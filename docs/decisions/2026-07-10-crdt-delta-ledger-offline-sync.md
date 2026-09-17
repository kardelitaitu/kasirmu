---
num: 6
area: sync
title: ADR #6: CRDT Delta Ledger & Offline Sync
status: Implemented (2026-07-15)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · all implementation claims verified: stock_movements migration exists; adjust_stock_with_reason (products.rs:1165), get_stock_from_ledger (1250), rebuild_stock_summary (1290), list_stock_movements (1359), archive_stock_movements (1405) all present; platform/sync/src/daemon.rs (start_prune_task) + apps/cloud-server/src/prune.rs (start_prune_loop) exist; ui/src/components/FastPINOverlay.tsx + crates/oz-security/src/terminal.rs present; platform/sync/tests/integration_test.rs present; Uuid::now_v7() adopted + oz_core::new_id() (lib.rs:147) confirmed; stock_movements_archive (migration 072) + stock_summary cache match · Status "Implemented (2026-07-15)" consistent -->

# ADR #6: CRDT Delta Ledger & Offline Sync

**Status:** Implemented (2026-07-15)
**Date:** 2026-07-10
**Updated:** 2026-07-15 (all phases complete — Q1-Q4 resolved, daemon wiring shipped)
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** crdt, offline, sync, inventory, uuidv7, ulid, concurrency

---

## Context

ADR #4 establishes the **Store-First Tenancy & Workspace Type/Instance Architecture**, enabling multiple POS registers per store and multiple stores per tenant. In multi-register environments, offline connectivity must not cause ID collisions, inventory race conditions, or cross-register data overwrites. This ADR defines the offline-safe data layer that supports concurrent registers operating without a live cloud connection.

This ADR is intentionally separate from ADR #4 because the CRDT delta ledger is a major data-model change that deserves its own design and implementation cycle.

### Relationship to Store-Scoped Databases

ADR #4 stores each store's data in a separate SQLite file. Within a single store, all registers share the same database file — so **within-store** conflicts are handled by SQLite's own locking. **Cross-store** sync (e.g., inventory transfer between Store A and Store B, or chain-wide reporting) goes through the cloud sync layer (`platform/sync/`). The CRDT delta ledger model applies to both scopes:

- **Within a store:** Multiple registers writing to the same `stock_movements` table in the same SQLite file — SQLite's WAL mode handles concurrent writers. UUIDv7 primary keys prevent ID collisions.
- **Across stores:** Each store's `stock_movements` deltas are synced to the cloud and merged deterministically without `last-write-wins` data loss.

---

## Decision

### 1. Time-Ordered UUIDv7 / ULID Primary Keys

All entity primary keys (`orders`, `order_lines`, `payments`, `stock_transfers`, `stock_movements`) use time-ordered **UUIDv7 / ULID** keys (`01F8MECH...`), eliminating ID collisions when multiple registers operate offline locally. This applies both within a single store database (multiple terminals) and across stores (globally unique IDs for sync).

### 2. CRDT Delta Ledger for Inventory

Offline registers never overwrite absolute `quantity` columns directly (`last-write-wins`). They only insert immutable delta ledger rows into `stock_movements` (`+5` or `-2`). When registers reconnect and sync, deltas sum up deterministically with zero race conditions or missing stock.

```sql
CREATE TABLE stock_movements (
    id                  TEXT PRIMARY KEY,  -- UUIDv7
    store_id            TEXT NOT NULL,     -- Boot-time validation: must match the database's owning store.
                                           -- Redundant in store-scoped DBs (the DB file IS the scope),
                                           -- but serves as a sanity check and sync routing key.
    item_id             TEXT NOT NULL,
    delta               INTEGER NOT NULL,  -- +N or -N
    reason              TEXT,
    created_at          TEXT NOT NULL,
    source_terminal_id  TEXT,                    -- nullable (rollup rows have no source terminal)
);
```

Current stock quantity is computed as:

```sql
-- Within a store database, store_id filtering is implicit (all rows belong to this store)
SELECT SUM(delta) FROM stock_movements WHERE item_id = ?;
```

For performance, maintain a materialized `stock_summary` table or in-memory cache that is invalidated on each sync and rebuilt from the delta ledger. This avoids aggregating the full history on every inventory lookup.

**Cross-store sync:** When deltas are synced to the cloud, the `store_id` column serves as a routing key — the cloud knows which store's inventory the delta belongs to. During cross-store transfers (e.g., Store A ships 10 units to Store B), Store A inserts a `-10` delta, Store B receives a `+10` delta via sync.

