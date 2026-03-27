const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const archiver = require("archiver");

const app = express();
const PORT = process.env.PORT || 5000;
// Use OS temp directory for intermediate files so we don't write into
// backend's local `downloads/` folder.
const DOWNLOADS_DIR = process.env.USER_WORK_DIR || path.join(os.tmpdir(), "ytgrab-downloads");
const USER_DOWNLOADS_DIR = process.env.USER_DOWNLOADS_DIR || path.join(os.homedir(), "Downloads");

// Ensure downloads (work) directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
try { if (!fs.existsSync(USER_DOWNLOADS_DIR)) fs.mkdirSync(USER_DOWNLOADS_DIR, { recursive: true }); } catch {}

const allowedOrigins = [
  'http://localhost:5173',
  'https://yt-grab-by-devesh-raj.vercel.app',
  'https://ytgrab-by-devesh-raj.onrender.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());

app.use("/downloads", express.static(DOWNLOADS_DIR));

function sendAttachment(res, filePath, filename) {
  const rawName = String(filename || "download");
  // Node's header values must be ASCII-safe; replace non-ASCII characters.
  const safeAscii = rawName
    .replace(/"/g, "'")
    .replace(/\r?\n/g, " ")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 120);

  res.setHeader("Content-Type", "application/octet-stream");
  // Keep Content-Disposition strictly ASCII-safe to avoid Node header validation crashes.
  // (This means browser may use a slightly sanitized filename for non-ASCII titles.)
  res.setHeader("Content-Disposition", `attachment; filename="${safeAscii || "download"}"`);

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).json({ error: "Failed to read file" });
  });
  stream.pipe(res);
}

async function copyToUserDownloads(srcPath, preferredName) {
  try {
    if (!srcPath || !preferredName) return;
    if (!fs.existsSync(srcPath)) return;
    if (!USER_DOWNLOADS_DIR) return;

    await fs.promises.mkdir(USER_DOWNLOADS_DIR, { recursive: true });

    const ext = path.extname(preferredName);
    const base = path.basename(preferredName, ext);
    let destName = preferredName;
    let destPath = path.join(USER_DOWNLOADS_DIR, destName);

    // Avoid overwriting existing files.
    let i = 1;
    while (fs.existsSync(destPath)) {
      destName = `${base} (${i})${ext}`;
      destPath = path.join(USER_DOWNLOADS_DIR, destName);
      i += 1;
      if (i > 500) break;
    }

    await fs.promises.copyFile(srcPath, destPath);
  } catch (e) {
    console.warn("Copy to OS Downloads failed:", e?.message || e);
  }
}

function getDisplayFilename(job, storedFilename) {
  const name = String(storedFilename || "");
  const jobId = job && job.id ? job.id : null;
  if (jobId) {
    const prefix = `${jobId}_`;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name || "download";
}

// ─── Format map: our format ID → yt-dlp format string ──────────────────────
const FORMAT_MAP = {
  "mp4-4k":    { format: "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160][ext=mp4]", ext: "mp4" },
  "mp4-quick": { format: "bestvideo[codec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]", ext: "mp4" },
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

// ─── In-memory playlist job store ─────────────────────────────────────────
const playlistJobs = {}; // playlistJobId -> { id, jobIds, status, progress, zipFilename, error, createdAt }

// ─── Helper: run yt-dlp and return a promise ────────────────────────────────
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `yt-dlp exited with code ${code}`));
    });
  });
}

function defaultCookiesFromBrowserArgs() {
  // Optional "just work like before" mode for local dev:
  // set YTGRAB_COOKIES_FROM_BROWSER=chrome|firefox|safari|edge|brave|chromium
  // so yt-dlp can reuse your logged-in browser session.
  const v = String(process.env.YTGRAB_COOKIES_FROM_BROWSER || "").trim();
  if (!v) return null;
  return ["--cookies-from-browser", v];
}

