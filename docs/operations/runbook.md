# Operations Runbook — kasir.mu (unified Northflank deployment)

<!-- Audit stamp: 2026-09-08 · DSH · status: ACCURATE after repair (4 findings) · SUPERSEDES the 2026-08-31 stamp, which was honest when written — "ACCURATE (0 findings)", verified against HEAD that apps/unified/healthcheck.sh and docs/archived/2026-08-15-unify-auth-and-sync.md exist and that the sync-path claims held. It was overtaken by events, and that is the finding: 23c963303 retired ten workflows to .bak on 2026-09-02, two days later, and swept none of the operational docs that named them. · REPAIRED: (1) §8.5 headline claimed "Merges to main now auto-deploy" via deploy.yml — that file is .bak, and its successor northflank-deploy sits in dev-ci.yml, whose on: block has only pull_request + workflow_dispatch, so the job's own push-branch condition is unreachable dead logic (flagged, not fixed: adding push: branches: [main] reinstates automatic production deploys, and that job omits release-readiness from its needs). Deploys are manual-only via Run workflow. (2) The §8 summary table repeated the same false trigger. (3) §8.5 recommended deploy.yml as "the preferred, auditable path" over Northflank native git triggers — the recommended path is gone, leaving the discouraged one as the only automatic option. (4) §9 claimed the website deploys via website.yml → npx wrangler deploy — zero wrangler references exist in any live workflow, and dev-ci.yml#website stops at Build; the deploy is npm run deploy from website/, by hand. · CODE FINDINGS FLAGGED, NOT PATCHED: the dead push branch above, and website/package.json:17 ("deploy": "bash ../scripts/wrangler-deploy.sh") — the only npm script in the repo invoking bare bash, which AGENTS.md records as resolving to WSL on this platform where it hangs until killed or runs Linux node against Windows-built node_modules. AGENTS.md's own env-var section recommends that command while its own Windows section says bare bash hangs: two correct documents, one contradiction, neither wrong when written. · REV 2 (09-09-26, docs-auditor, CI-claim pass) — status: ACCURATE AFTER REPAIR (4 findings) + 3 more stale-CI instructions fixed in the same section, all of them leftovers of the same retirement. Repaired: §9.2 named the PR `check` job and the `deploy` job (both only in `website.yml.bak:71`/`:144`) and §9.5 told the reader to treat a red `deploy` job as an incident (`.github/workflows/website.yml.bak` is inert since `23c963303`, 2026-09-02) — §9.2 now states plainly that nothing deploys the website and that a rejected token no longer has any CI surface at all, and §9.5 pages on the live-site probe instead. Also dead: §9.3 probe #1 (`gh run list --workflow "Website Deploy"` lists no runs — the empty list is the missing workflow, not health), the §9.3 note claiming the fail-fast credential step runs as the deploy job's first step (`website.yml.bak:155`, retired with it), §9.4 step 4's "re-run the last failed run / push a trivial change" (no run exists, and `dev-ci.yml` has no push trigger; `dev-ci.yml:137-163` builds the site and stops), and §9.1/§9.4's "put it in the GitHub secret store" (`git grep -l CLOUDFLARE_API_TOKEN -- .github/workflows` → `website.yml.bak` only; the live consumer is `scripts/wrangler-deploy.sh:42` reading the environment). Verified from the files: live workflows are `dev-ci.yml` + `release.yml` only; `dev-ci.yml` `on:` is `pull_request: branches: [main]` + `workflow_dispatch` with no `push:` and no `schedule:`; `static-gates` has 28 named steps. Nothing weakened: every open recommendation in §9.5 stays open and is now explicitly unbuilt. · STILL TRUE, re-checked not assumed: backup-pb.sh and litestream.yml are server-side artifacts the operator creates under /opt/oz, not repo files, so their absence from the tree is correct and my sweep's flags against them are false positives. · WHY THIS SLIPPED THE NET: verify-ci-docs-drift.py polices ci-pipeline.md, releases/checklist.md and the pre-commit hook — not this runbook. A workflow retirement updates the checked page and leaves the unchecked one naming the dead file. -->

One Northflank service, one Docker image. Two functions behind one caddy
reverse proxy (single public port):

| Function | Process | Internal port | Data |
|----------|---------|---------------|------|
| Auth (license) | PocketBase + Go hooks | 8080 | PocketBase SQLite (`pb_data/data.db`) |
| Sync (cloud) | Rust axum | 3099 | Postgres (managed addon) |

This runbook covers the §11 reliability contract of `docs/archived/2026-08-15-unify-auth-and-sync.md`:
Postgres PITR, PocketBase backup, restore drills, and alerting on retention
flatline, queue depth, webhook 5xx, and token-mint rate. It also documents the
metrics that make each incident observable.

---

## 1. Monitoring Surfaces

### `GET /health` (public, no auth)

JSON — the aggregate healthcheck target. `status` is `"ok"` when the DB ping
succeeds, `"degraded"` otherwise:

```json
{
  "status": "ok",
  "sync_queue_depth": 0,
  "db_latency_us": 1200,
  "last_sync_at": "...",
  "db_kind": "postgres"
}
```

`sync_queue_depth` is a **JSON field, not a Prometheus gauge** — alert on it by
polling `/health` (see §5). `db_kind` tells you which backend the server is on
(`sqlite` during the cutover window, `postgres` after).

### `GET /metrics` (Prometheus text)

All counters below are rendered here. `GET /api/sync/status` (JWT-authed) is
the per-tenant view: health, version, the tenant's pending queue depth, and
the tiered heartbeat interval.

### `apps/unified/healthcheck.sh` (container healthcheck)

Checks **both** processes, DB connectivity, and pending queue depth — not just
"port is open". A failing healthcheck is what the orchestrator uses to restart
or drain the container.

---

## 2. Metrics Reference

| Metric | Type | Meaning |
|--------|------|---------|
| `health_checks_total` / `health_check_failures_total` | counter | Health endpoint hits / DB-ping failures. A rising failure count = DB unreachable. |
| `health_db_latency_micros` | histogram | DB ping latency. |
| `sync_pushes_total{outcome}` | counter | Pushed items, by `accepted` / `conflict` / `rejected`. |
| `sync_anchor_expired_total` | counter | 410 `anchor_expired` responses (client `since` older than the pruned window). |
| `sync_pull_row_decode_failures_total` | counter | Rows that failed to decode during pull — **schema drift between server and store**. Any increase is a bug, not noise (SYNC-10). |
| `sync_push_duration_ms` / `sync_pull_duration_ms` / `sync_batch_size_bytes` | histogram | Sync latency + payload size. |
| `db_connection_contention_seconds{handler}` | histogram | DB lock acquisition time per handler. High p99 = pool starvation. |
| `prune_queue_deleted_total` | counter | `offline_queue` rows deleted by the hourly prune (90-day horizon). |
| `prune_sent_reports_deleted_total` | counter | `sent_reports` dedup claims deleted by the same prune. |
| `rate_limit_429_total{limiter="sync"}` | counter | 429s from the per-tenant sync limiters (push 100/min, pull 300/min, snapshot 50/min, status 300/min). |
| `rate_limit_429_total{limiter="token"}` | counter | 429s from the token-mint limiter (30/min per client IP). Sustained growth = brute force or a broken client. |
| `webhook_5xx_total` | counter | 5xx from the Stripe/Square webhook handlers. Any increase means real payment events are failing server-side and payment/plan state may be stale. |

The license server (Go) exposes no Prometheus metrics; its rate limiter is the
persisted 5/IP/hr bucket for activate/renew/status, observable only through
HTTP 429s in its access logs.

---

## 3. Incident Response

### 3.1 DB connection failure

- **Symptom:** `/health` → `"status": "degraded"`; `health_check_failures_total` increments; cloud-server logs DB errors.
- **Action:** Check the Postgres addon status on Northflank (the managed DB, not the container). Verify `DATABASE_URL` and that the app connects as the post-cutover role (§6.3). Check pool exhaustion (`db_connection_contention_seconds` p99 high, `OZ_DB_POOL_SIZE` too low).
- **Escalation:** > 2 min → on-call. Postgres itself unreachable → follow the addon's failover procedure; the sync function degrades (POS keeps working offline — the offline queue absorbs the outage by design).

### 3.2 Sync queue backlog

- **Symptom:** `sync_queue_depth` (from `/health`) stays elevated; pull latency (`sync_pull_duration_ms`) climbs.
- **Action:** Identify the tenant(s) via the sync API logs / `rate_limit_429_total{limiter="sync"}`. A small queue is normal (offline POS devices flush on reconnect); a *growing* queue with no 429s means pushes are failing server-side — check webhook `finalize_sale` path and DB writes.
- **Escalation:** `sync_queue_depth > 500` for 10 min → page on-call.

### 3.3 Webhook 5xx (payments)

- **Symptom:** `webhook_5xx_total` increases.
- **Action:** Webhooks are the payment-authenticity boundary — a 5xx means Stripe/Square events failed server-side. Check `STRIPE_WEBHOOK_SECRET` / `SQUARE_WEBHOOK_SIGNATURE_KEY` first (a misconfigured secret is the most common cause), then DB errors. Stripe redelivers with backoff, so the damage self-heals once the root cause is fixed.
- **Escalation:** any sustained increase over 15 min → on-call (payment/plan state may be stale).

### 3.4 Token-mint brute force

- **Symptom:** `rate_limit_429_total{limiter="token"}` increases (minting is rare in normal operation — once per terminal boot or JWT expiry).
- **Action:** A 429 cluster on `token` means someone is hammering `POST /api/v1/tokens` (admin key or client credentials). Check the mint logs for the client IP, verify no leaked `OZ_ADMIN_KEY`/`OZ_API_SECRET`, rotate secrets if there is any doubt.
- **Escalation:** sustained 429s for 15 min → on-call; block the offending IP at the proxy.

### 3.5 Tenant hammering sync

- **Symptom:** `rate_limit_429_total{limiter="sync"}` sustained (per-tenant limiters: push 100/min, pull 300/min, snapshot 50/min, status 300/min).
- **Action:** A tenant in a 429 loop is a buggy client or misconfiguration, not an attack. Identify the tenant from logs; check its `client_id`/`client_secret` and the JWT expiry/re-mint path. The limiter already protects the DB — no emergency action needed beyond contacting the tenant.
- **Escalation:** if one tenant's traffic degrades the shared Postgres pool, disable that tenant's sync temporarily (the offline queue absorbs it).

