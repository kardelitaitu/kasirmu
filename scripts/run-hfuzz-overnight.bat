@echo off
REM ============================================================================
REM  run-hfuzz-overnight.bat — launches the honggfuzz overnight campaign.
REM
REM  Two modes:
REM
REM    run-hfuzz-overnight.bat            launcher (default, double-click):
REM                                       starts the campaign in a MINIMIZED
REM                                       WSL console and returns immediately,
REM                                       so you can close this window and go
REM                                       to sleep. Closing THIS window does NOT
REM                                       stop the campaign — close the minimized
REM                                       console (or Ctrl-C / pkill inside WSL)
REM                                       to stop it.
REM
REM    run-hfuzz-overnight.bat foreground runs the campaign in THIS window
REM                                       with live output. Closing this window
REM                                       kills wsl.exe and stops the fuzzing —
REM                                       regular .bat behavior.
REM
REM  Companion scripts:
REM    tail-hfuzz.bat  - watch the campaign log live (safe to open anytime)
REM    stop-hfuzz.bat  - stop the running campaign (kills WSL processes +
REM                      closes the minimized console)
REM
REM  Both modes run tools/fuzz/hfuzz/run_overnight.sh (the "run while you sleep"
REM  fuzzing campaign) inside WSL. Equivalent to:
REM
REM      cd tools/fuzz/hfuzz && ./run_overnight.sh > /tmp/hfuzz-overnight.out 2>&1
REM
REM  Why a minimized console instead of `nohup ... &`? On WSL2, background
REM  processes are killed when the wsl.exe session that spawned them exits,
REM  so the launcher runs the campaign in the FOREGROUND of a minimized
REM  wsl.exe console (start /min). That keeps the WSL VM alive for the whole
REM  campaign and the .bat returns immediately. Keep the minimized window
REM  open; closing it stops the campaign. All output goes to
REM  /tmp/hfuzz-overnight.out.
REM
REM  Why WSL: honggfuzz does not build or run on native Windows — the whole
REM  tools/fuzz/hfuzz/ crate is Linux/macOS/WSL-only (see tools/fuzz/hfuzz/README.md).
REM
REM  PREREQS (once):
REM    - WSL2 with a distro that has Rust + `cargo honggfuzz` installed
REM      (Linux deps: build-essential binutils-dev libunwind-dev liblzma-dev)
REM    - This repo checked out on a Windows drive (the path is auto-converted
REM      to /mnt/<drive>/... via wslpath)
REM
REM  OVERRIDES (set in the environment before running):
REM    WSL_DISTRO        - WSL distro to use (default: the default distro)
REM    HFUZZ_RUN_TIME    - seconds per target (default 3600)
REM    HFUZZ_TARGETS     - space-separated targets (default: all)
REM    HFUZZ_THREADS     - fuzz threads (default: all cores)
REM    HFUZZ_REPORT_ROOT - campaign report root (default crash_reports/)
REM    HFUZZ_NO_NOTIFY=1 - skip desktop notifications (markers still written)
REM
REM  RESULTS:
REM    - campaign log:  /tmp/hfuzz-overnight.out (inside WSL)
REM    - crash reports: tools/fuzz/hfuzz/crash_reports/<timestamp>/
REM    - next morning:  cd tools/fuzz/hfuzz && ./triage_crashes.sh
REM
REM  DO NOT remove `pause`: the console closes on exit and hides errors.
REM ============================================================================
setlocal EnableDelayedExpansion

REM Mode: launcher (default) or foreground.
set "MODE=launcher"
if /i "%~1"=="foreground" set "MODE=foreground"
if /i "%~1"=="fg"         set "MODE=foreground"

REM Repo root = one level above this bat's directory (scripts/).
set "ROOT=%~dp0.."

REM Optional distro override.
set "DISTRO_ARGS="
if defined WSL_DISTRO set "DISTRO_ARGS=-d %WSL_DISTRO%"

REM Convert the Windows repo path to a WSL path (/mnt/c/...).
for /f "delims=" %%P in ('wsl.exe %DISTRO_ARGS% wslpath "%ROOT%"') do set "WSL_ROOT=%%P"
if not defined WSL_ROOT (
    echo [ERROR] Could not resolve "%ROOT%" inside WSL.
    echo         Is WSL installed, and is the repo on a Windows drive?
    pause
    exit /b 1
)
echo [OK] WSL repo root: %WSL_ROOT%

REM Pass through HFUZZ_* overrides as shell exports.
set "EXPORTS="
for %%V in (HFUZZ_RUN_TIME HFUZZ_TARGETS HFUZZ_THREADS HFUZZ_WORKSPACE HFUZZ_REPORT_ROOT HFUZZ_NO_NOTIFY) do (
    if defined %%V (
        set "EXPORTS=!EXPORTS! export %%V='!%%V!';"
    )
)

REM Launch the campaign.
echo Launching overnight honggfuzz campaign...
if "%MODE%"=="foreground" (
    echo   running in THIS window - close it to stop the campaign
) else (
    echo   minimized console: keep it open until the campaign finishes
)
echo   campaign log (inside WSL): /tmp/hfuzz-overnight.out
if "%MODE%"=="foreground" (
    REM Foreground: run in this window with live output. Closing the
    REM window kills wsl.exe and stops the fuzzing.
    wsl.exe %DISTRO_ARGS% bash -lc "!EXPORTS! cd '!WSL_ROOT!/tools/fuzz/hfuzz' && ./run_overnight.sh"
    echo [OK] Campaign finished - this window can be closed.
) else (
    REM Launcher: hand off to a minimized wsl.exe console, return now.
    start "OZ-POS hfuzz overnight" /min wsl.exe %DISTRO_ARGS% bash -lc "!EXPORTS! cd '!WSL_ROOT!/tools/fuzz/hfuzz' && ./run_overnight.sh > /tmp/hfuzz-overnight.out 2>&1"
    echo [OK] Launched. This window can be closed.
    echo   watch progress from WSL:  tail -f /tmp/hfuzz-overnight.out
)
echo   next morning:             cd tools/fuzz/hfuzz ^&^& ./triage_crashes.sh
pause
endlocal
