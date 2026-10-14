# The restaurant sidebar entries get E2E coverage — and the KDS row must stay hidden (round 149)

## The gap

The restaurant sidebar has seven rows. Until this round **only Settings** had E2E coverage;
a grep of all 40 specs showed the other six testids appearing in none of them:

```
restaurant-sidebar-menu-editor    nothing
restaurant-sidebar-receipts       nothing
restaurant-sidebar-payments       nothing
restaurant-sidebar-history        nothing
restaurant-sidebar-kds            nothing
restaurant-sidebar-close-shift    nothing
restaurant-sidebar-settings       restaurant-settings-toggles.spec.ts
```

Every one of those screens was driven by hand in earlier rounds (120, 126, 136) without ever
being pinned.

## The spec

`ui/e2e/restaurant-sidebar-entries.spec.ts`, five cases:

| Case | Asserts |
|---|---|
| every row for an owner | six rows attached and enabled; the seventh asserted ABSENT |
| Menu Editor | header appears, the sale is GONE, back returns to the grid |
| Receipts | title and the receipt preview render |
| Payments | title renders and the rail switches are non-empty |
| History | back control renders, and using it returns to the grid |

The route is what these prove, not each screen's behaviour — that belongs to the screen's own
suite. What they catch is a row that stops firing, or a screen that mounts without its way back.

## The case that was wrong first, and why that matters

My first version asserted all **seven** rows present-and-enabled. It failed on
`restaurant-sidebar-kds`, and the failure is **round 128's fix working**:

```
restaurant-sidebar-kds should exist
Expected: attached
Error: element(s) not found
```

Round 128 AND-ed the row's predicate with `isEnabled(FEATURES.KITCHEN_DISPLAY)`, because
`isPageAccessible` alone could not hide it — the `kds` page carries only a feature flag, not a
role or permission. Round 129 then measured the dev-mock's answer:

```ts
'get_enabled_features': () => ({ features: ['sales','inventory','reporting','staff','settings'] })
```

`kitchen-display` is not in it, so `showKitchenDisplay` is `false` and **the row is correctly
hidden**. The spec now asserts its ABSENCE with a comment explaining that a reappearance means
either the feature gate was dropped or the mock's feature set changed.

## Both halves kill-tested

| Mutation | Result |
|---|---|
| remove the Menu Editor row's `onOpenMenuEditor?.()` | **fails** — the route case |
| drop `isEnabled(FEATURES.KITCHEN_DISPLAY)` from `PosScreen.tsx:1748` | **fails** — the absence case |

The second is the interesting one: it means round 128's fix is now **pinned by a test**, not
only by a record. Before this round, deleting that gate would have broken nothing in the suite.

## Verified

| Run | Result |
|---|---|
| New spec | **10 passed** (5 x desktop/tablet) |
| Kill-tests | both fail as intended |
| Source files | `RestaurantSidebar.tsx`, `PosScreen.tsx` verified **identical to HEAD** |
| `eslint` / `tsc` | 0 / 0 |
| Full UI suite | 12,670 passed, 0 failed |