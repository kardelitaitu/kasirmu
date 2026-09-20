# scripts/sync-branding.ps1 - Synchronize brand assets across Tauri and Web apps.
#
# Usage:
#   powershell -File scripts\sync-branding.ps1                     # sync default brand
#   powershell -File scripts\sync-branding.ps1 -Brand "my-tenant"  # sync whitelabel tenant
#   powershell -File scripts\sync-branding.ps1 -DryRun             # preview only
#
# This script:
#   1. Locates ImageMagick for optional .icns generation
#   2. Reads the brand's manifest.json for theme tokens and asset paths
#   3. Auto-generates icon.icns if missing (macOS format via ImageMagick + binary pack)
#   4. Copies desktop icons to apps/desktop-tauri/icons/ and apps/mobile-tauri/icons/
#   5. Copies web icons (favicons, PWA) to ui/public/
#   6. Copies vector SVGs to ui/public/branding/
#   7. Updates ui/public/site.webmanifest name/short_name (preserving formatting)
#   8. Patches tauri.conf.json productName, identifier, and window title
#   9. Generates a CSS variables file for runtime brand injection
#
# Requirements: PowerShell 7+

param(
    [string]$Brand = "default",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSCommandPath)
Set-Location ..

$BrandDir = "assets/branding/$Brand"
$ManifestPath = "$BrandDir/manifest.json"

# -- Locate ImageMagick -------------------------------------------------------
# .icns generation uses ImageMagick to create PNG tiles, then packs them
# into the Apple IconFamily binary format via a .NET BinaryWriter.

$Script:MagickPath = $null
$magickCandidates = @(
    "magick",
    "magick.exe",
    "$env:ProgramFiles/ImageMagick-*/magick.exe"
)
foreach ($candidate in $magickCandidates) {
    $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($resolved) { $Script:MagickPath = $resolved.Source; break }
    $globbed = Get-ChildItem $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($globbed) { $Script:MagickPath = $globbed.FullName; break }
}

function New-IcnsFromPng {
    <#
    .SYNOPSIS
        Generate a macOS .icns file from a source PNG.
    .DESCRIPTION
        Uses ImageMagick to create PNG tiles at all standard sizes
        (16, 32, 64, 128, 256, 512 px), then packs them into the
        Apple IconFamily binary format. Pure PowerShell - no macOS
        tools or external dependencies beyond ImageMagick.
    .PARAMETER SourcePng
        Path to the source PNG (ideally 512x512+).
    .PARAMETER OutputPath
        Destination path for the .icns file.
    #>
    param([string]$SourcePng, [string]$OutputPath)

    if (-not (Test-Path $SourcePng)) {
        Write-Host "  [WARN] Source PNG not found: $SourcePng" -ForegroundColor Yellow
        return $false
    }

    # Standard icon sizes for modern .icns (macOS 10.8+).
    # Each entry maps to a four-byte OSType code used by the Finder.
    $sizes = @(
        @{code="ic11"; size=16},
        @{code="ic12"; size=32},
        @{code="ic13"; size=64},
        @{code="ic07"; size=128},
        @{code="ic08"; size=256},
        @{code="ic09"; size=512}
    )

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "oz-icns-$([System.Guid]::NewGuid().ToString())"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

    try {
        # -- 1. Generate PNG tiles at each required size --
        $entries = @()
        foreach ($s in $sizes) {
            $pngPath = Join-Path $tempDir "$($s.code).png"
            # Local override: ImageMagick emits deprecation warnings on stderr even
            # when successful. We cannot use $ErrorActionPreference=Stop here.
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            & $Script:MagickPath convert $SourcePng -resize "$($s.size)x$($s.size)" -strip $pngPath 2>$null
            $ErrorActionPreference = $prevEap
            if ((Test-Path $pngPath)) {
                $entries += @{
                    code = $s.code
                    data = [System.IO.File]::ReadAllBytes($pngPath)
                }
            }
        }

        if ($entries.Count -eq 0) {
            Write-Host "  [WARN] Failed to generate any PNG tiles for .icns" -ForegroundColor Yellow
            return $false
        }

        # -- 2. Pack into Apple IconFamily format --
        $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create)
        $writer = [System.IO.BinaryWriter]::new($stream)
        try {
            # Magic: "icns"
            $writer.Write([byte[]]@(0x69, 0x63, 0x6E, 0x73))

            # Total file size (written last, seek back after entries)
            $sizeOffset = $stream.Position
            $writer.Write([byte[]]@(0x00, 0x00, 0x00, 0x00))  # placeholder

            foreach ($e in $entries) {
                # OSType: convert string to ASCII bytes (e.g. "ic08")
                $codeBytes = [System.Text.Encoding]::ASCII.GetBytes($e.code)
                $writer.Write($codeBytes)

                # Entry size = 8 header bytes + PNG data length (big-endian)
                $entrySize = 8 + $e.data.Length
                $sizeBytes = [System.BitConverter]::GetBytes($entrySize)
                [Array]::Reverse($sizeBytes)
                $writer.Write($sizeBytes)

                # PNG data
                $writer.Write($e.data)
            }

            # Go back and write the real total size
            $totalSize = $stream.Length
            $totalSizeBytes = [System.BitConverter]::GetBytes([int]$totalSize)
            [Array]::Reverse($totalSizeBytes)
            $stream.Seek($sizeOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
            $writer.Write($totalSizeBytes)
        }
        finally {
            $writer.Close()
            $stream.Close()
        }

        return $true
    }
    finally {
        Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
    }
}

