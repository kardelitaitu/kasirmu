# Phase 4 Implementation Tickets — Strict Namespace Firewall

**Status:** Draft for execution (2026-10-03) — tickets only, no code changed by this document
**Scope:** Plan §10 "Phase 4 — Strict Namespace Firewall" (`todo-modular-scaffolding.md:800-824`) and the
governance gates it leaves open (§11.2), which ask that the module boundaries stop being a convention
and start being mechanically enforced.

**Predecessors:**
- `docs/architecture/phase3-implementation-tickets.md` — Phase 3 is closed (P3.1–P3.5); the modules are
  wrapped on `NamespacedStore`, the core size ratchet is live at 36590, and the frozen cross-vertical
  edge is a single declared grant.
- `docs/architecture/namespaced-store-api-draft.md` §10 — "What would make this enforceable (Phase 4)",
  the four-item list this phase executes.
- `docs/architecture/reporting-facade-inventory.md` §5 (the narrow trait shape) and §7 (the bypass set,
  now empty).
- `docs/architecture/module-boot-sequence.md` §6 — the two hatches Phase 4 closes (`raw()` and undeclared
  capabilities).

**Grounding rule (kept from Phases 0–3):** every ticket names a repository fact verified at the time of
writing. Where the plan's prose disagrees with the tree, the tree wins and the disagreement is recorded.

**Verified population at write time** (`python scripts/verify-namespace-governance.py --json`):
55 module source files scanned; 1 cross-vertical reference (loyalty → `gift_cards`), frozen and granted
with a declared dependency; 0 undeclared-dependency notes; 0 stale grants; 0 unowned-table blockers.
`python scripts/verify-core-size.py` measures 36590 production lines across 176 files (ceiling 36590).
`grep` finds **no** `trait ReportingFacade` and `NamespacedStore::raw()` is `crates/kasirmu-core/src/db/namespaced.rs:306`.

---

## 1. How these tickets map to the plan

| Plan §10 Phase 4 item | Ticket |
|---|---|
| Enable strict `NamespacedStore` enforcement | P4.1 — make the wrap strict at boot (manifest half DONE) |
| Reject unauthorized cross-namespace table access | P4.1 + P4.4 — strict `check_statement` and denial tests |
| Require reporting queries to go through `ReportingFacade` | P4.2 — define and route the trait (DONE) |
| Remove legacy shared-connection escape hatches | P4.3 — delete `raw()` |
| Add CI gate that fails on new namespace violations | P4.5 — flip `namespace-governance` from soft to strict (DONE) |
| Add CI gate that ratchets `kasirmu-core` size downward | **DONE** (Phase 3 P3.4, gate `core-size-ratchet`) |
| Add CI gate that requires handler classification metadata | **DONE** (gate `namespace-governance` Rule 2) |
| Add tests for cross-vertical access denial | P4.4 |
| Document migration completion criteria | P4.6 |

The two gate rows already shipped in Phase 3 because they are structural and do not depend on strict
enforcement. The remaining tickets are ordered by **risk**: first close the unchecked-SQL hatch (P4.3)
because it is the one route around every other check, then make the runtime check strict (P4.1), then the
reporting facade (P4.2), then the tests (P4.4), gate flip (P4.5), and documentation closure (P4.6).

---

## 2. P4.1 — Strict `NamespacedStore` enforcement

**Status: PARTIAL 2026-10-03 — manifest half done; the grant-derivation API and the boot-boundary
proof have landed; per-repository runtime wiring remains.**
Every `modules/*/manifest.json` now declares its `capabilities` set, derived mechanically from
`modules/ownership.json` + the manifest `dependencies` (`read:<id>` + `write:<id>` when the module owns
tables, plus `read:<dep>` per dependency — 36 capabilities across 14 manifests), and a new required gate
`capability-parity` (`scripts/gates.json`; step "capability parity" in `scripts/check.sh`) fails when a
manifest drifts. `scripts/verify-namespace-governance.py` gained `--check-capabilities` / `--emit-capabilities`
with the derivation in `derive_capabilities()`; `crates/kasirmu-core/tests/manifest_schema_test.rs`
`ALLOWED_FIELDS` now lists `capabilities` (the list had not been updated when the Phase 2 schema added the
property, so the test failed on the newly-populated manifests — fixed in the same commit). Item 2 has progressed: `Grants::from_capabilities(module, capabilities)`
(`crates/kasirmu-core/src/db/namespaced.rs`) now derives a read-grant set from a manifest capability list
(own `read:<id>`/`write:<id>` skipped; every other `read:<module>` interned as a foreign grant), and the boot
boundary at `platform/startup/tests/boot_capability.rs` derives the `reporting` grant set through it from the
real manifest, so the repository-side API and the boundary proof cannot disagree about `read:<module>`.
Item 2 is **not fully done**: each module still hardcodes `Grants::none()` / `Grants::read(...)` in its
repository constructor (122 `Repository::new(` call sites), with no manifest access at `NamespacedStore::new`
time, so production repositories do not yet route their grants from the manifest. Item 3 (reject a
`NamespacedStore` grant naming an undeclared module at `verify_capabilities`) also remains open — the
static `--check-capabilities` gate covers the manifest side, but the kernel does not see a module's
`Grants` at boot.

