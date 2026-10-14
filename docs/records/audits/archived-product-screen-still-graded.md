# An archived screen still graded by 24 unit tests and 5 E2E tests (round 146)

## Scope note first

**This is outside the restaurant-POS objective.** `grep 'product-mgmt|VariantManagement'` under
`features/restaurant` and `features/sales` returns **zero** hits: the POS never touches this
screen. It is recorded because it was found while checking whether the remaining disabled E2E
specs were reactivatable like rounds 143 and 145, and because the shape is the same one three
earlier rounds named. It is a pointer, not this session's mandate.

## The finding

`ui/e2e/product.spec.ts` has **five `test.fixme` tests and zero enabled ones** — the whole
`Product Management` describe block, with **no skip reason recorded** on any of them. They drive
`.product-mgmt`, `.product-mgmt-table`, `.product-mgmt-cell-sku` after
`loginAs(page, 'admin', '9999')` and `selectWorkspace(page, WORKSPACES.INVENTORY)`.

Those selectors still exist — but in `VariantManagementScreen.tsx` (`:170`, `:207`, `:261`), a
**child** of the archived page, not in a live route. The trail:

| Evidence | Where |
|---|---|
| *"ARCHIVED: 'inventory' route — ProductManagementScreen was the old global inventory page"* | `features/products/register.tsx:18-22` |
| *"Files kept in features/products/ for reference but no longer registered as a navigable route"* | same |
| the only import of `ProductManagementScreen` anywhere | `__tests__/ProductManagementScreen.test.tsx:6` |
| `product-mgmt` selectors in `ui/e2e` | `product.spec.ts` only |

So the screen is **unreachable production code whose sole consumers are tests** — round 107's
pattern (`dead-hook-tests-mask-live-gap.md`), at page scale.

## What it costs

| Instrument | Count | Status |
|---|---|---|
| `__tests__/ProductManagementScreen.test.tsx` | **24 cases** | all pass, grading an unmounted screen |
| `e2e/product.spec.ts` | **5 cases** | all disabled, aimed at a deleted route |

Verified: `npx vitest run src/__tests__/ProductManagementScreen.test.tsx` → **24 passed**.

The live replacement — `WarehouseScreen` (`register.tsx:20-22` names it) — has E2E coverage in
`inventory-workflows.spec.ts` and `new-flows.spec.ts`, so the domain is not uncovered. What is
uncovered is nothing: the 24 unit cases assert a screen no user can open, and the 5 E2E cases
cannot run.

## Why it was not fixed here

Deleting `ProductManagementScreen.tsx` plus its test file is the obvious move and is *probably*
right, but it is not this session's subject, and the same trap rounds 107-110 documented applies:
the remedy is not deletion alone. Three questions have to be answered first, and each needs
someone who owns the products surface:

1. **Is `ProductManagementScreen` a fallback someone still reaches?** It is not registered as a
   route, and nothing imports it — but round 112 showed an unreachable surface can be an
   owner decision rather than an oversight (`LocalApiSection`), and round 127 showed the
   reasoning is sometimes already in-tree. No `DEAD` header is present here, unlike
   `AboutSection`/`AppearanceSection`.
2. **Do the 5 E2E cases have a successor?** They assert the product list renders, the table
   carries the expected SKUs, and the create/edit modals open. If `WarehouseScreen` is the
   replacement, those assertions should be re-pointed at it rather than dropped.
3. **Are the 24 unit cases worth porting?** They cover rendering, stock status and price
   formatting on the archived screen; `VariantManagementScreen.test.tsx` exists and may already
   cover the same ground.

## Verified

| Item | Result |
|---|---|
| `product.spec.ts` | 0 enabled, 5 `test.fixme`, no reasons recorded |
| `ProductManagementScreen` registered as a route | no (`register.tsx:18-22`) |
| its only importer | its own unit test |
| `ProductManagementScreen.test.tsx` | 24 passed |
| restaurant-POS connection | none — 0 grep hits in `features/restaurant` and `features/sales` |
| Tree | no source changed this round |