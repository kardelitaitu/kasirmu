# The menu tile's out-of-stock state is pinned in the UNIT layer, not in E2E (round 150)

> **CORRECTED within the round.** The first version of this record claimed
> `RestaurantMenu.test.tsx` had no stock coverage and that the state was unreachable in the
> dev mock. Both were wrong, and both were found by reading the suite the tile's own header
> names instead of grepping `ui/e2e` for class names.

## What the tile's header says, and what that meant

`MenuItemTile.tsx:14-16`:

> *The `restaurant-card*` class names and DOM shape are pinned by `RestaurantMenu.test.tsx` and
> `restaurantCardHeight.test.ts` — never rename them here.*

Reading that suite instead of grepping the E2E directory changes the answer:
`RestaurantMenu.test.tsx` has **60 cases**, at least six of which name the out-of-stock path:

| Case |
|---|
| `does not add an unavailable card to the sale and displays 86 badge` |
| `marks a product unavailable via the context menu and blocks adding it` |
| `marks a card unavailable and available again without allowing checkout` |
| `shows a visible and accessible unavailable status without adding the c…` |
| `does not offer a local availability toggle for source-unavailable prod…` |
| `reloads product catalog and unavailable status on visibility change` |

Verified: **60 passed**.

## The two errors, and the pattern they share

1. **I grepped `ui/e2e` for the class names** and concluded "nothing covers them". The
   coverage is in the unit layer, which is where these behaviours belong — they are about the
   tile's reaction to a prop, not the shell's layout, and jsdom expresses them directly. The
   mock's lack of an `in_stock: false` fixture is not a gap at all: the unit suite supplies
   the prop itself.
2. **I treated an `in_stock: false` fixture as necessary to reach the state.** It is necessary
   only for an E2E route. The component does not care where the prop came from.

Both are the round-150 instance of a standing lesson: **"not in E2E" is not "uncovered."**
The same shape as round 135's two-sample receipts, where the answer was in the Rust tests
rather than in the browser.

## What remains true, and it is narrow

The tile's out-of-stock behaviour has **unit** coverage and no **browser** coverage, so a
defect that appears only in a real shell on this path would not be caught. That is a much
smaller claim than the one first recorded, and it is the one this record now makes.

## Kill-tested, so the coverage is not asserted on trust

Removing `aria-disabled={!product.inStock}` (`MenuItemTile.tsx:223`) fails **four** cases:

| Case |
|---|
| `shows a visible and accessible unavailable status without adding the card` |
| `does not offer a local availability toggle for source-unavailable products` |
| `marks a product unavailable via the context menu and blocks adding it` |
| `marks a card unavailable and available again without allowing checkout` |

Restored, and the file verified identical to HEAD.

## Verified
| Item | Result |
|---|---|
| `RestaurantMenu.test.tsx` | **60 passed**; six name the availability path |
| `restaurantCardHeight.test.ts` | 5 cases; pins the card's shape |
| E2E coverage of `restaurant-card--disabled` | none, and correctly so |
| dev-mock `in_stock: false` fixtures | 0 — not a defect, see above |
| The app-level guard | `MenuItemTile.tsx:214` still guards the add path |
| Tree | no source changed this round |