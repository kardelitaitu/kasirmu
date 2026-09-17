<#
.SYNOPSIS
    One-time developer environment setup for OZ-POS on Windows.

.DESCRIPTION
    Automates the common onboarding steps:
    1. Verify prerequisites (Rust, Node.js, Git)
    2. Enable Git hooks (pre-commit content gates; fmt moved to pre-push/CI on 2026-09-13)
    3. Install npm dependencies (respects the pinned install-script approvals in ui/package.json;
       see ui/README.md#install-script-approvals)
    4. Run database migration
    5. Seed demo data (if available)
    6. Quick verify with cargo check

    Run from the workspace root:
        powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

.PARAMETER WorkspaceRoot
    Path to the project root. Auto-detects from script location.
#>

param(
    [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

# Locate workspace root
if (-not $WorkspaceRoot) {
    $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
}
Set-Location $WorkspaceRoot

# Safety guard
if (-not (Test-Path "Cargo.toml")) {
    Write-Host "ERROR: Could not find Cargo.toml at $WorkspaceRoot" -ForegroundColor Red
    exit 1
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OZ-POS Developer Setup" -ForegroundColor Cyan
Write-Host "  Workspace: $WorkspaceRoot" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

$script:step = 0
function step {
    param([string]$Label, [ScriptBlock]$Block)
    $script:step++
    Write-Host "[$($script:step)] $Label... " -NoNewline -ForegroundColor Yellow
    $start = Get-Date
    try {
        & $Block
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        $elapsed = (Get-Date) - $start
        $sec = $elapsed.TotalSeconds.ToString('0.0')
        Write-Host "PASS ($sec s)" -ForegroundColor Green
    } catch {
        Write-Host "FAIL" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
        exit 1
    }
}

# Step 1: Prerequisites
step -Label "Prerequisites" -Block {
    $rust = rustc --version
    if ($LASTEXITCODE -ne 0) { throw "Rust not found -- install from https://rustup.rs/" }
    Write-Host "  Rust: $rust"

    $node = node --version
    if ($LASTEXITCODE -ne 0) { throw "Node.js not found -- install from https://nodejs.org/" }
    Write-Host "  Node: $node"

    $npm = npm --version
    if ($LASTEXITCODE -ne 0) { throw "npm not found" }
    Write-Host "  npm:  $npm"

    $git = git --version
    if ($LASTEXITCODE -ne 0) { throw "Git not found" }
    Write-Host "  Git:  $git"
}

# Step 2: Git hooks
step -Label "Git hooks" -Block {
    $hooksDir = Join-Path $WorkspaceRoot ".githooks"
    if (Test-Path $hooksDir) {
        git config core.hooksPath ".githooks"
        Write-Host "  hooksPath set to .githooks"
    } else {
        Write-Host "  .githooks not found -- skip hooks setup" -ForegroundColor Yellow
    }
}

# Step 3: npm install
step -Label "npm install" -Block {
    Push-Location (Join-Path $WorkspaceRoot "ui")
    try {
        npm ci --no-audit --no-fund
        Write-Host "  node_modules ready"
    } finally {
        Pop-Location
    }
}

# Step 4: Database migration
step -Label "database migration" -Block {
    cargo run -p oz-cli -- migrate
    Write-Host "  Schema up to date"
}

# Step 5: Migration idempotency
step -Label "migration idempotency" -Block {
    cargo run -p oz-cli -- migrate
    Write-Host "  Idempotent -- second run succeeds"
            Remove-Item -LiteralPath "kasir.db", "kasir.db-wal", "kasir.db-shm" -ErrorAction Ignore
}

# Step 6: Demo data seed (optional, skip if command not available)
step -Label "demo data seed" -Block {
    # Try to seed demo data; skip gracefully if subcommand unavailable.
    # Run via cmd.exe to suppress PowerShell error records from 2>&1
    # that would otherwise become terminating errors under $ErrorActionPreference = "Stop".
    $output = & cmd /c "cargo run -p oz-cli -- seed-demo 2>nul"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Demo data loaded"
    } else {
        Write-Host "  seed-demo subcommand not available -- skip" -ForegroundColor Yellow
    }
    $global:LASTEXITCODE = 0
}

# Step 7: cargo check (quick verify)
step -Label "cargo check (quick verify)" -Block {
    cargo check --workspace --all-features --exclude kasirmu-app --exclude kasirmu-tablet
    Write-Host "  Workspace compiles cleanly"
}

# Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    1. Run checks:    .\scripts\check.ps1" -ForegroundColor Gray
Write-Host "    2. Start coding:  code ." -ForegroundColor Gray
Write-Host "    3. Build EXE:     .\scripts\build-exe-release.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "  Quick reference:" -ForegroundColor White
Write-Host "    cargo check              fast Rust compilation check" -ForegroundColor Gray
Write-Host "    cargo test               run all Rust tests" -ForegroundColor Gray
Write-Host "    cd ui; npm run test      run UI tests" -ForegroundColor Gray
Write-Host "    cd ui; npm run typecheck TypeScript type check" -ForegroundColor Gray
Write-Host "    cargo clippy             Rust lint" -ForegroundColor Gray
Write-Host "    cargo fmt                Rust formatting" -ForegroundColor Gray
Write-Host ""
