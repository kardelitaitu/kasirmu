# An invisible hit area was eating clicks on a live button (round 217)

## How it surfaced

Round 216 named `pos-cart-kds-btn` as "reachable and uncovered". It is not, and chasing that
false lead is what found a real defect.

Round 216's own correction first: in the RESTAURANT workspace the cart header's terminal-action
cluster does not render at all — it is wrapped in `!sidebarOwnsTerminalActions`
(`CartPanel.tsx:649`, documented at `:641-648`) because PosScreen hands those controls to the
sidebar popover. So both the KDS button and the floor-plan button are correctly absent, and the
KDS route is covered through `restaurant-sidebar-kds`. That correction alone would have been a
thin round.

What IS reachable and untested is the RESUME half of the tab cycle: `pos-active-tab-banner` and
`pos-cart-new-tab-btn`, both gated on `activeOpenBillId`, which only a resume sets
(`OpenBillModals.tsx:158`). Round 215 pinned the PARK half; this is the other one.

## The defect

Writing that spec produced a 90-second click timeout, and Playwright named the cause exactly:

```
locator resolved to <button class="pos-held-item-resume" aria-label="Resume Table 12">
  <div aria-hidden="true" class="pos-resize-handle"></div> intercepts pointer events
```

Geometry, measured rather than guessed:

```
handle        x=915  w=4    (the visible separator)
handle::before left=-14px right=-14px z-index=200   -> covers x=901-933
resume button  x=871  w=69                          -> spans x=871-940
```

**A 4px separator's invisible 32px touch target sat over 39px of a live button.** The CSS said
so in its own comment — "Expand touch target hit area on mobile/tablet" — but the rule was
**unconditional**, outside any `@media (pointer: coarse)`. A mouse does not need a 32px target for
a 4px separator, and it is the desktop layout where the panel sits beside a list.

## The fix

Scoped the `::before` expansion to `@media (pointer: coarse)`. That is the direction the comment
already intended, and it keeps the tablet's measured 44px target the same file calls COMPLIANT at
`:605`.

**Kill-tested**: re-scoping it to a fine pointer restores the interception and fails the resume
case. Restored.

## What the spec pins — 2 passed

| Case | Asserts |
|---|---|
| resuming | no banner while parked; after resume the banner names the tab AND the lines come back — a banner over an empty cart would be a lie |
| New Tab | the control exists only on a resumed tab, and pressing it ends the tab and frees the cart |

The second is the operator's way OUT: without it, an operator who resumed the wrong tab is stuck
holding another table's order.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed, 2 skipped (portrait) |
| Kill-test | 1 failed, restoring the interception |
| `CartPanel.css` | +27 / -12, scoped |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## The shape

**A pointer-events interception is a product defect, not a test problem.** Playwright refuses to
click rather than dispatching anyway, which is why a real user's tap on Resume did nothing and no
test noticed — the control had never been driven. The tell is the message naming an element the
spec never asked for, and it is worth reading literally rather than reaching for `force: true`.