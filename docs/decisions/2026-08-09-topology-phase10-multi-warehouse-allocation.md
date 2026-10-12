<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Fresh pass over this phase record; the 2026-09-29 stamp body is merged at the bottom as original evidence. · MINOR (coordinate drift in the prior stamp's citation): the 2026-09-29 stamp located the `TransactionBehavior::Immediate` guard "in `crates/kasirmu-core/src/db/sales_lifecycle.rs` (`:180` among the call sites)". Line 180 is the `///` separator inside the doc comment above `complete_sale_with_resolved_shortfalls` — no transaction opens there. Re-measured at HEAD, the file opens Immediate transactions at `:118`, `:211`, `:646` and `:897`. The CLAIM was and remains true (the deduction path is Immediate-guarded); only the offset was wrong, and it is corrected here rather than left as a citation that reads as verified. · MATCH, re-measured at HEAD: allocation step 5's `sales.deduction_locations` column is real at `crates/kasirmu-core/migrations/20260813_init.sql:618` (`deduction_locations TEXT` on `sales`) and is genuinely the FIFO void/refund source — `crates/kasirmu-core/src/db/refunds.rs` reads it (`:49` documents it, `:396-397` queries it), and `migrations_tests.rs:631` records that migration 093 added exactly this column. The `stock-routing` relationship Phase 9 introduced and this phase consumes is real at `crates/kasirmu-bridge/src/pos.rs:87` with regression coverage across `pos_tests.rs`. The `db::sales::tests` filter path is still LIVE: `crates/kasirmu-core/src/db/sales.rs:643-644` declares `#[path = "sales_tests.rs"] mod tests;`, so the filter resolves; the "96 tests" figure is left as the 2026-08-09 count it is. · LEFT AS WRITTEN: the "96 tests" figure (a dated run, not a contract); the Dedicated limitation about a single `deduction_location_id` on the cart API (a scope statement, not a code fact). · NOT re-measured: the multi-location sale regression's runtime behaviour ("3 units from route A plus 5 from route B fulfil an 8-unit sale") and the route-order unit tests — those are the phase's acceptance evidence and need a test run, not a doc read. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim below;
     the superseded stamp body is quoted as plain text here, not as a nested comment:

Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass, with one schema claim worth spelling out because the whole contract hangs on it. Allocation step 5 — "persist every location/quantity pair in `sales.deduction_locations` so refunds and voids restore the original sources" — is backed by a real column: `deduction_locations TEXT` at `crates/kasirmu-core/migrations/20260813_init.sql:618`, on the `sales` table, and it is the same column ADR-19's status record (audited earlier in this pass) names as the FIFO void/refund source, so the two records agree rather than competing. Step 4's "one SQLite transaction" is consistent with `TransactionBehavior::Immediate` guarding the deduction path in `crates/kasirmu-core/src/db/sales_lifecycle.rs` (`:180` among the call sites). The Verification bullet "All `db::sales::tests` pass (96 tests)" is still a LIVE filter path, not a stale one: `crates/kasirmu-core/src/db/sales.rs` declares `mod tests` wired to the sibling `sales_tests.rs` per the project convention, so `db::sales::tests` resolves — the 96 figure itself is a 2026-08-09 count and is left as the record of that run, since re-counting it now would be measuring a tree that has moved a lot since. The `stock-routing` relationship Phase 9 introduced and Phase 10 consumes is real in `crates/kasirmu-bridge/src/pos.rs` and `crates/kasirmu-bridge/src/pos_tests.rs`, and the "Dedicated limitation" about a single `deduction_location_id` on the cart API is a scope statement rather than a verifiable code fact, so it is left as written. · No stamp or footer existed on this file before this pass.
-->


# ADR: Topology Phase 10 — Multi-Warehouse Stock Allocation

**Date:** 2026-08-09
**Status:** Implemented

## Problem

Phase 9 consumed only the first `stock-routing` wire from a POS workspace. Additional warehouse routes were ignored, forcing the cashier to enter split-fulfillment resolutions when the first warehouse lacked enough stock.

## Decision

A scoped POS completion now reads every distinct `stock-routing` target from the branch runtime plan in route order. Each target resolves to its primary inventory location, duplicate locations are removed while preserving the first route's priority, and the core sale-deduction transaction greedily fills each sale line from those locations.

The allocation contract is:

1. Prefer the first configured route.
2. Consume only the available quantity at that location.
3. Continue through later routes until the requested quantity is fulfilled.
4. Deduct all allocations atomically in one SQLite transaction.
5. Persist every location/quantity pair in `sales.deduction_locations` so refunds and voids restore the original sources.
6. Roll back the entire sale when the combined configured routes cannot fulfill a line.

Legacy callers and sales without topology routes retain the existing single-location resolver path. Cashier-resolved shortfalls remain available only for demand that exceeds the total configured route capacity or for legacy flows.

## Deliberate limitation

The cart API still exposes one `deduction_location_id` for compatibility and therefore displays the first route's location at cart start. Completion is the authoritative multi-location allocation boundary; a future UI slice can expose the full route plan on the cart and show the predicted split before payment.

## Verification

- Route-order allocation unit tests pass.
- Multi-location sale regression passes: 3 units from route A plus 5 from route B fulfill an 8-unit sale without cashier resolutions.
- All `db::sales::tests` pass (96 tests).
- Desktop runtime-plan route-order test passes.
- Rust formatting passes.

> last audited 11-10-26 by docs-auditor
