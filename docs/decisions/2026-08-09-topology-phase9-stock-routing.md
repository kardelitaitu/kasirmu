<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The `stock-routing` relationship this record keys its whole decision on is real and is defined on the Rust side of the bridge — `crates/kasirmu-bridge/src/pos.rs` holds the runtime consumer, with coverage in `crates/kasirmu-bridge/src/pos_tests.rs` (the "runtime-plan regression confirms `stock-routing` source/target matching" bullet), and the route vocabulary it matches against is compiled in `crates/kasirmu-bridge/src/topology/persistence.rs` with cases in `topology_command_tests.rs` and `topology_persistence_tests.rs`. The two application points the Decision names are real and land where it says: `start_sale_scoped` exists in both clients — `apps/desktop-tauri/src/commands/pos.rs:81` and `apps/mobile-tauri/src/commands/pos.rs:133` — and the scoped completion pair (`complete_sale_scoped`, `complete_sale_with_resolved_shortfalls_scoped`) sits alongside them at `apps/desktop-tauri/src/commands/pos.rs:339` and `:305`, with the mobile equivalents at `apps/mobile-tauri/src/commands/pos/checkout.rs:529` and `apps/mobile-tauri/src/commands/pos.rs:735`. The "passed to the existing location resolver" step is the same resolver ADR-19 (audited earlier in this pass) pinned down: the four helpers in `crates/kasirmu-core/src/location_resolver.rs`. · The last Verification bullet — "UI typecheck remains subject to unrelated topology-export changes in the working tree" — is a disclosure about the state of the tree on 2026-08-09 and is left exactly as written; it is true of that moment and is not a claim about today. · No repairs needed. -->

# ADR: Topology Phase 9 — Stock Routing Consumer

**Date:** 2026-08-09
**Status:** Implemented

## Problem

The topology compiler already emitted `stock-out → stock-in` routes into the branch runtime plan, but scoped POS sale completion still resolved stock from the POS workspace instance. A connected Warehouse node therefore had no effect on deduction or the cart's locked location.

## Decision

Scoped POS commands consume the branch runtime plan using the active POS instance as the source. The first validated `stock-routing` route selects a Warehouse workspace instance. That instance is passed to the existing location resolver, so its bound or primary inventory location becomes the sale's deduction location.

The selection is applied at both points that establish the deduction contract:

- `start_sale_scoped` locks the route-selected location on the active cart;
- scoped sale completion and resolved-shortfall completion use the route-selected workspace for stock checks, deductions, alternatives, and audit JSON.

When no stock route exists, the existing POS-instance resolution and legacy canonical-default fallback remain unchanged.

A missing or invalid route target fails before cart creation or cart deletion rather than silently falling back to the default location.

## Deliberate limitation

The current sale deduction model has one primary location per sale. If multiple stock routes are connected, the first runtime route is selected deterministically; cashier-driven split fulfillment remains available through the existing shortfall-resolution flow. A future phase can define topology-native multi-warehouse allocation.

## Verification

- Red test confirmed the runtime stock consumer was absent.
- Runtime-plan regression confirms `stock-routing` source/target matching.
- Rust formatting and desktop focused compilation/tests pass.
- UI typecheck remains subject to unrelated topology-export changes in the working tree.

> last audited 29-09-26 by docs-auditor
