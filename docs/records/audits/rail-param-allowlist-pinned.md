# The rail credential allow-list, extracted from a component body and pinned (round 183)

## The invariant with no test

`RestaurantPaymentsScreen.handleSave` builds TWO payloads from the same screen:

| Call | Writes | Where |
|---|---|---|
| `setLocalPaymentMethodsScoped` | the MARKET surface — which rails exist, what they are called, whether the site offers them | `local_payment_methods` |
| `setPaymentGatewayConfigScoped` | CREDENTIALS | `payment_gateways`, encrypted at rest |

The first is sanitised: Midtrans keeps only `channels`, Stripe only `reader`/`currency`, and
everything else is dropped. **That rule was inline in the component body**, where no unit test
could reach it without rendering the screen and its eight IPC mocks — so the boundary that
keeps a provider key out of a table every terminal reads and syncs had nothing watching it.

## What landed

`sanitizeRailParams(railCode, parameters)` in `paymentRailsLogic.ts`, next to the rest of the
rails logic, plus the call site rewired to use it. **An extracted function no component reaches
is dead code**, so both halves had to move together.

| Behaviour | Why it is that |
|---|---|
| known rails → allow-listed keys only | the credential boundary |
| unknown rails → parameters unchanged | a site addition has no credential surface, and dropping its params would lose configuration |
| case-insensitive code | matches how the rest of the file compares rail codes |
| malformed JSON → `'{}'` | junk must not reach the market row |

## A guard fired, correctly
`railParamReaders.test.ts` tracks which rail params have a READER and fails when an
`ALLOWED_UNWIRED` entry gains one. My extraction made `channels` readable, so it flagged the
entry as stale:

> *"these ALLOWED_UNWIRED keys now HAVE a reader, so the entry and its INERT comment are out of
> date. Delete the entry (and update the F19 record) so the list cannot outlive the condition
> it records."*

Removed with a note explaining why. **The guard noticed a consequence of my change that I had
not** — the second time this session a tracker caught real drift (round 169's was the first).

## Verified

| Item | Result |
|---|---|
| New tests | **5 passed** |
| Kill-test (allow-list disabled) | **4 of 5 failed** |
| Payments + rails suites | **53 passed** |
| Payments E2E (3 specs) | **6 passed** |
| `railParamReaders` | 9 passed after the stale entry was removed |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,703 passed |

## The shape this round repeats

Round 159 found the same pattern on a different screen: **a rule that matters living in a
component body, unreachable by a unit test, with the guard beside it instead of in it.** Both
times the fix was to move the rule into the logic module its screen already owns and pin it
there. Worth looking for a third.