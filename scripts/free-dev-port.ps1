<#
.SYNOPSIS
    Robustly kill any stale process bound to a specified TCP port (default 1420).

.DESCRIPTION
    Called from start-desktop.bat before `cargo tauri dev`. Safely hunts down
    stale dev-server PIDs (typically a leftover `node` from a crashed `vite`)
    and frees the port so Tauri can bind cleanly.

    Hardening over the previous inline `powershell -Command` chain:
    - Per-PID try/catch (one unreadable/owned-by-SYSTEM PID does not abort
      the rest of the cleanup).
    - Filters to Listen|Bound states only — TimeWait/Established are left
      alone so we never tear down legitimate traffic.
    - Friendly coloured output per kill so port-cleanup's behaviour is
      visible in the console, replacing the previous silent no-op.
    - Exit 0 when clean (incl. nothing to do); exits 1 if any holder could
      not be terminated, so the .bat caller can surface a warning.

.PARAMETER Port
    TCP port to clear (default 1420 — Tauri's devUrl).
#>
[CmdletBinding()]
param (
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$Port = 1420
)

$ErrorActionPreference = 'Continue'

# 0. Terminate any leftover desktop/tablet client processes from previous runs
#    so they do not hold the SQLite database (kasir.db) or the WebView2 user data profile.
Get-Process -Name kasirmu-app, kasirmu-mobile -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        Stop-Process -Id $_.Id -Force -ErrorAction Stop
        Write-Host ("[OK   ] Killed leftover client app: pid={0} ({1})" -f $_.Id, $_.ProcessName) `
            -ForegroundColor Green
    } catch {
        Write-Host ("[WARN ] Could not kill pid={0} ({1}): {2}" -f $_.Id, $_.ProcessName, $_.Exception.Message) `
            -ForegroundColor Yellow
    }
}

# 0b. Terminate any orphaned Edge WebView2 renderer processes associated with mu.kasir.app
#     so they do not hold EBWebView profile locks (HRESULT 0x800700AA / ERROR_BUSY).
Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*mu.kasir.app*" } |
    ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            Write-Host ("[OK   ] Killed leftover WebView2 renderer: pid={0}" -f $_.ProcessId) `
                -ForegroundColor Green
        } catch {
            Write-Host ("[WARN ] Could not kill WebView2 pid={0}: {1}" -f $_.ProcessId, $_.Exception.Message) `
                -ForegroundColor Yellow
        }
    }

# 1. Fetch IPv4 + IPv6 connections on $Port, filter to listeners / bound sockets.
#    Where-Object is used instead of the -State parameter on Get-NetTCPConnection
#    so the script is portable across Windows 10/11 PowerShell versions.
$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -match '^(Listen|Bound)$' }

# 2. Silent exit when nothing is blocking the port — the caller just runs Tauri.
if (-not $connections) {
    exit 0
}

# 3. A process listening on `[::1]` AND `127.0.0.1` appears twice (one per
#    address family). De-duplicate PIDs before iterating.
$pids = $connections.OwningProcess | Sort-Object -Unique

$exitCode = 0

foreach ($pidToKill in $pids) {
    # 4. Belt-and-braces: NEVER bring down SYSTEM (PID 0 = Idle, PID 4 = System).
    if ($pidToKill -in 0, 4) {
        Write-Host ("[WARN ] Port {0} bound by SYSTEM (pid={1}); skipping (likely shared service)" -f $Port, $pidToKill) `
            -ForegroundColor Yellow
        $exitCode = 1
        continue
    }

    # 5. Per-PID fenced kill — one stale/PERM-denied PID does not abort the rest.
    try {
        $proc = Get-Process -Id $pidToKill -ErrorAction Stop
        Stop-Process -Id $pidToKill -Force -ErrorAction Stop
        Write-Host ("[OK   ] Killed stale dev-server on port {0}: pid={1} ({2})" -f $Port, $pidToKill, $proc.ProcessName) `
            -ForegroundColor Green
    } catch {
        $msg = $_.Exception.Message
        Write-Host ("[FAIL ] Could not kill pid={0} on port {1}: {2}" -f $pidToKill, $Port, $msg) `
            -ForegroundColor Red
        $exitCode = 1
    }
}

exit $exitCode
