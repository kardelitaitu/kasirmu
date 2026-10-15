# The empty-section state, and the exit it offers (round 246)

## What this covers

`tables-empty-filtered` is the tables screen's **only empty state**. Round 244's filter fix made it
reachable without meaning to; round 245 mapped the route and stopped one step short. This finishes
it — 2 passed, desktop and tablet.

## The route, and why it is this long

`mockSections` is derived ONCE at module load (`dev-mock/handlers/floorplan.ts:66`) and never
recomputed, so a section's chip **survives after its last table is deleted.** That is the state an
operator reaches when they pack a room away, and it is the only route to the branch.

Every step was measured rather than assumed:

| Step | Detail |
|---|---|
| the delete guard | `activeBill \|\| occupied` disables Delete (`:1422`) — reserved and cleaning tables ARE deletable |
| deletable counts | `All` → 7, `Indoor` → **1**, `Patio` → **6** |
| the confirmation | an **inline** `.tables-warning-banner` (`:1278-1298`), not a modal |
| the dismissal | the panel's own Close button (`:1431`); **Escape leaves it open** |

**Indoor has five occupied tables of six, so it cannot be emptied from the UI at all.** Patio is
the only section a spec can use, and that is a fact about the seed rather than a preference.

## The failure that turned out not to be one

The last click kept timing out with `element was detached from the DOM`. That read like a broken
locator and was the opposite: **the app had already dismissed the panel itself** after the delete,
so the click landed on a node that was gone.

`closeDetail` now treats "the panel is gone" as the goal rather than "my click closed it" — it
scrolls, clicks with a short timeout, swallows the failure, and asserts the panel is absent. **The
assertion is the same either way; only the mechanism stopped being assumed.**

Worth recording as the round-217 rule in a new place: `force: true` would have hidden this, and
the message named the cause precisely enough to avoid it.

## What the spec pins

| Assertion | Why |
|---|---|
| some tables were actually deleted | otherwise nothing below is meaningful |
| the empty state is visible and **no tiles remain** | the state and its consequence |
| a way back is offered, and clicking it restores a **non-empty** plan | the exit works rather than merely renders |

**Kill-tested**: reverting round 244's `showEmpty` to the unfiltered list fails the case. Restored,
0 `kill-test` leftovers, `tsc` 0.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 1 failed |
| `TableManagementScreen.tsx` | unchanged — the fix this exercises landed in round 244 |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,716 passed — 0 failed |

## Why an empty state earns a test

It is the one screen in the flow where the operator has **no data to act on and must decide what
the absence means.** "No tables in this section" plus a way back says *your filter is narrow*; a
blank grid says nothing and invites a support call. The branch existed and rendered correctly all
along — it simply could not be reached, which is why no test had ever seen it.

> last audited 15-10-26 by docs-auditor
