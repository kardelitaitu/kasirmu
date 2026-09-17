# Changelog — kasir.mu 0.0.33

**Release date:** 2026-08-31
**Commits since 0.0.32:** 421

---

## Highlights

This release is the **audit + hardening + security** cycle. It closes 40+ audit findings across all 18 crates and the website, eliminates critical security gaps in the licensing engine, introduces a new encrypted LAN transport, adds 300+ regression tests, and retires the deprecated dashboard SPA in favor of the new account portal.

---

## Security & Licensing (LSE-series)

- **LSE-7 (HIGH):** Revenue amounts now carried as i64 minor units, fixing floating-point precision loss
- **LSE-8/LSE-9 (HIGH):** Admin gate no longer accepts any tenant key — validated properly
- **LSE-11:** API key rotation gated behind email recovery codes; throttled and notified
- **LSE-13:** Safe renewal ordering + rate-limit on trial claims
- **LSE-16:** Rate-limit pause/resume bcrypt endpoints
- **LSE-17/18/19:** CSPRNG enterprise trial keys + rate-limit redeem
- Enterprise code minting validates field caps and records attribution
- One-time enterprise approval codes can no longer be spent twice
- Addon identifiers capped before hitting column limit
- FX fallback no longer pinned to 1-hour success TTL
- Dashboard endpoints hardened + exchange-consume rate-limited
- Renew extends live subscriptions instead of truncating them
- Admin gate (license-server) fully audited and closed

## Payment & Sales Fixes (FRONTEND-series)

- **FRONTEND-03:** Line currency carried across add_line IPC; cross-currency lines rejected
- **FRONTEND-04:** Shortfall retry settled in charge currency with full tender snapshot
- **COR-25:** Over-refund guard fails closed and runs inside the transaction
- **COR-26:** Refunds whose currency differs from the sale currency are rejected
- **COR-35:** Snowflake export INSERT uses SQL API bind variables (prevents injection)
- **REP-04:** Net refunds properly netted into revenue reports
- Shortfall reconstruction carries line currency correctly

## Checkout Features (landed post-audit)

- **PROMO-3:** Fixed/BXGY promotions now apply at checkout — engine-previewed totals (`compute_checkout_promotions`), `promotionIds` on checkout args, and application rows persisted inside the checkout transaction (desktop + tablet)
- **LOY-03:** Loyalty points are reversed on refund inside the refund transaction, using integer round-half-up proportional points (no float on money)
- **COR-7:** Checkout replay guard — a client `attemptId` becomes per-split `idempotency_key`s backed by `UNIQUE idx_payments_idempotency_key`, so a retried checkout returns the original receipt instead of double-charging (desktop; tablet guard pending)
- **CUR-11:** `PaymentModal` loads one newest exchange rate per currency pair via `list_latest_exchange_rates_scoped` (bounded latest-per-pair) instead of the full rate history

## Website & Account Portal

- **httpOnly cookie migration (R1):** Account portal session migrated to httpOnly cookie; cookie-only sessions now load the dashboard
- **CSP hardening (R3):** Removed `unsafe-inline` from auth-gated page CSP
- Token leak, proxy hygiene, CSP comment, contact caps audited and fixed (WEB-1..4)
- Static assets correctly routed across subdomains
- Timezone-safe dashboard dates; no negative renewal countdowns
- Subscribe/bundle prices match payment region, not locale
- Localized `paused` subscription status
- `fmtDate` no longer leaks "Invalid Date" for malformed inputs
- Region dropdown stays open during keyboard navigation
- Dashboard region routing uses saved region, not locale
- `CopyKeyButton` clipboard fallback + "Copied!" only on success
- AccountRegion listbox queries scoped to component
- Unused i18n keys wired so audit shows zero dead keys
- Dashboard SPA files retired; redirects to ozpos.my.id/en/account/

## Admin Dashboard

- Phase 1 hardening: remove MOCK, fix innerHTML XSS, no-store cache, dead code removal
- Phase 2: tenants pagination + search, chart data guards
- Countdown seconds coercion, tab aria sync, table guards
- Status messages and toasts announced to screen readers
- Tab cycles inside open modal instead of escaping
- Modal focus enters dialog and restores on close
- Fuzz-found robustness holes in KPI coercion and row handling fixed
- Churn chart read `d.count` while server sends `d.churn` — bars were always zero
- `t()` shadowing that broke tenant detail modal fixed
- Lockout countdown timers raced — early unlock + zombie labels fixed
- `normalizeStats` partial payload no longer blanks the dashboard
- Enter key bypassed 429 lockout countdown — fixed
- Tab switch mid-submit corrupted other mode's form — fixed
- `AbortSignal.timeout` broke fetch on older WebViews — fixed
- Modal ESC listeners leaked on every non-ESC close — fixed
- FX rate fetch had no timeout — dead API hung dashboard — fixed
- Donut full-circle guard + chart month labels fixed

## Auth Hardening

- PIN minimum enforced in FastPINOverlay
- Lockout countdown with timing side-channel mitigation
- PIN Enter guard + usernameAccepted reset
- `window.setAuthMode` global leak removed

## Core & Sync

- Untagged terminal no longer ignored every inventory invalidation
- ozpkg header block authenticated (format v2)
- Oversized ozpkg headers rejected instead of truncated
- ExchangeRateScreen routed through session-scoped commands (CUR-06)
- Transactional exchange-rate writes (F-022)
- Cloud sync `pg create_sale` persists tender metadata columns (CUR-02)