# -- Validate brand directory ------------------------------------------------

if (-not (Test-Path $BrandDir)) {
    Write-Host "Error: Brand directory '$BrandDir' not found." -ForegroundColor Red
    Write-Host "Available brands:" -ForegroundColor Yellow
    Get-ChildItem "assets/branding/" -Directory | ForEach-Object { "  - $($_.Name)" }
    exit 1
}

if (-not (Test-Path $ManifestPath)) {
    Write-Host "Error: No manifest.json found in '$BrandDir'." -ForegroundColor Red
    exit 1
}

# -- Read manifest -----------------------------------------------------------

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$appName    = $manifest.appName
$companyName = $manifest.companyName
$brandId    = $manifest.brandId
$tokens     = $manifest.themeTokens
$assets     = $manifest.assets

Write-Host "+------------------------------------------------+" -ForegroundColor Cyan
Write-Host "| OZ-POS Brand Sync: $($brandId.PadRight(32))|" -ForegroundColor Cyan
Write-Host "| App: $($appName.PadRight(41))|" -ForegroundColor Cyan
Write-Host "+------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

function Sync-Item {
    param([string]$SourceRelative, [string]$DestAbsolute, [string]$Label)
    $src = Join-Path $BrandDir $SourceRelative
    if (-not (Test-Path $src)) {
        Write-Host "  [SKIP] $Label - source not found: $src" -ForegroundColor Yellow
        return $false
    }
    $parent = Split-Path $DestAbsolute -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    if ($DryRun) {
        Write-Host "  [DRY]  $Label -> $DestAbsolute" -ForegroundColor Magenta
    } else {
        Copy-Item -Force $src $DestAbsolute
        Write-Host "  [OK]   $Label" -ForegroundColor Green
    }
    return $true
}

# -- 1a. Auto-generate icon.icns if missing ----------------------------------

$icnsSource = "assets/source-icon.png"
$brandIcns = "$BrandDir/desktop/icon.icns"

