# The one invariant MenuSearchBar claimed but nobody pinned (round 173)

## How it was found

Round 172 closed the guard audit. Returning to the product, this round read the restaurant
components' own docblocks and CHECKED the claims they make — round 158's pattern, applied to
a component rather than a manifest.

`RestaurantMenu.test.tsx` pins 60 cases and `MenuSearchBar`'s docblock names eight invariants
(`:19-21`). Checking each against the test file found **seven of eight pinned — and the eighth
absent**:

| Docblock claim | Pinned |
|---|---|
| autocomplete attributes | yes |
| autocorrect / spellcheck | yes |
| `data-*-ignore` autofill suppression | yes |
| explicit text-selection style | yes |
| `restaurant-search-input` class | yes |
| type-to-search injection | yes |
| **"goes through the native value setter so React's onChange still fires"** | **no** |

## Why that one matters most

React tracks an input's value through a property descriptor on
`HTMLInputElement.prototype`. Assigning `input.value = v` sets the property WITHOUT going
through that descriptor, so `onChange` never fires — **and the failure is silent**: the
keystroke appears in the field, the grid does not filter, and nothing reports it. A direct
assignment is also the obvious way to write those three lines, which is exactly why it needs
pinning rather than trusting.

## The test, and what it kills

`ui/src/__tests__/menuSearchNativeSetter.test.ts` — 2 cases, asserting the **mechanism** rather
than the effect (an effect-only test would still pass with a direct assignment, because the
value lands in the field either way):

| Case | Kills |
|---|---|
| reads the descriptor from the prototype AND calls it | replacing the setter with `input.value = v` |
| dispatches a bubbling `input` event | removing the dispatch |

**Kill-tested**: applying the obvious-but-broken direct assignment fails **both** cases.
`MenuSearchBar.tsx` restored and verified byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| Docblock claims checked | 8 of 8 |
| Unpinned claims found | 1, now closed |
| New test | **2 passed** |
| Kill-test | **2 failed** |
| `MenuSearchBar.tsx` | identical to HEAD |
| `RestaurantMenu.test.tsx` | 60 passed alongside |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,690 passed |