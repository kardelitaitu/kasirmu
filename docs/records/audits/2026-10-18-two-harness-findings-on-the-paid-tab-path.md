# Two findings on the paid-tab path, and why the test still is not written

Date: 2026-10-18 (round 128). Surface: `PosScreen.handlePaymentComplete`, the target
of round 127's fix. **No commit this round** — the work was investigation, and the two
findings below are what it produced.

## What I set out to do

Round 127 shipped a fix with no test and said so. This round was to write it.

## Finding 1 — `canComplete` is false at Complete because the tender is empty

Round 127 recorded that Complete stayed disabled (`settleDisabled=true`, no
`completeSaleScoped`) and could not be driven. PROBED this round on the real
component, at the settle button, with a resumed tab in the restaurant workspace:

```
{ rateUnknown:false, splitMode:false, method:"cash", sufficient:false,
  totalMin:700, cashOffered:true, cardOffered:true, canComplete:false }
```

The blocker is `method: 'cash'` + `sufficient: false`: `canComplete` ends with
`if (method === 'cash') return sufficient && cashOffered`, and nothing is tendered
yet. The fix is a step, not a mystery — type into `Amount Tendered` before clicking
Complete, which the file's full-checkout case already does at `:1114-1116`. After
that step the probe read `sufficient:true, canComplete:true` and
`completeSaleScoped` was called once.

So round 127's blocker was a missing test step, now known. The cost of not knowing it
was one round; the cost of having guessed at it would have been a weakened assertion.

## Finding 2 — `handlePaymentComplete` does not run in this harness

With the tender entered the sale COMPLETES — `completeSaleScoped` called, receipt
rendered — but the delete branch is still never entered. A probe on the FIRST line of
`handlePaymentComplete` (`PosScreen.tsx:809`) stayed `undefined`
(`window.__hpc` never set) while `completeSaleScoped` had already run.

That is the real blocker, and it is not a test-authoring problem: **`onComplete` is
not reaching `handlePaymentComplete` in this harness.** `PosScreen.tsx:2297` wires
`onComplete={handlePaymentComplete}` onto `PaymentModal`, and the module resolves — so
either the modal completes the sale through a different path, or the callback throws
before its first statement is observable.

UNRESOLVED, and deliberately not guessed at. It matters beyond the test: if
`handlePaymentComplete` can fail to run on a real completed sale, then everything it
does is skipped — `resetCart`, the table release, the customer-display clear, the
deducted-location reset, AND round 127's paid-tab delete. That would be a far larger
defect than the one 127 fixed. What is NOT yet shown is whether this is a
production behaviour or a property of the jsdom harness (a throwing sibling callback,
a mocked surface, an act() boundary).

Stated at that precision on purpose: the evidence is one harness probe, and the
claim it would support — 'a completed sale can skip the post-completion teardown' —
is too large to assert from it.

## State of the tree

Nothing was committed. Every probe was removed from production code and both touched
test files were restored byte-identical to HEAD, verified by `git show HEAD:...`
string compare:

* `ui/src/features/sales/PosScreen.tsx` — clean; HEAD carries round 127's fix
  (`d722c1a04`).
* `ui/src/features/sales/PaymentModal.tsx` — clean; no `__cc` probe anywhere.
* `ui/src/__tests__/PosScreenCoreFlow.test.tsx` — clean, byte-identical to HEAD.
* `npm run typecheck` + `npm run lint` — 0 errors.
* `PosScreenCoreFlow`, `PosScreen.integration`, `PosScreen`, `usePosHeldCarts` —
  `158 passed / 1 skipped` (159).
* `findstr /S /M "__hpc" "__cc"` over `ui/src` — no hits.

## Next step, precisely

Determine why `handlePaymentComplete` is unreachable from a completed sale in
`PosScreenCoreFlow`: put a probe on `PaymentModal`'s own completion path and compare
it against `onComplete`, and if the callback IS invoked, catch and report what it
throws. Only once that is answered is a test for round 127's fix writable — and the
answer may itself be the round's finding.

> last audited 18-10-26 by docs-auditor
