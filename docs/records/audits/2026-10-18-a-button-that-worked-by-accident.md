# A button that only worked by accident — 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 155 - status: 1 real defect fixed
     (Details button with no handler), 1 nested-interactive a11y violation removed, 3 of
     my own drifted citations repaired - branch: 0.0.41 - commit: 8cbd7195c -->

<!-- Scope: inventory transaction log + the restaurant/USABILITY half of the goal. The
     double-tap class is closed (round 154), so this round took the usability question the
     reliability plan doc does not cover. -->

## Starting from the plan doc, not from a guess

The repo carries `todo-restaurant-pos-reliability.md`, and its header claims the restaurant
POS defects are all closed. A plan doc asserting "NO open code defects" is exactly the kind
of claim this session has learned to test rather than repeat, so it was tested: the three
enforcement files it names exist, and all three pass -- **14 tests, 3 files**. The claim
holds and is guarded, so re-hunting there would have been manufacturing work.

So the round took the other half of the goal: usability. Static sweep for controls that
render with no handler, no submit and no href, across 286 feature components.

## The defect, and the part that makes it worth writing down

`TransactionLogScreen.tsx:273-277` renders a "Details" button with **no onClick**, directly
above `{isExpanded && ...}` at :280. Every piece of machinery around it exists and is
wired: `expandedTxId` (:33), `handleRowClick` (:70-90), the detail block (:280), the loading
state (:34-35). One absent attribute killed the whole affordance.

And the reason the suite never noticed is the finding. `getAllByText('Details')[0]`
resolves to the <span> INSIDE the button, and a userEvent.click on it BUBBLES to the row's
onClick at :256. So the two existing expand/collapse cases pass while exercising the ROW
and never touching the BUTTON. The file header even claims "row expand/collapse" is
covered -- which is true, of a different control than the one that is broken.

A second defect comes with it: a <button> inside a row carrying `role="button"` (:250) is
an `aria-nested-interactive` violation, announced by a screen reader as a button inside a
button.

## My first test passed for the wrong reason, twice

The first version of the new case asserted that clicking the button expands the row. It
PASSED against the broken code, because of the same bubbling. Probed it: a non-bubbling
`dispatchEvent` on the button did nothing at all (`mockCalls = 0`) while the bubbling click
worked -- which proved the button owned no handler and the row was doing the work.

Two attempts to build a discriminating case then FAILED AGAINST CORRECT CODE. A
hand-dispatched `MouseEvent` never reaches a React onClick (React delegates at the root),
and a capture-phase `stopPropagation` listener on the row swallows the click before
React sees it either. Both were removed rather than kept as decoration.

What survived is the assertion the fix actually needs: **one click on Details must expand
the row exactly once.** With the button's handler added and no `stopPropagation`, ONE click
runs the handler twice and the row toggles open-then-closed -- a visible no-op, and a worse
bug than the one being fixed. Kill-tested: that variant turns the row red.

The code comment states this limit explicitly -- the case proves exactly-once but CANNOT
detect a missing onClick on its own -- because a comment that overstates its own coverage
is the failure this session has spent five rounds correcting.

## Three of my own citations, repaired

The gate caught citations this round's earlier work left behind: three comments I wrote in
round 135 cite `:1318`, and another lane's `b3eadb555` / `a234e44ca` shifted
`handleRenameSection` to `:1319`. Re-pointed, and proven safe: the committed file is
**2784 lines before and after, exactly 3 comment lines differing, nothing shifted.**

The remaining citation failures in that file (`:904`, `:881`, `:1045`) belong to the drag
commentary another lane is actively editing, and were left alone.

## Evidence

- Red then green: the case is red without `stopPropagation` (2 calls) and green with it;
  14/14 in TransactionLogScreen.test.tsx after.
- Kill-test: `stopPropagation` removed -> red; restored byte-identical from a backup. A
  second kill removing the handler entirely is GREEN, and the comment says so rather than
  implying otherwise.
- Plan-doc claim verified, not repeated: its three named enforcement files exist and pass.
- Line-neutrality proof for the citation fix: 2784 -> 2784, 3 differing lines.
- Gates: `npm run lint` PASS (0 errors, 116 warnings), `npm run typecheck` PASS,
  `npm run lint:i18n` PASS.
- Full suite: 810 passed | 4 failed files of 814; **12943 passed**. All four failures are
  cross-lane and none is mine: `featureCommentPaths` and both `OrderTypeDependentValueRule`
  cases cite files other lanes have open (PosScreen, completedSale.ts,
  TableManagementScreen:282 -- a code line, in a file where my diff touched only comments),
  plus the two long-standing ones.

## Carried forward

The static sweep produced 52 handler-less controls and 6 in the restaurant surfaces, all 6
of which turned out to be false positives from a too-narrow line window; the full-tag
parser version is the one that found the real defect. 51 of the 52 are design showcase
buttons (`features/design/*`), which is expected and needs no action. The two worth a
look next are `WorkspaceHome.tsx:288` (a user-profile control) and `KioskScreen.tsx:247`,
both of which need the same bubbling check before anyone calls them dead.

> last audited 18-10-26 by docs-auditor
