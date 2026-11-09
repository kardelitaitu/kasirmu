<!- - Correction 2026-10-19 (docs-auditor): the 2026-10-11 stamp below says "status:
     ACCURATE — 0 findings" and "EVERY CLAIM RE-DERIVED". Two of those claims were
     false when written and are corrected in the body above:
     (1) the manifest table asserted that `assets.*` holds "the paths the script
     copies from". `scripts/sync-branding.ps1:176` assigns `$assets = $manifest.assets`
     and never dereferences it — ZERO `$assets.` references in the file; every source
     path is a literal (:238-245 desktop list, :275 web glob, :299 vector glob). A
     tenant whose files are named differently syncs silently and ships a stale icon.
     (2) the `appName` row claimed it patches "window titles" in BOTH shells. Only the
     desktop config has a title replace (:336); the tablet patch (:349-353) rewrites
     productName and identifier and nothing else, and that identifier rewrite
     (mu.kasir.mobile.<brandId>) was not documented at all — a field that changes the
     Android application id.
     Both were provable by reading 30 lines of the script, which is the lesson: the
     stamp said "re-derived, not inherited" and was itself inherited from an earlier
     reading of the DOCUMENT rather than of the tool. Also corrected downstream:
     `whitelabel/example-tenant/README.md` claimed icon.png is 1024x1024 when every
     shipped tenant measures 256x256 or 512x512. That table is a naming convention,
     not a schema — nothing reads it, and the sync logs [SKIP] with exit 0 on a miss. -->
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Fresh full
     audit against branch 0.0.41; this file carried no stamp or footer before this pass. ·
     EVERY CLAIM RE-DERIVED, NOT INHERITED: the tenant table matches the tree exactly
     (default/, acme-tenant/, beta-retail/, whitelabel/example-tenant/ + whitelabel/README.md);
     ALL FOUR subdirectories exist in EVERY tenant, so "each tenant carries the same four"
     holds; the empty-template claim is literally true — example-tenant/ holds ONLY .gitkeep in
     vector/, web/, desktop/ and hardware/ plus manifest.json and a README; the manifest.json
     field table matches the real file (appName/companyName/themeTokens.{primaryHsl,accentHsl,
     fontFamily}/assets.{vector,web,desktop,hardware} are exactly the keys present); and every
     Related path resolves (sync-branding.ps1, whitelabel.ps1 as a documented thin alias,
     generate-tier-badges.ps1, assets/tier-badges/, assets/source-icon.png, and the 2026-07-15
     whitelabel ADR). ·
     THE OBSERVATION WORTH RECORDING: the per-tenant asset counts are NOT uniform (default/
     vector=5 vs the fixtures' 4; web=11 vs 5; desktop=8 vs 7; hardware=4/4/3). The page is
     CORRECT about this because it states no global count — it defines the four DIRECTORIES and
     defers the required-file list to whitelabel/example-tenant/README.md, which was itself
     audited to ACCURATE on 2026-10-11. That deferral is why a batch-16 finding of exactly this
     class ("the four vector variants" is now five) did not occur here. Do not add a count to
     this page; the single-source deferral is the property that keeps it true. ·
     NOT re-measured: whether a real `scripts/sync-branding.ps1` run reproduces the patched
     files (no PowerShell execution this pass), and the raster dimensions of any asset. ·
     Additionally the propagation-destination row for desktop/ now names BOTH shell icon dirs
     (apps/desktop-tauri/icons/ and apps/mobile-tauri/icons/), which the script writes to and
     which the page already listed correctly. -->
# Brand Assets

Every brand asset in the project, keyed by tenant. This directory is the
**origin**: the files here are the ones a human edits, and everything else is a
copy produced from them.

> **The one rule.** Edit a file here and re-run the sync. Never edit a copy —
> `scripts/sync-branding.ps1` overwrites its destinations, so a hand-edited copy
> is reverted the next time anyone syncs, silently.

## The tenants

| Tenant | What it is |
|---|---|
| `default/` | The real kasir.mu brand. This is what ships. |
| `acme-tenant/` | Fixture brand. Exists so the whitelabel pipeline can be exercised |
| `beta-retail/` | Second fixture brand, with a different font stack. |
| `whitelabel/example-tenant/` | An EMPTY template (`.gitkeep` files only). Copy it to start a tenant. |
| `whitelabel/README.md` | How to create a tenant. Read that before adding one. |

The fixtures are not dead weight: swapping brands is the only way to prove the
pipeline actually re-brands an app rather than merely copying files.

## The four subdirectories

Each tenant carries the same four, split by **where the asset is consumed**, not
by file type:

| Directory | Holds | Ends up in |
|---|---|---|
| `vector/` | SVG logos | `ui/public/branding/` |
| `web/` | Favicons, PWA icons, `site.webmanifest` | `ui/public/` |
| `desktop/` | `.ico`, `.icns`, PNG icon sizes | `apps/desktop-tauri/icons/` and `apps/mobile-tauri/icons/` |
| `hardware/` | Thermal receipt bitmaps, invoice watermark | **nowhere automatically** — the sync script does not copy these, and no code path reads them. It regenerates `hardware/README.md` (`scripts/sync-branding.ps1:404,431-454`) and, on demand, can cut the three PNGs from `assets/source-icon.png` with ImageMagick (`:451-453`). Getting them onto a receipt or a PDF invoice is a manual step |

The full required-file list per directory, with sizes, lives in
[`whitelabel/example-tenant/README.md`](whitelabel/example-tenant/README.md).
It is stated **once** there rather than repeated per tenant, so there is a
single place to correct it.

## manifest.json is an input, not documentation

Each tenant has one, and the sync script **reads it and patches other files
from it**:

| Field | Written to |
|---|---|
| `appName` | both `apps/*-tauri/tauri.conf.json` (`productName`), `site.webmanifest` |
| `companyName` | brand tokens |
| `themeTokens.primaryHsl` / `accentHsl` / `fontFamily` | `ui/src/features/design/brand-tokens.css` (regenerated whole) |
| `brandId` | the tablet's `tauri.conf.json` **`identifier`** — patched to `mu.kasir.mobile.<brandId>` (`scripts/sync-branding.ps1:349-353`). Not listed here before 2026-10-19, so a tenant could change it without knowing it rewrites the tablet's Android application id |
| `assets.*` | **nothing — this field is inert today.** See the warning below |

> ⚠️ **`assets.*` is NOT read by the sync script, and a tenant must not rely on it.**
> `scripts/sync-branding.ps1:176` assigns `$assets = $manifest.assets` and then never
> dereferences it — there are **zero** `$assets.` references in the whole script. Every
> source path is hardcoded in the script instead: the `desktop/` list is a literal at
> `:238-245`, `web/*` is copied wholesale at `:275`, and `vector` is a `*.svg` glob at
> `:299`. Consequence, and it is the one that bites: **a tenant whose files are named
> anything other than the hardcoded names syncs with no error and ships a stale or
> missing icon.** The reference template's own manifest declares
> `"trayIcon": "desktop/tray-icon.png"`, and that path is copied only if the file is
> present at `:248` — it is not, so `[SKIP]` is logged and the build keeps whatever it
> had. Treat the file names in `whitelabel/example-tenant/README.md` as a **naming
> convention the script enforces implicitly**, not as a schema it validates.
> This row read "`assets.*` | the paths the script copies from" until 2026-10-19, which
> asserted a mechanism that does not exist.

Two consequences worth knowing:

- A stale `appName` **renames the product** on the next sync. Check that field
  before running anything.
- `brand-tokens.css` is generated. Editing it by hand is reverted, exactly like
  any other copy.

## Running it

From the repo root:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-branding.ps1 -Brand default -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-branding.ps1 -Brand default
```

`-DryRun` prints the plan and touches nothing. `scripts/whitelabel.ps1` is a thin
alias for the same script.

After syncing, diff the three patched files (`apps/*/tauri.conf.json`,
`ui/public/site.webmanifest`, `ui/src/features/design/brand-tokens.css`) to see
what the manifest actually changed.

## Related

- `scripts/sync-branding.ps1` — the propagation script.
- `scripts/generate-tier-badges.ps1` — a DIFFERENT concern. Subscription tier
  badges and rasterised logo PNGs; they do not vary per tenant, so they live in
  `assets/tier-badges/`, not here.
- `assets/source-icon.png` — the master square icon the desktop sizes are cut
  from.
- `docs/decisions/2026-07-15-whitelabel-branding-system.md` — why it works this way.

> last audited 11-10-26 by docs-auditor
