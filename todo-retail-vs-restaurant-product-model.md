# todo — separate the restaurant MENU from the retail PRODUCT

> **Created 2026-10-10 · status: PLANNING — no code changed, no scope agreed.**
>
> **Why this file exists.** A restaurant POS could not finish a sale: the checkout raised
> *"Insufficient Stock"* against `MUFFIN-B` / `LATTE` / `CAPPU` (screenshot, 2026-10-10). The
> user's diagnosis was that **one `products` aggregate serves two different domains**, and
> asked for a split into `RetailProduct` and `RestaurantMenu`. **This file measures what that
> would touch and lays out the options. It does NOT pick one** — the scope question is open
> and belongs to the user, not to me.
>
> **Nothing here is an inference.** Every count below was taken at HEAD and names its command.

---

## 1. The reported symptom, and what is actually known

**Reported:** a restaurant sale is refused with an Insufficient Stock dialog for three
restaurant items. `Available: 0` on each, with a *"Allow negative stock (Manager PIN
override)"* escape.

**What is NOT yet known, and is the single most important open fact:**

> **What is `product_type` for those three SKUs?**

The checkout ALREADY exempts non-stock types — `sales_checkout.rs:282` skips the stock
check when `!tracks_inventory() && !has_recipe`, and `ProductType::tracks_inventory()`
returns `false` for both `Restaurant` and `Service`
(`foundation/src/inventory.rs:138`). So a checkout shortfall on a *restaurant* item means
one of exactly three things:

| # | Possibility | Consequence |
|---|---|---|
| 1 | `product_type` is `'retail'` | **Data problem.** The row is mistyped; the code is right. |
| 2 | `product_type` is unmapped / NULL / wrong case | The unknown value falls back to `Retail` (`parse_stored_or_default`), so it is stock-checked. **Code problem.** |
| 3 | The item has a BOM **recipe** | `has_recipe` forces the check by design. Working as intended. |

**Until (1) vs (2) vs (3) is answered, any fix is a guess.** The SQL to answer it is in §6.

---

## 2. The structural fault, measured

### 2.1 One table, two domains, an unconstrained discriminator

`products` is a single table (`migrations/20260813_init.sql:439`) whose row type is
discriminated by a **free-text column with no CHECK**:

```sql
product_type TEXT NOT NULL DEFAULT 'retail',   -- :451, no CHECK in either engine
```

The codebase already admits this — `migrations/20260901_product_images.sql:17`:
*"`product_type` is free-text (no CHECK in either engine; the bridge writes [raw IPC]**
***strings])**"*. `ProductType::parse_str` is case-sensitive, so `'RETAIL'` maps to `None` and
`parse_stored_or_default` **silently downgrades it to `Retail`** — a value whose own doc
comment calls it *"ambiguous between a legitimate `retail` and a failed read"*
(`foundation/src/inventory.rs:100-102`).

### 2.2 Two layers disagree about the same question

This is the fault that produces the visible symptom. **The same question — "does this item
need stock?" — is answered two different ways by two different layers:**

| Layer | Rule | Restaurant dish |
|---|---|---|
| **Checkout** (`db/sales_checkout.rs:278`) | `ptype.tracks_inventory()` | ✅ correct — stock check skipped |
| **Listing** (`kasirmu-bridge/src/products.rs:80,164`) | `stock_qty > 0` | ❌ wrong — ignores type entirely |
| **Mobile listing** (`apps/mobile-tauri/.../products.rs:169,241`) | `stock_qty > 0` | ❌ same rule, second copy |

