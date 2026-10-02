<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE AS AN ARCHIVED RECORD — 0 repairs needed · Audited on branch 0.0.40. First pass over this file: at 1,033 lines it carried NO audit stamp, NO footer, and no `docs-auditor` marker of any kind, which is worth noting because it is one of the four largest documents in the repository and the second-oldest `docs/archived/` file in the queue. The document is unusually well self-dispositioned — its front-matter reads `status: Archived (2026-08-31) — implemented; live procedure is docs/operations/runbook.md`, and that redirect target EXISTS. A reader who follows it gets the current procedure, which is exactly what an archived implementation plan should do. · The deployment-critical paths this plan names all still resolve, and they are the ones that matter: the four `apps/unified/` files (`Caddyfile`, `docker-entrypoint.sh`, `healthcheck.sh`, `supervisord.conf`) are all present, and so are all eight `apps/cloud-server/src/` modules it lists (`db.rs`, `email.rs`, `email_pg.rs`, `main.rs`, `prune.rs`, `rate_limit.rs`, `sync_store.rs`, `webhooks.rs`). The plan describes infrastructure that was actually built. · The env-var vocabulary in §8 is consistent with the code, and that is the useful negative result: the document names `OZ_API_SECRET`, `OZ_ADMIN_KEY`, `OZ_ENFORCE_PLANS`, `OZ_LICENSE_PRIVATE_KEY`, `OZ_LICENSE_SERVER_URL`, `OZ_CORS_ORIGINS`, `DATABASE_URL` and the `SMTP_*` set, and the `OZ_*` prefix is what the servers actually read — `OZ_ENFORCE_PLANS` at `apps/cloud-server/src/config.rs:208` and `OZ_ADMIN_KEY` per `apps/license-server/DEPLOY.md:325`. That makes this document further evidence for the AGENTS.md finding recorded against `docs/specs/admin-dashboard-plan.md`: the `OZ_` prefix is the real one, and AGENTS.md §4 listing two of these same variables as `KASIRMU_*` is the outlier, not the docs. · LEFT ALONE deliberately, and the reason is the same as every other archived record in this pass: the `crates/oz-core/…` and `crates/oz-api/…` paths are pre-restructure names inside a record of what was built in August, and the two client manifests it cites as `apps/desktop-client/tauri.conf.json` and `apps/tablet-client/tauri.conf.json` have since moved to `apps/desktop-tauri/tauri.conf.json` and `apps/mobile-tauri/tauri.conf.json` (also one level up — there is no `src-tauri/` subdirectory now). Rewriting an archived implementation record to match September's tree would convert evidence into fiction. Because the document already routes readers to the live runbook, the cost of leaving it is close to zero. · The §11.5 Post-Implementation Review, the §12 Risk Mitigation matrix and the §14 Success Criteria are left exactly as written. · No stamp or footer existed on this file before this pass. -->
---
area: sync
title: Unify Auth & Sync to Northflank
status: Archived (2026-08-31) — implemented; live procedure is docs/operations/runbook.md
---

# Unify Auth & Sync to Northflank

> **Status:** Archived (2026-08-31) — implemented and closed by the §11.5 Post-Implementation Review (2026-08-15).
>
> For the live deployment procedure use [`docs/operations/runbook.md`](../../operations/runbook.md).
> This file is kept as a historical design record for its rationale and its phase numbering
> ("Phase 1.2", "Phase 3.5", "§11"), which Rust source and the runbook still cite.

> Co-locate the license (auth) server and cloud (sync) server into one
> Northflank deployment: one Docker image running both functions, two
> databases coupled by the HS256 JWT identity, sync data on Postgres.

---

## 1. Current State (Two Servers)

```
┌────────────────────────────────────────────────────────┐
│  License Server (Go) — PocketBase + Go hooks           │
│  Northflank · DB: PocketBase SQLite                    │
│  Auth: tenant api_key (persistent)                     │
│                                                        │
│  Routes:   POST /api/v1/license/activate               │
│            POST /api/v1/license/renew                  │
│            POST /api/v1/license/status                 │
│  Signing:  RSA-2048 subscription payloads              │
│                                                        │
│  Collections: license_keys, tenants,                   │
│               subscriptions, tenant_machines           │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  Cloud Server (Rust) — axum + SQLite                   │
│  Northflank · DB: SQLite (own file)                    │
│  Auth: HS256 JWT (oz-api, POST /api/v1/tokens)         │
│                                                        │
│  Routes:   POST /api/sync/push                         │
│            POST /api/sync/pull                         │
│            GET  /api/sync/snapshot                     │
│            GET  /api/sync/status                       │
│            REST API (products, sales, …)               │
│            POST /api/webhooks/stripe                   │
│            POST /api/webhooks/square                   │
│                                                        │
│  Tables (cloud-relevant): offline_queue, products,     │
│      tax_rates, users, terminals, tenant_plans,        │
│      tenant_subscription, stripe_customers,            │
│      processed_webhooks, payments, sales               │
└────────────────────────────────────────────────────────┘
```

### Problems

| Problem | Impact |
|---------|--------|
| **Two databases** | License data (PocketBase) and sync data (SQLite) are isolated — the sync plan gate reads its own `tenant_plans` copy, not the license server's tier |
| **Two credential systems** | The license server authenticates with a persistent tenant `api_key`; the cloud server mints short-lived HS256 JWTs via `POST /api/v1/tokens`. The POS holds both. |
| **No shared tenant registry** | The license server owns `tenants`; the cloud server has no `tenants` table — tenant identity is a loose `tenant_id` string column on many tables (default `'default'`), so the two can silently disagree |
| **Duplicated plan state** | The cloud DB's `tenant_plans` + `tenant_subscription` (with `signed_payload`/`signature`/`api_key` columns) mirror the license server's `subscriptions` — two sources of truth kept in sync manually |
| **Two deployments** | Two Northflank services to maintain, monitor, update |
| **No shared state** | "Free tier → no sync" is enforced from the cloud server's own `tenant_plans`, not from the license server's tier |

---

## 2. Target State (One Deployment, Two Functions)

```
┌──────────────────────────────────────────────────────────┐
│  One Northflank service, one Docker image                │
│  caddy (single port, path routing)                       │
│                                                          │
│  Auth function (PocketBase + Go hooks — kept)            │
│    /api/v1/license/activate|renew|status                 │
│    /api/v1/web/contact (support form → Discord)          │
│    RSA-2048 subscription signing                         │
│    web_users auth (future website)                       │
│    admin UI /_/                                          │
│    DB: PocketBase SQLite (low traffic)                   │
│                                                          │
│  Sync function (Rust axum — kept)                        │
│    /api/sync/push|pull|snapshot|status                   │
│    /api/v1/tokens (HS256 JWT mint)                       │
│    /api/webhooks/stripe|square                           │
│    REST API + plan gating + rate limiting + prune        │
│    DB: Postgres (managed addon — futureproof)            │
│                                                          │
│  Identity: HS256 JWT (tenant_id + terminal_id)           │
└──────────────────────────────────────────────────────────┘
```

### What this buys

| Benefit | Detail |
|---------|--------|
| **One deploy** | One image, one Northflank service, one reverse proxy |
| **No rewrite** | Both mature codebases are kept; only packaging + the Postgres path change |
| **Futureproof sync** | Sync data on Postgres (pooling, replicas, backups) — the part that scales |
| **Cheap auth** | License + website users stay on PocketBase/SQLite (low traffic, bounded) |
| **One identity** | The HS256 JWT's `tenant_id` is the single contract between the two functions |

### Honest constraints

- Two databases, not one. They are coupled by the JWT `tenant_id` (and the
  Stripe/Square webhooks mirror plan state into the sync DB), not by a shared
  table. If cross-database queries become necessary, that is the signal to
  merge auth data into Postgres.
- PocketBase remains single-node SQLite; it holds only low-traffic data.

---

## 3. Data Layout (Two Databases)

### Auth DB — PocketBase SQLite (unchanged)

```
license_keys, tenants, subscriptions, tenant_machines
web_users (future website — per website-plan.md)
```

### Sync DB — Postgres (the cloud server's 93 tables, unchanged)

```
offline_queue, products, tax_rates, users, terminals,
tenant_plans, tenant_subscription, stripe_customers,
processed_webhooks, payments, sales, sale_lines, …
```

### Identity contract

PocketBase `tenants.id` is the canonical tenant ID. The sync server's JWT mint
embeds it as the `tenant_id` claim, and every sync/REST row is scoped by that
string. The two databases never need to share a table — they share the
identifier.

### Plan gating (explicit coupling)

The sync function enforces "free → no sync" from its own `tenant_plans`,
updated by the Stripe/Square webhooks. The license server's `subscriptions`
remains the source of truth for the signed payload and tier key. These are
kept in step operationally today; unifying them into one table is a later,
optional step, not a prerequisite for one deploy.

---

## 4. Unified Auth Flow

### The two credentials that exist today

The two servers use two *different* credentials, and they serve different
purposes — one is durable identity, the other a short-lived session:

| Credential | Issued by | Lifetime | Carries | Used for |
|-----------|-----------|----------|---------|----------|
| **Tenant `api_key`** | License server, `POST /api/v1/license/activate` | Persistent — no expiry, revoked explicitly | Tenant identity (stored on the `tenants` record) | License activation, renewal, status (`/api/v1/license/*`) |
| **HS256 JWT** | Cloud server, `POST /api/v1/tokens` (oz-api) | ~24 h (`exp` claim) | `tenant_id`, `terminal_id` scoping | Sync (`/api/sync/*`) and the REST API |

They are complementary, not competing. The `api_key` answers *"is this the
registered tenant?"*; the JWT answers *"is this an active session scoped to
that tenant and terminal?"*.

### Tenant `api_key` (identity — license server)

Issued on first activation, stored on the `tenants` record, and sent as
`Authorization: Bearer <api_key>`:

