<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Fresh full audit against branch 0.0.41; the 2026-07-24 Hermes-Agent stamp (79 days old, the stalest in this batch) is merged below as original evidence. · EVERY CLAIM VERIFIED: the `example-tenant/` template holds exactly the documented shape — `manifest.json` + `README.md` + the four subdirectories `vector/`, `web/`, `desktop/`, `hardware/`, each carrying only a `.gitkeep` and no sample assets, which is precisely what the template is for; the `Copy-Item -Recurse assets/branding/whitelabel/example-tenant` source path in step 1 resolves; step 4's `powershell -File scripts/sync-branding.ps1 -Brand <your-tenant-id>` matches the script's real interface (`param([string]$Brand = "default", [switch]$DryRun)`, `scripts/sync-branding.ps1:21-24`); the three real brand directories this page points at (`default`, `acme-tenant`, `beta-retail`) all exist and are tracked. · One thing worth stating because a reader could mis-infer it: the sibling brands `acme-tenant` and `beta-retail` are NOT copies of this template — they are materialised brands with real binary assets under git, whereas `whitelabel/example-tenant` is the placeholder-only reference. This page already says so ("serves as a reference for the expected structure"); verified rather than repaired. · NOT re-measured: the sync script's end-to-end behaviour (no pwsh run this pass). -->
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md matching documented layout; Copy-Item source path correct; sync-branding.ps1 accepts -Brand (param line 22) and -DryRun -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence (delimiters stripped so they cannot nest):

**STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:**

`Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md matching documented layout; Copy-Item source path correct; sync-branding.ps1 accepts -Brand (param line 22) and -DryRun -->`

-->
# Whitelabel Tenant Templates

This directory contains template structures for creating whitelabel / multi-tenant brand configurations for kasir.mu.

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

> last audited 11-10-26 by docs-auditor
