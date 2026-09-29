<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass, and the Verification section is unusually falsifiable, so it was checked rather than believed. "Rust semantic save test rejects the same cycle at the Apply boundary" resolves exactly: `semantic_save_rejects_directed_operational_cycle` at `crates/kasirmu-bridge/src/topology/topology_tests.rs:828`, building a two-wire `cycle_wires` fixture with `wire-cycle-a` / `wire-cycle-b` — the two-node cycle the record describes. The localized `cycle-detected` message is real on the frontend side (`ui/src/features/locations/topologyContract.ts`, with coverage in `ui/src/__tests__/topologyContract.test.ts`, `nodeTopologyEditorHelpers.test.ts` and `topologyValidationWidget.test.tsx`) and cycle handling is present across the Rust boundary modules (`crates/kasirmu-bridge/src/topology/persistence.rs` and `semantics.rs`, plus `crates/kasirmu-core/src/topology.rs`). The decision that wire direction markers stay presentation-only while persisted `from_node_id → to_node_id` drives the check is consistent with the test naming the cycle as *directed operational*. · No command lines in this record referenced a stale package, so nothing needed repairing. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 5 — Directed Cycle Validation

**Date:** 2026-08-09
**Status:** Implemented

## Problem

The topology contract validated ownership, semantic pairings, and node capabilities, but it allowed a directed operational cycle to reach Apply. A cycle makes route compilation ambiguous and can cause runtime adapters to repeatedly forward the same work between workspace instances.

## Decision

Both validation boundaries reject directed graph cycles:

- The frontend runs a deterministic depth-first cycle check for immediate editor feedback.
- The Rust Apply boundary runs an independent Kahn topological check so direct IPC callers cannot bypass the rule.
- The graph uses persisted `from_node_id → to_node_id` semantics; wire direction markers remain presentation-only as defined by the existing contract.
- The error identifies a node involved in the cycle and uses the localized `cycle-detected` message.
- Missing endpoints are handled by the existing unknown-endpoint validator and do not create false cycle reports.

## Verification

- Frontend topology contract test rejects a two-node operational cycle.
- Rust semantic save test rejects the same cycle at the Apply boundary.
- Existing topology contract tests remain green.
- Rust formatting, i18n lint, and diff checks pass.

> last audited 29-09-26 by docs-auditor
