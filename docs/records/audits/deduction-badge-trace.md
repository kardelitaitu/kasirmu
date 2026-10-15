# The deduction badge: reachable, and why it costs a price override (round 242)

## What the round established

`deduction-location-badge` and `deduction-override-indicator` are the last uncovered controls on
the cart. This round traced **where they live and what makes them appear**, which took four
probes and is the durable output even though no spec was committed.

### They are not on the cart panel

Round 216 recorded that the restaurant tier moves the header's buttons to the sidebar popover.
Re-confirmed at `CartPanel.tsx:441-445`, and the row itself renders at
`RestaurantSidebar.tsx:441-461` — alongside the shift rows the sidebar already covers.

So the gap is a **location** gap: the testids belong to a component no cart-side spec drives.

### What makes them appear

The badge renders when `deductionLocationName` is set, which happens inside `ensureCart`
(`usePosCartActions.ts:96-123`). Tracing its callers:

```
usePosCartActions.ts:296   returned to the caller
CartPanel.tsx:1000         ensureCart(l.unit_price.currency)     ← the ONLY call
```

`CartPanel.tsx:997-1000` is the line-level **price override** action:

```tsx
onOverride: (l: CartLine) => { setOverrideTarget(l); ensureCart(l.unit_price.currency); }
```

**So the cart is STARTED by a line action, not by mounting.** Adding an item does not set the
deduction location; overriding a line's price does. That is the reachability rule, and it is why
the earlier probes — which added an item and waited — saw `HAS_DEDUCT_TEXT=false` indefinitely.

The mock supports it: `start_sale_scoped` answers `deductionLocationId: 'default-loc'`
(`dev-mock/handlers/sales.ts:458`), so the badge can appear in the preview.

## The spec did not land

A spec was written that drives the override and then opens the sidebar. It failed on the sidebar
trigger: the element RESOLVED but was not clickable, which is the signature of something else on
top — most likely the override modal that `setOverrideTarget` opens (`CartPanel.tsx:998`). The
override flow is a **modal**, so it has to be completed or dismissed before the popover can be
reached, and that sequencing was not worked out inside this round.

The spec was deleted rather than left failing or loosened with `force: true`. **A pointer-events
interception is a sequencing fact about the test, not a product defect** (round 217's rule, in the
opposite direction: there the interception was the defect, here it is the test's own modal).

## Verified

| Item | Result |
|---|---|
| The badge's location | `RestaurantSidebar.tsx:441-461`, re-confirmed |
| The only `ensureCart` call | `CartPanel.tsx:1000`, the price override |
| The mock's answer | `start_sale_scoped` → `'default-loc'` |
| Probes run | 4, all removed |
| Source changed | none |
| New tests | zero |

## The next round's first step, precisely

Drive the override to completion: click the line's override control, **dismiss or confirm the
modal it opens**, then open the sidebar and assert the `Deducting:` row. If the override is
manager-gated, `loginAs(page, 'owner', ...)` already satisfies it — the affordance rendered in
the probe, so the gate is passed and only the sequencing remains.

## CartPanel coverage, unchanged

| Control | State |
|---|---|
| tab banner, new tab, held badge | covered (rounds 192, 196, 218) |
| resize handle | covered (round 217) |
| **deduction badge + override** | **location and trigger now known; not yet driven** |
| `pos-cart-kds-btn` | **moved to the sidebar** — absent here by design (round 216, re-confirmed) |
| `pos-cart-conflict-alert` + takeover | needs a second terminal (round 216) |