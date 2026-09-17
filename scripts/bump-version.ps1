<#
.SYNOPSIS
    Automates version bumping across the entire OZ-POS codebase.

.DESCRIPTION
    This script finds all occurrences of the current codebase version (read dynamically from Cargo.toml)
    across Rust Cargo config files, Tauri app config files, UI packages, Fluent statusbar labels,
    the website package + i18n strings, health route tests, React status/footer views, the Docker
    cache-priming manifests, and the version-lock lines in the AGENTS.md mirrors, and updates them
    to the target version.
    It then automatically refreshes the package lockfiles (Cargo.lock and the ui/ + website/ package-lock.json files).
    It also inserts the "## [X.Y.Z] - date" heading into the canonical CHANGELOG.md so the
    AUDIT-28 release version gate (scripts/check-release-version.mjs) passes when the tag is
    created.

.PARAMETER TargetVersion
    The new version number to bump the codebase to (e.g., "0.0.6").
    Must be MAJOR.MINOR.PATCH and newer than the current version - the script
    refuses to bump backwards.

.PARAMETER DryRun
    Preview mode: probes every pattern and reports what would change without
    writing anything, refreshing lockfiles, or running the release gate.
    Exits non-zero if any pattern would fail to match.

.EXAMPLE
    powershell -File scripts\bump-version.ps1 "0.0.6"
    (Run this command from the project root workspace directory)

.EXAMPLE
    powershell -File scripts\bump-version.ps1 "0.0.6" -DryRun
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]  # PS 5.1 has no ErrorMessage on ValidatePattern; the default message shows the expected MAJOR.MINOR.PATCH shape
    [string]$TargetVersion,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Ensure we are in workspace root
Set-Location (Split-Path -Parent $PSCommandPath)
Set-Location ..

# 1. Read current version from Cargo.toml
$cargoTomlPath = "Cargo.toml"
if (-not (Test-Path $cargoTomlPath)) {
    Write-Error "Could not find Cargo.toml in workspace root."
}
$cargoToml = [System.IO.File]::ReadAllText($cargoTomlPath, (New-Object System.Text.UTF8Encoding($false)))
$currentVersion = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value

if (-not $currentVersion) {
    Write-Error "Could not parse current version from Cargo.toml."
}

Write-Host "Current version detected: $currentVersion"
Write-Host "Target version: $TargetVersion"

if ($currentVersion -eq $TargetVersion) {
    Write-Host "Version is already at $TargetVersion. No changes needed."
    exit 0
}

# Refuse to bump backwards: a release version must never go down.
function Test-NewerVersion {
    param([string]$Current, [string]$Target)
    $c = $Current -split '\.' | ForEach-Object { [int]$_ }
    $t = $Target -split '\.' | ForEach-Object { [int]$_ }
    for ($i = 0; $i -lt 3; $i++) {
        if ($t[$i] -gt $c[$i]) { return $true }
        if ($t[$i] -lt $c[$i]) { return $false }
    }
    return $false
}
if (-not (Test-NewerVersion $currentVersion $TargetVersion)) {
    Write-Error "Target version $TargetVersion is not newer than current $currentVersion - refusing to bump backwards."
}

# Failure accounting: any pattern that does not match (or a missing target file)
# is recorded here and FAILS the bump at the end. A silent skip is how AGENTS.md
# drifted in 0.0.26 and how the StatusBar label rotted at 0.0.25 for two
# releases - so a skip is now a hard error, never a warning.
$script:BumpFailures = New-Object System.Collections.Generic.List[string]
# Every file the bump owns, collected so the post-bump sweep can prove the old
# version is gone from all of them.
$script:BumpTargets = New-Object System.Collections.Generic.List[string]

# Helper function to do safe string replacement in a file
function Update-File {
    param(
        [string]$Path,
        [string]$OldString,
        [string]$NewString
    )
    # UTF-8 read/write: the files are BOM-less UTF-8, but Windows PowerShell 5.1
    # defaults to ANSI (cp1252), which mangles non-ASCII (em-dashes in i18n
    # strings and CHANGELOG headings) on read and writes mojibake on write.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    if (-not (Test-Path $Path)) {
        $script:BumpFailures.Add("MISSING FILE: $Path")
        Write-Host "MISSING FILE: $Path" -ForegroundColor Red
        return
    }
    $script:BumpTargets.Add((Resolve-Path $Path).Path)
    $content = [System.IO.File]::ReadAllText($Path, $utf8)
    if (-not $content.Contains($OldString)) {
        $script:BumpFailures.Add("NO MATCH in $Path (expected pattern: $OldString)")
        Write-Host "NO MATCH in $Path" -ForegroundColor Red
        return
    }
    if ($DryRun) {
        Write-Host "WOULD UPDATE: $Path"
    } else {
        $updated = $content.Replace($OldString, $NewString)
        [System.IO.File]::WriteAllText($Path, $updated, $utf8)
        Write-Host "Updated: $Path"
    }
}

