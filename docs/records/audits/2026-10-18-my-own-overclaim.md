# My own fix overclaimed, one step softer — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 110 · status: 1 self-inflicted
     overclaim corrected; 1 detector WITHDRAWN on validation; 1 guard strengthened ·
     branch: 0.0.41 · commit: `52cfa436d` -->

<!- - Scope: generalising round 109's finding. Tree verified green at 813/813
     (12,901 passed) going in. -->

## My round-109 fix overclaimed too

Round 109 replaced "Payment processed!" with **"Order sent to the counter — please pay
there"**. That is *also* false: this handler sends nothing anywhere. No API call, no
notification, no print — it clears local state. A customer would read "sent to the counter"
and **the staff would never have seen the order.**

Same defect class as the original, one step softer: instead of claiming money moved, it
claimed information did. **A claim is not fixed by making it vaguer — it is fixed by making
it true of what the code does.**

The copy now says the selection was cleared and points the customer at the counter, which
is exactly what happens.

## The detector I built and threw away

I tried to generalise round 109 with a sweep: flag every success toast with no nearby API
call. **It returned 31 candidates and was worthless.** Validating it against the file it was
built from settled that:

```
detector flags kiosk NOW (post-fix, honest message): true
```

It keys on the toast **type**, so it cannot distinguish "Payment processed" from "order
cleared" — it flags the honest copy as loudly as the lie. A second attempt keyed on the
message text matched **186 bundle strings**, most of them labels rather than claims. Both
were withdrawn rather than reported, because a 31- or 186-item list from a detector that
cannot tell the two cases apart is noise wearing the costume of a finding.

## What replaced it: a guard keyed to the CLAIM SHAPE

The kiosk guard now matches the **shape** of the assertion — paid / processed / recorded /
sent / submitted, or any of the four message ids — and requires one of the seven operations
a real sale path performs. Unlike the sweep, it is scoped to the one handler that makes a
claim, and it **fails on a third wording** rather than on one known string.

**Kill-tested both ways**, which is what the first draft could not do:

| Mutation | Result |
|---|---|
| Restore `kiosk-pay-success` (round 109's original lie) | guard fails |
| Restore `kiosk-order-submitted` (MY overclaim) | guard fails |

## What the kiosk actually is

Worth recording because it bounds what should be built: the backend's own description is
**"Locked-down full-screen self-service mode"** (`crates/kasirmu-core/src/features.rs:107`) —
a DISPLAY mode. It performs **none** of the seven sale-path operations
(`startSaleScoped`, `addLineScoped`, `completeSaleScoped`, `finalizeSale`,
`printSalesReceipt`, `createKdsOrderFromSaleScoped`, `openCashDrawerScoped`). So the
honest copy is the one that claims none of them, and wiring a sale would be a product
decision rather than a copy fix.

## Verification

- **Full suite: 813/813 files, 12,901 passed, 0 failed** (3 skipped, 3 todo).
- The guard fails on both overclaims and passes on the honest copy.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors; `npm run lint:i18n` clean
  including bundle parity, with both strings replaced in en AND id.

## Standing rule

> Fixing a false claim by making it vaguer is not fixing it. Ask instead: what does this
> handler DO — and can the message state exactly that and nothing more? A customer-facing
> device has no one to correct the impression afterwards.

> last audited 18-10-26 by autonomous-goal-round-110