if (-not (Test-Path $brandIcns)) {
    Write-Host ""
    Write-Host "-- .icns generation (macOS) --" -ForegroundColor White
    if ($Script:MagickPath) {
        if ($DryRun) {
            Write-Host "  [DRY]  Would generate icon.icns from $icnsSource" -ForegroundColor Magenta
        } else {
            $result = New-IcnsFromPng -SourcePng $icnsSource -OutputPath $brandIcns
            if ($result) {
                $size = (Get-Item $brandIcns).Length
                Write-Host "  [OK]   Generated icon.icns ($size bytes, $([math]::Round($size / 1024)) KB)" -ForegroundColor Green
            } else {
                Write-Host "  [SKIP] icon.icns generation failed" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  [SKIP] ImageMagick not found - cannot generate icon.icns" -ForegroundColor Yellow
        Write-Host "         Install ImageMagick or manually place icon.icns at:" -ForegroundColor Yellow
        Write-Host "         $brandIcns" -ForegroundColor Yellow
    }
} else {
    $size = (Get-Item $brandIcns).Length
    Write-Host "  [OK]   icon.icns already exists ($size bytes, $([math]::Round($size / 1024)) KB)" -ForegroundColor Green
}

# -- 1b. Desktop icons -> app icon dirs --------------------------------------

Write-Host ""
Write-Host "-- Desktop icons --" -ForegroundColor White
$desktopFiles = @(
    @{src="desktop/icon.ico";    dst1="apps/desktop-tauri/icons/icon.ico";    dst2="apps/mobile-tauri/icons/icon.ico"},
    @{src="desktop/icon.icns";   dst1="apps/desktop-tauri/icons/icon.icns";   dst2="apps/mobile-tauri/icons/icon.icns"},
    @{src="desktop/icon.png";    dst1="apps/desktop-tauri/icons/icon.png";    dst2="apps/mobile-tauri/icons/icon.png"},
    @{src="desktop/32x32.png";   dst1="apps/desktop-tauri/icons/32x32.png";   dst2="apps/mobile-tauri/icons/32x32.png"},
    @{src="desktop/64x64.png";   dst1="apps/desktop-tauri/icons/64x64.png";   dst2="apps/mobile-tauri/icons/64x64.png"},
    @{src="desktop/128x128.png"; dst1="apps/desktop-tauri/icons/128x128.png"; dst2="apps/mobile-tauri/icons/128x128.png"},
    @{src="desktop/256x256.png"; dst1="apps/desktop-tauri/icons/256x256.png"; dst2="apps/mobile-tauri/icons/256x256.png"}
)

foreach ($f in $desktopFiles) {
    if (Test-Path (Join-Path $BrandDir $f.src)) {
        Sync-Item $f.src $f.dst1 "$($f.src) -> desktop"
        Sync-Item $f.src $f.dst2 "$($f.src) -> tablet"
    }
}

# 256x256 doubles as @2x
if (Test-Path "$BrandDir/desktop/256x256.png") {
    if (-not $DryRun) {
        Copy-Item -Force "$BrandDir/desktop/256x256.png" "apps/desktop-tauri/icons/128x128@2x.png"
        Copy-Item -Force "$BrandDir/desktop/256x256.png" "apps/mobile-tauri/icons/128x128@2x.png"
    }
    Write-Host "  [OK]   256x256 -> 128x128@2x.png (both apps)" -ForegroundColor Green
}

# -- 2. Web icons -> ui/public/ ----------------------------------------------

Write-Host ""
Write-Host "-- Web & PWA icons --" -ForegroundColor White
$webDir = Join-Path $BrandDir "web"
if (Test-Path $webDir) {
    if ($DryRun) {
        Get-ChildItem $webDir | ForEach-Object {
            Write-Host "  [DRY]  web/$($_.Name) -> ui/public/$($_.Name)" -ForegroundColor Magenta
        }
    } else {
        Copy-Item -Force -Recurse "$webDir/*" "ui/public/"
    }
    Write-Host "  [OK]   Copied web icons to ui/public/" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] No web/ directory" -ForegroundColor Yellow
}

# -- 3. Vector SVGs -> ui/public/branding/ -----------------------------------

Write-Host ""
Write-Host "-- Vector logos --" -ForegroundColor White
$vectorDir = Join-Path $BrandDir "vector"
if (Test-Path $vectorDir) {
    $targetBrandDir = "ui/public/branding"
    if (-not (Test-Path $targetBrandDir)) {
        if (-not $DryRun) {
            New-Item -ItemType Directory -Force -Path $targetBrandDir | Out-Null
        }
    }
    if ($DryRun) {
        Get-ChildItem "$vectorDir/*.svg" | ForEach-Object {
            Write-Host "  [DRY]  vector/$($_.Name) -> ui/public/branding/$($_.Name)" -ForegroundColor Magenta
        }
    } else {
        Copy-Item -Force "$vectorDir/*.svg" "$targetBrandDir/"
    }
    Write-Host "  [OK]   Copied vector SVGs to ui/public/branding/" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] No vector/ directory" -ForegroundColor Yellow
}

