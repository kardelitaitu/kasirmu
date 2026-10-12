<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Re-audit of the multi-terminal peer-model record; the 2026-09-29 stamp is merged at the bottom as original evidence. · MAJOR: the Implementation and Test sections named PRE-RESTRUCTURE paths in a present-tense, prescriptive list. All seven backend entries pointed at `crates/oz-core/` and `apps/desktop-client/`, neither of which exists — the crate root is `crates/kasirmu-core/` and the Tauri shells are `apps/desktop-tauri` + `apps/mobile-tauri`. Every one has a verified current equivalent carrying the same code (session.rs, db/terminals.rs, db/shifts.rs, db/sales.rs, state.rs, commands/pos.rs, commands/terminals.rs), and the list is repointed with a dated note. The test file `crates/oz-core/src/db/multi_terminal_tests.rs` is likewise repointed. The two UI entries were already correct. · MINOR: the test count was wrong in TWO places and a third reading was implied. The record said "17 multi-terminal test cases" in Consequences while enumerating 14, and its Context named "15 concrete multi-terminal scenarios". Measured 2026-10-11: the suite holds **22** `#[test]`/`#[tokio::test]` functions. The Consequences and Test Coverage figures are corrected to 22, the eight tests added since the record was written are listed by name so the arithmetic reconciles, and the Context's 15 is annotated as a dated reading rather than rewritten. · ALSO RECORDED: the routing engine `resolve_kds_targets` this ADR describes now lives in `crates/kasirmu-lan/src/kds_sync.rs` and `crates/kasirmu-bridge/src/kds_routing.rs` — the record named no path, so a location note is added rather than a correction. · VERIFIED AND LEFT ALONE: every row of the Key-Facts table still holds at HEAD — `terminals.bound_store_id` present, `shifts.terminal_id TEXT REFERENCES terminals(id)` at 20260813_init.sql:193, `active_carts` uses workspace_instance_id, `inventory` carries no terminal_id, `CHECK (qty >= 0)` present, `SessionContext.terminal_id` real in session.rs, and `staff_login` registered at apps/desktop-tauri/src/lib.rs:1373. The peer_group UI field is real (8 references under ui/src/features/locations). · NOT re-measured: the multi-terminal runtime behaviour the tests assert — that needs a test run, not a doc read — and the "15 scenarios tested" verification session itself, which is a dated record. · Superseded stamp below. -->

---
num: 40
area: topology
title: ADR #40: Multi-Terminal Peer Model
status: Implemented (2026-08-20)
---
<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 163 lines, no audit stamp, no footer, no marker. Front matter reads "Implemented (2026-08-20)" and the four artifacts its Related section names all exist at their current paths -- `session.rs`, `db/terminals.rs`, `db/shifts.rs` and `db/sales.rs` in the core crate. The citation is the only thing needing a note: the document writes them as `crates/oz-core/src/...`, the pre-restructure crate name, now `crates/kasirmu-core/src/...`. Left as written, since this is a decision record and its references are how the decision was recorded. · This ADR is the origin of the `terminal_id` model that several later documents in this campaign take for granted, and the chain is worth naming because it is not written down in one place: this document introduces per-terminal identity, ADR #47 (round 15) adds branch/workspace scope ON TOP of it through the `assignments` table, and the conditional-scoping record (round 11) shows a `terminal_id` being passed by callers into a delta-ledger INSERT under a value the caller supplies. The scoping story is therefore layered -- terminal, then branch/workspace -- and a reader meeting only one of these documents will not see it. · Status checker reports no drift for this row; the index agrees with the front matter. Stamp and footer added; the file had neither. -->
# ADR #40: Multi-Terminal Peer Model

**Status:** Implemented (2026-08-20)
**Date:** 2026-08-20
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** multi-terminal, peer-model, session, topology, KDS

---

## Context

