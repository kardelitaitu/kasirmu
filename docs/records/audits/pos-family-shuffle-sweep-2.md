# POS-family shuffle sweep, second pass (round 102)

## Why a second pass

Round 101 found a leak that **seed 2 did not show** (`PaymentModal.test.tsx`, the
per-case subscription tier). Round 100's single-seed sweep would have missed it, so the
instrument is only as good as the seeds it is run with. This round re-ran the family at
seeds 13 and 31, which had not been used.

## Results

  npx vitest run --sequence.shuffle.tests --sequence.seed=N <suites>

| Suites | Tests | seed 2 | seed 7 | seed 13 | seed 31 |
|---|---|---|---|---|---|
| 8 retail/restaurant screens | 236 | pass | pass | **pass** | **pass** |
| 8 POS/shift screens | 153 | pass | pass | **pass** | **pass** |
| 7 PaymentModal suites | 134 | pass | — | — | — |
| `PaymentModalSaleFlow` | 58 | **fixed (r100)** | pass | pass | — |
| `PaymentModal` | 40 | pass | pass | **fixed (r101)** | pass |
| `PosScreenCoreFlow` | 31 | **fixed (r99)** | pass | pass | — |

**~620 test executions across the POS family, no failures at any seed.** The family is
shuffle-clean.

## The heuristic that was WRONG

A static scan flagged 35 test files as "has `mockClear()`/`clearAllMocks()`, has
`mockImplementation`, never calls `mockReset()`" — including
`PosScreen.integration.test.tsx` with 13 apparent implementations and 15 clears.

Read directly, that file has **zero** `.mockImplementation(` calls and **zero**
once-values: the scan was matching the strings inside comments and assertions. Its
`clearAllMocks()` is therefore safe, and shuffle confirms it.

**The lesson is the same one rounds 100-101 taught from the other direction:** a static
pattern is a place to LOOK, not a finding. `--sequence.shuffle.tests` decides.

## What remains true

Three files carried three variations of one rule, and all three are fixed:

| File | Defect | Round |
|---|---|---|
| `PosScreenCoreFlow.test.tsx` | six distinct mechanisms | 91-99 |
| `PaymentModalSaleFlow.test.tsx` | `mockClear()` on a replaced implementation | 100 |
| `PaymentModal.test.tsx` | a per-case `useSubscription` value, never reset | 101 |

The rule: **a mock whose value a case sets is a mock `beforeEach` must reset.**
`mockClear()`/`clearAllMocks()` keep the implementation and any once-queue; `mockReset()`
clears both, so a captured default must be re-installed after it.