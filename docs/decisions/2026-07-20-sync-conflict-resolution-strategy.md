---
num: 21
area: sync
title: ADR #21: Sync Conflict Resolution Strategy
status: Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor)
---
# ADR #21: Sync Conflict Resolution Strategy

**Status:** Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor)
**Date:** 2026-07-20
**Author:** OZ-POS Contributors
**Tags:** conflict, sync, lww, crdt, offline, reconciliation

---

## Context

ADR #6 (CRDT Delta Ledger) defines an offline-first inventory model where stock movements are immutable delta rows that merge deterministically. ADR #10 (Sync Performance) covers batching, compression, and retention. The current conflict resolution implementation in `platform/sync/src/conflict.rs` uses a single `resolve_lww()` function that compares `created_at` timestamps with remote-wins-on-tie semantics.

The existing approach has several gaps:

1. **Entity-type agnosticism** — Products, sales, stock movements, and users all use the same LWW strategy. Stock movements are already CRDT-safe (deltas sum deterministically), but the current conflict resolver doesn't distinguish them.

2. **`created_at` vs `updated_at`** — The current resolver compares `created_at`, the *enqueue time* of the offline queue item, not the *entity's last modification time*. A sale that was modified locally at T+5 but enqueued at T+3 could lose to a remote item enqueued at T+4 with stale data.

3. **No state-machine awareness** — Sales have a lifecycle (active → pending → completed → voided). A simple LWW could incorrectly revert a completed sale to "pending" if both terminals record different states.

4. **No conflict logging** — When a conflict is resolved, the resolution is applied silently. There is no record of what was resolved, making manual conflict review impossible.

5. **No tombstone propagation** — Deleted entities are not propagated as tombstones during sync, so a deletion on one terminal can reappear when another terminal pushes its older version.

