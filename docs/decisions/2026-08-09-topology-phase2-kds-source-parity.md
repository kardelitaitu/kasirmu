<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Full audit; prior 2026-09-29 stamp merged below as original evidence. · MINOR (module attribution, repaired with a note): the record's semantic rules are enforced by \`crates/kasirmu-core/src/topology.rs\` — \`invalid-operation-source\` is produced at \`topology.rs:761\` — while the module both earlier stamps named, \`crates/kasirmu-bridge/src/topology/semantics.rs\`, is the thin adapter that maps the core error onto the wire shape (\`semantics.rs:39-40\` calls \`kasirmu_core::topology::validate_semantic_json\`). The claim is true; the coordinate was one level up the stack. A dated note was added under the Decision paragraph rather than rewriting it, since the record is right about the boundary and only imprecise about the file. · VERIFIED AND LEFT ALONE: both named tests exist and are wired — \`semantic_save_rejects_operation_feed_from_non_restaurant_pos\` at \`crates/kasirmu-bridge/src/topology/topology_tests.rs:479\` and \`semantic_save_accepts_kds_operation_feed_from_restaurant_pos\` at :442, reachable as \`topology::model::topology_tests\` (\`model.rs:333-334\`); both cited UI test files exist; the frontend contract carries the code and its message id (\`ui/src/features/locations/topologyContract.ts:833-834\` → \`topology-validation-invalid-operation-source\`). The bundle-parity claim re-measured TRUE: \`shared-ui/locales/multi-location.ftl\` and \`multi-location.id.ftl\` both carry the key and are key-for-key identical (408 keys each, zero divergence). · NOT re-measured: the runtime behaviour of a save against a live DB. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body(ies) kept verbatim as blockquote text:
Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 major, 0 minor) · Audited on branch 0.0.40. MAJOR, proven by execution: `cargo pkgid -p oz-pos-app` returns "error: package ID specification `oz-pos-app` did not match any packages" — the workspace publishes 40 packages and `oz-pos-app` is not one of them. The topology logic and every test this record cites now live in `kasirmu-bridge` (`apps/desktop-tauri`'s Cargo package is `kasirmu-app`). Repaired from `-p oz-pos-app` to `-p kasirmu-bridge`. · MATCH, re-measured: both named tests exist and are wired to a live module — `semantic_save_rejects_operation_feed_from_non_restaurant_pos` at `crates/kasirmu-bridge/src/topology/topology_tests.rs:479` and `semantic_save_accepts_kds_operation_feed_from_restaurant_pos` at `:442`, reachable as `topology::model::topology_tests` via `crates/kasirmu-bridge/src/topology/model.rs:333-334`. Both cited UI test files exist: `ui/src/__tests__/topologyCard.test.ts` and `ui/src/__tests__/topologyContract.test.ts`. The `invalid-operation-source` error code the Decision section centres on is carried by the same semantic module the tests exercise, and the Decision text itself — the `generic` relationship, the `operation-out` source port, and the `typeKey = restaurant-pos` requirement — is a description of rules in `crates/kasirmu-bridge/src/topology/semantics.rs`, which is where the semantic Apply boundary now lives. · NOT re-measured: the "English and Indonesian validation bundles remain bundle-parity complete" claim is a locale assertion and belongs to the i18n gate, not to a doc audit; it is left as a statement the bundle-parity gate can confirm or deny. · No stamp or footer existed on this file before this pass.
-->

# ADR: Topology Phase 2 — KDS Operation Source Parity

**Date:** 2026-08-09
**Status:** Implemented

## Problem

The editor pairing table allowed `location-out → operation-in`, and both frontend and backend validation accepted any `generic → operation-in` wire for a KDS. This allowed a Branch Location or a non-restaurant workspace to appear operationally connected to a KDS, even though the intended contract is Restaurant POS `operation-out → operation-in`.

## Decision

A KDS Operation In connection is valid only when:

- the wire relationship is `generic`;
- the source port is `operation-out`; and
- the source workspace has `typeKey = restaurant-pos`.

The Branch Location pairing to `operation-in` is removed. Both the pure frontend contract and the Rust Apply boundary report `invalid-operation-source` for an invalid source, while preserving the existing missing and multiple input errors.

> **Where the Rust rule is actually enforced (2026-10-11, docs-auditor).** This
> record and its siblings describe the boundary as `kasirmu-bridge`'s
> `topology/semantics.rs`. That file is real and is the IPC-boundary adapter —
> `validate_semantic_json` maps a core failure onto the wire error
> (`crates/kasirmu-bridge/src/topology/semantics.rs:39-40`) — but it **delegates**:
> the code that decides `invalid-operation-source` is
> `crates/kasirmu-core/src/topology.rs:761`, and the whole semantic engine lives
> there. So the claim "the Rust Apply boundary reports invalid-operation-source"
> is TRUE; only the named module is one level up the stack from where the rule is
> written. Read `semantics.rs` as the adapter and `kasirmu_core::topology` as the
> engine.

## Verification

- Frontend semantic contract and pairing tests cover invalid sources.
- Rust semantic save tests cover invalid and valid Restaurant POS sources.
- English and Indonesian validation messages remain bundle-parity complete.
- `npm run test -- src/__tests__/topologyCard.test.ts src/__tests__/topologyContract.test.ts`
- `cargo test -p kasirmu-bridge semantic_save_rejects_operation_feed_from_non_restaurant_pos --lib`
- `cargo test -p kasirmu-bridge semantic_save_accepts_kds_operation_feed_from_restaurant_pos --lib`
- `npm run typecheck`
- `npm run lint -- --quiet`

> last audited 11-10-26 by docs-auditor
