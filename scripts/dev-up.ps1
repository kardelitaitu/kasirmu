# ── OZ-POS Dev Up (Windows PowerShell) ───────────────────────────────
#
# One-command local development startup:
#   1. Resolves the compose-required secrets (JWT secret + admin key):
#      generated once into the gitignored repo .env, reused on every run
#   2. Starts PostgreSQL, Redis, license-server, cloud-server via Docker
#   3. Waits for all health checks to pass
#   4. Prints service URLs + next steps
#
# Usage:
#   .\scripts\dev-up.ps1              # SQLite mode (default)
#   .\scripts\dev-up.ps1 -Pg          # PostgreSQL mode
#   .\scripts\dev-up.ps1 -Build       # Rebuild images before starting
#   .\scripts\dev-up.ps1 -Down        # Stop and clean volumes

param(
  [switch]$Pg,        # Enable PostgreSQL backend
  [switch]$Build,     # Rebuild Docker images
  [switch]$Down       # Tear down (docker compose down -v)
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $PSCommandPath))

# ── Tear-down mode ────────────────────────────────────────────────
if ($Down) {
  Write-Host "👋 Tearing down OZ-POS dev environment..." -ForegroundColor Yellow
  if ($Pg) {
    docker compose -f docker-compose.yml -f docker-compose.pg.yml down -v
  } else {
    docker compose down -v
  }
  Write-Host "✅ Done. Volumes removed." -ForegroundColor Green
  exit 0
}

# ── Prerequisites check ───────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "❌ Docker is required. Install Docker Desktop from https://docker.com" -ForegroundColor Red
  exit 1
}

# ── Generate the required secrets once, persist them, reuse on next run ──
#
# MIRROR of the same block in scripts/dev-up.sh — keep the two in step.
# docker-compose.yml hard-requires OZ_API_SECRET (:55) and OZ_ADMIN_KEY (:70)
# with the fail-closed ':?' form. That requirement IS the fix: an unset
# OZ_ADMIN_KEY makes admin_key_authorised() (crates/kasirmu-api/src/routes/
# tokens.rs) return TRUE, turning POST /api/v1/tokens into an unauthenticated
# mint. Compose refusing to parse without one must stay; what this script owes
# a developer is a value to run with.
#
# Precedence, identical to the shell: an exported value wins and is written
# nowhere; else a non-empty line in .env is REUSED — which is what keeps minted
# tokens and the license-server's terminal registrations alive across a compose
# restart, since a fresh OZ_API_SECRET every run invalidates every token
# already issued; else one is generated once and persisted into .env, which
# .gitignore:66 excludes, so a secret never lands in a tracked file.
#
# Three traps this avoids — the same class the shell twin hit in review (a grep
# that matched nothing under pipefail, and bash-3.2 indirect expansion):
#   * A missing key gives back NOTHING, not an empty string — Get-Item on a
#     missing Env: path returns no item at all. Under ErrorActionPreference =
#     Stop that is fatal, so every read is cast through [string] before use.
#   * No value ever reaches a regex. Lookup is a literal StartsWith on the NAME=
#     prefix and the write hands one prebuilt string to WriteAllText, so a
#     secret containing $ [ ] | & cannot rewrite the line it lands on.
#   * .env is rewritten with the newline style it already uses, because this
#     repo's .env is CRLF and re-styling sixty unrelated lines to fix one key
#     would be a silent side effect on the developer's own secrets.
$EnvFile = '.env'
$GeneratedSecrets = @()
$LF = [string][char]10
$CR = [string][char]13
$DQ = [string][char]34
$BS = [string][char]92