6. **No version vector tracking** — The `version` column exists on `products` and `sales` (from ADR #6 migration 065) but is not used in conflict resolution.

This ADR defines an entity-aware strategy dispatch and upgrades the conflict resolver to close all six gaps.

---

## Decision

### 1. Entity-Type Dispatch

The conflict resolver must select a strategy based on the `action` field of the conflicting items:

| Action prefix | Entity type | Strategy | Key field |
|---|---|---|---|
| `complete_sale`, `void_sale`, `refund_sale` | Sales | State-machine LWW | `status` + `version` |
| `product.*`, `category.*`, `tax.*` | Reference data | LWW by `version` | `version` |
| `stock.adjusted`, `stock.movement` | Inventory | CRDT delta merge | — (no conflict) |
| `user.*`, `staff.*` | Staff | LWW by `version` | `version` |
| `*` (fallback) | Unknown | LWW by `created_at` | `created_at` |

### 2. LWW by Version (Reference Data & Staff)

For reference data (products, categories, tax rates, users), conflict resolution uses the entity's `version` field, which is already tracked and incremented on every update (ADR #6 Phase 2, migration 065).

```rust
fn resolve_version_lww(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let local_version = extract_version(&local.payload).unwrap_or(0);
    let remote_version = extract_version(&remote.payload).unwrap_or(0);

    let winner = if local_version > remote_version {
        local.clone()
    } else if remote_version > local_version {
        remote.clone()
    } else {
        // Version tie: prefer the item with the later `synced_at`
        // (server is authoritative for concurrent updates at the same version).
        remote.clone()
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}
```

**Why not `updated_at`?** The `version` field is a monotonic integer that is immune to clock skew, timezone errors, and millisecond truncation. Two terminals on the same entity will have sequentially increasing versions; the higher version always wins. `updated_at` is preserved as a human-readable reference but is not used as the conflict resolution key.

For reference data, the full entity payload is embedded in the offline queue item. The winner's payload replaces the local state entirely — there is no field-level merge.

### 3. State-Machine Aware LWW (Sales)

Sales follow a state machine with legal transitions:

```
active ──→ pending ──→ completed
                        ↓
                     voided
                        ↓
                     refunded
```

A terminal cannot transition a sale from `voided` back to `active`. Conflict resolution must enforce these legal transitions. If both terminals have modified the same sale, the result with the *most advanced* status wins — not the most recent timestamp.

```rust
/// Priority order of sale statuses (higher = more advanced).
const SALE_STATUS_ORDER: &[&str] = &["active", "pending", "completed", "voided", "refunded"];

fn resolve_sale_lww(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let local_status = extract_sale_status(&local.payload).unwrap_or("");
    let remote_status = extract_sale_status(&remote.payload).unwrap_or("");

    let local_rank = SALE_STATUS_ORDER.iter().position(|&s| s == local_status).unwrap_or(0);
    let remote_rank = SALE_STATUS_ORDER.iter().position(|&s| s == remote_status).unwrap_or(0);

    let winner = if local_rank > remote_rank {
        local.clone()
    } else if remote_rank > local_rank {
        remote.clone()
    } else {
        // Same status: resolve by version.
        resolve_version_lww(local, remote).winner
    };

    ResolvedItem {
        local: Some(local.clone()),
        remote: Some(remote.clone()),
        winner,
    }
}
```

**Edge case — version gap > 1**: If the version difference between local and remote is greater than 1, it indicates that updates were lost (e.g., a terminal was offline for a week). In this case, the conflict is logged for manual review and the *higher status* still wins, but a warning is emitted.

### 4. CRDT Delta Merge (Inventory)

Inventory stock movements are already CRDT-safe under ADR #6. A `stock.movement` delta carries a `+N` or `-N` integer. When two terminals concurrently record different deltas for the same product, both deltas are inserted into the `stock_movements` ledger — there is no conflict to resolve.

```rust
fn resolve_stock_crdt(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    // Both deltas are valid and should be applied.
    // The merged winner carries both deltas as separate payloads.
    // The sync engine applies both rather than picking one.
    ResolvedItem::merged(local.clone(), remote.clone())
}
```

The `ResolvedItem` for a CRDT merge sets `winner` to a new item whose payload contains *both* deltas. The sync engine processes merged items by applying each delta independently.

### 5. Conflict Logging

All conflict resolutions are logged to a new `sync_conflicts` table for observability and manual review:

```sql
CREATE TABLE sync_conflicts (
    id                  TEXT PRIMARY KEY,       -- UUIDv7
    local_item_id       TEXT NOT NULL,          -- FK to offline_queue.id
    remote_item_id      TEXT NOT NULL,          -- FK to offline_queue.id (or server ID)
    action              TEXT NOT NULL,          -- e.g., "complete_sale", "product.update"
    strategy_used       TEXT NOT NULL,          -- e.g., "version_lww", "sale_lww", "crdt_merge"
    winner_item_id      TEXT NOT NULL,          -- the winning offline_queue.id
    version_gap         INTEGER DEFAULT 0,      -- |local_version - remote_version|, 0 = unknown
    resolved_at         TEXT NOT NULL,          -- ISO-8601
    details             TEXT                    -- human-readable summary
);

CREATE INDEX idx_sync_conflicts_action ON sync_conflicts(action);
CREATE INDEX idx_sync_conflicts_resolved_at ON sync_conflicts(resolved_at);
```

The conflict log is exposed via:
- A new Tauri command `list_sync_conflicts(limit, offset)` for the admin UI
- A conflict count badge on the StatusBar (P1-3)
- A "Resolve Conflicts" sub-screen showing unresolved conflicts with manual resolution options (P1-3)

**Conflict retention**: Conflicts are retained for 90 days, matching the offline queue retention window. Older conflicts are pruned alongside the offline queue archive cycle (see ADR #6 Q4).

### 6. Tombstone Propagation

When an entity is deleted (soft-delete with `is_active = false` or `is_deleted = true`), the delete action is enqueued as a tombstone. During conflict resolution:

- **Reference data**: A delete tombstone has `version = MAX` (conceptually — it wins against any existing version). The local entity is soft-deleted. If the remote has a newer version of the same entity, the remote version wins (undelete).
- **Sales**: Void/refund actions are final statuses in the state machine — they cannot be overridden by an `active` or `pending` status from another terminal.

Tombstones carry the following payload:
```json
{
    "action": "product.delete",
    "sku": "COFFEE-001",
    "version": 999999,
    "deleted_at": "2026-07-20T12:00:00.000Z",
    "deleted_by": "user-abc"
}
```

### 7. Unified Resolver Interface

A single `resolve_conflict()` function dispatches to the appropriate strategy:

```rust
/// Resolve a conflict between a local and remote offline queue item.
///
/// Dispatches to the appropriate strategy based on the action type.
pub fn resolve_conflict(local: &OfflineQueueItem, remote: &OfflineQueueItem) -> ResolvedItem {
    let action = local.action.as_str();
    let resolved = if action.starts_with("sale.") || action.starts_with("complete_sale") {
        resolve_sale_lww(local, remote)
    } else if action.starts_with("stock.") {
        resolve_stock_crdt(local, remote)
    } else if action.starts_with("product.") || action.starts_with("category.") || action.starts_with("tax.") || action.starts_with("user.") || action.starts_with("staff.") {
        resolve_version_lww(local, remote)
    } else {
        // Fallback: original LWW by created_at.
        resolve_lww(local, remote)
    };

    // Log the conflict for observability.
    log_conflict(local, remote, &resolved);

    resolved
}
```

---

## Implementation Plan

> **Status:** Phase 1 ✅ implemented — all four resolvers + `resolve_conflict()` dispatch are live in `platform/sync/src/conflict.rs`. Phase 2 ❌ **not shipped** — there is no `sync_conflicts` table, `log_conflict`, or `list_sync_conflicts` anywhere in the codebase (checked 2026-08-08). Phase 3 (tombstones) remains future work.

### Phase 1: Resolver Upgrades (this milestone)

| Step | Description | Files |
|---|---|---|
| 1.1 | Add `resolve_version_lww()` using `version` field from entity payload | `platform/sync/src/conflict.rs` |
| 1.2 | Add `resolve_sale_lww()` with status DAG enforcement | `platform/sync/src/conflict.rs` |
| 1.3 | Add `resolve_stock_crdt()` returning a merged item | `platform/sync/src/conflict.rs` |
| 1.4 | Add `resolve_conflict()` dispatch function | `platform/sync/src/conflict.rs` |
| 1.5 | Wire dispatch into `lib.rs` replacement of direct `resolve_lww` call | `platform/sync/src/lib.rs` |
| 1.6 | Unit tests for all 4 resolvers + edge cases | `platform/sync/src/conflict.rs` |

### Phase 2: Conflict Logging

| Step | Description | Files |
|---|---|---|
| 2.1 | Migration: create `sync_conflicts` table | `crates/oz-core/migrations/` |
| 2.2 | Add `log_conflict()` store method | `crates/oz-core/src/db/` |
| 2.3 | Add `list_sync_conflicts()` store method | `crates/oz-core/src/db/` |
| 2.4 | Wire logging into `resolve_conflict()` | `platform/sync/src/conflict.rs` |
| 2.5 | Add Tauri command for conflict list | `apps/desktop-client/src/commands/` |
| 2.6 | Unit + integration tests | — |

### Phase 3: Tombstones (future)

| Step | Description |
|---|---|
| 3.1 | Add `is_deleted` column to `products`, `categories` |
| 3.2 | Enqueue tombstone on soft-delete |
| 3.3 | Update resolver for tombstone semantics |

---

## Consequences

### Positive

- **Entity-aware resolution** — Each entity type uses the appropriate strategy, eliminating incorrect resolutions.
- **Version-based ordering** — Monotonic version integers eliminate clock-skew issues in LWW.
- **State machine safety** — Sales transitions are enforced, preventing invalid status rollbacks.
- **CRDT-preserving** — Stock movements remain conflict-free with delta merge.
- **Observability** — All conflicts are logged and reviewable via the admin UI.
- **Tombstone readiness** — The framework is ready for full tombstone propagation in a future phase.

### Negative

- **Payload parsing required** — The resolver must parse the offline queue item's JSON payload to extract `version`, `status`, and SKU fields. This adds a dependency on `serde_json` in the conflict module.
- **Extra DB write per conflict** — Each resolution writes a row to `sync_conflicts`. For stores with frequent conflicts, this adds write load. Estimated at < 1 row per 100 sync items.
- **Migration required** — A new migration for the `sync_conflicts` table.
- **Backward compatibility** — Existing offline queue items without version fields in their payload will be handled by the fallback LWW. No data loss.

---

## Acceptance Criteria

1. **21-1**: `resolve_conflict()` dispatches to the correct strategy for each action prefix.
2. **21-2**: `resolve_version_lww()` correctly compares version integers and uses remote-wins-on-tie.
3. **21-3**: `resolve_sale_lww()` ensures a completed sale stays completed even if a remote terminal sends an older `active` payload.
4. **21-4**: `resolve_stock_crdt()` returns both deltas in a merged item — neither delta is lost.
5. **21-5**: Fallback LWW (`created_at`) is preserved for unknown action types.
6. **21-6**: Conflict logging writes to the `sync_conflicts` table with accurate metadata.
7. **21-7**: Version gap > 1 is detected and logged (not ignored silently).

---

## Related

- ADR #6 — CRDT Delta Ledger & Offline Sync (stock movement CRDT merge)
- ADR #10 — Sync Performance, Compression, Batching, Retention
- `platform/sync/src/conflict.rs` — Current LWW resolver
- `platform/sync/src/queue.rs` — `ResolvedItem` struct, `apply_resolution()`
- `platform/sync/src/lib.rs` — `run_sync_cycle()` conflict usage
- `crates/oz-core/migrations/065_version_optimistic.sql` — Existing version columns on products/sales (renamed from `065_version_columns.sql`)

---

## Activation and Ownership

*Appended 09-09-26 by docs-auditor, from the slice-4 sync dossier. Nothing above this line is changed by this section; it records who would execute the strategy, not what the strategy is.*

- **Two live consumers, two policies.** The manual/tablet push path (`crates/oz-core/src/sync_client.rs:329`) lets the **server copy win unconditionally** on `PushOutcome::Conflict`. The daemon path routes the same outcome through `SyncQueue::apply_push_conflict` (`platform/sync/src/daemon.rs:238`, `platform/sync/src/lib.rs:534`) into `resolve_stock_crdt` (`platform/sync/src/conflict.rs:153`), which **preserves both deltas**. Same tag, two owners, opposite semantics.
- **No server in this repository emits that tag.** Every non-test producer in `apps/cloud-server/src/sync_store.rs` and `platform/sync/src/pg_transport.rs` constructs only `Accepted` or `Rejected`. A real clash today arrives as `Rejected { reason: "duplicate id: …" }`, which both consumers route identically. **The divergence is latent; it activates the moment a foreign or older server emits the tag.**
- **The CRDT arm has no re-enqueue bound.** `resolve_stock_crdt` computes a merged `retry_count` (`conflict.rs:167`) and `apply_resolution` then discards it, because the re-enqueue persists `action` and `payload` only (`queue.rs:331`). A conflict that keeps conflicting resets to zero every cycle — forever.
- **The semantics choice is open.** Last-write-wins for the manual path versus merge for the daemon path is a **product decision this ADR did not make, and this append does not make either.**

**The honest headline is: two policy owners for a wire contract with no producer — not a live data-loss bug.** The record says so plainly because this finding arrived here framed as a tablet losing stock adjustments, which is a loss that cannot occur against any server this repo ships; an ADR that overstates a hazard is as much a defect as one that omits it.

- **Cross-reference:** `crates/oz-core/src/sync_client_divergence_tests.rs` is being written alongside this append. It is the artifact that will **fail loudly when someone picks a winner**, rather than letting the two policies drift apart silently in review.
- **Third consumer, and the one live trigger:** the PostgreSQL daemon at `platform/sync/src/pg_daemon.rs:323` **lacks the duplicate-id arm the other two share**, so an idempotent replay there is marked failed instead of synced. That is the only divergence in this section with a plausible non-foreign trigger — recorded so a future reader does not have to rediscover it.

---

> last audited 08-08-26 by docs-auditor · Activation and Ownership appended 09-09-26
