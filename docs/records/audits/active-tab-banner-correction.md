# Round 213's conclusion was wrong, and probing the popover is what showed it (round 214)

## What round 213 concluded, and why it did not survive

Round 213 recorded:

> **Save Tab requires an open shift**, and the banner only rises when a tab opens. …
> `HAS_OPEN_SHIFT=false` … the control that opens one is behind the restaurant sidebar popover.

Both halves of the chain were read correctly from the source:

| Claim | Verified |
|---|---|
| Save Tab needs a shift | yes — `CartActionBar.tsx:113-120` returns early without one |
| the shift control is in the popover | yes — `onOpenShift` is passed into `restaurantCartActions` (`PosScreen.tsx:1805-1808`) |

The CONCLUSION drawn from them was wrong. Probing the panel this round:

```
PANEL_ITEMS=9
OPEN_SHIFT=0    CLOSE_SHIFT=1
ITEMS=["Close current shift", "History", "Menu Editor", "Receipts", "Payments", ...]
```

**The dev-mock seeds an ACTIVE shift.** The row renders as `restaurant-sidebar-close-shift`, so
`OPEN_SHIFT=0` was round 213 reading a correct number and inferring a precondition that was
already satisfied. `HAS_OPEN_SHIFT=false` was true for a different reason: the probe was looking
for the *words* "open shift" in the page body, and the control was not rendered at the time.

## How to reach the shift panel

The trigger is `.restaurant-sidebar-btn` in the menu header (`RestaurantMenu.tsx:635-648`),
carrying `aria-expanded` and `aria-controls="restaurant-sidebar-panel"`. One click sets
`aria-expanded="true"` and all nine rows render:

```
TOGGLE=1    EXPANDED=true
```

That is the step round 213 said needed finding. It is one click, and it is now recorded.

## What still did not work, and what that leaves

With the shift already open and the cart carrying a line, **Save Tab produces no banner:**

```
AFTER_OPEN_LINES=1   AFTER_DISMISS_LINES=1   SAVE_TAB=1   TABLE_INPUT=1
DIALOG=0   BANNER=0   (no toast either)
```

Every precondition the source names is satisfied — `activeShift` is set, the cart is non-empty,
the table field is filled — and the click still raises nothing. The path is guarded further in
(`usePosHeldCarts.ts:202-280`: dispatch-on-save, label building, update-vs-create) and locating
the exact stop needs more than this round's remaining budget.

The spec was written, failed, and **removed** rather than left red.

## What this round leaves

| Item | State |
|---|---|
| round 213's conclusion | **corrected** — the precondition was already met |
| the popover trigger | found and recorded: `.restaurant-sidebar-btn`, one click |
| the banner spec | written, removed |
| probes | removed |
| new tests | zero |

## The shape worth keeping

**Two correct readings can support a wrong conclusion.** Round 213 verified that Save Tab needs a
shift and that the control is in the popover — both true — and then treated `OPEN_SHIFT=0` as
evidence that no shift was open, when it actually meant one was open and the row therefore read
*Close*. A probe that searches for the text of an action will find its opposite too, and reading
`CLOSE_SHIFT=1` beside it is what settles the question.

> last audited 14-10-26 by docs-auditor
