---
num: 39
area: subscription
title: ADR #39: Midtrans QRIS Subscription Payments (Phase 2)
status: Implemented (2026-08-18) — `docs/plans/todo.md` C3.1; Phase C complete (C0-C4.3 shipped)
---
# ADR #39: Midtrans QRIS Subscription Payments (Phase 2)

Date: 2026-08-18

Status: Implemented (2026-08-18) — `docs/plans/todo.md` C3.1; Phase C complete (C0-C4.3 shipped)

## Context

kasir.mu bills subscriptions in two markets (see `subscription-tiers.md` §2):

| Market | Provider | Currency | Payment methods |
| :--- | :--- | :--- | :--- |
| **Global** | Paddle (MoR) | USD | cards |
| **Indonesia** | **Midtrans** (Phase 2) | IDR, fixed Rp | QRIS, virtual accounts, e-wallets, cards |

Phase 1 (now) sends every customer through Paddle. Indonesian display prices are
honored via Paddle country price overrides, but IDR is not a supported Paddle
currency, so the override is a USD amount ≈ the Rp figure that **drifts with
FX**, and only card-holding customers can pay at all. That caps the Indonesian
TAM at a fraction of the 65M-MSME market — `subscription-tiers.md` §2 calls
Phase 2 **not optional for Indonesian revenue growth**.

Phase 2 routes Indonesian customers to a **Midtrans** checkout: fixed Rp prices
and local payment methods (QRIS, virtual accounts, e-wallets) that cards alone
can't reach. Midtrans over Xendit because `oz-payment` already integrates
Midtrans QRIS for in-store payments — one merchant account, one integration
surface.

State of the codebase:

- **One webhook + provisioning path exists**: `paddle_webhook.go` verifies the
  `Paddle-Signature` header, dedups by `event_id`, upserts the tenant by email,
  mints a `license_keys` record, and writes the RSA-signed `subscriptions`
  payload via the shared `tierQuotas()` + `signSubscription()` helpers
  (ADR #9, ADR #23).
- **Checkout is Paddle-only**: `website/src/components/paddle.ts` loads the
  Paddle.js v2 SDK and opens the checkout overlay; `CheckoutButton.tsx` is
  register-first (session email → `customData.email` so the webhook always
  finds a tenant). The `id` pricing catalog already documents that Midtrans
  replaces Paddle for ID checkout.
- **`license_keys`/`subscriptions` carry `paddle_sub_id`** but no provider
  discriminator — a Midtrans-minted record would be indistinguishable from a
  Paddle one.

## Decision

### D1 — Checkout routing: Indonesian customers → Midtrans

- The website routes a checkout to **Midtrans Snap** when the buyer's locale is
  Indonesian (`/id/*` pages, the site's primary market signal). Paddle stays for
  every other locale. IP geolocation is a future refinement, not a gate — the
  locale of the page the buyer is on is the pragmatic, testable signal today.
- The ID checkout button requests a **snap token** from the license server
  (`POST /api/v1/midtrans/snap`, same session/register-first auth as `/me`)
  instead of loading Paddle.js. The server creates the Midtrans subscription
  (server key held server-side only) with custom fields embedding
  `tier_key` + `email` + `vertical`, and returns `snap_token`; the page opens
  the Snap overlay and, on completion, refreshes via the existing `/me` poll
  (the same post-checkout pattern the Paddle flow uses).

### D2 — Midtrans webhook endpoint (license server)

- New `apps/license-server/midtrans_webhook.go`, route
  `POST /api/v1/midtrans/webhook`, **not** behind the web CORS allowlist
  (Midtrans is server-to-server; the signature is the gate — same as Paddle).
- **Signature verification**: HMAC-SHA512 over the notification's canonical
  fields with `MIDTRANS_SERVER_KEY` (payment notifications:
  `order_id + status_code + gross_amount`; subscription notifications:
  the subscription-status canonical string). Invalid signature → 401.
- **Dedup + idempotency**: in-memory TTL dedup keyed by the notification's
  `transaction_id`/`order_id` (mirroring `paddleDedup`); provisioning upserts
  on a `midtrans_sub_id` field so a retried notification converges instead of
  minting a second key.
- **Provisioning reuses the Paddle path**: on a successful charge
  (`transaction_status` = `settlement`/`capture`), the handler upserts the
  tenant by email, mints/refreshes the `license_keys` record, and writes the
  RSA-signed `subscriptions` payload — same `tierQuotas()` + `signSubscription()`
  helpers, so the POS sees byte-identical signed payloads regardless of provider.
- **Tier resolution**: the tier is carried in the checkout's custom fields
  (`tier_key`) and **cross-checked against the fixed IDR price** the tier is
  expected to bill (`MIDTRANS_PRICE_TIERS` maps `gross_amount → tier`, same
  shape as `PADDLE_PRICE_TIERS`) — a tampered amount cannot mint a higher tier.
- **Failed payment** (`cancel`/`expire`/`deny`): update the subscription status
  and set the grace period via the existing `calculateGraceUntil` semantics —
  the POS's signed payload carries `grace_until` and soft-locks after it.

### D3 — `payment_provider` provisioning discriminator

- Add `payment_provider` (`"paddle" | "midtrans"`) to **both** `license_keys`
  and `subscriptions` (schema + idempotent migration), set by whichever webhook
  minted/refreshed the record. `paddle_sub_id` stays as-is; Midtrans records
  additionally carry `midtrans_sub_id` (the subscription id) so support,
  renewals, and audits can trace the billing path. Existing Paddle records
  backfill to `"paddle"`.

### D4 — Renewals

- Midtrans recurring charges (card/e-wallet auto-debit where supported) arrive
  as later payment notifications on the same `subscription_id`; the webhook
  refreshes `expires_at` on the existing `license_keys`/`subscriptions`
  records (the Paddle renewal pattern). QRIS and VA charges are
  re-authorization-based — the customer re-pays via a new checkout, which the
  same mint-or-refresh path handles.

## Consequences

- Indonesian merchants get **fixed Rp prices and QRIS/VA/e-wallet checkout** —
  the primary revenue unlock for the ID market (`subscription-tiers.md` §2).
- kasir.mu becomes **merchant of record for ID payments**: Indonesian PPN
  (11% VAT) on subscription sales, refunds, and disputes are now kasir.mu's
  obligations — a legal/finance commitment the Paddle path delegated to
  Paddle's MoR.
- **Two webhook + provisioning paths to maintain.** Mitigated by reusing
  `tierQuotas()`, `signSubscription()`, `calculateGraceUntil()`, and the
  tenant/key/subscription upsert shape — the Midtrans handler is a thin
  signature+parse layer over the shared provisioning core.
- The POS and dashboard are **provider-agnostic**: both paths produce the same
  RSA-signed payload shape; `payment_provider` is for ops, not clients.
- A second set of secret env vars (`MIDTRANS_SERVER_KEY`,
  `MIDTRANS_PRICE_TIERS`) plus the existing Paddle set — fail-fast config
  validation mirrors `verifyPaddleConfig()`.

## Tradeoffs / risks

- **Signature correctness is load-bearing.** Midtrans does not sign raw-body
  like Paddle; the canonical field string must match Midtrans's documented
  scheme exactly. Accepted: pinned by test vectors in `TestMidtransWebhook`
  from Midtrans's published examples, not by production blind trust.
- **Local-method subscription maturity**: QRIS/VA charges are customer-initiated
  re-payments, not silent card auto-renew — churn risk at renewal. Accepted:
  Midtrans handles the reminder side; our webhook handles whatever charge
  actually lands.
- **Locale-based routing is a proxy for market.** An English-page buyer in
  Indonesia gets Paddle; an id-page buyer abroad gets Midtrans. Accepted for
  v1; IP geolocation can refine later without schema change.
- **MoR costs** (PPN compliance, refunds, disputes) are new operating
  obligations. Accepted per `subscription-tiers.md` §2 — the alternative caps
  the ID TAM.

## Verification

- `go test ./... -run TestMidtransWebhook`: valid-signature mint (tier from
  price cross-check, `payment_provider=midtrans`, `midtrans_sub_id` set,
  signed payload quota block), invalid signature → 401, replay dedup,
  renewal refresh on a later charge, failed-payment grace, Paddle backfill.
- Website routing tests: id-locale `CheckoutButton` calls the snap-token
  endpoint instead of Paddle.js; non-id locales still use Paddle.
- E2E: the plus-tier webhook→renew harness (`paddle_webhook_test.go`) gets a
  Midtrans twin through the same app mux.

## Implementation Status

- [x] D1 checkout routing — id-locale `CheckoutButton`/`AccountView` open Snap via `POST /api/v1/midtrans/snap`; Paddle for other locales
- [x] D2 `midtrans_webhook.go` + route (`POST /api/v1/midtrans/webhook`)
- [x] D3 `payment_provider` + `midtrans_sub_id`/`midtrans_order_id` (schema + migrations + Paddle backfill)
- [x] D4 renewal handling — recurring charges refresh the same key (keyed by `subscription_id`)
- [x] Tests — `go test ./... -run TestMidtrans` (mint, signature 401, replay dedup, renewal, failed-charge grace, amount cross-check, snap token) + website routing tests; full Go/website/build gates green

Tracked in `docs/plans/todo.md` C3.1 (shipped 2026-08-18).

## Implementation Deviations (shipped 2026-08-18, verified against the code)

The decisions above were written before implementation; the shipped code deviates in
several places. Recorded here so the decision record stays honest — the deviations are
intentional refinements, not bugs (except where noted):

1. **Signature scheme is SHA-512, not HMAC-SHA512** (D2). `verifyMidtransSignature`
   computes `sha512(order_id + status_code + gross_amount + serverkey)` with
   `sha512.Sum512` + constant-time compare — Midtrans's documented payment-notification
   scheme, which is a plain hash, not HMAC. Also, **only the payment canonical string is
   implemented**: subscription-status notifications carry no dedicated canonical string
   and fall through the handler's default branch as acknowledged no-ops (provisioning is
   keyed on settled *transaction* charges).
2. **Custom-field contract (D1) differs.** The ADR said the checkout embeds
   `tier_key` + `email` + `vertical`; what shipped is `custom_field1 = tier_key`,
   `custom_field2 = buyer email`, `custom_field3 = billing period` (the website's
   `monthly`/`yearly` vocabulary), and — added by C3.2 — `custom_field4 = bundle_id`.
   The signup vertical is **not** carried on Midtrans charges (trial segmentation is a
   desktop-activation concern); the stale `custom_field3 = signup vertical` comment in
   `midtrans_webhook.go` was corrected to match.
3. **Period vocabulary: website `monthly`/`yearly` vs. price-map `month`/`year`** (D2
   tier resolution). `midtransAmountForTier` normalizes the website's `BillingPeriod` to
   the map's plan-period vocabulary before the reverse lookup, and `midtransChargeExpiry`
   derives the expiry from the map's period. The webhook cross-checks **all three**
   checkout-embedded fields — `custom_field1` (tier), `custom_field3` (period, added
   2026-08-18: `normalizeMidtransPeriod` accepts `month`/`year` and the website's
   `monthly`/`yearly`), and `custom_field4` (bundle) — against the price-map entry.
   The amount→map lookup remains authoritative for the cadence; a tampered
   `custom_field3` on a renewal now rejects the notification (500) instead of being
   silently ignored, so a forged period can't drift the expiry interval.
4. **Price-map format gained segments (D2).** `MIDTRANS_PRICE_TIERS` shipped as
   `gross_amount:tier_key[:period][:bundle_id]` — not the ADR's "`gross_amount → tier`,
   same shape as `PADDLE_PRICE_TIERS`" — with `[:period]` (default `year`) and the C3.2
   `[:bundle_id]` extension. Unknown bundle ids are rejected at parse time (loud boot
   failure, never a silent no-op).
5. **The snap endpoint creates a Snap transaction token, not a Midtrans subscription**
   (D1). `createMidtransSnapHTTP` calls `POST {base}/snap/v1/transactions` (server key via
   Basic auth) and returns `{token, redirect_url, order_id, amount}` — the ADR's
   `snap_token` plus the order id and the fixed amount (the buyer-facing charge).
   `subscription_id` linkage only appears when Midtrans later sends recurring charges;
   provisioning falls back to `midtrans_order_id` for charges that predate a subscription
   id.
6. **Dedup key is `transaction_id` only** (D2) — not "`transaction_id`/`order_id`". A
   re-delivery with the same `order_id` but a new `transaction_id` is not deduped, which
   is safe: provisioning upserts idempotently on `midtrans_sub_id`/`midtrans_order_id`.
7. **Extra schema fields (D3).** Beyond `midtrans_sub_id`, both collections carry
   `midtrans_order_id` (lookup key for pre-subscription charges) and, from C3.2,
   `bundle_id` — the latter persisting a purchased bundle across renewals.
8. **Webhook-minted keys activate like Paddle keys.** The activation handler's
   api_key-mint-on-first-activation fast-path was originally Paddle-only
   (`paddle_sub_id`); the Midtrans plus-tier E2E exposed that a Midtrans-minted key
   401'd on activation, and it now covers any webhook-issued key (`paddle_sub_id` **or**
   `midtrans_sub_id`). This is the D1 register-first model made symmetric across
   providers.
