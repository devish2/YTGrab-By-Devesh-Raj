const express = require("express");
const cors = require("cors");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 5000;
const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const COOKIES_FILE  = path.join(__dirname, "cookies.txt");  // persisted on Render disk

// ─── Disk management config ─────────────────────────────────────────────────
const MAX_DISK_BYTES   = parseInt(process.env.MAX_DISK_MB  || "800")  * 1024 * 1024;
const FILE_TTL_MS      = parseInt(process.env.FILE_TTL_MIN || "30")   * 60 * 1000;
const MIN_FREE_BYTES   = parseInt(process.env.MIN_FREE_MB  || "150")  * 1024 * 1024;
const CLEANUP_INTERVAL = parseInt(process.env.CLEANUP_SEC  || "120")  * 1000;

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// ─── YouTube bypass strategies ───────────────────────────────────────────────
// Strategy order: proxy → po_token → cookies → plain (best to worst)

const PROXY_URL = process.env.YTDLP_PROXY || "";  // e.g. http://user:pass@host:port

// PO Token is a proof-of-origin token that bypasses bot detection completely.
// Generate one at: https://github.com/YunzheZJU/youtube-po-token-generator
// Then set it as YTDLP_PO_TOKEN env var on Render.
const PO_TOKEN    = process.env.YTDLP_PO_TOKEN    || "";
const VISITOR_DATA = process.env.YTDLP_VISITOR_DATA || "";

function hasCookies() {
  try { return fs.existsSync(COOKIES_FILE) && fs.statSync(COOKIES_FILE).size > 50; }
  catch { return false; }
}

/** Build yt-dlp args for a given bypass strategy */
function argsForStrategy(strategy) {
  const base = [
    "--no-check-certificates",
    "--extractor-retries", "5",
    "--fragment-retries", "5",
    "--retry-sleep", "exp=1:10",
    "--no-warnings",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ];

  switch (strategy) {
    case "proxy":
      return [
        ...base,
        "--proxy", PROXY_URL,
        "--add-headers", "Accept-Language:en-US,en;q=0.9",
      ];

    case "po_token":
      return [
        ...base,
        "--extractor-args",
        `youtube:player_client=web;po_token=web+${PO_TOKEN}`,
        "--extractor-args", `youtube:visitor_data=${VISITOR_DATA}`,
      ];

    case "cookies":
      return [
        ...base,
        "--cookies", COOKIES_FILE,
        "--add-headers", "Accept-Language:en-US,en;q=0.9",
      ];

    case "android":
      // Use Android client — different player endpoint, harder to block
      return [
        ...base,
        "--extractor-args", "youtube:player_client=android",
      ];

    case "tv":
      // YouTube TV/embedded client — often unblocked even on datacenter IPs
      return [
        ...base,
        "--extractor-args", "youtube:player_client=tv_embedded,web",
      ];

    case "plain":
    default:
      return base;
  }
}

/** Ordered list of strategies to try */
function getStrategies() {
  const strategies = [];
  if (PROXY_URL)                        strategies.push("proxy");
  if (PO_TOKEN && VISITOR_DATA)         strategies.push("po_token");
  if (hasCookies())                     strategies.push("cookies");
  // Always include client-switching fallbacks — no config needed
  strategies.push("tv", "android", "plain");
  return [...new Set(strategies)]; // dedupe
}

function isBlockedError(stderr) {
  return /Sign in to confirm|bot|blocked|HTTP Error 429|HTTP Error 403|Precondition check failed|This video is not available/i.test(stderr);
}

// ─── Disk helpers ───────────────────────────────────────────────────────────

/** Total bytes used inside DOWNLOADS_DIR */
function getDirBytes() {
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    return files.reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(DOWNLOADS_DIR, f)).size; }
      catch { return sum; }
    }, 0);
  } catch { return 0; }
}

/** Bytes free on the underlying filesystem (cross-platform) */
function getFreeBytes() {
  try {
    // Linux / macOS: df -Pk <dir> prints 1K-blocks
    const out = execSync(`df -Pk "${DOWNLOADS_DIR}"`, { timeout: 3000 }).toString();
    const line = out.split("\n")[1];
    const available = parseInt(line.trim().split(/\s+/)[3]);
    return available * 1024;
  } catch {
    return Infinity; // can't determine — don't block
  }
}

