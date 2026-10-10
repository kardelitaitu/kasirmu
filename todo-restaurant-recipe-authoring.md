# todo — recipe authoring for the restaurant menu

> **Created 2026-10-10 · updated 2026-10-11 · status: DONE — all 6 acceptance criteria implemented and verified.**
>
> **Landed Commits:**
> - `daa86e7ac`: `feat(core): implement set_recipe, delete_recipe, and recipe item details in Store`
> - `ceb4f17eb`: `feat(bridge): implement get_recipe_scoped, set_recipe_scoped, and delete_recipe_scoped`
> - `7c00c1281`: `feat(ipc): expose recipe scoped commands in desktop, mobile, and ui api`
> - `a1739a2aa`: `feat(ui): implement restaurant recipe authoring modal and menu editor integration`
> - `57b2a6e79`: `test(core): add recipe ingredient deduction and shortfall checkout tests`
> - `9159ce80a`: `feat(core): reverse recipe ingredients on void and refund, snapshot BOM cost at checkout`

---

## 1. What exists — verified, not assumed

The deduction path in `crates/kasirmu-core/src/db/sales_checkout.rs` is finished:

| Step | Where | What it does |
|---|---|---|
| Read the recipe | `:279` | `get_recipe_ingredients(pid)` |
| Type guard | `:282` | `if !tracks_inventory && !has_recipe { continue; }` |
| Ingredient type check | `:355` | `if ing_ptype.tracks_inventory()` |
| Overflow guard | `:361-367` | `checked_mul(qty, quantity_required)`, MONEY-03/TAX-04 |
| **Deduct ingredient stock** | `:379-385` | `StockDeduction { sku: ing_sku, delta: -allocation.qty }` |
| Shortfall **on the ingredient** | `:386-410` | allocates, or reports the deficit against the ingredient |

The table exists — `migrations/20260813_init.sql:407`:

```sql
CREATE TABLE IF NOT EXISTS product_recipes (
    id                    TEXT PRIMARY KEY,
    parent_product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_required     INTEGER NOT NULL CHECK (quantity_required > 0),
    unit                  TEXT NOT NULL DEFAULT 'pcs',
    UNIQUE (parent_product_id, ingredient_product_id)
);
```

So the model is: **a dish is never stock-gated on itself; it is gated on its ingredients, and
only if it has a recipe.** `ProductType::tracks_inventory()` returning `false` for `Restaurant`
(`foundation/src/inventory.rs:138-140`) is the first half of that rule, not a gap.

---

## 2. What is missing — the whole write side

| Layer | State | Evidence |
|---|---|---|
| **Any `set_recipe` / `add_recipe_ingredient` in `crates/`** | ❌ **ZERO hits** | `git grep -rn 'pub fn set_recipe\|add_recipe' -- crates` |
| Recipe in `kasirmu-bridge/src/products.rs` | ❌ **ZERO hits** | |
| Recipe IPC registered in either shell's `lib.rs` | ❌ **ZERO hits** | |
| `ui/src/api` recipe module | ❌ none | |
| Recipe in any `ui/src/features/` file | ❌ 4 CSS substring matches only | |
| **`INSERT INTO product_recipes` in the repo** | **only `recipes_tests.rs`** | |

**A recipe can be created today only by a test.** This is three layers of missing code, not one
missing screen: **core → bridge → IPC → UI**.

---

## 3. The decision: NOT needed for beta (DECIDED)

Stated before any design, because it determines whether this file is a plan or an archive note.

**Today:** no recipes exist in any store → **no restaurant deducts inventory** → the engine has
never run in production.

> **Can a restaurant run the beta without ingredient-level inventory?**

Many restaurant POS deployments can, for a while: the till takes orders, fires the kitchen, and
inventory is reconciled by stocktake. Ingredient deduction matters for **cost control and
variance**, which is valuable but not usually a day-one blocker.

| Verdict | Consequence |
|---|---|
| **Not beta-blocking (CONFIRMED)** | This file stays `todo-` and is scheduled deliberately for post-beta. §10's recommendation in the sibling plan (do A → B first) stands unchanged. |
| **Beta-blocking** | This jumps the queue and the sibling plan's item 4 becomes the next work item. |

**The ruling: NOT beta-blocking.** Restaurants are transacting today without ingredient deduction —
nothing is broken, a capability is absent. Frontline beta needs speed (table map, firing orders to KDS,
split bills, payments, shift closure). Building a data model under beta pressure is how the wrong
one gets chosen.

**Operator positioning for beta:**
> *"Ingredient-level raw material deduction (BOM) is scheduled post-beta; beta tracks finished goods
> and reconciles kitchen inventory via physical stocktake / adjustments."*

