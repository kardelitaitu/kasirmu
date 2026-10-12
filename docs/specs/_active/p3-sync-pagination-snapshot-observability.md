<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 3 minor — all three are the PRIOR MARKER'S findings, re-confirmed still true) · Fresh full audit; the 2026-09-29 stamp and the 2026-07-24 Hermes marker below are merged as original evidence. · THE 2026-07-24 FINDINGS WERE NOT RE-DERIVED AND ARE STILL OPEN; this pass re-verified all three at the current coordinates and each holds. A finding recorded and then re-confirmed is worth more than a finding recorded and forgotten, so they are corrected in place now rather than left in a superseded marker. · F1 (health disk-degrade — CONFIRMED STILL TRUE): the card requires `GET /health` to return `status: "degraded"` above 95% disk. The handler degrades on the DB round-trip only (`apps/cloud-server/src/main.rs:829`, `if db_connected { "ok" } else { "degraded" }`) and no disk reading exists anywhere in `apps/cloud-server/src`. Nested consequence: the `disk_usage_percent` gauge this card lists among the metrics also does not exist — the pruning task emits `PRUNE_QUEUE_DELETED_TOTAL`/`PRUNE_SENT_REPORTS_DELETED_TOTAL` (`metrics.rs:67,83`) and no disk metric. Corrected on the criterion, the metric bullet, the plan step and the verification row. · F2 (snapshot cache — CONFIRMED STILL TRUE, and the extension has drifted too): the card specifies a disk cache at `{OZ_CACHE_DIR}/snapshots/{tenant_id}/{generation}.ozpkg` with LRU-max-100. What exists is an in-memory single-flight cache — `Arc<Mutex<HashMap<String, Arc<RwLock<Option<SnapshotData>>>>>>` (`sync_api.rs:61`) with TTL eviction and an optional Redis tier — and `grep -n "fs::write\|PathBuf\|\.ozpkg" apps/cloud-server/src/sync_api.rs` returns nothing. The card also still writes `.ozpkg`; the format is `.kasirpkg` (`crates/kasirmu-core/src/kasirpkg.rs:1`). The in-memory design is a legitimate engineering choice and is documented in the code as an improvement (single-flight prevents a stampede); the card simply never records that it replaced the disk design it asked for. · F3 (DB path — CONFIRMED STILL TRUE, restated here): `OZ_DB_PATH` defaults to `kasir.db` in the CWD (`apps/cloud-server/src/db.rs:12`), not `/data/oz-pos.db`; the prior marker found this against the companion VPS-migration doc and it applies to this card's deployment assumptions. Recorded in the References rather than duplicated. · VERIFIED AND LEFT ALONE, because the card's other half genuinely shipped: the `.kasirpkg` snapshot endpoint is live (`sync_api.rs:197` route, `:537` handler) and the format is documented as JSON → zstd → encrypt (`kasirpkg.rs:1-47`); the tiered heartbeat matches the criterion exactly, including the tier boundaries — `0..=999 → 120`, `1000..=5000 → 300`, `_ → max(300, 10_000 / total * 60)` (`sync_api.rs:722-733`) with the response field at `:847`; and every named Prometheus metric the card lists is real and registered under the exact name it gives — `sync_pushes_total`, `sync_anchor_expired_total`, `sync_push_duration_ms`, `sync_pull_duration_ms`, `sync_batch_size_bytes`, `db_connection_contention_seconds` (`metrics.rs:29-258`, asserted in `metrics_tests.rs:27-91`). `check-dead-refs.py` never flagged any of the three divergences above, because each is a design claim rather than a path. · MINOR: pre-rebrand package names `oz-cloud-server`/`oz-core` in the Plan and two Verification rows, annotated. · NOT re-measured: pagination correctness under a real 90-day backlog, snapshot consistency, and the performance targets — those need a load run, which is what the prior marker also declined to assert. · Prior marker retained; footer re-dated. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence (delimiters stripped so they cannot nest):

**STAMP MERGED INTO THIS ONE (2026-10-11)** — superseded bodies kept verbatim as original evidence:

