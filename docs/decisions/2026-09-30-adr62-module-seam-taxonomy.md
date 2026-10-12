---
num: 62
area: architecture
title: "ADR-62: Module Seam Taxonomy — command contributors, projection subscribers, and the reporting-facade exception"
status: Accepted (2026-09-30) — the taxonomy is written and grounded in the Phase 0 handler census; the check that enforces it IS BUILT (scripts/verify-namespace-governance.py, Rule 2, registered as `namespace-governance` in scripts/gates.json). Amended 2026-10-07: this line and the body said the gate "is not built" and that it "must be registered when built" — both were true on 2026-09-30 and stale by 2026-10-05, when the gate was registered.
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 3 minor) · Re-audit of the seam taxonomy. THE DECISION IS SOUND AND ENFORCED, and this file is unusually good at correcting itself — it already carries two dated amendments (2026-10-02 T5, 2026-10-07) that fix its own stale claims, so the re-audit's job was the remaining present-tense drift. ·
  MAJOR — CONTEXT §4 AND THE CONSEQUENCES DESCRIBED A DEBT THAT HAS BEEN PAID. Both said `modules/reporting/src/repository.rs` 'issues its OWN raw SQL' / 'still issues raw SQL' and framed it as debt deliberately recorded rather than fixed. That file is GONE: `modules/reporting/src/` now holds only `handlers.rs`, `lib.rs` and `lib_tests.rs`, and the module's own doc records the retirement as 2026-10-03 (Phase 3 P3.1) — zero non-test callers, its one query was the LAST reporting facade-bypass edge, and because the method had no callers 'the migration is the deletion'; the frozen cross-vertical edge count drops 2 -> 1 (the loyalty gift-card read remains). Corrected in all four places, with the retirement recorded rather than the history rewritten. ·
  MINOR 1 — `todo-modular-scaffolding.md` has MOVED to `docs/plans/_done/done-todo-modular-scaffolding.md`; five citations named it at the repo root and resolved to nothing. Repointed. ·
  MINOR 2 — line coordinates in `sales_lifecycle.rs` and `event_handlers.rs` had aged on grown files: `complete_sale_with_resolved_shortfalls` `:152` -> `:183` (its `get_recipe_ingredients` call `:287`), `finalize_sale` `:86` -> `:117`, `finalize_sale_in_tx` `:110` -> `:141`, the `BEGIN IMMEDIATE` transaction `:180` -> `:118`, `LoyaltyEarnHandler` `:439` -> `:446`. Every SYMBOL was correct; only the numbers drifted. ·
  MINOR 3 — `acknowledge_stock_alert` is at `reports/product_sales.rs:356` (cited `:355`); the file grew one line, the D5 amendment's substance is unchanged. ·
  VERIFIED AND LEFT ALONE: D4 is enforced — `scripts/verify-namespace-governance.py` and `scripts/handler-classification.json` both exist and `namespace-governance` is registered in `scripts/gates.json`; `get_recipe_ingredients` really is `recipes.rs:25`; the four `reports/` submodules are still exactly the `mod` list in `reports.rs`; the checkout/loyalty contributor-vs-subscriber split the taxonomy describes is real. ·
  NOT re-measured: whether the namespace-governance gate currently passes, and the Phase 0 census's own figures — the census is a dated measurement and stays a reading of its day. ·
  NOTE ON THE FRONT MATTER: the status line says the gate landed 'in the same round' while the body says the gate was 'false from 2026-09-30'; both amendments agree the gate IS built and registered, which is the fact that matters, so the wording difference is left as the two authors wrote it. ·
-->
# ADR-62: Module Seam Taxonomy

**Status:** Accepted (2026-09-30) — the taxonomy is written and grounded in the Phase 0 handler census. **Amended 2026-10-07:** the check that enforces it IS BUILT and registered — `scripts/verify-namespace-governance.py` (Rule 2: a handler absent from `scripts/handler-classification.json` is a blocking finding), registered as the `namespace-governance` gate in `scripts/gates.json`. The original text said the gate "is not built"; that was accurate on 2026-09-30 and false from 2026-09-30, when the gate landed in the same round that accepted this ADR.
**Date:** 2026-09-30
**Recorded against:** branch `0.0.40`
**Tags:** architecture, module-system, seams, reporting, gates, event-bus

## Context