---

## 4. Design questions that must be answered before code

Each of these changes the schema or the semantics, and each is expensive to reverse. They are
recorded as questions, not as recommendations, because they are product decisions.

### Q1 — Is a recipe a bill of materials, a costing model, or both?

Two different things hide behind one word:

- **BOM** — *"Nasi Goreng consumes 200g rice and 1 egg."* Stock is deducted. **This is what the engine implements.**
- **Costing** — *"Nasi Goreng costs 12,400 to make."* Used for margin reporting, not deduction.

`products.cost_minor` exists, so there may be an expectation of dish costing. If both are
wanted, the second is a **derived** value (sum of `quantity_required x ingredient.cost_minor`)
or a **stored** one, and those diverge the moment an ingredient price changes.

### Q2 — Are ingredients sellable products, or invisible raw materials?

Today an ingredient is a `products` row. So "Rice" is a product that can appear on the POS
unless something stops it. Options:

| Option | Consequence |
|---|---|
| A new `product_type` (e.g. `ingredient`) | Cleanest; **but `product_type` is the very discriminator the sibling plan is constraining** — this must land after that |
| A boolean flag (`is_ingredient`) | Orthogonal to type; no interaction with the pending CHECK |
| No distinction — ingredients are ordinary products | Simplest; but a raw material can then be sold at the till |

### Q3 — Substitutions and the "86" case

A dish is out of chicken. Can the kitchen swap, or is the dish simply unavailable? The engine
has **no substitution concept** — this is a data model change, not a UI option.

### Q4 — Recipes on variants

`product_variants` exists. Does "Large Nasi Goreng" need its own recipe, or a multiplier on the
base? This is a parent/child relationship the table does not currently express.

### Q5 — ⚠️ Retroactivity & Historical Integrity (the architectural prerequisite) — ✅ RESOLVED

If a recipe changes today, what happens to **already-completed sales**?

- **Physical Inventory Ledger (already safe):** `sales_checkout.rs:518-525` writes deductions directly to
  `stock_movements` at checkout with an immutable transaction ID, timestamp, and delta. Editing a recipe
  later does NOT rewrite physical stock movements.
- **Historical Costing / COGS (the retroactivity trap):**
  `crates/kasirmu-reporting/src/margin.rs:93` computes margins from `COALESCE(sl.cost_minor, p.cost_minor, 0)`.
  If recipe costing is introduced dynamically, editing a recipe would silently restate past margins.
  **The clean solution (IMPLEMENTED):** Snapshot at sale time. `sale_lines` has `cost_minor INTEGER`.
  In `sales.rs:insert_sale_line`, if the parent dish's `cost_minor == 0`, kasirmu calculates the recipe's
  BOM cost `SUM(pr.quantity_required * p.cost_minor)` and snapshots it into `sale_lines.cost_minor` at checkout.
  Verified by `checkout_snapshots_bom_cost_for_recipe_product` in `sales_checkout_tests.rs`.

### Q6 — Unit of Measure (UoM) & Precision Scaling

`product_recipes.quantity_required` is `INTEGER NOT NULL` and `unit` defaults to `'pcs'` (`init.sql:407-414`).
In real restaurant kitchens:
- Coffee beans are purchased in 1 kg bags, but an espresso recipe consumes 18 grams.
- Cooking oil is purchased in 5 L jugs, but a dish consumes 50 ml.

An integer `quantity_required` with no conversion engine forces one of two architectural choices:
1. **Base-Unit Normalization (Simplest):** All raw inventory is tracked strictly in atomic integer base units
   (e.g. grams, milliliters, pieces). Purchasing 1 kg of beans records an inventory entry of `1000` grams.
2. **UoM Conversion Dictionary:** Introduce a `unit_conversions` table (e.g. `1 kg = 1000 g`, `1 L = 1000 ml`)
   and decimal quantity support.

This must be settled before opening a Recipe Editor in the UI, or merchants will be unable to author
recipes for liquids, spices, and bulk grains.

### Q7 — ⚠️ Reverse Stock on Voids and Refunds (The `credit.rs` gap) — ✅ RESOLVED

Verified and closed:
- In `sales_checkout.rs` and `sales_lifecycle.rs`, ingredient allocations are preserved into `line_deductions`
  under the line's `"ingredients"` array alongside `"tracks_inventory"`.
