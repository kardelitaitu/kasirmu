# Orchestrator Agent 1: Financial & Reporting DB Services (`tax.rs` & `reports.rs`)

**Document:** `todo-refactor-backend-db-agents-1.md`  
**Role:** Orchestrator Agent 1 (Financial & Analytics Data Architect)  
**Goal:** Decompose `crates/oz-core/src/db/tax.rs` (1,393 lines) and `reports.rs` (1,263 lines) from massive procedural SQL query files into modular query builders, dedicated aggregate calculators, and unified row mappers.

**Target Crates:** `crates/oz-core/src/db/`  
**Sibling Documents:**
- [`todo-refactor-backend-db-agents-2.md`](./todo-refactor-backend-db-agents-2.md) (Agent 2 — Sales & Checkout DB Repositories)
- [`todo-refactor-backend-db-agents-3.md`](./todo-refactor-backend-db-agents-3.md) (Agent 3 — Inventory, Stock & Catalog Repositories)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Coordinate strictly through Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 1 MUST use:
     - `refactor(db-tax): ...`
     - `refactor(db-reports): ...`
3. **Owned Path Fence (Exclusive to Agent 1):**
   - `crates/oz-core/src/db/tax.rs` & `tax_tests.rs`
   - `crates/oz-core/src/db/reports.rs` & `reports_tests.rs`
   - `crates/oz-core/src/db/tax/` (NEW module directory)
   - `crates/oz-core/src/db/reports/` (NEW module directory)
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `sales*.rs`, `cart.rs`, or `checkout.rs` (Owned by Agent 2).
   - DO NOT edit `inventory*.rs` or `products*.rs` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [x] Run `cargo test -p oz-core tax reports` to establish passing baseline.
  > Executed as the two real filters (`cargo test -p oz-core tax`, then `reports`;
  > cargo takes one TESTNAME). Baseline (pre-edit, 13-09-26, HEAD `ddc3af495`):
  > **tax = 129 lib unit tests passed** (+12 +4 integration-bin hits), **reports =
  > 95 lib unit tests passed** (+1). All green before any edit.
- [x] Record line counts of `tax.rs` (1,393) and `reports.rs` (1,263).
  > Doc counts were stale. **Measured: `tax.rs` = 1,463 lines, `reports.rs` =
  > 1,314 lines** (plus siblings `tax_tests.rs` 2,102, `reports_tests.rs` 2,342).

### Phase 1.1: Decompose `tax.rs`
- [x] Split `crates/oz-core/src/db/tax.rs` into: ⚠️ **seams deviated from plan — the
  doc's names described a different file than exists.** A full read found zero
  exemption, jurisdiction, or bracket code, and three real clusters instead:
  - ~~`db/tax/rules.rs`~~ → **`db/tax/scopes.rs`** (962 ln): the scope/window model
    (`TaxRateScope`, `TaxRateWindow`, `TaxRateScopeInfo`, `TaxSaleScope`), scoped
    authoring (`create/update_tax_rate_scoped`), the Location→Entity→Global resolver
    walk, applicability filter, and the tier-default / last-coverage guards. This is
    the plan's "effective rate calculations" content (its `rates.rs` description),
    named after what it actually is — tax *separation* scoping, the only "rules-
    like" machinery the file holds.
  - ~~`db/tax/rates.rs` (overrides)~~ → **`db/tax/rates.rs`** (394 ln): the
    rate-record CRUD the name actually maps to — list/get/default/create/update/
    archive (TAX-02/03/04), dependency counts, statutory rounding-directive reads.
  - ~~`db/tax/exemptions.rs`~~ → **dropped, then replaced by `db/tax/assignments.rs`**
    (150 ln): no customer/product exemption lookups exist in `tax.rs` (the word
    "exemption" appears in `crates/oz-core/src` only in audit event names —
    `db/audit.rs`, `db/audit_security.rs`, `db/profile.rs`, none a tax-exemption
    query). The third real seam is the product/category ↔ rate junction surface
    (`set/get_product_tax_rates[_batch]`, `set/get_category_tax_rates`, PROD-12) —
    the plan's "categories" fragment of `rules.rs`, so it took that content role.
- [x] Keep `db/tax.rs` as a clean facade re-exporting public functions to maintain backwards compatibility.
  > Facade is 44 lines: `mod` wiring, `pub use` of the production surface
  > (`TaxRateScope`, `TaxRateWindow`, `TaxRateScopeInfo`, `TaxSaleScope`,
  > `TaxRateDependencyCounts`, `MAX_TAX_RATE_BPS`), and `#[cfg(test)]` re-exports
  > for what `tax_tests.rs` resolves through `use super::*` (`parse_effective_date`
  > + parent-use bindings). `crate::db::tax::<Name>` paths did not move — verified
  > compiling from `oz-api`, `oz-bridge`, `tablet-client`, `platform/sync` callers.
  > `db/mod.rs` untouched (submodule dirs hang off the `tax.rs` root — the module
  > system never forced the edit). `tax_tests.rs` untouched.