### 3. Terminal Keyring Binding

Every POS hardware device holds a cryptographic profile (`terminal_id` bound via OS keyring, `oz-security::Keyring`). Sessions require the full scope validation:

```
(user_id + terminal_id + store_id + instance_id)
```

The `store_id` is included per ADR #4's `SessionContext` — it is resolved during session creation and never changes for the lifetime of the session. Terminal binding ensures that sync deltas (`source_terminal_id`) are traceable to a specific device at a specific store.

ADR #4's Security Architecture adds an HMAC signature on device bindings. The terminal keyring binding described here works in tandem: the OS keyring stores the terminal's identity, while the HMAC signature prevents tampering with the binding in the global database.

### 4. Shared Touchscreen Fast-Switching (`FastPINOverlay.tsx`)

To prevent session hijacking on shared touchscreens without slowing service down, the frontend overlays a **Quick Staff PIN Pad (`FastPINOverlay.tsx`)**. Upon PIN verification, the backend issues a **new session token** with the new user's resolved scope, while keeping `terminal_id` and `instance_id` invariant (the device doesn't change, only the operator does).

This aligns with ADR #4's Security Architecture (Section 4): user switching always triggers token invalidation and re-resolution. The old session token is removed from the backend's `SessionStore`, and a new opaque token is issued. This ensures:

