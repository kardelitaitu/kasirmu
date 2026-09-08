# Security Audit: Admin Dashboard Login Flow

<!-- Audit stamp: 2026-09-09 . DSH . status: HISTORICAL-RECORD, annotated not rewritten .
Dated 2026-08-29 snapshot; body left verbatim (rule E). Re-verified against branch 0.0.37:
F2/F4/F6/F7/F8 still describe the code (admin.js:32-53 + admin-utils.js:1374; worker.ts:284-287;
web_otp.go:43-46 and :52-56; login_lockout.go:36-40, :82-90; admin_dashboard.go:87-94).
F5's parent-domain cookie is gone (worker.ts:111-113 writes Domain=${hostname}), F3's
script-src premise is gone (worker.ts:121-131), and F3's "not on the marketing site"
mitigation is now FALSE — /__oz/session is served on ozpos.my.id (worker.ts:724-738),
which widens rather than narrows the exposure. See the Currency block.
-->

**Date:** 2026-08-29  
**Scope:** `admin.ozpos.my.id` login flow — from the auth gate in the worker through the login page and license server auth endpoints to the admin dashboard SPA.

## Architecture recap

```
Browser → admin.ozpos.my.id
  (no cookie) → worker serves /admin/login.html (dedicated admin login page)
  (cookie)    → worker serves /admin/index.html (admin SPA)
                  ├── SPA → /__oz/session → JWT → /api/v1/admin/* (Bearer)
                  └── worker auth gate: checks httpOnly oz_session cookie
                       → redirects to login page when missing
```

## Audit findings

### F1 (HIGH) — Token in URL query string

**Risk:** The login flow passes the session token as a URL query parameter (`/?token=<jwt>`). The worker then redirects to a clean URL, but the token-bearing URL briefly exists in:

1. **Browser history** — the initial `/?token=<jwt>` URL is stored in history before the 302 replaces it
2. **Access logs** — Cloudflare edge logs, potential CDN logs, server logs
3. **Referer headers** — the 302 redirect's Referer to the clean URL carries the full token URL

**Current mitigations:**
- Worker immediately 302 redirects to clean URL (token removed from address bar)
- `Referrer-Policy: strict-origin-when-cross-origin` — cross-origin requests send only origin (no path/query), so the token doesn't leak to external resources (Paddle, Midtrans, fonts)
- The 302 now has `Cache-Control: no-store` + `Referrer-Policy: no-referrer` (fixed in this audit)

**Residual risk:** LOW per-session, but the token is the full session — a one-time capture is enough.

**Recommendation:** ✅ Acceptable for now with the no-store fix. For a future hardening pass, replace the `?token=` query param with a one-time exchange code (license server issues a short-lived code, worker exchanges it for a session cookie). This eliminates the URL from ever carrying the real JWT.

### F2 (HIGH) — Admin SPA silently falls back to MOCK data on 401/403

**Risk:** The admin SPA's `api()` function returned `null` on 401/403, and `renderDashboard` treated `null` as "stats endpoint not available" → fell back to the **MOCK data** object. This means:

1. An **expired session** → 401 from `/api/v1/admin/stats` → the SPA shows fabricated MOCK data (total users 1,247, subscription stats, etc.) instead of notifying the user that their session expired
2. A **non-admin tenant** who logs in via the admin login page (same tenant auth) → 403 from admin API → the SPA also shows MOCK data

This is misleading — the operator could see fake numbers and think they're real.

**Current state:** ✅ FIXED — the `api()` function now renders an "Access denied" page with a sign-in link when either 401 or 403 is returned. The `renderDashboard` function no longer degrades to MOCK on auth failure.

### F3 (MEDIUM) — `/__oz/session` exposes JWT to page JS

**Risk:** The worker's `/__oz/session` endpoint (same-origin, no auth on the endpoint itself) returns the JWT from the httpOnly cookie to any JavaScript running on the dashboard/admin hostname. This is necessary for the SPA to authenticate to the license API (Bearer token). However:

- **Any XSS** on `admin.ozpos.my.id` or `dashboard.ozpos.my.id` can call `/__oz/session` and steal the session token
- The site's CSP includes `'unsafe-inline'` for script-src (required by the marketing site's theme-toggle inline script and the admin SPA's inline JS), reducing XSS protection

**Current mitigations:**
- The endpoint is only available on `DASHBOARD_HOSTS` (`dashboard.ozpos.my.id`, `admin.ozpos.my.id`) — not on the marketing site
- The cookie is HttpOnly (not readable by JS directly) — the endpoint is the only way to get the token
- `SameSite=Lax` prevents cross-site usage

