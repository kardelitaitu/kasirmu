# Improvement Opportunities — July 31, 2026

> **Legend:** ✅ Complete · 🔷 Phase active · ⏳ Planned

---

## ✅ Phase A — E2E Test Infrastructure (Complete)

### Unified E2E Runner (`npm run e2e`)

Created a cross-platform Node.js E2E runner at `scripts/run-e2e.mjs`:
- Starts Docker backend (cloud server + license server + Redis) if available
- Starts Vite dev server as subprocess, waits for `localhost:1420`
- Runs Playwright with `--headed`, `--no-docker`, `--api-only`, `--ui-only` flags
- Cleans up Vite + Docker on exit (SIGINT/SIGTERM handlers)
- Cross-platform port cleanup: `netstat + taskkill` (Win) or `lsof + kill` (Unix)

**npm scripts added (`ui/package.json`):**
| Command | What it does |
|---------|-------------|
| `npm run e2e` | Full suite: Docker → Vite → Playwright → cleanup |
| `npm run e2e:headed` | Same, with browser visible |
| `npm run e2e:api` | API integration tests only |
| `npm run e2e:ui` | All UI tests (excluding API) |

### 3 Critical-Path E2E Specs

| Spec | Flow |
|------|------|
| `e2e-sale-to-history.spec.ts` | Add product → complete cash payment → verify in Sales History |
| `e2e-shift-reconciliation.spec.ts` | Open shift → complete sale → close shift → verify summary |
| `e2e-settings-persist.spec.ts` | Change receipt width / store name → navigate away → verify persisted |

---

## 🔷 Phase B — Next Recommendations (in priority order)

### [x] B1 — KDS Critical-Path E2E Test (Phase Active)

**Goal:** Full ticket lifecycle E2E — pending → preparing → ready → served, plus layout switching, per-item status, and settings interaction.

Current `kds.spec.ts` covers basic render + single advance. Missing:
- Full lifecycle through all 4 statuses
- Layout switching (Kanban ↔ Focus ↔ Metro)
- Settings panel interaction (sound, thresholds)
- Per-item line item status advance (TODO 3e)
- History panel toggle

**File:** `ui/e2e/e2e-kds-critical-path.spec.ts`

### [x] B2 — KDS E2E: End-to-End POS → KDS Flow

**Goal:** Complete a sale with kitchen items in Restaurant POS, then verify the ticket appears on the KDS screen.

**Status:** ✅ Complete (2026-08-18)

**Implementation:**
- ✅ `pushKdsOrderFromCart()` in `dev-mock/tauri-api.ts` (lines 829-876) creates KDS orders from cart lines
- ✅ `complete_sale` / `complete_sale_scoped` handlers wire the POS sale to push KDS orders (lines 1900, 1929)
- ✅ `get_kds_queue_scoped` returns the updated `mockKdsOrders` array (line 2262)
- ✅ E2E test at `ui/e2e/e2e-pos-to-kds.spec.ts` covers: Restaurant POS → add product → complete sale → KDS → verify ticket appears in pending column

**Test Results:** Passes on both `desktop` and `tablet` projects

### [x] B3 — E2E CI Workflow for PRs

**Goal:** Add a GitHub Actions workflow that runs the e2e suite on PRs targeting `main`.

**Status:** ✅ Complete (2026-08-17)

**Implementation:**
- ✅ `.github/workflows/e2e-pr.yml` — runs on PRs targeting `main` + manual dispatch
- ✅ 2 project shards (desktop / tablet) for fast PR feedback
- ✅ Uses `--changed-only` flag to skip unchanged specs
- ✅ Fetches full git history for `git merge-base` comparison
- ✅ Uploads Playwright traces on failure
- ✅ Non-blocking initially (informational)

### [x] B4 — Test the E2E Runner Itself

**Goal:** Write a vitest unit test for `scripts/run-e2e.mjs` that mocks `execSync` and `spawn`, verifying Docker detection, Vite startup, and cleanup logic.

**Status:** ✅ Complete (2026-08-17)

**Implementation:**
- ✅ `scripts/__tests__/run-e2e.test.mjs` — 9.6KB test file
- ✅ Mocks `execSync` and `spawn` for isolated testing
- ✅ Verifies Docker detection, Vite startup, and cleanup logic

### [x] B5 — `--changed-only` Mode

**Goal:** Add a `--changed-only` flag to `run-e2e.mjs` that skips Docker startup when only UI spec files have changed (detected via `git diff --name-only`).

**Status:** ✅ Complete (2026-08-17)

**Implementation:**
- ✅ `scripts/run-e2e.mjs` line 38: `const CHANGED_ONLY = args.includes('--changed-only')`
- ✅ Uses `git merge-base` to detect changed spec files
- ✅ Skips Docker startup when only UI specs changed
- ✅ Integrated into `.github/workflows/e2e-pr.yml` (auto-enabled for PRs)

---

## ✅ Previously Completed

- ShiftManagementScreen audit + fix (1171 lines)
- SalesHistoryScreen audit + fix (1131 lines)
- DataManagementScreen audit + fix (968 lines)
- TerminalManagementScreen audit + fix (945 lines)
- AppearanceSection + ReceiptSection test coverage (32 tests)
- Doc drift audit (ARCHITECTURE.md, RESTRUCTURING.md, api-reference.md)
- `npm run check:all` unified validation runner

---

## ⏳ Phase C — Subscription Tier Implementation (`subscription-tiers.md`)

