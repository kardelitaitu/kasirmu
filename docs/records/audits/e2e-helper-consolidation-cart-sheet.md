# The two helpers five specs were carrying, consolidated (round 207)

## Why this round

Round 206's own record closed with a flag: *"Two specs now depend on that default being
documented — which is the argument for the seed living in a shared helper if a third appears."*
A scan showed **five** specs carrying local copies, so the condition was already met twice over.

| Helper | Specs that carried it |
|---|---|
| cart-sheet dismissal | `restaurant-kitchen-dispatch-race`, `restaurant-cart-line-badges`, `restaurant-cart-line-course`, `restaurant-course-firing` |
| course-firing seed | `restaurant-cart-line-course`, `restaurant-course-firing`, `restaurant-settings-cards` |

## What landed

Two exports in `ui/e2e/helpers.ts`, matching the file's existing pattern
(`openRestaurantCart` and `openRestaurantPosWithItem` were consolidated the same way):

```ts
dismissRestaurantCartSheet(page)  // no-op when the sheet is absent
seedCourseFiring(page)            // addInitScript, before the bundle
```

Both carry the WHY, including the constraints a reader would otherwise have to rediscover:
the backdrop is `position: fixed; inset: 0; z-index: 100` while open; dismissing it UNMOUNTS
the cart panel in portrait, which is why the specs needing both skip on tablet; and the seed
must be an init script because the dev-mock reads the slice once at module init.

## The migration

Four specs lost their local copies; `restaurant-settings-cards` already used only the seed and
was left as the control. Net **+17 lines** — 49 of documented helper against 40 of scattered
copy.

| File | Change |
|---|---|
| `helpers.ts` | +49 |
| the four specs | −40 |

## Verified

| Item | Result |
|---|---|
| The five specs, together | **16 passed, 10 skipped, 0 failed** |
| Skips | all the documented portrait constraint, none new |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,707 passed |

Every skip is the same constraint recorded in four files before this round. Consolidating it
means the FIFTH spec that needs it cannot rediscover the trap — which is the whole point of the
existing helpers and the reason this one is worth its 17 lines.

> last audited 14-10-26 by docs-auditor
