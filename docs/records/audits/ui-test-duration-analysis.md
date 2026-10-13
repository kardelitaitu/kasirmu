# UI test duration: where the 108s actually goes (2026-10-12)

Measured on the full suite: 745 files, 12,292 tests, **107.6s wall clock**.

```
Duration  107.58s (transform 28.67s, setup 190.93s, import 113.13s,
                   tests 567.03s, environment 684.24s)
```

The phase sums (1584s) far exceed the wall clock because 16 workers run in
parallel. **Sum of all per-file durations: 579s.** With 16 workers the ideal wall
would be ~36s - so the suite is at 108s, roughly 3x its own theoretical floor.

## The finding that decides everything

| File | Duration | Share of wall |
|---|---|---|
| NodeTopologyEditor.test.tsx | **49.2s** | **46%** |
| useNewTicketSound.test.ts | 16.6s | 15% |
| RestaurantReceiptsScreen.test.tsx | 16.4s | 15% |
| PaymentModalSaleFlow.test.tsx | 14.2s | 13% |
| AnalyticsScreen.test.tsx | 13.2s | 12% |

Top 25 files = **44%** of all file time.

**Vitest parallelises by FILE.** So the longest single file is a hard lower bound
on wall clock: `NodeTopologyEditor` at 49.2s means the suite can NEVER finish
faster than ~49s, no matter how many workers are added. The 108s is 49s of
critical path plus queueing behind it.

That is the whole optimisation story: **the lever is the longest file, not the
worker count.**

## Fix 1 - landed: real sleeps in useNewTicketSound (16.6s -> 0.23s)

The file had five `await new Promise((r) => setTimeout(r, N))` calls summing to
**16,000ms** of literal sleeping, for seven tests. Two tests alone were 8.0s and
6.0s.

The waits were NOT padding - they exercise the debounce boundary (just inside the
window must not chime, past it must, a burst gives exactly one trailing
catch-up). Deleting them would delete the coverage.

`vi.useFakeTimers()` controls `setTimeout` AND `Date.now()`, and the hook reads
both, so the boundary is crossed instantly. Same 7 tests, same assertions:
**16,583ms -> 227ms**.

A repo-wide sweep for the same pattern found only ONE other file
(RetailPosScreenInteractions, 1.5s total). This was an isolated 16s outlier, not a
systemic habit.

## Fix 2 - the big one, NOT yet done: split NodeTopologyEditor

550 tests, 12,246 lines, 94 describe blocks, 46% of wall clock.

**It is NOT extractable pure logic.** I checked every one of the 79 top-level
describes for DOM use: exactly **one** (64 lines, 1%) is DOM-free. The rest are
genuine render-and-interact tests against a heavy canvas editor. So "move the pure
parts out" buys ~1%.

**What does work: split it into ~4 files.** The cost is evenly spread - 550 tests
at a **69ms median**, only 3 tests above 500ms - so contiguous chunks are balanced:

| chunk | cumulative |
|---|---|
| 1st quarter | 9.7s |
| 2nd | 19.5s |
| 3rd | 35.2s |
| 4th | 49.2s |

Four files of ~12s each, run in parallel, move the floor from **49.2s to ~12.5s**
- and there are 16 workers, so the other 12 are idle-ish while this file runs.
Expected wall clock: **108s -> roughly 55-65s**.

### How to do it safely

- The 94 describes are already the seams; the first block (lines 537-3795, ~3,260
  lines) is the big one and would need 2-3 files itself.
- A shared module is needed for the setup every block depends on: the
  `vi.mock('@/api/topology')` seeding, the `TOPOLOGY_EN` map, `renderEditor()`,
  `getNodeCount()`, and the two FTL imports. It is a real refactor, not a move.
- **Preserve the note at the top of the mock**: it exists because sibling describes
  were order-dependent (a bare `vi.fn()` returns undefined and crashes the load
  effect). Splitting into separate files makes that hazard structural - each file
  must self-seed, which the mock already does.
- Do it in ONE commit with the file count change, and re-run the full suite twice
  (the config's own guidance: measure the CONTENDED pair, not a solitary run).

## What I would NOT change

- **The worker cap (maxWorkers: 16).** The config documents that it was chosen by
  measuring TWO FULL SUITES AT ONCE - the normal state of this shared checkout -
  and that uncapped produced 39 starvation failures vs the cap's 9/9 baseline,
  while being *slower* on the contended pair (156s vs 217s). Any change here must
  re-measure the contended pair or it is invalid.
- **The 3.8s undo-cap test.** It fires 101 events in one test because it must add
  51 nodes then undo 50 times. That is inherent work, not waste.
- **testTimeout: 10_000.** Nothing is near it once the sleeps are gone.

## Method note

Measure with `--reporter=json --outputFile=...` and read
`endTime - startTime` per file. The default reporter's phase totals are
misleading on their own - `environment: 684s` is summed across 16 workers, so it
reads as a bottleneck when the real constraint is the longest single file.

> last audited 14-10-26 by docs-auditor
