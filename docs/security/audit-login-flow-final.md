# Login Flow Audit — Admin + User Dashboard (Final Pass)

<!-- Audit stamp: 2026-09-09 . DSH . status: HISTORICAL-RECORD, annotated not rewritten .
Dated 2026-08-30 snapshot; body left verbatim (rule E). Checks 1, 4, 5, 6, 8, 10, 12, 13 and 15
were re-verified against branch 0.0.37 (website/worker.ts:130, :138, :313-319, :618, :730-737;
apps/license-server/main.go:274-295; web_exchange.go:137-192, exchangeTTL :34;
web_otp.go:127-133; login_lockout.go:36-40). Checks 2, 9, 11 and 14 and both F1/F2 entries
describe dashboard.ozpos.my.id and dashboard.js, which were retired the SAME DAY
(ae8778c75 + dece04fdc, 2026-08-30); the ?token= row in "Residual Notes" was removed by
dbd3106ae. Every correction, with citations and re-measure commands, is in the Currency block.
-->

**Date:** 2026-08-30  
**Scope:** `admin.ozpos.my.id` + `dashboard.ozpos.my.id` login flows end-to-end  
**Verified:** live endpoints, worker routing, license-server auth, CSP, cookie handling

---

## 1. Flow Summary (both subdomains)

```
Visit admin.ozpos.my.id / dashboard.ozpos.my.id (no cookie)
  → Worker serves dedicated login page (same subdomain)
  → User enters email → OTP (or password)
  → login.js POSTs to /api/v1/web/* (relative → Worker proxy → license server)
  → On success: POST /api/v1/web/exchange-issue (Bearer) → one-time code
  → Redirect to /?code=<code> → Worker POSTs /exchange-consume → real JWT
  → Worker sets httpOnly oz_session cookie → redirect to clean URL
  → SPA loads → /__oz/session → Bearer → /api/v1/admin/* or /api/v1/web/*
Log out → /__oz/logout → cookie expired (Max-Age=0) → 302 to same subdomain login
```

---

## 2. Verified Checks

| # | Check | Result |
|---|-------|--------|
| 1 | Admin login page served on `admin.ozpos.my.id` (no cookie) | ✅ 200 |
| 2 | User login page served on `dashboard.ozpos.my.id` (no cookie) | ✅ 200 |
| 3 | Both login pages use **relative API** (`API=''` → Worker proxy) | ✅ |
| 4 | No inline `onclick`/event handlers in either login page (strict CSP) | ✅ |
| 5 | Login endpoints through proxy: `/login`, `/request-otp`, `/verify-otp` | ✅ 401/200/processed |
| 6 | Exchange endpoints: `/exchange-issue` (401 no auth), `/exchange-consume` (400 bad code) | ✅ |
| 7 | Session cookie: HttpOnly + Secure + SameSite=Lax + Domain=subdomain-scoped (H4 — admin.ozpos.my.id / dashboard.ozpos.my.id, not the parent `.ozpos.my.id`) | ✅ |
| 8 | Logout expires cookie (`Max-Age=0`) via `/__oz/logout` | ✅ |
| 9 | Logout redirects to **same subdomain** (`admin.ozpos.my.id/` / `dashboard.ozpos.my.id/`) | ✅ |
| 10 | `/__oz/session` has NO `Access-Control-Allow-Origin` (token not readable cross-origin) | ✅ |
| 11 | Strict CSP: `script-src 'self'`, `frame-ancestors 'none'`, no-referrer | ✅ |
| 12 | Escalating brute-force lockout (5s → +30s → 15min cap) on login + verify-otp | ✅ |
| 13 | Session refresh (`touchSession`) on active use | ✅ |
| 14 | Dashboard SPA uses relative API + `/__oz/logout` (fixed this pass) | ✅ |
| 15 | Token never appears in a URL (one-time exchange code) | ✅ |

---

## 3. Issues Found & Fixed This Pass

### F1 — Dashboard SPA used direct license URL (CORS dependency)
**Before:** `dashboard.js` API base was `https://license.ozpos.my.id` directly (cross-origin, needs CORS) — inconsistent with the login pages.
**After:** Uses the same relative-API mode as login pages (`API=''` → Worker proxy). No cross-origin at all. **Fixed + deployed.**

### F2 — Dashboard logout didn't clear the httpOnly cookie
**Before:** dashboard.js logout called the license-server logout API + navigated to `/` — the httpOnly cookie persisted (same bug we fixed for admin).
**After:** dashboard.js logout navigates to `/__oz/logout` (Worker expires the cookie + redirects to `dashboard.ozpos.my.id/`). **Fixed + deployed.**

---

## 4. Residual Notes (accepted)

| Note | Assessment |
|---|---|
| **24h session TTL** | Active-use refresh keeps dashboards alive; acceptable |
| **`/__oz/session` returns JWT to same-origin JS** | Necessary for Bearer auth; mitigated by strict CSP + no CORS |
| **Session store is in-memory** | Resets on license-server deploy → old cookies become invalid (logout path recovers) |
| **`?token=` fallback in worker** | Deprecated; kept for transition, exchange-code is the primary flow |