### 3.6 Retention flatline

- **Symptom:** `prune_queue_deleted_total` **and** `prune_sent_reports_deleted_total` stay flat while the queue has rows older than 90 days.
- **Action:** The hourly prune (`start_prune_loop_pg`) deletes `offline_queue` rows > 90 days in 500-row batches plus `sent_reports` claims at the same horizon. A flatline with old rows present means the loop died — check the cloud-server logs for the prune task, then restart the server (supervisord restarts it).
- **Escalation:** flatline for 7 days with old rows present → on-call; unbounded `offline_queue` growth is a disk + pull-latency risk.

### 3.7 Pull decode failures (schema drift)

- **Symptom:** `sync_pull_row_decode_failures_total` increases.
- **Action:** This is a **code bug**, not an ops issue — the server and the row decoder disagree on the `offline_queue` schema. Clients receive 5xx, not silently truncated pages. Revert the offending deploy.
- **Escalation:** any increase → on-call (every client pull fails).

### 3.8 High error rate

- **Symptom:** `webhook_5xx_total` + `health_check_failures_total` climbing, sync latency degraded.
- **Action:** Check the latest deploy for regressions; verify external dependencies (payment gateway, license server, Postgres addon).
- **Escalation:** roll back the last deploy if error rate doesn't recover in 5 min (the image is one deployable unit — rolling back restores both functions together).

### 3.9 RLS fail-closed surprise (queries return 0 rows)

- **Symptom:** sync/REST handlers return empty results or rejected writes for data that exists; not a crash.
- **Cause:** RLS is **enforced** post-cutover (§6.3). Every tenant-touching query must run inside a transaction whose first statement is `SET LOCAL oz.tenant_id = '<tenant>'` (the sync data layer does this automatically in `apps/cloud-server/src/sync_store.rs`). A zero-rows result means the GUC was not set — a missed tenant scope is failing closed *by design*.
- **Action:** Check the handler actually went through the tenant-scoped sync layer rather than a raw connection. Do **not** "fix" it by disabling RLS.
- **Escalation:** if a legitimate path is broken, revert that path's code change.

---

## 4. Backup & Restore

### 4.1 Postgres (managed addon) — PITR

The sync DB is the only data that scales and the only one that must never lose
a committed write. Rely on the managed addon's backup service, **not** on the
container:

- **Enable** the addon's automated backups (daily full snapshot) and **PITR**
  (WAL archiving). Keep ≥ 7 days of PITR window so a logical corruption can be
  rewound past its introduction.
- **Verify** the backup job runs on schedule (Northflank dashboard) and that
  the storage target is outside the app's own volume.
- **RPO ≤ 5 min** (PITR replay of WAL), **RTO ≤ 1 h** (restore to a new addon
  instance + repoint `DATABASE_URL`).

**Restore drill (monthly):** restore the latest snapshot + PITR replay to a
throwaway addon instance, run the verification query set (§4.4), then delete
the throwaway. A drill that has never been executed is not a backup strategy.

### 4.2 PocketBase SQLite (auth)

Low-traffic, but irreplaceable: `tenants`, `license_keys`, `subscriptions`,
`tenant_machines`. Two acceptable strategies per `docs/archived/2026-08-15-unify-auth-and-sync.md`:

**Option A — litestream (continuous, recommended):** replicate
`/data/pb_data/data.db` to object storage continuously. Minimal config:

```yaml
# litestream.yml
dbs:
  - path: /data/pb_data/data.db
    replicas:
      - url: s3://<bucket>/pb-data
        retention: 72h
```

**Option B — nightly `VACUUM INTO` + off-machine copy (simpler):** `VACUUM
INTO` produces a consistent, compacted snapshot that is safe to take while
PocketBase is running:

```bash
# cron — every night 02:00
0 2 * * * bash /opt/oz/backup-pb.sh
```

```bash
# /opt/oz/backup-pb.sh
set -euo pipefail
SNAP="/backups/pb-data-$(date +%Y%m%d-%H%M%S).db"
sqlite3 /data/pb_data/data.db "VACUUM INTO '$SNAP'"
gzip -f "$SNAP"                                   # then ship to S3/GCS
find /backups -name 'pb-data-*.db.gz' -mtime +30 -delete
```

The generic `scripts/backup-db.sh` also works against any SQLite file
(integrity check → consistent `.backup` → gzip → retention): `bash
scripts/backup-db.sh /data/pb_data/data.db` with `BACKUP_DIR=/backups`.

**RPO ≤ 24 h** (nightly) or **≤ 5 min** (litestream), **RTO ≤ 1 h**.

### 4.3 Desktop POS SQLite (per-install)

Each POS keeps its own local SQLite store. The shipped scripts handle it:

- Backup: `bash scripts/backup-db.sh [db-path]` (integrity check, consistent
  `.backup`, gzip, 30-day retention; `BACKUP_DIR`/`RETENTION_DAYS` env).
- Restore: `bash scripts/restore-db.sh <backup-file> [db-path]` (verifies the
  backup, snapshots the current DB as `.pre-restore`, replaces, drops stale
  `-wal`/`-shm` sidecars, final smoke query).

### 4.4 Restore drill checklist (quarterly — both databases)

1. **Postgres:** restore the newest snapshot + WAL to a throwaway addon;
   verify with `SELECT count(*) FROM offline_queue; SELECT count(*) FROM
   sales;` and a tenant-scoped spot check (`SELECT ... WHERE tenant_id =
   '<tenant>'` with `SET LOCAL oz.tenant_id`); confirm row counts match the
   production addon's `pg_stat_user_tables`.
2. **PocketBase:** restore the newest backup into a scratch PocketBase;
   verify `tenants`, `license_keys`, `subscriptions`, `tenant_machines` row
   counts and that a sample `api_key_lookup` still resolves (hash lookup is
   data — a truncation shows up as a failed lookup).
3. **Time the drill.** RTO is "restore + verify + repoint" end-to-end; if it
   exceeds the target, fix the process before you need it.
4. **Record** the drill result (date, RTO observed, any deviation).

---

## 5. Alerting

Rules below assume a Prometheus scraping `/metrics` on the cloud server and a
`/health` poller for queue depth (JSON, not a gauge — poll with curl + jq on a
cron, or a json_exporter scrape).

| Alert | Expression | For | Severity |
|-------|-----------|-----|----------|
| Retention flatline | `increase(prune_queue_deleted_total[7d]) == 0` **and** `increase(prune_sent_reports_deleted_total[7d]) == 0` | 7d | warning (prune loop dead; verify old rows actually exist first) |
| Queue depth growing | `/health` → `sync_queue_depth > 100` | 5 min | warning |
| Queue depth critical | `/health` → `sync_queue_depth > 500` | 10 min | page |
| Webhook 5xx | `increase(webhook_5xx_total[15m]) > 0` | 15 min | warning (payment events failing server-side) |
| Token-mint brute force | `increase(rate_limit_429_total{limiter="token"}[15m]) > 0` | 15 min | warning (minting is rare; 429s = attacker or broken client) |
| Sync tenant abuse | `increase(rate_limit_429_total{limiter="sync"}[5m]) > 0` | 5 min | info → warning if sustained |
| Health degraded | `increase(health_check_failures_total[5m]) > 0` | 5 min | page |
| Pull decode failures | `increase(sync_pull_row_decode_failures_total[1h]) > 0` | 1 h | page (schema drift — every client pull fails) |
| DB contention | p99 `db_connection_contention_seconds` > 1 s | 10 min | warning (pool starvation → raise `OZ_DB_POOL_SIZE` or add capacity) |

License-server 429s (5/IP/hr activate/renew/status) have no metric — alert
from access-log error counts (e.g. Prometheus mtail / Loki) if the auth
function comes under attack.

---

## 6. Deployment & Lifecycle

### 6.1 Process supervision

Supervisord runs both functions in one container and **restarts each
independently**; it forwards SIGTERM so rolling deploys shut down gracefully
(drain in-flight sync, flush WAL). `docker-entrypoint.sh` fixes volume
ownership before exec'ing supervisord. The container healthcheck
(`apps/unified/healthcheck.sh`) gates traffic on both functions + DB.

### 6.2 Startup secrets (fail closed)

In production, `OZ_PRODUCTION=1` must be set. It makes the server **refuse to
start** if `OZ_API_SECRET` or `OZ_ADMIN_KEY` is unset (no dev-secret
fallback, no open token mint) and implies `OZ_DB_REQUIRE_TLS=1` (startup
fails if `DATABASE_URL` lacks `sslmode=require`). Keep all three in the
Northflank secret store, never in the image.

The `ops/docker/docker-compose.yml` full-stack path enforces this even earlier: both
`OZ_API_SECRET` and `OZ_ADMIN_KEY` use the `:?` required interpolation, so
`docker compose up` fails at parse time when either is unset — regardless of
`OZ_PRODUCTION` (DOCKER-04). Generate both with `openssl rand -hex 32`.

The license server has its own fail-fast boot gates (Paddle webhook secret + price
tiers are unconditional; Brevo SMTP once `OZ_SMTP_HOST` is set) — the ordered,
paste-ready checklist for taking the deployed instance from pre-gate to sandbox-live
is [`go-live-checklist.md`](./go-live-checklist.md), with the full variable reference in
`apps/license-server/DEPLOY.md` §7.

### 6.3 RLS cutover (one-time deploy step)

Tenant isolation ships in two halves; both must be true before multi-tenant
data is exposed:

1. **Schema side (already shipped):** the generated PG migration enables RLS
   + a `tenant_isolation` policy on the 15 tenant tables, and the sync data
   layer opens every transaction with `SET LOCAL oz.tenant_id`.
