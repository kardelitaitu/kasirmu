# Reporting facade inventory (T5, Phase 1)

**Status:** DONE 2026-10-02. Written by ticket T5 of
[phase1-implementation-tickets.md](./phase1-implementation-tickets.md). Companion to
[module-namespace-governance.md](../../architecture/module-namespace-governance.md) (Rule 1) and
[ADR-62](../../decisions/2026-09-30-adr62-module-seam-taxonomy.md) D5.

## 1. Why this document exists

Plan §9.5 names the sanctioned cross-vertical read path and sketches a four-method target trait
`ReportingFacade`. The facade **exists** — but as inherent methods on `Store` in
`crates/kasirmu-core/src/db/reports/` — and the plan's summary of it is stale in three ways this
inventory corrects:

1. the real surface is **24 public query methods**, not four;
2. the facade is **not read-only** — one method writes;
3. the plan lists `payments` as facade-readable data, but the facade's SQL names **no payments table**.

The inventory is the same treatment the handler set received in Phase 0: earn the map from the
repository, then record the gap between the plan and the tree rather than repeating the plan.

## 2. The facade surface — every public method, its submodule, and its tables

Root: `crates/kasirmu-core/src/db/reports.rs` (re-exports only). Submodules under
`crates/kasirmu-core/src/db/reports/`. Table names are the ones each method's SQL actually names
(comments stripped; CTE aliases such as `s`, `r`, `range_customers` are not tables).

### 2.1 `revenue.rs` — revenue aggregation

| Method | Line | Reads | Writes |
|---|---|---|---|
| `daily_revenue` | :133 | sales, sale_lines, products, refunds, refund_lines | — |
| `weekly_revenue` | :207 | sales, sale_lines, products, refunds, refund_lines | — |
| `monthly_revenue` | :282 | sales, sale_lines, products, refunds, refund_lines | — |

`daily_revenue` is the canonical shape: sales and refunds aggregate independently in CTEs and
`FULL OUTER JOIN` on `(date, currency)` so a refund-only day still yields a row (REP-04), and COGS is
a correlated subquery over `sale_lines` joined to `products` (REP-05/REP-06 semantics live here).

### 2.2 `sales_summary.rs` — operational rollups

| Method | Line | Reads | Writes |
|---|---|---|---|
| `hourly_heatmap` | :171 | sales | — |
| `payment_method_breakdown` | :204 | sales | — |
| `voided_sales_summary` | :235 | sales | — |
| `voided_items` | :264 | sales, sale_lines, products | — |
| `avg_basket_size` | :295 | sales | — |
| `basket_size_trend` | :321 | sales | — |
| `customer_split` | :350 | sales | — |
| `discounts_summary` | :394 | sales | — |
| `table_turnover` | :452 | kds_orders, sales | — |
| `hourly_table_activity` | :479 | kds_orders, sales | — |

`table_turnover` and `hourly_table_activity` share the `TABLE_TURN_SOURCE` constant
(`sales_summary.rs:39`): `FROM kds_orders k JOIN sales s ON k.sale_id = s.id WHERE s.status = 'completed' AND k.table_number IS NOT NULL AND k.table_number != ''`. The constant exists because two
hand-copied versions of this predicate drifted twice (the file comment records it) — it is the one
place the facade joins the kitchen vertical's `kds_orders`.

### 2.3 `product_sales.rs` — product, category and stock rollups

| Method | Line | Reads | Writes |
|---|---|---|---|
| `top_products` | :151 | sales, sale_lines, products | — |
| `low_stock_alerts` | :219 | products, inventory | — (**deprecated**) |
| `low_stock_alerts_at_location` | :258 | products, stock_summary, stock_thresholds | — |
| `active_stock_alerts` | :314 | stock_alert_events, products | — |
| `acknowledge_stock_alert` | :355 | stock_alert_events | **stock_alert_events** |
| `category_breakdown` | :376 | sale_lines, sales, products, categories | — |
| `inventory_turnover` | :434 | sale_lines, sales, stock_summary, products | — |
| `inventory_trend` | :470 | sale_lines, sales | — |

`low_stock_alerts` carries `#[deprecated(note = "use low_stock_alerts_at_location instead")]`
(`:218`); it is the only deprecated method on the surface. `acknowledge_stock_alert` is the only
writer (see §4).

### 2.4 `datetime.rs` — date/hour contract helpers

No public query methods. Exposes `check_date_bound` and `parse_utc_offset` as `pub(crate)`, used by
the query methods above and by `crates/kasirmu-core/src/db/analytics.rs`, `popularity.rs`,
`receipt_code.rs` and `export/mod.rs`. This is the REP-03 timezone/date-bound contract, not a
cross-vertical read surface.

