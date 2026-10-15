# The tablet cart sheet sat above every modal (round 243)

## The defect

`RestaurantCartSheet.css` stacked the cart sheet one level ABOVE the modal layer:

```css
/* before */
.restaurant-cart-sheet-panel    { z-index: calc(var(--z-modal, 100) + 1); }  /* 401 */
.restaurant-cart-sheet-backdrop { z-index: var(--z-modal, 100); }            /* 400 */
```

and every modal in the app uses `--z-modal` (400). Measured 2026-10-15 on the **tablet** project
with the price-override dialog open:

```
.restaurant-cart-sheet-panel  z-index 401
.price-override-overlay       z-index 400
document.elementFromPoint(centre of .price-override-next-btn) -> a node INSIDE the sheet
```

**The override dialog's own Next button was unreachable.** Tablet is the form factor the sheet
exists for, so the price-override feature was unusable on the device it was built around.

## The fix

Both the panel and the backdrop move to the layer that already exists for this:

```css
z-index: var(--z-overlay, 300);
```

`--z-overlay: 300` is below `--z-modal: 400` in the token scale. **A sheet IS an overlay** — the
`+ 1` treated it as a rival of the modal layer instead of a member of the one beneath.

The backdrop needed the same change and for the same reason: at 400 it was level with the
override's overlay, and DOM order then decided — the sheet renders after the modal, so the
backdrop covered it.

**Kill-tested**: restoring `calc(var(--z-modal) + 1)` on the panel fails the tablet case.
Confirmed by re-probe afterwards: `overlay 400` above `sheet 300`, and `elementFromPoint` at the
Next button's centre returns **the button itself**.

## What the spec covers

This is also the coverage round 242 set up: `deduction-location-badge` is the last uncovered cart
control, and it lives in the **sidebar popover** (`RestaurantSidebar.tsx:441-461`), not the cart
panel. It appears only once `ensureCart` runs, and `ensureCart` has exactly **one** caller — the
line-level price override (`CartPanel.tsx:1000`).

So the spec drives the whole three-step override (`price` → `username` → `pin`), dismisses the
tablet sheet through its own close control, opens the sidebar, and asserts the `Deducting:` row.

2 passed, desktop and tablet.

## The sequencing facts this needed, all measured

| Question | Answer |
|---|---|
| the override's steps | `price` is an `onClick` on a button (`:274`); `username` is a `<form>` (`:284`), so `Enter` submits it |
| the sheet's dismissal | its **close button**, not its backdrop — the backdrop is `<button tabindex="-1">` sitting *under* the panel, so clicking it is itself intercepted |
| the deduction wait | `ensureCart` sets the name asynchronously, so the popover opens after a settle |

The second is worth stating: round 242's failing attempt reached for the backdrop. Clicking the
backdrop is what a user does, but Playwright refuses it for a correct reason — **a backdrop belongs
below the thing it dims**, and that is now true here.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | fails on tablet with the old stacking |
| `kill-test` leftovers | 0 |
| eslint | 0 |
| Full UI suite | 12,716 passed — 0 failed, so the CSS change regressed nothing |

## CartPanel coverage, closed

| Control | State |
|---|---|
| tab banner, new tab, held badge, resize handle | covered (192, 196, 217, 218) |
| **deduction badge + override path** | **covered (243)** |
| `pos-cart-kds-btn` | absent by design — moved to the sidebar (216, re-confirmed) |
| conflict alert + takeover | needs a second terminal (216, unchanged) |

> last audited 15-10-26 by docs-auditor
