<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: ACCURATE (0 findings, template-doc verified) · example-tenant/ has all 4 subdirs (vector/web/desktop/hardware) + manifest.json + README.md; required-file tables (vector/web/desktop/hardware) match actual subdirs; sync-branding.ps1 -Brand/-DryRun documented correctly -->

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

> last audited 24-07-26 by Hermes-Agent
