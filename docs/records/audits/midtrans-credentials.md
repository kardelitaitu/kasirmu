# The Midtrans fields were reachable all along, and the deferral's reason was wrong (round 263)

## The standing question, applied to a twice-deferred item

Round 262 closed `CartPanel` by asking whether the remaining gap was an ENTITLEMENT or a missing
test. This round asked the same of the payments screen's Midtrans fields, deferred twice (rounds 225
and 257) as *"the one group where a test's value is lower than the care it would need to write"*.

**The deferral was wrong in its reason:**

```
REST     all six Midtrans counts 0
AFTER    all six Midtrans counts 1     <- reachable, merely unexplored
```

Nothing gated them. `PaymentMethodCard` mounts its body only while open, the same gate as the EDC
card, and one label click reveals them.

What remains true of the original caution is narrower: the fields' VALUES carry little
information, so this covers the part that is behaviour — **the environment selector, and a check
that reads PRESENCE only.**

## What the spec pins — 4 passed, both profiles, first run

| Case | Asserts |
|---|---|
| the environment selector | the default active marker, and that picking production MOVES it — taking it off the previous option in the same click |
| Test API Keys | an empty configuration reports MISSING; a filled one reports VALID |

**Kill-test**: `isConfigured = true` fails the second case. Restored byte-identical.

The env selector is a mutually-exclusive pair, so the second half is what proves the control is
wired: asserting only that production becomes active passes on a toggle that never clears the
other.

## The credential check, and why it does not handle a secret

`Test API Keys` (`:1411-1424`) mirrors Stripe's Verify Keys, which round 229 already covered, and for
the same reason — `isConfigured` picks success or warning. **Only the presence of the two fields is
read (`:1412`); no key value is ever asserted**, which is what makes this a test of the diagnostic
rather than of the credential.

That is the third provider behind the same pairing rule: EDC's Test Connection (round 257),
Stripe's Verify Keys (229), Midtrans's Test API Keys (263). **A control that reports only success
is not a diagnostic.**

## Two things that made this easy to get wrong

| Trap | Where it came from |
|---|---|
| assuming the card did not need opening | round 257 measured the EDC select is ALREADY visible; Midtrans's card is collapsed, so the label click IS required |
| writing the credential check with one arm | rounds 229, 230 and 257 each established the pair; one arm passes on a hard-coded control |

The first is the repayment of a pattern round 257 learned: **a pattern earned on one surface
describes that surface.** The EDC finding (no toggle) and the Midtrans finding (toggle) are both
true, of different controls, and only measuring distinguished them.

## Verified

| Item | Result |
|---|---|
| New spec | 4 passed (2 cases x desktop/tablet) |
| Kill-test | 1 failed |
| `RestaurantPaymentsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,716 passed |

## Payments coverage, and what is now left there

| Surface | Round |
|---|---|
| credential allow-list (unit) | 183 |
| custom rail authoring | 190 |
| QRIS mode | 191 |
| EDC terminal picker | 225 |
| F4 load failure + latch | 227 |
| credential boundary, both gateways | 228, 229 |
| Verify Keys (Stripe) | 229 |
| EDC Test Connection | 257 |
| **Midtrans env selector + credential check** | **263** |

What remains on that screen is the remaining Midtrans and Stripe INPUT fields — merchant id, the
readers, currency, NMID, surcharge, static payload — plus three static chrome ids. Those are
**field-by-field value plumbing**: each one writes through `updateRailParams`, and round 183 already
pins the allow-list that keeps every one of them out of the market row. **The security property they
could all violate is covered; the individual keystrokes are not, and are not worth a test each.**

That is now a considered conclusion rather than a deferral: the coverage table's remaining 13
payments ids are field plumbing whose invariant is already tested, plus chrome.

> last audited 15-10-26 by docs-auditor