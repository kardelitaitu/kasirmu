<#
.SYNOPSIS
    OZ-POS Flamegraph Profiling Helper (Windows/PowerShell)

.DESCRIPTION
    Wraps cargo-flamegraph with sane defaults for OZ-POS targets.
    Supports profiling benchmarks, binaries, and running processes by PID.

.PARAMETER Bench
    Benchmark target name from crates/kasirmu-core/benches/ (e.g. "transaction_commit", "barcode_lookup").
    When omitted with no other target, lists available benchmarks.

.PARAMETER Binary
    Binary package name to profile (e.g. "oz-pos-app", "oz-cloud-server", "oz-pos-tablet").

.PARAMETER PID
    Process ID of a running OZ-POS process to attach to. Requires Administrator privileges.

.PARAMETER Frequency
    Sampling frequency in Hz (default: 997, the prime-number default suggested by perf).

.PARAMETER Output
    Output SVG path. When omitted, auto-generates "flamegraph-{target}-{timestamp}.svg".

.PARAMETER Root
    Request Administrator elevation for kernel-level stack traces (required for PID profiling).

.PARAMETER List
    List available benchmark targets and exit.

.PARAMETER Help
    Show this help message.

.EXAMPLE
    powershell -File scripts/profile.ps1 -Bench transaction_commit
    Profile the transaction_commit benchmark.

.EXAMPLE
    powershell -File scripts/profile.ps1 -Binary oz-cloud-server
    Profile the cloud-server binary.

.EXAMPLE
    powershell -File scripts/profile.ps1 -PID 1234 -Frequency 1999
    Attach to process 1234 sampling at 1999 Hz.

.EXAMPLE
    powershell -File scripts/profile.ps1 -List
    List all available benchmark targets.
#>

[CmdletBinding(DefaultParameterSetName = 'Help')]
param(
    [Parameter(ParameterSetName = 'Bench')]
    [string]$Bench = "",

    [Parameter(ParameterSetName = 'Binary')]
    [string]$Binary = "",

    [Parameter(ParameterSetName = 'PID')]
    [int]$PID = 0,

    [Parameter(ParameterSetName = 'PID')]
    [Parameter(ParameterSetName = 'Bench')]
    [Parameter(ParameterSetName = 'Binary')]
    [int]$Frequency = 997,

    [Parameter(ParameterSetName = 'Bench')]
    [Parameter(ParameterSetName = 'Binary')]
    [Parameter(ParameterSetName = 'PID')]
    [string]$Output = "",

    [Parameter(ParameterSetName = 'PID')]
    [switch]$Root,

    [Parameter(ParameterSetName = 'List')]
    [switch]$List,

    [switch]$Help
)

$ErrorActionPreference = "Stop"

# ── Help / List ────────────────────────────────────────────────────────
if ($Help -or $PSBoundParameters.Count -eq 0) {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
    exit 0
}