function New-SecretHex {
  # 32 cryptographic random bytes as 64 hex chars — the equivalent of the
  # shell's openssl rand -hex 32. Hex only, on purpose: compose's dotenv parser
  # interpolates dollar references inside values, so a dollar sign in a key
  # would be substituted at render time. (The Get-Random loop this replaces drew
  # from System.Random, which is not a CSPRNG.)
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-EnvFileValue {
  param([string]$Name)
  if (-not (Test-Path -LiteralPath $EnvFile)) { return '' }
  $prefix = $Name + '='
  $found = ''
  # In a dotenv file the LAST assignment wins, so scan to the end.
  foreach ($line in @(Get-Content -LiteralPath $EnvFile)) {
    $t = ([string]$line).TrimStart()
    if ($t.StartsWith($prefix, [System.StringComparison]::Ordinal)) { $found = $t }
  }
  if ($found.Length -le $prefix.Length) { return '' }
  $v = $found.Substring($prefix.Length).Trim()
  if ($v.Length -ge 2 -and $v.StartsWith($DQ) -and $v.EndsWith($DQ)) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  return $v
}

function Set-EnvFileValue {
  # Fill an existing NAME= line in place — the shape a .env copied out of
  # .env.example has — instead of stacking a second assignment under it, so the
  # line count holds. Append only when the key is absent entirely.
  param([string]$Name, [string]$Value)
  $path = [System.IO.Path]::GetFullPath((Join-Path $PWD.Path $EnvFile))
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    [System.IO.File]::WriteAllText($path, ($Name + '=' + $Value + $LF), $utf8NoBom)
    return
  }
  $nl = $LF
  if ([System.IO.File]::ReadAllText($path).Contains($CR + $LF)) { $nl = $CR + $LF }
  $prefix = $Name + '='
  $assignment = $Name + '=' + $Value
  $out = New-Object System.Collections.Generic.List[string]
  $done = $false
  foreach ($line in @(Get-Content -LiteralPath $EnvFile)) {
    $t = ([string]$line).TrimStart()
    if (-not $done -and $t.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      $out.Add($assignment); $done = $true
    } else {
      $out.Add([string]$line)
    }
  }
  if (-not $done) { $out.Add($assignment) }
  [System.IO.File]::WriteAllText($path, (($out -join $nl) + $nl), $utf8NoBom)
}

function Protect-SecretFile {
  param([string]$Path)
  # Windows has no umask, so this is the equivalent of the shell creating the
  # file under 077: drop the inherited grants and keep exactly one, this
  # account's read+write. Named here rather than assumed, because the POSIX
  # mode the shell leans on does not exist on this platform.
  #
  # Best-effort by design — a managed machine can refuse an ACL edit and a dev
  # startup must not die over one. And, unlike the shell's unconditional chmod,
  # applied ONLY to a .env this run created: stripping inheritance from a file
  # the developer already maintains could lock out their own backup or AV
  # tooling, and those permissions were chosen deliberately.
  $who = $env:USERNAME
  if ($env:USERDOMAIN) { $who = $env:USERDOMAIN + $BS + $env:USERNAME }
  try {
    $null = & icacls $Path /inheritance:r /grant:r ($who + ':(R,W)')
    if ($LASTEXITCODE -ne 0) {
      Write-Host ('⚠️  icacls could not tighten ' + $EnvFile + ' (exit ' + $LASTEXITCODE + ') — set its permissions manually.') -ForegroundColor Yellow
    } else {
      Write-Host ('🔒 ' + $EnvFile + ' created owner-only via icacls /inheritance:r /grant:r ' + $who + ':(R,W)') -ForegroundColor Cyan
    }
  } catch {
    Write-Host ('⚠️  icacls unavailable — could not tighten ' + $EnvFile + '; set its permissions manually.') -ForegroundColor Yellow
  }
}

function Require-Secret {
  param([string]$Name)
  # Already exported (operator, CI, a secret manager) -> use it, write nothing.
  $current = [string](Get-Item -LiteralPath ('Env:' + $Name) -ErrorAction SilentlyContinue).Value
  if ($current.Trim().Length -gt 0) { return }

  $stored = [string](Get-EnvFileValue -Name $Name)
  if ($stored.Trim().Length -gt 0) {
    Set-Item -Path ('Env:' + $Name) -Value $stored
    Write-Host ('🔑 ' + $Name + ' reused from ' + $EnvFile) -ForegroundColor Cyan
    return
  }

  $fresh = [string](New-SecretHex)
  if ($fresh.Length -lt 64) {
    Write-Host ('❌ Could not generate a 64-char hex secret for ' + $Name + '.') -ForegroundColor Red
    exit 1
  }
  # Decided BEFORE writing: Set-EnvFileValue is what creates the file.
  $createdHere = -not (Test-Path -LiteralPath $EnvFile)
  Set-EnvFileValue -Name $Name -Value $fresh
  if ($createdHere) {
    Protect-SecretFile -Path ([System.IO.Path]::GetFullPath((Join-Path $PWD.Path $EnvFile)))
  }
  # Set-Item, not an env: literal, because the name arrives in a variable.
  Set-Item -Path ('Env:' + $Name) -Value $fresh
  # Only the NAME lands in this list — never a value. This output is captured in
  # CI logs, so the one banner below is the whole disclosure.
  $script:GeneratedSecrets += $Name
}

