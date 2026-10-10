# todo — demo fixtures are sellable on the restaurant POS

> **Created 2026-10-10 · status: DONE — Option 2 implemented across useProducts.ts and RetailPosScreen.tsx; verified by npm run test -- src/__tests__/useProducts.test.tsx.**
>
> **Found while investigating** `todo-retail-vs-restaurant-product-model.md`, and it appears to be
> **the actual cause of that file's reported symptom.** A restaurant sale was refused with an
> *"Insufficient Stock"* dialog listing `MUFFIN-B` / `LATTE` / `CAPPU`, all `Available: 0`.
>
> **Those three SKUs are not database rows. They are demo fixtures.** They appear because
> `isDemoMode()` is true and the store DB is empty, so the menu renders a fictional catalogue.
> The checkout then validates that fictional cart against the **real, empty** database — where
> none of those SKUs exist — and refuses every line.
>
> **Not previously recorded.** The reliability log has no entry for this, and `isDemoMode`'s own
> suite (`demoMode.test.tsx`, 6 cases) tests the **predicate only** — nothing pins that the
> fixtures cannot reach a cashier's cart.

---

## 1. The mechanism, verified end to end

### 1.1 The gate

```ts
// ui/src/utils/demo-mode.ts:14-16
export function isDemoMode(): boolean {
  return import.meta.env.DEV || import.meta.env['VITE_DEMO_MODE'] === '1';
}
```

**In any dev build this is unconditionally true** — no flag needed. So a developer running the
desktop app locally, against a store database with no products, is in demo mode whether they
intended it or not.

### 1.2 The fixture substitution

`ui/src/features/products/useProducts.ts` falls back to fixtures in **two** places, both gated:

| Line | Trigger | Result |
|---|---|---|
| `:133-142` | `sessionToken` is null, or the IPC read throws | `SAMPLE_PRODUCTS` when demo, else `[]` |
| `:175-188` | **the DB returned zero products** | `SAMPLE_PRODUCTS` when demo, else `[]` |

The second is the one that fires here, and its comment states the intent: *"Empty DB in
dev/demo — sample catalog for preview purposes."*

**`useProducts` is consumed by the restaurant screens:**

- `ui/src/features/sales/PosScreen.tsx:143` — `const { products } = useProducts(...)`
- `ui/src/features/restaurant/RestaurantMenu.tsx:176` — `const { products, ... } = useProducts(...)`

### 1.3 The fixtures are marked SELLABLE

`useProducts.ts:12-29` — `SAMPLE_PRODUCTS`. The three SKUs from the screenshot:

```ts
{ sku: 'MUFFIN-B', name: 'Blueberry Muffin', ..., inStock: true,  stockQty: 20, productType: 'restaurant' }
{ sku: 'LATTE',    name: 'Caffè Latte',      ..., inStock: true,  stockQty: 50, productType: 'restaurant' }
{ sku: 'CAPPU',    name: 'Cappuccino',       ..., inStock: true,  stockQty: 40, productType: 'restaurant' }
```

Every one carries **`inStock: true`** and a **non-zero `stockQty`**. So the tile renders
**enabled and addable** — the fixture asserts its own availability, and nothing re-checks it.

### 1.4 The checkout does not know about demo mode

`git grep -n 'SAMPLE\|demo' -- ui/src/features/sales/PaymentModal.tsx` → **zero hits.**

PaymentModal is demo-unaware by design. It takes the cart and calls the real
`complete_sale_scoped`, which resolves the SKUs against the **real store database**. Those SKUs
are absent, so `batch_lookup_products` misses and `sales_checkout.rs:257-268` pushes a shortfall
with `primary_qty_available: 0` for each —

```rust
let Some((pid, ptype_str)) = product_map.get(line.sku.as_str()) else {
    shortfalls.push(Shortfall { sku: line.sku.clone(), ..., primary_qty_available: 0, ... });
    continue;
};
```

**That is the dialog.** `Available: 0` is not a stock figure at all — it is the absence of the
row, reported as zero.

### 1.5 The mismatch, stated once

```
menu      -> fixtures (MYTHICAL SKUs, inStock: true)
checkout  -> real DB  (those SKUs do not exist)
            => every line shortfalls at Available: 0
```

**The two halves of one sale read from two different sources, and nothing reconciles them.**

---

## 2. Why the existing guard did not help

The repo already understands this hazard. `ui/src/features/retail/RetailPosScreen.tsx:65-68`
states it exactly:

> *"These catalogs may NEVER surface in a production build, even when the live IPC catalog
> request fails: a cashier could otherwise see and select products that are not in the store.
> `isDemoMode()` gates them."*

So the `isDemoMode` guard is the intended control, and it works — **in production**. The
residual hole is the one the comment does not address:

| Build | Empty DB | Menu | Cart | Checkout | Outcome |
|---|---|---|---|---|---|
| **Production** | yes | `[]` (correct) | empty | n/a | ✅ correct |
| **Production** | no | real rows | real | real | ✅ correct |
| **Dev / demo** | no | real rows | real | real | ✅ correct |
| **Dev / demo** | **yes** | **fixtures** | **fixtures** | **real, empty** | ❌ **BROKEN** |

**The guard protects production, which is right. The broken case is dev/demo with an empty
DB — a state a developer reaches by doing nothing wrong.**

---

## 3. Why this was mistaken for a stock-model bug

Honestly recorded, because the misdiagnosis is instructive:

- The fixtures are tagged `productType: 'restaurant'`, so they *look* like real restaurant
  catalogue entries. Nothing on screen says "demo".
