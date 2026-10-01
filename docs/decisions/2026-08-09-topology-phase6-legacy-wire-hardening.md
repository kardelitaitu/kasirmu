<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The `ambiguous-legacy-wire` error this record centres on is real and enforced at BOTH boundaries the Decision claims, which is the specific thing worth verifying: frontend at `ui/src/features/locations/nodeTopologyEditorMigration.ts` (with `ui/src/__tests__/NodeTopologyEditor.test.tsx` and `ui/src/__tests__/topologyContract.test.ts` covering it), and Rust at `crates/kasirmu-core/src/topology.rs` and `crates/kasirmu-bridge/src/topology/topology_tests.rs`. The "unknown endpoints continue to use the existing structural error instead of being misclassified as ambiguous" distinction is a claim about error precedence between two validators, and the fact that the code is duplicated across both a core module and a bridge test file is consistent with two independent validators existing. The four known legacy identity mappings (Branch Location → Location, warehouse → stock routing, Restaurant POS → KDS operation feed, KDS → hardware ticket routing) line up with the semantic vocabulary this same batch confirmed elsewhere in `crates/kasirmu-bridge/src/topology/semantics.rs` and with the `stock-routing` relationship in `crates/kasirmu-bridge/src/pos.rs`. · No repairs needed. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 6 — Legacy Wire Hardening

**Date:** 2026-08-09
**Status:** Implemented

## Problem

Legacy topology rows may contain only geometric endpoints. Known identities can be migrated safely, but an arbitrary workspace-to-workspace wire has no reliable semantic meaning. The frontend already folded these rows to `legacy-out → legacy-in`, while the backend's legacy compatibility path could still persist them because semantic validation was skipped when no semantic fields were present.

## Decision

Known legacy identities remain loadable and saveable:

- Branch Location → workspace → Location;
- workspace → warehouse → stock routing;
- Restaurant POS → KDS → operation feed;
- KDS → hardware → ticket routing.

All other geometry-only wires with resolvable endpoints are rejected at Apply with `ambiguous-legacy-wire`. The frontend reports a repairable localized message instructing the user to delete and reconnect the wire using labeled ports. The Rust boundary enforces the same rule for direct IPC callers. Unknown endpoints continue to use the existing structural error instead of being misclassified as ambiguous.

## Verification

- Frontend contract test covers an ambiguous legacy workspace-to-workspace wire.
- Rust semantic save test rejects the same wire.
- Existing legacy Branch Location → workspace compatibility remains covered by the topology command suite.
- Rust formatting, i18n lint, and diff checks pass.

> last audited 29-09-26 by docs-auditor
