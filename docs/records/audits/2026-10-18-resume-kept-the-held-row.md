# Resuming a held cart left it in the list it was resumed from

Date: 2026-10-18 (round 123). Surface: the retail POS held-cart browse path, the
open surface my round-122 record named. Commit: `26e82fd81` —
*fix(retail): drop a resumed hold from the browse list it came from*.

## The defect

`handleResumeCart` (`RetailPosScreen.tsx:1459`) ends with the DELETE that IS the
commit — `await deleteHeldCartScoped(sessionToken, cartId)` (:1509). It never
removed the row from `heldCartsList`, the local array that drives both the
reminder popup and the held-carts modal. Its sibling `handleDeleteHeldCart` does
exactly that (:1553):

```ts
// handleDeleteHeldCart — keeps the list honest
setHeldCartsList((prev) => prev.filter((c) => c.id !== cartId));

// handleResumeCart, before this round — deletes the record, keeps the row
await deleteHeldCartScoped(sessionToken, cartId);
setHeldCartId(null);
setShowHeldCartsList(false);
```

Two handlers perform the same server-side destroy; only one performed the local
write. This is the asymmetry class the round-121 qty/price fix was — one rule,
two implementations, one drifted.

## Why it is reachable and how it fails

1. **The count lies.** `RetailReminderPopup` receives
   `heldCartCount={heldCartsList.length}` (:2080) and renders a row naming a
   number. That row is the ONLY affordance telling a cashier 'there are carts on
   hold'. After resuming the last one it still claimed one, and every resume left
   the count inflated by one for the rest of the shift.

2. **A dead control, and worse, a silently dead one.** The popup's row is wired to
   a bare `setShowHeldCartsList(true)` (:2084) — no refetch. So the modal rendered
   the stale local array and listed a cart the server no longer held. Tapping it
   ran `getHeldCartScoped`, received null, and hit `if (!full) return;` (:1462):
   no modal change, no toast, no error. The cashier taps a row and the UI does
   nothing, with nothing on screen to say why.

The fix is the one-line write the delete path already had, filtered by `id` rather
than clearing the array — the resumed cart is one row among possibly several and
the others must survive.

## Verification (kill-tested)

* RED first, and for the right reason:
  `the resumed hold is deleted server-side but still counted by the reminder popup`
  — the F4 drive had already reached `deleteHeldCartScoped('...', 'held-only')`,
  so the resume itself succeeded and only the list lagged.
* GREEN after the fix: `55 passed` in `RetailPosScreenInteractions.test.tsx`, and
  `192 passed` across all 8 retail suites.
* KILL: deleting the single `setHeldCartsList(...)` line returned the same red,
  then the file was restored and confirmed byte-identical to the pre-kill copy.
  The assertion is load-bearing, not satisfied by the mount path.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings,
  none introduced).
* Full suite: `808 passed | 3 failed (811)` files, `12893 passed | 4 failed`
  tests — unchanged failures from `TableManagementScreen.css`/`.tsx`, still
  belonging to commit `4347b36d2` from another lane (the offenders were re-read
  out of the committed blob: `window.confirm` and
  `tables-arrange-inspector-title`). This round adds exactly one test
  (12892 -> 12893).

## What the test does NOT claim, and why

Consequence 2 (the dead modal row) is asserted INDIRECTLY — by the popup row being
absent — rather than by opening the modal. Two attempts to drive it directly
failed for a documented reason, not a harness accident: the F4 browse branch
`handleResume` (:1534-38) auto-resumes a LONE cart, so no modal ever renders,
which is exactly what the sibling case 'does NOT silently take over a lone hold'
(:1333) pins. Asserting the modal directly would have required a second hold and
would have tested the list-fetch rather than the write under repair. The row's
absence is the observable that matters: with it gone there is no stale entry to
tap, through either entry point.

## Method note

The first assertion used `screen.getByText('Indomie Goreng')` and failed with
'Found multiple elements' — the seeded cart line and the product grid both render
it. Switched to `getAllByText` (:1052 in the same file does the same). A harness
error is not a defect; re-running with the sibling's own query kept the round
honest without changing what is being verified.

> last audited 18-10-26 by docs-auditor