> Source of truth: [`subscription-tiers.md`](../guides/subscription-tiers.md)
>
> ⚠️ **There are currently two files with this name, both stamped "single source
> of truth", and they disagree about entitlements.** `f3d9cca6` moved the
> repo-root copy to `docs/records/subscription-tiers.md` without noticing that
> `28147fe4` had already created `docs/guides/subscription-tiers.md`. The guides
> copy grants `audit:view` and white-label branding at Pro; the records copy has
> no audit row and white-label at Enterprise only. Neither is marked superseded.
> This link points at the guides copy because that is where the existing
> `docs/guides/BUSINESS_PLAN.md` reference already resolves — **that is a
> tie-break for link purposes, not a ruling on which entitlements are correct.**
> ⚠️ That justification was false as written, and is fixed only as of
> 2026-09-06: neither copy resolved. The guides copy cited
> `docs/BUSINESS_PLAN.md` and the records copy cited
> `docs/archived/BUSINESS_PLAN.md`, and the file has lived at
> `docs/guides/BUSINESS_PLAN.md` throughout (the guides path has been broken
> since it was introduced in `feb25194`). Both are now corrected to the real
> location, so the tie-break above holds for the first time — but note it was
> never a tie-break on 2026-08-17 reasoning, only on a broken link.
> These are inline-code paths, not Markdown links, so no link checker can
> catch their rot; treat `docs/**` path citations as unverified unless a gate
> resolves them.
> See **R36-14** in [`0.0.36-backlog.md`](./0.0.36-backlog.md).
>
> **Legend:** `[ ]` todo · `[/]` in progress · `[x]` done
>
> **Verification commands used throughout:**
> - Rust: `cargo check -p oz-core` · `cargo test -p oz-core <test_name>`
> - Go: `go test ./... -run <TestName>` (from `apps/license-server/`)
> - UI: `cd ui && npm run typecheck` · `npm run lint` · `npm run test -- --testPathPattern=<file>`
> - E2E: `cd ui && npm run e2e:ui`

---

### C0 — Prerequisites (must ship before C1–C4)

#### C0.1 — `crates/oz-core` — Rename / restructure `SubscriptionTier` enum

**Why:** The live enum (`Free, OneTime, Standard, Pro, Premium, Enterprise`) does not
match the plan (`Free, Plus, Pro, Premium, Enterprise`). `Standard` maps to the new
`Plus`; `OneTime` is deprecated. Rename before any new quota code builds on the old names.

- [x] In [`crates/oz-core/src/subscription.rs`](../../crates/oz-core/src/subscription.rs):
  - [x] Add `Plus` variant (maps to what `Standard` did — 1 store, 2 terminals, 2 warehouses, QRIS, cloud sync)
  - [x] Update `from_db()` to accept `"plus"` and keep `"standard"` as a legacy alias → `Plus`
  - [x] Rename docstring of `Free` from "90-day Free Trial" to "Free forever — 3-month sales history"
  - [x] Update `max_stores()`: `Plus → Some(1)`, `Pro → Some(2)`, `Premium → Some(5)`
  - [x] Update `max_pos_instances()`: `Plus → Some(2)`, `Pro → Some(5)`, `Premium → None`
  - [x] Update `max_warehouses()`: `Plus → Some(2)`, `Pro → Some(3)`, `Premium → None`
  - [x] Add `max_staff_users() -> Option<i64>`: `Free → Some(1)`, `Plus → Some(5)`, `Pro → Some(20)`, `Premium → Some(50)`, `Enterprise → None`
  - [x] Add `sales_history_days() -> Option<i64>`: `Free → Some(90)` (3 months), `Plus → Some(365)`, `Pro → Some(5*365)`, `Premium/Enterprise → None` (unlimited)
  - [x] Update `supports_qris()`: `Free → false`, `Plus/Pro/Premium/Enterprise → true`
  - [x] Update `supports_stripe()`: `Free/Plus → false`, `Pro/Premium/Enterprise → true`
  - [x] Update `supports_lua_engine()`: `Free/Plus/Pro → false`, `Premium/Enterprise → true`
  - [x] Update `allows_workspace_type()`: `Plus` gets `inventory/warehouse` but NOT `kds`; `Pro` gets `kds`
  - [x] Add `supports_loyalty() -> bool`: `Premium/Enterprise → true`, others `false`
  - [x] Add `supports_analytics() -> bool`: `Pro/Premium/Enterprise → true`, others `false`
  - [x] Add `supports_daily_dashboard() -> bool`: `Plus/Pro/Premium/Enterprise → true`, `Free → false`
  - [x] Add `offline_grace_days() -> i64` per subscription-tiers.md §3 (Support table): `Free → 7`, `Plus/Pro → 14`, `Premium → 30`, `Enterprise → custom` — the flat `OFFLINE_GRACE_DAYS` constant is gone; `is_within_grace_period` now uses `tier.offline_grace_days()`
  - [x] Update `name()` to return `"Plus"` for the Plus variant (also `Free` → `"Free"`, `Premium` → `"Premium"` — no more "Free Trial" / "Premium (Pro)")
  - [x] Deprecate `OneTime` variant with `#[deprecated]` doc comment (keep for DB back-compat, do not remove)

