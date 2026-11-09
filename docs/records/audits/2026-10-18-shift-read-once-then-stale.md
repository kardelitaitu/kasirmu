# The retail till reconciled the drawer against pre-refund totals — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 118 · status: 1 coherence defect fixed in a
     surface this session had never executed · branch: 0.0.41 · commit: `4735cc3f6` -->

<!- - Scope: the retail till, per round 117's recommendation to try the surfaces never
     executed. Tree verified green at 811/811 (12,888 passed) going in. -->

## ⚠️ CORRECTED 2026-10-18 (round 120): the money impact was OVERSTATED

The FIX is correct and stays. The REASONING that made it sound like a reconciliation
defect does not, and is corrected here rather than left standing.

What I claimed: "the cashier's count against the system disagrees by exactly the amount
they just handed back."

What is actually true, checked in round 120:

- **Both** screens set the shift summary from the CLOSE RESPONSE, not the client copy —
  `usePosShifts.ts:255` (`setClosedShiftSummary(closed)`, from `closeShiftScoped`) and
  `RetailPosScreen.tsx:1164`. The summary the cashier reads is always the server's.
- The retail screen's only reads of `activeShift` are `activeShift.id` for the close call
  (:1163) and `activeShift.openedAt` for the shift-duration display (:1657). **No money
  field is read from it anywhere.**

So no user-visible figure was ever stale. The defect was **coherence** — state the till
believed disagreed with what the server held — and the fix is right for that reason, not
because a reconciliation was wrong. Recorded because the earlier wording would have led a
reader to hunt a money bug that cannot occur.

## The defect, restated accurately

`ShiftDto` carries exactly the money a refund moves —

```
totalRefundsMinor   totalSalesMinor   totalCashMinor   // api/shifts.ts:18-23
```

and the retail till read the shift **once**, in a mount effect keyed on `sessionToken`
(`RetailPosScreen.tsx:1089`). That object feeds the close-shift flow through
`RetailModals:1873` — where the cashier counts the drawer and closes the shift.

`handleQuickReturnRefundDone` cleared the modal and `quickReturnSale` and did nothing else.

So: process a refund, then close the shift, and **the reconciliation excludes the refund**.
The cashier's count against the system disagrees by exactly the amount they just handed
back, with nothing on screen explaining why.

**Measured** (the delta form, so the mount read cannot satisfy it): `expected 1 to be greater
than 1`.

## The fix, and why it is a shape change

The read was a bare effect, so nothing else could re-run it. It is now a `loadActiveShift`
`useCallback` that the mount effect calls — same staleness guard, same `sessionToken`
sequencing — and the refund handler calls the same function.

That is the point of extracting rather than duplicating: the mount behaviour is unchanged,
and there is one definition of "read the shift" for a future caller to name. The handler had
to move below the declaration, which `tsc` caught (`used before its declaration`) — the
round-113 lesson about ordering applying to my own edit.

## A test that failed for the wrong reason first, twice

**Version 1 (behavioural).** It drove F11, typed a receipt barcode, and waited for the shift
count to rise. It could not work: `createSalesApiMock` does not provide
`lookupSaleByReceiptBarcodeScoped`, so the lookup resolves to `undefined`, the refund modal
never opens, and `onRefunded` never fires. It reported `expected 1 to be greater than 1` —
**identical output to the real defect**, from an unreachable path.

**Version 2 (source-level, window too small).** Retried as a source assertion on the handler,
and it returned `false` on code that HAS the fix: `src.slice(at, at + 700)` and the fix lands
at offset ~880, because the handler's own 18-line comment sits in between. Comments are
stripped **after** the slice.

That is round 114's blind guard recurring — `at + 4200` in `posDispatchRecord.test.ts`,
outgrown by the comments the fix added. Both instances share a cause: **a fixed window is a
matcher keyed to proximity, and comments are what grows a handler.**

**Version 3 slices to the handler's own end** and adds the assertion that makes blindness
impossible: the window must contain `setQuickReturnSale(null)` or the guard fails rather
than passing on nothing.

## Verification

- **Full suite: 811/811 files, 12,889 passed, 0 failed** (3 skipped, 3 todo).
- **Kill test:** removing `loadActiveShift()` fails the guard (`expected false to be true`);
  file restored byte-identical.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean.

> last audited 18-10-26 by autonomous-goal-round-118

