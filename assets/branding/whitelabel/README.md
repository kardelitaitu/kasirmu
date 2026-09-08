<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md matching documented layout; Copy-Item source path correct; sync-branding.ps1 accepts -Brand (param line 22) and -DryRun -->

# Whitelabel Tenant Templates

This directory contains template structures for creating whitelabel / multi-tenant brand configurations for OZ-POS.

## Purpose

Each tenant brand gets its own folder under `assets/branding/<tenant-id>/` with a `manifest.json` and the required asset files. The `example-tenant/` directory serves as a reference for the expected structure and file naming conventions.

## Creating a New Tenant

1. **Copy the template:**
   ```powershell
   Copy-Item -Recurse assets/branding/whitelabel/example-tenant assets/branding/<your-tenant-id>
   ```

2. **Edit `manifest.json`:**
   - Set `brandId` to your tenant identifier (e.g., `"my-brand"`)
   - Set `appName`, `companyName`, and `description`
   - Customize `themeTokens` (HSL color values and font family)
   - Update `assets` paths if your file names differ

3. **Add your brand assets** to each subdirectory (see `example-tenant/README.md` for required file names, formats, and sizes)

4. **Run the sync script** to apply the brand across the codebase:
   ```powershell
   powershell -File scripts/sync-branding.ps1 -Brand <your-tenant-id>
   ```

## Directory Layout

```
whitelabel/
└── example-tenant/           # Reference template
    ├── manifest.json          # Brand configuration
    ├── vector/                # SVG logos (vector, resolution-independent)
    ├── web/                   # Web favicons & PWA manifest icons
    ├── desktop/               # Tauri desktop/tablet app icons
    └── hardware/              # Thermal receipt & invoice assets
```

Each tenant brand folder under `assets/branding/` follows the exact same structure.

> last audited 24-07-26 by Hermes-Agent
