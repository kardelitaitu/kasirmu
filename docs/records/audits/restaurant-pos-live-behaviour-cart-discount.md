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

## Not covered here

- A completed sale through the payment modal (the modal was opened and its
  controls enumerated, but the sale was not settled — no receipt was produced).
- The tip segments and service-charge toggle were enumerated but not exercised
  end to end against a settled total.
- KDS ticket lifecycle (accept → ready → served) on a live ticket.
