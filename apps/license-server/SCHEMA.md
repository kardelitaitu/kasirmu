<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 4 minor) · Fresh full audit; the 2026-07-22 Hermes stamp with its three dated notes is merged at the bottom as original evidence. · MAJOR: the document covered FOUR collections while `pb_schema.json` now defines TEN. The six it omitted are not incidental — `trial_registrations`/`trial_claims`/`trial_email_log` back the trial flow, `enterprise_approvals` backs the enterprise-trial admission flow, and `revenue_events`/`revenue_adjustments` are the revenue ledger the admin dashboard reports from. A schema document that silently omits the ledger is the one omission a reader cannot detect. All six added as §5–§10, field-by-field, from the JSON. · MINOR 1: `license_keys` was missing `addons`. · MINOR 2: `tenants` was missing four fields — `email_verified`, `password_hash`, `password_reset_at`, `region` — the first three of which are the web-dashboard credential surface. · MINOR 3: `subscriptions` was missing `paused_at`, `paused_until`, `bundle_id`, `feature_grants`, and its `status` select was missing the `paused` option. · MINOR 4: `tenant_machines` was missing `machine_id` and `revoked_at`, and BOTH `payment_provider` rows listed two of the three real options (`manual` was absent) — an operator reading the enum would not know a manually-minted key is representable. · ALSO REPAIRED: the Overview now names the authoritative artifact (`pb_schema.json`) and no longer implies the simplified-authenticator framing covers the whole schema. · VERIFIED UNCHANGED: every field the document DID list is still present and still has the type it claims; the bcrypt+lookup §2 note, the §3 quota-mirroring note and the four correctness notes carried by the prior stamp all still hold. · NOT re-measured: the PocketBase-side behaviour (index shapes, access rules) — this audit reads `pb_schema.json`, which is the field contract, not the running instance. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim:
Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · pb_schema.json verified to contain all 4 collections (license_keys, tenants, subscriptions, tenant_machines) + the listed fields (key, tier_key, status, expires_at, email, api_key, api_key_lookup, signed_payload, signature, grace_until, first_seen_at, last_seen_at); the "simplified authenticator" framing is consistent with the field subset vs ADR #9's fuller schema · NOTE (2026-08-14): tenants.api_key is now a bcrypt hash + tenants.api_key_lookup is the indexed SHA-256 lookup (see §2) · NOTE (2026-08-16): subscriptions now carries the tier quota block (max_stores, max_pos_instances, allowed_types) mirrored from license_keys (see §3) · NOTE (2026-08-17 → RESOLVED 2026-08-31 by docs-auditor): `plus` has landed — both `tier_key` selects (license_keys, subscriptions) now read free/plus/pro/premium/enterprise (TODO.md C0.2 done); §1 and §3 field rows updated accordingly. Re-audit also confirmed all newer fields present in pb_schema.json: is_trial, bundle_id, payment_provider, midtrans_sub_id, midtrans_order_id, paddle_sub_id, api_key_lookup
-->


# License Server Schema Documentation

This document describes the PocketBase collections and fields required for the kasir.mu License Server to function correctly. The four **core** collections (`license_keys`, `tenants`, `subscriptions`, `tenant_machines`) act as the authenticator and licence authority, delegating feature quotas to the client based on the assigned `tier_key`; six further collections back the trial, enterprise-approval and revenue-reporting surfaces.

The authoritative definition is [`pb_schema.json`](./pb_schema.json) — this document is the human-readable companion and is re-derived from it, not the other way round.

---

