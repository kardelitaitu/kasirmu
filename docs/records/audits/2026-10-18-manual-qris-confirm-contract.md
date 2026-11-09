# The manual QRIS confirm has no re-entry guard — and that is the DESIGN

Date: 2026-10-18 (round 125). Surface: `useGatewayQr`, the manual (cashier-asserted)
QRIS tender — the last of the three gateway rails left unexecuted by my round-122
record. Commit: `e330d8a74` — *test(payments): cover the manual QRIS confirm against
its documented contract*.

## What I found, and what I got wrong about it

`handleQrConfirmed` has no in-flight guard. Rounds 124 and 122 had just added exactly
that shape to the sibling hooks (`useAutoQr`'s `reissuingRef`, `useEdcTenderPhase`'s
`terminalFailed` + `clearTerminalFailed`), so this looked like the third instance of
one rule and the obvious next fix. `usePosHeldCarts`'s own comment
(`RetailPosScreen.tsx:1425`) even cites `useAutoQr` as an example of the class.

MEASURED, before touching anything: two confirms in one round-trip produce
`expected 2 to be 1` — two `buildGatewaySale` calls, i.e. two `completeSaleScoped`
completions for ONE QR.

I added the guard, and it broke two existing tests:

```
FAIL  PaymentModalSaleFlow.test.tsx > PaymentModal — QRIS attempt id
      > sends the SAME attempt id when the QRIS poll confirms twice for one scan
      > mints a different attempt id for the next QRIS attempt
AssertionError: expected 1 to be 2
```

Those tests are not incidental. They encode the documented contract, stated at
`PaymentModalSaleFlow.test.tsx:1930-1935` and again at `PaymentModal.tsx:902-909`:

> The QRIS confirm callback can legally fire MORE than once for one QR (a poll
> that returns pending and then succeeds twice), so every firing must carry the
> SAME attempt id — the backend then replays the first receipt instead of ringing
> a second sale.

So the two calls are REQUIRED. The duplicate is absorbed deliberately, one layer
down, by the backend's attempt-id replay guard. **My fix was wrong and I reverted
it**: `useGatewayQr.ts` is byte-identical to HEAD, verified against
`git show HEAD:...`. Production code in this round is unchanged.

## Why the three gateway tenders genuinely differ

| Tender | Duplicate means | Absorbed by |
|---|---|---|
| EDC (`useEdcTenderPhase`) | a second card capture | overlay owns the screen; `terminalFailed` gates Complete |
| QRIS Auto (`useAutoQr`) | a SECOND Midtrans order, DIFFERENT idempotency key | a client guard is required — nothing else can dedupe it |
| Manual QRIS (`useGatewayQr`) | the SAME settlement observed twice | the backend attempt-id replay guard, by design |

Auto bumps `autoIssueSeq` to mint a new order, so its two calls are two REAL charges
with different keys — a client guard is the only defence. Manual sends the SAME
`attemptId` on every firing, so its second call is a replay the backend answers with
the first receipt. Round 124's fix was right; this round's was wrong. The
distinguishing question is not 'can this fire twice' but 'would the second call
create a second charge'. Only Auto answers yes.

## What was committed

A new `useGatewayQr.test.ts` (140 lines, tests only) pinning the behaviour that had
no behavioural coverage at all — the manual path was referenced by one comment and
exercised by nothing:

1. opening mints a fresh reference each time (a reference identifies ONE exchange);
2. the confirm settles with the asserted reference, `gatewayStatus: 'confirmed'`
   (the ADR-64 vocabulary), and `settleGatewaySale(sale, true)` — manual's payment
   was only ASSERTED, so a failed local finalize voids the pending sale, the
   opposite of Auto;
3. a failed confirm reports on the toast and the classified banner, and does not
   settle;
4. a failed confirm leaves the flow usable — the retry runs the sale again. This is
   the cashier-asserted tender with no polling feed, so a stuck confirm would strand
   the only settlement surface it has.

The file's comments also record WHY no guard is added, quoting the contract, so the
next round does not re-make my mistake.

## Verification

* Payment suites: all 11 files, `186 passed / 1 skipped / 2 todo` (189) — including
  the two `QRIS attempt id` cases my wrong fix had broken, green again after the
  revert.
* New file: `4 passed`.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `810 passed | 3 failed (813)` files, `12901 passed | 4 failed` tests —
  the same four `TableManagementScreen` failures as rounds 120-124, still belonging
  to commit `4347b36d2` from another lane. This round adds one file and five tests.
* `git --no-optional-locks status` on the payment directory shows ONLY the new test
  file; `git diff --stat HEAD -- useGatewayQr.ts` is empty.

## The lesson, which is the opposite of round 124's

Round 124's rule was 'when a test cannot reach its subject, move the test, not the
assertion'. This round's is the other half: **when a new fix breaks an existing
test, the first hypothesis is that the FIX is wrong, not the test.** Two sibling
hooks having a guard is a pattern, not a contract. The contract is in the comment
at the call site and in the test that was already there — and it said, in as many
words, that the callback fires more than once on purpose.

> last audited 18-10-26 by docs-auditor
