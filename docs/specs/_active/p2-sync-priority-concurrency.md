<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: STALE (1 finding — status outdated) · Finding: card is marked "PENDING" but the implementation has LANDed. Verified: SyncPriority enum (Critical=0/Normal=1/Low=2) at crates/oz-core/src/offline.rs:12 with priority field on OfflineQueueItem (offline.rs:61) + default_priority(); per-route ConcurrencyLimitLayer::new(10) API + ::new(40) sync at apps/cloud-server/src/main.rs:343-344; #[tokio::main(flavor="multi_thread", worker_threads=2)] at main.rs:65; event handlers enqueue priorities (platform/startup/src/event_handlers.rs). Status "PENDING" understates reality. Baseline/file references accurate. -->

# P-2 — Sync priority tiers & concurrency limits

- **Status:** PENDING
- **Phase:** 2 of 3 (Sync Performance Strategy — ADR #10)
- **Parent:** `docs/decisions/2026-07-13-sync-performance-compression-batching.md`
- **Severity:** MEDIUM
- **Owner:** TBD
- **Est. effort:** 1-2 weeks
- **Depends on:** P-1 (batching, compression, backoff, retention)

## Summary

Ensure critical sale records propagate before inventory syncs by introducing priority tiers in the sync queue. Protect API availability under sync load by splitting Axum concurrency limits per route group and raising the Tokio runtime to 2 worker threads.

## Baseline (pre-fix)

- All `offline_queue` items are equal priority. A `complete_sale` and a `product.created` are pushed in arrival order within the same batch. During large inventory imports, sale records can be delayed arbitrarily.
- The `oz-cloud-server` uses the default Tokio multi-threaded runtime (number of threads = number of CPU cores). There is no concurrency limit. A burst of sync pushes can OOM the server or starve API routes (product lookup, sale creation, health).
- The single global `ConcurrencyLimitLayer` (if one existed) would block API calls when sync routes hit the limit.

## Acceptance criteria

### Priority tiers
- [ ] `SyncPriority` enum defined: `Critical = 0` / `Normal = 1` / `Low = 2` (derive `Serialize`, `Deserialize`, `PartialOrd`, `Ord`)
- [ ] `offline_queue` table gains `priority INTEGER NOT NULL DEFAULT 1` column (new migration)
- [ ] Event handlers emit queue items with appropriate priority: `SaleCompleted` → `Critical`, `ProductCreated` → `Normal`, `StockAdjusted` → `Normal`, settings changes → `Low`
- [ ] `build_batches()` groups items by priority before chunking. All `Critical` batches transmit before any `Normal` batch.
- [ ] Server-side ordering: items within a batch processed in arrival order (no re-ordering needed)

### Concurrency limits (per-route-group)
- [ ] Sync routes (push/pull/status): max **40 concurrent requests**, queue up to 10 MB buffered payloads, then `429 Too Many Requests`
- [ ] API routes (products, sales, health): max **10 concurrent requests**, no queue (shed immediately)
- [ ] Achieved via separate `ConcurrencyLimitLayer` per `RouteGroup` in Axum router, not a single global limiter

### Runtime
- [ ] `oz-cloud-server` compiled with `#[tokio::main(flavor = "multi_thread", worker_threads = 2)]`
- [ ] Workspace `Cargo.toml` `tokio` dependency retains `rt-multi-thread` feature (not changed to `rt` — the 2-thread override happens at the binary level)

### Performance targets
- [ ] Under 50 concurrent sync pushes: API p50 response time < 100ms
- [ ] Under 50 concurrent sync pushes: API error rate = 0% (no 429s on API routes)
- [ ] Sync route 429 rate < 5% under normal load (bursts expected, normal operations unaffected)

## Plan

1. **Priority type**: Add `SyncPriority` enum to `crates/oz-core/src/offline.rs` (or a new `sync.rs` module). Derive required traits. Add `priority` field to `OfflineQueueItem` struct.
2. **Migration**: Create `crates/oz-core/migrations/XXX_offline_queue_priority.sql`: `ALTER TABLE offline_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 1;`. Register in `migrations.rs`. Update DDL in `018_offline_queue.sql` for new installs.
3. **Event handlers**: Update `platform/startup/src/event_handlers.rs`: enqueue `SaleCompleted` with `Critical`, inventory events with `Normal`, settings with `Low`.
4. **Batching**: Modify `build_batches()` in `platform/sync/src/lib.rs` to sort pending items by priority before the existing byte-size chunking loop.
5. **Server DDL**: Update `apps/cloud-server/src/db.rs` PG-compatible `CREATE TABLE` to include `priority INTEGER NOT NULL DEFAULT 1`.
6. **Concurrency limits**: Split Axum router in `apps/cloud-server/src/main.rs` into route groups. Apply `ConcurrencyLimitLayer::new(40)` to sync group, `ConcurrencyLimitLayer::new(10)` to API group. Use `tower::layer::layer_fn` to attach buffer tracking on sync group (10 MB limit via custom `BufferLayer` or existing `BackpressureLayer`).
7. **Runtime**: Add `#[tokio::main(flavor = "multi_thread", worker_threads = 2)]` attribute to `main()` in `apps/cloud-server/src/main.rs`. No changes to workspace `Cargo.toml` needed — `rt-multi-thread` is already the default feature.

## Verification

| Check | Expected |
|-------|----------|
| `cargo build -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests` | exit 0 |
| `cargo clippy -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests -- -D warnings` | 0 warnings |
| `cargo test -p platform-startup` | all passing (event handler tests) |
| `cargo test -p oz-core --test offline_integration` | all passing (priority column) |
| Load test: 60 concurrent sync pushes + 20 concurrent API calls | Sync: 40 in-flight, 20 queued; API: 10 in-flight, 10 rejected (429) |
| Assert: items enqueued as `Critical` appear in DB with `priority = 0` | Verified via SQLite query |
| Assert: `build_batches` output ordering: all Critical batches before Normal | Verified via unit test fixture |

## Residual / follow-ups

- **Priority-based backpressure**: Currently, a `Critical` item queued behind 500 `Normal` items still waits for all Normal batches to clear before its batch is sent. A future refinement could promote `Critical` items to the front of the queue even if already enqueued after Normal items.
- **Dynamic concurrency tuning**: The 40/10 split is hardcoded. Phase 3's observability surface can inform whether these values need to be configurable at runtime.
- **Snapshot priority**: The snapshot endpoint (Phase 3) should be treated as `Low` priority in the concurrency model — it's bulk data, not latency-sensitive.

## References

- `docs/decisions/2026-07-13-sync-performance-compression-batching.md` (Strategy overview — priority tiers and concurrency limits)
- `docs/specs/_active/p1-sync-batching-compression-retention.md`
- `crates/oz-core/src/offline.rs`
- `crates/oz-core/migrations/20260813_init.sql`
- `platform/startup/src/event_handlers.rs`
- `apps/cloud-server/src/main.rs`
- `apps/cloud-server/src/sync_api.rs`

> last audited 22-07-26 by Hermes-Agent