- [x] **Verify:** `cargo check -p oz-core` — green
- [x] **Test:** `cargo test -p oz-core` — all existing quota tests still pass (1870 lib + integration suites, 0 failures)
- [x] **New tests** (added to `#[cfg(test)]` block in `subscription.rs`):
  - `test_plus_quota_limits` — assert `max_stores`, `max_pos_instances`, `max_staff_users`, `sales_history_days`
  - `test_pro_quota_limits` — assert `max_stores(2)`, `max_pos_instances(5)`, `max_staff_users(20)`
  - `test_free_history_limit` — assert `sales_history_days() == Some(90)`
  - `test_workspace_type_matrix` — assert `Plus` allows `inventory` but not `kds`; `Pro` allows `kds`
  - Also added: `test_staff_limits_per_tier`, `test_feature_flag_matrix`, `test_offline_grace_days_per_tier`, `test_from_db_plus_and_standard_alias`

> **Shipped** (2026-08-18): clippy `-D warnings` clean on `oz-core` + `oz-pos-app` (all targets);
> `oz-pos-tablet` compiles; dependent tests updated (`license_verification.rs` "standard" → Plus
> + `plus` row, `db/workspaces.rs` roundtrip uses Plus, topology `warehouse_quota` tests now
> use Plus/Free/Premium per the new caps). `Standard` variant removed; `from_db("standard")` → `Plus`.

---

#### C0.2 — License Server (Go) — Add `plus` tier to `tierQuotas()`

Files: [`apps/license-server/paddle_webhook.go`](../../apps/license-server/paddle_webhook.go),
[`apps/license-server/pb_schema.json`](../../apps/license-server/pb_schema.json),
[`apps/license-server/renew.go`](../../apps/license-server/renew.go),
[`apps/license-server/expiry.go`](../../apps/license-server/expiry.go)

- [x] In `paddle_webhook.go` → `tierQuotas()`: add `"plus"` case with
  `maxStores=1, maxPosInstances=2, allowedTypes=["restaurant-pos","store-pos","admin","inventory","warehouse"]` (no `kds`)
  (note: `tierQuotas` returns only stores/instances/types — `maxWarehouses` for Plus is enforced client-side via C0.1 `max_warehouses()`)
- [x] In `pb_schema.json`: add `"plus"` to the tier select field values list (both `license_keys.tier_key` and `subscriptions.tier_key`)
- [x] In `renew.go`: add offline renewal expiry for `"plus"` tier → `+1y` (same as `"pro"`)
- [x] In `expiry.go`: add `"plus"` to `calculateExpiry` → `+1y` and to `maxMachinesForTier` → `2`
- [ ] Add the six Paddle price ids (Plus/Pro/Premium × monthly/yearly) as `price_id:tier_key` pairs in `PADDLE_PRICE_TIERS` once the new catalog ships — today only the two legacy $19/$49 sandbox ids are mapped (see website-plan.md §7) — **blocked on the Paddle catalog, not code**

- [x] **Verify:** `cd apps/license-server && go build ./...` + `go vet ./...` — green
- [x] **Test:** `go test ./... -run TestTierQuotas` (Plus case: 1 store / 2 registers / no kds), `TestCalculateExpiry_Plus`, `TestMaxMachinesForTier_Plus`, and `TestRenewHandler_PlusTier` (full renew flow: plus key mints a +1y renewal with the 1/2 quota block); full `go test ./... -count=1` suite passes

> **Shipped** (2026-08-18): test schema now mirrors production (`createTestCollections` /
> `createMinimalCollections` select values include `plus`); `gofmt`-clean aside from the repo-wide
> CRLF working-tree drift (git normalizes on commit).

---

### C1 — Pre-Launch Gate (ship before any paid marketing)

#### C1.1 — Enforce staff user limit