### 2.5 Aggregate table set of the facade

`sales`, `sale_lines`, `products`, `refunds`, `refund_lines`, `kds_orders`, `inventory`,
`stock_summary`, `stock_thresholds`, `stock_alert_events`, `categories`.

**`payments` is absent.** Plan §9.5 lists payments among the data reporting may read through the
facade; no facade method names it. Payment analysis is done as
`payment_method_breakdown` (`sales_summary.rs:204`) and `customer_split` etc. off the `sales` row
itself. §9.5's mention of payments is aspirational and should not be read as a shipped capability.

## 3. Facade vs module-repository duplication

**Status: retired 2026-10-03 (Phase 3 P3.1).** The only production cross-vertical SQL in a **module**
repository used to be `modules/reporting/src/repository.rs:34` (`generate_daily_report` reading
`sales`). It duplicated the facade's `daily_revenue` in the narrow, single-day sense: same table, same
`status = 'completed'` filter, but summed to one row instead of grouped by currency and without refund
netting or the store-UTC bucket. It was baselined in `scripts/namespace-governance-baseline.json` and
carried the T3 grant marker `// namespace: cross-vertical read sales granted (…)`.

Because the whole domain surface (`ReportingRepository`, `ReportingService`, `DailyReport`,
`ReportingError`) had **zero non-test callers**, the migration the ticket prescribed was the deletion:
the method, its T3 marker, the repository/service/models/error modules and their tests were removed, and
the baseline entry with them. The frozen cross-vertical edge count is now **1** (the loyalty
gift-card read, §6). `modules/reporting/src/` names no foreign table at all, and the module shell
(`ReportingModule`, `platform/startup/src/lib.rs`) stays — it is a registered vertical, and removing it
would change the module-registration parity convention.

## 4. The write question (T5 item 2) — DECISION

**Finding.** `acknowledge_stock_alert` (`product_sales.rs:355`) issues
`UPDATE stock_alert_events SET status = 'acknowledged', acknowledged_at = ?1, acknowledged_by = ?2 WHERE id = ?3 AND status = 'active'`.
It writes, and it writes a table the facade does not own. Read plainly, \"reads through the facade,
never writes\" (ADR-62 D5) is false as the code stands.

**Decision (option 2a): the facade's write exception is narrowed and named in ADR-62 D5 — not
relocated.** `acknowledge_stock_alert` stays on the facade, and D5 is amended to say the facade may
write **only alert-acknowledgement state, and only the alert tables it already reads**. Rationale:

1. **The write is state on a row the facade already owns the read of.** `active_stock_alerts`
   (`:314`) already reads `stock_alert_events`; splitting the acknowledgement into a separate
   command-contributor path would give one narrow table two owners and two code paths for one
   lifecycle transition, which is the coupling the seam taxonomy exists to remove, not create.
2. **It is an idempotent status flip, not an aggregate write.** `WHERE ... status = 'active'` makes
   the statement self-guarding; it cannot resurrect or mutate a resolved alert.
3. **Moving it out would be a behaviour change in Phase 1.** Relocating the method requires a caller
   in the command path and a handler classification; that is Phase 2+ work (the NamespacedStore
   draft), and Phase 1 is deliberately soft. Record the boundary now; enforce it in Phase 4.
4. **The alternative was tested against the repository and rejected.** Option 2b (reclassify as a
   command contributor outside the facade) has no command-contributor home today: the alert
   acknowledgement is driven from the reports/alert UI path through `kasirmu-bridge`, so 2b would
   need a new contributor and a new bridge entry, not a move.

**Consequence recorded for the reader:** D5's sentence is amended to \"the facade may READ across
verticals, and may WRITE only its own alert-acknowledgement state.\" The ADR edit lives in
`docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md`; this doc is the inventory that motivated
it, not a substitute for the ADR line.

## 5. Trait shape (T5 item 3) — DECISION: NARROW

Plan §9.5 sketches `trait ReportingFacade { daily_revenue; sales_summary; product_sales; low_stock_alerts }`.
The real surface is 24 methods; the trait is **narrow** — the four plan methods, no more.

Rationale: a trait that re-exports every inherent method adds an indirection with no boundary, and
the facade's value is exactly the boundary. The four methods are the four *aggregate families*
(daily revenue, operational summary, product/category rollups, stock alerts); a caller that needs a
specific rollup beyond those should depend on the concrete submodule type it already resolves
through `kasirmu_core::db::reports`, not widen the sanctioned interface. If a fifth family proves
necessary, it is added to the trait deliberately, with this doc amended — the trait grows by
decision, not by mechanical mirroring.

