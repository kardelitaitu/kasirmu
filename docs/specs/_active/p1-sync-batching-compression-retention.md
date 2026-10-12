<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (2 major, 6 minor) · Fresh full audit; the 2026-09-29 stamp and the 2026-07-22 Hermes marker below are merged as original evidence. · MAJOR 1 (a shipped step was REVERTED and the card still instructs a reader to do it): Plan step 3 says to add `CompressionLayer::new().gzip(true).quality(6)` to the Axum router, and an acceptance criterion requires the server to compress responses. **That layer was removed** — `apps/cloud-server/src/main.rs:990-991` records "gzip compression is handled by Caddy … The Rust CompressionLayer was removed to save ~0.01 core CPU", and `ops/gateway/Caddyfile.example:26,37` carries `encode gzip`. Responses are still compressed on the wire; the code that does it is no longer in this repository. A reader implementing this card literally would re-add a layer that was deliberately deleted for a measured CPU saving. Both the criterion and the plan step now say so. · MAJOR 2 (retention design diverged from what the criteria promise): the card specifies a disk-pressure-gated loop — "if disk ≥ 90%" — plus `PRAGMA auto_vacuum = INCREMENTAL` on two tables. **What shipped is an unconditional hourly 90-day aging policy with no disk check and no `auto_vacuum` anywhere**: `grep -c auto_vacuum crates/kasirmu-core/migrations/20260813_init.sql` → 0, the only vacuum call is the opportunistic `PRAGMA incremental_vacuum(50);` inside the prune batch loop, and `apps/cloud-server/src/prune.rs` declares `RETENTION_DAYS = 90` / `PRUNE_BATCH_SIZE = 500` with no disk branch. The guard the card wanted — "data < 90 days is never deleted, regardless of disk pressure" — is therefore satisfied vacuously, because nothing deletes on disk pressure at all. Recorded on each affected criterion rather than by rewriting them. · MINOR 1 (the 2026-08-08 note itself carries dead coordinates, including one that never existed): it cites migration `072_stock_movements_archive.sql`. **No such file exists** — migrations are timestamp-named and consolidated; the archive table is created in `crates/kasirmu-core/migrations/20260813_init.sql:725` with its indexes at `:1277-1281`. It also cites server gzip at `main.rs:374`, which is the removed layer. A correction block is appended under the note. · MINOR 2-3 (pre-rebrand crate paths in the Plan): steps 6-7 create migrations under `crates/oz-core/`, which does not exist — the crate is `kasirmu-core`. · MINOR 4 (the ledger helpers moved and were split): the card says to add `archive_stock_movements` to `crates/kasirmu-core/src/db/products.rs`. That file was split; the shipped home is `crates/kasirmu-core/src/db/products_stock_adjust/` — `archive_stock_movements` at `movements.rs:65`, `get_stock_from_ledger` at `ledger.rs:22`, `rebuild_stock_summary` at `ledger.rs:73`. Plan step 8 and the References list corrected. · MINOR 5 (stale package names in runnable blocks): `oz-cloud-server` and `oz-core` in the Verification table. · MINOR 6: the References list named `20260813_init.sql` twice; de-duplicated. · VERIFIED AND LEFT ALONE, because the card's core is real: `build_batches()` is live at `platform/sync/src/lib.rs:162` with all six unit tests the criteria imply (`lib_tests.rs:17-84`, including `build_batches_respects_byte_limit` and `build_batches_sorts_by_priority`); the client `reqwest` `.gzip(true)` is live at `platform/sync/src/transport.rs:336`; the exponential-full-jitter backoff is implemented exactly as the criterion states (`daemon.rs:55-62`, `rand(0, min(60_000, 2_000 * 2^failures))`, with the comment naming this spec); `archive_stock_movements` and `start_prune_loop` both exist and are wired; and `AnchorExpired`/snapshot handling landed (110 references repo-wide). · NOT re-measured: the performance targets (p95 < 2 s, RSS bounds, compression ratio) — those need a load run, and the card already presents them as targets rather than results. · Prior marker retained; footer re-dated. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence (delimiters stripped so they cannot nest):

