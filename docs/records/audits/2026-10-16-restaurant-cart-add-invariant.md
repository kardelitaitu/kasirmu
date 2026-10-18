# Restaurant POS reliability: the cart-add invariant holds under rapid input

**Date:** 2026-10-16
**Scope:** `ui/src/features/restaurant/RestaurantMenu.tsx`,
`ui/src/features/sales/hooks/usePosCartActions.ts`,
`ui/src/features/sales/usePosState.ts`.
**Verdict:** verified correct. One candidate defect was chased to ground and withdrawn;
nothing was changed because nothing was broken.

## The question

`RestaurantMenu.handleAddProduct` (`:250-263`) carries **no cooldown**. Its 400ms
`addedSku` timer only drives the card's added-flash; the cart mutation itself is
unconditional and fires on every tap:

    setAddedSku(product.sku);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAddedSku(null), 400);

A cashier double-tapping a tile during service is the normal case, so the flash must
not be mistaken for a guard, and the absence of a guard must not mean a corrupt cart.
The guard has to live in the cart mutation. It does — and this note records where, so
the next reader does not re-derive it from the absence of one in the tile.

## Where the invariant actually lives

`usePosState.addProduct` (`:75-130`) resolves the line inside a **functional updater**:

    setLines((prev) => {
      const existing = prev.find((l) => { ... });

Two taps in one React batch both apply against committed state, so the second sees the
first's result. That is the whole reason a double-tap is safe: a handler written as
`setLines([...lines, line])` would close over a stale `lines` and lose a tap.

The merge key is SKU **plus** the line's attributes, not SKU alone — `l.courseId`,
`coursingStatus`, `note`, and the **sorted** `modifierId` list must all match
(`:94-102`). So the same dish ordered twice with different modifiers correctly stays
two lines instead of silently merging, which is the failure that would mis-bill a table.

## Measured in the live app (desktop project, restaurant workspace)

| Action | Lines | Result |
|---|---|---|
| 1 tap on item A | 1 | qty 1 |
| **5 rapid taps** on item A | 1 | **qty 5** — merged, no duplicates, no lost taps |
| 1 tap on item B | 2 | separate line |

The one-tap case is the **positive control**: it proves the 5-tap reading is a real
count and not a locator that always reports one line.

## Why no change was made

The merge-key contract is already pinned by **13 dedicated unit tests** in
`ui/src/__tests__/usePosState.test.ts:465-556` — fresh-add meta, merge-on-existing-SKU,
meta omitted, and explicit non-merge cases for `note`, `courseId` and `coursingStatus`,
plus the matching merge cases. Every dimension of the key named above has a test in both
directions. There is no gap to close here.

## Adjacent surfaces checked in the same pass

* **Shift gate** (`usePosCartActions.ts:150-160`) refuses an add only when the shift
  service is REACHABLE and no shift is open. The unreachable branch is covered by
  `usePosShifts.availability.test.tsx`, `CartActionBar.test.tsx` and
  `restaurant-payment-modal.spec.ts:85`.
* **Layout / touch targets** at both viewports (1024x1366 portrait and 1366x768):
  zero sub-44px POS tap targets, zero element overflow, zero offscreen controls, no
  document scroll spill.
* **Cart-sheet memo clearance** — the fix recorded at
  `RestaurantCartSheet.css:63-105` is still live: the memo stack sits at y 53-120
  (was 1141-1282 when it covered the toggle), `--memo-bottom-inset` resolves to
  `calc(85dvh + 0.75rem)`, and `elementFromPoint` at the
  `.pos-cart-options-toggle` centre returns `SPAN.pos-cart-subtotal-label` rather
  than `memo-banner-close`.

## Withdrawn candidate

`.memo-banner` reported `scrollWidth 511 > clientWidth 476`. Inspected before
reporting: the delta is the button's own padding box, the element computes
`overflow: visible`, and the text children's `scrollWidth` equals their
`clientWidth`. Nothing is clipped, so this was **not** filed as a defect.

> last audited 16-10-26 by docs-auditor
