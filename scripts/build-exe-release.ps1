# build-exe-release.ps1 — Build Windows EXE for OZ-POS Desktop Client
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$BuildConfig = 'Release',

    [switch]$SkipRustBuild = $false,
    [switch]$SkipFrontendBuild = $false,
    [switch]$SkipTauriBuild = $false,
    [switch]$SkipSign = $false,
    [switch]$NoInstaller = $false,
    [switch]$SkipNpmInstall = $false,

    [string]$TauriTarget = 'x86_64-pc-windows-msvc'
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = Split-Path -Parent $ScriptDir
$DesktopClientDir = Join-Path $WorkspaceRoot "apps\desktop-tauri"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building OZ-POS Windows EXE (Release)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Verify Rust toolchain
try {
    $rustcVersion = rustc --version 2>&1
    Write-Host "[INFO] Rust toolchain: $rustcVersion" -ForegroundColor Green
} catch {
    Write-Error "Rust is not installed or not on PATH. Please install Rust from https://rustup.rs/"
    exit 1
}

# Verify Node.js
try {
    $nodeVersion = node --version 2>&1
    Write-Host "[INFO] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed or not on PATH."
    exit 1
}

# Step 1: Build frontend
if (-not $SkipFrontendBuild) {
    Write-Host "`n[1/4] Building Frontend (React/TypeScript)..." -ForegroundColor Yellow
    Push-Location (Join-Path $WorkspaceRoot "ui")
    try {
        if (-not $SkipNpmInstall) {
            Write-Host "  Running: npm ci --no-audit --no-fund --ignore-scripts" -ForegroundColor Cyan
            npm ci --no-audit --no-fund --ignore-scripts
            if ($LASTEXITCODE -ne 0) {
                Write-Error "npm ci failed"
                exit 1
            }
        }
        Write-Host "  Running: npm run build" -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Frontend build failed"
            exit 1
        }
        Write-Host "[SUCCESS] Frontend built successfully" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[1/4] Skipping frontend build (--SkipFrontendBuild flag set)" -ForegroundColor Yellow
}