**Problem (verified).** The `NamespacedStore` boundary is advisory today: every module builds its store
with `Grants::none()` (or, for loyalty, one read grant), and `check_statement` refuses a foreign table —
but nothing *forces* a module to route its SQL through the store at all, and `Posture` permits a raw
`&Connection` through `raw()` (P4.3). The plan's exit criterion is "module boundaries are enforced by
build/tooling, not convention alone."

**Verified facts:**
- `crates/kasirmu-core/src/db/namespaced.rs` defines `NamespacedStore<'a>` (`own`/`read`/`grants`/`owner`/
  `conn`), `Namespace` handles, `Grants { read }`, `Posture { ReadWrite, ReadOnly }`,
  `check_statement(owner, grants, sql, posture)`, and `Namespace::query` / `query_try` / `execute`.
- `Namespace::raw()` at `crates/kasirmu-core/src/db/namespaced.rs:306` returns SQL unchanged for a named
  own table and `Err(Foreign)` otherwise — the migration hatch (removed in P4.3).
- Every wrapped module's manifest declares no capabilities yet (`grep capabilities modules/*/manifest.json`
  finds the field defaulted to empty), so the capability half of the firewall is wired but unpopulated.

**Ticket P4.1 — make the boundary fail-closed and capability-backed.**

1. Populate `capabilities` in each `modules/*/manifest.json` for the tables it reads/writes, using the
   `namespace:action` vocabulary from `platform/kernel/src/capability.rs` (`read:inventory`,
   `write:sales`, …) — the manifest field already exists and is validated against
   `docs/specs/module-manifest.schema.json`.
2. Route the grant set from the manifest at wrap time, so a code-level `Grants` entry with no manifest
   declaration fails boot (draft §9 open question 3) — this turns Phase 1 Rule 3 from a review rule into
   a mechanical check.
3. Have `Kernel::verify_capabilities` reject, in addition to a required-but-ungranted capability, a
   `NamespacedStore` grant that names a module the manifest does not depend on.

**Files:** `modules/*/manifest.json`, `platform/kernel/src/{capability.rs,context.rs,manifest.rs}`,
`platform/kernel/src/kernel/lifecycle.rs`, `crates/kasirmu-core/src/db/namespaced.rs`.

**Acceptance criteria:**
- Each module boots only when every table it touches is covered by a declared capability.
- A fixture module whose `Grants` names an undeclared dependency fails `load_all` with a named error.
- `cargo test -p platform-kernel -p kasirmu-core` green; `cargo check --workspace --all-targets` clean.

**Depends on:** P4.3 (remove the hatch first, or the strict check has a bypass). **Blocks:** P4.5.

---

## 3. P4.2 — Define and route `ReportingFacade`

**Status: DONE 2026-10-03.** `trait ReportingFacade` now lives in
`crates/kasirmu-core/src/db/facade.rs` (re-exported as `kasirmu_core::ReportingFacade`), implemented for
`Store<'_>` by delegating to the inherent methods. The four families are `daily_revenue`, `hourly_heatmap`
(operational summary), `top_products` (product rollups), and `low_stock_alerts_at_location` (stock
alerts) — the plan's `low_stock_alerts` is `#[deprecated]`, so the trait takes its successor rather than
freezing the deprecation (recorded in `docs/architecture/reporting-facade-inventory.md` §5). The one
sanctioned write (`acknowledge_stock_alert`) is deliberately NOT on the trait: it is a READ contract.
`facade_tests.rs` binds all four through the trait and pins the count at four. The live bridge consumer
surface routes its four family call sites through `ReportingFacade::` explicitly
(`crates/kasirmu-bridge/src/reports.rs` `get_daily_revenue`, `get_top_products`, `get_hourly_heatmap`,
`get_low_stock_alerts`). `cargo test -p kasirmu-core --lib facade` 4 pass; `cargo test -p kasirmu-bridge
reports` 53 pass; clippy `-D warnings` clean on both crates.

