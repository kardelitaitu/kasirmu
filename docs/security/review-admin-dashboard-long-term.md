# Admin Dashboard Review — Long-Term Sustainability Report

<!-- Audit stamp: 2026-09-09 . DSH . status: ACCURATE AFTER REPAIR (4 findings) .
Verified every "✅ Resolved" status in §6 against the 0.0.37 tree: innerHTML->textContent
(website/public/admin/admin.js), MOCK removal, tenants pagination+search
(website/public/admin/admin.js, apps/license-server/admin_dashboard.go), no-store on SPA HTML
and per-subdomain cookie scoping (website/worker.ts), ?token= and devices2 removal,
STRINGS/t() (website/public/admin/admin-utils.js), the svgChart/svgDonut guards,
maskLicenseKey at 11 non-test sites in 7 files plus its AST guard, and the version pin in
apps/license-server/admin_dashboard.go. Repaired 4 items: two CI pointers at a workflow that
is now inert, one gate mis-attribution, and the L2 a11y status (no admin JS file contains an
aria-label today). Still-open items re-confirmed open, NOT weakened. Dated §1/§2/§8 prose left
verbatim per rule E; corrections are bracketed and the end note carries re-measure commands.
-->

**Date**: 2026-08-29  
**Scope**: `website/public/admin/` (SPA) + `website/worker.ts` (auth gate) + `apps/license-server/admin_*.go` (backend)  
**Focus**: Maintainability, security, scalability, and resilience for the long run.

---

## 1. Architecture Overview

```
Browser → admin.ozpos.my.id
  ├── No cookie → Worker serves /admin/login (login.html + login.js + login.css)
  └── Cookie → Worker serves /admin/     (index.html + admin.js + admin.css + theme.js)
        ├── Dashboard tab   → /api/v1/admin/stats  (real) → MOCK fallback
        ├── Tenants tab     → /api/v1/admin/tenants (paginated)
        └── Health tab      → /api/v1/admin/health
```

**Stack**: Vanilla JS (no framework), inline SVG charts, CSS custom properties for theming, strict CSP via worker injection.

---

## 2. Top Findings (highest-impact issues)

### C1 — Unsafe `innerHTML` in Tenant Detail Modal (defense-in-depth, currently LOW exploitability)

**File**: `admin.js:373-380`  
**Risk**: `showTenantDetail` builds the modal via `kv.innerHTML = '<span>...' + (t.status || '—') + '...</span>'`. **Assessment after verifying the data model**: license keys are server-generated hex (`hex.EncodeToString` in `api_key.go`/`helpers.go`), and `tierKey`/`status`/`provider` are enum/select fields constrained at the PocketBase schema level — so none of the fields interpolated into this HTML are currently free-text user input. The tenant **email** (the one genuinely user-controlled field) is rendered via `el('h3')` → `textContent`, which is safe.

**Severity**: **MEDIUM** (was initially assessed HIGH) — not directly exploitable today, but the `innerHTML`-with-string-concatenation pattern is fragile. Any future field that becomes free-text (e.g., a tenant `notes` column, an editable `display_name`) instantly becomes stored XSS in the admin panel with JWT-theft capability via `/__oz/session`.

**Fix**: Replace `innerHTML` concatenation with `el('span', ...)` + `textContent` in `showTenantDetail`. Cheap, removes the whole class of future bugs.

### C2 — Unsafe `innerHTML` in Upgrade Prompt (defense-in-depth)

**File**: `admin.js:402`  
**Risk**: `box.innerHTML += '<p>... Current tier: ' + (data.subscription.tierKey || 'none') + '...</p>'`. Same pattern as C1 — `tierKey` is a schema-constrained enum today, but the pattern is unsafe for future fields.

**Severity**: **MEDIUM** (was initially assessed HIGH) — same rationale as C1.

**Fix**: Use `el('p', ...)` + `textContent` for the tier display.

### C3 — No Pagination in Frontend for Tenants List

**File**: `admin.js:340-359`  
**Risk**: The admin SPA fetches `GET /api/v1/admin/tenants` without any `?page=` or `?perPage=` params. The backend defaults to page 1, 25 per page, and returns the first 25 only. **The frontend never requests the next page** — so the admin sees only the first 25 tenants. With 1,000+ tenants, only 25 are visible, and there's no way to load more or search.

**Severity**: **HIGH** — functional gap that will block operators as the business grows.

**Fix**: Add pagination controls (page numbers, prev/next) to `renderTenants`, pass `?page=` and `?perPage=` to the API, and display total count from the response.

### C4 — MOCK Data Fallback Masks Real Failures

**File**: `admin.js:148-151`  
**Risk**: When the `/api/v1/admin/stats` API fails (network error, server down, 500), `renderDashboard` catches the exception and silently falls back to the `MOCK` object. The admin sees fabricated numbers (1,247 users, 386 subscribers, etc.) with a "MOCK DATA" badge. **An operator could act on fake data**, especially if they don't notice the badge.

**Severity**: **HIGH** — operational risk. Real data disappears behind plausible-looking fake data.

**Fix**: Show an error banner ("Stats API unavailable — showing sample data") in addition to the MOCK badge, or disable the mock fallback and show an empty state with a retry button. The current behavior is too quiet.

---

## 3. High Findings

### H1 — Monolithic 450-line Vanilla JS File

**File**: `admin.js` (448 lines)  
**Risk**: All logic, data, chart rendering, i18n strings, event handling, and routing live in a single file. No module separation, no test coverage, no build step. Adding a feature means growing the monolith. The `MOCK` data object (lines 5-47) alone is 43 lines of hardcoded test data shipped to production.

