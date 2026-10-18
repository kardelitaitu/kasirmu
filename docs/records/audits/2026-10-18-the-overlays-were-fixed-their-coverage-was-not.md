# The overlays were already fixed — their coverage was not — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 191 · status: SalesHistory three
     focus-trapped overlays verified CORRECT under the round-189 predicate, and the zero
     Escape coverage that hid that fact is closed · branch: 0.0.41 · commit: 3295902c9 -->

<!-- Scope: the round-190 carry-forward — SalesHistory overlays have no Escape coverage. -->

## Verified before assumed

Round 190 found that SalesHistory carries **three** focus-trapped ARIA overlays (detail, void,
stamp) and that no spec asserted anything about Escape on them. The open question was whether
the round-189 predicate had actually fixed them, so I probed the real screen instead of
reasoning from the code shape:

```
open a sale detail overlay:  overlays 1, .sales-history 1, aria-modal 1
press Escape:                overlays 0, .sales-history 1, aria-modal 0
```

**Correct.** The overlay closes and the screen survives — exactly the behaviour the table
detail panel is now pinned to. The predicate is `isAnyAriaModalOpen()`, so it reaches every
such overlay by construction rather than by enumeration, which is why SalesHistory needed no
production change.

## So the deliverable is the coverage, not a fix

This is the round-188 shape repeating one layer down, and it is worth naming: **a correct screen
with no test asserting the corrected behaviour is one refactor away from regressing silently.**
The overlay had 46 passing tests; not one of them pressed Escape. Every detail-modal case opens
the panel by CLICK, which is a different code path — the click calls the handler directly, while
Escape goes through `useFocusTrap` document listener into `useExitAnimation` requestClose.

One case added, mirroring the existing click case so the two paths are directly comparable:

> **closes the detail modal on Escape without leaving the screen** — asserts BOTH halves: the
> panel goes (Sale Detail absent) AND the screen stays (the rows are still there).

Asserting only the first half would pass against the exact bug round 189 fixed, where the panel
closed and the whole screen went with it. The second assertion is the one that discriminates.

## Kill-tested

Disabling the trap Escape branch turns the new case **red**. The production file was then
restored byte-identically by sha256 (`72699ffb8468d976`), so nothing shipped but the test.

## Verified

| check | result |
|---|---|
| `SalesHistoryScreen.test.tsx` | **47 passed** |
| kill-test (trap Escape disabled) | the new case **fails** — load-bearing |
| restore of `useFocusTrap.ts` | byte-identical, no production change |
| `npm run lint` | 0 errors (116 warnings, baseline) |
| stray probes | none; `zz-*` removed |

**One gate failure that is not mine, verified rather than waved past:** `npm run typecheck`
reports `IssueGiftCardModal.test.tsx(32,3): Cannot find name beforeEach`. That file is **dirty
in the working tree from another lane** (`417df16950` drop the gift-card PIN input), my commit
touches only `SalesHistoryScreen.test.tsx`, and the error is in a different directory. It is
theirs to finish, and I have not touched it.

## Carried forward

1. The VOID and STAMP overlays share the verified trap pattern and the same predicate, but only
   DETAIL is now pinned by a case. The probe could not reach the Void action — the fixture sale
   had no Void affordance, which is status-dependent — so if either overlay is touched, add its
   own case rather than assuming the detail case covers it.
2. `npm run typecheck` is currently RED from another lane. Do not read that as this lane
   failure, and do not fix their file.

> last audited 18-10-26 by docs-auditor
