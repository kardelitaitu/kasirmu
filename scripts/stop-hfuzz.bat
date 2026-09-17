@echo off
REM ============================================================================
REM  stop-hfuzz.bat - stops the running honggfuzz overnight campaign.
REM
REM  Signals the campaign inside WSL (via scripts/stop-campaign.sh) and waits
REM  for it to shut down gracefully, so the TERM trap can write a partial
REM  report + DONE marker into crash_reports/. Then closes the minimized
REM  "OZ-POS hfuzz overnight" console window, if it is still open.
REM
REM  Safe: only targets honggfuzz-related processes. It does NOT touch other
REM  WSL distros/sessions (Docker Desktop, other shells) or your dev server.
REM
REM  Usage: double-click, or run from anywhere (%~dp0-relative).
REM  Override: WSL_DISTRO=<name>  (only if you started the campaign with a
REM            non-default distro - must match)
REM ============================================================================
setlocal EnableDelayedExpansion

REM Optional distro override.
set "DISTRO_ARGS="
if defined WSL_DISTRO set "DISTRO_ARGS=-d %WSL_DISTRO%"

REM Repo root = one level above this bat's directory (scripts/).
set "ROOT=%~dp0.."

REM Convert the Windows repo path to a WSL path (/mnt/c/...).
for /f "delims=" %%P in ('wsl.exe %DISTRO_ARGS% wslpath "%ROOT%"') do set "WSL_ROOT=%%P"
if not defined WSL_ROOT (
    echo [ERROR] Could not resolve "%ROOT%" inside WSL.
    echo         Is WSL installed, and is the repo on a Windows drive?
    pause
    exit /b 1
)

REM 1. Signal the campaign and wait for its TERM trap (writes DONE).
wsl.exe %DISTRO_ARGS% bash -lc "cd '%WSL_ROOT%' && bash ./scripts/stop-campaign.sh"

REM 2. Close the minimized "OZ-POS hfuzz overnight" console, if open.
taskkill /FI "WINDOWTITLE eq OZ-POS hfuzz overnight*" >nul 2>&1
if errorlevel 1 (
    echo   [INFO] no minimized console was open (campaign may have exited already)
) else (
    echo   [OK] minimized console closed
)

echo.
echo Next: check the partial report with  cd tools/fuzz/hfuzz ^&^& ./triage_crashes.sh
pause
endlocal
