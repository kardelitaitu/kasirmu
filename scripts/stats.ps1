# scripts/stats.ps1 — Scans the codebase to generate stats.json for badges/shields.io
#
# The badge answers "how big is this repository", so the scan covers every
# hand-written source language, not only the compiled ones — see the
# $extToLanguage map for what is in scope and what is deliberately out.
# Generated output (dist trees, node_modules, target) is excluded.
#
# Usage: powershell -File scripts/stats.ps1

$ErrorActionPreference = "Stop"

# Get project root (parent of scripts directory)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Excluded directory names/patterns.
#
# Build outputs are matched by PREFIX, not by the literal name "dist": this
# repo also builds into ui/dist-mobile, which a bare "dist" entry never caught
# (the matcher requires a backslash on both sides of the name). That bug was
# live for css before .js/.mjs were added, and adding them is what made it
# visible — 150 minified files were about to be reported as "javascript".
# The prefix match below is what keeps generated bundles out of the counts.
$excludeDirs = @(
    ".git",
    "node_modules",
    "target",
    "dist",
    "dist-*",
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

# File extensions to scan and map to language labels.
#
# Scope: everything that is written and maintained by hand as source. The
# badge's job is "how big is this repository", so a language that is present
# and hand-written belongs here even when it is not compiled — omitting .md
# meant ~378 markdown files of real documentation contributed nothing.
#
# Deliberately still out: .json/.toml (configuration, largely generated),
# .svg/.png/.ico/.woff2 (binary or asset), and lock files. Adding those would
# inflate the badge without saying anything about the codebase.
#
# .py is counted because the gate scripts under scripts/ are real maintained
# source, not glue; .sh/.ps1 likewise, since several of them are load-bearing
# CI and release paths.
$extToLanguage = @{
    ".rs"    = "rust"
    ".ts"    = "typescript"
    ".tsx"   = "typescript"
    ".go"    = "go"
    ".css"   = "css"
    ".html"  = "html"
    ".sql"   = "sql"
    ".md"    = "markdown"
    ".py"    = "python"
    ".js"    = "javascript"
    ".mjs"   = "javascript"
    ".astro" = "astro"
    ".ftl"   = "fluent"
    ".sh"    = "shell"
    ".ps1"   = "powershell"
}

# An ORDERED map, built from the sorted language list. A plain hashtable
# iterates in an unspecified order, so two runs over an unchanged tree emitted
# the same numbers in a different sequence — a spurious diff every time, and a
# diff is exactly what a reviewer uses to decide whether anything changed.
$langStats = [ordered]@{}
foreach ($lang in ($extToLanguage.Values | Sort-Object -Unique)) {
    # The inner map is ordered too: a plain @{} still let ConvertTo-Json emit
    # `lines` before `files` on one run and the reverse on the next, so the
    # file's bytes changed while its contents did not.
    $langStats[$lang] = [ordered]@{ files = 0; lines = 0 }
}

$totalFiles = 0
$totalLines = 0

# Helper to check if a path should be excluded.
#
# Split into PATH SEGMENTS and compare whole segments, rather than wrapping the
# name in wildcards. The old form ("*\$dir\*") required a backslash on both
# sides, so it matched an exact directory name and nothing else: `dist` caught
# ui/dist but not ui/dist-mobile, and a name like `dist-*` matched nothing at
# all because the wildcard was inside a literal. Segment comparison states the
# rule the list was always trying to express — "no directory of this name
# anywhere in the path" — and a prefix entry like `dist-*` then works.
$excludeDirGlobs = $excludeDirs | ForEach-Object { $_ }

function Test-DirNameExcluded($name) {
    foreach ($glob in $excludeDirGlobs) {
        if ($name -like $glob) { return $true }
    }
    return $false
}

function IsExcluded($path) {
    $rel = $path.Substring($projectRoot.Length).TrimStart('\')
    # Any directory segment anywhere in the path (never the file name itself).
    $segments = $rel.Split('\')
    for ($i = 0; $i -lt $segments.Length - 1; $i++) {
        if (Test-DirNameExcluded $segments[$i]) { return $true }
    }
    # A dot-prefixed FILE at the repo root is scratch: editor swaps, .tmp-*
    # probes, one-off migration scripts. They are untracked, appear and vanish
    # between runs, and made this script's own output nondeterministic (two
    # back-to-back runs disagreed because an agent wrote .tmp-cat.py mid-scan).
    # Dot-directories are already covered by the segment loop above.
    $leaf = $segments[$segments.Length - 1]
    if ($leaf.StartsWith('.') -and $leaf -ne '.') { return $true }
    foreach ($p in $excludePaths) {
        if ($rel -like "$p\*" -or $rel -eq $p) {
            return $true
        }
    }
    return $false
}

# Scan directory recursively. No Get-Unique needed — Get-ChildItem -File
# never returns duplicates for distinct file paths on disk.
#
# Sorted so the walk order is fixed: the totals do not depend on it, but a
# stable order keeps the run reproducible if a per-file state is ever added.
Get-ChildItem -Path $projectRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
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