```
POS App first boot → user enters license key + email + machine_id
    │
    ▼
POST /api/v1/license/activate
    │
    ├── Go hook validates the key against license_keys
    ├── Finds or creates the tenant by email
    ├── Issues api_key (stored on the tenants record)
    ├── Signs the subscription payload with RSA-2048
    └── Returns { tenant_id, api_key, signed_payload, signature }

POS App subsequent boots
    │
    ├── Reads stored tenant_id + api_key from local SQLite
    └── POST /api/v1/license/status  { Authorization: Bearer <api_key> }
```

The `api_key` is not a JWT — it is a persistent secret verified directly
against the `tenants` collection. It never expires; it is revoked only on
explicit tenant action, subscription cancel + grace expiry, or an admin
security action.

### HS256 JWT (session — cloud server)

Minted by `POST /api/v1/tokens`, signed with `OZ_API_SECRET`, carrying `sub`,
`jti`, `exp`, `iat`, `tenant_id`, and `terminal_id` claims. The mint itself is
authorised one of three ways (ADR sync-auth-hardening): terminal client
credentials (`client_id` + `client_secret`), an `X-Admin-Key` header gated by
`OZ_ADMIN_KEY`, or — in dev only — an open mint when neither is configured.

```
POS App (before sync) → POST /api/v1/tokens
    │                    (client credentials | X-Admin-Key | open dev mint)
    ▼
oz-api create_token_scoped()
    │
    ├── Claims: tenant_id, terminal_id, exp = now + 24h
    └── Returns { token, expires_at, token_id }

POS App sync cycle
    │
    ├── POST /api/sync/push      { Authorization: Bearer <jwt> }
    ├── POST /api/sync/pull      { Authorization: Bearer <jwt> }
    ├── GET  /api/sync/snapshot  { Authorization: Bearer <jwt> }
    └── GET  /api/sync/status    { Authorization: Bearer <jwt> }
```

`auth_middleware` validates the JWT and injects its claims; the sync handlers
take `tenant_id` from the claims (never the request body) and the plan gate
(`OZ_ENFORCE_PLANS`) reads the same claim. On a structured 401
(`token_expired`) the client re-mints and retries once; `invalid_token` /
`missing_token` are surfaced as configuration errors.

### Refresh model

| Credential | Refresh strategy |
|-----------|------------------|
| `api_key` (identity) | No refresh — valid until revoked |
| JWT (session) | Re-mint at `POST /api/v1/tokens` on `token_expired` (no refresh token; minting is cheap) |

### Recommendation: keep both — unify only where they are verified

Do **not** collapse the two credentials into one:

- Making the `api_key` a JWT (or the JWT permanent) loses the short lifetime,
  the `terminal_id` scoping, and the expiry-based invalidation that sync and
  plan gating rely on.
- Making sync/REST use the raw `api_key` would send the long-lived identity
  secret on every data-plane request and lose the per-terminal scoping the
  JWT claims carry.

The merge should therefore:

1. Keep `api_key` on `tenants` for `/api/v1/license/*` (identity + activation).
2. Keep the HS256 JWT mint (`POST /api/v1/tokens`) and its auth middleware in
   the Rust sync server (session) — unchanged.
3. Use the JWT's `tenant_id` as the single identity contract: PocketBase
   `tenants.id` is the canonical ID, the JWT carries it, and the sync DB
   scopes rows by it. The two credentials coexist without one shared table.

---

## 5. Sync Protocol (Unchanged)

The Rust cloud server exposes four sync endpoints, all behind the oz-api JWT
(`auth_middleware`), per-tenant rate limiting, and optional plan gating
(`OZ_ENFORCE_PLANS`). The sync engine stays in the Rust server exactly as-is —
the POS client does not change. Only its database and its deployment move.

| Endpoint | Method | Contract |
|----------|--------|----------|
| `/api/sync/push` | POST | Accept a `Vec<OfflineQueueItem>`; insert each into `offline_queue` with its client-generated ID; tenant taken from JWT claims (never the body); per-item `Accepted` / `Rejected{reason}` (non-UUID id, duplicate id, db error) |
| `/api/sync/pull` | POST | Replay `offline_queue` rows for the tenant changed since `since`, ordered `created_at, id`, cursor-paginated (500/page); `410 anchor_expired` if `since` is older than the pruned window |
| `/api/sync/snapshot` | GET | Reference-data baseline — products, tax rates, users — scoped to the JWT tenant; 5-min in-memory cache; `pin_hash` never serialised (SYNC-06); query failures return 5xx, never an empty success (SYNC-09) |
| `/api/sync/status` | GET | Health, version, pending queue depth, tiered heartbeat interval |

### Push Flow

```
POS App → POST /api/sync/push
    │
    │  Headers: Authorization: Bearer <jwt from POST /api/v1/tokens>
    │  Body: [ { id, action, payload, status, retry_count, last_error,
    │           created_at, synced_at } ]        // Vec<OfflineQueueItem>
    │
    ▼
axum: push_handler (auth → plan gate → rate limit → handler)
    │
    ├── tenant_id = claims.tenant_id (never the request body)
    ├── For each item:
    │   ├── Reject non-UUID ids (defense-in-depth for the prune DELETE path)
    │   ├── INSERT INTO offline_queue (existing client-generated id)
    │   └── Duplicate id (UNIQUE) → Rejected { reason: "duplicate id" }
    └── Return PushResponse { results: [Accepted | Rejected] }
```

Push does NOT write to `products`/`sales` tables. The offline queue is a
pending-action ledger; reference data flows through the snapshot, and payment
events flow in through the Stripe/Square webhooks (as `finalize_sale` actions).

### Pull Flow (queue replay)

```
POS App → POST /api/sync/pull
    │
    │  Headers: Authorization: Bearer <jwt>
    │  Body: { since?: "2026-08-01T00:00:00Z", cursor?: "created_at|id" }
    │
    ▼
axum: pull_handler
    │
    ├── tenant_id = claims.tenant_id
    ├── If since is older than the oldest retained row → 410 anchor_expired
    ├── SELECT ... FROM offline_queue
    │     WHERE tenant_id = ? AND created_at >= since
    │     ORDER BY created_at ASC, id ASC LIMIT 501
    ├── Truncate to 500; if a 501st row existed, return next_cursor
    └── Return PullResponse { items, next_cursor }
```

### Snapshot (reference data, not the queue)

```
POS App → GET /api/sync/snapshot   (Authorization: Bearer <jwt>)
    │
    ▼
axum: snapshot_handler
    │
    ├── tenant_id = claims.tenant_id
    ├── Serve cached JSON if younger than 5 min
    ├── SELECT products, tax_rates, users WHERE tenant_id = ?
    ├── users: pin_hash deliberately omitted (SYNC-06)
    └── Return { products: [...], tax_rates: [...], users: [...] }
```

### Anti-spike & retention (must be preserved)

The sync function carries two DB-protection loops that are load-bearing and
must survive the SQLite → Postgres move — they are not optional:

| Mechanism | Today | Behavior |
|-----------|-------|----------|
| **Per-tenant rate limiter** (`rate_limit.rs`) | In-memory token bucket — DB-agnostic, already wired on both backends | push 100/min · pull 300/min · snapshot 50/min · status 300/min; token mint 30/min per IP; `429` + `Retry-After`; stale-bucket cleanup every 60 s |
| **Retention / prune loop** (`prune.rs`) | Hourly, now on **both** backends — `offline_queue` retention ported to Postgres (`start_prune_loop_pg`); `archive_stock_movements` + `incremental_vacuum` remain SQLite-only | delete `offline_queue` rows > 90 days regardless of status, in 500-row cursor batches (SQLite: `incremental_vacuum(50)` per batch; PG: autovacuum reclaims space); `archive_stock_movements` ledger rollup (SQLite only); `PRUNE_QUEUE_DELETED_TOTAL` counter |

Phase 1.5 has ported the offline-queue retention half of the prune loop to
Postgres (batched `DELETE ... id = ANY($1)`; `incremental_vacuum` becomes
autovacuum) and re-wired it onto the Postgres branch, and the report-sender
email loop now runs on Postgres too (`email_pg.rs` — settings + the full
analytics bundle, reusing the shared scheduler/filter/builder logic from
`oz_core`). Remaining on SQLite: the `archive_stock_movements` ledger rollup
only (deliberate — Postgres reclaims space via autovacuum, and the stock
rollup has no PG port). The rate limiter stays as-is: in-memory,
per-process, DB-agnostic.

### Key Change: co-locate, don't merge

| Aspect | Change |
|--------|--------|
| Sync handlers | Unchanged (Rust) |
| License handlers | Unchanged (Go/PocketBase) |
| Sync database | SQLite → Postgres (managed addon) |
| License database | PocketBase SQLite (unchanged) |
| Deployment | Two Northflank services → one image, one service |
| Identity | HS256 JWT `tenant_id` (already the contract) |

---

## 6. Migration Plan

### Phase 1: Finish the Postgres backend (Weeks 1-2)

| Step | Action |
|------|--------|
| 1.1 | Port the full 93-table migration set to Postgres DDL — **done**: `scripts/generate-pg-migration.py` → `20260813_init.pg.sql` (type-mapped, FK-order topo-sorted, 4 triggers → 3 plpgsql functions + 4 triggers); applied + verified idempotent on Postgres 16 (93 tables, 122 indexes, 4 triggers; the SQLite schema has 123 indexes — the `idx_sales_status_created_date` expression index is SQLite-only, see §11.5 deferred item 2) |
| 1.2 | Make oz-api REST handlers run on Postgres (drop the in-memory SQLite fallback) — **done**: the sync function (`SyncStore`, via `SyncState.pg`), the REST surface (`crates/oz-api/src/pg.rs`, via `AppState.pg` — products, categories, tax_rates, users, plans, sales, terminals, token client-credentials), **and** the Stripe/Square webhook layer (dedup, `finalize_sale` enqueue, payment lookup, stripe-customer mapping, plan writes) all read/write Postgres on the cloud branch; the report-sender loop remains on SQLite |
| 1.3 | Raise the pool above the 8-connection default — **done**: `OZ_DB_POOL_SIZE` (default 20); TLS via rustls already wired |
| 1.4 | Migrate live sync data from SQLite to Postgres; verify row counts + checksums — **done**: `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs` copies the cloud surface (FK-topo-sorted from `pg_constraint`, `ON CONFLICT DO NOTHING` so re-runs are safe, per-table row-count + FNV-1a checksum verification); verified end-to-end + idempotent re-run against live Postgres |
| 1.5 | Re-wire the background loops onto Postgres — **done**: prune (offline-queue retention) via `start_prune_loop_pg`, **and** the report-sender email loop via `email_pg::start_report_sender_loop_pg` (settings + analytics bundle on Postgres). Only the `archive_stock_movements` stock rollup remains SQLite-only (autovacuum supersedes it on PG). Rate-limit cleanup is DB-agnostic. |