/** Delete oldest completed/error files until bytes used < target */
function evictOldFiles(targetBytes = MAX_DISK_BYTES * 0.7) {
  // Collect files with mtime
  let files;
  try {
    files = fs.readdirSync(DOWNLOADS_DIR).map(f => {
      const fp = path.join(DOWNLOADS_DIR, f);
      try { return { name: f, fp, mtime: fs.statSync(fp).mtimeMs, size: fs.statSync(fp).size }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return; }

  // Sort oldest first
  files.sort((a, b) => a.mtime - b.mtime);

  let used = files.reduce((s, f) => s + f.size, 0);
  let removed = 0;
  for (const file of files) {
    if (used <= targetBytes) break;
    try {
      fs.unlinkSync(file.fp);
      used -= file.size;
      removed++;
      console.log(`[cleanup] Evicted ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      // Remove from job store too
      Object.keys(jobs).forEach(id => {
        if (jobs[id].filename === file.name) delete jobs[id];
      });
    } catch {}
  }
  if (removed > 0) console.log(`[cleanup] Evicted ${removed} file(s). Dir now ~${(used/1024/1024).toFixed(0)} MB`);
}

/** True if it's safe to start a new download */
function hasSufficientSpace() {
  const dirBytes  = getDirBytes();
  const freeBytes = getFreeBytes();
  if (dirBytes  >= MAX_DISK_BYTES) { evictOldFiles(); }
  if (freeBytes <  MIN_FREE_BYTES) { evictOldFiles(MAX_DISK_BYTES * 0.5); }
  return getDirBytes() < MAX_DISK_BYTES && getFreeBytes() >= MIN_FREE_BYTES;
}

app.use(cors());
app.use(express.json());
app.use("/downloads", express.static(DOWNLOADS_DIR));

// ─── Format map: our format ID → yt-dlp format string ──────────────────────
const FORMAT_MAP = {
  "mp4-4k":    { format: "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]", ext: "mp4" },
  "mp4-1080":  { format: "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]", ext: "mp4" },
  "mp4-720":   { format: "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]",  ext: "mp4" },
  "mp4-480":   { format: "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]",  ext: "mp4" },
  "mp4-360":   { format: "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]",  ext: "mp4" },
  "webm-1080": { format: "bestvideo[height<=1080][ext=webm]+bestaudio[ext=webm]/best[height<=1080][ext=webm]", ext: "webm" },
  "webm-720":  { format: "bestvideo[height<=720][ext=webm]+bestaudio[ext=webm]/best[height<=720][ext=webm]",  ext: "webm" },
  "mp3-320":   { format: "bestaudio", ext: "mp3", audioOnly: true, audioBitrate: "320" },
  "mp3-192":   { format: "bestaudio", ext: "mp3", audioOnly: true, audioBitrate: "192" },
  "mp3-128":   { format: "bestaudio", ext: "mp3", audioOnly: true, audioBitrate: "128" },
  "aac":       { format: "bestaudio", ext: "aac", audioOnly: true },
  "flac":      { format: "bestaudio", ext: "flac", audioOnly: true },
  "wav":       { format: "bestaudio", ext: "wav", audioOnly: true },
  "ogg":       { format: "bestaudio", ext: "ogg", audioOnly: true },
  "m4a":       { format: "bestaudio[ext=m4a]/bestaudio", ext: "m4a", audioOnly: true },
};

// ─── In-memory job store ────────────────────────────────────────────────────
const jobs = {};

// ─── Helper: run yt-dlp with automatic strategy fallback ────────────────────
async function runYtDlp(extraArgs) {
  const strategies = getStrategies();
  let lastError = null;

  for (const strategy of strategies) {
    const args = [...argsForStrategy(strategy), ...extraArgs];
    console.log(`[yt-dlp] Trying strategy: ${strategy}`);
    try {
      const result = await runYtDlpOnce(args);
      if (strategy !== strategies[0]) {
        console.log(`[yt-dlp] Success with strategy: ${strategy}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      if (isBlockedError(err.message)) {
        console.warn(`[yt-dlp] Strategy "${strategy}" blocked — trying next…`);
        continue; // try next strategy
      }
      throw err; // non-block error (bad URL, etc.) — don't retry
    }
  }

  // All strategies exhausted
  const finalErr = new Error("YOUTUBE_BLOCKED:" + (lastError?.message || "All bypass strategies failed"));
  throw finalErr;
}

function runYtDlpOnce(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(
          isBlockedError(stderr) ? "YOUTUBE_BLOCKED:" + stderr : (stderr || `exit ${code}`)
        ));
      }
    });
  });
}

