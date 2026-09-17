---
num: 43
area: cloud
title: ADR #43: Cloud Sync Performance & Scale-Out Roadmap
status: Implemented (D1–D4, D7, D9-ready) — remaining items deferred or infra-only (2026-09-02)
---
# ADR #43: Cloud Sync Performance & Scale-Out Roadmap

**Status:** Implemented (D1–D4, D7, D9-ready) — remaining items deferred or infra-only (2026-09-02)  
**Date:** 2026-09-02  
**Author:** Architecture Team & kasir.mu Contributors  
**Tags:** cloud, sync, performance, scalability, caching, rate-limiting, observability, rls, cost-optimization, redis, postgres

> **Baseline (2026-09-01–02):** the cloud server (`oz-cloud-server`, axum 0.8,
> dual SQLite/Postgres backend, single unified container behind Caddy on
> Northflank) already carries a SOTA core: cursor-paginated pull, multi-row
> push inserts (Phase A), single-flight + version-revalidated snapshot cache
> (Phase B), cached health depth and tunable worker threads (Phase C), and
> per-tenant sharded token-bucket rate limiting. This ADR records the next
> wave of improvements — cheap hot-path wins first, then horizontal
> scale-out readiness, then scale-out architecture — with the decision to
> pursue them in that priority order.

---

## 1. Context & Motivation

The cloud sync function must stay **cheap** and serve **many concurrent
tenants** from one small instance, and eventually scale horizontally.
The Phase A/B/C work (commits `0e52f1d4`, `571129c1`, `42cdf6a1`) removed
the biggest per-request costs, but several hot-path and scaling limits
remain:

1. **Every DB query is re-parsed and re-planned.** Push, pull, status, and
   snapshot run the same SQL thousands of times per minute; nothing uses
   `prepare_cached`, so PostgreSQL spends CPU re-parsing identical text.
2. **Snapshot staleness is bounded by a version-stamp query.** Phase B
   added version revalidation, but the stamp query (`COUNT` +
   `MAX(updated_at)` per reference table) runs on every cache miss and is
   wasted work for tenants whose reference data is unchanged — the common
   case between edits.
3. **All caches and the rate limiter are per-instance.** The snapshot
   cache, tenant-count cache, health-depth cache, and sharded token
   buckets live in process memory. A second replica resets rate-limit
   windows (abuse window) and duplicates cache misses — horizontal
   scaling is blocked until they are shared.
4. **Reads and writes share the same Postgres primary.** Status heartbeat
   (every 120s+ per terminal), pull (per push cycle), and snapshot (on
   anchor expiry) are the volume; pushing them through the primary caps
   read throughput at one writer's ceiling.
5. **Email reports are sent from a 300s poll loop** with no outbox
   (at-least-once gap under crash/restart), and webhooks have no retry /
   dead-letter path.
6. **Observability stops at process metrics.** `tracing` spans and
   Prometheus counters exist but are not exported; there is no
   distributed tracing across Caddy → app → Postgres, and no alerting on
   queue depth or DB latency.
7. **RLS policies exist but are not enforced.** The app sets
   `oz.tenant_id` per request, but it likely still connects as the table
   owner (which bypasses RLS); the `scripts/rls-cutover.sql` cutover has
   not been completed, so tenant isolation is application-level only.
8. **Cost: full snapshots on anchor mispredictions.** A large catalog
   (10k+ products) re-downloads the whole 3-table reference set whenever
   the anchor expires, even when few rows changed.

---

## 2. Architectural Decisions

Adopt a **tiered roadmap**, executed in priority order. Each tier is
independently shippable, testable, and reversible; lower tiers build on
the foundations of higher tiers.

### Tier 1 — Cheap, high-impact (next sprint)

**D1. Prepared statement caching for the PG hot path.**
Wrap the repeated SQL in `sync_store.rs` (push_batch, pull_items,
pending_count, snapshot_all, snapshot_version, status queries) with
`tokio_postgres` `prepare_cached` handles so the backend reuses plans
instead of re-parsing. No new dependency; expected 10–30% CPU reduction
on the PG hot path, largest for small queries (status, pending_count).
*Decision:* do this first — it is the lowest-risk, highest-ROI item.

