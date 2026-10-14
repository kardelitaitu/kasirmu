# A per-case mock value with no reset: the subscription tier (round 101)

## The finding

`PaymentModal.test.tsx` failed `shows Pay with QR button for QRIS method` under
`--sequence.shuffle.tests --sequence.seed=13` — a case that passes in declaration order and
in three other seeds.

`beforeEach` (`:189-209`) resets several mocks, and two of them carry the reason inline:

```ts
// Reset, not clear: the store-default tests make this REJECT rather than reject once,
// and a clear would hand the rejection to the next test.
mockGetDefaultCurrencyScoped.mockReset();
```

But `useSubscription` — set PER CASE at `:232` (`makeSubscriptionCaps({ tier: 'free',
supportsQris: false })`) and `:254` (`tier: 'plus', supportsQris: true`) — is **never
reset.** `invokeMock.mockClear()` on the line above it does not help: `clear` keeps
implementations.

So the caps in force depend on which of those two cases ran last, and the QRIS case —
which asserts only that the button exists and assumes nothing about the tier — was handed a
tier by a neighbour.

## Fixed

`beforeEach` now restores the harness's neutral default (`test-setup.ts:195-200`):

```ts
vi.mocked(useSubscription).mockImplementation(() => ({
  caps: null, state: 'active', loading: false, refresh: vi.fn(),
}) as never);
```

`caps: null` renders every gate OPEN, which is the neutral default the harness documents
rather than a policy claim.

## Verified

| Run | Result |
|---|---|
| seeds 13, 2, 7, 99 | 40 passed each — seed 13 had 1 failure |
| full suite, default and verbose reporters | 12,658 passed, 0 failed |

## The family, after three sweeps

| File | Defect | Round |
|---|---|---|
| `PosScreenCoreFlow.test.tsx` | six distinct mechanisms (see `once-queue-survives-clear.md`) | 91-99 |
| `PaymentModalSaleFlow.test.tsx` | `mockClear()` on a replaced implementation | 100 |
| `PaymentModal.test.tsx` | a per-case `useSubscription` value with no reset | 101 |

Three files, three variations of one rule. The rest of the POS family — 15 suites, ~330
tests — passes under shuffle.

## The rule, third statement

**A mock whose value a case sets is a mock `beforeEach` must reset.** `mockClear()` and
`clearAllMocks()` are not resets: they keep the implementation and any once-queue.
`mockReset()` clears both, so a captured default must be re-installed after it.

The instrument: `npx vitest run --sequence.shuffle.tests --sequence.seed=N`, run across
SEVERAL seeds — seed 13 found this one and seed 2 did not.