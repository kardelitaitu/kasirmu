<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Full audit; prior 2026-09-29 stamp merged below as original evidence. · MINOR (code-versus-message-key conflation, repaired in place): the Decision said "uses the localized \`cycle-detected\` message". \`cycle-detected\` is the ERROR CODE; the message key is \`topology-validation-cycle\` (\`ui/src/features/locations/topologyContract.ts:611-612\`), and it resolves in both bundles (\`shared-ui/locales/multi-location.ftl:347\`, \`multi-location.id.ftl:345\`). A reader grepping for \`topology-validation-cycle-detected\` finds nothing — which is exactly the check that was run here. The sentence now names both and records the distinction. · THE CENTRAL CLAIM WAS PROVEN BY READING THE ALGORITHM, NOT BY TRUSTING ITS NAME: "the Rust Apply boundary runs an independent Kahn topological check" is literally true — \`find_directed_cycle_node\` (\`crates/kasirmu-core/src/topology.rs:283-338\`) builds an adjacency map plus an indegree map, seeds a \`VecDeque\` with every zero-indegree node, drains it decrementing each target's indegree, and reports a member of the residual indegree-positive set (\`:330-337\`) — which IS Kahn's algorithm. An identifier search for "kahn"/"topological" returns nothing, so this claim is only verifiable by reading the body; recorded because a future auditor repeating the grep would wrongly conclude the claim is unsupported. The cycle gate fires at \`topology.rs:601-609\` with code \`cycle-detected\`, and the Apply test \`semantic_save_rejects_directed_operational_cycle\` (\`crates/kasirmu-bridge/src/topology/topology_tests.rs:828\`, asserting the code at :870) drives it through \`save_topology_json_at_key_with_revision\` with a two-wire \`cycle_wires\` fixture (\`wire-cycle-a\`/\`wire-cycle-b\`) — the two-node cycle the record describes. The frontend DFS is real at \`topologyContract.ts:493\` (\`findDirectedCycleNode\`, called at :608). The "missing endpoints are not misclassified as cycles" ordering claim is corroborated: the unknown-endpoint check is emitted first at \`topologyContract.ts:599-605\`, before the cycle check at :608. · NOT re-measured: runtime behaviour against a live DB. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body(ies) kept verbatim as blockquote text:
Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass, and the Verification section is unusually falsifiable, so it was checked rather than believed. "Rust semantic save test rejects the same cycle at the Apply boundary" resolves exactly: `semantic_save_rejects_directed_operational_cycle` at `crates/kasirmu-bridge/src/topology/topology_tests.rs:828`, building a two-wire `cycle_wires` fixture with `wire-cycle-a` / `wire-cycle-b` — the two-node cycle the record describes. The localized `cycle-detected` message is real on the frontend side (`ui/src/features/locations/topologyContract.ts`, with coverage in `ui/src/__tests__/topologyContract.test.ts`, `nodeTopologyEditorHelpers.test.ts` and `topologyValidationWidget.test.tsx`) and cycle handling is present across the Rust boundary modules (`crates/kasirmu-bridge/src/topology/persistence.rs` and `semantics.rs`, plus `crates/kasirmu-core/src/topology.rs`). The decision that wire direction markers stay presentation-only while persisted `from_node_id → to_node_id` drives the check is consistent with the test naming the cycle as *directed operational*. · No command lines in this record referenced a stale package, so nothing needed repairing. · No stamp or footer existed on this file before this pass.
-->

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
- The error identifies a node involved in the cycle and uses the localized
  `cycle-detected` **error code**. (Precision, 2026-10-11: the code and the
  message key differ — the frontend emits `code: 'cycle-detected'` with
  `messageId: 'topology-validation-cycle'` at `ui/src/features/locations/topologyContract.ts:611-612`,
  and the key resolves in `shared-ui/locales/multi-location.ftl:347` and
  `multi-location.id.ftl:345`. There is no key named `topology-validation-cycle-detected`.)
- Missing endpoints are handled by the existing unknown-endpoint validator and do not create false cycle reports.

## Verification

- Frontend topology contract test rejects a two-node operational cycle.
- Rust semantic save test rejects the same cycle at the Apply boundary.
- Existing topology contract tests remain green.
- Rust formatting, i18n lint, and diff checks pass.

> last audited 11-10-26 by docs-auditor
