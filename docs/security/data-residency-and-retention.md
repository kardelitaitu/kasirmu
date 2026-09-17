# Data Residency & Retention Policy — kasir.mu

<!-- Audit stamp: 2026-09-09 · DSH · status: VERIFIED-TRUE, 2 precision notes (0 errors) · Every load-bearing claim re-checked against code rather than against the document's own confidence, and the page held: legal_entities has no region column (20260908_legal_entities.sql carries id, tenant_id, name, legal_name, registration_number, tax_id, status, created_at, updated_at - so §K residency really is decided-not-built); crates/oz-api contains ZERO references to customers, which is stronger than the claimed 'no write path'; the pin_hash citation is exact (pg.rs:421 INSERT INTO users (... pin_hash ...)); hash_pin is Argon2id (platform/core/src/auth.rs:9,18 with m=19456,t=2,p=1); the audit-delete trigger exists in BOTH engines (20260813_init.pg.sql:1468/1480 and 20260813_init.sql:1046); stripe_customers is real; create_backup_scoped (data.rs:605) writes .backup.db (:574) behind a DATA_EXPORT gate (:599/611); telemetry is genuinely absent (0 of 38 ui dependencies, 0 in ui/src); and every retention number holds - RETENTION_DAYS=90 (prune.rs:20), hourly via from_secs(3600) (:45), PRUNE_BATCH_SIZE=500 (:22), start_prune_loop_pg real (prune.rs:165, wired at cloud-server/main.rs:347), the 30-day memo commits c8d2a54fd and 5ee1064a1 both exist, and 20260914_memo_retention.sql exists. Two cited migrations looked missing only because an ls|head -4 truncated the list. · PRECISION NOTE 1 (metrics): the page said the license server exposes no metrics, which is true of that process while the deployed image still answers /metrics on the same origin - Caddy sends it to :3099, which is oz-cloud-server. For a residency policy the distinction is load-bearing: an auditor checking whether auth data leaves via metrics must look at the sync server, not at the absence of a route in apps/license-server. · PRECISION NOTE 2 (the headline gap): 'no per-tenant DELETE in crates/oz-api' was true in spirit and false to a grep, because pg.rs:1975 deletes memos by tenant_id during snapshot reconciliation. Restated as no per-tenant ERASURE, naming the reconciliation line and noting that the tenant-wide shapes exist only in pg_tests.rs cleanup - so nobody cites one as evidence of the other. · This is the strongest page of its kind in the repo: it already separates implemented / decided-not-built / open-gap and cites sources inline. Nothing was softened and no gap was closed on paper. -->

<!-- Authored 2026-09-07 · facts verified against HEAD 3c2fcdb8 by direct code
     inspection (sources cited inline). Implements the documentation deliverable
     of todo-global-saas-3.md §"Define data residency and retention policy" and
     records the adopted §K policy's implemented/decided/unimplemented state.
     Backup/restore *procedures* live in docs/operations/runbook.md §4 — this
     document governs, the runbook operates. -->

This document states where kasir.mu data is stored, how long each class of data
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
`create_backup_scoped`, `DATA_EXPORT`-gated, `apps/desktop-tauri/src/commands/data.rs`);
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
  (both engines: `audit_log_immutable_delete` raises on DELETE). The trigger has
  one narrow exception since `20260920_audit_retention.sql`: DELETE is allowed
  only while a `settings` row with key `audit.retention_sweep_active` exists,
  which `Store::sweep_audit_retention` writes around its own deletes
  (`SWEEP_MARKER_KEY`, `crates/oz-core/src/db/audit.rs:126`, inserted at :196/
  :204 and removed at :226/:231). An auditor asking whether audit rows can be
  deleted therefore gets a two-part answer: not by any ordinary path, and yes
  by the tier retention sweep, which announces itself in the same database.
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
counters/latencies, not user tracking, and the license server exposes no metrics at all
(runbook §2) — precise about which process, because the deployed image answers `/metrics`
anyway: Caddy routes it to `localhost:3099`, and that is `oz-cloud-server`
(`apps/unified/Caddyfile:95`, `apps/unified/supervisord.conf:3`,
`apps/cloud-server/src/config.rs:139`). PocketBase and the license code listen on `:8080`
and register no metrics route. Both statements are true about different things, and for a
residency policy the difference is load-bearing: an auditor asking whether *auth* data can
leave via metrics has to look at the sync server, not at the absence of a route in
`apps/license-server`. No telemetry SDK exists in any `Cargo.toml`, any client
`tauri.conf.json`, or any of the 38 `ui` dependencies.

