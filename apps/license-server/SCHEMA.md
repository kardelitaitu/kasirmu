<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · pb_schema.json verified to contain all 4 collections (license_keys, tenants, subscriptions, tenant_machines) + the listed fields (key, tier_key, status, expires_at, email, api_key, api_key_lookup, signed_payload, signature, grace_until, first_seen_at, last_seen_at); the "simplified authenticator" framing is consistent with the field subset vs ADR #9's fuller schema · NOTE (2026-08-14): tenants.api_key is now a bcrypt hash + tenants.api_key_lookup is the indexed SHA-256 lookup (see §2) · NOTE (2026-08-16): subscriptions now carries the tier quota block (max_stores, max_pos_instances, allowed_types) mirrored from license_keys (see §3) · NOTE (2026-08-17 → RESOLVED 2026-08-31 by docs-auditor): `plus` has landed — both `tier_key` selects (license_keys, subscriptions) now read free/plus/pro/premium/enterprise (TODO.md C0.2 done); §1 and §3 field rows updated accordingly. Re-audit also confirmed all newer fields present in pb_schema.json: is_trial, bundle_id, payment_provider, midtrans_sub_id, midtrans_order_id, paddle_sub_id, api_key_lookup -->

# License Server Schema Documentation

This document describes the PocketBase collections and fields required for the OZ-POS License Server to function correctly. The schema has been simplified to act purely as an authenticator, delegating feature quotas to the client based on the assigned `tier_key`.

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
| `payment_provider` | Select | `paddle` | Billing provider that issued the key: `paddle` (global, USD cards) or `midtrans` (Indonesian QRIS/VA/e-wallet, fixed IDR). Set by the issuing webhook; backfilled to `paddle` for pre-Midtrans keys. |
| `is_trial` | Bool | *Optional* | True for segmented-trial keys (C2.1). Activation mints a short Plus/Pro license from the request's `trial_vertical` (14-day Plus general, 14-day Pro restaurant/cafe, 30-day Pro enterprise referral) instead of the key's own tier/expiry/quota. Paid keys leave it unset. |
| `bundle_id` | Text | *Optional* | Vertical-bundle id (C3.2) this license was purchased with — `restaurant_starter` widens the Plus quota block with the `kds` workspace type. Set at webhook mint; renewals fall back to it when the charge notification carries no bundle. |

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
| `status` | Select | **Mandatory** | State of the subscription (`active`, `expired`, `grace_period`, `revoked`). |
| `starts_at` | Date | **Mandatory** | Start date of the current subscription cycle. |
| `expires_at` | Date | **Mandatory** | Expiration date of the current subscription cycle. |
| `signed_payload`| Text | **Mandatory** | The JSON string signed by the RSA private key. |
| `signature` | Text | **Mandatory** | The base64 cryptographic signature verified by the POS client. |
| `grace_until` | Date | *Optional* | Secondary date allowing limited offline usage buffering if the POS cannot connect. |
| `paddle_sub_id` | Text | *Optional* | Paddle Billing `sub_...` id this record mirrors — the lookup key for `subscription.updated` / `canceled` events. Uniquely indexed (partial). |
| `midtrans_sub_id` | Text | *Optional* | Midtrans Subscription API subscription id this record mirrors — the lookup key for recurring-charge refreshes. Uniquely indexed (partial). |
| `midtrans_order_id` | Text | *Optional* | Midtrans `order_id` of the most recent charge that provisioned/refreshed this record. |
| `payment_provider` | Select | `paddle` | Billing provider that issued the record: `paddle` (global, USD cards) or `midtrans` (Indonesian QRIS/VA/e-wallet, fixed IDR). Set by the issuing webhook; backfilled to `paddle` for pre-Midtrans records. |
| `max_stores` | Number | *Optional* | Tier quota (0 = unlimited). Persisted whenever a subscription record is created (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change; read back for `/status` and webhook re-signs. **Storage name — historical.** The 1g wire rename emits this value as `max_locations` on the signed payload and `/status` (with a legacy `max_stores` key alongside at the same value for pre-rename clients); only the wire changed, not this field. |
| `max_pos_instances` | Number | *Optional* | Tier quota (0 = unlimited). Persisted with the subscription record (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change. |
| `allowed_types` | JSON | *Optional* | JSON array of allowed workspace types for the tier. Persisted with the subscription record (Paddle provisioning, manual activation, renew) and refreshed on Paddle tier change. |

---

## 4. `tenant_machines`
Tracks which specific POS hardware devices have connected to a tenant's subscription. This is automatically managed by the activation API.

| Field Name | Type | Requirement | Description |
|---|---|---|---|
| `tenant_id` | Relation | **Mandatory** | Links to the `tenants` collection. |
| `first_seen_at` | Date | *Auto-filled* | First time this machine connected to the activation endpoint. |
| `last_seen_at` | Date | *Auto-filled* | Most recent connection from this machine. |

> [!NOTE]
> PocketBase automatically adds an `id`, `created`, and `updated` field to every collection. These internal fields do not need to be manually defined in your JSON schema.

> last audited 22-07-26 by Hermes-Agent