2. **Cutover (must be run):** as the DB owner, run
   `psql "$DATABASE_URL" -f scripts/rls-cutover.sql` — it creates the
   restricted `oz_app` role, grants DML (including the non-RLS webhook
   tables `processed_webhooks` / `payments`), creates the
   `oz_webhook_resolver` role (NOLOGIN BYPASSRLS — used by the webhook
   handlers for their pre-tenant resolution reads via tx-scoped `SET LOCAL
   ROLE`, so it never needs a password), and `FORCE ROW LEVEL SECURITY`s
   the 15 tables so the table-owner bypass no longer applies. Then enable
   login on the role and **point `DATABASE_URL` at `oz_app`** **and set
   `OZ_APPLY_SCHEMA=0`** — without it, startup re-applies `PG_INIT` (full
   DDL) and fails with `permission denied for schema public`, because
   `oz_app` only has DML grants. The schema is applied once by the
   migration tool as the owner; the app then boots without touching DDL.
   From then on, a missed `WHERE tenant_id = ?` returns zero rows instead
   of leaking. Reversible: `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`
   on all 15 + `DROP ROLE oz_app` + `DROP ROLE oz_webhook_resolver`.

### 6.4 Rate limits (self-protection — do not weaken)

| Surface | Limit |
|---------|-------|
| `/api/sync/push` | 100/min per tenant |
| `/api/sync/pull` | 300/min per tenant |
| `/api/sync/snapshot` | 50/min per tenant |
| `/api/sync/status` | 300/min per tenant |
| `/api/v1/tokens` | 30/min per client IP |
| License activate/renew/status | 5/hr per IP (persisted to SQLite — survives restarts) |

The sync limiter and snapshot cache are **per-process** (in-memory); scaling
past one sync instance requires moving both to a shared store (Redis) — see
the growth path in `docs/archived/2026-08-15-unify-auth-and-sync.md`.

---

## 7. Disk Space Management

### Log Growth Cap (50 MB per service)

Every service in the Compose stack runs the `json-file` log driver with
`max-size: "10m"` and `max-file: "5"` (set in `ops/docker/docker-compose.yml` and
the prod/pg overrides) — so each service holds **at most 50 MB of logs
(5 × 10 MB) regardless of uptime**. Unbounded log growth that fills the
host disk is no longer possible.

### Check Current Usage

```bash
# Overall Docker disk usage — images, containers, volumes, build cache
docker system df

# Per-container / per-image / per-volume breakdown
docker system df -v

# Host disk (the real limit)
df -h
```

To confirm a service's log rotation is applied (its log file should stay
well under 50 MB):

```bash
docker inspect -f '{{.LogPath}}' oz-pos-pos-cloud-server-1
ls -lh "$(docker inspect -f '{{.LogPath}}' oz-pos-pos-cloud-server-1)"
```

### Prune Policy (safe cron)

**Weekly cron — safe to automate.** Reclaims dangling images, build cache,
and stopped containers. Never touches volumes:

```bash
# crontab -e (root) — every Sunday 03:00, reclaim > 7 days old
0 3 * * 0 docker system prune -f --filter "until=168h"
```

Manual `docker compose down` stops containers without removing volumes,
so an abandoned stack's volumes accumulate until pruned manually.

**Volume pruning is deliberate, manual, and never in cron** — the data
volumes (`oz_cloud_data`, `pb_data`, `redis_data`, `oz_pg_data`) hold the
actual databases:

```bash
# Inspect before deleting anything
docker volume ls
docker volume inspect oz-pos_oz_cloud_data

# Manual cleanup of orphaned volumes only
docker volume prune
```

> ⚠️ **Never** put `docker system prune --volumes` or `docker volume prune`
> in cron — it deletes the SQLite / PocketBase / PostgreSQL data volumes
> and their backups are not automatically restored.

### Incident: Disk Space Pressure

- **Symptom:** `df -h` shows > 85% used; `docker system df` reports large
  reclaimable build cache; services slow or fail to write
- **Action:** `docker system prune -f --filter "until=24h"`; identify the
  biggest consumer with `docker system df -v`; verify log rotation is
  applied (`docker inspect ... .LogPath`)
- **Escalation:** If a data volume (`oz_cloud_data`/`pb_data`) is the
  growth source, run `scripts/backup-db.sh` first, then investigate the
  DB size — never delete the volume as a shortcut

---

## 8. Unified Northflank Deployment (live config)

> **Status:** live since 2026-08-16. One service serves both auth
> (PocketBase) and sync (Rust) behind a single caddy, replacing the two
> standalone services (`oz-pos-license-service` + `oz-sync`).

### Service

| Setting | Value |
|---------|-------|
| Service name | `oz-cloud` |
| Public URL | **two names, one service**: `https://license.kasir.mu` (canonical) and `https://license.ozpos.my.id` (alias) |
| Dockerfile | `ops/docker/Dockerfile.unified` (under `ops/docker/`) |
| Port | `80` (caddy; routes to :8080 PocketBase / :3099 Rust) |
| Volume | single volume at `/data` (Northflank free tier = 1 volume) |
| Build trigger | A push to **`main`** runs Dev CI, and `northflank-deploy` builds the linked branch automatically when `NORTHFLANK_API_TOKEN` is set (`dev-ci.yml:791`). A manual **Actions → Dev CI → Run workflow** also works — but dispatch it **from `main`**: Northflank builds the service's linked branch (`main`, see §8.6) and a dispatch from a `0.0.*` branch is deliberately refused (§8.5), so **code reaches production by landing on `main`, not by dispatching from a release branch**. |

**Single-volume layout (DOCKER-11):**

| Function | Data path |
|----------|-----------|
| Sync (Rust SQLite) | `/data/kasir.db` |
| Auth (PocketBase) | `/data/pb_data/` (`serve --dir=/data/pb_data`) |

Both live under `/data` so one persistent volume covers the whole service.
The old `pb_data:/pb/pb_data` mount from the standalone license service no
longer exists — migrating that data requires a PocketBase backup → restore
(see `docs/archived/2026-08-15-unify-auth-and-sync.md` §Phase 3.5).

### Environment variables

| Variable | Value / source | Notes |
|----------|----------------|-------|
| `OZ_LICENSE_PRIVATE_KEY` | RSA PEM | required — Go license server exits without it (`OZ_LICENSE_KEY` is the legacy alias) |
| `OZ_API_SECRET` | `openssl rand -hex 32` | required when `OZ_PRODUCTION=1` |
| `OZ_ADMIN_KEY` | `openssl rand -hex 32` | required — `ops/docker/docker-compose.yml` fails at parse time when unset; with `OZ_PRODUCTION=1` the server also refuses to start; gates token mint |
| `OZ_ADMIN_EMAIL` | the admin tenant's email | web-dashboard admin identity — the gate compares this to the signed-in tenant's email, and falls back to a compiled-in inbox when unset. **Set it before the admin-identity repair ships — see directly below the table** |
| `OZ_PRODUCTION` | `1` | fail-closed boot: refuses to start if either secret is unset; implies `OZ_DB_REQUIRE_TLS=1` |
| `OZ_ENFORCE_PLANS` | `1` | reject free-plan sync (403 plan_required) |
| `OZ_CORS_ORIGINS` | optional | extra origins beyond the default allowlist |
| `OZ_DB_POOL_SIZE` | `20` | Postgres pool size (ignored for SQLite) |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db?sslmode=require` | optional — switch from SQLite to the managed PostgreSQL addon (free on Northflank). Requires `sslmode=require` (fail-fast at boot). See `docs/archived/2026-08-15-unify-auth-and-sync.md` §Phase 3.5 for the full cutover. The image defaults to `/data/kasir.db` (SQLite); this variable overrides the connection string. |
| `OZ_LOG_FORMAT` | `json` or unset | log output format (plain unless `json`) |
| `OZ_APPLY_SCHEMA` | `0` post-cutover | default applies full DDL at startup; set `0` once the schema exists and the app runs as the restricted `oz_app` role (§6.3) |
| `OZ_REDIRECT_ONLY` / `OZ_SYNC_REDIRECT_URL` | optional | sync-redirect mode — `OZ_REDIRECT_ONLY=true` requires `OZ_SYNC_REDIRECT_URL`; dev/testing only |
| `PADDLE_WEBHOOK_SECRET` | sandbox endpoint secret | Paddle Billing webhook provisioning — **required at boot** (fail-fast gate) |
| `PADDLE_PRICE_TIERS` | `price_id:tier_key` map | **required at boot** — unmapped prices fail provisioning with 500 → Paddle retries |
| `PADDLE_API_URL` | `https://api.paddle.com` (default) / `https://sandbox-api.paddle.com` | Paddle API base for webhook customer lookups; use the sandbox URL until the live catalog exists |
| `PADDLE_API_KEY` | optional | server-side API key — fallback `GET /customers/{id}` when `custom_data.email` is absent (checkout passes it, so rarely needed) |
| `PADDLE_WEBHOOK_MAX_AGE` | `5m` | webhook timestamp replay window |
| `OZ_SMTP_HOST` / `OZ_SMTP_PORT` / `OZ_SMTP_USER` / `OZ_SMTP_PASSWORD` / `OZ_SMTP_FROM` | Brevo relay creds | OTP + license-key receipt emails. Port 465 = implicit TLS, anything else = STARTTLS. `OZ_SMTP_FROM` required at boot once `OZ_SMTP_HOST` is set (sender must be verified with the relay) |
| `OZ_WEB_ALLOWED_ORIGINS` | optional | unset = defaults already include the deployed site + localhost |
| `OZ_WEB_SESSION_TTL` | `24h` | web session lifetime (Go duration) |
| `OZ_DISCORD_WEBHOOK` | optional | support-contact target for `/api/v1/web/contact`; unset → 503 + mailto fallback |
| `OZ_HEALTH_SMTP_MAX_FAILS` | `3` | container healthcheck (unified image): fail after N consecutive `smtp.verified:false` probes |
| `OZ_HEALTH_PADDLE_MAX_FAILS` | `3` | container healthcheck (unified image): fail after N consecutive `paddle.secret_configured:false` probes |

> ⚠️ **Do not set `OZ_PRODUCTION=1` unless both `OZ_API_SECRET` and
> `OZ_ADMIN_KEY` are set** — startup fails fast by design (no dev-secret
> fallback, no open token mint). Without `OZ_PRODUCTION`, the service runs
> in dev mode: `/api/v1/tokens` mints freely. Compose deployments never reach
> that dev mode — the compose file itself fails at parse time unless both
> secrets are set (§6.2).

### Precondition: `OZ_ADMIN_EMAIL` before the admin-identity repair ships

