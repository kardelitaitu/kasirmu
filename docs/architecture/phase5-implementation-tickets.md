# Phase 5 Implementation Tickets — Core Extraction and the Inventory Seam

**Status:** open. Written 2026-10-03. Successor to
`docs/architecture/phase4-implementation-tickets.md`.

## Why this phase exists

Phases 0–4 made every *module* boundary mechanical: a module's repositories are scoped on
`NamespacedStore`, its grant set is derived from its manifest capabilities, its declared
dependencies are checked at boot, and `scripts/check.sh` runs the namespace gate `--strict`.

One cross-vertical write path still runs *inside* `kasirmu-core` and is therefore governed by
nothing: the sale lifecycle in `crates/kasirmu-core/src/db/sales_lifecycle.rs` (901 lines)
deducts stock and consumes recipe ingredients while writing tables three modules own —
`products`, `product_recipes`, `stock_summary` (inventory) and `customers` (crm). Because the
code is in core, no `NamespacedStore` check ever sees those statements.

Plan §10 flagged this as “Move owned domain types into module crates” and Phase 3 marked it
PARTIAL. Plan §14 names it as the single remaining structural item. This phase closes it.

## What is mechanically true today (verified 2026-10-03)

- `crates/kasirmu-core/src/db/ownership.rs` is the generated single source of `TABLE_OWNERS`
  and `owner_of(table) -> Option<&'static str>` (fail closed on an unmapped table). It is
  already *in* core, so the ownership map does **not** need lifting into core — it is already
  there. (Plan §14's first wording is stale; this ticket corrects it.)
- `sales_lifecycle.rs` foreign-table statements: `UPDATE customers` at :59 (in
  `apply_customer_stats_on_completion`, lifetime spend accrual); `FROM products` at :202, :269,
  :339 and `FROM stock_summary` at :281 and `FROM workspace_inventory_locations` at :294 (all
  inside `complete_sale_with_resolved_shortfalls`); `INSERT INTO payments` at :555.
- Own-table statements: `sales` at :32, :89, :115, :465, :641, :706, :739, :780, :847.
- The canonical stock mutation is `Store::adjust_stock_batch` in
  `crates/kasirmu-core/src/db/products_stock_adjust/batch.rs:31`; the recipe read is
  `Store::get_recipe_ingredients` in `crates/kasirmu-core/src/db/recipes.rs:25`.
- `modules/inventory` exposes only `InventoryService::get_product` today
  (`modules/inventory/src/service.rs:19`); its `get_stock`/`adjust_stock` were removed 2026-09-29
  as dead and untestable against planned-schema columns. There is no inventory seam that settles
  a sale.

## Non-goals

- Do **not** move the `sales` table or its status machine out of core: `sales` is sales-owned and
  the state machine is the core checkout contract.
- Do **not** relocate `payments`; that table is written through `enqueue_payment_recorded_outbox_in_tx`
  and stays where it is (see P5.4 for the ownership question only).
- Do **not** change checkout's synchronous contract (standing invariant, plan §15).

## Tickets

### P5.1 — Declare the cross-vertical writes this path performs — **DONE 2026-10-03**

Make the invisible visible before moving anything. Add a `CONTRACT`/grant declaration to the sale
lifecycle path naming every foreign table it writes, and a governance test asserting each declared
table's `owner_of` matches a declared module dependency of `sales`. This is the analogue of
`Module::namespace_grants()` for a core-owned path, and it fails closed if a new foreign write
appears. Deliverable: the declaration + `crates/kasirmu-core/src/db/sales_lifecycle_tests.rs`
coverage. **Acceptance:** deleting a declared table from the list makes the test fail. **Landed:** the declaration lives in `crates/kasirmu-core/src/db/sales_lifecycle_tests.rs` (`FOREIGN_WRITES` = `[customers, payments]`, `MODULE_DEPENDENCIES` = `[inventory, crm]`), with `the_foreign_writes_name_owners_that_sales_declares` and `the_foreign_write_declaration_is_not_empty`; a production pointer comment in `sales_lifecycle.rs` names the test. Mutation-proven: adding `users` to the list fails the test with “owned by 'staff', but sales does not declare that dependency”.

> **Finding surfaced by P5.1:** the declaration has to name `customers` (owned by crm) to pass, but `modules/sales/manifest.json` declares only `dependencies: ["inventory"]`. `MODULE_DEPENDENCIES` currently mirrors what the code *needs* (`[inventory, crm]`) rather than the manifest, so the gap is visible in one place. P5.3 closes it by routing the accrual through the crm seam and declaring the dependency.

### P5.2 — Extract stock settlement behind an inventory seam

Replace the inline `products` / `stock_summary` / `workspace_inventory_locations` reads and the
`adjust_stock_batch` call inside `complete_sale_with_resolved_shortfalls` with one inventory-owned
settlement entry point (a function that takes the validated deduction list and the tx and performs
the availability re-check plus the batch adjustment). The path that builds `deductions` stays in
core; the *stock mutation* moves behind the seam. **Acceptance:** the foreign `products`/
`stock_summary` statements at :202, :269, :281, :294, :339 are gone from `sales_lifecycle.rs`,
the behaviour tests still pass unchanged, and a mutation test proves the seam refuses an
unowned table.

### P5.3 — Route the loyalty/customer accrual through the crm seam

`apply_customer_stats_on_completion` writes `customers` directly (:58–:67). Route the lifetime-spend
accrual through a crm-owned entry point so the write is governed; keep it NON-FATAL exactly as
today (a captured payment must never roll back on a CRM problem). The loyalty earn already calls
`crate::db::loyalty::earn_points_with_conn` — decide in this ticket whether that stays in core or
moves, and record the decision. **Acceptance:** `UPDATE customers` no longer appears in
`sales_lifecycle.rs`; the non-fatal contract is pinned by a test.

### P5.4 — Settle the `payments` ownership question

`INSERT INTO payments` at :555 lists no owner in `modules/ownership.json` (no module owns
`payments`). Either assign it deliberately (to `sales`, whose settlement writes it) or document why
it is intentionally unowned. **Acceptance:** `owner_of("payments")` is `Some(_)` *or* a dated note
in `modules/ownership.json` and `docs/architecture/module-namespace-firewall.md` explains the gap.

### P5.5 — Flip the sale path onto the strict store and retire the exemption

Once P5.2–P5.4 land, `sales_lifecycle.rs` performs no ungoverned foreign write. Update the
firewall doc §7 to state the path is closed, and lower the core-size ratchet to the new (smaller or
equal — track whatever it is) ceiling with `scripts/verify-core-size.py --emit-baseline`.
**Acceptance:** `docs/architecture/module-namespace-firewall.md` has no “BOM deduction” gap;
`python scripts/verify-core-size.py` exits 0.

## Verification for every ticket

- `cargo test -p kasirmu-core --lib` (background — the suite exceeds the 120 s foreground default).
- `cargo clippy -p kasirmu-core --all-targets -- -D warnings`.
- `python scripts/verify-namespace-governance.py --strict` (0 blocking).
- `python scripts/verify-namespace-governance.py --census` (0 stale).
- `python scripts/verify-core-size.py` (at ceiling).
- `python scripts/verify-debt-markers.py`, `python scripts/verify-ci-docs-drift.py`,
  `node scripts/generate-records-index.mjs --check`.
- `python .agents/skills/docs-auditor/scripts/check-dead-refs.py <changed docs>`.