function preferredBrowsers() {
  const env = String(process.env.YTGRAB_COOKIES_FROM_BROWSER || "").trim();
  if (env) return [env];

  // Reasonable defaults for local dev; user can override via env.
  if (process.platform === "darwin") return ["chrome", "brave", "edge", "firefox", "safari", "chromium"];
  if (process.platform === "win32") return ["chrome", "edge", "brave", "firefox", "chromium"];
  return ["chrome", "chromium", "brave", "edge", "firefox"];
}

function withBrowserCookies(args, browser) {
  return ["--cookies-from-browser", browser, ...args];
}

async function runYtDlpWithBrowserFallback(baseArgs) {
  const browsers = preferredBrowsers();
  let lastErr = null;
  for (const b of browsers) {
    try {
      return await runYtDlp(withBrowserCookies(baseArgs, b));
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || "");
      // If yt-dlp can't read that browser's cookies, try next. Otherwise stop early.
      const retryable =
        /cookies-from-browser/i.test(msg) ||
        /could not/i.test(msg) ||
        /not (?:found|installed)/i.test(msg) ||
        /permission/i.test(msg);
      if (!retryable) break;
    }
  }
  throw lastErr || new Error("yt-dlp failed");
}

// ─── GET /api/info?url=... ──────────────────────────────────────────────────
// Returns video or playlist metadata
app.get("/api/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const raw = await runYtDlpWithBrowserFallback([
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      url,
    ]);

    // yt-dlp outputs one JSON object per line for playlists
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
    const msg = String(err?.message || err || "");
    console.error("Info error:", msg);
    const isBotCheck = /Sign in to confirm you(?:'|’)re not a bot/i.test(msg) || /Use --cookies-from-browser or --cookies/i.test(msg);
    res.status(500).json({ error: msg, code: isBotCheck ? "BOT_CHECK" : undefined });
  }
});

