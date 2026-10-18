# The menu editor's category dialog let Tab out on the first press

**Round 32 · 2026-10-11 · restaurant POS · menu editor category modal**

## Two checks that came back clean

Round 31 fixed a stale key-ownership inventory and suggested checking the siblings it
named. Both were checked and both hold:

- **`WorkspaceRestaurantPosSettings.tsx`** (the F10 card) writes exactly one key,
  `restaurant.course_firing` — which the settings inventory marks `SHARED with the F10
  card`. The ownership claim is accurate in the direction that matters.
- **`RestaurantReceiptsScreen.tsx`** writes `receipt.*` keys, not `restaurant.*`, so it is
  outside the inventory's scope rather than contradicting it.

A wider `grep` for the inventory's phrasing (`owned here`, `SHARED with`) across
`ui/src/features` returned 6 more files, all of which use it for STATE ownership
("Node finder (Ctrl+F) open state — owned here") rather than a key inventory. The
inventory class is a single file, now guarded.

## The finding

`RestaurantMenuEditorScreen.tsx`'s category modal declares `aria-modal="true"` and had no
focus mechanism at all — checked for `useFocusTrap`, `autoFocus`, `panelRef` and `.focus()`
(the only `.focus()` is the icon radiogroup's own arrow-key handler). Measured before the
fix:

```
focus inside the dialog on open          -> expected false to be true
Tab left the dialog on press 1           -> expected false to be true
```

Tab escaping on the **first** press is the notable part: with no trap and no autofocus,
focus was still on the "+ Category" button behind the dialog, so the very first Tab moved
into the menu grid the modal is covering. A keyboard operator on the tablet hits this
immediately.

Escape was already correct — the screen's own document-level listener closes the modal and
suppresses the back-navigation — so the fix deliberately does **not** re-handle it. A second
handler would double-fire `setCategoryModal(null)` and defeat the `stopPropagation`.

## The fix

The modal now installs the shared `useFocusTrap`, as every sibling POS dialog does
(`ItemModifierModal:253`, `SplitBillModal:37`, `PromotionsModal:66`, `RefundModal:176`,
`PriceOverrideModal:176`, `StockShortfallDialog:115`, plus `RestaurantCartSheet` and
`OpenBillModals` from rounds 29-30).

## Verification

| Check | Result |
|---|---|
| trap disabled (kill-test) | both focus cases -> **red**; the 2 pre-existing cases stay green |
| `RestaurantMenuEditorScreen.test.tsx` | **4 passed** on the modal cases |
| menu editor suites (4 files) | **57 passed** |
| wide restaurant/a11y sweep (9 files) | **66 passed** |
| ESLint / typecheck | **0 errors** / clean |

The pre-existing cases staying green through the kill-test is the evidence that the fix ADDS
the trap rather than replacing the modal's behaviour.

## Remaining, recorded

The untrapped-dialog list is now 6, down from 8 after round 29 and none of them on the POS
cashier path: `ThresholdConfigScreen`, `TopologyApplyConfirm`, `topologyMigrationDialog`,
`TopologyRevisionBrowser`, `ShiftModals`, `RestoreSection`.

`ShiftModals` is worth a note: round 30 fixed its **Enter** hazard but it still has no trap.
That is a deliberate split, not an oversight — the Enter defect committed a shift on a
keystroke, which is a data-loss class, while the missing trap is a navigation annoyance. It
is the nearest of the six to the till and the obvious next candidate.

## Method notes

- **A measurement that surprises is worth more than one that confirms.** "Tab leaves on press
  1" told me focus was still on the button BEHIND the dialog, which is a sharper statement
  than "no focus trap" and explains why the defect is hit immediately rather than
  occasionally.
- Checking the siblings a fix names is cheap and was worth doing twice: both held, which is
  what makes the guarded inventory trustworthy rather than merely updated.

> last audited 16-10-26 by docs-auditor
