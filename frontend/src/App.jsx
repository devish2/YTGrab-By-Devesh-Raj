import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

const FORMATS = [
  { id: "mp4-4k",    label: "MP4 4K",        badge: "2160p", type: "video", size: "~2.1 GB" },
  { id: "mp4-1080",  label: "MP4 1080p",     badge: "HD",    type: "video", size: "~450 MB" },
  { id: "mp4-720",   label: "MP4 720p",      badge: "HD",    type: "video", size: "~220 MB" },
  { id: "mp4-480",   label: "MP4 480p",      badge: "SD",    type: "video", size: "~110 MB" },
  { id: "mp4-360",   label: "MP4 360p",      badge: "SD",    type: "video", size: "~60 MB"  },
  { id: "webm-1080", label: "WEBM 1080p",    badge: "HD",    type: "video", size: "~380 MB" },
  { id: "webm-720",  label: "WEBM 720p",     badge: "HD",    type: "video", size: "~180 MB" },
  { id: "mp3-320",   label: "MP3 320kbps",   badge: "HQ",    type: "audio", size: "~25 MB"  },
  { id: "mp3-192",   label: "MP3 192kbps",   badge: "HQ",    type: "audio", size: "~15 MB"  },
  { id: "mp3-128",   label: "MP3 128kbps",   badge: "",      type: "audio", size: "~10 MB"  },
  { id: "aac",       label: "AAC 256kbps",   badge: "HQ",    type: "audio", size: "~20 MB"  },
  { id: "flac",      label: "FLAC Lossless", badge: "MAX",   type: "audio", size: "~85 MB"  },
  { id: "wav",       label: "WAV Lossless",  badge: "MAX",   type: "audio", size: "~95 MB"  },
  { id: "ogg",       label: "OGG Vorbis",    badge: "",      type: "audio", size: "~12 MB"  },
  { id: "m4a",       label: "M4A 256kbps",   badge: "HQ",    type: "audio", size: "~20 MB"  },
];

// ── Cookie Panel ─────────────────────────────────────────────────────────────
function CookiePanel({ onSaved, onDismiss }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch(`${API_BASE}/cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: text }),
      });
      const d = await r.json();
      if (d.ok) { setMsg(`✓ Saved ${d.lines} cookie lines`); setTimeout(onSaved, 800); }
      else setMsg("✗ " + (d.error || "Failed"));
    } catch (e) { setMsg("✗ " + e.message); }
    setSaving(false);
  }

  return (
    <div style={{ background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: 18, marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>
        YouTube verification required
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12, lineHeight: 1.6 }}>
        Export a Netscape-format <code style={{ color: "#a78bfa" }}>cookies.txt</code> from a logged-in YouTube session, paste it here, and analyze again.
        <br />
        <span style={{ color: "#6b7280" }}>
          Install the <strong style={{ color: "#d1d5db" }}>"Get cookies.txt LOCALLY"</strong> Chrome extension → open youtube.com → click the extension → Export.
        </span>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\tSID\t..."}
        style={{
          width: "100%", height: 120, background: "#0a0a0a", border: "1px solid #374151",
          borderRadius: 6, padding: "10px 12px", fontSize: 11, color: "#9ca3af",
          fontFamily: "monospace", resize: "vertical",
        }}
      />
      {msg && <div style={{ fontSize: 12, color: msg.startsWith("✓") ? "#34d399" : "#f87171", marginTop: 6 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={handleSave} disabled={saving} style={{
          background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
          padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
        }}>
          {saving ? "Saving…" : "Save cookies and retry"}
        </button>
        <button onClick={onDismiss} style={{
          background: "none", color: "#6b7280", border: "1px solid #374151",
          borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: "pointer",
        }}>Dismiss</button>
      </div>
    </div>
  );
}

function BadgePill({ label }) {
  const colors = { "2160p": "#f59e0b", HD: "#3b82f6", SD: "#6b7280", HQ: "#10b981", MAX: "#8b5cf6" };
  const c = colors[label];
  if (!label || !c) return null;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
      padding: "2px 5px", borderRadius: 3,
      background: c + "22", color: c, border: `1px solid ${c}44`,
    }}>{label}</span>
  );
}

function FormatCard({ fmt, selected, onClick }) {
  return (
    <div onClick={() => onClick(fmt.id)} style={{
      cursor: "pointer", padding: "10px 12px", borderRadius: 8,
      border: `1.5px solid ${selected ? "#3b82f6" : "#1f2937"}`,
      background: selected ? "#1e3a5f" : "#111827",
      display: "flex", flexDirection: "column", gap: 4, transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: selected ? "#93c5fd" : "#e5e7eb" }}>{fmt.label}</span>
        <BadgePill label={fmt.badge} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontSize: 10, color: fmt.type === "audio" ? "#34d399" : "#a78bfa",
          background: fmt.type === "audio" ? "#052e16" : "#1e1b4b",
          padding: "1px 5px", borderRadius: 3, fontWeight: 600,
        }}>{fmt.type === "audio" ? "AUDIO" : "VIDEO"}</span>
        <span style={{ fontSize: 10, color: "#6b7280" }}>{fmt.size}</span>
      </div>
    </div>
  );
}

// Poll a job until done/error, then call onDone
function useJobPoller(jobId, onUpdate, onDone) {
  const timer = useRef(null);
  useEffect(() => {
    if (!jobId) return;
    timer.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/job/${jobId}`);
        const data = await r.json();
        onUpdate(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(timer.current);
          onDone(data);
        }
      } catch {}
    }, 700);
    return () => clearInterval(timer.current);
  }, [jobId]);
}

