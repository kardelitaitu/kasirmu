# The tablet divergence was my spec not opening the cart (round 260)

## Round 259 recorded a defect that was not one

Round 259 gated its spec to desktop and recorded *"a real behavioural divergence in the modifier
chain: the customizer opens on tablet and the choice does not stick."* That was wrong, and this
round traced the exact reason.

## The measurement that settled it

Probed the tablet path after confirming the customizer:

```
OPTION_IDS     ["modifier-opt-<uuid>-0"]    the option WAS clickable and identifiable
CONFIRM        enabled, then clicked
MODAL_AFTER    0                             the customizer closed normally
SHEET          false                         - the cart sheet is not open
bar            true, reading "1 item Rp 50.000 View Order"
```

**Rp 50.000 is 45.000 for the item plus the 5.000 modifier.** The choice attached correctly. The
cart on the tablet profile is a FLOATING BAR, not an open sheet, so `.pos-cart-line` was never in
the DOM and the Edit control could not be found — by me, not by an operator, who reaches for the
same trigger the desktop spec's helper already knew about.

## The fix, and the round's one-line lesson

```ts
await openRestaurantCart(page);
```

The established helper (`ui/e2e/helpers.ts`) opens the sheet only when the lines are not already
on screen, so it is a no-op on desktop and the trigger-click on tablet. **The gate is gone and
both profiles pass — 2 passed, no skips.**

The lesson is the round-226 one in its cheapest form: **a control that cannot be found is not a
control that does not exist.** Round 259 read an absence and wrote a defect report about it, which
is the exact failure it had named one round earlier.

## What round 259 got RIGHT, and it stayed

Two things from last round survived untouched and are still the value of the spec:

| From 259 | Status |
|---|---|
| the option selector — `getByText(/Extra Hot/)` rather than a testid prefix that matched the GROUP first | **kept** |
| the wait for the confirm to ENABLE, which is itself the check that a choice was made | **kept** |

## Verified

| Item | Result |
|---|---|
| The spec | 2 passed (desktop + tablet), **0 skipped** |
| Kill-test | 2 failed — one per profile |
| `CartLineItem.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## CartLineItem, complete on both profiles

| Control | Round |
|---|---|
| modifier region | 212 |
| action cluster | 217 |
| edit-modifiers | 259, **260** |

## The correction, and what it says about the method

Three rounds in this session have now been spent un-writing a defect: round 250 reverted a real
fix, round 251 withdrew a real defect, and round 259 invented one. **The common shape is a probe
that reads an absence and a record written the same day.**

The habit that would have caught it in round 259 is one line: **when a control cannot be found,
ask what ELSE is not on screen.** Here the answer was the entire cart, and its own floating bar was
reporting the correct total the whole time.

> last audited 15-10-26 by docs-auditor
