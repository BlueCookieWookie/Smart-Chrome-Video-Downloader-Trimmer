#!/usr/bin/env python3
import sys
import json
import struct
import os
import traceback
from pathlib import Path
import subprocess
from typing import Optional, Tuple

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

# Try Tkinter for folder picker
try:
    import tkinter as tk
    from tkinter import filedialog
    TK_AVAILABLE = True
except Exception:
    TK_AVAILABLE = False

HOME = Path.home()
LOG_PATH = HOME / "ytdlp_host.log"
DOWNLOAD_DIR = HOME / "Downloads"

# ---------------- Logging ---------------- #

def log(msg: str) -> None:
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass

log("ytdlp_host started.")

# ---------------- Native messaging I/O ---------------- #

def send_message(obj: dict) -> None:
    try:
        encoded = json.dumps(obj).encode("utf-8")
        sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except Exception as e:
        log(f"Error in send_message: {e!r}")
        raise

def read_message() -> Optional[dict]:
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    (msg_len,) = struct.unpack("<I", raw_len)
    data = sys.stdin.buffer.read(msg_len)
    if not data:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except Exception as e:
        log(f"Error decoding message: {e!r}")
        return None

# ---------------- yt-dlp helpers ---------------- #

class NullLogger:
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): log(f"[yt-dlp ERROR] {msg}")

NULL_LOGGER = NullLogger()

def quality_to_format(quality: Optional[str], container: Optional[str]) -> str:
    q = (quality or "best").lower()
    c = (container or "auto").lower()

    if q == "audio":
        return "bestaudio/best"

    if c == "mp4":
        base = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    elif c == "webm":
        base = "bestvideo[ext=webm]+bestaudio/best[ext=webm]/best"
    else:
        base = "bestvideo+bestaudio/best"

    if q == "1080p":
        return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/" + base
    if q == "720p":
        return "bestvideo[height<=720]+bestaudio/best[height<=720]/" + base
    if q == "480p":
        return "bestvideo[height<=480]+bestaudio/best[height<=480]/" + base
    return base

def run_ytdlp_download(
    url: str,
    title_hint: Optional[str] = None,
    quality: Optional[str] = None,
    container: Optional[str] = None,
    format_id: Optional[str] = None,
    job_id: Optional[str] = None,
    stream_type: str = "av",
) -> str:
    """
    Download with yt-dlp and return final filename.
    Sends progress events if jobId is provided.
    """

    global DOWNLOAD_DIR
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    downloads_dir = str(DOWNLOAD_DIR)

    outtmpl = os.path.join(downloads_dir, "%(title).80s.%(ext)s")

    progress_state = {"last_percent": -1}

    def progress_hook(d):
        if job_id is None:
            return
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        downloaded = d.get("downloaded_bytes") or 0
        if total > 0:
            percent = int(downloaded * 100 / total)
            if percent != progress_state["last_percent"]:
                progress_state["last_percent"] = percent
                send_message({
                    "jobId": job_id,
                    "event": "progress",
                    "phase": "download",
                    "percent": percent,
                    "fromNative": True
                })

    st = (stream_type or "av").lower()
    q = (quality or "best").lower()
    c = (container or "auto").lower()

    ydl_opts = {
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "logger": NULL_LOGGER,
        "progress_hooks": [progress_hook],
    }

    # ----- AUDIO-ONLY: always use FFmpegExtractAudio, even with format_id -----
    if st == "a":
        # choose which input stream to take
        if format_id:
            ydl_opts["format"] = format_id
        else:
            ydl_opts["format"] = "bestaudio/best"

        # map container to preferred codec
        preferred = "m4a"
        if c == "mp3":
            preferred = "mp3"
        elif c == "webm":
            preferred = "opus"
        elif c == "m4a":
            preferred = "m4a"
        elif c == "aac":
            preferred = "aac"
        elif c == "auto":
            preferred = "m4a"

        ydl_opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": preferred,
            "preferredquality": "0",
        }]
        ydl_opts["keepvideo"] = False

    else:
        # ----- VIDEO or VIDEO+AUDIO -----
        if format_id:
            if st == "av":
                ydl_opts["format"] = f"{format_id}+bestaudio/best"
            else:  # video only
                ydl_opts["format"] = format_id
        else:
            if st == "v":
                # pure video-only formats
                if q == "1080p":
                    ydl_opts["format"] = "bestvideo[height<=1080]/bestvideo/best"
                elif q == "720p":
                    ydl_opts["format"] = "bestvideo[height<=720]/bestvideo/best"
                elif q == "480p":
                    ydl_opts["format"] = "bestvideo[height<=480]/bestvideo/best"
                else:
                    ydl_opts["format"] = "bestvideo/best"
            else:
                # video + audio
                ydl_opts["format"] = quality_to_format(quality, container)

    log(
        f"Starting yt-dlp download for URL: {url}, "
        f"quality={quality}, container={container}, format_id={format_id}, "
        f"stream_type={st}, dir={downloads_dir}"
    )

    if job_id:
        send_message({"jobId": job_id, "event": "start", "fromNative": True})

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as e:
        log(f"yt-dlp DownloadError: {e!r}")
        raise

    filename = None
    if isinstance(info, dict):
        rds = info.get("requested_downloads") or []
        for d in rds:
            fp = d.get("filepath")
            if fp:
                filename = fp
                break
        if not filename:
            filename = info.get("filepath") or info.get("_filename")

    log(f"yt-dlp info final filename guess: {filename}")

    if not filename:
        raise RuntimeError("yt-dlp did not provide a final output filename")

    filename = str(Path(filename).expanduser().resolve())
    log(f"yt-dlp download complete. Final file: {filename}")
    return filename

