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
| `hardware/` | Thermal receipt bitmaps, invoice watermark | the print and PDF paths |

The full required-file list per directory, with sizes, lives in
[`whitelabel/example-tenant/README.md`](whitelabel/example-tenant/README.md).
It is stated **once** there rather than repeated per tenant, so there is a
single place to correct it.

## manifest.json is an input, not documentation

Each tenant has one, and the sync script **reads it and patches other files
from it**:

| Field | Written to |
|---|---|
| `appName` | both `apps/*-tauri/tauri.conf.json` (`productName`, window titles), `site.webmanifest` |
| `companyName` | brand tokens |
| `themeTokens.primaryHsl` / `accentHsl` / `fontFamily` | `ui/src/features/design/brand-tokens.css` (regenerated whole) |
| `assets.*` | the paths the script copies from |

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
