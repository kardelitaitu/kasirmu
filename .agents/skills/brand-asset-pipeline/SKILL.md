---
name: brand-asset-pipeline
description: Regenerate the kasir.mu brand asset set — app icons, favicons, PWA icons and vector logos — from a designer export, and repair drift between the brand source and the places it is copied to. Use when a new logo lands, when an icon shows the wrong or stale mark, when adding a whitelabel tenant under `assets/branding/`, or when `scripts/sync-branding.ps1` skips a step or refuses to run.
---

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: ACCURATE · Derived from a full regeneration of the `default` brand on 2026-09-19 (commits ac25c3e32, df5e0ff87, ea3aa2c7e, ea60a3c16). Verified this pass: `scripts/sync-branding.ps1` parses clean under PowerShell 7.5.5 and exits 0; `assets/branding/default/manifest.json` declares appName kasir.mu; both app `tauri.conf.json` files end a sync run with a zero diff; `ui/public` and `assets/branding/default/web/` agree byte-for-byte on all six web icons; the logo exports sitting directly in `ui/public/` are the designer's own files, and `ui/public/branding/` holds the four vector variants. The ImageMagick and PowerShell behaviours below were measured on this host, not inferred. -->

# Brand Asset Pipeline

Brand artwork has **one hand-authored source and many generated copies**. Edit the source; never edit a copy. A copy that is edited by hand is reverted the next time the sync runs, silently.

## The one rule

`assets/branding/<brand>/` is the source of truth. Everything else is a destination:

| Destination | Written by | Contents |
|---|---|---|
| `apps/desktop-tauri/icons/` | sync | the 8 core app icons |
| `apps/mobile-tauri/icons/` | sync | the same 8 |
| `ui/public/` | sync | favicons, PWA icons, `site.webmanifest` |
| `ui/public/branding/` | sync | the four vector variants |

Run it from the repo root:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-branding.ps1 -Brand default -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-branding.ps1 -Brand default
```

`-DryRun` prints the plan without touching anything. `-Brand <id>` selects a tenant directory.

## The manifest is an input, not documentation

`assets/branding/<brand>/manifest.json` supplies `appName`, `companyName` and `themeTokens`. The script **patches files from those fields**:

- both `apps/*-tauri/tauri.conf.json` → `productName`, `identifier`, every window `title`
- `ui/public/site.webmanifest` → `name` and `short_name`
- `ui/src/features/design/brand-tokens.css` → regenerated whole

So a stale `appName` renames the product on the next sync. Check that field before running anything, and diff the three patched files afterwards. For the `default` brand the correct identifier values are `mu.kasir.app` (desktop) and `mu.kasir.mobile` (tablet); a tenant gets `mu.kasir.<brandId>`.

## Four traps, all measured

**1. ImageMagick cannot be executed from the PowerShell tool.** `magick -version` returns nothing and writes no file, while the same binary works from bash. `Get-Command magick.exe` still *resolves*, so the script's detection passes and the failure surfaces as a conversion error. Symptom: `[WARN] Failed to generate any PNG tiles for .icns`. Run rasterisation from bash instead.

**2. `.icns` has no ImageMagick writer, and no reader either.** The file is written by the sync script's own PowerShell IconFamily packer, and only when `desktop/icon.icns` is *absent* — delete it to force a rebuild. Since that path needs ImageMagick, pack the container directly when trap 1 bites: magic `icns`, a big-endian total length, then one entry per size of a 4-byte OSType, a big-endian entry length and the PNG payload. The six codes are `ic11` 16, `ic12` 32, `ic13` 64, `ic07` 128, `ic08` 256, `ic09` 512. `identify` cannot verify it — parse the container and check the length field equals the file size.

**3. The ICO writer emits uncompressed BMP frames.** A 256px BMP frame is 256 KB, so a six-frame `icon.ico` jumps from tens of KB to several hundred KB. Build the container directly to get PNG frames: an ICONDIR of reserved 0, type 1, count N; then 16-byte entries of width, height, 0, 0, planes 1, bpp 32, payload size and payload offset; then the PNG payloads. A dimension of 256 is encoded as 0.

**4. Rasterise per size; do not downscale one master.** `px = viewBox_units × density / 96`, so for the 216-unit mark `density = px × 96 / 216`. A direct render at each target size beats shrinking a large one. SVG export tools emit a small transparent margin that is part of the design — leave it.

Two smaller ones: `pathlib`'s `write_text` translates newlines to CRLF on Windows, which `.gitattributes` (`* text=auto eol=lf`) forbids, so every `git` command will warn — normalise generated SVG to LF. And a Vite `public/` directory is copied **verbatim** into the bundle, so artwork staged there ships; `ui/vite.config.ts` sets no `publicDir`.

## Verify, do not assume

- Every destination file byte-identical to its source. `apps/*/icons/128x128@2x.png` comes from `desktop/256x256.png`, not from a file of its own name.
- Both `tauri.conf.json` files: **zero** diff after the run. Anything else means the manifest disagrees with the app.
- `ui/src/features/design/brand-tokens.css`: the timestamp line only.
- `ui/public/site.webmanifest`: the `name` field, not just that the file was touched.
- Icon files carry the expected frame count at the expected sizes.

## What the pipeline does not own

These hold brand artwork and will still show the old mark after a sync. Check them rather than assuming a regeneration covered the brand:

- `assets/branding/<brand>/hardware/` — receipt logos and invoice watermarks. Hand-composed; the recipe in that directory's README does not reproduce the committed files.
- The Tauri **platform extras** — `Square*Logo.png`, `StoreLogo.png`, `icons/android/`, `icons/ios/`, `gen/android/**/mipmap-*`. These come from the Tauri CLI's icon command, which is not a dependency of this repo, and ship as the framework's placeholder artwork.
- `website/` — a separate front-end with its own favicon and social image.
- The `themeTokens` HSL values. Changing them restyles the whole application and is a design decision, not an asset refresh.

A brand that owns only `desktop/` and `web/` is complete; a brand missing `vector/` breaks the renderer, because `ui/src/features/auth/StaffLoginScreen.tsx` loads the mark from `ui/public/branding/`.

## Committing

One logical change per commit. The asset commit and the source fix are separate:

```bash
git add -- assets/branding/default/web/256x256.png && git commit -m "feat(branding): add the 256px web icon" -- assets/branding/default/web/256x256.png assets/branding/default/manifest.json
```

A new file cannot enter a pathspec commit on its own, so the `add` names only untracked new paths and the commit pathspec is a superset. Inspect the dirty set immediately before committing and again immediately after: other sessions write to `ui/public` directly, and a write landing in the seconds between the check and the commit is swept in under your subject.

## Related

- `docs/decisions/2026-07-15-whitelabel-branding-system.md` — the pipeline's design and the multi-tenant contract.
- `ui-components` — the renderer conventions the vector logos feed into.

> last audited 19-09-26 by Budak-Korporat
