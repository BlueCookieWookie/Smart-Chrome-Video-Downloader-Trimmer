@echo off
:: Smart Video Trimmer & Downloader - User Installer (No Admin Required)
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Smart Video Downloader - Installing...

echo.
echo Smart Video Trimmer & Downloader - Installing
echo ==================================================
echo.

:: ===================================================================
:: 1. Detect Python
:: ===================================================================
echo [1/6] Checking for Python...
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "delims=" %%p in ('python -c "import sys; print(sys.executable)"') do set "PYTHON_EXE=%%p"
    echo [OK] Found: %%p
) else (
    echo [..] Installing Python 3.11 via winget...
    winget install Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements --force >nul
    if errorlevel 1 (
        echo [ERROR] Failed to install Python.
        pause & exit /b 1
    )
    for /f "delims=" %%p in ('where python 2^>nul') do set "PYTHON_EXE=%%p"
    if not defined PYTHON_EXE (
        echo [ERROR] Python installed but not detected. Restart may be required.
        pause & exit /b 1
    )
    echo [OK] Python installed
)

:: ===================================================================
:: 2. Install yt-dlp
:: ===================================================================
echo [2/6] Installing yt-dlp...
"!PYTHON_EXE!" -m pip install --upgrade yt-dlp --quiet --no-cache-dir >nul
if errorlevel 1 (
    echo [ERROR] Failed to install yt-dlp
    pause & exit /b 1
)
echo [OK] yt-dlp ready

:: ===================================================================
:: 3. Set user install directory
:: ===================================================================
set "INSTALL_DIR=%USERPROFILE%\SmartVideoDownloader"
echo [3/6] Installing to: %INSTALL_DIR%
if exist "%INSTALL_DIR%" rd /s /q "%INSTALL_DIR%" >nul 2>&1
mkdir "%INSTALL_DIR%\extension" >nul 2>&1
mkdir "%INSTALL_DIR%\host" >nul 2>&1

echo [..] Copying files...
xcopy /E /I /Y "extension" "%INSTALL_DIR%\extension" >nul
xcopy /E /I /Y "host\ytdlp_host.py" "%INSTALL_DIR%\host\" >nul

:: ===================================================================
:: 4. Download FFmpeg (bundled with app)
:: ===================================================================
echo [4/6] Downloading FFmpeg (~15 MB)...
set "FFZIP=%TEMP%\ffmpeg.zip"
set "FFDIR=%TEMP%\ffmpeg_temp"
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile '%FFZIP%' -UseBasicParsing" >nul
if not exist "%FFZIP%" (
    echo [ERROR] Failed to download FFmpeg
    pause & exit /b 1
)
echo [..] Extracting FFmpeg...
powershell -Command "Expand-Archive -Force '%FFZIP%' '%FFDIR%'" >nul
copy "%FFDIR%\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe" "%INSTALL_DIR%\host\ffmpeg.exe" >nul
copy "%FFDIR%\ffmpeg-master-latest-win64-gpl\bin\ffprobe.exe" "%INSTALL_DIR%\host\ffprobe.exe" >nul
del "%FFZIP%" >nul 2>&1
rd /s /q "%FFDIR%" >nul 2>&1
echo [OK] FFmpeg installed (local copy)

:: ===================================================================
:: 5. Generate host config
:: ===================================================================
echo [5/6] Creating native messaging host files...
set "HOST_DIR=%INSTALL_DIR%\host"
set "BAT=%HOST_DIR%\ytdlp_host.bat"
set "JSON=%HOST_DIR%\com.ytdlp_bridge.json"
set "BAT_ESC=%BAT:\=\\%"

> "%BAT%" (
    echo @echo off
    echo "!PYTHON_EXE!" "%HOST_DIR%\ytdlp_host.py" %%*
)

> "%JSON%" (
    echo {
    echo   "name": "com.ytdlp_bridge",
    echo   "description": "yt-dlp native messaging host",
    echo   "path": "%BAT_ESC%",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://YOUR_EXTENSION_ID_GOES_HERE/"
    echo   ]
    echo }
)

:: Register for current user only (no admin needed)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytdlp_bridge" /ve /t REG_SZ /d "%JSON%" /f >nul
echo [OK] Native host registered (current user)

:: ===================================================================
:: 6. Done
:: ===================================================================
echo.
echo [6/6] Installation complete.
echo.
echo Next steps:
echo   1. Open Chrome → chrome://extensions/
echo   2. Enable "Developer mode"
echo   3. Click "Load unpacked" → select:
echo      %INSTALL_DIR%\extension
echo   4. Copy your Extension ID (32 characters)
echo   5. Edit this file:
echo      %JSON%
echo   6. Replace YOUR_EXTENSION_ID_GOES_HERE with your ID
echo   7. Save → reload extension
echo.
echo All files are in:
echo   %INSTALL_DIR%
echo.
echo Done.
pause