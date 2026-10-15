# Following an authored modifier group to the till that sells it (round 212)

## Why

Round 211 proved a group authored in the menu editor survives its own save. That left the last
link: does the TILL offer it when the item is sold? The chain is three components deep —
`serializeDraftModifierGroups` writes it, `getProductModifierGroups` reads it, and
`RestaurantMenu.tsx:255-262` decides from that read whether tapping the tile adds the dish
directly or opens the customizer.

```ts
const groups = getProductModifierGroups(product);
if (groups.length > 0) { setCustomizingProduct(product); return; }   // ask
handleAddProduct(product);                                          // add
```

A group that saves but does not reach that check is invisible to the cashier — saved and
useless. Nothing tested the join.

## What the spec pins — 5 passed, 1 skipped

A third case in `restaurant-modifier-groups-persist.spec.ts`:

| Step | Asserts |
|---|---|
| tap the tile | the CUSTOMIZER opens rather than a cart line appearing — the whole decision at `:257` |
| the modal | it names the group the operator authored, so the round trip closes |
| pick and confirm | the option arms `Add to Order` (it is disabled until the group is satisfied, so arming proves the tap registered) |
| the cart | the sold line carries the modifier |

**Kill-tested**: restoring round 210's defect fails **all three desktop cases** — the two from
round 211 plus this one. Restored byte-identical to HEAD.

## The navigation, and round 211's measurement earning its keep

The first attempt failed: the back button did not reach the till. The cause was exactly what
round 211 recorded — `authorAndReopen` ends with the item form OPEN, and **an open form swallows
the back button's click**. Closing the form first makes the single click land.

That is the second time this session a measurement taken for one purpose decided another round's
approach. Recording the WHY in the helper's comment is what made it findable.

## Verified

| Item | Result |
|---|---|
| Spec | 5 passed, 1 skipped (the till case skips on portrait — round 201's constraint) |
| Kill-test | 3 failed, all desktop cases |
| `catalog.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## The modifier chain, end to end

| Link | Pinned by |
|---|---|
| the mock keeps the field | `devMockProductNotes.test.ts` (round 210) |
| the save round-trips | case 1 (round 211) |
| the group can be removed | case 2 (round 211) |
| **the till offers it** | **case 3 (this round)** |

Four layers, and each would pass while the next failed — which is why the chain was worth
following rather than stopping at the first green.

> last audited 14-10-26 by docs-auditor
