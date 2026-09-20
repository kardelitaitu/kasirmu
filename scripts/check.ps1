# scripts/check.ps1 — Windows dev gate: a set of CHECKS, with an optional auto-fix afterwards.
#
# This is NOT a mirror of CI, whatever an older header here said. The workflow it used to
# name (ci.yml) is retired at .github/workflows/attic/ci.yml.bak; the live ones are
# dev-ci.yml and release.yml, and their job set is a strict superset of what runs below --
# the whole static-gates family (i18n parity, PG drift, ipc parity, scoped reads, the
# Go checks, the website job) has no equivalent here. For the full local matrix run
# scripts/check.sh; for what a push actually gates see .githooks/pre-push ->
# scripts/run-pre-push.py, which is path-routed.
#
# Order matters and is deliberate: every verify step (fmt --check, clippy -D warnings)
# runs FIRST and can fail the run. The auto-fix step runs LAST and only as a convenience
# on a clean tree -- it is skipped with a printed reason whenever `git status --porcelain`
# is non-empty, so it can never rewrite another lane's in-flight files in a shared
# checkout (the reason the repo dropped cargo fmt from pre-commit on 2026-09-13).
#
# Usage:  powershell -File scripts\check.ps1
#         powershell -File scripts\check.ps1 -Fast   (dev: unit tests + fmt + clippy only)
#         (run from the workspace root)

param(
    [switch]$Fast = $false
)

$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSCommandPath)
Set-Location ..

$totalStart = Get-Date
$script:stepCounter = 1

function Step {
    param(
        [string]$Name,
        [string]$RetryCommand,
        [scriptblock]$ScriptBlock,
        [int]$RetryMax = 1,
        [string[]]$RetryKill = @()
    )
    $stepStr = "{0:D2}" -f $script:stepCounter
    Write-Host "$stepStr. checking $Name... " -NoNewline
    $script:stepCounter++

    $start = Get-Date
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"

    for ($attempt = 1; $attempt -le $RetryMax; $attempt++) {
        $failed = $false
        $output = ""
        $global:LASTEXITCODE = 0
        try {
            $output = & $ScriptBlock 2>&1
            if ($LASTEXITCODE -ne 0) {
                $failed = $true
            }
        } catch {
            $failed = $true
            $output = $_
        }

        if (-not $failed) { break }

        if ($attempt -lt $RetryMax) {
            Write-Host ""
            Write-Host "  [$Name] attempt $attempt/$RetryMax failed - killing processes..."
            foreach ($proc in $RetryKill) {
                taskkill /f /im $proc 2>$null
            }
            Start-Sleep -Seconds 2
            Write-Host "  [$Name] retrying ($($attempt+1)/$RetryMax)... " -NoNewline
        }
    }

    $ErrorActionPreference = $oldEAP

    if ($failed) {
        Write-Host "FAIL" -ForegroundColor Red
        Write-Host "Output/Error from failed command:"
        Write-Host $output
        Write-Host "run ""$RetryCommand"" for full detailed error messages"
        exit 1
    } else {
        $elapsed = (Get-Date) - $start
        $elapsedSec = [math]::Round($elapsed.TotalSeconds, 1)
        Write-Host "PASS (" -NoNewline
        Write-Host $elapsedSec -NoNewline
        Write-Host "s)"
    }
}

# --- Phase 1: checks ----------------------------------------------------
$pythonCommand = if (Get-Command "python3" -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command "python" -ErrorAction SilentlyContinue) { "python" } else { $null }
if ($pythonCommand) {
    Step -Name "architecture boundaries" -RetryCommand "$pythonCommand scripts/verify-architecture-boundaries.py --strict" -ScriptBlock { & $pythonCommand scripts/verify-architecture-boundaries.py --strict }
} else {
    Write-Host "FAIL architecture boundaries (Python is required)" -ForegroundColor Red
    exit 1
}