# ---------------- ffmpeg trimming ---------------- #

def run_ffmpeg_trim(src: str, start: float, end: float, job_id: Optional[str] = None) -> str:
    src_path = Path(src)
    out_path = src_path.with_name(src_path.stem + "_clip" + src_path.suffix)

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", str(src_path),
        "-c", "copy",
        str(out_path)
    ]

    log(f"Running ffmpeg trim: {' '.join(cmd)}")

    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except subprocess.CalledProcessError as e:
        log(f"ffmpeg trim failed: {e!r}")
        raise

    return str(out_path)

# ---------------- Folder picker ---------------- #

def choose_save_directory() -> Optional[str]:
    global DOWNLOAD_DIR

    if not TK_AVAILABLE:
        log("Tkinter not available; cannot show folder picker.")
        return None

    try:
        root = tk.Tk()
        root.withdraw()
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass

        folder = filedialog.askdirectory(
            initialdir=str(DOWNLOAD_DIR),
            title="Choose download folder for Smart Video Downloader",
        )
        root.destroy()

        if folder:
            DOWNLOAD_DIR = Path(folder)
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            log(f"User chose download dir: {DOWNLOAD_DIR}")
            return str(DOWNLOAD_DIR)

        log("User cancelled folder picker; keeping existing dir.")
        return None
    except Exception as e:
        log(f"Error in choose_save_directory: {e!r}")
        return None

# ---------------- Probe info ---------------- #

def run_ytdlp_probe(url: str) -> Tuple[Optional[float], Optional[str], Optional[str], list]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "logger": NULL_LOGGER,
    }

    duration = None
    title = None
    thumbs = []
    formats = []

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as e:
        log(f"yt-dlp probe DownloadError: {e!r}")
        raise

    if isinstance(info, dict):
        duration = info.get("duration")
        title = info.get("title")
        thumbs = info.get("thumbnails") or []
        formats_raw = info.get("formats") or []
        for f in formats_raw:
            formats.append({
                "format_id": f.get("format_id"),
                "ext": f.get("ext"),
                "height": f.get("height"),
                "width": f.get("width"),
                "tbr": f.get("tbr"),
                "format_note": f.get("format_note"),
                "fps": f.get("fps"),
                "vcodec": f.get("vcodec"),
                "acodec": f.get("acodec"),
            })

    thumb_url = None
    if thumbs:
        best = sorted(thumbs, key=lambda t: (t.get("width") or 0), reverse=True)[0]
        thumb_url = best.get("url")

    log(f"Probe result: duration={duration}, title={title}, thumbnail={thumb_url}, formats={len(formats)}")

    return duration, title, thumb_url, formats

# ---------------- Message helpers ---------------- #

def choose_url(payload: dict) -> Optional[str]:
    video_url = payload.get("videoUrl")
    page_url = payload.get("pageUrl")
    if video_url and not str(video_url).startswith("blob:"):
        return video_url
    return page_url