Superseded audit marker (2026-07-24 · Hermes-Agent, body kept verbatim) · retained · status: STALE (3 findings) · F1 (HIGH): spec line 59 + verification line 100 require GET /health -> status:"degraded" when disk>95%, but health_handler (apps/cloud-server/src/main.rs:305) only degrades on db_connected; no disk-usage logic anywhere in cloud-server (grep NONE) · F2 (MED): spec line 35/37 require disk-backed snapshot cache at {OZ_CACHE_DIR}/snapshots/{tenant_id}/{gen}.ozpkg with LRU max 100 files, but SnapshotCache is in-memory Arc<Mutex<HashMap>> (apps/cloud-server/src/sync_api.rs:29) with no fs write; design diverges from spec · F3 (LOW): vps-migration companion doc states default OZ_DB_PATH=/data/oz-pos.db, but code default (db.rs:52) is oz-pos.db in CWD (the /data path is a docker-compose convention) · verified accurate: /api/sync/snapshot route (sync_api.rs:81) + handler:297; tiered heartbeat formula matches spec (sync_api.rs:459 <1000=120s,1000-5000=300s,5000+=max(300,10k/count*60)); crates/oz-core/src/ozpkg.rs uses zstd; axum-prometheus /metrics + /health exist

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with a prior marker re-verified rather than replaced. It closes the three-phase sync performance strategy whose first two cards were audited in the previous round, and completing the series is what makes the set worth a reader's time: batching and backoff first, then priority and concurrency, then pagination, snapshotting and observability — in that order, because you cannot measure what you have not made observable. · THE SERIES IS A DEPENDENCY CHAIN and this card is its terminus. The first card decides how items are grouped and how failures back off; the second decides what to send first and how much at once; this one decides how a large backlog is paged rather than truncated, how a consistent snapshot is taken, and how any of it is seen. A reader arriving here first will read observability as a nice-to-have, which is the exact misreading the ordering exists to prevent. · THE PRIOR MARKER IS RE-VERIFIED rather than replaced, and its finding retained as original evidence. What is recorded is that the card's claims about pagination, snapshotting and observability were NOT re-derived: establishing whether a snapshot is genuinely consistent, or whether an observability surface emits what it promises, is a code review rather than a documentation audit, and a stamp implying otherwise would be the overreach this campaign has avoided throughout. · A NOTE ON WHY OBSERVABILITY IS THE RIGHT FINAL PHASE RATHER THAN AN OPTIONAL EXTRA, which the repository's own history supports. This campaign has repeatedly found that real problems were invisible not because they were hard but because nothing was watching: the settings-ingest census existed only because someone wrote a script to measure the admitted set, and the rate-limit collapse took a full session to find because the client reported a 429 as a connection failure. A sync layer that batches, tiers and pages without emitting the counters to see it is three phases of machinery with no feedback — and this card is the one that closes that loop. · Prior marker retained; footer re-dated to match the new stamp.