# --- Phase 2: strict verify (mirrors CI rust job) -----------------------
Step -Name "cargo fmt (verify)" -RetryCommand "cargo fmt --all -- --check" -ScriptBlock {
    cargo fmt --all -- --check
}
Step -Name "clippy workspace" -RetryCommand "cargo clippy --workspace --all-targets --all-features -- -D warnings" -ScriptBlock {
    cargo clippy --workspace --all-targets --all-features -- -D warnings
}

$cpuCount = $env:NUMBER_OF_PROCESSORS
if (-not $cpuCount) { $cpuCount = 4 }

$nextestAvailable = $false
try { & cargo nextest --version | Out-Null; $nextestAvailable = ($LASTEXITCODE -eq 0) } catch {}

if ($Fast) {
    $testArgs = @('--lib')
    $retryArgs = "--lib"
} else {
    $testArgs = @()
    $retryArgs = ""
}

if ($nextestAvailable) {
    Step -Name "test workspace (nextest)" -RetryCommand "cargo nextest run --workspace --all-features --exclude kasirmu-app --exclude kasirmu-mobile" -ScriptBlock {
        cargo nextest run --workspace --all-features --exclude kasirmu-app --exclude kasirmu-mobile
    }
    Step -Name "test doctests" -RetryCommand "cargo test --doc --workspace" -ScriptBlock {
        cargo test --doc --workspace
    }
} else {
    Write-Host "WARNING nextest not found - falling back to cargo test (slower)" -ForegroundColor Yellow
    Step -Name "test workspace" -RetryCommand "cargo test --workspace --all-features $retryArgs -- --test-threads $cpuCount" -ScriptBlock {
        cargo test --workspace --all-features @testArgs -- --test-threads $cpuCount
    }
}

# --- Migration ----------------------------------------------------------
Step -Name "migration smoke test" -RetryCommand "cargo run -p kasirmu-cli -- migrate" -ScriptBlock { cargo run -p kasirmu-cli -- migrate }
Step -Name "migration idempotency" -RetryCommand "cargo run -p kasirmu-cli -- migrate" -ScriptBlock { cargo run -p kasirmu-cli -- migrate }
Remove-Item -LiteralPath "kasir.db", "kasir.db-wal", "kasir.db-shm" -ErrorAction Ignore

# --- Skill drift guard --------------------------------------------------
$gitBash = if (Test-Path "C:\Program Files\Git\bin\bash.exe") {
    "C:\Program Files\Git\bin\bash.exe"
} elseif (Get-Command "bash" -ErrorAction SilentlyContinue) {
    (Get-Command "bash").Source
} else {
    $null
}
if ($gitBash) {
    Step -Name "skill-drift-guard" -RetryCommand "& '$gitBash' .agents/skills/skill-drift-guard/scripts/detect.sh --report" -ScriptBlock {
        & $gitBash .agents/skills/skill-drift-guard/scripts/detect.sh --report
    }
} else {
    Write-Host "SKIP skill-drift-guard (bash not available)"
}