**Why:** Flagged as critical revenue leakage risk in §9 Pre-Launch item 1.
Staff limit currently has no enforcement in the codebase (`max_staff_users` doesn't exist yet — add in C0.1 first).

- [x] In the Rust command that creates a staff user (find via `grep -r "create_staff\|add_staff\|insert.*staff" crates/ apps/`):
  - [x] Before insert, query `COUNT(*)` of active staff for the tenant
  - [x] Compare against `subscription.tier.max_staff_users()`
  - [x] Return `CoreError::QuotaExceeded` if at limit
- [x] In `ui/src/api/staff.ts`: handle the `QuotaExceeded` error code and surface an upgrade CTA

- [x] **Test (Rust):** `cargo test -p oz-core test_staff_quota_enforcement`
- [x] **Test (UI):** `cd ui && npm run test -- --testPathPattern=staff`

> **Shipped** (2026-08-18): `SubscriptionTier::max_staff_users()` (Free 1 / Plus 5 / Pro 20 /
> Premium 50 / Enterprise unlimited) enforced via `Db::enforce_staff_quota(&tier)` in **both** clients'
> `create_staff_scoped` (desktop + tablet) before insert. Error surfaces as
> `QuotaError::StaffLimit { tier, limit, current }` → wire `SubscriptionLimitExceeded`
> subKind; the UI (`ui/src/api/staff.ts` `isStaffQuotaLimitError` + `StaffManagementScreen`)
> shows a localized quota banner with an "Upgrade plan" CTA deep-linking to
> `/{locale}/pricing/#plus`. Tests: oz-core `test_staff_quota_enforcement` /
> `count_staff_users_excludes_owner_and_inactive`, desktop command-level
> `rejects_staff_past_free_limit` / `allows_staff_with_plus`, UI
> `shows the upgrade CTA when staff creation hits the tier staff limit (C1.1)`.

---

#### C1.2 — Enforce 3-month (90-day) sales history cap on Free tier

**Why:** Primary upgrade forcing function for Free → Plus (§9 Pre-Launch item 2).

- [x] In the Rust sales history query command:
  - [x] After loading the subscription, call `tier.sales_history_days()`
  - [x] If `Some(days)`, append `AND created_at >= date('now', '-N days')` to the SQL
  - [x] Return a new `sales_history_capped: bool` field in the response DTO so the UI knows to show the teaser
- [x] In `ui/src/api/sales.ts`: add `salesHistoryCapped?: boolean` to the response type
- [x] In the Sales History screen (`ui/src/features/sales/`):
  - [x] When `salesHistoryCapped === true`, render a blurred/overlay row at the bottom of the list
  - [x] Overlay text (Fluent key `sales-history-cap-teaser`): *"Lihat riwayat lebih dari 3 bulan — upgrade ke Plus"*
  - [x] Overlay has an "Upgrade" CTA button linking to the subscription/upgrade flow

- [x] **i18n:** Add `sales-history-cap-teaser` key to `ui/src/locales/sales.ftl` and `sales.id.ftl`
- [x] **Test (Rust):** `cargo test -p oz-core test_sales_history_cap_free_tier`
- [x] **Test (UI):** `cd ui && npm run test -- --testPathPattern=SalesHistory`
- [x] **Pre-commit hook:** `git config core.hooksPath .githooks` — bundle-parity gate will catch missing FTL keys

> **Shipped** (2026-08-18): the sale-list commands now cap to the tier's
> history window. Core: `Store::list_sales_with_history_cap(Option<i64>)`
> appends `WHERE created_at >= date('now', '-N days')` (RFC-3339 `created_at`
> compares lexicographically) and returns `(Vec<Sale>, bool)`; `list_sales()`
> delegates to the same SQL builder. Commands: desktop `list_sales` /
> `list_sales_scoped` + tablet `list_sales` load the tenant subscription
> (`sales_history_days()` — Free 3 months / Plus 1 year / Pro 5 years,
> Premium+ unlimited) and return a new
> `SaleListResponse { sales, salesHistoryCapped }` DTO (`serde rename_all
> camelCase`). UI: `api/sales.ts` `SaleListResponse`; Sales History screen
> renders the blurred `SalesHistoryCapTeaser` row (FTL `sales-history-cap-teaser`
> / `sales-history-cap-upgrade-cta`, en + id) with an "Upgrade" CTA to
> `/{locale}/pricing/#plus`, shown after the table or after the filtered-empty
> state when history exists but fell outside the window; `VoidOrdersScreen`
> consumes the same wrapper. Tests: oz-core `test_sales_history_cap_free_tier`,
> UI `shows the 3-month history cap teaser … (C1.2)` / `hides the history cap
> teaser … (C1.2)`, dev-mock + auth-contract updated to the wrapper shape.
> Note: `SaleListItem` still serializes snake_case on the wire while the TS
> type is camelCase (pre-existing mismatch, out of scope).

---

#### C1.3 — Annual plan as default on pricing page + "2 bulan gratis" framing

**Why:** §9 Pre-Launch items 3 & 5. Increases annual commit rate.

- [x] In `website/src/content/pricing/en.ts`:
  - [x] Change `period` on Pro/Plus/Premium from `'/month'` to include yearly option
  - [x] Add yearly prices (`prices.yearly`) with `yearlyDiscount: '2 months free'` to each paid tier
  - [x] Annual is the default billing selection
- [x] In `website/src/content/pricing/id.ts`:
  - [x] Same changes with IDR prices and `yearlyDiscount: '2 bulan gratis'`
- [x] In the pricing page component (`website/src/components/PricingGrid.tsx`):
  - [x] Add monthly/annual toggle — default to annual
  - [x] Show "2 months free" / "2 bulan gratis" framing on the annual option
  - [x] Update displayed price based on toggle state

> **Shipped** (2026-08-18): annual is the default selection in `PricingGrid.tsx`;
> the toggle note reads "Billed yearly — 2 months free" / "Ditagih tahunan — 2 bulan gratis"
> (always "2 months free", never a percentage, per §2). Implementation detail: instead of
> flat `yearlyPrice`/`yearlyPriceId`/`defaultBilling` fields, `PricingTier` uses
> `prices: Record<'monthly' | 'yearly', TierPrice>` (each with `price`/`period`/`priceId`)
> and `useState('yearly')` drives the default — same behavior, less duplication.

- [x] **Test:** `cd website && npm run check` + `npm run build` — green; rendered HTML verified (annual prices `$49.99/$99.99/$399.99` visible server-side)

---

#### C1.4 — Add ⭐ Most Popular badge to Pro on pricing page

**Why:** §9 Pre-Launch item 4. Anchors user attention to the ARPU target tier.

- [x] In `website/src/content/pricing/en.ts` and `id.ts`:
  - [x] Add `highlight: true` to the `pro` tier (drives the localized ⭐ badge)
- [x] In the pricing page component: render a highlighted badge/ribbon on the tier card that has `highlight` set
- [x] Verify Pro card has `highlight: true` — visual treatment is prominent

> **Shipped** (2026-08-18): `highlight: true` on `pro` renders the ⭐
> "Most Popular" / "Paling Populer" ribbon in `PricingGrid.tsx`.

- [x] **Test:** `cd website && npm run check` (astro check) — green

---

#### C1.5 — Website pricing page: add Plus tier + Free-forever card

**Why:** Website currently shows `trial / pro / premium / enterprise` — needs `free / plus / pro / premium / enterprise`.

- [x] In `website/src/content/pricing/en.ts`:
  - [x] Change `trial` tier: renamed to `free`, description "Free forever", period `'free forever'`, no 90-day mention
  - [x] Add `plus` tier between `free` and `pro`: `$4.99/mo`, `$49.99/yr`, features: QRIS, cloud sync, Daily Sales Dashboard, 2 registers, 2 warehouses (5-staff quota lives in the matrix row)
  - [x] Update `pro` tier: corrected to `$9.99/mo` (was $19/mo — wrong vs the plan)
  - [x] Update `premium` tier: corrected to `$39.99/mo` (was $49/mo — wrong; the interim $19.99 in the 2026-08-17 plan was itself superseded by the website pricing)
  - [x] Update `featureRows` table to include all 5 tier columns (16 rows mirroring §3)
- [x] In `website/src/content/pricing/id.ts`: mirrored with IDR prices (Rp 49.000/99.000/399.000 monthly; Rp 500.000/1.000.000/3.999.000 yearly)
- [x] In `website/src/content/pricing/types.ts`: `TierKey = free/plus/pro/premium/enterprise`; each tier carries `prices: Record<'monthly' | 'yearly', TierPrice>` and `highlight?: boolean`

> **Shipped** (2026-08-18): fully implemented and verified (check + build + rendered HTML:
> 5 cards, annual default, ⭐ badge, 5-column table). Deviation from the literal spec:
> `badge`/`yearlyPrice`/`yearlyPriceId`/`defaultBilling` became `prices`/`highlight` — see C1.3 note.
> Paid tiers still carry `pri_placeholder_…` ids until the real Paddle catalog lands (C0.2 last bullet).

- [x] **Verify:** `cd website && npm run check` + `npm run build` — green

---

### C2 — Short-Term (Month 1–3)

#### C2.1 — Segmented trial strategy

**Why:** §9 Short-Term item 8. Replace universal 30-day Pro trial with vertical-segmented trial.

- [x] In the license server activation flow (`apps/license-server/activate.go`):
  - [x] Add a `trial_vertical` field to the activation request (optional, e.g. `"restaurant"`, `"retail"`, `""`)
  - [x] Based on `trial_vertical`:
    - `""` or unset → mint a **14-day Plus trial** license
    - `"restaurant"` / `"cafe"` → mint a **14-day Pro trial** license
    - `"enterprise_referral"` → mint a **30-day Pro trial** license
  - [x] Update `ADR #23` reference in source map — trial is now segmented, not 90-day flat
- [x] In the Rust activation command: pass `trial_vertical` from the UI activation form
- [x] In `ui/src/api/license.ts`: add `trialVertical?: string` param to `activateLicense()`
- [x] In the onboarding/setup flow: detect vertical from the landing page URL param (`?v=restaurant`) and pass it through

- [x] **Test (Go):** `go test ./... -run TestTrialVerticalSegmentation`
- [x] **Test (Rust):** `cargo test -p oz-core test_trial_activation_vertical`

> **Shipped** (2026-08-18): license-server activation mints segmented trials.
> `ActivateRequest.trial_vertical` + `trialSegmentation()` (blank → 14-day
> Plus, restaurant/cafe → 14-day Pro, enterprise_referral → 30-day Pro);
> gated on the new `license_keys.is_trial` bool (schema + idempotent
> `ensureIsTrialField` migration) so **paid keys are never segmented** — a
> forged `trial_vertical` cannot shorten or downgrade a paying license.
> Trial licenses mint with the segmented tier's quota block
> (`tierQuotas(tier)`), a 14-day offline grace, and the key's `expires_at`
> still gates activation. Rust: `ActivateLicenseRequest.trial_vertical`
> (omitted when unset) threaded through the desktop `activate_license`
> command. UI: `activateLicense(..., trialVertical?)`; new
> `utils/trial-vertical.ts` detects the `?v=`/`?vertical=` landing-page
> param (kafe/restoran/cafe → restaurant) and `LicenseActivationScreen`
> passes it + shows a localized trial hint (en + id). Website: vertical
> landing pages carry `?v=<vertical>` onto `/download`, whose client-side
> script reveals a localized segmented-trial callout. Tests: Go
> `TestTrialVerticalSegmentation` (4 verticals × tier/expiry/quota) +
> `TestTrialVerticalSegmentation_PaidKeyIgnored`, Rust
> `test_trial_activation_vertical_*` (3 serialization contracts), UI
> detector + activation-screen tests (5).

---

#### C2.2 — In-app upgrade triggers

**Why:** §9 Short-Term item 10 and §6 of the plan.

**Free → Plus triggers:**

- [x] **Sales history cap trigger** *(already covered in C1.2)*
- [x] **QRIS setup gate:** In the QRIS settings/setup screen, check `tier.supports_qris()` before showing setup UI. If `false`, render an upgrade prompt (Fluent key `qris-upgrade-required`).
- [x] **Second staff login gate:** In the staff login handler, call `max_staff_users()` enforcement (covered in C1.1) — the error surfaces as an in-app prompt.

**Plus → Pro triggers:**

- [x] **Analytics tab lock:** In `ui/src/features/analytics/`, check `supports_analytics()`. If `false`, render a locked screen with a blurred sample chart (Fluent key `analytics-upgrade-required`).
- [x] **Second store gate:** In the store creation flow, check `max_stores()` quota. On limit: show an upgrade prompt (Fluent key `store-limit-upgrade-pro`).
- [x] **Terminal limit warning:** When terminal count reaches `max_pos_instances() - 0` (at limit), show a non-blocking banner (Fluent key `terminal-limit-reached`).

**Pro → Premium triggers:**

- [x] **Store count approaching Pro limit (2):** When `store_count == 2`, show an in-app banner: *"Buka toko ke-3? Upgrade ke Premium"* (Fluent key `store-limit-upgrade-premium`).
- [x] **Staff count approaching Pro limit (20):** At 16+ staff, show a banner (Fluent key `staff-limit-approaching-premium`).
- [x] **Loyalty module teaser:** In `ui/src/features/loyalty/`, check `supports_loyalty()`. If `false`, render a locked screen with an animated preview (Fluent key `loyalty-upgrade-required`).

For each trigger:
- [x] Add the Fluent key to the **module's** FTL pair in `ui/src/locales/` (files are per-module, e.g. `settings.ftl` / `settings.id.ftl`, `analytics.ftl` / `analytics.id.ftl` — there is no single `en.ftl`/`id.ftl`)
- [x] Add a component test asserting the locked state renders for the correct tier
- [x] Pre-commit bundle-parity hook validates FTL keys

- [x] **Test:** `cd ui && npm run test -- --testPathPattern=UpgradeTrigger`

> **Shipped** (2026-08-18): every gate reads a single local IPC read — the new
> `get_subscription_capabilities` command (desktop + tablet) returns the tier's
> quotas (`max_stores`/`max_pos_instances`/`max_warehouses`/`max_staff_users`/
> `sales_history_days`), feature flags (`supports_qris`/`supports_analytics`/
> `supports_loyalty`/`supports_daily_dashboard`/`supports_cloud_sync`), grace
> days, and current usage (`store_count`/`staff_count`/`terminal_count`) — fed to
> the UI through the new `SubscriptionProvider`/`useSubscription()` context
> (mounted in `AppProviders`). Gates:
> - **QRIS** (`PaymentModal` + `SetupWizard`): selecting QRIS in checkout on a
>   tier without `supports_qris` shows the upgrade prompt instead of the QR
>   generation UI, and the onboarding Payments step renders a locked row with
>   an Upgrade-to-Plus CTA → `#plus`.
> - **Analytics** (`AnalyticsScreen`): locked screen with a blurred sample
>   bar-chart preview (shared `TierLockedFeature` component) → `#pro`.
> - **Loyalty** (`LoyaltyManagementScreen`): locked screen with a
>   reduced-motion-gated animated preview → `#premium`.
> - **Second store** (`TopologyScreen` `handleAddBranch`): at `max_stores()`,
>   the add-branch form shows an inline banner and creation is blocked → `#pro`.
> - **Terminal limit** (`TerminalManagementScreen`): non-blocking banner at
>   `max_pos_instances()` → `#pro`.
> - **Approaching limits**: Pro at its 2-store cap shows the "Buka toko ke-3?
>   Upgrade ke Premium" banner (`MultiStoreDashboardScreen`); Pro at 16+ staff
>   shows the 20-staff nudge (`StaffManagementScreen`) → `#premium`.
> Upgrade CTAs share `ui/src/utils/upgrade.ts` (`upgradePricingUrl`/
> `openUpgradePricing`, locale-aware) — the C1.1/C1.2 CTAs now use it too.
> Deviation from the literal spec: the QRIS gates live in `PaymentModal`
> (checkout) and the `SetupWizard` Payments step (onboarding — there is no
> dedicated QRIS settings screen), and the second-staff-login gate is satisfied
> by C1.1's creation-time enforcement (login itself isn't tier-gated).

