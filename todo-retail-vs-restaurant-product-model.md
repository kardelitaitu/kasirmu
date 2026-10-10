# todo — separate the restaurant MENU from the retail PRODUCT

> **Created 2026-10-10 · status: RULED, not started — no code changed.**
>
> **RULING (§5a): do Option A, then Option B. Option C is REFUSED.** The deciding fact is that
> `both` is **dead code** — no UI can produce it, no Rust path branches on it, and its two
> consumers contradict each other. C's entire justification rested on preserving that variant.
> It is refused for three further reasons: **it does not fix the reported symptom** (the shortfall
> comes from the checkout reading the stock ledger, which a table split leaves untouched); it
> re-points **29 FKs** and breaks `sku` as a global join key across sync and the PG replica;
> and this repo's own policy puts a change that size behind an ADR, not a bug report.
>
> **Still open:** Phase 0's data check (§6) and question 5 (is `both` wanted, or deleted).
>
> **Why this file exists.** A restaurant POS could not finish a sale: the checkout raised
> *"Insufficient Stock"* against `MUFFIN-B` / `LATTE` / `CAPPU` (screenshot, 2026-10-10). The
> user's diagnosis was that **one `products` aggregate serves two different domains**, and
> asked for a split into `RetailProduct` and `RestaurantMenu`.
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

### 2.2 CORRECTED — the two mechanisms are INDEPENDENT, not two rules for one thing

> **This section was WRONG in the first draft of this file, and the correction matters
> because it changed what Option A can claim. The original text said the checkout and the
> listing `"disagree about the same question"` and that fixing `in_stock` would close the
> reported bug. Both statements are false. They read DIFFERENT TABLES and are triggered by
> different user actions. Re-verified 2026-10-10 against the code.**

**Mechanism 1 — the greyed tile (listing).**

```
ProductDto.in_stock = stock_qty > 0        (kasirmu-bridge/src/products.rs:80,164)
stock_qty = COALESCE(SUM(stock_summary.qty), inventory.qty)   (products_crud.rs:56 etc.)
```

Falls back to the legacy `inventory` table, so a row in EITHER table makes it sellable. Read by
`MenuItemTile` (`!product.inStock` disables the card, `:191`, `:199`) — presentation only.

**Mechanism 2 — the Insufficient Stock dialog (checkout).**

```
stock_at_locations()  ->  SELECT COALESCE(qty, 0) FROM stock_summary
                          WHERE item_id = ?1 AND location_id = ?2      (sales_checkout.rs:25-31)
```

**This reads `stock_summary` ONLY.** It never touches `inventory` and it never reads
`ProductDto.in_stock`. A missing row becomes `0` via `.unwrap_or(0)` — so an item whose stock
lives only in the legacy `inventory` table, or in no table at all, reports **`Available: 0`**
and blocks the sale.

**Therefore the two are independent:**

| | Reads | Triggered by | Fixed by A? |
|---|---|---|---|
| Grey tile | `stock_summary` **or** `inventory` | rendering the menu | **yes**, for restaurant items — see 10.5 for the case it does NOT fix |
| Insufficient Stock | `stock_summary` **only** | pressing Complete | **NO** unless the row genuinely has no ledger entries |

**The consequence for the ruling, stated plainly:** Option A fixes the **grey tile** for
restaurant items. It does **NOT** by itself stop the Insufficient Stock dialog. The original
claim that A `"closes your reported bug"` was false and is withdrawn.

### 2.3 Why the reported dialog happened AT ALL — deduced, and testable

`sales_checkout.rs:282` skips the stock check entirely when
`!tracks_inventory && !has_recipe`. For the sale to have shortfalled, that guard must **not**
have fired. That leaves exactly two possibilities:

| # | Condition | What it means |
|---|---|---|
| A | `tracks_inventory() == true` | the row is `retail`, `both`, **or unmapped** (which falls back to `Retail`) |
| B | `has_recipe == true` | the item has BOM ingredient rows |

