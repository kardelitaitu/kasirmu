<#
.SYNOPSIS
  Dev code-signing for OZ-POS Windows exes - the FREE route.

.DESCRIPTION
  Generates (or reuses) a self-signed Authenticode code-signing certificate
  in the CURRENT USER certificate store, adds it to the user's Trusted Root,
  signs one or more .exe files with signtool, and verifies the result.

  Why this is the "free route":
    * No CA certificate purchase (no DigiCert/Sectigo OV/EV fees).
    * No admin/elevation needed - CurrentUser store + CurrentUser\Root.
    * Removes the "Publisher: Unknown" / "unknown publisher" label on THIS
      machine for locally-built exes (harness, cloud server, CLI, ...).

  Limitation (honest):
    * Trust is local to this user/machine. End users on other machines will
      STILL see "unknown publisher" unless they install the same root cert.
    * For public distribution, the free options are:
        - SignPath (signpath.org) - free code signing for qualifying
          open-source projects, cloud HSM, integrates with GitHub Actions.
        - Certum Open Source Code Signing - free *certificate* but requires
          buying the smart-card hardware kit (~EUR 69 first year).
    * This script is the dev/CI-internal route; SignPath is the public route.

.PARAMETER Name
  Certificate subject (CN). Default "OZ-POS Development".

.PARAMETER Exe
  One or more .exe files to sign. Accepts a single path, a comma-separated
  string ("a.exe,b.exe"), or repeated -Exe arguments.

.PARAMETER Store
  Certificate store: CurrentUser (default, no admin) or LocalMachine (admin).

.PARAMETER SkipTrust
  Generate/sign but do NOT install the cert into Trusted Root (signature will
  verify as NotTrusted on this machine; used for testing the signing pipeline
  without altering trust).

.PARAMETER YesTrust
  Install the cert into Trusted Root SILENTLY via the X509Store API instead of
  Import-Certificate. The cmdlet pops Windows' "Security Warning: install this
  root certificate?" dialog and BLOCKS the script until answered; the API call
  adds the root without any UI. Use this in CI / unattended runs. Note: the
  dialog only appears for Root-store installs, and only on the first install
  of a given thumbprint.

.PARAMETER NoTimestamp
  Skip RFC 3161 timestamping (signature then expires with the cert instead of
  staying valid). Without this flag the script pre-flights the timestamp
  server and silently skips timestamping (with a warning) if it is
  unreachable, so signing never hangs on a dead network route.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/dev-code-sign.ps1 `
      -Exe "scripts/updater-compat-check/target/release/oz-updater-compat-check.exe"

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/dev-code-sign.ps1 `
      -Exe "target/release/kasirmu-cloud.exe, apps\desktop-tauri\target\release\kasirmu-app.exe"

.NOTES
  Requires: Windows SDK signtool.exe (auto-detected), New-SelfSignedCertificate
  (Windows 10+ / PowerShell). Runs as the invoking user - no elevation.
  IMPORTANT: keep this file ASCII-only. PowerShell 5.1 reads .ps1 files without
  a BOM as cp1252, and UTF-8 em-dashes (E2 80 94) decode to a literal quote
  char (0x94), which corrupts string parsing.
#>
[CmdletBinding()]
param(
  [string]$Name = "OZ-POS Development",
  [Parameter(Mandatory = $true, Position = 0)]
  [string[]]$Exe,
  [ValidateSet("CurrentUser", "LocalMachine")]
  [string]$Store = "CurrentUser",
  [switch]$SkipTrust,
  [switch]$YesTrust,
  [switch]$NoTimestamp
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Accept "a.exe,b.exe" single-string form (see NOTES about -File invocation).
if ($Exe.Count -eq 1 -and $Exe[0] -match ",") {
  $Exe = $Exe[0] -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

# ---------------- Locate signtool (Windows SDK) -----------------------
$sdkRoots = @(
  "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
  "${env:ProgramFiles}\Windows Kits\10\bin"
)
$signtool = $null
foreach ($root in $sdkRoots) {
  if (Test-Path $root) {
    $found = Get-ChildItem -Path $root -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
      Where-Object FullName -Match "x64" | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $signtool = $found.FullName; break }
  }
}
if (-not $signtool) {
  $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($cmd) { $signtool = $cmd.Source }
}
if (-not $signtool) {
  throw "signtool.exe not found. Install Windows SDK or add it to PATH."
}
Write-Host "signtool: $signtool" -ForegroundColor Cyan

# ---------------- Cert store root --------------------------------------
$storeRoot = "Cert:\$Store\My"
$trustRoot = "Cert:\$Store\Root"

# ---------------- Find existing cert (reuse) or create one -------------
# NOTE: never build "Cert:\...\$thumb" string paths - they are mangled by
# shell escaping (the backslash before the variable is eaten). Always obtain
# the cert OBJECT from Get-ChildItem and operate on the object.
$cert = Get-ChildItem -Path $storeRoot -CodeSigningCert -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -eq "CN=$Name" -and $_.HasPrivateKey } |
  Select-Object -First 1

if ($cert) {
  Write-Host "Reusing existing code-signing cert: $($cert.Thumbprint) (expires $($cert.NotAfter))" -ForegroundColor Yellow
} else {
  Write-Host "Creating new self-signed code-signing cert: CN=$Name ..."
  $params = @{
    Subject           = "CN=$Name"
    Type              = "CodeSigningCert"
    CertStoreLocation = $storeRoot
    KeyExportPolicy   = "Exportable"
    KeySpec           = "Signature"
    KeyAlgorithm      = "RSA"
    KeyLength         = 3072
    NotAfter          = (Get-Date).AddYears(3)
    HashAlgorithm     = "SHA256"
    Provider          = "Microsoft Enhanced RSA and AES Cryptographic Provider"
  }
  $cert = New-SelfSignedCertificate @params
  Write-Host "Created cert: $($cert.Thumbprint)" -ForegroundColor Green
}

