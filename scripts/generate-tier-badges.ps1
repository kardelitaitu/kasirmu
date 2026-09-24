# scripts/generate-tier-badges.ps1 - Subscription tier badge generator.
#
# Usage:
#   powershell -File scripts\generate-tier-badges.ps1                    # SVG + PNG @1x/2x/3x
#   powershell -File scripts\generate-tier-badges.ps1 -Scales 1,2,3,4    # extra scales
#   powershell -File scripts\generate-tier-badges.ps1 -SvgOnly           # no rasterisation
#
# The badge is a fixed product artefact: the five subscription tiers are
# defined by TIER_LEVEL in ui/src/utils/tierLevel.ts and do NOT vary per
# tenant, so this lives outside assets/branding/ (whose every subdirectory
# is a whitelabel brand with a manifest.json).
#
# One source of truth: the palette and geometry below generate every SVG,
# and every PNG is rasterised from that SVG. Edit here, never a copy.
#
# Requirements: PowerShell 7+, ImageMagick (for PNG export).

param(
    [string]$OutDir = "assets/tier-badges",
    # A [int[]] here is a trap: `-File script.ps1 -Scales 1,2,4` passes the
    # literal string '1,2,4', which PowerShell coerces to the single int 124.
    # Taking a string and splitting it makes the documented CLI work.
    [string]$Scales = "1,2,3",
    [switch]$SvgOnly
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSCommandPath)
Set-Location ..

# -- Geometry (px, at 1x) -----------------------------------------------------
# A pill: the corner radius is exactly half the inner height, so the shape
# never reads as a rounded rectangle by accident.
$Height      = 40
$StrokeWidth = 1.5
$Radius      = ($Height - $StrokeWidth) / 2   # 19.25 - a true pill
$FontSize    = 15
$FontWeight  = 600
$LetterSpace = 0.9
$PadX        = 18                             # horizontal padding either side of the ink
$BaselineK   = 0.36                           # optical baseline offset as a fraction of font-size