if ($List) {
    Write-Host "Available benchmark targets (crates/kasirmu-core/benches/):" -ForegroundColor Cyan
    $benchDir = Join-Path $PSScriptRoot ".." "crates" "kasirmu-core" "benches"
    $benches = Get-ChildItem -Path $benchDir -Filter "*.rs" | Select-Object -ExpandProperty BaseName
    foreach ($b in $benches | Sort-Object) {
        Write-Host "  - $b" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Usage: powershell -File scripts/profile.ps1 -Bench <name>" -ForegroundColor Yellow
    exit 0
}

# ── Validate parameters ────────────────────────────────────────────────
$hasTarget = ($Bench -ne "") -or ($Binary -ne "") -or ($PID -gt 0)
if (-not $hasTarget) {
    Write-Host "ERROR: Specify one of -Bench, -Binary, or -PID." -ForegroundColor Red
    Write-Host "Run with -Help for usage details." -ForegroundColor Yellow
    exit 1
}

# ── Ensure cargo-flamegraph is installed ───────────────────────────────
Write-Host "==> Checking cargo-flamegraph..." -ForegroundColor Cyan
$flamegraphInstalled = $false
try {
    $null = & cargo flamegraph --help 2>&1 | Out-String
    $flamegraphInstalled = $true
} catch {
    # Check via --version
    try {
        $null = & cargo flamegraph --version 2>&1 | Out-String
        $flamegraphInstalled = $true
    } catch {}
}

if (-not $flamegraphInstalled) {
    Write-Host "    cargo-flamegraph not found. Installing..." -ForegroundColor Yellow
    & cargo install flamegraph
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install cargo-flamegraph." -ForegroundColor Red
        Write-Host "Try: cargo install flamegraph" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "    cargo-flamegraph installed." -ForegroundColor Green
} else {
    Write-Host "    cargo-flamegraph found." -ForegroundColor Green
}

# ── Resolve output path ────────────────────────────────────────────────
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputFile = if ($Output -ne "") {
    $Output
} elseif ($Bench -ne "") {
    "flamegraph-$Bench-$timestamp.svg"
} elseif ($Binary -ne "") {
    "flamegraph-$Binary-$timestamp.svg"
} elseif ($PID -gt 0) {
    "flamegraph-pid$PID-$timestamp.svg"
} else {
    "flamegraph-$timestamp.svg"
}

# ── Build cargo-flamegraph command ─────────────────────────────────────
if ($PID -gt 0 -and $Root) {
    Write-Host ""
    Write-Host "NOTE: PID profiling requires Administrator privileges." -ForegroundColor Yellow
    Write-Host "      Restart this script in an elevated PowerShell if needed." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " OZ-POS Flamegraph Profiling" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Build argument array for cargo flamegraph (safe splatting, no Invoke-Expression)
$flamegraphArgs = @('flamegraph', '--frequency', "$Frequency", '--output', "$outputFile")

if ($Bench -ne "") {
    Write-Host "  Target:  benchmark '$Bench'" -ForegroundColor White
    Write-Host "  Freq:    $Frequency Hz" -ForegroundColor White
    Write-Host "  Output:  $outputFile" -ForegroundColor White
    $flamegraphArgs += '--bench', "$Bench"
} elseif ($Binary -ne "") {
    Write-Host "  Target:  binary '$Binary'" -ForegroundColor White
    Write-Host "  Freq:    $Frequency Hz" -ForegroundColor White
    Write-Host "  Output:  $outputFile" -ForegroundColor White
    $flamegraphArgs += '--bin', "$Binary"
} elseif ($PID -gt 0) {
    Write-Host "  Target:  PID $PID" -ForegroundColor White
    Write-Host "  Freq:    $Frequency Hz" -ForegroundColor White
    Write-Host "  Output:  $outputFile" -ForegroundColor White
    # On Windows, flamegraph --pid uses ETW (Event Tracing for Windows).
    # Requires Administrator privileges.
    $flamegraphArgs += '--pid', "$PID"
}

$displayCmd = "cargo $($flamegraphArgs -join ' ')"
Write-Host ""
Write-Host "Running: $displayCmd" -ForegroundColor Gray
Write-Host ""

& cargo $flamegraphArgs

# ── Check result ───────────────────────────────────────────────────────
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "SUCCESS: Flamegraph generated:" -ForegroundColor Green
    Write-Host "  $outputFile" -ForegroundColor Green

    # Get file size
    if (Test-Path $outputFile) {
        $file = Get-Item $outputFile
        $sizeKB = [math]::Round($file.Length / 1KB, 1)
        Write-Host "  Size: $sizeKB KB" -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "View the SVG in any browser or image viewer." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "ERROR: Flamegraph generation failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  - Missing debug symbols: Build with `profile.release.debug = 1`" -ForegroundColor Yellow
    Write-Host "  - PID profiling requires Administrator mode" -ForegroundColor Yellow
    Write-Host "  - Windows: Ensure Debugging Tools for Windows are installed" -ForegroundColor Yellow
    Write-Host "    (xperf.exe needs to be on PATH from Windows SDK or WPT)" -ForegroundColor Yellow
    Write-Host "  - Try: cargo flamegraph --help" -ForegroundColor Yellow
    exit 1
}