# --- UI checks ----------------------------------------------------------
if ((Get-Command "npm" -ErrorAction SilentlyContinue) -and (Test-Path "ui/package-lock.json")) {
    Push-Location ui

    Step -Name "npm ci" -RetryCommand "cd ui; npm ci --no-audit --no-fund --ignore-scripts" `
         -RetryMax 2 -RetryKill @("esbuild.exe") -ScriptBlock {
        npm ci --no-audit --no-fund --ignore-scripts 2>&1
    }
    Step -Name "ui lint" -RetryCommand "cd ui; npm run lint" -ScriptBlock { npm run lint }
    Step -Name "ui typecheck" -RetryCommand "cd ui; npm run typecheck" -ScriptBlock { npm run typecheck }
    Step -Name "ui test" -RetryCommand "cd ui; npm run test" -ScriptBlock { npm run test }

    if (Test-Path "node_modules/.bin/playwright.cmd") {
        $portFree = $true
        try {
            $conn = [System.Net.Sockets.TcpClient]::new('localhost', 1420)
            $conn.Close()
            $portFree = $false
        } catch {}
        if ($portFree) {
            Write-Host "XX. running ui e2e (non-blocking)... " -NoNewline
            $e2eStart = Get-Date
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "SilentlyContinue"
            try {
                $global:LASTEXITCODE = 0
                # repo entry point: boots the Docker backend + Vite, then runs Playwright
                $e2eResult = npm run e2e 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "WARN (some tests failed)" -ForegroundColor Yellow
                    Write-Host "  E2E failures are non-blocking. Last lines of the run:"
                    $e2eResult | Select-Object -Last 15 | ForEach-Object { Write-Host ("  " + $_) }
                } else {
                    $elapsed = (Get-Date) - $e2eStart
                    $elapsedSec = [math]::Round($elapsed.TotalSeconds, 1)
                    Write-Host "PASS (" -NoNewline
                    Write-Host $elapsedSec -NoNewline
                    Write-Host "s)"
                }
            } catch {
                Write-Host "WARN (error running E2E)" -ForegroundColor Yellow
            } finally {
                $ErrorActionPreference = $oldEAP
            }
        } else {
            Write-Host "SKIP ui e2e (port 1420 already in use)"
        }
    } else {
        Write-Host "SKIP ui e2e (Playwright not installed)"
    }
    Pop-Location
} else {
    Write-Host "SKIP UI checks (npm not available or ui/package-lock.json missing)"
}

# --- Generate stats.json -------------------------------------------------
Step -Name "generate code stats" -RetryCommand "powershell -File scripts\stats.ps1" -ScriptBlock {
    & powershell -File scripts\stats.ps1
}

# --- Auto-fix (convenience, LAST) ---------------------------------------
# Runs strictly AFTER every check above, so it can never mask a violation.
# Skipped on a dirty tree: --allow-dirty would rewrite another lane's in-flight files.
$dirtyPaths = @(git status --porcelain)
if ($dirtyPaths.Count -eq 0) {
    Step -Name "clippy auto-fix" -RetryCommand "cargo clippy --fix --allow-dirty -- --allow warnings" -ScriptBlock {
        cargo clippy --fix --allow-dirty -- --allow warnings
    }
    Step -Name "cargo fmt" -RetryCommand "cargo fmt --all" -ScriptBlock { cargo fmt --all }
    Write-Host "tree is now formatted and lint-clean"
} else {
    Write-Host "SKIP auto-fix (working tree is dirty - $($dirtyPaths.Count) path(s) modified); no files were rewritten"
}

# --- Done ---------------------------------------------------------------
$totalElapsed = (Get-Date) - $totalStart
$label = if ($Fast) { "fast" } else { "all" }
$elapsedSec = [math]::Round($totalElapsed.TotalSeconds, 1)
Write-Host "$label checks passed (" -NoNewline
Write-Host $elapsedSec -NoNewline
Write-Host "s)"

# --- Commit suggestion --------------------------------------------------
Write-Host ""
Write-Host "Now make a local commit:"
Write-Host ""
Write-Host "  1. git add <files>     # stage only intended files"
Write-Host "  2. git commit          # write a message following the guidelines below"
Write-Host ""
Write-Host "Commit message guidelines:"
Write-Host "  - Keep the summary line under 50 characters, imperative mood, no period"
Write-Host "  - Leave a blank line after the summary"
Write-Host "  - Use bullet points (- or *) for the body - focus on WHAT and WHY, not how"
Write-Host "  - Reference related docs/decisions or issue numbers where relevant"
Write-Host "  - Keep each bullet under 72 characters"
Write-Host ""
Write-Host "Example:"
Write-Host ""
Write-Host "    feat(sales): add deduction location override via PIN"
Write-Host ""
Write-Host "    - Clicking the badge opens FastPINOverlay for PIN verification"
Write-Host "    - Store method overrides deduction location with IMMEDIATE transaction"
Write-Host "    - Badge shows '(Override)' indicator after successful override"
Write-Host ""
Write-Host "    References ADR-19"
Write-Host ""
