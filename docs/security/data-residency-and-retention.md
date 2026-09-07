# Data Residency & Retention Policy — OZ-POS

<!-- Authored 2026-09-07 · facts verified against HEAD 3c2fcdb8 by direct code
     inspection (sources cited inline). Implements the documentation deliverable
     of todo-global-saas-3.md §"Define data residency and retention policy" and
     records the adopted §K policy's implemented/decided/unimplemented state.
     Backup/restore *procedures* live in docs/operations/runbook.md §4 — this
     document governs, the runbook operates. -->

This document states where OZ-POS data is stored, how long each class of data
is kept, and how deletion and export requests are handled. It separates three
honesties the reader needs: what is **implemented today**, what is **decided
but not yet built** (adopted policy §K, todo-global-saas-1.md), and what is an
**open gap** recorded here so it cannot be mistaken for a guarantee.

## 1. Where data lives (deployment topology)

One Northflank service, one Docker image, two data stores
(`docs/operations/runbook.md`, docs-auditor stamped):

| Store | Engine | Function | Holds |
|---|---|---|---|
| Sync DB | Postgres, Northflank **managed addon** | cloud sync + REST serving (`apps/cloud-server`) | sales, catalog, inventory, memos, staff users (see §2) |
| Auth DB | PocketBase SQLite (`pb_data/data.db`) | license/auth server (`apps/license-server`) | tenants, machines, subscriptions, license keys, revenue events |

Client devices (desktop + tablet) each hold a **complete local SQLite
database** — the system is offline-first, so the device copy is the working
copy and the cloud copy is partial (only what syncs — see §2). Client backups
are local files written beside the database (`<db>.backup.db`,
`create_backup_scoped`, `DATA_EXPORT`-gated, `apps/desktop-client/src/commands/data.rs`);
they never leave the device unless the operator copies them.

**Residency.** Deployment is **single-region**: region is a property of the
deployment (the Northflank service and its Postgres addon), not a per-tenant
choice. §K's ruling — residency selected at organization creation, moved only
via an explicit support/migration workflow — is **decided, not implemented**:
`legal_entities` carries no region column
(`crates/oz-core/migrations/20260908_legal_entities.sql`), and nothing in the
schema or API expresses per-tenant residency. When that lands, this section is
the contract it must satisfy.

## 2. Data inventory (what syncs, what stays)

Cloud Postgres (row-level-security enforced on all tenant-bearing tables —
`scripts/generate-pg-migration.py` `RLS_TABLES`, fail-closed exemption gate
`07197574`):

- **Sales data**: `sales`, `sale_lines`, `refunds` — pushed from devices
  (`POST /api/v1/sales`, `crates/oz-api/src/lib.rs`). Sale lines are what a
  receipt records; the client-side export deliberately omits them (§5).
- **Catalog & inventory**: `products`, variants/taxes/bundles, `tax_rates`,
  `inventory`, `stock_movements`, `stock_summary`, `categories`, `settings`.
- **Staff accounts**: `users` — `username`, `display_name`, `role_id`,
  **`pin_hash`** (`INSERT INTO users`, `crates/oz-api/src/pg.rs`). Staff PIN
  *hashes* replicate to the cloud; raw PINs never leave the device — PINs are
  hashed with Argon2id at creation (`hash_pin`, `platform/core/src/auth.rs`).
  Treat the cloud user table as personal data.