# -- 4. Update ui/public/site.webmanifest (targeted, no reformat) ------------

Write-Host ""
Write-Host "-- Web manifest --" -ForegroundColor White
$webManifestPath = "ui/public/site.webmanifest"
if (Test-Path $webManifestPath) {
    if (-not $DryRun) {
        $raw = Get-Content $webManifestPath -Raw
        $raw = $raw -replace '(?<="name":\s*)"[^"]*"', "`"$appName`""
        $raw = $raw -replace '(?<="short_name":\s*)"[^"]*"', "`"$appName`""
        [IO.File]::WriteAllText((Resolve-Path $webManifestPath), $raw)
    }
    Write-Host "  [OK]   Updated site.webmanifest name -> '$appName'" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] No site.webmanifest found" -ForegroundColor Yellow
}

# -- 5. Patch tauri.conf.json -------------------------------------------------

$safeId = $brandId -replace '[^a-zA-Z0-9.-]', '-'

Write-Host ""
Write-Host "-- Tauri config (desktop) --" -ForegroundColor White
$tauriConfigPath = "apps/desktop-tauri/tauri.conf.json"
if (Test-Path $tauriConfigPath) {
    $desktopId = if ($brandId -eq "default") { "mu.kasir.app" } else { "mu.kasir.$safeId" }
    if (-not $DryRun) {
        $raw = Get-Content $tauriConfigPath -Raw
        $raw = $raw -replace '(?<="productName":\s*)"[^"]*"', "`"$appName`""
        $raw = $raw -replace '(?<="identifier":\s*)"[^"]*"', "`"$desktopId`""
        $raw = $raw -replace '(?<="title":\s*)"[^"]*"', "`"$appName`""
        [IO.File]::WriteAllText((Resolve-Path $tauriConfigPath), $raw)
    }
    Write-Host "  [OK]   Patched desktop tauri.conf.json (name='$appName', id='$desktopId')" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] No desktop tauri.conf.json" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "-- Tauri config (tablet) --" -ForegroundColor White
$tabletConfigPath = "apps/mobile-tauri/tauri.conf.json"
if (Test-Path $tabletConfigPath) {
    $tabletId = if ($brandId -eq "default") { "mu.kasir.mobile" } else { "mu.kasir.mobile.$safeId" }
    if (-not $DryRun) {
        $raw = Get-Content $tabletConfigPath -Raw
        $raw = $raw -replace '(?<="productName":\s*)"[^"]*"', "`"$appName`""
        $raw = $raw -replace '(?<="identifier":\s*)"[^"]*"', "`"$tabletId`""
        [IO.File]::WriteAllText((Resolve-Path $tabletConfigPath), $raw)
    }
    Write-Host "  [OK]   Patched tablet tauri.conf.json (name='$appName', id='$tabletId')" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] No tablet tauri.conf.json" -ForegroundColor Yellow
}

# -- 6. Generate runtime brand CSS variables ---------------------------------

Write-Host ""
Write-Host "-- Brand CSS tokens --" -ForegroundColor White
$brandCssTarget = "ui/src/features/design/brand-tokens.css"
# The three text tokens below are quoted differently ON PURPOSE, and what
# decides it is the shape of the VALUE, not the identity of the token:
#   --brand-font-family : a font-family stack -- a COMMA-SEPARATED LIST of
#       families, each already quoted inside the manifest value when it needs
#       it (acme-tenant ships '"DM Sans", "Inter", sans-serif'). CSS has to see
#       the list, so this one is emitted raw. Wrapping a list in a single pair
#       of quotes collapses it into one family named "Inter, sans-serif", which
#       no engine has, and the generic sans-serif entry goes with it.
#   --brand-app-name    : genuinely ONE string, read from content: and title
#       contexts where CSS requires a quoted value -- keeps its apostrophes.
#   --brand-company     : same shape, same reason.
# The hsl() pair needs neither: the function call carries its own syntax.
$cssContent = @"
/* Auto-generated by scripts/sync-branding.ps1 - DO NOT EDIT BY HAND */
/* Brand: $brandId - $appName */
/* Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') */

:root {
  --brand-primary: hsl($($tokens.primaryHsl));
  --brand-accent:  hsl($($tokens.accentHsl));
  --brand-font-family: $($tokens.fontFamily);
  --brand-app-name: '$appName';
  --brand-company: '$companyName';
}
"@

if (-not $DryRun) {
    $cssDir = Split-Path $brandCssTarget -Parent
    if (-not (Test-Path $cssDir)) {
        New-Item -ItemType Directory -Force -Path $cssDir | Out-Null
    }
    [IO.File]::WriteAllText((Resolve-Path $brandCssTarget), $cssContent)
}
Write-Host "  [OK]   Generated $brandCssTarget" -ForegroundColor Green

# -- 7. Ensure hardware/ directory has a README ------------------------------

Write-Host ""
Write-Host "-- Hardware assets --" -ForegroundColor White
$hardwareReadmePath = "assets/branding/$brandId/hardware/README.md"
if (-not (Test-Path $hardwareReadmePath) -and -not $DryRun) {
    # The closing fence of the fenced block below is written with SIX backticks on
    # purpose. Inside a double-quoted here-string a backtick is the escape
    # character, so a fence of three backticks immediately followed by a newline
    # escapes that newline as a line continuation. The `"@` terminator then no
    # longer sits at the start of a line and the ENTIRE SCRIPT fails to parse with
    # TerminatorExpectedAtEndOfString -- which is what happened between this block
    # landing and 2026-09-19, while `.gitattributes` pins the working tree to LF.
    # Six backticks emit three literal backticks and leave the newline intact, so
    # the generated README is byte-identical. Do not "tidy" this back to three.
    $readmeContent = @"
# Hardware Assets - $appName ($brandId)

This directory holds specialized bitmap assets for thermal receipt printers
and invoice watermarks. These are generated from the master source icon
(assets/source-icon.png) via the whitelabel pipeline.

## Expected files

| File | Description | Spec |
|------|-------------|------|
| receipt-logo-58mm.png | 1-bit monochrome bitmap for 58mm thermal printers | 384x100 px |
| receipt-logo-80mm.png | 1-bit monochrome bitmap for 80mm thermal printers | 576x150 px |
| invoice-watermark.png | Subtle watermark for backend PDF invoices | 512x512 px |

## Generation

To generate receipt bitmaps from the master source icon:

```powershell
# Requires ImageMagick
magick convert assets/source-icon.png -resize 384x100! -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-58mm.png
magick convert assets/source-icon.png -resize 576x150! -threshold 50% assets/branding/%brandId%/hardware/receipt-logo-80mm.png
``````
"@
    New-Item -ItemType Directory -Force -Path (Split-Path $hardwareReadmePath -Parent) | Out-Null
    Set-Content -Path $hardwareReadmePath -Value $readmeContent -Encoding UTF8
    Write-Host "  [OK]   Created hardware/README.md with generation instructions" -ForegroundColor Green
} elseif (Test-Path $hardwareReadmePath) {
    Write-Host "  [OK]   hardware/README.md already exists" -ForegroundColor Green
} else {
    Write-Host "  [SKIP] Dry run - would create hardware/README.md" -ForegroundColor Yellow
}

# -- Summary -----------------------------------------------------------------

Write-Host ""
Write-Host "+------------------------------------------------+" -ForegroundColor Cyan
Write-Host " Brand sync complete! ($brandId)" -ForegroundColor Cyan
Write-Host "+------------------------------------------------+" -ForegroundColor Cyan
