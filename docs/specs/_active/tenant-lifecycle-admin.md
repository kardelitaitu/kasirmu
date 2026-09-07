<!-- Spec: tenant lifecycle management (admin API + UI) · 2026-08-31 · status: SHIPPED (server + UI, 2026-08-31) · owner: Coding Agent 4 · grounded in apps/license-server/admin_dashboard.go @ 0.0.34, paddle_webhook.go upsert, web_dashboard.go device revoke -->

# Tenant Lifecycle Management — Admin API + UI

> **Status: SHIPPED.** Server endpoints + admin UI live; end-to-end verified
> 22/22 (boot gates, migrations on fresh volume, PATCH/409/no-op, grant with
> real signing + grace, device revoke idempotency, cascade delete row-level).
> Website deployed (2026-08-31) behind a server-version capability gate
> (`/admin/health` ≥ 0.0.34), re-probed on every detail-dialog open.
> Remaining: user-run Northflank redeploy, then production smoke.

## Problem

The admin dashboard can only flip tenant status (`activate`/`revoke`), extend days
(`renew`), and change tier (`tier-override`, silent no-op without a subscription).
Five operations an operator needs are impossible without direct DB access:

1. Fix a wrong **email/phone** (typos made at registration)
2. **Revoke one device** (stolen/retired POS instance) — tenants can do this
   themselves via `/api/v1/web/devices/{id}/revoke` but the admin cannot
3. **Delete a tenant** (test accounts, GDPR-style removal) — no path at all
4. **Grant a subscription manually** — transfer/e-wallet customers who paid
   outside Paddle/Midtrans currently have no subscription record, so renew and
   tier-override both dead-end
5. **Set an exact expiry date** — renew is days-only, so "align all tenants to
   the 1st" requires arithmetic and is wrong for already-expired subs

## Ground truth (verified in code)

| Fact | Where |
|---|---|
| Admin middleware `adminAuth` (Bearer `OZ_ADMIN_KEY` or admin web session) | `admin_dashboard.go:62` |
| `tenants` fields: email (EmailField), phone, api_key, status(active/suspended/revoked), email_verified, created | `handler_test.go:54` mirrors production schema |
| `subscriptions` requires `signed_payload` + `signature`; status values include active/expired/grace_period/revoked/paused; relation `tenant_id` set as `[]string` | `handler_test.go:100` |
| Subscription creation + signing template: build `SubscriptionPayload`, `signSubscription`, set quotas via `tierQuotas(tier, bundle)`, grace via `calculateGraceUntil(expiresAt)` | `paddle_webhook.go:942-996` |
| Device revoke (idempotent, sets `revoked_at`, ownership check) | `web_dashboard.go:178-217` |
| `license_keys.activated_by` relation → tenants (MaxSelect 1, not required) | `handler_test.go:82` |
| `otpStore.sessions[tokenHash] → webSession{tenantID}`; `deleteSession(hash)` exists, no by-tenant sweep | `web_otp.go:123-151` |
| B29 renew anchor: `max(now, expires_at)` + days | `admin_dashboard.go:268-277` |
| `adminDashboardVersion = "0.0.33"` (stale vs 0.0.34 lock) | `admin_dashboard.go:38` |

## New endpoints (all behind `adminAuth`; all additive)

### 1. `PATCH /api/v1/admin/tenants/{id}` — edit contact
Body: `{"email": "...", "phone": "..."}` (either may be omitted).
- Email: `normalizeEmail`, must parse as email (PocketBase EmailField enforces on save too), uniqueness check first → `409 {"error": "email already in use"}` on collision.
- Phone: trim, store verbatim (validation stays client-side lenient).
- Refuse changing the admin tenant's email (would break `adminAuth` mapping) → `400`.
- Response: same shape as `GET /tenants/{id}` detail.

### 2. `POST /api/v1/admin/tenants/{id}/devices/{deviceId}/revoke`
Mirror of `handleWebRevokeDevice` with `adminAuth` instead of session auth.
- 404 when device missing **or** `tenant_id` mismatch (no existence leak).
- Idempotent: already-revoked → `200 {"status":"revoked","revoked_at":existing}`.
- Sets `revoked_at` = now UTC. `/status` already honors it (status.go:106).

### 3. `POST /api/v1/admin/tenants/{id}/renew` — extended (backward compatible)
Body gains optional `"expires_at": "YYYY-MM-DD"`. Rules:
- Both `days` and `expires_at` → `400`; neither → `days` defaults 365 (unchanged).
- Date is **inclusive**: stored as `23:59:59Z` of that date (operator intent: "paid through Aug 1").
- Must be in the future → `400 {"error": "expires_at must be in the future"}`.
- **Re-signs** the subscription with the new expiry (payload must match the row or offline POS trust breaks) — same `signSubscription` path as B29.
- No subscription → 404 (unchanged).

