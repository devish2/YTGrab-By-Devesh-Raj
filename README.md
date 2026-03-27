# YTGrab — YouTube Downloader (Full-Stack)

AI-powered YouTube video & playlist downloader. Backend powered by **yt-dlp** + Node.js/Express. Frontend built with **React + Vite**.

---

## 📁 Project Structure

```
ytgrab/
├── backend/
│   ├── server.js          ← Express API server
│   ├── package.json
└── frontend/
    ├── src/
    │   └── App.jsx        ← React frontend
    ├── package.json
    └── vite.config.js
```

---

## ⚙️ Prerequisites

| Tool | Install |
|------|---------|
| **Node.js** ≥ 18 | https://nodejs.org |
| **Python** ≥ 3.8 | https://python.org |
| **yt-dlp** | `pip install yt-dlp` or `brew install yt-dlp` |
| **ffmpeg** | `brew install ffmpeg` / `apt install ffmpeg` / https://ffmpeg.org |

Verify installs:
```bash
node --version
yt-dlp --version
ffmpeg -version
```

---

## 🚀 Quick Start

### 1. Backend

```bash
cd backend
npm install
npm start
# → API running at http://localhost:5000
```

For development with auto-reload:
```bash
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → App running at http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## 🔌 API Endpoints

### `GET /api/health`
Health check.
```json
{ "ok": true, "jobs": 3 }
```

### `GET /api/info?url=<youtube_url>`
Fetch video/playlist metadata.
```json
{
  "isPlaylist": false,
  "videos": [{
    "id": "dQw4w9WgXcQ",
    "title": "Never Gonna Give You Up",
    "channel": "Rick Astley",
    "duration": "3:32",
    "views": "1.5B views",
    "thumb": "https://...",
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ"
  }]
}
```

### `POST /api/download`
Start a single video download job.
```json
// Request
{ "url": "https://youtube.com/watch?v=...", "formatId": "mp4-1080" }

// Response
{ "jobId": "uuid-here" }
```

### `GET /api/job/:jobId`
Poll job status.
```json
{
  "status": "downloading",   // pending | downloading | done | error
  "progress": 42.5,
  "speed": "1.20MiB/s",
  "eta": "00:18",
  "filename": "uuid_title.mp4",
  "downloadUrl": "/downloads/uuid_title.mp4",
  "error": null
}
```

### `POST /api/download-playlist`
Start multiple download jobs in parallel.
```json
// Request
{ "urls": ["https://...", "https://..."], "formatId": "mp3-320" }

// Response
{ "jobIds": ["uuid-1", "uuid-2"] }
```

### `DELETE /api/job/:jobId`
Delete a job and its file.

---

## 🎛️ Supported Formats

| ID | Format | Type |
|----|--------|------|
| `mp4-4k` | MP4 2160p | Video |
| `mp4-1080` | MP4 1080p | Video |
| `mp4-720` | MP4 720p | Video |
| `mp4-480` | MP4 480p | Video |
| `mp4-360` | MP4 360p | Video |
| `webm-1080` | WebM 1080p | Video |
| `webm-720` | WebM 720p | Video |
| `mp3-320` | MP3 320kbps | Audio |
| `mp3-192` | MP3 192kbps | Audio |
| `mp3-128` | MP3 128kbps | Audio |
| `aac` | AAC 256kbps | Audio |
| `flac` | FLAC Lossless | Audio |
| `wav` | WAV Lossless | Audio |
| `ogg` | OGG Vorbis | Audio |
| `m4a` | M4A 256kbps | Audio |

---

## 🐋 Docker (optional)

```dockerfile
# backend/Dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg
RUN pip3 install yt-dlp
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]
```

```bash
docker build -t ytgrab-api ./backend
docker run -p 5000:5000 ytgrab-api
```

---

## 🔒 Notes

- Downloaded files are auto-deleted after **1 hour**.
- If YouTube blocks requests with "sign in to confirm you're not a bot", the backend reuses your local browser session via `yt-dlp --cookies-from-browser`. You can override the browser by setting `YTGRAB_COOKIES_FROM_BROWSER=chrome` (or `firefox`, `safari`, etc).
- This tool is for **personal use only**.
- Respect YouTube's Terms of Service and copyright law.
- Consider adding rate limiting (`express-rate-limit`) before deploying publicly.
