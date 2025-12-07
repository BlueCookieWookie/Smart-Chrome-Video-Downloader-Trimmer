// popup.js

const $ = (id) => document.getElementById(id);

let videos = [];
let selectedVideo = null;
let currentTab = { url: null, title: null };

// Track which button owns which native job
const buttonState = {
  full: { jobId: null, busy: false },
  trimmed: { jobId: null, busy: false }
};

function formatTime(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, "_");
}

function getThumbnailForUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  } catch (e) {}
  return null;
}

// --- Button UI state helpers ---

function getButtonElements(which) {
  if (which === "full") {
    return {
      btn: $("download-full"),
      spinner: $("full-spinner"),
      text: $("btn-full-text")
    };
  }
  return {
    btn: $("download-trimmed"),
    spinner: $("trim-spinner"),
    text: $("btn-trim-text")
  };
}

function getStreamType() {
  const typeSel = $("stream-type");
  return typeSel ? typeSel.value || "av" : "av";
}

function updateButtonLabelsForStreamType() {
  const fullText = $("btn-full-text");
  const trimText = $("btn-trim-text");
  if (!fullText || !trimText) return;

  const st = getStreamType();

  const fullState = buttonState.full;
  const trimState = buttonState.trimmed;
  const canUpdateFull = !fullState.busy;
  const canUpdateTrim = !trimState.busy;

  if (st === "a") {
    if (canUpdateFull) fullText.textContent = "Download Audio";
    if (canUpdateTrim) trimText.textContent = "Download Trimmed Audio";
  } else {
    if (canUpdateFull) fullText.textContent = "Download Full Video";
    if (canUpdateTrim) trimText.textContent = "Download Trimmed Clip";
  }
}

function resetButton(which) {
  const { btn, spinner, text } = getButtonElements(which);
  spinner.classList.add("hidden");
  btn.classList.remove("btn-busy", "btn-success", "btn-error");

  if (which === "trimmed") {
    btn.disabled = true;
  } else {
    btn.disabled = false;
  }

  const st = getStreamType();
  if (which === "full") {
    text.textContent = st === "a" ? "Download Audio" : "Download Full Video";
  } else {
    text.textContent =
      st === "a" ? "Download Trimmed Audio" : "Download Trimmed Clip";
  }
  buttonState[which].busy = false;
  buttonState[which].jobId = null;
}

function setButtonProgress(which, percent) {
  const { btn, spinner, text } = getButtonElements(which);
  btn.classList.add("btn-busy");
  spinner.classList.remove("hidden");
  btn.classList.remove("btn-success", "btn-error");
  btn.disabled = true;

  const safePercent =
    typeof percent === "number" && isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent)))
      : 0;

  text.textContent = `Downloading… ${safePercent}%`;
  buttonState[which].busy = true;
}

function shortenPath(path) {
  if (!path) return "Downloads";
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.length >= 2) {
    const folder = parts[parts.length - 2] || "";
    if (folder.toLowerCase() === "downloads") return "Downloads";
    return folder || "Downloads";
  }
  return "Downloads";
}

function setButtonDone(which, filename) {
  const { btn, spinner, text } = getButtonElements(which);
  spinner.classList.add("hidden");
  btn.classList.remove("btn-busy", "btn-error");
  btn.classList.add("btn-success");
  btn.disabled = false;

  const folderLabel = shortenPath(filename || "");
  text.textContent = `Saved to ${folderLabel} ✓`;

  buttonState[which].busy = false;
  buttonState[which].jobId = null;
}

function setButtonError(which, errorMessage) {
  const { btn, spinner, text } = getButtonElements(which);
  spinner.classList.add("hidden");
  btn.classList.remove("btn-busy", "btn-success");
  btn.classList.add("btn-error");
  btn.disabled = false;

  text.textContent = "Error – click to retry";
  console.error("Download error:", errorMessage);

  buttonState[which].busy = false;
  buttonState[which].jobId = null;
}

// --- Native messaging helper for request/response style calls ---

