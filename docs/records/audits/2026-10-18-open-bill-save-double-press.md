# A double-press on Save created two open bills

Date: 2026-10-18 (round 126). Surface: `usePosHeldCarts.handleOpenBill` — the
restaurant POS open-bill (tab) save. Commit: `8e82afc14` —
*fix(sales): guard the open-bill save against a double-press*.

## How I got there

Round 125 ended with the three gateway rails closed and a standing question: rounds
124 and 122 had each added a re-entry guard to a sibling hook, and round 124 had
measured that `RetailPosScreen.tsx:1425` cites `useAutoQr` as already using 'the same
guard shape' when it did not. The claim named `usePosHeldCarts` too, so this round
checked the other half of the claim.

It was false there as well — and on this code path it concealed a real defect.

## The defect

`handleOpenBill` (`usePosHeldCarts.ts:215`) had no re-entry guard. Its `openingBill`
is a `useState` BOOLEAN written at the top of the handler and cleared in its
`finally` — and READ NOWHERE as a condition. Its only readers are the two buttons in
`OpenBillModals.tsx:95/103`, which it disables. That is a different mechanism with a
different failure mode: a state flag cannot prevent a second call, because React does
not re-render between two clicks that land inside one await.

MEASURED, with the write held in flight:

```
AssertionError: two Save presses in one round-trip created two open bills for one
sale — the duplicate tab the retail hold guard exists to prevent: expected 2 to be 1
```

So a double-press on Save created TWO open bills for one sale — the exact failure the
retail `holdingRef` guard was added to prevent, live on the restaurant side while the
comment told auditors the class was already handled here.

## The fix

An `openingBillRef` set after the existing early-return guards and released in the
handler's own `finally`. The `finally` is load-bearing and got its own test: a
REFUSED save (locked DB, lapsed session) must leave the cashier able to retry, and
the tab they failed to record is precisely what the flow exists to record. A guard
held across the failure would strand them.

`openingBill` is left exactly as it was — it still disables the two buttons, which is
a real accessibility affordance. The ref is added, not swapped in.

## The claim was also corrected

`RetailPosScreen.tsx:1425` read:

> The same guard shape `usePosHeldCarts` and `useAutoQr` already use.

Measured, neither had one at the time. Now `useAutoQr` has `reissuingRef` (round 124)
and this hook has `openingBillRef`, so the sentence is true again — but it is
rewritten to name the two refs and record that the claim had been false, rather than
leaving an assertion a reader cannot check.

## Verification (two kill tests)

* RED first, with the measured count `expected 2 to be 1`.
* GREEN after the fix: `21 passed` in the file.
* KILL 1 — drop the guard's early return: RED with the same message; restored.
* KILL 2 — keep the guard, DROP the `finally` release: RED with
  `a refused save held the guard — the operator could not retry recording the tab`.
  Both kills were reverted and the file verified restored by exact compare.
* Restaurant POS suites: `usePosHeldCarts`, `usePosHeldCarts.leaseConflict`,
  `PosScreen.integration`, `PosScreen`, `PosScreenCoreFlow`,
  `heldCartReplacementOrder` — `165 passed / 1 skipped` (166).
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings,
  none introduced).
* Full suite: `810 passed | 3 failed (813)` files, `12903 passed | 4 failed` tests —
  the same four `TableManagementScreen` failures as rounds 120-125, still belonging
  to commit `4347b36d2` from another lane (offenders re-read from the committed
  blob). This round adds two tests.

## The pattern this is

Four rounds have now found the same defect class, at four sites:

| Round | Site | Missing guard |
|---|---|---|
| 122 | `useEdcTenderPhase` | terminal wait vs Complete (pinned, not a missing guard) |
| 124 | `useAutoQr.handleAutoReissue` | a second Midtrans order on one sale |
| 125 | `useGatewayQr.handleQrConfirmed` | none — and correctly so, by design |
| 126 | `usePosHeldCarts.handleOpenBill` | a second open bill for one sale |

The distinguishing question is the one round 125 recorded: not 'can this fire twice'
but 'would the second call create a second side effect'. Only 125 answered no.

The more transferable finding is the meta-one: **a comment naming a sibling as an
example of a class is a lead, not a reassurance.** Round 124 used that discipline to
find `useAutoQr`; round 126 applied it to the rest of the same sentence and found a
second, real gap. The claim was not even checked by the round that wrote the guard it
cited, because it was phrased as justification rather than as an assertion.

> last audited 18-10-26 by docs-auditor