**Severity**: **HIGH** — maintainability debt. Future developers will hesitate to touch it.

### H2 — Zero Unit Tests

**Risk**: `admin.js`, `login.js`, `theme.js`, `admin.css`, `login.css` have zero tests. The only test coverage for the admin dashboard is the worker's 14 integration tests (`worker.test.ts`), which test the HTTP routing and auth gate — not the JS rendering or user-facing behavior.

**Severity**: **HIGH** — every change risks regression.

### H3 — Hardcoded English Strings (No i18n)

**File**: `admin.js` — every label, tooltip, error message, button text, and table header is hardcoded English. The rest of the kasir.mu ecosystem uses `@fluent/react` and `.ftl` files for i18n. The admin dashboard has no locale support.

**Severity**: **HIGH** — inconsistent with the rest of the platform. If the admin needs to be localized in the future, every string must be extracted.

### H4 — Session Cookie Shared Across All Subdomains

**File**: `worker.ts:47` — `Domain=.ozpos.my.id`  
**Risk**: The `oz_session` cookie is sent to ALL `*.ozpos.my.id` subdomains, including the marketing site. While the cookie is HttpOnly (not readable by JS on the marketing site), the marketing site's CSP is less strict (`script-src 'unsafe-inline'`). If the marketing site is compromised, the attacker can make authenticated requests to the license API via the shared cookie.

**Severity**: **HIGH** — cross-subdomain session exposure.

---

## 4. Medium Findings

### M1 — No Loading / Error States for Charts

**File**: `admin.js:143-269`  
**Risk**: The `renderDashboard` function shows a skeleton while loading, but if the API partially fails (e.g., stats succeeds but chart data is missing), the charts render with `NaN` values or empty SVG. The `svgChart` function uses `Math.max(...data.map(...))` — if `data` is empty, `Math.max()` returns `-Infinity`, producing broken SVG.

### M2 — Duplicate Icon Code

**File**: `admin.js:185,188` — `devices` and `devices2` hold identical SVG strings. The `devices2` key is never referenced (`devices` is used at line 197). Dead code shipped to production.

### M3 — `?token=` Fallback Still Active

**File**: `worker.ts:154-172` — the deprecated `?token=` flow is still handled. The exchange code flow (`?code=`) is the intended replacement. The fallback should be removed after verifying the rollout.

### M4 — Client-Side FX Rate Fetch (No Server Cache)

**File**: `admin.js:54-60`  
**Risk**: The FX rate is fetched from `open.er-api.com` directly from the browser. If the external API is throttled or down, the admin dashboard shows a stale rate with a "stale" chip. The server-side `/api/v1/admin/stats` already returns `fxRate` with a 1-hour cache, but when the real API fails (falling to MOCK), the client makes a duplicate fetch.

### M5 — No Search on Tenants List

**File**: `admin.js:340-359`  
**Risk**: With 25 tenants per page and no search/filter, finding a specific tenant requires manually paging through hundreds of records. The backend has no search endpoint.

### M6 — SPA HTML is Edge-Cached (acceptable, but worth documenting)

**File**: `worker.ts:248` — the SPA response (`withStrictCSP(spaResp)`) copies the ASSETS headers including `Cache-Control: public, max-age=0, must-revalidate`. Live check confirms `CF-Cache-Status: HIT`. **Assessment**: this is acceptable — `max-age=0` + `must-revalidate` means the edge/browser revalidates every request, so stale SPA content isn't served long-term. The one subtlety is that a deploy changing the SPA's hash-less file paths can serve the *previous* version for one revalidation cycle. Not a bug, but the admin dashboard's HTML/JS should be considered immutable-per-deploy; a future improvement is fingerprinting asset filenames (e.g. `admin-<hash>.js`) to eliminate even that window.

---

## 5. Low / Info Findings

### L1 — Inline Styles via JS (CSP Dependency on `unsafe-inline` for style-src)

The admin dashboard heavily uses `style.cssText`, `style="..."` in SVG strings, and `innerHTML` with inline styles. This forces `style-src 'self' 'unsafe-inline'` in the CSP. While acceptable for an admin tool, it prevents achieving a fully strict CSP.

**Status (2026-08-30 re-review): OPEN — was overclaimed as resolved.** `worker.ts` still ships `style-src 'self' 'unsafe-inline'` and `admin.js` still uses ~12 `style="..."` + 7 `cssText`. Note the real CSP dependency is narrower than the finding implies: `style-src` gates only `style=""` *attributes* and `<style>` elements — CSSOM writes (`el.style.cssText`, `el.style.x = …`) are **not** gated. So the fix is to move the ~14 `style="..."` occurrences (mostly SVG chart markup) to presentation attributes (`fill=`/`stroke=`) or classes, then tighten CSP to `style-src 'self'`. The `cssText`/`.style.x` uses can stay.

### L2 — No `alt` / `aria-label` on SVG Icons