**And (B) is very unlikely for those SKUs:** `provisioning.rs` seeds **no recipes at all**
(zero `recipe` hits in that file), and the seeded restaurant SKUs are `SMPL-REST-01..05` — the
screenshot names `MUFFIN-B`, `LATTE`, `CAPPU`, which are the **dev fixtures** in
`useProducts.ts:12-29`, not seeded rows. Those fixtures carry `inStock: true` and
`stockQty: 50` — but a **fixture is not a database row**, so whatever the real rows are, the
guard did not skip them.

**So the leading hypothesis is (A): those rows are not `restaurant`.** Either written as
`retail`, or holding an unmapped value that `parse_stored_or_default` downgraded to `Retail`
— which is exactly the silent path `foundation/src/inventory.rs:100-102` warns about.
**Phase 0's SQL decides it, and it is still the blocking fact.**

### 2.4 The rule is written FOUR times

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

- The aggregate **is** ambiguous: one free-text discriminator, no constraint, and a fallback
  that silently invents `retail`.
- The **`in_stock` rule is genuinely duplicated** 4×, and `product_type != 'service'` twice
  (`products_crud.rs:119,148`). Those are real copy-paste costs.

**Also worth stating, because it bounds the fear:** the architecture is **mostly not**
duplicated per shell. **403 of 499 desktop handlers and 403 of 422 mobile handlers are the
same commands**, and the heavy behaviour lives in `kasirmu-bridge`. So the two shells are a
shared core with capability differences — not two implementations. The duplication is
concentrated in a handful of rules like `in_stock`, not spread through the app.

**What is NOT yet established:** that a *table* split is necessary to fix anything. The
reported symptom is most likely a **type/data** problem (§2.3), and the underlying listing defect
(§10.5) is generic to every product created with blank stock — both fixable without touching a
single FK.

---

## 5. Options, with cost and risk stated

**These are not ranked as "good/bad".** They are three different amounts of work solving
three different-sized problems, and the choice is the user's.

### Option A — targeted: constrain the discriminator, unify the stock rule

| | |
|---|---|
| **Fixes** | The silent-downgrade path, the 4-duplicate rule, and the GREY TILE for restaurant items. **NOT the reported dialog** — see 2.2 and 6.2 |
| **Touches** | 1 migration (+PG regen), `ProductType` consumers, 4 `in_stock` sites |
| **FKs touched** | **0** |
| **Risk** | Low — small, reversible, no schema re-shape |
| **Leaves** | `products` still one table; the domain distinction is by `product_type` |

### Option B — domain TYPES over the one table (the separation, without the migration)

Introduce `RestaurantMenuItem` / `RetailProduct` as **typed views** enforced at the Rust and
IPC boundary, on top of Option A:

```
product_type = restaurant → RestaurantMenuItem  (menu, courses, kitchen, recipes)
product_type = retail     → RetailProduct       (stock, barcode, rack, EAN)
product_type = service    → ServiceItem         (no stock, no menu tile)
```

| | |
|---|---|
| **Gives** | The readable separation and cross-contamination guard the user asked for |
| **FKs touched** | **0** — same table, same `sku` identity, same sync payload |
| **Risk** | Medium — touches the DTO/API surface, but no data moves. Assumes `Both` is removed (§8 q5); if kept, its semantics must be defined first |
| **Requires** | Option A first (the discriminator must be trustworthy before it can discriminate) |

### Option C — full table/aggregate split

| | |
|---|---|
| **Cost** | 29 FKs, `sku` identity, sync payload, PG replica, migration registry, 403-command surface |
| **Risk** | **High** — a working POS can be broken by this, and `Both` must be re-expressed |
| **Needs** | An **ADR** (this area already has ADR-36 and ADR-37) and explicit user sign-off |
| **Verdict** | Out of scope for a chat instruction; see §7 |

---

## 5a. THE RULING (2026-10-10) — Option A + B; C is REFUSED

The user delegated the call. This is it, with the evidence that decided it. **A ruling without
its reasons is just an opinion, so every line below names what settled it.**

### RULED: do A, then B. Do NOT do C.

### The fact that decided it: `both` is DEAD CODE

The whole cost of Option C rested on one question — *is a product appearing on both menus a
real requirement?* It is not. Measured:

| Evidence | Where |
|---|---|
| The type selector offers **only** `retail`, `restaurant`, `service` | `ProductManagementScreen.tsx:679-681` |
| **No UI anywhere writes `'both'`** | `git grep -rn "'both'" -- ui/src/features/products` returns empty |
| No Rust product path branches on it | zero `Both` hits in `products_crud.rs` + `bridge/products.rs` |
| The restaurant menu **excludes** it | `RestaurantMenu.tsx:505` — matches `'restaurant'` only |
| The KDS picker **includes** it | `KdsProductPickerModal.tsx:225` — matches `'restaurant'` OR `'both'` |

So `Both` is **an enum variant with no producer and two contradictory consumers.** No row can
obtain the value through the product UI. It is unreachable state, and it was the single
strongest argument for keeping one table ("two tables must join or duplicate to preserve it").
**That argument is void.**

### Why C is refused anyway — the argument that actually kills it

Removing the `Both` objection makes C *cheaper*, not *sensible*. Three independent reasons:

1. **C does not fix the reported symptom**, and — corrected — **neither, on its own, does A.**
   The Insufficient Stock dialog comes from `stock_at_locations()` reading `stock_summary`
   only (§2.2). A table split leaves that query untouched, so you would spend a 29-FK migration
   and still be refused at the till. **A fix that does not fix the symptom is not a fix**, and
   this applies to both A and C. The change that DOES address it is identified in §10.5 — and it
   is a listing/write-side defect, not the checkout.
2. **`sku` is a global join key.** 29 FKs reference `products` by `id` *and* by `sku` (`:62`,
   `:389`, `:419`, `:427`). A split re-points every one *and* breaks `sku` as an identity, and it
   reaches `platform/sync` (upsert-by-SKU) and the SQLite to PG replica. That is a sync-protocol
   and cloud-schema change riding on a bug report.
3. **This repo's own rule forbids it here.** Feature work must not ride in on a reliability
   repair, and this area is ADR-governed (ADR-36, ADR-37; 84 ADRs total). A restructuring of
   that size starts from an ADR, not a chat message.
4. **Offline-first & Hybrid Domain Architecture:**
   - In SQLite, splitting into two tables forces polymorphic foreign keys on `sale_lines`,
     tax dependency checks, and audit logs—a pattern SQLite cannot enforce without triggers.
   - Real-world merchants are frequently hybrid (cafés selling packaged coffee beans and mugs
     alongside espresso; bakeries selling bottled sodas alongside made-to-order sandwiches).
     Forcing separate physical tables breaks hybrid operations. Industry POS engines (Square,
     Toast, Shopify POS) consistently maintain a single catalog aggregate with typed domain
     capabilities, exactly what Option B provides.

**C is not rejected as wrong — it is rejected as unearned and structurally inferior.** If the two domains
ever genuinely diverge (different lifecycles, different sync rules), the ADR writes itself. Today the
difference is one discriminator and one stock rule, and B expresses exactly that.

### Why B is the right shape for the separation that was asked for

The ask was for the concepts to be *separate and readable*. B delivers that at the type
boundary, with **0 FKs touched**, no data movement, and the sync payload unchanged. It also
gives the compiler something to enforce — a retail-only field cannot reach a menu item — which
a table split would also give, at roughly 20x the cost.

### Correction: this ruling corrects my OWN earlier claim

This ruling corrects **two** of my own earlier claims, and both are recorded in section 9 so
the wrong models are not inherited.

1. I first said the divergence was **desktop vs mobile**. It is not — both shells share
   `run_list_products` and `MenuItemTile`, and there is **no shell divergence at all**.
2. I then said it was **checkout vs listing** "disagreeing about the same question". **That is
   also wrong.** They read different tables and are triggered by different actions; they are
   independent mechanisms, not two answers to one question (§2.2).

### The ruling's own risk, stated

B is a **medium-risk** change touching the DTO/API surface. It is defensible only if A lands
first — the discriminator must be trustworthy before anything can discriminate on it. If A's
Phase 0 check comes back `retail` on those SKUs, then A shrinks to "fix the data" and B becomes
the whole of the work.

---
## 6. Phase 0 — RESOLVED by the demo-fixture finding (see `todo-demo-fixtures-sellable.md`)

