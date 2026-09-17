# scripts/coverage.ps1 — Windows mirror of scripts/coverage.sh
#
# Generates Rust + UI coverage reports in coverage/ at the workspace root.
#
# Usage:
#   powershell -File scripts/coverage.ps1           # rust + ui
#   powershell -File scripts/coverage.ps1 rust      # rust only
#   powershell -File scripts/coverage.ps1 ui        # ui only
#
# Requirements:
#   rust: cargo install cargo-llvm-cov
#         # Install LLVM tools so llvm-cov + llvm-profdata are on PATH.
#         # Easiest on Windows: choco install llvm
#   ui:   npm ci --no-audit --no-fund --ignore-scripts (handled by the test:coverage npm script)

[CmdletBinding()]
param(
    [ValidateSet("all", "rust", "ui")]
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $root
try {
    function Write-Step($msg) {
        Write-Host ""
        Write-Host $msg -ForegroundColor Cyan
    }
    # Write to stderr so CI log scrapers and downstream `2>&1 | grep`
    # pipelines behave the same way as the bash version (which uses >&2).
    function Write-Err($msg) {
        [Console]::Error.WriteLine($msg)
    }

    # Track hard-failures across both targets so callers see the full picture.
    $errors = @()

    # ── Rust coverage ───────────────────────────────────────────────────
    if ($Target -in "all", "rust") {
        Write-Step "Rust coverage via cargo-llvm-cov -> coverage/rust/"
        $cargoCov = Get-Command cargo-llvm-cov -ErrorAction SilentlyContinue
        $llvmCov  = Get-Command llvm-cov        -ErrorAction SilentlyContinue
        if (-not $cargoCov) {
            Write-Err "cargo-llvm-cov not installed. Install with: cargo install cargo-llvm-cov"
            $errors += "rust: cargo-llvm-cov missing"
        }
        elseif (-not $llvmCov) {
            Write-Err "llvm-cov not on PATH. On Windows install with: choco install llvm"
            $errors += "rust: llvm-cov missing"
        }
        else {
            New-Item -ItemType Directory -Force -Path "coverage/rust" | Out-Null
            # Note: cargo-llvm-cov 0.8.x rejects combining `--json` and `--lcov`.
            # Emit JSON and re-run with --lcov only if the user wants
            # Codecov / SonarQube / similar integration.
            cargo llvm-cov `
                --workspace `
                --all-features `
                --exclude kasirmu-app `
                --exclude kasirmu-mobile `
                --html `
                --json `
                --output-dir (Join-Path $root "coverage/rust")
            Write-Step "rust done -> coverage/rust/index.html"
        }
    }

    # ── UI coverage ─────────────────────────────────────────────────────
    if ($Target -in "all", "ui") {
        Write-Step "UI coverage via vitest -> coverage/ui/"
        if (-not (Test-Path "ui/node_modules")) {
            Write-Err "ui/node_modules missing. Run: cd ui; npm ci --no-audit --no-fund --ignore-scripts"
            $errors += "ui: ui/node_modules missing"
        }
        elseif (-not (Test-Path "ui/node_modules/.bin/vitest")) {
            Write-Err "ui/node_modules/.bin/vitest missing. Run: cd ui; npm ci --no-audit --no-fund --ignore-scripts"
            $errors += "ui: vitest not installed"
        }
        else {
            Push-Location "ui"
            try { npm run test:coverage } finally { Pop-Location }
            Write-Step "ui done -> coverage/ui/index.html"
        }
    }

    Write-Step "coverage report: $root\coverage\{rust,ui}\index.html"

    if ($errors.Count -gt 0) {
        Write-Err "coverage failed:"
        foreach ($e in $errors) { Write-Err "  - $e" }
        exit 1
    }
}
finally {
    Pop-Location
}
