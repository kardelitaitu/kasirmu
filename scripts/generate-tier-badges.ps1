# scripts/generate-tier-badges.ps1 - Subscription tier badge generator.
#
# Usage:
#   powershell -File scripts\generate-tier-badges.ps1                 # SVG + PNG @1x/2x/3x
#   powershell -File scripts\generate-tier-badges.ps1 -Scales 1,2,3,4
#   powershell -File scripts\generate-tier-badges.ps1 -SvgOnly
#
# The five subscription tiers are defined by TIER_LEVEL in
# ui/src/utils/tierLevel.ts and do NOT vary per tenant, so this lives outside
# assets/branding/ (whose every subdirectory is a whitelabel brand with a
# manifest.json).
#
# One source of truth: the palettes and geometry below generate every SVG, and
# every PNG is rasterised from that SVG. Edit here, never a copy.
#
# Text is emitted as OUTLINED PATHS, not <text>. That is deliberate: it bakes
# the weight in and removes the font dependency, so a badge rasterises
# identically on a machine with no Inter installed. The outlines come from
# Inter Bold instantiated out of the variable font the UI already ships.
#
# Requirements: PowerShell 7+, Python 3 + fontTools, ImageMagick (for PNG).

param(
    [string]$OutDir = "assets/tier-badges",
    # A [int[]] here is a trap: `-File script.ps1 -Scales 1,2,4` passes the
    # literal string 1,2,4 which PowerShell coerces to the single int 124.
    # Taking a string and splitting it makes the documented CLI work.
    [string]$Scales = "1,2,3",
    [switch]$SvgOnly,
    [string]$FontFile = "",
    [int]$Weight = 700
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSCommandPath)
Set-Location ..

# -- Geometry (px, at 1x) -----------------------------------------------------
# A ROUNDED RECTANGLE, not a pill: the radius stays well under half the height
# so the shape never reads as a capsule.
$Height      = 40
$Radius      = 8
# MEASURED, not chosen by eye. Inter Bold at this size gives a 14px cap height,
# 35% of the badge. The size shipped before was 15px, whose 11px caps are 28% —
# visibly undersized in the tall box, which is what prompted the change. Badge
# typography generally sits in the 35-42% band, so treat 19 as the FLOOR; do not
# reduce it back toward 15 without re-measuring against this ratio.
$FontSize    = 19
$LetterSpace = 0.9
$PadX        = 18                             # horizontal padding either side of the ink
$BaselineK   = 0.36                           # optical baseline offset as a fraction of font-size

# -- Palette ------------------------------------------------------------------
# Solid fills, one fixed colourway. Every ink clears WCAG AA (4.5:1) against
# its own fill; Assert-Contrast below re-checks that on every run so a palette
# edit that breaks AA fails the build rather than shipping.
#
# `pro` uses the brand blue knocked down just far enough to carry WHITE text at
# 4.5:1: the logo blue #147EFB itself only reaches 3.88:1 with white, so the
# fill keeps the logo hue and saturation and drops lightness to 48.1%.
$Tiers = @(
    @{ Key = "free";       Label = "FREE";       Fill = "#64748B"; Ink = "#FFFFFF"; Border = "" }
    @{ Key = "plus";       Label = "PLUS";       Fill = "#8655F6"; Ink = "#FFFFFF"; Border = "" }
    @{ Key = "pro";        Label = "PRO";        Fill = "#0471F1"; Ink = "#FFFFFF"; Border = "" }
    @{ Key = "premium";    Label = "PREMIUM";    Fill = "#F5C518"; Ink = "#3F2D00"; Border = "" }
    @{ Key = "enterprise"; Label = "ENTERPRISE"; Fill = "#12141A"; Ink = "#F1F5F9"; Border = "" }
)

# -- Normalise -Scales --------------------------------------------------------
$ScaleList = @(
    $Scales -split ',' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne '' } |
        ForEach-Object {
            $n = 0
            if (-not [int]::TryParse($_, [ref]$n) -or $n -lt 1) {
                throw "-Scales expects positive integers, got '$_'"
            }
            $n
        }
)
if ($ScaleList.Count -eq 0) { throw "-Scales must name at least one scale" }

