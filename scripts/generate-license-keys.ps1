# generate-license-keys.ps1
# ── OZ-POS License Key Generator ────────────────────────────────────
# Generates an RSA-2048 key pair for the license server (ADR #9).
#
# Outputs:
#   crates/kasirmu-core/oz-license.key.pub     ← Public key (embedded in POS binary, committed)
#   crates/kasirmu-core/oz-license-private.pem ← Private key (set as OZ_LICENSE_PRIVATE_KEY env var, git-ignored)
#
# Requirements:
#   - OpenSSL (included with Git for Windows: C:\Program Files\Git\usr\bin\openssl.exe)
#
# Usage:
#   .\scripts\generate-license-keys.ps1

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$publicKeyPath  = "crates/kasirmu-core/oz-license.key.pub"
$privateKeyPath = "crates/kasirmu-core/oz-license-private.pem"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  OZ-POS License Key Generator (ADR #9)"            -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# ── Check OpenSSL availability ──────────────────────────────────────
$openssl = $null
$opensslCandidates = @(
    "openssl",
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
)

foreach ($candidate in $opensslCandidates) {
    try {
        $null = & $candidate version 2>$null
        $openssl = $candidate
        break
    } catch {}
}

if (-not $openssl) {
    Write-Host "ERROR: OpenSSL not found." -ForegroundColor Red
    Write-Host "Install it via: winget install OpenSSL.OpenSSL" -ForegroundColor Yellow
    Write-Host "Or use Git for Windows (includes OpenSSL at C:\Program Files\Git\usr\bin\openssl.exe)" -ForegroundColor Yellow
    exit 1
}
Write-Host "[✓] OpenSSL found: $openssl" -ForegroundColor Green

# ── Confirm before overwriting ──────────────────────────────────────
if (Test-Path $privateKeyPath) {
    Write-Host ""
    Write-Host "WARNING: $privateKeyPath already exists!" -ForegroundColor Yellow
    Write-Host "Overwriting this key will INVALIDATE all existing subscriptions." -ForegroundColor Yellow
    $confirm = Read-Host "Type 'YES' to continue"
    if ($confirm -ne "YES") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 1
    }
}

if (Test-Path $publicKeyPath) {
    Write-Host "WARNING: $publicKeyPath will be overwritten." -ForegroundColor Yellow
}

# ── Ensure the output directory exists ──────────────────────────────
$outDir = Split-Path -Parent $privateKeyPath
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# ── Generate RSA-2048 private key (PKCS#8 PEM) ──────────────────────
Write-Host ""
Write-Host "Generating RSA-2048 key pair..." -ForegroundColor Cyan

& $openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $privateKeyPath 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to generate private key." -ForegroundColor Red
    exit 1
}
Write-Host "[✓] Private key created: $privateKeyPath" -ForegroundColor Green

# Set restrictive permissions (Windows ACL: current user only)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "      (Permission restriction skipped — run as admin for ACL control)" -ForegroundColor DarkGray
} else {
    try {
        $acl = Get-Acl $privateKeyPath
        $acl.SetAccessRuleProtection($true, $false)
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, "FullControl", "Allow")
        $acl.SetAccessRule($rule)
        Set-Acl $privateKeyPath $acl
        Write-Host "      Permissions restricted to current user." -ForegroundColor DarkGray
    } catch {
        Write-Host "      (Permission restriction failed: $_)" -ForegroundColor DarkGray
    }
}

# ── Extract public key (DER/SPKI format) ────────────────────────────
& $openssl pkey -in $privateKeyPath -pubout -outform DER -out $publicKeyPath 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to extract public key." -ForegroundColor Red
    exit 1
}
Write-Host "[✓] Public key created: $publicKeyPath" -ForegroundColor Green

# ── Verify the key pair ─────────────────────────────────────────────
try {
    $privateContent = Get-Content -Raw $privateKeyPath
    $publicSize = (Get-Item $publicKeyPath).Length

    if ($privateContent -match "-----BEGIN PRIVATE KEY-----") {
        Write-Host "[✓] Private key is valid PKCS#8 PEM" -ForegroundColor Green
    } elseif ($privateContent -match "-----BEGIN RSA PRIVATE KEY-----") {
        Write-Host "[✓] Private key is valid PKCS#1 PEM" -ForegroundColor Green
    } else {
        Write-Host "[!] WARNING: Private key format unexpected" -ForegroundColor Yellow
    }

    if ($publicSize -ge 256) {
        Write-Host "[✓] Public key is valid ($publicSize bytes DER)" -ForegroundColor Green
    } else {
        Write-Host "[!] WARNING: Public key size unexpected ($publicSize bytes)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] WARNING: Could not verify keys: $_" -ForegroundColor Yellow
}

# ── Final instructions ──────────────────────────────────────────────
Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  Key generation complete!"                          -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Public key:  $publicKeyPath   ← committed to git" -ForegroundColor White
Write-Host "  Private key: $privateKeyPath ← NEVER commit this" -ForegroundColor White
Write-Host ""
Write-Host "  To set the private key as an env var for local testing:" -ForegroundColor Cyan
Write-Host '    $env:OZ_LICENSE_PRIVATE_KEY = (Get-Content -Raw "' + $privateKeyPath + '")' -ForegroundColor Gray
Write-Host ""
Write-Host "  To set on Northflank:" -ForegroundColor Cyan
Write-Host "    1. Open your project → Secrets → Secret Groups" -ForegroundColor Gray
Write-Host "    2. Create a secret named OZ_LICENSE_PRIVATE_KEY" -ForegroundColor Gray
Write-Host "    3. Paste the ENTIRE contents of $privateKeyPath" -ForegroundColor Gray
Write-Host ""
Write-Host "  See apps/license-server/DEPLOY.md for the full deployment guide." -ForegroundColor DarkGray
Write-Host ""