Web admin access is an email match against this variable (`admin_dashboard.go:87-91`, same test at `addon_admin.go:278-282`, `admin_tenant_lifecycle.go:31-37`, `password_rotation.go:176`); while it is unset the match target is a compiled-in inbox (`defaultAdminEmail`, `password_rotation.go:42`). It is in no compose file and no workflow, so assume unset. The repair makes the gate **refuse to match when it is unset** — ship that code first and web admin access stops working until someone sets the variable and restarts. Operator steps, in order (exact commands: `apps/license-server/DEPLOY.md` §7.7.1):

1. Northflank carries `OZ_ADMIN_EMAIL`, and that email already has a `tenants` row with `status=active` — admin self-signup is refused, so the row must have been provisioned out of band.
2. Prove the owner reads that mailbox with one `request-otp` → `verify-otp` round trip: `email_verified` is false by migration default (`main.go:467-484`) and false for webhook-created rows (`paddle_webhook.go:1188`), and admin login never reads it, so a row is not proof of an inbox.
3. Confirm `OZ_ADMIN_KEY` is present — it is break-glass for the **API only** (`admin_dashboard.go:65`, `addon_admin.go:263` authenticate by key), and `website/public/admin/login.js` is session-only, so key-only recovery does not restore the dashboard.
4. Treat `OZ_ADMIN_EMAIL` as write-once: it must never change after first boot, because a mid-session env change silently re-scopes who is admin.

Sessions are in-memory (`web_otp.go:13-19`), so a restart drops admin sessions: a session-path lockout self-heals on restart, and equally a revoked admin session cannot be killed without one. A restart is not a way to remove an attacker who has the mailbox — they just request another OTP.

> **Scaling beyond the free tier:** the unified image defaults to SQLite
> (sync `/data/kasir.db` + PocketBase `/data/pb_data/`), which is fine for
> the target 200–400 terminals. When you approach that ceiling — or observe
> SQLite lock contention in production (`SQLITE_BUSY` in the logs, sync
> latency growing) — enable the **free Northflank PostgreSQL addon** and set
> `DATABASE_URL` (see the env table above). The managed PG addon eliminates
> the single-writer lock and is the documented production target (see
> `docs/archived/2026-08-15-unify-auth-and-sync.md` §Phase 3.5 for the full cutover,
> including the RLS migration). Keep the `/data` volume either way — PocketBase
> stays on SQLite under `/data/pb_data`.

> ⚠️ **Known defect — every client shares one rate-limit budget (measured 2026-09-21).**
> The licence server's limiters are keyed on `e.RealIP()` (`apps/license-server/ratelimit.go:52`,
> `maxPerHr: 5`). PocketBase v0.39.6's `RealIP()` trusts `X-Forwarded-For` only once
> `Settings.TrustedProxy.Headers` is populated, and returns `RemoteIP()` when that set is
> **empty** — the Caddy reverse-proxy peer, i.e. loopback. Nothing in this repo seeded it, so the
> production key collapsed to loopback and **all clients shared ONE 5-per-hour budget across nine
> lanes**, meaning the fifth request from anywhere on earth 429'd everyone else. Full analysis:
> `docs/records/2026-09-21-license-ratelimit-collapse.md`. A fix exists in commits `fb0626518`
> (attest split onto its own 60/hr budget), `e6e254881` (`seedClientIPSettings` + the
> XFF-collapsing middleware, `apps/license-server/main.go:131-144`), `0ce2483a1` (hop-index clamp,
> `helpers.go:307-310`) and `061f3bff6` (a 429 no longer advances the origin ladder) — **and it is
> NOT deployed.** Ship it, then follow the staged verification in §5 of that record.

### Verification checklist (post-deploy)

**Run one command first.** `python scripts/verify-deployment.py` probes this surface and exits
non-zero while any ADR #54 route is missing, printing the expected status for each. Its default
base is `https://license.kasir.mu` (`scripts/verify-deployment.py:116`), the canonical name.

**Status measured 2026-09-21: the deployment is COMPLETE.** Every route the verifier checks
answers — `GET /api/v1/web/me` and `GET /api/v1/web/identities` → 401, `POST
/api/v1/desktop/link/email/request` → 400, `POST /api/v1/desktop/link/google/start` → 400,
`POST /api/v1/web/request-otp` → 400, `GET /api/sync/snapshot` → 401, `POST /api/v1/terminals`
→ 422, and both OAuth endpoints → 302 (configured) — so the `deployment COMPLETE` verdict is
current, not the 2026-09-26 `predated ADR #54` reading this section used to carry.

**Two probe paths that produce 404 by design — do not read them as a stale deploy.**
`/api/v1/desktop/link/` and `/api/v1/desktop/link/start` **do not exist in the source**; the
registered paths are `google/start`, `google/callback`, `consume`, `email/request` and
`email/consume` (`apps/license-server/main.go:338-343`). A 404 there is correct behaviour. On a
tablet the sign-in path is the emailed code and the link response is what carries the sync
credential, so a genuine gap in *that* surface presents as "the app cannot reach auth or sync",
and the client gets blamed — which is why the check to trust is the script's route list, not a
hand-typed URL.

> Two traps in this area, both measured. **Probe with the right method**: PocketBase answers 404,
> not 405, for a wrong method on an existing route, so `GET /api/v1/web/request-otp` looks dead
> while `POST` returns 400. And **pace the probes — but only on the alias**. `license.ozpos.my.id`
> is fronted by Cloudflare (measured 2026-09-21: `server: cloudflare` with a `cf-ray` header) and
> a burst from one IP gets 403 for every `/api/v1/*` path on **that name**, which reads as a
> broken deployment until a single paced request returns the real status. The canonical name
> carries no `cf-ray` at all — `license.kasir.mu` sits behind istio-envoy + Caddy (measured
> 2026-09-21: 12 spaced requests, no 403 and no rate-limit behaviour) — so a 403 burst is a
> property of the alias edge, not of the deployment. The verifier stops at the first throttle for
> this reason.

```bash
BASE="https://license.ozpos.my.id"
curl -s "$BASE/health"                                  # sync pill → 200 ok
curl -s "$BASE/api/health"                              # auth pill → 200
curl -s -X POST "$BASE/api/v1/license/activate" \
  -H 'Content-Type: application/json' -d '{}'           # PocketBase 400 (not 404)
curl -s -o /dev/null -w '%{http_code}' "$BASE/_/"       # admin UI → 200
curl -s -o /dev/null -w '%{http_code}' -X POST \
  "$BASE/api/v1/paddle/webhook"                          # 503 not-configured (not 404)

# Origin attestation (ADR #55). 200 proves the route exists; the openssl verify
# proves the deployed server signs with the key the POS binaries embed
# (crates/kasirmu-core/oz-license.key.pub). A 404 means the licence server
# predates the endpoint -- clients then stay on the compiled MAIN and the
# cascade is inert, which is safe but silent.
NONCE=$(openssl rand -hex 16); printf %s "$NONCE" > /tmp/attest.nonce
curl -s -X POST "$BASE/api/v1/license/attest" -H 'Content-Type: application/json' \
  -d "{\"nonce\":\"$NONCE\"}" -o /tmp/attest.json
python3 -c "import json,base64;d=json.load(open('/tmp/attest.json'));open('/tmp/attest.sig','wb').write(base64.b64decode(d['signature']));open('/tmp/attest.payload','wb').write(('ozpos-origin-attest-v1:'+open('/tmp/attest.nonce').read().strip()).encode())"
openssl dgst -sha256 -verify crates/kasirmu-core/oz-license.key.pub \
  -signature /tmp/attest.sig /tmp/attest.payload    # -> Verified OK

# Google sign-in (ADR #54). The two states are deliberately distinguishable:
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/web/oauth/google/start"
#   503 -> OZ_GOOGLE_CLIENT_ID is unset (nothing else to diagnose)
#   302 -> configured; the headers below prove BOTH endpoints are live without
#          touching Google, and that the browser-binding cookie is being set:
curl -s -D - -o /dev/null "$BASE/api/v1/web/oauth/google/start?next=/en/account" \
  | grep -Ei '^(HTTP|location|set-cookie)'
#   Location must be https://accounts.google.com/... and Set-Cookie must carry
#   oz_oauth_state (HttpOnly, Secure, Lax).

# The device link's server side. The wizard's own flow needs a real device, and a device's
# api_key never leaves it: it is issued once at activation and stored hashed here. So these
# check the WIRING — which is what breaks on a new deployment:
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/v1/desktop/link/email/request" \
  -H 'Content-Type: application/json' -d '{}'
#   400 -> the route exists and rejects a body with no machine_id   404 -> the deploy predates it
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/v1/desktop/link/email/consume" \
  -H 'Content-Type: application/json' -d '{}'
#   400 as well.

# The sync service the link will call (OZ_SYNC_API_URL). Production sets OZ_ADMIN_KEY, and the
# endpoint must say so:
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/v1/terminals" \
  -H 'Content-Type: application/json' -d '{}'
#   401 -> reachable and demanding the admin key   404 -> caddy is not routing /api/v1/* to it
#   200 -> NO admin key is configured and the endpoint is OPEN: fix that before onboarding.
# Inside the unified container, confirm the address OZ_SYNC_API_URL names is the one answering:
#   docker exec <container> curl -s -o /dev/null -w '%{http_code}\n' -X POST \
#     http://127.0.0.1:3099/api/v1/terminals -H 'Content-Type: application/json' -d '{}'

# For the end-to-end check, take a throwaway tenant: activate (or recover) it and use the
# api_key the response returns — the only time a key is ever visible — with the machine_id that
# activation registered. Then request, read the code from the mailbox, and consume:
KEY="<the api_key activation returned>"; MACHINE="<that machine_id>"; ACCOUNT="<its email>"
curl -s -X POST "$BASE/api/v1/desktop/link/email/request" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $KEY" \
  -d "{\"machine_id\":\"$MACHINE\",\"email\":\"$ACCOUNT\"}"
#   503 -> OZ_SMTP_HOST is unset        403 -> not this store's account address
curl -s -X POST "$BASE/api/v1/desktop/link/email/consume" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $KEY" -d "{\"machine_id\":\"$MACHINE\",\"code\":\"<code>\"}"
#   expect {"tenantId":...,"verified":true,"terminal":{"issued":true,...}}
#   terminal.issued=false means OZ_SYNC_API_URL is unset or the sync service refused the
#   admin key: the account is linked, the device simply holds no sync credential.
```

