---
num: 21
area: sync
title: ADR #21: Sync Conflict Resolution Strategy
status: Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor)
---
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 327 lines, no audit stamp, no footer, no docs-auditor marker. Its front matter reads "Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor)", so a Phase 1 exists, and the resolution function this ADR specifies is live: `resolve_conflict(local, remote) -> ResolvedItem` at `platform/sync/src/conflict.rs:201`, still in the sync crate the ADR names. · WHAT SURVIVED AND WHAT MOVED, precisely. The resolution function is intact, but the surrounding vocabulary the ADR introduces is not findable under its own names -- searching `platform/sync` for `ConflictType` or `ConflictResolution` returns nothing, meaning the entity-type dispatch the companion research document refers to (see `docs/decisions/2026-07-20-crdt-sync-research.md`, audited in the previous round) is keyed differently now. Recorded rather than treated as a finding: an ADR naming a type that was later renamed or inlined is ordinary evolution, and the function carrying the decision is still where the record says. · THIS ADR IS THE DECIDED COUNTERPART to that research document, and reading them together is the useful part. The CRDT survey concluded against a rewrite; this one specifies what shipped instead -- a last-writer-wins hybrid with explicit resolution, extended by property-based tests. Those tests are present (`platform/sync/src/conflict_proptests.rs`), so the strategy this document chose is the one under test. · The status checker reports no drift for this row. Body left entirely as written, including its references to the sync engine's queue and delta surfaces; stamp and footer added, which is all this file needed. -->
# ADR #21: Sync Conflict Resolution Strategy

**Status:** Approved — Phase 1 implemented (2026-07-20; re-audited 2026-08-08 by docs-auditor)
**Date:** 2026-07-20
**Author:** kasir.mu Contributors
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

- **Cross-reference:** the divergence suite has landed — `platform/sync/src/sync_client_divergence_tests.rs` at 28e0e11fd, 509 lines, six tests, wired by four lines at the end of `platform/sync/src/queue.rs`. It could not have gone where this bullet first pointed, because `platform-sync` depends on `oz-core`, so a test in `oz-core` that calls both consumers needs a dev-dependency cycle — cargo accepts that graph and rustc then rejects the call with multiple different versions of crate `oz_core`, the same types twice. The suite now pins that the two owners disagree on work for a stock item where one drops the local delta and the other re-enqueues a merged row; that four of the six rows agree on row state and disagree only on the tag, which is why the assertions check the tag; that the merged retry count and tenant are computed and then discarded, so the re-enqueued row comes back at zero under the default tenant; and that the depth-two nested envelope is the only thing stopping a conflict loop, with no depth guard and no warning. It is a pin, not a verdict — `UNDECIDED` sits in its assertion messages and the semantics choice above stays open — and it **fails loudly when someone picks a winner**, which is what it was written to do.
- **Third consumer, and the one live trigger:** the PostgreSQL daemon at `platform/sync/src/pg_daemon.rs:323` **lacks the duplicate-id arm the other two share**, so an idempotent replay there is marked failed instead of synced. That is the only divergence in this section with a plausible non-foreign trigger — recorded so a future reader does not have to rediscover it.

---

## Second parity gap (appended 09-16-26)

*Appended 09-16-26, from a read-only pass at tip `486bb8807`. Nothing above this line is changed by this section; it corrects one number in it. The bullet above says **one** consumer lacks the duplicate-id arm; re-measured, the tree has **two**.*

