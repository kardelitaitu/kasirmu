# The memo stack covers the bottom of the receipts settings screen (round 247)

## What the round found

Two more receipts diagnostics were uncovered — the **cash drawer** kick and the **kitchen chit**.
Covering them turned up a measured collision, and the collision is the finding.

At the desktop 1366x768 profile with the dev-mock's two memos pending:

```
drawer button      y 682..726
.memo-stack        y 610..747        <- overlaps
viewport height    768
elementFromPoint(centre of the button) -> "memo-banner-title"
```

`scrollIntoViewIfNeeded` puts the button in the bottom strip the stack occupies, and Playwright
refuses the click. **That is the same shape `WorkspaceHome.css:248-290` documents for the
workspace picker** — a MEASURED DEFECT from 2026-09-30 where the admin workspace card came to rest
under the same stack — on a screen that has **no clearance rule of its own.**

## What was established while trying to clear it

| Measured | Value |
|---|---|
| the scroller found by class | `restaurant-settings-main`, `scrollHeight` 1467, `clientHeight` 705 |
| setting its `scrollTop = scrollHeight` | the button **did not move** — stayed at y=682 |
| `window.scrollBy(0, 400)` | also no movement |
| the button's own `scrollIntoView({block:'center'})` | no movement |

So `restaurant-settings-main` scrolls, but **not the content the button is in** — there is a nested
scrolling region between them, and the button is not in the outer one. Identifying it is the next
step; three candidates were eliminated and each elimination is recorded.

## Why the finding matters more than the test

A drawer button under a memo bubble is not a test problem. The memos are dismissible, so an
operator can clear them — but until they do, **a diagnostic they may need at closing time is behind
an overlay.** `WorkspaceHome.css` already treats this class as a defect worth a long measured
comment and a CSS clearance rule; the receipts screen has no equivalent.

The spec was deleted rather than shipped with `force: true`, which would have hidden exactly the
overlap worth reporting. Round 217's rule holds: **a pointer-events interception is a product
observation first and a test obstacle second.**

## The kitchen chit has a separate, simpler cause

`restaurant-kitchen-test-chit-btn` is gated on `hasKdsFeature && kitchenConnection !== 'disabled'`
(`:2853`), and the seeded profile has the kitchen printer **disabled** — measured, count 0. The
reachable twin is `restaurant-receipts-preview-test-chit-btn`, which shares `handleTestKitchenChit`
and is not gated. Any future spec should use that one; it was passing on tablet before this round
ended.

## Verified

| Item | Result |
|---|---|
| Probes run | 4, all removed |
| Source changed | none |
| New tests | zero |

## The next round's first step

Find the nested scroller between `restaurant-settings-main` and the drawer button — walk the
ancestors and log every element whose `scrollHeight` exceeds its `clientHeight`, not just the first
one whose `overflow-y` is auto. Then either scroll THAT one clear, or file the collision as a defect
with the geometry above.