// ─── GET /api/info?url=... ──────────────────────────────────────────────────
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const raw = await runYtDlp([
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      url,
    ]);

    const lines = raw.split("\n").filter(Boolean);
    const videos = lines.map(line => {
      try {
        const v = JSON.parse(line);
        return {
          id: v.id,
          title: v.title || v.fulltitle || "Unknown",
          channel: v.uploader || v.channel || "Unknown",
          duration: formatDuration(v.duration),
          views: formatViews(v.view_count),
          thumb: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`,
        };
      } catch { return null; }
    }).filter(Boolean);

    const isPlaylist = videos.length > 1;
    res.json({ isPlaylist, videos });
  } catch (err) {
    console.error("Info error:", err.message);
    if (err.message.startsWith("YOUTUBE_BLOCKED:")) {
      return res.status(403).json({ error: "YouTube blocked this request. Paste a valid YouTube cookies.txt export below, then retry.", code: "YOUTUBE_BLOCKED" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/download ─────────────────────────────────────────────────────
// Body: { url, formatId }
// Returns: { jobId }
app.post("/api/download", (req, res) => {
  const { url, formatId } = req.body;
  if (!url || !formatId) return res.status(400).json({ error: "url and formatId are required" });

  // ── Disk space guard ──
  if (!hasSufficientSpace()) {
    return res.status(507).json({
      error: "Server disk is full. Please try again in a few minutes while old files are cleaned up.",
      code: "DISK_FULL",
    });
  }

  const fmtConfig = FORMAT_MAP[formatId];
  if (!fmtConfig) return res.status(400).json({ error: "Invalid formatId" });

  const jobId = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}_%(title)s.%(ext)s`);

  // Build yt-dlp args
  const args = [
    "--no-playlist",
    "--merge-output-format", fmtConfig.ext,
    "-o", outputTemplate,
    "--newline",  // progress on each line
  ];

  if (fmtConfig.audioOnly) {
    args.push("-x", "--audio-format", fmtConfig.ext);
    if (fmtConfig.audioBitrate) args.push("--audio-quality", `${fmtConfig.audioBitrate}K`);
  } else {
    args.push("-f", fmtConfig.format);
  }

  // ffmpeg is required for merging; add path if needed
  // args.push("--ffmpeg-location", "/usr/bin/ffmpeg");

  args.push(url);

  const job = {
    id: jobId,
    url,
    formatId,
    status: "pending",   // pending | downloading | done | error
    progress: 0,
    speed: "",
    eta: "",
    filename: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs[jobId] = job;

  // Kick off async
  startDownload(job, args);

  res.json({ jobId });
});

function startDownload(job, args) {
  job.status = "downloading";
  const fullArgs = [...baseYtDlpArgs(), ...args];
  const proc = spawn("yt-dlp", fullArgs);

  proc.stdout.on("data", data => {
    const line = data.toString();
    const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
    if (progressMatch) {
      job.progress = parseFloat(progressMatch[1]);
      job.speed = progressMatch[2];
      job.eta = progressMatch[3];
    }
    const destMatch = line.match(/\[(?:download|ExtractAudio|Merger)\] Destination: (.+)/);
    if (destMatch) job.filename = path.basename(destMatch[1].trim());
  });

  proc.stderr.on("data", data => {
    const text = data.toString();
    console.error("yt-dlp stderr:", text);
    if (text.includes("Errno 28") || text.includes("No space left on device")) {
      proc.kill("SIGTERM");
      job.status = "error";
      job.error = "Server ran out of disk space. Please retry in a minute.";
      evictOldFiles(MAX_DISK_BYTES * 0.5);
      if (job.filename) { try { fs.unlinkSync(path.join(DOWNLOADS_DIR, job.filename)); } catch {} }
      try { fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(job.id)).forEach(f => { try { fs.unlinkSync(path.join(DOWNLOADS_DIR, f)); } catch {} }); } catch {}
    }
    if (/Sign in to confirm|bot|blocked|HTTP Error 429|HTTP Error 403/i.test(text)) {
      proc.kill("SIGTERM");
      job.status = "error";
      job.error = "YOUTUBE_BLOCKED: YouTube blocked this download. Please add cookies via the Settings panel and retry.";
    }
  });

  proc.on("close", code => {
    if (job.status === "error") return;
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      if (!job.filename) {
        const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(job.id));
        if (files.length > 0) job.filename = files[0];
      }
    } else {
      job.status = "error";
      job.error = `yt-dlp exited with code ${code}`;
    }
  });
}

// ─── GET /api/job/:jobId ────────────────────────────────────────────────────
app.get("/api/job/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    filename: job.filename,
    downloadUrl: job.filename ? `/downloads/${encodeURIComponent(job.filename)}` : null,
    error: job.error,
  });
});