**Problem (verified).** Plan §9.5 and §11.2 require "reporting queries to go through `ReportingFacade`".
`grep -rn 'trait ReportingFacade'` finds **no** such trait in the tree; the capability ships as inherent
methods on `Store` in `crates/kasirmu-core/src/db/reports/` (submodules `datetime`, `revenue`,
`sales_summary`, `product_sales`), re-exported through `crates/kasirmu-core/src/db/reports.rs`.

**Verified facts:**
- `crates/kasirmu-core/src/db/reports/revenue.rs:133` `daily_revenue(...)`.
- `crates/kasirmu-core/src/db/reports/product_sales.rs:151` `top_products`, `:219` `low_stock_alerts`,
  `:355` `acknowledge_stock_alert` (the one sanctioned write on `stock_alert_events`).
- `crates/kasirmu-core/src/db/reports/sales_summary.rs:171` `hourly_heatmap`, `:394` `discounts_summary`,
  and the other operational rollups — 24 inherent methods in total
  (`docs/architecture/reporting-facade-inventory.md` §5).
- `docs/architecture/reporting-facade-inventory.md` §5 fixes the trait at the plan's **four** methods:
  `daily_revenue`, `sales_summary`, `product_sales`, `low_stock_alerts` — narrow by decision.

**Ticket P4.2 — a trait of four methods, implemented by `Store`, with callers routed through it.**

1. Define `trait ReportingFacade` with the four method families from inventory §5, in a core module
   beside `reports.rs`, and implement it for the concrete reporting surface.
2. Route the reporting paths that read across verticals through the trait rather than the concrete
   submodule types, so "the facade is the only broad read path" is a type-level fact.
3. Keep `acknowledge_stock_alert` (product_sales.rs:355) as the one named write, per amended ADR-62 D5.

**Files:** `crates/kasirmu-core/src/db/reports.rs` (and a new `facade.rs` sibling), callers in
`platform/` and `apps/`.

**Acceptance criteria:**
- `trait ReportingFacade` exists with exactly the four families; a test pins the method count so a fifth
  family is a deliberate, reviewed edit.
- Reporting callers resolve the facade, not the concrete submodule types.
- `cargo test -p kasirmu-core` green.

**Depends on:** P4.1 (the namespace grant is what makes a foreign read a façade call rather than a raw
one). **Blocks:** P4.6.

---

## 4. P4.3 — Remove the `NamespacedStore::raw()` escape hatch

**Status: DONE 2026-10-03.** `Namespace::raw()` was deleted from
`crates/kasirmu-core/src/db/namespaced.rs` together with its two tests
(`raw_returns_sql_after_check`, `raw_rejects_a_foreign_table`) in
`crates/kasirmu-core/src/db/namespaced_tests.rs`; `grep -rn "\.raw("` over `crates/` `modules/`
`platform/` now finds no `NamespacedStore` caller (only the unrelated `StoredCipher::raw()` and
`PgTransport::new_raw`). `cargo test -p kasirmu-core --lib namespaced` 22 pass, clippy `-D warnings`
clean, and the core-size ceiling was lowered 36590 → 36586 (the four removed production lines) via
`--emit-baseline` in the same commit. The foreign-table rejection the removed test asserted is still
covered by `foreign_write_is_refused_before_touching_the_db` and the per-module boundary tests.
Also in that commit: the header comment in `namespaced.rs` and the compatibility-window notes in
`docs/architecture/{namespaced-store-api-draft.md,module-boot-sequence.md,phase2-implementation-tickets.md}`
were updated to say the hatch is gone, and `todo-modular-scaffolding.md` line 750 no longer claims it
remains.

**Problem (verified).** `Namespace::raw()` at `crates/kasirmu-core/src/db/namespaced.rs:306` returns SQL
unchanged for an own table and is the only remaining route to unchecked SQL — the exact hatch the draft
(`namespaced-store-api-draft.md` §10) and `module-boot-sequence.md` §6 say Phase 4 closes. Every module
can currently bypass the parse-and-validate step by calling `raw()`.

**Ticket P4.3 — delete the method, not deprecate it.**