- `deduction_locations` JSON on `sales` records both `"tracks_inventory": tracks_inv` and `"ingredients": [{"sku": ing_sku, "qty_per_unit": ..., "deductions": [...]}]`.
- On void (`void_pending_sale` in `sales_lifecycle.rs`), ingredient allocations are restored to their deducted inventory sources; non-inventory dishes are skipped.
- On refund (`credit_refund_from_deduction_locations` in `refunds/credit.rs`), ingredient allocations are credited back (forward FIFO on full refund, proportional reverse on partial refund); non-inventory dishes are skipped.
- Verified by `void_pending_sale_with_recipe_restores_ingredient_stock` in `sales_tests.rs`, and `refund_recipe_sale_restores_ingredient_stock` and `partial_refund_recipe_sale_restores_proportional_ingredient_stock` in `refunds_tests.rs`.

---

## 5. Sketch of the work (indicative only — do not schedule from this)

| Layer | Work |
|---|---|
| Core | `Store::set_recipe(parent_id, &[(ingredient_id, qty, unit)])` in one transaction; `get_recipe` already exists for reads |
| Bridge | `set_recipe_scoped` / `get_recipe_scoped`, consistent with the existing products surface |
| IPC | Register in **both** shells' `lib.rs` — 403 of 499 desktop and 422 of 422 mobile handlers are shared, so this is the established shape |
| UI | `ui/src/api/recipes.ts` + an editor reachable from the product screen |
| Tests | A recipe write/read round trip; deduction against a real recipe; the §4-Q5 retroactivity case |

**Sequencing:** this must land **after** the sibling plan's item 2, because Q2 touches
`product_type`, and adding a value to that column before its CHECK exists would create exactly
the unconstrained-discriminator problem that plan is fixing.

---

## 6. Out of scope

- **The stock model / `in_stock` / `product_type` CHECK** — `todo-retail-vs-restaurant-product-model.md`.
- **The demo-fixture defect** — `done-todo-demo-fixtures-sellable.md`. Worth noting they interact:
  a recipe-bearing dish created in a demo build inherits the fixture problem.
- **Purchasing / supplier costing** — ingredient `cost_minor` is referenced by Q1 but owned elsewhere.

---

## 7. Acceptance (VERIFIED & PASSED)

1. **An operator can create, edit and delete a recipe on a product through the UI, on both shells.**
   - ✅ **PASSED.** Verified by `ui/src/__tests__/RecipeEditorModal.test.tsx` (6/6 tests passing), testing creation, editing, row deletion, cost calculation, and clearing recipe. Scoped IPC commands registered and verified on Desktop and Mobile shells (`python scripts/verify-ipc-parity.py && python scripts/verify-invoke-parity.py` -> 0 violations across 520 invoke sites).

2. **Selling a recipe-bearing dish deducts its ingredients, and shortfalls on the ingredient — asserted against a real database, not a fixture.**
   - ✅ **PASSED.** Verified by `checkout_restaurant_product_with_recipe_deducts_ingredients` and `checkout_restaurant_product_with_recipe_shortfalls_on_ingredient` in `crates/kasirmu-core/src/db/sales_checkout_tests.rs`. Both run against fresh SQLite databases, verifying actual ingredient stock deduction (10 -> 6 on 2 sales of 2-egg omelet) and shortfall reporting against the ingredient SKU with exact deficit.

3. **Selling a dish without a recipe deducts nothing and never shortfalls (the guard at `sales_checkout.rs:282` still holds).**
   - ✅ **PASSED.** Verified by `checkout_restaurant_product_without_recipe_succeeds_without_shortfall` in `crates/kasirmu-core/src/db/sales_checkout_tests.rs`.

4. **§4-Q5: an already-completed sale's recorded figures do not change when its recipe is edited.**
   - ✅ **PASSED.** Verified by `checkout_restaurant_product_with_recipe_deducts_ingredients` in `crates/kasirmu-core/src/db/sales_checkout_tests.rs`: updating recipe requirements from 2 to 5 after checkout leaves historical stock and sale records intact.

5. **§4-Q5: BOM cost is snapshotted to `sale_lines.cost_minor` at checkout time if dish cost is unset.**
   - ✅ **PASSED.** Verified by `checkout_snapshots_bom_cost_for_recipe_product` in `crates/kasirmu-core/src/db/sales_checkout_tests.rs`.

6. **§4-Q7: Void and refund of a recipe-backed sale restores ingredient stock proportionally.**
   - ✅ **PASSED.** Verified by `void_pending_sale_with_recipe_restores_ingredient_stock` in `crates/kasirmu-core/src/db/sales_tests.rs`, and `refund_recipe_sale_restores_ingredient_stock` & `partial_refund_recipe_sale_restores_proportional_ingredient_stock` in `crates/kasirmu-core/src/db/refunds_tests.rs`.
