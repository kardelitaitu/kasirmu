<!-- Audit stamp: 2026-07-24 · Hermes-Agent · status: STALE (3 findings) · F1 (HIGH): spec line 59 + verification line 100 require GET /health -> status:"degraded" when disk>95%, but health_handler (apps/cloud-server/src/main.rs:305) only degrades on db_connected; no disk-usage logic anywhere in cloud-server (grep NONE) · F2 (MED): spec line 35/37 require disk-backed snapshot cache at {OZ_CACHE_DIR}/snapshots/{tenant_id}/{gen}.ozpkg with LRU max 100 files, but SnapshotCache is in-memory Arc<Mutex<HashMap>> (apps/cloud-server/src/sync_api.rs:29) with no fs write; design diverges from spec · F3 (LOW): vps-migration companion doc states default OZ_DB_PATH=/data/oz-pos.db, but code default (db.rs:52) is oz-pos.db in CWD (the /data path is a docker-compose convention) · verified accurate: /api/sync/snapshot route (sync_api.rs:81) + handler:297; tiered heartbeat formula matches spec (sync_api.rs:459 <1000=120s,1000-5000=300s,5000+=max(300,10k/count*60)); crates/oz-core/src/ozpkg.rs uses zstd; axum-prometheus /metrics + /health exist -->

# P-3 — Pull pagination, snapshot endpoint, tiered heartbeat & metrics