**STAMP MERGED INTO THIS ONE (2026-10-11)** — superseded bodies kept verbatim as original evidence:

Superseded audit marker (2026-07-22, body kept verbatim) · Hermes-Agent · status: STALE (1 finding — status outdated) · Finding: card is marked "PENDING" but the implementation has LANDed. Verified: build_batches() at platform/sync/src/lib.rs:759 with byte-limit + priority-sort tests (build_batches_respects_byte_limit line 141, build_batches_sorts_by_priority line 165); client compression reqwest .gzip(true) at transport.rs:118 + server CompressionLayer::new().gzip(true) at apps/cloud-server/src/main.rs:368; archive_stock_movements + stock_movements_archive migration + apps/cloud-server/src/prune.rs::start_prune_loop + daemon.rs backoff (all present, verified via ADR #6 audit). Status "PENDING" understates reality — only residual items (snapshot endpoint, configurable retention window, possibly the exact incremental_vacuum cadence) remain. Baseline file references accurate.

Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, with a prior marker re-verified rather than replaced — and here the prior marker and the document are in agreement, which is worth saying because the two siblings in this series are not. · THE PRIOR MARKER SAYS STALE AND THE DOCUMENT HAS SINCE BEEN FIXED, which is the good version of that finding. The 2026-07-22 audit found the card's status line outdated; a 2026-08-08 documentation audit then corrected it in place, recording that it verified the batching function in the sync crate rather than assuming. The chain is: a finding was raised, it was correct, and someone acted on it. That is the audit loop working end to end, and it is the first time this campaign has seen a stale-stamp finding CLOSED rather than merely recorded. · THE STATUS NOW VERIFIES AGAIN, at the coordinate the correction names: the batching function is present in the sync crate. Phase 1 of the three-phase strategy therefore has its core landed, with residual items the card itself lists — a card that names its own residue is doing the hard part of a status line honestly. · THE P-SERIES FRAMING, shared across all three phases and worth stating once: this is a three-phase sync performance strategy, and the phases are ordered by dependency rather than convenience. Batching, compression, backoff and retention come first because priority tiers and concurrency limits are meaningless without them — you cannot decide what to send first if you have not decided how items are batched or how failures back off. A reader arriving at any single card out of order will misjudge why the others exist, which is why this stamp names the parent. · NOT re-measured: the batching function's behaviour, the compression ratio, the backoff schedule, or the retention window. Those are the document's own content and are the original work. What is established is that the status line describing them is current. · Prior marker retained; footer re-dated to match the new stamp.

-->
# P-1 — Sync batching, compression, backoff & retention

- **Status:** DONE (core implementation landed; residual items below)
- **Audit note (2026-08-08 by docs-auditor):** status corrected from PENDING — verified `build_batches()` in `platform/sync/src/lib.rs`, gzip client (`transport.rs:231`) + server (`main.rs:374`), `apps/cloud-server/src/prune.rs`, migration `072_stock_movements_archive.sql`, and `AnchorExpired` handling in `lib.rs`. Residual: snapshot endpoint (Phase 3), configurable retention window, exact `incremental_vacuum` cadence.
- **Correction (2026-10-11 by docs-auditor):** three coordinates in the note above are stale. (a) **There is no migration `072_stock_movements_archive.sql`** — the migration set is timestamp-named and was consolidated; `stock_movements_archive` is created in `crates/kasirmu-core/migrations/20260813_init.sql` (:725 CREATE, :1277-1281 indexes-omitted archive config). (b) **The server-side gzip layer no longer exists**: `apps/cloud-server/src/main.rs:990-991` records that the Rust `CompressionLayer` was removed and gzip is handled by Caddy (`ops/gateway/Caddyfile.example:26,37` `encode gzip`). The client `.gzip(true)` remains (`platform/sync/src/transport.rs:336`). (c) `build_batches()` and `compute_backoff()` are both live (`lib.rs:162`, `daemon.rs:59`).
- **Phase:** 1 of 3 (Sync Performance Strategy — ADR #10)
- **Parent:** `docs/decisions/2026-07-13-sync-performance-compression-batching.md`
- **Severity:** HIGH
- **Owner:** TBD
- **Est. effort:** 2-3 weeks

## Summary

Eliminate OOM risk on low-end terminals and reduce bandwidth cost by (1) splitting sync payloads into adaptive 64 KB batches, (2) compressing responses with Gzip, (3) applying capped exponential backoff with full-jitter on failures, (4) pruning the `offline_queue` after 90 days with incremental vacuum, and (5) archiving `stock_movements` ledger rows older than 90 days via rollup consolidation to keep live `SUM(delta)` queries fast on low-end hardware.

## Baseline (pre-fix)

- `platform/sync/src/lib.rs`: `SyncEngine::run_sync_cycle()` sends **all** pending items in a single `transport.push_items()` call. A terminal with 500 pending items pushes ~3 MB of JSON in one HTTP request.
- `platform/sync/src/transport.rs`: `reqwest::Client` has no `.gzip(true)`. No compression headers. JSON payloads are sent and received uncompressed.
- `platform/sync/src/daemon.rs`: `SyncDaemon` sleeps a fixed random range (60-120s) on each cycle. No exponential backoff. The `retry_count` field is incremented on failure but **never read**.
- `crates/kasirmu-core/migrations/20260813_init.sql`: No `PRAGMA auto_vacuum`. Synced and failed items accumulate indefinitely. There is no cleanup mechanism.
- `crates/kasirmu-core/migrations/20260813_init.sql`: No archive table, no pruning mechanism. The `stock_movements` delta ledger grows unbounded — a busy store doing 500 transactions/day accumulates ~180K rows/year per product. With 50 products, that's 9M rows/year, degrading `SUM(delta)` query performance on low-end Android 9 tablets.

## Acceptance criteria

### Batching
- [ ] `build_batches()` produces chunks ≤ 64 KB serialized JSON each
- [ ] Minimum 1 item per batch (no empty requests)
- [ ] Batches are sent **sequentially** — batch N+1 waits for batch N's response
- [ ] Each batch commits independently via `rusqlite` transaction
- [ ] Server detects batched vs legacy push: array-of-arrays = batched, flat array = legacy
- [ ] Server-side push endpoint accepts both formats and returns per-item outcomes

### Compression
- [ ] `tower-http` enabled with `compression-gzip` feature (not `compression-full`) — **MET at the workspace level (`Cargo.toml:127`), but no longer used by the edge server** — see the note on the next line
- [ ] Server compresses push/pull responses with Gzip level 6 — **SUPERSEDED 2026-10-11: the Rust `CompressionLayer` was REMOVED (`apps/cloud-server/src/main.rs:990-991`, "removed to save ~0.01 core CPU") and gzip is now terminated by the Caddy gateway (`ops/gateway/Caddyfile.example:26,37`). Responses are still gzipped on the wire; the layer that does it is no longer in this codebase.**
- [ ] `reqwest::ClientBuilder` in `transport.rs` configured with `.gzip(true)`
- [ ] Client advertises `Accept-Encoding: gzip`
- [ ] Client request bodies are NOT re-compressed (≤ 64 KB batches make compression overhead not worth it)

### Backoff
- [ ] Exponential backoff formula: `sleep_ms = rand(0, min(60_000, 2_000 * 2^retries))`
- [ ] `retry_count` field drives the delay. Reset to 0 after a successful sync cycle
- [ ] On-event syncs (manual, sale completed) bypass backoff entirely

### Retention (`offline_queue`)
- [ ] `offline_queue` table DDL updated with `PRAGMA auto_vacuum = INCREMENTAL;` (new migration) — **NOT SHIPPED 2026-10-11: `auto_vacuum` appears nowhere in the schema (`grep -c auto_vacuum crates/kasirmu-core/migrations/20260813_init.sql` → 0); the only vacuum call site is the opportunistic `PRAGMA incremental_vacuum(50);` inside the prune loop (`apps/cloud-server/src/prune.rs`)**
- [ ] Existing production databases altered with `PRAGMA auto_vacuum = 2;` — **NOT SHIPPED, same reason**
- [ ] Hourly background task checks disk usage — **DIVERGED 2026-10-11: the hourly task prunes UNCONDITIONALLY on the 90-day horizon (`apps/cloud-server/src/prune.rs`, `RETENTION_DAYS = 90`, `PRUNE_BATCH_SIZE = 500`) and does not read disk usage. The disk-pressure trigger was dropped; what the criteria below describe as a 90%-gated loop is the plain 90-day aging policy.**
- [ ] If disk ≥ 90%: cursor-based loop `SELECT id … ORDER BY id LIMIT 500`, `DELETE WHERE id IN (?)`, `PRAGMA incremental_vacuum(50)`
- [ ] Loop repeats until disk < 85% or no more rows ≥ 90 days old
- [ ] Data < 90 days is never deleted, regardless of disk pressure
- [ ] Server response for pull with pruned `since` timestamp: returns `AnchorExpired` error (includes `oldest_available` timestamp for client)
- [ ] Client catches `AnchorExpired`, logs warning with `oldest_available`, and retries on next sync cycle. A full base sync is not attempted in this phase — the snapshot endpoint (Phase 3) will provide that capability.

### Ledger Retention (`stock_movements`)

**Design:** Archive-rollup consolidation. Instead of soft-deleting rows (which bloats the live table and degrades `SUM(delta)` performance), rows older than 90 days are:

1. Copied to `stock_movements_archive` for audit compliance (preserved for 3+ years).
2. Replaced in the live `stock_movements` table by a single **rollup row** per product — `SUM(delta)` of all archived rows, with `reason: 'archive-rollup'`.
3. Deleted from the live table.

This works because the CRDT delta ledger is mathematically additive: `SUM(delta)` across all rows (live + archive) equals `SUM(delta)` across the live table alone (since the rollup row consolidates the archived deltas). Zero code changes needed in `get_stock_from_ledger()` or `rebuild_stock_summary()` — they just run `SELECT SUM(delta) FROM stock_movements WHERE item_id = ?` and get the correct answer.

Audit queries for date ranges older than 90 days use `UNION ALL SELECT … FROM stock_movements_archive`.

- [ ] New migration creates `stock_movements_archive` table (identical schema to `stock_movements`, no indexes needed — archive is append-only, queried infrequently)
- [ ] New migration adds `PRAGMA auto_vacuum = INCREMENTAL;` to the `stock_movements` DDL — **NOT SHIPPED (see above)**
- [ ] Pruning runs in the same hourly background task as `offline_queue` pruning
- [ ] Pruning logic (one transaction per item_id group):
  1. `INSERT INTO stock_movements_archive SELECT * FROM stock_movements WHERE item_id = ? AND created_at < ? AND reason != 'archive-rollup'` (copy old rows to archive, skipping previous rollup rows)
  2. `INSERT INTO stock_movements (id, item_id, delta, reason, store_id, created_at) VALUES (uuid_v7(), ?, SUM(delta), 'archive-rollup', ?, ?)` (consolidate into one rollup row — `SUM(delta)` is computed from the rows about to be deleted)
  3. `DELETE FROM stock_movements WHERE item_id = ? AND created_at < ? AND reason != 'archive-rollup'` (remove old rows from live table, preserving the rollup)
- [ ] Rollup rows are never themselves archived (identified by `reason = 'archive-rollup'` — the pruning cursor stops at the oldest rollup row)
- [ ] `PRAGMA incremental_vacuum(50)` runs after each item group commit
- [ ] Data < 90 days is never archived, regardless of disk pressure
- [ ] `get_stock_from_ledger()` and `rebuild_stock_summary()` require **zero code changes** — the rollup row makes the math work transparently
- [ ] `list_stock_movements()` requires **zero code changes** but is intentionally scoped to the live table only. Individual historical movement rows (sales, restocks) older than 90 days live in `stock_movements_archive`. A future "Inventory Audit Log" API will UNION live + archive for date-range queries. The truncation is by design — no changes needed in this phase.
- [ ] Rollup rows are identified by `reason = 'archive-rollup'` and excluded from future archiving via `WHERE reason != 'archive-rollup'` in the archive SELECT
- [ ] First run or catch-up run: process at most 50 item_id groups per cycle. Subsequent cycles pick up remaining groups. This keeps each cycle's runtime bounded regardless of backlog size. Idempotent — already-archived groups are skipped.
- [ ] `PRAGMA incremental_vacuum(50)` runs **once** after all item_id groups in the cycle are committed (not after each group), to avoid excessive I/O

**Sizing example:** A store with 50 products, 500 transactions/day, 90-day window:
- Live table: 50 rollup rows + ~90 days of deltas = ~45K rows per product max = ~2.25M rows total
- Archive table: grows at ~180K rows/year/product × 50 products = 9M rows/year (acceptable for infrequent audit queries)

### Performance targets
- [ ] p95 sync time for 50 items on simulated cellular (200ms RTT): < 2 seconds
- [ ] Server RSS memory under load (100 concurrent syncs): < 100 MB
- [ ] Client RSS memory with 500 pending items: no increase over baseline
- [ ] Compression ratio on pull responses: ≥ 40% size reduction

## Plan

1. **Batching**: Add `build_batches()` to `platform/sync/src/lib.rs`. Modify `run_sync_cycle()` to iterate over batches sequentially. Update `SyncError` types if needed. Update `transport.rs` `push_items()` to accept `&[OfflineQueueItem]` (already does — no signature change needed).
2. **Server batch detection**: In `apps/cloud-server/src/sync_api.rs`, wrap push handler to inspect JSON root: array-of-arrays → process each batch independently; flat array → legacy path.
3. **Compression — server**: Add `compression-gzip` to `tower-http` feature list in workspace `Cargo.toml`. Add `.layer(CompressionLayer::new().gzip(true).quality(6))` to Axum router in `apps/cloud-server/src/main.rs`.  **CORRECTION 2026-10-11: this step landed and was then reverted — the layer was removed from the Axum router and compression moved to Caddy. Do not re-add it without checking `apps/cloud-server/src/main.rs:990`.**
4. **Compression — client**: Add `.gzip(true)` to `reqwest::ClientBuilder` in `platform/sync/src/transport.rs`.
5. **Backoff**: Modify `platform/sync/src/daemon.rs` `run()` loop to track failure count, apply exponential backoff formula, reset on success. Keep existing on-event trigger path that bypasses backoff.
6. **Retention migration — `offline_queue`**: Create `crates/kasirmu-core/migrations/XXX_offline_queue_autovacuum.sql` — **crate is `kasirmu-core`, not `oz-core`; the XXX-numbered form is also obsolete, migrations are timestamp-named and consolidated into `20260813_init.sql`** enabling `PRAGMA auto_vacuum = INCREMENTAL;`. Register in `migrations.rs`.
7. **Ledger retention migration — `stock_movements`**: Create `crates/kasirmu-core/migrations/XXX_stock_movements_archive.sql` — **same two corrections** creating the `stock_movements_archive` table (identical schema to `stock_movements`). Enable `PRAGMA auto_vacuum = INCREMENTAL;` on `stock_movements`. Register in `migrations.rs`. Update the `20260813_init.sql` base DDL for new installs (migrations consolidated 2026-08-14, commit `db6198a3`).
8. **Ledger archiving logic**: Add `archive_stock_movements(conn, older_than_days: i64)` function to `crates/kasirmu-core/src/db/products_stock_adjust/movements.rs` — **the shipped home; `db/products.rs` was split and the ledger helpers moved into a `products_stock_adjust/` module (`movements.rs:65`, with `ledger.rs` and `batch.rs` alongside)** Implements the per-item_id archive-rollup transaction loop described in the acceptance criteria. Returns the number of item groups archived.
9. **Pruning background task**: Add a new file `apps/cloud-server/src/prune.rs` with a `start_prune_loop(db: Arc<tokio::sync::Mutex<rusqlite::Connection>>)` function that runs on `tokio::time::interval(Duration::from_secs(3600))`. Implements the cursor-based DELETE loop for `offline_queue` + calls `archive_stock_movements()` for the ledger. Spawn this task in `main.rs` after the Axum server starts.
   - **Client-side pruning** (`stock_movements` only): Spawn a `tokio::task` in `platform/sync/src/daemon.rs` alongside `SyncDaemon::start()`. The task sleeps for 60-120s (same randomized interval as the daemon) and calls `archive_stock_movements()` on the local DB connection. This keeps the implementation co-located with the sync lifecycle. The client does NOT prune `offline_queue` — that's cloud-server only.
10. **AnchorExpired error**: Define `SyncErrorCode::AnchorExpired` variant in shared crate with `oldest_available: Option<DateTime<Utc>>` field. Return from pull handler when `since` < oldest retained row. On the client side, add catch logic in `run_sync_cycle()` that logs a warning and returns early, so the next scheduled cycle retries naturally.

## Verification

| Check | Expected |
|-------|----------|
| `cargo build -p platform-sync -p oz-cloud-server --lib --tests` | exit 0 — **NOTE: `oz-cloud-server` is a pre-rebrand package name; it is `kasirmu-cloud` today** |
| `cargo clippy -p platform-sync -p oz-cloud-server --lib --tests -- -D warnings` | 0 warnings |
| `cargo test -p platform-sync` | all passing |
| `cargo test -p oz-cloud-server` | all passing |
| `cargo test -p oz-core -- products` | all passing (stock_movements tests intact, archive function tested) — **`oz-core` is a pre-rebrand name; use `kasirmu-core`** |
| Manual: 500 fake pending items, measure RSS before/after | No increase |
| Manual: `curl -v -H "Accept-Encoding: gzip" …` | Response has `Content-Encoding: gzip` |
| Manual: populate offline_queue with 1000 items, set 90% disk threshold | Items > 90 days deleted, vacuum runs |
| Manual: populate stock_movements with 5000 rows across 10 products, set `created_at` to 120 days ago, run `archive_stock_movements()` | One rollup row per product in live table, old rows in archive, `SUM(delta)` unchanged |

## Residual / follow-ups

- **Client pull endpoint**: This phase does not add pull pagination. Pull responses may still be large for terminals offline > 30 days. Phase 3 addresses this with cursor-based pagination.
- **Tiered heartbeat**: The existing random 60-120s daemon interval is kept as-is. Phase 3 introduces server-driven tiered heartbeat.
- **Priority tiers**: All items pushed in arrival order. Phase 2 adds priority-based reordering.
- **Concurrency limits**: No per-route-group limits in this phase. Phase 2 adds them.
- **Snapshot endpoint**: Not included. Phase 3 adds it.
- **Audit history UI**: The `stock_movements_archive` table enables a future "Inventory Audit Log" screen that queries `stock_movements UNION ALL stock_movements_archive` for date-range browsing. Not in this phase — just the storage infrastructure.
- **Configurable retention window**: The 90-day window is hardcoded. A future settings screen could expose this as a configurable value (with a minimum of 30 days to prevent accidental data loss).

## References

- `docs/decisions/2026-07-13-sync-performance-compression-batching.md`
- `docs/decisions/2026-07-10-crdt-delta-ledger-offline-sync.md` (ADR #6 — delta ledger design, open question #4)
- `platform/sync/src/lib.rs`
- `platform/sync/src/transport.rs`
- `platform/sync/src/daemon.rs`
- `apps/cloud-server/src/sync_api.rs`
- `apps/cloud-server/src/main.rs`
- `crates/kasirmu-core/migrations/20260813_init.sql` (cited twice in the original — de-duplicated 2026-10-11)
- `crates/kasirmu-core/src/db/products_stock_adjust/` — the shipped home of these helpers (`adjust_stock_with_reason` in `batch.rs`, `get_stock_from_ledger`/`rebuild_stock_summary`(_for) in `ledger.rs`, `list_stock_movements`/`archive_stock_movements` in `movements.rs`). **Previously cited as `crates/kasirmu-core/src/db/products.rs`, which was split.**

---

> last audited 11-10-26 by docs-auditor
