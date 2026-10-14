# The active-tab banner needs an open shift, and the shift control is in the popover (round 213)

## What was attempted

A coverage re-derivation put `CartPanel` at **1 of 10** — the outlier after rounds 204-212 worked
through `CartLineItem`. The two most valuable were its SAFETY surfaces:

| Testid | What it is |
|---|---|
| `pos-active-tab-banner` | names the tab that is open, so an operator can tell what they are serving |
| `pos-cart-conflict-alert` | says another screen holds the same tab |

The banner also carries a **documented defect history**: `CartPanel.tsx:745-752` records that it
is the DISPLAY half of the stray-table defect — rounds 40-42 stopped a non-dine-in order
CLAIMING, RELEASING and PERSISTING a table, but the banner still named one until the dine-in
rule was applied here too. A test asserting the banner agrees with the ORDER TYPE was the plan.

## Why it did not land

A spec was written and it failed. Probing found the reason is a **precondition, not a selector**:

```ts
const handleSaveTabClick = useCallback(() => {
  if (!activeShift) {
    addToast({ message: … 'retail-toast-open-shift-first', type: 'warning' });
    return;                       // <- the path stops here
  }
  ...
}, [activeShift, ...]);          // CartActionBar.tsx:113-126
```

**Save Tab requires an open shift**, and the banner only rises when a tab opens. Measured on a
fresh login:

```
TABLE_FIELD=1   SAVE_TAB=1 enabled=true   BANNER=0   ERROR_TEXT=(none)
HAS_OPEN_SHIFT=false   HAS_SHIFT_BUTTON=0
```

The click lands, no error surfaces, and nothing happens — the warning toast is gone before a
probe can read it. That is the mode this codebase handles well (the guard REPORTS rather than
failing silently); it just means the probe has to know the precondition.

## Where the shift control lives

Not in the cart. `restaurantCartActions` (`PosScreen.tsx:1805-1808`) passes `onOpenShift` into
the **restaurant sidebar POPOVER**, per the comment at `:1766-1771`: the cart header's buttons
were moved there so the workspace renders one action cluster rather than two.

So opening a shift in the restaurant shell needs the popover opened first — a step none of the
helpers does, and `e2e-shift-reconciliation.spec.ts` covers the STORE workspace's shift screen
rather than this one.

## What this round leaves

| Item | State |
|---|---|
| the banner spec | written, **removed** — not left failing |
| probes | removed |
| source | unchanged |
| tree | only other lanes' known entries |

**Zero new tests.** The deliverable is the measurement: the banner is reachable, its precondition
is an open shift, and the control that opens one is behind the restaurant sidebar popover.

## The unblocking step, stated for the next round

Open the shift through the sidebar popover, then Save Tab, then assert. The popover's own
affordance needs finding first — `RestaurantSidebar` renders `cartActions`, and its open trigger
is the next thing to probe. That is one focused step, not a rewrite of this round.

Worth adding to `helpers.ts` as `openRestaurantShift(page)` once it works, since any future spec
touching tabs or held carts will need the same precondition.