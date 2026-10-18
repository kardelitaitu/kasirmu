# The Void overlay is behind a swipe, which is why the probe missed it — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 192 · status: the VOID overlay's Escape
     path pinned, after establishing WHY the previous round could not reach it; production
     unchanged · branch: 0.0.41 · commit: 0052fd297 -->

<!-- Scope: the round-191 carry-forward — the VOID overlay has no case. -->

## Why round 191 could not reach it, established rather than worked around

Round 191 recorded: *"the probe could not reach the Void action — the fixture sale had no Void
affordance, which is status-dependent."* That explanation was **wrong**, and the real one is
simpler and more useful.

The Void button is not in the detail panel. It lives on the ROW, behind a swipe:

```
SwipeableOrderRow  ->  useSwipe({ onSwipeLeft: () => { if (canVoid) setRevealed(true); } })
                   ->  {canVoid && revealed && <button className="sales-history-void-btn">Void</button>}
```

So the E2E probe that clicked a row and then looked for a Void button inside the panel was
looking in the wrong place, and no fixture change would have helped. **The affordance is behind a
touch gesture, which is exactly the kind of thing a click-driven probe cannot find** — and the
same is true of the existing unit tests, all of which open the panel by click.

## The case, and why it is a unit case

A swipe is far easier to drive faithfully in jsdom (`fireEvent.touchStart`/`touchEnd` with
explicit `clientX` values, which is what `useSwipe` reads) than through Playwright, and the
unit harness already renders the real component with `useSwipe` UNMOCKED — so the gesture is
exercised for real rather than stubbed:

```ts
fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 10 }] });
fireEvent.touchEnd(row, { changes: [{ clientX: 40, clientY: 10 }] });   // left swipe -> reveal
```

The case asserts both halves, like its detail-panel sibling: the **overlay goes**
(`[aria-modal="true"]` count returns to 0) and the **screen stays** (the rows are still there).

## Kill-tested TWICE, because there were two things that could be vacuous

The risk with a gesture-driven case is that it never actually opens what it claims to, and then
"Escape closed it" is asserted against nothing. So both halves were broken in turn:

| mutation | result | what it proves |
|---|---|---|
| disable the swipe reveal (`onSwipeLeft` a no-op) | **red** — *"Unable to find an element with the text: Void"* | the gesture genuinely reaches the affordance |
| disable the void trap (`useFocusTrap(voidPanelRef, false, …)`) | **red** | the case pins the VOID trap, not something else |

Both restored byte-identically by sha256 (`1afddfeac40e3712`); production is unchanged.

## Verified

| check | result |
|---|---|
| `SalesHistoryScreen.test.tsx` | **48 passed** |
| kill-test 1 (swipe reveal) | red |
| kill-test 2 (void trap) | red |
| `git status` on the production file | clean — only the test was committed |
| `npm run lint` | 0 errors (116 warnings, baseline) |
| stray probes | none |

## What is actually covered now, and what is not

SalesHistory has three focus-trapped overlays. Two are pinned:

| overlay | case | how it is opened |
|---|---|---|
| DETAIL | round 191 | click a row / View |
| **VOID** | **this round** | swipe a row left |
| STAMP (e-Faktur NSFP) | **none** | reachable from inside the detail panel |

STAMP remains the last uncovered one. It is a genuine gap rather than an oversight: it is opened
from within another overlay, so it is a second-level case and needs the detail panel open first.

## The transferable part

**A probe that drives the UI by click cannot find affordances behind a gesture.** Round 191 read
that absence as a data problem ("the fixture has no Void affordance") when it was an
interaction-model problem — and the difference matters, because one is fixable by changing a
fixture and the other is not. When a control is genuinely unreachable by the probe, that is a
signal to change the probe, not to record the control as untestable.

> last audited 18-10-26 by docs-auditor