# -- WCAG relative luminance / contrast --------------------------------------
function Get-Luminance {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    $channels = @(
        [Convert]::ToInt32($h.Substring(0, 2), 16),
        [Convert]::ToInt32($h.Substring(2, 2), 16),
        [Convert]::ToInt32($h.Substring(4, 2), 16)
    )
    $linear = $channels | ForEach-Object {
        $c = $_ / 255
        if ($c -le 0.03928) { $c / 12.92 } else { [Math]::Pow((($c + 0.055) / 1.055), 2.4) }
    }
    return 0.2126 * $linear[0] + 0.7152 * $linear[1] + 0.0722 * $linear[2]
}

function Get-Contrast {
    param([string]$A, [string]$B)
    $la = Get-Luminance $A
    $lb = Get-Luminance $B
    $hi = [Math]::Max($la, $lb)
    $lo = [Math]::Min($la, $lb)
    return ($hi + 0.05) / ($lo + 0.05)
}

# -- Inter Bold outlines ------------------------------------------------------
# Instantiated once out of the variable font the UI ships, then cached for the
# run. Nothing here depends on a system-installed Inter.
if (-not $FontFile) {
    $FontFile = Join-Path $env:TEMP "kasirmu-Inter-Bold.ttf"
}

$variableFont = "ui/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"

if (-not (Test-Path $FontFile)) {
    if (-not (Test-Path $variableFont)) {
        throw "Neither $FontFile nor the bundled variable font ($variableFont) is available."
    }
    Write-Host "-- Instantiating Inter wght=$Weight from the bundled variable font --" -ForegroundColor White
    $py = @'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
src, dst, wght = sys.argv[1], sys.argv[2], int(sys.argv[3])
f = TTFont(src)
instantiateVariableFont(f, {"wght": wght}, inplace=True)
f.save(dst)
'@
    $pyPath = Join-Path $env:TEMP "kasirmu-instantiate-inter.py"
    [IO.File]::WriteAllText($pyPath, $py)
    & python $pyPath $variableFont $FontFile $Weight
    if ($LASTEXITCODE -ne 0) { throw "Failed to instantiate Inter wght=$Weight" }
    Write-Host "  [OK]   $FontFile" -ForegroundColor Green
}

# -- ImageMagick --------------------------------------------------------------
$Script:MagickPath = $null
foreach ($candidate in @("magick", "magick.exe", "$env:ProgramFiles/ImageMagick-*/magick.exe")) {
    $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($resolved) { $Script:MagickPath = $resolved.Source; break }
    $globbed = Get-ChildItem $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($globbed) { $Script:MagickPath = $globbed.FullName; break }
}

# -- SVG emission -------------------------------------------------------------
function New-TierBadgeSvg {
    param([hashtable]$Tier, [string]$PathData, [double]$Advance)

    # Canvas hugs the real advance width plus symmetric padding, rounded up to
    # an even number so 2x/3x exports land on whole pixels.
    $width = [Math]::Ceiling(($Advance + 2 * $PadX) / 2) * 2
    $baseline = $Height / 2 + $FontSize * $BaselineK
    # Centre the advance box horizontally and sit the baseline on the
    # optical centre; the glyph outlines are positioned from this origin.
    $x = ($width - $Advance) / 2

    # No border anywhere: a solid fill defines its own edge. `free` used to carry
    # a hairline purely because a WHITE pill is invisible on a white surface;
    # now that it is a grey fill no row needs one, so the mechanism is gone
    # rather than left as a per-tier flag with no user.
    $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $width $Height" width="$width" height="$Height" role="img" aria-labelledby="tier-badge-title">
  <title id="tier-badge-title">$($Tier.Label) tier badge</title>
  <rect x="0" y="0" width="$width" height="$Height" rx="$Radius" fill="$($Tier.Fill)"/>
  <g transform="translate($x,$baseline)"><path d="$PathData" fill="$($Tier.Ink)"/></g>
</svg>
"@
    return @{ Svg = $svg; Width = $width }
}