Then finish **one real sign-in in a browser** and confirm the account portal lists it under *Sign-in methods* — that is the only check that exercises Google itself. Two
failures to expect, and what each means:


- `redirect_uri_mismatch` from Google: the callback for **this** host **and this flow** is not
  registered. With `OZ_GOOGLE_REDIRECT_URI` pinned to the web callback (`DEPLOY.md` section 7b)
  that host's **two** paths are enough — `/api/v1/web/oauth/` and `/api/v1/desktop/link/` —
  because the link flow rewrites the path of the override, and a pinned one-URI console is
  simpler to keep correct. Leave the override unset and all **four** are needed: both hosts
  crossed with both paths, since each flow then derives its callback from the request's Host.
  A web sign-in that works while the wizard's Google button does not is exactly this: the
  desktop path missing from the console.
  > **You can check registration without the console.** Ask Google: build the authorize URL
  > with the client id and the callback under test and GET it. An unregistered `redirect_uri`
  > answers `400 redirect_uri_mismatch` *before* consent; a registered one answers `302`
  > onward. Measured 2026-09-26 — it settled a "did we register these?" question in one call,
  > and a `302` also proves the client id itself is valid.
- `400 invalid oauth state` after the consent screen: the browser did not send the
  `oz_oauth_state` cookie back — something in front of the licence host is stripping
  cookies, or the flow was started on one host and returned to the other.

**Known dead end, deliberate (ADR #54 §9 O2).** Account linking lives only in the setup wizard, so
a device that skipped the Account step — or whose credential was revoked — cannot be linked from
inside the running app; there is no Settings repair path. Recovery means re-running the wizard on a
fresh install. The wizard's failure copy says "continue without linking" rather than promising a
later path, because there is none.

Also: create the PocketBase superuser via the `/_/` first-boot installer
link (or shell: `pocketbase superuser upsert EMAIL PASS`).

### App-side URL references (ADR #55 — one compiled list, not five hardcoded spots)

All point at the unified host; each also has an env-var override:

| File | Change | Override |
|------|--------|----------|
| `crates/kasirmu-core/src/license_verification.rs` | `LICENSE_SERVER_URL` const | `OZ_LICENSE_SERVER_URL` |
| `apps/desktop-tauri/tauri.conf.json` | CSP `connect-src` | — |
| `apps/mobile-tauri/tauri.conf.json` | CSP `connect-src` | — |
| `crates/kasirmu-core/src/server_origin.rs` | `MAIN_SERVER_ORIGIN` / `FALLBACK_SERVER_ORIGIN` — the only compiled origins | `OZ_LICENSE_SERVER_URL` |
| `ui/src/features/auth/__tests__/LicenseActivationScreen.test.tsx` | pinned URL | — |

The **sync server URL** is per-install user config: Settings → Cloud Sync
→ enter `https://license.ozpos.my.id`. It is per-install user config, stored in the local DB —
and since ADR #55 it also has compiled fallbacks (`server_origin::MAIN_SERVER_ORIGIN` in the
bridge probe, `FALLBACK_SERVER_ORIGIN` in the desktop debug bootstrap, and the `SettingsContext`
draft), so the earlier claim that it is "never compiled in" no longer holds.

The row this table used to carry for `AUTH_SERVICE_URL` / `VITE_AUTH_SERVICE_URL` was stale:
grep `ui/src` for either name and neither exists. `node scripts/check-server-origins.mjs` is the
guard that keeps this table honest.

### 8.5 Automated deploys — **not automated today**

> ⚠️ **This section claimed automation that does not happen.** Verified 08-09-26:
> * `.github/workflows/deploy.yml` **does not exist** — `23c963303` retired it to
>   `deploy.yml.bak` on 2026-09-02, and the file named in this heading has not run since.
> * The deploy logic moved **into** `dev-ci.yml` as the `northflank-deploy` job, and that
>   job's condition read
>   `(github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/heads/0.0.'))) || github.event_name == 'workflow_dispatch'`.
>   But `dev-ci.yml`'s own `on:` block declares only `pull_request` and
>   `workflow_dispatch` — **there is no `push` trigger** (AGENTS.md says the same). The
>   first half of that condition can therefore never be true. It is dead logic, not a
>   documentation problem: whoever moved the job carried the `if:` across and left the
>   trigger behind.
>
> **What actually deploys:** `workflow_dispatch` only — Actions → Dev CI → Run workflow.
> A merge to `main` triggers nothing deploy-related, and a PR run never deploys either
> (the condition excludes `pull_request`). The consequence is the mirror image of what
> this page promised: a stale deploy cannot hide, but neither can it happen by itself.
>
> **Corrected 2026-09-15 — three of the four statements above are now false, and the
> fourth has changed shape.** `dev-ci.yml` *does* declare `push: branches: [main]`
> (`:6-7`; the "no `push` trigger" line and the AGENTS.md it cites were both corrected on
> 2026-09-14), so a merge to `main` **does** deploy, and the "code-level finding" below
> was carried out rather than merely flagged. The condition has been tightened to
> `(github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'`,
> which closes the hole that was live until that date: `workflow_dispatch` declares **no**
> branch filter, so a dispatch off a `0.0.*` branch reached the deploy job and shipped to
> production with no workflow edit at all. A release branch no longer deploys by either
> route. The paragraph below is kept as the dated record it is.
>
> **Code-level finding, flagged not fixed.** Adding `push: branches: [main]` to
> `dev-ci.yml` would make the old claim true again. That reinstates automatic production
> deploys gated only by the seven jobs `northflank-deploy` `needs`, so it is a decision
> for whoever owns the deploy. It is also entangled with the gap AGENTS.md records: that
> job omits `release-readiness` from its `needs`, so a re-armed push path would
> auto-deploy without the updater-signing check having passed.

The mechanism below is real and is what `northflank-deploy` does when it runs: it
triggers a Northflank API build of the exact commit (`POST
/v1/projects/{projectId}/services/{serviceId}/build` with `{"sha": ...}`),
polls until the build concludes (a combined service auto-deploys after a
successful build), then smoke-tests `$NORTHFLANK_SERVICE_URL/health` and
`/api/health`. The whole lifecycle is one auditable check on the commit — no
dashboard clicks.

**One-time setup:**

1. **Create a team API token** — Northflank → Team settings → **API
   tokens** → create one with permission **Project > Services > General >
   Update** (trigger the build) + **Read** (poll it). Least privilege only.
2. **Find the IDs** — resource header (top of the service page) → ⋮ →
   **View specification**; or with the token:
   `curl -s -H "Authorization: Bearer $TOKEN" https://api.northflank.com/v1/projects`
   then `…/v1/projects/{projectId}/services`.
3. **Set GitHub Actions secrets/vars:**
   - secret `NORTHFLANK_API_TOKEN`
   - vars `NORTHFLANK_PROJECT_ID`, `NORTHFLANK_SERVICE_ID`,
     `NORTHFLANK_SERVICE_URL` (the public `https://oz--cloud--…code.run` URL;
     unset skips the smoke step)

**Behavior:** runs on push to `main` filtered to the unified-image inputs
(`ops/docker/Dockerfile.unified`, `Cargo.toml`/`Cargo.lock`, `rust-toolchain.toml`,
`crates/**`, `foundation/**`, `platform/**`, `modules/**`, `apps/**`) plus
`workflow_dispatch` for manual redeploys. Fail-closed: missing token/IDs
fails the job loudly. Until the §8 env table is fully applied, the smoke
probes may 503 — that is the fail-fast gate working, not a workflow bug.
If the service's native git trigger beats the workflow to the API (HTTP
409 "only one build may be active"), the workflow **adopts the in-flight
build for the same commit** and watches it to conclusion — a merge shows
one green, auditable check either way.

> **⏱️ Expected build time:** the unified image compiles the full Rust
> workspace (`oz-cloud-server` + its dependency graph), which takes roughly
> **15 minutes** on Northflank's 4-core / 16 GB builders. The deploy job's
> 90-minute timeout and 50-minute poll window are sized for worst-case
> cold caches — a warm cache (unchanged `Cargo.toml`/`Cargo.lock` between
> builds) lands closer to ~10 minutes. A push that touches only docs or the
> `website/`/`ui/` tree does not trigger a deploy (path filter above), so
> these builds are backend-only.

**Manual redeploy from a shell** (same API call, no GitHub needed):

