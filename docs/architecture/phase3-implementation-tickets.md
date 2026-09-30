# Phase 3 Implementation Tickets — Vertical Extraction

**Status:** Draft for execution (2026-10-03) — tickets only, no code changed by this document
**Scope:** Plan §10 "Phase 3 — Vertical Extraction" (`todo-modular-scaffolding.md:764-795`), which asks that
business logic move out of `kasirmu-core` into owned modules, keeping cross-vertical reads behind facades
and checkout behaviour unchanged.

**Predecessors:**
- `docs/architecture/phase2-implementation-tickets.md` — Phase 2 is closed (P1–P5); the `NamespacedStore`,
  `ModuleContext` and the capability registry exist and are tested.
- `docs/architecture/namespaced-store-api-draft.md` §5 — the per-module wrap order (rows 2.1–2.4) this phase
  executes.
- `docs/architecture/reporting-facade-inventory.md` — the facade surface and its single bypass edge.
- `docs/architecture/module-namespace-governance.md` §3–§4 — the ownership map, the frozen edges, the checker.

**Grounding rule (kept from Phases 0–2):** every ticket names a repository fact verified at the time of
writing. Where the plan's prose disagrees with the tree, the tree wins and the disagreement is recorded.

**Verified population at write time** (`python scripts/verify-namespace-governance.py --json`):
59 module source files scanned; 2 cross-vertical references, both frozen and both carrying a T3 grant marker;
1 undeclared-dependency note (`modules/loyalty/src/repository.rs:59` → `gift_cards`, owned by `giftcards`);
0 stale grants; 0 unowned tables.

---

## 1. How these tickets map to the plan

| Plan §10 Phase 3 item | Ticket |
|---|---|
| Reporting facade consolidation | P3.1 — retire the reporting module's facade-bypass edge |
| Move owned SQL into module repositories | P3.2 — wrap the self-contained modules on `NamespacedStore` |
| Keep cross-vertical reads behind facades | P3.3 — make loyalty's gift-card read a declared grant |
| Ratchet `kasirmu-core` line count downward | P3.4 — add the core-size ratchet gate |
| Preserve behaviour through characterization tests | P3.5 — pin the extraction with boundary tests |

The plan's extraction order (reporting, inventory, sales, CRM, staff, tax/promotions, loyalty, terminal) is a
*priority*, not a dependency chain. These tickets order the work by **risk**: first the redundant surface with
no callers (P3.1), then the mechanical wraps whose code already names only its own tables (P3.2), then the one
genuine cross-vertical edge (P3.3), then the structural gate that keeps the ratchet honest (P3.4).

---

## 2. P3.1 — Retire the reporting module's facade-bypass edge

**Status: DONE 2026-10-03.** The redundant domain surface (`repository.rs`, `service.rs`, `models.rs`,
`error.rs` and their tests) was deleted — it had zero non-test callers and the live facade
`kasirmu_core::db::reports` already ships the capability. `modules/reporting/src/lib.rs` was rewritten to
the module shell that remains, the `modules/reporting/src/repository.rs` entry was removed from
`scripts/namespace-governance-baseline.json`, and the live docs
(`docs/architecture/reporting-facade-inventory.md` §3/§6,
`docs/architecture/module-namespace-governance.md` §4/§5) record the retirement. `--json` now reports
**1** frozen cross-vertical edge (loyalty) and `stale == 0`; `cargo test -p modules-reporting` 11 pass;
`cargo check --workspace --all-targets` clean.

**Problem (verified).** `modules/reporting/src/repository.rs:34` `generate_daily_report` reads `sales` with
its own SQL instead of the sanctioned facade `kasirmu_core::db::reports`. It is the **only** production
cross-vertical SQL in a module repository (`docs/architecture/reporting-facade-inventory.md` §3, §6): the
bypass set has exactly one member. It is baselined in `scripts/namespace-governance-baseline.json` and carries
the T3 marker `// namespace: cross-vertical read sales granted (…)`.

**Verified disposition facts:**
- `ReportingRepository`, `ReportingService` and `DailyReport` have **zero non-test callers**
  (`modules/reporting/src/lib.rs:33-49` records this; re-verified by grep at ticket time).
- The whole surface duplicates `kasirmu_core::db::reports`: `daily_revenue`
  (`crates/kasirmu-core/src/db/reports/revenue.rs:133`) aggregates the same `sales` rows with the correct
  currency grouping, UTC bucket and refund netting.
- The module shell (`ReportingModule`) is a **registered vertical** (`platform/startup/src/lib.rs`), and the
  registration block is pinned against `modules/*/manifest.json` by
  `every_module_manifest_is_registered` (`platform/startup/src/startup_tests.rs`). The shell stays; the
  domain surface goes.

**Ticket P3.1 — delete the bypass, not relocate it.**

