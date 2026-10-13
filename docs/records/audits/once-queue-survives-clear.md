# The once-queue survives `clearAllMocks()` (round 99)

## The measurement

A two-case probe on this repo's vitest:

```ts
const fn = vi.fn(() => 'default');
beforeEach(() => { vi.clearAllMocks(); });

it('queues a once-value', () => { fn.mockResolvedValueOnce('once'); });  // never calls fn

it('the queued once-value is STILL pending', async () => {
  fn.mockImplementation(() => 'default');
  await expect(fn()).resolves.toBe('once');   // PASSES
});
```

`mockResolvedValueOnce` / `mockReturnValueOnce` queue a value that

* `clearAllMocks()` does NOT clear,
* `restoreAllMocks()` does NOT clear for a `vi.fn()` a `vi.mock` factory created, and
* a later `mockImplementation()` does NOT override — the queue is consulted first.

## The effect, observed

Instrumented in `PosScreen.tsx`'s scan handler (`--sequence.shuffle.tests --sequence.seed=2`):

```
PROBE scan result code=BARCODE-002 dto=ITEM-002   <- the once-value queued for this scan
PROBE scan result code=BARCODE-002 dto=ITEM-001   <- a DIFFERENT case's leftover value
```

Two scans of the same barcode answered with different products. The second received a
queued value that another case had set and never consumed — so `adds multiple products`
saw one line instead of two, and `persists active draft` was handed a product it did not
expect.

## Why this is the same defect as `mock-implementation-leak.md`

Round 92 established: `clearAllMocks()` keeps IMPLEMENTATIONS. This round shows it also
keeps the ONCE-QUEUE, and that `mockImplementation()` does not mask it. Both are the same
mistake — treating `clearAllMocks()` as a full reset — and both are fixed the same way:
**`mockReset()` for any mock a case mutates.**

## Fixed

`PosScreenCoreFlow.test.tsx`'s `beforeEach` now calls `mockReset()` before re-installing
the default, for `getSettingScoped` and `lookupByBarcodeScoped` — the two mocks cases
queue values on. `mockReset()` clears the implementation AND the queue, so the default has
to be re-installed immediately after; doing it for every mock would drop the factory
defaults and break the file.

## Verified

| Run | Result |
|---|---|
| `--sequence.shuffle.tests` seeds 2, 7, 13, 99 | **all pass** — 2 and 13 failed since round 93 |
| declaration order | 30 passed, 1 skipped |
| full suite, default and verbose reporters | 12,658 passed, 0 failed |

`PosScreenCoreFlow.test.tsx` is shuffle-clean for the first time.

## The full set of causes behind this file's flakes

| Round | Cause |
|---|---|
| 91 | a shared `mockResolvedValueOnce` consumed by a stray call |
| 92 | `mockImplementation` kept by `clearAllMocks()` |
| 94 | `createSettingsApiMock` missing `setSettingScoped` (uncaught at the call site) |
| 96 | the scanner is disabled on `restaurant-pos` |
| 98 | `course_firing`'s unset default is `false` |
| 99 | the once-queue survives `clearAllMocks()` |

Each was a different mechanism. The one practice that found them all:
**`npx vitest run --sequence.shuffle.tests --sequence.seed=N`**, repeated across seeds.