```bash
TOKEN="<team API token>"; PROJECT="<projectId>"; SERVICE="<serviceId>"
curl -sS -X POST "https://api.northflank.com/v1/projects/$PROJECT/services/$SERVICE/build" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

(empty body = build the latest commit of the service's linked branch.)

**Alternative (zero repo code):** enable native git triggers on the service
— Build configuration → branch restrictions → `main` — Northflank then
auto-builds + auto-deploys on every push itself. Same outcome, but invisible in
GitHub Actions. Until 2026-09-02 this sentence recommended `deploy.yml` as "the
preferred, auditable path"; that workflow is retired (`deploy.yml.bak`, `23c963303`)
and its `northflank-deploy` successor **is live** in `dev-ci.yml` and **does** fire on push
(`on.push` at `:6-7`), gated for *both* entry points on `github.ref == 'refs/heads/main'`
(`:753-763`): a merge to `main` deploys, a dispatch **from `main`** deploys, and a dispatch
from a `0.0.*` branch is refused on purpose. The sentence that stood here claimed the deploy
"cannot fire on push"; the workflow's own comment at `:749-751` names that claim as false.
So the native git trigger is an **alternative** automatic path, not the only one —
`dev-ci.yml` deploys on a push to `main` as well. The difference is *visibility*, not
capability: the GitHub job is auditable in the Actions UI and reports its own failures, while
the Northflank git trigger is invisible from this repository.

### 8.6 Logging & Debugging

The unified image runs three processes under supervisord (caddy, license,
sync); all write to the container's stdout/stderr, which Northflank
captures and surfaces in **Dashboard → service → Logs**.

**Everything below is a hosted-service diagnostic, and that is a limitation of
the clients, not of this page.** No shipped binary writes a persistent local
log: both Tauri apps initialise logging with `kasirmu_logging::try_init()`
(`apps/desktop-tauri/src/lib.rs:99`, `apps/mobile-tauri/src/lib.rs:69`),
which installs an `EnvFilter` + `fmt` subscriber and **no writer**
(`crates/kasirmu-logging/src/lib.rs:78-89`, no `.with_writer`), so stdout goes wherever the OS puts it
— which for a double-clicked desktop build is nowhere. The two entry points
that would have created a file, `init_with_file` and `init_json_with_file`
(`crates/kasirmu-logging/src/lib.rs:184`, `:238`), have **zero callers outside their
own tests**; `log_dir` / `LogRoot` / `app_log` / `path_resolver` return **0
matches across `apps/`**, and the EventLog backend is never wired by any
binary either. So there is no on-device log file to open, and nothing in this
section can be run on a till or a tablet.

The tablet is worse than unlogged: it is **unobservable by construction**.
Android does not persist its logcat, no log-pull ships, and the device never
reaches the container's stdout — so a field issue on a tablet cannot be
diagnosed from logs at all, only from the SQL below and from reproducing it.

**Recommended log format:** set `OZ_LOG_FORMAT=json` in the service env
(§8 table) so the Rust cloud-server emits structured, queryable log lines
instead of plain text. The Go license server (PocketBase) logs plain text
regardless — the JSON toggle only affects the sync function.

**Common debugging flows:**

| Goal | How |
|------|-----|
| Tail live logs | Northflank dashboard → service → **Logs** (stream). |
| Increase Rust log verbosity | temporarily add `RUST_LOG=debug` (or `=trace`) to the service env and redeploy; remove afterwards. |
| Find a crash / restart reason | check the Logs tab around the restart timestamp; supervisord restarts a crashed process automatically (`autorestart=true`), so the crash line precedes the restart marker. |
| Inspect process state | `exec` into the service from the Northflank dashboard: `ps aux`, `supervisorctl status`, `wget -qO- http://localhost:3099/health`. |

**Structured querying tip:** with `OZ_LOG_FORMAT=json`, the Logs viewer's
filter box can match `"level":"error"` or `"component":"sync"` — far easier
than scanning plain-text lines. When diagnosing a specific endpoint, add
the request path to the filter (e.g. `/api/v1/tokens`).

**Unmapped `product_type` — from one log line to the affected rows:**
filter the Logs viewer for the prefix `unmapped product_type`, not for a
whole message, because **two** different warnings carry that prefix —
`unmapped product_type; falling back to default (retail)`
(`modules/inventory/src/models.rs`, the `ProductType::parse_stored_or_default`
helper, whose doc comment in that file is the only place this fallback is
specified) and `unmapped product_type on sale line; stock was deducted
anyway because the type could not be mapped`
(`modules/inventory/src/handlers.rs`, `operation` =
`InventoryStockHandler::handle_line`). Search the prefix, so that finding
nothing for one never reads as health for the other — and know which half the
lane you are reading can even produce: `oz-cloud-server` links `kasirmu-api` and
`kasirmu-core` only (`apps/cloud-server/Cargo.toml:19-20`), so container logs can
carry the fallback line (its `operation` there is
`pg_row_to_product_with_details`, `crates/kasirmu-api/src/pg.rs:1064`) but **never**
the sale-line one, which lives in `modules/inventory` — its absence from a
hosted log is architecture, not health. On a device both can fire and neither
is recorded anywhere (see the scope note above). Each line carries
`sku`, `stored` in `Debug` form — so a NULL (`None`), an empty string
(`Some("")`) and an uppercase miss (`Some("RETAIL")`) stay three
distinguishable causes — and `operation`, which names the reader that hit
it. A non-empty result below means every row it returns is being served to
the listing, to stock deduction and to reports as `retail`, which is
exactly the ambiguity the warning exists to break. The statement is safe to
run read-only against a live merchant database while terminals are serving
customers: it is a `SELECT`, so it touches no write path, and the write
path stays deliberately unvalidated because a `CHECK` constraint or a
reject-on-read would break CSV import, `.ozpkg` restore and sync ingest —
this diagnostic is the shipped half. Keep the `IS NULL` clause even though
it looks redundant: `NOT IN` is three-valued, so a NULL matches nothing and
drops out of the result silently instead of being reported, and although
the column is `TEXT NOT NULL DEFAULT 'retail'` in both engines
(`20260813_init.sql:451`, `20260813_init.pg.sql:881`), `None` is the shape a
missing or unwritten value takes on the read path, which is what the
operator is actually asking about. If the column is absent entirely the
statement errors — its own answer, and a better one than a clean count.

```sql
SELECT id, sku, name, product_type
  FROM products
 WHERE product_type IS NULL
    OR product_type NOT IN ('retail','restaurant','both','service');
```

**Runnable on a device — the same census without a log.** Because no client
persists a log, the on-device question is never "which rows warned" but "which
rows *could* have": group the stored values by their form.

```sql
-- Device form: sqlite3 /data/kasir.db  (per-install desktop/tablet DB)
-- The identical statement runs on PostgreSQL unchanged; add `tenant_id` to the
-- SELECT and GROUP BY when you run it hosted, and the forms group per tenant.
SELECT CASE
         WHEN product_type IS NULL         THEN 'NULL'
         WHEN trim(product_type) = ''      THEN 'EMPTY'
         ELSE product_type
       END AS stored_form,
       COUNT(*) AS rows
  FROM products
 GROUP BY 1
 ORDER BY 2 DESC;
```

It is the **stored form** that picks the repair, not the count:

- `EMPTY` → the **importer** wrote an empty string (CSV column blank, or a
  header that matched nothing), so the fix is at the import boundary.
- `NULL` → the **ingest mapping** never populated the column — a sync or
  `.ozpkg` restore lane, not the importer.
- a **case or padding variant** (`RETAIL`, `retail `) → the **accepted set** is
  the problem: the parser is case-sensitive, so the value is legal to an
  operator and unmapped to the code.

Only `retail`, `restaurant`, `both` and `service` are clean; anything else in
that first column is a row that reads as `retail` at runtime.

> ⚠️ **Log volume is not a proxy for row count.** The parse runs per row on a
> *read* path, so one bad hosted row logs once per listed row per query — a
> single unmapped row behind a busy listing can out-log a table full of them.
> Never size the problem by counting warning lines; count rows with the
> statement above.

> ⚠️ Crash logs are retained only as long as Northflank's log retention
> policy — for long-term diagnostics export the log stream before a
> container is replaced.

### 8.7 Converted-tender currency census (hosted data only)

`migration 20260821_tender_currency.sql` added three nullable columns to the
sale header — `base_currency`, `base_total_minor`, `tender_rate_millionths` —
and its own comment records that **all three are NULL for single-currency
sales, the common case**. The question this census answers is whether any
hosted tenant has ever completed a currency conversion: a sale whose tender
`currency` differs from its recorded `base_currency`.

> 🛑 **Run this against hosted data. Every local store is empty.** Measured
> 2026-09-12 on the dev machine: the six local databases hold **zero sales
> rows**, so the question is undecidable on a workstation and any number read
> from a local run is an artifact of an empty table. Re-measure that emptiness
> rather than trusting this sentence — `SELECT COUNT(*) FROM sales;` is the
> first statement in both blocks below for exactly that reason.

**The three numbers are not equally bad news.** `base_currency_null_or_empty`
is not a defect count: it is expected to be most of the table, because a
single-currency sale legitimately stores no base currency. It is the
denominator that makes the other two readable. Only `mismatch_all_time` and
`mismatch_last_90d` count rows where both columns are present, non-empty, and
differ.

- **Non-zero mismatch** → those receipts cannot substantiate a completed
  currency conversion, and there is paper in the world that cannot be
  reconciled: the conversion happened, was printed, and the record does not
  support it. Live exposure, escalate to the currency owner.
- **Zero mismatch with a non-zero `sales_rows`** → the defect is **latent**.
  The columns and the code path exist and nothing has exercised them; the work
  is documentation plus a dormant code path, not remediation.
- **`sales_rows = 0`** → the census means **nothing at all**. That is not a
  zero-mismatch result, it is an absent measurement — the state of every
  database on this machine tonight, and also the state an RLS-scoped
  connection returns for a tenant that does have rows (§3.9, §6.3).

SQLite form (per-install `.db`, the desktop/tablet lane):

```sql
SELECT COUNT(*) AS sales_rows FROM sales;  -- 0 ⇒ everything below is an absent measurement

SELECT tenant_id,
       SUM(CASE WHEN currency      IS NOT NULL AND currency      <> ''
                 AND base_currency IS NOT NULL AND base_currency <> ''
                THEN 1 ELSE 0 END) AS mismatch_all_time,
       SUM(CASE WHEN currency      IS NOT NULL AND currency      <> ''
                 AND base_currency IS NOT NULL AND base_currency <> ''
                 AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 day')
                THEN 1 ELSE 0 END) AS mismatch_last_90d,
       SUM(CASE WHEN base_currency IS NULL OR base_currency = ''
                THEN 1 ELSE 0 END) AS base_currency_null_or_empty,
       COUNT(*)                    AS rows_for_tenant
  FROM sales
 GROUP BY tenant_id
 ORDER BY mismatch_all_time DESC, tenant_id;
```

PostgreSQL form (the hosted `sales` table):

```sql
SELECT COUNT(*) AS sales_rows FROM sales;  -- 0 ⇒ check the RLS scope before believing it

SELECT tenant_id,
       SUM(CASE WHEN currency      IS NOT NULL AND currency      <> ''
                 AND base_currency IS NOT NULL AND base_currency <> ''
                THEN 1 ELSE 0 END) AS mismatch_all_time,
       SUM(CASE WHEN currency      IS NOT NULL AND currency      <> ''
                 AND base_currency IS NOT NULL AND base_currency <> ''
                 AND created_at::timestamptz >= now() - interval '90 days'
                THEN 1 ELSE 0 END) AS mismatch_last_90d,
       SUM(CASE WHEN base_currency IS NULL OR base_currency = ''
                THEN 1 ELSE 0 END) AS base_currency_null_or_empty,
       COUNT(*)                    AS rows_for_tenant
  FROM sales
 GROUP BY tenant_id
 ORDER BY mismatch_all_time DESC, tenant_id;
```