## 1. `license_keys`
Stores the license keys generated for customers. You create these manually in the Admin UI.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `key` | Text | **Mandatory** | The actual license string (e.g. `OZ-PRO-ABCD-EFGH`). Must be unique. |
| `tier_key` | Select | **Mandatory** | The subscription tier this key grants (`free`, `plus`, `pro`, `premium`, `enterprise`). |
| `status` | Select | **Mandatory** | Current state of the key (`unused`, `activated`, `expired`, `revoked`). |
| `expires_at` | Date | **Mandatory** | The baseline expiration date granted when this key is activated. |
| `activated_at` | Date | *Auto-filled* | Populated by the server upon first activation. |
| `activated_by` | Relation | *Auto-filled* | Links to the `tenants` record that activated the key. |
| `revoked_at` | Date | *Optional* | Set manually by admins to revoke a key. |
| `notes` | Text | *Optional* | Internal notes for staff. |
| `max_stores` | Number | *Optional* | Tier quota (0 = unlimited). Populated by the Paddle webhook. |
| `max_pos_instances` | Number | *Optional* | Tier quota (0 = unlimited). Populated by the Paddle webhook. |
| `allowed_types` | JSON | *Optional* | JSON array of allowed workspace types for the tier. |
| `paddle_sub_id` | Text | *Optional* | Paddle Billing `sub_...` id that issued the key. Set ⇒ webhook-issued (enables email+key activation and expiry sync on `subscription.updated`). Uniquely indexed (partial). |
| `midtrans_sub_id` | Text | *Optional* | Midtrans Subscription API subscription id this key belongs to (recurring charges share it). Set ⇒ Midtrans webhook-issued; enables expiry refresh on later charges. Uniquely indexed (partial). |
| `midtrans_order_id` | Text | *Optional* | Midtrans `order_id` of the most recent charge that minted/refreshed this key. Lookup key for charges that arrive before a `subscription_id` exists. |
| `payment_provider` | Select | `paddle` | Billing provider that issued the key: `paddle` (global, USD cards), `midtrans` (Indonesian QRIS/VA/e-wallet, fixed IDR) or `manual` (minted outside the webhook flow). Set by the issuing webhook; backfilled to `paddle` for pre-Midtrans keys. |
| `is_trial` | Bool | *Optional* | True for segmented-trial keys (C2.1). Activation mints a short Plus/Pro license from the request's `trial_vertical` (14-day Plus general, 14-day Pro restaurant/cafe, 30-day Pro enterprise referral) instead of the key's own tier/expiry/quota. Paid keys leave it unset. |
| `bundle_id` | Text | *Optional* | Vertical-bundle id (C3.2) this license was purchased with — `restaurant_starter` widens the Plus quota block with the `kds` workspace type. Set at webhook mint; renewals fall back to it when the charge notification carries no bundle. |
| `addons` | Text | *Optional* | Add-on entitlements attached to this key. |

---

## 2. `tenants`
Stores the business entities (customers) using the POS software. A record is created by the Paddle webhook at first purchase, or automatically upon their first license activation.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `email` | Email | **Mandatory** | Contact email address. |
| `phone` | Text | *Optional* | Contact phone number (Paddle customers may not provide one; the activation path defaults it to `-`). |
| `api_key` | Text | **Mandatory** | Bcrypt hash of the tenant API key — the plaintext is never stored. |
| `api_key_lookup` | Text | *Auto-filled* | Hex SHA-256 lookup hash of the `api_key` (hidden, uniquely indexed) used for O(1) tenant resolution. |
| `status` | Select | **Mandatory** | Account standing (`active`, `suspended`, `revoked`). |
| `email_verified` | Bool | *Auto-filled* | Whether the owner has proved control of the mailbox. `false` by migration default and for webhook-created rows; admin login never reads it (see `DEPLOY.md` §7.7.1). |
| `password_hash` | Text | *Optional* | Password credential for the web dashboard, when the account uses password sign-in rather than OTP/Google. |
| `password_reset_at` | Date | *Optional* | Timestamp of the last password reset. |
| `region` | Select | *Optional* | Deployment region for the tenant. Currently a single-value select (`global`). |

> [!NOTE]
> The `api_key` is stored **hashed** at rest. `api_key` holds a salted
> bcrypt hash (verification); `api_key_lookup` holds a deterministic
> hex SHA-256 of the key so `/renew` and `/status` can resolve the tenant
> in one indexed lookup (bcrypt is salted and therefore not indexable).
> The plaintext is only ever returned once, at mint time (or on a
> re-activation key rotation). Tenants created before hashing are
> upgraded lazily on their next successful authentication.

