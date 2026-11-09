# Round 131's guard claimed a report it never emitted

Date: 2026-10-18 (round 132). Commits: `66b48668a` — *docs(ui): re-point seven
citations that landed on punctuation-only lines*; `6fbe42935` — *test(ui): enforce
citations that land on punctuation-only lines and print the review list*.

## The defect, and it was mine

Round 131's record said the new guard "reports the 154 that do not" resolve to their
subject. That report did not exist. The accumulator was built and never read:

```ts
const suspicious: string[] = [];
  ...
  suspicious.push(...);      // filled
// ...and never used. The summary line printed; the list did not.
```

Measured this round: grepping `suspicious` in the committed file returns exactly two
hits — the declaration and the push. A run prints
`194 total, 40 in range, 154 to review` and then nothing. So round 131 shipped a guard
whose own documentation described behaviour it did not have, which is the round-126
defect class committed by me, in a file whose entire purpose is catching that class.

Two smaller artefacts from the same editing session were found beside it: the summary
`console.info` was duplicated, and a `const blankOrBeyond` was computed and `void`ed.
Both removed.

## What the report shows now that it runs

154 candidates across the features tree, concentrated in the largest files:
RetailPosScreen 21, TableManagementScreen 18, PosScreen 16, SalesHistoryScreen 11.

Round 131 generalised from a hand-checked sample of FOUR. That is too small, so this
round checked twelve and then classified all 154:

* **12 of 12** hand-checked candidates were genuinely drifted. `ExpoScreen:164` cites
  `:232`, which reads `};`; `useKdsPreferences:98` cites `:113`, which reads `}`;
  `KdsProductPickerModal:267` cites `:136`, a `return` statement.
* Classified mechanically, **103 of 154** have their comment's own identifiers absent
  from a ±3-line window but present elsewhere in the file — the signature of a pointer
  that has moved.

So the signal is real and the 154 is mostly genuine drift, not heuristic noise. It is
still not enforced wholesale: the mechanical classifier cannot separate 'moved' from
'the comment paraphrases', and failing on 154 pre-existing citations would make the
guard noise. That reasoning from round 131 survives; only its description was wrong.

## The second enforceable class

Seven of the 154 land on a line whose entire content is punctuation — `};`, `}`, `})}`,
`)}`, `});`. No comment can be citing one of those correctly, so it carries the same
no-false-positive property as a blank line and is now ENFORCED alongside it. All seven
were re-pointed after reading their targets:

| File | Was | Now | Cites |
|---|---|---|---|
| ExpoScreen.tsx | :232 | :328 | `restoreOrder` |
| useKdsPreferences.ts | :113 | :128 | `writeLocalPrefs(userId, serverPrefs)` |
| RetailPosScreen.css | :3263 | :3133 | `.retail-view-toggle-btn--active` |
| PosScreen.tsx | :993 | :1020 | `setActiveOpenBillId(null)` |
| PosScreen.tsx | :1169 | :1202 | the dispatch await |

## The exemption this needed

`EodReportScreen.tsx:27` reads *"They were spelled inline at both render sites below
(was :154 and :187 at tip b2247947e)"*. Those numbers were never meant to resolve —
they name where code USED to be, with the commit that moved it. A HISTORICAL reference
is a claim about the past, which is the same reason the two path passes already exempt
`deleted`/`removed`/`retired`. Added on the same terms, and the exemption is
load-bearing: removing it turns the guard red on exactly those two citations.

## Verification

* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Guard GREEN: 194 citations extracted, 0 dangling.
* KILL A — re-break `ExpoScreen` to the punctuation-only `:232`: RED.
* KILL B — remove the historical exemption: RED on `EodReportScreen:27` only.
* Full suite: `811 passed | 2 failed (813)` files, `12908 passed | 2 failed` tests.
  The count IMPROVED from 4 to 2 because another lane fixed the two
  `screenExtraction` TableManagementScreen failures mid-round (`screenExtraction` now
  runs 323/323). The remaining two are `nativeDialogCompliance` and
  `noiseDitherCompliance`, both still belonging to commit `4347b36d2`.
* Four production files changed, 5 insertions and 5 deletions, every changed line a
  comment — verified mechanically.

## What this round is worth

One dead accumulator and two editing artefacts from my own last commit, seven more
real drifts fixed by hand, and a second enforceable class added to the guard. No
production defect.

The transferable part: round 131 built the report and I described it as working without
running it. The guard passed, the summary printed, and the one line that would have
shown the difference — the list — was missing. A test that passes does not tell you
which of its parts executed; asserting on the part you believe you added is the only
way, and the kill test is what forced me to look.

> last audited 18-10-26 by docs-auditor