## LAN Server

- **noise-psk-v1 encrypted transport** — full DC-1 fix: LAN communication now encrypted with PSK-based noise protocol

## Modules & Lua

- Single-writer loyalty projection (MSL-4)
- Daily-report tax column fix (MSL-7)
- SQLite quoted identifier rejection in plugin SQL (PLG-11)
- Remaining LOWs sweep: MSL-1, MSL-2, MSL-8, MSL-10, CS-3, LUA-2

## Security Audit Fixes

- Payment gateway secrets removed from renderer surface (UI-1)
- Webhook HMAC verify constant-time + Stripe timestamp tolerance (CS-1/CS-2)
- SMTP at-rest paths fail-closed + OZ_MASTER_KEY opt-in (F-029)
- Staged key rotation (SEC-4) + entropy scrubbing (SEC-6)
- `oz_session` cookie restricted to dashboard subdomain (H4)
- Deprecated `?token=` fallback removed (M3)
- Worker preserves query string for static assets in auth-gated routes
- API refuses production boot without real JWT signing secret (API-1)
- File logging retains WorkerGuard (L-1)

## Refactoring

- **F-011:** Split `db/workspaces.rs`, `db/products.rs`, `db/sales.rs`, `db/kds.rs`, `sync_client.rs` into cohesive parts
- **F-018:** Extract inline tests from sync daemon, pg_transport, conflict, transport, queue, event_handlers to sibling files
- **F-006:** Removed 148 dead IPC command functions from desktop-client
- **F-005:** Split CLI `commands.rs` into per-command-family modules
- Topology editor: 4-phase extraction — helpers, header, context menu, zoom controls
- AccountView.tsx split into focused sub-components
- Dashboard.ozpos.my.id retired with redirect

## Testing (300+ new tests)

### TDD Session — Critical Module Coverage

| Module | Tests Added | Total |
|---|---|---|
| RBAC (3 rounds) | +23 | 67 |
| Permission Registry (3 rounds) | +56 | 58 |
| Sale Deduction | +43 | 53 |
| Inventory Transaction | +31 | 36 |
| Cache | +24 | 32 |
| email_report (COR-36) | +30 | 30 |
| ozpkg | +21 | 28 |
| Promotion Engine | +22 | 51 |
| Rate Limiter | +14 | 30 |
| Payment Webhook | +18 | 19 |
| Sync Conflict | +21 | 76 |
| Subscription | +35 | 95 |
| Desktop Staff (STAFF-10) | pinned | — |
| User Preferences | pinned | — |
| Features proptests | +1 | — |
| Revenue pipeline | +9 | — |

### Website TDD

| Component | Tests |
|---|---|
| LocaleSwitcher | structure, localStorage, navigate |
| ThemeToggle | dark mode toggle |
| DocSidebar search filter | filter by title |
| Header auth nav | session-based login toggle |
| Base.astro scroll-reveal | IntersectionObserver |
| Base.astro applyTheme | flash prevention |
| DocsLayout features | setupDocsFeatures |
| ContactForm | mailto fallback |
| SearchModal | keyboard nav + search trigger |
| OtpInput | paste, backspace, digit filter |
| AuthForm | redirect exchange flow |
| Pricing content invariants | parity + selector contract |
| CheckoutButton + PricingGrid | branch coverage |
| Footer + VerticalLanding | render regression |
| AccountView | 19→33 regression tests |
| Admin utils (kpiC + tableCard) | 18 tests |
| RBAC drift prevention | 4 hardening tests |

### Audit & Gap Analysis

- Full oz-core audit (slices A–D): 40+ findings stamped
- Full oz-payment audit: all 20 production files stamped
- oz-security, oz-crypto, oz-logging, oz-reporting, oz-media audited
- License-server (Go): auth core, rate limit, dashboard, webhooks all reviewed
- Foundation, platform-core, platform-sync all deep-read
- Website audit: login flow, cookie scope, CSP, token handling
- Admin dashboard: rounds 1–10 documented; 40 bugs found and fixed

## CI & Performance

- **wtree-guard.sh:** catches concurrent worktree drift
- **IPC parity gate (F-008/F-050):** verifies registration consistency
- **license-server Go gate:** full suite nightly, short mode on PRs
- **website-tests gate:** vitest suites registered in CI
- CI workflow optimized: PR path filtering, runner tuning, deferred advisory gates
- Website prebuild parallelized, portal sync multi-threaded, vitest workers tuned
- Media pipeline: single decode pass (M-2)
- `test-tdd.sh` fixed for WSL cargo discovery
- Dockerfile prime stages unified

## Documentation

- Audit campaign log: 18 crates fully audited, findings documented
- Admin dashboard review journal: rounds 1–10, 40 bugs tracked
- License-server audit slices A–D documented
- TDD skill updated with shared-worktree drift window
- Unified build time documented in deploy section
- PostgreSQL scaling path documented
- `DATABASE_URL` added to Northflank env table
- AGENTS.md optimized for AI coding agents
- Conventional Commits format enforced
- Skill-drift-guard post-campaign pass clean

## Bug Fixes (Misc)

- KDS column titles wired to translated status keys
- Missing `kds-column-count` Fluent key added to en + id bundles
- `setNativeValue` made polymorphic for input and textarea
- Dashboard `/en/login` 404 redirect resolved + session logout handled
- Login tabs blocked by CSP + cache-bust assets for mobile
- Comment-aware handler parsing in IPC parity gate
- Stale keyboard test fixed for PIN minimum enforcement