function sendNativeRequest(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response) return reject(new Error("No response from background"));
      if (!response.ok) {
        return reject(new Error(response.error || "Native helper error"));
      }
      resolve(response);
    });
  });
}

// --- Video list rendering ---

function renderVideoList() {
  const listEl = $("video-list");
  const countEl = $("video-count");
  listEl.innerHTML = "";

  if (!videos || videos.length === 0) {
    countEl.textContent = "No videos detected.";
    return;
  }

  countEl.textContent = `${videos.length} video${videos.length > 1 ? "s" : ""}`;

  videos.forEach((video, idx) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "video-item";
    item.dataset.index = idx;

    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "thumb-wrapper";

    const img = document.createElement("img");
    img.className = "thumb";
    img.src =
      video.thumbnail ||
      getThumbnailForUrl(video.pageUrl || currentTab.url) ||
      "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA2NCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNDAiIHJ4PSI4IiBmaWxsPSIjMTMyMDM0Ii8+PHBhdGggZD0iTTI3IDMyLjI1NFY3Ljc0NTk5QzI3IDcuNDc5NzggMjcuMjk5NSA3LjI3MjE0IDI3LjU1MDkgNy40MDIzM0w0Ny4yNTIgMTcuNjUzMUM0Ny41NDU0IDE3LjgwMzYgNDcuNTQ1NCAxOC4xOTY0IDQ3LjI1MiAxOC4zNDY5TDI3LjU1MDkgMjguNTk0NkMyNy4yOTk1IDI4LjcyNDggMjcgMjguNTE3MiAyNyAyOC4yNTEgVjMyLjI1NFoiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC44Ii8+PC9zdmc+";
    thumbWrapper.appendChild(img);

    if (video.duration && isFinite(video.duration)) {
      const badge = document.createElement("div");
      badge.className = "thumb-badge";
      badge.innerHTML = `<span>${formatTime(video.duration)}</span>`;
      thumbWrapper.appendChild(badge);
    } else if (video.isPageUrl) {
      const badge = document.createElement("div");
      badge.className = "thumb-badge";
      badge.innerHTML = `<span>Page URL</span>`;
      thumbWrapper.appendChild(badge);
    }

    const meta = document.createElement("div");
    meta.className = "video-meta";

    const titleEl = document.createElement("div");
    titleEl.className = "video-title";
    titleEl.textContent =
      video.title ||
      (video.isPageUrl ? "Use page URL (native helper)" : "Untitled video");

    const sub = document.createElement("div");
    sub.className = "video-sub";

    try {
      const originSource = video.src || video.pageUrl;
      const origin = new URL(originSource || currentTab.url || "https://example.com");
      const originHost = origin.hostname.replace(/^www\./, "");
      const durationLabel =
        video.duration && isFinite(video.duration)
          ? formatTime(video.duration)
          : video.isPageUrl
          ? "Native helper will resolve formats"
          : "Unknown length";
      sub.textContent = `${originHost} · ${durationLabel}`;
    } catch {
      sub.textContent = formatTime(
        video.duration && isFinite(video.duration) ? video.duration : 0
      );
    }

    meta.appendChild(titleEl);
    meta.appendChild(sub);

    item.appendChild(thumbWrapper);
    item.appendChild(meta);

    item.addEventListener("click", () => {
      document
        .querySelectorAll(".video-item.selected")
        .forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");
      onVideoSelected(video);
    });

    listEl.appendChild(item);
  });
}

// --- Slider helpers ---

