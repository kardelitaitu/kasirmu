# Three overlays, three cases, and the class is closed — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 193 · status: the last uncovered overlay
     (e-Faktur STAMP) pinned, completing Escape coverage for every focus-trapped overlay on
     SalesHistory; production unchanged · branch: 0.0.41 · commit: 09839102e -->

<!-- Scope: the round-192 carry-forward — STAMP is the last overlay with no case. -->

## The gap, and why it was genuinely last rather than merely left

SalesHistory mounts three focus-trapped overlays. Rounds 191 and 192 pinned DETAIL and VOID;
this round closes STAMP, and it was the awkward one for a structural reason: **its trigger lives
inside another overlay.**

```
detail panel  ->  "Input e-Faktur NSFP"  ->  stamp overlay  (stampPanelRef)
```

So the trap that must own Escape *at that moment* is `stampPanelRef`, not `detailPanelRef`. A case
that only ever opens the detail panel cannot reach it, and assuming the detail case covered it
would have been exactly the mistake rounds 188 and 191 each had to correct.

## The case

Mirrors the existing stamp flow (:922) up to the point it needs a new assertion, then presses
Escape and checks both halves — the **overlay goes** and the **screen stays**. The second half is
the discriminating one: the class of bug here is a dismissal that also navigates away.

## Kill-tested against the specific trap

Disabling the STAMP trap alone — `useFocusTrap(stampPanelRef, false, …)` — turns the case **red**
(`expected <span></span> to be null`). That is the assertion that matters: it proves the case pins
THIS trap rather than passing because a neighbouring overlay happened to close. Restored
byte-identically by sha256 (`1afddfeac40e3712`); production is unchanged.

## The class, complete

| overlay | pinned | opened by |
|---|---|---|
| DETAIL | round 191 | click a row / View |
| VOID | round 192 | **swipe** a row left |
| **STAMP** | **round 193** | a button **inside the detail panel** |

Three overlays, three different opening mechanics — click, gesture, nested. That is the finding:
**the mechanics are what make coverage hard to reason about, not the overlays.** Each round the
next one looked covered and was not, because the previous case exercised a different way in.

## Verified

| check | result |
|---|---|
| `SalesHistoryScreen.test.tsx` | **49 passed** |
| all three Escape cases present | :359 detail, :394 void, :933 stamp |
| kill-test (stamp trap disabled) | red |
| `git status` on the production file | clean — only the test was committed |
| `npm run lint` | 0 errors (116 warnings, baseline) |

## Carried forward

1. Escape coverage on SalesHistory is now complete for all three overlays. This sub-thread is
   closed; do not re-open it without a new reproduction.
2. The generalisable rule, third variant in three rounds: **collapsing "same component" with
   "same code path" is what hides these gaps.** Three overlays in one file, three harnesses:
   a click the click-driven probe finds, a swipe it cannot, and a nested control it must open
   first. Coverage claims should be made per MECHANISM, not per file.
3. The round-189 predicate (`isAnyAriaModalOpen()`) is what makes all three correct at
   runtime; these cases are what keep it that way.

> last audited 18-10-26 by docs-auditor
