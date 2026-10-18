# A paid open bill that failed to delete was never re-read

Date: 2026-10-18 (round 127). Surface: `PosScreen.handlePaymentComplete` — the
restaurant POS checkout's open-bill teardown. Commit: `d722c1a04` —
*fix(sales): re-read the bills when a paid tab fails to delete*.

## The defect

`handlePaymentComplete` ended a paid tab with a fire-and-forget delete whose
refresh raced it and whose failure did nothing:

```ts
if (activeOpenBillId) {
  void releaseLease(activeOpenBillId);
  deleteHeldCartScoped(sessionToken, activeOpenBillId).catch(() => {
    addToast({ ... 'pos-toast-held-cart-delete-failed' });
  });
  setActiveOpenBillId(null);   // handle destroyed BEFORE the write settles
  loadOpenBills();             // refresh in the SAME tick as the delete
}
```

When the delete REJECTED:

1. the tab was still in the database — nothing else removes it, the delete IS the
   commit;
2. `setActiveOpenBillId(null)` had already run, so the only handle that could retry
   the delete was gone;
3. `loadOpenBills()` had fired before the write settled, so the list the operator saw
   was built from whatever the server held an instant earlier.

A paid tab left in the database is not cosmetic. The open-bills list is the only
surface that can resume one, so the next waiter can recall a tab this cashier already
settled and sell its lines a second time.

## Why this was findable, and the comment that pointed at it

The split-bill handler in the SAME FILE does this correctly — it awaits the delete and
re-reads the list in its catch (`PosScreen.tsx:1006-1037`) — and its own comment
records why: *"`loadOpenBills()` sits on the success path (:995), so until now the
list was never re-read and the screen kept showing ONE bill over data that held TWO."*

The split case even NAMES this site's gap and leaves it open
(`PosScreenCoreFlow.test.tsx:710-713`):

> the duplicate being VISIBLE ... needs `activeOpenBillId` set, which only a resumed
> tab does (usePosHeldCarts.ts:418); no case in this file resumes one, so the
> `if (activeOpenBillId)` delete at PosScreen:1000 is never entered here. Stated
> rather than implied: this covers the refresh, not the duplicate display.

That is round 126's lesson again, one degree sharper: not a comment citing a guard
that does not exist, but a comment drawing a precise map of an unclosed gap. Reading
the sibling's fix and asking "does the OTHER site do this?" was the whole method.

## The fix

The delete now carries its refresh in `.finally()` — so BOTH paths re-read — and
`setActiveOpenBillId(null)` moved above it, with the id captured first. Still
fire-and-forget for the sale's sake: the money is already taken and a locked DB must
not fail a completed checkout.

## Verification, and one thing I could NOT verify

* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Restaurant POS suites: `PosScreenCoreFlow`, `PosScreen.integration`,
  `PosScreen`, `usePosHeldCarts`, `heldCartReplacementOrder` —
  `163 passed / 1 skipped` (164).
* Full suite: `810 passed | 3 failed (813)` files, `12903 passed | 4 failed` tests —
  **identical to round 126's counts**, so the change is regression-free. The four
  failures are the same `TableManagementScreen` ones from commit `4347b36d2`, another
  lane.
* **NOT DONE, and deliberately not faked: there is no test for this fix.** I spent the
  round driving `PosScreen.integration` and `PosScreenCoreFlow` to a completed
  checkout with a resumed tab and a refused delete. The resume works and the cart is
  correct, but the payment modal's Complete stays disabled in both harnesses at the
  point reached — `settleDisabled=true`, `completeSaleScoped` never called — so the
  `activeOpenBillId` branch is never entered and the assertion cannot be satisfied
  honestly. Rather than weaken it to something that passes for the wrong reason, the
  test was REMOVED and both files restored byte-identical to HEAD
  (verified by `git show HEAD:...` string compare, not by line count).

  Two splice errors were made and reverted during that attempt — a block inserted
  after a `describe`'s closing brace, and a duplicated `});` — the same failure mode
  rounds 101 and 122 recorded. Both were caught by the transform error rather than by
  inspection, which is why the file was restored wholesale instead of patched again.

  The correct place for this case is a harness that can complete a restaurant sale
  against a resumed tab. `PosScreenCoreFlow` gets closest — its `renderPosScreenWithShift`
  reaches a populated cart in the restaurant workspace — but something between the
  Charge click and `completeSaleScoped` keeps `canComplete` false. That is the next
  step, not a claim.

## Status

The fix is live and unregressed. The assertion that would pin it is absent, so this
record is a FIX WITHOUT A TEST — stated plainly rather than implied by a green suite.

> last audited 18-10-26 by docs-auditor