# -- Palette ------------------------------------------------------------------
# Each tier carries a HUE; the two colourways are derived from it so a tier
# keeps one identity in both themes:
#   dark  : fill = hue at 14% over the dark panel (#1c1f27) -- the 10-15%
#           tint the design language specifies for status pills
#           (prototypes/design-language.html:1459); ink = the hue lightened
#           until it clears WCAG AA (4.5:1) against that fill.
#   light : fill = hue at 10% over white; ink = the hue darkened until it
#           clears 4.5:1 against that fill.
# The Ink values are precomputed, NOT recomputed here - they are design
# decisions. Assert-Contrast below re-checks them on every run so a hand
# edit that breaks AA fails the build instead of shipping.
$Tiers = @(
    @{ Key = "free";       Label = "FREE";       InkWidth = 38; Hue = "#64748B"
       Dark  = @{ Fill = "#262b35"; Ink = "#8993a5"; Stroke = "#3c4553" }
       Light = @{ Fill = "#f0f1f3"; Ink = "#5e6e82"; Stroke = "#b9c0cb" } }
    @{ Key = "plus";       Label = "PLUS";       InkWidth = 40; Hue = "#147EFB"
       Dark  = @{ Fill = "#1b2c45"; Ink = "#3f94fb"; Stroke = "#194985" }
       Light = @{ Fill = "#e8f2ff"; Ink = "#146bd1"; Stroke = "#95c5fd" } }
    @{ Key = "pro";        Label = "PRO";        InkWidth = 32; Hue = "#0891B2"
       Dark  = @{ Fill = "#192f3a"; Ink = "#2da1bc"; Stroke = "#135164" }
       Light = @{ Fill = "#e6f4f7"; Ink = "#087896"; Stroke = "#90cedc" } }
    @{ Key = "premium";    Label = "PREMIUM";    InkWidth = 75; Hue = "#8B5CF6"
       Dark  = @{ Fill = "#2c2844"; Ink = "#a17df6"; Stroke = "#4d3a82" }
       Light = @{ Fill = "#f3effe"; Ink = "#7c52dd"; Stroke = "#cbb6fb" } }
    @{ Key = "enterprise"; Label = "ENTERPRISE"; InkWidth = 98; Hue = "#10B981"
       Dark  = @{ Fill = "#1a3534"; Ink = "#10B981"; Stroke = "#17634f" }
       Light = @{ Fill = "#e7f8f2"; Ink = "#107d59"; Stroke = "#93e0c6" } }
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
    param([hashtable]$Tier, [hashtable]$Palette, [string]$Title)

    # Canvas hugs the measured ink width plus symmetric padding, rounded up
    # to an even number so 2x/3x exports land on whole pixels.
    $inkW = $Tier.InkWidth - $LetterSpace   # the trailing letter-space is not ink
    $width = [Math]::Ceiling(($inkW + 2 * $PadX) / 2) * 2
    $innerW = $width - $StrokeWidth
    $innerH = $Height - $StrokeWidth
    $baseline = $Height / 2 + $FontSize * $BaselineK

    # letter-spacing appends a space after the final glyph, which shifts a
    # middle-anchored run left by half that space; x is nudged by the same
    # half so the visible ink - not the advance box - is centred.
    $x = $width / 2 + $LetterSpace / 2

    $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $width $Height" width="$width" height="$Height" role="img" aria-labelledby="tier-badge-title">
  <title id="tier-badge-title">$Title</title>
  <rect x="$($StrokeWidth / 2)" y="$($StrokeWidth / 2)" width="$innerW" height="$innerH" rx="$Radius" fill="$($Palette.Fill)" stroke="$($Palette.Stroke)" stroke-width="$StrokeWidth"/>
  <text x="$x" y="$baseline" fill="$($Palette.Ink)" font-family="Inter, 'Segoe UI', system-ui, -apple-system, sans-serif" font-size="$FontSize" font-weight="$FontWeight" letter-spacing="$LetterSpace" text-anchor="middle">$($Tier.Label)</text>
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
    foreach ($scheme in @("light", "dark")) {
        $palette = $tier.$scheme
        $contrast = Get-Contrast -A $palette.Ink -B $palette.Fill
        $label = "$($tier.Key)-$scheme"

        # The AA gate. A palette edit that drops below 4.5:1 fails here.
        if ($contrast -lt 4.5) {
            $failures += "$label ink/fill contrast $([Math]::Round($contrast, 2)):1 is below WCAG AA (4.5:1)"
        }

        $title = "$($tier.Label) tier badge ($scheme)"
        $built = New-TierBadgeSvg -Tier $tier -Palette $palette -Title $title
        $svgPath = Join-Path $svgDir "tier-$label.svg"
        [IO.File]::WriteAllText($svgPath, $built.Svg)
        Write-Host ("  [SVG]  tier-{0}.svg  {1}x{2}  contrast {3}:1" -f $label, $built.Width, $Height, [Math]::Round($contrast, 2)) -ForegroundColor Green

        $manifestEntries += @{
            key      = $tier.Key
            label    = $tier.Label
            scheme   = $scheme
            svg      = "svg/tier-$label.svg"
            width    = $built.Width
            height   = $Height
            fill     = $palette.Fill
            ink      = $palette.Ink
            stroke   = $palette.Stroke
            contrast = [Math]::Round($contrast, 2)
        }

        if ($SvgOnly) { continue }

        if (-not $Script:MagickPath) {
            Write-Host "  [SKIP] ImageMagick not found - cannot export PNG" -ForegroundColor Yellow
            continue
        }

        foreach ($scale in $ScaleList) {
            $px = $built.Width * $scale
            $pngPath = Join-Path $pngDir "tier-$label@$($scale)x.png"
            # -depth 8 is load-bearing: ImageMagick Q16 writes 16-bit PNGs by
            # default, and tauri's icon decoder panics on a 16-bit RGBA image.
            & $Script:MagickPath "$svgPath" -background none -resize "$($px)x" -depth 8 -strip $pngPath
            if ($LASTEXITCODE -ne 0) { $failures += "PNG export failed for $label @$($scale)x" }
        }
        Write-Host "         PNG @$($ScaleList -join 'x, ')x" -ForegroundColor DarkGray
    }
}

# -- Manifest -----------------------------------------------------------------
$manifest = @{
    generatedBy = "scripts/generate-tier-badges.ps1"
    geometry    = @{
        height        = $Height
        strokeWidth   = $StrokeWidth
        radius        = $Radius
        fontSize      = $FontSize
        fontWeight    = $FontWeight
        letterSpacing = $LetterSpace
        paddingX      = $PadX
        fontFamily    = "Inter"
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
