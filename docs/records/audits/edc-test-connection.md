# The EDC Test Connection, and a toggle that was not needed (round 257)

## What this covers

`edc-test-connection-btn` is the last operator diagnostic on the payments screen and the third of
its family, after the receipts test print (round 222) and the cash-drawer / kitchen-chit pair
(round 248). It answers the question an operator asks when a card will not go through: **is the
terminal answering, and what does it say?**

4 passed, desktop and tablet, across two arms:

| Case | Asserts |
|---|---|
| the terminal answers | a status is reported |
| the check fails | the failure is reported **as an error** |

The mock returns `{ status: 'ready' }` (`dev-mock/handlers/payment.ts:194-200`), so the success arm
comes from the seed and the failure arm from `window.__MOCK_FAIL` — the seam rounds 221, 223,
225, 227 and 257 have each used.

**Kill-tested**: removing the catch's toast fails the failure case. Restored byte-identical.

## The two arms are the point

A diagnostic hard-coded to say READY passes the first case and fails the second — which is why
both are written. The same pairing rule rounds 229, 230 and 242 established, applied here for a
**third** consecutive diagnostic: a control that reports only success is not a diagnostic.

## The reachability detail, and the error it caused

The button is gated on a selection: `{defaultEdcTerminalId && (…)}` (`:1246`). Round 225's spec
already drives that picker successfully, so this reused the route.

The first attempt **added a rail-toggle click before it**, on the assumption that the card body
needed opening. It made things worse:

```
Error: [data-testid="edc-default-select"] expected visible, received HIDDEN
```

Round 225's spec reaches the same select **with no toggle at all** — it is visible on the default
profile. The toggle collapsed the card.

The `role=switch`-through-its-label pattern is real (rounds 148, 170, 179, 228, 230, 242) but it
**does not apply to this control**, and applying it reflexively was the error. A pattern earned on
five surfaces is still a pattern, not a law: it describes those five.

The comment now records this, so the next reader does not re-derive it by adding the toggle back.

## Two splice-shaped mistakes, both caught

The same class as rounds 249, 250, 252 and 255 — the **edit-then-verify** shape:

| Symptom | Caught by |
|---|---|
| a duplicated `const select` line | `tsc` — the file would not compile |
| no tests found | the same run |

Both were from a `splice` that left the original line behind. **The lesson is now uniform across CSS
and TS: replace by explicit line range, then verify the frame around the seam before running**,
which is why both of these were one-line repairs rather than lost time.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| `RestaurantPaymentsScreen.tsx` | unchanged, byte-identical to HEAD |
| `eslint` / `tsc` | 0 / 0 |
| Full UI suite | 12,716 passed |

## Payments coverage, and what is left there

| Surface | Round |
|---|---|
| credential allow-list (unit) | 183 |
| custom rail authoring | 190 |
| QRIS mode | 191 |
| EDC terminal picker | 225 |
| F4 load failure + latch | 227 |
| credential boundary, both gateways | 228, 229 |
| Verify Keys | 229 |
| **EDC Test Connection** | **257** |

What remains on that screen is the Midtrans / Stripe **credential fields** — the one group the
session repeatedly deferred, and for a stated reason: they are secret-key inputs whose *values*
carry little information, while the *boundary* they must not cross is what actually matters and is
already covered (228, 229). The rest of the screen's behavioural surface is now covered.