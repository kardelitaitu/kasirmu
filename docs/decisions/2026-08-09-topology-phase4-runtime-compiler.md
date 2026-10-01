<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The central claim — the branch-scoped runtime key `oz-pos/topology-runtime/<branch-id>` with an unscoped fallback of `oz-pos/topology-runtime` — is real, and unusually well defended: the unscoped constant has exactly ONE public definition, `pub const TOPOLOGY_RUNTIME_SETTING_KEY` at `crates/kasirmu-bridge/src/pos.rs:45` and `crates/kasirmu-bridge/src/topology/model.rs:259`, with a private sibling at `crates/kasirmu-bridge/src/kds.rs:27`, and two module docs (`apps/desktop-tauri/src/commands/topology.rs:42`, `crates/kasirmu-bridge/src/pos.rs:44`) explicitly assert the "exactly one definition" property the record relies on. The three Verification bullets all resolve to real tests: runtime-plan compilation and branch identity at `crates/kasirmu-bridge/src/topology/topology_persistence_tests.rs:535` (`runtime_plan_carries_target_node_kind_and_branch_id`) and `:572` (`runtime_plan_unscoped_has_null_branch_and_filters_non_operational`), and branch isolation at `:608` (`runtime_setting_key_branch_scoped_appends_branch_id`). The "saving an empty operational graph replaces the prior plan with an empty route list" claim is corroborated by the `runtime_plan_unscoped_has_null_branch_and_filters_non_operational` case, which is precisely the non-operational filtering the record describes. · The Follow-up section ("runtime adapters still need to consume the compiled plan") is now partly STALE in the doc's favour — Phase 7 and Phase 8, audited in this same batch, describe exactly the KDS consumer that closed it. Left as written, because a phase record states what was true when the phase landed; correcting it would rewrite history. Flagged here so a reader does not mistake it for an open item. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 4 — Runtime Route Compiler

**Date:** 2026-08-09
**Status:** Implemented

## Problem

The topology Apply flow persisted semantic wires only inside the editor diagram. Runtime code had no stable artifact containing operational routes, so a valid stock, transfer, ticket, hardware, or Restaurant POS → KDS connection could be visually correct while runtime adapters had nothing to consume.

## Decision

Every topology save now compiles non-location semantic wires into a branch-scoped runtime plan:

```text
oz-pos/topology-runtime/<branch-id>
```

The unscoped compatibility path is `oz-pos/topology-runtime`. Each route stores only stable runtime fields:

- wire ID;
- source workspace/instance ID;
- target workspace/instance ID;
- source and target semantic port IDs;
- relationship type.

Canvas coordinates, display names, labels, and geometric anchors are intentionally excluded. The diagram and runtime plan are written in the same SQLite transaction, and saving an empty operational graph replaces the prior plan with an empty route list so removed wires do not remain active in the runtime artifact.

The compiler runs after semantic and structural validation, so direct IPC callers cannot inject invalid runtime routes. Branch-scoped keys preserve the Phase 1 isolation guarantee.

## Follow-up

Runtime adapters still need to consume the compiled plan. The next runtime slice should connect one consumer, beginning with KDS ticket target selection or inventory route resolution, and add an end-to-end behavior test.

## Verification

- Runtime-plan compilation test covers Restaurant POS → KDS operation routing.
- Branch isolation test covers separate runtime keys for separate branches.
- Rust topology tests and formatting pass.

> last audited 29-09-26 by docs-auditor