1. Delete `raw()` and its tests; add a compile-time or test assertion that no caller remains.
2. Where a caller genuinely needs a statement shape `check_statement` cannot express, widen the typed
   surface (a named `query`/`execute` variant) rather than reintroduce a raw path.

**Files:** `crates/kasirmu-core/src/db/namespaced.rs`, `crates/kasirmu-core/src/db/namespaced_tests.rs`.

**Acceptance criteria:**
- `grep -rn '::raw(' crates/ modules/ platform/` returns no `NamespacedStore` caller.
- `cargo test -p kasirmu-core --lib namespaced` green.
- The core-size ceiling drops by the number of lines removed (a deliberate `--emit-baseline` edit).

**Depends on:** none (do it first). **Blocks:** P4.1, P4.5.

---

## 5. P4.4 — Cross-vertical access-denial tests

**Status: DONE 2026-10-03.** Item 1 was already satisfied by the Phase 3 wraps: all 8 boundary tests
(`modules/{terminal,settings,loyalty,staff,tax,crm,sales,inventory}/src/repository_tests.rs`) assert the
error payload, e.g. `matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales")`, and
`NamespaceError::Foreign` carries `{ table, owner, self_owner }` (`crates/kasirmu-core/src/db/namespaced.rs:87`),
so the failure names the table AND the owner. Item 2 landed as two tests in
`platform/startup/tests/boot_capability.rs`: `real_manifests_declare_a_grant_only_for_a_declared_dependency`
(every `read:<dep>` in a real manifest must name a declared dependency — the test-level companion to the
`capability-parity` gate) and `a_module_cannot_read_a_table_outside_its_declared_capabilities` (builds a
`NamespacedStore` for `reporting` from its manifest's declared read grants, proves `sales` passes, and proves
`loyalty_accounts` — owned by a vertical reporting never declares — is refused with `Foreign`).
`cargo test -p platform-startup --test boot_capability` 6 pass; clippy `-D warnings` clean.

**Problem.** Phase 3 added per-module own-passes / foreign-refused boundary tests, but the plan's Phase 4
task "Add tests for cross-vertical access denial" wants the *strict* path proven: a foreign read fails,
and the failure names the table and the owner.

**Ticket P4.4 — a denial test per boundary, plus one end-to-end.**

1. For each wrapped module, extend the boundary test to assert the *error payload* names the foreign
   table (`NamespaceError::Foreign { table }`).
2. Add one boot-path integration test under `platform/startup/tests/` that boots the real module set and
   asserts a module cannot read a table outside its manifest-declared capabilities.

**Files:** each wrapped module's `src/repository_tests.rs`; `platform/startup/tests/` (extend
`boot_capability.rs`).

**Acceptance criteria:**
- Every denial test fails if the grant is widened; proven by a temporary widening on one module.
- `cargo test -p platform-startup` green.

**Depends on:** P4.1. **Blocks:** P4.5.

---

## 6. P4.5 — Flip the namespace gate from soft to strict

**Status: DONE 2026-10-03.** `scripts/verify-namespace-governance.py` gained a `--strict` flag; the
promotion is a named `promote_strict(findings)` helper that turns each `undeclared-dependency` note
(Rule 3) into a `verdict` so it flows through `apply_baseline` and blocks unless baselined. The
`namespace-governance` gate step now runs `--strict` (`scripts/check.sh`), the gate `_note` records the
flip, and `docs/architecture/module-namespace-governance.md` §Rule 3 / §5 were updated (they had said
"review rule today" and "no vertical manifest declares capabilities today", both now false).
Mutation-proven: adding `let _ = conn.prepare("SELECT id FROM loyalty_accounts")` to
`modules/settings/src/repository.rs` (deps `[]`) makes soft report 1 blocking + 1 informational while
`--strict` reports 2 blocking + 0 informational; reverting restores byte-identical output. `--self-test`
now also covers the promotion (3 new checks); strict reports 0 blockers on the real tree
(1 frozen edge, 0 undeclared edges). `verify-runner-commands`, `verify-runner-claims`,
`verify-ci-docs-drift`, `verify-selftests-wired` all green.

**Problem (verified).** `scripts/verify-namespace-governance.py` Rule 1 fails only on a *new* edge
(`--json` `new_blocking`), and Rule 3 (undeclared dependency) is informational. That is deliberate Phase 1
softness (`docs/architecture/module-namespace-governance.md` §4); §11.2 says strict enforcement is the
Phase 4 end state. The gate is already wired (`namespace-governance`, required, dev-ci static-gates).