// ─── POST /api/download ─────────────────────────────────────────────────────
// Body: { url, formatId }
// Returns: { jobId }
app.post("/api/download", (req, res) => {
  const { url, formatId } = req.body;
  if (!url || !formatId) return res.status(400).json({ error: "url and formatId are required" });

  const fmtConfig = FORMAT_MAP[formatId];
  if (!fmtConfig) return res.status(400).json({ error: "Invalid formatId" });

  const jobId = uuidv4();
  const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}_%(title)s.%(ext)s`);

  // Build yt-dlp args
  const browser = preferredBrowsers()[0];
  const args = withBrowserCookies([
    "--no-playlist",
    "--merge-output-format", fmtConfig.ext,
    "-o", outputTemplate,
    "--newline",  // progress on each line
  ], browser);

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
    kind: "single",      // single | playlistZip
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
  const proc = spawn("yt-dlp", args);
  let stderrBuf = "";

  proc.stdout.on("data", data => {
    const line = data.toString();
    // Parse progress lines like: [download]  42.3% of 25.00MiB at 1.20MiB/s ETA 00:18
    const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+[\d.]+\S+\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/);
    if (progressMatch) {
      job.progress = parseFloat(progressMatch[1]);
      job.speed = progressMatch[2];
      job.eta = progressMatch[3];
    }
    // Detect destination file
    const destMatch = line.match(/\[(?:download|ExtractAudio|Merger)\] Destination: (.+)/);
    if (destMatch) job.filename = path.basename(destMatch[1]);
  });

  proc.stderr.on("data", data => {
    const s = data.toString();
    stderrBuf += s;
    if (stderrBuf.length > 20000) stderrBuf = stderrBuf.slice(-20000);
    console.error("yt-dlp stderr:", s);
  });

  proc.on("close", code => {
    if (code === 0) {
      job.status = "done";
      job.progress = 100;
      // Resolve the output file reliably (final filename on disk).
      job.filename = resolveJobFilename(job);

      // No server-side copy to ~/Downloads.
      // We rely on the browser download flow (attachment response) so
      // the user sees only one file with the standard download UI.
    } else {
      job.status = "error";
      const isBotCheck = /Sign in to confirm you(?:'|’)re not a bot/i.test(stderrBuf) || /Use --cookies-from-browser or --cookies/i.test(stderrBuf);
      job.error = isBotCheck
        ? "YouTube blocked this request (bot-check). Upload a cookies.txt export and retry."
        : (stderrBuf.trim().split("\n").slice(-3).join(" ").trim() || `yt-dlp exited with code ${code}`);
    }
  });
}

// Resolve the final filename for a finished job.
// Why: yt-dlp sometimes reports intermediate destinations, but the final file
// on disk can differ in extension. This verifies existence and falls back to
// the most recently modified file matching the job id prefix.
function resolveJobFilename(job) {
  if (!job || !job.id) return null;

  if (job.filename) {
    const maybePath = path.join(DOWNLOADS_DIR, job.filename);
    if (fs.existsSync(maybePath)) return job.filename;
  }

  const files = fs.readdirSync(DOWNLOADS_DIR)
    .filter(f => f.startsWith(job.id))
    .map(f => {
      const stat = fs.statSync(path.join(DOWNLOADS_DIR, f));
      return { f, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  if (files.length > 0) return files[files.length - 1].f;
  return null;
}

// ─── GET /api/job/:jobId ────────────────────────────────────────────────────
app.get("/api/job/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  const displayName = job.filename ? getDisplayFilename(job, job.filename) : null;
  res.json({
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    filename: displayName,
    downloadUrl: displayName ? `/api/job/${req.params.jobId}/file` : null,
    error: job.error,
  });
});

// ─── GET /api/job/:jobId/file (attachment download) ─────────────────────────
// Forces a real download in the user's filesystem (prevents "open in new tab").
app.get("/api/job/:jobId/file", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "done") return res.status(409).json({ error: "Job not finished yet" });

  const filename = resolveJobFilename(job);
  if (!filename) return res.status(404).json({ error: "Downloaded file not found" });

  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File missing on disk" });

  const displayName = getDisplayFilename(job, filename);
  sendAttachment(res, filePath, displayName);
});

// ─── POST /api/download-playlist ───────────────────────────────────────────
// Body: { urls: string[], formatId }
// Returns: { jobIds: string[] }
app.post("/api/download-playlist", (req, res) => {
  const { urls, formatId } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "urls array required" });

  const fmtConfig = FORMAT_MAP[formatId];
  if (!fmtConfig) return res.status(400).json({ error: "Invalid formatId" });

  const browser = preferredBrowsers()[0];
  const jobIds = urls.map((url, index) => {
    const jobId = uuidv4();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}_%(title)s.%(ext)s`);
    const args = withBrowserCookies([
      "--no-playlist",
      "--merge-output-format", fmtConfig.ext,
      "-o", outputTemplate,
      "--newline",
    ], browser);
    if (fmtConfig.audioOnly) {
      args.push("-x", "--audio-format", fmtConfig.ext);
      if (fmtConfig.audioBitrate) args.push("--audio-quality", `${fmtConfig.audioBitrate}K`);
    } else {
      args.push("-f", fmtConfig.format);
    }
    args.push(url);

    const job = {
      id: jobId, url, formatId,
      kind: "playlistZip", // keep consistent with playlist ZIP behavior
      status: "pending", progress: 0, speed: "", eta: "",
      filename: null, error: null, createdAt: Date.now(),
    };
    jobs[jobId] = job;

    // Stagger starts slightly to avoid hammering
    setTimeout(() => startDownload(job, args), index * 500);
    return jobId;
  });

  res.json({ jobIds });
});

