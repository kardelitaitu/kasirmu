# A real Card settlement driven to a receipt, live (round 118)

## The gap this closes

`restaurant-pos-cart-footer-live-controls.md` (2026-10-12) ran a live control-by-control pass
over the cart footer and closed with two declared gaps:

> *A settlement completed through Card or QRIS (the panels render; the charge was not driven
> to a receipt).*
> *The split-tender arithmetic against a real backend.*

This round closed the first.

## Method

Playwright against the Vite dev server, driving the real application:

1. `owner` -> Next -> PIN `1234` on the keypad.
2. Press `1` on the workspace picker -> **Restaurant POS**.
3. Click the first `.restaurant-grid-item` (Caffe Latte, `Rp 45.000`).
4. `Charge the customer` -> `label:has(input[value=card])` -> `Pay on card terminal`.

Two instrument notes worth keeping:

* **The radio is not clickable.** `locator('input[type=radio][value=card]').check()` times
  out with *"element is not visible"* — the control is styled out. Click the LABEL.
* **`Add` is not the button's accessible name.** `getByRole('button', { name: 'Add' })`
  never resolves; the product tiles are `.restaurant-grid-item`.

## The result

```
Caffe Latte              1  Rp 45.000   Rp 45.000
SUBTOTAL:  Rp 45.000
TOTAL:     Rp 45.000
Card       Rp 45.000
Thank you for your purchase!   [ Print Receipt ] [ Issue Tax Invoice ] [ Skip ]
```

The card tender settles, `TOTAL` equals `SUBTOTAL`, the receipt records the method as
`Card`, and the receipt screen renders its three actions. The record's first gap is closed.

## Incidental confirmations

* **Round 106's currency ladder is live.** The cash quick-tender buttons read
  `Rp 50,000 / Rp 60,000 / Rp 100,000` on a `Rp 45.000` cart — the IDR ladder multiplied by
  the exponent-0 scale, which is exactly what `defaultTenderPresets('IDR')` should produce.
  The fix is visible in the running app, not only in the unit test.
* The modal offers all six tenders: `cash, card, qris, credit, other, open_bill`.
* The workspace picker offers **Restaurant POS** first, alongside Store POS, Kitchen Display
  and Warehouse — so the restaurant workspace this session has been auditing for a hundred
  rounds is reachable in the dev-mock stack.

## Still open

**QRIS to a receipt** and **split-tender arithmetic against a real backend** are untouched.
QRIS needs the same drive with `input[value=qris]`; split-tender needs the cart's
`Split Bill` flow. Neither is claimed here.

**Docker is unavailable in this session** (`docker info` fails), so the full E2E stack and
any real backend cannot run. This pass is against the dev-mock handlers, which is the same
surface the 2026-10-12 record used.

## Verified

| Item | Result |
|---|---|
| Card settlement | drove to a receipt with correct totals |
| Full suite | 12,657 passed, 0 failed (no source changed) |
| Tree | `ui/src` clean but for another lane's file; scratch scripts deleted |
| Vite | stopped after the pass |