# Two comment-consistency detectors, built and rejected — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 198 · status: both detectors prototyped,
     measured, and NOT shipped; the class-name one produced 25 hits of which 2 were real and
     BOTH were false positives · branch: 0.0.41 · commit: none (no production change) -->

<!-- Scope: round-197 carry-forward — a mechanical check for a file that contradicts itself. -->

## What was proposed, and what happened to it

Round 197 corrected a header that claimed a role its own body said was removed, and proposed:
*"a grep for a role or symbol the file claims to use, checked against the file actual role=
attributes, would catch it mechanically."* I built exactly that this round. Twice.

## Detector 1 — role claims

Extracts every `role="X"` named in a COMMENT and checks whether the file sets it in CODE.

```
456 files | 25 role claims | 7 flagged
```

Read all seven. **All seven are legitimate:**

| file | claim | why it is fine |
|---|---|---|
| `KdsTicketLineItem.tsx` | `role="button"` | explains why Enter arrives via onClick |
| `ItemModifierModal.tsx` | `role="option"` | *"NOT `role="option"`: an option must live inside a listbox"* — an explicit refusal |
| `nodeTopologyEditorAnnouncements.ts` | `role="status"` | names the role its CONSUMER renders |
| `usePosShifts.ts` | `role="alert"` | names a banner `CartPanel` owns |
| `MenuItemContextMenu.tsx` ×3 | menu / menuitem / presentation | all three in the correction I wrote |

So the detector flags the CORRECT way to explain an absent role as often as it flags drift. Its
precision on real defects is zero, and a guard with zero precision is one the tree learns to
ignore — the same argument the citation checker settled on in round 179.

## Detector 2 — class-name claims

Same shape with CSS class names (`restaurant-*`, `pos-*`, `kds-*`, `tables-*`,
`sales-*`) named in comments and checked against the file code.

## The control that failed, and what it taught

My first run reported **0 suspicious across 88 claims** — a clean bill of health. Before believing
it I ran the positive control round 197 insisted on: invent a stale claim and check the detector
fires. **It did not fire.** Two separate reasons, found in order:

1. I was testing `src.includes(cls)` — and the claim itself is in `src`, so the check was
   **satisfied by the very comment under test.** Restricting it to CODE fixed that.
2. The control token was `restaurant-NONEXISTENT` and the token regex is lowercase-only
   (`[a-z0-9]+`), so the control never entered the candidate set at all.

Only after renaming the control to `restaurant-nonexistent` did the detector fire. **The
"0 suspicious" result was meaningless when I reported it to myself**, and the control is the only
thing that said so. This is the round-197 rule applied one step earlier, and it earned its keep
immediately: without it I would have recorded "88 claims verified clean", which was false.

## The validated result

With the control firing, the honest run gives:

```
88 class claims | 25 flagged by the naive check
19 checked against the WHOLE source tree (stylesheet-aware) | 2 absent everywhere
```

And both survivors are **false positives**:

| flagged | reality |
|---|---|
| `analyticsCardCsv.ts` names `sales-by-category` | prose in a docstring — *"the sales-by-category breakdown as CSV"* |
| `KdsHamburgerPanel.tsx` names `kds-warning` | a **CSS variable** the comment itself says is *"defined NOWHERE"* — describing a removed token, correctly |

So the class-name detector has the same zero precision as the role one, for the same underlying
reason: **a comment that names something absent is usually explaining the absence.**

## Why neither ships

Both are candidate generators with a near-total false-positive rate, and the project already has
a rule for that — written about the citation heuristic in rounds 178-179: do not gate on a signal
that samples badly, because a red gate that is usually wrong is worse than no gate. The findings
here are:

1. the tree IS consistent on both axes today (0 real contradictions in 456 files / 88 class
   claims after the round-197 fix), which is the actual answer to "how many more of these are
   there?" — **none that are currently detectable**;
2. a detector for this class cannot be built from the file alone, because the legitimate forms
   (naming a consumer role, refusing a role, describing a removed token) are textually identical
   to the defect. Separating them needs the comment INTENT, which is a reading, not a grep.

## Verified

| check | result |
|---|---|
| detector 1 | 25 claims, 7 flagged, **7/7 legitimate** |
| detector 2, naive | 88 claims, 25 flagged |
| detector 2, stylesheet-aware | 2 absent, **2/2 false positives** |
| positive control | initially FAILED twice (self-satisfying check, uppercase token); fires once fixed |
| `MenuItemGrid.tsx` and `MenuItemContextMenu.tsx` | restored byte-identical (`4ce7ba3e1d408305`, `e535502e867955d9`) |
| production change | **none** |

## Carried forward

1. **Do not build either detector as a guard.** They were measured, not assumed, and the answer
   is no. Recording the numbers so a future round does not rebuild them.
2. The positive control is now the third time this session that an unvalidated query produced a
   confident wrong answer. **Run the control before reporting any zero** — it cost one call here
   and caught a result I would otherwise have recorded as a clean sweep.

> last audited 18-10-26 by docs-auditor