**1. Modularization needs its seams named before it moves code.** The modular-scaffolding plan
(`docs/plans/_done/done-todo-modular-scaffolding.md`) defines five resolved decisions and a seam taxonomy in §5, but the
taxonomy lives only in an untracked planning document. Phase 0 produced a handler census
(`docs/records/superseded/handler-census-phase0.md`, commit `f018704c9`) that classified 13 production
handlers; the classification vocabulary ("command contributor", "projection subscriber") is used
there without a decision record defining it. This ADR makes the vocabulary binding.

**2. The census corrected the plan's own dead-code claims.** The plan asserted
(`docs/plans/_done/done-todo-modular-scaffolding.md:552-553`) that `InventoryStockHandler` "is not orphaned" and
"performs important BOM/recipe-aware stock deduction". The census proved it is referenced ONLY from
`modules/inventory/src/handlers_tests.rs` — it is never subscribed or constructed in production
(`docs/records/superseded/handler-census-phase0.md` §3). The real BOM/recipe deduction is transactional on
the checkout path: `Store::complete_sale_with_resolved_shortfalls`
(`crates/kasirmu-core/src/db/sales_lifecycle.rs:183`, called at `:287`) reads `self.get_recipe_ingredients(pid)?`
(`:237`, defined `crates/kasirmu-core/src/db/recipes.rs:25`). So a seam taxonomy cannot treat
"registered module" and "live behaviour" as the same thing.

**3. Two kinds of interaction are already conflated on the checkout path.** `finalize_sale`
(`crates/kasirmu-core/src/db/sales_lifecycle.rs:117`) and `finalize_sale_in_tx` (`:141`) award
loyalty points INSIDE the sale transaction (`apply_customer_stats_on_completion`, `:100`/`:124`);
`LoyaltyEarnHandler` (`platform/startup/src/event_handlers.rs:446`) subscribes to the SAME fact on the
bus. Both exist. Which one is authoritative is exactly the question the taxonomy answers.

**4. Reporting already reads across verticals and already duplicates a facade.** The sanctioned
cross-vertical read path is `kasirmu_core::db::reports` (`crates/kasirmu-core/src/db/reports.rs`,
split 13-09-26 into `datetime`, `revenue`, `sales_summary`, `product_sales` (all four still the `mod` list at HEAD)). But
`modules/reporting/src/repository.rs:31-34` issued its OWN raw SQL against `sales` — **that file is now RETIRED** (deleted 2026-10-03, Phase 3 P3.1; see the dated note below)
(SELECT COUNT(*), SUM(total_minor), SUM(tax_total_minor) ... WHERE status='completed'), bypassing the
facade, and `modules/reporting/src/lib.rs:33-40` records this surface as having ZERO non-test callers.
The exception must therefore be recorded WITH its current debt, not as a clean ideal.

**5. Governance must be mechanical eventually and soft now.** The plan's Phase 1 requires soft
governance (rules and tooling that do not fail builds on existing access) and Phase 4 requires strict
enforcement. `scripts/gates.json` is the single source of truth for gates; any new gate must be
registered there. The taxonomy is the precondition for the plan's §11.3 handler classification gate.

## Decision

**D1 — Two seams, named.** A module interaction is ONE of:
- **Command contributor** — participates in a business operation SYNCHRONOUSLY, inside the same
  transaction or atomic operation, and may REJECT the operation.
- **Projection subscriber** — reacts to a fact that has ALREADY COMMITTED, after the transaction, and
  may not reject or roll back the originating operation.

These are the only two names for cross-module behaviour. A third shape (a read served to another
module) is a query facade (D5), and lifecycle/plugin/helper code is internal (D6).

**D2 — Command contributors run in the transaction and are ordered deterministically.** A command
contributor must be explicit, must be ordered deterministically, must not hide side effects outside the
transaction, and is tested as part of the operation it contributes to. The authoritative example is
the checkout path: stock validation and deduction, payment recording and loyalty award all execute
inside one `BEGIN IMMEDIATE` transaction (`crates/kasirmu-core/src/db/sales_lifecycle.rs:118`), and
`apply_customer_stats_on_completion` (`:100`) is the loyalty CONTRIBUTOR. A failure returns `Err`
and the transaction rolls back (`:250`, `:169`).