- The dialog reports stock quantities — `Wanted: 6`, `Available: 0` — so it reads as a
  **stock** finding, not a **provenance** one.
- The SKUs are absent from the DB, so a query for them returns nothing — which is *also* what a
  mistyped row would look like.

**Three separate plausible stories, and the stock-model one was wrong.** The decisive test was
asking *where the SKUs come from* — and `MUFFIN-B` exists in exactly one place in the repo:
`useProducts.ts:19`, as a fixture.

---

## 4. Fix options

**The requirement is one sentence: a demo catalogue must not be sellable.** Everything below
satisfies it differently.

### Option 1 — make the fixtures visibly demo, and refuse to sell them

| | |
|---|---|
| **Change** | A demo banner in the POS when `usingFallback` is true, and a checkout refusal with an explicit *"demo catalogue — not sellable"* message, before the stock path runs |
| **Pros** | Fixes the real hazard; the cashier is told the truth; no silent data |
| **Cons** | Touches PaymentModal, which is currently demo-unaware |
| **Risk** | Low |

### Option 2 — stop serving a sellable catalogue in demo mode

| | |
|---|---|
| **Change** | Make **both** fallback paths in `ui/src/features/products/useProducts.ts` return `[]` **always** (`applyUnavailableCatalog` at `:133-142` and the empty-array branch at `:175-188`), and surface the empty state (which already exists) instead of fixtures |
| **Pros** | Smallest change; removes the mismatch by construction — the menu and the DB can no longer disagree |
| **Cons** | Loses the preview value of an unseeded dev environment; phantom fixtures can be removed or relocated to test mocks |
| **Risk** | Low — proper demo catalogues in dev/demo should be provisioned into SQLite via database seeders, not injected in-memory |

### Option 3 — seed the demo database

| | |
|---|---|
| **Change** | When `isDemoMode()` and the DB is empty, provision the fixture rows into the **real** DB so both halves agree |
| **Pros** | Keeps the preview experience; makes the whole flow — including checkout — genuinely work end to end |
| **Cons** | Writes to the DB from the UI path; needs a decision on whether it also writes stock rows |
| **Risk** | Medium — writing data as a side effect of rendering is a pattern to be careful with |

**Note the relationship to `todo-retail-vs-restaurant-product-model.md` §10.5:** that file
records that `create_product` writes an inventory row **only when `initial_stock > 0`**. Option 3
would inherit that defect unless it seeds stock too — the same trap, one layer down.

---

## 5. Recommendation

**Option 2 now, Option 1 as the durable guard.**

Option 2 removes the mismatch **by construction** — if the menu can never show a product the
database does not have, the class of bug cannot recur. That is strictly stronger than detecting
it at checkout, which Option 1 does. Both fallback sites in `useProducts.ts` (`:133-142` on
null token / IPC catch, and `:175-188` on empty array) must return `[]` so that mount delays or
IPC blips do not leak fixtures onto the screen.

Option 1 is still worth having as a defense-in-depth guard: if any test fixture or fallback catalogue
ever reaches a cart, an explicit refusal (*"demo catalogue — not sellable"*) prevents a confusing
`Available: 0` stock dialog.

**Option 3 is the one I would not start with**, despite it being the most "complete": it makes
rendering a screen write to the database, and it would need to solve §10.5's stock-row problem
first or the demo rows land Unavailable too — reproducing this bug one level deeper. The proper
place to seed demo data is the workspace/store provisioning scripts, not a React hook.

### Acceptance

A dev build, with an **empty** store database or unmounted catalog, must not permit a phantom sale:

1. The 4-row table in §2 — the bottom case (dev/demo with empty DB or unavailable catalog) —
   renders the legitimate **empty menu state**; no fixture cards render, and the cart remains empty
   (checkout is never reachable with phantom items).
2. If fixtures ever reach a cart via any other route, Option 1's durable guard states an explicit
   **refusal** (*"demo catalogue — not sellable"*), never a stock shortfall dialog.
3. A test pins that neither `useProducts` fallback path (`applyUnavailableCatalog` or empty result)
   can hand a sellable product to a cart while the real catalogue is empty.
4. Kill-tested: reverting the guard must turn that test red.

---

## 6. Scope — Unified fix across Restaurant and Retail

- **IN SCOPE — Restaurant POS:** Both fallback sites in `useProducts.ts` (`:133-142` and `:175-188`)
  must return `[]`.
- **IN SCOPE — Retail POS:** `RetailPosScreen.tsx:498-506` has the identical pattern in its `.catch()`
  block (substituting `RETAIL_SAMPLE_PRODUCTS` when `isDemoMode()` is true). It shares the exact same
  hazard and is fixed in the same pass by returning `[]` on failure instead of phantom sellable items.
- **OUT OF SCOPE:** The stock model itself (`todo-retail-vs-restaurant-product-model.md`) and recipe
  authoring (`todo-restaurant-recipe-authoring.md`).

---

## 7. Architectural Invariant — Local-First Single Source of Truth

> **INVARIANT (DATA-01): SQLite is the sole source of truth for sellable products across all screens.**
>
> 1. UI components and data hooks (`useProducts`, `RetailPosScreen`) must **NEVER** synthesize
>    in-memory mock product catalogues for active POS carts.
> 2. An empty database must render the legitimate empty catalogue state, never fictional rows.
> 3. Demo/dev catalogues must be provisioned as real rows into SQLite via database seed scripts
>    (`provisioning.rs`), ensuring `products`, `stock_summary`, and tax configurations are mutually
>    consistent before a cashier reaches checkout.
