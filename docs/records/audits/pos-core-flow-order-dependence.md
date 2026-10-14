# PosScreenCoreFlow is order-dependent: what `--sequence.shuffle` found (round 93)

## Why this note exists

Round 92 proved a mechanism: `vi.clearAllMocks()` keeps IMPLEMENTATIONS, and
`restoreAllMocks()` does not undo a `vi.fn()` made by a `vi.mock` factory. A case that
replaces a shared mock with `mockImplementation` therefore changes every case after it.

That mechanism is only visible when the ORDER changes. Vitest's default order is
declaration order, so the file passes indefinitely and the defect stays latent.
`--sequence.shuffle.tests` is the probe that exposes it, and it should be the FIRST thing
tried on an order-dependent failure.

## What the probe found in `PosScreenCoreFlow.test.tsx`

Run, seeds 2 / 7 / 13 / 99:

  npx vitest run --sequence.shuffle.tests --sequence.seed=N src/__tests__/PosScreenCoreFlow.test.tsx

| Seed | Before |
|---|---|
| 7 | `persists active draft when kasirmu:trimMemory event is dispatched` — 'Unable to find text: Test Item' |
| 2 | `ignores a slower course-firing read` — no line contains 'Course Item' |
| 13 | `adds multiple products` |
| 99 | passed |

The file passes in DECLARATION ORDER, and fails under shuffles that move a case in front
of a case it was silently relying on.

## Fixed in round 93

1. **The trimMemory case had NO product fixture.** Nothing in the file makes the default
   lookup resolve `BARCODE-001`; it passed only because the case at the `BARCODE-001`/
   `BARCODE-002` implementation ran FIRST and leaked in. It now installs its own fixture,
   keyed on its barcode.
2. **`beforeEach` now restores `lookupByBarcodeScoped` too**, by re-delegating to
   `mockLookupByBarcode`. Round 92 restored only `getSettingScoped`.
3. **The course-firing case asserted on `getByTestId('cart-panel-line-item')`** -- "the
   first cart line is mine". Under a shuffle a neighbour's line can be first, or mine can
   be the only one. It now asserts that SOME line is mine, which is the property the case
   actually needs.

After 1-3, seeds 7 and 99 are green and seed 2 no longer reports the DOM-shape failure.

## NOT fixed, and stated plainly

**Seeds 2 and 13 still fail.** The remaining cause is not the one above: the course-firing
case reports `expected false to be true` -- NO line contains 'Course Item' -- so its scan
is being blocked rather than misread. The `beforeEach` delegation is in place, so the
implementation my case installs immediately before scanning should win. That has not been
isolated, and round 93 stops short of claiming it.

The wider picture: **30 cases in this file share a cart panel, a barcode mock and a
settings mock**, and several still depend on a neighbour. Making the file shuffle-clean is
a real piece of work -- per-case fixtures and per-case cleanup across all 30 -- not a
one-line change. This note records the instrument and the three fixes made, so the
remaining work starts from evidence.

## Re-verify with

  cd ui
  npx vitest run src/__tests__/PosScreenCoreFlow.test.tsx                    # declaration order
  for s in 2 7 13 99; do npx vitest run --sequence.shuffle.tests --sequence.seed=$s \
      src/__tests__/PosScreenCoreFlow.test.tsx; done