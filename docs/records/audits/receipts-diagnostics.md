# The receipts diagnostics an operator reaches for mid-service (round 222)

## Why this round

A coverage re-derivation put the receipts screen at **5 of 15**, now the weakest of the
restaurant surfaces, and its uncovered set is dominated by the HARDWARE DIAGNOSTICS — test
print, test chit, test drawer. Those are what an operator reaches for when the printer stops
working while guests are waiting, and nothing exercised them.

## The surface

`handleTestPrint` (`:808-905`) is a **pre-flight ladder**: four checks before it prints, each with
its own code.

| Code | Condition |
|---|---|
| `ERR_AUTH_REQUIRED` | no session |
| `ERR_PRINTER_DISABLED` | printer switched off in settings |
| `ERR_MISSING_HOST` | network printer with no address |
| `ERR_MISSING_PORT` | usb/serial/bluetooth with no port |

Then it prints and reports into a status card (`:1889-1905`) carrying the CODE and a human
sentence. Measured before writing anything: on the seeded profile the ladder stops at
`PRN_ERR_MISSING_PORT`, so **the reachable branch is a real error report rather than the happy
path** — which is the branch an operator meets first.

## What the spec pins — 4 passed, both projects

| Case | Asserts |
|---|---|
| the report | no card before a run; after it, a card naming a code AND carrying a sentence longer than the code alone |
| the button's return | the card appears, and the button comes back ENABLED |

The second is the one worth stating: asserting only that the card appears would pass on a run
whose spinner never clears, locking the operator out of the one diagnostic they have.

The code-plus-sentence pair is deliberate too — the code is for a support call, the sentence is
for the person standing at the till, and a card carrying only one serves half the audience.

**Kill-tested**: dropping `setTestPrintResult` from the pre-flight fails **both** cases. Restored
byte-identical.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 2 failed |
| `RestaurantReceiptsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,709 passed |

## Receipts coverage, four rounds on

| Surface | Round |
|---|---|
| save + token guard | 164 |
| preview documents (customer / KOT) | 178 |
| **hardware diagnostics** | **222** |

Still uncovered there: the header/back/icon set and `restaurant-receipts-load-error` with its
retry. The load-error path is the reachable one — the retry button only renders inside it, and
the seam round 221 used (`window.__MOCK_FAIL`) can force the read to reject. That is the next
coherent step on this screen.