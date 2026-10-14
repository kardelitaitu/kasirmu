# The restaurant cart setup, shared instead of copied four times (round 161)

## The duplication

Round 160's record ended with a standing lesson: *any restaurant spec that reaches the cart
must open the sheet on portrait*, and four specs each carried their own copy of the
`openCart` helper to do it. This round measured that and found it was true:

```
restaurant-cart-capabilities.spec.ts    own openCart
restaurant-order-lifecycle.spec.ts      own openCart
restaurant-payment-modal.spec.ts        own openCart
restaurant-shortcuts-e2e.spec.ts        own openCart   (added last round)
```

All four were the same ~10 lines: if the inline line item is visible, return; otherwise click
`.restaurant-floating-cart-trigger` and wait for `.restaurant-cart-sheet-panel`.

## What landed

`ui/e2e/helpers.ts` gains two exports and five specs shrink:

| Export | What |
|---|---|
| `openRestaurantCart(page)` | the two-shell cart reveal |
| `openRestaurantPosWithItem(page, role = 'owner')` | login, workspace, one tile, cart revealed |

Net effect: **+73 −89 lines** over five files, one owner for the trap, and the helper's docblock
names the four specs that hit it so the next reader knows why it is shared rather than local.

## The one thing that went wrong, and what it cost

The first refactor of `restaurant-cart-capabilities.spec.ts` silently **promoted it from `staff`
to `owner`**, because the shared helper defaulted to owner and the spec's role was in the body
I deleted. Caught by re-reading the diff rather than trusting the tests — all 8 of its cases
would still have passed, since none of them needs a privilege `staff` lacks.

The fix was to **parameterise the role** rather than pick one. Three of the four specs use
`staff`, and that is the least-privileged account reaching the till, which is the right one to
exercise cart controls. The extraction comment now says so, so the next refactor does not
flatten it.

A second, smaller miss from the same cause: the payment-modal refactor left **two surviving
`openCart(page)` call sites** its helper no longer defined, which the spec caught immediately
(`ReferenceError: openCart is not defined`). Repointed to the shared helper.

## Verified

| Spec | Result |
|---|---|
| `restaurant-cart-capabilities` | 8 passed |
| `restaurant-order-lifecycle` | 6 passed |
| `restaurant-payment-modal` | 10 passed |
| `restaurant-shortcuts-e2e` | 6 passed |
| **together** | **30 passed** (desktop + tablet) |
| Login roles | all three `staff` specs still `staff` |
| Full UI suite | 12,678 passed |
| Diff | 5 files, +73 −89, no behaviour change |