# The Stripe card finished, and a check that had to be given both arms (round 229)

## Why this round

Round 228's record closed with: *"What is left is the Stripe card, which is now the same shape as
the Midtrans one this round covered — a second case rather than a second investigation."* This was
that case, and one extra claim the shape revealed.

## What the spec pins — 6 passed, both projects

| Case | Asserts |
|---|---|
| the Midtrans boundary | a server key is absent from the market rail row after a save |
| the Stripe boundary | a secret key is likewise absent |
| Verify Keys | an unconfigured gateway is reported **missing**, a configured one **valid** |

## The Stripe boundary is asserted rather than inferred

The allow-list is **per rail code** (`paymentRailsLogic.ts`): `stripe: ['reader', 'currency']`, and
a code NOT in the list passes its parameters through **unchanged**. So the Stripe entry existing is
what protects that rail, and a typo in the key would be silent. Running the same case against the
second gateway is therefore a real check, not a repetition.

**Kill-tested** with the Midtrans allow-list (round 228) and confirmed here on Stripe.

## Verify Keys needed BOTH arms, and the first draft had one

`stripe-verify-keys-btn` reports `restaurant-payment-stripe-keys-valid` or `…-missing` depending on
`Boolean(stripePublishableKey && stripeSecretKey)`. A case asserting only the *missing* arm would
pass on a control hard-coded to warn; asserting only *valid* would pass on one hard-coded to
succeed. **The state decides the message, so both states are read** — the round-219 pattern, third
occurrence.

**Kill-tested**: `const isConfigured = true` fails it. Restored byte-identical.

## The assertions are pinned to the real strings

The first draft used `/missing|not set|required/i` and failed. The actual FTL text
(`shared-ui/locales/products.ftl`) is:

```
restaurant-payment-stripe-keys-valid   = Stripe keys format valid ({ $mode })
restaurant-payment-stripe-keys-missing = Please enter Publishable Key and Secret Key
```

**Which contains none of those words.** An assertion written from what a message *ought* to say is
a guess; reading the catalogue makes it a check — and the same class as the round-226 record's
second failure mode, one layer over: not a probe reading the wrong moment, but an assertion
reading the wrong text.

## The helper that came out of it

`enableRailCard(page, code)` now holds both measured reasons a gateway card needs a step before its
fields exist: `PaymentMethodCard` mounts children only while OPEN, and the raw `role=switch` input
is styled out so the click must go through `label[for="rail-toggle-<code>"]`. Round 228 wrote that
inline; this round's second card made it a function.

## Verified

| Item | Result |
|---|---|
| Spec | 6 passed (3 cases x desktop/tablet) |
| Kill-tests | 2, each failing its own case |
| `RestaurantPaymentsScreen.tsx` | unchanged, byte-identical to HEAD |
| eslint | 0 |
| Full UI suite | 12,713 passed — 0 failed |

## Payments coverage, closed

| Surface | Round |
|---|---|
| credential allow-list (unit) | 183 |
| custom rail authoring | 190 |
| QRIS mode | 191 |
| EDC terminal picker | 225 |
| F4 load failure + latch | 227 |
| credential boundary, both gateways | 228, **229** |
| **Verify Keys** | **229** |

What remains on that screen is the header chrome and the cash custom-label field. The credential
surface — the part where a mistake is a data-security incident — is now covered on both gateways.