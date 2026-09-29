<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 0 minor) · Audited on branch 0.0.40. MAJOR, proven by execution rather than by reading the manifest: the Verification section runs `cargo test -p oz-pos-app commands::topology::tests --lib`, and `cargo pkgid -p oz-pos-app` returns "error: package ID specification `oz-pos-app` did not match any packages". The workspace now publishes 40 packages and `oz-pos-app` is not among them; the desktop Tauri shell is `apps/desktop-tauri` and its Cargo package is `kasirmu-app`, while the topology logic and its tests live in `kasirmu-bridge`. The old module path has split in two as well, so the bare `commands::topology::tests` filter no longer resolves either: the branch-key and persistence cases are wired at `crates/kasirmu-bridge/src/topology/persistence.rs:967-969` as `mod topology_persistence_tests`, and the command round-trip cases at `crates/kasirmu-bridge/src/topology/model.rs:337` as `mod topology_command_tests`. Repaired to the package and the two module paths that actually exist. · MATCH, re-measured — the design claims in the body all still hold: the unscoped `oz-pos/topology` settings key is real and still documented as the legacy form, `apps/desktop-tauri/src/commands/topology/persistence.rs:232` and `:235` (with the command module doc at `apps/desktop-tauri/src/commands/topology.rs:4` describing first-load migration into it); and `store_profile_id`, the field this record says proves a legacy diagram belongs to a branch, is present across the bridge layer — `crates/kasirmu-bridge/src/topology/commands.rs`, `persistence.rs`, `semantics.rs`, `topology_persistence_tests.rs` and `topology_tests.rs`. The tests matching the described coverage are all present in `topology_persistence_tests.rs`: `topology_key_does_not_interfere_with_other_settings` (line 162, key isolation), `runtime_setting_key_branch_scoped_appends_branch_id` (608), `runtime_setting_key_rejects_arbitrary_key_without_prefix` (619, invalid key characters), `runtime_setting_key_rejects_empty_branch_suffix` (627) and `template_roundtrips_under_its_branch_key` (639, legacy branch matching). · All four cited UI test files exist: `ui/src/__tests__/api-ipc-contract.test.ts`, `TopologyScreen.test.tsx`, `topologyCard.test.ts`, `topologyContract.test.ts`. · Noted for the next lane, not acted on: `crates/kasirmu-bridge/src/topology/persistence_tests.rs` and `topology_command_tests.rs` carry uncommitted edits from a concurrent session as this pass ran, so test counts in that area are moving underneath any audit that tries to pin them. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 1 — Branch-Scoped Persistence

**Date:** 2026-08-09
**Status:** Implemented

## Problem

Topology diagrams were persisted under one global `oz-pos/topology` settings key. Selecting a different Branch Location changed the editor view, but saving one branch could overwrite the diagram for every other branch.

## Decision

Branch-aware topology commands derive a dedicated settings key:

```text
oz-pos/topology/<branch-id>
```

The UI passes the active branch through load and Apply IPC calls. The backend validates the branch identifier, persists the diagram under that branch key, and rejects an Apply when the requested branch differs from the semantic Branch Location in the graph.

The old unscoped key remains available for compatibility with legacy callers. A legacy diagram is read for a branch only when its canonical `store_profile_id` proves that it belongs to that branch; ambiguous geometry is never copied into a branch by guesswork.

Apply recovery journals the branch identity so compensation restores the same branch-specific key after a failed cross-database mutation.

## Verification

- UI IPC contract tests cover branch arguments.
- The editor passes the active branch to topology loading.
- TopologyScreen passes the selected branch to Apply.
- Rust unit tests cover key isolation, invalid key characters, legacy branch matching, and the Tauri command round trip.
- `cargo test -p kasirmu-bridge topology::persistence::topology_persistence_tests --lib`
- `cargo test -p kasirmu-bridge topology::model::topology_command_tests --lib`
- `npm run test -- src/__tests__/api-ipc-contract.test.ts src/__tests__/TopologyScreen.test.tsx`
- `npm run typecheck`
- `npm run lint -- --quiet`

> last audited 29-09-26 by docs-auditor
