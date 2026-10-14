<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 5 minor) · THE MAJOR IS A LIVE RED GATE THIS PAGE CLAIMS IS ENFORCED. §6 quotes a conscious ceiling of "37176 lines across 178 files" and says the core-size-ratchet gate fails if core grows above it — at HEAD the gate IS failing: python3 scripts/verify-core-size.py reports measured 38703 vs ceiling 37176 (+1527 lines), exit 1, with scripts/core-size-baseline.json committed-clean and only a README dirty under crates/kasirmu-core/, so the growth is MERGED work that never got the deliberate ceiling edit the section demands. That is the exact failure mode the same section warns about ("a gate that is permanently red trains people to ignore it"). Recorded in place rather than re-baselined: lowering the ceiling is a code owner's deliberate act, not a docs repair. ALSO REPAIRED: five drifted coordinates (namespaced.rs NamespacedStore 181->212, check_statement 344->374, Posture 251->282, NamespaceError::Foreign 87->149; lifecycle.rs verify_capabilities 245->278) and the §1 table count "14 modules, 30 tables" -> 31 (payments is now owned by sales; verify-namespace-governance.py --check-ownership prints 31 and is green). · VERIFIED UNCHANGED: the single-source ownership chain (ownership.json -> generator -> ownership.rs :12/:49), the facade (facade.rs :36 trait, :91 impl — both exact), grants deriving from manifests, the closed capability vocabulary, the four required gate ids in gates.json, and namespace-governance run as a live check.sh step. · NOT re-measured: whether the four gates pass in CI today beyond the two I ran, and any runtime behaviour. · Prior stamp preserved below as plain text. -->
# Module namespace firewall — completion criteria

<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 finding) · Repaired: the Tickets line cited `docs/architecture/phase4-implementation-tickets.md`, which is not in `docs/architecture/` — the target is `docs/records/superseded/phase4-implementation-tickets.md` (verified present). The completion-criteria claims were re-measured and hold: `scripts/verify-namespace-governance.py --strict` is a live `check.sh` step (`:509`) and its `--check-ownership`/`--check-capabilities` legs are at `:521` and `:532`. · Repaired against branch `0.0.41` at `134aaed1b`. -->


Status: **Phase 4 (firewall) — mechanically enforced except for one named runtime gap.**
Last updated 2026-10-03. This page is the single place that states what the module
namespace firewall now *mechanically* guarantees, and — in the last section — what it
does not yet. Every claim below names the file, line, or gate id that makes it true.

Source plan: `todo-modular-scaffolding.md` §10 (boundary rules) and §13 (acceptance
criteria). Tickets: `docs/records/superseded/phase4-implementation-tickets.md`.

## 1. One table, one owner

`modules/ownership.json` is the single source of the table→module map (14 modules, 31
tables). `scripts/generate-ownership-map.mjs` renders it into
`crates/kasirmu-core/src/db/ownership.rs` (`pub const TABLE_OWNERS` at
`crates/kasirmu-core/src/db/ownership.rs:12`, `pub fn owner_of` at
`crates/kasirmu-core/src/db/ownership.rs:49`, fail-closed: an unknown table is `None`,
not a default). A hand-edit of the generated file is caught by the required gate
`ownership-map-parity` (`scripts/gates.json`), which runs `generate-ownership-map.mjs
--check` from `scripts/check.sh`.

## 2. Every module statement is checked at runtime

`NamespacedStore<'a>` (`crates/kasirmu-core/src/db/namespaced.rs:212`) borrows the shared
connection and validates every statement against the ownership map before it runs.
`check_statement` (`crates/kasirmu-core/src/db/namespaced.rs:374`) is the pure check: it
names the tables a statement touches and refuses a table outside the module’s own
namespace unless a `Grants` entry permits it. `Posture`
(`crates/kasirmu-core/src/db/namespaced.rs:282`) separates `ReadWrite` (own namespace)
from `ReadOnly` (foreign namespace); `Grants` has **no write field by construction**, so
there is no cross-namespace write path to open.

Evidence that this is load-bearing, not decorative:

- `NamespacedStore::raw()` — the one escape hatch that returned SQL unchecked for an own
  table — was **deleted** (Phase 4 P4.3, commit `45c991d94`). No caller remained.
- All eight wrapped verticals carry a boundary test in
  `modules/<id>/src/repository_tests.rs` asserting a foreign read is refused with
  `NamespaceError::Foreign { table, owner, self_owner }` (the error names the table AND
  its owner, `crates/kasirmu-core/src/db/namespaced.rs:149`).

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
**before** any `on_load` runs (`platform/kernel/src/kernel/lifecycle.rs:278`), so a
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
deliberate `--emit-baseline` commit. Current baseline: **37176 lines across 178 files**.

> **Measured 11-10-26: this gate is RED at HEAD.** `python3 scripts/verify-core-size.py`
> reports **measured 38703 vs ceiling 37176 (+1527 lines)** and exits 1. Nothing in the working
> tree is dirty on this path (`scripts/core-size-baseline.json` is committed-clean and the only
> modified file under `crates/kasirmu-core/` is a README), so the growth is committed work that
> was merged without the deliberate ceiling edit the paragraph above requires. The mechanism the
> section describes is intact — the gate runs, and a red gate proves nothing, which is exactly
> the failure this section already warns about elsewhere. **Ratio unchanged and worth reading:
> the same drift that once left this ceiling behind has recurred.**

That figure was re-emitted to the true measured count, not because core was allowed to drift, but
because the ceiling had been left behind by committed work — the payment-gateway and cloud-export
additions, together with the COR-32/COR-37 correctness fixes — so the `core-size-ratchet` gate was
**red** while the plan still claimed CI enforced it. The ratchet exists to make growth a conscious,
reviewed act: a gate that is permanently red trains people to ignore it, and a red gate proves
nothing. This records growth that was already reviewed and merged; the ratchet counts down from here.

## 7. What is NOT yet true

The Phase 4 work closed the named gaps, and the Phase 5 core extraction closed the sale-settlement path's foreign reach. What remains is the general, structural caveat:

- `NamespacedStore` is enforced *where a module routes its SQL through it*; nothing
  forces a module to stop taking a bare `&Connection`. The governance gate catches new
  foreign tables in literal SQL, and `Namespace::raw()` (the escape hatch) was deleted in
  P4.3, but a future module could still take `&Connection` and reach a table the static
  gate sees only if the SQL is a literal.
- The Phase 5 core extraction closed the sale-settlement path's cross-vertical
  reach. `crates/kasirmu-core/src/db/sales_lifecycle.rs` now performs no ungoverned
  foreign read or write: P5.1 declared the path's foreign writes
  machine-checkably; P5.4 assigned `payments` to `sales` in `modules/ownership.json`,
  so the settlement INSERT is an own-table write; P5.3 made
  `crates/kasirmu-core/src/db/customers.rs` the single writer of `customers`; and P5.2
  moved the `products` / `stock_summary` / `workspace_inventory_locations` reads into
  the core-owned seam `crates/kasirmu-core/src/db/inventory_seam.rs`. The inventory
  *write* side (`adjust_stock_batch`) already lived behind
  `products_stock_adjust`. Both seams are core-owned because core cannot depend on
  the vertical modules without inverting the layering; each is guarded by mutation
  tests that fail if a statement is re-inlined. The remaining gap is the general one
  above, not a named sale-path hole.

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

---

> last audited 11-10-26 by docs-auditor