- Perfect audit logs per operator (every order, stock movement, and payment is tagged with the correct `user_id`)
- Cash drawer accountability (the session's `user_id` is bound to cash operations)
- No stale scope leakage (the new token carries the new user's `user_store_access` and `user_workspace_instances`)

The `terminal_id` and `instance_id` remain invariant through the switch because the physical device and its assigned workspace don't change — only the operator does.

### 5. Immutable Transaction Clock

Every record tracks `version INTEGER` and `updated_at TEXT` so when offline registers reconnect to each other or `cloud-server`, optimistic concurrency checks prevent ghost overwrites.

### 6. Orphan Prevention

All foreign keys to `store_profiles` in the **global database** explicitly enforce `ON DELETE RESTRICT ON UPDATE CASCADE`, making it impossible to delete a location while it has active registers, open shifts, or historical transactions. In per-store databases, `store_id` columns are logical references (no FK constraint — see ADR #4's schema), validated at boot time rather than enforced by the database engine. The global database is the authoritative source for store existence; per-store databases trust it.

---

## Consequences

### Positive

- No ID collisions across offline registers (UUIDv7/ULID).
- Inventory deltas merge deterministically without last-write-wins data loss.
- Terminal binding prevents session spoofing.
- Optimistic concurrency prevents ghost overwrites.
- Cross-store inventory transfers are mediated by the CRDT model — no double-counting.

### Negative

- Requires migrating existing auto-increment IDs to UUIDv7 (completed — all 158 call sites migrated).
- Inventory queries must aggregate `stock_movements` instead of reading a single `quantity` column (mitigated: `stock_summary` materialized cache avoids scanning full history).
- Stock corrections and adjustments must be modeled as delta rows (a correction is a compensating delta, e.g., `+3` if the actual count is 3 higher than the computed sum).
- Sync protocol between registers and cloud-server must handle both within-store (same DB, SQLite WAL) and cross-store (different DBs, cloud-mediated) sync correctly (implemented and tested — 19 integration tests).
- The materialized `stock_summary` cache must be invalidated on every sync and rebuilt — this is a performance consideration for high-volume stores.
- The `stock_movements` ledger grows unbounded without pruning (implemented: archive-rollup consolidation via migration 072, daemon wiring complete — client-side 60-120s, server-side hourly).

---

## Open Questions

### ✅ Q1: UUIDv7 or ULID? — RESOLVED (2026-07-11)

**Decision:** UUIDv7. All 158 `Uuid::new_v4()` call sites replaced with `Uuid::now_v7()` across the workspace. UUIDv7 was chosen over ULID because:
- Native support in SQLite (stored as TEXT, sorts correctly since v7 is time-ordered by design)
- No dependency on a separate ULID crate
- Same 128-bit collision resistance and time-ordering guarantees
- The `uuid` crate's `v7` feature is already a workspace dependency

### ✅ Q2: Stock corrections — compensating delta or admin override? — RESOLVED (2026-07-13)

**Decision:** Compensating deltas with built-in audit trail. The code has only one write path:

- `adjust_stock_with_reason(sku, delta, reason, terminal_id, user_id)` — writes an immutable delta row to `stock_movements`
- There is **no single-product** method that directly sets `inventory.qty` — all writes go through the delta ledger (the only bulk write to `inventory` is `rebuild_stock_summary()`, which computes `SUM(delta)` from the ledger)
- `rebuild_stock_summary()` is the only bulk write to `inventory`, and it computes `SUM(delta)` from the ledger

A correction workflow:
1. Auditor counts physical stock → 53 units
2. System computes `SUM(delta)` from ledger → 50 units
3. Insert a `+3` delta with `reason: "correction-cycle-2026-07"` and audit terminal/user IDs

The audit fields (`source_terminal_id`, `source_user_id`, `reason`) are already populated from session context. A future admin UI would call the same `adjust_stock_with_reason` with `reason: "correction"` — no new code path needed.

### ✅ Q3: Sync protocol — within-store vs cross-store? — RESOLVED (2026-07-11)

**Decision:** Two distinct mechanisms, both implemented and tested.

**Within a store (shared SQLite):**
- Multiple registers write to the same `stock_movements` table in the same SQLite file
- SQLite WAL mode handles concurrent writers
- UUIDv7 primary keys prevent ID collisions
- No sync needed — all registers see the same data immediately

**Across stores (cloud-mediated):**
- `platform/sync/` crate implements a push/pull protocol via HTTP to the cloud server
- Push: `SyncDaemon` reads pending items from `offline_queue`, sends via `SyncTransport::push_items()`
- Pull: `SyncTransport::pull_updates(None)` fetches remote items
- Apply: `SyncQueue::apply_remote()` dispatches by action type — `complete_sale` deducts stock, `stock.adjusted` adjusts stock, `product.created` creates product, `stock.movement` inserts raw ledger delta
- Reconcile: After pull, `rebuild_stock_summary()` recomputes `stock_summary` + `inventory` from `SUM(delta)`
- The `store_id` column on `stock_movements` acts as a routing key for cross-store transfers

19 integration tests in `platform/sync/tests/integration_test.rs` cover push, pull, conflict resolution, cross-terminal product replication, stock adjustment replication, and 100-item throughput.

### ✅ Q4: Delta pruning without losing audit history? — RESOLVED (2026-07-15)

**Decision:** Archive-rollup consolidation. Specified in `docs/specs/_active/p1-sync-batching-compression-retention.md` (Ledger Retention section).

**Design:** Rows older than 90 days are:
1. Copied to `stock_movements_archive` for audit compliance (preserved for 3+ years)
2. Replaced in the live `stock_movements` table by a single **rollup row** per product — `SUM(delta)` of all archived rows, with `reason: 'archive-rollup'`
3. Deleted from the live table

This works because the CRDT delta ledger is mathematically additive: `SUM(delta)` across live + archive equals `SUM(delta)` across the live table alone (the rollup row consolidates archived deltas). **Zero code changes** needed in `get_stock_from_ledger()`, `rebuild_stock_summary()`, or `list_stock_movements()`.

**Implementation plan (P-1 Phase):**
1. **Migration**: Create `stock_movements_archive` table (identical schema, no indexes — append-only, infrequently queried). Enable `PRAGMA auto_vacuum = INCREMENTAL` on `stock_movements`.
2. **Core function**: `archive_stock_movements(conn, older_than_days: i64)` in `crates/oz-core/src/db/products.rs`. Per-item_id transaction: `INSERT INTO archive SELECT … WHERE reason != 'archive-rollup'` → insert rollup row → `DELETE WHERE reason != 'archive-rollup'` → commit. Cap: 50 item groups per cycle.
3. **Background task**: Server-side in `apps/cloud-server/src/prune.rs` (hourly interval). Client-side spawned alongside `SyncDaemon` in `platform/sync/src/daemon.rs` (60-120s interval).
4. **Sizing**: Live table stays at ~45K rows/product max for 90-day window. Archive grows at ~9M rows/year for 50 products — acceptable for infrequent audit queries.

See `docs/specs/_active/p1-sync-batching-compression-retention.md` for full acceptance criteria.

---

## Implementation Checklist

### Phase 1: Stock Movements Delta Ledger (Done 2026-07-10)

- [x] Create `stock_movements` delta ledger table and `stock_summary` materialized cache (migration 063).
- [x] Register migration in `crates/oz-core/src/migrations.rs`.
- [x] Add `StockMovement` Rust struct with id, item_id, delta, reason, source_terminal_id, source_user_id, created_at.
- [x] Refactor `adjust_stock` → `adjust_stock_with_reason(sku, delta, reason)`: writes delta row to ledger + updates `inventory` + `stock_summary` in one transaction.
- [x] `create_product` writes initial stock to ledger (`reason: 'initial-stock'`).
- [x] `get_stock_from_ledger(product_id)` — computes `SUM(delta)` from ledger; falls back to `inventory.qty` if no rows.
- [x] `list_stock_movements(product_id, limit, offset)` — paginated ledger query for audit/sync.
- [x] 7 new tests: table existence, ledger writes, SUM computation, pagination, stock_summary tracking, creation ledger.
- [x] `cargo check` ✅, `cargo test -p oz-core -- products` ✅ (67/67), `cargo fmt` ✅.

### Phase 2 (Done 2026-07-11)

- [x] Choose and adopt UUIDv7 for all entity primary keys — replaced all 158 `Uuid::new_v4()` call sites with `Uuid::now_v7()` across the entire workspace. Added `v7` feature to workspace `uuid` dependency. Added `oz_core::new_id()` helper for future entity ID generation.
- [x] Implement materialized `stock_summary` cache rebuild from deltas — `rebuild_stock_summary()` method recomputes both `stock_summary` and `inventory` tables from `SUM(delta)` in a single transaction. Sync integration point ready but not yet wired. Added 2 new tests.
- [x] Populate `source_terminal_id` and `source_user_id` from session context — `adjust_stock_with_reason` now accepts optional audit params. Scoped `adjust_stock_scoped` Tauri command passes `session.terminal_id` and `session.user_id`. Backward-compat `adjust_stock` passes `None`. Added 2 new tests verifying audit field persistence.
- [x] Add `version` and `updated_at` optimistic concurrency fields to synced entities — migration 065 adds `version INTEGER NOT NULL DEFAULT 1` to both `products` and `sales`. `update_product` accepts `Option<i64>` for gradual adoption. `update_sale_status` and `void_sale` increment version on UPDATE. All struct literals and row mappers updated across the workspace.
- [x] Implement `FastPINOverlay.tsx` for shared touchscreen user switching — two-step overlay (username → PIN pad) wired into StatusBar. AuthContext gains `swapSession`, WorkspaceContext gains `swapSessionToken` with race-condition guard. Added 3 i18n keys (en + id). 19 tests (2026-07-11).
- [x] Enforce `ON DELETE RESTRICT` on `store_profiles` foreign keys in the global database — migration 066 adds FK to `workspace_instances.store_id` and changes `user_store_access.store_id` from CASCADE to RESTRICT.
- [x] Cross-store delta routing via `platform/sync/` — migration 067 adds `store_id` to `stock_movements`. `SyncQueue::apply_remote` handles `stock.movement` action (inserts raw delta). `SyncDaemon` rebuilds `stock_summary` after pull. 3 new tests (2026-07-11).

### Phase 3: Delta Pruning (Done 2026-07-15)

- [x] Create `stock_movements_archive` table for audit compliance (migration 072). Enable `PRAGMA auto_vacuum = INCREMENTAL`.
- [x] `archive_stock_movements(older_than_days, max_groups)` — per-item_id archive-rollup consolidation. Copies old rows to archive, inserts SUM(delta) rollup row with `reason: 'archive-rollup'`, deletes old rows from live table. Capped at `max_groups` per call, idempotent, runs `PRAGMA incremental_vacuum(50)` once per cycle.
- [x] 10 tests: table existence, empty DB, no old rows, rollup creation, recent row preservation, idempotency, max_groups cap, rollup exclusion, zero-sum deltas. All 75 products tests pass.
- [x] Daemon integration: `platform/sync/src/daemon.rs` (client-side, `start_prune_task`, 60-120s interval) and `apps/cloud-server/src/prune.rs` (server-side, `start_prune_loop`, hourly interval). Server-side also prunes `offline_queue` in cursor-based batches with `incremental_vacuum`.

---

## Related

- ADR #4 — Store-First Tenancy & Workspace Type/Instance Architecture
- ADR #5 — Subscription Tier & Entitlement
- ADR #10 — Sync Performance Strategy (compression, batching, backoff, retention)
- `docs/specs/_active/p1-sync-batching-compression-retention.md` — Ledger retention spec (Q4 implementation plan)
- `crates/oz-core/src/db/products.rs` (`adjust_stock_with_reason`, `insert_stock_movement`, `rebuild_stock_summary`, `get_stock_from_ledger`, `list_stock_movements`)
- `crates/oz-security/src/terminal.rs`
- `platform/sync/` — Cross-store sync layer
- `platform/sync/tests/integration_test.rs` — 19 cross-terminal integration tests
- `ui/src/components/FastPINOverlay.tsx` ✅

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