function updateSliderLabels() {
  if (!selectedVideo) return;

  const startRange = $("start-range");
  const endRange = $("end-range");
  const startLabel = $("start-time-label");
  const endLabel = $("end-time-label");
  const help = $("duration-help");

  const total =
    selectedVideo._knownDuration && isFinite(selectedVideo._knownDuration)
      ? selectedVideo._knownDuration
      : 0;

  let start = parseFloat(startRange.value);
  let end = parseFloat(endRange.value);

  if (!isFinite(start) || start < 0) start = 0;
  if (!isFinite(end) || end < 0) end = 0;
  if (start > end) {
    end = start;
    endRange.value = String(end);
  }

  startLabel.textContent = formatTime(start);
  endLabel.textContent = formatTime(end);

  const length = Math.max(0, end - start);

  if (total > 0) {
    help.textContent = `Clip: ${formatTime(start)} → ${formatTime(
      end
    )} (${formatTime(length)}) of ${formatTime(total)} total.`;
  } else {
    help.textContent = `Clip: ${formatTime(start)} → ${formatTime(
      end
    )} (${formatTime(length)})`;
  }
}

function initSlidersForVideo(video) {
  const knownDuration =
    video.duration && isFinite(video.duration) && video.duration > 0
      ? video.duration
      : 7200; // fallback 2h

  selectedVideo._knownDuration = knownDuration;

  const startRange = $("start-range");
  const endRange = $("end-range");

  startRange.min = "0";
  startRange.max = String(knownDuration.toFixed(1));
  endRange.min = "0";
  endRange.max = String(knownDuration.toFixed(1));

  startRange.value = "0";
  endRange.value = String(knownDuration.toFixed(1));

  updateSliderLabels();
}

// --- Format selector (container) options based on stream type ---

function updateFormatOptionsForStreamType() {
  const formatSel = $("format-select");
  if (!formatSel) return;

  const st = getStreamType();
  formatSel.innerHTML = "";

  const add = (value, label) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    formatSel.appendChild(opt);
  };

  if (st === "a") {
    add("m4a", "M4A (AAC)");
    add("mp3", "MP3 (re-encode)");
    add("webm", "WebM / Opus");
    add("auto", "Auto (best audio)");
  } else {
    add("mp4", "MP4");
    add("webm", "WebM");
    add("auto", "Auto");
  }
}

// --- Dynamic quality selector based on yt-dlp formats & stream type ---

function addQualityOption(sel, value, label, disabled = false) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  opt.disabled = disabled;
  sel.appendChild(opt);
}

