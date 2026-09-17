# install/win/install.ps1 — kasir.mu Windows bootstrap installer
<#
.SYNOPSIS
    Installs (or upgrades) kasir.mu on Windows by downloading the official
    release installer and verifying it before running it.

.DESCRIPTION
    A thin bootstrap that reuses the project's existing release pipeline:

      1. Detects the CPU architecture and resolves the release manifest
         (latest.json for stable, beta.json for beta) published as a
         GitHub Release asset — the SAME manifest the in-app updater
         already trusts.
      2. Downloads the installer and SHA256SUMS.txt from the SAME release
         and verifies the SHA-256 checksum (fail-closed).
      3. Checks Authenticode: a valid signature is reported; unsigned
         releases (no signing cert configured) get a warning, not a hard
         fail — the checksum is the integrity guarantee.
      4. Runs the Tauri NSIS installer silently (/S). The installer is
         compiled with installMode=currentUser, so it installs to
         %LOCALAPPDATA%\Programs\kasir.mu with no UAC prompt.
      5. With -System, installs per-machine to Program Files via the MSI
         asset (msiexec /qn — a UAC prompt is expected there).

.EXAMPLE
    irm https://github.com/kardelitaitu/oz-pos/releases/latest/download/install.ps1 | iex
.EXAMPLE
    ./install.ps1
.EXAMPLE
    ./install.ps1 -Channel beta
.EXAMPLE
    ./install.ps1 -Version 0.0.28
.EXAMPLE
    ./install.ps1 -System
.EXAMPLE
    ./install.ps1 -DryRun

.NOTES
    Exit codes: 0 success | 1 generic error | 2 unsupported OS/arch |
    3 checksum mismatch | 4 download failure | 5 installer failure.

    Security model: the installer binary is verified against SHA256SUMS.txt
    published on the same GitHub Release (HTTPS). When run from disk, the
    script also verifies ITS OWN checksum against the release's
    SHA256SUMS.txt (install.ps1 is itself a release asset). When piped via
    `irm ... | iex` the script has no file on disk to verify, so that
    self-check is skipped — HTTPS + the release's checksum still cover the
    installer, and the script is short enough to audit.
