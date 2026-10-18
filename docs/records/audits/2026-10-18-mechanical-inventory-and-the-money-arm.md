# The mechanical inventory, and the money arm of the class - 2026-10-18

<!-- Audit stamp: 2026-10-18 - autonomous goal round 145 - status: 1 real defect fixed
     (double REFUND - money out), 1 checker committed - branch: 0.0.41 - commit:
     102633f58 -->

<!-- Scope: sales / refunds, per the active goal. Opened by acting on round 144's own
     carry-forward: the saving-as-guard pattern was being hunted by hand, one file per
     round, and the mechanical version had never been run. -->

## The inventory

Round 144 said it plainly: the saving-as-guard pattern "has not been run" mechanically.
This round ran it - every handler that sets a busy flag, awaits a WRITE, and has NO ref
guard in the same body:

- 725 production files scanned;
- 143 handlers set a busy flag and await something;
- 82 survive the two filters that matter: the awaited call is not a
  list/get/load/refresh/fetch read, and the handler name is write-shaped.

82 is still too many to fix one per round, and the first pass showed why the raw count is
useless: two of the three I hand-checked were settings UPSERTS - idempotent by
construction. That is the whole point of the checker, and it is committed as
scripts/check-reentry-guards.py with that warning written into its own docstring: "a
CANDIDATE, not a defect: the cost of the replay depends on the backend."

It also self-verifies in a way the earlier hand work did not - every file this session has
already fixed has DROPPED OFF the list. The checker confirms the fixes are actually in place
rather than trusting the commit history.

## The defect: a double click refunds the customer twice

RefundModal.handleRefund set processing and awaited. Every previous instance of this class
was in the refused-replay group - a unique index or a compare-and-set rejected the second
write, so the worst outcome was a false error toast. This one is not.

    // crates/kasirmu-core/src/db/refunds.rs:119-142
    let already_refunded: i64 = tx.query_row(
        "SELECT COALESCE(SUM(total_minor), 0) FROM refunds WHERE sale_id = ?1 AND currency = ?2", ...)?;
    let after = already_refunded.checked_add(refund.total.minor_units)?;
    if after > sale_total {
        return Err(CoreError::Validation { field: "total", message: "refund total {} exceeds refundable balance {} ..." });
    }

The bound is the CUMULATIVE refundable balance, not "have I already refunded this". So
refunding 7000 of a 35000 sale accepts BOTH writes - 14000 <= 35000 - and the customer is
refunded twice. The modal closes on the first success, so the second write is invisible, and
nothing downstream notices because the cumulative total is still legal.

That is the first time in this session that the double tap moved MONEY OUT OF THE TILL with
no backend backstop at all. The stock-transfer case (round 142) moved stock twice but was
bounded by a count; the restore case (round 143) had no evidence trail. This one is silent,
legal, and directly a cash loss.

## A half-fix that a probe caught

The first attempt was a defect in my own fix: I added the guard
(if (refundPendingRef.current) return;) but NOT the set. The guard was checked and never
armed, so it did nothing. My kill-test proved it - "guard checked, pending=false" on both
invocations. The fix is three lines: check, set, release in finally. Worth recording because
a guard that reads correctly but never arms is exactly the kind of "fix" that a passing test
would have waved through: this case's first version had a green render assertion before the
probe exposed it.

## Evidence

- Red then green: "expected 2 to be 1" before the fix; 21/21 in RefundModal.test.tsx after.
- Kill-test: both guard lines removed -> red; restored byte-identical.
- Half-fix caught: the probe log is the reason the fix is a check+set+release triple rather
  than the partial version I first wrote.
- Checker self-verification: the fixed files from rounds 136-145 are all absent from the
  checker's output; it exits 0 and reports 82 candidates, none of which is a file already
  fixed.
- Gates: npm run lint PASS (0 errors, 114 warnings - baseline), npm run typecheck PASS,
  npm run lint:i18n PASS.
- Full suite: 812 passed | 2 failed files of 814; 12927 passed (up 1). The 2 failures are
  the unchanged pre-existing cross-lane ones (nativeDialogCompliance, noiseDitherCompliance).

## Carried forward

The checker is the durable output and it is not a finding machine - it is a READING LIST
with the filtering already done. The 82 candidates sort by consequence, and the ones that
deserve a round next are the ones whose backend has NO dedupe at all, because those are the
money arm:

- SalesHistoryScreen.handleConfirmVoid -> voidSaleScoped - a reversed sale is money too;
- GiftCardPayment.handleApply -> redeemGiftCard, IssueGiftCardModal.handleSubmit ->
  issueGiftCard - redeeming the same card twice is a real balance walk, and the gift-cards
  table is in the list of tables with no unique index found earlier;
- InventoryAdjustmentScreen.handleSubmit -> adjustStockScoped - stock already moved, and
  this session has already seen how a stock adjustment propagates.

Each needs only the question the checker cannot answer: does the backend refuse it, or does
it add up?

> last audited 18-10-26 by docs-auditor