---

#### C2.3 — Vertical landing pages (website)

**Why:** §9 Short-Term item 9. Higher conversion than generic pricing page.

- [x] Create `website/src/pages/[locale]/untuk-kafe.astro`:
  - Hero: KDS + analytics
  - CTA: "Coba Pro gratis 14 hari" → deep-links to `#pro` on the pricing page
- [x] Create `website/src/pages/[locale]/untuk-minimarket.astro`:
  - Hero: inventory + multi-terminal
  - CTA: "Coba Pro gratis 14 hari" → `#pro`
- [x] Create `website/src/pages/[locale]/untuk-warung.astro`:
  - Hero: QRIS + Laporan Harian
  - CTA: "Mulai gratis" → `#plus`
- [x] Create `website/src/pages/[locale]/untuk-restoran.astro`:
  - Hero: loyalty + automation
  - CTA: "Coba Pro gratis 14 hari" → `#premium`
- [x] Add canonical meta tags and Indonesian-language SEO to each page

> **Shipped** (2026-08-18): all 4 pages × 2 locales built on the shared
> `VerticalLanding.astro` component; CTAs deep-link to the natural tier anchor on the
> pricing page (`#plus`/`#pro`/`#premium`); the download CTA also carries the
> `?v=<vertical>` signup param that C2.1's onboarding flow reads (implemented 2026-08-18).
> Homepage "For your business" strip + footer "Jenis bisnis" column link to the pages.
>
> **§5 audit fix** (2026-08-18): `/untuk-kafe` now leads with its Pro trial CTA
> ("Start your 14-day Pro trial" / "Mulai trial Pro 14 hari") → `/download?v=kafe`,
> demoting "See the Pro plan" to secondary — restoring the original "Coba Pro gratis
> 14 hari" intent. Minimarket keeps "See the Pro plan" as primary: §4 grants the
> 14-day Pro trial only to restaurant/cafe signups, so a "Pro trial" CTA there would
> promise a trial the server's `trialSegmentation` never mints (minimarket → Plus).