# Step 2: Build Rust binary
if (-not $SkipRustBuild) {
    Write-Host "`n[2/4] Building Rust Desktop Client..." -ForegroundColor Yellow
    Push-Location $DesktopClientDir
    try {
        Write-Host "  Config: $BuildConfig" -ForegroundColor Cyan
        Write-Host "  Target: $TauriTarget" -ForegroundColor Cyan

        if ($BuildConfig -eq 'Release') {
            Write-Host "  Running: cargo build --release --target $TauriTarget" -ForegroundColor Gray
            cargo build --release --target $TauriTarget
        } else {
            Write-Host "  Running: cargo build --debug --target $TauriTarget" -ForegroundColor Gray
            cargo build --debug --target $TauriTarget
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Cargo build failed with exit code $LASTEXITCODE"
            exit 1
        }

        Write-Host "[SUCCESS] Rust binary built successfully" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[2/4] Skipping Rust build (--SkipRustBuild flag set)" -ForegroundColor Yellow
}

# Step 3: Build with Tauri (creates installer)
if (-not $SkipTauriBuild) {
    Write-Host "`n[3/4] Building Tauri Application & Installer..." -ForegroundColor Yellow
    Push-Location $DesktopClientDir
    try {
        $tauriCmd = if ($BuildConfig -eq 'Release') {
            "cargo tauri build"
        } else {
            "cargo tauri build --debug"
        }

        Write-Host "  Running: $tauriCmd" -ForegroundColor Cyan

        # Set environment for release build
        if ($BuildConfig -eq 'Release') {
            $env:TAURI_SIGNING_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY
            $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
        }

        Invoke-Expression $tauriCmd

        if ($LASTEXITCODE -ne 0) {
            Write-Error "Tauri build failed"
            exit 1
        }

        Write-Host "[SUCCESS] Tauri application built successfully" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "`n[3/4] Skipping Tauri build (--SkipTauriBuild flag set)" -ForegroundColor Yellow
}

# Step 4: Code signing (optional, release only)
if (-not $SkipSign -and $BuildConfig -eq 'Release' -and -not $SkipTauriBuild) {
    Write-Host "`n[4/4] Code Signing (Optional)..." -ForegroundColor Yellow

    $SignTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($null -ne $SignTool) {
        $certThumb = $env:SIGN_CERT_THUMB
        $cert = $null

        if ([string]::IsNullOrWhiteSpace($certThumb)) {
            $cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Select-Object -First 1
            if ($null -ne $cert) {
                $certThumb = $cert.Thumbprint
                Write-Host "  Found certificate: $($cert.Subject)" -ForegroundColor Gray
            }
        } else {
            $cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $certThumb }
        }

        if ($null -ne $cert -or -not [string]::IsNullOrWhiteSpace($certThumb)) {
            Write-Host "  Signing with certificate..." -ForegroundColor Cyan
            # Note: Tauri handles signing via signtool during build
            # This is just a fallback if needed
            Write-Host "  Code signing handled by Tauri build process" -ForegroundColor Gray
        } else {
            Write-Host "[INFO] No code signing certificate found" -ForegroundColor Cyan
        }
    } else {
        Write-Host "[INFO] signtool.exe not found on PATH" -ForegroundColor Cyan
        Write-Host "  Install Windows SDK for code signing support" -ForegroundColor Cyan
    }
} else {
    Write-Host "`n[4/4] Skipping code signing" -ForegroundColor Yellow
}

# Summary
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Build Complete!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Find output artifacts
Write-Host "`n[OUTPUT ARTIFACTS]" -ForegroundColor Cyan

$DistPath = Join-Path $DesktopClientDir "target" "tauri"
if (Test-Path $DistPath) {
    $Installers = Get-ChildItem -Path $DistPath -Filter "*.exe" -Recurse | Where-Object { $_.Name -match "(setup|installer|bundle)" }

    if ($Installers.Count -gt 0) {
        Write-Host "`n  Installers:" -ForegroundColor White
        foreach ($installer in $Installers) {
            Write-Host "    $("$($installer.Name)") - $([math]::Round($installer.Length / 1MB, 2)) MB" -ForegroundColor Yellow
            Write-Host "      Path: $($installer.FullName)" -ForegroundColor Gray
        }
    }

    # Also show raw binary
    $BinaryPath = Join-Path $DesktopClientDir "target\release\kasirmu-app.exe"
    if (Test-Path $BinaryPath) {
        $binary = Get-Item $BinaryPath
        Write-Host "`n  Standalone Binary:" -ForegroundColor White
        Write-Host "    $("$($binary.Name)") - $([math]::Round($binary.Length / 1KB, 2)) KB" -ForegroundColor Yellow
        Write-Host "      Path: $BinaryPath" -ForegroundColor Gray
    }
}

Write-Host "`n[NEXT STEPS]" -ForegroundColor Cyan
Write-Host "  1. Test the installer: Double-click the .exe file above" -ForegroundColor White
Write-Host "  2. Upload to GitHub releases for public distribution" -ForegroundColor White
Write-Host "  3. Update version and publish to Microsoft Store if needed" -ForegroundColor White

Write-Host "`n[VERIFICATION]" -ForegroundColor Cyan
Write-Host "  To test standalone binary: $BinaryPath" -ForegroundColor White

# Show standalone binary location
$BinaryPath = Join-Path $DesktopClientDir "target\$($BuildConfig.ToLower())\kasirmu-app.exe"
if (Test-Path $BinaryPath) {
    Write-Host "`n[STANDALONE BINARY]" -ForegroundColor Cyan
    Write-Host "  Location: $BinaryPath" -ForegroundColor White
    $binaryInfo = Get-Item $BinaryPath
    Write-Host "  Size: $([math]::Round($binaryInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
    Write-Host "  Last Modified: $($binaryInfo.LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "`n[STANDALONE BINARY]" -ForegroundColor Cyan
    Write-Host "  Binary not found at expected location (may be bundled in installer)" -ForegroundColor Yellow
}