---

## 3. `subscriptions`
Stores the cryptographically signed subscription payload. This record is automatically generated and updated during activation or renewal calls, and by the Paddle webhook at purchase/subscription events.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `tenant_id` | Relation | **Mandatory** | Links back to the `tenants` collection. |
| `tier_key` | Select | **Mandatory** | The active tier (`free`, `plus`, `pro`, `premium`, `enterprise`). |
| `status` | Select | **Mandatory** | State of the subscription (`active`, `expired`, `grace_period`, `revoked`, `paused`). |
| `starts_at` | Date | **Mandatory** | Start date of the current subscription cycle. |
| `expires_at` | Date | **Mandatory** | Expiration date of the current subscription cycle. |
| `signed_payload`| Text | **Mandatory** | The JSON string signed by the RSA private key. |
| `signature` | Text | **Mandatory** | The base64 cryptographic signature verified by the POS client. |
| `grace_until` | Date | *Optional* | Secondary date allowing limited offline usage buffering if the POS cannot connect. |
| `paddle_sub_id` | Text | *Optional* | Paddle Billing `sub_...` id this record mirrors — the lookup key for `subscription.updated` / `canceled` events. Uniquely indexed (partial). |
| `midtrans_sub_id` | Text | *Optional* | Midtrans Subscription API subscription id this record mirrors — the lookup key for recurring-charge refreshes. Uniquely indexed (partial). |
| `midtrans_order_id` | Text | *Optional* | Midtrans `order_id` of the most recent charge that provisioned/refreshed this record. |
| `payment_provider` | Select | `paddle` | Billing provider that issued the record: `paddle` (global, USD cards), `midtrans` (Indonesian QRIS/VA/e-wallet, fixed IDR) or `manual`. Set by the issuing webhook; backfilled to `paddle` for pre-Midtrans records. |
| `max_stores` | Number | *Optional* | Tier quota (0 = unlimited). Persisted whenever a subscription record is created (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change; read back for `/status` and webhook re-signs. **Storage name — historical.** The 1g wire rename emits this value as `max_locations` on the signed payload and `/status` (with a legacy `max_stores` key alongside at the same value for pre-rename clients); only the wire changed, not this field. |
| `max_pos_instances` | Number | *Optional* | Tier quota (0 = unlimited). Persisted with the subscription record (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change. |
| `allowed_types` | JSON | *Optional* | JSON array of allowed workspace types for the tier. Persisted with the subscription record (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change. |
| `paused_at` | Date | *Optional* | Start of the current pause window (subscription pause/resume feature). |
| `paused_until` | Date | *Optional* | Scheduled end of the current pause window; unset means open-ended. |
| `bundle_id` | Text | *Optional* | Vertical-bundle id this record was provisioned with — mirrors the `license_keys` field of the same name. |
| `feature_grants` | JSON | *Optional* | Per-subscription feature-grant overrides, persisted alongside the signed payload. |

---

## 4. `tenant_machines`
Tracks which specific POS hardware devices have connected to a tenant's subscription. This is automatically managed by the activation API.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `tenant_id` | Relation | **Mandatory** | Links to the `tenants` collection. |
| `first_seen_at` | Date | *Auto-filled* | First time this machine connected to the activation endpoint. |
| `last_seen_at` | Date | *Auto-filled* | Most recent connection from this machine. |
| `machine_id` | Text | *Auto-filled* | The device's hardware/machine identifier, as presented at activation. |
| `revoked_at` | Date | *Optional* | Set when an admin deactivates this machine; a revoked machine no longer counts against the seat quota. |

---

## 5. `trial_registrations`

One row per device that has started a segmented trial, keyed by hardware fingerprint. Written by the trial-registration path.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `hardware_fingerprint` | Text | **Mandatory** | Stable device fingerprint; the uniqueness anchor for a trial device. |
| `first_seen_at` | Date | **Mandatory** | First time this device presented itself. |
| `trial_expires_at` | Date | **Mandatory** | When the device's trial window ends. |
| `platform` | Select | **Mandatory** | Client platform: `windows`, `android`, `linux`, `macos`, `unknown`. |
| `app_version` | Text | **Mandatory** | Client build that registered the trial. |
| `tenant_id` | Relation | *Optional* | The tenant this device was later bound to, if any. |
| `ip_address` | Text | *Optional* | Registration source address (abuse triage). |

---

## 6. `trial_claims`

The anti-abuse ledger for trial claims, so one identity cannot harvest trials across devices.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `claim_hash` | Text | **Mandatory** | Hashed claim identity (the correlation key). |
| `email` | Text | **Mandatory** | Claiming email address. |
| `device_id` | Text | **Mandatory** | Device that made the claim. |
| `tenant_id` | Relation | *Optional* | Tenant minted by the claim. |
| `claim_count` | Number | **Mandatory** | How many times this identity has claimed. |
| `first_claimed_at` | Date | **Mandatory** | First claim timestamp. |
| `last_claimed_at` | Date | **Mandatory** | Most recent claim timestamp. |
| `trial_keys` | Text | *Optional* | Trial keys issued to this identity. |

---

## 7. `trial_email_log`

Idempotency record for the scheduled trial-nurture emails — one row per (subscription, day offset) so a code resends nothing.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `subscription` | Text | **Mandatory** | Subscription the email concerns. |
| `day_offset` | Number | **Mandatory** | Days into the trial the mail belongs to. |
| `sent_at` | Date | **Mandatory** | When it was sent. |

---

## 8. `enterprise_approvals`

Codes that admit a prospect to the enterprise trial flow, issued by an admin.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `code` | Text | **Mandatory** | The approval code itself. |
| `email` | Text | *Optional* | Pre-bound recipient, when the code is issued to a named prospect. |
| `prospect_name` | Text | *Optional* | Prospect label for the admin dashboard. |
| `status` | Select | **Mandatory** | `unused`, `redeemed`, `expired`. |
| `created_by` | Text | *Optional* | Admin identity that issued it. |

---

## 9. `revenue_events`

The revenue ledger: one row per recognised billing event from either provider. **Amounts are stored as `number` fields here because PocketBase has no integer-minor-unit type; the Go server owns the conversion.** `amount_usd`/`amount_idr` are populated according to `currency`.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `tenant_id` | Relation | **Mandatory** | Tenant the event belongs to. |
| `event_id` | Text | **Mandatory** | Provider-side event identifier (idempotency key). |
| `provider` | Select | **Mandatory** | `paddle` or `midtrans`. |
| `amount_usd` | Number | *Optional* | Amount in USD, when `currency` is `USD`. |
| `amount_idr` | Number | *Optional* | Amount in IDR, when `currency` is `IDR`. |
| `currency` | Select | **Mandatory** | `USD` or `IDR`. |
| `tier_key` | Select | *Optional* | Tier purchased (`plus`, `pro`, `premium`, `enterprise`). |
| `subscription_id` | Text | *Optional* | Provider subscription id this event paid for. |
| `notes` | Text | *Optional* | Free-form operator note. |

---

## 10. `revenue_adjustments`

Reversals against a `revenue_events` row — refunds and chargebacks kept in their own ledger so recognised revenue stays append-only.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `event_id` | Text | **Mandatory** | The `revenue_events` row being adjusted. |
| `provider` | Select | **Mandatory** | `paddle` or `midtrans`. |
| `tenant_id` | Relation | *Optional* | Tenant the adjustment belongs to. |
| `kind` | Select | **Mandatory** | `refund`, `partial_refund`, `chargeback`. |
| `amount_usd` | Number | *Optional* | Adjustment amount in USD. |
| `amount_idr` | Number | *Optional* | Adjustment amount in IDR. |
| `currency` | Select | **Mandatory** | `USD` or `IDR`. |
| `notes` | Text | *Optional* | Free-form operator note. |

---

> [!NOTE]
> PocketBase automatically adds an `id`, `created`, and `updated` field to every collection. These internal fields do not need to be manually defined in your JSON schema.

> last audited 11-10-26 by docs-auditor