- **The count, re-derived rather than reasoned about.** `grep -rn 'is_duplicate_id_rejection' --include='*.rs' apps crates modules platform foundation` returns exactly **two** call sites: `crates/oz-core/src/sync_client.rs:310` (consumer 1, the immediate `apply_sync_outcomes` path) and `platform/sync/src/daemon.rs:208` (the SQLite daemon). Both route a duplicate-id replay to **synced**, which is the intended idempotent-replay behaviour. **Every other consumer of `Rejected` falls through to failure.**
- **The second one, and why the bullet above did not see it.** `platform/sync/src/pg_daemon.rs:333` **and** `platform/sync/src/lib.rs:561` both route `Rejected { reason }` to `mark_offline_failed` with no prefix check, because `SyncQueue::mark_failed` (`platform/sync/src/queue.rs:268`-`:270`) is a bare delegate to `store.mark_offline_failed`. A duplicate-id replay on either path is therefore marked **terminally failed** — push-side failed items are not requeued, so a crash-then-repush strands an item the server had already accepted. `lib.rs` is the one that was missed, and the reason is a census artefact rather than an oversight of principle: `SyncEngine::run_sync_cycle` is **public API with no in-repo production caller** — it is invoked only from `platform/sync/src/lib_tests.rs` and `platform/sync/tests/integration_test.rs`, while `platform/sync/src/lib.rs:18`-`:29` advertises `SyncEngine` in the crate doc. A consumer census that counts call sites under `apps/` cannot see it. **Its blast radius is an embedder, which is exactly what a second shell would be**, so it belongs in this section rather than being dismissed as dead code.
- **Status: reported, not fixed, and no code was changed to measure any of it.** The repair for both is the predicate the other two already share — `oz_core::sync_client::is_duplicate_id_rejection(reason)` applied before the `mark_offline_failed` fallthrough — and it is not done here for two stated reasons: `pg_daemon`'s arm sits inside `run_once`'s `spawn_blocking` closure behind a live `PgTransport`, so pinning a fix would need a PostgreSQL connection; and `lib.rs`'s push loop is a **public API surface**, so changing its semantics is a decision rather than a repair.
- **How this connects to the idempotency key.** The `duplicate id:` reason is not a coincidence of wording — it is the **client-minted row id doing its job**, minted at `crates/oz-core/src/offline.rs:129` inside `OfflineQueueItem::new` and deduped server-side by `ON CONFLICT (id) DO NOTHING`. So this section and the offline-queue identity question are **one mechanism seen from two ends**: the key is what makes the replay idempotent, and the reason string is what a consumer must recognise to treat it as success. A consumer that routes the reason to `failed` has effectively opted out of the guarantee the key provides.
- **Pinning state, so the gap is not mistaken for a regression.** `platform/sync/src/sync_client_divergence_tests.rs:425`-`:437` documents the `pg_daemon` half and its doc comment names the same single consumer; the suite pins **consumer 1's** side only, and the `pg_daemon` half stays a code-reading claim there by design. The second half is now a code-reading claim too, for the same reason.

---

> Activation and Ownership appended 09-09-26.

> last audited 29-09-26 by docs-auditor

---

## The re-enqueue bound is closed (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it records that the first bullet of Activation and Ownership has been repaired, and how.*