#### Phase 1.2 — data-layer design (the remaining core)

`Store` cannot be rewritten to Postgres: it is the SQLite data layer for the
whole POS (desktop + tablet + cloud), a borrow-wrapper over
`&rusqlite::Connection` with ~45 domain modules, and the cloud server is only
one of its three consumers. Phase 1.2 therefore adds a **parallel async
Postgres data layer** for the cloud server and leaves `Store` untouched:

| Decision | Choice |
|----------|--------|
| Abstraction | `apps/cloud-server/src/sync_store.rs` — a `SyncStore` enum (`Sqlite` / `Postgres`) with one async surface over `deadpool_postgres::Pool` (no `blocking` feature; stay async). **Done** for the sync function. |
| Surface | Only what the cloud server uses: `offline_queue` (push/pull/prune), `tenant_plans` (get/set), `processed_webhooks` (dedup), stripe/square webhook tables, products/tax_rates/users (snapshot **and** REST CRUD), sales (REST create/get/status), terminals + token client-credentials, SMTP + report schedule (email loop). **Implemented**: `offline_queue` push/pull + counts, `tenant_plans` get/set, products/categories/tax_rates/users/plans/sales/terminals/tokens REST, prune retention, webhook dedup + `finalize_sale` + stripe-customer mapping, **and** the email/report loop (`email_pg.rs` — SMTP config, report schedule, dedup key, store name, and the full 10-query analytics bundle on Postgres). |
| SQL | Write Postgres SQL directly (`$1` params, `now() AT TIME ZONE 'UTC'`, `ON CONFLICT`); no dialect shim |
| State | `SyncState` **and** `oz_api::AppState` hold `pg: Option<Pool>` (threaded through `build_router`); the Postgres branch passes `Some(pool)`, the SQLite branch `None`. `CloudServerState` also carries the pool so `/health` reports the real Postgres queue depth. |
| REST (oz-api) | **done** — `crates/oz-api/src/pg.rs` implements the REST surface against `deadpool_postgres::Pool`; every handler dispatches on `AppState::pg` (Postgres path vs. the untouched SQLite `Store` path). The Postgres branch no longer serves the empty in-memory SQLite. |
| Transactions | `tokio_postgres` `client.transaction()` for multi-row writes; `batch_execute` for the (already-done) migration |

Port order (highest value/risk first): **sync function** (offline_queue + plan
gating) — **done** → **prune loop, offline-queue retention** (1.5) — **done** →
**REST handlers** (1.2 tail) — **done** → **webhook dedup + `finalize_sale`**
— **done** (all webhook DB access is backend-aware; PG integration test
covers dedup, payment lookup, enqueue, tenant resolution, and plan upgrade)
→ **email loop** (1.5) — **done** (settings + analytics bundle on Postgres;
`pg_integration_email_loop_reads_postgres` covers revenue, heatmap, category
breakdown, low stock, and config round-trips) → **data migration** (1.4) —
**done** (binary + `pg_integration_migrate_and_verify`). Each landed
step has a skip-if-no-PG integration test (the established pattern) while the
SQLite branch keeps its full coverage.

### Phase 2: Combine into one image (Week 2) — complete

Status: **done** — `Dockerfile.unified`, `apps/unified/supervisord.conf`,
`apps/unified/Caddyfile`, `apps/unified/docker-entrypoint.sh`,
`apps/unified/healthcheck.sh`. Sync runs on SQLite until Phase 1 lands
(`DATABASE_URL` switches to Postgres with no packaging change).

| Step | Action |
|------|--------|
| 2.1 | Multi-stage Dockerfile building both binaries (unify libc) |
| 2.2 | Supervisor entrypoint running PocketBase (8080) + Rust (3099) |
| 2.3 | caddy reverse proxy on one port with path routing |
| 2.4 | One volume (pb_data + sync data), one aggregate healthcheck |

### Phase 3: Deploy one service (Week 3)

| Step | Action |
|------|--------|
| 3.1 | Provision the managed Postgres addon on Northflank |
| 3.2 | Deploy the combined image; blue-green beside the two old services |
| 3.3 | Point the POS at the single URL; keep redirect mode (421) for stragglers |
| 3.4 | Decommission the two old Northflank services |

### Phase 3.5: Switchover checklist (executed 2026-08-16)

The two standalone services (`oz-pos-license-service` + `oz-sync`) were
deleted and a single fresh unified service `oz-cloud` was created
(`Dockerfile.unified`, port 80, single volume at `/data`, public URL
`https://oz--cloud--76cyv4d6bn54.code.run`). The old auth data volume was
not migrated — the deployment starts with a fresh PocketBase (see
`docs/operations/runbook.md` §8 for the live config + restore path).

**Client code — auth URL repointed to the unified host** (the old
`auth--oz-pos-license-service--76cyv4d6bn54.code.run` is gone):

| File | Change |
|------|--------|
| `crates/oz-core/src/license_verification.rs` | `LICENSE_SERVER_URL` → `https://oz--cloud--76cyv4d6bn54.code.run` (env override `OZ_LICENSE_SERVER_URL`) |
| `apps/desktop-client/tauri.conf.json` | CSP `connect-src` adds the unified host |
| `apps/tablet-client/tauri.conf.json` | CSP `connect-src` adds the unified host |
| `ui/src/features/auth/LicenseActivationScreen.tsx` | `AUTH_SERVICE_URL` fallback → unified host (`VITE_AUTH_SERVICE_URL` overrides) |
| `ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx` | pinned URL updated |

**Unified service env vars (Northflank → Configuration):**

| Variable | Source | Notes |
|----------|--------|-------|
| `OZ_LICENSE_PRIVATE_KEY` | copy from old license service | required (Go exits without it) |
| `OZ_API_SECRET` | `openssl rand -hex 32` | required by `OZ_PRODUCTION=1` |
| `OZ_ADMIN_KEY` | random string | required by `OZ_PRODUCTION=1`; gates token mint |
| `OZ_PRODUCTION` | `1` | fail-closed boot (both secrets + TLS posture) |
| `OZ_CORS_ORIGINS` | optional | extra origins beyond the default allowlist |
| `OZ_ENFORCE_PLANS` | `1` | reject free-plan sync (403 plan_required) |
| `PADDLE_WEBHOOK_SECRET` + `PADDLE_PRICE_TIERS` | copy from old license service | Paddle webhook provisioning |
| `OZ_SMTP_*` / `OZ_DISCORD_WEBHOOK` / `OZ_WEB_ALLOWED_ORIGINS` | copy from old license service | optional, if configured |

**Data migration (PocketBase backup → restore):**

1. On the OLD license service, create a PocketBase backup via the admin UI
   (`/_/` → Settings → Backups → Create backup) or `POST /api/backups`.
2. Download the backup zip; keep it until the unified service is verified.
3. On the UNIFIED service, open its PocketBase admin UI (`/_/`), create the
   superuser (first-boot installer link), then Settings → Backups → restore
   the downloaded zip.
4. Verify: `license_keys`, `tenants`, `subscriptions`, `tenant_machines`
   collections are populated and `/api/health` is green.

The sync SQLite (`/data/oz-pos.db`) is fresh on the unified volume — any
pending offline queue is per-install and re-syncs once a sync URL + API key
are configured.

---

## 7. Code Changes Required

### Rust (cloud server — Postgres path)

| File | Change |
|------|--------|
| `crates/oz-core/migrations/` | **done** — `20260813_init.pg.sql` + `generate-pg-migration.py`; exposed as `oz_core::migrations::PG_INIT`. The generator now emits `ON CONFLICT DO NOTHING` on every seed INSERT, so re-applying `PG_INIT` on an existing volume is idempotent (verified live — cloud-server restarts work) |
| `apps/cloud-server/src/db.rs` | **done** — `connect_postgres` applies `PG_INIT` (full schema) instead of the 2-table stub; pool sized via `OZ_DB_POOL_SIZE` |
| `apps/cloud-server/src/main.rs` | **done** — the oz-api router receives the Postgres pool (`AppState.pg`), the prune loop starts on the Postgres branch (`start_prune_loop_pg`), the report-sender loop starts on the Postgres branch (`email_pg::start_report_sender_loop_pg`), and `/health` reports the real Postgres queue depth / `db: "postgres"` |
| `crates/oz-api/src/pg.rs` | **done** — the REST Postgres data layer (products, categories, tax_rates, users, plans, sales, terminals, token client-credentials); `PgError` → HTTP mapping; `SUM(...)::bigint` cast for stock (Postgres `SUM(bigint)` returns `numeric`); skip-if-no-PG integration test |
| `apps/cloud-server/src/webhooks.rs` | **done** — webhook dedup (`processed_webhooks` upsert + exists), payment → sale lookup, `finalize_sale` enqueue, stripe-customer mapping, and tenant-plan writes are backend-aware (`CloudServerState.pg`); PG integration test |
| `apps/cloud-server/src/prune.rs` | **done** — offline-queue retention ported to Postgres (`start_prune_loop_pg`, batched `DELETE ... id = ANY($1)`, autovacuum, `PRUNE_QUEUE_DELETED_TOTAL`); `archive_stock_movements` rollup remains SQLite-only |
| `apps/cloud-server/src/email.rs` | SQLite loop unchanged (desktop client path) |
| `apps/cloud-server/src/email_pg.rs` | **done** — Postgres report-sender loop: `settings` read/write (SMTP config + schedule + dedup key + store name) and the full 10-query analytics bundle (`daily/weekly/monthly revenue`, `top_products`, `hourly_heatmap`, `category_breakdown`, `low_stock`, `active_stock_alerts`, `category_popularity`, `category_forecast`) against `deadpool_postgres::Pool`, reusing `oz_core`'s shared scheduler/filter/`ReportEmailBuilder`; `should_send_scheduled_with_last_sent` extracted in `oz-core` so the two loops share one cadence/dedup implementation; skip-if-no-PG integration test |
| `apps/cloud-server/src/bin/migrate_sqlite_to_pg.rs` | **done** — Phase 1.4 cutover tool: copies the cloud surface from a SQLite file to Postgres (schema applied idempotently, rows via `ON CONFLICT DO NOTHING`), FK-topo-sorted copy order from `pg_constraint`, per-table row-count + FNV-1a checksum verification; `--dry-run`; unit tests + skip-if-no-PG integration test |
| `apps/cloud-server/src/rate_limit.rs` | Unchanged — in-memory and DB-agnostic; limits preserved |

