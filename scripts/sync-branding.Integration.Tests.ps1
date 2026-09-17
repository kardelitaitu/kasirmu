<#
.SYNOPSIS
    Integration tests for scripts/sync-branding.ps1 with a fully mocked file system.
.DESCRIPTION
    Runs sync-branding.ps1 with all external dependencies mocked so no actual
    files are read, written, or copied. Tests verify the script completes
    without throwing for valid inputs, and handles invalid inputs gracefully.

    CRITICAL: All mock return values are HARDCODED (string literals) inside
    the mock closures rather than referencing variables. This avoids Pester 3's
    module-scope variable resolution issues where $script: variables in mock
    closures resolve to Pester's internal module scope instead of the test file.

    Run with: powershell -NoProfile -Command "Invoke-Pester scripts\sync-branding.Integration.Tests.ps1"
#>

# Shadow exit once globally to prevent exit 1 from killing the test runner.
# WARNING: This shadow is TEST-ONLY — it silently discards all exit codes.
# Never dot-source this file outside Pester; the global `exit` override
# would suppress real failures in production scripts.
function global:exit { param([int]$code = 0) }

# ---------------------------------------------------------------------------
# Tests - DryRun path (no file writes)
# ---------------------------------------------------------------------------
Describe 'sync-branding.ps1 integration - DryRun' {

    BeforeEach {
        # Single Get-Content mock that dispatches on path
        # NOTE: No param($Path) - Pester 5 proxy function makes $Path available as automatic variable
        Mock Get-Content {
            if      ($Path -like '*manifest.json')   { return '{ "brandId": "test-brand", "appName": "Test App", "companyName": "Test Company", "description": "Integration test brand", "themeTokens": { "primaryHsl": "210, 80%, 55%", "accentHsl": "160, 75%, 45%", "fontFamily": "Inter, sans-serif" }, "assets": { "vector": { "logoFullLight": "", "logoFullDark": "", "logoMark": "", "logoMonochrome": "" }, "web": { "faviconSvg": "" }, "desktop": { "iconIco": "", "iconPng": "" }, "hardware": { "receiptLogo58mm": "", "receiptLogo80mm": "" } } }' }
            if      ($Path -like '*tauri.conf.json')  { return '{ "productName": "kasir.mu", "identifier": "mu.kasir.app", "version": "0.0.4", "bundle": { "icon": ["icons/icon.ico"] } }' }
            if      ($Path -like '*site.webmanifest') { return '{"name":"kasir.mu","short_name":"kasir.mu","start_url":"/"}' }
            return $null
        }

        # File existence - default all true
        Mock Test-Path { return $true }

        # Hide ImageMagick so New-IcnsFromPng is never entered
        Mock Get-Command { return $null }
        Mock Get-ChildItem { return @() }

        # File operations - no-ops
        Mock Copy-Item { }
        Mock New-Item { $null }
        Mock Set-Content { }
        Mock Remove-Item { }

        # File info for .icns size reporting
        Mock Get-Item { return @{ Length = 150000 } }

        # Directory navigation - no-op
        Mock Set-Location { }

        # Console output - suppress
        Mock Write-Host { }
    }

    It 'completes without throwing for test-brand' {
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -Brand 'test-brand' -DryRun } | Should -Not -Throw
    }

    It 'completes without throwing for acme-tenant' {
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -Brand 'acme-tenant' -DryRun } | Should -Not -Throw
    }

    It 'completes without throwing for default brand' {
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -Brand 'default' -DryRun } | Should -Not -Throw
    }

    It 'handles missing site.webmanifest gracefully' {
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*site.webmanifest*' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun } | Should -Not -Throw
    }

    It 'handles missing tauri configs gracefully' {
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*tauri.conf.json*' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun } | Should -Not -Throw
    }

    It 'handles missing desktop icons gracefully' {
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*desktop/*' -or $Path -like '*desktop\*' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun } | Should -Not -Throw
    }

    It 'handles missing vector SVGs gracefully' {
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*vector/*' -or $Path -like '*vector\*' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun } | Should -Not -Throw
    }

    It 'handles missing web icons gracefully' {
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*web/*' -or $Path -like '*web\*' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun } | Should -Not -Throw
    }
}

# ---------------------------------------------------------------------------
# Tests - Error paths
# ---------------------------------------------------------------------------
Describe 'sync-branding.ps1 integration - Error handling' {

    BeforeEach {
        Mock Set-Location { }
        Mock Write-Host { }
    }

    It 'handles missing brand directory gracefully' {
        Mock Test-Path { return $false }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -Brand 'test-brand' -DryRun } | Should -Not -Throw
    }

    It 'handles missing manifest.json gracefully' {
        Mock Test-Path { return $true }
        Mock Test-Path { return $false } -ParameterFilter { $Path -like '*manifest.json' }
        { . (Join-Path $PSScriptRoot 'sync-branding.ps1') -Brand 'test-brand' -DryRun } | Should -Not -Throw
    }
}

# ---------------------------------------------------------------------------
# Tests - Call counts
# ---------------------------------------------------------------------------
Describe 'sync-branding.ps1 integration - Call verification' {

    BeforeEach {
        # Global counters for mock call tracking (Assert-MockCalled unreliable for Get-Content in Pester 3)
        $global:getContentCount = 0
        $global:setContentCount = 0
        $global:getCommandCount = 0

        # Single Get-Content mock that dispatches on path
        # NOTE: No param($Path) - Pester 5 proxy function makes $Path available as automatic variable
        Mock Get-Content {
            $global:getContentCount++
            if      ($Path -like '*manifest.json')   { return '{ "brandId": "test-brand", "appName": "Test App", "companyName": "Test Co", "themeTokens": { "primaryHsl": "0,0%,0%", "accentHsl": "0,0%,0%", "fontFamily": "Arial" }, "assets": { "vector": {}, "web": {}, "desktop": {}, "hardware": {} } }' }
            if      ($Path -like '*tauri.conf.json')  { return '{ "productName": "kasir.mu", "identifier": "mu.kasir.app", "version": "0.0.4" }' }
            if      ($Path -like '*site.webmanifest') { return '{"name":"kasir.mu","short_name":"kasir.mu"}' }
            return $null
        }

        Mock Test-Path { return $true }

        Mock Get-Command {
            $global:getCommandCount++
            return $null
        }

        Mock Get-ChildItem { return @() }
        Mock Copy-Item { }
        Mock New-Item { $null }
        Mock Set-Content { $global:setContentCount++ }
        Mock Remove-Item { }
        Mock Get-Item { return @{ Length = 150000 } }
        Mock Set-Location { }
        Mock Write-Host { }
    }

    It 'does not call Set-Content during dry run' {
        . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun
        $global:setContentCount | Should -Be 0
    }

    It 'calls Get-Content once during dry run (manifest.json only)' {
        . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun
        # During dry run, Get-Content is only called once for manifest.json.
        # The webmanifest and tauri config reads are inside `if (-not $DryRun)` blocks.
        $global:getContentCount | Should -Be 1
    }

    It 'calls Get-Command to detect ImageMagick (once per candidate)' {
        . (Join-Path $PSScriptRoot 'sync-branding.ps1') -DryRun
        $global:getCommandCount | Should -Be 3
    }
}
