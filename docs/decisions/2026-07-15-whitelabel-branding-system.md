---
num: 12
area: theming
title: ADR #12: Whitelabel Branding System — Manifest-Driven Asset Pipeline & Multi-Tenant Theming
status: Implemented (2026-07-15)
---
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, claims verified) · 3 brand templates (default/acme-tenant/beta-retail) confirmed; whitelabel/ dir is a helper (example-tenant/ + README.md), not a 4th brand; scripts/sync-branding.ps1 + whitelabel.ps1 + .Tests.ps1 + .Integration.Tests.ps1 all exist; all 3 manifest.json exist; ui/public/site.webmanifest + ui/src/features/design/brand-tokens.css + ui/src/frontend/shell/ThemeProvider.tsx (useBrand/deriveAccentPalette) present; 4th brand claim intentionally absent -->

# ADR #12: Whitelabel Branding System — Manifest-Driven Asset Pipeline & Multi-Tenant Theming

**Status:** Implemented (2026-07-15)
**Date:** 2026-07-15
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** branding, whitelabel, theming, multi-tenant, pwa, icons, desktop, manifest

---

## Context

kasir.mu is designed as a white-label POS platform that can be rebranded for different tenants, resellers, or enterprise customers. Each tenant requires:

- A **custom app name** and **company name** displayed throughout the UI
- **Theme colours** (primary, accent) injected as CSS variables
- **Custom font family** for the brand's typography
- **Desktop icons** (`.ico`, `.icns`, `.png` at multiple resolutions) for Tauri-packaged Windows, macOS, and Linux builds
- **Web/PWA icons** (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) for the web frontend and progressive web app
- **Vector logos** (light, dark, monochrome, and mark variants) for UI components
- **Hardware assets** (receipt logos at 58mm/80mm, invoice watermarks) for thermal printers and PDF generation
- **Tauri configuration patches** — `productName`, `identifier` (e.g., `mu.kasir.app` → `mu.kasir.acme-tenant`), and window `title`
- **PWA manifest updates** — `name` and `short_name` in `site.webmanifest`, plus standardized icon references

Previously, all branding was hardcoded for the default kasir.mu identity. Adding a new tenant required manual edits across multiple config files, icon directories, and build outputs. There was no repeatable process, no dry-run preview, and no automated testing for branding consistency.

### Requirements

- **Manifest-driven**: Each brand has a single `manifest.json` that declares all assets and tokens. The sync script reads this manifest and distributes assets to the correct locations.
- **Idempotent**: Running the sync script multiple times produces the same result. Re-applying the same brand configuration is a no-op.
- **Dry-run support**: Preview all changes without modifying any files, to verify correct asset resolution before committing.
- **Multiple brand templates**: A `default` brand for kasir.mu itself, plus templates for tenant onboarding (e.g., `acme-tenant`, `beta-retail`).
- **Asset fallback**: The default brand is the canonical source. Tenant brands override only what they need — missing assets are detected at sync time (not runtime) with clear [SKIP] warnings.
- **Automated testing**: Integration tests verify the full sync pipeline, and unit tests verify the regex-based config patching patterns in isolation.
- **macOS .icns generation**: Auto-generate the Apple IconFamily format from a source PNG using ImageMagick + binary packing, without requiring macOS tools.
- **Backward-compatible**: Existing installations continue to work. The `sync-branding.ps1` script can be run at any time to refresh brand assets without affecting runtime behavior.

---

## Decision

### 1. Brand Directory Structure

Each brand lives under `assets/branding/<brand-id>/` with a standard directory layout:

