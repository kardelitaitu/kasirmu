# Two gates that stop the course bar rendering under test (round 97)

Round 96 found that the barcode scanner is DISABLED on `restaurant-pos`
(`PosScreen.tsx:567`), so a case there cannot scan a product into the cart. Round 97 asked
the obvious next question: seed the line another way and render the course bar. **Two more
gates block that**, and both had to be measured.

## Gate 1 -- portrait restaurant renders NO CartPanel

```ts
// PosScreen.tsx:376
const isPortraitRestaurant = activeWorkspace === 'restaurant-pos' && !orientation.isLandscape;

// PosScreen.tsx:1789
{!isPortraitRestaurant && (   // <CartPanel .../>
```

The course bar lives in `CartPanel` (`CartPanel.tsx:961`). In portrait on that workspace
the panel is replaced by a sheet, so **the bar cannot exist at all**.

`useOrientation.readIsLandscape` (`hooks/useOrientation.ts:93-102`) reads
`window.matchMedia(LANDSCAPE_QUERY).matches`, and jsdom answers `false`. So any test that
renders `PosScreen` on `restaurant-pos` takes the PORTRAIT branch unless it stubs
`matchMedia` — and the two existing cases that render that workspace in this file
(`ignores a slower course-firing read`, `ignores a slower order-type-prompt read`) do not.

## Gate 2 -- a cart line alone does not show the bar

Measured with a temporary case inside `PosScreenCoreFlow.test.tsx` (added, run, deleted):

| Probe | Result |
|---|---|
| seed `pos-active-draft`, render `restaurant-pos` | `lines=1 courseBar=false` |
| the same with `window.matchMedia` stubbed for landscape | `lines=1 courseBar=false` |
| which cart container rendered | `cartPanel=true sheet=false` |

So the draft restore DOES reach the cart (1 line item) and the CartPanel DOES render in
landscape — and the bar still does not appear. The remaining input is
`courseFiringEnabled !== false` (`CartPanel.tsx:961`).

A third probe to read that value was written and MISCOMPILED (a top-level `await` inside
the `waitFor` callback), and the round stops there rather than guessing. The value is one
of: `null` (bar shows), `false` (bar hidden), or an implementation left by an earlier case
— and the `mockImplementation` leak documented in `mock-implementation-leak.md` is a live
candidate for the third.

## Why this matters for the case under repair

`ignores a slower course-firing read from the previous store` has been failing under
`--sequence.shuffle.tests` since round 93. It cannot be repaired by fixing the scan (round
96) or by seeding the draft (round 96 attempt): on `restaurant-pos` in portrait there is no
CartPanel, and with a CartPanel there is still no bar. Any repair must either

1. stub `matchMedia` for landscape AND establish `courseFiringEnabled`, or
2. assert something other than the container.

## Verified state

All probes deleted; `git status` on both files clean; the file passes in declaration order
(30 passed, 1 skipped) and the full suite is green.