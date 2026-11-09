# A double-tap on 'Generate a new QR' minted a second Midtrans charge

Date: 2026-10-18 (round 124). Surface: the QRIS Auto (dynamic Midtrans) tender of
the payment modal — the second of the three gateway hooks my round-122 record left
unexecuted. Commit: `e23ed7408` — *fix(payments): guard the QRIS auto reissue
against a double-tap*.

## The defect

`handleAutoReissue` (`payment/useAutoQr.ts:171`) had no re-entry guard: no ref, no
busy flag, no cooldown. It incremented `autoIssueSeq` and then awaited the charge
with nothing in between, so two taps inside one round-trip each incremented and
each called `qrisAutoChargeScoped`. MEASURED, not reasoned:

```
AssertionError: two reissues in one round-trip minted two charges ... expected 2 to be 1
```

That is a SECOND Midtrans order on the SAME local sale — and the idempotency key
differs on each call, because `autoIssueSeq` is exactly what builds it
(`issueAutoQr`, :113-115):

```ts
const idempotencyKey = autoIssueSeq.current === 0
  ? base                                  // PAY-2: reuse the attempt id
  : `${base}-${autoIssueSeq.current}`;    // a NEW order on the same sale
```

PAY-2 is what makes a retry after a lost response return the SAME live QR rather
than a second charge. The counter is deliberately different per reissue — so the
gateway has no way to dedupe two taps that arrived 50 ms apart. Two charges, one
sale, two things to reconcile, and only the first has a QR on screen.

The button offered no help: `onClick={onReissue}` at `QrisQrDisplay.tsx:329`
carries no `disabled`, while the Cancel beside it does (:341). A DOM `disabled`
could not have covered it either — React does not re-render between two clicks
that land inside one await, the same reason the retail hold guard exists.

## The unverified claim it also pins

`RetailPosScreen.tsx:1425` justifies the screen's own hold re-entry guard with:

> The same guard shape `usePosHeldCarts` and `useAutoQr` already use.

Measured, `useAutoQr` does not. Its only ref is `autoIssueSeq` (:104), a counter,
not a guard. A reader auditing that block is told the class is already handled
where it is not — which is the defect round 105 and round 109 both found, in a
comment rather than in code.

## The fix

A `reissuingRef` set after the `autoQr` guard and released in the handler's own
`finally`, mirroring the `holdingRef` shape the retail screen and
`usePosHeldCarts` actually do use. The `finally` is load-bearing and got its own
test: the expired QR stays on screen after a REFUSED charge, so the cashier must
be able to retry. A guard held across a failure would make that button dead for
the rest of the modal's life — the lock-out class round 297's exit guard describes.

## Verification (two kill tests)

* RED first, with the measured count: `expected 2 to be 1`.
* GREEN after the fix: `2 passed`.
* KILL 1 — remove the guard and the set/release: the double-charge case went RED
  again with the same message, then the file was restored byte-identical.
* KILL 2 — keep the guard but DROP the `finally` release: the retry case went RED
  (`a failed reissue held the guard`), proving the release is pinned and not just
  the early return. Both kills were reverted and verified by exact string compare.
* Payment suites: all 10 files, `182 passed / 1 skipped / 2 todo` (185).
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings).
* Full suite: `809 passed | 3 failed (812)` files, `12896 passed | 4 failed`
  tests — the same four `TableManagementScreen` failures as rounds 120-123, still
  belonging to commit `4347b36d2` from another lane (offenders re-read from the
  committed blob). This round adds one file and two tests
  (12893 -> 12896 includes this file's two cases and the prior round's).

## Method note — the wrong harness, caught

The first attempt placed this case in `PaymentModalSaleFlow.test.tsx`, where the
other QRIS Auto cases live. It could never pass: that file MOCKS
`@/components/QrisQrDisplay` with a stub (`:141`), so the 'Generate a new QR'
button does not exist in its DOM — the failure was `Unable to find role=button
name=/generate a new qr/i`, and the DOM dump showed the stub's own
`qris-auto-confirm` control. The button could not be driven there at all.

The case was REMOVED from that file and the file restored byte-identical to HEAD
(verified by exact string comparison against `git show HEAD:...`, including a
one-byte stray blank line that the first removal left behind). It was rewritten in
a dedicated `useAutoQr.test.ts` that drives the handler directly, which is where
the missing guard actually lives.

That is the round-122 lesson applied again in reverse: when a test cannot reach
its subject, the fix is to move the test, not to weaken what it asserts.

> last audited 18-10-26 by docs-auditor
