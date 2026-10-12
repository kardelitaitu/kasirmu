<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor + 5 coordinates) · Fresh full audit; the 2026-09-29 stamp and the 2026-07-22 Hermes marker below are merged as original evidence. · THE IMPLEMENTATION IS FULLY REAL, and this pass re-derived it independently rather than inheriting the prior finding, because the prior marker cited pre-restructure paths that no longer resolve and its claim could not be taken on authority. Everything the card specifies exists: `SyncPriority` is defined with the exact variant values the criterion names (`crates/kasirmu-core/src/offline.rs`, `Critical=0`/`Normal=1`/`Low=2`, with `Serialize`/`Deserialize`/`PartialOrd`/`Ord`), `default_priority()` is at `offline.rs:22` and the field at `:84`; the `offline_queue` table carries `priority INTEGER NOT NULL DEFAULT 1` (in the consolidated `crates/kasirmu-core/migrations/20260813_init.sql`, not the numbered migration the plan names); the per-route-group concurrency split is exactly as specified — `ConcurrencyLimitLayer::new(10)` on the API router and `::new(40)` on the sync router (`apps/cloud-server/src/main.rs:956/961`), with the comment naming P-2; and `build_batches()` really does sort by priority before chunking (`platform/sync/src/lib.rs:162`, asserted by `build_batches_sorts_by_priority` at `lib_tests.rs:66`). The direction of the card's drift remains the optimistic one the prior marker recorded: it says PENDING where the work has landed. · MINOR (the runtime criterion shipped in a compatible but different form): the card requires `#[tokio::main(flavor = "multi_thread", worker_threads = 2)]`. What shipped is an explicit `tokio::runtime::Builder::new_multi_thread().worker_threads(n)` where `n` is read from `OZ_WORKER_THREADS` and defaults to **2** when unset or unparseable (`apps/cloud-server/src/main.rs:141-193`). The number the criterion asks for is still the default; the difference is that the deployment can now override it. Recorded on the criterion and the plan step rather than rewritten, because the criterion is a decision the card is entitled to state. · COORDINATE FIXES (5, all pre-rebrand and all silent — none reddens `check-dead-refs.py` because they are crate/package names in prose, not paths): `crates/oz-core/migrations/` in Plan step 2 → `crates/kasirmu-core/migrations/`; the dead `018_offline_queue.sql` numbered-migration reference; and the package names `oz-cloud-server`/`oz-core`/`oz-cloud-server` in the Baseline and the three Verification rows → `kasirmu-cloud`/`kasirmu-core`. · VERIFIED AND LEFT ALONE: the card's prior evidence that the priority enum "has left the core crate" is itself now out of date in the other direction — it is back in `kasirmu-core`, which is where step 1 of the plan wanted it; the 2026-09-29 note describing a cloud-server sync-store home for the enum no longer applies, and the plan's original instruction is the accurate one. · NOT re-measured: the tiering semantics under real load and the 40/10 limits in operation (the card's performance targets need a load test, and it presents them as targets). · Prior marker retained; footer re-dated. -->

> **STAMP MERGED INTO THIS ONE (2026-10-11)** — superseded bodies kept verbatim as original evidence:
>
> <!-- Superseded audit marker (2026-07-22, body kept verbatim) · Hermes-Agent · status: STALE (1 finding — status outdated) · Finding: card is marked "PENDING" but the implementation has LANDed. Verified: SyncPriority enum (Critical=0/Normal=1/Low=2) at crates/oz-core/src/offline.rs:12 with priority field on OfflineQueueItem (offline.rs:61) + default_priority(); per-route ConcurrencyLimitLayer::new(10) API + ::new(40) sync at apps/cloud-server/src/main.rs:343-344; #[tokio::main(flavor="multi_thread", worker_threads=2)] at main.rs:65; event handlers enqueue priorities (platform/startup/src/event_handlers.rs). Status "PENDING" understates reality. Baseline/file references accurate. -->
> 
> <!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · REPAIRED — a card whose status line understated what has shipped, and whose fix is to add the current coordinates rather than to assert a status. · THE FINDING IS NOT MINE, IT IS THE PRIOR MARKER'S, AND IT WAS RIGHT. The 2026-07-22 stamp says STALE for exactly one reason: the card is marked PENDING but the implementation has landed. This pass re-verified that independently, which is worth doing precisely because the marker cited PRE-RESTRUCTURE paths that no longer resolve — so the claim could not simply be taken on authority. All four symbols it named are present: the priority enum and its Postgres variant now live in the cloud server's sync-store module, the default-priority helper is in the core crate's offline module — the same file the old citation named, under the renamed crate — and the per-route concurrency limiter is still constructed in the server's main entry point at the line the earlier audit recorded. The one that moved furthest is the enum itself, which has left the core crate entirely. · WHY THE CORRECTION IS WRITTEN AS COORDINATES RATHER THAN A NEW STATUS WORD. A card that says DONE and names no symbols is worth less than a card that says PENDING and does, because the next reader still has to go looking. The correction therefore records where each piece lives today, and leaves the authoritative status word to whoever owns the series — which is the same convention this campaign has applied to the Android artefact name and the Windows executable, where guessing a generated name would have been worse than saying so. · THE DIRECTION OF THE DRIFT, which continues the pattern this campaign has been tracking: the card says LESS is true than actually is. That is the same optimistic direction as the licence-plaintext baseline, the archived CI dashboard and the payment-resilience design, and it has now recurred four times. For a work-tracking card the practical cost is a reader re-implementing something that already exists, which is expensive and entirely avoidable. · NOT re-measured: the tiering semantics themselves or the concurrency limits in operation. The priority semantics are documented in the sync crate's own public interface, which is how this pass confirmed the tier concept is real rather than only the type name. · Prior marker retained; footer re-dated to match the new stamp. -->