- **Memos**: `memos`, `memo_locations`, `memo_recipients`, `memo_revisions`
  (desktop-push snapshot, RLS'd, ack-merged).
- **Subscriptions**: `tenant_subscription`, `tenant_plans` (signed capability
  mirror), `sync_terminals` (device registration).
- **Audit**: `audit_log`, `audit_review_checkpoints` — append-only by trigger
  (both engines: `audit_log_immutable_delete` raises on DELETE).
- **Ops**: `offline_queue`, `sent_reports`, `exchange_rates`,
  `snapshot_versions`, `payment_gateways`, `payment_settlements`,
  `stripe_customers`.
- **Structure**: `locations`, `legal_entities` (entity `tax_id` +
  `registration_number` are financial-identity data), `user_location_access`.

**Stays device-local** (never synced): `customers` (names, phones, emails —
no customers write path exists in `crates/oz-api`), client-side outbox rows,
branding/media files, and the full local sale history beyond what was pushed.

Auth DB (PocketBase): tenant **emails** (login identity + receipt contact),
machine fingerprints, signed subscription payloads, license keys, revenue
events (`revenue_events` — provider, amounts, tier), web-OTP sessions,
password-rotation state (superuser email + hash snapshots,
`apps/license-server/password_rotation.go`).

**Telemetry: none.** No third-party analytics or crash-reporting SDK exists in
either client (`ui/package.json`, both `tauri.conf.json` — verified by search)
or in the Rust crates. Server-side `/metrics` (Prometheus) are operational
counters/latencies, not user tracking, and the license server exposes no
metrics at all (runbook §2).

## 3. Retention schedule

| Data class | Retention today | Mechanism |
|---|---|---|
| `offline_queue` (cloud) | **90 days**, enforced | hourly prune, 500-row batches (`start_prune_loop_pg`; runbook §3.6) |
| `sent_reports` dedup claims (cloud) | **90 days**, enforced | same prune |
| Memos (device) | archived → purged at **30 days** | retention sweep (`c8d2a54f` enforced via `archived_at`; daemon `5ee1064a`; `20260914_memo_retention.sql`) |
| `audit_log` | **infinite** — immutable by trigger; no purge exists | see gap below |
| Sales, catalog, inventory, users, memos (cloud) | **no expiry** — kept while the tenant exists | no purge path in `crates/oz-api` (verified: no per-tenant `DELETE`) |
| Local device DB | kept until operator action (backup/restore) | — |

**Decided but not implemented** (P1 audit-baseline item, todo-global-saas-2.md,
still open): tier-based audit retention — Plus 90 days, Pro 180, Premium 1
year, Enterprise 3 with contract override, Free none. Until that lands, the
audit log's immutability is a *correctness* guarantee, not a retention one.

## 4. Deletion & export requests

Implemented today:

- **Client data export** — `export_data` (session + `SETTINGS_EDIT`, path
  contained, `apps/desktop-client/src/commands/data.rs`) writes an `.ozpkg`
  payload (`crates/oz-core/src/ozpkg.rs`): products, categories, settings,
  and *optionally* sale **headers only** ("no lines for privacy"), customers,
  and users **without PIN hashes**. `import_preview`/`import_data` restore it.
- **Client backup/restore** — `create_backup_scoped` produces a full SQLite
  file copy; restore is the operator re-importing it.
- **Tenant deletion (license server)** — `handleAdminDeleteTenant`
  (`apps/license-server/admin_tenant_lifecycle.go`): admin-key gated,
  confirm-email required, admin tenant protected. Deletes machines,
  subscriptions, and web sessions, deletes the tenant record, and **unlinks
  but keeps license keys** — minted keys are the financial audit trail for
  real payments. The reason is logged.

**Open gaps — recorded, not glossed:**

1. **No sync-DB purge.** License-server tenant deletion does not touch the
   Postgres sync DB: there is no per-tenant `DELETE` in `crates/oz-api`
   (verified at HEAD). A deleted tenant's sales/catalog/users rows persist in
   the cloud store. A purge (or crypto-shred) workflow keyed off tenant
   deletion is the main unmet obligation of this policy.
2. **No tenant self-service deletion or export request path.** Both are
   operator/admin actions today.
3. **Backup retention vs. deletion.** PITR snapshots and PocketBase backups
   (runbook §4) will retain deleted tenant data until their windows elapse —
   stated so a "deleted" claim is never stronger than the backup windows
   (Postgres: ≥ 7-day PITR; PocketBase: the litestream/`VACUUM INTO` policy
   actually configured — 30 days in the runbook's example).

## 5. Handling a deletion/export request (operating procedure, today)

1. Export the tenant's portable data via `export_data` on their device
   (operator-assisted; the payload's privacy choices are fixed in code, §4).
2. Delete the tenant record via the license server's admin tenant-delete
   (confirm-email; record the reason) — this kills logins, machines, and
   subscription payloads immediately.
3. Manually purge the tenant's Postgres rows using the RLS-scoped role
   (per-tenant `DELETE` across `RLS_TABLES`) — **manual today**; until the
   purge workflow exists (§4 gap 1), this step is a documented operator runbook
   entry, not an automated guarantee.
4. Note that backups retain the data for their remaining windows (§4 gap 3).

## 6. Business dates, money, timestamps (§K invariants already true)

Money is integer minor units with an explicit currency (`Money`, i64 — repo
rule, migration-gated by `verify-migration-column-types.py`); timestamps are
stored in UTC (RFC 3339 strings); business dates resolve in the location's
timezone. These §K requirements are satisfied by construction and enforced by
existing gates, so residency work inherits them rather than introducing them.

---

*Scope note: this document describes the desktop/tablet SaaS platform. The
website (Cloudflare Workers) and the license-server deployment region are
deployment-level facts (single-region, §1), not per-tenant choices. Updates to
this file must re-verify its claims against HEAD — it names files, columns,
and the absence of code paths, all of which can drift.*
