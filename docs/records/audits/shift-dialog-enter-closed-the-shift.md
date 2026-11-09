# Enter closed the shift: an overlay keydown handler with no target guard

**Round 30 · 2026-10-11 · restaurant + retail POS · shift dialogs**

## Continuing last round's class

Round 29 enumerated every `aria-modal="true"` without `useFocusTrap` and fixed the two on
the POS cashier path. Re-running the same command this round showed the class had shrunk by
exactly those two, and `ShiftModals.tsx` (3 dialogs) was next — open shift, close shift, and
the shift summary, all on the till.

## The defect

`CloseShiftConfirm` attached its keyboard handling to the **overlay**:

```tsx
onKeyDown={(e) => {
  if (e.key === 'Escape') { closeShiftExit.requestClose(); setCloseShiftError(null); }
  if (e.key === 'Enter') handleConfirmCloseShift();
}}
```

The dialog contains a counted-cash `<input>` and a notes `<textarea>`. A keydown inside
either one **bubbles to the overlay**, and there was no target guard anywhere in the file
(`grep` for `isEditableTarget|e.target|stopPropagation` found only `onChange` handlers).
A textarea is precisely where a multi-line shift note is typed, and no modifier is needed —
so the keystroke that should have inserted a newline **closed the shift**.

Measured, before any fix:

```
Enter in the notes textarea        -> handleConfirmCloseShift called 1 time
Enter in the counted-cash input    -> handleConfirmCloseShift called 1 time
Enter from a non-text control      -> called 1 time   (the deliberate affordance)
```

The third row is the control: the Enter shortcut is intentional for a keyboarded till, so
the fix had to keep it and narrow it, not delete it.

**`OpenShiftModal` had the identical shape** — an opening-balance `<input>` and
`if (e.key === 'Enter') handleConfirmOpenShift();` on the overlay. The file's own header
already named the pattern (`dialogs (<div role="dialog" onKeyDown>)`), which is what made
it worth checking the sibling rather than fixing one instance.

## The fix

Both handlers gained the guard the rest of the POS already uses:

```tsx
if (e.key === 'Enter' && !isEditableTarget(e.target)) handleConfirmCloseShift();
```

`isEditableTarget` is the shared helper (`utils/isEditableTarget.ts`) that `PosScreen` and
`RetailPosScreen` already use to suppress hotkeys during text entry — so this is the same
rule applied to a dialog rather than a new mechanism.

## Verification

| Check | Result |
|---|---|
| guards removed (kill-test) | 3 hazard cases -> **red**, 2 controls stay green |
| re-kill-tested after a fixture refactor | still 3 red / 2 green |
| `closeShiftEnterHazard.test.tsx` | **5 passed** |
| POS sweep (9 files) | **132 passed**, 1 skipped |
| ESLint / typecheck | **0 errors** / clean |

### Two harness errors worth recording

1. My first fixture omitted `closingBalance`/`shiftNotes`, so the component threw on
   `closingBalance.trim()` and **all three** cases failed — including the control. A control
   failing alongside the subject tests means the harness is wrong, not the code.
2. `vitest` transpiles without typechecking, so 5 tests passed while `tsc` reported three
   real errors (`Spread types may only be created from object types` from my `as never`
   casts). **Typecheck caught what the test run could not** — the two gates are not
   redundant.

The fix for (2) was to type the fixtures with the components' own prop types and to give
`activeShift` a COMPLETE `ShiftDto`: object literals are checked in full, so a partial one
is an error even when every field the component reads is present.

## What I checked and did NOT change

A coarse `grep` for Enter handlers without `isEditableTarget` returns 27 files, and
narrowing to dialogs containing a text input still returns 7. I read each of the 7: in
every one the handler sits on the **control** (`RetailModals.tsx:501`'s discount input,
`:805`'s quick-return input, `topologyNodeFinder`, `KdsEnrollmentModal`, `PriceOverrideModal`,
`SalesHistoryScreen`, `RestaurantMenuEditorScreen`), not on the overlay. Enter on an input
that should submit is correct; only the overlay-level binding was wrong. **The enumeration
was too coarse to be a defect list, and is recorded that way rather than as six more bugs.**

## Method notes

- **A guard on a container is not a guard on its children.** The defect was not a missing
  condition but a missing *scope*: the handler was three levels up from where the keystroke
  originated, so it fired for events the author never pictured.
- **The control case earns its place.** Two of five tests assert the shortcut STILL works.
  Without them, deleting the binding would pass the suite — the cheapest wrong fix.
- **Re-run the kill-test after refactoring a test.** Fixing the type errors rewrote every
  fixture; a refactored test is a new test until it has been seen to fail.

> last audited 16-10-26 by docs-auditor
