# An unbounded quantity field, and an Escape that ate the sidebar — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 94 · status: 2 defects fixed,
     2 classes swept clean · branch: 0.0.41 · commits: `235083152`, `981902c56` -->

<!- - Scope: restaurant POS usability and reliability, on a tree verified green at
     811/811 (12,869 passed) by the round-93 baseline. -->

## Defect 1 — the quantity picker had no ceiling (money)

`RetailPosScreen.handleConfirmQty` clamped a picked quantity with
`Math.max(1, parseInt(qtyInput, 10) || 1)` — the LOWER bound only. The box that feeds
it, `setQtyInput`, was handed to the modal RAW as `onInputChange` (`RetailModals.tsx:618
-> :2046`) with no validation.

**The stock check does not save you.** `:391-397` is the only other gate and it is
skipped entirely when `stock_qty` is `null` — every service item, and any product
inventory does not cover. With it skipped nothing remained: the typed value went
straight to `addProduct`, the cart, and the server.

**Measured, not reasoned:** typing `999999` committed exactly 999999 units.

**The money is on screen before the confirm.** `RetailModals.tsx:655` multiplies the
unit price by the raw input for the modal's total line, so the cashier reads
`Rp 3.499.996.500` as a price for a 3,500-IDR item.

### Why the ceiling is 9999 and why it lives where it does

The DB CHECK on line quantity is `qty > 0` (20260813_init.sql:208) with **no upper
limit**, so nothing downstream would have caught it — this is a BUSINESS bound, not a
schema one. It is applied on the WRITE (`handleQtyInputChange`), not only at the
commit, because the modal computes its displayed total from the same string: a bound
applied only at commit leaves a wrong money figure on screen. One ceiling, two paths
bounded, and a comment explaining why they are not two.

The commit site keeps a backstop (`:391-397`'s clamp), which is why the first kill
test — reverting only the writer — failed just ONE of the two cases. That is
defence-in-depth behaving correctly, and killing both reproduces the pre-fix state and
fails both.

## A test that would have passed for the wrong reason

The first version of the case drove SKU-001 (stock 100) and got **zero** `addProduct`
calls — the stock guard rejected 999999 and the case would have looked green while
proving nothing. Same trap the round-93 popularity fixture fell into. Rewritten to
strip `stock_qty` from the fixture so the only thing that can stop the value is the
ceiling itself.

## Defect 2 — Escape destroyed the sidebar

The feature round 93 shipped opened the shortcut-help panel inside the sidebar. The
sidebar's Escape listener is on `document` (:384-395) and closed the PANEL outright,
so pressing Escape on the help list threw away the whole sidebar — and with it the
cashier's place in the POS. **Measured:** the panel stayed mounted AND
`onOpenChange(false)` fired.

Escape is the key a user presses to dismiss the thing they just opened. Fixed by
unwinding the innermost layer first, which is the rule the commerce surfaces already
follow (`PosScreen`'s Escape closes the split-bill dialog and leaves the sale view up).

### The same class, swept

The class is "a global Escape closes the outer surface while an inner overlay is open".
Four restaurant sub-screens registered as candidates — and all four are **correctly
guarded**, because they route Escape through `handleRequestBack()` (which raises the
unsaved-changes dialog) and defer to any open `role="dialog"`. Closed, not re-audited.

## The detector discipline, applied again

The first version of the numeric detector returned 0 hits and was **wrong**: its
`!/Math\.min\(/` exclusion matched an unrelated `Math.min` elsewhere in the very file
under audit, so it was blind to the defect. Validated by reconstructing the pre-fix
file — which the detector must flag and did not. Rewritten to scope the check to the
quantity EXPRESSION, re-validated, and only then trusted for the sweep, which came
back clean. A detector that reads zero on a known-bad case is measuring itself.

## Verification

- `npx vitest run src/__tests__/RetailPosScreenInteractions.test.tsx` — 53/53.
- `npx vitest run src/__tests__/RestaurantSidebar.logic.test.tsx` — 35/35.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.
- **Kill tests:** revert the clamp writer → the money case fails on
  `Rp 3.499.996.500`; revert writer AND commit backstop → both cases fail; remove the
  Escape inner-layer branch → the panel survives Escape and the case fails on it.
  All three files restored byte-identical.

> last audited 18-10-26 by autonomous-goal-round-94