The bypass set is one dead method whose capability already ships in the facade. The Phase 1 inventory's
disposition ("migrate onto `reports::revenue::daily_revenue`; delete the method, the marker and the baseline
entry together") is correct, and the migration is a deletion because nothing calls it:

1. Delete `generate_daily_report` from `modules/reporting/src/repository.rs`, with its T3 marker.
2. Delete `ReportingService::generate_daily_report` (`modules/reporting/src/service.rs:19`) and the
   `ReportingRepository`/`ReportingService` types if nothing else remains in them.
3. Remove the `modules/reporting/src/repository.rs:34` entry from `scripts/namespace-governance-baseline.json`.
4. Keep `ReportingModule` registered and keep `DailyReport` if any non-test consumer is found; otherwise
   remove the DTO with the rest and update `modules/reporting/src/lib.rs`'s redundancy paragraph to say the
   surface was retired rather than recorded.

**Files:** `modules/reporting/src/{repository.rs,service.rs,models.rs,lib.rs}`,
`modules/reporting/src/{repository_tests.rs,service_tests.rs}`, `scripts/namespace-governance-baseline.json`.

**Acceptance criteria:**
- `python scripts/verify-namespace-governance.py --json` reports **1** frozen cross-vertical edge (loyalty),
  down from 2; `stale_baseline == 0` (the removed entry is gone, not orphaned).
- `--census` still reports 12 rows / 0 stale (no handler lines moved).
- `cargo test -p modules-reporting` green after the test files are pruned to match.
- `cargo check --workspace --all-targets` clean.

**Depends on:** nothing. **Blocks:** P3.2 (ordering only — it proves the baseline can shrink).

---

## 3. P3.2 — Wrap the self-contained modules on `NamespacedStore`

**Problem.** The modules that name only their **own** tables still take a raw `&Connection` and prepare SQL
directly. Nothing stops a future edit from reaching into another vertical's table. The plan (§7.2/§9.3 Step 2)
wants each module's data access to go through a namespace it owns.

**Verified scope** (`namespaced-store-api-draft.md` §5 rows 2.1–2.2, re-checked against the tree):
- **crm** (`modules/crm/src/repository.rs`), **settings** (`modules/settings/src/repository.rs`),
  **staff** (`modules/staff/src/repository.rs`), **tax** (`modules/tax/src/repository.rs`),
  **terminal** (`modules/terminal/src/repository.rs`), **sales** (`modules/sales/src/repository.rs`),
  **inventory** (`modules/inventory/src/repository.rs`) — each names only tables it owns.
- `modules/inventory/src/handlers.rs` names other inventory-owned tables; the Phase 0 census found it
  **dead/test-only** (never registered), so it is out of scope and stays as-is.
- The genuinely cross-vertical BOM deduction lives in **core** (`crates/kasirmu-core/src/db/sales_lifecycle.rs`),
  not in a module, and is out of this API's scope until the ownership map is lifted into core.

**Ticket P3.2 — wrap one module at a time, prove the check passes before granting anything.**

For each module in the list: construct `NamespacedStore::new(Store::new(conn), ModuleId("<id>"),
Grants::none())`, replace the repository's raw `conn.prepare(...)` calls with `ns.own().prepare(...)` (or the
`Namespace` query/execute surface), and add a boundary test asserting an own-table read passes and a
foreign-table read returns `NamespaceError::Foreign`. Because every one of these modules names only its own
tables, the check can only pass — which is exactly what proves the wrapper before any grant exists.

**Files (one per module):** the module's `src/repository.rs` + its `repository_tests.rs`, and any
`service.rs` that threads the connection through.

**Acceptance criteria (per module):**
- `cargo test -p modules-<id>` green, including a new own-passes / foreign-refused boundary test.
- `cargo check --workspace --all-targets` clean.
- `python scripts/verify-namespace-governance.py --json` population unchanged (no new edge, no new note).

**Depends on:** P3.1 (proves the baseline can shrink first). **Blocks:** P3.3.

---

## 4. P3.3 — Make loyalty's gift-card read a declared grant

**Problem (verified).** `modules/loyalty/src/repository.rs:59` `get_gift_card_by_number` reads
`gift_cards` (owned by `giftcards`) but the dependency is **not declared** in
`modules/loyalty/manifest.json` (`dependencies = [crm]`). It is the single undeclared-dependency note in the
checker output. It carries a T3 grant marker, so the *read* is sanctioned; the *manifest declaration* is what
is missing.

**Ticket P3.3 — the grant becomes the declaration.**

1. Add `giftcards` to `modules/loyalty/manifest.json` `dependencies`.
2. Wrap the loyalty repository on `NamespacedStore` with `Grants { read: vec![ModuleId("giftcards")] }` and
   route `get_gift_card_by_number` through `ns.read(ModuleId("giftcards"))`.
3. Keep the T3 marker (the edge is still real and sanctioned) and keep the baseline entry only if the checker
   still needs it — with the declaration present, the `undeclared-dependency` note disappears.

**Files:** `modules/loyalty/src/repository.rs`, `modules/loyalty/src/repository_tests.rs`,
`modules/loyalty/manifest.json`, `modules/loyalty/Cargo.toml` (if `kasirmu-core` `namespaced` is not already
reachable).

