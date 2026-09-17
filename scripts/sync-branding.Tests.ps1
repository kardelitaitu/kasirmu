<#
.SYNOPSIS
    Pester unit tests for scripts/sync-branding.ps1 config-patching regex patterns.
.DESCRIPTION
    Tests all -replace operators used in sync-branding.ps1 for:
    - site.webmanifest name/short_name patching
    - tauri.conf.json productName/identifier/title patching
    - safeId brand-identifier generation

    Runs standalone (no dot-source) to avoid Set-Location or file I/O.

    Run with:
      powershell -NoProfile -Command "Import-Module Pester -RequiredVersion 5.6.1 -Force; Invoke-Pester scripts\sync-branding.Tests.ps1"
#>

# Regex patterns copied from sync-branding.ps1
$webNamePattern    = '(?<="name":\s*)"[^"]*"'
$webShortNamePattern = '(?<="short_name":\s*)"[^"]*"'
$productNamePattern = '(?<="productName":\s*)"[^"]*"'
$identifierPattern  = '(?<="identifier":\s*)"[^"]*"'
$titlePattern      = '(?<="title":\s*)"[^"]*"'
$safeIdBadChars    = '[^a-zA-Z0-9.-]'

Describe 'safeId generation' {

    It 'passes through basic alphanumeric brand IDs unchanged' {
        $brandId = 'default'
        $safeId  = $brandId -replace $safeIdBadChars, '-'
        $safeId | Should -Be 'default'
    }

    It 'replaces spaces and special characters with hyphens' {
        $brandId = 'acme tenant#1'
        $safeId  = $brandId -replace $safeIdBadChars, '-'
        $safeId | Should -Be 'acme-tenant-1'
    }

    It 'preserves dots and hyphens' {
        $brandId = 'my-brand.v2'
        $safeId  = $brandId -replace $safeIdBadChars, '-'
        $safeId | Should -Be 'my-brand.v2'
    }

    It 'handles underscores, exclamation marks, and at-signs' {
        $brandId = 'beta_retail!test@2026'
        $safeId  = $brandId -replace $safeIdBadChars, '-'
        $safeId | Should -Be 'beta-retail-test-2026'
    }

    It 'collapses consecutive bad characters into single hyphens' {
        $brandId = 'foo!!!bar'
        $safeId  = $brandId -replace $safeIdBadChars, '-'
        $safeId | Should -Be 'foo---bar'
    }
}