- **The bullet above is now historical.** `apply_resolution` no longer discards the merged winner's identity: the `is_new_winner` branch calls `Store::enqueue_offline_preserving_item(&resolved.winner)` (`platform/sync/src/queue.rs:170`) instead of `Store::enqueue_offline(&resolved.winner.action, &resolved.winner.payload)`.
- **What the fix preserves, and why it matters.** The resolver already built the correct row — `resolve_stock_crdt` mints one uuid (`platform/sync/src/conflict.rs:163`), carries the local tenant (`:174`) and origin (`:178`) and computes `retry_count = local.max(remote)` (`:167`). The old call kept only two of those fields, so a merge that kept conflicting acquired a fresh server-side id every cycle, reset the retry ceiling to zero (the bound never engaged) and re-enqueued a multi-store delta under tenant `default`. Persisting the whole item is what keeps the replay idempotent — re-sending the **same** row id is the guarantee the durable outbox (ADR #6) rests on, and `apps/cloud-server/src/sync_store.rs` dedupes it with `ON CONFLICT (id) DO NOTHING`.
- **The new seam.** `crates/kasirmu-core/src/db/offline/enqueue.rs:91` `enqueue_offline_preserving_item(&self, item: &OfflineQueueItem) -> Result<OfflineQueueItem, CoreError>` enforces the subscription writability gate for the item's **own** tenant (`enforce_pos_writable_for_tenant`, `crates/kasirmu-core/src/db/quota_gate.rs:74`), forces status `Pending`/`synced_at` `None`, and INSERTs all eleven columns verbatim. It is the identity-preserving counterpart to `enqueue_offline`, which deliberately mints a new row.
- **The pin did its job.** `platform/sync/src/sync_client_divergence_tests.rs` test `crdt_merge_reenqueue_discards_retry_count_and_tenant` carried `UNDECIDED` in its assertion messages and was written to **fail loudly when someone picked a winner**. It did. It is renamed `crdt_merge_reenqueue_preserves_retry_count_and_tenant` and now asserts the corrected behaviour: `retry_count == 4`, `tenant_id == "store-a"`.
- **The id assertion is derived, not pre-resolved.** The test does not compare the requeued row to the winner it resolved itself: `apply_push_conflict` re-resolves internally and mints a *different* uuid from the same millisecond, so the test re-derives the winner from the same inputs and asserts the persisted row's merged **payload** and **origin terminal** match, plus `requeued.id != row.id`. The unstable field is the id itself, by design.
- **Activation state unchanged.** No server in this repository emits the conflict tag (`apps/cloud-server/src/sync_store.rs`, `platform/sync/src/pg_transport.rs` construct only `Accepted`/`Rejected`), so this repair is still latent-path work. The sibling parity gaps recorded above — the `pg_daemon` duplicate-id arm and the `SyncEngine` public-API fallthrough — are **not** addressed here.

> Re-enqueue bound closed 2026-10-04.

---

## Both parity gaps are closed (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it records that the two bullets describing the PostgreSQL-daemon and SyncEngine duplicate-id gaps are now historical, and names the tests that pin the closure.*

- **The tree has four appliers and all four share the rule.** The predicate lives once, at `crates/kasirmu-core/src/sync_client/types.rs:63` (`is_duplicate_id_rejection`, `reason.starts_with(DUPLICATE_ID_REJECTION_PREFIX)` where the prefix is `"duplicate id:"` at `:59`). The call sites are:
  - consumer 1 — `crates/kasirmu-core/src/sync_client.rs:101` (immediate `apply_sync_outcomes`);
  - the SQLite daemon — `platform/sync/src/daemon.rs:408` (`apply_push_results`);
  - **the PostgreSQL daemon — `platform/sync/src/pg_daemon.rs:760` (`apply_push_outcomes`)**;
  - **the embedder — `platform/sync/src/lib.rs:239` (`SyncEngine::apply_push_outcomes`)**.
- **The PostgreSQL arm was added and is pinned, not merely read.** The C48 sweep added it and `platform/sync/src/pg_daemon_tests.rs` pins it with `pg_apply_push_outcomes_duplicate_id_replay_marks_synced` (duplicate-id replay -> `synced`) and its negative twin `pg_apply_push_outcomes_genuine_rejection_marks_failed`. The arm was extracted out of `run_once`'s `spawn_blocking` closure into a testable free function precisely so it could be pinned without a live PostgreSQL, which answers the "would need a PostgreSQL connection" objection recorded above.
- **The SyncEngine arm is pinned too.** `platform/sync/src/lib_tests.rs:1627` exercises the prefix through `SyncEngine::apply_push_outcomes`. The embedder-side semantics decision the bullet above called open was taken: a duplicate-id replay marks **synced** on that path as well.
- **The divergence suite's doc no longer calls it a gap.** `platform/sync/src/sync_client_divergence_tests.rs` row 5 documents the four appliers and is renamed `duplicate_id_rejection_is_synced_on_all_four_appliers`; its remaining `UNDECIDED` messages concern the CRDT merge path and the depth-two envelope, not the duplicate-id arm.

> Parity gaps closed 2026-10-04.

---

## The CRDT envelope no longer nests (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it records the depth guard added to `resolve_stock_crdt`.*

- **The defect.** `resolve_stock_crdt` (`platform/sync/src/conflict.rs:215`) wrapped whatever payload it was handed into `{local, remote, merge_type: "crdt_delta"}`. A merged winner is itself a queue row, so a second conflict on it produced `{local: {local, remote, merge_type}, ...}`. The appliers read only one level (`payload.get("local")`), so the inner envelope failed to deserialise as a stock delta — and that failure, not a guard, was **the only thing stopping a conflict loop**, silently.
- **The repair.** The resolver now FLATTENS: `flatten_stock_deltas` returns the ordered list of leaf deltas a payload carries (a plain delta yields itself; an envelope yields `local`, `remote`, and `local_extra`/`remote_extra` when present). The first two become `local` and `remote` — the keys the four `queue.rs` consumers already read — and any surplus deltas ride in an `extra` array that those consumers also apply. The result is always exactly one level deep and no delta is dropped. A nested envelope is logged once via `tracing::warn!` (flags only, never payload contents).
- **Every consumer was taught the new key.** The four envelope sites in `platform/sync/src/queue.rs` (`stock.adjusted` and `stock.movement`, in both the atomic and legacy dispatchers) now apply `local`, `remote`, and each entry of `extra`. `remote_effect_key` (`platform/sync/src/queue/appliers.rs:448`) is unchanged: a CRDT-enveloped stock item still has no single effect key by design.
- **The pin flipped.** `nested_crdt_envelope_fails_to_deserialize_at_depth_two` was the pin that recorded the old nesting; it is replaced by `re_merging_a_merged_envelope_stays_one_level_deep` (`platform/sync/src/sync_client_divergence_tests.rs`), which asserts a re-merge over a merged row stays depth one and every carried side decodes as a `StockAdjustmentPayload`.
- **Still latent.** No server in this repository emits the conflict tag, so this guard hardens a path that is not live yet (same activation caveat as the rest of this ADR). A typed replacement for the envelope exists but is unadopted: `platform/sync/src/crdt/delta_mutation.rs` (`DeltaMutation`), whose migration remains separate work.

> Depth guard added 2026-10-04.

---

## The flatten now consumes its own surplus deltas (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it corrects one claim in it and records a follow-on repair.*

- **The claim above that "no delta is dropped" was only true for the second merge.** The first flatten parks surplus deltas in the envelope's `extra` array, but `flatten_stock_deltas` (`platform/sync/src/conflict.rs:159`) read only the `local`/`remote`/`local_extra`/`remote_extra` keys — never `extra` itself. A THIRD merge over an envelope that carried an `extra` array therefore silently discarded every surplus delta: the exact data loss the flatten existed to prevent, moved one merge later. The pre-fix third merge of a two-delta winner yielded `[1, 1, 2, 2]` instead of the `[1, 1, 1, 1, 2, 2, 2, 2]` its inputs demanded.
- **The repair.** `flatten_stock_deltas` now reads `local` then `remote` (keeping the first two deltas stable for the four `queue.rs` consumers), then each entry of the `extra` array in order, then the legacy `local_extra`/`remote_extra` keys. The earlier doc's claim that an envelope yields "`local_extra`/`remote_extra` when present" was also wrong about this module's own producer — the producer writes `extra` (an array); the two legacy keys are tolerated, not emitted.
- **The pin.** `re_merging_a_flattened_envelope_keeps_its_extra_deltas` (`platform/sync/src/sync_client_divergence_tests.rs`) merges twice to build an `extra`-bearing envelope, merges a third time, and asserts all four leaves survive on both sides. It FAILED before the repair with `left: [1, 1, 2, 2]` against `right: [1, 1, 1, 1, 2, 2, 2, 2]`.
- **Scope.** Still the same latent path: no in-repo server emits the conflict tag. Both the envelope and its flatten remain the legacy shape; the typed `DeltaMutation` migration (`platform/sync/src/crdt/delta_mutation.rs`) is unchanged separate work.

> Surplus deltas preserved 2026-10-04.

---

## A flattened envelope may repeat a movement id (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it records the replay-safety repair the flatten made necessary.*

- **The defect the flatten exposed.** A re-merge of a `stock.movement` envelope with itself legitimately repeats the SAME movement id across `local`, `remote` and the `extra` array. The applier inserted every one of them, and `stock_movements.id` is a PRIMARY KEY, so the second insert aborted the whole apply with `UNIQUE constraint failed: stock_movements.id` — the daemon's replay ledger guards a repeated ITEM, never a repeated id WITHIN one flattened envelope.
- **The repair.** `insert_stock_movement_on` (`crates/kasirmu-core/src/db/products_stock_query.rs:150`) now inserts `ON CONFLICT(id) DO NOTHING`. A movement's id IS its identity, so a replay of the same ledger row is a no-op — the correct semantics for an immutable ledger, and the same idempotence the durable outbox rests on. The first write wins; a replay cannot mutate a settled row.
- **The pins.** `insert_stock_movement_is_idempotent_by_id` (`crates/kasirmu-core/src/db/products_stock_query_tests.rs`) inserts the same id twice with different deltas and asserts one row holding the first delta. `apply_remote_tolerates_duplicate_ids_in_a_flattened_extra_array` (`platform/sync/src/queue_tests.rs`) applies a `stock.movement` envelope whose `local`/`remote`/`extra` all name one id and asserts the apply succeeds with the row stored once. The second FAILED before the repair with the UNIQUE violation above.
- **Scope.** Still the latent conflict path (no in-repo server emits the conflict tag), but the idempotence is correct for ANY replay of a movement row, not only the CRDT one.

> Movement replay made idempotent 2026-10-04.

---

## A self-merge is idempotent (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it corrects the semantics the two earlier flattens established.*

- **The defect the flatten exposed.** Making `extra` reach the appliers revealed that a merge of a row with ITSELF (X ∪ X, the converged state two replicas present) listed every delta twice — `local`/`remote` plus two `extra` repeats. The appliers are not all idempotent: `adjust_stock` appends a fresh mutation by design, so applying the repeats double-counted. A `{+10, -3}` winner self-merged and applied landed **+14** instead of **+7**.
- **The repair.** `resolve_stock_crdt` collapses byte-identical leaf deltas after flattening, keeping first occurrence so the local/remote ordering stays stable. Two identical deltas ARE the same fact here: they only ever arise from repeating one input, while two independent adjustments arrive on the distinct `local`/`remote` sides and stay distinct (a `stock.adjusted` delta carries no id, so content is the only identity it has — the reason `DeltaMutation` exists, still unadopted). The applier side was hardened too: the four stock arms in `platform/sync/src/queue.rs` now share `appliers::envelope_deltas`, one walk that yields the envelope's DEDUPLICATED leaf deltas, so a hand-built or legacy envelope cannot double-apply either.
- **The pins.** `re_merging_a_merged_envelope_stays_one_level_deep_and_idempotent` replaces the old depth-one pin and asserts a self-merge yields `{local: +10, remote: -3}` with NO `extra`. `re_merging_distinct_envelopes_keeps_every_delta` proves the collapse does not eat genuinely different deltas: merging `{+1}`, `{+2}`, `{+3}` still applies all three. `apply_remote_does_not_double_count_repeated_stock_adjustments` (`platform/sync/src/queue_tests.rs`) FAILED before the repair with `left: 64` against `right: 57`.
- **Scope.** Still the latent conflict path (no in-repo server emits the conflict tag). This is the FOURTH defect in the CRDT merge path, each uncovered by repairing the one before it: the winner's identity, the nesting, the dropped extras, and now the double-count.

> Self-merge made idempotent 2026-10-04.

---

## The degenerate inputs of a content-dedupe merge (appended 2026-10-04)

*Appended 2026-10-04. Nothing above this line is changed by this section; it pins the edges the self-merge idempotence created.*

- **Two identical payloads.** When both sides carry the same fact, collapsing identical deltas leaves the envelope with one delta, so it carries `local` but no `remote`. That is safe because the four appliers walk the payload through `appliers::envelope_deltas`, which iterates only the sides present — the earlier `payload.get("remote").unwrap_or(&Value::Null)` shape (which would have tried to deserialise NULL and failed the apply) is gone. `crdt_merge_of_two_identical_payloads_stays_consumable` (`platform/sync/src/conflict_tests.rs`) and `apply_remote_consumes_a_merge_of_two_identical_payloads` (`platform/sync/src/queue_tests.rs`, asserting +5 applied ONCE) pin it.
- **Two movements that share every field but the id.** Content-dedupe keys on the serialised bytes, so it correctly keeps both — the ids differ, the bytes differ. `apply_remote_keeps_distinct_movements_that_share_their_fields` (`platform/sync/src/queue_tests.rs`) pins that a second movement with its own id is never deduped away. Identity for a movement is its id, and that id is part of the bytes; a same-id/different-field pair is instead collapsed by the ledger's `ON CONFLICT(id) DO NOTHING`.
- **The proptests still hold.** `crdt_merge_preserves_two_distinct_deltas_rather_than_deduplicating` passes unchanged: the content-collapse only ever joins byte-identical deltas, which arise from repeating one input, never from two independent adjustments.

> Dedupe edges pinned 2026-10-04.

---

## A null side in an envelope is skipped, not applied (appended 2026-10-04)

*Appended 2026-10-04. Continues the "degenerate inputs" section above.*

`resolve_stock_crdt` can legitimately emit an envelope with a `Null` side: two unparseable inputs merge to `Null/Null`, and one unparseable input with one good one merges to `{local: <fact>, remote: Null}` (both shapes are already produced and pinned in `platform/sync/src/conflict_tests.rs`).

Routing the four stock arms through `appliers::envelope_deltas` (the self-merge fix, e7f45118b) passed those nulls straight to the arm's deserialiser, which then aborted the WHOLE apply: `invalid stock payload: invalid type: null, expected struct StockAdjustmentPayload`. A side that carries no fact must be skipped.

- `envelope_deltas` now drops a `Null` SIDE. It still emits a NON-envelope payload verbatim, so a bare top-level `null` item is still rejected visibly by the arm's deserialiser — only a null *side in a merge* is treated as "no fact".
- Pins: `apply_remote_skips_a_null_side_in_a_merge_envelope` (a real local delta alongside a null remote applies once), `apply_remote_treats_both_null_sides_as_a_no_op` (`Null/Null` succeeds as a no-op), `apply_remote_still_rejects_a_bare_null_payload` (a non-envelope null still fails).

> Null-side disposition pinned 2026-10-04.

---

## A permanent apply failure quarantines on its first attempt (appended 2026-10-04)

*Appended 2026-10-04. Closes the `next:` item recorded at `platform/sync/src/queue.rs`.*

A pull item that fails to apply used to burn a flat three-attempt budget before it was dead-lettered, whatever the error. That is right for a failure that can clear on its own, but wrong for one decided by the input: a malformed payload, a missing referenced row, or an id/field clash produces the identical error every time, so the two extra attempts only hold the durable pull anchor back for two more cycles.

`CoreError::is_permanent()` (`crates/kasirmu-core/src/error.rs`) now names the three input-decided kinds — `Validation`, `NotFound` and `Conflict`. The failure site in `SyncQueue::apply_remote_atomic_full` records `max_attempts = 1` for those and `3` otherwise:

- PERMANENT (`max_attempts = 1`): a malformed payload, a missing referenced row, a uniqueness/identity clash. Quarantined on the first failure; the anchor may advance at once.
- TRANSIENT (`max_attempts = 3`): database failures, platform errors, unexpected internal failures (including a payload that fails deserialization), money overflow, and stock contention. Also every permission, subscription and licence condition — a role grant, a renewal or an operator action can clear those, so they must not be quarantined on sight.

The check is a whitelist of the three permanent kinds, so a newly added `CoreError` variant stays retryable by default and cannot silently start quarantining a new class of item. An operator can still requeue any quarantined item with `Store::requeue_remote_failure`, which deletes the quarantine row and rewinds the pull anchor for a re-pull (safe because the `sync_applied_items` receipt ledger skips every already-applied item).

Pins: `apply_remote_atomic_failure_rolls_back_mutation_and_receipt` (missing sku quarantines on the first failure), `apply_remote_atomic_transient_failure_burns_the_retry_budget` (malformed payload keeps the three-attempt budget), `apply_pulled_page_dead_letters_then_advances` (permanent failure advances the anchor immediately), `apply_pulled_page_retains_anchor_on_retryable_failure` and `engine_retains_anchor_until_remote_item_is_dead_lettered` and `daemon_retains_anchor_until_remote_item_is_dead_lettered` (transient failures retain the anchor while retryable).

> Permanent-vs-transient apply-failure classification pinned 2026-10-04.

---

## A failed push still advances the persisted logical clock (appended 2026-10-04)

*Appended 2026-10-04. Closes the `next:` item recorded at `platform/sync/src/crdt/push_stamp.rs`.*

Outbound pushes are stamped with `_terminal` and `_vector: {terminal: counter}` so the cloud's conflict detectors can order this terminal's mutations against its peers. The counter must never rewind: the server compares counters per terminal, so a counter that goes backwards makes every later push look older than what is already stored — the push is classified `Stale` and detection quietly stops for this terminal.

`SyncTransport::push_items` burns one counter per queued item BEFORE the HTTP call is made (the atomic is advanced in the stamping loop). The daemon used to write the counter back only in the `Ok(results)` arm of both push sites, so a rejected push — a 500, a 403 `plan_required`, a 401 that the retry path also fails — discarded the advanced counters while the persisted value stayed at the previous cycle's mark. The next tick (or a restart) then resumed from a counter range the server may already have recorded.

`daemon_tick::persist_stamped_counter(db, transport)` now writes the current stamped counter back after EVERY push attempt, success or failure, and both push sites (the `run_tick` push phase and `push_retry_after_auth_refresh`) plus the `run_tick` error arm call it:

- Success: unchanged behaviour, verified after the push instead of before the response parse.
- Failure: the advanced counter is persisted so the surviving range cannot be re-emitted; the error is still surfaced to daemon status exactly as before, and no queued item's state changes (a terminal rejection like `plan_required` still leaves items `pending`).
- No stamping (no terminal identity): `last_stamped_counter()` is `None`, so nothing is written — correct, because no counter was ever emitted.

Pin: `run_tick_persists_the_clock_even_when_the_push_fails` (a 500 push server; the persisted `sync.clock.counter` must exceed its seed of 40 after a tick that queued two items).

> Outbound clock persistence on failure pinned 2026-10-04.

---

## The engine is embedder-only; the shipped shells use the daemon (appended 2026-10-04)

*Appended 2026-10-04. Records an entitlement/reachability finding about `SyncEngine::run_sync_cycle`.*

`SyncEngine::run_sync_cycle` (`platform/sync/src/lib.rs`) is a public API with no caller in the shipped application. Both dependents of `platform-sync` reach past it:

- `apps/desktop-tauri` drives `platform_sync::daemon::SyncDaemon` / `platform_sync::pg_daemon::PgSyncDaemon` (plus `SettingsChangedSink`, `PgDaemonStatus`, `image_push`).
- `apps/cloud-server` consumes only the transport and CRDT types (`PushOutcome`, `PushRequest`/`PushResponse`, `CausalOrder`, `VersionVector`, `stamp_payload`).

Every real caller of `run_sync_cycle` is a test (`platform/sync/tests/integration_test.rs`, `platform/sync/src/lib_tests.rs`); the only other hits are doc comments.

**Why this matters:** the engine's push phase only stamps if the caller seeded `with_vector_stamping` — and the shipped shells never call the engine at all, so no production push can reach the server unstamped this way. The production push path is the daemon, which stamps every push and persists the counter through `daemon_tick::persist_stamped_counter`.

`run_sync_cycle`'s doc comment now states this contract explicitly (embedder-only; a caller MUST seed `crate::crdt::CLOCK_KEY` + the terminal id and persist `last_stamped_counter` after every cycle), and two pins record the reachable states: `sync_engine_without_stamping_seed_reports_no_counter` (a fresh engine stamps nothing) and `sync_engine_with_stamping_seed_reports_a_counter` (the seed is the highest counter; `with_vector_stamping("term-embed", 40)` reports `Some(40)`).

> Engine reachability + embedder stamping contract recorded 2026-10-04.

---

## COR-32: a workspace rebind now invalidates the 30s location cache (fixed 2026-10-04)

`resolve_primary_location` (`crates/kasirmu-core/src/location_resolver.rs`) caches the resolved primary location in a process-global `LOCATION_CACHE` keyed by workspace instance id, with a 30-second TTL (`CACHE_TTL_SECS`). The cache exists so a per-cart-open SELECT does not run on every sale.

The marker `COR-32` (LOW-MED) recorded that no production mutation path cleared the cache: `invalidate_location_cache` had callers only on session switch (`crates/kasirmu-bridge/src/auth.rs`) and behind an explicit IPC command (`invalidate_location_cache_scoped`) that the rebind path never invoked. So an operator who rebound a workspace's inventory locations (`Store::set_workspace_inventory_locations`, `crates/kasirmu-core/src/db/inventory.rs`) could keep deducting stock from the OLD location for up to 30 seconds after the change.

**Fix:** the mutator now calls `crate::location_resolver::invalidate_location_cache()` immediately after `tx.commit()` succeeds, so the next `resolve_primary_location` re-reads the bindings the transaction just replaced. The call is after the commit on purpose — a rolled-back write must not drop a still-correct cache entry.

Pinned red-first by `set_workspace_inventory_locations_invalidates_the_location_cache` (`crates/kasirmu-core/src/db/inventory_tests.rs`): bind A, resolve (populating the cache), rebind to B, resolve again — the post-fix resolve returns B, and the pre-fix run returned the stale A.

> COR-32 fixed 2026-10-04; the binding mutator invalidates the location cache.

---

## The image-push daemon's HTTP client is now bounded (COR-31 residual, fixed 2026-10-04)

`ImagePushScheduler` (`platform/sync/src/image_push.rs`) — re-exported as `crate::image_push` and run as a background daemon by `apps/desktop-tauri/src/lib.rs` via `platform_startup::spawn_daemon("image push", ...)` — built its HTTP client with a bare `reqwest::Client::new()`. That constructor sets **no timeout at all**, and the client is used for two real calls: `POST {server}/api/v1/images:batch` and `GET {server}/api/v1/images:missing`.

This is the last known COR-31 site, and it is worse in a daemon than in a request path: a hung POST never returns, `drain_once` never completes, and the drain loop never reaches its next tick — the image queue silently stops draining while the scheduler is still alive and reporting healthy. The identical hazard is already documented for `platform/startup/src/rate_sync.rs`.

**Fix:** a shared `pub(crate) fn bounded_http_client()` builds through `reqwest::Client::builder()` with `connect_timeout(10s)` and `timeout(30s)` — the same budget the other bounded non-bulk JSON calls use (`sync_client`, `whatsapp`, the payment drivers). The batch payload is capped at `batch_max_bytes()` (512 KB), so 30s is generous. The fallback arm keeps the old unbounded client but logs at `error`, matching the `rate_sync.rs` and payment-driver pattern.

Pinned by `push_client_is_bounded_by_a_timeout` (`platform/sync/src/image_push_tests.rs`): reqwest's `Client` does not expose its configured timeouts, so the coupling — "the constructor builds through `Client::builder()` with a connect and a total timeout, and no bare `client: reqwest::Client::new()` remains" — is asserted over the source with `include_str!`, the same technique `apps/cloud-server/src/sync_api_tests.rs` uses for source contracts. The test harness's own struct literal now builds through `super::bounded_http_client()` too, so the tests exercise the real shape.

> COR-31 residual fixed 2026-10-04; the image-push daemon's client is bounded at 10s connect / 30s total.

## The tablet's conflict commands use a bounded client too (COR-31 residual, fixed 2026-10-04)

`list_sync_conflicts_scoped` and `resolve_sync_conflict_scoped` in `apps/mobile-tauri/src/commands/sync.rs` built their requests with a bare `reqwest::Client::new()` — no timeout at all. Unlike the image-push daemon, these are user-initiated UI calls: the operator taps the conflict queue, and then resolves a row. An unbounded hang pins the command forever and the spinner never clears.

**Fix:** a `fn bounded_conflict_client()` builds through `reqwest::Client::builder()` with `connect_timeout(10s)` and `timeout(30s)`, the same budget as the other bounded non-bulk JSON calls. The unreachable builder-failure arm keeps an unbounded client but logs at `error`, matching `rate_sync.rs` and the payment drivers.

Pinned by `sync_conflict_commands_use_a_bounded_client` (`apps/mobile-tauri/src/commands/sync_tests.rs`): it asserts both commands route through `bounded_conflict_client()`, that the builder sets connect and total timeouts, and that no bare `reqwest::Client::new().get(` / `.post(` request builder survives.

The desktop twin (`apps/desktop-tauri/src/commands/sync.rs`) carries the same pattern at `:440`/`:488` and is left to the lane that currently owns that file.

> COR-31 residual fixed 2026-10-04; the tablet conflict commands are bounded at 10s connect / 30s total.
