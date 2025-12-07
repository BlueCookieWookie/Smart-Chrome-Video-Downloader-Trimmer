// background.js

const NATIVE_HOST_NAME = "com.ytdlp_bridge";

let nativePort = null;
// For request/response style calls (probe info, choose dir)
const pendingJobs = {}; // jobId -> sendResponse

function makeJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensurePort() {
  if (nativePort) return;

  nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  console.log("Connected to native host", NATIVE_HOST_NAME);

  nativePort.onMessage.addListener((msg) => {
    if (!msg || !msg.jobId) {
      console.warn("Native message without jobId", msg);
      return;
    }

    const jobId = msg.jobId;
    const event = msg.event;

    // If there's a pending sendResponse waiting (probe / choose dir),
    // complete it and don't forward further.
    if (pendingJobs[jobId]) {
      const cb = pendingJobs[jobId];
      delete pendingJobs[jobId];
      cb(msg);
      return;
    }

    // Otherwise, forward to any open popup(s)
    chrome.runtime.sendMessage({ fromNative: true, ...msg });
  });

  nativePort.onDisconnect.addListener(() => {
    console.error("Native host disconnected", chrome.runtime.lastError);
    nativePort = null;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Smart Video Downloader (yt-dlp bridge) installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (
    message.type === "DOWNLOAD_FULL" ||
    message.type === "DOWNLOAD_TRIMMED"
  ) {
    ensurePort();
    const jobId = makeJobId();
    nativePort.postMessage({ ...message, jobId });
    // Immediately tell popup the jobId; progress will come via runtime.onMessage
    sendResponse({ ok: true, jobId });
    return true;
  }

  if (message.type === "PROBE_INFO" || message.type === "CHOOSE_SAVE_DIR") {
    ensurePort();
    const jobId = makeJobId();

    pendingJobs[jobId] = (nativeMsg) => {
      // Normalize into a simple response
      sendResponse({
        ok: !!nativeMsg.ok,
        ...nativeMsg
      });
    };

    nativePort.postMessage({ ...message, jobId });
    return true;
  }
});
