# Retail: an optimistic add that was never rolled back, and a category that was never saved

**Date:** 2026-10-11 · **Round:** 52 (session) · **Status:** FIXED (both)
**Area:** `ui/src/features/retail/RetailPosScreen.tsx`

## Defect 1 — a refused product add left the row on screen

`handleSaveNewProduct` (:605) inserts the new product into `products` BEFORE awaiting
`createProductScoped` (:606). The catch toasted and nothing else — it never removed the
row.

So when the create is refused (duplicate SKU, permission, network) the operator sees the
product in the grid and believes it is saved. It vanishes on the next reload — after they
have moved on. **Same class as the ADR #36 comment directly above it** ("previously the
product only lived in local React state and vanished on reload"), reintroduced on the
FAILURE path, which the success-path fix did not cover.

**Fix:** the catch removes the optimistic row (`setProducts(prev => prev.filter(p => p.sku !== newProd.sku))`)
before toasting, so the grid agrees with the server.

## Defect 2 — a new CATEGORY was never persisted at all

`handleSaveNewCategory` (:595-600) appended to React state, called `invalidateCatalog`,
and never awaited a write. `createCategoryScoped` exists (`api/products.ts:285`) and **the
whole retail feature called it zero times.**

The category lived only in local state and disappeared on the next reload. This is the
exact defect ADR #36 fixed for products, still open for categories.

**Fix:** the handler awaits `createCategoryScoped`, adopts the SERVER's id when it
differs from the client-minted `cat-<timestamp>` (AddCategoryModal.tsx:45) — otherwise the
products filed under that id reference a category that does not exist — and on failure
adds nothing and reports.

## Why nothing caught it

**The mock-factory gap and the defect were the same omission.**
`createRetailProductsApiMock` listed `createCategoryScoped` in its KNOWN_GAPS ledger, so
the factory had no such key and **no suite routing through it could have called the
function**. The absence of the mock guaranteed the absence of the coverage, and the
ledger recorded the gap as acceptable.

Adding the mock tripped `mockFactorySurface.test.ts` on the first full run, naming the row
and the count: `gap set changed... expected [ 'createCategoryScoped', ...(7) ]`.
Closing the gap required closing the ledger entry. That is the guard working exactly as
designed: 8 names became 7, and the removal is now recorded in the file.

## Evidence

Both tests **RED before their fix, green after**, and each **kill-tested**:

- *does not leave an unsaved product on screen when the add is refused* — RED printed
  `Brand New Product` still present after the refused create. Kill: removing the
  `filter` line reproduces it.
- *persists a new category instead of only adding it to local state* — RED with
  `a new category was never sent to the server: expected "vi.fn()" to be called 1 times,
  but got 0 times`. Kill: replacing the call with a no-op reproduces it.

- `RetailPosScreenInteractions.test.tsx` **46 passed** (was 44 — two new)
- full UI suite **807 files, 12,817 passed**
- `typecheck` clean · `eslint` no new findings

## How this was found

A sweep for **optimistic local updates whose catch has no compensating setter** — a state
change the operator *sees* that the server never accepted. The sweep found the product
case; reading its immediate sibling found the category case, which is worse (no write at
all, not a failed one).

The generalisable lesson: **a mock factory's KNOWN_GAPS list is a coverage map.** A name on
that list is a call no test can make, and it deserves reading as a suspect rather than as
an accepted gap.

> last audited 11-10-26 by docs-auditor