**What actually differs between the two engines.** Both declare
`sales.currency TEXT NOT NULL`, both carry the three CUR-02 columns as nullable
(`TEXT`/`BIGINT` in PG at `20260813_init.pg.sql:1028`, `TEXT`/`INTEGER` in
SQLite), and both reach `tenant_id` — SQLite through
`20260814_sales_tenant.sql`, PG from the init schema. `created_at` is `TEXT` in
**both**, and in PG it is a `to_char(now() AT TIME ZONE 'UTC', …)` string, not a
native timestamp (`20260813_init.pg.sql:1012`). So the only real divergence is
the 90-day boundary: SQLite compares against a `strftime` text boundary, PG
must cast `created_at::timestamptz` — or, if any malformed row makes that cast
abort the scan, compare text against a `to_char`-formatted boundary instead.
`SUM(CASE …)` is used rather than `COUNT(*) FILTER (WHERE …)` so one shape runs
on both engines and the SQLite copy needs no ≥ 3.30 FILTER support.

On a hosted read, run it as the schema owner or per tenant inside a
transaction that opens with `SET LOCAL oz.tenant_id = '<tenant>'` (§6.3).

### 8.8 Legacy cleartext credential rows — how to look, and the one-machine fix

This is a **dev-machine and locally-built-binary note, not an incident
procedure.** Transparent encryption at rest for the sync / PG / rate-sync
credentials arrived at `e105109f6` (2026-08-29), and it deliberately passes a
legacy plaintext value through instead of failing, so an install already holding
one keeps working. The key it now encrypts, `sync_api_key`, had been written raw
since it first existed at `2ea09a595` (2026-06-29) — a **61-day primary window**.
A row written in that window and never re-saved is still stored in the clear
today, and nothing converts it by itself. The published-release version of the
question does not arise: `v0.0.5` is the only tag in the repository, it predates
the window's close, nothing was ever published against it, and zero releases
exist. So the population is a workstation, or a binary you built, and the fix
below is for one machine at a time.

The grep that produced the zero — re-run it rather than trusting this sentence:
`git grep -lE "encrypt|decrypt|cipher" tags/v0.0.5 -- platform/core/src/settings`
→ **0 files**. Tree-wide at that same tag the identical pattern hits 6 files and
none of them is the settings lane, so the zero is about these accessors, not about
the repository having no crypto vocabulary at all.

**1. Look — read-only, and it prints keys and forms, never values.**

```sql
-- Device form: sqlite3 <the per-install .db the app already uses>
SELECT key,
       length(value) AS chars,
       CASE
         WHEN trim(value) = ''                       THEN 'EMPTY — never written, nothing to convert'
         WHEN length(value) >= 38
              AND value NOT GLOB '*[^A-Za-z0-9_-]*' THEN 'BASE64-SHAPED — read step 2'
         ELSE 'NOT-SHAPED — cleartext, re-save it'
       END AS form
  FROM settings
 WHERE key IN ('sync_api_key','sync.auth_token','sync_terminal_secret',
               'pg_sync.password','redis.url','rate_sync.api_key','lan_server.psk',
               'local_api.secret','smtp_config','license.api_key','license.payload',
               'license.signature','license.tenant_id','license.phone',
               'stripe.api_key','square.api_key','midtrans.server_key')
 ORDER BY form DESC, key;
```

That key list is `SECRET_KEY_DENY_LIST` in `platform/core/src/settings/keys.rs` —
copy it from there if it has moved since this section was written, and note that
the comparison in `is_non_exportable_setting_key` is trim-then-ASCII-case-fold,
so an oddly spelled row is judged on its folded form. The 38-character floor comes
from `looks_like_ciphertext` in `crates/kasirmu-crypto/src/lib.rs`: a 12-byte nonce and
a 16-byte GCM tag minimum, base64url without padding. On PostgreSQL the same
thinking applies but `GLOB` does not exist — use `value !~ '^[A-Za-z0-9_-]+$'` for
the inverted class.

**2. Read the rung, not the column.** Three rungs, and the middle one is weaker
than it sounds:

- **`NOT-SHAPED`** → cleartext. Certain.
- **`BASE64-SHAPED`** → either a genuine ciphertext or a plaintext that happens to
  look like one. The stored bytes cannot tell you which, and the envelope carries no
  prefix, no version byte and no marker to check: a hand-authored value in that
  character class is indistinguishable by inspection.
- **`BASE64-SHAPED` and it authenticates** → encrypted against someone who does not
  have the source. That is the whole of it; see the block below.

> ⚠️ **The portable family keys are obfuscation, not confidentiality — and one rung
> is out of reach from the row alone.** For these credentials
> `encrypt_sync_api_key` and its siblings derive through `portable_key`, whose
> fallback is `derive_key` over SHA-256 of the domain prefix concatenated with the
> literal `"static"` — not machine-bound. The crate says so about itself, plainly,
> in the threat-model note on `derive_static_key` in `crates/kasirmu-crypto/src/lib.rs`:
> that key is a public constant, anyone with the repository can derive it and
> decrypt every portable at-rest value in any deployment's database, and what the
> encoding buys is protection against opportunistic inspection of the file, not
> confidentiality. Read the ladder that way: a `NOT-SHAPED` row is cleartext to
> anyone who can open it, and a `BASE64-SHAPED` row is cleartext to anyone holding
> both the file and the source.
>
> And the branch no query can see. If `OZ_MASTER_KEY` (64 hex chars) was set in the
> environment that wrote the row, the value went through the HMAC derivation
> instead, so it will NOT authenticate under the portable key on a machine where
> that variable is absent — a shaped row that fails to decrypt is therefore not
> evidence of tampering and not evidence of cleartext either; it may simply be a
> different derivation. For the process in front of you, ask the code rather than
> guessing: `kasirmu_crypto::master_key_derivation_active()` reports which derivation
> this process selected, and nothing else — a historical install may have had the
> variable set and be long gone. Whether these families should move to
> machine-bound derivation is a rewrap decision, and it is deliberately not taken
> here: it changes what every existing install can read back.

**3. Fix one machine — re-save the credential, do not edit the row.** Open
Settings, on the surface that owns the field (Cloud sync, PostgreSQL sync, exchange
rate sync, LAN server), type the credential in again and save. The save goes
through the typed setter, which encrypts on the way in, so this is a single-key
targeted conversion with no migration, no batch mutation and no downtime. The five
setters that do it are `set_sync_api_key`
(`platform/core/src/settings/typed.rs:338`, encrypting at `:339`),
`set_sync_terminal_secret` (`:366`, `:367`), `set_pg_sync_password` (`:441`, `:442`),
`set_rate_sync_api_key` (`:557`, `:558`) and `set_lan_server_psk` (`:643`, `:645`) —
and they are the only production call sites of their `encrypt_*` functions, which is
why following the save is the conversion and no other route is. Re-run
step 1 afterwards: it is read-only and idempotent, and it is the only evidence that
the row actually moved. Two limits worth saying plainly. Re-saving converts only a
key you still know — if you no longer know it, rotate it at the provider and enter
the replacement, which was the better hygiene outcome before you needed to. And
where a form preserves the stored secret instead of rewriting it, saving its other
field converts nothing; step 1 shows you exactly that, so read it after every fix,
not before.

**Which of those saves is wired today, measured at HEAD, because three are and two
are not.** `set_sync_api_key` is called from command lanes both shells reach
(`crates/kasirmu-bridge/src/sync.rs:76`, `apps/mobile-tauri/src/commands/sync.rs:92`), from
the sync daemon (`platform/sync/src/daemon.rs:170`), from terminal auth
(`crates/kasirmu-core/src/sync_auth.rs:472`) and from desktop auto-provisioning
(`apps/desktop-tauri/src/sync_bootstrap.rs:84`); `set_sync_terminal_secret` from the
pairing path at `apps/desktop-tauri/src/sync_bootstrap.rs:248`; `set_pg_sync_password` from
`crates/kasirmu-bridge/src/sync.rs:161`. Those three keys have a walkable ladder.
`set_rate_sync_api_key` (`platform/core/src/settings/typed.rs:557`) and
`set_lan_server_psk` (`platform/core/src/settings/typed.rs:643`) have **no production
caller at all** — the only hits are their own definitions, the never-invoked
`crates/kasirmu-core/src/settings.rs:570` facade wrapper, tests and comments, and
`crates/kasirmu-core/tests/credential_storage_form.rs:258` already records one of them in
those terms. So the only production write of `rate_sync.api_key` and `lan_server.psk`
is `platform/core/src/settings/typed.rs:560` and
`platform/core/src/settings/typed.rs:646`, inside setters nobody invokes, while both
keys are refused by the generic funnel as manager-owned. For those two rows this step
is a shape to copy, not a lane to walk: there is no in-app re-save to perform, so
rotate at whoever holds the value and let the lane that owns it write it. Re-run step 1
after anything in this section — it is the only evidence either way.

`smtp_config` is in step 1's list and is **not** written by any of those setters, so
here is the chain instead of a sentence of prose to trust:
`ui/src/features/settings/EmailReportSettings.tsx:163` (`setSettingScoped`) →
`run_set_setting` in `crates/kasirmu-bridge/src/settings.rs:500` (batch door `:593`; tablet
`apps/mobile-tauri/src/commands/settings.rs:623`) → `Store::merged_smtp_password_json`
(`crates/kasirmu-core/src/export/email_report.rs:316`) → `crate::crypto::encrypt_smtp_at_rest`
at `:207` of that file. Note what that chain does and does not seal: it replaces the
`password` **field of a JSON blob**, and only when a password was supplied
(`:204-206`) — a value the keep-on-blank merge merely carried over is never
re-encrypted (`:202`), which is the second limit above stated exactly. And name the
shape honestly, because the family names invite the wrong reading: the
credential-sealed-inside-its-own-settings-value pattern this section recommends is
live through the **portable** family (`encrypt_smtp_at_rest`,
`crates/kasirmu-crypto/src/lib.rs:227`), while the machine-bound sibling it resembles,
`encrypt_smtp_password` (`crates/kasirmu-crypto/src/lib.rs:193`), has no caller left in the
tree at all. A reader who looks for that function as the exemplar lane will not find
one; what they can follow is the seam above, and that seam is a recommendation about
an envelope shape, not a conversion any of the four surfaces above performs.

