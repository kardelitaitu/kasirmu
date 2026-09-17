# One-time setup for Rust compilation caching with sccache (Windows).
#
# Prerequisites: Chocolatey (https://chocolatey.org/install)
#
# Run once per machine (PowerShell as Administrator not required):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-cache.ps1
#
# What it does:
# 1. Installs sccache via Chocolatey if missing
# 2. Sets a generous 20 GB local disk cache via SCCACHE_CACHE_SIZE
#    (`sccache --set-config` was removed from the CLI in modern sccache
#    releases; the supported knob is the SCCACHE_CACHE_SIZE env var,
#    which must be present in the environment when the sccache server
#    starts, so it is persisted at User scope here)
# 3. Verifies sccache is active as the rustc wrapper
#
# NOTE (sccache x incremental): [profile.dev] incremental = true keeps
# tight edit->check loops fast but makes dev-profile compiles
# non-cacheable for sccache. Clean rebuilds, release builds, and CI
# still cache. Prefix a command with CARGO_INCREMENTAL=0 when you want
# a cacheable baseline.

$ErrorActionPreference = "Stop"

Write-Host "==> Checking sccache..." -ForegroundColor Cyan
$sccache = Get-Command sccache -ErrorAction SilentlyContinue
if (-not $sccache) {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Host "    Chocolatey not installed. Install it first:" -ForegroundColor Red
        Write-Host "    https://chocolatey.org/install" -ForegroundColor Red
        exit 1
    }
    Write-Host "    sccache not found. Installing via Chocolatey..." -ForegroundColor Yellow
    choco install sccache -y
}

$version = sccache --version 2>&1
Write-Host "    $version"

Write-Host "==> Setting cache size to 20 GB (SCCACHE_CACHE_SIZE, User scope)..." -ForegroundColor Cyan
$desired = "20G"
$env:SCCACHE_CACHE_SIZE = $desired   # visible to the server restarted below
[Environment]::SetEnvironmentVariable("SCCACHE_CACHE_SIZE", $desired, "User")
Write-Host "    SCCACHE_CACHE_SIZE=$desired persisted at User scope (new processes inherit it)"

# Restart the local server so the new size takes effect immediately.
Write-Host "==> Restarting sccache server to apply the size..." -ForegroundColor Cyan
sccache --stop-server 2>&1 | Out-Null
sccache --start-server 2>&1 | Out-Null

Write-Host "==> Zeroing stats (fresh start)..." -ForegroundColor Cyan
sccache --zero-stats

Write-Host "==> Verifying sccache is enabled (uncommented) in .cargo\config.toml ..." -ForegroundColor Cyan
$configPath = Join-Path $PSScriptRoot ".." ".cargo" "config.toml"
$line = Select-String -Path $configPath -Pattern '^rustc-wrapper.*sccache' -Quiet
if ($line) {
    Write-Host "    ✓ sccache enabled as rustc-wrapper (uncommented)" -ForegroundColor Green
} else {
    Write-Host "    ✗ sccache not wired or still commented in .cargo\config.toml" -ForegroundColor Red
    Write-Host "    The repo ships this file uncommented -- make sure you have the latest version."
    exit 1
}

Write-Host ""
Write-Host "Setup complete. Current server config:" -ForegroundColor Green
sccache --show-stats 2>&1 | Select-String "Cache location|Max cache size|Version \(client\)" | ForEach-Object { "    $($_.Line.Trim())" }
Write-Host ""
Write-Host "Next:" -ForegroundColor Green
Write-Host "  1. Run a cold build:  cargo clean && cargo check --workspace --exclude kasirmu-app"
Write-Host "  2. Run a warm build:  cargo check --workspace --exclude kasirmu-app"
Write-Host "  3. Check stats:       sccache --show-stats"
