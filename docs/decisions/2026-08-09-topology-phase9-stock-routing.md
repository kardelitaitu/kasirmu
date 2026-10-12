<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Fresh pass over this phase record; the 2026-09-29 stamp body is merged at the bottom as original evidence. · MINOR (coordinate drift in the prior stamp, not in the record): the 2026-09-29 stamp placed the mobile commands at `apps/mobile-tauri/src/commands/pos.rs:133` and `apps/mobile-tauri/src/commands/pos.rs:735`. Neither resolves to the function it names. The mobile `start_sale_scoped` is at `apps/mobile-tauri/src/commands/pos.rs:135` (line 133 is its `SALES_PROCESS` doc comment), the mobile `complete_sale_with_resolved_shortfalls_scoped` is at `apps/mobile-tauri/src/commands/pos.rs:823`, and mobile `complete_sale_scoped` lives in a DIFFERENT file — `apps/mobile-tauri/src/commands/pos/checkout.rs:651`, not pos.rs at all; line 735 of pos.rs is `Some(&session.instance_id),` inside unrelated code. The DESKTOP half of the same sentence was exact and re-verified: `apps/desktop-tauri/src/commands/pos.rs:81` (`start_sale_scoped`), `:339` (`complete_sale_scoped`), `:305` (`complete_sale_with_resolved_shortfalls_scoped`). Corrected here because a citation that names a real file at a line holding something else sends a reader to the wrong function while looking authoritative — the failure mode is silent, not loud. · MATCH, re-measured at HEAD: the `stock-routing` relationship this record keys its decision on is real — matched at `crates/kasirmu-bridge/src/pos.rs:87` (`route.get("relationship_type") == Some("stock-routing")`) and exercised throughout `crates/kasirmu-bridge/src/pos_tests.rs` (:488, :635, :687, :694, :701) and the topology suites; the route vocabulary is compiled in `crates/kasirmu-bridge/src/topology/persistence.rs:845/871`, which accepts `stock-routing | inventory-transfer`, with the `warehouse-missing-stock-routing` validation code at `persistence.rs:875/880` and cases in `topology_command_tests.rs:351/365` and `topology_tests.rs:91/540/613`. The "passed to the existing location resolver" step is the resolver ADR-19 pinned: the four helpers in `crates/kasirmu-core/src/location_resolver.rs` — `get_workspace_locations` (:131), `resolve_primary_location` (:304), `resolve_all_locations` (:424), `resolve_location_chain_for_sku` (:513) — plus `get_default_location_id` (:110) for the canonical fallback the record says is unchanged. · LEFT AS WRITTEN: the last Verification bullet ("UI typecheck remains subject to unrelated topology-export changes in the working tree") is a disclosure about the state of the tree on 2026-08-09, true of that moment and not a claim about today; the Deliberate limitation (one primary location per sale, first route selected deterministically, cashier split fulfillment via shortfall resolution) remains the accurate description of the shipped model. · NOT re-measured: the red-test history and the runtime behaviour of route selection against a live store (needs a running deployment); the "Rust formatting and desktop focused compilation/tests pass" line is the phase's own acceptance evidence, not re-run here. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim below;
     the superseded stamp body is quoted as plain text here, not as a nested comment:

Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The `stock-routing` relationship this record keys its whole decision on is real and is defined on the Rust side of the bridge — `crates/kasirmu-bridge/src/pos.rs` holds the runtime consumer, with coverage in `crates/kasirmu-bridge/src/pos_tests.rs` (the "runtime-plan regression confirms `stock-routing` source/target matching" bullet), and the route vocabulary it matches against is compiled in `crates/kasirmu-bridge/src/topology/persistence.rs` with cases in `topology_command_tests.rs` and `topology_persistence_tests.rs`. The two application points the Decision names are real and land where it says: `start_sale_scoped` exists in both clients — `apps/desktop-tauri/src/commands/pos.rs:81` and `apps/mobile-tauri/src/commands/pos.rs:133` — and the scoped completion pair (`complete_sale_scoped`, `complete_sale_with_resolved_shortfalls_scoped`) sits alongside them at `apps/desktop-tauri/src/commands/pos.rs:339` and `:305`, with the mobile equivalents at `apps/mobile-tauri/src/commands/pos/checkout.rs:529` and `apps/mobile-tauri/src/commands/pos.rs:735`. The "passed to the existing location resolver" step is the same resolver ADR-19 (audited earlier in this pass) pinned down: the four helpers in `crates/kasirmu-core/src/location_resolver.rs`. · The last Verification bullet — "UI typecheck remains subject to unrelated topology-export changes in the working tree" — is a disclosure about the state of the tree on 2026-08-09 and is left exactly as written; it is true of that moment and is not a claim about today. · No repairs needed.
-->


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

> last audited 11-10-26 by docs-auditor
