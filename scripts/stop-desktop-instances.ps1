<#
.SYNOPSIS
    Stop a running kasir.mu desktop instance and wait until its locks are free.

.DESCRIPTION
    `scripts/start-desktop.bat` calls this on every dev start. Killing the app
    is the easy half; the half that actually decides whether the next launch
    works is the WAIT that follows it.

    Windows releases the things a killed process held LAZILY, measurably later
    than the process itself exits:

      * the memory-mapped SQLite `-shm` sidecar -> the successor's first write
        fails with `unable to open database file` (SQLITE_CANTOPEN);
      * the WebView2 user-data directory -> the successor's webview creation
        fails with `HRESULT 0x800700AA: The requested resource is in use`.

    Both were observed on 2026-09-28 after a plain `taskkill /F /T`. A fixed
    sleep guesses at how long that takes; this script verifies instead, and
    only waits when it actually killed something, so a clean start pays
    nothing.

    WHAT IT KILLS, and why that is narrower than it looks. WebView2 children
    outlive their parent and cannot be attributed by parent PID once the parent
    is gone -- but every `msedgewebview2.exe` carries `--user-data-dir=` on its
    command line, so ownership IS decidable. This script kills only those whose
    command line contains `mu.kasir.app`. Measured 2026-09-28 on this machine:
    12 WebView2 processes were live and 0 were ours -- 7 belonged to Windows
    Search (`--webview-exe-name=SearchHost.exe`) and 5 to another desktop app
    (`wb-switch-rust.exe`). A blanket `taskkill /IM msedgewebview2.exe` would
    have killed all twelve.

.OUTPUTS
    One line per action on stdout. Exit 0 when the locks are free (including
    when nothing was running); exit 1 when they are still held at the deadline,
    so the caller can warn instead of launching into a known failure.
#>
param(
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = 'Continue'

$AppNames = @('kasirmu-app', 'kasirmu-mobile')
# The bundle identifier from apps/desktop-tauri/tauri.conf.json. It is what
# appears in our WebView2 children's `--user-data-dir=`, and it is the only
# safe way to tell ours from Windows Search's.
$Marker = 'mu.kasir.app'

function Get-OurWebViewProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
        Where-Object { $_.CommandLine -like "*$Marker*" })
}

function Get-AppProcesses {
    $found = @()
    foreach ($name in $AppNames) {
        $found += @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    }
    return @($found)
}

$killedSomething = $false
foreach ($name in $AppNames) {
    $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
        & taskkill /F /T /IM "$name.exe" > $null 2>&1
        Write-Host "[stop-desktop] stopped $($procs.Count) $name.exe process(es)"
        $killedSomething = $true
    }
}

if (-not $killedSomething) {
    Write-Host "[stop-desktop] no kasir.mu instance was running; nothing to wait for"
    exit 0
}

Write-Host "[stop-desktop] waiting up to $TimeoutSeconds s for Windows to release the file locks..."
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $apps = Get-AppProcesses
    $ours = Get-OurWebViewProcesses

    if ($apps.Count -eq 0 -and $ours.Count -eq 0) {
        Write-Host "[stop-desktop] locks released - no kasir.mu process and no own WebView2 child"
        exit 0
    }

    # Orphans never exit on their own: the parent that would have told them to
    # is already gone. Kill ours rather than waiting for a deadline we know
    # they will sit through.
    foreach ($p in $ours) {
        Write-Host "[stop-desktop] killing orphaned WebView2 pid $($p.ProcessId) (our user-data dir)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Milliseconds 500
}

$apps = Get-AppProcesses
$ours = Get-OurWebViewProcesses
Write-Host "[stop-desktop] WARNING: after $TimeoutSeconds s, $($apps.Count) app process(es) and $($ours.Count) own WebView2 child(ren) remain"
exit 1