```
assets/branding/
├── <brand-id>/
│   ├── manifest.json          # Brand declaration — app name, tokens, asset paths
│   ├── desktop/
│   │   ├── icon.ico           # Windows icon (multi-res)
│   │   ├── icon.icns          # macOS icon (auto-generated from source PNG)
│   │   ├── icon.png           # Master PNG (typically 512x512)
│   │   ├── tray-icon.png      # System tray icon
│   │   ├── 32x32.png          # Size-specific PNGs
│   │   ├── 64x64.png
│   │   ├── 128x128.png
│   │   └── 256x256.png
│   ├── web/
│   │   ├── favicon.ico        # Legacy favicon
│   │   ├── favicon.svg        # Modern vector favicon
│   │   ├── apple-touch-icon.png
│   │   ├── icon-192.png       # PWA icon (192x192)
│   │   ├── icon-512.png       # PWA icon (512x512)
│   │   └── icon-maskable-512.png  # Adaptive icon (Android)
│   ├── vector/
│   │   ├── logo-full.svg          # Full logo (light background variant)
│   │   ├── logo-full-dark.svg     # Full logo (dark background variant)
│   │   ├── logo-mark.svg          # Icon/symbol only
│   │   └── logo-monochrome.svg    # Single-colour variant for receipts
│   └── hardware/
│       ├── receipt-logo-58mm.png  # 1-bit bitmap for 58mm thermal printers
│       ├── receipt-logo-80mm.png  # 1-bit bitmap for 80mm thermal printers
│       ├── invoice-watermark.png  # Subtle watermark for PDF invoices
│       └── README.md              # Generation instructions
└── default/                   # Canonical kasir.mu brand — reference implementation
```

### 2. The Brand Manifest (`manifest.json`)

Every brand declares its identity in `manifest.json`:

```json
{
  "brandId": "acme-tenant",
  "appName": "ACME POS",
  "companyName": "ACME Corporation",
  "description": "Retail Point of Sale for ACME supplies",
  "themeTokens": {
    "primaryHsl": "14, 100%, 53%",
    "accentHsl": "38, 92%, 50%",
    "fontFamily": "\"DM Sans\", \"Inter\", sans-serif"
  },
  "assets": {
    "vector": {
      "logoFullLight": "vector/logo-full.svg",
      "logoFullDark": "vector/logo-full-dark.svg",
      "logoMark": "vector/logo-mark.svg",
      "logoMonochrome": "vector/logo-monochrome.svg"
    },
    "web": {
      "faviconIco": "web/favicon.ico",
      "faviconSvg": "web/favicon.svg",
      "appleTouchIcon": "web/apple-touch-icon.png",
      "icon192": "web/icon-192.png",
      "icon512": "web/icon-512.png"
    },
    "desktop": {
      "iconIco": "desktop/icon.ico",
      "iconPng": "desktop/icon.png"
    },
    "hardware": {
      "receiptLogo58mm": "hardware/receipt-logo-58mm.png",
      "receiptLogo80mm": "hardware/receipt-logo-80mm.png",
      "invoiceWatermark": "hardware/invoice-watermark.png"
    }
  }
}
```

Key fields:
- **`brandId`**: Used for reverse-DNS Tauri identifiers (`mu.kasir.<brandId>`). Sanitized to `[a-zA-Z0-9.-]` for safe iOS/Android bundle IDs.
- **`appName`**: Displayed in window titles, PWA manifests, About screens, and Tauri `productName`.
- **`companyName`**: Legal entity name for licensing, copyright notices, and the About dialog.
- **`themeTokens`**: HSL values injected into `brand-tokens.css` at sync time. Font family string is passed through verbatim.
- **`assets`**: Declarative mapping of logical asset names to filesystem paths relative to the brand directory. The sync script iterates these entries to copy files to their destinations.

### 3. The Sync Pipeline (`sync-branding.ps1`)

The sync script (`scripts/sync-branding.ps1`) is the single entry point for brand deployment. It performs these operations in order:

#### Step 1: Brand Validation
- Verify the brand directory and `manifest.json` exist
- Parse manifest for `appName`, `companyName`, `brandId`, `themeTokens`, `assets`
- Display a header showing which brand is being synced

#### Step 2: `.icns` Auto-Generation (macOS)
- If `desktop/icon.icns` does not exist for the brand, attempt auto-generation from `assets/source-icon.png` (the master source icon at the repo root)
- Uses ImageMagick (`magick convert`) to generate PNG tiles at 6 standard sizes (16, 32, 64, 128, 256, 512 px)
- Packs the tiles into the Apple IconFamily binary format using a pure-PowerShell `BinaryWriter`
- The `.icns` magic bytes (`0x69 0x63 0x6E 0x73`) and OSType entries (`ic11`–`ic13`, `ic07`–`ic09`) are written manually — no macOS `iconutil` dependency
- Falls back gracefully with a [SKIP] warning if ImageMagick or the source PNG is unavailable