# 2. Update version strings in all codebase files
Write-Host "`nUpdating version strings..." -ForegroundColor Cyan

# NOTE: the Markdown backticks around the version must be DOUBLED in the
# PowerShell string - a single backtick escapes the `$` and renders a
# literal "$currentVersion", so the pattern would never match and the file
# would be silently skipped (it happened for 0.0.26).
# AGENTS.md version-lock line is a table row in the current repo format (it used
# to be a bullet). The audit stamp at the top of the file also carries the locked version.
Update-File "AGENTS.md" "| **Version Lock** | **Version is locked at ``$currentVersion``. NEVER modify version numbers.** | Do not bump version in ``Cargo.toml``, ``package.json``, ``tauri.conf.json``, etc. |" "| **Version Lock** | **Version is locked at ``$TargetVersion``. NEVER modify version numbers.** | Do not bump version in ``Cargo.toml``, ``package.json``, ``tauri.conf.json``, etc. |"
Update-File "AGENTS.md" "version lock: $currentVersion" "version lock: $TargetVersion"
# .agents/AGENTS.md mirrors the table-row format and audit stamp of the root AGENTS.md.
Update-File ".agents/AGENTS.md" "| **Version Lock** | **Version is locked at ``$currentVersion``. NEVER modify version numbers.** | Do not bump version in ``Cargo.toml``, ``package.json``, ``tauri.conf.json``, etc. |" "| **Version Lock** | **Version is locked at ``$TargetVersion``. NEVER modify version numbers.** | Do not bump version in ``Cargo.toml``, ``package.json``, ``tauri.conf.json``, etc. |"
Update-File ".agents/AGENTS.md" "version lock: $currentVersion" "version lock: $TargetVersion"
Update-File "Cargo.toml" "version = `"$currentVersion`"" "version = `"$TargetVersion`""
Update-File "ops/docker/Dockerfile.server" "version = `"$currentVersion`"" "version = `"$TargetVersion`""
Update-File "apps/desktop-tauri/tauri.conf.json" "`"version`": `"$currentVersion`"," "`"version`": `"$TargetVersion`","
Update-File "apps/mobile-tauri/tauri.conf.json" "`"version`": `"$currentVersion`"," "`"version`": `"$TargetVersion`","
Update-File "ui/package.json" "`"version`": `"$currentVersion`"," "`"version`": `"$TargetVersion`","
Update-File "ui/package-lock.json" "`"version`": `"$currentVersion`"," "`"version`": `"$TargetVersion`","

# NOTE: data.rs and health.rs (both clients) now use env!("CARGO_PKG_VERSION")
# instead of hardcoded version strings, so they are automatically correct once
# Cargo.toml is bumped above. No per-file updates needed.

# The license-server is Go, so it has no CARGO_PKG_VERSION equivalent and its
# admin health endpoint reports a literal. It was missed by this script for a
# whole release cycle: admin_dashboard.go said 0.0.34 while the repo moved to
# 0.0.36, and the test that claims to be "the bump reminder" asserted the const
# equals itself, so it stayed green. Bumped here AND pinned against Cargo.toml
# by TestAdminHealthB31, which is the check that actually can fail.
Update-File "apps/license-server/admin_dashboard.go" "const adminDashboardVersion = `"$currentVersion`"" "const adminDashboardVersion = `"$TargetVersion`""

Update-File "ui/src/features/auth/LicenseActivationScreen.tsx" ("useState<string>('{0}')" -f $currentVersion) ("useState<string>('{0}')" -f $TargetVersion)
Update-File "ui/src/features/auth/StaffLoginScreen.tsx" "v$currentVersion" "v$TargetVersion"
Update-File "ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx" "Version $currentVersion" "Version $TargetVersion"
Update-File "ui/src/features/design/TooltipPreview.tsx" "OZ-POS v$currentVersion" "OZ-POS v$TargetVersion"