#>
[CmdletBinding()]
param(
    [ValidateSet('stable', 'beta')]
    [string]$Channel = 'stable',
    [string]$Version = '',
    [switch]$System,
    [switch]$DryRun,
    [switch]$NoLaunch,
    [string]$Repo = 'kardelitaitu/oz-pos'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# PowerShell 5.1 defaults to TLS 1.0/1.1 on some systems; GitHub requires 1.2+.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

function Write-Step { param([string]$m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "    $m" -ForegroundColor Yellow }
function Fail       { param([string]$m, [int]$code) Write-Host "ERROR: $m" -ForegroundColor Red; exit $code }

# ── OS / architecture detection ──────────────────────────────────────────
if ($env:OS -ne 'Windows_NT') { Fail 'This script installs kasir.mu on Windows only.' 2 }

$arch = $env:PROCESSOR_ARCHITECTURE
# 32-bit PowerShell on 64-bit Windows reports x86 but runs under WOW64.
if ($arch -eq 'x86' -and $env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
switch ($arch) {
    'AMD64' { $platformKey = 'windows-x86_64'; $archTag = 'x64' }
    'ARM64' { $platformKey = 'windows-aarch64'; $archTag = 'arm64' }
    default { Fail "Unsupported CPU architecture: $arch (kasir.mu ships x64 and arm64 builds)." 2 }
}
Write-Step "Detected $arch ($platformKey)"

# ── Resolve the release manifest ─────────────────────────────────────────
if ($Version) { $Version = $Version.TrimStart('v') }
$manifestFile = if ($Channel -eq 'beta') { 'beta.json' } else { 'latest.json' }
if ($Version) {
    $releaseBase = "https://github.com/$Repo/releases/download/v$Version"
} else {
    $releaseBase = "https://github.com/$Repo/releases/latest/download"
}
$manifestUrl = "$releaseBase/$manifestFile"
Write-Step "Resolving release manifest: $manifestUrl"

$work = Join-Path $env:TEMP 'kasirmu-install'
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    $manifest = Invoke-RestMethod -Uri $manifestUrl
    # PSObject.Properties guard: under Set-StrictMode a plain property
    # access on a missing key throws, so test presence first.
    if (-not $manifest.platforms.PSObject.Properties[$platformKey]) {
        Fail "Release $($manifest.version) has no $platformKey build yet — try the latest release or a newer version." 2
    }
    if ($Version -and $manifest.version -ne $Version) {
        Fail "Version mismatch: requested $Version but $manifestFile describes $($manifest.version)." 1
    }
    $exeUrl = $manifest.platforms.$platformKey.url
    $exeName = Split-Path -Leaf $exeUrl
    Write-Ok "Latest: kasir.mu $($manifest.version) ($platformKey)"
} catch {
    Fail "Could not fetch the release manifest ($manifestUrl): $($_.Exception.Message)" 4
}

# ── Checksums (SHA256SUMS.txt covers every release asset) ────────────────
Write-Step 'Fetching SHA256SUMS.txt'
try {
    Invoke-WebRequest -Uri "$releaseBase/SHA256SUMS.txt" -OutFile (Join-Path $work 'SHA256SUMS.txt') -UseBasicParsing | Out-Null
} catch {
    Fail "Could not fetch SHA256SUMS.txt: $($_.Exception.Message)" 4
}
$sums = @{}
Get-Content (Join-Path $work 'SHA256SUMS.txt') | ForEach-Object {
    if ($_ -match '^\s*([0-9a-fA-F]{64})\s+(.+?)\s*$') { $sums[$matches[2]] = $matches[1].ToLower() }
}

# Self-verify when run from disk: install.ps1 is itself a release asset and
# appears in SHA256SUMS.txt. Skipped when piped (`irm ... | iex`) because
# $PSCommandPath is empty for a script block.
if ($PSCommandPath) {
    $selfName = Split-Path -Leaf $PSCommandPath
    if ($sums.ContainsKey($selfName)) {
        $selfHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLower()
        if ($selfHash -ne $sums[$selfName]) {
            Fail "This copy of $selfName does not match the released checksum — refusing to continue. Re-download it from the release." 3
        }
        Write-Ok "Self checksum verified ($selfName)"
    } else {
        Write-Warn "SHA256SUMS.txt has no entry for $selfName — skipping self-verification."
    }
} else {
    Write-Warn 'Running from a pipe — self-verification skipped. Download the script to disk and run ./install.ps1 to verify it too.'
}

function Get-VerifiedAsset {
    param([string]$Url, [string]$FileName)
    $path = Join-Path $work $FileName
    Write-Step "Downloading $FileName"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $path -UseBasicParsing | Out-Null
    } catch {
        Fail "Download failed: $($_.Exception.Message)" 4
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower()
    if (-not $sums.ContainsKey($FileName) -or $sums[$FileName] -ne $hash) {
        Fail "Checksum mismatch for $FileName (expected $($sums[$FileName]), got $hash) — aborting. Do not run the installer." 3
    }
    Write-Ok "Checksum verified: $FileName"
    return $path
}

try {
    if ($System) {
        # Per-machine install: the NSIS installer is compiled for currentUser,
        # so use the MSI asset (Tauri MSI is per-machine → Program Files).
        # msiexec will trigger a UAC prompt.
        $msiName = $null
        foreach ($name in $sums.Keys) {
            if ($name -like "*_$archTag*_en-US.msi" -or $name -like "*_$archTag*.msi") { $msiName = $name; break }
        }
        if (-not $msiName) { Fail "No $archTag MSI asset found in SHA256SUMS.txt — cannot do a per-machine install." 2 }

        $msi = Get-VerifiedAsset -Url "$releaseBase/$msiName" -FileName $msiName
        if ($DryRun) {
            Write-Ok "Dry run: would run 'msiexec /i $msiName /qn /norestart' (per-machine, Program Files, UAC prompt expected)."
            exit 0
        }
        Write-Step 'Installing per-machine (a UAC prompt may appear)...'
        $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
        if ($p.ExitCode -ne 0) { Fail "msiexec failed with exit code $($p.ExitCode)." 5 }
        Write-Ok 'kasir.mu installed to Program Files.'
    } else {
        $exe = Get-VerifiedAsset -Url $exeUrl -FileName $exeName

        # Authenticode is advisory: releases may legitimately ship unsigned
        # until a signing cert is configured. The checksum already passed.
        $sig = Get-AuthenticodeSignature -LiteralPath $exe
        if ($sig.Status -eq 'Valid') { Write-Ok "Authenticode: valid signature from $($sig.SignerCertificate.Subject)" }
        elseif ($sig.Status -eq 'NotSigned') { Write-Warn 'Installer is not code-signed (release built without a signing cert) — checksum already verified.' }
        else { Write-Warn "Authenticode status: $($sig.Status) — checksum already verified." }

        if ($DryRun) {
            Write-Ok "Dry run: would run '$exeName /S' (per-user, %LOCALAPPDATA%\Programs\kasir.mu)."
            exit 0
        }
        Write-Step "Installing kasir.mu $($manifest.version) (silent)..."
        $p = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
        if ($p.ExitCode -ne 0) { Fail "Installer exited with code $($p.ExitCode)." 5 }
        Write-Ok 'Install complete.'

        if (-not $NoLaunch) {
            $appExe = Join-Path $env:LOCALAPPDATA 'Programs\kasir.mu\kasir.mu.exe'
            if (Test-Path $appExe) { Start-Process $appExe; Write-Ok 'Launching kasir.mu.' }
            else { Write-Warn "App not found at $appExe — launch kasir.mu from the Start Menu." }
        }
    }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Ok "Done. kasir.mu $($manifest.version) installed."
exit 0