**D3 — Projection subscribers are never required for checkout atomicity.** A projection may be
retried, replayed or dropped without corrupting a committed sale, must be idempotent where practical,
must not mutate the original fact, and should be observable. Every one of the 11 live
`bus.subscribe` entries in `platform/startup/src/lib.rs` (:134-:193) is a projection subscriber: it
runs AFTER the event is published, which is after the sale transaction has committed. The rule is
enforceable as a sentence: if removing a handler would change whether a sale is valid, it is not a
projection — it is a contributor and belongs in D2's transaction.

**D4 — A handler is classified as exactly one type, and the classification is data.** Every registered
handler carries a `handler_type` of `command_contributor | projection_subscriber | query_facade |
lifecycle | plugin_bridge | internal_helper`. The Phase 0 census supplies the first population for
this classification. The class is metadata, not prose, so the future gate (§11.3) can check it
mechanically and a missing classification is a failure rather than a judgement call.

**D5 — The reporting facade is a sanctioned cross-vertical READ exception, with one named write.**
`kasirmu_core::db::reports` is the official read facade. Reporting may read sales, inventory,
refunds and product data THROUGH it; reporting may NOT write another vertical's tables, and new
reporting queries are added to the facade rather than issued from module repositories. The facade's
existing and sanctioned breadth is the REASON it is exempt from D1/D2 — it is the seam that lets
reporting stay read-only across verticals (plan §9.5) — and the exemption is bounded.

**Amended 2026-10-02 (T5).** The facade is NOT strictly read-only: `acknowledge_stock_alert`
(`crates/kasirmu-core/src/db/reports/product_sales.rs:355`) writes alert-acknowledgement state. The
facade may therefore WRITE **only alert-acknowledgement state, and only the alert tables it already
reads** (`stock_alert_events`); every other write is still out of bounds. This is recorded rather than
relocated because the write is a self-guarding status flip on a row the facade already owns the read
of (`active_stock_alerts`), and splitting it out would give one narrow table two owners. Option 2b
(reclassify `acknowledge_stock_alert` as a command contributor outside the facade) was rejected: no
command-contributor home exists for it today. Full reconciliation:
[docs/records/superseded/reporting-facade-inventory.md](../records/superseded/reporting-facade-inventory.md) §4.

**D6 — Lifecycle handlers, plugin bridges and internal helpers are internal, not seams.** They are
classified so the census is complete, but they carry no cross-module contract: a lifecycle handler
that is log-only is not evidence of behaviour, and a registered module is not the same thing as a live
one (Context §2). Classification must not be read as an endorsement of activity.

**D7 — Soft governance now; strict enforcement is a later, gated phase.** Phase 1 adds rules and
tooling that do not fail builds on EXISTING cross-vertical access: an inventory of those accesses, an
allowlist for known reporting queries (e.g. the `modules/reporting/src/repository.rs` duplicate in
Context §4 — since retired, see the dated note), and the written rule this ADR records. Strict enforcement — rejecting unauthorised
cross-namespace table access, requiring all reporting reads to route through the facade — is Phase 4
(plan §9.2), and the handler classification gate is registered in `scripts/gates.json` only when it
is built, per that file's stated contract.

**D8 — Classification is earned from the repository, and absence is not shim evidence.** The Phase 0
census earned every verdict by reading the tree, and where the plan's claims did not match it, the
REPOSITORY won (Context §2). The same caution from ADR-61 D2 applies: a handler with no non-test
reference is reported as unclassified/dead rather than silently blessed as active, and a
classification whose supporting evidence is only a test is not a live classification.

**Amended 2026-10-11 (docs-auditor re-audit).** Three corrections, none of which changes the taxonomy.

**1. The Context §4 debt is PAID, and this ADR's present-tense describes it otherwise.**
`modules/reporting/src/repository.rs` was **retired 2026-10-03 (Phase 3 P3.1)** — the file is deleted and
`modules/reporting/src/` now holds only `handlers.rs`, `lib.rs` and `lib_tests.rs`. The module's own doc
records why: the surface had zero non-test callers, its one query was the LAST reporting facade-bypass
edge, and because the method had no callers the migration WAS the deletion — the frozen cross-vertical
edge count drops from 2 to 1 (the loyalty gift-card read remains). So the paragraph in Context §4 and the
Consequences bullet that read "still issues raw SQL" / "recording the debt rather than fixing it" were
true at acceptance and are now false. Corrected in place; the retirement is recorded rather than the
history rewritten.