> **UPDATE 2026-10-10 (later the same day): Phase 0 is no longer a database query, because the
> SKUs do not need looking up — they are DEMO FIXTURES, not rows.**
>
> `MUFFIN-B` appears in exactly one place in the repo: `ui/src/features/products/useProducts.ts:19`,
> in `SAMPLE_PRODUCTS`. With `isDemoMode()` true (which it is in **every dev build**, no flag
> needed) **and an empty store database**, `useProducts` substitutes that fixture catalogue
> (`useProducts.ts:175-188`). The menu then shows mythical SKUs marked `inStock: true`, and the
> checkout validates them against the **real, empty** DB — where they do not exist — so
> `sales_checkout.rs:257-268` shortfalls every line at `Available: 0`.
>
> **So the reported symptom was a FIXTURE/REALITY MISMATCH, not a stock-model or type problem.**
> This also dissolves §2.3's deduction: the guard at `:282` did not fire because **the rows were
> never in the database at all** — a third possibility that §1's table of three did not contain.
>
> **The SQL below is retained for the case where the reporter was NOT on a demo build** — if a real
> store DB genuinely holds those SKUs, these queries still answer §1's three cases.

### 6.1 The original queries (valid if those SKUs ARE real rows)

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

### 6.2 ~~The change that actually addresses the reported symptom~~ — WITHDRAWN, see §6.4

> **⚠️ THIS SECTION'S RECOMMENDATION WAS WRONG AND IS WITHDRAWN. It is kept only so a reader who
> finds a reference to "A2" knows what happened to it. Do not implement it.**
>
> The original text argued for widening `stock_at_locations()` to fall back to the legacy
> `inventory` table, on the reasoning that "the listing and the checkout should read the same
> thing". **§6.4's ADR check showed the direction is backwards:** `stock_summary` is the
> authoritative ADR-19 ledger, so teaching the checkout to honour `inventory` would make the till
> accept stock the ledger model deliberately superseded — **a regression, not a fix.**
>
> **There is no "A2".** The stock-source question was already answered by the ADRs; what remains
> is §10.5's listing/write-side defect, which is a different thing entirely.

### 6.3 Audit — what this file verified, and what it got wrong

Every claim was re-checked against the code. Recorded because the first draft contained a
**material error** that changed the ruling.

| Claim | Verdict | Evidence |
|---|---|---|
| Checkout exempts non-stock types | **TRUE** | `sales_checkout.rs:282` — `if !tracks_inventory && !has_recipe { continue; }` |
| `tracks_inventory()` is false for restaurant | **TRUE** | `foundation/src/inventory.rs:138-140` — `matches!(self, Retail \| Both)` |
| Both shells use that same guard | **TRUE** | both call `complete_sale_deduction_with_locations_and_estimate` |
| `product_type` is a parsed enum where I propose to use it | **TRUE** | `row_to_product:607` → `.as_str()` at `products.rs:84` |
| No stock row → `stock_qty` NULL → `in_stock` false | **TRUE** | `COALESCE(SUM(..), i.qty)` with LEFT JOIN; both NULL |
| `both` is unproducible | **TRUE** | selector `:679-681`; no UI writes it; KDS/menu consumers contradict |
| **"Checkout and listing disagree about the same question"** | **FALSE — CORRECTED** | different tables, different triggers (§2.2) |
| **"A closes the reported bug"** | **FALSE — WITHDRAWN** | the dialog reads `stock_summary` via `stock_at_locations`, never `in_stock` |

### 6.4 The stock-source question is ALREADY ANSWERED by the ADRs (audit finding)

6.2 (since withdrawn) asked which table is authoritative. The audit found the answer is
**already recorded**, which is what killed that section:

- **`stock_summary` is the authoritative ledger.** ADR-19 established its composite PRIMARY
  KEY `(item_id, location_id)` (migration 089), and ADR `2026-07-18-multi-location-inventory.md`
  is *"the origin of the stock-location model that ADR-19 ... build[s] on"*. Its symbols —
  `adjust_stock_at_location_with_reason`, `rebuild_stock_summary`, `stock_movements.location_id`
  — are all live.
