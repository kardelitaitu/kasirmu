# A whole-tree sweep of the E2E selectors: one dead half, no breakage — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 171 - status: 1 dead selector half
     removed, the class shown to be SWEEP-CLEAN (292 locators, 0 that can break), 1 defect
     still escalated - branch: 0.0.41 - commit: 205d10f4c -->

<!- - Scope: the sweep round 170 named - check E2E selectors against the current CSS, since a
     rename leaves assertions behind as false promises. -->

## What the sweep covered, and what it found

Round 170's version of this idea was narrower than it should have been: it proposed checking case
NAMES. Names are a proxy. The checkable property is the SELECTOR, so this round extracted
every class selector the suite actually queries and tested each against `ui/src`:

- 292 distinct `.locator(...)` class compounds
- 34 distinct `getByTestId` values
- 16 distinct `querySelector(All)` class selectors (missed entirely by a locator-only sweep)

**Exactly one dead part, and it cannot break its case.**

```
restaurant-menu-editor-sort.spec.ts:39
  querySelectorAll('.restaurant-menu-editor-item-name, .restaurant-menu-editor-card-name')
                          ^ 0 hits in ui/src            ^ live, RestaurantMenuEditorScreen.tsx:1674
```

The span the first alternative named was renamed to the second, so the leading class had been
dead since that rename — and a comma selector survives a dead part SILENTLY, which is precisely
why it sat there: the case kept passing on the second half and nothing ever reported the first.
Removed, with the reason in the comment rather than a bare deletion.

## The negative result, and why it is the more useful half

The sweep's real value is the class it rules out. Two other candidates surfaced and were
refuted as false positives, and one of those refutations was MY OWN bug:

**`.tables-table--has-bill` — a bug in my checker, not in the suite.** My first pass reported
it as an orphan. It is a real class, built inside a template literal alongside a dynamic
`tables-table--${t.status}` (`TableManagementScreen.tsx:1790`). My extraction stripped only the
leading dot from a compound selector, leaving `a.b` as one string that matches nothing. The
fix — split the compound on `.` and test each part — dropped the orphan count from 2 to 1. A
scanner that cannot read a class LIST will invent orphans, which is the round-157 lesson
(a checker must be self-tested) recurring in a new shape.

**`.restaurant-menu-editor-category-modal` — dead, but fallback-safe.** It appears only as
`.restaurant-menu-editor-category-modal, [role="dialog"]`. The locator resolves through the
attribute alternative, so the case cannot break. Left alone: it is documentation noise, not a
latent failure, and I am not going to churn another lane's spec for that.

So the honest headline is a NEGATIVE: **after the one removal, no E2E selector can break from a
missing class.** The `:303` failure of rounds 167-170 was not a locator falling through — it
was a helper THROWING on a missing selector (`if (!receipt || !input || !group) throw`), which is a
different failure mode with a different signature. A comma fallback hides an orphan; an
explicit guard turns one into a hard error. That distinction is what made this defect findable
and is worth remembering in both directions.

## Evidence

- The extraction and the corpus check are reproducible from the transcripts: 292/34/16 counts,
  the corrected per-part comparison, and the final orphan list of exactly one.
- `restaurant-menu-editor-sort.spec.ts` + `restaurant-menu-editor-memo-clearance.spec.ts` -> 3 passed after
  the removal, so the case still proves what it claims.
- `tables-table--has-bill` confirmed present as a literal token at
  `TableManagementScreen.tsx:1790` — the refutation is a file read, not an inference.
- Commit `205d10f4c` verified with `git show --name-only` -> exactly the one spec.
  **No production file changed.** All scratch files deleted; 0 `zz-*` remain in `ui/e2e/`.

## Carried forward

1. The 197px sales-history scroll range is unchanged and still escalated (rounds 167-169). It is
   the only known open defect in this lane.
2. The E2E selector class is now swept and clean. Do NOT re-run this sweep as a routine — it
   found one dead comment-level token in 292 selectors, which is not a recurring class. Re-run
   it only after a bulk rename.
3. The recursion worth noting: I have now twice written a checker that invented findings
   (`check-dead-controls.py` flagging my own comments, and this sweep flagging a compound
   selector). Both were caught by self-testing against a KNOWN-valid input. That is the habit
   that keeps paying.

> last audited 18-10-26 by docs-auditor
