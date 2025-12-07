<img width="354" height="356" alt="image" src="https://github.com/user-attachments/assets/d7640541-ad42-47db-80d2-4328129d3742" /> <img width="367" height="598" alt="image" src="https://github.com/user-attachments/assets/285c97e9-fc01-4ebd-b81b-314a91986beb" />




A powerful Manifest V3 Chrome extension that finds every playable video on a page (even hidden or fragmented streams), lets you trim it with frame-accurate precision using FFmpeg stream copy, and downloads it via yt-dlp using Chrome Native Messaging

Works on **most sites** — YouTube, Twitter/X, TikTok, Instagram, Reddit, Twitch, etc. I notice that it has trouble downloading from Vimeo, but I couldn't be bothered fixing. 

---

### Installation (Windows)

1. Download the latest release or clone the repo
2. Extract and double-click `Install.bat`  
   → installs to `C:\Users\<YourName>\SmartVideoDownloader`
3. Open `chrome://extensions/` → enable **Developer mode**
4. Load unpacked → select the `extension` folder inside the C:\Users\<YourName>\SmartVideoDownloader install directory
5. Copy your Extension ID (32 characters)
6. Edit `host\com.ytdlp_bridge.json` → replace `YOUR_EXTENSION_ID_GOES_HERE` with the extension ID
7. Save → reload extension

Done.

Chrome Native Messaging requires absolute paths to the Python executable, host script, and FFmpeg binary — these differ on every machine, so the installer detects/installs Python + yt-dlp, downloads FFmpeg, and writes the correct paths and necessary config files automatically.

After installation, the downloaded directory is no longer needed and can be deleted. The extension will now live in C:\Users\<YourName>\SmartVideoDownloader

---

### Usage

- Click the extension on any page
- Pick a video
- (Optional) Enable trimming → drag sliders
- Choose quality/format → download
