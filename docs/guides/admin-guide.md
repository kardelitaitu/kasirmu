# Admin Guide — OZ-POS

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (3 findings) · SUPERSEDES the 2026-07-26 stamp; its observation O1 still stands and is carried forward here: this doc lists KDS as a top-level "Workspace" beside Store POS / Inventory / Admin, while the seed registers workspace_key='kds' as a SCREEN under restaurant-pos rather than a standalone workspace type — a deliberate user-facing simplification, not a code error, but a reader who administers the DB will not find a kds workspace_type row. Re-verified accurate this pass: workspace_types seeded store-pos / inventory / restaurant-pos / admin; roles Owner / Manager / Cashier / Kitchen; shift open/close, cash payout, offline queue, and the five reports (sales, eod, menu-engineering, custom, inventory) all map to real features; scripts/backup-db.sh and scripts/restore-db.sh exist; the upgrade path via PUT /api/v1/tenants/{tenant_id}/plan matches the live handler, which really is free|pro only. Repaired: (1) the setup wizard offers SIX presets (Simple Retail, Restaurant, Full Store, Cafe / Bakery, Franchise, Custom) and the page listed three — and the stamp it sat under had certified the shortened list as "consistent with workspace seeds", which is the failure mode this whole audit keeps finding: a check that confirms a summary rather than comparing it to the source; (2) PIN is 4-8 digits, not 4-6 — min 4 enforced twice (CreatePinScreen.tsx:44 and commands/auth.rs:192), max 8 applied by silent truncation in digitsOnly() (slice(0, 8)), so a long paste is cut rather than rejected; (3) removed a shadow stamp from the footer block — a "status: ACCURATE (0 findings)" line sitting outside the <!-- Audit stamp --> comment, contradicting the real stamp's 1 observation and unfindable by check-audit-stamps.py. -->

## Installation

1. Download the latest release from GitHub Releases
2. Run the installer (Windows: `.msi`, Linux: `.AppImage`)
3. On first launch, follow the setup wizard to:
   - Set store name, currency, and tax settings
   - Create the owner account (username + PIN)
   - Choose a workspace preset — the wizard offers **six**: Simple Retail, Restaurant,
     Full Store, Cafe / Bakery, Franchise, and Custom
     (`ui/src/features/setup/SetupWizard.tsx`, `PRESETS`). This line listed three until
     08-09-26, and the 2026-07-26 audit stamp below actively certified it as "user-facing
     guidance consistent with workspace seeds" — certifying a shortened list as correct is
     worse than not checking it, because the check is what a later reader trusts.

## Workspace Management

Navigate to **Admin → Workspaces** to manage workspace types:

| Workspace | Purpose |
|-----------|---------|
| Store POS | Point of sale — customer-facing checkout |
| Inventory | Product management, stock counts, transfers |
| KDS | Kitchen display — order tickets for kitchen staff |
| Admin | Settings, staff management, reporting |

## User Management

1. Go to **Admin → Staff**
2. Click **+ Add Staff** to create a new user
3. Set **role** (owner, manager, cashier, kitchen)
4. Assign a **PIN** (**4–8 digits**) for quick login. The minimum is 4, enforced twice:
   `CreatePinScreen.tsx:44` and again server-side at
   `apps/desktop-client/src/commands/auth.rs:192`. The maximum is 8, and it is not an
   error — `digitsOnly()` at `CreatePinScreen.tsx:36` does `.slice(0, 8)`, so a longer
   paste is silently truncated rather than rejected. "4-6" was wrong at the top end and
   described a bound nothing enforces.

### Roles

| Role | Permissions |
|------|-------------|
| Owner | Full access — settings, staff, reporting, data export |
| Manager | Staff management, reporting, inventory |
| Cashier | POS only — sales, refunds, shift open/close |
| Kitchen | KDS only — view and acknowledge orders |

## Shift Management

1. At start of day: **Open Shift** → enter opening cash balance
2. During the day: process sales normally
3. At end of day: **Close Shift** → review sales summary → confirm
4. Cash payouts (e.g., for supplies): **Cash Payout** in shift screen

## Reporting

Navigate to **Admin → Reports** for:

- **Sales Report**: Daily/weekly revenue, top products, category breakdown
- **EOD Report**: End-of-day summary with payments, taxes, discounts
- **Menu Engineering**: Profitability vs popularity analysis
- **Custom Report**: Build your own reports by selecting columns and date ranges
- **Inventory Report**: Stock levels, low stock alerts, stock value

## Backup & Restore

### Backup
```bash
bash scripts/backup-db.sh
```
Creates a timestamped gzipped backup in `./backups/`. Prunes backups older than 30 days.

### Restore
```bash
bash scripts/restore-db.sh backups/oz-pos-20260720-120000.db.gz
```
Verifies integrity, creates a pre-restore safety backup, replaces the active database.

## Offline Mode

The POS continues operating without internet:
- All sales, shifts, and inventory changes are queued locally
- Data syncs automatically when connection is restored
- Check **Admin → Offline Queue** to see pending sync items
- Status bar indicator: 🟢 online / 🟡 reconnecting / 🔴 offline

### Cloud sync plans

Cloud sync is a paid feature (ADR sync-plan-gating). When the server has
`OZ_ENFORCE_PLANS=1`:

- A tenant on the **free** plan runs the POS fully locally but cannot
  push/pull to the cloud server — the server returns `403
  plan_required`, and **Settings → Cloud Sync** shows an upgrade prompt
  instead of a generic sync error.
- Queued items on a free tenant stay `pending` — they are valid, just
  gated, and sync automatically once the tenant is upgraded.
- Upgrade the tenant via `PUT /api/v1/tenants/{tenant_id}/plan` (with the
  `X-Admin-Key` header when `OZ_ADMIN_KEY` is configured) or automatically
  via a paid Stripe subscription.

> last audited 08-09-26 by docs-auditor

<!-- The two blockquote lines that used to sit under the footer — "audit: Phase 1 Core
Architecture & API Docs Audit" and "status: ACCURATE (0 findings) · verified accurate:
cargo check passed, no structural orphans, no stale version headers, all file references
valid" — were removed. The second is a shadow stamp: it has the shape and authority of an
audit stamp but sits in footer position, outside the <!-- Audit stamp --> comment, so no
tool looks for it and no rule governs it. It also contradicted the real stamp on this page,
which reported 1 observation, and its "0 findings" claim is contradicted by the preset
error it sat above. If you want to record an audit pass, write a stamp; a status line in
the footer is invisible to the stamp checker and misleading to a reader. -->

