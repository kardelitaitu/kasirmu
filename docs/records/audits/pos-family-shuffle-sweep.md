# Shuffling the POS-family suites: one more leak found (round 100)

## The sweep

Rounds 88-99 fixed `PosScreenCoreFlow.test.tsx`, whose six distinct mechanisms are tabulated
in `once-queue-survives-clear.md`. Round 100 turned the same instrument on the OTHER
POS-family suites, which had never been shuffled:

  npx vitest run --sequence.shuffle.tests --sequence.seed=N <suites>

| Suites | Seed 2 |
|---|---|
| `PaymentModalSaleFlow.test.tsx` | **4 FAILED** |
| `RetailPosScreen.test.tsx`, `PosScreen.test.tsx`, +1 | pass |
| 7 PaymentModal suites (134 tests) | pass |
| 8 retail/restaurant screen suites (196 tests) | pass |

So the class is not endemic — one file carried it, and the rest are clean.

## The defect in `PaymentModalSaleFlow.test.tsx`

Its first `describe` block reset the invoke mock with:

```ts
beforeEach(() => {
  invokeMock.mockClear();          // clears CALLS, keeps IMPLEMENTATIONS
});
```

and **six of its cases replace that implementation without restoring it** — at lines 754,
794, 960, 1009, 1173 and 1353. Several other cases in the same file DO capture and restore
(`:359-360`, `:498-499`, `:550-551`, `:1654-1674`), so the file knew the rule and applied it
unevenly.

The second block (`PaymentModal — shortfall resolution`, `:922`) already did it right, with
its own `afterEach` calling `mockReset()`. The first block never got the same treatment.

## Fixed

```ts
// captured once, at module scope, from the hoisted factory's own default
const DEFAULT_INVOKE_IMPL = invokeMock.getMockImplementation() as (cmd: string) => Promise<unknown>;

beforeEach(() => {
  invokeMock.mockReset();                    // clears the implementation AND any once-queue
  invokeMock.mockImplementation(DEFAULT_INVOKE_IMPL);
});
```

Captured at module scope rather than reusing the block's own `defaultInvokeImpl`, which is
declared at `:900` — inside a later describe — so it is not in scope from every case.

## Verified

| Run | Result |
|---|---|
| seeds 2, 7, 13, 99 | 58 passed each — seed 2 had 4 failures |
| full suite, default and verbose reporters | 12,658 passed, 0 failed |

## The rule, restated because it keeps recurring

**`mockClear()` and `clearAllMocks()` clear calls. `mockReset()` clears calls, the
implementation, AND the once-queue.** Any `beforeEach` that used `clear` on a mock a case
replaces is a latent order-dependence, and `--sequence.shuffle.tests` is how it is found.

See also: `mock-implementation-leak.md` (round 92), `once-queue-survives-clear.md` (round 99).