Require-Secret -Name 'OZ_API_SECRET'
Require-Secret -Name 'OZ_ADMIN_KEY'

if ($GeneratedSecrets.Count -gt 0) {
  Write-Host ('🧪 LOCAL DEV ONLY — scripts/dev-up.ps1 generated ' + ($GeneratedSecrets -join ' ') + ' into the gitignored ' + $EnvFile + '. These are throwaway values for THIS MACHINE, not production credentials: replace them before deploying anywhere.') -ForegroundColor Yellow
}

# ── Check license key ─────────────────────────────────────────────
$licenseKeyPath = "crates\kasirmu-core\oz-license-private.pem"
if (-not $env:OZ_LICENSE_PRIVATE_KEY) {
  if (Test-Path $licenseKeyPath) {
    $env:OZ_LICENSE_PRIVATE_KEY = (Get-Content $licenseKeyPath -Raw).Trim()
    Write-Host "🔑 Loaded OZ_LICENSE_PRIVATE_KEY from $licenseKeyPath" -ForegroundColor Cyan
  } else {
    Write-Host "⚠️  OZ_LICENSE_PRIVATE_KEY not set and $licenseKeyPath not found." -ForegroundColor Yellow
    Write-Host "   Generate keys: .\scripts\generate-license-keys.ps1" -ForegroundColor Yellow
  }
}

# ── Build (optional) ──────────────────────────────────────────────
if ($Build) {
  Write-Host "🔨 Building Docker images..." -ForegroundColor Cyan
  if ($Pg) {
    docker compose -f docker-compose.yml -f docker-compose.pg.yml build
  } else {
    docker compose build
  }
}

# ── Start services ────────────────────────────────────────────────
Write-Host "🚀 Starting OZ-POS backend services..." -ForegroundColor Cyan
if ($Pg) {
  docker compose -f docker-compose.yml -f docker-compose.pg.yml up -d
} else {
  docker compose up -d
}

# ── Wait for health checks ────────────────────────────────────────
Write-Host "⏳ Waiting for services to become healthy..." -ForegroundColor Yellow

$services = @("redis", "license-server", "pos-cloud-server")
if ($Pg) { $services = @("redis", "pos-cloud-db", "license-server", "pos-cloud-server") }

$timeout = 120
$elapsed = 0
$interval = 3

while ($elapsed -lt $timeout) {
  $allHealthy = $true
  foreach ($svc in $services) {
    $status = docker compose ps --format json $svc 2>$null | ConvertFrom-Json | Select-Object -ExpandProperty Health -ErrorAction SilentlyContinue
    if ($status -ne "healthy") {
      $allHealthy = $false
      break
    }
  }
  if ($allHealthy) { break }
  Start-Sleep -Seconds $interval
  $elapsed += $interval
}

if ($elapsed -ge $timeout) {
  Write-Host "⚠️  Health check timeout after ${timeout}s. Check logs: docker compose logs" -ForegroundColor Yellow
} else {
  Write-Host "✅ All services healthy (${elapsed}s)" -ForegroundColor Green
}

# ── Print service URLs ────────────────────────────────────────────
$apiPort = if ($env:OZ_API_PORT) { $env:OZ_API_PORT } else { "3099" }

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  OZ-POS Backend — Ready                                  ║" -ForegroundColor Green
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Cloud Server:    http://localhost:$apiPort/api/health       ║" -ForegroundColor Green
Write-Host "║  License Server:  http://localhost:8080/api/health       ║" -ForegroundColor Green
Write-Host "║  Redis:           localhost:6379                         ║" -ForegroundColor Green
if ($Pg) {
  Write-Host "║  PostgreSQL:      localhost:5432 (ozpos/ozpos)           ║" -ForegroundColor Green
}
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "║  Start desktop app: .\scripts\start-desktop.bat          ║" -ForegroundColor Green
Write-Host "║  Stop services:    .\scripts\dev-up.ps1 -Down            ║" -ForegroundColor Green
Write-Host "║  View logs:        docker compose logs -f                ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
