# The context menu's Escape guard, unpinned like round 173's (round 174)

## Extending round 173's technique

Round 173 read one component's docblock and checked its eight claimed invariants against the
tests that supposedly pinned them, finding one gap. The obvious next step was to apply the
same check to the rest, so this round did.

Eight restaurant components carry docblocks with an `Invariants:`-style section. Six make a
*"pinned by …"* claim and most name a file:

| File | Claim |
|---|---|
| `MenuCategoryTabBar.tsx:13` | `restaurant-category-pill*` pinned by the bundle-parity gate + RestaurantMenu.test.tsx |
| `MenuItemTile.tsx:14` | `restaurant-card*` class names and DOM shape |
| `MenuPreferencesMenu.tsx:13` | `restaurant-hamburger-*` pinned by tests and stylesheets |
| `MenuItemGrid.tsx:17` | `restaurant-grid` / `restaurant-empty` class names |
| `MenuItemContextMenu.tsx:18` | class names and role semantics |
| `MenuSearchBar.tsx:19` | eight invariants — round 173 checked these |

Checking each found **one more gap, in the same family**:
`MenuItemContextMenu.tsx:15-16` claims *"Escape must stopImmediatePropagation so the global
type-to-search Escape handler cannot clear the query while this menu is open"* — and it was
unpinned. Grep found `stopImmediatePropagation` in **no unit test and no e2e spec** in the
tree.

## Why it is a real hazard

`MenuSearchBar` keeps its own Escape handler on the **window** (`:52-56`) that clears the query
and blurs. The context menu's handler is also on the document (`:101-102`). Both fire on the
same keypress, and ordering between two window/document listeners is not something code should
rely on — `stopImmediatePropagation` is what makes the menu's dismissal win.

Without it: open the context menu, type a search, press Escape → the menu closes **and** the
query is wiped, so the operator retypes it. A silent, small, repeating cost.

## The test

`ui/src/__tests__/contextMenuEscapeGuard.test.ts` — 3 cases:

| Case | Why |
|---|---|
| the Escape branch calls `stopImmediatePropagation` | the invariant, asserted on the mechanism |
| the roving-focus branch does **not** | non-vacuity — it is not an unconditional call |
| the hazard is still real | MenuSearchBar still clears on Escape, so the guard is defending against something |

The third case matters for a specific reason: if `MenuSearchBar` ever stops handling Escape,
this guard becomes a defence against nothing and the case says so instead of pinning a
no-op.

**Kill-tested**: removing the call fails the named case. Restored, byte-identical to HEAD.

## The five other claims

`MenuCategoryTabBar`, `MenuItemTile`, `MenuPreferencesMenu` and `MenuItemGrid` claim class
names are pinned. Those are covered by `screenExtraction.test.ts`'s CSS citation arm and
`RestaurantMenu.test.tsx`'s markup assertions — which are themselves kill-tested (round 172
and round 150 respectively), so their claims hold by construction rather than by assertion.

## Verified

| Item | Result |
|---|---|
| Components with docblock claims | 8 |
| Claims checked | all |
| Unpinned found | **1**, now closed |
| New test | **3 passed** |
| Kill-test | **1 failed** |
| `MenuItemContextMenu.tsx` | identical to HEAD |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,693 passed |