So a restaurant dish tints **Unavailable** on the menu tile (the listing's crude rule) and
is **also** refused at checkout when the crude rule happens to feed the shortfall path. The
model to fix this **already exists** — `tracks_inventory()` — and one layer already honours it.

### 2.3 The rule is written FOUR times

`in_stock: pwd.stock_qty.is_some_and(|q| q > 0)` appears at **4 sites** (2 bridge, 2 mobile).
There is no single home, so the copies can and eventually will drift. This is the
concrete form of the user's *"now it's like we have to code twice"* complaint — see §4 for
what IS and is NOT actually duplicated.

---

## 3. What a REAL table split would touch (the cost, measured)

The user's asked-for shape is two entities. **This is its true price, taken at HEAD:**

| Surface | Count | Command |
|---|---|---|
| **Foreign keys referencing `products`** | **29** | `git grep -c 'REFERENCES products\|REFERENCES "products"' -- crates/kasirmu-core/migrations/*.sql` |
| Rust files mentioning `products` | **296** | `git grep -l 'products' -- '*.rs'` |
| Workspace crates | **37** | 17 under `crates/`, 20 under `platform/` + `modules/` + `apps/` |
| Shared IPC commands (both shells) | **403** | per-`lib.rs` handler-name intersection |
| Product-domain Rust fns | 28 | `kasirmu-bridge/src/products.rs` (14) + `products_crud.rs` (14) |
| UI product/menu files | 33 | `ui/src/features/products` + `ui/src/features/restaurant` |

**Two constraints that decide whether a split is even coherent:**

1. **`products.sku` is a join key, not just a column.** Many of the 29 FKs reference
   `products(sku)` — e.g. `:62`, `:389`, `:419`, `:427`. Splitting the table breaks `sku` as
   a **global identity**, so every one of those references needs re-pointing or a kept
   contract. This is the single largest piece of the work.
2. **The split reaches sync and the cloud replica, not just local schema.**
   `platform/sync/src/lib.rs:297,315` upserts products **by SKU** into the store DB, and the
   cloud server carries a SQLite→PG migration
   (`apps/cloud-server/src/bin/migrate_sqlite_to_pg/`). A table split is therefore a
   **sync-payload and PG-replica change**, with the schema-drift gate (`init.pg.sql` is
   generated) and the migration registry both in the path.

**And the constraint that most often kills the two-table idea:** `ProductType` has a
**`Both`** variant (`foundation/src/inventory.rs:75`) — a product that legitimately appears
in *both* menus today. Two tables must either join or duplicate a row to preserve it.

---

## 4. What the user is right about, and what is worth separating

**Right, and measured:**

- The aggregate **is** ambiguous: one free-text discriminator, no constraint, a fallback that
  silently invents `retail`, and two layers answering "needs stock?" differently.
- The **`in_stock` rule is genuinely duplicated** 4×, and `product_type != 'service'` twice
  (`products_crud.rs:119,148`). Those are real copy-paste costs.

**Also worth stating, because it bounds the fear:** the architecture is **mostly not**
duplicated per shell. **403 of 499 desktop handlers and 403 of 422 mobile handlers are the
same commands**, and the heavy behaviour lives in `kasirmu-bridge`. So the two shells are a
shared core with capability differences — not two implementations. The duplication is
concentrated in a handful of rules like `in_stock`, not spread through the app.

**What is NOT yet established:** that a *table* split is necessary to fix anything. The
reported bug is explained entirely by §2.2 (two layers, two rules) and §2.1 (unconstrained
discriminator) — both fixable without touching a single FK.

---

## 5. Options, with cost and risk stated

**These are not ranked as "good/bad".** They are three different amounts of work solving
three different-sized problems, and the choice is the user's.

### Option A — targeted: constrain the discriminator, unify the stock rule

| | |
|---|---|
| **Fixes** | The reported bug, the silent-downgrade path, the 4-duplicate rule |
| **Touches** | 1 migration (+PG regen), `ProductType` consumers, 4 `in_stock` sites |
| **FKs touched** | **0** |
| **Risk** | Low — small, reversible, no schema re-shape |
| **Leaves** | `products` still one table; the domain distinction is by `product_type` |

### Option B — domain TYPES over the one table (the separation, without the migration)

Introduce `RestaurantMenuItem` / `RetailProduct` as **typed views** enforced at the Rust and
IPC boundary, on top of Option A:

```
product_type ∈ {restaurant, both} → RestaurantMenuItem  (menu, courses, kitchen, recipes)
product_type ∈ {retail, both}     → RetailProduct       (stock, barcode, rack, EAN)
```

| | |
|---|---|
| **Gives** | The readable separation and cross-contamination guard the user asked for |
| **FKs touched** | **0** — same table, same `sku` identity, same sync payload |
| **Risk** | Medium — touches the DTO/API surface, but no data moves and `Both` still works |
| **Requires** | Option A first (the discriminator must be trustworthy before it can discriminate) |

### Option C — full table/aggregate split

| | |
|---|---|
| **Cost** | 29 FKs, `sku` identity, sync payload, PG replica, migration registry, 403-command surface |
| **Risk** | **High** — a working POS can be broken by this, and `Both` must be re-expressed |
| **Needs** | An **ADR** (this area already has ADR-36 and ADR-37) and explicit user sign-off |
| **Verdict** | Out of scope for a chat instruction; see §7 |

---

## 6. Phase 0 — the measurement that unblocks everything

**No code until this is answered.** Against the desktop app's store database:

```sql
SELECT sku, name, product_type, is_active FROM products WHERE sku IN ('MUFFIN-B','LATTE','CAPPU');
-- and the fallback detector: any row whose type is not one of the four known strings
SELECT sku, product_type FROM products
 WHERE product_type NOT IN ('retail','restaurant','both','service');
-- and whether a recipe is forcing the check (§1 case 3)
SELECT p.sku, COUNT(r.ingredient_product_id) AS ingredients
  FROM products p LEFT JOIN product_recipes r ON r.parent_product_id = p.id
 WHERE p.sku IN ('MUFFIN-B','LATTE','CAPPU') GROUP BY p.sku;
```

**Interpretation:** `retail` → §1 case 1 (data). An unknown/NULL value → case 2 (the
fallback, a real code defect). A non-zero ingredient count → case 3 (by design).

---

## 7. Out of scope for this file

- **Option C (the table split) is NOT approved and NOT planned here.** If it is wanted, it
  starts with an ADR — this repo has **84** of them and product modelling already has
  ADR-36 (`2026-08-11-adr36-retail-product-attributes.md`) and ADR-37. A 29-FK restructuring
  begun from a chat message, with no ADR, is how a working POS gets broken.
- **No schema change in Phase 0.** It is three SELECTs.
- **The date-stamping / receipt work** in `todo-restaurant-pos-reliability.md` is unrelated and
  stays there.

---

## 8. Open questions — these are the user's to answer

1. **Phase 0's result:** what is `product_type` on those three SKUs? (Blocks the fix choice.)
2. **Scope:** Option A (bug fix), B (types + separation), or C (real split + ADR)?
3. **The `Both` case:** is a single product appearing on BOTH the retail grid and the
   restaurant menu a real requirement? If **no**, Option C gets materially cheaper and this
   whole question should be re-costed. If **yes**, two tables need a join or a duplicate row.
4. **The recipe question:** should a restaurant dish WITH a BOM recipe be stock-checked?
   Today it is (by design, `sales_checkout.rs:282`) — so a dish built from tracked
   ingredients *does* shortfall on those ingredients. If the answer is "dishes are never
   blocked", that is a second, independent change.

---

## 9. Claims that have rotted — do not quote these

- **"Restaurant and mobile differ on `in_stock`."** Measured and **false**: both shells call
  the same `run_list_products` and the same `MenuItemTile`. The divergence is between the
  **checkout** and the **listing** layers (§2.2), not between shells.
- **"Mobile has its own product behaviour."** Mostly false: mobile is a **subset** of the
  desktop command surface (422 vs 499 handlers, 403 shared). The genuine duplication is the
  4 `in_stock` copies and the 2 `product_type != 'service'` copies.