# P-2 — Sync priority tiers & concurrency limits

- **Status:** PENDING — **CORRECTION (2026-09-29, re-audited): the implementation HAS landed.** A 2026-07-22 audit already flagged this status as outdated; re-verified this round against current paths, since the symbols have moved out of the pre-restructure crate this card's history names. `SyncPriority` now lives in the cloud server's sync-store module and its Postgres variant; `default_priority` is in the core crate's offline module — the same file under the renamed crate; and the per-route concurrency limiter is still constructed in the server's main entry point at the line the earlier audit recorded. All four symbols that audit named are present. The card's PENDING line is the stale part, not the implementation.
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
- The `oz-cloud-server` (pre-rebrand name; `kasirmu-cloud` today) uses the default Tokio multi-threaded runtime (number of threads = number of CPU cores). There is no concurrency limit. A burst of sync pushes can OOM the server or starve API routes (product lookup, sale creation, health).
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
- [ ] `oz-cloud-server` compiled with `#[tokio::main(flavor = "multi_thread", worker_threads = 2)]` — **DIVERGED 2026-10-11, in a compatible direction: the runtime is built explicitly and the thread count is read from `OZ_WORKER_THREADS`, defaulting to 2 when unset or unparseable (`apps/cloud-server/src/main.rs:141-193`). The `worker_threads = 2` this criterion asks for is still the default; it is now overridable per deployment rather than compiled in.**
- [ ] Workspace `Cargo.toml` `tokio` dependency retains `rt-multi-thread` feature (not changed to `rt` — the 2-thread override happens at the binary level)

### Performance targets
- [ ] Under 50 concurrent sync pushes: API p50 response time < 100ms
- [ ] Under 50 concurrent sync pushes: API error rate = 0% (no 429s on API routes)
- [ ] Sync route 429 rate < 5% under normal load (bursts expected, normal operations unaffected)

## Plan

1. **Priority type**: Add `SyncPriority` enum to `crates/kasirmu-core/src/offline.rs` (or a new `sync.rs` module).  **Shipped there: `SyncPriority` lives at `crates/kasirmu-core/src/offline.rs` (derives `Serialize`/`Deserialize`/`PartialOrd`/`Ord`, `Critical=0`/`Normal=1`/`Low=2`), with `OfflineQueueItem::default_priority()` at `:22` and the `priority` field at `:84`.** Derive required traits. Add `priority` field to `OfflineQueueItem` struct.
2. **Migration**: Create `crates/kasirmu-core/migrations/XXX_offline_queue_priority.sql`  (crate is `kasirmu-core`, not `oz-core`; the column shipped in the consolidated `20260813_init.sql` as `priority INTEGER NOT NULL DEFAULT 1`): `ALTER TABLE offline_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 1;`. Register in `migrations.rs`. Update DDL in `018_offline_queue.sql` for new installs.  (The numbered scheme is gone — migrations were consolidated into `20260813_init.sql`.)
3. **Event handlers**: Update `platform/startup/src/event_handlers.rs`: enqueue `SaleCompleted` with `Critical`, inventory events with `Normal`, settings with `Low`.
4. **Batching**: Modify `build_batches()` in `platform/sync/src/lib.rs` to sort pending items by priority before the existing byte-size chunking loop.
5. **Server DDL**: Update `apps/cloud-server/src/db.rs` PG-compatible `CREATE TABLE` to include `priority INTEGER NOT NULL DEFAULT 1`.
6. **Concurrency limits**: Split Axum router in `apps/cloud-server/src/main.rs` into route groups. Apply `ConcurrencyLimitLayer::new(40)` to sync group, `ConcurrencyLimitLayer::new(10)` to API group. Use `tower::layer::layer_fn` to attach buffer tracking on sync group (10 MB limit via custom `BufferLayer` or existing `BackpressureLayer`).
7. **Runtime**: Add `#[tokio::main(flavor = "multi_thread", worker_threads = 2)]` attribute to `main()` in `apps/cloud-server/src/main.rs`.  **CORRECTION 2026-10-11: shipped as an explicit `tokio::runtime::Builder::new_multi_thread().worker_threads(n)` where `n` comes from `OZ_WORKER_THREADS` (default 2), not as the attribute shown.** No changes to workspace `Cargo.toml` needed — `rt-multi-thread` is already the default feature.

## Verification

| Check | Expected |
|-------|----------|
| `cargo build -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests` | exit 0 — **`oz-cloud-server` is a pre-rebrand name; it is `kasirmu-cloud` today** |
| `cargo clippy -p oz-cloud-server -p platform-sync -p platform-startup --lib --tests -- -D warnings` | 0 warnings — **same name note** |
| `cargo test -p platform-startup` | all passing (event handler tests) |
| `cargo test -p oz-core --test offline_integration` | all passing (priority column) — **`oz-core` is a pre-rebrand name; use `kasirmu-core`** |
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
- `crates/kasirmu-core/src/offline.rs`
- `crates/kasirmu-core/migrations/20260813_init.sql`
- `platform/startup/src/event_handlers.rs`
- `apps/cloud-server/src/main.rs`
- `apps/cloud-server/src/sync_api.rs`

> last audited 11-10-26 by docs-auditor
