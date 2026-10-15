# The empty-section branch: reachable, and the route is longer than it looked (round 245)

## What the round set out to do

Round 244's fix made `tables-empty-filtered` **reachable** — the branch needs `showEmpty` under a
selected section, and `showEmpty` had been keyed on the unfiltered list, so it could never be true
while any table existed. This round set out to cover it and the way back it offers.

The route: `mockSections` is derived once at module load (`dev-mock/handlers/floorplan.ts:66`) and
**never recomputed**, so deleting every table in a section leaves its chip behind with nothing in
it — the state an operator reaches when they pack a room away.

## What was established, by measurement

Each of these corrected an assumption, and together they map the route:

| Measured | Detail |
|---|---|
| the delete guard | `disabled={Boolean(activeBill \|\| selected.status === 'occupied')}` (`:1422`) — **reserved and cleaning ARE deletable**, only occupied-or-billed are not |
| deletable tables per chip | `All 5/12` → 7 deletable; `Indoor 5/6` → **1**; `Patio 6` → **6** |
| the confirmation | an **inline** `.tables-warning-banner` (`:1278-1298`), not a modal — a `.tables-modal-backdrop` locator finds nothing |
| closing the panel | its own **Close** button (`:1431`); **Escape left the panel open**, so a scan loop re-selected the same tile every pass |

The second is the one that matters: **Indoor has five occupied tables out of six**, so it is
effectively undeletable from the UI. Only **Patio** can be emptied, and that is the section a spec
has to choose.

## The spec did not land

Four iterations, each fixing a wrong assumption above, and the last failed differently: after a
delete the detail panel stays open, so the loop's next `.tables-table` click resolved to a
**disabled** tile. The loop's own state machine is the remaining work — close the panel after each
delete, then re-scan — and it was not finished inside this round.

The spec was deleted rather than left failing. **Everything it needed is now measured and
recorded**, which is what the next attempt starts from.

## Verified

| Item | Result |
|---|---|
| Round 244's fix | intact — `visibleTables` at `:501`, `:503`, `:1055` |
| Probes run | 2, both removed |
| Source changed | none |
| New tests | zero |

## Why one branch is worth this much care

`tables-empty-filtered` is the screen's only empty state, and its shape decides what an operator
does next. "No tables in this section" plus a way back says *your filter is narrow*; a blank grid
says nothing and invites a support call. Round 244 made it reachable by accident while fixing the
filter — which is exactly why it deserves a test rather than an assumption.

## The next round's first step

Empty **Patio**, the one section that can be. And close the detail panel after each delete before
re-scanning: `.tables-detail` -> its Close button (`:1431`), then wait for the panel to be gone.
The deletable count is already known (6), so the loop can be bounded by measurement rather than a
guess.

> last audited 15-10-26 by docs-auditor
