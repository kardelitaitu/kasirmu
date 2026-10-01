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