**Recommendation:** 
- Inline scripts in the admin SPA should be kept minimal — the admin/login.html already has one inline `<script>` block. Hardening: keep the admin SPA as a single static HTML file with unchanged inline JS, and consider adding a separate CSP header for the admin subdomains that's more restrictive.
- Long-term: the admin SPA could be served from a separate Worker with a stricter CSP that doesn't need `'unsafe-inline'` (by using external JS). This is a significant architectural change.

### F4 (MEDIUM) — No `Cache-Control: no-store` on token-bearing 302

**Risk:** The worker's 302 redirect that carries the `?token=` query param had no `Cache-Control: no-store` header. While 302 responses are rarely cached, a CDN or browser could cache the redirect response, which would associate the token-bearing URL with a cached redirect.

**Current state:** ✅ FIXED — the 302 response now includes `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` + `Referrer-Policy: no-referrer` + `Pragma: no-cache`.

### F5 (LOW) — Cookie Domain shared across all subdomains

**Risk:** The `oz_session` cookie is set with `Domain=.ozpos.my.id`, which means it's sent to ALL subdomains of ozpos.my.id, including the marketing site. If any ozpos subdomain is compromised, the cookie would be sent on requests from that subdomain. However, the cookie is HttpOnly (not readable by JS on the marketing site), and the marketing site is a static Astro site with no authenticated endpoints.

**Recommendation:** ✅ Acceptable. The marketing site is static and has no JS that reads the cookie. A future improvement could set the cookie on a dedicated auth domain (e.g., `auth.ozpos.my.id`) and have the worker set it per-subdomain, but this would break the cross-subdomain session sharing that the dashboard and admin subdomains need.

### F6 (LOW) — 24-hour session TTL

**Risk:** The web session token (validated server-side) has a TTL of 24 hours (`defaultWebSessionTTL`). The httpOnly cookie has a 30-day Max-Age. This means a session token can be used for up to 24 hours after login, even if the user hasn't visited the dashboard. For an admin panel, this is long but not unreasonable.

**Recommendation:** Consider reducing the session TTL for the admin specifically (e.g., 8 hours), or add a "session active" background check that refreshes the session. This is a policy decision, not a vulnerability.

### F7 (INFO) — In-memory sessions (not persisted)

**Risk:** The web session store (`webOtpStore`) is in-memory only. A server restart invalidates all sessions. This is by design (short-lived), but means a license server deployment invalidates all admin sessions.

**Recommendation:** ✅ Acceptable. Documented in the code as intentional. The session TTL is 24h, so restarts are expected to be infrequent.

### F8 (INFO) — OTP auto-signup on admin login page

**Risk:** The `POST /api/v1/web/request-otp` endpoint auto-creates a tenant for any email address (self-signup). The admin login page uses this endpoint, meaning anyone can request an OTP for any email (including yours) and a tenant will be created. This is by design for the self-serve signup flow, but the admin login page exposes it.

**Current mitigations:**
- Rate limited: 3 requests per email per 15 minutes, 10 per IP per 15 minutes
- Escalating lockout added: 5s gap, +30s after 3rd failure, cap 15 min
- The OTP is sent to the email address via SMTP (Brevo) — the attacker never sees the code
- The admin SPA returns 403 to any tenant whose email != OZ_ADMIN_EMAIL

**Recommendation:** ✅ Acceptable. The rate limits + OTP email delivery make practical exploitation ineffective.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | HIGH | Token in URL query string | ✅ Mitigated (no-store + referrer-policy) |
| F2 | HIGH | Admin SPA shows MOCK on 401/403 | ✅ FIXED |
| F3 | MEDIUM | `/__oz/session` exposes JWT to page JS | ⚠️ Architecture-driven; accept |
| F4 | MEDIUM | No Cache-Control on token 302 | ✅ FIXED |
| F5 | LOW | Domain=.ozpos.my.id shared cookie | ✅ Accept |
| F6 | LOW | 24h session TTL | ✅ Accept (policy) |
| F7 | INFO | In-memory sessions | ✅ Accept (by design) |
| F8 | INFO | OTP auto-signup on admin login | ✅ Accept (rate limited) |

## Recommendations for future hardening