### 4. `POST /api/v1/admin/tenants/{id}/grant-subscription`
Body: `{"tier_key": "pro", "months": 12 | "expires_at": "YYYY-MM-DD", "reason": "transfer payment #123"}`.
- Exactly one of `months`/`expires_at`; neither → months=12. `reason` required (audit).
- Tier validated against `TierPriceUSD` → `400` on unknown.
- If the latest subscription is `active` → `409 {"error": "active subscription exists; use renew or tier-override"}` (expired/grace/revoked/paused/none → create).
- Creates via the webhook template: quotas from `tierQuotas(tier, "")`, `status=active`, `starts_at=now`, `expires_at` = now+months or the date, `grace_until=calculateGraceUntil`, `payment_provider="manual"`, `paddle_sub_id=""`, signed payload + signature.
- Also flips the tenant status to `active` (a paid tenant should not stay `revoked`).
- Response: `{"status":"active","expires_at":...,"tier_key":...}`.

### 5. `DELETE /api/v1/admin/tenants/{id}` — guarded cascade
Body: `{"confirm_email": "..."}` — must equal the tenant email (case-insensitive), else `400`.
- Refuse deleting the admin tenant (`OZ_ADMIN_EMAIL` match) → `403`.
- Cascade order: `tenant_machines` (delete rows) → `subscriptions` (delete rows) → `license_keys.activated_by == tenant` (clear the relation, **keep the key records** — financial audit trail) → drop all web sessions for the tenant (new `deleteSessionsForTenant` helper on `otpStore`) → delete the tenant record.
- Response: `{"deleted": true, "machines": N, "subscriptions": N, "keys_unlinked": N}` + server log with reason context.
- PocketBase relation deletes would otherwise orphan: this is the reason for explicit ordering.

### 6. Version honesty
`adminDashboardVersion` `0.0.33` → `0.0.34` (repo lock), test pin updated.

## Admin UI (website/public/admin)

> Shipped in `2026-08-31` (+ per-open version re-probe). The gate also keeps the
> deploy-order guarantee: nothing new is offered until the server reports
> 0.0.34, so an early website deploy is safe.

- **Detail modal — Devices section** (shipped): machine_id (mono), last seen via `relTime`, "Revoked" badge for revoked devices; per-device Revoke is single-click (busyWrap single-flight) — device revoke is idempotent server-side, so no email gate — then re-opens the detail dialog fresh.
- **Detail modal — Edit contact** (shipped): email + phone fields with Save → `PATCH`; on 409 an inline "email already in use" hint; no-op save just closes.
- **Renew dialog** (shipped): quick "+365d" button **or** an exact-date input + "Set exact date" (server validates future + inclusive 23:59:59Z; no client-side min). No-subscription guard unchanged (disabled button + tip pointing at Grant).
- **Grant subscription** (shipped): when no subscription exists, the disabled Renew is joined by "Grant subscription" → dialog (tier select, months number default 12, or exact date, required reason input; reason-missing blocks client-side).
- **Delete tenant** (shipped): full-width `btn-bad` at the modal foot → confirm modal reusing the revokeConfirmModal email-gate pattern with `opts` (custom title/hint/confirm label + cascade warning line: devices + subscriptions removed, license keys unlinked but preserved).
- **Version gate** (shipped): every Phase-4 control renders only when `/admin/health` reports ≥ 0.0.34; boot probe + re-probe on each detail-dialog open, so a panel left open across the server redeploy heals without a page reload.
- All strings via `STRINGS`; flash on success; list refresh after mutations (now cheap thanks to tab caching).

## Tests (Go, `admin_lifecycle_test.go` + `admin_dashboard_test.go`)

Shipped and green: edit (both/409/admin-email/400/401/403), device revoke
(set/idempotent/404), renew (exact-date re-sign `2027-03-15T23:59:59Z`, days
anchor, 400s, 404), grant (manual provider, quotas, status flip, plus-no-kds,
default 12mo, rejections), delete (cascade + guards), parser tests, version
pin 0.0.34. **Beyond the suite:** fresh-volume boot E2E of the HEAD binary —
22/22 including signature storage, grace recalc, and row-level cascade proof.

## Deployment order

Superseded by the version gate: the website shipped first (`2026-08-31`) and is
safe against the old API — all new controls stay hidden until the server
reports 0.0.34. Remaining steps:

1. **You:** push (explicit order required) → **Northflank Redeploy** (dashboard).
2. **Then verify:** `/api/v1/admin/health` reports `0.0.34` (the admin UI
   health card shows it), the detail dialog self-heals the new controls on its
   next open, and a production smoke of one grant + one device revoke.

## Out of scope (later)

- Bulk operations, tenant create (registration flow already exists), audit-log UI, subscription pause/resume from admin (endpoints exist tenant-side).
