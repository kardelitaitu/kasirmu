# Restaurant POS — live behavioural pass: cart add & discount (2026-10-12)

## Why this exists

The a11y coverage for the restaurant POS is complete (see
`restaurant-pos-live-accessible-names.md`), but accessible names say nothing
about whether the controls DO the right thing. This record captures a driven
end-to-end pass against the running desktop app, so the flows below are known to
work on real IPC and real state rather than only in jsdom.

## Method

CDP against the live WebView2 (port 9222). Two techniques were needed and both
matter:

1. **Synthetic pointer sequence.** A bare `element.click()` did NOT add an item
   — the menu card owns `onPointerDown/Move/Up` handlers (long-press and swipe
   gestures), so a click alone is not the interaction the component listens for.
   Dispatching `pointerdown, mousedown, pointerup, mouseup, click` with real
   clientX/clientY does drive it.
2. **Native value setter** for React-controlled inputs:
   `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`
   then `dispatchEvent(new Event('input', { bubbles: true }))` — assigning
   `.value` directly is invisible to React's onChange.

## What was exercised, and what happened

| Step | Result |
|---|---|
| Add a menu card | The product **merged into its existing line** and the qty incremented 2 → 3 (a second card click did not create a duplicate line). |
| Subtotal | Recomputed to **Rp 2.000.000** from the merged lines. |
| Open the discount form | The form opened from the "+ Add Discount" button. |
| Apply 10% | Row appeared: `Discount (10% Discount)` **-Rp 200.000** — exactly 10% of 2.000.000, with a remove (×) control. |
| Discount applied state | The footer button becomes the clear (×) control; the label and amount render in the discount row. |

No console exceptions were raised during any step (`Runtime.exceptionThrown`
subscribed for the whole pass).

## Corrections to earlier assumptions

- The menu card is a **merge**, not an always-new line: two cart rows for the
  same SKU existed because the cart had been seeded that way by earlier manual
  use, NOT because one click adds a second line.
- The discount button's selector is **state-dependent**: with no discount it is
  `+ Add Discount` (opens the form); with one applied the footer control is
  `pos-cart-discount-clear`. A probe that reuses the first selector after
  applying will find nothing — which is what happened on the first attempt.

## Discount Apply boundaries — verified live

Clearing the applied discount reopens the form blank, which allowed the guards to
be walked directly. Each row is a real keystroke through the native setter:

| Field value | Apply button | Field after |
|---|---|---|
| (empty) | DISABLED | — |
| `0` | DISABLED | `"0"` |
| `101` | DISABLED | `"101"` |
| `10` | ENABLED | `"10"` |
| `2.5` | (unchanged) | `"10"` |

The last row is the interesting one: the fractional keystroke is **rejected, not
truncated** — the field stays at the previous valid value rather than silently
becoming `2`. That is the whole-non-negative-number guard in
`CartFooterTotals`, and it behaves correctly against the real component.

Cancelling the form left no discount applied, and clearing removed both the row
and the clear control.

## Completed sale — verified live

The sale was settled end to end: Charge → tender → Complete → receipt → Skip.

Tendering used the panel's own **Exact** button, which filled the field with
`2000000` — the payable in minor units. The receipt the POS then rendered was
correct in every particular:

```
kasir.mu Store          Oct 12, 2026
01-01-26 1011-01-000002
────────────────────────────────
Item            Qty  Price      Total
Pisang Goreng     1  Rp 500.000 Rp 500.000
No onions please
Tax: Rp 0
Pisang Goreng     3  Rp 500.000 Rp 1.500.000
Tax: Rp 0
────────────────────────────────
SUBTOTAL:              Rp 2.000.000
────────────────────────────────
TOTAL:                 Rp 2.000.000
CASH                   Rp 2.000.000
CHANGE:                Rp 0
Thank you for your purchase!
```

Two things the receipt proves that a unit test could not:

1. The **line note survived the whole way** — "No onions please" printed against
   the correct line, so the note is carried through `complete_sale`, not just
   held in cart state.
2. The arithmetic is **exact integer minor units**: 1×500.000 + 3×500.000 =
   Rp 2.000.000, tendered exactly, change Rp 0.

Dismissing the receipt with **Skip** closed the dialog and **reset the cart to
zero lines**, showing "Cart is empty / Tap a menu item to start the order".

### Driving note

The payment modal exposes three receipt actions — Skip, Issue Tax Invoice, Print
Receipt — and the Skip button responded to a **trusted CDP mouse event**
(`Input.dispatchMouseEvent`), not a dispatched DOM click. For a control that
settles money, use the real input path; a synthetic `.click()` is not the same
interaction and can silently do nothing while appearing to succeed. That is
exactly what made the first attempt look like a failure: the sale HAD completed,
and the "dialog still open" reading was the *receipt* modal, which also carries
`role="dialog"`.

## Not covered here

- The tip segments and service-charge toggle were enumerated but not exercised
  end to end against a settled total.
- KDS ticket lifecycle (accept → ready → served) on a live ticket.
- Void / refund of a settled sale.