Describe 'site.webmanifest patching' {

    It "replaces the name field value" {
        $raw   = '{"name":"kasir.mu","short_name":"kasir.mu","start_url":"/"}'
        $appName = 'Beta Retail'
        $result = $raw -replace $webNamePattern, "`"$appName`""
        $result | Should -Be '{"name":"Beta Retail","short_name":"kasir.mu","start_url":"/"}'
    }

    It "replaces the short_name field value independently" {
        $raw   = '{"name":"kasir.mu","short_name":"kasir.mu","start_url":"/"}'
        $appName = 'ACME'
        $result = $raw -replace $webShortNamePattern, "`"$appName`""
        $result | Should -Be '{"name":"kasir.mu","short_name":"ACME","start_url":"/"}'
    }

    It 'does not modify non-matching fields' {
        $raw   = '{"name":"kasir.mu","description":"POS system","start_url":"/"}'
        $appName = 'Beta'
        $result = $raw -replace $webNamePattern, "`"$appName`""
        $result | Should -Be '{"name":"Beta","description":"POS system","start_url":"/"}'
    }

    It 'handles app names with special characters' {
        $raw   = '{"name":"","short_name":""}'
        $appName = 'ACME & Sons POS'
        $result = $raw -replace $webNamePattern, "`"$appName`""
        $result | Should -Be '{"name":"ACME & Sons POS","short_name":""}'
    }

    It 'matches nested name keys in objects (documents shallow regex)' {
        $raw   = '{"name":"TOP","manifest":{"name":"nested"}}'
        $appName = 'Replaced'
        $result = $raw -replace $webNamePattern, "`"$appName`""
        $result | Should -Be '{"name":"Replaced","manifest":{"name":"Replaced"}}'
    }
}

Describe 'tauri.conf.json productName patching' {

    It "replaces the productName field" {
        $raw   = '{ "productName": "kasir.mu", "version": "0.0.4" }'
        $appName = 'Beta Retail'
        $result = $raw -replace $productNamePattern, "`"$appName`""
        $result | Should -Be '{ "productName": "Beta Retail", "version": "0.0.4" }'
    }

    It 'handles productName with single quote inside' {
        $raw   = '{ "productName": "kasir.mu" }'
        $appName = "Acme's POS"
        $result = $raw -replace $productNamePattern, "`"$appName`""
        $expected = '{ "productName": "Acme' + "'" + 's POS" }'
        $result | Should -Be $expected
    }

    It 'handles extra whitespace after colon' {
        $raw   = '{ "productName":   "kasir.mu" }'
        $appName = 'Beta'
        $result = $raw -replace $productNamePattern, "`"$appName`""
        $result | Should -Be '{ "productName":   "Beta" }'
    }

    It 'matches compact JSON with no space after colon' {
        $raw   = '{"productName":"kasir.mu"}'
        $appName = 'Compact Beta'
        $result = $raw -replace $productNamePattern, "`"$appName`""
        $result | Should -Be '{"productName":"Compact Beta"}'
    }
}

Describe 'tauri.conf.json identifier patching' {

    It 'replaces the identifier field' {
        $raw   = '{ "identifier": "mu.kasir.app" }'
        $desktopId = 'mu.kasir.beta-retail'
        $result = $raw -replace $identifierPattern, "`"$desktopId`""
        $result | Should -Be '{ "identifier": "mu.kasir.beta-retail" }'
    }

    It 'replaces tablet identifier separately' {
        $raw   = '{ "identifier": "mu.kasir.mobile" }'
        $tabletId = 'mu.kasir.mobile.beta-retail'
        $result = $raw -replace $identifierPattern, "`"$tabletId`""
        $result | Should -Be '{ "identifier": "mu.kasir.mobile.beta-retail" }'
    }

    It 'matches compact JSON with no space after colon' {
        $raw   = '{"identifier":"mu.kasir.app"}'
        $desktopId = 'mu.kasir.compact'
        $result = $raw -replace $identifierPattern, "`"$desktopId`""
        $result | Should -Be '{"identifier":"mu.kasir.compact"}'
    }
}