**D2. Write-through snapshot invalidation.**
Replace the version-stamp query with a per-tenant version counter bumped
in the same transaction as reference-data writes (`create_product`,
`update_product`, `create_tax_rate`, `create_user`, etc.). The snapshot
handler compares the counter instead of running the stamp query,
eliminating a query on every cache miss and making propagation
near-instant. The version stamp query remains as the SQLite-backend
fallback (no write hook there).
*Decision:* accept the small surface change in oz-api write handlers;
reject a fully event-driven invalidator (overkill while one instance).

**D3. Cache the `/metrics` text render.**
Re-format the Prometheus exposition at most once per 10s (same shape as
`HealthDepthCache`) to remove scrape-driven CPU spikes.

### Tier 2 — Horizontal scaling readiness

**D4. Redis/Valkey for cross-instance snapshot cache + rate limiter.**
Add an optional Redis backend (Valkey preferred — BSD license, cheaper):
the snapshot cache stores `tenant_id → (bytes, version)` with TTL; the
token buckets become atomic Lua-scripted sliding-window counters. Both
fall back to the in-process implementation when Redis is unavailable, so
single-instance deployments need nothing new.
*Decision:* required before the deployment may run more than one app
replica; until then the in-process implementations are authoritative.

### Tier 3 — Scale-out architecture

**D5. Read replicas for pull/status/snapshot.**
Add a second deadpool pool pointed at a PG read replica; route the
read-only sync surface (pull, status, snapshot) to it while writes stay
on the primary. `SyncStore` gains a `PostgresReadReplica(Pool)` variant.
*Decision:* **DEFERRED — until we actually get high traffic.** A read
replica doubles the Postgres footprint (compute + storage + replication
latency) for a benefit the current load does not need: today the sync
read volume (status heartbeat, pull, snapshot) fits comfortably on the
single primary, and the read/write mix on one small instance stays far
below the primary's ceiling. Deferral triggers: sustained
requests-per-second where primary CPU or connection count approaches its
ceiling, or read latency regressions under load. The `SyncStore` enum
makes the routing change localized when we reach that point.

**D6. PgBouncer (transaction mode) as the connection front.**
Amortize N app instances × pool_size onto few PG connections. Deployment
config only — no code change. *Decision:* adopt when instance count ×
pool_size approaches PG `max_connections`.

**D7. Transactional outbox for email + webhooks.**
Write outgoing messages to an `outbox` table in the same transaction as
the source event; a background worker drains it at-most-once with
delivery tracking. Replaces the 300s email poll loop and adds webhook
retry with exponential backoff and dead-letter.
*Decision:* the poll loop is acceptable below ~1k tenants; the outbox is
the SOTA replacement when reliability at scale matters.

### Tier 4 — Observability & security

**D8. OpenTelemetry (OTLP) export.**
Bridge the existing `tracing` spans to OTLP for distributed traces and
add alerting rules (push 5xx rate, DB latency, queue depth) to the
platform. *Decision:* adopt a managed OTLP endpoint (e.g. Grafana Tempo /
Mimir); keep Prometheus text format as the local scrape source of truth.

**D9. Complete the RLS cutover.**
Create the restricted `oz_app` role with DML-only grants, switch the
app's connection to it, and `FORCE RLS` on tenant-scoped tables
(`scripts/rls-cutover.sql`). *Decision:* security milestone; schedule
with a maintenance window and full regression run.

### Tier 5 — Cost optimization

**D10. Incremental snapshot (delta) endpoint.**
Client sends its last-known `updated_at` per reference table; server
returns only rows changed since, with the full snapshot as the anchor-
expiry fallback. *Decision:* **DEFERRED — until we actually get high
traffic / large catalogs.** The delta protocol adds client + server
complexity (per-table anchors, merge semantics, cache interplay) for a
problem the current tenants do not have: today's catalogs are small
enough that the full-snapshot + ETag/304 path already returns cheaply
(and 304 means most anchor-expired pulls transfer zero bytes). Deferral
triggers: sustained large-catalog tenants (10k+ reference rows) where
full-snapshot bytes or CPU demonstrably hurt bandwidth, or measurable
transfer cost per terminal. The full snapshot stays the fallback
regardless.

**D11. Responsive image serving.**
Add on-the-fly WebP sizing (thumbnail vs detail) behind the existing
immutable content-addressed cache. *Decision:* defer until image-heavy
terminals show measurable transfer cost.

**D12. Autoscale on sync QPS.**
Export `sync_requests_total` per route (already present in `metrics.rs`)
and drive replica count from requests-per-second per replica.
*Decision:* deployment config; no code change beyond exposing the
metric label (already done).