function buildQualitySelect(video) {
  const sel = $("quality-select");
  if (!sel) return;

  const streamType = getStreamType();
  sel.innerHTML = "";

  let formats = Array.isArray(video._formats) ? video._formats : [];
  formats = formats.filter((f) => f && f.format_id);

  // No real formats yet → show generic presets
  if (!formats.length) {
    if (streamType === "a") {
      addQualityOption(sel, "audio", "Best available (audio)");
    } else {
      addQualityOption(sel, "best", "Best available");
      addQualityOption(sel, "1080p", "Up to 1080p");
      addQualityOption(sel, "720p", "Up to 720p");
      addQualityOption(sel, "480p", "Up to 480p");
      if (streamType === "av") {
        addQualityOption(sel, "audio", "Audio only");
      }
    }
    return;
  }

  // We DO have formats → show real ones only (plus Best available)
  if (streamType === "a") {
    addQualityOption(sel, "audio", "Best available (audio)");
  } else {
    addQualityOption(sel, "best", "Best available");
  }

  let list = [];

  if (streamType === "a") {
    const audioExts = ["m4a", "mp3", "webm", "opus", "ogg", "flac", "wav"];
    list = formats.filter((f) => {
      const v = (f.vcodec || "").toLowerCase();
      const a = f.acodec;
      const ext = (f.ext || "").toLowerCase();
      const hasAudio = a && a.toLowerCase() !== "none";
      const noVideo = !v || v === "none";
      const audioishExt = audioExts.includes(ext);
      return hasAudio && (noVideo || audioishExt);
    });
    list.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
  } else if (streamType === "v") {
    // Prefer *pure* video-only formats (acodec == none). If none exist, fall back to all video formats.
    const videoOnly = formats.filter((f) => {
      const v = f.vcodec;
      const a = f.acodec;
      const hasVideo = v && v !== "none";
      const noAudio = !a || a === "none";
      return hasVideo && noAudio;
    });

    if (videoOnly.length) {
      list = videoOnly;
    } else {
      list = formats.filter((f) => {
        const v = f.vcodec;
        return v && v !== "none";
      });
    }

    list.sort((a, b) => (b.height || 0) - (a.height || 0));
  } else {
    // av (video+audio)
    const avFormats = formats.filter((f) => {
      const v = f.vcodec;
      const a = f.acodec;
      return v && v !== "none" && a && a !== "none";
    });
    if (avFormats.length) {
      list = avFormats;
    } else {
      list = formats.filter((f) => {
        const v = f.vcodec;
        return v && v !== "none";
      });
    }
    list.sort((a, b) => (b.height || 0) - (a.height || 0));
  }

  if (!list.length) {
    addQualityOption(
      sel,
      "",
      "No formats of this type; try a different type",
      true
    );
    return;
  }

  list.forEach((f) => {
    const height = f.height;
    const width = f.width;
    const ext = f.ext || "";
    const tbr = f.tbr || 0;
    const note = f.format_note || "";
    const fps = f.fps || null;
    const vcodec = f.vcodec;
    const acodec = f.acodec;

    const parts = [];

    if (streamType === "a") {
      if (tbr) {
        parts.push(`${Math.round(tbr)}kbps`);
      }
      if (ext) {
        parts.push(ext);
      }
      if (note) {
        parts.push(note);
      }
    } else {
      if (width && height) {
        parts.push(`${width}x${height}`);
      } else if (height) {
        parts.push(`${height}p`);
      }
      if (fps) {
        parts.push(`${fps}fps`);
      }
      if (ext) {
        parts.push(ext);
      }
      if (tbr) {
        parts.push(`${Math.round(tbr)}kbps`);
      }

      if (streamType === "v") {
        parts.push("video only");
      } else if (vcodec && vcodec !== "none" && acodec && acodec !== "none") {
        parts.push("video + audio");
      } else {
        parts.push("muxed with best audio");
      }

      if (note) {
        parts.push(note);
      }
    }

    const label = parts.length ? parts.join(" · ") : f.format_id;
    const opt = document.createElement("option");
    opt.value = `format:${f.format_id}`;
    opt.textContent = label;
    sel.appendChild(opt);
  });

  console.log("yt-dlp formats for selected video:", formats);
}

// --- Probe duration & formats for selected video (always) ---

async function probeInfoForVideo(video) {
  if (!video) return;
  const url = video.pageUrl || currentTab.url;
  if (!url) return;

  try {
    const res = await sendNativeRequest({
      type: "PROBE_INFO",
      pageUrl: url
    });

    let changed = false;

    if (res.duration && isFinite(res.duration)) {
      video.duration = res.duration;
      changed = true;
    }

    if (res.title && !video.title) {
      video.title = res.title;
      $("selected-title").textContent = res.title;
    }

    if (res.thumbnail && !video.thumbnail) {
      video.thumbnail = res.thumbnail;
      const thumbEl = $("preview-thumb");
      if (thumbEl && !thumbEl.src) {
        thumbEl.src = res.thumbnail;
      }
    }

    if (Array.isArray(res.formats) && res.formats.length) {
      video._formats = res.formats;
    }

    buildQualitySelect(video);

    if (changed) {
      initSlidersForVideo(video);
    }
  } catch (err) {
    console.error("Probe error:", err);
  }
}

// Decide if we can actually play the src in the popup origin
function shouldUseThumbPreview(video) {
  if (!video) return true;
  if (video.isPageUrl) return true;
  if (!video.src) return true;

  try {
    const u = new URL(video.src, currentTab.url || undefined);
    if (u.protocol === "blob:") return true;
    const host = (u.hostname || "").replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      return true;
    }
  } catch (e) {
    return true;
  }

  return false;
}

// --- Selection ---

