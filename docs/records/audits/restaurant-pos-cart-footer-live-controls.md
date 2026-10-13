# Restaurant POS cart footer — live control-by-control pass (2026-10-12)

## Why this exists

Round 34 found the "Other" tender unreachable by pointer. That was found by
clicking a control and checking whether anything happened, so this pass ran the
same method across the whole cart footer. It also corrects three of MY OWN
misreadings from earlier rounds, which is the more useful half of the record.

## Method

Playwright against the Vite dev server (:1420), logged in as `owner` / PIN 1234,
one item in the cart, dev toolbar hidden (`.dev-toolbar{display:none}` — it is a
fixed overlay that intercepts clicks). For each control: snapshot the rendered
cart text, click, snapshot again, and report whether it CHANGED.

## Every control, and what it did

| Control | Result |
|---|---|
| `+ Add Discount` | Opens the inline discount form (one line, below the buttons) |
| `+ Promotions` | Opens the promotions modal, 3 offers, "Apply promotions" |
| Tip `15%` | `Tip (15%) +Rp 6.750` on a Rp 45.000 subtotal — correct |
| Toggle service charge | `Service (10%) +Rp 9.000`, subtotal recomputed |
| Clear cart | Cart empties to "Cart is empty / Tap a menu item to start the order" |
| Charge | Opens the payment modal |
| Remove line | Removes the line |

Promotion flow, end to end: toggle "Happy Hour 15%" (`aria-checked` goes true,
"1 selected") -> Apply -> modal closes -> cart shows a `Happy Hour 15% ×` chip and
a toast confirms "Promotions applied: Happy Hour 15%".

Discount boundaries re-verified live (they were only unit-tested before):

| Field value | Apply button | Field after |
|---|---|---|
| (empty) | disabled | — |
| `0` | disabled | `0` |
| `101` | disabled | `101` |
| `10` | enabled | `10` |
| `2.5` | (unchanged) | `10` — fractional REJECTED, not truncated |

Applying 10% renders `Discount (10% Discount) -Rp 4.500` = exactly 10% of
Rp 45.000, with a `×` remove control.

## Three corrections to earlier readings (mine, not the app's)

1. **`+ Promotions` "not found"** — my selector used
   `.pos-cart-promotions-btn`. The real class is `pos-cart-promotion-btn`
   (singular).
2. **`.pos-cart-discount-btn` matched two buttons.** `+ Add Discount` and
   `+ Promotions` SHARE that class; `querySelector` returns whichever comes
   first. Target by text, or take the index deliberately.
3. **The discount form is INLINE, not a modal.** It renders as
   `.pos-cart-discount-form` inside the footer (CartFooterTotals.tsx:176), so
   scanning `[role="dialog"]` for its inputs finds nothing — which is what I
   reported twice before checking.

## One state I checked because it looked wrong

An empty cart reports the footer controls as present-but-enabled if you query
them at the moment of the clear. Re-checked after the re-render: on an empty cart
the discount/promotions/clear/charge controls are **not rendered at all** (`null`
from the DOM), so there is no stale enabled button. The first reading was a query
taken before React re-rendered — my timing, not a defect.

## Not covered

- A settlement completed through Card or QRIS (the panels render; the charge was
  not driven to a receipt).
- The split-tender arithmetic against a real backend.

> last audited 14-10-26 by docs-auditor