#### Step 3: Desktop Icons → App Icon Directories
- Copies 7 icon formats to both `apps/desktop-client/icons/` and `apps/tablet-client/icons/`:
  - `icon.ico`, `icon.icns`, `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `256x256.png`
- The 256x256 PNG also serves as `128x128@2x.png` (Retina) for both apps
- Missing source files produce [SKIP] warnings (non-fatal) — the destination retains previously synced assets

#### Step 4: Web/PWA Icons → `ui/public/`
- Copies all files from `assets/branding/<brand-id>/web/` to `ui/public/`
- These are served statically by Vite and referenced from `index.html` / `index.tablet.html`:
  - `favicon.ico` — legacy browser favicon
  - `favicon.svg` — modern vector favicon (dark-mode aware)
  - `apple-touch-icon.png` — iOS home screen icon
  - `icon-192.png` — PWA icon (192x192)
  - `icon-512.png` — PWA icon (512x512 for splash screens; declared with `"purpose": "any maskable"` in `site.webmanifest` for Android adaptive icon support)
  - `icon-maskable-512.png` — Dedicated maskable variant for Android adaptive icons (optional; default brand only)

  **Filename standardization**: Earlier icon names (`android-chrome-192x192.png`, `android-chrome-512x512.png`) were device-specific. These were renamed to generic `icon-*.png` names (accompanied by `apple-touch-icon.png` and `favicon.*`) to decouple filenames from any single platform. The `site.webmanifest`, `index.html`, and `index.tablet.html` were updated to reference the new names.

#### Step 5: Vector Logos → `ui/public/branding/`
- Copies all `*.svg` files from the brand's `vector/` directory to `ui/public/branding/`
- These are loaded at runtime by React components (e.g., login screen, receipt headers, admin dashboard)
- Creates the `ui/public/branding/` directory if it doesn't exist

#### Step 6: PWA Manifest Patching (`site.webmanifest`)
- Reads `ui/public/site.webmanifest` (already exists from previous sync or initial setup)
- Applies targeted regex replacements:
  - `"name": "..."` → `"name": "<appName>"`
  - `"short_name": "..."` → `"short_name": "<appName>"`
- Preserves all other fields — no reformatting, no structural changes
- The regex uses a lookbehind assertion `(?<="name":\s*)` to match only the value portion

#### Step 7: Tauri Config Patching
- Reads `apps/desktop-client/tauri.conf.json` and `apps/tablet-client/tauri.conf.json`
- Applies targeted regex replacements:

| Field | Desktop | Tablet |
|-------|---------|--------|
| `productName` | `<appName>` | `<appName>` |
| `identifier` | `mu.kasir.<safeId>` | `mu.kasir.tablet.<safeId>` |
| `title` | `<appName>` | — (tablet has no window title) |

- **`safeId` generation**: `brandId` sanitized to `[a-zA-Z0-9.-]` (replaces invalid characters with `-`)
- **Default brand special case**: `default` always resolves to `mu.kasir.app` / `mu.kasir.tablet` (no suffix)
- Regex patterns match both compact JSON (`{"key":"val"}`) and formatted JSON (`{ "key": "val" }`) with flexible whitespace

#### Step 8: Brand CSS Token Generation
- Generates `ui/src/features/design/brand-tokens.css` with runtime CSS variables:

```css
:root {
  --brand-primary: hsl(175, 70%, 40%);
  --brand-accent:  hsl(200, 80%, 50%);
  --brand-font-family: '"Plus Jakarta Sans", "Inter", sans-serif';
  --brand-app-name: 'Beta Retail';
  --brand-company: 'Beta Retail Group Ltd';
}
```

- Note: While these CSS variables are generated, the **runtime theming** uses a different mechanism — the `useBrand()` hook (in `ThemeProvider.tsx`) derives an accent palette from the `primary_colour` database setting and applies it via `deriveAccentPalette()` + `applyAccentPalette()` directly to `<html>` element styles. The `brand-tokens.css` file serves as a **build-time reference** for the generated tokens and potential future static import.

#### Step 9: Hardware Asset README
- Creates `assets/branding/<brand-id>/hardware/README.md` if it doesn't exist, documenting expected hardware asset files and ImageMagick generation commands
- Also generates receipt-logo bitmaps and watermark templates at sync time if the master source icon is available

### 4. Identifier Naming Convention

Tauri identifiers follow a consistent reverse-DNS pattern:

| Brand | Desktop Identifier | Tablet Identifier |
|-------|-------------------|-------------------|
| `default` | `mu.kasir.app` | `mu.kasir.tablet` |
| `acme-tenant` | `mu.kasir.acme-tenant` | `mu.kasir.tablet.acme-tenant` |
| `beta-retail` | `mu.kasir.beta-retail` | `mu.kasir.tablet.beta-retail` |

This convention ensures:
- All app identifiers are namespaced under `mu.kasir.`
- Tablet builds are clearly distinguished from desktop builds
- No identifier conflicts across tenants
- macOS/iOS code signing profiles can be pre-configured per tenant

### 5. Whitelabel Wrapper (`whitelabel.ps1`)

A thin alias script (`scripts/whitelabel.ps1`) wraps `sync-branding.ps1` with the same interface:

```powershell
powershell -File scripts\whitelabel.ps1                     # default brand
powershell -File scripts\whitelabel.ps1 -Brand "my-tenant"  # custom tenant
powershell -File scripts\whitelabel.ps1 -DryRun             # preview
```

This exists purely as a discoverable entry point — `sync-branding.ps1` remains the canonical implementation.

### 6. Brand Templates

Three brand templates are provided:

| Brand ID | App Name | Primary HSL | Accent HSL | Font Family |
|----------|----------|-------------|------------|-------------|
| `default` | kasir.mu | `210, 80%, 55%` (blue) | `160, 75%, 45%` (teal) | `Inter, sans-serif` |
| `acme-tenant` | ACME POS | `14, 100%, 53%` (orange) | `38, 92%, 50%` (amber) | `"DM Sans", "Inter", sans-serif` |
| `beta-retail` | Beta Retail | `175, 70%, 40%` (teal) | `200, 80%, 50%` (blue) | `"Plus Jakarta Sans", "Inter", sans-serif` |

Additional templates can be created by copying the directory structure and updating `manifest.json`.

### 7. Testing Strategy

Three layers of automated testing ensure branding consistency:

#### Layer 1: Unit Tests (`sync-branding.Tests.ps1`)
Pester unit tests that validate regex patterns in isolation (no file I/O):
- `safeId` generation — alphanumeric, special chars, dots/hyphens
- `site.webmanifest` name/short_name patching — single and multi-field, special characters, nested objects
- `tauri.conf.json` productName/identifier/title patching — whitespace variants, compact JSON, dual-device identifiers
- Multi-field patching simulation — desktop + tablet configs
- Idempotency — re-applying the same replacement produces no change

#### Layer 2: Integration Tests (`sync-branding.Integration.Tests.ps1`)
End-to-end tests that run the full sync pipeline against all three brands (13 tests):
- **Brand resolution** (1 test): directories exist, manifests parse correctly for all 3 brands
- **Desktop icons** (2 tests): all 7 formats × 2 apps = 14 copies resolve correctly; 256x256 → 128x128@2x mapping
- **Web icons** (1 test): all expected files (favicon.ico, favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png) appear in `ui/public/`
- **Vector logos** (1 test): SVGs copied to `ui/public/branding/`
- **Web manifest** (1 test): `name` and `short_name` updated to brand's `appName` via regex
- **Tauri desktop config** (2 tests): `productName`, `identifier`, and `title` patched correctly; default brand gets `mu.kasir.app`
- **Tauri tablet config** (2 tests): `productName` and `identifier` patched (no title); default gets `mu.kasir.tablet`
- **Brand CSS** (1 test): token file generated with correct HSL values for each brand
- **Hardware README** (1 test): created if missing
- **Idempotency** (1 test): re-running the sync produces the same output (no double-patching)

#### Layer 3: Dry-Run Verification
The `-DryRun` flag enables safe preview before any writes:
- All operations print `[DRY]` with the proposed action
- No files are created, modified, or deleted
- Used as a pre-commit validation step

### 8. .icns Generation (macOS)

The `New-IcnsFromPng` function in `sync-branding.ps1` implements a pure-PowerShell Apple IconFamily encoder:

1. **ImageMagick** (`magick convert`) generates 6 PNG tiles: 16, 32, 64, 128, 256, 512 px
2. Each tile is assigned an OSType code: `ic11` (16), `ic12` (32), `ic13` (64), `ic07` (128), `ic08` (256), `ic09` (512)
3. A `System.IO.BinaryWriter` writes the `.icns` magic header, total file size, and each entry's OSType + size + PNG data
4. The size field is written as a big-endian `int32` at the end (seek back to the placeholder offset)

ImageMagick stderr is suppressed (`2>$null`) because it emits deprecation warnings even on success.

---

## Whitelabel Client Onboarding Workflow

To onboard a new whitelabel tenant:

1. **Create brand directory**: `cp -r assets/branding/default assets/branding/<tenant-id>`
2. **Edit manifest**: Update `brandId`, `appName`, `companyName`, `description`, and `themeTokens`
3. **Replace assets**: Swap `desktop/`, `web/`, `vector/`, and `hardware/` files with tenant's branding
4. **Dry-run**: `powershell -File scripts\whitelabel.ps1 -Brand <tenant-id> -DryRun` — verify all paths resolve
5. **Sync**: `powershell -File scripts\whitelabel.ps1 -Brand <tenant-id>` — apply branding
6. **Build**: Build Tauri desktop/tablet apps — branded output is produced
7. **Commit**: Include the brand directory and any updated config files in version control

For deployment-only (no source changes), the sync script can be run in CI to refresh branding before each build.

---

## Options Considered

### Option A — Manifest-Driven Scripted Sync (Chosen)

A PowerShell script that reads a declarative `manifest.json`, copies assets to destination directories, and patches config files via regex.

- **Pro**: Single source of truth — all brand config in one file
- **Pro**: Idempotent — safe to run repeatedly
- **Pro**: Dry-run mode for preview
- **Pro**: Auto-generates macOS `.icns` without macOS tooling
- **Pro**: Easy CI integration (PowerShell on Windows, pwsh on Linux/macOS)
- **Con**: Requires PowerShell 7+ for cross-platform
- **Con**: Regex patching on JSON is fragile if the config structure changes

### Option B — Tauri Build-Time Hooks (Rejected)

Use Tauri v2's beforeDevCommand/beforeBuildCommand to run an inline script or plugin.

- **Pro**: Tightly integrated with the build process
- **Pro**: No separate sync step needed
- **Con**: Tauri hooks cannot modify `tauri.conf.json` at build time (it's read before the hook runs)
- **Con**: Cannot preview changes before building
- **Con**: No dry-run support
- **Con**: Harder to test in isolation

### Option C — Vite Plugin for Asset Replacement (Rejected)

A custom Vite plugin that replaces brand assets at dev/build time.

- **Pro**: Web-only scope — doesn't affect Tauri config
- **Con**: Only addresses web icons, not desktop icons or config patching
- **Con**: Requires the plugin to know about brand directories
- **Con**: No macOS `.icns` generation
- **Con**: Cannot patch Tauri config (separate build pipeline)

### Option D — Environment Variable Injection (Rejected)

Use `TAURI_*` environment variables and Vite `import.meta.env` to customize branding at build time.

- **Pro**: No filesystem changes needed
- **Con**: Only covers `appName` and trivial config — cannot handle binary assets
- **Con**: No icon replacement mechanism
- **Con**: No CSS variable generation
- **Con**: Complex fallback logic for unset vars

### Option E — Rust `build.rs` Script (Rejected)

A Tauri build script that reads the manifest and patches configs at compile time.

- **Pro**: Cross-platform (Rust)
- **Con**: Must duplicate the OS-specific icon handling (`.ico` in Windows, `.icns` in macOS)
- **Con**: `tauri.conf.json` is already processed by the Tauri build system before `build.rs` runs
- **Con**: Harder to test — requires compiling to verify
- **Con**: No dry-run preview

---

## Consequences

### Positive

- **Single source of truth**: Every brand's identity is declared in one `manifest.json`.
- **Repeatable pipeline**: The sync script produces deterministic, verifiable output.
- **Dry-run safety**: Preview all changes before applying them — critical for CI/CD.
- **macOS .icns auto-generation**: No macOS build machine required for `.icns` creation.
- **Comprehensive testing**: 13 integration tests + 20+ unit tests cover edge cases and idempotency.
- **Discoverable**: The `whitelabel.ps1` wrapper makes the script easy to find.
- **CI-ready**: Can be run in any CI pipeline (PowerShell on Windows, `pwsh` on Linux/macOS).
- **Backward-compatible**: Existing `default` brand is the canonical reference; all existing `tauri.conf.json` files are patched in place but produce the same identifiers.

### Negative

- **PowerShell dependency**: The script requires PowerShell 7+ (or Windows PowerShell 5.1 on Windows). Linux/macOS CI must install `pwsh`.
- **Regex patching on JSON**: The `-replace` patterns assume consistent JSON formatting. If Tauri changes its config schema (e.g., restructuring the identifier field), the regex must be updated. However, the unit tests catch such breakage at test time.
- **No runtime brand switching**: Brand is a build-time concern. Switching brands requires re-running the sync script and rebuilding the apps. Runtime multi-tenant serving (a single binary that detects the tenant at startup) is explicitly out of scope.
- **Binary assets in git**: Icon files (`.ico`, `.png`, `.icns`) are binary and add to repository size. Each brand template adds ~200–500 KB of binary assets.
- **Brand CSS is reference-only**: The generated `brand-tokens.css` is not actually imported at runtime — the app uses a JS-based palette derivation from the database `primary_colour` setting. This is a documented gap that could be addressed in the future by importing the tokens CSS as a fallback for server-side rendering or build-time injection.

### Mitigations

- **PowerShell compatibility**: The script uses `param()` and `Set-Location` — both compatible with PowerShell 7+ on all platforms. CI configurations include `pwsh` installation.
- **Regex brittleness**: Unit tests in `sync-branding.Tests.ps1` cover all regex patterns with at least 4 cases each (compact JSON, formatted JSON, special characters, edge cases). CI fails if the regex breaks.
- **Binary asset size**: Icon files are optimized for PNG compression. The `source-icon.png` at the repo root serves as the single master asset — brand-specific icons are only stored when they differ from the default.
- **CSS gap**: Documented in this ADR. If future requirements demand build-time CSS injection (e.g., server-side rendering), the `brand-tokens.css` file provides the template.

---

## Related

- `scripts/sync-branding.ps1` — The canonical sync implementation
- `scripts/whitelabel.ps1` — Discoverable alias wrapper
- `scripts/sync-branding.Tests.ps1` — Unit tests for regex patterns (~20 tests)
- `scripts/sync-branding.Integration.Tests.ps1` — End-to-end integration tests (13 tests)
- `assets/branding/default/manifest.json` — Canonical brand manifest (reference)
- `assets/branding/acme-tenant/manifest.json` — Example tenant manifest
- `assets/branding/beta-retail/manifest.json` — Example tenant manifest
- `apps/desktop-client/tauri.conf.json` — Patched at sync time
- `apps/tablet-client/tauri.conf.json` — Patched at sync time
- `ui/public/site.webmanifest` — Patched at sync time
- `ui/src/features/design/brand-tokens.css` — Generated CSS tokens (reference only)
- `ui/src/frontend/shell/ThemeProvider.tsx` — Runtime palette derivation (alternative mechanism)
- `docs/decisions/2026-03-01-frontend-restructure.md` — ADR #3: Frontend structure (consumer of branded assets)

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