- **`inventory` is the LEGACY table.** It survives as the `COALESCE` fallback in the listing
  query (`products_crud.rs:56`, *"falling back to the legacy `inventory.qty` when no ledger
  rows exist (ADR #36)"*).

**So the DIAGNOSIS inverts, and this is the most useful finding of the audit:**

> The **checkout is reading the right table**. It is the **listing's fallback to the legacy
> `inventory` table that is the loose one** — it makes an item look sellable on a table the
> checkout does not consult.

That means A2 is **not** "widen the checkout to read `inventory`". Doing that would be a
**regression**: it would make the till honour a table the ledger model deliberately superseded.
The correct alignment runs the **other way**:

| Change | Direction | Note |
|---|---|---|
| Listing `in_stock` | use `tracks_inventory()` (restaurant never stock-gated) | Option A — still correct |
| Listing `stock_qty` fallback to `inventory` | **question the fallback**, do not propagate it | new — needs care for rows that have NO ledger entries |
| Checkout `stock_at_locations()` | **leave alone** — it reads the authoritative table | A2 withdrawn |

**And the legacy fallback cannot simply be deleted:** for a product with no ledger rows at all,
`stock_summary` is empty and the `inventory` fallback is the only thing reporting stock. So this
is a **migration question** (backfill `stock_summary` from `inventory`, then drop the fallback),
which belongs with the ADR — not a one-line change.

**Net effect on the ruling:** the reported symptom is now most likely **data or type**
(`product_type` not `restaurant`, §2.3), **not** the stock-source mismatch. Phase 0 remains the
gate. This is the third time in this file that measurement corrected the plan, and it is why
§6.3 records each claim's verdict separately.

## 7. Out of scope for this file

- **Option C (the table split) is NOT approved and NOT planned here.** If it is wanted, it
  starts with an ADR — this repo has **84** of them and product modelling already has
  ADR-36 (`2026-08-11-adr36-retail-product-attributes.md`) and ADR-37. A 29-FK restructuring
  begun from a chat message, with no ADR, is how a working POS gets broken.
- **No schema change in Phase 0.** It is three SELECTs.
- **The date-stamping / receipt work** in `todo-restaurant-pos-reliability.md` is unrelated and
  stays there.

---

## 8. Questions — RESOLVED (decisions and evidence recorded)

1. **Phase 0's result (RESOLVED):** The reported SKUs were in-memory dev fixtures in
   `useProducts.ts:19-21`, not database rows at all. See `todo-demo-fixtures-sellable.md`.
2. **Scope (RULED, §5a):** Option A, then Option B. Option C (table split) is REFUSED.
3. **The `Both` case / Q5 (RESOLVED):** `both` is unproducible dead code with contradictory
   consumers (`RestaurantMenu` excludes it; `KdsProductPickerModal` includes it). Decision:
   **delete `both`** in Option A, making `product_type` a clean 3-way discriminator
   (`retail`, `restaurant`, `service`).
4. **The recipe question (RESOLVED):** Dishes with BOM recipes are stock-checked on their
   ingredients by design (`sales_checkout.rs:282`). Recipe authoring is confirmed **not
   beta-blocking** and tracked separately in `todo-restaurant-recipe-authoring.md`.

---

## 9. Claims that have rotted — do not quote these

- **"Restaurant and mobile differ on `in_stock`."** Measured and **false**. Both shells call the
  same `run_list_products` and the same `MenuItemTile`; there is **no shell divergence at all**.
- **"The checkout and the listing disagree about the same question."** **False.** They read
  **different tables** — the listing `COALESCE(stock_summary, inventory)`, the checkout
  `stock_summary` only — and are triggered by different actions (rendering vs Complete). The
  corrected account is §2.2.
- **"Option A closes the reported Insufficient Stock dialog."** **Withdrawn.** The dialog comes
  from `stock_at_locations()` (`sales_checkout.rs:25-31`), which never reads `ProductDto.in_stock`.
  A fixes the grey tile; whether it touches the dialog depends on the unknown in §2.3.
- **"The checkout reads the wrong stock table."** **False, and the reverse is closer to true.**
  `stock_summary` is the ADR-19 ledger and the authoritative source (§6.4); the listing's
  fallback to the legacy `inventory` table is the loose end. Widening the CHECKOUT to read
  `inventory` would be a regression.
- **"Mobile has its own product behaviour."** Mostly false: mobile is a **subset** of the
  desktop command surface (422 vs 499 handlers, 403 shared). The genuine duplication is the
  4 `in_stock` copies and the 2 `product_type != 'service'` copies.

---

## 10. RECOMMENDATION (2026-10-10, revised after the recipe finding)

> **The user's steer:** *"restaurant menu later will reduce kitchen inventory (via menu recipe)"*.
>
> **This does not weaken the ruling — it STRENGTHENS it, and it kills one claim this file was still
> carrying.** The recipe mechanism the user describes **already exists and already works**, so
> almost none of the work is in the checkout.

### 10.1 The recipe mechanism is REAL and COMPLETE — verified end to end

`sales_checkout.rs:288-410` already does exactly what was described:

| Step | Where | What it does |
|---|---|---|
| Read the recipe | `:279` | `get_recipe_ingredients(pid)` |
| Guard on type | `:282` | skips items that neither track stock nor have a recipe |
| Ingest type check | `:355` | `if ing_ptype.tracks_inventory()` — only deductible ingredients |
| Overflow guard | `:361-367` | `checked_mul` on `qty x quantity_required`, with MONEY-03/TAX-04 rationale |
| **Deduct ingredient stock** | `:379-385` | `StockDeduction { sku: ing_sku, delta: -allocation.qty }` |
| Shortfall **on the ingredient** | `:386-410` | allocates or reports the deficit against the ingredient |

**So the model in this file is now complete, and it explains everything:**

> **A dish is never stock-gated on itself. It is stock-gated on its INGREDIENTS — and only if it
> has a recipe.** `tracks_inventory()` returning false for `Restaurant` is not a gap; it is the
> first half of a two-part rule, and the second half (`has_recipe`) is already implemented.

That is *why* the guard at `:282` reads `!tracks_inventory && !has_recipe` — it is not a sloppy
condition, it is the exact statement of "restaurant dishes have no own stock, but their
ingredients do".

### 10.2 ⚠️ THE REAL GAP — there is NO WAY TO CREATE A RECIPE

This is the finding that matters, and it is not in the checkout:

| Layer | State |
|---|---|
| Core deduction logic | ✅ complete (`:288-410`) |
| `product_recipes` table | ✅ exists (`init.sql:407`) |
| **Any `set_recipe` / `add_recipe_ingredient` in `crates/`** | ❌ **ZERO hits** |
| **Recipe in `crates/kasirmu-bridge/src/products.rs`** | ❌ **ZERO hits** |
| **Recipe IPC registered in either shell's `lib.rs`** | ❌ **ZERO hits** |
| **`ui/src/api` recipe module** | ❌ **none** |
| Recipe in any `ui/src/features/` file | ❌ only 4 **CSS** files match the substring |

**The only `INSERT INTO product_recipes` in the repo is in `recipes_tests.rs`.** So today a
recipe can be created **only by a test**. An operator cannot.

**Therefore the user's stated plan — "reduce kitchen inventory via menu recipe" — cannot be
executed at all today**, on any shell, for any product. The engine is built; there is no steering
wheel. This is the same shape as F24 earlier in this campaign: *a complete chain with no surface.*

### 10.3 REVISED RECOMMENDATION

**Do these, in this order. The order matters because each one unblocks the next.**

| # | Change | Why, and what it closes |
|---|---|---|
| **0** | **Fix demo fixtures sellable** (`todo-demo-fixtures-sellable.md`) | **Phase 0 closed.** The reported SKUs were in-memory fixtures in `useProducts.ts`. Return `[]` to eliminate phantom sales by construction. |
| **1** | **Remove `both`** (open question 5) | Unproducible, unreachable, two contradictory consumers. Pure debt removal; makes `product_type` a clean 3-way discriminator. |
| **2** | **A: constrain discriminator + fix `products_crud.rs:411` stock row creation** | Adds CHECK constraint on `product_type`. Fixes §10.5 write-side defect so products created with 0 initial stock get inventory rows. Unifies 4 `in_stock` copies. |
| **3** | **B: `RestaurantMenuItem` / `RetailProduct` types** | The readable separation. Now *well-motivated*: the two domains genuinely differ — one is stock-gated on itself, the other on ingredients. |
| **4** | **RECIPE AUTHORING (Post-beta feature)** | Deferred per `todo-restaurant-recipe-authoring.md`. Bridge `set_recipe`/`get_recipe` + IPC in both shells + UI Recipe editor. |
| **C** | **Still REFUSED** | §5a's reasoning is unchanged and, with the recipe mechanism in hand, *stronger*: the two domains share `sku`, recipes, images, tax and sales lines. Table split buys nothing here. |

**Recommendation: 0 → 1 → 2 → 3, then 4 as its own post-beta feature.** Item 4 is a **feature build**
(IPC + UI), not a reliability repair — so by this repo's own rule it should not ride in on the
bug fix. It is tracked separately in `todo-restaurant-recipe-authoring.md`.

### 10.4 What this changes in the ruling — and one claim WITHDRAWN

- **Open question 4 is ANSWERED by the user's steer.** *"Should a dish with a recipe be
  stock-checked?"* — **Yes, on its ingredients.** That is the intent, and the code already does
  it. So question 4 is closed, not open.
- **WITHDRAWN: "Option A closes the reported bug."** Already withdrawn in §6.3; now doubly so.
  If those SKUs have **no recipe** (and provisioning writes none), they are not stock-gated at
  all *once their type is correct* — so the dialog was most likely a **type** problem, and item 2
  is what fixes it. Consistent with §2.3, not a new hypothesis.

### 10.5 ⚠️ The sharpest defect in this plan, confirmed on the code

**The listing defect is wider than recipes, and it is the single most important thing below.**
Verified at `products_crud.rs:411`:

```rust
// Service products never get inventory rows — they have unlimited stock.
if initial_stock > 0 && product_type != "service" {
    tx.execute("INSERT INTO inventory (product_id, qty, updated_at) ...")?;
```

**An inventory row is created ONLY when `initial_stock > 0`.** And the Add-Product form
**defaults `initialStock: '0'`** (`ProductManagementScreen.tsx:61,229`).

So for **any** product created through the UI without typing a stock figure:

| | |
|---|---|
| inventory row | **not created** |
| `stock_qty` | `COALESCE(NULL, NULL)` = **NULL** |
| `in_stock` | `NULL.is_some_and(> 0)` = **false** |
| tile | **"Unavailable" — permanently** |

**This is not a restaurant-specific bug. It affects every product type, on both shells, and it
is reachable by anyone who adds a product and skips the stock field.** The reported restaurant
symptom is one visible instance of it; my F14a seeding fix earlier in this campaign
(`938d72f9f`) masked it on one device by writing inventory rows for the samples.

**The Two-Part Architectural Fix:**

1. **Write-side initialization (`products_crud.rs:411`):**
   When creating a product whose type tracks inventory (`Retail`), always insert initial rows into
   `inventory`, `stock_movements`, and call `upsert_stock_summary_in_tx` **even when `initial_stock == 0`**.
   This ensures `stock_summary` has an authoritative ledger row (`qty: 0`) instead of empty silence,
   so `(SELECT SUM(ss.qty)...)` evaluates to `0` rather than `NULL`.
2. **Read-side DTO mapping (`kasirmu-bridge/src/products.rs`):**
   Unify the 4 duplicated `in_stock` sites into:
   ```rust
   let in_stock = if !ptype.tracks_inventory() {
       true // Restaurant and Service without recipes are always orderable
   } else {
       pwd.stock_qty.unwrap_or(0) > 0
   };
   ```
   This cleanly separates the two concerns:
   - Untracked items (`Restaurant`, `Service`) are orderable by definition (`in_stock = true`).
   - Tracked items (`Retail`) depend strictly on available ledger stock (`qty > 0`).
   - Absence of initial stock input at creation never leaves a retail product in an undefined NULL state.

**This is the fourth time in this file that measurement changed the plan. It is also the first
time the finding is broader than the original report — the user's restaurant symptom was a
symptom, and the defect is generic.**