- **Status:** DONE (implemented 2026-07-15)
- **Phase:** 3 of 3 (Sync Performance Strategy — ADR #10)
- **Parent:** `docs/decisions/2026-07-13-sync-performance-compression-batching.md`
- **Severity:** MEDIUM
- **Owner:** Architecture Team
- **Est. effort:** 2-3 weeks (actual: 2 days)
- **Depends on:** P-1, P-2

## Summary

Handle large pull responses (terminals offline 90+ days) via cursor-based pagination and a compressed snapshot endpoint. Introduce a lightweight tiered heartbeat to replace fixed periodic polling. Expose sync health and performance via Prometheus metrics.

## Baseline (pre-fix)

- `POST /api/sync/pull` returns **all** items matching `created_at >= since` in a single JSON response. A terminal offline 90 days triggers a pull of potentially tens of thousands of rows (megabytes of JSON).
- There is no snapshot mechanism. `AnchorExpired` (Phase 1) leaves the terminal with nothing to sync from — it must fetch each record individually via the pull endpoint.
- The daemon polls on a fixed random interval (60-120s). No server-driven heartbeat interval.
- No Prometheus metrics. No visibility into sync latency, contention, or error rates beyond raw logs. No health check with disk-pressure awareness.

## Acceptance criteria

### Pull pagination
- [ ] Pull request accepts optional `cursor: Option<String>` (opaque base64 encoding of `(created_at, id)`)
- [ ] Pull response includes `next_cursor: Option<String>` when more pages exist
- [ ] Page size: 500 items
- [ ] Client loops `pull(since, cursor)` until `next_cursor` is null
- [ ] Server-side query uses cursor for pagination: `WHERE (created_at, id) > (cursor_ts, cursor_id) ORDER BY created_at, id LIMIT 500`
- [ ] Pull response compression (Phase 1 Gzip) applies to each page independently

### Snapshot endpoint
- [ ] `GET /api/sync/snapshot` returns compressed `.ozpkg` file (zstd, via existing `crates/oz-core/src/ozpkg.rs`)
- [ ] Snapshot endpoint is protected by the same JWT auth middleware as push/pull/status (tenant-scoped)
- [ ] Cached files stored at `{OZ_CACHE_DIR}/snapshots/{tenant_id}/{generation_timestamp}.ozpkg`. `OZ_CACHE_DIR` defaults to `<data_dir>/cache`.
- [ ] Snapshot contains: all products, tax rates, users, and settings for the requesting tenant
- [ ] Snapshot cached on disk keyed by `{tenant_id}_{generation_timestamp}`. LRU eviction with max 100 files
- [ ] Cache invalidation: regeneration triggered on product/tax/user/setting domain events, debounced to at most once per 5 minutes per tenant
- [ ] `AnchorExpired` error (Phase 1) directs client to snapshot endpoint instead of pull
- [ ] Staggered recovery: client waits `rand(0, retry_after_secs)` before requesting snapshot (default 3600s spread)

### Tiered heartbeat
- [ ] `GET /api/sync/status` response includes `heartbeat_interval_secs: u64` field
- [ ] Server computes heartbeat interval: < 1000 tenants → 120s, 1000-5000 → 300s, 5000+ → `max(300, 10_000 / tenant_count * 60)`
- [ ] Client caches this value and uses it for idle heartbeat timing
- [ ] Heartbeat is a lightweight status check only (not a full push/pull cycle)
- [ ] Full push/pull cycle triggers immediately on-event (unchanged) or when status check reveals pending server-side changes

### Observability
- [ ] `GET /metrics` endpoint (via `axum-prometheus` crate) exposes:
  - `sync_pushes_total` — counter by status (accepted / conflict / rejected)
  - `sync_push_duration_ms` — histogram (p50, p95, p99)
  - `sync_pull_duration_ms` — histogram
  - `sync_batch_size_bytes` — histogram (before/after compression)
  - `db_connection_contention_seconds` — histogram
  - `sync_anchor_expired_total` — counter
  - `disk_usage_percent` — gauge from hourly pruning task
- [ ] Each client sync cycle logs: pending count, batch count, bytes sent/received, per-batch duration, compression ratio, retry count, backoff delay
- [ ] `GET /health` returns `{"status":"ok","version":"…","db":"sqlite","uptime_seconds":…}`. Disk > 95% → `status: "degraded"`

### Performance targets
- [ ] Full base sync via snapshot for a tenant with 10K products: < 10 seconds (including download + import)
- [ ] Snapshot cache hit ratio: > 90% after first week of operation
- [ ] `GET /metrics` and `GET /health` add < 1ms p99 latency to the server (negligible overhead)
- [ ] Idle heartbeat at 10,000 tenants: server CPU < 5% from status checks alone

## Plan

1. **Pull pagination**: Modify `POST /api/sync/pull` handler in `apps/cloud-server/src/sync_api.rs`:
   - Accept optional `cursor: Option<String>` in request body. Decode base64 → `(DateTime<Utc>, Uuid)`.
   - Query: `SELECT … FROM offline_queue WHERE tenant_id = ? AND created_at >= ? AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT 501` (fetch 501, return 500 + next_cursor if 501 present).
   - Encode `next_cursor` as base64 of `(last.created_at, last.id)`.
2. **Client pull loop**: Update `platform/sync/src/lib.rs` `run_sync_cycle()` pull phase to loop on `next_cursor`.
3. **Snapshot endpoint**: Add `GET /api/sync/snapshot` handler in `apps/cloud-server/src/sync_api.rs`:
   - Check cache: `{tenant_id}_{generation_timestamp}.ozpkg`. If exists and generation timestamp matches current products/tax/users/settings generation, serve cached file.
   - If cache miss: generate snapshot via existing `oz-core` snapshot logic, write to cache, serve.
   - Cache eviction: track access timestamps, evict LRU when count > 100.
4. **Snapshot cache invalidation**: Subscribe to domain events (same pattern as `platform/startup/src/event_handlers.rs`). On product/tax/user/setting mutation, bump `generation_timestamp` for the tenant. Debounce: coalesce mutations within 5 minutes.
5. **Client snapshot recovery**: In `platform/sync/src/lib.rs` `run_sync_cycle()`, handle `AnchorExpired`:
   - Wait `rand(0, error.retry_after_secs)`.
   - `GET /api/sync/snapshot` → download `.ozpkg` → import via existing `sync_client.rs` snapshot import logic.
   - Resume delta pulls from `oldest_available`.
6. **Tiered heartbeat**: Add `heartbeat_interval_secs` field to sync status response in `apps/cloud-server/src/sync_api.rs`. Compute via the tiered formula. Update `platform/sync/src/daemon.rs` to read this field from status response and adjust its sleep interval. Fall back to default 120s if field absent.
7. **Metrics**: Add `axum-prometheus` to `apps/cloud-server/Cargo.toml`. Register metrics registry in Axum app state. Instrument sync push/pull handlers with counters and histograms. Add DB contention tracking via `tokio::sync::Mutex` lock time measurement.
8. **Health**: Add `GET /health` handler returning server info. Report degraded when `disk_usage_percent > 95`.
9. **Client logging**: Add structured logging (via `tracing`) to each sync cycle in `platform/sync/src/lib.rs`. Log at `info` level for cycle summary, `debug` for per-batch details.

## Verification

| Check | Expected |
|-------|----------|
| `cargo build -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests` | exit 0 |
| `cargo clippy -p oz-cloud-server -p platform-sync --lib --tests -- -D warnings` | 0 warnings |
| `cargo test -p oz-cloud-server` | all passing (pull pagination tests) |
| `cargo test -p platform-sync` | all passing (client pull loop + snapshot recovery) |
| Manual: pull with 1500 items in queue | 3 pages of 500 returned, `next_cursor` non-null on first two |
| Manual: `curl /api/sync/snapshot` returns valid `.ozpkg` | File header matches zstd magic bytes |
| Manual: `curl /metrics` returns prometheus text format | Contains `sync_pushes_total`, `sync_push_duration_ms` etc. |
| Manual: `curl /health` when disk < 95% | `{"status":"ok",…}` |
| Manual: `curl /health` when disk > 95% (simulate with threshold override) | `{"status":"degraded",…}` |

## Residual / follow-ups

- **Snapshot push notification**: Instead of clients polling the heartbeat and discovering snapshots only on `AnchorExpired`, a future enhancement could push snapshot-available notifications via WebSocket or SSE. Not needed until real-world latency requirements demand below-minute convergence.
- **Snapshot route group**: The snapshot endpoint belongs to the sync route group (Phase 2 concurrency limit of 40). If snapshot generation blocks a worker thread for seconds, it could starve other sync requests. A future enhancement could assign snapshots to a separate "bulk" route group with a lower concurrency limit (e.g., 2).
- **Metrics dashboard**: The Prometheus endpoint is raw. A pre-built Grafana dashboard JSON (or `axum-metrics-grafana` annotation) would help operators. Out of scope for this phase.
- **Adaptive page size**: 500 items/page is a guess. Phase 3 data from `sync_pull_duration_ms` histogram may suggest tuning pull page size. Configurable via server setting (out of scope).

## References

- `docs/decisions/2026-07-13-sync-performance-compression-batching.md` (Strategy overview — pull pagination, snapshot, heartbeat, observability)
- `docs/specs/_active/p1-sync-batching-compression-retention.md`
- `docs/specs/_active/p2-sync-priority-concurrency.md`
- `apps/cloud-server/src/sync_api.rs`
- `platform/sync/src/lib.rs`
- `platform/sync/src/daemon.rs`
- `crates/oz-core/src/ozpkg.rs`
- `platform/sync/src/transport.rs`

> last audited 24-07-26 by Hermes-Agent