# ---------------- Message handlers ---------------- #

def handle_download_full(payload: dict) -> None:
    job_id = payload.get("jobId")
    url = choose_url(payload)
    if not url:
        send_message({
            "jobId": job_id,
            "event": "error",
            "ok": False,
            "error": "No URL provided."
        })
        return

    try:
        filename = run_ytdlp_download(
            url,
            title_hint=payload.get("title"),
            quality=payload.get("quality"),
            container=payload.get("container"),
            format_id=payload.get("formatId"),
            job_id=job_id,
            stream_type=payload.get("streamType") or "av",
        )
        send_message({
            "jobId": job_id,
            "event": "complete",
            "ok": True,
            "filename": filename
        })
    except Exception as e:
        log("Error in handle_download_full: " + repr(e))
        log(traceback.format_exc())
        send_message({
            "jobId": job_id,
            "event": "error",
            "ok": False,
            "error": str(e)
        })

def handle_download_trimmed(payload: dict) -> None:
    job_id = payload.get("jobId")
    url = choose_url(payload)
    if not url:
        send_message({
            "jobId": job_id,
            "event": "error",
            "ok": False,
            "error": "No URL provided."
        })
        return

    start = payload.get("start")
    end = payload.get("end")

    if start is None or end is None or end <= start:
        send_message({
            "jobId": job_id,
            "event": "error",
            "ok": False,
            "error": "Invalid start/end times."
        })
        return

    try:
        downloaded = run_ytdlp_download(
            url,
            title_hint=payload.get("title"),
            quality=payload.get("quality"),
            container=payload.get("container"),
            format_id=payload.get("formatId"),
            job_id=job_id,
            stream_type=payload.get("streamType") or "av",
        )
        clipped = run_ffmpeg_trim(downloaded, start, end, job_id=job_id)

        try:
            os.remove(downloaded)
            log(f"Deleted original full file after trimming: {downloaded}")
        except Exception as e_del:
            log(f"Failed to delete original file {downloaded}: {e_del}")

        send_message({
            "jobId": job_id,
            "event": "complete",
            "ok": True,
            "filename": clipped
        })
    except Exception as e:
        log("Error in handle_download_trimmed: " + repr(e))
        log(traceback.format_exc())
        send_message({
            "jobId": job_id,
            "event": "error",
            "ok": False,
            "error": str(e)
        })

def handle_probe(payload: dict) -> None:
    job_id = payload.get("jobId")
    url = payload.get("pageUrl")
    if not url:
        send_message({
            "jobId": job_id,
            "event": "complete",
            "ok": False,
            "error": "No pageUrl for probe."
        })
        return

    try:
        duration, title, thumb, formats = run_ytdlp_probe(url)
        send_message({
            "jobId": job_id,
            "event": "complete",
            "ok": True,
            "duration": duration,
            "title": title,
            "thumbnail": thumb,
            "formats": formats
        })
    except Exception as e:
        log("Error in handle_probe: " + repr(e))
        log(traceback.format_exc())
        send_message({
            "jobId": job_id,
            "event": "complete",
            "ok": False,
            "error": str(e)
        })

def handle_choose_save_dir(payload: dict) -> None:
    job_id = payload.get("jobId")
    folder = choose_save_directory()

    if not folder:
        folder = str(DOWNLOAD_DIR)

    send_message({
        "jobId": job_id,
        "event": "complete",
        "ok": True,
        "dir": folder
    })

# ---------------- Main loop ---------------- #

def main():
    try:
        while True:
            msg = read_message()
            if msg is None:
                log("EOF on stdin, exiting.")
                break

            log(f"Received raw message: {json.dumps(msg, ensure_ascii=False)}")

            mtype = msg.get("type")
            log(f"Handling message type: {mtype}")

            if mtype == "DOWNLOAD_FULL":
                handle_download_full(msg)
            elif mtype == "DOWNLOAD_TRIMMED":
                handle_download_trimmed(msg)
            elif mtype == "PROBE_INFO":
                handle_probe(msg)
            elif mtype == "CHOOSE_SAVE_DIR":
                handle_choose_save_dir(msg)
            else:
                log(f"Unknown message type: {mtype}")
    except Exception as e:
        log("Fatal error in main(): " + repr(e))
        log(traceback.format_exc())

if __name__ == "__main__":
    main()
