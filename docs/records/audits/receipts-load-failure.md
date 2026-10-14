# The F4 load failure, and the claim it suppresses (round 223)

## Why this round

Round 222 named it: `restaurant-receipts-load-error` and its retry, the last reachable pair on
the receipts screen. The retry ONLY renders inside the error state, so nothing could reach it
without first forcing a read to fail.

The seam is round 221's `window.__MOCK_FAIL` (`mockDispatcher.ts:100-134`) — re-read on every
invoke, so a spec arms it in an init script before navigating. The command to fail is
`get_user_preferences_scoped` (`api/settings.ts:297`), the read that `setLoadFailed(true)`
answers (`:514-519`).

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the failure | an error banner is visible, carries `role="alert"`, offers Retry, and **the screen does NOT claim 'All changes saved'** |
| the retry | clearing the injection and pressing Retry **clears the banner** |

## The property worth stating plainly

The saved-claim suppression is the F4 guard, and the comment above `setLoadFailed(true)` gives
the reason:

> A FAILED preferences read is not an answer. Do NOT leave the screen looking saved over values
> that were never confirmed — the operator's next Save would write them over the real ones.

So the negative assertion is the substantive one. A banner alone tells the operator something
went wrong; the absent *"All changes saved"* is what stops them acting on values the screen never
read. **A test that only checked for the banner would pass on a screen that both warned and lied.**

**Kill-tested twice**, because they are two claims:

| Mutation | Result |
|---|---|
| remove the `loadFailed ? null :` arm | fails the failure case |
| stop clearing `receiptInitializedRef` on Retry | fails the retry case |

Both restored byte-identical to HEAD.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-tests | 2, each failing its own case |
| `RestaurantReceiptsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## Receipts coverage, five rounds on

| Surface | Round |
|---|---|
| save + token guard | 164 |
| preview documents (customer / KOT) | 178 |
| hardware diagnostics | 222 |
| **F4 load failure + retry** | **223** |

What is left there is the header's static chrome — title, icon, back button. Those are cosmetic
rather than behavioural, which is the point at which a screen is worth calling closed.

## The seam, now used twice

`window.__MOCK_FAIL` made both round 221's print failure and this round's load failure testable
from a browser. Its docblock predicted exactly this use — *"some states the UI must survive
cannot be reached through the mock's DATA"* — and the two rounds since have each been a case of
it. Worth reaching for before concluding a path is unreachable; rounds 213 and 216 were both
records of paths that looked unreachable and were not.