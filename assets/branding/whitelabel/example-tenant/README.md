<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Fresh full audit against branch 0.0.41; the 2026-07-24 Hermes-Agent stamp (79 days old) is merged below as original evidence. · THE REQUIRED-FILE TABLES MATCH THE TREE: the four sections document `vector/` (4 SVGs), `web/` (6 files incl. `icon-maskable-512.png`), `desktop/` (4 files incl. `icon.icns` and `tray-icon.png`) and `hardware/` (3 files); all four subdirectories exist under this template, and the manifest's `assets` block declares paths in exactly these four groups. · THE WARNING IS TRUE AND IS THE POINT OF THE DIRECTORY: "Do not commit placeholder or sample assets" — verified, this template contains ONLY `.gitkeep` files in all four subdirectories plus `manifest.json` and this README, so the "paths document what is expected" reading is the correct one and a reader cannot mistake the template for a working brand. · The two `powershell -File scripts/sync-branding.ps1 -Brand <your-tenant-id>` invocations (plain and `-DryRun`) match the script's real `param()` block. · The recommended sizes are design guidance, not machine-checked anywhere (no gate reads this table) — stated so the numbers are not mistaken for an enforced contract. · NOT re-measured: whether the resize dimensions survive a real sync (no pwsh run this pass). -->
<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md; required-file tables (vector/web/desktop/hardware) match actual subdirs; sync-branding.ps1 -Brand/-DryRun documented correctly -->

> **STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:**
>
> `<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md; required-file tables (vector/web/desktop/hardware) match actual subdirs; sync-branding.ps1 -Brand/-DryRun documented correctly -->`


# Example Tenant — Whitelabel Brand Template

This directory is a **template** for creating a whitelabel tenant brand. Add your own brand assets to the subdirectories listed below before running the sync script.

> **Do not commit placeholder or sample assets to this directory.** The `manifest.json` paths in this template document which files are expected — add real branded files when creating a new tenant.

---

## Directory Structure & Required Files

### `vector/` — Master Logos (SVG, resolution-independent)

| File | Description |
|------|-------------|
| `logo-full.svg` | Primary horizontal logo (wordmark + mark) for light themes |
| `logo-full-dark.svg` | Horizontal logo optimized for dark themes |
| `logo-mark.svg` | Compact square mark (no wordmark) for collapsed sidebars |
| `logo-monochrome.svg` | High-contrast single-color vector for e-paper/watermarks |

### `web/` — Web Favicons & PWA Manifest Icons

| File | Description | Recommended Size |
|------|-------------|-----------------|
| `favicon.ico` | Multi-res ICO for browser tabs | 16×16, 32×32, 48×48 |
| `favicon.svg` | Modern scalable vector favicon | Vector |
| `apple-touch-icon.png` | iOS home screen shortcut | 180×180 px |
| `icon-192.png` | Android / PWA standard icon | 192×192 px |
| `icon-512.png` | PWA splash screen icon | 512×512 px |
| `icon-maskable-512.png` | Adaptive icon with safe-zone padding | 512×512 px |

### `desktop/` — Tauri Desktop & Tablet App Icons

| File | Description | Recommended Size |
|------|-------------|-----------------|
| `icon.ico` | Windows desktop icon, multi-res | 16×16 to 256×256 |
| `icon.icns` | macOS icon bundle | 32×32 to 1024×1024 |
| `icon.png` | Master PNG (Linux .desktop, AppImage) | 1024×1024 px |
| `tray-icon.png` | OS system tray / menu bar icon | 32×32 px |

### `hardware/` — Thermal Receipt & Invoice Assets

| File | Description | Recommended Size |
|------|-------------|-----------------|
| `receipt-logo-58mm.png` | Monochrome bitmap for 58mm thermal printers | 384×100 px |
| `receipt-logo-80mm.png` | Monochrome bitmap for 80mm thermal printers | 576×150 px |
| `invoice-watermark.png` | Semi-transparent watermark for PDF invoices | 512×512 px |

---

## After Adding Files

Run the sync script to apply the brand:

```powershell
powershell -File scripts/sync-branding.ps1 -Brand <your-tenant-id>
```

Use `-DryRun` first to preview what would happen:

```powershell
powershell -File scripts/sync-branding.ps1 -Brand <your-tenant-id> -DryRun
```

> last audited 11-10-26 by docs-auditor
