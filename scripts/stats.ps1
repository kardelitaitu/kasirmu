# scripts/stats.ps1 — Scans the codebase to generate stats.json for badges/shields.io
#
# Usage: powershell -File scripts/stats.ps1

$ErrorActionPreference = "Stop"

# Get project root (parent of scripts directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Excluded directory names/patterns
$excludeDirs = @(
    ".git",
    "node_modules",
    "target",
    "dist",
    ".agents",
    ".github",
    ".idea",
    ".vscode",
    "tmp",
    "coverage",
    "pb_data",
    "gen"
)

# Generated documentation output, excluded by repo-relative path prefix (the
# name-based list above can't express these without also dropping real source:
# "api" would match crates/kasirmu-api and ui/src/api). These trees are rebuilt by
# scripts/build-docs.sh and .gitignore'd — counting them made the badge report
# ~1.16M lines of mdBook/TypeDoc HTML instead of source.
$excludePaths = @(
    "docs\book",
    "docs\src\api",
    "website\public\docs-portal",
    "website\public\dev"
)

# File extensions to scan and map to language labels
$extToLanguage = @{
    ".rs"   = "rust"
    ".ts"   = "typescript"
    ".tsx"  = "typescript"
    ".go"   = "go"
    ".css"  = "css"
    ".html" = "html"
    ".sql"  = "sql"
}

$langStats = @{}
foreach ($lang in $extToLanguage.Values) {
    if (!$langStats.ContainsKey($lang)) {
        $langStats[$lang] = @{ files = 0; lines = 0 }
    }
}

$totalFiles = 0
$totalLines = 0

# Helper to check if a path should be excluded
function IsExcluded($path) {
    foreach ($dir in $excludeDirs) {
        if ($path -like "*\$dir\*" -or $path -like "*\$dir") {
            return $true
        }
    }
    $rel = $path.Substring($projectRoot.Length).TrimStart('\')
    foreach ($p in $excludePaths) {
        if ($rel -like "$p\*" -or $rel -eq $p) {
            return $true
        }
    }
    return $false
}

# Scan directory recursively. No Get-Unique needed — Get-ChildItem -File
# never returns duplicates for distinct file paths on disk.
Get-ChildItem -Path $projectRoot -File -Recurse | ForEach-Object {
    $file = $_
    $ext = $file.Extension.ToLower()
    
    if ($extToLanguage.ContainsKey($ext)) {
        if (-not (IsExcluded $file.FullName)) {
            $lang = $extToLanguage[$ext]
            
            # Count lines safely (handles empty files and encoding)
            $lineCount = 0
            if ($file.Length -gt 0) {
                # Get-Content -Raw counts lines by counting newlines
                $content = Get-Content -Path $file.FullName -ErrorAction SilentlyContinue
                if ($content) {
                    $lineCount = $content.Count
                }
            }
            
            $langStats[$lang].files += 1
            $langStats[$lang].lines += $lineCount
            
            $totalFiles += 1
            $totalLines += $lineCount
        }
    }
}

# Format totals in K (thousands) if large
$messageStr = "{0:N0} lines" -f $totalLines
if ($totalLines -ge 1000) {
    $messageStr = "{0:N1}k lines" -f ($totalLines / 1000)
}

# Create shields.io endpoint structure + detailed stats
$report = [ordered]@{
    schemaVersion = 1
    label         = "code size"
    message       = $messageStr
    color         = "blue"
    stats         = [ordered]@{
        totalLines = $totalLines
        totalFiles = $totalFiles
        languages  = $langStats
    }
}

# The badge file is committed at the REPO ROOT (README reads /stats.json).
# This used to write into scripts/, so the root copy silently froze at its
# 2026-07-18 value while every `scripts/check.ps1` run left an untracked
# scripts/stats.json behind.
$outputPath = Join-Path $projectRoot "stats.json"
$report | ConvertTo-Json -Depth 4 | Out-File -FilePath $outputPath -Encoding utf8

Write-Host "Generated stats.json at $outputPath (Total lines: $totalLines, Files: $totalFiles)"