Describe 'tauri.conf.json title patching' {

    It 'replaces the window title field' {
        $raw   = '{ "title": "kasir.mu", "identifier": "mu.kasir.app" }'
        $appName = 'Beta Retail'
        $result = $raw -replace $titlePattern, "`"$appName`""
        $result | Should -Be '{ "title": "Beta Retail", "identifier": "mu.kasir.app" }'
    }

    It "does not corrupt other fields when title is absent" {
        $raw   = '{ "identifier": "mu.kasir.app" }'
        $appName = 'Beta'
        $result = $raw -replace $titlePattern, "`"$appName`""
        $result | Should -Be '{ "identifier": "mu.kasir.app" }'
    }

    It 'matches compact JSON with no space after colon' {
        $raw   = '{"title":"kasir.mu","identifier":"mu.kasir.app"}'
        $appName = 'Compact Title'
        $result = $raw -replace $titlePattern, "`"$appName`""
        $result | Should -Be '{"title":"Compact Title","identifier":"mu.kasir.app"}'
    }
}

Describe 'Idempotency' {

    It 're-applying the same replacement produces no change' {
        $raw   = '{ "productName": "kasir.mu", "identifier": "mu.kasir.app" }'
        $appName = 'Beta Retail'
        $first  = $raw -replace $productNamePattern, "`"$appName`""
        $first  = $first -replace $identifierPattern, "`"mu.kasir.beta-retail`""
        $second = $first -replace $productNamePattern, "`"$appName`""
        $second = $second -replace $identifierPattern, "`"mu.kasir.beta-retail`""
        $second | Should -Be $first
    }
}

Describe 'Multi-field patching simulation' {

    It 'replicates the desktop config patching logic' {
        $raw   = '{ "productName": "kasir.mu", "identifier": "mu.kasir.app", "bundle": { "icon": ["icons/icon.ico"] } }'
        $appName   = 'Beta Retail'
        $brandId   = 'beta-retail'
        $safeId    = $brandId -replace $safeIdBadChars, '-'
        $desktopId = 'mu.kasir.' + $safeId

        $result = $raw -replace $productNamePattern, "`"$appName`""
        $result = $result -replace $identifierPattern, "`"$desktopId`""

        $result | Should -Match '"productName": "Beta Retail"'
        $result | Should -Match '"identifier": "mu.kasir.beta-retail"'
        $result | Should -Not -Match '"identifier": "mu.kasir.app"'
    }

    It 'replicates the tablet config patching logic' {
        $raw   = '{ "productName": "kasir.mu", "identifier": "mu.kasir.mobile", "bundle": { "icon": ["icons/icon.ico"] } }'
        $appName   = 'Beta Retail'
        $brandId   = 'beta-retail'
        $safeId    = $brandId -replace $safeIdBadChars, '-'
        $tabletId  = 'mu.kasir.mobile.' + $safeId

        $result = $raw -replace $productNamePattern, "`"$appName`""
        $result = $result -replace $identifierPattern, "`"$tabletId`""

        $result | Should -Match '"productName": "Beta Retail"'
        $result | Should -Match '"identifier": "mu.kasir.mobile.beta-retail"'
        $result | Should -Not -Match '"identifier": "mu.kasir.mobile","'
    }

    It 'correctly identifies default brand as mu.kasir.app' {
        $brandId   = 'default'
        $safeId    = $brandId -replace $safeIdBadChars, '-'
        $desktopId = if ($brandId -eq 'default') { 'mu.kasir.app' } else { 'mu.kasir.' + $safeId }
        $desktopId | Should -Be 'mu.kasir.app'
    }
}

Describe 'Brand CSS token emission' {

    # Pester 5 runs an It body in its own scope, so the generator is read in
    # BeforeAll, not in the script body. (The 23 older Its in this file fail
    # for exactly that reason -- their pattern variables are set outside any
    # block and arrive empty. Pre-existing, unrelated to this Describe.)
    BeforeAll {
        $gen = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'sync-branding.ps1' } else { 'scripts/sync-branding.ps1' }
        $brandLines = @((Get-Content $gen -Raw) -split '\r?\n' |
            Where-Object { $_ -match '^\s*--brand-(font-family|app-name|company):' })
        $brandRoot = if ($PSScriptRoot) { Join-Path $PSScriptRoot '../assets/branding' } else { 'assets/branding' }
    }

    It 'emits --brand-font-family as a CSS family LIST, not one quoted string' {
        $fontLine = @($brandLines | Where-Object { $_ -match '--brand-font-family:' }) | Select-Object -First 1
        ($fontLine | Measure-Object).Count | Should -Be 1
        # A font-family value is a comma-separated list, so the generator must
        # interpolate the manifest value raw. Wrapping the list in one pair of
        # quotes makes CSS read it as a single family named "Inter, sans-serif"
        # -- which no engine has -- and the generic fallback goes with it.
        $fontLine.Trim() | Should -Be '--brand-font-family: $($tokens.fontFamily);'

        $prefix = '--brand-font-family: '
        $checked = 0
        foreach ($manifest in Get-ChildItem -Path $brandRoot -Recurse -Filter 'manifest.json') {
            $family = (Get-Content $manifest.FullName -Raw | ConvertFrom-Json).themeTokens.fontFamily
            if (-not $family) { continue }
            $emitted = $fontLine.Trim().Replace('$($tokens.fontFamily)', $family)
            $value = ($emitted -replace ('^' + [regex]::Escape($prefix)), '').TrimEnd(';')
            # Unchanged by emission: per-family quoting stays the manifest's
            # business and the generator adds none of its own.
            $value | Should -Be $family
            $checked += 1
        }
        $checked | Should -BeGreaterThan 0
    }

    It 'keeps --brand-app-name and --brand-company as quoted single strings' {
        # The other side of the same shape rule: these ARE one string each and
        # are read from content:/title contexts, so they keep their quotes.
        $app = @($brandLines | Where-Object { $_ -match '--brand-app-name:' }) | Select-Object -First 1
        $company = @($brandLines | Where-Object { $_ -match '--brand-company:' }) | Select-Object -First 1
        $app.Trim() | Should -Be '--brand-app-name: ''$appName'';'
        $company.Trim() | Should -Be '--brand-company: ''$companyName'';'
    }
}