The KPI icons and chart SVGs have no `aria-hidden="true"` (or it's on the SVG itself but not on the container). Minor for screen readers.

**Status (2026-08-30 re-review): ✅ Resolved (#75).** KPI icons carry `aria-label`s; decorative SVGs are `aria-hidden`.

**Re-checked 2026-09-09 — this sentence no longer describes the tree, so it is
not an enforced control.** The dashboard's cards are built by `statC`
(`website/public/admin/admin-utils.js:292`), which takes no icon at all (call
sites `website/public/admin/admin.js:196-199`), and `kpiC` — the helper that did
take one — fills a plain `<div class="kpi-icon">` via `innerHTML` with neither
`aria-label` nor `aria-hidden` (`website/public/admin/admin-utils.js:271-276`)
and has no production caller left, only the two test files that exercise it.
`grep -c aria-label` returns **0 for every JavaScript file** in
`website/public/admin/`; the labels that do exist are static markup in
`website/public/admin/index.html` (nav, back link, theme toggle) and
`website/public/admin/login.html`, as are its 6 `aria-hidden` SVGs. The
generated chart SVGs are likewise unlabelled and not hidden
(`website/public/admin/admin-utils.js:205`, `:490`, `:553`). Nothing regressed
for a user — the icons were removed rather than labelled — but nothing now
guarantees the property the row claims. Re-measure:
`grep -c aria-label website/public/admin/*.js`.

### L3 — `theme.js` Loaded Synchronously in `<head>`

The theme script blocks rendering. For a 1KB file it's negligible, but it's a pattern to note.

**Status (2026-08-30 re-review): ✅ Won't fix — by design.** Synchronous `<head>` execution is the *correct* anti-FOUC pattern for a theme script (1.3 KB); `defer`/`async` would reintroduce the theme flash it prevents.

### L4 — Login Page Has No Theme Switcher

The admin login page (`login.html`) is always dark. The dashboard has a theme toggle, but the login page doesn't — creates a flash of dark on redirect.

**Status (2026-08-30 re-review): ✅ Resolved (#75).** Sun/moon toggle + `theme.js` on both admin and dashboard login pages.

---

## 6. Recommendations (Priority Order)

| # | Priority | Finding | Action | Status |
|---|----------|---------|--------|--------|
| 1 | **HIGH** | Unsafe `innerHTML` patterns (C1, C2) | Replace with `textContent` / `el()` for all API-sourced strings (defense-in-depth; not exploitable today due to server-generated hex keys + enum-constrained fields) | ✅ Resolved — `showTenantDetail` / `upgradePrompt` use `el()` + `textContent` (Phase 1) |
| 2 | **HIGH** | MOCK fallback masks failures (C4) | Show error banner when API fails; keep MOCK only as last-resort skeleton | ✅ Resolved — MOCK object removed; API errors render a retry/error state (Phase 1) |
| 3 | **HIGH** | Tenants list has no pagination (C3) | Add page controls + pass `?page=` / `?perPage=` to the API | ✅ Resolved — pagination controls + `?page=`/`?perPage=`/`?search=` (Phase 2) |
| 4 | **HIGH** | Monolithic admin.js (H1) | Split into testable modules (stats.js, tenants.js, charts.js) or move to a build step | ✅ Resolved — pure helpers extracted into `admin-utils.js` (charts, formatting, cards, API auth, i18n) with unit tests |
| 5 | **HIGH** | Zero tests (H2) | Add unit tests for chart rendering, helpers, and API mock fallback | ✅ Resolved — 103 unit tests across `admin-utils.test.ts` (94, incl. a seeded property fuzz) and `admin-a11y.test.ts` (9), +19 in `worker.test.ts`, +13 Go tests in `admin_stats_test.go`, `admin_dashboard_test.go`, `enterprise_admin_test.go`, `addon_admin_robustness_test.go` and `enterprise_trial_race_test.go`; the JavaScript suites execute in CI via the `website-tests` gate, the Go suites via the `go` gate (`dev-ci.yml#static-gates` runs `go test -short` over `apps/license-server`, and none of these five files is skipped by `-short`). The 2026-08-30→31 bug hunt added 81 of the website tests and fixed 40 real bugs (see §8.1) |
| 6 | **HIGH** | No i18n (H3) | Extract strings to an i18n structure; at minimum, add English `.ftl` keys for future localization | ✅ Resolved — `STRINGS` key-value table + `t()` helper; all admin/dashboard/login strings extracted |
| 7 | **HIGH** | Shared session cookie (H4) | Restrict `Domain` to individual subdomains or use a dedicated auth domain | ✅ Resolved — cookie scoped to `admin.ozpos.my.id` / `dashboard.ozpos.my.id` (not the parent domain) |
| 8 | **MEDIUM** | No loading/error states for charts (M1) | Guard `svgChart` against empty/NaN data; add per-chart error states | ✅ Resolved — `svgChart` / `svgDonut` guard empty/NaN/zero data |
| 9 | **MEDIUM** | Remove `?token=` fallback (M3) | Delete the deprecated path once exchange-code rollout is confirmed stable | ✅ Resolved — `?token=` fallback removed; exchange-code (`?code=`) is the only handoff |
| 10 | **MEDIUM** | Duplicate `devices2` icon (M2) | Remove dead code | ✅ Resolved — dead code removed |
| 11 | **MEDIUM** | No search on tenants (M5) | Add a search endpoint on the backend + search input in the frontend | ✅ Resolved — backend `?search=` + frontend search input (Phase 2) |
| 12 | **INFO** | SPA HTML edge-cached (M6) | Acceptable (`max-age=0, must-revalidate`); optional future: fingerprint asset filenames | ✅ Resolved — `Cache-Control: no-store` on SPA HTML; `?v=` cache-busting now works via the worker query-string fix |
| 13 | **LOW** | Login page always dark (L4) | Add theme.js to the login page or auto-detect OS preference | ✅ Resolved — sun/moon theme toggle on both admin and dashboard login pages |

---

## 7. Phase Plan

_Status as of the re-verification pass (PRs #64–#89): items 1–13 and 15 are done; 14 remains open. Item 16 has two landed slices (#88: focus-visible, skip links, modal dialog + ESC; #89: upgrade-prompt dialog + login skip links) — the full keyboard/focus audit remains open._

### Phase 1 (immediate — hours) ✅
1. ✅ Fix stored XSS (C1, C2) — replace `innerHTML` with `textContent` in `showTenantDetail` + `upgradePrompt`
2. ✅ Fix MOCK fallback (C4) — add an error banner; don't silently fall back
3. ✅ Remove dead code (M2)
4. ✅ Set `Cache-Control: no-store` on SPA HTML (M6)

### Phase 2 (short-term — days) ✅
5. ✅ Add pagination controls to the tenants list (C3)
6. ✅ Guard `svgChart` against empty data (M1)
7. ✅ Add loading/error states for all API calls
8. ✅ Add search to tenants list (M5)

### Phase 3 (medium-term — weeks) ✅
9. ✅ Split `admin.js` into modules (H1) — pure helpers extracted into `admin-utils.js` (charts, formatting, cards, API auth, i18n)
10. ✅ Add unit tests for chart rendering, helpers, and error states (H2)
11. ✅ Add i18n infrastructure (H3) — `STRINGS` key-value pattern + `t()` helper
12. ✅ Remove `?token=` fallback after confirming `?code=` works (M3)

### Phase 4 (long-term) ⏳
13. ✅ Restrict session cookie domain (H4) — cookie scoped to each dashboard subdomain
14. ☐ Move admin dashboard to a build step (Vite/Rollup) for TypeScript, module resolution, and tree-shaking — **open**: not required while the dashboard stays a plain-vanilla static SPA
15. ✅ Add theme.js to the login page (L4) — sun/moon toggle on both admin and dashboard login pages
16. ◐ Accessibility pass (ARIA, keyboard navigation, focus management) — #75 (KPI aria-labels), #88 (focus-visible, skip links, modal + ESC), #89 (upgrade-prompt dialog, login skip links) landed; full keyboard/focus audit remains open

---

## 8. Re-verification addendum (2026-08-30)

Independent re-review of every claim above against the code on `main`,
merge history (`git log -S` + merge-ancestry), and a local test run:

- **All 13 recommendation-table resolutions verified in code** — cookie
  scoping (`Domain=${hostname}`), `?token=` removal, chart guards,
  backend `?search=` (+ `regexp.QuoteMeta`), FX server cache (1 h TTL),
  pagination, MOCK removal, safe kv-grid, `STRINGS`/`t()` on all four
  pages, theme toggles on both logins.
- **True PR attribution** (an earlier summary table misfiled several):
  M1/M2/M4/M5/M6 and C1–C4 all landed in **#60** (Phase 1+2 hardening);
  H4 in **#68**; M3 in **#74**; H1/H2 in #69/#70/#72; H3 in #71/#73/#76/#77;
  L2/L4 in **#75**. #67 (license-suite speed) and #78 (timezone-fragile
  fixtures) resolve none of the M findings.
- **H2 enforcement gap closed**: the 24 admin-utils tests + 14 worker
  tests existed but **no CI workflow executed them** (`astro check` only
  type-checks). Now gated end-to-end: `website-tests` registered in
  `scripts/gates.json`, `npm test` step in `website.yml` (fail-fast,
  before the portal build), `website test` step in `scripts/check.sh`.
  _(Corrected 2026-09-09: that `website.yml` pointer is dead — the file is now
  the inert `website.yml.bak`, which GitHub never runs. The live runner is the
  `website` job of `.github/workflows/dev-ci.yml`: `npm run check` at line 159,
  `npm test` at line 161, `npm run build` at line 163, so the fail-fast ordering
  still holds, and `gates.json` itself now records `website-tests` ->
  `dev-ci.yml#website`.)_
- **L1 corrected to OPEN**, **L3 marked won't-fix/by-design** — see §5.
- Test count corrected: **24**, not "25+".

### 8.1 Bug hunt (2026-08-30 → 08-31, TDD) — 40 bugs found & fixed

A focused hunt over `admin.js`/`admin-utils.js` against the Go server's
actual JSON shapes found six real bugs — none caught by the pre-existing
24 tests, which covered only escapeHtml/fmt/statusPill:

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B1 | P0 | `tenants.forEach(t => …)` — callback param shadowed the i18n `t()`; `t('tenant.details')` threw on the first row → Tenants tab = header + empty tbody | row builder extracted to `tenantRow(tenant, onDetails)` |
| B2 | P0 | `showTenantDetail`: `const t = data.tenant` shadowed `t()` identically → detail modal **always** showed "Failed to load" | kv mapping extracted to `tenantDetailRows(data)` |
| B3 | P1 | churn bars read `d.count`, but `admin_stats.go` sends `monthBucket{Month, Churn}` with `count` at Go zero → chart permanently flat/NaN | `svgBarChart(id, data, {valueKey})`; churn passes `'churn'` |
| B4 | P1 | `svgDonut` single 100% slice → one arc with start==end → draws nothing (SVG spec) → empty ring beside a "100%" legend | full circle split into two 180° arcs |
| B5 | P2 | `svgChart` did `d.month.slice(5)` unguarded — M1 protected values but not labels; one month-less row killed the render | label guarded + escaped |
| B6 | P2 | `renderDashboard` dereferenced `m.revenueTrend.forEach` / `m.kpis.mrrUsd` **before** the chart guards ran → partial payload = blank dashboard | `normalizeStats(m)` guarantees shapes |

Commits `b238540b`, `ac7ed317`, `27af049f`, `c18a3e00`, `de489a16`
(prefix `(bugs)website:admin`). Suite 24→40 tests; full website suite
566/566. Known residuals logged in `JOURNAL.md` (lockout-countdown timer
race, `escHandler` listener leak, per-request `/__oz/session` fetch).

**Round 2** (same day) hunted those residuals and the login flow — six
more bugs, all fixed with tests (suite 40→57, full website 623/623):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B7 | P1 | `showLockoutCountdown` spawned a new `setInterval` per 429 without clearing the previous — the shorter stale timer re-enabled the button **early** during a longer lockout; the survivor zombie-rewrote the restored label | `startLockoutCountdown` keeps one tracked timer per button |
| B10 | P2 | `fetchFxRate` awaited an un-timed fetch — firewalled FX API hung the whole dashboard render | `fetchFxRate(fetchImpl, timeoutMs)` with `AbortSignal.timeout` |
| B11 | P2 | both modal builders leaked the document ESC handler on every non-ESC close (button/backdrop) — stale handlers kept reacting to later ESCs | `mountModal(root, box)` — one idempotent `close()` owns all paths |
| B12 | P1 | `api()` awaited two un-timed fetches per call (session + license API) — a hung connection froze every tab forever, no error state | `fetchWithTimeout` on both calls (default 15s) |
| B13 | P2 | `exchangeForCode` navigated to `/?code=undefined` on a code-less 200 — silent login loop | `exchangeUrlFrom(body)` validates + surfaces `login.exchangeFailed` |
| B14 | P3 | `setAuthMode` overwrote the lockout countdown label on tab switch — disabled button labelled "Send Verification Code" | label writes skipped while `isLockoutActive(btn)` |

Round-2 commits: `5dfe72d9`, `1670a282`, `96f6d3f9`, `2b19570c`,
`cafcca11`. Remaining residuals (stale-response race in `renderTenants`,
raw-enum `statusPill` text, no URL state for tab/search/page) logged in
`JOURNAL.md`.

**Round 3** (same day) closed those residuals and hunted the modal
action paths — four more bugs, one candidate dropped as unreachable
(suite 57→70, full website 636/636):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B15 | P2 | `renderTenants` let a slow page-2 response overwrite page 3 (last-arrival-wins) — rows and pagination header disagreed | `createSeqGuard()`: superseded responses discarded on success + error paths |
| B16 | P3 | server status enum leaked raw into pills and the detail modal (`grace_period`) | `statusLabel()` maps the enum via STRINGS; unknown → raw fallback |
| B18 | P2 | OTP resend cooldown went invisible after a tab switch (timer ran on, element hidden) — user clicked into a 429 blind | `startCountdown`/`stopCountdown`/`countdownActive` on the node; `setAuthMode` re-shows while active |
| B19 | P1 | tenant modal actions had no double-click guard — Renew POSTed +365 days per click, double-click = +730 | `busyWrap` single-flight wrapper on all four buttons |

B17 (detail-modal fetch race) was investigated and **dropped**: the
loading overlay blocks all interaction, so two detail fetches cannot
overlap. Round-3 commits: `bb73e268`, `d3017b63`, `fc184c30`. The B19
helper was independently written by the concurrent agent session and
adopted (attribution in the commit message).

**Round 4** (same day) ran the adversarial pass over the hunt's own
fixes — three more, including one self-inflicted regression
(suite 70→76, full website 642/642):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B20 | P1 | B10/B12 called `AbortSignal.timeout()` unconditionally — Chrome/WebView 103+/Safari 16+ only; on older WebViews EVERY `api()` call threw TypeError, making the dashboard permanently broken on browsers that worked before the timeout fixes | `timeoutSignal()` availability guard; un-timed fetch beats broken fetch |
| B21 | P2 | tab click during an in-flight login flipped `currentMode` — the response handler wrote the wrong mode's label and could start the OTP cooldown on the password tab | `setAuthMode` extracted with `isSubmitting()` veto; refused flips leave DOM untouched |
| B22 | P2 | `login-btn` is `type=submit`: Enter in any input triggers implicit form submission, which **ignores the disabled state** — the 429 lockout countdown was bypassable by pressing Enter | `handleLogin` vetoes while `isLockoutActive(btn)`; restore label mirrors the mode's real state |

Round-4 commits: `70d5d869`, `aa808a93`, `d183645e`. Lesson recorded:
timeout/abort primitives are themselves compatibility surfaces — a
hardening fix can regress more than the bug it cures.

**Round 5** (same day) completed full end-to-end coverage of the admin
area — every SPA file plus the worker's admin auth gate — and found two
bugs in the one-time-code exchange (worker suite 17→19, full website
644/644):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B24 | P1 | exchange-code failure on `admin.ozpos.my.id` 302'd to the MARKETING host's `/admin/login` — which has no `/api/v1/` proxy (gated to `DASHBOARD_HOSTS`), so login.js's relative POSTs 404: a dead login form, user stranded | redirect to the clean URL on the same host; the no-session gate serves login locally and the destination survives re-login |
| B24b | P1 | the exchange SUCCESS 302 used `url.pathname` raw — `/?code=x` at path `//evil.com` produced `Location: //evil.com/`: a protocol-relative **open redirect** on the admin host | path forced single-slash (`/^[/\\]+/`) before reuse |

Round-5 commit: `d3085d8e`. The pre-existing worker test asserted the
marketing bounce — it pinned the bug and was corrected with a note.
B23 (innerHTML+= breaking SVG viewBox) was investigated and dropped:
the HTML parser's SVG attribute adjustment fixes camelCase attrs.
**Coverage is now complete**: admin.js, login.js, admin-utils.js,
theme.js, index.html, login.html, and the worker admin gate have each
been read end-to-end during the hunt.

**Round 6** (same day) went server-side and into the accessibility
surface — the Go stats endpoint behind the dashboard plus the modal
focus lifecycle (3 fixed, 1 hypothesis dropped; commit format switched
to the enforced conventional style, area `licensing`/`website-admin`):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B25 | P2 | `getFxRate` cached a FAILED upstream fetch with the same 1h TTL as a success — one blip pinned the 16000 fallback for an hour; since revenue_events.go converts Midtrans IDR payments through it AT WRITE TIME, payments recorded during the window store a ~3% wrong USD equivalent | per-entry TTL: success 1h, failure `fxRetryTTL` 60s; `fxFetcher` test seam |
| B27 | P3 | `mountModal` announced the dialog (role/aria-modal) but focus never entered it — keyboard/SR users tabbed through background content (WCAG 2.4.3) | capture opener, focus first focusable (or box via tabindex=-1 during Loading), restore on close |
| B28 | P3 | Tab walked OUT of the open dialog (WCAG 2.1.2) | focus trap cycling Tab/Shift+Tab within the dialog, focusables queried at event time, removed via the B11 close() path |

Round-6 commits: `ed1d6054` (B25), `915e73b5` (B27), `5a8b0cc3` (B28).
**B26 dropped with a lesson**: hypothesized "revenue merge collapses
IDR-only months to $0" and test-drove `usd + idr/fx` — the pre-existing
`TestAdminStats_RealRevenue` then failed, correctly: revenue_events
stores BOTH currencies of every payment (native + FX-converted at write
time), so `realUsd` already includes Midtrans revenue and the "fix"
double-counted everything. Reverted; NOTE comments pin the data model.
Lesson: check the WRITER before fixing a reader.
**Clean audits this round**: all 9 `/api/v1/admin/*` Go handlers wrap
`adminAuth` (admin key or admin-tenant session; registration verified);
every innerHTML chart/donut path routes server strings through
`escapeHtml` (String()-coerced); table cells use textContent.

**Round 7** (same day) swept the Go admin action-endpoint BODIES — the
last un-reviewed admin surface (round 6 covered only the auth wrappers):

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B29 | P2 | `handleAdminRenew` anchored the new expiry at `time.Now()` — renewing a subscription with months of paid time left silently TRUNCATED it (proved: 2027-01-01 +30d → ~now+30d) | extend from `max(now, current expiry)`; expired subs still renew from now (guard test both directions) |
| B30 | P3 | tier-override accepted any string — unknown keys hit the SelectField schema at save time and surfaced a **500** for bad input (MRR would price unknown keys at $0 if the schema loosened) | 400 `unknown tier_key` via `TierPriceUSD` whitelist |
| B31 | P3 | `/admin/health` hardcoded version `0.0.31` while the repo is locked at `0.0.33` — the health card misreported the deployment | named const + test pin (bump reminder) |
| B32 | P3 | Top Subscribers `renewal` leaked the raw PocketBase datetime (`2027-01-01 00:00:00.000Z`) while every other date column formats `2006-01-02` | same format; zero datetime → empty |

Round-7 commits: `ec2653d4` (B29–B31), `36055db6` (B32).
**Clean audits this round**: tenant search filter (`regexp.QuoteMeta` +
bound params — no injection), pagination clamps (`perPage` 1..100,
`page` ≥ 1), `licenseSummary`/`subscriptionSummary` (parameterized,
consistent latest-by-`starts_at` — renew targets exactly what the
dashboard shows). **Adjacent, not this hunt**: the concurrent agent's
LSE-9 landed mid-round — `addon_admin` `authenticateAdmin` previously
accepted ANY valid tenant api_key as admin (P0 priv-esc: any customer
could mint enterprise approval codes / mutate add-ons); fixed in their
`fix(licensing)` slice alongside LSE-8 (constant-time `adminKeyOK`).

**Round 8** (same day) closed the a11y announcement family and ran a
deterministic property fuzz over the render pipeline — the fuzz found
three real crash/corruption paths on its first run:

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B33 | P3 | login `#error-msg`/`#success-msg` had no ARIA role — login errors/success silent to screen readers (WCAG 4.1.3); tabs half-wired (`role=tab` without `aria-controls`, groups without `role=tabpanel`) | `role=alert`/`role=status` + full tab/panel wiring; markup contract tests parse the real HTML |
| B34 | P3 | `flash()` appended a bare div — every action toast AT-silent | extracted to `admin-utils.flashMessage` with `role=alert`; admin.js delegates |
| B35 | P2 | `normalizeStats` coerced only the old 7 KPI keys — `fxRate`/`mrrIdr`/`lifetimeUsd`/`lifetimeIdr` could render "Rp NaN" (B4 class) | full numeric set coerced finite; string/bool keys pass through |
| B36 | P1 | a null row inside any stats array crashed svgChart/svgBarChart/svgDonut — whole-dashboard render death from one truncated element | object-row filter in all three builders |
| B37 | P1 | non-string truthy `created` threw in `tenantRow` — the tenants `forEach` aborted and the ENTIRE table vanished | `String()` before slice; `devices` guarded to array |

Round-8 commits: `60a8c542` (B33+B34), `74b79da0` (B35–B37).
Fuzz: seeded LCG (reproducible), 20-value hostile pool, 500 iterations
across normalizeStats/charts/tenant builders. B36/B37 are the hunt's
first P1s since B24 — single malformed array elements taking down
whole views, previously only hypothesized (B4's partial-payload class)
and now proven reachable through the element level.

**Round 9** (2026-08-31) opened the last un-read Go admin file (the
enterprise approval-code endpoints) and finished the login page's
robustness/a11y gaps:

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B39 | P2 | `startLockoutCountdown`/`startCountdown` took `seconds` straight from `body.retry_after` — a garbage value made the decrement NaN forever (`NaN <= 0` is false), so the end branch never ran and the **login button stayed disabled until a page reload** | coerce to a finite integer; invalid/non-positive means "already over" (restore button / fire `onEnd`); numeric-string control test proves real countdowns still run |
| B40 | P3 | `setAuthMode` toggled the visual `.active` class but never `aria-selected` — after switching credential modes a screen reader still reported the *original* tab as selected (WCAG 4.8.2) | both branches keep `aria-selected` in sync with the class |
| B41 | P2 | `tableCard` indexed row fields directly — a null row or non-array headers threw and killed the whole view (B36 class, found by extending the fuzz to the remaining helpers) | containers validated, malformed rows skipped |
| B42 | P3 | `handleGenerateEnterpriseCode` checked only `len(code) < 8` while the schema caps `code` 64 / `email` 254 / `prospect_name` 256 — oversized input reached Save and failed PocketBase validation, surfacing a **500 for bad client input** (B30 class); Red leaked `code: Must be no more than 64 character(s).` | rune-count pre-checks mirroring the caps (PB validates with `len([]rune(value))`, so a byte-count guard would let a multi-byte payload slip through and leak the 500 again) |
| B43 | P3 | the schema carries `created_by` for attribution; the handler never set it — every privileged enterprise code was minted **anonymously**, no audit trail | `adminIdentity` helper labels the authenticating credential (`admin_key` or the admin tenant's email); mint log carries it too |

Round-9 commits: `324e138b` (B42+B43), `2f1171e3` (B39–B41),
`e82845f1` (B38 net + CI type fix). **B38** (nav `aria-current`) was
fixed by the concurrent agent in `235815d7` while I was blocked on the
same dirty file; my three tests were kept as its regression net rather
than duplicating the fix.
**Clean audits this round:** `generateApprovalCode` uses `crypto/rand`
(not `math/rand`) — entropy sound; `handleListEnterpriseCodes` is
parameterized, bounded, RFC3339-dated; `authenticateAdmin` (their LSE-9
rewrite) correctly requires admin key or admin-tenant session.
**Residuals logged, not fixed:** the uniqueness pre-check → `Save` is a
genuine TOCTOU (the unique index exists, so a true concurrent duplicate
yields 500 not 409 — needs a concurrency test to pin); response returns
raw `req.Email` while the stored value is normalized; `code[:4]` could
split a multi-byte rune in a log line; generated codes carry 32 bits of
entropy (acceptable for one-time, rate-limited admin-minted codes).
**Self-caught regression:** round 8's `60a8c542` broke the `astro check`
gate (possibly-null `getElementById` results + untyped
`querySelectorAll` → 4 errors; `npm run check` at `website.yml:75` would
have failed — today that step is `dev-ci.yml:159` in the `website` job, since
`website.yml` is retired and nothing in `.github/workflows/` except
`dev-ci.yml` and `release.yml` executes). Vitest can't see it — esbuild strips types without
checking. The website gate is `npm run check`, not `npm test`.

**Round 10** (2026-08-31) swept the last admin Go file whose body I had
only partially read (`addon_admin.go`) plus the redemption side of the
round-9 enterprise codes:

| # | Sev | Bug | Fix |
|---|-----|-----|-----|
| B44 | P3 | `license_keys.addons` is `Max:1024` but `handleAddLicenseAddon` validated neither `addon_id` length nor the serialized list size — oversized input reached Save and failed PocketBase validation, so bad admin input surfaced as a **500** (B42/B30 class); Red leaked `addons: Must be no more than 1024 character(s).` | rune-count caps enforced before Save (matching PB's `len([]rune(value))`); the previously-ignored `json.Marshal` error is handled |
| B45 | **P2** | `handleEnterpriseTrial` checked `status == "unused"` up front and marked the code `redeemed` only at the **end** — after creating a tenant *and* minting a 30-day Enterprise key. One one-time code granted **N trials**, and it is deliberately reachable: an attacker with one leaked code just sends N parallel requests | `enterpriseRedeemMu` held across the whole check-and-redeem section; the loser observes `redeemed` and gets 409 |

Round-10 commits: `6845b312` (B44), `bbaab2cd` (B45).
**B45 evidence:** reproduced 3/3 before the fix (2/2 racers returned
200 — no flakiness, the window is wide enough that it always loses);
5/5 clean after. **Clean audits:** `parseAddonsFromRecord` (empty,
malformed, and non-array JSON all degrade to `[]`), the remove handler
(404 when absent; no Save on failure paths, so no B44 exposure), the
list handler (parameterized), and the `[:4]`/`[:8]` masking slices
(safe only because the schemas enforce `Min:8`/`Min:10` on the stored
values a request must match exactly).
**Residuals deliberately not fixed:** a failed final `redeemed` write is
treated as non-fatal, leaving the code reusable — closing it means
claiming before minting, which moves a mid-flow failure onto the
customer instead of the business (product call, not a silent fix);
`enterprise_trial.go:182` logged a full license key — **CLOSED 2026-08-31
(`039197e9` + `e90b2e2c`)**. The deferral reason was that fixing one file
alone would be worse than inconsistent, so the whole class was swept instead:
11 sites across 7 files now mask through `maskLicenseKey` (tail-8, mirroring
`mask_token` in `crates/oz-security/src/mask.rs`, so Rust and Go share one
convention). Classification was by argument, not keyword: 3 `login_lockout.go`
sites were excluded as email-derived, and 2 `addon_admin.go` sites kept their
stronger prefix form under a `key-log:masked` marker. An AST guard
(`mask_convention_test.go`) now fails any new raw site, so this cannot regrow.
**Open finding surfaced by that classification:** `login_lockout.go:203`,
`:218` and `:319` write the customer's email address into the server log via
`loginLockoutKey(email)` — PII rather than a credential, so out of scope for
the key sweep and still unfixed; the list handler's `updated_at` reports request time, not
the record's; the enterprise mint's uniqueness pre-check → `Save` is a
genuine TOCTOU (unique index exists, so a true concurrent duplicate
yields 500 not 409).
**Process lesson:** an A/B must hold scope constant — my first attempt
compared an isolated test against a full-package run (package tests
share process state), which briefly mis-attributed another agent's
`TestActivateHandler_Lifecycle` failure to my mutex.

---

## Currency (re-checked 2026-09-09 against branch 0.0.37 — §1-§8 bodies are dated records and were left verbatim)

**Re-verified true, with today's coordinates.** innerHTML is gone from the two data paths
(`showTenantDetail` builds its grid with `el()` + `textContent`,
`website/public/admin/admin.js:548-561`; `upgradePrompt` the same at `:794-812`); the MOCK
object is gone (`admin.js:74` is only the comment saying so); pagination and search are live on
both sides (`admin.js:464-465` sends `?page=&perPage=&search=`; `apps/license-server/admin_dashboard.go:108-126`
clamps `perPage` to 1..100 and escapes the term with `regexp.QuoteMeta`); `devices2` is gone;
`?token=` is gone; `Cache-Control: no-store` is applied to SPA HTML
(`website/worker.ts:151` inside `withStrictCSP`, used at `:668`); the cookie is scoped to the
requesting host (`website/worker.ts:111-113`); `STRINGS` + `t()` exist
(`website/public/admin/admin-utils.js:1391`, `:1650`); `svgChart`/`svgDonut` carry their guards
(`:87-99`, `:210-222`); `enterpriseRedeemMu` is held across check-and-redeem with a 409 for the
loser (`apps/license-server/enterprise_trial.go:20`, `:110-111`, `:121`); the health version is a
pinned const matching the current lock (`apps/license-server/admin_dashboard.go:40`,
tested at `admin_dashboard_test.go:137`, updated by `scripts/bump-version.ps1`); and the masking
round's numbers still check out — `maskLicenseKey` is defined at `apps/license-server/mask.go:36`
with exactly 11 non-test call sites across 7 files, its AST guard
`TestNoRawLicenseKeyLogging` in `mask_convention_test.go` runs under
`dev-ci.yml#static-gates` because no admin or masking test is gated on `testing.Short`.

**Still open, still unfixed — recorded so nobody reads the ✅ column as "all clear".**
`apps/license-server/login_lockout.go:203`, `:218` and `:319` still write `key=%q`, and that key is
`"email:"+email` (`:384-386`), so the customer's address goes to the server log. The list handler
still stamps `updated_at` with request time rather than the record's
(`apps/license-server/addon_admin.go:234` — note it is the **addons** handler; the enterprise list
at `apps/license-server/enterprise_admin.go:146` returns the record's own `created`, which is why
the earlier attribution kept failing to locate). The enterprise mint still pre-checks uniqueness and
then calls `Save` (`apps/license-server/enterprise_admin.go:112-122`), relying on the unique index in
`apps/license-server/pb_schema.json` to absorb the race, so a true concurrent duplicate is a 500,
not a 409. And `style-src 'unsafe-inline'` is still shipped
(`website/worker.ts:131`, L1 remains OPEN), with 9 `style="` occurrences across
`website/public/admin/admin.js`, `admin-utils.js` and `index.html` plus 29 `cssText` writes —
the L1 body's "~12 + 7" split is stale; the CSSOM half grew when helpers moved out of
`admin.js`.

**Counts that have moved (measured, not inferred).** `admin.js` is 1,214 lines where §2 said 448,
and `website/public/admin/admin-utils.js` is 1,704 — so H1's "450-line file" framing only holds for
the file that was split, not for what the split left behind. §6 row 5's 103 JS tests are now 156 in
`website/src/__tests__/admin-utils.test.ts` + 9 in `admin-a11y.test.ts` + 26 in
`website/src/__tests__/worker.test.ts`, and the whole website suite is 758 tests over 42 files, not
the "644/644" of round 5; the five Go files named there now hold 15 `func Test` declarations, not 13.
Round 6's "all 9 `/api/v1/admin/*` handlers wrap `adminAuth`" is now 18 routes, every one of them
still guarded but split across two helpers — 12 `adminAuth` sites
(`admin_dashboard.go` 7, `admin_tenant_lifecycle.go` 4, `admin_stats.go` 1) and 6 `authenticateAdmin`
sites (`addon_admin.go` 3, `enterprise_admin.go` 2, `feature_grants.go` 1).
§1's architecture line still reads "stats (real) → MOCK fallback" while §6 row 2 removed the
fallback; read §6, not §1, for that. L4's "both admin and dashboard login pages" is one page
today: `website/public/admin/login.html` only, because `dashboard.ozpos.my.id` now 302s
(`website/worker.ts:193-209`) — the theme toggle on it is intact.

**Re-measure:** `cd website && npx vitest run` ·
`go -C apps/license-server test -short ./...` ·
`grep -c 'func Test' apps/license-server/admin_*_test.go apps/license-server/enterprise_*_test.go apps/license-server/addon_admin_robustness_test.go` ·
`grep -rn 'npm test\|npm run check' .github/workflows` ·
`wc -l website/public/admin/*.js`.

> last audited 09-09-26 by docs-auditor
