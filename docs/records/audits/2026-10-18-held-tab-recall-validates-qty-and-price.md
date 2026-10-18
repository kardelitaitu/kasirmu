# A recalled held tab validates its qty and unit_price

Date: 2026-10-18 (round 121). Surface: the restaurant POS held-tab recall.
Subject: `ui/src/features/sales/hooks/usePosHeldCarts.ts` `handleResumeOpenBill`.
Commit: `38d155da7` — *fix(sales): validate qty and unit_price when recalling a held tab*.

## The defect

`handleResumeOpenBill` rebuilt every line of a recalled tab with the RAW payload
values (`usePosHeldCarts.ts:409-434` before the fix):

```ts
setLines(data.lines.map((l: {
  sku: string;
  qty: number;
  unit_price: { minor_units: number; currency: string };
  ...
}) => ({
  ...
  qty: l.qty,                 // cast, not a check
  unit_price: l.unit_price,   // cast, not a check
})));
```

Both annotations above the arrow are TYPE ASSERTIONS. TypeScript erases them, so
they check nothing at runtime — and `cart_data` is precisely the untrusted
boundary: JSON written by `holdCartScoped`, round-tripped through SQLite, read
back here.

## Why it is money, not cosmetics

`usePosState.subtotal` (`:281`) sums `l.unit_price.minor_units * l.qty` with no
guard of its own, and every downstream memo — `discounted`, `total`,
`discountAmount` — reads that sum. Measured against the two malformed lines the
new test feeds it:

```
subtotal minor_units = NaN
Number.isFinite = false
```

So a single non-numeric quantity or price makes the WHOLE cart NaN minor units,
and the total the waiter reads on the pay screen is `NaN`. This is the same
defect class the round-118 retail `discountPercent` fix describes, reached
through a field nobody was checking.

## The asymmetry that made it findable

The RETAIL twin already guards this — `RetailPosScreen.handleResumeCart`
(`:1483-1487`) tests `typeof l.unit_price.minor_units !== 'number'` and
`Number.isFinite(l.qty) && l.qty > 0`, defaulting a bad quantity to 1. The
restaurant copy, which is the one that runs on a busy floor, did not. That is a
drift between two implementations of one rule — the shape this audit keeps
finding — rather than an invented concern.

## The fix

The restore callback now validates before constructing the line, and returns the
validated values:

```ts
const minor = price && typeof price.minor_units === 'number' && Number.isFinite(price.minor_units)
  ? price.minor_units
  : 0;
const qty = typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty > 0
  ? Math.round(rawQty)
  : 1;
```

A malformed price falls back to 0 and a malformed quantity to 1 — the retail
twin's own rule. Deliberately a type/finitude check, NOT a blanket refusal: a
well-formed qty and price must still restore, or the fix would be 'never resume a
tab with items'. The pre-existing case *resumes normally when the cart is empty*
and the two `setLines` restore cases cover that direction.

## Verification (kill-tested)

* RED first: the new case failed at HEAD with
  `a non-numeric qty was restored as-is; the subtotal becomes NaN minor units`.
* GREEN after the fix, with the file's other 18 cases:
  `19 passed (19)`.
* KILL: reverting the two validated bindings to `qty: l.qty, unit_price:
  l.unit_price,` turned the case red again, then the file was restored and
  confirmed byte-identical. The assertion is load-bearing, not satisfied by the
  mount path.
* Neighbour suites re-run with the change in place: `usePosHeldCarts.test.tsx`,
  `usePosHeldCarts.leaseConflict.test.tsx`, `RetailPosScreen.test.tsx`,
  `RetailPosScreenInteractions.test.tsx`, `PosScreen.integration.test.tsx` —
  `191 passed (191)`.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings,
  none introduced — the one warning in this file is at `:541`, a different
  callback); `npm run lint:i18n` exit 0.

## Note on the round's full-suite number

The workspace-wide run finished `3 failed | 808 passed (811)` files,
`4 failed | 12891 passed (12901)` tests. ALL FOUR failures name
`features/tables/TableManagementScreen.css` / `TableManagementScreen.tsx` and
were introduced by commit `4347b36d2` (*feat(tables): add section manager,
arrange inspector, and quick dining actions*), which landed in this same session
4 seconds before this round's commit, from another lane:

* `nativeDialogCompliance` — `window.confirm` added to `TableManagementScreen.tsx`
* `noiseDitherCompliance` — `.tables-arrange-inspector` uses `--shadow-*` without
  a noise-dither entry
* `screenExtraction` ×2 — `tables-arrange-inspector-title` used but undefined;
  `tables-table--square` defined but unreachable

Each was confirmed by reading the offending lines out of the COMMITTED blob
(`git show 4347b36d2:...`), not from the worktree. This round's commit touches
neither of those files and changes no CSS. Recorded here so the next round does
not re-derive it.

> last audited 18-10-26 by docs-auditor
