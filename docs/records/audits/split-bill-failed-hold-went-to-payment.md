# A failed split-bill hold sent the cashier into payment with the tab still open

**Date:** 2026-10-11 · **Round:** 65 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/PosScreen.tsx` — `handleConfirmSplitBill`

## The defect

`handleConfirmSplitBill` (:925) balances the remaining lines onto a new tab. The
create-first ordering at :979-987 is correct and thoroughly documented — the file's own
comment at :972-978 explains it was fixed because delete-first could lose a tab.

But the **catch at :995-997 only toasted — it did not return** — so :999-1001 ran anyway:

```ts
} catch {
  addToast({ ... 'pos-toast-tab-balance-failed', type: 'error' });
}   // <-- no return
setLines(selectedLines);          // cart reduced to the split portion
setShowSplitBillModal(false);
setShowPayment(true);             // PAYMENT OPENS
```

And `setActiveOpenBillId(null)` (:993) is on the **success path only**, so the ORIGINAL
tab still holds every line.

**Result: the split portion is rung as a new sale AND the full original tab remains to
be settled — one set of lines charged twice.** The cashier is told only that the tab
update failed, and the next screen invites them to take payment.

The irony is that the comment two dozen lines above (:974-977) names this exact shape as
what the reordering was meant to end: *"execution then CONTINUES to setShowPayment(true),
so the sale goes to payment with the remaining lines destroyed"*. The reordering removed
the data loss; the missing `return` left the double charge.

## Fix

`return` after the toast. The cart stays intact and the split modal stays open, so the
cashier can retry the balance or cancel. A lost tab is recoverable; a double charge is not.

## Evidence

**RED before the fix**, with all three halves of the contract asserted in order:

1. **reachability** — `holdCartScoped.mock.calls.length > 0`, so the toast assertion cannot
   pass on a path that never ran. It initially reported **0**, which is how I found my test
   was not exercising the code at all;
2. the failure toast renders;
3. `payment-overlay` is **null** — this is the line that went red:

```
AssertionError: payment opened even though balancing the remaining tab failed:
  expected <div …(2)>…(1)</div> to be null
```

**Kill-tested** by removing the `return` — red again with the same message, green on restore.

- `PosScreenCoreFlow.test.tsx` **34 passed**, 1 skipped (was 33 passed — one new)
- full UI suite **808 files, 12,830 passed**
- `typecheck` clean · `eslint` clean

## The test cost four attempts, and two harness facts were the blockers

1. **The barcode scanner is off in restaurant-pos** — `useBarcodeScanner` is wired with
   `enabled: activeWorkspace !== 'restaurant-pos'` (PosScreen.tsx:611), and the split
   modal requires restaurant-pos. Two scans in restaurant-pos produce zero cart lines. The
   test now scans in store-pos and switches workspace afterwards.
2. **`SplitBillModal` auto-selects line[0] at qty 1** when it opens (:50-53), so a 2-unit
   single line already has one unit selected and one remaining. An explicit selection
   click is not needed — and my first attempt added one, which moved the selection the
   wrong way.
3. **A leaked `mockRejectedValue` broke a neighbouring test.** The first full-file run
   failed `opens Open Bill input, saves, and reopens cart`, which passes in isolation —
   the file's own header (:491-503) documents exactly this hazard. The new test now resets
   `holdCartScoped` and the barcode mock and restores `activeWorkspace` on the way out.

## Related

- `payment/splitDistribution.ts` — the integer-split helper this path's sibling uses; it
  carries its own over-split guard.
- Rounds 57-64, the double-invocation family — a different shape, but the same instinct:
  **ask what the handler does AFTER its failure branch.**

> last audited 11-10-26 by docs-auditor
