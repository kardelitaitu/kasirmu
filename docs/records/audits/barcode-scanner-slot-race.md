# The scanner-slot race: why two shuffled seeds fail (round 95)

## The instrument

  cd ui
  npx vitest run --sequence.shuffle.tests --sequence.seed=2 src/__tests__/PosScreenCoreFlow.test.tsx

`ignores a slower course-firing read from the previous store` fails with
`AssertionError: the scanned product never reached the cart`.

## What was measured, in order

Every probe was added, run, read, and reverted; `git status` confirms the working tree
was left clean. The facts, each from a run:

| Probe | Result |
|---|---|
| `console.log` either side of `triggerScan('BARCODE-CF')` | BOTH print — the call happens |
| the same log INSIDE `triggerScan` | does NOT print (jsdom output buffering drops it) |
| `mockedBarcode.useBarcodeScanner.mock.calls.length` at scan time | **7** |
| a `slotIsSet()` accessor added to the mock | **true** — a callback IS in the slot |
| a waitFor over `lookupByBarcodeScoped.mock.calls` for `'BARCODE-CF'` | never appears |
| `lookupByBarcodeScoped` logged with both args in `PosScreen` | only `BARCODE-001` / `-002`, never `-CF` |

So: **the scan fires, the slot is occupied, and `handleBarcode` is never reached.**
Seven components called `useBarcodeScanner` by the time this case scanned, and the mock
keeps ONE module-level slot holding whichever registered LAST.

## The cause

```ts
// test-utils/mocks/barcodeScanner.ts
let onProductFound: ((payload) => void) | null = null;   // ONE slot
useBarcodeScanner: vi.fn((opts) => { onProductFound = opts.onProductFound; })
triggerScan(code) { onProductFound?.({ code, symbology: 'test' }); }
```

A previous case's tree can register AFTER the current case's render — the ordering is
whatever the component tree happens to settle into — and it overwrites the slot. The
current case's `triggerScan` then dispatches into the previous screen's handler, which
renders into a tree that is no longer the one under assertion. The current screen never
sees the scan.

That is why this is invisible in declaration order: the case that exposes it has to be
moved in FRONT of the case whose tree leaves the late registration.

## What was tried and did NOT fix it

Gating the scan on `useBarcodeScanner.mock.calls.length` increasing (round 94) does not
help: it proves *a* registration happened, not that the newest one belongs to this render.
`mockedBarcode.reset()` in `beforeEach` nulls the slot, but the stale tree re-registers
afterwards.

## The fix this points to, not yet made

The slot needs an **owner**, so a scan can be rejected when it would go to the wrong tree.
Options, cheapest first:

1. `mockedBarcode.register(ownerId)` returning an unregister, with `triggerScan` taking the
   owner id and doing nothing when the slot's owner differs. Touches the mock and every
   call site.
2. Reset the slot in `afterEach` **after** RTL cleanup, so a late registration cannot
   survive into the next case. Needs verifying against the ordering.
3. Unmount explicitly at the end of cases that render `PosScreen`, so no tree is left
   alive to re-register.

Option 2 is the smallest; none was attempted far enough to claim, and round 95 stops at
the diagnosis rather than shipping a guess — the last three rounds each shipped a guess
that a green run under the wrong conditions endorsed.

## Status

Seeds 7 and 99 pass; 2 and 13 fail. Twelve cases in this file render `PosScreen` and share
this one slot, so the exposure is broad and the fix belongs in the mock, not in a case.