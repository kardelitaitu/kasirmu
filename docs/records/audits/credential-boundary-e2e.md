# The credential boundary, proven in the browser (round 228)

## Why this round

The Midtrans and Stripe credential fields are the last substantial uncovered group on the payments
screen — the weakest restaurant surface. Round 225 called them *"the one group where a test's value
is lower than the care it would need to write"*, and round 183 showed the care IS the point.

`handleSave` builds TWO payloads from one screen (`:747-790`):

| Call | Writes |
|---|---|
| `setLocalPaymentMethodsScoped` | the MARKET surface — which rails exist, what they are called |
| `setPaymentGatewayConfigScoped` | CREDENTIALS — encrypted at rest in `payment_gateways` |

**A credential in the rail list is a provider key in a table every terminal reads and syncs, with
none of that encryption.** Round 183 extracted `sanitizeRailParams` to enforce the allow-list and
pinned it with a unit test. This round proves the boundary **end to end in the browser**, which the
unit test cannot: that the screen's own field writes route the key correctly.

## What the spec pins — 2 passed, both projects

Enable the Midtrans card, type a sentinel into the SERVER KEY, arm and press Save, then read the
mock's rail slice for the sentinel.

The assertion is a **boundary**: absent from the market row, while still having been sent to the
encrypted table. Absence alone would pass on a screen that dropped the field entirely — which is
why the arm-then-save is part of the same case rather than a separate one.

**Kill-tested**: widening the allow-list to `['channels', 'serverKey', …]` leaks the key into the
market row and the case fails. Restored byte-identical.

## Two reachability facts established on the way

| Gate | Detail |
|---|---|
| the card body | `PaymentMethodCard` mounts its children only when OPEN, and the midtrans card has no `mountBodyWhenCollapsed` (unlike the `card` rail at `:1222`) — so a fresh profile renders no credential fields at all |
| the toggle | the raw `role=switch` input is styled out; the click must go through `label[for="rail-toggle-midtrans"]` — rounds 148, 170 and 179's pattern, now a fourth occurrence |

Both are recorded in the spec's comments so the next reader does not re-derive them.

## Verified

| Item | Result |
|---|---|
| New spec | 2 passed (desktop + tablet) |
| Kill-test | 1 failed, widening the allow-list |
| `paymentRailsLogic.ts` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,713 passed — **0 failed** |

## A note on the suite

Round 227's run reported `1 failed` in another lane's in-flight `TableManagementScreen` work. This
run is green, so that lane has since fixed it — the failure was never mine, and committing only my
own paths meant none of their work was swept into my commit while it was broken.

## Payments coverage

| Surface | Round |
|---|---|
| credential allow-list (unit) | 183 |
| custom rail authoring | 190 |
| QRIS mode | 191 |
| EDC terminal picker | 225 |
| F4 load failure + latch | 227 |
| **credential boundary (e2e)** | **228** |

What is left is the Stripe card, which is now the same shape as the Midtrans one this round
covered — a second case rather than a second investigation.