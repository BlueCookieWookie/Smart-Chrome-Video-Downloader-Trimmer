// content.js

function inferVideoTitle(videoEl) {
  const attrs = [videoEl.getAttribute("aria-label"), videoEl.title].filter(Boolean);
  if (attrs.length) return attrs[0];

  const figure = videoEl.closest("figure");
  if (figure) {
    const cap =
      figure.querySelector("figcaption") ||
      figure.querySelector("h1, h2, h3, h4, h5, h6");
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
  }

  const parent = videoEl.parentElement;
  if (parent) {
    const heading = parent.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading && heading.textContent.trim()) return heading.textContent.trim();
  }

  if (document.title) return document.title;

  return "Video";
}

function getVideoSrc(videoEl) {
  if (videoEl.currentSrc) return videoEl.currentSrc;
  if (videoEl.src) return videoEl.src;
  const source = videoEl.querySelector("source[src]");
  if (source) return source.src;
  return null;
}

function waitForLoadedData(videoEl, timeoutMs = 1500) {
  if (videoEl.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const onLoaded = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("loadeddata", onLoaded);
      resolve();
    };
    videoEl.addEventListener("loadeddata", onLoaded, { once: true });
    setTimeout(() => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("loadeddata", onLoaded);
      resolve();
    }, timeoutMs);
  });
}

async function captureThumbnail(videoEl) {
  if (videoEl.poster) {
    return videoEl.poster;
  }

  try {
    await waitForLoadedData(videoEl);
    const width = videoEl.videoWidth || 320;
    const height = videoEl.videoHeight || 180;
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoEl, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch (e) {
    return null;
  }
}

async function collectVideosOnPage() {
  const videoEls = Array.from(document.querySelectorAll("video"));

  const seenSrc = new Set();
  const results = [];

  for (const el of videoEls) {
    const src = getVideoSrc(el);
    if (!src) continue;
    if (seenSrc.has(src)) continue;
    seenSrc.add(src);

    const title = inferVideoTitle(el);
    const duration =
      el.duration && isFinite(el.duration) && el.duration > 0
        ? el.duration
        : null;
    let thumbnail = null;

    try {
      thumbnail = await captureThumbnail(el);
    } catch (e) {
      thumbnail = null;
    }

    results.push({
      title,
      src,
      duration,
      thumbnail
    });
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "GET_VIDEOS") {
    return;
  }

  (async () => {
    try {
      const videos = await collectVideosOnPage();
      sendResponse({ videos });
    } catch (e) {
      sendResponse({ error: e && e.message ? e.message : String(e) });
    }
  })();

  return true; // async
});
