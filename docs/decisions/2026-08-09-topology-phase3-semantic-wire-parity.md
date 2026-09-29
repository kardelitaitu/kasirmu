<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 0 minor) · Audited on branch 0.0.40. MAJOR, proven by execution: `cargo pkgid -p oz-pos-app` returns "error: package ID specification `oz-pos-app` did not match any packages" — the workspace publishes 40 packages and `oz-pos-app` is not one of them. The topology logic and every test this record cites now live in `kasirmu-bridge` (`apps/desktop-tauri`'s Cargo package is `kasirmu-app`). Repaired from `-p oz-pos-app` to `-p kasirmu-bridge`. Three `cargo test` lines were affected, not two. · MATCH, re-measured: all three named tests exist in the same wired module — `semantic_save_rejects_mismatched_non_location_wire` at `crates/kasirmu-bridge/src/topology/topology_tests.rs:529`, `semantic_save_rejects_ticket_wire_from_non_kds_workspace` at `:571`, and the Restaurant POS → KDS acceptance case at `:442`; the module is reachable as `topology::model::topology_tests` (`crates/kasirmu-bridge/src/topology/model.rs:333-334`). Both cited UI test files exist. The Decision section describes four capability rules — stock/transfer terminating at a warehouse, ticket feeds running KDS → hardware, operation feeds Restaurant POS → KDS, hardware → hardware — plus the closed-matrix allowance for the not-yet-emitted `generic-out → generic-in` pair, and the dedicated `invalid-operation-source` error; all of these live in `crates/kasirmu-bridge/src/topology/semantics.rs`, which is the Apply-side semantic validator this record is about, so the record describes the right module under its former name. · NOT re-measured: the "English and Indonesian validation bundles include the incompatible-connection message" locale claim, which belongs to the i18n gate. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 3 — Semantic Wire Validation Parity

**Date:** 2026-08-09
**Status:** Implemented

## Problem

The editor's typed pairing table constrained newly authored wires, but the Rust Apply boundary validated only Branch Location ownership and KDS operation ownership. A caller could submit a semantically incompatible stock, transfer, ticket, or hardware wire directly to the command and persist it. The frontend also lacked validation for forged wires whose port pair was legal but whose node types could not produce or consume those ports.

## Decision

Validate every non-location semantic wire at both boundaries:

- The frontend reuses the same pairing matrix as drag gating and relationship selection.
- Node capabilities are checked in addition to port ids:
  - stock and transfer feeds terminate at a warehouse;
  - ticket feeds originate at KDS and terminate at hardware;
  - operation feeds remain Restaurant POS → KDS;
  - hardware connections remain hardware → hardware.
- The Rust Apply boundary mirrors those rules for direct IPC callers.
- Location wires retain their specialized ownership and cardinality validation.
- KDS operation wires retain the dedicated `invalid-operation-source` error so the user receives precise guidance.
- The future-facing `generic-out → generic-in` pair remains allowed by the closed semantic matrix, even though no current node emits it.

## Verification

- Frontend tests cover matrix compatibility, invalid port/relationship combinations, invalid ticket endpoints, and valid stock routing.
- Rust tests cover invalid semantic pairs, invalid ticket producers, valid stock routing, and valid Restaurant POS → KDS operation feeds.
- English and Indonesian validation bundles include the incompatible-connection message.
- `npm run test -- src/__tests__/topologyCard.test.ts src/__tests__/topologyContract.test.ts`
- `cargo test -p kasirmu-bridge semantic_save_rejects_mismatched_non_location_wire --lib`
- `cargo test -p kasirmu-bridge semantic_save_rejects_ticket_wire_from_non_kds_workspace --lib`
- `cargo test -p kasirmu-bridge semantic_save_accepts_kds_operation_feed_from_restaurant_pos --lib`
- `npm run typecheck`
- `npm run lint -- --quiet`

> last audited 29-09-26 by docs-auditor
