# kasir.mu 0.0.31

Released 2026-08-28.

kasir.mu 0.0.31 is a major infrastructure and security release focused on eliminating legacy settings duplication, introducing the website admin + user dashboard subdomains, completing the security audit remediation (H-1/H-2/H-5/H-6/C-1/C-2), and hardening the KDS runtime.

## Highlights

### Settings consolidation — legacy hub deleted

The old settings hub (route `settings` / `SettingsPage.tsx`) hosted 23 tabs — 12 management screens (staff, audit, terminals, stores, shifts, tax, exchange, promotions, offline, features, data, kds) AND 11 genuine configuration tabs. This caused the "two settings" confusion where clicking "Staff Management" opened the settings hub on a management tab, not the standalone page.

- **12 management tabs removed** from the settings hub — each already has its own standalone route with a dedicated page. The `#/settings/<tab>` deep-link pattern is now whitelisted: only the 11 kept tabs (general, appearance, receipt, sync, email, about, license, topology, store-pos, restaurant-pos, inventory) respond to hash-based navigation.
- **`management` sidebar section deleted** — the 8 items (staff, audit, terminals, stores, shifts, offline, features, data) were re-homed. First to `settings` (interim), then to a new `tools` sidebar section that separates tools from configuration.
- **New `tools` sidebar section** — 8 management tools now live under a "Tools" section in the sidebar, distinct from the "Settings" section which contains only the configuration hub .
- **SettingsNavTree categories** — Management category removed; topology folded into System. Settings hub has 3 categories: Business (2), Operations (6), System (3).
- **Home "Tools" area expanded** — 10 missing tools added to the home screen tile grid (terminals, stores, shifts, tax-config, exchange-rates, promotions, offline-queue, features, data-management, kds). Each tool is role-gated (`minRole`) and optionally subscription-tier-gated (`cap` field) via `useSubscription().caps`.
- **Orphaned FTL keys cleaned** — 12 `settings-nav-*` keys, `nav-section-management`, `settings-category-management` removed from both EN and ID bundles.

### Website admin & user dashboard (ADR #42)

Two new subdomains with auth-gated, full-featured dashboards:

**Infrastructure:**
- `dashboard.ozpos.my.id` and `admin.ozpos.my.id` provisioned via Cloudflare API (AAAA proxied records + Worker routes, A-record CNAME migration for proper routing).
- Cloudflare Worker (`worker.ts`) implements hostname-based routing: `ozpos.my.id` → marketing site (unchanged), `dashboard.ozpos.my.id` / `admin.ozpos.my.id` → auth-gated SPAs.
- Auth gate: httpOnly `oz_session` cookie (30-day expiry, `Domain=.ozpos.my.id`). No cookie → 302 redirect to `https://ozpos.my.id/login?redirect=...`. `?token=` query param sets the cookie and redirects to clean URL. `run_worker_first = true` ensures the Worker runs before the ASSETS edge cache.
- `/__oz/session` endpoint (same-origin) returns the JWT from the cookie so the SPA can authenticate to the license API with a Bearer header.
- Login flow: `AuthForm.tsx` recognizes `?redirect=` to dashboard subdomains and passes the JWT as `?token=`.

**License server API (PocketBase Go):**
- `web_dashboard.go`: `GET /api/v1/web/usage` (device/subscription counts + entitlement limits), `GET /api/v1/web/devices` (tenant machines) — session-authed like `/me`.
- `admin_dashboard.go`: `GET /api/v1/admin/tenants` (list), `/tenants/{id}` (detail + devices), `POST /tenants/{id}/activate`, `/renew` (+N days), `/revoke`, `/tier-override` (with reason), `GET /api/v1/admin/health`. Auth: `OZ_ADMIN_KEY` bearer OR a web session of the admin tenant (`OZ_ADMIN_EMAIL`, default `adikaradwiatmaja@gmail.com`).
- CORS allowlist default includes `dashboard.ozpos.my.id` and `admin.ozpos.my.id`.
- 6 tests covering usage, devices, admin list/auth, renew, tier-override.

**Dashboard SPAs:**
- User dashboard (`website/public/dashboard/index.html`): account, license key (copy-to-clipboard), subscription, usage stat cards (devices/subscriptions/max stores/max POS), devices table.
- Admin panel (`website/public/admin/index.html`): tenant list, drill-down modal, activate/renew (+365d)/revoke/tier-upgrade actions with audit reason, system health tab.
- Both SPAs authenticate via `/__oz/session` and call the license API with Bearer tokens.

### Admin password rotation reminder

- `password_rotation.go`: `OnRecordAfterUpdateSuccess("_superusers")` hook detects password hash changes by diffing against a stored snapshot in `password_rotation_state` collection (PB has no `OldRecord` in the event).
- Daily scheduler (`startPasswordRotationScheduler`) at 08:00 UTC sends a reminder email to the superuser when the password is >= 120 days old, repeating every 30 days until changed (idempotent via `last_reminder_at`).
- Configurable via `OZ_ADMIN_EMAIL` (default `adikaradwiatmaja@gmail.com`) and shared `OZ_SMTP_*` (Brevo) relay.
- 5 tests covering seed, scanner, 30-day interval, and email content.

### Security audit remediation (H-1/H-2/H-5/H-6/C-1/C-2)

- **H-1/H-2 (unscoped IPC commands):** 77 deprecated unscoped commands unregistered across both desktop and tablet clients. 116+ scoped command variants added (hardware, products, offline, kiosk, settings, sync, EDC). Scoped coverage gate added to prevent regression.
- **H-5 (secrets at rest):** `oz-crypto` crate extracted with domain-separated `encrypt/decrypt` functions. LAN PSK encrypted accessor added. Transparent secret encryption at rest for all stored keys.
- **H-6 (free-form URL params):** Removed from sync commands.
- **C-1 (export/import gating):** Export/import commands gated behind session + permission check, paths contained.
- **C-2 (secret key redaction):** Raw `get_setting` IPC redacts secret keys.
- **H-3 (picker-ticket verification):** `create_session` requires picker-ticket verification.
- **H-4 (EDC command gating):** Payment (EDC) commands gated behind session + permission.

### KDS runtime hardening

- KDS footer sticks to bottom on Open tab, reduced top bar clutter (title + order count badge removed, back button alignment).
- Filter pill keyboard sync and a11y improvements.
- Card Colours pickers activated in hamburger settings (un-guarded).
- Dead CSS classes (`kds-title`, `kds-order-count`) cleaned up.

## Quality and delivery

- 400 UI test files, 7068+ tests pass (25 skipped).
- License server: 83-second full suite passes.
- 14 website worker tests pass.
- `npm run typecheck` clean (0 errors).
- `npm run lint`: 0 errors, 23 warnings (pre-existing).
- Pre-commit gates (cargo fmt, i18n lint, bundle parity, FTL dedupe) pass.
- 40 legacy docs archived to `docs/archived/`.
- 4 agents (AGENTS.md) updated: chunk-size recommendation 100 → 500 lines.