-->
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
- [x] `GET /api/sync/snapshot` returns compressed `.kasirpkg` file (zstd, via existing `crates/kasirmu-core/src/kasirpkg.rs` — the module was renamed from `ozpkg.rs` in the rebrand, and the format's own extension moved with it) — **CONFIRMED 2026-10-11: module present, `.kasirpkg` envelope documented at `kasirpkg.rs:1-47` (JSON → zstd → encrypt), route live at `apps/cloud-server/src/sync_api.rs:197`**
- [ ] Snapshot endpoint is protected by the same JWT auth middleware as push/pull/status (tenant-scoped)
- [ ] Cached files stored at `{OZ_CACHE_DIR}/snapshots/{tenant_id}/{generation_timestamp}.ozpkg`. `OZ_CACHE_DIR` defaults to `<data_dir>/cache`.  — **NOT SHIPPED, still open 2026-10-11: there is no disk cache and no `OZ_CACHE_DIR` for snapshots. `SnapshotCache` is an in-memory single-flight structure — `Arc<Mutex<HashMap<String, Arc<RwLock<Option<SnapshotData>>>>>>` (`apps/cloud-server/src/sync_api.rs:61`) with an optional Redis tier and a TTL; `grep -n "fs::write\|PathBuf\|\.ozpkg" apps/cloud-server/src/sync_api.rs` returns nothing. The `.ozpkg` extension named here is also stale — the format is `.kasirpkg`.**
- [ ] Snapshot contains: all products, tax rates, users, and settings for the requesting tenant
- [ ] Snapshot cached on disk keyed by `{tenant_id}_{generation_timestamp}`. LRU eviction with max 100 files  — **NOT SHIPPED; eviction is TTL-based (`SNAPSHOT_CACHE_TTL_SECS`), not an LRU of 100 files**
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
  - `disk_usage_percent` — gauge from hourly pruning task  — **NOT SHIPPED: no such metric exists. The pruning task emits `PRUNE_QUEUE_DELETED_TOTAL` and `PRUNE_SENT_REPORTS_DELETED_TOTAL` (`apps/cloud-server/src/metrics.rs:67,83`) but no disk gauge, consistent with pruning no longer being disk-driven (`apps/cloud-server/src/prune.rs`).**
- [ ] Each client sync cycle logs: pending count, batch count, bytes sent/received, per-batch duration, compression ratio, retry count, backoff delay
- [ ] `GET /health` returns `{"status":"ok","version":"…","db":"sqlite","uptime_seconds":…}`. Disk > 95% → `status: "degraded"`
      — **NOT SHIPPED, still open 2026-10-11: `status` is `"degraded"` only when the DB round-trip fails (`apps/cloud-server/src/main.rs:829`, `if db_connected { "ok" } else { "degraded" }`). No disk-usage reading exists anywhere in `apps/cloud-server/src` — `grep -n "disk_usage\|auto_vacuum" …` returns nothing on the health path. The prior 2026-07-24 finding F1 is confirmed still true.**

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
   - If cache miss: generate snapshot via existing `kasirmu-core` snapshot logic, write to cache, serve.  (crate renamed from `oz-core`.)
   - Cache eviction: track access timestamps, evict LRU when count > 100.
     **CORRECTION 2026-10-11: shipped as a TTL-based in-memory cache (single-flight per tenant, optional Redis tier), not a disk LRU of 100. See the criterion note above.**
4. **Snapshot cache invalidation**: Subscribe to domain events (same pattern as `platform/startup/src/event_handlers.rs`). On product/tax/user/setting mutation, bump `generation_timestamp` for the tenant. Debounce: coalesce mutations within 5 minutes.
5. **Client snapshot recovery**: In `platform/sync/src/lib.rs` `run_sync_cycle()`, handle `AnchorExpired`:
   - Wait `rand(0, error.retry_after_secs)`.
   - `GET /api/sync/snapshot` → download `.ozpkg` → import via existing `sync_client.rs` snapshot import logic.
   - Resume delta pulls from `oldest_available`.
6. **Tiered heartbeat**: Add `heartbeat_interval_secs` field to sync status response in `apps/cloud-server/src/sync_api.rs`. Compute via the tiered formula. Update `platform/sync/src/daemon.rs` to read this field from status response and adjust its sleep interval. Fall back to default 120s if field absent.
7. **Metrics**: Add `axum-prometheus` to `apps/cloud-server/Cargo.toml`. Register metrics registry in Axum app state. Instrument sync push/pull handlers with counters and histograms. Add DB contention tracking via `tokio::sync::Mutex` lock time measurement.
8. **Health**: Add `GET /health` handler returning server info. Report degraded when `disk_usage_percent > 95`.  **CORRECTION 2026-10-11: shipped without the disk clause — `/health` reports `degraded` on DB failure only.**
9. **Client logging**: Add structured logging (via `tracing`) to each sync cycle in `platform/sync/src/lib.rs`. Log at `info` level for cycle summary, `debug` for per-batch details.

## Verification

| Check | Expected |
|-------|----------|
| `cargo build -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests` | exit 0 — **`oz-cloud-server` is a pre-rebrand name; it is `kasirmu-cloud` today** |
| `cargo clippy -p oz-cloud-server -p platform-sync --lib --tests -- -D warnings` | 0 warnings — **same name note** |
| `cargo test -p oz-cloud-server` | all passing (pull pagination tests) |
| `cargo test -p platform-sync` | all passing (client pull loop + snapshot recovery) |
| Manual: pull with 1500 items in queue | 3 pages of 500 returned, `next_cursor` non-null on first two |
| Manual: `curl /api/sync/snapshot` returns valid `.ozpkg` | File header matches zstd magic bytes |
| Manual: `curl /metrics` returns prometheus text format | Contains `sync_pushes_total`, `sync_push_duration_ms` etc. |
| Manual: `curl /health` when disk < 95% | `{"status":"ok",…}` |
| Manual: `curl /health` when disk > 95% (simulate with threshold override) | `{"status":"degraded",…}` — **cannot pass as written: there is no disk threshold to override** |

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
- `apps/cloud-server/src/main.rs` (health + metrics + concurrency layers)
- **Note on the DB path: `OZ_DB_PATH` defaults to `kasir.db` in the CWD (`apps/cloud-server/src/db.rs:12`), not `/data/oz-pos.db`. The prior 2026-07-24 finding F3 recorded this against the companion VPS-migration doc; it is restated here because this card's deployment assumptions are the same ones.**
- `platform/sync/src/lib.rs`
- `platform/sync/src/daemon.rs`
- `crates/kasirmu-core/src/kasirpkg.rs` (RENAMED from a pre-rebrand `ozpkg` path that no longer exists)
- `platform/sync/src/transport.rs`

> last audited 11-10-26 by docs-auditor
