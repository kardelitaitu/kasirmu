<!-- Audit stamp: 2026-10-19 · docs-auditor · status: ACCURATE AFTER REPAIR (2 findings) · Re-audit of the page's citations and its own headline gate claim. The 2026-10-11 stamp is kept verbatim below as original evidence. · FIXED 1 (a citation that named the wrong symbol at the right file): the Source-of-truth paragraph said `pub const TABLE_OWNERS` was at `db/ownership.rs:49`. Line 49 is `pub fn owner_of`; `TABLE_OWNERS` is declared at :12. Both symbols were named in the same sentence and both citations had slid onto the other one, so the sentence was wrong twice while the file resolved. Now :12 for the const and :49 for the function, and the citation was rewritten to put the backticked token after its own symbol so `check-cite-lines.py` can grade the :12 half. · FIXED 2 (the ceiling, re-measured rather than quoted): the page stated a ceiling of 39068 lines. `python3 scripts/verify-core-size.py` at HEAD prints measured 39069 vs ceiling 39069 (0 lines, headroom 0), exit 0 — the baseline had already been re-emitted at 39069 for a `clippy::type_complexity` declaration in `db/provisioning.rs`, and the page had not followed it. The number AND its explanation were both stale: the recorded analysis (15 files, `db/assignments.rs` at 97 lines, 27% of the delta) explains the 38703 -> 39068 step and does NOT explain the later +1. The page now says which raise each paragraph accounts for, and records that the gate is GREEN. · The ceiling itself was NOT edited: raising or lowering it is a code owner's act, and this pass only made the document agree with what the gate already reports. · Footer re-dated. -->
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
`crates/kasirmu-core/src/db/ownership.rs` (`pub const TABLE_OWNERS` at :12 and
`pub fn owner_of` at :49 of that file, fail-closed: an unknown table is `None`,
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
(`platform/kernel/src/capability.rs:164`) `verify_all`
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
deliberate `--emit-baseline` commit. Current ceiling: **40616 lines across 181 files**
(raised 2026-10-24 — 40597 → 40616, +19 attributable to
`PaymentSplitArg::effective_gateway_status` in `payment.rs`, the ADR-64 tender
lifecycle state machine, with eight other files of incidental churn offset by −7 of
cleanup; see the baseline `description`. 40597 before that on 2026-10-23, 40417 on
2026-10-22, 39069 on 2026-10-19, 39068 before that, 38703 from `341ba7227` on
2026-10-14, 37176 before that.) Re-measured 2026-10-24:
`python3 scripts/verify-core-size.py` reports 40616 vs 40616, headroom 0, exit 0.

> **CORRECTED 2026-10-24 — and this is the FOURTH recurrence of the pattern this
> section already records.** This page said "39069 lines across 178 files" while the
> tree measured **40616 across 181**; three raises (39069 → 40417 → 40597 → 40616,
> +1547 lines) had happened since the 2026-10-19 pass and the page never followed. The
> paragraph below calls 2026-10-19 "the third recurrence of the same pattern"; a
> fourth is now on the record, and the shape is identical — committed growth merged, the
> ceiling was re-emitted correctly each time, and the *narrative page* was not updated.
> **The lesson is that a prose ceiling has no gate.** `verify-core-size.py` polices
> `core-size-baseline.json` and nothing reads this paragraph, so the number rots
> silently between doc passes. Re-derive with
> `python3 scripts/verify-core-size.py --json` rather than quoting either figure,
> including the ones above.

> **Measured 2026-10-19: the gate is GREEN, and how it got there is the part worth reading.**
> It was RED at HEAD at 39068 vs a 38703 ceiling (+365), the third recurrence of the same
> pattern — committed growth merged without the ceiling edit. The deliberate re-emit this
> callout originally demanded **had happened** (37176 → 38703), so the mechanism works; what
> recurs is that nobody re-emits *as part of* the change that grows core. That raise's
> analysis — **15 distinct files** carried net production growth, the largest single
> contributor being `db/assignments.rs` at 97 lines (27% of the delta) with the top three at
> 54%, so there is no misplaced module to extract — is recorded verbatim in the baseline
> `description`, and it explains the **38703 → 39068** step. It does NOT explain the current
> ceiling: a later `+1` (39068 → 39069) was forced by `clippy::type_complexity` on the
> six-field sample-item tuple in `db/provisioning.rs`, with every other file under
> `crates/kasirmu-core/src` unchanged since that raise. Now 39069 vs 39069, headroom 0,
> `verify-core-size.py` exit 0.
>
> **The standing caution, kept from the earlier reading:** a ceiling that is only ever moved
> after the fact is a changelog, not a ratchet. Moving it is meant to be part of a change that
> says why, in the same commit. Note also that `--emit-baseline` rewrites the baseline's
> `description` to a one-line default, discarding the raise history — restore it from git and
> re-append when you use it.

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

> last audited 19-10-26 by docs-auditor