function VideoCard({ video, checked, onToggle, formatId, fmtLabel }) {
  const [jobId, setJobId] = useState(null);
  const [jobData, setJobData] = useState(null);
  const [starting, setStarting] = useState(false);

  useJobPoller(jobId, setJobData, (d) => {
    if (d.status === "done" && d.downloadUrl) {
      // Auto-trigger browser download
      const a = document.createElement("a");
      a.href = `http://localhost:5000${d.downloadUrl}`;
      a.download = d.filename || "download";
      a.click();
    }
  });

  async function handleDownload() {
    setStarting(true);
    try {
      const r = await fetch(`${API_BASE}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: video.url, formatId }),
      });
      const data = await r.json();
      if (r.status === 507 || data.code === "DISK_FULL") {
        alert("⚠️ Server disk is full — old files are being cleaned up automatically. Please wait 1–2 minutes and try again.");
        setStarting(false);
        return;
      }
      if (data.jobId) setJobId(data.jobId);
    } catch (e) {
      alert("Download failed: " + e.message);
    }
    setStarting(false);
  }

  const progress = jobData?.progress || 0;
  const status = jobData?.status;
  const isDownloading = status === "downloading" || status === "pending";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <div style={{
      background: "#111827", borderRadius: 10,
      border: `1px solid ${checked ? "#1d4ed8" : "#1f2937"}`,
      overflow: "hidden", transition: "border 0.2s",
    }}>
      <div style={{ display: "flex", gap: 12, padding: 12 }}>
        {onToggle && (
          <input type="checkbox" checked={checked} onChange={onToggle}
            style={{ marginTop: 4, accentColor: "#3b82f6", width: 16, height: 16, flexShrink: 0 }} />
        )}
        <img src={video.thumb} alt={video.title}
          style={{ width: 100, height: 60, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f9fafb", lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {video.title}
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{video.channel}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#4b5563" }}>{video.duration}</span>
            {video.views && <span style={{ fontSize: 10, color: "#4b5563" }}>{video.views}</span>}
          </div>
        </div>
        {!jobId && !starting && (
          <button onClick={handleDownload} style={{
            alignSelf: "center", background: "#1d4ed8", color: "#fff",
            border: "none", borderRadius: 6, padding: "6px 12px",
            fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0,
          }}>↓ Download</button>
        )}
        {starting && <span style={{ alignSelf: "center", fontSize: 11, color: "#6b7280", flexShrink: 0 }}>Starting…</span>}
        {isDone && (
          <span style={{ alignSelf: "center", color: "#34d399", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✓ Saved</span>
        )}
        {isError && (
          <span style={{ alignSelf: "center", color: "#f87171", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✗ Error</span>
        )}
      </div>
      {isDownloading && (
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ height: 4, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              {fmtLabel} — {Math.floor(progress)}%
            </span>
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              {jobData?.speed && `${jobData.speed}`}{jobData?.eta && ` · ETA ${jobData.eta}`}
            </span>
          </div>
        </div>
      )}
      {isError && jobData?.error && (
        <div style={{ padding: "0 12px 10px", fontSize: 11, color: "#f87171" }}>{jobData.error}</div>
      )}
    </div>
  );
}

// Playlist batch downloader — tracks multiple jobs
function PlaylistDownloader({ videos, checkedIds, formatId, fmtLabel, trigger }) {
  const [jobMap, setJobMap] = useState({}); // videoId → jobId
  const [jobDataMap, setJobDataMap] = useState({}); // jobId → jobData
  const pollTimers = useRef({});
  const started = useRef(false);

  const pollJob = useCallback((jobId) => {
    if (pollTimers.current[jobId]) return;
    pollTimers.current[jobId] = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/job/${jobId}`);
        const data = await r.json();
        setJobDataMap(prev => ({ ...prev, [jobId]: data }));
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollTimers.current[jobId]);
          if (data.status === "done" && data.downloadUrl) {
            const a = document.createElement("a");
            a.href = `http://localhost:5000${data.downloadUrl}`;
            a.download = data.filename || "download";
            a.click();
          }
        }
      } catch {}
    }, 700);
  }, []);

  useEffect(() => {
    if (!trigger || started.current) return;
    started.current = true;
    const selectedVideos = videos.filter(v => checkedIds.includes(v.id));
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/download-playlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: selectedVideos.map(v => v.url), formatId }),
        });
        const data = await r.json();
        if (data.jobIds) {
          const newMap = {};
          selectedVideos.forEach((v, i) => { newMap[v.id] = data.jobIds[i]; });
          setJobMap(newMap);
          data.jobIds.forEach(jid => pollJob(jid));
        }
      } catch (e) { console.error(e); }
    })();
    return () => Object.values(pollTimers.current).forEach(clearInterval);
  }, [trigger]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
      {videos.map(video => {
        const jid = jobMap[video.id];
        const jdata = jid ? jobDataMap[jid] : null;
        const progress = jdata?.progress || 0;
        const status = jdata?.status || (trigger && checkedIds.includes(video.id) ? "pending" : null);

        return (
          <div key={video.id} style={{
            background: "#111827", borderRadius: 10,
            border: `1px solid ${checkedIds.includes(video.id) ? "#1d4ed8" : "#1f2937"}`,
            overflow: "hidden",
          }}>
            <div style={{ display: "flex", gap: 12, padding: 12 }}>
              <img src={video.thumb} alt={video.title}
                style={{ width: 100, height: 60, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f9fafb", lineHeight: 1.3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {video.title}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{video.channel}</div>
                <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4 }}>{video.duration}</div>
              </div>
              {status === "done" && <span style={{ alignSelf: "center", color: "#34d399", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✓ Saved</span>}
              {status === "error" && <span style={{ alignSelf: "center", color: "#f87171", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✗ Error</span>}
              {(status === "pending" || status === "downloading") && (
                <span style={{ alignSelf: "center", fontSize: 10, color: "#6b7280", flexShrink: 0 }}>
                  {Math.floor(progress)}%
                </span>
              )}
              {!trigger && !checkedIds.includes(video.id) && (
                <span style={{ alignSelf: "center", fontSize: 10, color: "#4b5563", flexShrink: 0 }}>Skipped</span>
              )}
            </div>
            {(status === "pending" || status === "downloading") && (
              <div style={{ padding: "0 12px 10px" }}>
                <div style={{ height: 3, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", transition: "width 0.3s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>{fmtLabel}</span>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>
                    {jdata?.speed}{jdata?.eta && ` · ETA ${jdata.eta}`}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("mp4-1080");
  const [activeTab, setActiveTab] = useState("video");
  const [checkedVideos, setCheckedVideos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [singleVideo, setSingleVideo] = useState(null);
  const [error, setError] = useState("");
  const [downloadTrigger, setDownloadTrigger] = useState(0);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [showCookiePanel, setShowCookiePanel] = useState(false);

  const fmt = FORMATS.find(f => f.id === selectedFormat);

  async function handleAnalyze() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const ytPattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    if (!ytPattern.test(trimmed)) { setError("Please enter a valid YouTube URL."); return; }
    setError(""); setLoading(true); setMode(null); setSingleVideo(null); setVideos([]);
    setDownloadStarted(false); setShowCookiePanel(false);

    try {
      const r = await fetch(`${API_BASE}/info?url=${encodeURIComponent(trimmed)}`);
      const data = await r.json();
      if (data.code === "YOUTUBE_BLOCKED") {
        setError("YouTube blocked this request. Paste a valid YouTube cookies.txt export below, then retry.");
        setShowCookiePanel(true);
        setLoading(false);
        return;
      }
      if (data.error) throw new Error(data.error);
      if (data.isPlaylist) {
        setVideos(data.videos);
        setCheckedVideos(data.videos.map(v => v.id));
        setMode("playlist");
      } else {
        setSingleVideo(data.videos[0]);
        setMode("single");
      }
    } catch (e) {
      setError("Failed to fetch video info: " + e.message);
    }
    setLoading(false);
  }

  const videoFormats = FORMATS.filter(f => f.type === "video");
  const audioFormats = FORMATS.filter(f => f.type === "audio");

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1a",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#f9fafb", padding: "24px 16px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        input[type=text]:focus { outline: none; border-color: #3b82f6 !important; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 4px; }
        .tab-btn { border: none; background: transparent; cursor: pointer; padding: 8px 18px; border-radius: 6px; font-weight: 600; font-size: 13px; transition: all 0.15s; }
        .tab-btn.active { background: #1d4ed8; color: #fff; }
        .tab-btn:not(.active) { color: #6b7280; }
        .tab-btn:not(.active):hover { color: #d1d5db; }
        .analyze-btn { border: none; cursor: pointer; border-radius: 8px; padding: 12px 24px; font-weight: 700; font-size: 14px; transition: all 0.15s; }
        .analyze-btn:hover:not(:disabled) { opacity: 0.88; transform: translateY(-1px); }
        @keyframes shimmer { 0% { transform: translateX(-200%); } 100% { transform: translateX(400%); } }
        @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(300%)} }
      `}</style>

      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, background: "#dc2626", borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>▶</div>
            <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>
              YT<span style={{ color: "#3b82f6" }}>Grab</span>
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
              background: "#1e3a5f", color: "#60a5fa", border: "1px solid #1d4ed8",
              borderRadius: 4, padding: "3px 7px",
            }}>AI POWERED</span>
          </div>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
            Download any YouTube video or playlist — 4K, HD, MP3, FLAC & more. Powered by yt-dlp.
          </p>
        </div>

        {/* URL Input */}
        <div style={{ background: "#111827", borderRadius: 12, padding: 20, border: "1px solid #1f2937", marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", display: "block", marginBottom: 10 }}>
            PASTE YOUTUBE URL
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <input type="text" value={url}
              onChange={e => { setUrl(e.target.value); setError(""); setMode(null); }}
              placeholder="https://youtube.com/watch?v=... or playlist URL"
              style={{
                flex: 1, background: "#0a0f1a", border: "1px solid #1f2937",
                borderRadius: 8, padding: "11px 14px", fontSize: 13, color: "#f9fafb", fontFamily: "inherit",
              }}
              onKeyDown={e => e.key === "Enter" && handleAnalyze()} />
            <button onClick={handleAnalyze} disabled={loading} className="analyze-btn"
              style={{ background: loading ? "#1f2937" : "linear-gradient(135deg,#1d4ed8,#7c3aed)", color: loading ? "#6b7280" : "#fff" }}>
              {loading ? "Analyzing…" : "Analyze →"}
            </button>
          </div>
          {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 8 }}>{error}</div>}
          {showCookiePanel && (
            <CookiePanel
              onSaved={() => { setShowCookiePanel(false); setError(""); handleAnalyze(); }}
              onDismiss={() => setShowCookiePanel(false)}
            />
          )}
          {loading && (
            <div style={{ marginTop: 14 }}>
              <div style={{ height: 3, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: "50%", background: "linear-gradient(90deg,#3b82f6,#8b5cf6)", animation: "slide 1.2s infinite ease-in-out", borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>Fetching video metadata via yt-dlp…</div>
            </div>
          )}
        </div>

        {mode && (
          <>
            {/* Format Picker */}
            <div style={{ background: "#111827", borderRadius: 12, padding: 20, border: "1px solid #1f2937", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em" }}>SELECT FORMAT</span>
                <div style={{ display: "flex", background: "#0a0f1a", borderRadius: 7, padding: 3, border: "1px solid #1f2937" }}>
                  <button className={`tab-btn ${activeTab === "video" ? "active" : ""}`}
                    onClick={() => { setActiveTab("video"); setSelectedFormat("mp4-1080"); }}>Video</button>
                  <button className={`tab-btn ${activeTab === "audio" ? "active" : ""}`}
                    onClick={() => { setActiveTab("audio"); setSelectedFormat("mp3-320"); }}>Audio Only</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px,1fr))", gap: 8 }}>
                {(activeTab === "video" ? videoFormats : audioFormats).map(f => (
                  <FormatCard key={f.id} fmt={f} selected={selectedFormat === f.id} onClick={setSelectedFormat} />
                ))}
              </div>
              <div style={{ marginTop: 14, padding: "8px 12px", background: "#0a0f1a", borderRadius: 7, border: "1px solid #1f2937",
                display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#6b7280" }}>Selected:</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#93c5fd" }}>{fmt?.label}</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>·</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>{fmt?.size}</span>
              </div>
            </div>

            {/* Single Video */}
            {mode === "single" && singleVideo && (
              <div style={{ background: "#111827", borderRadius: 12, padding: 20, border: "1px solid #1f2937" }}>
                <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 14 }}>
                  VIDEO DETECTED
                </div>
                <VideoCard video={singleVideo} formatId={selectedFormat} fmtLabel={fmt?.label} />
              </div>
            )}

            {/* Playlist */}
            {mode === "playlist" && videos.length > 0 && (
              <div style={{ background: "#111827", borderRadius: 12, padding: 20, border: "1px solid #1f2937" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.08em" }}>
                      PLAYLIST · {videos.length} VIDEOS
                    </span>
                    <span style={{ marginLeft: 10, fontSize: 10, color: "#34d399", background: "#052e16", padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
                      {checkedVideos.length} selected
                    </span>
                  </div>
                  {!downloadStarted && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setCheckedVideos(videos.map(v => v.id))}
                        style={{ fontSize: 11, color: "#93c5fd", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        Select all
                      </button>
                      <span style={{ color: "#374151" }}>|</span>
                      <button onClick={() => setCheckedVideos([])}
                        style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        None
                      </button>
                    </div>
                  )}
                </div>

                {!downloadStarted ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                      {videos.map(video => (
                        <div key={video.id} style={{
                          background: "#0a0f1a", borderRadius: 10,
                          border: `1px solid ${checkedVideos.includes(video.id) ? "#1d4ed8" : "#1f2937"}`,
                        }}>
                          <div style={{ display: "flex", gap: 12, padding: 12 }}>
                            <input type="checkbox" checked={checkedVideos.includes(video.id)}
                              onChange={() => setCheckedVideos(prev =>
                                prev.includes(video.id) ? prev.filter(id => id !== video.id) : [...prev, video.id]
                              )}
                              style={{ marginTop: 4, accentColor: "#3b82f6", width: 16, height: 16, flexShrink: 0 }} />
                            <img src={video.thumb} alt={video.title}
                              style={{ width: 100, height: 60, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#f9fafb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {video.title}
                              </div>
                              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{video.channel}</div>
                              <div style={{ fontSize: 10, color: "#4b5563", marginTop: 4 }}>{video.duration}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setDownloadStarted(true); setDownloadTrigger(t => t + 1); }}
                      disabled={checkedVideos.length === 0}
                      style={{
                        width: "100%", padding: 12, borderRadius: 8, border: "none",
                        cursor: checkedVideos.length === 0 ? "not-allowed" : "pointer",
                        background: checkedVideos.length === 0 ? "#1f2937" : "linear-gradient(135deg,#1d4ed8,#7c3aed)",
                        color: checkedVideos.length === 0 ? "#4b5563" : "#fff",
                        fontSize: 14, fontWeight: 700,
                      }}>
                      ↓ Download {checkedVideos.length} video{checkedVideos.length !== 1 ? "s" : ""} as {fmt?.label}
                    </button>
                  </>
                ) : (
                  <PlaylistDownloader
                    videos={videos}
                    checkedIds={checkedVideos}
                    formatId={selectedFormat}
                    fmtLabel={fmt?.label}
                    trigger={downloadTrigger}
                  />
                )}
              </div>
            )}
          </>
        )}

        {!mode && !loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 8 }}>
            {[
              { icon: "🔗", title: "Paste any URL", desc: "Video, playlist, or Shorts link" },
              { icon: "🎛️", title: "Pick your format", desc: "MP4 4K to MP3 128kbps and more" },
              { icon: "⚡", title: "Instant download", desc: "Fast, powered by yt-dlp engine" },
            ].map(item => (
              <div key={item.title} style={{ background: "#111827", borderRadius: 10, padding: 16, border: "1px solid #1f2937", textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#e5e7eb", marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{item.desc}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "#374151" }}>
          For personal use only · Respect copyright and YouTube's Terms of Service
        </div>
      </div>
    </div>
  );
}