# ---------------- Trust the cert as a root ------------------------------
# Removes the "unknown publisher" label on THIS machine. Writes the cert's
# DER bytes to a temp file and imports them as a standalone trusted root.
if (-not $SkipTrust) {
  $inTrust = Get-ChildItem -Path $trustRoot -ErrorAction SilentlyContinue |
    Where-Object Thumbprint -eq $cert.Thumbprint
  if (-not $inTrust) {
    Write-Host "Adding cert to Trusted Root store ($trustRoot) ..."
    if ($YesTrust) {
      # Silent install - no "Security Warning" dialog. The X509Store API adds
      # the root programmatically; Import-Certificate would pop the UI prompt
      # and block an unattended/CI run.
      # NOTE: do NOT name this $store - it collides with the $Store param
      # (ValidateSet) and PowerShell re-validates it, throwing MetadataError.
      $rootCertStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        [System.Security.Cryptography.X509Certificates.StoreName]::Root,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
      $rootCertStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $rootCertStore.Add($cert)
      $rootCertStore.Close()
      Write-Host "Trusted root installed silently (no dialog)." -ForegroundColor Green
    } else {
      $tmpCer = Join-Path $env:TEMP "oz-dev-signing-$($cert.Thumbprint).cer"
      [System.IO.File]::WriteAllBytes($tmpCer, $cert.RawData)
      if (-not (Test-Path $tmpCer)) {
        throw "Failed to export certificate DER to $tmpCer"
      }
      Import-Certificate -FilePath $tmpCer -CertStoreLocation $trustRoot | Out-Null
      Remove-Item $tmpCer -Force -ErrorAction SilentlyContinue
      Write-Host "Trusted root installed for current user." -ForegroundColor Green
    }
  } else {
    Write-Host "Cert already in Trusted Root store." -ForegroundColor Green
  }
}

# ---------------- Bounded signtool invocation ---------------------------
# Run signtool with a hard timeout and kill it if it exceeds it (dead
# timestamp servers would otherwise hang the script forever). First try WITH
# an RFC 3161 timestamp; on timeout, re-sign WITHOUT one (with a warning).
function Invoke-BoundedSigntool {
  param(
    [string]$SigntoolPath,
    [string[]]$SignArgs,
    [int]$TimeoutSeconds = 25
  )
  $p = Start-Process -FilePath $SigntoolPath -ArgumentList $SignArgs -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\signtool-out.txt" -RedirectStandardError "$env:TEMP\signtool-err.txt"
  if (-not $p.WaitForExit($TimeoutSeconds * 1000)) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
    Write-Host "  signtool timed out after ${TimeoutSeconds}s - killing." -ForegroundColor Yellow
    return 124
  }
  # Null-safe: if ExitCode is not yet readable (process racing), poll briefly.
  for ($i = 0; $i -lt 10 -and $null -eq $p.ExitCode; $i++) { Start-Sleep -Milliseconds 100 }
  if ($null -eq $p.ExitCode) { return 125 }  # 125 = unknown/failed to read exit code
  return $p.ExitCode
}

$useTimestamp = -not $NoTimestamp

# ---------------- Sign each exe ----------------------------------------
$thumb = $cert.Thumbprint
$results = @()
foreach ($exe in $Exe) {
  if (-not (Test-Path -LiteralPath $exe)) {
    Write-Warning "Skipping missing exe: $exe"
    continue
  }
  Write-Host "`nSigning: $exe" -ForegroundColor Cyan

  $base = @("sign", "/fd", "SHA256", "/sha1", $thumb, "/v", "`"$exe`"")
  $rc = $null
  if ($useTimestamp) {
    $withTs = $base + @("/tr", "http://timestamp.digicert.com", "/td", "SHA256")
    $rc = Invoke-BoundedSigntool $signtool $withTs
    if ($rc -eq 124) {
      Write-Host "  Timestamp route slow/dead - re-signing WITHOUT timestamp." -ForegroundColor Yellow
    }
  }
  if ($null -eq $rc -or $rc -ne 0) {
    $noTs = $base
    $rc = Invoke-BoundedSigntool $signtool $noTs
  }
  if ($rc -ne 0) {
    Write-Warning "signtool exited $rc for $exe - leaving unsigned."
    $results += [pscustomobject]@{ Exe = $exe; Signed = $false }
    continue
  }

  # ---------------- Verify ----------------------------------------------
  $sig = Get-AuthenticodeSignature -LiteralPath $exe
  $publisher = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "(none)" }
  $results += [pscustomobject]@{ Exe = $exe; Signed = $true; Status = $sig.Status; Publisher = $publisher }
  Write-Host ("  Status: {0}" -f $sig.Status) -ForegroundColor Green
  Write-Host ("  Publisher: {0}" -f $publisher) -ForegroundColor Green
}

# ---------------- Summary ------------------------------------------------
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | Format-Table Exe, Status, Publisher -AutoSize
$allSigned = $results.Count -gt 0 -and -not ($results | Where-Object { -not $_.Signed })
Write-Host "Thumbprint: $thumb (store $storeRoot)" -ForegroundColor Yellow
if ($allSigned) {
  Write-Host "All exes signed. 'Publisher: Unknown' is gone on this machine." -ForegroundColor Green
  Write-Host "NOTE: other machines still need this root cert (or SignPath) to trust these exes." -ForegroundColor Yellow
} else {
  Write-Host "One or more exes failed to sign - see warnings above." -ForegroundColor Red
  exit 1
}
