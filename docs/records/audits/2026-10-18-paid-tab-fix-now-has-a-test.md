# The paid-tab fix now has a load-bearing test — after three wrong assertions

Date: 2026-10-18 (round 129). Surface: `PosScreen.handlePaymentComplete`, the
target of round 127's fix and round 128's unresolved blocker. Commit: `914218ac4` —
*test(sales): pin that a paid tab is re-read only after the delete settles*.

## Round 128's blocker, resolved — it was not a defect

Round 128 ended with: *"`handlePaymentComplete` does not run in this harness"*, and a
note that if a completed sale can skip the post-completion teardown it would be a far
larger defect than round 127's. PROBED this round: it is neither a defect nor a
harness artifact. Two timing facts explain it completely, and both are ordinary
design:

1. `onComplete` is not called when the sale completes. It runs through
   `animateLeave` (`PaymentModal.tsx:295-305`, `:1692`), i.e.
   `done` -> 1500 ms -> `leaving` -> 300 ms -> `handleLeaveEnd` -> `onComplete` —
   **1800 ms minimum**. Round 128 waited 900 ms.
2. When `receiptArgs` exists the modal shows the ReceiptPreview instead of running
   that timer at all (`:1682` is gated on `!receiptArgs`), so `onComplete` waits on
   Print/Skip (`:2070-2072`). In this harness a receipt is always produced, so the
   timer path is never taken and dismissing the receipt is a required step.

With the receipt dismissed, a probe on the first line of `handlePaymentComplete` set
`{fired:true, activeOpenBillId:'bill-1'}`, the delete ran, and the read count went
2 -> 4. The callback fires exactly as designed. Round 128's write-up was correct to
say the claim was too large to assert; it was wrong to leave the mechanism unknown,
and this round closes that.

## Three assertions that measured nothing

Writing the test took four attempts. The first three PASSED against the broken code,
i.e. were worthless — each was kill-tested rather than trusted:

| Attempt | Assertion | Why it failed to discriminate |
|---|---|---|
| 1 | read count `> readsBefore + 1` | the broken shape also calls `loadOpenBills()` exactly once; only its TIMING differs |
| 2 | invocation order (last read after the delete) | measured: broken `reads=[10,40,74,89] deletes=[88]`, fixed `reads=[10,43,72,91] deletes=[86]` — in BOTH, the last read follows the delete, because the mount and resume reads are also in the list |
| 3 | read count unchanged while the delete is pending, against a baseline captured AFTER observing the delete | the baseline is taken too late: the broken shape's racing read has ALREADY fired by then |

Attempt 4 is the one that discriminates, and it is attempt 3 with the baseline moved:
compare the count while the write is unsettled against `readsBefore`, captured BEFORE
the Complete click. The delete is held open (never settles) so the pending window is
observable:

```
broken:  readsBefore=2, readsWhilePending=4   // the racing read already fired
fixed:   readsBefore=2, readsWhilePending=3   // nothing fired yet
```

The assertion is therefore `readsWhilePending === readsBefore + 1` — the resume's own
read, and nothing from the checkout. The broken shape is one higher.

## Verification

* GREEN at HEAD: `1 passed`.
* KILL: reverting the fix to the pre-round-127 shape (`loadOpenBills()` called
  synchronously beside a fire-and-forget delete) turns it RED with
  `expected 4 to be 3`. The file was then restored and verified byte-identical.
  Round 127's fix is now actually load-bearing under test.
* `npm run typecheck` clean. One real error was caught on the way — an unused
  `refuseDelete` binding, since the promise is deliberately never settled; removed.
* `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `810 passed | 3 failed (813)` files, `12904 passed | 4 failed` tests —
  the same four `TableManagementScreen` failures from commit `4347b36d2`, another
  lane. This round adds one test.

## Why the three attempts matter more than the fourth

Round 127 shipped a fix with no test and said so. Round 128 tried and failed, and
recorded the blocker rather than weakening the assertion. This round could have
stopped at attempt 1 — it was green, the suite was green, and a commit would have
looked like coverage. The kill test is the only reason it is not: three assertions
that pass against the broken code would have converted 'untested' into
'apparently tested', which is worse than the honest gap round 127 left.

## The method, restated

A count assertion satisfied by the mount path is worthless — the rule already on
record from rounds 78/83. This round adds its twin: **an ORDERING assertion can be
satisfied by unrelated later calls**, and both are cured the same way, by holding the
subject's own write open so the window being asserted about is the only thing that can
move within it.

> last audited 18-10-26 by docs-auditor