**Ticket P4.5 — strict mode, driven by the ownership map.**

1. Add a `--strict` mode: an undeclared cross-vertical edge and an undeclared dependency both block, not
   just new ones.
2. Point the `namespace-governance` gate at `--strict` once P4.1–P4.4 make the population clean.
3. Keep the `--self-test` companion step; keep `namespace-governance-baseline.json` as the record of the
   sanctioned exception.

**Files:** `scripts/verify-namespace-governance.py`, `scripts/gates.json`, `scripts/check.sh`,
`docs/architecture/module-namespace-governance.md`.

**Acceptance criteria:**
- `--strict` reports 0 blockers on the real tree; the gate fails when a hand-added foreign read lands.
- `verify-ci-docs-drift` and `verify-selftests-wired` stay green.

**Depends on:** P4.1, P4.3, P4.4. **Blocks:** P4.6.

---

## 7. P4.6 — Document migration completion criteria

**Status: DONE 2026-10-03** — `docs/architecture/module-namespace-firewall.md` exists and states what is
mechanically true per plan §10/§13, with every claim pointing at a file:line or a gate id, plus an explicit
§7 "What is NOT yet true" recording the P4.1 runtime gap. Linked from
`docs/architecture/module-namespace-governance.md` §5 and `docs/architecture/module-boot-sequence.md` §9;
`check-dead-refs.py` clean. The plan §10/§13 boxes are ticked in `todo-modular-scaffolding.md`.

**Problem.** The plan's §13 acceptance criteria are a mix of delivered (Phases 0–3) and Phase 4 work;
without a written completion statement, "the firewall is done" is a judgement call.

**Ticket P4.6 — one page of completion criteria, dated and evidence-linked.**

1. Add `docs/architecture/module-namespace-firewall.md` (to be created) stating, per plan §10 exit
   criteria, exactly what is now mechanically true: strict `NamespacedStore` enforcement, no `raw()`,
   reporting through the facade, the strict gate, the core-size ceiling, and the capability declarations.
2. Link it from `docs/architecture/module-namespace-governance.md` and
   `docs/architecture/module-boot-sequence.md`; tick the corresponding plan §10/§13 boxes with the commit
   that made each true.

**Files:** `docs/architecture/module-namespace-firewall.md` (to be created); inbound links.

**Acceptance criteria:**
- Every claim on the page points at a file/line or a gate id that exists on the commit that lands it.
- `check-dead-refs.py` clean on the new page.

**Depends on:** P4.1–P4.5.

---

## 8. Sequencing

1. **P4.3** — delete `raw()`; the unchecked path is gone. (Smallest change, closes the bypass for
   everything after it.)
2. **P4.1** — strict, capability-backed enforcement; the boundary fails closed.
3. **P4.4** — the denial tests that prove P4.1.
4. **P4.2** — the reporting facade trait and routed callers.
5. **P4.5** — flip the gate to `--strict`.
6. **P4.6** — document the completion criteria and tick the plan.

Each ticket is independently reviewable and revertible. P4.3 and P4.1 are the load-bearing pair; the
rest build on them.

---

## 9. What this phase does not do

- It does **not** move the cross-vertical BOM deduction out of core
  (`crates/kasirmu-core/src/db/sales_lifecycle.rs`); lifting the ownership map into core to enable that is
  P4.1's manifest work, and the move itself is a later extraction.
- It does **not** split the shared SQLite connection; checkout stays synchronous and transactional on one
  connection (plan §9.1, `namespaced-store-api-draft.md` §8).
- It does **not** adopt SQLite `set_authorizer`; the draft (§8, §10) keeps it as a possible accelerator
  behind the table scan, not a replacement.

## References

- `todo-modular-scaffolding.md` §10 (Phase 4), §11.2 (namespace violation gate), §13 (acceptance criteria)
- `docs/architecture/phase3-implementation-tickets.md` (the closed predecessor phase)
- `docs/architecture/namespaced-store-api-draft.md` §8, §10 (what makes it enforceable)
- `docs/architecture/reporting-facade-inventory.md` §5 (trait shape), §6 (bypass set, now empty)
- `docs/architecture/module-boot-sequence.md` §6 (the two hatches Phase 4 closes)
- `crates/kasirmu-core/src/db/namespaced.rs` (the store this phase makes strict)