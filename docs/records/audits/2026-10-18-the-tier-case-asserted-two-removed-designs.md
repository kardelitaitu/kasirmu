# The sales-history tier case was asserting two removed designs — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 170 - status: 1 stale E2E case
     REPAIRED from measurement (both its premises were removed by one commit), 1 defect
     remains escalated and untouched - branch: 0.0.41 - commit: ea1bb88dd -->

<!- - Scope: the contained deliverable round 169 specified - retarget the :303 assertion,
     now that round 169 proved it queried a class deleted by f5772454c. -->

## The case was asserting TWO obsolete designs, not one

Round 169 found the helper queried `.sales-history-filter-group`, which no longer exists.
Measuring the shipped screen at all four viewports found a SECOND removed premise in the same
case — and it was the one the case was named for:

```
WIDE     receiptDisplay table-cell   items table-cell   payment table-cell
TABLET   receiptDisplay table-cell
480x800  receiptDisplay table-cell   items none         payment none
360x640  receiptDisplay table-cell   items none         payment none
```

The case was named "receipt lane folds, filters take the row" and asserted
`receiptDisplay === none` at narrow widths. **The receipt lane never folds, at any tier.**
The shipped 640px rule (`SalesHistoryScreen.css:1195`) hides `nth-child(4)` and
`nth-child(6)` — and the real column order is receipt 1, date 2, total 3, **items 4**, status 5,
**payment 6**, cashier 7. Its own comment says so: "receipt, date, total, status and the actions
stay."

So the case was guaranteed to fail twice over: once on a deleted selector, and once on an
expectation about a lane that the design deliberately keeps. Neither was a regression.

## The repair, and why it is not a re-baseline

The obvious wrong move here is to flip the expectations until the test passes. What I did
instead: measured the shipped behaviour at 360/480/1024/1366 first, then wrote assertions that
name the mechanism.

- **Folded lanes** are now asserted as folded: items and payment at narrow, per the rule.
- **Kept lanes** are asserted as KEPT, including two controls against over-folding: receipt
  (the row primary affordance) and status. That is what makes this stronger than the old case,
  not weaker — the old one had no control at all in this direction.
- **The mechanism** is asserted directly: the bar is `nowrap` + `overflow-x: auto` and its
  `scrollWidth > clientWidth` at narrow widths. That is the property the 640px tier exists
  for, and nothing in the old case tested it.
- **The 880px tier is separated from the 640px one** by asserting items is STILL painted at
  1024 — the old case only checked the receipt lane there, which cannot distinguish the tiers.
- The input floor is asserted as `> 0` rather than a literal `9rem`, so a root-font
  change does not break a case about layout.

## Kill-tested, because a repaired assertion is only worth its discrimination

Disabling the 640px fold in the CSS (so nothing folds) makes the case fail with exactly
"items lane still painted at 480x800" — the new assertion catches the behaviour it claims to
guard. CSS restored byte-identical (sha256) and confirmed clean against HEAD.

## Result

`narrow-shell.spec.ts` now reports **5 passed | 1 failed**, down from 4 passed | 2 failed. The one
remaining failure is the 197px document scroll range — the escalated defect from rounds 167-169,
which I deliberately did not touch this round.

## Evidence

- The four-viewport measurement table above is printed output from the shipped screen.
- The column order is from `SalesHistoryScreen.tsx:1400-1448` (receipt, date, total, items,
  status, payment, cashier) and the fold targets from the CSS rule itself.
- Kill-test: fold disabled -> 1 failed with "items lane still painted at 480x800"; restored by
  sha256 and re-run to 5 passed | 1 failed.
- Commit: `ea1bb88dd`, verified with `git show --name-only` -> exactly
  `ui/e2e/narrow-shell.spec.ts`. **No production file changed.**
- Scratch probes deleted (0 `zz-*` remain in `ui/e2e/`).

## Carried forward

1. The 197px scroll range is the only thing left in this file, and it is exactly where rounds
   167-169 left it: refuted space tabulated, next probe aimed at the fixed-position overlays
   interacting with `container-type: inline-size`. I did not re-open it, and the escalation
   stands.
2. The generalisable finding: **one commit that replaces a design can invalidate several
   assertions in one case, including the one the case is named for.** Round 169 found the
   deleted class; the receipt-lane expectation was the same commit and would have been missed
   by fixing only what the failure message named. Reading the failure message is not enough —
   the named symptom is a subset of what changed.
3. Worth a sweep in a later round: any other E2E case whose NAME encodes a design decision
   should be checked against the current CSS, because a rename like f5772454c leaves the name
   behind as a false promise.

> last audited 18-10-26 by docs-auditor
