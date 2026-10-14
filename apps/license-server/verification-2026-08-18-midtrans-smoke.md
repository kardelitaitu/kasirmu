<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · First audit of this file. It carries no stamp and no footer, so this pass adds the first. Scope was deliberately narrow, per the skill's rule for dated records: a smoke-test RECORD is evidence of one session, so the only thing an audit can falsify is whether the artifacts, commands and code paths it names still exist — NOT whether its 2026-08-18 observations still hold, which no doc read can re-derive. · EVERY ANCHOR RE-VERIFIED PRESENT: all three commits resolve (\`ff136ffe\`, \`701ab400\`, \`9a9f563f\`); \`DEPLOY.md\` §11.7 (line 721), §11.8 (759), §7.1 step 8 (the MIDTRANS_PRICE_TIERS block at 347-361) and the Monitoring section (873) all exist, and the same §11.7/§11.8 pair is in \`docs/operations/runbook.md\`; \`pb_schema.json\` is present; the deployment host \`license.ozpos.my.id\` appears 16 times in DEPLOY.md. · THE TECHNICAL CLAIMS VERIFY AT SOURCE, which is what makes this record usable as a reproduction recipe: the six fixed prices plus the two \`restaurant_starter\` bundle entries are exactly §7.1's (\`49000:plus:month,…,2000000:premium:year\` + \`74000:plus:month:restaurant_starter,750000:plus:year:restaurant_starter\`); the three routes exist in Go (\`main.go:368\` request-otp, plus the \`/api/v1/midtrans/snap\` and \`/api/v1/midtrans/webhook\` handlers); the \`OZ-<TIER>-<unix>-<hex>\` order-id format is literally \`midtransOrderID\` (\`midtrans_checkout.go:100-106\`); the Snap request body's \`enabled_payments\` list and \`credit_card.secure\` match \`midtrans_checkout.go:143-146\`; the health object's \`server_key_configured\` / \`price_tiers_configured\` / \`price_tiers_mappings\` / \`secret_configured\` fields are all in \`health.go\` (165-197) with \`db_connected\` at :49; \`MIDTRANS_SNAP_URL\` really does default to \`https://app.midtrans.com\` (DEPLOY.md:361); and all four log strings the negative-check table quotes exist in \`.go\` source — \`is not mapped in MIDTRANS_PRICE_TIERS\` (midtrans_checkout.go:231), \`disagrees with price-mapped bundle\` (midtrans_webhook.go:264), \`disagrees with price-mapped period\` (midtrans_webhook.go:258, the custom_field3 check added by \`9a9f563f\`), and the \`duplicate\` / \`invalid signature\` branches (midtrans_webhook.go:332-343). The boot-gate wording \`Midtrans webhook config verified: N amount→tier mapping(s)\` is emitted from \`midtrans_webhook.go:709\`. The website artifacts §6 defers — \`CheckoutButton\` and the \`LICENSE_API_URL\` worker binding — exist in the website source. · A NEAR-MISS WORTH RECORDING: a grep for \`price-mapped period\` hits \`paddle_webhook.go:1016\` FIRST, with an analogous message about \`billing_cycle.interval\`. That is the Paddle cross-check, not this one; the Midtrans custom_field3 check the record describes is the separate hit at \`midtrans_webhook.go:258\`. A future auditor who stops at the first match would conclude the claim was misattributed. · NOT re-measured, and not re-assertable by this pass: the 2026-08-18 walk's own results — the OTP capture, the snap charge response, the settlement → provisioning → receipt chain, the negative-check outcomes (401/500/duplicate), the record counts (2 keys, 2 subscriptions), and the \`pb_data\` row dumps. Those are observations of one session against a local fake Snap API and SMTP sink; re-deriving them needs a booted server and the harness the page describes inline. Also not re-measured: the deferred sandbox/deployment steps in §6, which by construction have not run. -->

# §11.7 Verification — Midtrans QRIS purchase smoke test

**Date:** 2026-08-18 · **Status:** PASS (server-side walk, locally sandbox-shaped)
**Server under test:** the committed `apps/license-server` code, built from `HEAD` (`go build`), booted as a standalone PocketBase app.
**Runbook section verified:** `DEPLOY.md` §11.7 (end-to-end QRIS purchase smoke test) + §11.8 (curl shapes).

## Scope & honesty note

This walk exercised the **real license-server code paths end-to-end** — OTP login, Snap
charge creation (through the real HTTP client), signature verification, provisioning,
idempotency, renewal, and grace handling — against a real PocketBase DB. The **one external
leg was simulated**: no real `SB-Mid-server-…` key or Midtrans dashboard exists in this
environment, so `MIDTRANS_SNAP_URL` pointed at a local HTTP fake that answers
`POST /snap/v1/transactions` with the documented `{token, redirect_url}` shape, and
`OZ_SMTP_HOST` pointed at a local SMTP sink that captures the OTP/receipt emails. The steps
that require the real sandbox (a live charge settled through the Midtrans dashboard, and the
Northflank-deployed webhook URL) are listed as deferred at the bottom.

**How to reproduce:** the harness (`fake Snap API`, `SMTP sink`, boot env) is described
inline per step; the boot env mirrors `DEPLOY.md` §7.1 step 8 with a sandbox-shaped key.

## Environment under test

| Setting | Value |
|---|---|
| Binary | `go build` of the repo HEAD (commit `ff136ffe` + `701ab400`) |
| `MIDTRANS_SERVER_KEY` | `SB-Mid-server-verify-local-012345` (fabricated sandbox-shaped) |
| `MIDTRANS_PRICE_TIERS` | the §7.1 six prices **plus** the two optional bundle entries: `49000:plus:month,500000:plus:year,99000:pro:month,1000000:pro:year,199000:premium:month,2000000:premium:year,74000:plus:month:restaurant_starter,750000:plus:year:restaurant_starter` |
| `MIDTRANS_SNAP_URL` | `http://127.0.0.1:18080` (local fake, production default `https://app.midtrans.com`) |
| `OZ_SMTP_HOST/PORT` | `127.0.0.1:2525` (local sink) |
| `PADDLE_*` | boot-gate values (`pdl_webhook_test_verify` + 3 fake price ids) |
| DB | fresh `pb_data` (schema auto-imported from the embedded `pb_schema.json`) |

## 1. Boot verification

**Boot log (observed):**

```
2026/08/18 14:40:17 SMTP sender identity verified: verify@ozpos.my.id via 127.0.0.1:2525
2026/08/18 14:40:17 Paddle webhook config verified: 3 price→tier mapping(s)
2026/08/18 14:40:17 Midtrans webhook config verified: 8 amount→tier mapping(s)
```

The runbook's boot-gate line `Midtrans webhook config verified: 8 amount→tier mapping(s)`
(6 fixed + 2 bundle) fired, and the server failed fast on the first boot attempt when
`PADDLE_PRICE_TIERS` was missing — matching §7.1's "boot gate fails fast" contract.

**`GET /api/health` (observed):**

```json
{
  "status": "ok",
  "db_connected": true,
  "midtrans": { "server_key_configured": true, "price_tiers_configured": true,
                "price_tiers_mappings": 8, "error": "" },
  "paddle":    { "secret_configured": true, "price_tiers_configured": true,
                 "price_tiers_mappings": 3, "error": "" }
}
```

The §12 monitoring gate from commit `ff136ffe` reports the configured state.

## 2. Purchase walk (§11.7 steps 1–7)

**Step 1–2 — register-first OTP login:**

```bash
curl -X POST http://127.0.0.1:8099/api/v1/web/request-otp \
  -H "Content-Type: application/json" -d '{"email":"verify.buyer@example.com"}'
# → {"status":"ok"}
```

OTP email captured by the sink (`Your OZ-POS verification code is: 987610`). Verify-otp
returned a session token + tenant:

```json
{ "token": "6aa4b291…", "expires_at": "…", "tenant": { "email": "verify.buyer@example.com",
  "status": "active", "emailVerified": true }, "license": …, "subscription": … }
```

**Step 3 — snap charge (the checkout leg):**

```bash
curl -X POST http://127.0.0.1:8099/api/v1/midtrans/snap \
  -H "Authorization: Bearer <session>" -H "Content-Type: application/json" \
  -d '{"tier_key":"plus","period":"yearly"}'
```

**Observed response (200):**

```json
{
  "amount": "500000",
  "order_id": "OZ-PLUS-1787038841-cbfa92",
  "redirect_url": "http://127.0.0.1:18080/snap/v2/vtweb/snap-token-9cc90f5477da4de1",
  "token": "snap-token-9cc90f5477da4de1"
}
```

Cross-check: `amount` `500000` equals the §7.1 `plus:year` map entry; `order_id` matches
`OZ-<TIER>-<unix>-<hex>`. **The raw request the server sent to the Snap API (captured by
the fake, §11.8 step 3 shape):**

```json
{
  "transaction_details": { "order_id": "OZ-PLUS-1787038841-cbfa92", "gross_amount": "500000" },
  "item_details": [{ "id": "plus-yearly", "price": "500000", "quantity": 1, "name": "OZ-POS PLUS (yearly)" }],
  "customer_details": { "email": "verify.buyer@example.com" },
  "custom_field1": "plus", "custom_field2": "verify.buyer@example.com",
  "custom_field3": "year", "custom_field4": "",
  "enabled_payments": ["qris", "bank_transfer", "echannel", "gopay", "shopeepay", "credit_card"],
  "credit_card": { "secure": true }
}
```

**Step 4–5 — settlement webhook → provisioning.** Signed `SHA512(order_id + status_code +
gross_amount + serverkey)` notification (`transaction_status=settlement`, `status_code=200`,
`fraud_status=accept`, `gross_amount=500000`, custom fields echoed) → **`{"status":"ok"}`**.

**Admin-UI records after the settlement (observed in `pb_data/data.db`):**

`tenants` — one row: `verify.buyer@example.com`, `status=active`, `email_verified=1`
(upserted by the checkout email).

`license_keys` — one row:

```json
{
  "key": "OZ-PLUS-7N24-N9RQ-VJM9-5TPK",
  "tier_key": "plus", "status": "unused", "payment_provider": "midtrans",
  "midtrans_order_id": "OZ-PLUS-1787038841-cbfa92", "midtrans_sub_id": "",
  "bundle_id": "", "max_stores": 1, "max_pos_instances": 2,
  "allowed_types": "[\"restaurant-pos\",\"store-pos\",\"admin\",\"inventory\",\"warehouse\"]",
  "expires_at": "2027-08-18 07:40:49.000Z"
}
```

`subscriptions` — one row: `tier_key=plus`, `status=active`, `payment_provider=midtrans`,
`expires_at=2027-08-18` (+1 year), `grace_until=2027-09-01` (+14 days), signed payload
present (RSA signature from the boot-loaded key).

**Step 6 — receipt email (captured by the sink):**

```
Subject: Your OZ-POS license key
Your license key is: OZ-PLUS-7N24-N9RQ-VJM9-5TPK
```

## 3. Bundle purchase (§11.7 step 8)

Bundle snap (`{"tier_key":"plus","period":"yearly","bundle":"restaurant_starter"}`) →
**`"amount":"750000"`**, order `OZ-PLUS-1787038868-1da12f`. Settlement for that amount with
`custom_field4=restaurant_starter` and a `subscription_id` → `{"status":"ok"}`. The minted key
(observed):

```json
{
  "key": "OZ-PLUS-GURC-ZNCM-P3PQ-HM26",
  "tier_key": "plus", "payment_provider": "midtrans", "bundle_id": "restaurant_starter",
  "midtrans_sub_id": "sub-midtrans-0001",
  "allowed_types": "[\"restaurant-pos\",\"store-pos\",\"admin\",\"inventory\",\"warehouse\",\"kds\"]",
  "expires_at": "2027-08-18 07:41:19.000Z"
}
```

`allowed_types` **includes `kds`** and `bundle_id=restaurant_starter` — matching §11.7 step 8.
Receipt email for `OZ-PLUS-GURC-…` also captured.

## 4. Negative + lifecycle checks (§11.7 list)

| Check | Call | Observed | PASS |
|---|---|---|---|
| Replay | resend the same `transaction_id` | `{"status":"duplicate"}`, still exactly one key | ✅ |
| Invalid signature | `signature_key` zeroed | `401 {"error":"invalid signature"}`, nothing created | ✅ |
| Tampered amount | `gross_amount=123456` (not in map) | `500 {"error":"provisioning failed"}`; log: `gross_amount "123456" is not mapped in MIDTRANS_PRICE_TIERS`; no key minted | ✅ |
| Bundle claim on plain amount | `custom_field4=restaurant_starter` with `500000` | `500 {"error":"provisioning failed"}`; log: `custom_field4 bundle "restaurant_starter" disagrees with price-mapped bundle "" for amount "500000" — rejecting`; no key minted | ✅ |
| **Tampered custom_field3** | `1490000` (plus:year) with `custom_field3="month"` | `500 {"error":"provisioning failed"}`; log: `custom_field3 period "month" disagrees with price-mapped period "year" for amount "1490000" — rejecting`; no key minted | ✅ |
| Renewal | same `subscription_id`, new `order_id`, same amount | **same** key `OZ-PLUS-GURC-…` (no second mint); `midtrans_order_id` updated; `expires_at` extended 07:41:19 → 07:42:02 (+1 year); subscription back to `active`; `bundle_id` + `kds` survived | ✅ |
| Failed charge | `transaction_status=cancel` for the subscription | subscription → `grace_period` with `grace_until` = the old `expires_at`; later renewal revived it to `active` | ✅ |

Final record counts after all checks: **2 license keys, 2 subscriptions** — the negative
checks minted nothing.

> **Tampered custom_field3 verification (re-run 2026-08-18):** the period
> cross-check added in commit `9a9f563f` was re-verified against the HEAD
> code. A notification with `gross_amount=1490000` (plus:year) and
> `custom_field3="month"` was rejected with **500** and the server log
> recorded `custom_field3 period "month" disagrees with price-mapped
> period "year" for amount "1490000" — rejecting`. No license key was
> minted. The legacy vocabulary `"monthly"` for the matching monthly amount
> (`149000`) was accepted (200, key minted, expiry ~+1mo).

## 5. §11.7 checklist summary

- [x] Boot gate line (`Midtrans webhook config verified: 8 amount→tier mapping(s)`)
- [x] Register-first OTP login self-signs the tenant
- [x] Snap charge returns `{token, redirect_url, order_id, amount}` with the map amount
- [x] Settlement webhook mints key + subscription + sends the receipt email
- [x] Key has `payment_provider=midtrans`, plus quota block (no kds without bundle)
- [x] Bundle amount (`750000`) → `kds` in `allowed_types` + `bundle_id=restaurant_starter`
- [x] Replay dedup, invalid signature 401, tampered amount 500, bundle-claim 500
- [x] **Tampered custom_field3** (`month` on `plus:year` amount) → 500, no key minted
- [x] Renewal refreshes the same key and extends expiry +1 year
- [x] Failed charge moves the subscription to `grace_period`

## 6. Deferred ops steps (require the real sandbox / deployment)

- [ ] Run §11.7 against the **real Midtrans sandbox**: set `MIDTRANS_SERVER_KEY` to a real
  `SB-Mid-server-…` and `MIDTRANS_SNAP_URL=https://app.sandbox.midtrans.com` in Northflank
  (§7.1 step 8), point the sandbox webhook URL at
  `https://license.ozpos.my.id/api/v1/midtrans/webhook` (§7.6), and pay with the sandbox
  QRIS app so the charge settles through Midtrans's own API (the one leg simulated here).
- [ ] Verify the **website worker binding** (`LICENSE_API_URL` → the license server) so the
  id-locale `CheckoutButton` hits the deployed snap endpoint (§11.7 pre-flight).
- [ ] Confirm the §12 keyword monitor (`"server_key_configured":false` /
  `"price_tiers_configured":false`) is live on `https://license.ozpos.my.id/api/health`.

> last audited 11-10-26 by docs-auditor
