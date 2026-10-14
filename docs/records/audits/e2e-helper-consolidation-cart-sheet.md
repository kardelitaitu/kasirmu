# The two helpers five specs were carrying, consolidated (round 207)

## Why this round

Round 206's own record closed with a flag: *"Two specs now depend on that default being
documented — which is the argument for the seed living in a shared helper if a third appears."*
A scan showed **five** specs carrying local copies, so the condition was already met twice over.

| Helper | Specs that carried it |
|---|---|
| cart-sheet dismissal | `restaurant-kitchen-dispatch-race`, `restaurant-cart-line-badges`, `restaurant-cart-line-course`, `restaurant-course-firing` |
| course-firing seed | `restaurant-cart-line-course`, `restaurant-course-firing` (2 — corrected 2026-10-14; `restaurant-settings-cards` never imported `seedCourseFiring`) |

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

Four specs lost their local copies. **Corrected 2026-10-14 (docs-auditor):** the claim that
`restaurant-settings-cards` "already used only the seed and" was the control is false — it never
imported `seedCourseFiring` at all; its only helpers import is `openRestaurantSidebarRow`
(`grep -n "from './helpers'" ui/e2e/restaurant-settings-cards.spec.ts` → `:2`), and it drives the
setting through a `data-testid` toggle instead. So `seedCourseFiring` has exactly two consumers.
What was true: four specs lost their local copies, and
was left as the control. Net **+17 lines** — 49 of documented helper against 40 of scattered
copy.

| File | Change |
|---|---|
| `helpers.ts` | +49 |
| the four specs | −40 |

> **Consumer counts re-derived 2026-10-14 (docs-auditor).** `dismissRestaurantCartSheet` now has
> **seven** spec consumers, not the four named here — `restaurant-cart-panel-controls`,
> `restaurant-open-bills-cycle` and `restaurant-tab-resume` were added after this record. The
> consolidation did its job (the helper is the shared seam); the count simply grew, which is the
> outcome the record argued for. `git grep -l 'dismissRestaurantCartSheet' -- ui/e2e`.

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
