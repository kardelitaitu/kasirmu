<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Full audit; prior 2026-09-29 stamp merged below as original evidence. · MINOR (a cited test file that no longer exists): the 2026-09-29 stamp listed \`ui/src/__tests__/NodeTopologyEditor.test.tsx\` as covering the ambiguous-legacy-wire rule. That file was DELETED by \`20da3835c\`, which split the monolithic editor suite into focused files so vitest can parallelise it; it is absent from the tree and from \`git ls-files\`. The behaviour is still covered, at \`ui/src/__tests__/nodeTopologyEditorWiresAndShortcuts.test.tsx\` and \`nodeTopologyEditorWarehouseAndCanvas.test.tsx\` (the \`ambiguous-legacy-wire\` code is referenced from both) plus \`topologyContract.test.ts\`. A dated correction note was added under the Decision; the deleted filename was NOT silently swapped, because which suite owns the case is the useful fact. · VERIFIED AND LEFT ALONE: the \`ambiguous-legacy-wire\` code is real and enforced at both boundaries the Decision claims — frontend at \`ui/src/features/locations/topologyContract.ts:624-625\` (\`code: 'ambiguous-legacy-wire'\` → \`messageId: 'topology-validation-ambiguous-legacy-wire'\`, resolved in \`shared-ui/locales/multi-location.ftl:348\` AND \`multi-location.id.ftl:346\`, which is the repairable localized message), and Rust at \`crates/kasirmu-core/src/topology.rs\` with the Apply test in \`crates/kasirmu-bridge/src/topology/topology_tests.rs\`. The migration helper consuming the code is \`ui/src/features/locations/nodeTopologyEditorMigration.ts:5,96,103\`. The four known legacy identity mappings line up with the semantic vocabulary in \`crates/kasirmu-core/src/topology.rs\` and the \`stock-routing\` relationship in \`crates/kasirmu-bridge/src/pos.rs\`. The "unknown endpoints use the structural error, not the ambiguous one" precedence claim is consistent with the dedicated \`unknown-wire-endpoint\` code emitted separately at \`topologyContract.ts:601\`. · NOT re-measured: runtime behaviour against a live DB. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body(ies) kept verbatim as blockquote text:
Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The `ambiguous-legacy-wire` error this record centres on is real and enforced at BOTH boundaries the Decision claims, which is the specific thing worth verifying: frontend at `ui/src/features/locations/nodeTopologyEditorMigration.ts` (with `ui/src/__tests__/NodeTopologyEditor.test.tsx` and `ui/src/__tests__/topologyContract.test.ts` covering it), and Rust at `crates/kasirmu-core/src/topology.rs` and `crates/kasirmu-bridge/src/topology/topology_tests.rs`. The "unknown endpoints continue to use the existing structural error instead of being misclassified as ambiguous" distinction is a claim about error precedence between two validators, and the fact that the code is duplicated across both a core module and a bridge test file is consistent with two independent validators existing. The four known legacy identity mappings (Branch Location → Location, warehouse → stock routing, Restaurant POS → KDS operation feed, KDS → hardware ticket routing) line up with the semantic vocabulary this same batch confirmed elsewhere in `crates/kasirmu-bridge/src/topology/semantics.rs` and with the `stock-routing` relationship in `crates/kasirmu-bridge/src/pos.rs`. · No repairs needed. · No stamp or footer existed on this file before this pass.
-->

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

> *Test-location correction (2026-10-11, docs-auditor):* the frontend coverage for
> this rule moved. `ui/src/__tests__/NodeTopologyEditor.test.tsx`, named in the
> 2026-09-29 stamp, was **deleted and split** by `20da3835c` ("test(locations):
> split the topology editor suite so vitest can parallelise it") into focused
> suites. In the split, the `ambiguous-legacy-wire` assertions now live in
> `ui/src/__tests__/nodeTopologyEditorWiresAndShortcuts.test.tsx` and
> `nodeTopologyEditorWarehouseAndCanvas.test.tsx` (both reference the code), with
> the contract-level coverage still in `ui/src/__tests__/topologyContract.test.ts`.
> The migration helper that consumes the code is unchanged:
> `ui/src/features/locations/nodeTopologyEditorMigration.ts:103` filters on
> `e.code === 'ambiguous-legacy-wire'`.

All other geometry-only wires with resolvable endpoints are rejected at Apply with `ambiguous-legacy-wire`. The frontend reports a repairable localized message instructing the user to delete and reconnect the wire using labeled ports. The Rust boundary enforces the same rule for direct IPC callers. Unknown endpoints continue to use the existing structural error instead of being misclassified as ambiguous.

## Verification

- Frontend contract test covers an ambiguous legacy workspace-to-workspace wire.
- Rust semantic save test rejects the same wire.
- Existing legacy Branch Location → workspace compatibility remains covered by the topology command suite.
- Rust formatting, i18n lint, and diff checks pass.

> last audited 11-10-26 by docs-auditor