# -- Generate -----------------------------------------------------------------
$svgDir = Join-Path $OutDir "svg"
$pngDir = Join-Path $OutDir "png"
New-Item -ItemType Directory -Force -Path $svgDir | Out-Null
if (-not $SvgOnly) { New-Item -ItemType Directory -Force -Path $pngDir | Out-Null }

Write-Host "+------------------------------------------------+" -ForegroundColor Cyan
Write-Host "| kasir.mu Tier Badge Generator                  |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------+" -ForegroundColor Cyan

$manifestEntries = @()
$failures = @()

foreach ($tier in $Tiers) {
    $contrast = Get-Contrast -A $tier.Ink -B $tier.Fill
    $key = $tier.Key

    # The AA gate. A palette edit that drops below 4.5:1 fails here.
    if ($contrast -lt 4.5) {
        $failures += "$key ink/fill contrast $([Math]::Round($contrast, 2)):1 is below WCAG AA (4.5:1)"
    }

    $json = & python scripts/tier-badge-text-path.py $FontFile $tier.Label $FontSize $LetterSpace $Weight
    if ($LASTEXITCODE -ne 0) { throw "Failed to outline '$($tier.Label)'" }
    $glyph = $json | ConvertFrom-Json

    $built = New-TierBadgeSvg -Tier $tier -PathData $glyph.d -Advance $glyph.advance
    $svgPath = Join-Path $svgDir "tier-$key.svg"
    [IO.File]::WriteAllText($svgPath, $built.Svg)
    Write-Host ("  [SVG]  tier-{0}.svg  {1}x{2}  contrast {3}:1" -f $key, $built.Width, $Height, [Math]::Round($contrast, 2)) -ForegroundColor Green

    $manifestEntries += @{
        key      = $key
        label    = $tier.Label
        svg      = "svg/tier-$key.svg"
        width    = $built.Width
        height   = $Height
        fill     = $tier.Fill
        ink      = $tier.Ink
        contrast = [Math]::Round($contrast, 2)
    }

    if ($SvgOnly) { continue }

    if (-not $Script:MagickPath) {
        Write-Host "  [SKIP] ImageMagick not found - cannot export PNG" -ForegroundColor Yellow
        continue
    }

    foreach ($scale in $ScaleList) {
        $px = $built.Width * $scale
        $pngPath = Join-Path $pngDir "tier-$key@$($scale)x.png"
        # -depth 8 is load-bearing: ImageMagick Q16 writes 16-bit PNGs by
        # default, and tauri's icon decoder panics on a 16-bit RGBA image.
        & $Script:MagickPath "$svgPath" -background none -resize "$($px)x" -depth 8 -strip $pngPath
        if ($LASTEXITCODE -ne 0) { $failures += "PNG export failed for $key @$($scale)x" }
    }
    Write-Host "         PNG @$($ScaleList -join 'x, ')x" -ForegroundColor DarkGray
}

# -- Manifest -----------------------------------------------------------------
$manifest = @{
    generatedBy = "scripts/generate-tier-badges.ps1"
    geometry    = @{
        height        = $Height
        radius        = $Radius
        fontSize      = $FontSize
        fontWeight    = $Weight
        letterSpacing = $LetterSpace
        paddingX      = $PadX
        textOutlined  = $true
    }
    scales = $ScaleList
    badges = $manifestEntries
}
# ConvertTo-Json emits CRLF on Windows, but .gitattributes pins this tree to
# LF: an unconverted write leaves the file permanently dirty against its own
# committed blob after every run. Normalise before writing.
$manifestJson = ($manifest | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $OutDir "manifest.json"), $manifestJson)

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host ""
Write-Host "OK - $($manifestEntries.Count) badges, contrast >= 4.5:1" -ForegroundColor Green