1. **(Architecture)** Replace `?token=` query param with a one-time exchange code — the license server issues a short-lived (30s) exchange code, the worker POSTs it to the license server to get the real JWT, eliminating the token from URLs entirely.
2. **(CSP)** Separate the admin/dashboard subdomains' CSP from the marketing site's CSP — the admin SPA could have a stricter CSP (no `'unsafe-inline'`) by extracting the inline JS to an external file.
3. **(Session)** Add server-side session refresh — the `/__oz/session` could refresh the session TTL on each call, keeping active sessions alive without requiring re-login.

---

## Currency (re-checked 2026-09-09 against branch 0.0.37 — annotation only; the record above is unchanged)

Nothing here is downgraded. Two findings lost the mitigation the summary credited them with, and one lost its subject entirely.

- **F1's subject is gone.** The `?token=` handoff this audit described was deleted the next day: commit `dbd3106ae` "fix(security): remove deprecated ?token= fallback (M3 / Phase 3 item 12)". `grep -E '\?token=|"token="' website/ scripts/ apps/` returns nothing, and `website/worker.ts:13-16` now documents only the `?code=` exchange. F1's "✅ Mitigated" is therefore understated — the residual risk it accepted no longer exists. Recommendation 1 below (one-time exchange code, 30 s) is exactly what shipped: `exchangeTTL = 30 * time.Second` at `apps/license-server/web_exchange.go:34`, registered at `apps/license-server/main.go:294-295`.
- **F4's headers survive, on a different response.** The `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` + `Referrer-Policy: no-referrer` + `Pragma` set it credits is still shipped on the exchange 302 (`website/worker.ts:284-287`), the logout 302 (`:625-627`) and the portal 302 (`:706-709`) — but the token-bearing 302 it was written about is the one F1 lost.
- **F5's premise is false today, in both directions.** `Domain=.ozpos.my.id` is gone: `setCookieHeader()` emits `Domain=${domain}` (`website/worker.ts:111-113`) and both call sites pass the request hostname (`:283`, `:705`), so a session minted on `admin.ozpos.my.id` is scoped to that host. It is **not** true that the parent domain is never used: the account-portal handoff runs on `ozpos.my.id` itself, so its cookie is written as `Domain=ozpos.my.id` (`:705`) and is sent to every subdomain. Re-measure: `grep -n 'Domain=' website/worker.ts`.
- **F3 is now wider, not narrower.** Its mitigation bullet — "only available on `DASHBOARD_HOSTS` … not on the marketing site" — no longer holds: `DASHBOARD_HOSTS` is down to `admin.ozpos.my.id` alone (`website/worker.ts:72`) while `/__oz/session` is *also* served on the marketing host (`:724-738`) so the account portal can read its own cookie back. The second bullet, "CSP includes `'unsafe-inline'` for `script-src`", is also gone for these pages: `script-src 'self' https://static.cloudflareinsights.com` with the change recorded at `website/worker.ts:121-131`; `style-src` still carries `'unsafe-inline'` (`:131"). So the one reason the doc gave for accepting F3 architecturally has been removed, and the endpoint's blast radius grew. Do not read "accept" as re-confirmed.
- **F6 is a default now, not a constant.** `defaultWebSessionTTL` = 24 h stands (`apps/license-server/web_otp.go:43-46`) and the 30-day cookie Max-Age stands (`website/worker.ts:283`), but the TTL is overridable via `OZ_WEB_SESSION_TTL` (`web_otp.go:310-322`, documented at `.env.example:96` and `docs/operations/runbook.md:440`). Recommendation 3 below is implemented server-side — `touchSession()` (`web_otp.go:127-133), called from `web_dashboard.go:49` and `web_exchange.go:145` — but not on `/__oz/session`, which never reaches the license server.
- **F7 is narrower than it reads.** Sessions are still memory-only (`web_otp.go:13-19`, `:75-85), so "resets on restart" holds for them; the *lockout* counters no longer reset — they persist to SQLite table `rate_limit_login_lockouts` (`apps/license-server/login_lockout.go:20`, `:216`).
- **F8 stands in full, with one open follow-on.** Window 15 min, 3/email, 10/IP: `web_otp.go:52-56`. Escalating lockout 5 s → +30 s → 15 min cap: `login_lockout.go:36-40` with the formula at `:82-90`. The 403 for a non-admin tenant email: `admin_dashboard.go:87-94`. Still unfixed, and discovered only later: `login_lockout.go:203`, `:218` and `:319` log `key=%q`, and that key is `"email:"+email` (`:384-386`) — the customer's address goes to the server log. Re-measure with `go -C apps/license-server test -short ./...` plus `grep -n 'key=%q' apps/license-server/login_lockout.go`.

> last audited 09-09-26 by docs-auditor