# The status-bar version label lives in Fluent, not TSX (StatusBar.tsx renders the
# `statusbar-version` key), so the FTL files are the real bump targets.
Update-File "shared-ui/locales/shared.ftl" "statusbar-version = v$currentVersion" "statusbar-version = v$TargetVersion"
Update-File "shared-ui/locales/shared.id.ftl" "statusbar-version = v$currentVersion" "statusbar-version = v$TargetVersion"

# Website (marketing site): package version + i18n version strings. Single-quoted
# format strings keep the em-dash out of the source; it is injected via [char]0x2014.
# Website app version is tracked independently (it can lag the Cargo version,
# e.g. 0.0.32 while Cargo is 0.0.33), so read its real current value instead of
# assuming $currentVersion. The bump still targets $TargetVersion.
$websitePkgPath = "website/package.json"
if (Test-Path $websitePkgPath) {
    $websiteVersion = [regex]::Match([System.IO.File]::ReadAllText($websitePkgPath, (New-Object System.Text.UTF8Encoding($false))), '(?m)"version"\s*:\s*"([^"]+)"').Groups[1].Value
} else { $websiteVersion = $currentVersion }

Update-File "website/package.json" "`"version`": `"$websiteVersion`"," "`"version`": `"$TargetVersion`","
Update-File "website/package-lock.json" "`"version`": `"$websiteVersion`"," "`"version`": `"$TargetVersion`","
Update-File "website/src/i18n/en.json" ('"versionValue": "{0}"' -f $currentVersion) ('"versionValue": "{0}"' -f $TargetVersion)
Update-File "website/src/i18n/en.json" ('"subtitle": "Version {0} {1} free forever, no signup required."' -f $currentVersion, [char]0x2014) ('"subtitle": "Version {0} {1} free forever, no signup required."' -f $TargetVersion, [char]0x2014)
Update-File "website/src/i18n/id.json" ('"versionValue": "{0}"' -f $currentVersion) ('"versionValue": "{0}"' -f $TargetVersion)
Update-File "website/src/i18n/id.json" ('"subtitle": "Versi {0} {1} gratis selamanya, tanpa pendaftaran."' -f $currentVersion, [char]0x2014) ('"subtitle": "Versi {0} {1} gratis selamanya, tanpa pendaftaran."' -f $TargetVersion, [char]0x2014)

# ops/docker/Dockerfile.unified carries the same cache-priming manifests as ops/docker/Dockerfile.server.
Update-File "ops/docker/Dockerfile.unified" "version = `"$currentVersion`"" "version = `"$TargetVersion`""

# .prime/AGENTS.md used to be synced here. The .prime/ tree (a third rules mirror and
# a Python codebase-memory wrapper) was deleted on 08-09-26; verify-agents-mirrors.py
# now expects exactly two mirrors and will fail if a third reappears unannounced.

# README's "Latest release" claim (prose, updated per release).
Update-File "README.md" "Latest release: **v$currentVersion** (on branch ``$currentVersion``)." "Latest release: **v$TargetVersion** (on branch ``$TargetVersion``)."