**Acceptance criteria:**
- The `undeclared-dependency` note is **gone** from `--json` `informational`: `undeclared_edges == 0`.
- The frozen edge count is still 1, now with a declared dependency behind it.
- `cargo test -p modules-loyalty` green; `cargo test -p platform-kernel --test module_manifests` green
  (the manifest-dependency parity test now sees the new edge and must still find it registered).
- `--census` 12/0 unchanged.

**Depends on:** P3.2 (the wrapper must exist first). **Blocks:** P3.4.

---

## 5. P3.4 — Add the `kasirmu-core` size ratchet

**Problem.** Plan §11.1 ("Core Size Ratchet") and the Phase 3 task "Ratchet `kasirmu-core` line count
downward" have no gate. Without one, extraction can be silently undone by new logic landing in core.

**Ticket P3.4 — a measured ratchet, in the house style.**

1. Measure the current `kasirmu-core` production line count (excluding `tests` modules and test files) and
   record it as the ceiling in a checked-in baseline (to be created at `scripts/core-size-baseline.json`), the same shape
   as `namespace-governance-baseline.json`.
2. Add a checker (to be created at `scripts/verify-core-size.py`, or a mode on an existing script) that fails when the
   count **rises** above the ceiling, and prints the delta. Lowering the ceiling is a deliberate edit to the
   baseline, exactly as a namespace edge leaves the baseline.
3. Wire it into `scripts/gates.json` + `scripts/check.sh` under a new gate id.

**Files:** `scripts/verify-core-size.py` (to be created), `scripts/core-size-baseline.json` (to be created),
`scripts/gates.json`, `scripts/check.sh`.

**Acceptance criteria:**
- The checker fails when a line is added to a `kasirmu-core` production file and passes when removed; proven
  by a self-test that doctors a temporary copy (the Phase 1/2 checker self-test pattern).
- The gate appears in `--check`/`scripts/check.sh` and `verify-ci-docs-drift` recognises it.

**Depends on:** P3.1–P3.3 (the ratchet should start from a count the extraction has already lowered).
**Blocks:** Phase 4.

---

## 6. P3.5 — Characterisation tests before any move

**Problem.** The plan requires "Preserve existing behavior through characterization tests before refactoring"
and "Checkout behavior remains unchanged". P3.1–P3.3 are deletions and wraps, so their characterisation is the
existing test suite; the risk is an extraction that moves a *live* path without a test pinning it.

**Ticket P3.5 — a per-vertical boundary test, added before the move, not after.**

For each vertical P3.2 wraps, add a boundary test that exercises its repository's public surface against a
migrated in-memory DB and asserts the pre-move result. This is the same shape as the existing
`repository_tests.rs` files; the ticket's rule is **the test lands in the same commit as the wrap**, so a wrap
without a characterisation test is incomplete by construction.

**Files:** each wrapped module's `src/repository_tests.rs`.

**Acceptance criteria:**
- Every P3.2 module has at least one test that would fail if the wrap changed a result.
- Checkout tests (`cargo test -p kasirmu-core`) remain green and unchanged.

**Depends on:** none; runs **with** P3.2–P3.3, not after.

---

## 7. Sequencing

1. **P3.1** — delete the dead reporting bypass; the frozen edge count drops 2 → 1. (Lowest risk, immediate
   measurable win.)
2. **P3.2 + P3.5** — wrap the self-contained modules, one commit per module, each with its boundary test.
3. **P3.3** — declare loyalty's gift-card grant; the undeclared-dependency note drops to 0.
4. **P3.4** — set the core-size ratchet from the count the extraction produced.
5. **Phase 4** — strict enforcement (its own ticket document).

Each ticket is independently reviewable and independently revertible. None is a prerequisite for the others
except where a `Depends on` line says so.

---

## 8. What this phase does not do

- It does **not** move the cross-vertical BOM deduction out of core
  (`crates/kasirmu-core/src/db/sales_lifecycle.rs`); that needs the ownership map lifted into core and is
  Phase 4 work.
- It does **not** enable strict `NamespacedStore` enforcement; Phase 4 does.
- It does **not** remove the `raw()` escape hatch; Phase 4 does.
- It does **not** add capabilities to the vertical manifests; the P3 gate exercises the legacy branch until
  they are populated, which is tracked in `docs/architecture/module-namespace-governance.md`.

## References

- `todo-modular-scaffolding.md` §10 (Phase 3), §11.1 (core-size ratchet), §13 (acceptance criteria)
- `docs/architecture/phase2-implementation-tickets.md` (the closed predecessor phase)
- `docs/architecture/namespaced-store-api-draft.md` §5 (per-module wrap order)
- `docs/architecture/reporting-facade-inventory.md` §3, §6 (the single bypass edge)
- `docs/architecture/module-namespace-governance.md` §3–§4 (ownership map, frozen edges)
- `scripts/verify-namespace-governance.py` (the checker these tickets must keep green)
