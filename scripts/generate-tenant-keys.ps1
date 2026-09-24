# generate-tenant-keys.ps1
# ── kasir.mu Tenant Key Generator ─────────────────────────────────────
# Generates a cryptographically secure API key and formatted License Key
# for manually registering a new tenant in PocketBase.
#
# Usage:
#   .\scripts\generate-tenant-keys.ps1 [tier]
#
# Examples:
#   .\scripts\generate-tenant-keys.ps1        (defaults to PRO)
#   .\scripts\generate-tenant-keys.ps1 FREE

param (
    [string]$Tier = "PRO"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Tier = $Tier.ToUpper()
$validTiers = @("FREE", "PRO", "PREMIUM", "ENTERPRISE")
if ($Tier -notin $validTiers) {
    Write-Host "ERROR: Invalid tier '$Tier'. Must be one of: $($validTiers -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  kasir.mu Tenant & License Key Generator"            -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# Generate a secure 32-byte API Key using RNGCryptoServiceProvider
$rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::Create()
$apiBytes = New-Object byte[] 32
$rng.GetBytes($apiBytes)
$apiHex = ($apiBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$apiKey = "oz_live_$apiHex"

# Generate a 16-character License Key using RNGCryptoServiceProvider
$licBytes = New-Object byte[] 8
$rng.GetBytes($licBytes)
$licHex = ($licBytes | ForEach-Object { $_.ToString("X2") }) -join ""
# Format as XXXX-XXXX-XXXX-XXXX
$licSegments = $licHex.Insert(12, "-").Insert(8, "-").Insert(4, "-")
$licenseKey = "OZ-$Tier-$licSegments"

Write-Host "Tenant API Key (keep secret!):" -ForegroundColor White
Write-Host $apiKey -ForegroundColor Green
Write-Host ""
Write-Host "POS License Key ($Tier):" -ForegroundColor White
Write-Host $licenseKey -ForegroundColor Green
Write-Host ""
Write-Host "Instructions:" -ForegroundColor Gray
Write-Host "1. Paste the API Key into the 'tenants' collection." -ForegroundColor Gray
Write-Host "2. Paste the License Key into the 'license_keys' collection." -ForegroundColor Gray
Write-Host "3. Set the tier inside the license_keys record to match." -ForegroundColor Gray
Write-Host ""