### Packaging (new)

| File | Change |
|------|--------|
| `Dockerfile.unified` | **done** — build both binaries into one image |
| `apps/unified/supervisord.conf` | **done** — run PocketBase + Rust under one supervisor |
| `apps/unified/Caddyfile` | **done** — one port, path-routed to 8080 / 3099 |
| `apps/unified/docker-entrypoint.sh` | **done** — volume ownership fix + exec supervisord |
| `apps/unified/healthcheck.sh` | **done** — aggregate healthcheck (both functions + DB ping) |

### Go (license server) + Rust (POS app)

| File | Change |
|------|--------|
| `apps/license-server/*` | Unchanged (kept as the auth function) |
| `crates/oz-core/src/sync_client.rs` | Unchanged — same endpoints + token mint |
| `platform/startup/src/rate_sync.rs` | Point server URL defaults at the single service URL |

---

## 8. Environment Variables

### Auth function (PocketBase)

```bash
PB_URL=https://api.ozpos.my.id
OZ_LICENSE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
# SMTP for web_users email (future website)
SMTP_HOST=... SMTP_PORT=587 SMTP_USERNAME=... SMTP_PASSWORD=...
```

> **DOCKER-11 (single volume):** PocketBase's data directory is NOT set via
> an env var — `apps/unified/supervisord.conf` passes `--dir=/data/pb_data`
> to `pocketbase serve`, so PocketBase writes inside the SAME `/data`
> volume as the sync SQLite DB (`/data/oz-pos.db`). One persistent volume
> therefore covers both functions (Northflank free tier grants one volume
> per service).

### Sync function (Rust)

```bash
DATABASE_URL=postgres://user:pass@host:5432/ozpos?sslmode=require  # require = encrypted via rustls (disable/prefer for local dev)
OZ_PRODUCTION=1                  # fail startup if OZ_API_SECRET/OZ_ADMIN_KEY unset; also implies OZ_DB_REQUIRE_TLS
OZ_DB_REQUIRE_TLS=1              # fail startup if DATABASE_URL omits sslmode=require (implied by OZ_PRODUCTION=1)
OZ_DB_POOL_SIZE=20               # max Postgres pool connections (positive integer; ignored for SQLite)
OZ_APPLY_SCHEMA=1                # apply PG_INIT at startup; set to 0 once the schema exists and the app runs as the restricted oz_app role post-cutover (the migration tool applies DDL once as owner)
OZ_API_SECRET=...                # HS256 JWT signing secret — required when OZ_PRODUCTION=1 (unset falls back to the hard-coded dev secret; JWTs become forgeable)
OZ_ADMIN_KEY=...                 # gates POST /api/v1/tokens — required when OZ_PRODUCTION=1 (unset = open token mint, dev mode)
OZ_ENFORCE_PLANS=1               # reject free-plan sync (403 plan_required)
STRIPE_WEBHOOK_SECRET=whsec_...
SQUARE_WEBHOOK_SIGNATURE_KEY=...
SQUARE_WEBHOOK_URL=https://.../api/webhooks/square
OZ_API_PORT=3099
RUST_LOG=info
```

The two functions share one volume and one secret store; they communicate only
through the HS256 JWT, never directly.

---

## 9. API Endpoints (One Deployment)

### Auth function (PocketBase — kept)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/license/activate` | POST | Activate a key, issue the tenant `api_key`, sign the subscription |
| `/api/v1/license/renew` | POST | Renew a subscription |
| `/api/v1/license/status` | POST | Check status / revoke a machine (Bearer `api_key`) |
| `/api/collections/web_users/auth-*` | POST | Website auth (future, per website-plan.md) |

### Sync function (Rust — kept)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/push` | POST | Accept `OfflineQueueItem`s, insert with existing IDs, per-item outcomes |
| `/api/sync/pull` | POST | Replay `offline_queue` changes since a timestamp, cursor-paginated |
| `/api/sync/snapshot` | GET | Reference-data baseline (products, tax rates, users) |
| `/api/sync/status` | GET | Health, version, pending queue depth, heartbeat interval |
| `/api/v1/tokens` | POST | Mint HS256 JWT (`X-Admin-Key` / client credentials / dev) |
| `/api/webhooks/stripe` | POST | Subscription → plan; payment → `finalize_sale` |
| `/api/webhooks/square` | POST | Payment → `finalize_sale` |
| `/health` · `/metrics` | GET | Health + Prometheus metrics (incl. retention counter) |

---

## 10. Backward Compatibility

### Transition Period (~3 weeks)

| Client | Before | During Transition | After |
|--------|--------|-------------------|-------|
| POS App | Two URLs (license + sync) | One URL (reverse proxy), old services still up | One URL |
| Sync | Rust (SQLite) | Rust (Postgres, in parallel) | Rust (Postgres) |
| License | Go/PocketBase | Go/PocketBase | Go/PocketBase |

No protocol changes: the POS keeps the same HS256 JWT mint and the same
push/pull/snapshot/status calls. The existing redirect mode
(`OZ_REDIRECT_ONLY` + `OZ_SYNC_REDIRECT_URL`, HTTP 421) covers stragglers.

### Version Detection

```rust
// POS app can detect which server it's talking to
fn detect_server_version(base_url: &str) -> ServerVersion {
    // The unified server exposes the license endpoints alongside sync.
    if reqwest::get(format!("{}/api/v1/license/status", base_url)).is_ok() {
        ServerVersion::Unified
    } else {
        ServerVersion::Legacy
    }
}
```

---

## 11. Security, Reliability & Growth

### CORS Configuration

Lock to an explicit allowlist before serving the website:

| Origin | Purpose |
|--------|---------|
| `https://ozpos.my.id` | Website (global) |
| `https://id.ozpos.my.id` | Website (Indonesia) |
| `http://localhost:4321` | Website (dev) |
| `tauri://localhost` | POS app (Tauri) |

### Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Strict-Transport-Security` | `max-age=31536000` | Force HTTPS |
| `Content-Security-Policy` | `default-src 'self'` | Restrict resources |

### Hardening

- **Run Postgres with TLS** and a dedicated low-privilege role. The pool uses
  rustls, and `sslmode=require` is enforced at startup — via
  `OZ_DB_REQUIRE_TLS=1`, or automatically under `OZ_PRODUCTION=1` — so there
  is no silent plaintext fallback. The dedicated low-privilege role is still
  to be added.
- **Fail startup in prod if `OZ_API_SECRET` or `OZ_ADMIN_KEY` is unset.**
  `OZ_PRODUCTION=1` enforces both at startup — without it the JWT secret
  falls back to the hard-coded `oz-pos-dev-secret-change-in-production`
  (forgeable JWTs) and the token mint opens to anyone.
- **Rate-limit `/api/v1/tokens`** — done: 30/min per client IP (keyed on
  `X-Forwarded-For`/`X-Real-IP`). License `/status` now shares the license
  server's persisted 5/IP/hr token bucket (was unthrottled).
- **Hash the tenant `api_key` at rest** — done: `tenants.api_key` now stores a
  bcrypt hash and `tenants.api_key_lookup` (hidden, uniquely indexed) stores a
  hex SHA-256 for O(1) lookup. `/renew` + `/status` resolve via
  `findTenantByAPIKey`; legacy plaintext rows are lazily migrated on their
  first successful auth. A re-activation without the key rotates it (the key
  is write-only). The legacy body-`api_key` fallback is **removed**: the
  `Authorization: Bearer <api_key>` header is the sole credential channel on
  all three endpoints (body-only requests → 401 + `WWW-Authenticate` hint),
  and the desktop client sends the key via the header on activate/renew too
  (`#[serde(skip_serializing)]` keeps it out of the request body), so the
  secret can never land in CDN/access logs.
- **Keep the license server's 5/IP/hr activate/renew limiter** — it persists
  state to SQLite so restarts don't reset brute-force state; `/status` shares
  the same bucket.
- Store `OZ_API_SECRET`, `OZ_ADMIN_KEY`, and `OZ_LICENSE_PRIVATE_KEY` in
  Northflank secrets, never in the image.
- Lock down PocketBase's `/_/` admin UI (`DisableSignUp` + IP allowlist).
- The reverse proxy is the single public entry point; both app ports stay
  internal to the container.

### Reliability & operations

| Area | Requirement |
|------|-------------|
| Backups | Managed Postgres PITR **and** the PocketBase SQLite file (litestream or nightly `VACUUM INTO`); define RPO/RTO and run a restore drill |
| Aggregate healthcheck | Must check both processes, DB connectivity, and pending queue depth — not just "port is open" |
| Restart policy | Supervisor restarts each function independently; forward SIGTERM for graceful shutdown during rolling deploys |
| Alerting | Thresholds on: retention counter flatline, `offline_queue` depth, webhook 5xx, and token-mint rate |