# 2b. Sync canonical CHANGELOG.md heading (RELEASE-07)
Write-Host "`nSyncing CHANGELOG.md heading..." -ForegroundColor Cyan
$changelogPath = "CHANGELOG.md"
if (-not (Test-Path $changelogPath)) {
    $script:BumpFailures.Add("MISSING FILE: $changelogPath")
    Write-Host "MISSING FILE: $changelogPath" -ForegroundColor Red
} else {
    $content = [System.IO.File]::ReadAllText($changelogPath, (New-Object System.Text.UTF8Encoding($false)))
    $date = Get-Date -Format "yyyy-MM-dd"
    # Build the em-dash via [char] so the script source stays pure-ASCII; the
    # heading is written as proper UTF-8 by the UTF-8 writer below (previously
    # PowerShell 5.1's ANSI Set-Content emitted a cp1252 0x97 byte instead).
    $heading = "## [$TargetVersion] $([char]0x2014) $date"
    $headingRe = "(?m)^## \[${TargetVersion}\]"
    if ($content -match $headingRe) {
        Write-Host "Skipped (heading already present): $changelogPath" -ForegroundColor Yellow
    } else {
        # Insert the new heading right after the intro block (before the first "## [").
        $insertAfter = [regex]::Match($content, "(?m)^## \[")
        if (-not $insertAfter.Success) {
            $script:BumpFailures.Add("CHANGELOG.md has no '## [' heading to anchor the new entry - the format changed?")
            Write-Host "CHANGELOG.md has no '## [' heading to anchor the new entry" -ForegroundColor Red
        } elseif ($DryRun) {
            Write-Host "WOULD INSERT: $changelogPath ($heading)"
        } else {
            $block = "$heading`r`n`r`nRelease notes: see docs/releases/CHANGELOG-$TargetVersion.md (reviewed before tagging).`r`n`r`n---`r`n`r`n"
            $updated = $content.Substring(0, $insertAfter.Index) + $block + $content.Substring($insertAfter.Index)
            [System.IO.File]::WriteAllText($changelogPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "Updated: $changelogPath (inserted $heading)"
        }
    }
}

# 2c. Fail fast: a bump with any unresolved pattern is a broken bump, and the
# lockfile refresh / release gate must not run on one. This check is mode-
# agnostic, so a dry run with problems also exits non-zero.
if ($script:BumpFailures.Count -gt 0) {
    Write-Host "`nBUMP FAILED - $($script:BumpFailures.Count) problem(s):" -ForegroundColor Red
    foreach ($f in $script:BumpFailures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
Write-Host "All $($script:BumpTargets.Count) version-string patterns resolved."

# 3. Refresh Lockfiles (skipped in dry-run)
Write-Host "`nUpdating lockfiles..." -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "Dry run - skipping lockfile refresh."
} else {
    # Cargo.lock
    Write-Host "Running cargo check to update Cargo.lock..."
    & cargo check
    if ($LASTEXITCODE -ne 0) {
        Write-Error "cargo check failed while updating Cargo.lock."
    }

    # ui/package-lock.json
    if (Test-Path "ui") {
        Push-Location ui
        Write-Host "Running npm install --package-lock-only to sync package-lock.json..."
        & npm install --package-lock-only --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed while syncing ui/package-lock.json."
        }
        Pop-Location
    }

    # website/package-lock.json
    if (Test-Path "website") {
        Push-Location website
        Write-Host "Running npm install --package-lock-only to sync website/package-lock.json..."
        & npm install --package-lock-only --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed while syncing website/package-lock.json."
        }
        Pop-Location
    }
}

# 4. Post-bump verification (real mode only): prove the old version is gone from
# every owned file, then run the canonical release version gate (AUDIT-28) as the
# final word - the script has always claimed to satisfy that gate, now it proves it.
if (-not $DryRun) {
    Write-Host "`nVerifying the bump..." -ForegroundColor Cyan
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $stale = 0
    foreach ($target in $script:BumpTargets) {
        # Audit-stamp HTML comments record historical version moves (e.g. the
        # README "footer version 0.0.25 -> 0.0.33" line) and are NOT live
        # version references, so strip comments before the stale check or the
        # gate would wrongly fail on a record of the previous bump.
        $raw = [System.IO.File]::ReadAllText($target, $utf8)
        $stripped = [regex]::Replace($raw, '<!--.*?-->', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($target.EndsWith(".md")) {
            # In markdown documents (AGENTS.md, README.md, etc.), historical release
            # notes and changelog references (e.g. "missing until 0.0.36", "added in 0.0.36")
            # are legitimate prose. Only check that the version lock or release claim
            # does not contain the stale version.
            if ($stripped -match "(?m)^\s*\|\s*\*\*Version Lock\*\*\s*\|\s*\*\*Version is locked at `$?$currentVersion`?\.|\bLatest release:\s*\*\*v$currentVersion\*\*|- \*\*Version is locked at the current release \(`?$currentVersion`?\)") {
                Write-Host "STALE: $target still contains $currentVersion lock" -ForegroundColor Red
                $stale++
            }
        } else {
            if ($stripped.Contains($currentVersion)) {
                Write-Host "STALE: $target still contains $currentVersion" -ForegroundColor Red
                $stale++
            }
        }
    }
    if ($stale -gt 0) {
        Write-Error "$stale file(s) still contain the old version $currentVersion - the bump is incomplete."
    }
    Write-Host "No stale $currentVersion references in $($script:BumpTargets.Count) owned file(s)."

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error "node is not on PATH - cannot run the release version gate (scripts/check-release-version.mjs)."
    }
    Write-Host "Running release version gate: node scripts/check-release-version.mjs $TargetVersion"
    & node scripts/check-release-version.mjs $TargetVersion
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Release version gate FAILED - the bump is inconsistent."
    }
}

if ($DryRun) {
    Write-Host "`nDRY RUN COMPLETE - no files were modified." -ForegroundColor Green
} else {
    Write-Host "`nVersion successfully bumped from $currentVersion to $TargetVersion!" -ForegroundColor Green
}
