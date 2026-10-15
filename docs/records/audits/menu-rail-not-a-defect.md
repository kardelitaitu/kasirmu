# The menu-rail occlusion was never real: a second correction, and where the reading came from (251)

## What round 250 got wrong, and round 251 disproved

Round 250 measured the menu editor's category rail at `y 105..803` — 698px against a 768px
viewport — and reported three controls under the memo stack. It reverted its own CSS because the
kill-test kept passing, and recorded the occlusion as *"seed-dependent"*.

**The occlusion does not exist.** Measured this round with every candidate rule killed:

```
rail   h 128    bottom 233    max-height none    overflow-y auto
stack  y 610..747
```

The rail is **128px tall** at rest. It never reaches the stack, and never did. The 698px reading
that started rounds 249-250 was taken from a **different state of the same page** — most likely the
rail rendered against a category list that had not yet collapsed, or a moment when the screen was
mid-transition — and it was never reproduced while the rail was actually at rest and settled.

## How the wrong reading survived three rounds

| Round | What it did | What it missed |
|---|---|---|
| 249 | hit-test sweep, reported the rail's controls occluded | the sweep ran **during** the transition, before the rail settled |
| 250 | measured 698 in one probe, 623 in another, called it seed-dependent | never sampled the same state twice |
| **251** | sampled the rail **10 times over 7 seconds** | — and still got 698, because the sample loop began before the rail settled |

**Even this round's first measurement was wrong**, and for the same reason as the others: it began
sampling immediately and its 10 samples all landed inside the same unsettled window. Only the
measurement taken after the page was left alone produced the true 128px.

The rail is `position: sticky` with a **collapsible category list**; the long reading belongs to
the expansion, and the settled state is short. **A probe that samples a state before it settles
will reproduce the same wrong answer as many times as you ask it.**

## What was actually shipped

Nothing to the stylesheet — `RestaurantMenuEditorScreen.css` is byte-identical to HEAD, confirmed
with `git hash-object` after every attempt. Five CSS edits were written and reverted across rounds
250-251, and **none of them was the fix, because there was nothing to fix.**

The one durable change is to the spec: it no longer scrolls the rail before clicking the category
delete. That scroll was added in round 250 to work around a phantom occlusion, and it is what made
the kill-test unfalsifiable — the click landed on the result of the scroll rather than on the
state the rule was supposed to protect.

4 passed, desktop and tablet, against unmodified HEAD.

## Verified

| Item | Result |
|---|---|
| `RestaurantMenuEditorScreen.css` | byte-identical to HEAD |
| The rail at rest, all rules killed | `h 128`, `bottom 233` — clear of the stack at 610 |
| The spec | 4 passed against HEAD |
| Full UI suite | 12,716 passed — 0 failed |

## The lesson, and it is the round's whole output

**Three rounds of work came from one measurement taken at the wrong moment.** Round 226's record
named this class — *"the probe read at the wrong moment"* — and listed four instances. This is the
fifth, and the most expensive: it produced a false defect report, two CSS change-sets and a
published record, all of which had to be withdrawn.

The tell was available in round 250 and was read as a contradiction instead: **623 and 803 are the
same page in two states**, and the honest response to that pair is *"which state does the operator
meet?"* — not an average, and not a bounding rule that happens to make both true.

## The memo-stack class, corrected

| Screen | Outcome |
|---|---|
| workspace picker | clearance rule, measured 2026-09-30 |
| staff roles list | clearance rule, measured 2026-10-01 |
| receipts preview column | clearance rule; **partial** — works at the scroll end only |
| ~~menu editor rail~~ | **not a defect — the measurement was of an unsettled state** |

Three screens, not four.