**4. What not to do.**

- **Do not hand-edit `settings.value`.** The encrypted form cannot be written by
  hand: it is produced by the setter, and a value you wrap yourself fails to
  authenticate on read — and the read path tolerates that failure by handing the
  malformed string back to the caller as though it were the secret. That behaviour
  is pinned as a *known hazard*, not as a contract, by the `known_hazard_*` tests in
  `platform/core/src/settings/tests.rs`; turning it into an error is that crate's
  own recorded next step and a runbook cannot shortcut it.
- **Do not aim `oz credential-deltas purge` at the settings table.** That lane
  walks the `setting_updated` delta ledger and its delete path belongs there; the
  live settings row is untouched by it on purpose, which is the property that makes
  the purge safe to run at all.
- **Do not bulk-rewrite values in SQL** for tidiness. Step 3 is one credential at a
  time precisely so that a mistaken save costs one credential.


---

---

## 9. Website Deploy Token (Cloudflare) — lifecycle & rotation

The marketing site (Astro, `website/`) deploys to Cloudflare Workers static assets
(`oz-pos` worker → `https://ozpos.my.id`) via **`npm run deploy` from `website/`,
run by hand** — `website/package.json:17` shells out to `scripts/wrangler-deploy.sh`.

> ⚠️ **No workflow deploys the website.** This section named
> `.github/workflows/website.yml` until 08-09-26; that file is retired
> (`website.yml.bak`), and `grep -rn wrangler .github/workflows/*.yml` returns
> **zero** hits across the live workflows. The live `dev-ci.yml#website` job does
> asset hygiene, install, typecheck, lint, unit tests and **build** — it stops short
> of deploying. Everything below about the token still holds; what changed is that
> the token is consumed by a person, not a pipeline.
>
> ⚠️ **On Windows the documented command can hang.** `scripts/wrangler-deploy.sh` is
> invoked as `bash ../scripts/wrangler-deploy.sh` — the only npm script in the repo
> that calls bare `bash`. AGENTS.md's "Running CLI Tools on Windows" section records
> that bare `bash` resolves to `C:\Windows\System32\bash.exe` (WSL), which here either
> **hangs until killed** or runs the Linux node against the Windows-built
> `website/node_modules`. <!-- dead-ref: ok: `website/node_modules` is a build artifact created by `npm ci` in `website/`, named here as the tree WSL's Linux node resolves against — not a documentation path and never committed, so it cannot resolve in a clean checkout. --> The script's own usage header shows the same form. Until it
> is changed, call it through Git's bash explicitly:
> `& 'C:\Program Files\Git\bin\bash.exe' scripts/wrangler-deploy.sh`. Editing the npm
> script is a code change and is deliberately not made here. The deploy authenticates
with the **`CLOUDFLARE_API_TOKEN`** GitHub Actions repo secret; `CLOUDFLARE_ACCOUNT_ID`
(the sibling secret) is not a credential — it is the account id shown in the Cloudflare
dashboard and simply names which account the token acts on.

### 9.1 Required scopes (least privilege)

- **Account → Workers Scripts → Edit** — the only permission an assets-only Worker
  needs (`wrangler deploy` of `name = "oz-pos"`): full CRUDL on the worker; no
  Zone/DNS/Pages/KV permissions required.
- Create it at **My Profile → API Tokens → Create Token** (a user token; an Account
  token under Manage Account → API Tokens also works). The secret is **shown only
  once** — copy it straight into wherever the deploy reads it from, which today is
  the environment, not GitHub: `scripts/wrangler-deploy.sh:42` fails when
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` are unset, and AGENTS.md feeds those
  from `.env` / the `KASIRMU_CLOUDFLARE_*` user variables. A GitHub Actions secret of the
  same name is harmless to keep (it is what the retired website pipeline expected) but
  `git grep -l CLOUDFLARE_API_TOKEN -- .github/workflows` matches only `website.yml.bak`
  and `scripts/wrangler-deploy.sh`, so no live workflow reads it.
- Optional hardening: restrict to the single account; skip Client IP filtering unless
  you accept the tradeoff — GitHub-hosted runner egress IPs change, so IP filters are
  a frequent false-failure source.

### 9.2 Expiry — how a token rots silently

- TTL is **optional** at creation. A token **without a TTL never expires on its own** —
  it stays valid until revoked, its scopes change, or the account relationship changes.
  That is exactly how this bit us (2026-08-17): no TTL, no calendar event, and nothing
  alerted when the token stopped working.
- **Observed failure mode (as it presented on 2026-08-17, when a workflow still
  deployed the site — the two job names below are retired `.bak` content, see the
  bullet after this one):** the deploy job errors with `Authentication error [code:
  10000]` / `Invalid access token [code: 9109]` on `/accounts/<id>/workers/services/oz-pos`.
  The job "fails loudly" in its own log, but **nobody is paged**: the PR-side `check`
  job (retired `website.yml`, still readable at `website.yml.bak:71`) stays green
  because it does not deploy, so the Actions list looks healthy until you open the
  `deploy` job (`website.yml.bak:144`). The live site keeps serving the last good
  build — here, the pre-portal 1-card docs hub — for ~20 failed runs before the
  outage was noticed.
- **What replaced that failure mode: nothing.** No live workflow deploys the website,
  so there is no run that can go red and no Actions list to look healthy or otherwise.
  A rejected token now surfaces only as an error in the terminal of whoever typed
  `npm run deploy`, and a forgotten deploy is invisible from GitHub altogether. That
  is strictly less detection than 2026-08-17 had, and it is why probe #3 below is the
  only real signal.
- **Policy:** give every token a **TTL ≤ 1 year** (Cloudflare's maximum is 10 years)
  and put the expiry date in the ops calendar. A TTL forces a deliberate review cadence
  instead of silent rot.

### 9.3 Detection (run these on any deploy suspicion)

```bash
# 1. There is no deploy run to list. Probe #1 was `gh run list --workflow "Website
#    Deploy"`; that workflow went inert when 23c963303 renamed it to .bak on
#    2026-09-02, so the command now returns an empty list. An empty list is the
#    missing workflow, NOT evidence that deploys are healthy — the health evidence
#    is probe #3 (the live site) and the wrangler output of the human who deployed.

# 2. Is the token itself valid? (authoritative — Cloudflare's verify endpoint)
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# expect: {"result":{"status":"active"},...} with message code 10000 "valid and active"
# Note: SHORT-LIVED tokens (cfat_ prefix, e.g. dashboard quick-creates) are
# account-scoped only: /user/tokens/verify answers 401 while the token is fine.
# Probe them against their own account instead (same call the deploy gate makes):
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# A cfat_ token also EXPIRES by design — prefer a regular token with a TTL ≤ 1y
# for the CI secret so the deploy never silently rots mid-cycle.

# 3. Is the LIVE site carrying the latest portal? The 4-card docs hub ships only via a
#    successful deploy — a 404 here while CI is green means the deploy is silently stale.
curl -sf -o /dev/null -w '%{http_code}\n' \
  https://ozpos.my.id/docs-portal/intro.html   # want 200
```

GitHub's secret store exposes no expiry/rotation metadata, so rely on these three
probes (fold probe #3 into the §5 poller or an uptime monitor). The fail-fast step
this section used to describe — "Validate Cloudflare deploy credentials
(fail-fast)", `website.yml.bak:155` — died with the retired workflow. Nothing
validates the token before a deploy any more: probe #2 is now a step YOU run by
hand, and probe #3 is the only ground truth for what actually shipped.

### 9.4 Rotation (zero-downtime, ~5 min)

1. **Create the new token first** (My Profile → API Tokens → Create Token): Account →
   Workers Scripts → Edit, **set a TTL**, note the expiry in the calendar. Copy it
   immediately — shown only once.
2. **Verify before touching GitHub:** run the §9.3 probe #2 with the new token →
   `"status": "active"`.
3. **Update wherever the deploy actually reads the token:** the `.env` entry and the
   `KASIRMU_CLOUDFLARE_API_TOKEN` user variable that feed `scripts/wrangler-deploy.sh`.
   Updating only the GitHub secret (Settings → Secrets and variables → Actions →
   `CLOUDFLARE_API_TOKEN`) rotates a credential nothing live consumes, and the manual
   deploy would keep using the revoked token.
4. **Confirm with a real deploy:** run `npm run deploy` from `website/` (the manual
   route named at the top of §9) and confirm probe #3 returns 200. The two old routes
   are gone: there is no Website Deploy run left to rerun, and pushing a `website/**`
   change deploys nothing — the only live website job is `dev-ci.yml#website`, which
   stops at Build, and `dev-ci.yml` has no push trigger at all.
5. **Revoke the old token** (API Tokens → Roll / Delete). Two overlapping tokens
   during rotation is fine — the old one must die only after the new one is proven.

### 9.5 Prevention (so this cannot recur silently)

- **TTL policy from §9.2:** every token gets a TTL ≤ 1 year + a calendar entry. A token
  with no TTL is a standing silent-rot risk — treat it as an incident to fix.
- **Automated token-verify smoke — still not built, and now the only would-be
  detector is gone.** This bullet used to say the deploy job runs probe #2 pre-build
  (see §9.3); that step retired with `website.yml` on 2026-09-02, so nothing checks
  the token at deploy time or any other time. The recommendation stands unchanged:
  wire probe #2 into a scheduled workflow (or the §5 poller) so an invalid token
  alerts *before* someone tries to deploy. Note that neither live workflow declares
  a schedule trigger today, so this means writing one, not editing an existing run.
  The token is a repo secret; the verify endpoint needs no other permission.
- **Live-portal poller:** probe #3 is the ground truth for "did the deploy actually
  land" — a 404 on `/docs-portal/intro.html` means stale assets regardless of what CI
  says. Add it to the §5 alert rules as a page-level check.
- **Treat a stale site as an incident:** the retired Website Deploy workflow is what
  used to be able to go red here, so "deploy job failed" is no longer an alert any
  system can raise. Add the equivalent for probe #3 to §3 instead — a 404 on
  `https://ozpos.my.id/docs-portal/intro.html` is now the ONLY signal that a deploy
  did not land, because no live workflow deploys the site and a green PR tells you
  nothing about what shipped.

> last audited 09-09-26 by docs-auditor
