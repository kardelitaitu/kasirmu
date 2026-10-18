@echo off
echo Starting kasir.mu Tablet HMR Dev Server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\android-dev-hmr.ps1"
pause
