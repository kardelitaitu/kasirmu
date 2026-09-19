---
name: brand-asset-pipeline
description: Regenerate the kasir.mu brand asset set — app icons, favicons, PWA icons and vector logos — from a designer export, and repair drift between the brand source and the places it is copied to. Use when a new logo lands, when an icon shows the wrong or stale mark, when adding a whitelabel tenant under `assets/branding/`, or when `scripts/sync-branding.ps1` skips a step or refuses to run.
---

<!-- Audit stamp: 2026-09-19 · Budak-Korporat · status: ACCURATE · Derived from a full regeneration of the `default` brand on 2026-09-19 (commits ac25c3e32, df5e0ff87, ea3aa2c7e, ea60a3c16) plus the icon.ico decode fix (32ea54472) and the hardware rebrand (6c09d4e1e). Verified this pass: `scripts/sync-branding.ps1` parses clean under PowerShell (PARSE_OK via the parser) and its dry-run runs; `assets/branding/default/manifest.json` declares appName kasir.mu; both app `tauri.conf.json` files end a sync run with a zero diff; `ui/public` and `assets/branding/default/web/` agree byte-for-byte on all six web icons; the logo exports in `ui/public/` are the designer's own files and `ui/public/branding/` holds the four vector variants. The 16-bit ICO trap was confirmed live (cargo check panicked, then passed on the 8-bit file). The hardware receipt logos were regenerated with `-resize WxH! -threshold 50%` (the `!` was a doc bug in the README/script, now fixed) and the watermark reproduced at ~19% mean alpha (measured 13728 vs the old 12600). The ImageMagick and PowerShell behaviours below were measured on this host, not inferred. · Pass 2 (2026-09-19, Android build-repair lane): trap 5 added — the 16-bit **PNG** icon panic. Measured end to end on the Redmi 23073RPBFG: with `windows: []` the bug was silent, and once a window was declared every launch died at `tauri-2.11.3/src/app.rs:1425` with `invalid icon: The specified dimensions (32x32) don't match the number of pixels supplied by the `rgba` argument (2048)`, surfaced as `SIGABRT` and a MIUI `thirdappassistant` crash dialog. The six `default/desktop/*.png` were re-encoded to 8-bit `TrueColorAlpha`, `sync-branding.ps1 -Brand default` propagated them, all 18 destination files verified byte-identical to source, and the app then installed, launched, stayed resumed and rendered (815 distinct colours, no panic). Also confirmed this pass: on a clean tree the sync leaves both `tauri.conf.json` files and `ui/public/site.webmanifest` byte-identical and touches only the timestamp line of `brand-tokens.css`. Left open and NOT this pipeline's bug: with `useHttpsScheme: true` the dev page loads over `https://tauri.localhost`, so Vite's HMR client throws `SecurityError: Failed to construct 'WebSocket'` — a dev-only hot-reload failure owned by `ui/vite.mobile.config.ts`'s `hmr.protocol`. -->

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

**3. The ICO writer emits 16-bit PNG frames under Q16 — and that breaks the build.** ImageMagick on Windows is a Q16 build, so when it packs PNG frames into an ICO every frame is `depth=16`. Tauri's `generate_context!()` proc-macro decodes `apps/desktop-tauri/icons/icon.ico` at compile time and **panics** on a 16-bit frame: `failed to decode icon .../icon.ico: Unsupported PNG bit depth: Sixteen`, which fails the whole app build. The same build also bloats — a 256px BMP frame is 256 KB, so a six-frame `icon.ico` jumps from tens of KB to several hundred KB. Two safe paths, both verified this host:
   1. **`tauri icon assets/source-icon.png`** — canonical, produces an 8-bit `icon.ico` (~18 KB, frames 32/16/24/48/64/256). Copy its `icon.ico` into `assets/branding/default/desktop/`, `apps/desktop-tauri/icons/`, and `apps/mobile-tauri/icons/` (the sync copies the source verbatim, so fixing the source is what survives the next run).
   2. ImageMagick `-depth 8` downscale of the existing file — preserves the original frame set but writes BMP frames and bloats to ~370 KB; only use it if the frame set must stay exact.
   Whichever you pick, `magick identify -format "%[depth]"` must report `8` for every frame before committing. The web `ui/public/favicon.ico` is a separate file and does not block the build, but keep it 8-bit too.

**4. Rasterise per size; do not downscale one master.** `px = viewBox_units × density / 96`, so for the 216-unit mark `density = px × 96 / 216`. A direct render at each target size beats shrinking a large one. SVG export tools emit a small transparent margin that is part of the design — leave it.

Two smaller ones: `pathlib`'s `write_text` translates newlines to CRLF on Windows, which `.gitattributes` (`* text=auto eol=lf`) forbids, so every `git` command will warn — normalise generated SVG to LF. And a Vite `public/` directory is copied **verbatim** into the bundle, so artwork staged there ships; `ui/vite.config.ts` sets no `publicDir`.

## Verify, do not assume

- Every destination file byte-identical to its source. `apps/*/icons/128x128@2x.png` comes from `desktop/256x256.png`, not from a file of its own name.
- Both `tauri.conf.json` files: **zero** diff after the run. Anything else means the manifest disagrees with the app.
- `ui/src/features/design/brand-tokens.css`: the timestamp line only.
- `ui/public/site.webmanifest`: the `name` field, not just that the file was touched.
- Icon files carry the expected frame count at the expected sizes.

## What the pipeline does not own

These hold brand artwork and the sync does not regenerate them; check them after a rebrand:

- The Tauri **platform extras** — `Square*Logo.png`, `StoreLogo.png`, `icons/android/`, `icons/ios/`,
  `gen/android/**/mipmap-*`. They come from `tauri icon` (see the platform-icons section), not from
  this script, and must be regenerated by hand when the source mark changes.
- `website/` — a separate front-end with its own favicon and social image. The favicon must mirror
  `assets/branding/default/vector/logo-mark.svg`; `og-image.svg` / `og-image.png` are designer scope.
- The `themeTokens` HSL values. Changing them restyles the whole application and is a design decision,
  not an asset refresh.

## Hardware assets (receipt logos, invoice watermark) — manual; the script only writes the README

`assets/branding/<brand>/hardware/` holds three committed PNGs the sync never regenerates — the script
only (re)creates that directory's `README.md`: `receipt-logo-58mm.png` (384x100, 1-bit),
`receipt-logo-80mm.png` (576x150, 1-bit), `invoice-watermark.png` (512x512 grayscale-alpha). All three
are the **square source mark** (`assets/source-icon.png`), not a wordmark:

```bash
magick convert assets/source-icon.png -resize 384x100! -threshold 50% assets/branding/$brand/hardware/receipt-logo-58mm.png
magick convert assets/source-icon.png -resize 576x150! -threshold 50% assets/branding/$brand/hardware/receipt-logo-80mm.png
```

The `!` is mandatory: without it ImageMagick aspect-fits and yields 100x100 / 150x150, not the spec
widths, so the receipt layout (which expects 384x100 and 576x150) breaks. The README shipped before
2026-09-19 omitted the `!` — a doc bug, now fixed in both the README and `sync-branding.ps1`.

The watermark has **no** documented command. The committed one is a centred, full-opacity grayscale
mark at ~19% mean alpha (peak 65535). Reproduce by resizing the source to ~274px and compositing centred
in 512x512 with `-colorspace Gray`:
`magick convert assets/source-icon.png -resize 274x274 -colorspace Gray -gravity center -background none -extent 512x512 out.png`.
Measure mean alpha and nudge the resize to land near 12600; exact subtlety is a designer call, so flag it.

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
- `website` (`website/public/`) — has its own `favicon.svg`, `og-image.svg`, `og-image.png`. The
  favicon must mirror `assets/branding/default/vector/logo-mark.svg` (same shape, same blue, same
  grey dot); the social image is a designer call, leave it alone until someone owns it.

## Platform icons (windows store, android, ios) — use `tauri icon`, do not hand-roll

The 10 Windows-Store tiles (`Square30/44/71/89/107/142/150/284/310 + StoreLogo.png`), the 18 iOS
`AppIcon-*` PNGs, and the full Android set (`mipmap-{m,h,xh,xxh,xxxh}dpi/{ic_launcher,ic_launcher_foreground,ic_launcher_round}.png` plus the `mipmap-anydpi-v26/*.xml` and `values/ic_launcher_background.xml`) all live under `apps/desktop-tauri/icons/`. The Android set duplicates into `apps/mobile-tauri/gen/android/app/src/main/res/`. None of them are produced by `scripts/sync-branding.ps1`.

Hand-rendering fails three ways: adaptive icons have a 108dp canvas with a 72dp safe zone, the
`.icns` round-trip needs `iconutil` (macOS-only), and `ic_launcher_round` is a different circle than
`ic_launcher` for many densities. The correct path is:

```bash
# managed, isolated — no ui/package.json touched, no lockfile in repo
cd C:/Users/Dika/.workbuddy-ai/binaries/node/workspace
npm install @tauri-apps/cli@2 --no-audit --no-fund

# run into a temp dir so the eight pipeline-owned files are not touched
"$WS/node_modules/.bin/tauri" icon assets/source-icon.png -o "$SCRATCH/tauri-icon-out"
```

The output matches the existing placeholder layout 1:1 (filename and size per file). Copy only the
platform files (`Square*Logo.png`, `StoreLogo.png`, `android/`, `ios/`). Do **not** copy
`{32x32,64x64,128x128,256x256}.png`, `icon.png`, `icon.ico`, or `icon.icns` — the pipeline owns
those eight and would silently revert a direct overwrite on the next sync.

On first run, `apps/mobile-tauri/gen/android/app/src/main/res/` is missing
`mipmap-anydpi-v26/ic_launcher.xml` and `values/ic_launcher_background.xml`. They are byte-identical
to the desktop side's tracked XMLs, so a diff against the desktop tree confirms zero drift before
committing.

## PWA manifest completeness

The brand-source `assets/branding/default/web/site.webmanifest` and the renderer's
`ui/public/site.webmanifest` must declare **all four** PWA icons, not just two:

```json
{"src":"/icon-192.png","sizes":"192x192","type":"image/png"},
{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"},
{"src":"/android-chrome-192x192.png","sizes":"192x192","type":"image/png"},
{"src":"/android-chrome-512x512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}
```

`index.html` itself names only `favicon.svg / favicon-32 / favicon-16 / favicon.ico /
apple-touch-icon / site.webmanifest` — the manifest entries for `android-chrome-*` are
referenced by Chrome's installability check, not by the page. The PNGs live in `ui/public/`
(untracked unless the owner folds them into `assets/branding/default/web/`); add the rows in
lockstep on both manifests.

> last audited 19-09-26 by Budak-Korporat