// ─── POST /api/download-playlist ───────────────────────────────────────────
// Body: { urls: string[], formatId }
// Returns: { jobIds: string[] }
app.post("/api/download-playlist", (req, res) => {
  const { urls, formatId } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "urls array required" });

  const fmtConfig = FORMAT_MAP[formatId];
  if (!fmtConfig) return res.status(400).json({ error: "Invalid formatId" });

  const jobIds = urls.map(url => {
    const jobId = uuidv4();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}_%(title)s.%(ext)s`);
    const args = [
      "--no-playlist",
      "--merge-output-format", fmtConfig.ext,
      "-o", outputTemplate,
      "--newline",
    ];
    if (fmtConfig.audioOnly) {
      args.push("-x", "--audio-format", fmtConfig.ext);
      if (fmtConfig.audioBitrate) args.push("--audio-quality", `${fmtConfig.audioBitrate}K`);
    } else {
      args.push("-f", fmtConfig.format);
    }
    args.push(url);

    const job = {
      id: jobId, url, formatId,
      status: "pending", progress: 0, speed: "", eta: "",
      filename: null, error: null, createdAt: Date.now(),
    };
    jobs[jobId] = job;

    // Stagger starts slightly to avoid hammering
    setTimeout(() => startDownload(job, args), jobIds.indexOf(jobId) * 500);
    return jobId;
  });

  res.json({ jobIds });
});

// ─── DELETE /api/job/:jobId ─────────────────────────────────────────────────
app.delete("/api/job/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  // Clean up file
  if (job.filename) {
    const filePath = path.join(DOWNLOADS_DIR, job.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  delete jobs[req.params.jobId];
  res.json({ deleted: true });
});

// ─── POST /api/cookies — save cookies.txt from the browser UI ──────────────
app.post("/api/cookies", (req, res) => {
  const { cookies } = req.body;
  if (!cookies || typeof cookies !== "string" || cookies.trim().length < 50) {
    return res.status(400).json({ error: "Invalid cookies content" });
  }
  // Basic Netscape format validation
  if (!cookies.includes(".youtube.com") && !cookies.includes("youtube")) {
    return res.status(400).json({ error: "Cookies must be from youtube.com" });
  }
  try {
    fs.writeFileSync(COOKIES_FILE, cookies.trim(), "utf8");
    console.log("[cookies] Updated cookies.txt —", cookies.trim().split("\n").length, "lines");
    res.json({ ok: true, lines: cookies.trim().split("\n").length });
  } catch (err) {
    res.status(500).json({ error: "Failed to save cookies: " + err.message });
  }
});

// ─── GET /api/cookies/status ────────────────────────────────────────────────
app.get("/api/cookies/status", (req, res) => {
  res.json({ hasCookies: hasCookies(), path: COOKIES_FILE });
});
setInterval(() => {
  const cutoff = Date.now() - FILE_TTL_MS;
  let freed = 0;
  Object.entries(jobs).forEach(([id, job]) => {
    if (job.createdAt < cutoff) {
      if (job.filename) {
        const fp = path.join(DOWNLOADS_DIR, job.filename);
        if (fs.existsSync(fp)) {
          try {
            const size = fs.statSync(fp).size;
            fs.unlinkSync(fp);
            freed += size;
          } catch {}
        }
      }
      delete jobs[id];
    }
  });
  if (freed > 0) console.log(`[cleanup] TTL removed ${(freed/1024/1024).toFixed(1)} MB`);

  // Also evict if dir is over limit regardless of TTL
  if (getDirBytes() > MAX_DISK_BYTES * 0.85) evictOldFiles();
}, CLEANUP_INTERVAL);

// ─── Health + disk stats ────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  const dirBytes  = getDirBytes();
  const freeBytes = getFreeBytes();
  res.json({
    ok: true,
    jobs: Object.keys(jobs).length,
    disk: {
      usedByDownloadsMB: Math.round(dirBytes  / 1024 / 1024),
      freeOnDeviceMB:    freeBytes === Infinity ? "unknown" : Math.round(freeBytes / 1024 / 1024),
      limitMB:           Math.round(MAX_DISK_BYTES / 1024 / 1024),
      healthy:           hasSufficientSpace(),
    }
  });
});

// ─── Manual purge endpoint (optional: protect with a secret in production) ──
app.post("/api/admin/purge", (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers["x-admin-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  evictOldFiles(0); // evict everything
  res.json({ ok: true, remaining: getDirBytes() });
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds) return "N/A";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
               : `${m}:${String(s).padStart(2,"0")}`;
}

function formatViews(n) {
  if (!n) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`;
  return `${n} views`;
}

app.listen(PORT, () => console.log(`✅ YTGrab API running on http://localhost:${PORT}`));