## 3. Retention schedule

| Data class | Retention today | Mechanism |
|---|---|---|
| `offline_queue` (cloud) | **90 days**, enforced | hourly prune, 500-row batches (`start_prune_loop_pg`; runbook §3.6) |
| `sent_reports` dedup claims (cloud) | **90 days**, enforced | same prune |
| Memos (device) | archived → purged at **30 days** | retention sweep (`c8d2a54f` enforced via `archived_at`; daemon `5ee1064a`; `20260914_memo_retention.sql`) |
| `audit_log` (tenant-facing) | **tier window**, enforced | hourly daemon sweep: `Store::sweep_audit_retention` (`db/audit.rs:162`), called from `apps/desktop-tauri/src/lib.rs:614`/`:639` and `apps/mobile-tauri/src/lib.rs:284`. Plus 90d / Pro 180d / Premium 365d / Enterprise 1095d / Free & OneTime no entitlement (`subscription.rs:243-251`) |
| `audit_log` rows within the window | **infinite**, immutable by trigger | the sweep only deletes PAST the window; see the trigger exception in §2 |
| Sales, catalog, inventory, users, memos (cloud) | **no expiry** — kept while the tenant exists | no purge path in `crates/oz-api` (verified: no per-tenant `DELETE`) |
| Local device DB | kept until operator action (backup/restore) | — |

**Correction (2026-09-09, section J audit-baseline scoping).** This row and the
paragraph below previously stated that no audit purge exists and that tier-based
retention was "decided but not implemented". Both were false at the time of the
09-09 stamp on this page. The mechanism had landed: `sweep_audit_retention` is
tier-driven, tested in `db/audit_tests.rs` and `db/audit_security_tests.rs`, and
wired into both apps' daemons.

How the error survived a verification pass is worth recording, because the page
was audited the same day and stamped "every retention number holds". The number
that was checked is `RETENTION_DAYS = 90` in `crates/oz-api/src/prune.rs:20` — a
different mechanism, on a different table, in a different process (the cloud sync
prune). It is a *correct* citation for the rows above it and says nothing about
`audit_log`. Verifying one retention constant and generalizing to "no purge
exists" is the instrument-mismatch shape: the answer was produced by a tool that
was never pointed at the question.

**Actually open**: the Enterprise *configurable contract override* on the 3-year
default. `Entitlements::audit_retention_days` (`crates/oz-core/src/entitlements.rs
:189`) is a pure `self.tier.audit_retention_days()` delegation, so there is no seam
through which a contract could widen the window; adding one means a signed-payload
change in `apps/license-server` (a payload-schema ownership decision), not a local
edit. Deferred as such — an unsigned local override would let a tenant extend the
retention window their own compliance story depends on, which inverts the point.

**Retained is not the same as visible.** The tier gate on reading the audit surface
is Premium-or-above (`require_audit_tier`, `commands/audit.rs:265`), while the
retention schedule sweeps Plus and Pro data too. So a Plus tenant's audit rows age
out on a 90-day window that they cannot inspect. That is consistent with the box
text as written — paid tiers *retain*, Premium and above *receive* the views — but
it is the reading nobody had written down, and it changes what a "your data is
deleted after 90 days" answer to a customer should say.

## 4. Deletion & export requests

Implemented today:

- **Client data export** — `export_data` (session + `SETTINGS_EDIT`, path
  contained, `apps/desktop-tauri/src/commands/data.rs`) writes an `.ozpkg`
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
   Postgres sync DB: there is no per-tenant **erasure** in `crates/oz-api`
   (verified at HEAD). Wording matters here, because the crate does contain one
   tenant-scoped `DELETE` in production code — `pg.rs:1975`,
   `DELETE FROM memos WHERE tenant_id = $1 AND NOT (id = ANY($2))` — and it is
   snapshot *reconciliation* during a memo push, not a right-to-be-forgotten
   path. Grep alone would therefore report a false purge capability: what is
   absent is any statement that removes a tenant's sales, catalog or user rows
   (those shapes exist only in `pg_tests.rs`, as test cleanup). A deleted
   tenant's rows persist in the cloud store. A purge (or crypto-shred) workflow keyed off tenant
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

> last audited 09-09-26 by docs-auditor
