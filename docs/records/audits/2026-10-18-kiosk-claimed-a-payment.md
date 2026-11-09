# The kiosk said "Payment processed!" and recorded nothing — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 109 · status: 1 defect fixed
     (the claim; the wiring is deliberately NOT done) · branch: 0.0.41 ·
     commit: `e4d094f8c` -->

<!- - Scope: the kiosk Pay handler, carried over from round 108's flag. Tree verified
     green at 813/813 (12,900 passed) going in. -->

## The defect

The kiosk's Pay button toasted `kiosk-pay-success` — **"Payment processed!"** /
*"Pembayaran berhasil!"* — and cleared local state. **It calls no sales API at all:**

- the file's only API imports are `listProductsScoped` and `listCategoriesScoped`;
- there is no import from `@/api/sales` and no dynamic `import()`.

So a customer tapped Pay, was told the payment succeeded, and **no sale existed**: no
revenue recorded, no stock deducted, nothing to reconcile. They collected the goods against
a message that was not true.

**This is not a demo shell.** `register.tsx` registers the route behind the real backend
feature `Feature::SelfServiceKiosk` (`crates/kasirmu-core/src/features.rs:499`) with a nav
item, and no plan or record documents the gap.

## What was fixed, and what was deliberately not

**Fixed: the claim.** The button now says the order went to the counter for payment — true
of what the code does (collect the selection, clear the cart) — and leaves collection to
staff. Same shape as round 105: where a code path cannot do what its message promises, the
message is the defect.

**NOT fixed: the missing write.** Wiring a sale needs a shift, a cart id, a tender and the
stock path — that is a feature, not an audit fix, and doing it unilaterally inside a review
round would be the wrong call. It is recorded here so it is a known gap rather than a
silent one.

**The guard keeps the gap honest.** `KioskScreen.test.tsx` fails if a success claim
reappears **without** a recording call, so the wiring cannot land half-done — a future
commit that adds the API call must also decide what the customer is told.

## Why this survived every existing check

The kiosk had 15 passing tests, including two for the idle timeout and one for the
checkout screen. **A render test observes "a toast appeared"** — which is exactly what it
observes when the call succeeds. The defect is an *absence*, so it is reachable only by
reading what the handler does or does not call, and the guard is a source check for that
reason.

## Verification

- **Full suite: 813/813 files, 12,901 passed, 0 failed** (3 skipped, 3 todo).
- The new case fails pre-fix (`expected true to be false`) and passes after; **kill test**
  restores `kiosk-pay-success` and fails it; file restored byte-identical.
- `kiosk-order-submitted` added to BOTH bundles (en + id), and `lint:i18n` incl. bundle
  parity is clean.
- `npm run typecheck` 0 errors; `npm run lint` 0 errors.

## Standing rule

> The strongest claim a UI can make is about money, and it is the one it is least entitled
> to make without a write behind it. When a handler cannot perform what its message says,
> fix the message first and record the missing capability — do not let a feature build
> masquerade as a completed audit, and do not leave the customer-facing half of it wrong
> while the backend half waits.

> last audited 18-10-26 by autonomous-goal-round-109