function onVideoSelected(video) {
  selectedVideo = video;
  const trimSection = $("trim-section");
  trimSection.classList.remove("hidden");

  $("selected-title").textContent =
    video.title ||
    (video.isPageUrl ? "Using page URL (native helper)" : "Selected video");

  const previewVideo = $("preview-video");
  const previewThumb = $("preview-thumb");

  const useThumb = shouldUseThumbPreview(video);

  if (useThumb) {
    previewVideo.classList.add("hidden");
    previewVideo.removeAttribute("src");
    previewVideo.load();

    previewThumb.classList.remove("hidden");
    previewThumb.src =
      video.thumbnail ||
      getThumbnailForUrl(video.pageUrl || currentTab.url) ||
      "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxODAiIHJ4PSIxNCIgZmlsbD0iIzEzMjAzNCIvPjxwYXRoIGQ9Ik0xMzYgMTM5LjZWNDAuMzM4NEMxMzYgMzkuMDQ1MSAxMzcuMzYgMzguMjkzIDEzOC41NjQgMzguOTM3MkwyMTcuMzQ4IDgyLjM4MzlDMjE4LjQ1MyA4Mi45NzI2IDIxOC40NTMgODQuNTkxMiAyMTcuMzQ4IDg1LjE4MDdMMTM4LjU2NCAxMjguNjI3QzEzNy4zNiAxMjkuMjcxIDEzNiAxMjguNTE5IDEzNiAxMjcuMjI2VjEzOS42WiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIwLjgiLz48L3N2Zz4=";
  } else {
    previewThumb.classList.add("hidden");
    previewThumb.removeAttribute("src");

    previewVideo.classList.remove("hidden");
    previewVideo.src = video.src;
    previewVideo.currentTime = 0;
    previewVideo.load();
  }

  const sliderWrapper = $("slider-wrapper");
  const enableTrim = $("enable-trim");
  if (enableTrim) enableTrim.checked = false;
  if (sliderWrapper) sliderWrapper.classList.add("hidden");

  const trimBtn = $("download-trimmed");
  if (trimBtn) trimBtn.disabled = true;

  initSlidersForVideo(video);

  buildQualitySelect(video);
  updateFormatOptionsForStreamType();
  updateButtonLabelsForStreamType();
  probeInfoForVideo(video);

  resetButton("full");
  resetButton("trimmed");
}

// --- Download handlers ---

function startDownload(which) {
  if (!selectedVideo) return;
  if (buttonState[which].busy) return;

  const isTrimmed = which === "trimmed";
  const enableTrim = $("enable-trim");
  const trimmingEnabled = enableTrim ? enableTrim.checked : false;

  const startRange = $("start-range");
  const endRange = $("end-range");

  const maxDuration =
    selectedVideo && selectedVideo._knownDuration
      ? selectedVideo._knownDuration
      : 7200;

  let start = 0;
  let end = maxDuration;

  if (isTrimmed) {
    if (!trimmingEnabled) {
      return;
    }
    start = parseFloat(startRange.value) || 0;
    end = parseFloat(endRange.value) || maxDuration;
  }

  if (isTrimmed && end <= start) {
    setButtonError(which, "End must be greater than start.");
    return;
  }

  const streamType = getStreamType();

  const qualitySelect = $("quality-select");
  const rawQuality = qualitySelect ? qualitySelect.value || "best" : "best";

  let quality = rawQuality;
  let formatId = null;

  if (rawQuality && rawQuality.startsWith("format:")) {
    formatId = rawQuality.slice(7);
    if (streamType === "a") {
      quality = "audio";
    } else {
      quality = "best";
    }
  } else if (rawQuality === "audio") {
    quality = "audio";
  }

  const formatSelect = $("format-select");
  const container = formatSelect ? formatSelect.value || "mp4" : "mp4";

  const payload = {
    type: isTrimmed ? "DOWNLOAD_TRIMMED" : "DOWNLOAD_FULL",
    title:
      sanitizeFilename(
        selectedVideo.title ||
          currentTab.title ||
          (isTrimmed ? "clip" : "video")
      ) || (isTrimmed ? "clip" : "video"),
    videoUrl: selectedVideo.src || null,
    pageUrl: selectedVideo.pageUrl || currentTab.url || null,
    quality,
    formatId,
    container,
    streamType,
    start: isTrimmed ? start : null,
    end: isTrimmed ? end : null
  };

  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      const err =
        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
        (response && response.error) ||
        "Failed to start download.";
      setButtonError(which, err);
      return;
    }
    const jobId = response.jobId;
    buttonState[which].jobId = jobId;
    setButtonProgress(which, 0);
  });
}