- [x] Verify `cargo test -p oz-core tax` passes.
  > 129 passed / 0 failed — identical to baseline. Plus `cargo check -p
  > oz-cloud-server -p oz-bridge -p oz-api` clean; `cargo fmt -p oz-core --
  > --check` shows zero diffs.
- [x] **Commit Milestone:**
  > `fd98fb7ead` — `refactor(db-tax): split tax.rs into rates, scopes, and
  > assignments submodules behind a re-export facade` (4 files, +1,535/−1,448;
  > subject names the real seams, convention respected).

### Phase 1.2: Decompose `reports.rs`
- [x] Split `crates/oz-core/src/db/reports.rs` into: ⚠️ **seams deviated — no Z-/X-
  reports and zero tax-statutory queries exist in this file** (X/Z shift reports
  live in `db/shifts.rs`; statutory rounding reads live in `db/tax.rs`). Real map:
  - `db/reports/sales_summary.rs` ✅ (478 ln): the plan's "hourly sales aggregation"
    half is real (`hourly_heatmap`, `hourly_table_activity`) alongside tender split,
    voids, baskets, customer split, discounts; no Z/X exists to move.
  - `db/reports/product_sales.rs` ✅ (489 ln): category breakdown + top sellers as
    planned; the "dead stock" fragment became the low-stock alert + inventory
    turnover/trend queries that actually live here.
  - ~~`db/reports/tax_audit.rs`~~ → **dropped**: `reports.rs` contains no tax
    queries (verified by reading all 1,314 lines — `tax` appears nowhere in it).
    Replaced by **`db/reports/revenue.rs`** (308 ln, daily/weekly/monthly REP-04
    aggregation + the shared revenue/COGS mapper) and
    **`db/reports/datetime.rs`** (100 ln, the REP-03 tz/date-bound contract).
- [x] Keep `db/reports.rs` as a clean facade.
  > 40 lines wiring all 20 row structs + `pub(crate) use` of `check_date_bound` /
  > `parse_utc_offset` (imported by path from `db/analytics.rs`, `db/popularity.rs`
  > and cloud-server's `email_pg/analytics.rs` — all `oz_core::db::reports::<Type>`
  > paths verified working). `reports_tests.rs` needed zero changes (it imports by
  > absolute `crate::` paths, never `use super::*`). `db/mod.rs` untouched.
- [x] Verify `cargo test -p oz-core reports` passes.
  > 95 passed / 0 failed — identical to baseline. Downstream `cargo check -p
  > oz-cloud-server -p oz-bridge` clean.
- [x] **Commit Milestone:**
  > `e76d02665a` — `refactor(db-reports): split reports.rs into datetime, revenue,
  > sales_summary, and product_sales submodules behind a re-export facade`
  > (5 files, +1,403/−1,302).

---

## ✅ Closure stamp (13-09-26, Agent 1)

- **Pure refactor:** every SQL string, comment and code path copied verbatim; the
  only visibility edits are `pub(super)` on three `Store` helpers shared across the
  tax submodules (`validate_tax_rate_input`, `clear_tier_default`,
  `ensure_scoped_coverage_survives` — effective reachability unchanged: all three
  were module-private in `tax`, and `pub(super)` from a child is exactly the `tax`
  subtree) and `pub(crate) fn window_covers` kept crate-visible inside
  `tax/scopes.rs` (its `crate::db::tax::window_covers` path had zero users
  workspace-wide — re-exporting it on the facade emitted `unused_imports`, so it
  was left un-re-exported; the function itself is unchanged).
- **Final line counts** (facade / submodules, all < 1,000; no fmt regressions —
  per-file `rustfmt --edition 2024`, the removed `cargo fmt` hook step respected):
  tax 44 / 394 / 962 / 150; reports 40 / 100 / 308 / 478 / 489.
- **Tests:** tax 129→129, reports 95→95, identical tails including integration
  bins; no other filter re-run was needed because no other file was touched.
- **Collisions:** none observed inside the fence; shared dirty files outside it
  (`migrations/20260813_init.pg.sql`, `AGENTS.md`, `.githooks/pre-commit`,
  `ui/*`) were never staged, committed, or reverted.
