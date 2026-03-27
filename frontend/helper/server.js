const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const PORT = 4876;
const HOST = "127.0.0.1";

const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads", "YTGrab");
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const ALLOWED_ORIGINS = [
  "https://yt-grab-by-devesh-raj.vercel.app",
  "http://localhost:5173"
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  }
}));

app.use(express.json());

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
      resolve(stdout);
    });
  });
}

function runFfmpegVersion() {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function formatDuration(sec) {
  if (!sec || Number.isNaN(sec)) return "—";
  const s = Number(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function formatViews(v) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US").format(v);
}

function mapFormat(formatId) {
  const map = {
    "mp4-1080": { ext: "mp4", audio: true },
    "mp4-720": { ext: "mp4", audio: true },
    "mp4-480": { ext: "mp4", audio: true },
    "mp4-360": { ext: "mp4", audio: true },
    "mp3-320": { ext: "mp3", audioOnly: true },
    "mp3-192": { ext: "mp3", audioOnly: true },
    "m4a": { ext: "m4a", audioOnly: true }
  };
  return map[formatId] || { ext: "mp4", audio: true };
}

function getCookieBrowser(browser = "chrome") {
  const supported = ["chrome", "firefox", "brave", "edge", "safari"];
  return supported.includes(browser) ? browser : "chrome";
}

app.get("/health", async (_req, res) => {
  const ffmpegOk = await runFfmpegVersion();
  res.json({
    ok: true,
    app: "YTGrab Helper",
    version: "1.0.0",
    ffmpeg: ffmpegOk,
    downloadsDir: DOWNLOADS_DIR
  });
});

app.post("/api/info", async (req, res) => {
  const { url, browser = "chrome" } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  try {
    const args = [
      "--dump-json",
      "--flat-playlist",
      "--no-warnings",
      "--cookies-from-browser", getCookieBrowser(browser),
      url
    ];

    const raw = await runYtDlp(args);
    const lines = raw.split("\n").filter(Boolean);

    const videos = lines.map((line) => {
      const v = JSON.parse(line);
      return {
        id: v.id,
        title: v.title || v.fulltitle || "Unknown",
        channel: v.uploader || v.channel || "Unknown",
        duration: formatDuration(v.duration),
        views: formatViews(v.view_count),
        thumb: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`
      };
    });

    return res.json({
      isPlaylist: videos.length > 1,
      videos
    });
  } catch (err) {
    return res.status(500).json({
      error: String(err.message || err)
    });
  }
});

app.post("/api/download", async (req, res) => {
  const { url, formatId = "mp4-720", browser = "chrome" } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const fmt = mapFormat(formatId);
  const outputTemplate = path.join(DOWNLOADS_DIR, "%(title)s.%(ext)s");

  try {
    let args = [
      "--no-playlist",
      "--newline",
      "-o", outputTemplate,
      "--cookies-from-browser", getCookieBrowser(browser)
    ];

    if (fmt.audioOnly) {
      args = [
        ...args,
        "-x",
        "--audio-format", fmt.ext,
        url
      ];
    } else {
      args = [
        ...args,
        "--merge-output-format", fmt.ext,
        url
      ];
    }

    await runYtDlp(args);

    return res.json({
      ok: true,
      message: "Download started/completed locally",
      folder: DOWNLOADS_DIR
    });
  } catch (err) {
    return res.status(500).json({
      error: String(err.message || err)
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`YTGrab Helper running on http://${HOST}:${PORT}`);
});