function handleDownloadFull() {
  startDownload("full");
}

function handleDownloadTrimmed() {
  startDownload("trimmed");
}

// --- Save location change ---

async function handleChangeSaveLocation() {
  try {
    const res = await sendNativeRequest({ type: "CHOOSE_SAVE_DIR" });
    if (res.dir) {
      const label = $("save-location-label");
      label.textContent = `Save location: ${res.dir}`;
    }
  } catch (err) {
    console.error("Change save dir error:", err);
  }
}

// --- Content script communication ---

function requestVideosForActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return;

    currentTab = {
      url: tab.url || null,
      title: tab.title || null
    };

    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_VIDEOS" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(chrome.runtime.lastError);
          return;
        }
        if (!response) return;

        if (response.error) {
          console.error("Content script error:", response.error);
          return;
        }

        videos = response.videos || [];

        if (!videos.length && currentTab.url) {
          videos.push({
            title: currentTab.title || "This page (native helper)",
            src: null,
            pageUrl: currentTab.url,
            duration: null,
            thumbnail: getThumbnailForUrl(currentTab.url),
            isPageUrl: true
          });
        }

        renderVideoList();
      }
    );
  });
}

// --- Handle progress events from native host ---

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.fromNative || !msg.jobId) return;

  const jobId = msg.jobId;
  const event = msg.event;

  ["full", "trimmed"].forEach((which) => {
    const state = buttonState[which];
    if (state.jobId !== jobId) return;

    if (event === "start") {
      setButtonProgress(which, 0);
    } else if (event === "progress") {
      setButtonProgress(which, msg.percent || 0);
    } else if (event === "complete") {
      setButtonDone(which, msg.filename);
    } else if (event === "error") {
      setButtonError(which, msg.error || "Unknown error");
    }
  });
});

// --- Pin handling ---

function handlePinClick() {
  const pinBtn = $("pin-toggle");
  if (!pinBtn) return;

  pinBtn.classList.add("pin-active");

  const url = chrome.runtime.getURL("popup.html?pinned=1");
  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 420,
      height: 640
    },
    () => {}
  );
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
  $("download-full").addEventListener("click", handleDownloadFull);
  $("download-trimmed").addEventListener("click", handleDownloadTrimmed);

  const enableTrim = $("enable-trim");
  const sliderWrapper = $("slider-wrapper");
  const trimBtn = $("download-trimmed");

  if (trimBtn) trimBtn.disabled = true;

  if (enableTrim && sliderWrapper) {
    enableTrim.addEventListener("change", () => {
      if (enableTrim.checked) {
        sliderWrapper.classList.remove("hidden");
        if (trimBtn) trimBtn.disabled = false;
        updateSliderLabels();
      } else {
        sliderWrapper.classList.add("hidden");
        if (trimBtn) trimBtn.disabled = true;
      }
    });
  }

  const startRange = $("start-range");
  const endRange = $("end-range");
  startRange.addEventListener("input", updateSliderLabels);
  endRange.addEventListener("input", updateSliderLabels);

  $("change-save").addEventListener("click", handleChangeSaveLocation);

  const typeSel = $("stream-type");
  if (typeSel) {
    typeSel.addEventListener("change", () => {
      if (selectedVideo) {
        buildQualitySelect(selectedVideo);
      }
      updateFormatOptionsForStreamType();
      updateButtonLabelsForStreamType();
    });
  }

  const pinBtn = $("pin-toggle");
  if (pinBtn) {
    pinBtn.addEventListener("click", handlePinClick);
  }

  updateFormatOptionsForStreamType();
  updateButtonLabelsForStreamType();

  requestVideosForActiveTab();
});