**2. `todo-modular-scaffolding.md` has MOVED.** Five citations named it at the repo root; it is now
`docs/plans/_done/done-todo-modular-scaffolding.md`. Repointed (the `done-` prefix is its own earned
acceptance, not this campaign's).

**3. Line coordinates in `sales_lifecycle.rs` and `event_handlers.rs` had drifted** on a file that has
since grown. Re-derived at HEAD: `complete_sale_with_resolved_shortfalls` is `:183` (cited `:152`, and its
call to `get_recipe_ingredients` is `:287`); `finalize_sale` is `:117` (cited `:86`) and
`finalize_sale_in_tx` `:141` (cited `:110`); the `BEGIN IMMEDIATE` transaction is `:118` (cited `:180`);
`LoyaltyEarnHandler` is at `event_handlers.rs:446` (cited `:439`). Every SYMBOL was already correct —
only the numbers aged. The four `reports/` submodules the Context names are still exactly the `mod` list
at `reports.rs`.

**Verified and left alone:** the gate claim holds — `scripts/verify-namespace-governance.py` exists,
`scripts/handler-classification.json` exists, and `namespace-governance` is registered in
`scripts/gates.json` — so D4 is enforced, as the 2026-10-07 amendment says. `acknowledge_stock_alert` is
at `reports/product_sales.rs:356` (cited `:355`; the file grew one line, the D5 amendment's substance is
unchanged). `get_recipe_ingredients` is really at `recipes.rs:25`, as cited.

**NOT re-measured:** whether the namespace-governance gate currently passes, the handler census's own
figures, and any runtime behaviour of the seams. The census is a dated Phase 0 measurement and stays a
reading of its day.

## Consequences

- **Good:** the seam vocabulary is now a recorded decision rather than an untracked plan paragraph;
  the census's 13 rows have a normative home; the reporting exception is bounded (reads through the
  facade, never writes); and the plan's §11.3 gate has a definition to enforce.
- **Good:** D3 gives a one-sentence test ("would removing it change whether a sale is valid?") that
  separates the two seams for any future handler.
- **Cost, accepted:** the taxonomy does NOT clean up the existing duplication. `LoyaltyEarnHandler`
  and the in-transaction award both still exist (Context §3), and
  `modules/reporting/src/repository.rs` issued raw SQL (Context §4) — **that debt is now PAID** (see the dated note). Recording the debt rather
  than fixing it is deliberate — Phase 1 is soft governance, and strict enforcement is Phase 4.
- **Known gap, CLOSED 2026-10-07:** this said "no gate enforces `handler_type` yet", which was true
  at acceptance and is not any more. §11.3 is built: `scripts/verify-namespace-governance.py` Rule 2
  fails any `impl EventHandler` type absent from `scripts/handler-classification.json`, and the gate
  is registered as `namespace-governance` in `scripts/gates.json`. D4 is a failing check, not a
  convention. The registry is generated from the Rust `handler_type` method, so a category flip
  regenerates the row (`--emit-registry`) and `--check` catches a hand-edit that drifts.
- **Verification:** the census this ADR grounds in is committed at `f018704c9`
  (`docs/records/superseded/handler-census-phase0.md`); the plan sections cited are
  `docs/plans/_done/done-todo-modular-scaffolding.md` §5, §9.1–§9.5, §11.1–§11.5; the reporting facade is
  `crates/kasirmu-core/src/db/reports.rs`; the checkout transaction is
  `crates/kasirmu-core/src/db/sales_lifecycle.rs`.

## References

- `docs/records/superseded/handler-census-phase0.md` — the Phase 0 population this taxonomy classifies
- `docs/plans/_done/done-todo-modular-scaffolding.md` — §5 (seam taxonomy), §9 (decision details), §11 (governance gates), §14 (next actions)
- `crates/kasirmu-core/src/db/reports.rs` and `reports/` — the sanctioned reporting facade
- `crates/kasirmu-core/src/db/sales_lifecycle.rs` — the checkout transaction (command contributor path)
- `platform/startup/src/lib.rs` — the 11 live bus subscriptions (projection subscribers)
- `modules/inventory/src/handlers.rs` — the remaining recorded debt (`modules/reporting/src/repository.rs` was retired 2026-10-03)
- `scripts/gates.json` — where the §11.3 gate IS registered (`namespace-governance`, line ~1567)
- ADR-61 — the tier/boundary precedent for a statically-checked architecture rule

> last audited 11-10-26 by docs-auditor