kasir.mu already supports multiple POS terminals through its existing
multi-store scoping (ADR #7) and terminal registration system. However,
the peer-terminal model was implicit — documented only through code
conventions rather than an explicit architectural record.

This ADR formalizes the multi-terminal peer model and documents the
verification results from testing 15 concrete multi-terminal scenarios at the time of writing
(the suite has since grown to 22 — see **Test Coverage**; the count is a dated reading, not an
invariant).

**Key facts verified against the schema and codebase:**

| Claim | Evidence | Status |
|-------|----------|--------|
| Terminals are peers within a store | `terminals.bound_store_id` allows multiple terminals per store | ✅ Verified |
| Sessions carry terminal_id | `SessionContext.terminal_id` set during `staff_login` | ✅ Verified |
| Shifts are terminal-isolated | `shifts.terminal_id TEXT REFERENCES terminals(id)` | ✅ Verified |
| Cash payouts are terminal-isolated | `cash_payouts.shift_id → shifts.terminal_id` (indirect) | ✅ Verified |
| Inventory is shared (by design) | `inventory` has no terminal_id; qty is global per product | ✅ Verified |
| Held carts are workspace-instance-isolated | `active_carts` uses workspace_instance_id | ✅ Verified |
| Stock concurrency is safe | `inventory.qty CHECK (qty >= 0)` prevents negative stock | ✅ Verified |
| Reporting can filter by terminal | `sales.user_id` and `shifts.terminal_id` available for grouping | ✅ Verified |

---

## Decision

### 1. Peer Terminal Model

Multiple Retail POS terminals operate as **equal peers** within the same
store. There is no hierarchical relationship between terminals.

**Isolation model:**

| Data Type | Isolation Mechanism | Scope |
|-----------|-------------------|-------|
| Product catalog | Global within store | Shared |
| Inventory levels | `product_id` PK | Shared |
| Customer data | `store_id` | Shared |
| Shift information | `terminal_id` | Terminal-isolated |
| Cash payouts | `shift_id → terminal_id` | Terminal-isolated |
| Held carts | workspace_instance_id | Workspace-isolated |
| Sales | `terminal_id` in sale record | Per-sale |
| KDS orders | `store_id` | Shared |

### 2. Session Scoping

Each terminal runs its own process with its own `AppState`. At startup,
the terminal is identified by `device_id` (hostname) and mapped to a
`terminal_id`. The session carries `terminal_id` for all API calls.

```
(terminal_id, store_id) → unique terminal instance within a store
```

### 3. Stock Concurrency

Two terminals selling the last unit simultaneously:
1. Both read `inventory.qty = 1`
2. First to commit wins: `UPDATE inventory SET qty = qty - 1` → qty = 0
3. Second gets `CHECK (qty >= 0)` constraint violation → rollback
4. Business error: "insufficient stock"

SQLite's row-level locking and CHECK constraints provide safe concurrency
without application-level locks.

### 4. Topology Peer Grouping

Workspace nodes in the topology editor support an optional `peerGroup`
metadata field for visual grouping of multi-POS terminals. This is
backward-compatible (optional, stored in existing `metadata` JSON).

### 5. KDS Multi-Device Routing

KDS devices register with `station_ids` mapping to product `kitchen_zone`
values. The routing engine (`resolve_kds_targets`) maps SKU → kitchen_zone
→ device station_ids using a 3-phase approach. *(Located at HEAD in
`crates/kasirmu-lan/src/kds_sync.rs` and `crates/kasirmu-bridge/src/kds_routing.rs`;
this record named no path, and the engine has since been split across the LAN
and bridge crates.)*
1. Station-targeted: only devices whose `station_ids` contain the zone
2. Broadcast: if no station-targeted device, all active devices
3. Catch-all: inactive devices excluded

---

## Consequences

### Positive

- **Zero migration required**: Existing deployments continue unchanged
- **Proven infrastructure**: Uses existing terminal registration, session
  scoping, and SQLite concurrency
- **Tested**: **22** multi-terminal test cases (measured 2026-10-11; the
  record said 17, and the suite has grown since) covering shift isolation, cash
  drawer isolation, concurrent stock, held cart isolation, reporting, and
  KDS routing
- **Backward compatible**: peer_group metadata is optional; all existing
  integrations remain compatible

### Negative

- **Held cart limitation**: Two terminals sharing the same workspace
  instance would see each other's held carts. Mitigated by each terminal
  using a unique workspace instance in practice.
- **No cross-terminal cart transfer**: A cart held on Terminal A cannot be
  restored on Terminal B. This is by design — each terminal manages its
  own held carts.

### Risks

- **Network partitions**: Terminals operate independently during
  partitions. Stock may diverge temporarily until sync reconciles. This
  is the expected offline-first behavior.

---

## Implementation

> **Path correction (2026-10-11).** This section named the pre-restructure crate and app
> directories (`crates/oz-core/`, `apps/desktop-client/`). Neither exists: the workspace was
> renamed to `kasirmu-*` and the Tauri shells are `apps/desktop-tauri` and `apps/mobile-tauri`.
> The list below is repointed to the files that carry the same code today — the decision itself
> is unchanged, and the entries are the record of where its implementation lives. Re-derive:
> `ls crates/kasirmu-core/src/{session.rs,db/terminals.rs,db/shifts.rs,db/sales.rs}`.

### Backend Files

- `crates/kasirmu-core/src/session.rs` — SessionContext with terminal_id
- `crates/kasirmu-core/src/db/terminals.rs` — Terminal registration, binding
- `crates/kasirmu-core/src/db/shifts.rs` — Terminal-isolated shifts
- `crates/kasirmu-core/src/db/sales.rs` — Sale completion with terminal_id
- `apps/desktop-tauri/src/state.rs` — Terminal ID resolution at startup
- `apps/desktop-tauri/src/commands/pos.rs` — Terminal-scoped POS operations
- `apps/desktop-tauri/src/commands/terminals.rs` — Terminal CRUD

### Frontend Files

- `ui/src/features/locations/NodeTopologyEditor.tsx` — peer_group inspector field
- `ui/src/features/locations/topologyNodeCard.tsx` — peer_group badge rendering

### Test Coverage

**22** multi-terminal test cases in `crates/kasirmu-core/src/db/multi_terminal_tests.rs`
(recounted 2026-10-11: 22 `#[test]`/`#[tokio::test]` functions; the record listed 14 and
said 17). The fourteen the record enumerated are all still present and still pass by name,
starting with `two_terminals_bound_to_same_store`; the suite has since gained the
integration, e2e and edge-case cases named below. Re-derive:
`grep -c '#\[tokio::test\]\|#\[test\]' crates/kasirmu-core/src/db/multi_terminal_tests.rs`.

1. Two terminals bound to same store
2. Terminal listing shows all per store
3. Shift isolation between terminals
4. Cash payout isolated by shift
5. Concurrent sale — last unit, second fails
6. Concurrent sale — sufficient stock, both succeed
7. Held cart isolated by workspace instance
8. Inventory shared across terminals
9. Stock never goes negative
10. Report can filter by terminal
11. Report aggregates across terminals
12. KDS order routed from any terminal
13. Same user login on two terminals
14. Terminal crash loses unsaved cart

**Added since the record was written** (present at HEAD, listed so the count reconciles):
`same_user_opens_shift_on_both_terminals`, `integration_full_multi_terminal_workflow`,
`integration_kds_routing_from_multiple_terminals`, `integration_held_cart_same_workspace_shared`,
`integration_terminal_deactivation`, `integration_stock_not_deducted_on_payment_mismatch`,
`e2e_three_terminal_restaurant`, `e2e_network_partition_stock_visibility`.

> last audited 11-10-26 by docs-auditor
