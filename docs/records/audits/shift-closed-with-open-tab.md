# A shift closed with a customer's tab still open, and nothing on screen said so (round 294)

## A different class of defect

Rounds 288-293 removed dead controls, fixed write ordering, and closed the held-cart
replacement class. This round went after the **usability and cash-control** side of the
objective, which the earlier rounds touched only as reliability.

## The defect

`usePosShifts.handleCloseShiftClick` enforced one condition before closing a shift:

```tsx
if (lines.length > 0) {
  setCloseShiftError(...'pos-close-shift-cart-error');
  return;
}
```

On restaurant POS **`lines.length > 0` is not the empty state**. A resumed tab's lines live
in the cart only while it is being worked on, so "the cart is empty" is the NORMAL condition
for "a customer has an open tab on this terminal". Closing the shift in that state orphaned the
tab: outstanding, unreconciled, with nothing on screen to say it had happened.

That is a cash-control failure on the one surface whose purpose is counting cash. The operator's
only signal was a successful "shift closed".

## Why the fix is a ref and not an argument

`activeOpenBillId` is produced by `usePosHeldCarts`, which `PosScreen` instantiates AFTER
`usePosShifts`. The value cannot be an argument — the declaration order forbids it, and TS
confirmed the point twice while this was being written.

So the hook takes `hasOpenTabRef?: { current: boolean }`, following the shape `l10nRef` already
establishes for exactly the same reason. The caller declares the ref before the hook and assigns
it after the held-cart one. A ref is also correct on its own terms: **the guard must read the
tab state at the moment Close is pressed**, not the value captured when the hook was configured.
The assignment happens during render rather than in an effect, so there is no one-close-behind
window where a tab exists but the ref still reads false.

A boolean `hasOpenTab` is kept as well, because the hook's own tests and any non-POS host have no
ordering problem to work around.

## The message is a new string, on purpose

Reusing `pos-close-shift-cart-error` would tell the operator to "complete or clear the current
sale" while the sale field is already empty — sending them to hunt for a problem that does not
exist while the actual risk (an open tab) goes unnamed. The new string is actionable in both
English and Indonesian, added to the FTL bundles the i18n lint checks.

## Four tests, and the over-correction they block

| Case | Guards against |
|---|---|
| tab outstanding -> named error, modal does not open | the defect |
| value read from a ref at CLICK time | a tab resumed after first render being missed |
| non-empty cart -> the CART message | the original guard regressing |
| empty cart and no tab -> modal opens | **the guard becoming "close is always disabled"** |

The fourth is the one that matters most and is the easiest to omit. A guard added too broadly
blocks the close flow entirely, which is the same class of defect as the one above: an operator
who cannot close a quiet shift stands at the till guessing why.

## Kill-tested

Removing the tab check from the handler:

```
Tests  2 failed | 2 passed (4)
```

The two tab-guard cases fail; the cart-guard case and the empty-store case still pass — which is
the discrimination the suite is supposed to have. Restored, all four green.

## Verified

| Item | Result |
|---|---|
| New guard tests | **4 passed** |
| Kill-test (guard removed) | **2 failed / 2 passed** — exactly the two intended, then restored |
| POS suites by filter | **929 passed, 58 files, 0 failed** |
| FULL ui vitest suite (796 files) | **12,728 passed, 0 failed** — run this round, no regressions anywhere |
| `npm run typecheck` | **exit 0** |
| eslint on all three files | 0 |
| `lint-i18n.sh` | no issues (the new FTL keys are matched) |
| pre-commit FTL orphan check | OK |
| Source commit | `7255231e5` (guard) + `778c4fb30` (locales) + `ba3e3744c` (tests) |

**The full-suite run is the notable one.** Rounds 1-6 verified filtered subsets, which is
sufficient to see a regression in the area under work but silent about one anywhere else. Running
all 796 files closes that question for the whole UI at once: 12,728 passing, zero failures. No
regression exists in this change.

## Still not verified

e2e. `run-e2e.mjs` needs a Docker backend and the Docker daemon is not running on this machine,
so every result this session has produced is vitest-layer. That is now the single largest
unverified area in the objective, and it is an environment limit rather than a code one.

`TableManagementScreen.tsx` also still carries the other session's `created_at`/`updated_at`
hunk from round 292 and remains uncommitted for that reason — unchanged and still reported.

> last audited 15-10-26 by docs-auditor
