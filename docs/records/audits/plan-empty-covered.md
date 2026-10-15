# The plan-empty state, reached through a seam rather than thirteen lifecycle calls (round 268)

## What round 267 proposed, and what it already had

Round 267 found `tables-empty-add-table-btn` — a second empty state on a different branch — and
concluded the honest fix was a dev-mock seam for an empty floor plan, which it called a shared-fixture
change that should be PROPOSED rather than taken.

**The seam convention already existed.** Five handlers read `URLSearchParams`, and `system.ts:29-56`
documents the contract in full: an explicit per-navigation opt-in, read at CALL time, changing no
default, guarded because the handlers also run under jsdom where `window.location.search` is empty.

So this was not an invention — it was joining a convention, which is why it took 27 lines.

## The seam

```ts
const mockTables: MockTable[] = emptyPlanRequested() ? [] : tablesSnapshot();
```

`?plan=empty`. Named for the STATE an operator is in rather than a count a caller constructs.

## 2 passed, both profiles

| Assertion | Why |
|---|---|
| the empty state renders and **no tiles** | the state and its consequence together |
| the `All` escape is **absent** | `:1049` renders it for the SECTION-empty state; offering it on a plan with no sections is a dead end dressed as a way out — this is what distinguishes the branches from outside |
| the control **opens the form** | the only route out of a plan with no tables; a button that rendered but did nothing would pass everything above |

## The kill-test that proves the seam's contract

Making the plan empty BY DEFAULT was killed. **Three unrelated specs failed** — the toolbar suite's
legend, arrange-mode and assign cases — while this spec still passed.

That asymmetry is the point: a seam that changes no default is falsifiable exactly by removing the
guard, and the resulting failures are in OTHER tests. A seam nobody else notices is a seam whose
contract holds.

Restored, `0` kill-test leftovers, and the three specs re-run to **10 passed**.

## Set on the FIRST load, and why

`mockTables` is seeded at module load, so a later `goto` finds the plan already built. Measured:
navigating with the flag AFTER login left **12 tiles** in place and the control absent.

The spec therefore sets it in `addInitScript`, before anything loads. That is a fact about the seam
worth recording — the other query seams in this mock are read per-request, and this one is read once.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 3 unrelated specs failed; this one passed |
| Restore | 0 leftovers, 10 passed across the three tables specs |
| eslint / tsc | 0 / 0 |
| Full UI suite | 12,716 passed |

## Tables coverage, behaviourally complete

| Surface | Round |
|---|---|
| form + Save gate | 165, 167 |
| floor plan | 177 |
| release, delete, move, merge | 193-195 |
| toolbar, arrange, assign | 219 |
| edit form + prefill | 220 |
| Print Bill | 221 |
| reserve | 240 |
| seat | 241 |
| section filter | 244 |
| section-empty state | 246 |
| **plan-empty state** | **268** |

What remains on that screen is the tab-conflict pair, which needs a **second terminal** — verified
five times now, most recently round 258, and blocked by architecture rather than by tests.

## The correction this pair of rounds makes

Round 266 declared every surface behaviourally closed. Round 267 measured the claim and found one
gap. Round 268 closed it. **The sequence is the method: a summary is a hypothesis, and the scan is
what tests it.**