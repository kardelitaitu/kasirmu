# todo — recipe authoring for the restaurant menu

> **Created 2026-10-10 · status: PROPOSED — not approved, not started, no code changed.**
>
> **This is a FEATURE plan, not a reliability repair**, and it is deliberately filed separately
> from `todo-retail-vs-restaurant-product-model.md`. This repo's own rule is that feature work
> does not ride in on a bug fix, and this file exists so it does not.
>
> **The finding that created it:** the restaurant menu's ingredient-deduction engine is
> **complete and already correct** — but there is **no way to author a recipe**, so in practice
> **no restaurant deducts anything.** A working engine with no input is dead code in
> production, which is the same shape as F24 in this campaign (a complete chain, no surface).

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

### Q5 — ⚠️ Retroactivity & Historical Integrity (the architectural prerequisite)

If a recipe changes today, what happens to **already-completed sales**?

- **Physical Inventory Ledger (already safe):** `sales_checkout.rs:518-525` writes deductions directly to
  `stock_movements` at checkout with an immutable transaction ID, timestamp, and delta. Editing a recipe
  later does NOT rewrite physical stock movements.
- **Historical Costing / COGS (the retroactivity trap):**
  `crates/kasirmu-reporting/src/margin.rs:93` computes margins from `COALESCE(sl.cost_minor, p.cost_minor, 0)`.
  If recipe costing is introduced dynamically, editing a recipe would silently restate past margins.
  **The clean solution:** Snapshot at sale time. `sale_lines` ALREADY has a `cost_minor INTEGER` column
  (`migrations/20260813_init.sql:595`). Stamping the computed recipe cost snapshot onto `sale_lines.cost_minor`
  at checkout freezes historical margins forever without complex multi-table historical recipe joins.

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

### Q7 — ⚠️ Reverse Stock on Voids and Refunds (The `credit.rs` gap)

Verified in the code:
- In `sales_checkout.rs:363` vs `:444`, ingredient allocations are sent to `adjust_stock_batch`,
  but **never mapped into `line_deductions`**.
- As a result, `deduction_locations` JSON on `sales` records the *dish* SKU, not the *ingredient* SKUs.
- When a sale is refunded or voided (`crates/kasirmu-core/src/db/refunds/credit.rs`), it reads `deduction_locations`
  and attempts to credit stock back to `line.sku` (the dish, which has no inventory tracking), dropping the
  ingredient stock restoration entirely.

**Architectural requirement before recipe authoring ships:**
1. `sales_checkout.rs` must record ingredient allocations into `line_deductions` under the dish's line item.
2. `deduction_locations` JSON must preserve the actual ingredient SKUs and quantities deducted.
3. `credit_refund_from_deduction_locations` in `credit.rs` must restore inventory to the recorded ingredient SKUs.

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
- **The demo-fixture defect** — `todo-demo-fixtures-sellable.md`. Worth noting they interact:
  a recipe-bearing dish created in a demo build inherits the fixture problem.
- **Purchasing / supplier costing** — ingredient `cost_minor` is referenced by Q1 but owned elsewhere.

---

## 7. Acceptance (when it is built)

1. An operator can create, edit and delete a recipe on a product through the UI, on both shells.
2. Selling a recipe-bearing dish deducts its **ingredients**, and shortfalls **on the
   ingredient** — asserted against a real database, not a fixture.
3. Selling a dish **without** a recipe deducts nothing and never shortfalls (the guard at
   `sales_checkout.rs:282` still holds).
4. §4-Q5: an already-completed sale's recorded figures do not change when its recipe is edited.
