# Module namespace firewall — completion criteria

Status: **Phase 4 (firewall) — mechanically enforced except for one named runtime gap.**
Last updated 2026-10-03. This page is the single place that states what the module
namespace firewall now *mechanically* guarantees, and — in the last section — what it
does not yet. Every claim below names the file, line, or gate id that makes it true.

Source plan: `todo-modular-scaffolding.md` §10 (boundary rules) and §13 (acceptance
criteria). Tickets: `docs/architecture/phase4-implementation-tickets.md`.

## 1. One table, one owner

`modules/ownership.json` is the single source of the table→module map (14 modules, 30
tables). `scripts/generate-ownership-map.mjs` renders it into
`crates/kasirmu-core/src/db/ownership.rs` (`pub const TABLE_OWNERS` at
`crates/kasirmu-core/src/db/ownership.rs:12`, `pub fn owner_of` at
`crates/kasirmu-core/src/db/ownership.rs:49`, fail-closed: an unknown table is `None`,
not a default). A hand-edit of the generated file is caught by the required gate
`ownership-map-parity` (`scripts/gates.json`), which runs `generate-ownership-map.mjs
--check` from `scripts/check.sh`.

## 2. Every module statement is checked at runtime

`NamespacedStore<'a>` (`crates/kasirmu-core/src/db/namespaced.rs:181`) borrows the shared
connection and validates every statement against the ownership map before it runs.
`check_statement` (`crates/kasirmu-core/src/db/namespaced.rs:344`) is the pure check: it
names the tables a statement touches and refuses a table outside the module’s own
namespace unless a `Grants` entry permits it. `Posture`
(`crates/kasirmu-core/src/db/namespaced.rs:251`) separates `ReadWrite` (own namespace)
from `ReadOnly` (foreign namespace); `Grants` has **no write field by construction**, so
there is no cross-namespace write path to open.

Evidence that this is load-bearing, not decorative:

- `NamespacedStore::raw()` — the one escape hatch that returned SQL unchecked for an own
  table — was **deleted** (Phase 4 P4.3, commit `45c991d94`). No caller remained.
- All eight wrapped verticals carry a boundary test in
  `modules/<id>/src/repository_tests.rs` asserting a foreign read is refused with
  `NamespaceError::Foreign { table, owner, self_owner }` (the error names the table AND
  its owner, `crates/kasirmu-core/src/db/namespaced.rs:87`).

## 3. Reporting reads go through a typed facade

`trait ReportingFacade` (`crates/kasirmu-core/src/db/facade.rs:36`) fixes the reporting
read path at exactly four method families — `daily_revenue`, `hourly_heatmap`,
`top_products`, `low_stock_alerts_at_location`. `impl ReportingFacade for Store<'_>`
(`crates/kasirmu-core/src/db/facade.rs:91`) delegates to the inherent methods, and the
live bridge consumer surface routes its four families through the trait explicitly
(`crates/kasirmu-bridge/src/reports.rs`). `facade_tests.rs` binds all four through the
trait and pins the count at four, so a fifth family is a deliberate edit. The one
sanctioned write (`acknowledge_stock_alert`, an `UPDATE` on `stock_alert_events`) is
deliberately **not** on the trait: the trait is a READ contract (amended ADR-62 D5,
`docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md`).

## 4. The static namespace gate is strict

`scripts/verify-namespace-governance.py` scans every module source file for SQL literals
and fails when a file touches a table owned by another module without a declared
dependency and a grant marker (`// namespace: cross-vertical read <table> granted
(<reason>)`). Phase 4 P4.5 (commit `ec280cde9`) flipped the gate to `--strict`: an
`undeclared-dependency` finding is now a blocking verdict, not a note. The gate runs from
`scripts/check.sh` as gate id `namespace-governance` (`scripts/gates.json`). At flip time
the population was clean: 0 undeclared edges and 1 frozen cross-vertical edge, which is
baselined (`scripts/namespace-governance-baseline.json`) and grant-marked.

## 5. The capability vocabulary is closed and gated

