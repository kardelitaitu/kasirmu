# The gateway tender path had a second, silent copy of an already-fixed loyalty bug

**Date:** 2026-10-11 · **Round:** 49 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/PaymentModal.tsx` — `settleGatewaySale`

## How this was found

Round 48's sweep produced a narrow candidate list of empty catch blocks in write paths. Most
of it was legitimate (DOM pointer-capture calls in `TableManagementScreen`, a non-blocking
sale read-back in the same function). One entry was not: `PaymentModal.tsx:1073`.

## The defect

`redeemLoyaltyPoints` is a separate IPC from sale completion, and it has a **money
consequence** when it fails: the customer's total was already reduced by `loyaltyDiscount`,
so a failed redemption gives away that discount while leaving the points in the account — a
leak the cashier has to settle by hand.

`PaymentModal` contains **two** copies of this block:

| Site | Path | Before |
|---|---|---|
| `:1621-1632` | direct cash/credit/split checkout | already fixed — `console.error` + `payment-toast-loyalty-redeem-failed` warning, with a comment spelling out the money leak |
| `:1073` | `settleGatewaySale` — the shared QRIS/gateway tail | **empty `catch { // non-blocking }`** |

`settleGatewaySale` is the tail for three tenders — manual QRIS, QRIS Auto and EDC — via
`payment/useGatewayQr.ts:104`, `payment/useAutoQr.ts:234` and
`payment/useEdcTenderPhase.ts:232`. So the fixed site covered direct checkout only, and every
QRIS or card-present sale leaked the discount in silence.

The direct path even had a test pinning the fix (`PaymentModalSaleFlow.test.tsx:1148`, *warns
instead of silently keeping points when a loyalty redemption fails*) — which is why this went
unnoticed: the suite was green while the other tender leaked.

## Fix

The second catch now reports identically to the first: `console.error` plus the same
`payment-toast-loyalty-redeem-failed` warning, with a comment pointing at the direct path's
copy for the reasoning rather than restating it. No new strings.

## Evidence

New test — *warns on the GATEWAY path too when a loyalty redemption fails (the second copy of
the same catch)*. It redeems points, drives the manual-QRIS tender (method radio → QRIS pay
button → dialog confirm), and requires the warning. **RED before the fix**, **green after**.

**Kill-tested** by replacing the report with `void redeemErr;`:
`the gateway tail reported nothing about the failed redemption: expected '' to match
/loyalty points were NOT deducted/i`. Restored → green.

- `PaymentModalSaleFlow.test.tsx` **70 passed** (was 69)
- full UI suite **807 files, 12,810 passed**
- `typecheck` clean · `eslint` clean

## Two things worth recording

### The defect was duplicated code, not duplicated intent

This is the first finding in this session's sweep where the *fix already existed in the same
file*. The takeaway is a test-coverage one: an assertion that pins a rule at ONE call site
is satisfied by one copy and blind to the others. Rounds 45 and 47 both produced guards that
pin the rule across *all* sites (`isUnparseable`, `kdsItemStatusFailureIsReported`); for this
one the two copies are in different call paths and a behavioural test each is the right
answer, since a source-level check would have to know which catch belongs to which flow.

### Wiring the test took longer than the fix

Three wrong attempts before the assertion was honest: clicking settle without confirming the
QR dialog (`settleGatewaySale` runs from `handleQrConfirmed`, so the tail never ran); then
`screen.findByText` scoped to the modal, which had already swapped to its done state and
unmounted. The final version asserts on `.toast`/`[role=alert]` across the document, and
carries a check that `redeem_loyalty_points_scoped` was actually CALLED — so it cannot pass
on a redemption that never ran (the failure mode the neighbouring test's own comment warns
about at :1168-1171).

## Related

- Round 48 (`barcode-lookup-failure-was-silent.md`) — same shape on the scan path.
- Round 47 (`kds-item-status-failure-was-silent.md`) — same shape on the KDS path.
- Round 46 (`hardware-load-failure-pinned-save-shut.md`) — same shape on the load path.

Four rounds, four features, one shape: **a mute handler sitting next to a handler that
reports.** Three of the four were found by reading the two side by side rather than by a
behaviour report, which is the argument for the class-based sweep.

> last audited 11-10-26 by docs-auditor