---

## 5. Conclusion

Both login flows are **consistent, CORS-free, CSP-hardened, and recoverable**:

- **admin.ozpos.my.id** — dedicated admin login → exchange code → httpOnly cookie → admin API (gated by OZ_ADMIN_EMAIL)
- **dashboard.ozpos.my.id** — dedicated user login → exchange code → httpOnly cookie → user API

No blocking issues remain. All fixes deployed live.

---

## Currency (re-checked 2026-09-09 against branch 0.0.37 — annotation only; the record above is unchanged)

Half of what this pass certified is gone, and it is gone because it worked: the flow it verified was replaced hours later by the same team.

- **The user half of the scope no longer exists.** `dashboard.ozpos.my.id` now 302s to the marketing account portal before any auth logic runs (`website/worker.ts:193-209`, target constants at `:90-92`; `DASHBOARD_HOSTS` is down to `admin.ozpos.my.id` alone at `:72`), retired by `ae8778c75` "refactor(website): retire dashboard.ozpos.my.id — redirect to ozpos.my.id/en/account/" and deleted by `dece04fdc` "chore(website): remove retired dashboard SPA files" — both dated 2026-08-30, the date on this document. Consequences: **check 2** (login page served there, 200) is false today; **check 3**'s "both login pages" is one page; **check 9** is half-gone — logout now goes to `https://admin.ozpos.my.id/` for the admin host and `https://ozpos.my.id/en/login` for everything else (`website/worker.ts:616-620`, `:747`); **check 14** points at a deleted artifact; and **F1/F2** cite `dashboard.js`, which is no longer a tracked file (`git ls-files website/public` lists `admin/*` only — the `dashboard/` directory is gone). Re-measure: `grep -n CUSTOMER_DASHBOARD_HOST website/worker.ts`.
- **Check 11 is now over-precise in the other direction.** `script-src` is `'self' https://static.cloudflareinsights.com`, not bare `'self'` (`website/worker.ts:130`); `frame-ancestors 'none'` (`:138`) and `Referrer-Policy: no-referrer` still hold, and `style-src` still carries `'unsafe-inline'` (`:131`).
- **The parent-domain cookie came back through a different door.** Check 7 says the scoped domain means "not the parent `.ozpos.my.id`", and that is true for the admin host (`setCookieHeader(token, 30*24*3600, hostname)` at `website/worker.ts:283`, header built at `:111-113`). But the account-portal exchange that replaced the dashboard writes the cookie from the marketing host, where `hostname` **is** `ozpos.my.id` — so that session is `Domain=ozpos.my.id` and is sent to every subdomain (`website/worker.ts:705`). This is a code observation, flagged not fixed: it is the exact condition F5 in `docs/security/audit-admin-login-flow.md` accepted, reintroduced by the retirement this document certifies. Re-measure: `grep -n 'setCookieHeader(' website/worker.ts`.
- **Residual row "?`token=` fallback in worker — kept for transition" is closed.** Commit `dbd3106ae` "fix(security): remove deprecated ?token= fallback (M3 / Phase 3 item 12)" deleted the path; `grep -E '\?token=|"token="' website/ scripts/ apps/` returns nothing, and both surviving handoffs are `?code=` (`website/worker.ts:261-303` on the admin host, `:687-722` on the marketing host, the latter additionally gated to 48-hex codes at `:688`). Check 15 is therefore stronger than it was written, not weaker.
- **Checks 1, 4, 5, 6, 8, 10, 12, 13 re-verified true.** Admin page served on `admin.ozpos.my.id` (`website/worker.ts:637-651`); no inline handlers in `website/public/admin/login.html` or `index.html` (both 0 hits for `onclick|onload=|onerror=`); `/api/v1/web/login`, `request-otp`, `verify-otp` at `apps/license-server/main.go:280`, `:274`, `:275`; `exchange-issue`/`exchange-consume` at `:294-295` with 401-unauthenticated (`web_exchange.go:137`, `:142`) and 400-bad-code (`:188`, `:192`) and a 30 s TTL (`:34`); logout `Max-Age=0` (`website/worker.ts:622`, `:748`); no `Access-Control-Allow-Origin` on `/__oz/session` (`:313-319, `:730-737` — the only ACAO headers in the file are the API proxy echo at `:241` and `/api/contact` at `:775`); lockout 5 s → +30 s → 15 min (`login_lockout.go:36-40`, `:82-90`); `touchSession` (`web_otp.go:127-133`, called from `web_dashboard.go:49` and `web_exchange.go:145`).
- **"All fixes deployed live" is a deployment claim about a host I cannot reach, and it was overtaken anyway.** Re-measure against the checkout, not the doc: `cd website && npx vitest run src/__tests__/` and `go -C apps/license-server test -short ./...`.

> last audited 09-09-26 by docs-auditor
