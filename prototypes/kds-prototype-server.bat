@echo off
setlocal
title KDS Prototype - Local Server + Cloudflare Tunnel
cd /d "%~dp0"

echo ============================================
echo   KDS Prototype - local + Cloudflare tunnel
echo   (serving the prototypes/ folder - single source)
echo ============================================
echo.

REM ---- 1. Local python server (port 8765, all interfaces) ----
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found on PATH.
    pause
    exit /b 1
)
echo [1/2] Starting local server on port 8765 ...
start "KDS local server" /min cmd /c "python -m http.server 8765 --bind 0.0.0.0"
REM If port 8765 is already in use, the existing server keeps serving - fine.

REM ---- 2. Cloudflare tunnel ----
set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\cloudflared\cloudflared.exe" (
        set "CF=%LOCALAPPDATA%\cloudflared\cloudflared.exe"
    ) else (
        echo [ERROR] cloudflared not found.
        echo Download it to: %LOCALAPPDATA%\cloudflared\cloudflared.exe
        echo   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
        pause
        exit /b 1
    )
)

echo [2/2] Starting Cloudflare tunnel...
echo       The PUBLIC URL appears below when the tunnel connects.
echo       (protocol http2 + IPv4 only - required on this network)
echo.
echo       Local:   http://localhost:8765/kds-prototype.html
echo       Public:  the https://...trycloudflare.com URL below
echo.
echo       Close this window to stop the tunnel.
echo.
"%CF%" tunnel --url http://127.0.0.1:8765 --protocol http2 --edge-ip-version 4

echo.
echo Tunnel stopped.
pause