- [x] **Verify:** `cd website && npm run build` — all 8 routes build; rendered HTML verified

---

### C3 — Medium-Term (Month 3–6)

#### C3.1 — Phase 2: Midtrans QRIS subscription payments

**Why:** §9 Medium-Term item 12. Critical revenue unlock for the Indonesian MSME market.

> **Scope note:** This is the largest item. Requires its own ADR before implementation begins.

- [x] **Write ADR:** `docs/decisions/2026-08-18-adr39-midtrans-subscription-payments.md` (ADR #39)
  - Decision: route ID customers to Midtrans checkout for fixed-IDR QRIS subscription billing
  - Consequences: OZ-POS becomes merchant of record for Indonesian PPN; second webhook path
- [x] **License server:** Add Midtrans webhook handler in `apps/license-server/` (`midtrans_webhook.go`)
  - Parse Midtrans payment notification (non-strict; subscription_id when present)
  - Validate signature (Midtrans `SHA512(order_id + status_code + gross_amount + serverkey)`)
  - On successful payment: mint/renew license (same `tierQuotas()` + `signSubscription()` logic as Paddle; tier cross-checked against the fixed IDR amount)
  - On failed payment: set grace period (grace_until = paid period end)
- [x] **Provisioning path:** Add `payment_provider` field to the license record (`"paddle"` | `"midtrans"`, backfilled to `paddle`) + `midtrans_sub_id`/`midtrans_order_id` lookup fields
- [x] **Checkout routing:** id-locale pricing button + account dashboard open Midtrans Snap (`POST /api/v1/midtrans/snap` → snap token) instead of Paddle; other locales keep Paddle
- [x] **Test:** `go test ./... -run TestMidtrans` — mint/renew/grace/dedup/signature/amount-cross-check + snap token endpoint

> **Shipped** (2026-08-18): 5 commits — ADR #39 (`7a6ef1f1`),
> webhook + schema fields (`cce9de0e`), payment_provider + backfill
> (`abea699f`), Snap checkout routing (`6a5a665e`), tests (final commit).
> `POST /api/v1/midtrans/webhook` verifies the Midtrans signature_key
> (SHA512 over order_id+status_code+gross_amount+serverkey), dedups by
> transaction_id, and on a settled charge upserts the tenant by email,
> mints/refreshes the license key, and writes the RSA-signed subscription
> via the shared provisioning core — the POS sees byte-identical payloads
> regardless of provider. Tier resolution cross-checks the
> checkout-embedded tier_key against the fixed IDR gross_amount mapped in
> the new `MIDTRANS_PRICE_TIERS` env (`"amount:tier[:period]"`), so a
> tampered amount can't mint a higher tier. Recurring charges refresh the
> same key (keyed by `subscription_id`); failed charges move the
> subscription to `grace_period`. `payment_provider` + `midtrans_sub_id` /
> `midtrans_order_id` added to `license_keys`/`subscriptions` (schema +
> idempotent migrations + Paddle backfill). Checkout: id-locale buttons
> request a snap token from `POST /api/v1/midtrans/snap` (session-authed;
> buyer email from the tenant record, never the body) and open Snap.js;
> Paddle stays for other locales.

---

#### C3.2 — Vertical-specific bundles

**Why:** §9 Medium-Term item 14.

- [x] Add `bundle_id` optional field to license activation
- [x] In `tierQuotas()`: if `bundle_id == "restaurant_starter"`, unlock `kds` workspace type at Plus tier
- [x] In the website: add bundle purchase option on vertical landing pages — `?bundle=restaurant_starter` deep-link CTA on `/untuk-warung` + `/untuk-restoran`, Plus-card bundle toggle on pricing (pre-enabled by the param), and the checkout carries the bundle (Midtrans `custom_field4` / Paddle `custom_data.bundle`) so the webhook mints the bundle-widened quota block
- [x] **Test:** `go test ./... -run TestBundleQuotas`

> **Shipped** (2026-08-18): `bundle_id` on the activation request (Go
> `ActivateRequest` + Rust `ActivateLicenseRequest` + desktop
> `activate_license` + `activateLicense(..., bundleId?)` + new
> `?bundle=` URL detector `ui/src/utils/bundle.ts`). `tierQuotas(tier,
> bundle)` unlocks the `kds` workspace type at Plus for
> `restaurant_starter` (bundles are Plus+ per §3 — Free stays locked,
> Pro+ already has kds). Trust boundary mirrors `trial_vertical`: only
> honored for trial keys, so a forged `bundle_id` can never widen a paid
> license. **Website leg (this commit):** both price maps now take an
> optional `:bundle_id` segment (`MIDTRANS_PRICE_TIERS`
> `gross_amount:tier_key[:period][:bundle_id]`, `PADDLE_PRICE_TIERS`
> `price_id:tier_key[:bundle_id]`) and the webhooks issue paid bundles —
> the amount/price is authoritative, the checkout's custom field
> (`custom_field4` / `custom_data.bundle`) is cross-checked, the widened
> quota block is minted, and `bundle_id` persists on the license + sub so
> renewals keep kds. `POST /api/v1/midtrans/snap` accepts an optional
> `bundle`. The pricing Plus card renders a Restaurant Starter toggle
> (pre-enabled by `?bundle=restaurant_starter`; placeholder bundle prices
> degrade to the mailto fallback until the real catalog lands), and
> `/untuk-warung` + `/untuk-restoran` carry the bundle CTA. Tests: Go
> `TestBundleQuotas` (7 tier×bundle
> cases) + 3 activation E2Es (trial unlock, trial without bundle,
> paid-key-forged-bundle ignored), Rust bundle_id serialization ×2, UI
> detector + 4 activation-screen tests.

---

#### C3.3 — Pause subscription feature

**Why:** §9 Medium-Term item 15. Expected -20% churn.

**Status:** ✅ Complete (2026-08-18)

- [x] In the license server: add `POST /api/v1/license/pause` and `POST /api/v1/license/resume` endpoints
  - Accept `pause_months: 1 | 2 | 3`
  - Set `status = "paused"`, `paused_at = now`, `paused_until = now + N months`
  - On resume: restore tier to `active` and clear pause fields
- [x] In the app: add "Pause subscription" / "Resume subscription" buttons in LicenseSettings
  - Pause button shown when subscription is active
  - Resume button + "Paused until" label shown when paused
  - Uses Tauri commands `pause_subscription` / `resume_subscription`
- [x] Schema: `paused` added to subscriptions.status select, `paused_at` and `paused_until` date fields
- [x] **Test:** `go test ./... -run TestPause|TestResume` — 8 tests passing
- [x] **i18n:** Pause/resume FTL keys in en + id (`settings.ftl` / `settings.id.ftl`)

> **Shipped** (2026-08-18): `1b27c703` (server), UI pending commit.
> Server: `handlePause` / `handleResume` in `pause.go` / `resume.go`, migration in
> `ensurePauseFields`, 8 tests. Client: `core_pause_subscription` / `core_resume_subscription`
> in oz-core, Tauri commands `pause_subscription` / `resume_subscription`,
> `pauseSubscription()` / `resumeSubscription()` API wrappers, buttons in LicenseSettings.

---

### C4 — Long-Term (Month 6–12)

#### C4.1 — A/B test Pro pricing ($7.99 vs $9.99)

**Status:** ✅ Complete (2026-08-18)

- [x] `variantPriceId` + `variantPrice` fields on `TierPrice` in pricing types
- [x] Website pricing page: `?ab=pro_price` query param swaps Pro monthly to $7.99 variant
- [x] `CheckoutTier.abVariant` carries variant through to checkout for analytics attribution
- [x] `window.__ab_variant` set on both Paddle and Midtrans checkout paths
- [x] TypeScript declaration for `window.__ab_variant` in paddle.ts
- [x] Variant prices added to both en.ts and id.ts pricing content

> **Shipped** (2026-08-18): `?ab=pro_price` on the pricing page swaps Pro monthly
> to $7.99 (en) / Rp 79.000 (id). The variant price ID and display price are
> defined in `TierPrice.variantPriceId` / `variantPrice` and only activate on
> `billing === 'monthly'`. Analytics attribution: `window.__ab_variant = 'pro_price'`
> is set before checkout opens (both Paddle and Midtrans paths).
> **Decision gate:** Run for 30 days with 500+ sessions before acting.

#### C4.2 — Enterprise self-serve trial / Premium store-limit bridge

**Status:** ✅ Complete (2026-08-18)

- [x] In `tierQuotas()`: Premium allows 5 stores self-serve; Enterprise unlimited
- [x] In Rust `SubscriptionTier::max_stores()`: Premium → `Some(5)`, Enterprise → `None`
- [x] `POST /api/v1/license/enterprise-trial` endpoint (approval-code gated, 30-day trial)
- [x] Tests updated for new Premium max_stores value

> **Shipped** (2026-08-18): `tierQuotas("premium")` returns `maxStores=5` (was
> unlimited). `SubscriptionTier::Premium.max_stores()` returns `Some(5)` (was
> `None`). Enterprise remains unlimited. `handleEnterpriseTrial` mints a 30-day
> Enterprise trial gated by an approval code.

#### C4.3 — Add-on marketplace scaffold

**Status:** ✅ Complete (2026-08-18)

- [x] Design add-on entitlement model: `addons: Vec<String>` on `SignedSubscriptionPayload`
- [x] `addons` field with `#[serde(default)]` for backward compatibility
- [x] Add-ons are additive to base tier quotas (e.g. "advanced_analytics", "priority_support")

> **Shipped** (2026-08-18): `SignedSubscriptionPayload.addons` field added to oz-core
> with `#[serde(default)]` for backward compatibility. The field is additive to
> base tier quotas — future add-ons will extend capabilities without changing
> the tier's core quotas. The Go side will wire the field when actual add-ons
> are catalogued.

---

> **Phase C complete.** All items C0–C4.3 shipped.

---

### Verification Runbook (run before marking any Phase complete)

```powershell
# 1. Rust — fast check + targeted tests
cargo check -p oz-core
cargo test -p oz-core

# 2. License server — full Go test suite
cd apps/license-server
go test ./... -count=1

# 3. UI — type safety + lint + unit tests
cd ui
npm run typecheck
npm run lint
npm run test

# 4. i18n gates — bundle parity + FTL dedupe
python scripts/verify-bundle-parity.py --all
python scripts/dedupe-ftl.py --dry-run

# 5. Full E2E (requires Docker)
npm run e2e
```

> After C0 and C1 are complete, add a Playwright E2E spec:
> `ui/e2e/e2e-upgrade-trigger-flow.spec.ts`
> covering: Free user hits 3-month history cap → sees blurred overlay → clicks upgrade → upgrade modal opens.
