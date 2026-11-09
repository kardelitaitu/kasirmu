# scripts/android-dev-hmr.ps1 — start the tablet with live HMR from a USB-connected device.
#
# Why this lives in the repo rather than in a lane's scratch: the procedure is
# three environment facts that are not discoverable from the tree — the Android
# SDK location, which NDK the Tauri android target builds against, and the TWO
# adb reverse forwards Vite needs (1422 for HTTP, 1423 for the HMR WebSocket).
# Missing the second one is the classic failure: the page loads and every
# hot-reload silently never arrives.
#
# Usage: double-click START_TABLET_HMR.bat at the repo root, or run this file
# directly. HostIp is the address the DEVICE reaches the host on; the default
# 127.0.0.1 is correct for a USB device because adb reverse tunnels it, and is
# wrong for a device on Wi-Fi (pass the host LAN address there).
#
# The NDK is resolved to the HIGHEST installed version rather than pinned: this
# script originally hardcoded both an SDK path and an NDK number for one machine,
# so it broke the moment either moved. Nothing below names a version.

param(
  [string]$HostIp = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

# Resolve the repo root from this script's own location — never hardcode it
# (AGENTS.md §3 "Paths": a hardcoded checkout root breaks in every worktree).
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ANDROID_HOME may already be set in the user environment; the default below is
# where the Windows SDK installer puts it.
if (-not $env:ANDROID_HOME) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
$Adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"

if (-not (Test-Path $Adb)) {
  Write-Error "adb not found at $Adb — set ANDROID_HOME to your Android SDK root."
  exit 1
}

# Tauri's android target needs ANDROID_NDK_HOME and NDK_HOME; some tooling still
# reads the older name, so both are set here.
$NdkRoot = Join-Path $env:ANDROID_HOME "ndk"
if (Test-Path $NdkRoot) {
  $Ndk = Get-ChildItem $NdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if ($Ndk) { $env:ANDROID_NDK_HOME = $Ndk.FullName; $env:NDK_HOME = $Ndk.FullName }
}

Write-Host "==> Checking Android device connection..." -ForegroundColor Cyan
& $Adb devices

# Both forwards are required: 1422 serves the Vite HTTP bundle, 1423 carries the
# HMR WebSocket. Without the second the app runs but never hot-reloads.
Write-Host "==> Setting up ADB port reverse (1422 HTTP, 1423 HMR WebSocket)..." -ForegroundColor Cyan
& $Adb reverse tcp:1422 tcp:1422
& $Adb reverse tcp:1423 tcp:1423
& $Adb reverse --list

Write-Host "==> Launching Tauri Android Dev with live HMR (host: $HostIp)..." -ForegroundColor Green
Set-Location (Join-Path $repoRoot "apps\mobile-tauri")
cargo tauri android dev --host $HostIp