A module manifest’s `capabilities` array uses the `namespace:action` vocabulary parsed
by `Capability::parse` (`platform/kernel/src/capability.rs:29`). `CapabilityRegistry`
(`platform/kernel/src/capability.rs:119`) `verify_all`
(`platform/kernel/src/capability.rs:164`) returns `KernelError::MissingCapability` for the
first module (in id order) with an ungranted requirement, and `Kernel::load_all` calls it
**before** any `on_load` runs (`platform/kernel/src/kernel/lifecycle.rs:245`), so a
half-loaded system never exists. The required gate `capability-parity`
(`scripts/gates.json`) fails when a manifest’s declared capabilities drift from what
`modules/ownership.json` + its `dependencies` justify.

`Grants::from_capabilities` (`crates/kasirmu-core/src/db/namespaced.rs`) derives a
namespace grant set from a manifest capability list, and the boot-boundary proof
(`platform/startup/tests/boot_capability.rs`) derives the `reporting` grant set through it
from the real `modules/reporting/manifest.json`.

A module also declares the foreign namespaces its stores intend to read through
`Module::namespace_grants()` (`foundation/src/contracts.rs`), and the kernel rejects a
grant that names a module the module does not depend on: `Kernel::verify_namespace_grants`
(`platform/kernel/src/kernel/lifecycle.rs`) runs inside `verify_capabilities`, before any
`on_load`, and returns `KernelError::UndeclaredNamespaceGrant { module, granted }`. The one
real implementer today is `LoyaltyModule` (it reads `gift_cards` via its `giftcards`
dependency), and `the_real_loyalty_grant_names_a_declared_dependency` pins the invariant.

## 6. The extraction has a number

`scripts/verify-core-size.py` enforces a ceiling on `crates/kasirmu-core` production lines
(`scripts/core-size-baseline.json`). The required gate `core-size-ratchet`
(`scripts/gates.json`) fails when core grows above the recorded ceiling without a
deliberate `--emit-baseline` commit. Current baseline: **36659 lines across 177 files**
(raised by the `Grants::from_capabilities` addition).

## 7. What is NOT yet true

The Phase 4 work closed the named gaps. What remains is out of Phase 4 scope:

- `NamespacedStore` is enforced *where a module routes its SQL through it*; nothing
  forces a module to stop taking a bare `&Connection`. The governance gate catches new
  foreign tables in literal SQL, and `Namespace::raw()` (the escape hatch) was deleted in
  P4.3, but a future module could still take `&Connection` and reach a table the static
  gate sees only if the SQL is a literal.
- Moving `crates/kasirmu-core/src/db/sales_lifecycle.rs`'s cross-vertical BOM deduction
  behind the ownership map is a core extraction, tracked as Phase 5
  (`docs/architecture/phase5-implementation-tickets.md`). Progress: P5.1 declared the
  path's foreign writes machine-checkably; P5.4 assigned `payments` to `sales` in
  `modules/ownership.json`, so the settlement `INSERT INTO payments` is an own-table
  write; P5.2 extracted the shortfall decision logic into `plan_resolution_deductions`.
  Open: P5.2's reads still sit at the call site, and P5.3 still routes the `customers`
  accrual (the one remaining foreign write) behind the crm seam.

Everything the firewall was built to enforce is now mechanical:

- Each wrapped repository derives its grant set from its own embedded manifest
  (`Grants::from_manifest_json(OWNER, include_str!("../manifest.json"))`), so a
  hardcoded grant cannot drift from the declaration.
- The kernel rejects a grant with no dependency basis at boot (`Module::namespace_grants()`
  + `Kernel::verify_namespace_grants`).
- The `capability-parity` gate keeps each manifest's `capabilities` equal to
  `{read:<own>, write:<own>} ∪ {read:<dep>}`.
## 8. Gate index

| Gate id | What it enforces |
| --- | --- |
| `namespace-governance` | No module source touches a foreign table without a declared dependency + grant marker (strict). |
| `capability-parity` | Manifest `capabilities` match ownership + dependencies. |
| `ownership-map-parity` | `ownership.rs` matches `modules/ownership.json`. |
| `core-size-ratchet` | `crates/kasirmu-core` does not grow past its ceiling. |

All four are `status: required` in `scripts/gates.json` and run from `scripts/check.sh`
(checkers under `scripts/`); the static-gates CI job is `dev-ci.yml` / `static-gates`.