### Growth path

| When | Action |
|------|--------|
| A feature needs a cross-DB join (e.g. plan gate must read the license tier directly) | Merge the auth collections into Postgres; retire PocketBase SQLite |
| The sync function is scaled beyond one instance | Move the rate limiter **and** the 5-min snapshot cache out of process memory into a shared store (Redis) — both are per-process today |
| Schema changes ship | Adopt a Postgres migration tool (sqlx/refinery) so DDL is versioned, not ad-hoc `batch_execute` |
| Cross-tenant isolation must be provable | Done: the generated PG migration `ENABLE ROW LEVEL SECURITY` on all 15 tenant-scoped tables with a `tenant_isolation` policy keyed on the `oz.tenant_id` session GUC — a missed `WHERE tenant_id = ?` fails closed instead of leaking rows. `pg_integration_rls_fails_closed` proves it for a real non-owner role, and the deployment cutover is now shipped too: `scripts/rls-cutover.sql` creates the restricted `oz_app` role, grants DML, and `FORCE ROW LEVEL SECURITY`s the 15 tables; the sync data layer already issues `SET LOCAL oz.tenant_id` as the first statement of every request transaction (auto-resets on pool return). `pg_integration_rls_force_blocks_owner` executes the real script in a transaction and proves FORCE isolates even the table owner when the GUC is unset. Webhook handlers (signature-authenticated, not tenant-authenticated) resolve the tenant from the data before writing: their two resolution reads run under the dedicated `oz_webhook_resolver` role (BYPASSRLS, tx-scoped `SET LOCAL ROLE`, auto-reset on commit) and every write after resolution runs as `oz_app` with `SET LOCAL oz.tenant_id` — `pg_integration_webhooks_restricted_role_after_cutover` proves the whole path as `oz_app` on a throwaway DB and fails without the resolver role |
| A second tenant brings the same product SKU or username | Done: `UNIQUE (tenant_id, sku)` / `UNIQUE (tenant_id, username)` in both schemas, the four `products(sku)` child FKs (`bundle_items`, `product_bundles`, `product_taxes`, `product_variants`) reworked to composite `(tenant_id, sku)` FKs, and the by-SKU REST lookups (list/get/adjust stock, sale cost-freeze) tenant-scoped from the JWT claims. `pg_integration_tenant_sku_isolation` proves two tenants can share a SKU/username without seeing or mutating each other's rows. The desktop snapshot upserts (`ON CONFLICT (tenant_id, sku)` etc.) keep working single-tenant |

---

## 11.5 Post-Implementation Review (2026-08-15)

Full review of the merged Phase 1 code (commits `8d565711` → `dd6a362c`): every
REST handler, the sync store, prune, webhooks, the email/analytics port, the
1.4 migration tool, the generated schema, and the plan doc's claims.

### Fixed in this review

