# build-docs.ps1 - Build the kasir.mu documentation portal (mdBook)
#
# Pipeline (order matters):
#   1. cargo doc        -> target/doc/
#   2. typedoc          -> docs/src/api/ts/
#   3. copy guides/ADRs -> docs/src/guides/ + docs/src/decisions/
#   4. copy rustdoc     -> docs/src/api/rust/
#   5. generate SUMMARY.md from the copied trees
#   6. mdbook build     -> docs/book/ (fails if mdBook emits warnings)
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 files as ANSI
# unless they carry a UTF-8 BOM, so non-ASCII characters (em-dashes, check
# marks, arrows) corrupt string literals and break parsing.
#
# See docs/plans/documentation-portal-plan.md for the plan behind this layout.
[CmdletBinding()]
param(
    [switch]$Open = $true,
    [switch]$SkipRust = $false,
    [switch]$SkipUI = $false
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $ScriptDir
$BookSrc = Join-Path $WorkspaceRoot "docs\src"

if (-not (Get-Command mdbook -ErrorAction SilentlyContinue)) {
    Write-Error "mdbook not found - install it with: cargo install mdbook --locked"
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building kasir.mu Documentation Portal" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (-not $SkipRust) {
    Write-Host "`n[1/7] Generating Rust workspace API docs (cargo doc)..." -ForegroundColor Yellow
    Push-Location $WorkspaceRoot
    try {
        cargo doc --workspace --no-deps --document-private-items
        Write-Host "[SUCCESS] Rust documentation generated in target/doc/" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}

if (-not $SkipUI) {
    Write-Host "`n[2/7] Generating TypeScript API docs (TypeDoc)..." -ForegroundColor Yellow
    Push-Location (Join-Path $WorkspaceRoot "ui")
    try {
        $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
        if ($null -ne $npxCmd) {
            npx -y typedoc --skipErrorChecking --entryPointStrategy expand ./src/api ./src/types ./src/hooks --out ../docs/src/api/ts
            if (-not (Test-Path "$BookSrc\api\ts\index.html")) {
                Write-Host "[WARNING] TypeDoc output missing - install typedoc in ui/ (npm i -D typedoc)." -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "[WARNING] npx not found on PATH, skipping TypeDoc generation." -ForegroundColor Yellow
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "`n[3/7] Copying detailed docs into the book source..." -ForegroundColor Yellow
# The live guides are the ones under docs/guides/. docs/archived/ holds
# superseded material kept for provenance (commit d0fe7481 moved it there as
# stale), and publishing it as book chapters was never its purpose.
if (Test-Path "$BookSrc\guides") { Remove-Item -Recurse -Force "$BookSrc\guides" }
if (Test-Path "$BookSrc\decisions") { Remove-Item -Recurse -Force "$BookSrc\decisions" }
if (Test-Path "$BookSrc\releases") { Remove-Item -Recurse -Force "$BookSrc\releases" }
if (Test-Path "$BookSrc\operations") { Remove-Item -Recurse -Force "$BookSrc\operations" }
New-Item -ItemType Directory -Force -Path "$BookSrc\guides", "$BookSrc\decisions\archived", "$BookSrc\releases", "$BookSrc\operations" | Out-Null
Copy-Item (Join-Path $WorkspaceRoot "docs\guides\*.md") "$BookSrc\guides\" -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WorkspaceRoot "docs\decisions\*.md") "$BookSrc\decisions\" -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WorkspaceRoot "docs\decisions\archived\*.md") "$BookSrc\decisions\archived\" -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WorkspaceRoot "docs\releases\*.md") "$BookSrc\releases\" -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WorkspaceRoot "docs\operations\*.md") "$BookSrc\operations\" -ErrorAction SilentlyContinue
Write-Host "[SUCCESS] guides + ADRs + releases + operations copied into docs/src/" -ForegroundColor Green

Write-Host "`n[4/7] Copying Rust API docs into the book source..." -ForegroundColor Yellow
if (Test-Path "$BookSrc\api\rust") { Remove-Item -Recurse -Force "$BookSrc\api\rust" }
New-Item -ItemType Directory -Force -Path "$BookSrc\api\rust" | Out-Null
if (Test-Path (Join-Path $WorkspaceRoot "target\doc")) {
    Copy-Item -Recurse -Force (Join-Path $WorkspaceRoot "target\doc\*") "$BookSrc\api\rust\"
    Write-Host "[SUCCESS] rustdoc copied into docs/src/api/rust/" -ForegroundColor Green
}
else {
    Write-Host "[WARNING] target/doc missing - cargo doc failed; writing placeholder." -ForegroundColor Yellow
    Set-Content -Path "$BookSrc\api\rust\index.html" -Value '<!doctype html><meta charset="utf-8"><title>Rust API Reference</title><body style="font-family:sans-serif;padding:40px;max-width:720px"><h1>Rust API Reference</h1><p>Placeholder - run cargo doc to generate this section.</p></body>'
}
if (-not (Test-Path "$BookSrc\api\ts\index.html")) {
    New-Item -ItemType Directory -Force -Path "$BookSrc\api\ts" | Out-Null
    Set-Content -Path "$BookSrc\api\ts\index.html" -Value '<!doctype html><meta charset="utf-8"><title>TypeScript API Reference</title><body style="font-family:sans-serif;padding:40px;max-width:720px"><h1>TypeScript API Reference</h1><p>Placeholder - run typedoc to generate this section.</p></body>'
}

Write-Host "`n[5/7] Generating the sidebar (SUMMARY.md) from the copied trees..." -ForegroundColor Yellow
python3 (Join-Path $ScriptDir "gen-summary.py")
Write-Host "[SUCCESS] docs/src/SUMMARY.md generated" -ForegroundColor Green

Write-Host "`n[6/7] Building the book..." -ForegroundColor Yellow
Push-Location (Join-Path $WorkspaceRoot "docs")
try {
    $mdbookOutput = (& mdbook build 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Write-Host $mdbookOutput
        Write-Error "mdBook build failed."
        exit 1
    }
    if ($mdbookOutput -match '(?m)^\s*(WARN|ERROR)') {
        Write-Host $mdbookOutput
        Write-Error "mdBook emitted warnings/errors - fix the docs and rebuild (see output above)."
        exit 1
    }
}
finally {
    Pop-Location
}

Write-Host "`n[7/7] Verifying the portal hub..." -ForegroundColor Yellow
$PortalIndex = Join-Path $WorkspaceRoot "docs\book\index.html"
if (Test-Path $PortalIndex) {
    Write-Host "[SUCCESS] Master Documentation Hub ready at: $PortalIndex" -ForegroundColor Green
    if ($Open) {
        Write-Host "`nOpening Documentation Portal in default browser..." -ForegroundColor Cyan
        Start-Process $PortalIndex
    }
}
else {
    Write-Error "Documentation portal index.html not found at $PortalIndex"
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Documentation Build Complete!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
