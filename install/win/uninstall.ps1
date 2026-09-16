# install/win/uninstall.ps1 — kasir.mu Windows uninstaller
<#
.SYNOPSIS
    Removes kasir.mu from Windows using the uninstaller registered by the
    NSIS (per-user) or MSI (per-machine) installer.

.DESCRIPTION
    Finds the kasir.mu uninstall entry in the registry (HKCU for per-user
    installs, HKLM/WOW6432Node for per-machine), stops a running app, and
    runs the uninstaller silently (/S for NSIS; msiexec /x for MSI).
    Local app data (databases, settings) is preserved unless -Purge is given.

.EXAMPLE
    irm https://github.com/kardelitaitu/oz-pos/releases/latest/download/uninstall.ps1 | iex
.EXAMPLE
    ./uninstall.ps1
.EXAMPLE
    ./uninstall.ps1 -Purge

.NOTES
    Exit codes: 0 success | 1 not installed | 2 uninstaller failed.
    The uninstaller is found from the registry the installer itself wrote,
    so this works for both currentUser and per-machine installs and never
    guesses an install path.
#>
[CmdletBinding()]
param(
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail { param([string]$m, [int]$code) Write-Host "ERROR: $m" -ForegroundColor Red; exit $code }

# ── Locate the uninstall entry ───────────────────────────────────────────
$roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$found = @()
foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $found += Get-ChildItem $root | ForEach-Object {
        $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
        # PSObject.Properties guard: registry keys without a DisplayName must
        # not throw under Set-StrictMode.
        if ($props.PSObject.Properties['DisplayName'] -and $props.DisplayName -like 'kasir.mu*') { $props }
    }
}
$entry = $found | Select-Object -First 1
if (-not $entry) {
    Write-Host 'kasir.mu is not installed (no uninstall entry found).'
    exit 1
}
Write-Host "Found: $($entry.DisplayName)"

# Guard under Set-StrictMode: either property may be absent on the entry.
$command = ''
if ($entry.PSObject.Properties['QuietUninstallString']) { $command = $entry.QuietUninstallString }
if (-not $command -and $entry.PSObject.Properties['UninstallString']) { $command = $entry.UninstallString }
if (-not $command) { Fail 'Uninstall entry found but it carries no uninstall command.' 1 }
Write-Host "Uninstall command: $command"

# ── Stop a running app (NSIS aborts uninstall if the app is running) ─────
Get-Process -Name 'kasir.mu' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# ── Run the uninstaller silently ─────────────────────────────────────────
# UninstallString is usually a quoted exe path + args ("C:\...\uninstall.exe");
# QuietUninstallString (NSIS) is already the silent form.
if ($command -match '"([^"]+)"') {
    $exePath = $matches[1]
    $installArgs = ($command -replace '^\s*"[^"]+"\s*', '')
} else {
    $exePath = $command
    $installArgs = ''
}
# msiexec uses /qn for silent, NSIS uninstallers use /S.
if ($exePath -match '(?i)msiexec') {
    if ($installArgs -notmatch '(?i)/(qn|qb|quiet)') { $installArgs = "$installArgs /qn" }
} elseif ($installArgs -notmatch '(?i)/S') {
    $installArgs = "$installArgs /S"
}

Write-Host "Running: $exePath $installArgs"
$p = Start-Process -FilePath $exePath -ArgumentList $installArgs -Wait -PassThru
# 0 = success, 3010 = success, reboot required (MSI).
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Fail "Uninstaller exited with code $($p.ExitCode)." 2
}
Write-Host 'kasir.mu uninstalled.'

# ── Optional data purge ──────────────────────────────────────────────────
if ($Purge) {
    $dirs = @(
        (Join-Path $env:APPDATA 'mu.kasir.app'),
        (Join-Path $env:LOCALAPPDATA 'mu.kasir.app'),
        (Join-Path $env:LOCALAPPDATA 'Programs\kasir.mu')
    )
    foreach ($d in $dirs) {
        if (Test-Path $d) {
            Write-Host "Removing $d"
            Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
        }
    }
    Write-Host 'Local app data purged.'
}

exit 0