| Finding | Fix | Test |
|---------|-----|------|
| `adjust_stock` read the previous quantity **outside** the transaction — concurrent adjustments to one SKU could lose updates (SQLite's single-writer semantics had masked it) | Whole read-modify-write moved inside the tx with the product row locked (`SELECT … FOR UPDATE`), serializing per-SKU adjustments | `pg_integration_concurrent_adjust_stock` — 20 concurrent `-1` adjustments must land as 20 ledger rows with final qty exactly `start − 20` |
| `update_sale_status` validated against a stale status — two concurrent transitions could both pass the state-machine check and double-apply | Compare-and-swap `UPDATE … WHERE id = $1 AND status = $2`; the loser re-reads and reports the current state | `pg_integration_concurrent_sale_status_transition` — exactly one of two concurrent `Pending→Active` wins; `version` bumps exactly once |
| `offline_queue` pulls filter `(tenant_id, created_at)` but no such index existed — every poll sorted the tenant's whole queue | Added `idx_offline_queue_tenant_created` to both schemas (regenerated `20260813_init.pg.sql` via the generator; index-surface guard bumped 121 → 122) | Existing `init_sql_creates_complete_schema_surface` guard |
| Stale comment claimed "the oz-api router requires SQLite" on the PG branch | Rewritten: REST handlers dispatch on `state.pg`; the in-memory SQLite is a never-written fallback | — |

### Verified clean (parity, no change needed)

- Every data-touching REST handler dispatches on `state.pg`; the in-memory SQLite fallback is never written in production PG mode, and `/health` reads the real Postgres queue depth.
- Analytics date math matches the SQLite engine: both interpret the stored UTC wall-clock; weekly grouping is Monday-first on both sides (`DATE(d, '-6 days', 'weekday 1')` ≡ `date_trunc('week', …)`).
- Snapshot column parity (`price_updated_at` defaults to `''` in both schemas); `track_serial`/`is_active` 0/1 BIGINT reads consistent.
- SMTP at rest: the PG loop decrypts via `oz_core::crypto` with the same static-key domain separation; plaintext legacy seeds degrade gracefully.
- No `unwrap()`/`expect()` in production cloud-server code; every client-supplied id stays parameter-bound (hostile-id prune tests).
- Migration tool: FK-topological copy order from `pg_constraint`, `ON CONFLICT DO NOTHING`, row-count + FNV-1a checksum verification, idempotent re-run verified live.
- `db.rs` TLS enforcement (`sslmode=require` fail-closed) and startup secret checks intact.

### Deferred (documented, not fixed)

1. ~~Global `UNIQUE(sku)` / `UNIQUE(username)`~~ — **done** in this pass (per-tenant constraints + composite FKs + tenant-scoped REST lookups + isolation test). The email-loop COGS/popularity joins were also hardened to `(tenant_id, sku)` so shared SKUs cannot cross tenants at the row level.
2. ~~Analytics scans use `created_at::date` (a cast, so `idx_sales_created_at` can't serve them)~~ — **SQLite done**: `idx_sales_status_created_date ON sales(status, date(created_at))` ships in the SQLite schema (guard 122 → 123) with a planner-proof test (`EXPLAIN QUERY PLAN` picks it, not `idx_sales_created_at`). **PG stays a scan** — text→date casts are STABLE in Postgres, so an expression index on `date(created_at)` is rejected as non-IMMUTABLE (verified against live PG 16); fine for a background daily job, revisited only if the bundle grows.
3. ~~Postgres Row-Level Security~~ — **done, including the cutover**. Schema side: the generator appends an RLS appendix to the PG migration (`ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy on all 15 tenant-scoped tables, keyed on `current_setting('oz.tenant_id', true)` — unset ⇒ NULL ⇒ no rows). `pg_integration_rls_fails_closed` connects a real non-owner role on a dedicated connection and asserts: no GUC ⇒ zero rows visible and INSERT rejected ("row-level security"); GUC set ⇒ only that tenant's row visible, a shared SKU resolves to the right price, a cross-tenant INSERT is rejected, and UPDATE on the visible row succeeds. Deployment cutover (the last enforcement item): `scripts/rls-cutover.sql` is a runnable, idempotent script that creates the restricted non-owner `oz_app` role, grants DML on the 15 tenant tables **plus the 6 auxiliary non-RLS tables the REST layer touches** (`sale_lines`, `inventory`, `stock_movements`, `stock_summary`, `categories`, `roles`), and `FORCE ROW LEVEL SECURITY`s the tenant tables; the cloud sync data layer (`sync_store.rs`) opens every Postgres transaction with `SET LOCAL oz.tenant_id` (via `set_config(..., is_local := true)`) so the GUC auto-resets when the connection returns to the pool. `pg_integration_rls_force_blocks_owner` executes the real script verbatim inside a transaction (run twice for idempotency, 15 tables FORCEd, rollback restores), and proves on a dedicated non-superuser OWNED table that FORCE blocks the table owner without the GUC (zero rows, writes rejected) and unblocks with it. The webhook path was made `oz_app`-compatible too: `scripts/rls-cutover.sql` adds the `oz_webhook_resolver` role (NOLOGIN **BYPASSRLS**, granted to `oz_app`) plus DML on the non-RLS webhook tables (`processed_webhooks`, `payments`); the handlers run their two pre-tenant resolution reads (stripe-customer mapping, payment→sale join) under tx-scoped `SET LOCAL ROLE oz_webhook_resolver` (auto-resets on commit, falls back unscoped pre-cutover while the app is still the owner), and every write after resolution (mapping upsert, `finalize_sale` enqueue, plan update) under `SET LOCAL oz.tenant_id`. `pg_integration_webhooks_restricted_role_after_cutover` drives the real signed HTTP handlers as `oz_app` on a throwaway DB (real cutover + FORCE) through resolution → enqueue → dedup → plan update → mapping, and fails without the resolver role. Also fixed while there: the `db.rs` PG integration tests hardcoded port 15432 and silently skipped in CI — they now read `OZ_TEST_PG_URL` like every other PG test.

### Multi-tenant readiness audit (2026-08-15)

Per-tenant uniqueness is in place; this is the remaining tenant-aware vs
tenant-blind surface, audited table by table.

| Surface | Status | Notes for the first real second tenant |
|---------|--------|----------------------------------------|
| `sync_api` handlers + `sync_store` (push/pull/snapshot/plan) | ✅ scoped | Tenant always resolved from JWT claims; per-tenant snapshot cache + rate limiter |
| `oz-api` REST (`pg.rs`) — products list/get/create/stock, tax rates, users, plans, terminals | ✅ scoped | Sale cost-freeze is tenant-scoped; `get_sale` / `update_sale_status` are by sale id (globally unique UUID — acceptable) |
| Webhook payment → sale lookup | ✅ scoped | Returns `(sale_id, tenant_id)` by joining the sale; the `finalize_sale` enqueue now runs under the sale's owner tenant (verified in the PG webhook test) |
| Webhook `finalize_sale` enqueue | ✅ scoped | Tenant flows from the sale row — no more hardcoded `'default'` |
| `sales` table | ✅ has `tenant_id` (default `'default'`) | Stamped by REST `create_sale` from the JWT claims; `payments` needs no tenant column (it joins through `sales.id`) |
| Report-sender email loop (`email_pg.rs`) | ✅ per-tenant | Every SKU-keyed product join resolves within the sale's tenant, and the loop now walks tenants: scoped settings keys (`{key}:{tenant}` with bare-key fallback), data-derived tenant enumeration (`default` first), a per-tenant advisory lock so a second instance skips instead of double-sending, and tenant-filtered aggregation (`AND s.tenant_id = $n` / `AND p.tenant_id = $n` in every sub-query). `pg_integration_email_loop_reads_postgres` asserts each tenant's bundle contains only its own sales and its own COGS (shared SKU), the scoped-key fallback, enumeration order, and the no-SMTP loop decision paths — see §11.5 "Per-tenant report scheduling" |
| Desktop `Store` (oz-core, SQLite) | ✅ single-tenant by construction | `create_sale` + the payment-completion paths stamp `tenant_id = 'default'` explicitly (asserted in `create_sale_persists_header`). The unscoped by-SKU/username queries are fine while each POS keeps its own DB file; the full inventory of what a shared-data rollout must scope is in §11.5 "Desktop Store tenant-scoping audit" (recommendation: a startup integrity check + the ~10 SKU/username-keyed statements, not a wholesale tenant API) |
| Health endpoint queue depth | ✅ global by design | Aggregate ops metric — correct as-is |

**Recommended Phase-4 order:** (1) ~~`sales.tenant_id` + REST/webhook threading~~ — **done** → (2) ~~per-tenant report settings + tenant-scoped analytics~~ — **done** (implemented below) → (3) ~~RLS~~ — **done**: schema-side (15 tables, `tenant_isolation` policy, fail-closed test) + deployment cutover (`scripts/rls-cutover.sql`: restricted `oz_app` role + `FORCE ROW LEVEL SECURITY`; sync data layer issues `SET LOCAL oz.tenant_id` per request transaction; FORCE-blocks-owner proof test).

### Per-tenant report scheduling (implemented 2026-08-15)

Today the report-sender loop runs once per server, reads single-global
`settings` rows, and aggregates every tenant into one report. This design
makes each tenant get its own report on its own schedule to its own
recipients, aggregated from its own rows — without breaking the existing
single-tenant behaviour.

**1. Tenant-scoped settings keys.** Settings stay in the single `settings`
table; the key carries the tenant as a **suffix**: `smtp_config:{tenant}`,
`report_schedule:{tenant}`, `last_report_sent_at:{tenant}`, `store.name:{tenant}`.
The bare keys (`smtp_config`, …) remain the canonical location for
`default`, so a read falls back `{base}:{tenant}` → bare `{base}`, and
`default`'s existing rows keep working untouched. Suffix (not prefix)
because it is a plain PK lookup — no `LIKE` scan — and it leaves the
legacy reads byte-identical. Recipients already live inside
`ReportScheduleConfig`, so no new settings surface is needed. Provisioning
is now covered by the admin-gated settings endpoint (`GET/PUT
/api/v1/settings`, `X-Admin-Key` like token minting): PUT validates the
SMTP/schedule JSON against the loop's types, encrypts the SMTP password
at rest, always writes the scoped `{base}:{tenant}` keys, and treats an
explicit `null` as "delete the override" (falling back to the bare key);
GET returns the effective per-tenant view with the bare-key fallback
applied — a second tenant is enabled purely by provisioning its scoped
keys through the endpoint, with no data migration.

**2. Tenant enumeration.** There is no `tenants` table; derive the active
set from data (cheap, no schema change, and a tenant exists the moment it
has a plan, a terminal, or queue activity):

```sql
SELECT tenant_id FROM tenant_plans
UNION SELECT DISTINCT tenant_id FROM offline_queue
UNION SELECT DISTINCT tenant_id FROM sync_terminals;
```

Growth path: when signup/provisioning lands (the website), introduce a
`tenants` table and enumerate from it, keeping the union as an orphan
fallback. `default` is always processed first so the current behaviour is
a byte-identical special case.

**3. The loop.** One background task; each cycle: enumerate tenants → for
each, read its scoped settings → if `enabled` and due (reuse the existing
tenant-agnostic `should_send_scheduled_with_last_sent` with its scoped
`last_report_sent_at`) → generate its bundle → send → stamp the scoped
last-sent. **Failure isolation:** per-tenant errors are logged and the
cycle continues; only a DB-level failure aborts. Tenants process
sequentially in `tenant_id` order for deterministic log output.

**4. Tenant-scoped aggregation.** `export_analytics_bundle_pg` already
takes `tenant_id` (today it only labels metadata) — thread it into every
sub-query (`AND s.tenant_id = $n` on sales-driven queries,
`AND p.tenant_id = $n` on product-driven ones). The joins already resolve
within the sale's tenant (previous work); the `WHERE` filter is what
isolates the aggregation itself.

**5. Concurrency & scale-out.** Single instance needs nothing extra
(sequential per-tenant work in one task). Multiple instances must not
send the same tenant's report twice: wrap each tenant's send in a
`pg_advisory_xact_lock(hashtext(tenant_id))` so the other instance skips
it. The at-most-once gap (a crash between a successful send and the
last-sent stamp could duplicate) is closed by the `sent_reports
(tenant_id, period, report_id)` table — **implemented**: the period
(daily/weekly/monthly calendar bucket in the schedule's timezone) is
claimed with `INSERT … ON CONFLICT (tenant_id, period) DO NOTHING`
BEFORE generating or sending; a second claim loses and the cycle skips,
so a crash-recovery restart or a racing instance can never re-send the
same period. The claim is released only when the send definitively
fails (allowing a retry); a send that succeeded but whose SMTP response
was lost is the unavoidable at-least-once boundary of email delivery.

**6. Rollout.** No data migration: existing bare keys are `default`'s
config. A second tenant is enabled purely by provisioning its scoped
keys. Tests: extend `pg_integration_email_loop_reads_postgres` to seed a
second tenant's scoped settings + rows and assert each tenant receives
only its own bundle (the shared-SKU COGS test already proves the row
isolation half); unit-test the key-scoping fallback.

**✅ Implemented (2026-08-15), all six points landed in `email_pg.rs`:**

- Settings: `get_setting_scoped_pg` / `set_setting_scoped_pg` +
  `scoped_key` (suffix form); `get_smtp_config_pg` /
  `get_report_schedule_pg` / `get_store_name_pg` / `category_means_pg`
  all take the tenant and read scoped-first with bare-key fallback.
- Enumeration: `active_tenants_pg` = `tenant_plans ∪ offline_queue ∪
  sync_terminals` + always `default`, sorted `default`-first.
- Loop: `try_send_scheduled_pg` walks tenants sequentially; per-tenant
  errors are logged and the cycle continues.
- Aggregation: `tenant_id` is threaded into every analytics sub-query
  (`daily/weekly/monthly revenue` incl. their COGS subqueries,
  `top_products`, `hourly_heatmap`, `category_breakdown`, both stock
  alert queries, `category_popularity`'s three queries, and the
  popularity-trend sales + activity queries).
- Concurrency: **one deviation from the design** — the design said
  `pg_advisory_xact_lock`, but the cycle's helpers each use independent
  pooled connections, so a transaction-scoped lock would guard nothing.
  `try_send_scheduled_for_tenant_pg` instead holds a **session**
  `pg_try_advisory_lock(hashtext(tenant_id))` on one dedicated
  connection for the whole read-due → send → stamp cycle; a second
  instance gets `false` and skips the tenant. Released on every exit
  path; worst case it dies with the connection on recycle.
- Tests (all in `pg_integration_email_loop_reads_postgres`): per-tenant
  bundle isolation (each tenant sees only its own sales and COGS), scoped
  key wins + bare-key fallback after deleting the scoped row, enumeration
  order, and the no-SMTP loop decision paths (already-sent tenant
  short-circuits before SMTP; unknown tenant skipped cleanly).
- At-most-once send: the new `sent_reports (tenant_id, period,
  report_id)` table (93rd table, both schemas; RLS-enrolled via the
  generator) is claimed before the email is sent
  (`claim_period_pg` — `ON CONFLICT DO NOTHING`), so a crash between a
  successful send and the last-sent stamp — or a racing instance — is
  recovered by the next cycle seeing the claim and skipping; the claim
  is released only on an observed send failure
  (`release_period_pg`). `period_for_schedule` buckets by cadence in
  the schedule's timezone (`YYYY-MM-DD` daily, Monday `YYYY-MM-DD`
  weekly, `YYYY-MM` monthly), reusing the now-public
  `resolve_now_in_timezone`. Tests: cadence bucketing unit test,
  live-PG claim-wins/second-claim-loses/release-retries, and a due
  schedule with a pre-claimed period that returns Ok without ever
  attempting SMTP.
- Provisioning: `crates/oz-api/src/routes/settings.rs` ships the
  admin-gated `GET/PUT /api/v1/settings` endpoint (registered in
  `oz-api`'s public router, `X-Admin-Key` like token minting). PUT
  validates `SmtpConfig`/`ReportScheduleConfig`, encrypts the SMTP
  password at rest (`encrypt_smtp_at_rest`), writes scoped suffix keys on
  SQLite and Postgres, and maps explicit `null` → delete override via a
  `deserialize_with` helper (plain `Option<Option<T>>` cannot distinguish
  null from absent — serde collapses both to `None`). GET resolves the
  effective view with the same scoped-first/bare-fallback order the loop
  uses. Tests: admin gating, typed round-trip, at-rest encryption (raw
  row inspected), per-tenant isolation, bare-key fallback (legacy bare
  row seeded directly), null-delete, validation rejects, and a live-PG
  provision round-trip (`pg_integration_settings_provision_per_tenant`).

### Desktop Store tenant-scoping audit (2026-08-15)

Per-tenant `UNIQUE (tenant_id, sku)` / `UNIQUE (tenant_id, username)` is
live in the schema, so the desktop `Store`'s unscoped queries are now the
only place a bare SKU/username lookup can multi-match. This is the
inventory of what a real multi-tenant rollout must scope.

**The surface (oz-core, SQLite `Store`):**

| Bucket | Where | Statements |
|--------|-------|------------|
| SKU-keyed product reads/writes | `db/products.rs` | get by sku (672), by barcode (685), duplicate check (649), partial update (536), `track_serial` update (698), delete (717), id-by-sku (915); category cleanup (845) |
| id-keyed product reads | `db/products.rs` | sku-by-id (929), `product_type`-by-id (943), list queries (173–290, 1103) |
| Cross-file SKU lookups/joins | `db/sales.rs` (cost freeze 129, line validate 738/789), `inventory.rs`, `refunds.rs`, `kds.rs`, `stock_counts.rs`, `stock_transfers.rs`, `shifts.rs`, `settings.rs` | ~76 sku-keyed statements across 10 files; most are `WHERE sku = ?` reads, a handful are test literals |
| Username-keyed user reads/writes | `db/staff.rs` | list (157), by id (178), by username (282), create (349, 721…), update (407, 438), delete (457) |
| Lists & aggregations | `db/products.rs`, `db/staff.rs`, `db/reports.rs`, `db/popularity.rs`, `db/analytics.rs` | whole-table scans — safe only because the desktop DB is single-tenant by construction |
| Already tenant-aware | `sync_client.rs` | snapshot upserts conflict on `(tenant_id, sku)` / `(tenant_id, username)` |

**What actually breaks if a desktop DB ever holds a foreign-tenant row:**

1. **SKU/username-keyed single-row reads and writes** — with per-tenant
   uniqueness, `WHERE sku = ?` can return one row per tenant; `query_row`
   errors on multi-match and writes hit the wrong row. This is the small,
   must-fix set: products.rs 536/649/672/685/698/717/915 + sales.rs
   129/738/789 + staff.rs 282, each gaining `AND tenant_id = 'default'`
   (or a tenant parameter).
2. **Cross-file SKU joins** (stock, refunds, KDS, reports) — same
   multi-match ambiguity; scope by `(tenant_id, sku)` when touched.
3. **id-keyed reads** (929, 943, staff 178, 407/438/457) — UUIDs are
   globally unique so nothing breaks, but a cross-tenant id lookup is a
   leak vector; add the filter for defense-in-depth.
4. **Lists & aggregations** — only a leak if foreign rows exist; no
   change needed while each POS keeps its own DB file.

**Recommended approach (not sprinkling 40+ `WHERE tenant_id` clauses):**

- **Scope by construction**: the desktop/tablet app keeps one DB file per
  store, so foreign rows should never exist. Add a cheap startup
  integrity check (`SELECT COUNT(*) FROM products WHERE tenant_id !=
  'default'`) that fails loudly if they appear, instead of rewriting the
  whole Store.
- **Fix the must-break set** (bucket 1, ~10 statements) when multi-tenancy
  actually ships.
- **Defer** id-keyed defense-in-depth and the aggregation surface until
  the Store is ever pointed at shared data — today the cloud syncs
  reference data *into* the local DB rather than reading from it.

This mirrors how the cloud side was handled: per-tenant constraints + the
queries that break under them, not a wholesale tenant API.

### Test plan (what proves the port is right)

| Area | Test | Backend |
|------|------|---------|
| REST round-trip (product/tax/user/plan/sale/terminal, oversell, state machine) | `pg_integration_rest_roundtrip` (oz-api) | live PG |
| Concurrency (stock, status transitions) | the two `pg_integration_concurrent_*` tests | live PG |
| Multi-tenant isolation (shared SKU/username across tenants) | `pg_integration_tenant_sku_isolation` | live PG |
| RLS fail-closed + deployment cutover | `pg_integration_rls_fails_closed` + `pg_integration_rls_force_blocks_owner` (cloud-server) | live PG |
| Sync store push/pull/snapshot/plan | `pg_integration_sync_store_*` (cloud-server) | live PG |
| Webhooks dedup, tenant resolution, plan writes | `pg_integration_webhooks_read_write_postgres` | live PG |
| Webhook path as the restricted `oz_app` role post-cutover (FORCE RLS): resolution reads via `oz_webhook_resolver`, writes via the GUC, dedup, plan update | `pg_integration_webhooks_restricted_role_after_cutover` — real cutover script + real signed HTTP payloads on a throwaway DB; fails without the resolver role | live PG (throwaway DB) |
| Prune retention batching + hostile-id-as-data | `pg_integration_prune_*` + unit tests | live PG + SQLite |
| Email analytics bundle + settings | `pg_integration_email_loop_reads_postgres` | live PG |
| Per-tenant report scheduling (bundle isolation, scoped settings keys, enumeration order) | `pg_integration_email_loop_reads_postgres` per-tenant assertions | live PG |
| `sent_reports` at-most-once claim + 90-day retention | `pg_integration_sent_reports_claim_release` + `pg_integration_sent_reports_skips_claimed_period_before_smtp` + `pg_integration_prune_ages_out_old_sent_reports` | live PG |
| Settings endpoint (admin-gated provisioning) | `settings_*` unit tests in `crates/oz-api/src/routes/settings.rs` — `settings_require_admin_key_when_configured`, `put_then_get_round_trips_typed_config`, `scoped_keys_are_written_suffix_form`, `scoped_key_falls_back_to_bare`, `null_deletes_scoped_override`, malformed-input rejections | unit |
| SQLite → Postgres cutover | migration bin unit tests + live-PG integration incl. idempotent re-run | live PG |
| CI gate | Postgres service container added to `ci.yml` (`rust-test-fast` + `rust-test-apps`) with `OZ_TEST_PG_URL`, so the skip-if-unreachable tests can no longer silently skip in CI | CI |

All tests run with `OZ_TEST_PG_URL` set against one Postgres 16 and coexist
(unique namespaces + cleanup); `cargo test -p oz-api` 162 (+1 doctest),
`oz-cloud-server` 166 (+5 migration bin +2 main bin), `oz-core --lib` 1774,
migration bin 5 — all verified green on the 2026-08-15 final pass.

### Implementation audit (2026-08-15): claims vs. code

Re-read the whole plan and checked every load-bearing claim against the
implementation. **Verified present and tested:** `OZ_PRODUCTION=1` startup
secret enforcement (+ `production_requires_both_secrets`), `OZ_PRODUCTION`
→ `OZ_DB_REQUIRE_TLS` implication, `sslmode=require` fail-closed,
`/api/v1/tokens` rate limit (30/min/IP), license `api_key` bcrypt + SHA-256
lookup with lazy legacy migration, the license 5/IP/hr activate limiter
(SQLite-persisted), the plan gate (`OZ_ENFORCE_PLANS` → 403
`plan_required`), redirect mode (`OZ_REDIRECT_ONLY` → 421), the per-tenant
5-min snapshot cache (tenant-keyed, adaptive TTL), the `/health` +
`/metrics` endpoints (incl. `PRUNE_QUEUE_DELETED_TOTAL`), Stripe/Square
signature verification tests, the unified packaging files, and SIGTERM
handling in supervisord.

**Gaps found (the improvement list below).** All are either small code
items with tests, or documented deployment items — nothing contradicts the
plan's design.

### Next improvements (2026-08-15 audit) — prioritized, with tests

| # | Improvement | Why | Tests to add |
|---|-------------|-----|-------------|
| 1 | **CORS allowlist** — **done**: `allow_origin(Any)` replaced with an env-configured list (`OZ_CORS_ORIGINS`, defaulting to the §11 origins + `http://localhost:4321`); `Any` stays only when the env explicitly sets `OZ_CORS_ORIGINS=*` | The doc requires an explicit allowlist before the website ships; today every origin gets `access-control-allow-origin: *` | `parse_cors_origins_defaults_to_documented_allowlist` / `_parses_comma_list` / `_star_means_allow_all` / `_blank_denies_all`; `cors_allowed_origin_is_echoed`, `cors_disallowed_origin_gets_no_header`, `cors_preflight_allowed_origin_returns_allow_header`, `cors_preflight_disallowed_origin_gets_no_allow_header` — all in `crates/oz-api/src/lib.rs` |
| 2 | **Security headers middleware** — **done**: `security_headers_middleware` on the oz-api + cloud routers sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'`, and `Strict-Transport-Security` (production only, via `security_header_value`) | §11 lists all four; none are set today | `security_headers_present_on_health` (health returns all four headers); `security_header_hsts_only_in_production` (HSTS absent in dev, present when `OZ_PRODUCTION=1`) — both in `crates/oz-api/src/lib.rs` |
| 3 | **Analytics expression index** — **done**: `CREATE INDEX idx_sales_status_created_date ON sales (status, date(created_at))` ships in the SQLite schema (SQLite guard bumped 122 → 123); the generator skips it for PG with a comment | Deferred item 2 in §11.5: the report queries filter `status = 'completed'` + `DATE(created_at) BETWEEN …`; the cast defeats `idx_sales_created_at` today. **PG can't have it**: text→date casts are STABLE (DateStyle-dependent), so `CREATE INDEX` on `date(created_at)` is rejected as non-IMMUTABLE (verified against live PG 16) — the PG report job stays a scan (fine for a background daily job) | `analytics_query_uses_status_created_date_index` (in `crates/oz-core/src/migrations.rs`) runs `EXPLAIN QUERY PLAN` and asserts the SQLite planner picks the new index (and NOT `idx_sales_created_at`); the email PG analytics test still green; `PG_INIT` still applies cleanly |
| 4 | **`sent_reports` retention** — **done**: the PG prune cycle now deletes claims older than 90 days (same horizon as `offline_queue`), after the queue loop | The dedup table grows one row per (tenant, period) forever; old claims are only useful while a crash-recovery retry window could still collide | `pg_integration_prune_ages_out_old_sent_reports` (live-PG, in `apps/cloud-server/src/prune.rs`): seeds an old claim + fresh claims for two tenants → only the old one is swept, fresh claims for *both* tenants survive (no over-delete); new `prune_sent_reports_deleted_total` counter mirrors the queue one |
| 5 | **Desktop tenant-foreign-row startup check** — **done**: `Store::check_tenant_integrity()` (two indexed COUNTs on `idx_products_tenant`/`idx_users_tenant`, naming the offending table(s)) wired into both `AppState::new` startup paths (desktop + tablet) right after migrations — a foreign row refuses to boot | §11.5's desktop audit recommends exactly this instead of sprinkling 40+ `WHERE tenant_id` clauses; today only `PRAGMA integrity_check` (page corruption) exists | `check_tenant_integrity_passes_on_clean_db` (clean + default-tenant rows); `_rejects_foreign_product` / `_rejects_foreign_user` (error names the table); `_reports_both_violations` — all in `backup_restore_integration.rs` |
| 6 | **RLS deployment cutover** — **done**: `scripts/rls-cutover.sql` (idempotent, pure SQL: creates restricted non-owner `oz_app` role, grants DML on the 15 tenant tables + the 6 auxiliary REST tables (`sale_lines`, `inventory`, `stock_movements`, `stock_summary`, `categories`, `roles`) + the webhook-path tables (`processed_webhooks`, `payments`), creates the `oz_webhook_resolver` role (NOLOGIN BYPASSRLS, granted to `oz_app`) for the pre-tenant resolution reads, `FORCE ROW LEVEL SECURITY` on all 15; header documents the webhook/`distinct_tenant_count` GUC exceptions) + the cloud sync data layer opens every Postgres transaction with `SET LOCAL oz.tenant_id` (`set_config(..., is_local := true)`, auto-reset on pool return), and the webhook handlers scope their post-resolution writes the same way while their resolution reads run under tx-scoped `SET LOCAL ROLE oz_webhook_resolver` | The last enforcement item; schema-side RLS shipped + proven, but the owner bypassed it | `pg_integration_rls_force_blocks_owner` (live-PG): executes the real script verbatim in a transaction twice (idempotency; 15 tables FORCEd; rollback restores), then proves on a dedicated non-superuser OWNED table that FORCE blocks the owner without the GUC (0 rows + INSERT rejected) and unblocks with it; the sync PG roundtrip test stays green through the transaction refactor. `pg_integration_webhooks_restricted_role_after_cutover`: real cutover + signed HTTP payloads as `oz_app` on a throwaway DB — payment resolution → enqueue under the sale's tenant → redelivery dedup → subscription plan update → mapping upsert, plus an RLS-live proof; fails without the resolver role |
| 7 | **License server** — **done**: `/status` now shares the persisted 5/IP/hr token bucket (applied before auth, like activate/renew), and the legacy body-`api_key` fallback is **removed** from all three endpoints — the `Authorization: Bearer` header is the sole credential channel (body-only → 401 + `WWW-Authenticate: Bearer` hint; activate still allows a credential-less first activation). The desktop client matches: activate/renew send the key via `.bearer_auth()` and `#[serde(skip_serializing)]` keeps it out of the request body | Both were documented gaps (§11): `/status` was unthrottled; the body fallback leaked the secret into access logs | `TestStatusHandler_RateLimited` (6th `/status` call in an hour → 429); `TestRenewHandler_RejectsBodyAPIKey` + the AuthPaths tables (body-only → 401 + `WWW-Authenticate`; header wins when both present, body ignored); all pre-existing handler tests migrated to the Bearer header; Rust `renew_license_request_serializes_snake_case` asserts `api_key` never appears in the request body |
| 8 | **Doc hygiene** — **done**: the §6.1 step-1.1 row now states the real surface (93 tables / 122 PG indexes / 4 triggers; SQLite 123 indexes with the SQLite-only expression index called out), and the §11.5 test matrix gained rows for RLS fail-closed + cutover, per-tenant report scheduling, `sent_reports` at-most-once + retention, and the settings endpoint | Keep the plan doc truthful | — |
| 9 | **Operations checklist (deploy-time)** — **done**: `docs/operations/runbook.md` now documents Postgres PITR (managed addon, RPO ≤ 5 min / RTO ≤ 1 h, monthly restore drill), PocketBase backup (litestream **or** nightly `VACUUM INTO` / `scripts/backup-db.sh`, RPO ≤ 24 h), the desktop `backup-db.sh`/`restore-db.sh` pair, a quarterly two-DB restore drill checklist, Prometheus rules for retention flatline, queue depth (polling `/health` — a JSON field, not a gauge), webhook 5xx, token-mint rate, sync 429s, health degraded, pull decode failures, and DB contention, plus the RLS cutover deploy step and the startup-secret/TLS fail-closed contract; and `rate_limit_429_total{limiter}` + `webhook_5xx_total` counters ship with `metrics_render_rate_limit_and_webhook_counters` (drives both paths through a real router and asserts `/metrics` renders them) | §11 reliability table items are all still paper | a `docs/operations/` runbook entry; the metrics additions get a smoke test that the endpoint renders the new counters |

All nine items are done and committed individually — 1–5 + 8 as code/doc slices
with tests, 6 as the RLS enforcement step (deployment script + request wiring +
FORCE proof), 7 in the Go license server, 9 as the ops runbook + metrics
counters. Every item's row above is marked **done** with its tests listed.

---

## 12. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Postgres path was a 2-table stub | **Resolved** — full 93-table schema + sync function + prune retention + REST handlers + webhooks + the report-sender email loop + the 1.4 migration tool all run on Postgres; the only remaining SQLite surface is the `archive_stock_movements` stock rollup (deliberate — autovacuum supersedes it) |
| Prune/report loops are SQLite-only (`incremental_vacuum`, `rusqlite::Connection`) | Offline-queue retention is ported + re-wired on Postgres (step 1.5) and the report-sender loop runs on Postgres (`email_pg`); only the `archive_stock_movements` rollup remains SQLite-only (autovacuum supersedes it on PG); retention counter confirms aging |
| In-memory rate limiter is per-process | Fine for one node; move to a shared store (Redis) only if the sync function is scaled out |
| Snapshot cache is also in-memory | Same — Redis/shared store on scale-out |
| Dev-secret fallback / open token mint in prod | Fail startup if `OZ_API_SECRET` / `OZ_ADMIN_KEY` unset |
| Postgres pool was `NoTls` | Now rustls; startup fails unless `DATABASE_URL` sets `sslmode=require` (`OZ_DB_REQUIRE_TLS=1` or `OZ_PRODUCTION=1`) |
| `api_key` stored plaintext | Done: bcrypt + SHA-256 lookup; legacy rows migrated lazily |
| PocketBase SQLite has no backup | litestream / nightly `VACUUM INTO` + restore drill |
| Data loss during SQLite → Postgres | Back up SQLite, verify row counts + checksums, replay window |
| Two databases drift | JWT `tenant_id` is the single identity; webhooks mirror plan state; reconcile if a cross-DB query appears |
| Supervisor / reverse proxy failure | Aggregate healthcheck; keep the two processes independently restartable |
| POS breakage | No protocol change; redirect mode (421) catches stragglers |
| PocketBase single-node | Holds only low-traffic auth data; migrate web_users to a hosted provider if it outgrows |
| Sync conflicts | Version-based optimistic concurrency (existing) |
| Lost stock updates under concurrency (read-outside-tx) | Fixed: `adjust_stock` locks the product row (`FOR UPDATE`) inside the tx; concurrent-adjust test proves no lost updates |
| Double-applied sale status transitions under concurrency | Fixed: compare-and-swap `UPDATE … WHERE status = $current`; concurrent-transition test proves exactly one winner |
| PG integration tests silently skip in CI | Fixed: Postgres service container + `OZ_TEST_PG_URL` in `ci.yml` (`rust-test-fast`, `rust-test-apps`) |

---

## 13. Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1**: Finish Postgres backend | 1-2 weeks | Full schema + oz-api on Postgres + data migration |
| **Phase 2**: Combine into one image | 1 week | Dockerfile + supervisor + reverse proxy |
| **Phase 3**: Deploy one service | 1 week | Northflank service + Postgres addon + cutover |
| **Total** | ~3-4 weeks | One deployment, two functions |

---

## 14. Success Criteria

| Criterion | How to Verify |
|-----------|---------------|
| One deployment | One Northflank service, one image, one public URL |
| Two functions | PocketBase (auth) + Rust (sync) both healthy in the one container |
| Sync on Postgres | Sync, prune, REST, webhook, and email/report reads/writes hit Postgres; the in-memory SQLite REST fallback is gone — the only remaining SQLite surface is the `archive_stock_movements` rollup (deliberate; autovacuum supersedes it) |
| License works | activate/renew/status behave as today |
| Sync works | POS pushes/pulls via the unchanged contract |
| Webhooks work | Stripe/Square update plans and enqueue `finalize_sale` |
| One identity | JWT `tenant_id` scopes every sync row to the canonical tenant |
| No data loss | Row counts + checksums match after the SQLite → Postgres migration |
| Anti-spike loops survive | Rate limits still return `429`; the hourly prune ages `offline_queue` on Postgres and the retention counter increments; the report-sender loop runs on Postgres; the `stock_movements` rollup remains SQLite-only (deliberate) |
| Secrets enforced | `OZ_PRODUCTION=1` fails startup unless `OZ_API_SECRET` and `OZ_ADMIN_KEY` are set (no dev fallback / open mint) |
| Backups verified | A restore drill recovers both Postgres and PocketBase SQLite to a known point |
| Alerts fire | A flatlined retention counter or growing queue depth pages a human |

> last audited 29-09-26 by docs-auditor
