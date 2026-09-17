# Research: CRDT-Based Conflict-Free Replication

**Status:** Research (evaluation only)
**Date:** 2026-07-20
**Author:** Architecture Team
**Tags:** crdt, sync, conflict-resolution, research, lww

---

## Context

kasir.mu currently uses a **Last-Write-Wins (LWW)** conflict resolution strategy
with version vectors (ADR #21, `2026-07-20-sync-conflict-resolution-strategy.md`).
The strategy is entity-type-dispatch:

- **Reference data** (products, customers): Version LWW — highest `version` wins
- **Sales**: State-machine LWW — status transitions are monotonic
  (active → pending → completed → voided → refunded)
- **Stock**: CRDT delta ledger — immutable `+N`/`-N` rows with deterministic SUM

The TODO item P20-2 asks: *"Evaluate CRDT-based conflict-free replication as
upgrade path from LWW."* This document evaluates whether adopting a full CRDT
library would improve the current hybrid approach.

---

## Current Approach (LWW Hybrid)

kasir.mu already implements a **practical CRDT** for inventory — the delta ledger
is mathematically equivalent to a G-Counter (grow-only counter with positive and
negative deltas summing to a PN-Counter). This is described in ADR #6.

The current approach is:
1. **Simple** — SQL queries, no external library dependencies
2. **Reliable** — 49 sync-conflict tests, 139 platform-sync tests
3. **Auditable** — Every delta row has `created_at`, `source_terminal_id`,
   `source_user_id`, `reason`
4. **Performant** — Compiled SQL, no deserialization overhead
5. **Limited** — LWW for reference data can lose concurrent edits (e.g., two
   terminals updating the same product at the same time)

---

## CRDT Library Options

Three Rust-compatible CRDT libraries were evaluated:

### Option A: Automerge (`automerge`)

- **License:** MIT
- **Maturity:** Active (Automerge team, ~4k stars)
- **Model:** JSON-like CRDT (conflict-free replicated data type)
- **Rust API:** Native Rust crate with WASM support
- **Pros:** Rich data model, automatic merge, no conflict resolution needed,
  diff/patch operations, sync protocol included
- **Cons:** ~200KB WASM binary, all data must be in Automerge's format
  (requires migration from SQL), JSON-like structure is less efficient than
  SQL for queries, not designed for SQL-backed apps

### Option B: Yrs (`yrs`)

- **License:** MIT
- **Maturity:** Active (Yjs port, ~1.5k stars)
- **Model:** YATA CRDT (conflict-free data types for collaborative editing)
- **Rust API:** Native Rust with C FFI and WASM
- **Pros:** Proven in collaborative editors, Yjs ecosystem compatibility,
  efficient binary encoding, awareness protocol (who is online)
- **Cons:** Designed for real-time collaboration (overkill for async POS sync),
  document-oriented, not SQL-friendly, complex API for simple counters

### Option C: `crdts` (rust-crdt)

- **License:** MIT
- **Maturity:** Stable (~600 stars)
- **Model:** Pure CRDT primitives (G-Counter, PN-Counter, LWW-Register,
  OR-Set, Map)
- **Rust API:** Lightweight, no dependencies on external sync protocol
- **Pros:** Minimal (~50KB), composable primitives, can embed in SQL columns,
  no migration needed (CRDT values stored as BLOBs)
- **Cons:** Manual sync protocol, each data type must be manually chosen,
  smaller community

---

## Comparison Matrix

| Criterion | Current (LWW Hybrid) | Automerge | Yrs | crdts |
|---|---|---|---|---|
| Setup complexity | None (already built) | High (full migration) | High (full migration) | Medium (incremental) |
| SQL compatibility | Native | None (document model) | None (document model) | Good (BLOB columns) |
| Conflict handling | Per-type manual | Automatic | Automatic | Per-type manual |
| Sync protocol | Custom (push/pull) | Built-in | Built-in (Yjs) | Manual |
| Audit trail | Built-in (SQL rows) | Via history API | Via awareness | Manual |
| Performance | Fast (compiled SQL) | Moderate (JSON ops) | Fast (binary encoding) | Fast (minimal overhead) |
| Test coverage | 188 tests | None | None | None |
| Migration effort | N/A | Months | Months | Weeks |

---

## Analysis

### What We'd Gain

- **Reference data conflicts:** A true LWW-Register or OR-Set for products,
  customers, and settings would resolve concurrent edits deterministically
  without data loss (currently, the highest `version` wins, which can
  silently discard data).

- **Simpler mental model:** A single CRDT library for all data types instead
  of the current per-entity dispatch.

- **Off-the-shelf sync protocol:** Automerge and Yrs include sync protocols
  that handle partial sync, connection drops, and reconnection automatically.

### What We'd Lose

- **SQL queryability:** Automerge and Yrs are document-oriented. You can't
  `SELECT SUM(revenue) FROM sales` without deserializing all documents.
  This is a **showstopper** for a POS system that needs fast aggregation
  queries for reporting, dashboards, and inventory checks.

- **Audit trail:** SQL rows naturally provide an immutable audit trail.
  CRDT libraries have history APIs, but they're designed for undo/redo,
  not compliance auditing.

- **Existing investment:** 49 sync-conflict tests, 139 platform-sync tests,
  and the entire `platform/sync/` infrastructure would need to be rewritten.

- **Performance:** SQL queries against indexed tables are faster than
  traversing CRDT document graphs for aggregation queries.

---

## Recommendation

**Stay with the current LWW hybrid approach.** The current system already
implements a CRDT for the most conflict-prone data (inventory stock), uses
monotonic state machines for sales, and has acceptable LWW behavior for
reference data (which changes infrequently and almost never concurrently).

### Incremental Improvements (Instead of Full CRDT Migration)

1. **LWW-Register for reference data:** Adopt the `crdts` crate's
   `LWWRegister` for product fields (name, price, category) stored as a
   BLOB column. This would resolve true concurrent edits deterministically
   while keeping SQL compatibility. Migration would be per-field and
   incremental — about 1 week of work.

2. **Lamport clocks:** Replace the current `version` integer with a
   Lamport clock (counter + node ID) for more precise causal ordering
   of reference data updates. This is a lightweight change (migration +
   ~50 lines of Rust).

3. **OR-Set for sale lines:** If concurrent line-item edits become a
   problem (e.g., two terminals modifying the same sale), an OR-Set
   (observed-remove set) ensures add/remove operations converge.

These incremental improvements deliver most of the benefit of full CRDT
adoption with a fraction of the migration effort.

---

## Related

- ADR #6: CRDT Delta Ledger & Offline Sync
- ADR #21: Sync Conflict Resolution Strategy (`2026-07-20-sync-conflict-resolution-strategy.md`)
- `platform/sync/src/conflict.rs` — current entity-type conflict dispatch
- `crates/oz-core/src/db/reports.rs` — SQL aggregation queries
- `platform/sync/tests/` — 139 integration tests

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