**Landed in code 2026-10-03 (Phase 4 P4.2).** `trait ReportingFacade` now exists in
`crates/kasirmu-core/src/db/facade.rs` (re-exported as `kasirmu_core::ReportingFacade`), implemented for
`Store<'_>` by delegating to the inherent methods. The four families are represented by `daily_revenue`,
`hourly_heatmap` (operational summary), `top_products` (product rollups), and
`low_stock_alerts_at_location` (stock alerts). One deviation from this section's literal list: the plan
names `low_stock_alerts` for the stock family, but that method is `#[deprecated]` in favour of
`low_stock_alerts_at_location` (`product_sales.rs:218`), so the trait takes the successor rather than
freezing a deprecation. A test (`facade_tests.rs::the_trait_is_exactly_four_aggregate_families`) binds all
four through the trait, and `the_documented_method_count_matches_the_trait` pins the count at four. The
live bridge consumer surface (`crates/kasirmu-bridge/src/reports.rs`) routes its four family call sites
(`get_daily_revenue`, `get_top_products`, `get_hourly_heatmap`, `get_low_stock_alerts`) through
`ReportingFacade::` explicitly.

## 6. Reporting-bypass set (T5 item 4) — the migration checklist

Every production **reporting-module** query that names a foreign table, so §9.5's \"no new direct
SQL\" is a checklist rather than an aspiration:

| Site | Table (owner) | Status | Disposition |
|---|---|---|---|
| `modules/reporting/src/repository.rs:34` `generate_daily_report` | sales (sales) | **RETIRED 2026-10-03 (P3.1)** | Migrated onto nothing: it had zero callers, so the method, its T3 marker and the baseline entry were deleted together (the facade's `daily_revenue` already ships the capability). |

**The bypass set is now empty.** No file under `modules/reporting/src/` names a foreign table, so there
is nothing left to sequence. The reporting module's redundant domain code (`ReportingService`,
`ReportingRepository`, `DailyReport`, `ReportingError`) was deleted with it; the module shell remains
registered and is the only thing left under `modules/reporting/src/` besides `handlers.rs` (handler-free)
and `lib_tests.rs`.

### 6.1 Tables the facade touches that the ownership map does not yet cover

Six facade tables have **no entry in `TABLE_OWNERS`** (`scripts/verify-namespace-governance.py:133-148`):
`refunds`, `refund_lines`, `kds_orders`, `categories`, `stock_thresholds`, `stock_alert_events`.
The checker reports them as `unowned-table` **notes**, never blocking. They resolve as follows:

| Table | Natural owner | Basis |
|---|---|---|
| `refunds`, `refund_lines` | sales | both `REFERENCES sales(id)` (`20260813_init.sql:534-555`); refunds are sale reversals |
| `kds_orders` | kitchen | kitchen display tickets; `sale_id REFERENCES sales(id)` (`20260813_init.sql:271-288`) |
| `stock_thresholds`, `stock_alert_events` | inventory | both reference `products(id)` and drive stock alerts (`20260813_init.sql:673-757`) |
| `categories` | (unresolved) | product taxonomy; not owned by tax (which owns `category_taxes`) and not by sales |

These are recorded as a **follow-up for the ownership map**, not silently added: assigning an owner
is what turns a cross-vertical read into a Rule 1 finding, and the map is deliberately conservative.
The facade reads them all in-vertical from its own module's perspective today, so nothing is red —
but the map's silence is a real gap the T5 inventory surfaces for the Phase 2 store work.

## 7. Acceptance evidence

- Every public facade method above appears with its submodule, line and tables (§2).
- The write question has a recorded decision with rationale (§4) — no TODO.
- The reporting-bypass set is enumerated; its single member is baselined **and** carries a T3
  marker (§3, §6).
- `check-dead-refs.py` clean on this doc (run at commit time).

## References

- `crates/kasirmu-core/src/db/reports.rs` and `crates/kasirmu-core/src/db/reports/` — the facade.
- `crates/kasirmu-bridge/src/reports.rs` — the live scoped consumer surface (~37 functions).
- `modules/reporting/src/lib.rs` — the module shell that remains after P3.1 retired the bypass edge.
- [docs/architecture/namespaced-store-api-draft.md](namespaced-store-api-draft.md) §5 row 2.4 — the migration this stages.
- [done-todo-modular-scaffolding.md](../../../../docs/plans/_done/done-todo-modular-scaffolding.md) §9.5 — the plan paragraph being reconciled.