---

## 3. Low-End & Single-Node Deployment Guidelines (What to Avoid or Treat with Caution)

While designed for horizontal scaling, several items in Tiers 2–4 should **not** be deployed on a single budget / low-end instance (e.g., 0.5–1 vCPU, 512MB–1GB RAM on Northflank or a minimal VPS):

- **D4 (Redis / Valkey Cache & Rate Limiter):**
  - *Analysis:* Adding a Redis container on a budget server eats 50–100MB of RAM and adds localhost network hops.
  - *Codebase Reality:* `apps/cloud-server/src/redis_backend.rs` includes complete in-process fallback.
  - *Recommendation:* Keep Redis disabled on a single instance. The in-process `TokenBucket` (`apps/cloud-server/src/rate_limit.rs`) and `Arc<RwLock<Option<SnapshotData>>>` (`apps/cloud-server/src/sync_api.rs`) are zero-copy, sub-microsecond, and use virtually zero memory.
- **D8 (OpenTelemetry / OTLP Export):**
  - *Analysis:* Background OTLP batching, gRPC channels, and trace spans introduce non-trivial CPU and memory overhead.
  - *Recommendation:* Stick to lightweight Prometheus counters and standard structured logging.
- **D11 (On-The-Fly Responsive Image Sizing):**
  - *Analysis:* Dynamic WebP transcoding on a 0.5–1 vCPU server will throttle POS checkout requests during concurrent image fetches.
  - *Recommendation:* Pre-scale thumbnails during client upload or offload to an external CDN/storage layer.

---

## 4. Consequences

**Positive**

- D1–D3 measurably reduce per-request CPU with no infrastructure change;
  combined they target ~30% lower DB CPU on the sync hot path.
- D4 unblocks horizontal scaling; D5–D6 make that scaling cost-efficient.
- D7 raises delivery reliability from at-least-once to at-most-once with
  retries and dead-letter, eliminating the double-send gap.
- D8 shortens time-to-diagnosis for latency regressions; D9 gives true
  database-level tenant isolation.
- D10–D12 cut bandwidth and spend for large/image-heavy tenants without
  changing the protocol for small ones.

**Negative / Trade-offs**

- D2 touches oz-api write handlers and needs careful per-column
  regression coverage (product/tax/user/assignment writes).
- D4 adds an operational dependency (Redis/Valkey); the in-process
  fallback must stay correct so the deployment can run without it.
- D7 is the largest single change (new table + drainer + webhook retry);
  it should be shipped behind a feature flag or in a quiet window.
- D9 changes the app's DB credentials and RLS posture — a cutover with a
  documented rollback (re-grant owner, un-force RLS).

**Risks**

- Read-replica lag (D5) can serve a stale snapshot/pull; acceptable for
  reference data but must be documented for status/heartbeat.
- Redis (D4) is a new SPOF unless deployed with replication; the fallback
  path mitigates availability but not correctness of shared limits.

---

## 5. Open Questions

1. **Prepared statements on SQLite?** rusqlite has no server-side plan
   cache; the win is PG-only. Confirmed scope: D1 targets the PG branch.
2. **Version counter storage for D2:** a new `snapshot_versions` table vs
   a column on `tenant_plans`? Decision deferred to implementation.
3. **Redis topology:** shared managed Valkey vs per-deployment instance;
   impacts D4 cost and availability posture.
4. **Outbox ordering guarantees:** strict per-tenant FIFO vs best-effort;
   affects the drainer design in D7.
5. **Do we keep the full-snapshot endpoint after D10 ships?** The anchor-
   expiry fallback argues yes; the incremental endpoint becomes the
   default on new clients.

---

## 6. Related Documents

- ADR #10 — [Sync Performance Strategy](./2026-07-13-sync-performance-compression-batching.md)
- ADR #21 — [Sync Conflict Resolution Strategy](./2026-07-20-sync-conflict-resolution-strategy.md)
- Spec 0046b — Product & Menu-Item Image Support (content-addressed image store)
- Spec 0047 — OpenAPI Drift Guard & JWT Read Tiers
- `docs/records/sqlite-pg-roles.md` — SQLite↔Postgres schema parity & RLS cutover
- `scripts/rls-cutover.sql` — the pending RLS enforcement cutover (D9)