// ─── POST /api/download-playlist-zip ─────────────────────────────────────────
// Creates individual jobs for each URL, waits until all are done, then zips them
// into a single archive for direct download.
// Body: { urls: string[], formatId }
// Returns: { playlistJobId, jobIds }
app.post("/api/download-playlist-zip", (req, res) => {
  const { urls, formatId } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "urls array required" });

  const fmtConfig = FORMAT_MAP[formatId];
  if (!fmtConfig) return res.status(400).json({ error: "Invalid formatId" });

  const playlistJobId = uuidv4();
  const browser = preferredBrowsers()[0];
  const jobIds = urls.map((url, index) => {
    const jobId = uuidv4();
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}_%(title)s.%(ext)s`);
    const args = withBrowserCookies([
      "--no-playlist",
      "--merge-output-format", fmtConfig.ext,
      "-o", outputTemplate,
      "--newline",
    ], browser);

    if (fmtConfig.audioOnly) {
      args.push("-x", "--audio-format", fmtConfig.ext);
      if (fmtConfig.audioBitrate) args.push("--audio-quality", `${fmtConfig.audioBitrate}K`);
    } else {
      args.push("-f", fmtConfig.format);
    }

    args.push(url);

    const job = {
      id: jobId,
      url,
      formatId,
      kind: "playlistZip", // used to decide whether to copy per-item output to OS Downloads
      status: "pending",
      progress: 0,
      speed: "",
      eta: "",
      filename: null,
      error: null,
      createdAt: Date.now(),
    };

    jobs[jobId] = job;

    // Stagger starts slightly to avoid hammering
    setTimeout(() => startDownload(job, args), index * 500);
    return jobId;
  });

  const playlistJob = {
    id: playlistJobId,
    jobIds,
    status: "pending", // pending | downloading | zipping | done | error
    progress: 0,
    zipFilename: null,
    error: null,
    createdAt: Date.now(),
  };

  playlistJobs[playlistJobId] = playlistJob;

  // Wait until all jobs complete, then zip.
  (function waitAndZip() {
    const timer = setInterval(async () => {
      const jobStates = playlistJob.jobIds.map(jid => jobs[jid]);
      const anyMissing = jobStates.some(j => !j);
      if (anyMissing) {
        playlistJob.status = "error";
        playlistJob.error = "One or more jobs not found in memory.";
        clearInterval(timer);
        return;
      }

      const anyError = jobStates.some(j => j.status === "error");
      if (anyError) {
        const errJob = jobStates.find(j => j.status === "error");
        playlistJob.status = "error";
        playlistJob.error = errJob?.error || "Playlist download job failed";
        clearInterval(timer);
        return;
      }

      const allDone = jobStates.every(j => j.status === "done");
      const avgProgress = jobStates.reduce((sum, j) => sum + (j.progress || 0), 0) / jobStates.length;
      playlistJob.progress = Math.round(avgProgress);

      if (allDone) {
        clearInterval(timer);
        playlistJob.status = "zipping";
        try {
          const zipFilename = `${playlistJob.id}_playlist.zip`;
          const zipPath = path.join(DOWNLOADS_DIR, zipFilename);

          // Create zip archive using streaming (archiver).
          const output = fs.createWriteStream(zipPath);
          const archive = archiver("zip", { zlib: { level: 9 } });
          archive.on("warning", err => {
            // Missing files shouldn't crash the whole operation.
            if (err?.code !== "ENOENT") console.warn("zip warning:", err);
          });
          archive.pipe(output);

          // Add completed files.
          playlistJob.jobIds.forEach(jid => {
            const job = jobs[jid];
            const filename = resolveJobFilename(job);
            if (!filename) return;
            const filePath = path.join(DOWNLOADS_DIR, filename);
            if (fs.existsSync(filePath)) {
              // Put each file at the root of the zip.
              const entryName = getDisplayFilename(job, filename);
              archive.file(filePath, { name: entryName });
            }
          });

          await new Promise((resolve, reject) => {
            output.on("close", resolve);
            output.on("error", reject);
            archive.on("error", err => {
              playlistJob.status = "error";
              playlistJob.error = String(err?.message || err);
              reject(err);
            });
            archive.finalize().catch(reject);
          });

          playlistJob.zipFilename = zipFilename;
          playlistJob.progress = 100;
          playlistJob.status = "done";

          // No server-side copy to ~/Downloads.
          // The browser download flow will save the ZIP when requested.
        } catch (e) {
          playlistJob.status = "error";
          playlistJob.error = String(e?.message || e);
        }
      } else {
        // Mark as "downloading" once anything starts.
        playlistJob.status = "downloading";
      }
    }, 1000);
  })();

  res.json({ playlistJobId, jobIds });
});

// ─── GET /api/playlist-job/:playlistJobId ───────────────────────────────────
app.get("/api/playlist-job/:playlistJobId", (req, res) => {
  const playlistJob = playlistJobs[req.params.playlistJobId];
  if (!playlistJob) return res.status(404).json({ error: "Playlist job not found" });

  res.json({
    status: playlistJob.status,
    progress: playlistJob.progress,
    zipFilename: playlistJob.zipFilename,
    downloadUrl: playlistJob.zipFilename ? `/api/playlist-job/${playlistJob.id}/file` : null,
    error: playlistJob.error,
  });
});

// ─── GET /api/playlist-job/:playlistJobId/file (attachment download) ─────
app.get("/api/playlist-job/:playlistJobId/file", (req, res) => {
  const playlistJob = playlistJobs[req.params.playlistJobId];
  if (!playlistJob) return res.status(404).json({ error: "Playlist job not found" });
  if (playlistJob.status !== "done") return res.status(409).json({ error: "ZIP not ready yet" });

  const filename = playlistJob.zipFilename || `${playlistJob.id}_playlist.zip`;
  const filePath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "ZIP file missing on disk" });

  sendAttachment(res, filePath, "playlist.zip");
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

// ─── Auto-cleanup: delete files older than 1 hour ──────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const partialCutoff = Date.now() - 12 * 60 * 60 * 1000; // keep last 12h parts
  const cookiesCutoff = Date.now() - 12 * 60 * 60 * 1000; // keep last 12h cookies
  const activeJobIds = new Set(
    Object.values(jobs)
      .filter(j => j && (j.status === "downloading" || j.status === "pending"))
      .map(j => j.id)
  );
  const activePlaylistJobIds = new Set(
    Object.values(playlistJobs)
      .filter(j => j && j.status !== "done" && j.status !== "error")
      .map(j => j.id)
  );

  Object.entries(jobs).forEach(([id, job]) => {
    // Don't delete active downloads; only clean up finished jobs.
    if (job.createdAt < cutoff && (job.status === "done" || job.status === "error")) {
      if (job.filename) {
        const fp = path.join(DOWNLOADS_DIR, job.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
      delete jobs[id];
    }
  });

  Object.entries(playlistJobs).forEach(([id, pjob]) => {
    if (pjob.createdAt < cutoff && (pjob.status === "done" || pjob.status === "error")) {
      if (pjob.zipFilename) {
        const zp = path.join(DOWNLOADS_DIR, pjob.zipFilename);
        if (fs.existsSync(zp)) fs.unlinkSync(zp);
      }
      delete playlistJobs[id];
    }
  });

  // Extra safety: remove stale partial downloads if they exist.
  // This prevents "No space left on device" from repeated failed runs.
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    files.forEach(f => {
      if (!f.endsWith(".part")) return;
      if (!activeJobIds.size && !activePlaylistJobIds.size) {
        // fallthrough
      } else {
        for (const jid of activeJobIds) {
          if (f.startsWith(`${jid}_`)) return;
        }
      }

      const full = path.join(DOWNLOADS_DIR, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < partialCutoff) {
        fs.unlinkSync(full);
      }
    });
  } catch {}

  // Clean up cookie files (best-effort).
}, 10 * 60 * 1000);

// ─── Health check ───────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, jobs: Object.keys(jobs).length }));

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
