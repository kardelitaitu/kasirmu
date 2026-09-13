# Audit Open Findings — Consolidated

> **Source of truth for still-open audit findings.** The per-sector audit
> reports in `audit/` were consolidated into this file (and the sector
> reports removed). Each finding below keeps its original ID so the commit
> history and code comments that reference it still resolve.
>
> Fully-remediated sectors (✅ in the registry) are **not** repeated here —
> their findings are closed by the commits recorded in the deleted reports.
> Only sectors with open or partially-remediated findings survive here.

---

## CRM (`01-crm-module.md` — PARTIALLY REMEDIATED)

**Status:** CRM-01–CRM-11 ALL closed as of 2026-08-31 (CRM-06 was real and fixed same day; the rest verified fixed against current code).

Key items:
- ~~**CRM-02** — Customer listing does not enforce the view permission~~ — **VERIFIED FIXED 2026-08-31** (with one residual closed same day): `list_customers_scoped`/`search_customers_scoped` enforce `customers:view` on both clients (denial-tested). **Residual found and fixed (`7967cc2d`):** the tablet still registered the legacy unguarded `get_customer` (no session, no permission, global db — cross-store read by id); replaced with `get_customer_scoped` (gated, store-scoped, denial-tested on both clients), and the dead legacy UI wrappers were removed so no caller can reach an unregistered command.
- ~~**CRM-03** — Load failures are silently rendered as an empty customer database~~ — **VERIFIED FIXED 2026-08-31**: `loadError` state; the error view replaces the empty state when the list fails to load (`CustomerManagementScreen.tsx:465`).
- ~~**CRM-04** — Delete is immediate and delete failures are invisible~~ — **VERIFIED FIXED 2026-08-31**: `ConfirmDialog` gates deletion (CUST-02) and a localized toast surfaces delete failures (CUST-04), both tested.
- ~~**CRM-05** — "Purchase history" documented but not exposed~~ — **VERIFIED FIXED 2026-08-31**: `get_customer_history_scoped` + in-screen history view with load-failure retry (CUST-05 tested).
- ~~**CRM-06** — Sale-completion aggregation is not idempotent and does not validate currency~~ — **REAL, FIXED 2026-08-31 (`23b78594`+`841448ca`, unsubscription follow-up next commit)**: the handler WAS live — `platform/startup` subscribed `CrmHistoryHandler` to `sale.completed` in both shipping clients (an earlier grep that missed `platform/` produced a wrong "zero production writers" claim, corrected here). So the original bugs were production-real: no idempotency (event re-delivery double-counted spend) and no currency validation (foreign-currency sales added raw). The projection moved into the completion transaction (base currency, statement-level atomic increment, replay-safe via the finalize `changed==1` CAS — idempotency by construction) and `create_refund` reverses it proportionally at the sale-recorded rate (integer round-half-up, floor at zero). The handler's bus subscription is removed with it — running both writers would double-count every sale. 5 tests, Red-first.
- ~~**CRM-07** — Duplicate, incomplete ownership between CRM module and core persistence~~ — **RESOLVED 2026-08-31 by deletion + unsubscription**: the duplicate writer (`modules/crm/src/handlers.rs` + its `platform/startup` subscription) is gone; `Store` completion/refund is the single owner of the spend projection.
- ~~**CRM-08** — Indonesian locale incomplete~~ — **VERIFIED FIXED 2026-08-31**: `customers.ftl`/`customers.id.ftl` at 56/56 key parity, enforced by the i18n lint + bundle-parity pre-commit gates.
- ~~**CRM-09** — Hardcoded English fallbacks~~ — **VERIFIED FIXED 2026-08-31**: screen uses `requiredLocalized`/`getString` throughout; remaining `??` defaults are data values (empty strings, em-dash), not user-facing English.
- ~~**CRM-10** — Row action touch targets below POS minimum~~ — **VERIFIED FIXED 2026-08-31**: `.customer-mgmt-action-btn` carries `min-height/min-width: 2.75rem` (44px).
- ~~**CRM-11** — Test coverage omits failure/authorization/destructive paths~~ — **VERIFIED FIXED 2026-08-31**: 35 screen tests including delete-failure toast, load-failure retry, history retry; command-level permission denial tests on both clients (pre/post `7967cc2d`).

---

## Loyalty (`02-loyalty-module.md` — AUDITED)

**Status:** Loyalty cluster FULLY CLOSED 2026-08-31 — LOY-01 remediated; **LOY-06 CLOSED 2026-08-30** (earn now fires atomically at completion); SF-01 closed with it; **LOY-03 CLOSED 2026-08-31** (proportional refund reversal in-tx; void path proven unreachable + `void_sale` race fixed as CAS); LOY-04 verified fixed; LOY-05 verified fixed.

Key open items:
- ~~**LOY-02** — Earning points is not idempotent by sale~~ — **VERIFIED FIXED 2026-08-30**: migration 128 enforces a unique earn/redeem projection index (`crates/oz-core/src/db/loyalty_tests.rs:556`).
- ~~**LOY-06** (P1) — loyalty earning never fires in production~~ — **CLOSED 2026-08-30**, landed in `3c23e47b` (swept by a concurrent website commit — content verified intact in HEAD; attribution recorded in the journal). Wiring (user decision: backend-atomic, base-currency): `earn_points` refactored into a connection-bound core `earn_points_with_conn` that joins the caller's transaction; `finalize_sale`/`finalize_sale_in_tx` award inside the same tx as the pending→completed transition (`changed == 1` guards replays; unique index guards races); the shortfall retry awards inline. Award uses `base_total_minor` when the CUR-02 snapshot is present (the formula is currency-naive — a low-exponent charge currency would multiply rewards). Failures logged non-fatal: a captured payment never rolls back over points. Pinned by 7 new core tests.
- ~~**SF-01** (P1, found during the LOY-06 sweep) — shortfall retry sales stuck at `pending`~~ — **CLOSED 2026-08-30**, same commit: `complete_sale_with_resolved_shortfalls` wrote `status='pending'` + a 30-min expiry and nobody finalized retry sales — invisible to every report (they filter `status='completed'`) and an auto-void time bomb once the ADR-20 reaper is wired (the reaper is NOT currently wired on either client, so today's symptom is permanent-pending). The retry settles an already-captured payment → now writes `completed`, no expiry, returns `Completed`. Follow-up UX gap (open, minor): the dialog's `onComplete` still doesn't print a receipt the way the main path does.
- ~~**LOY-03** — No refund or void compensation path for earned points~~ — **CLOSED 2026-08-31** (landed inside foreign commit `01d3932e` — swept while committing; content verified intact in HEAD): `create_refund` now reverses `round(award × refund/sale)` **in the same DB transaction**, capped at the not-yet-reversed remainder (cumulative refunds can never claw back more than the award). Ledger row records the full deduction (negative points, type `refund_reversal`, same sign convention as `redeem`); balance floors at zero (spent points aren't dragged negative); lifetime drops → tier demotion recomputes; `customers.loyalty_points` projection maintained. Idempotent per refund via deterministic PK `loyalty-reversal-<refund_id>`. Loyalty failure warns, never blocks the refund (policy matches the LOY-06 award hook). Semantics chosen by the user: proportional reversal. 8 tests (6 unit + 2 wiring). **Void path investigated and CLOSED as unreachable**: the transition table (`foundation/src/enums.rs`) only allows `Active→Voided` — a completed (paid, points-awarded) sale can never be voided, only refunded. That sweep did surface a real race in `void_sale`: the Active pre-check read outside the transaction and the UPDATE had no status predicate, so a concurrent finalize could be overwritten completed→voided; fixed as a compare-and-set (`AND status = 'active'`, explicit rollback on conflict).
- ~~**LOY-04** — Tier updates accept invalid business values~~ — **VERIFIED FIXED 2026-08-31** (registry stale; re-recorded after an earlier close note was lost to a foreign tree revert): `update_tier` runs `validate_tier_config` — empty names, negative thresholds, non-positive `points_per_unit`, non-finite/non-positive multipliers and non-hex colours are rejected, plus unique-threshold and zero-tier invariants; pinned by `update_tier_rejects_invalid_values`.
- ~~**LOY-05** — Load failures are silently presented as stale or empty data~~ — **VERIFIED FIXED 2026-08-31**: `LoyaltyManagementScreen` gates rendering on `loadError` (set from `l10nErrorMessage` in the load catch, rendered before any data view at `:225`); tier-save failures surface via `setError`. Same pattern as the LOAD-cluster compliance (localized error, never silent-empty).

---

## Reporting (`03-reporting-module.md` — REMEDIATED IN PART)

**Status:** security boundary and limit validation implemented; **REP-02/03/04/05/06 ALL CLOSED 2026-08-31** (REP-03 `35f76dc3`, REP-04 cloud parity `88ea4e8c`, REP-05 snapshots `8952c558`, REP-06a pie `0c7f91e1`). Remaining follow-ups recorded below: cloud email timezone parity + the offline-queue drain gap (new architectural finding).

Key open items:
- ~~**REP-02** — Revenue UI combines different currencies into one displayed total~~ — **VERIFIED FIXED 2026-08-30**: per-currency summing in `ui/src/features/reports/revenueTotals.ts` + DashboardScreen/SalesReportScreen tests.
- ~~**REP-04** — Report queries do not show explicit refund/void/net-sales treatment~~ — **CLOSED 2026-08-30** (core `35d8bec4`; UI half landed inside foreign commit `98300bca` — content verified intact, attribution recorded in the journal): refunds never mutate the sale row, so revenue counted refunded sales at full value and the refund ledger was invisible everywhere. Daily/weekly/monthly revenue now aggregate sales and refunds via CTEs joined FULL OUTER on (period, currency) — each row carries `refund_minor` (attributed to the REFUND's own period) + `net_revenue_minor`; refund-only periods produce a row instead of dropping the refund. `refunds_summary` (per-currency count + totals) was added in core but never gained a consumer — **removed 2026-08-31** (the per-period `refund_minor` on the revenue rows already surfaces the same money in the UI; an orphaned query is exactly the dead-code shape CRM-06 proved dangerous — recoverable from `35d8bec4` if a dedicated panel is ever built). Voids were already surfaced (`voided_sales_summary`); net-sales semantics are now explicit in the row fields. SalesReportScreen shows Refunds + Net Revenue rows when the period has refunds.
- ~~**REP-06** — cross-currency SUMs in the remaining report queries~~ — **CLOSED 2026-08-31** (core `38b456bd`, UI `3f9ced5c`): `top_products`, `hourly_heatmap`, `category_breakdown`, `payment_method_breakdown` and `voided_sales_summary` summed minor units across currencies into one number (the REP-02 class below the revenue trends). All five now GROUP BY currency with a `currency` field on every row; category percentages normalize WITHIN each currency; voided summary returns one row per currency; heatmap cells aggregate currency rows (orders sum, intensity tracks the display currency, labels list every amount); the refunds analytics card + its CSV are per-currency. **Follow-ups recorded:** (a) ~~the category PIE still compares slice areas across currencies — visual-semantics decision needed (per-currency pies vs currency filter)~~ — **CLOSED 2026-08-31 (`0c7f91e1`)**: per-currency tabs on the pie card (display currency default, strip only when the range spans currencies) + the CSV gained its missing currency column with per-row currency formatting; (b) ~~cloud `email_pg.rs` mirrors the old single-currency shapes AND lacks REP-04 refund netting — parity slice~~ — **CLOSED 2026-08-31**: the cloud already had the REP-06 per-currency shapes (note was stale; `4b8a630e`), REP-05 erasure fixed same-day, and **REP-04 netting landed in `88ea4e8c`** — the earlier "cloud schema has NO refunds table" note was WRONG: `refunds` existed in `init.pg.sql` all along (the prior grep had searched only `apps/`, missing `crates/oz-core/migrations/`); the real gaps were `tenant_id`, RLS policy, oz_app grants, cutover coverage and query wiring — all closed. `daily/weekly/monthly_revenue_pg` now mirror the local FULL OUTER netting semantics (PG rejects the correlated COGS subquery over ungrouped outer columns — E42803 — so COGS moved to a pre-aggregated CTE). **Still open:** the forecast queries (`category_popularity_pg`, `category_means_pg`) still INNER JOIN products (advisory consumers, deliberately not expanded); cloud email reports bucket in UTC — per-tenant timezone config does not exist in the cloud schema (REP-03 parity follow-up, needs a tenant-level setting + the same offset-string contract).
- ~~**REP-05** — Current product/category joins can erase or rewrite historical sales attribution~~ — **ERASE HALF CLOSED 2026-08-31 (`cd4bdaa8`)**: `top_products`/`category_breakdown` INNER JOINed the mutable products table — deleting a product silently erased its historical sales from both reports (totals stopped reconciling; the category pie inflated surviving slices). Both LEFT JOIN now: deleted products keep revenue under their stored sku and bucket into Uncategorised. **Rewrite half remains open as a design item**: renames/category moves still retroactively change historical labels because `sale_lines` stores only `sku` — fixing it needs sale-line snapshot columns (name/category at sale time), a backfill for legacy rows, and cloud-sync parity; deliberately not smuggled into this slice. **REWRITE HALF CLOSED 2026-08-31 (`8952c558`)**: `sale_lines` gained snapshot columns (`product_id`, `product_name`, `category_id` — migration `20260826_sale_line_snapshots.sql` with best-effort backfill from current products for legacy rows; PG init + cloud `create_sale` + the cutover copy tool in parity). `insert_sale_line` resolves all three in its existing single product lookup. Both reports read snapshot-first with the products join as legacy fallback — renames, category moves and sku reuse now keep every sale era on its own correctly-labelled row (5 new core tests, incl. the flipped deleted-product semantics: a snapshot keeps its TRUE category instead of bucketing to Uncategorised).
- ~~**REP-03** — Date boundaries have no store-timezone contract or input validation~~ — **CLOSED 2026-08-31 (`35f76dc3`)** per the design below, with one correction to the sketch: IANA names are NOT resolved (no `chrono-tz` dep) — the stored contract is a fixed offset string `'+HH:MM'`/`'-HH:MM'` (schema default `'UTC'` normalized to `'+00:00'`; anything unparseable falls back to UTC so a misconfigured store never silently shifts money buckets). The `UTC`→`+00:00` normalization is load-bearing: SQLite 3.45 (rusqlite bundled) treats the `UTC` *modifier* as a local→UTC conversion on bare values — `DATE('now','UTC')` shifted a whole day in tests; 3.50 behaves differently; `±HH:MM` is pure arithmetic and version-stable. Threaded through ALL date-bucket queries at once: 14 `reports.rs` functions incl. the REP-04 refund CTEs, `analytics.rs` staff series, `popularity.rs` trend (scoring decay windows stay UTC by design — rolling windows, not calendar buckets), `sales.rs` today-exports (both sides of the comparison shifted) and `shifts.rs` hourly labels (window filter stays on absolute instants). Boundaries validated as strict YYYY-MM-DD (SQLite silently NULLs garbage — a mistyped bound used to vanish rows instead of erroring). UI submits store-local boundary dates: `rangeForGranularity`/`cardRange`/presets/custom defaults anchor to the primary store day via `getPrimaryStoreScoped` (device-local legacy until the profile loads). **Open residual:** no settings UI exists to edit `store_profiles.timezone` (API + SQL only — the field had no editor before this slice either); cloud email tz parity needs a per-tenant setting (recorded above).
- **ARCH-01 (new, found during the REP-04 cloud parity sweep 2026-08-31)** — POS terminals push offline_queue items to `/api/sync/push`, but the cloud stores them **store-and-forward with NO runtime drain into `sales`/`sale_lines`/`refunds`**: the cloud revenue tables are populated only by the `migrate_sqlite_to_pg` cutover tool and the REST `POST /api/v1/sales` path. Consequence: terminal sales and refunds never appear in cloud email reports — those reflect only cloud-owned (REST-created + cutover-copied) data. The approved "sync refunds to Postgres" premise for the netting slice was therefore WRONG as stated; slice 2 was honestly rescoped to cutover-copy coverage (refunds added to `DEFAULT_TABLES` + `tenant_id`/RLS/grants) + faithful query netting. **The drain gap is a separate architectural decision (who owns the write path, idempotency, tenant attribution of queued rows) — deliberately NOT silently fixed here.**
- Also: stale-request races, unbounded custom-report results, CSV escaping

---

## Currency (`04-currency-module.md` — PARTIALLY REMEDIATED)

**Status:** IPC fixed-point contract aligned; **settlement, command scoping, and remaining UX/validation findings require follow-up**.

Key open items:
- ~~**CUR-02** — PaymentModal displays converted currency but settles the base currency amount~~ — **VERIFIED FIXED 2026-08-30**: tender snapshot (base currency / base total / fixed-point rate) flows PaymentModal → `complete_sale*` args → `Sale` → SQLite (`20260821_tender_currency.sql`) and is now also persisted to the cloud (`pg::create_sale`, commit bc8bb29c — the PG INSERT had silently dropped all five tender/tip/service columns that `pg::get_sale` reads).
- ~~**CUR-04** — PaymentModal chooses the first matching rate without selecting the effective historical rate~~ — **CLOSED 2026-08-31 (`3ff5db6f`)**: the session path already asks the backend for the latest rate effective as-of today (`get_latest_exchange_rate_scoped` → `effective_date <= as_of ORDER BY effective_date DESC` — correct); settlement itself is snapshot-based by design (tender stores the payment-time fixed-point rate, CUR-02). The residual was the no-session fallback: `list_exchange_rates` ordered only by pair, so `find()` could surface the oldest-inserted rate — now newest-effective-first within each pair (Red-first backfill test).
- ~~**CUR-05** — Exchange-rate input and effective-date validation is incomplete~~ — **VERIFIED FIXED 2026-08-30** (see Currency section: validators on both clients + UI gating + `type="date"`; registry entry was stale).
- ~~**CUR-06** — Default-currency command scope~~ — **CLOSED 2026-08-30**, commit `aa1f831f` (backend scoping existed; `ExchangeRateScreen` was the un-migrated UI consumer — now routes through `*_scoped` APIs).
- ~~**CUR-10** — missing delete confirmation~~ — **VERIFIED FIXED 2026-08-30** (`ConfirmDialog` before delete, pinned by tests). **CUR-09/CUR-11** remain open (locale/theme gaps; bounded-rate API + e2e coverage).
- Currency exponent-aware settlement rounding and a lossless string/decimal IPC representation for values beyond JavaScript's safe integer range

---

## Staff (`06-staff-module.md` — PARTIALLY REMEDIATED)

**Status:** security-critical staff IPC paths closed; **residuals documented**.

Key residual items:
- **STAFF-13 (partially)** — Security-focused command tests and wiring tests cover session binding, two-store identity, role hierarchy, PIN rotation/invalidation, rate limits… (remaining coverage gaps documented in the deleted report)
- ~~Deactivate/Restore flow: … backend does not prevent self/last-owner deactivation~~ — **backend half VERIFIED FIXED 2026-08-30** (registry stale): `enforce_role_assignment_policy` on BOTH clients' scoped commands blocks self-role change, self-deactivation (STAFF-10), and deactivate/demote of the last active Owner (STAFF-02), plus Owner-only promotion; legacy unscoped staff commands are hard-disabled. Branch-pinning tests added (`d45d1119`: each guard exercised in isolation with exact-message asserts — the pre-existing last-owner test was satisfied by either branch). ~~**Remaining (UI, open):** no confirmation dialog, no per-row pending state.~~ — **VERIFIED FIXED 2026-08-31**: deactivation requires a named `ConfirmDialog` (STAFF-10 comment in `StaffManagementScreen.tsx:591`), the dialog carries `loading={deactivating}` (busy state, cancel guarded mid-request), and reactivation is the only no-confirm path by design. STAFF-13 is now FULLY CLOSED (command tests both clients + UI flow). ~~**Coverage gap noted:** the tablet's duplicated policy copy has NO command-level tests~~ — **CLOSED 2026-08-31 (`34e84fb4`)**: the tablet now carries the full branch-pinned set (7 command-level security tests incl. both exact-message branch pins); all passed first run — the duplicated policy was genuinely enforced, the gap was coverage only. The registry's claim that "tablet test infra lacks a scoped-state helper" was stale: the customers_tests pattern ports directly.

---

## Loading States (`23-loading-states.md` — AUDITED)

**Status:** **ALL CLOSED — verified fixed 2026-08-31** against current code; a dedicated guard test (`__tests__/loadingStateCompliance.test.tsx`) now enforces the patterns.

- ~~**LOAD-01** — Two separate Skeleton components~~ — **VERIFIED FIXED**: single canonical `frontend/shared/Skeleton.tsx`; `components/Skeleton.tsx` is a documented 9-line compatibility re-export so 40+ importers share one source of truth.
- ~~**LOAD-02** — Load failures silently become an empty screen~~ — **VERIFIED FIXED**: sampled failure paths (ShiftBar, StockCountDetail, KdsProductPickerModal, CustomerManagement) all surface localized error toasts or error states; compliance test guards the pattern.
- ~~**LOAD-03** — Demo-data fallbacks mask production failures~~ — **VERIFIED FIXED**: no demo-data path remains in any data-loading screen (analytics card states it explicitly); remaining "demo" hits are the intentional DesignSystem showcase pages.
- ~~**LOAD-04** — Initial-load vs refresh semantics (KdsScreen)~~ — **VERIFIED FIXED**: `KdsScreen` gates the skeleton on `initialLoading` only; refreshes update the live board in place.
- ~~**LOAD-05** — Progress not announced~~ — **VERIFIED FIXED**: shared `LoadingStatus` (role=status, localized label) wraps decorative skeletons; 11 screen usages + compliance test.

---

## Topology — Rust (`30-topology-rust.md` — ⚠️ 8 FINDINGS, OPEN)

**Status:** **ALL CLOSED — verified fixed 2026-08-31** (TOP-01→TOP-08).

- ~~**TOP-01** — Raw control bytes in test string literals~~ — **VERIFIED FIXED**: no control-byte literals remain; `topology_setting_key` now REJECTS control chars (dedicated tests: `..._control_chars_rejected`, `..._rejects_path_injection`).
- ~~**TOP-02** — Setting-key constant duplicated across three modules~~ — **VERIFIED FIXED**: single home in `topology/model.rs` (`TOPOLOGY_SETTING_KEY`, `TOPOLOGY_RUNTIME_SETTING_KEY`, `TOPOLOGY_APPLY_*`, `TOPOLOGY_SCHEMA_VERSION`), consumed via `pub(crate)`.
- ~~**TOP-03** — Duplicated paragraph in `load_topology_data` doc~~ — **VERIFIED FIXED**: doc is a single coherent explanation (load-side raw-port faithfulness + healing rationale), pinned by `load_topology_data_preserves_raw_legacy_null_ports`.
- ~~**TOP-04** — `save_topology_data` duplicated structural validation~~ — **VERIFIED FIXED**: save calls the shared `validate_topology_structure` (persistence.rs:726); the comment records the drifted inline copy's removal.
- ~~**TOP-05** — Legacy typed API production-dead~~ — **VERIFIED FIXED**: `save_topology_data`/`load_topology_data` are now `#[cfg(test)]`-gated test-compat helpers; production flows through `apply_topology_diff` only.
- ~~**TOP-06** — Missing doc comments~~ — **VERIFIED FIXED**: sampled items (`default_direction`, `topology_apply_request_key`, `persist_topology_recovery`) all carry doc comments.
- ~~**TOP-07** — O(n²) scans in validation core~~ — **VERIFIED FIXED**: membership checks use prebuilt sets (`workspace_id_set.contains`, `warehouse_ids` via set lookups).
- ~~**TOP-08** — File-size watch items~~ — **NO ACTION**: `persistence.rs` 786 lines (under the 1,000 cap); test files within the module's cited guideline. Watch item only.

---

## Money — Frontend (`32-money-frontend.md` — FULLY REMEDIATED)

**Status:** FRONTEND-01/02/03/04 all closed (04 found + fixed during the FRONTEND-03 sweep, 2026-08-30).

- **FRONTEND-01** — PaymentModal charge-amount row inflates by base exponent (P1, FIXED)
- **FRONTEND-02** — usePosState silently mixes currencies in the subtotal (P1, FIXED)
- ~~**FRONTEND-03** — IPC boundary drops line currency (P2, **DEFERRED to Phase 5 — open, needs backend change**)~~ — **CLOSED 2026-08-30**, commit `fc8eae22`: `AddLineArgs.unit_price_currency` (optional, wire-compatible) added on desktop + tablet; commands build the line in the wire currency so `Cart::add_line`'s (previously dead) mismatch check rejects cross-currency lines; invalid ISO codes fail closed. PaymentModal sends `line.unit_price.currency` on both sale paths. Pinned by tablet e2e (EUR line into USD cart → Err) + desktop serde-shape/helper tests + UI contract tests. Follow-up also **CLOSED 2026-08-30**, commit `4439cfa3`: `CartLineData.unit_price_currency` in `complete_sale_with_resolved_shortfalls_scoped` (both clients) — same helper pattern, same fail-closed parse; PaymentModal's shortfall-dialog mapping sends the line currency, dialog passthrough pinned by test.
- ~~**FRONTEND-04** (P2, found 2026-08-30 during the FRONTEND-03 sweep) — multi-currency charge + stock shortfall settles the second command in the WRONG currency~~ — **CLOSED 2026-08-30**, commit `0e5e8bf9`. Semantics decision: the retry must settle in the SAME currency the first command used (charge currency) — it is a retry of the same sale. Fix (UI-only; the Rust struct already accepted all five CUR-02 fields): CUR-02 tender metadata lifted into a shared `tenderSnapshot` memo used by the QRIS path, main path, and shortfall dialog; dialog now receives `lineItemsInCartCurrency` + `cartCurrency` + `effectiveTotalInCartCurrency` + `tenderedMinorInCartCurrency` and forwards tip/service/base fields into the retry args. Pinned by a multi-currency e2e (USD cart → IDR charge at 16500: retry payload currency IDR, converted line amounts, baseCurrency/baseTotalMinor/tenderRateMillionths) + single-currency tip/service pin (previously the retry recorded tip=0/service=0 even without multi-currency).

---

## Money — TDD sweep (`MONEY-01..05` — CLOSED 2026-08-31; residual LOYALTY-01 also CLOSED)

A `/tdd` pass over the money area (foundation `money.rs` came back exemplary — deep-audited, property-tested, no change needed; the weaknesses were all in the UI conversion/input edges and one daemon cast):

- ~~**MONEY-01** — PaymentModal tender conversion mis-rounded .5 boundaries~~ — **FIXED `79247c92`**: the conversion chain (`baseMinor/10^exp × float-rate × 10^exp`) turned exact decimal halves into float values slightly below the tie — brute-forced counterexamples: 0.03 USD @ 149.5 → 448 instead of 449, 0.41 → 6129 vs 6130. Replaced by `convertMinorUnits` (BigInt, half-up toward +∞, inverse-pair aware via an `inverted` flag) + `reciprocalMillionths` for the persisted `tender_rate_millionths` (the snapshot now carries the ORIGINAL integer, not a float round-trip). 11 unit tests.
- ~~**MONEY-02** — every user-entered money field parsed with `Math.round(parseFloat(s) × 10^scale)`~~ — **FIXED `89589dae`**: "1.005" USD → 100 cents (exact: 101); parseFloat also swallowed "1e3" → 1000 and "1,500" → 1 on free-text fields. `parseMinorUnits` (strict decimal regex + BigInt scaling + half-up) migrated to all sites: tender, split amounts (×3), rate editor (scale 6), shift balances, staff pay (garbage → absent, not NaN). 12 unit tests.
- ~~**MONEY-03** — rate-sync daemon cast untrusted API floats with saturating `as i64`~~ — **FIXED `6736fb02`**: a `1e300` response became `i64::MAX`, which PASSES the repo's `>0` validation and persists. `rate_to_millionths` now rejects non-finite/non-positive/≥1e10/sub-resolution before the cast; rejected rows warn+skip. 6 unit tests.
- ~~**MONEY-04** — Rp discount tab hardcoded ×100~~ — **FIXED `46fd1ab0`**: for IDR (exponent 0) the ratio inflated 100× — Rp 2,000 off Rp 100,000 computed pct=200 → `setDiscount` clamps → **100% off, free goods**. Now scales by `minorUnitExponent(subtotal.currency)`. Red test pinned first (the tab had zero coverage).
- ~~**MONEY-05** — shift open/close balances hardcoded ×100~~ — **FIXED `46fd1ab0`**: `opening_balance_minor` is store-currency minor units; every IDR drawer count was stored 100× inflated, breaking `expected_cash` reconciliation. Now scales by `minorUnitExponent(storeSettings.currency)`. The old test PINNED the bug (100000 → 10000000); corrected.
- ~~**LOYALTY-01 (OPEN)** — `db/loyalty.rs` computed `points = ((base as f64)/100 × earn_multiplier).round() as i64` with the multiplier stored as `REAL`~~ — **CLOSED 2026-08-31**, commits `803f6239` (core) + `02b264cd` (UI): the multiplier is now **fixed-point millionths** end to end (`earn_multiplier_millionths INTEGER`, the repo's own `rate_millionths` precedent). Evidence that justified it: exhaustive scan (double vs exact-decimal, half-away) — multiplier 1.4 flipped at 585 bases ≤ 2,000,000, e.g. base=2250 (a $22.50 sale at points_per_unit=1): float 31.499999999999996 → 31 points where exact decimal gives 32, always DOWNWARD for 1.4; 1.1/1.2/1.3/1.5/1.75/2.0 never flipped in range (1.5/1.75/2.0 binary-exact; the others' error snaps back at the tie — which is why the seeded tiers 1.0/1.25/1.5/2.0 hid this for so long). The corruption was at WRITE time (UI JS number → f64 IPC → REAL column), so no compute-site patch could recover intent. Fix: migration `20260831_loyalty_multiplier_fixedpoint.sql` (drop triggers → ADD COLUMN → backfill `CAST(ROUND(old × 1e6) AS INTEGER)` → DROP COLUMN → recreate triggers; no table rebuild, the `loyalty_accounts.tier_id` FK is never disturbed), `compute_points()` exact i128 half-up toward +∞, DTO/wire rename to `earn_multiplier_millionths`, tier editor parses via `parseMinorUnits(x, 6)` and displays via `millionthsToDecimalString` (integer-only). Postgres intentionally untouched — the cloud has no loyalty code path and `init.pg.sql` is a generated artifact. 5 new Rust tests (boundary grid, extremes saturate, end-to-end $22.50→32, legacy backfill, seeded-tier exactness) + 3 UI tests (prefill "1.25", save 1_400_000, zero rejected).
- **Test hygiene fallout (CLOSED `0ffdd2c3`)** — the full-suite run surfaced 6 tests red at HEAD *before* the money batch: the scoped-IPC audit (`5e0d4caa`) and REP-06 shipped without updating RefundModal (wire object dropped `userId`; token is arg 0), VoidOrdersScreen (`voidSaleScoped` positional), a11yTransitions (StatusBar's scoped offline call), and AnalyticsScreen ×2 (category fixture missing the REP-06 row currency — `Intl.NumberFormat` currency-style throws on a missing code; CSV export predates the REP-06a currency column). The ERR-10 compliance whitelist pinned PaymentModal line numbers and drifted under MONEY-01/02 — now content-anchored with a per-entry sanity check.

---

## Currency — Exchange & Settlement (`34-currency-exchange.md` — MOSTLY REMEDIATED)

**Status:** CUR-02/03/04/05/06/08/10/11 closed; **CUR-09 remains open** (locale/theme gaps, low value). Design-recommendation leftovers also landed 2026-08-31: shortfall-receipt preview parity (`8f79bd43`) and CurrencyContext refresh + workspace bridge (`319f03dd`).

- ~~**CUR-02** (P0) — PaymentModal displays converted currency but settles the base currency amount (multi-currency settlement)~~ — **CLOSED 2026-08-30** (see Currency section: local snapshot verified in code; cloud persistence gap in `pg::create_sale` fixed, commit bc8bb29c, pinned by the PG roundtrip test).
- ~~**CUR-05** (remaining) — exchange-rate input / effective-date validation residuals~~ — **VERIFIED FIXED 2026-08-30** (registry was stale): `validate_create_rate_args` on desktop AND tablet (shared by legacy + scoped paths) rejects non-positive rates, same-currency pairs, non-ISO-4217 codes, and malformed `YYYY-MM-DD` effective dates; UI side `ExchangeRateScreen` gates Save on the same conditions incl. the millionths conversion (exact `parseMinorUnits(form.rate, 6)` since MONEY-02), and the date field is `type="date"` (browser-enforced format). Pinned by `exchange_rates_tests.rs` (zero/negative, same-pair, non-ISO, malformed-date, valid-input).
- ~~**CUR-06** — default-currency command scope~~ — **CLOSED 2026-08-30**, commit `aa1f831f`: backend scoped variants (`get/set_default_currency_scoped`, rate commands) already enforced `SETTINGS_READ`/`SETTINGS_EDIT` + store resolution with ISO validation on set; the residual was the UI — `ExchangeRateScreen` still called the legacy global-DB APIs for list/create/delete. Now routes through the `*_scoped` wrappers whenever a workspace session exists. Pinned by 3 new tests (token passthrough + legacy-not-called).
- ~~**CUR-10** — missing delete confirmation~~ — **VERIFIED FIXED 2026-08-30**: `ExchangeRateScreen` renders a `ConfirmDialog` (`currency-delete-confirm`, danger variant) before `deleteExchangeRate`; pinned by the delete tests.
- **CUR-09** — locale/theme gaps (unverified; low value, left open)
- ~~**CUR-11** — bounded/latest-rate APIs + e2e coverage~~ — **CLOSED 2026-08-31** (`8f026449` + `41598afa`): `CurrencyRepository::list_latest_exchange_rates` returns one row per pair (newest `effective_date`; `UNIQUE(pair, date)` makes ties impossible, `created_at`/`rowid` tail is defence in depth — `rowid`, not `id`, because rate ids are UUIDs), exposed as `list_latest_exchange_rates_scoped` on both clients behind `SETTINGS_READ`, and wired into the PaymentModal currency load (the picker needs current rates per pair, not the history; the rate editor keeps the full list). Playwright coverage added as a SCREEN-CONTRACT spec (route, columns, Save gating incl. same-pair rejection, CUR-10 delete-confirm) — the e2e run surfaced that **the exchange-rate commands have no cloud REST counterpart** (web/e2e mode serves them from the dev-mock; real CRUD is impossible there), an ARCH-01-family gap recorded rather than silently extended.
- ~~**ARCH-01-family: rate REST gap**~~ — **CLOSED 2026-08-31** (`5b0f1662` + this batch): `crates/oz-api` gained the full rate surface mirroring the scoped IPC commands 1:1 — `GET /api/v1/exchange-rates` (CUR-04 order), `GET …/latest` (CUR-11), `GET …/latest/{from}/{to}` (case-insensitive), `POST …` (CUR-05 validation shared via `pg::validate_exchange_rate_request`), `DELETE …/{id}`. Dual-path like tax-rates: PG helpers in `pg.rs` (unique→409, FK→400) or SQLite fallback via `CurrencyRepository` with an explicit duplicate pre-check (the repo surfaces the constraint as a raw Db error). Rates are global reference data in the cloud schema (no `tenant_id`, no RLS — same treatment as categories). OpenAPI spec + protected-route assertions updated; 11 route tests + live-PG roundtrip + real-CRUD e2e (`api.spec.ts`, per-worker dates to survive parallel projects).
- **UUID-vs-rowid tiebreaker sweep — CLEAN 2026-08-31**: every other `ORDER BY … id` recency pattern was checked. `audit_log` (`created_at DESC, id DESC`) and `offline_queue` (`created_at ASC, id ASC`) are safe — both ids are UUID **v7** (time-ordered); `prune.rs` `ORDER BY id` is batch stability, not recency; `recipes`/PO-lines/transfer-lines `ORDER BY id` is listing order. `exchange_rates` was the only genuine trap (mixed id lineage possible) and it already pins `rowid` in SQLite / relies on `UNIQUE(pair, date)` in PG. No code change needed.
- **.env poison — HARDENED 2026-08-31**: six Paddle note-lines with spaces in keys (`PADDLE PROD IDS = …`) broke `docker compose` for the whole e2e stack with the terse `failed to read .env: line 21: key cannot contain a space` (the root `.env` is untracked — the poison was local-only, commented out on discovery). Hardened with `scripts/validate-env.mjs` — a quote-state-aware dotenv validator (handles the real multi-line PEM value without false positives) wired as a pre-flight in `run-e2e.mjs startDocker()`, so the next poisoned line fails fast with every offending line numbered instead of dying inside compose. `.env.example` verified clean.
- **Foreign breakage at HEAD — RESOLVED UPSTREAM + VERIFIED 2026-08-31**: the unused-`total` warning in tablet `pos.rs` (`192c5bc6`) and the nine red PaymentModal tests were fixed by the PROMO-3 owner's follow-up `100dcdef` mid-repair. Verified at the gate rather than assumed: fresh `cargo check` warning-free, `cargo clippy -p oz-pos-tablet -p oz-api --all-targets` clean, payment family 99/99 green.
- **Leftovers landed 2026-08-31 (design batch, not numbered findings):** shortfall-resolved sales now show the same receipt print preview as the normal path — `StockShortfallDialog` forwards the `CompleteSaleResult` and the modal builds items from the COMMITTED sale lines (resolutions change what sold; the local cart no longer does); `CurrencyProvider` gained `refresh(token?)` (scoped per-store default when a session exists, global bootstrap otherwise, errors keep the last good value) plus a `CurrencyWorkspaceSync` bridge below `WorkspaceProvider` in both entries — per-store defaults (CUR-03 commands) now reach `useCurrency` consumers without a page reload.

---

## Refund guards — `create_refund` (rust-auditor COR-25/COR-26 — CLOSED 2026-08-30)

- ~~**COR-25** (MEDIUM) — over-refund guard ran outside the transaction and read the cumulative refunded SUM with `.unwrap_or(0)`: a read error read as "zero refunds" and the money guard failed OPEN~~ — fixed: guard inside the tx, SUM errors propagate (`crates/oz-core/src/db/refunds.rs`, commit 8f01a5d0; regression test `over_refund_guard_fails_closed_when_cumulative_sum_unreadable`).
- ~~**COR-26** (LOW) — refund currency never compared to the sale currency~~ — fixed: `create_refund` rejects a mismatch with `CoreError::CurrencyMismatch` (commit a53feaea; regression test `create_refund_rejects_currency_mismatch`).

## PG integration harness — silently-skipped tests (CLOSED 2026-08-30)

`throwaway_test_pool` built DB names from UUID `Display` (hyphens) inside an
unquoted `CREATE DATABASE` identifier → server syntax error → every
throwaway-DB PG test (REST roundtrip, RLS non-owner, concurrent adjust,
sync-store) printed "skipped" and reported PASS — cloud money-path coverage
was silently zero. Fixed with `.simple()` hex names + probe connections
retargeted to the throwaway DB (commit a022b4fb). **Verified live: oz-api
198/198 and oz-cloud-server 224/224 with ZERO skips.** Residual risk: on
machines/CI without PG the skip is still quiet (PASS) by design.

---

> **Path currency (added 08-09-26).** Entries below are dated findings and are not
> rewritten — a finding that named `ui/src/features/stores/` on 2026-08-26 named the right
> directory then. Two renames since then make several paths dead: `ui/src/features/stores/`
> is now `ui/src/features/locations/`, and the `StoreProfile` type (and the `store` →
> `location` vocabulary around it) is now `LocationProfile` in
> `crates/oz-core/src/location_profile.rs`. `docs/api-reference.md` is now
> `docs/guides/api-reference.md`. Nothing else in these entries should be read as a
> current path without checking.

## Topology — Editor UI (`31-topology-editor-ui.md` — ✅ ALL CLOSED 2026-08-26)

**Status:** **all 7 findings repaired in one commit** (TOP-UI-01→TOP-UI-07). Audit of
`ui/src/features/stores/` (33 production files, ~12k lines) + docs. No blocking
findings; verdict was "solid code, stale docs".

Closed items:
- **TOP-UI-01** — ADR #34 pairing table listed 8 rows; shared contract (`topologySemantics.json`,
  frontend + Rust `include_str!`) implements 7. `location-out → operation-in` removed from the
  ADR table with an explanatory note; parent ADR #34 §Slice 1 corrected to match.
- **TOP-UI-02** — ADR #34 audit stamp (09-08-26) predated 12-08-26 sections; new sections
  re-verified during this audit, stamp refreshed to 26-08-26.
- **TOP-UI-03** — ADR #34 cited `topologyCard.ts` as the pairing-table home and row order that
  drifted from the JSON; doc now references `topologySemantics.json` and matches row order.
- **TOP-UI-04** — `docs/api-reference.md` missing `can_save_topology` command; row added.
- **TOP-UI-05** — `topology.rs` module doc said "four #[tauri::command]" but only 3 exist
  (the 4th is a startup daemon); comment corrected to "three".
- **TOP-UI-06** — 4 pre-existing `topologyNodeCard.test.tsx` failures (validation text renders
  twice: tooltip + SR-only span; dismiss button hidden in the tooltip portal); tests now query
  `getAllByText` / `hidden: true`.
- **TOP-UI-07** — `docs/multi_pos_one_location_support.md` cited `topologyEditor.tsx`; actual
  file is `NodeTopologyEditor.tsx`; path corrected.

---

## Schema — SQLite/Postgres drift (`CLOSED 2026-08-31`)

Surfaced while making the loyalty fixed-point migration land on both engines; the new drift guard found a second one the same day it was written.

- ~~**SCHEMA-01** — inline global `UNIQUE` on `products.sku` / `users.username` dominated the composite per-tenant uniqueness that `20260815_tenant_unique_indexes.sql` documents~~ — **FIXED `6f47c964`**: the revert (`62224b00`) restored a pre-drift init.sql carrying the global constraints and 20260815 only added the composite indexes on top, so two tenants could never share a SKU/username and the sync upserts (`ON CONFLICT (tenant_id, sku)`) failed with a bare constraint error. The PG port had been *silently hand-fixing this* — which is why only the faithful regenerated schema made `pg_integration_tenant_sku_isolation` fail. `20260831_per_tenant_unique_rebuild.sql` rebuilds both tables without the inline UNIQUE (composite indexes become the surviving rule), retargets the four `products(sku)` child FKs to composite `(tenant_id, sku)` (mirroring the PG semantics), and adds the real `product_activity.tenant_id` the cloud analytics join already expects. `PRAGMA defer_foreign_keys` carries the 10 inbound FKs per parent through each DROP+RENAME inside the runner's transaction. Regression test pins cross-tenant duplicates allowed, same-tenant rejected, upsert resolving, zero FK violations.
- ~~**PG-DRIFT-01** — `20260813_init.pg.sql` was hand-ported, not generated~~ — **FIXED `16aa2dc8`**: the committed PG file was init.sql@old-date plus hand-ported incrementals (incl. PG-only columns and the silent SCHEMA-01 fix); the old text-based generator could not reproduce it in either direction. `scripts/generate-pg-migration.py` rewritten as a migration-engine snapshot: applies the full registry chain to in-memory SQLite, dumps final state + seed rows, translates to PG (topo-sorted tables, unique indexes inline after their table for composite FK targets, curated RLS list with staleness validation, strict trigger-port parity). `--check` renders twice (determinism self-proof) and diffs against the committed file; wired as a pre-commit gate + CI job (`pg-schema-drift`). Supersedes the "Postgres intentionally untouched" note in LOYALTY-01 — the file was not a generated artifact then; it is now, and the loyalty column has since been ported faithfully.
- **Follow-ups flagged, not in scope**: `scripts/rls-cutover.sql` role grants may lag the curated `RLS_TABLES` list; `sale_lines` carries `tenant_id` but the REST insert does not populate it (RLS stays off there — write-path work); the cloud-server pg suite has a pre-existing shared-container deadlock flake under parallel test threads (serial run green).

---

## i18n — Fluent localization (`PARTIALLY REMEDIATED 2026-09-03`)

Full working journal, per-phase evidence and the retracted claims: [`fluent-page-audit.md`](./fluent-page-audit.md).

Closed by that audit: the parity gate's scope (1 surface / `features/**` only → 6 surfaces / all of `ui/src`), its promotion from `--report-only` to fail-closed, 14 phantom keys, 74 hardcoded sites, the PO-Receive label bug, two screen-reader names built from raw keys or unlocalized array entries, 16 split en/id locale pairs, the stray `ui/locales/` bundle, and the missing CI job.

- **I18N-01 — 78 keys exist only in `.id.ftl`, with no English twin anywhere** — **OPEN**: sales 22, staff 20, inventory 14, shared 8, customers 7, settings 4, reports 2, products 1. Unreachable in English and unreferenced by any statically-checkable call site, so they are dead weight rather than a defect. Deleting translations is a translator's call, so the audit left them; `scripts/scan-locale-crossings.py` prints the per-file counts so the number cannot silently grow.
- **I18N-02 — programmatic `<Localized id={expr}>` sites** — **MOSTLY CLOSED 2026-09-03**: the audit surveyed all 98 and found the majority were literals in disguise. `verify-bundle-parity.py --include-dynamic-literals` now extracts key-shaped literals from those expressions and checks them — **82 recovered ids across 39 ternaries**, which immediately exposed three real gaps: `pos-close-shift-confirm`, `pos-close-shift-closing` and `pos-open-shift-opening` existed in `sales.id.ftl` but never in `sales.ftl`, so English was rendering hardcoded JSX fallback children. Added. The extractor also had to learn to ignore *comparison* operands, since `id={ws === 'restaurant-pos' ? …}` names a workspace type, not a message id. Still unresolvable statically: 27 template-literal ids whose domains come from data (the prefix is now covered by enumerating each domain, even where the site itself is not), and four families whose ids derive from server strings or DB rows (`gift-cards-status-`, `gift-cards-txn-`, `sales-report-category-`, `topology-purpose-`) — there the requirement is a graceful fallback, which each site already has.

  Two further surfaces were added in the same sweep, taking the gate from 1 to **8** and the census from 4188 to 4434 checked key sites: `--include-id-maps` covers the 8 `MAP[key]` lookup objects (**67 ids**, all resolving) that the key-field surface missed because their field names are `login`/`void`/`refund` rather than `*Key`; and `KEY_FIELD_ID_PATTERN` was widened on survey evidence — `labelKey` (35 sites), `messageId` (25), `fluentKey` (14), `rightLabelId` (9), `ariaId` (8), `typeLabelId` (4), `rightAriaLabelId` (2), `okKey` (1).

  `restaurant-sort-${mode}` turned out to be **entirely missing from both bundles** — four ids never written, invisible in English because each button carries a hardcoded fallback child, so Indonesian users read English sort labels in an otherwise-localised menu. Added, and pinned against the now-exported `SORT_MODES` (with `SortMode` derived from it, so a fifth mode cannot be added silently); `day-${dayKey}` verified complete the same way via exported `DAY_KEYS`.

  **A broad `return '<kebab-case>'` surface was measured and rejected**: 21 such literals resolve as ids but 6 must not be — `status-pending`/`status-synced`/`status-failed` are CSS class names returned by `statusClass()`, and `branch-location` is a topology port key. Demanding keys for those would have manufactured junk, exactly the `portId` trap. The three `id={fn(x)}` helpers are pinned by enumerating their switch returns instead.
- **I18N-03 — the untranslated-value count is not trustworthy** — **OPEN**: the audit reported 225/4274 (5.3%) identical en/id values early on and 440/4407 (10.0%) later, using different normalization, and **never reconciled the two**. Treat both figures as unverified until one method is chosen. Some identical values are legitimately identical (PIN, QRIS, SKU, KDS, brand names, currency codes).
- **I18N-04 — 21 hardcoded sites classified benign, open to challenge** — **OPEN**: brand marks (OZ-POS ×2), an `aria-hidden` locked-tier preview (4), a hidden form-submit shim and `Ctrl`/`S`/`F12` key hints (4), a `Pro` tier badge, and input examples (`e.g. 50000`, `pcs / kg / box` ×2, `A-01` ×2). The `pcs / kg / box` and `A-01` **placeholders** are the defensible disagreement — they are user-visible hint text, and "not worth localizing" was the audit's judgment, not a measured one.
- ~~**I18N-05 — `verify-ci-docs-drift.py` is red and unenforced** — **RESOLVED 2026-09 (0.0.37 CI-gate restoration)**: the two retired gates were restored into `dev-ci.yml#static-gates` + `#ci-docs-drift` (commits `bf8f0da3`, `ecbcc635`, `af246396`, `f5d94a20`, `6e270d70`), `scripts/gates.json` now carries 69 gate records (52 required + 1 advisory + 16 retired), and `verify-ci-docs-drift.py` exits **0 with 0 drift items** when run today. The "78 dead workflow references" were closed by `af246396` (police the hook's CI pointers, fix the four that were already wrong). The original root cause — `23c96330` retired `ci.yml`/`nightly.yml` without a `gates.json` record — is no longer live; the checker now polices hook→workflow references (consistent with AGENTS.md's re-injected "10 gates / dev-ci.yml" claims, which are accurate).~~

## Bridge extraction (`crates/oz-bridge`) — 2026-09-11 — PRESERVED, NOT REMEDIATED

**Status:** New section, no fixes made. Every line below was located in the tree on
2026-09-11 (branch `0.0.37`, measured from `3cc76b156` through `abbedfb4b`) and is deliberately **left in
place**: ADR #49 §*The parity iron rule* forbids repairing a pre-existing defect inside an
extraction, because a behaviour change hidden in a `refactor` commit is an unreviewed
behaviour change. This is the register the iron rule's "and REPORTED" half points to.
**All 29 claims in the hand-off list were located; none had to be dropped.** Five were
corrected against what the code says rather than copied: `BR-S4` (the ADR #38 wording is a
module doc + ADR line, not an inline "authorises nothing" comment), `BR-D1` (39 confirmed,
and two further test arrays carry 33/37), `BR-D3` (**15** such adapters, not five — and the
named settings/tax precedents are already deleted), `BR-D4` (the permission is
`SALES_PROCESS` on **both** carts, and both live tablet-side), `BR-T1` (the non-recursive
glob is at `:272`, not `:277`). Two more corrections land in the ADR rather than here:
`BridgeCtx` carries **14** public fields, not 16, and the parts-taking topology helpers are
**four**, not three. One item was **added** while cross-checking the gates: `BR-T4`.

Legend: **[PBD]** = preserved by design (ADR #49). Cites are `path:line` at this HEAD; a
sibling lane may shift them, so re-grep the symbol before trusting a number.

### Security / authz-shaped

- **BR-S1** — **[PBD]** the ungated backup pair takes no session at all and writes a
  `.backup.db` beside the live db: `apps/desktop-client/src/commands/data.rs:33`
  (`get_backup_status`), `:42` (`create_backup`) → `crates/oz-bridge/src/data.rs:274` /
  `:294`, target derived at `crates/oz-bridge/src/data.rs:148` (`set_extension("backup.db")`);
  `DATA_EXPORT` is held only by the twins `crates/oz-bridge/src/data.rs:712` and `:725`.
  Not scope-aware, so it stays not scope-aware.
- **BR-S2** — **[PBD]** `set_brand_logo_path` writes an **unvalidated** path whenever no
  `AppHandle` is present, under a comment skipping validation "for backward
  compatibility" — `crates/oz-bridge/src/branding.rs:188-192` (comment `:189-190`) — and the
  scoped twin repeats the same skip at `crates/oz-bridge/src/branding.rs:254-256`, so the
  H-3 containment rule (`branding.rs:71-74`) is conditional on the shell, not on the caller.
- **BR-S3** — **[PBD]** `set_brand_logo_path_scoped` gates `SETTINGS_EDIT`
  (`crates/oz-bridge/src/branding.rs:247`), opens the scope's **store** db (`:249`) and then
  persists to the **global** db (`:252`, `:255`) — while both siblings in the same file write
  the store db (`:215-217` colour, `:232-234` name). A scoped logo write therefore lands on
  the shared tenant row, not the store's.
- **BR-S4** — **[PBD]** `open_product_images_scoped` authenticates and authorises nothing:
  `apps/desktop-client/src/commands/browser.rs:32-41` delegates to
  `crates/oz-bridge/src/browser.rs:64`, which calls `resolve_store` and no `require_permission`
  anywhere in the module — the *intent* is stated at `crates/oz-bridge/src/browser.rs:61-63`
  and ADR #38 frames the same line as auth-only
  (`docs/decisions/2026-08-11-adr38-retail-row-context-menu-browser-images.md:81`, "resolves
  the session (auth precedent, ADR #7)"), which is why this reads as designed rather than
  as a hole. **Correction to the hand-off:** no `ADR #38` *code* comment describes the
  missing authorisation; the descriptive text is the module doc above plus the ADR line.
- **BR-S5** — **[PBD]** `pick_logo_file` has no gate (`apps/desktop-client/src/commands/branding.rs:102`)
  where `pick_logo_file_scoped` holds `SETTINGS_EDIT`
  (`apps/desktop-client/src/commands/branding.rs:164`, gate at `:171`). Both keep their bodies
  desktop-side (no seam for `tauri::dialog` — ADR #49 §What was NOT extracted).
- **BR-S6** — **[PBD]** `set_setting` authorises a **caller-supplied** identity:
  `crates/oz-bridge/src/settings.rs:989` takes `user_id: &str` (`:993`) and gates *that* at
  `:1007` (`require_permission_for_user`), while the value arrives from the renderer at
  `apps/desktop-client/src/commands/settings.rs:277` — the gate answers for whoever the
  caller names, not for the session.
- **BR-S7** — **[PBD]** `resolve_report_scope` authorises against the **global** identity db
  (`crates/oz-bridge/src/reports.rs:65`, `:67-69`) and then opens
  `session.store_id`'s store db (`:71-73`) with no re-check of the binding between them.

### Correctness / robustness

- **BR-C1** — **[PBD]** `register_terminal` is a registered-shaped command that is **not in
  `invoke_handler!`**: `apps/desktop-client/src/commands/terminals.rs:123` carries
  `#[tauri::command]`, but `apps/desktop-client/src/lib.rs:1036-1051` registers 16
  `commands::terminals::` entries and `register_terminal` is not one of them (16 of 17).
  Dead on the wire, alive in the test suite.
- **BR-C2** — **[PBD]** `build_device_binding_dto` treats a keyring **read failure** as an
  invalid signature: `crates/oz-bridge/src/terminals.rs:343` →
  `verify_binding(...).unwrap_or(false)` at `:357-364`, so `signature_valid:false` cannot be
  distinguished from "the device secret could not be read" (`verify_binding` is at `:78`).
- **BR-C3** — **[PBD]** `export_data` accepts `date_from` / `date_to` over IPC
  (`crates/oz-bridge/src/data.rs:63`, `:65`) and **never reads them** — zero references in
  the whole body `:310-485`. A user-scoped "export this date range" silently exports
  everything.
- **BR-C4** — **[PBD]** `create_backup` holds the **global connection guard** from
  `Store::backup` through a filesystem stat with no explicit drop:
  `crates/oz-bridge/src/data.rs:299` (`lock_global`) → `:301` (`store.backup`) → `:302`
  (`std::fs::metadata`).
- **BR-C5** — **[PBD]** `import_data` mixes connection-bound existence probes with
  transaction writes inside one open transaction: tx at `crates/oz-bridge/src/data.rs:518`,
  `store.conn()` probes at `:562`, `:589`, `:614`, `:645`, `tx.execute` writes at `:570`,
  `:575`, `:624`, `:629`, `:653`, `:659`. The two paths can disagree about the same row.
- **BR-C6** — **[PBD]** `export_data`'s features map silently **empties** on a read error:
  `crates/oz-bridge/src/data.rs:424-427` (`load_features().map(...).unwrap_or_default()`)
  — a failed feature read exports as "no features", not as an error.
- **BR-C7** — **[PBD]** `gather_usage` turns four database faults into logged zeros:
  `crates/oz-bridge/src/subscription.rs:127-145` (`count_locations`, `count_staff_users`,
  `count_terminals`, `count_warehouse_locations`, each `unwrap_or_else(|e| { warn; 0 })`), so
  quota gates see "no usage" rather than "unknown".
- **BR-C8** — **[PBD]** `per_location_over_quota_rows` has a TOCTOU shape:
  `crates/oz-bridge/src/subscription.rs:639` probes `manager.store_db_exists(store_id)` and
  `:642` then opens it (`open_store`); the file can appear or vanish between the two. A
  store that fails to answer is skipped, not fatal (`:660-663`).
- **BR-C9** — **[PBD]** `gate_permission` is computed twice for the same feature in one
  verdict: `crates/oz-bridge/src/subscription.rs:382` and again at `:386`.
- **BR-C10** — **[PBD]** `get_hardware_settings_scoped` carries an inherited **double
  session read**: `crates/oz-bridge/src/settings.rs:672` resolves the session, `:676` calls
  `resolve_scope`, which resolves it **again** (`crates/oz-bridge/src/ctx.rs:170`), and `:677`
  delegates to `get_hardware_settings` (`:557`). Preserved because the unscoped reader is
  shared; the second resolve is what makes an expiry between the two calls observable.
- **BR-C11** — **[PBD]** `run_list_credit_sales` binds the **payment reference** into the
  **customer name** column: `crates/oz-bridge/src/settings.rs:380` selects
  `p.gateway_reference` at index 1 and `:392` reads it as
  `customer_name: row.get::<_, Option<String>>(1)?` (DTO field declared at `:167`).

### Consistency across modules — **a PATTERN, three independent instances**

- **BR-X1** — **[PBD]** store-open asymmetry inside one module:
  `crates/oz-bridge/src/terminals.rs` reaches the store db through `db_manager.open_store` in
  **9** commands (`:436`, `:474`, `:525`, `:556`, `:591`, `:664`, `:700`, `:758`, `:810`) and
  through `ctx.resolve_store` in **7** (`:187`, `:217`, `:240`, `:265`, `:285`, `:308`, `:332`)
  — two session-resolution paths with different failure text and different re-entry
  behaviour, in the same file.
- **BR-X2** — **[PBD]** same split as a *db-selection* asymmetry in features:
  `list_all_features` reads the **global** db (`crates/oz-bridge/src/features.rs:53-54`) while
  `list_all_features_scoped` reads the scope's **store** db
  (`crates/oz-bridge/src/features.rs:629-633`) — the pair can answer differently for one user.
- **BR-X3** — **[PBD]** and in prose: `apps/desktop-client/src/commands/settings.rs:9-11`
  still promises that store name / currency / features "may be exposed here in the future",
  while the generic key-value (`:274` `set_setting`), hardware (`:178`, `:351`) and batch
  (`:311` `set_settings_scoped`) commands are already exposed in that same file.

### Doc / test debt

- **BR-D1** — **[PBD]** `"all 32 features"` is wrong in three places —
  `apps/desktop-client/src/commands/features.rs:9`, `crates/oz-bridge/src/features.rs:45` and
  `:383` — while the enum carries **39** variants (`crates/oz-core/src/features.rs:31`), the
  metadata table returns **39** rows (`crates/oz-bridge/src/features.rs:385`), and the desktop
  test enumeration lists **39** (`apps/desktop-client/src/commands/features_tests.rs:195`).
  Additional drift found while counting: the two core test enumerations carry **33** and **37**
  (`crates/oz-core/src/features_tests.rs:181`, `:389`) — neither matches 39 either.
- **BR-D2** — **[PBD]** `device_hostname` is undocumented at
  `crates/oz-bridge/src/features.rs:375`: its doc block (`:348-352`) is fused into the comment
  run that ends on `feature_to_module_id`'s own doc (`:353-358`), so rustdoc attaches both
  runs to `feature_to_module_id` (`:359`) and `missing_docs` never fires for the helper.
- **BR-D3** — **[PBD]** caller-outside-tests-only desktop adapters. **Correction to the
  hand-off:** the count is **15**, not five, and the two named precedents are already
  harvested — the settings adapter went in `2d233fc5b` and the tax rounding-mode adapter in
  `ee56fd04d`. Remaining: `commands/data.rs:53`, `:86`, `:95`; `commands/features.rs:33`,
  `:38`; `commands/offline.rs:24`, `:31`, `:36`; `commands/products_images.rs:139`;
  `commands/sync.rs:81`, `:95`, `:105`, `:135`, `:148`; `commands/terminals.rs:270`.
  Each is `#[allow(dead_code)]` with a comment naming its test file as the only caller; all
  are cleanup candidates **once their tests relocate to `oz-bridge`**, not before.
- **BR-D4** — **[PBD]** dead IPC surface per the parity gate (measured, `python
  scripts/verify-ipc-parity.py`): 25 allowlisted orphans = **23 redundant twins** with no
  check + **2 GATED DEAD SURFACE** carrying a real `SALES_PROCESS` gate with no reachable
  caller — `get_active_cart_scoped` and `list_active_carts_scoped
  (`scripts/ipc-parity-allowlist.json:194`, `:201`). **Correction to the hand-off:** the
  second is `SALES_PROCESS`, not `SALE_PROCESS`, and both live tablet-side
  (`apps/tablet-client/src/commands/pos.rs:270`, `:305`; registered in tablet
  `lib.rs:550-551`), which is why the desktop allowlist holds them.
- **BR-D5** — **[PBD]** four model helpers are `pub` **only** so `model_tests.rs` can reach
  them: `crates/oz-bridge/src/topology/model.rs:27` (`ser_f64_finite`), `:35`
  (`de_f64_or_null`), `:55` (`de_direction_or_null`), `:250` (`default_direction`). They are
  the narrowable half of the topology visibility cost in ADR #49 §Consequences (4 of 28).

### Tooling gaps found while building the gates

- **BR-T1** — `scripts/verify-ipc-parity.py` walks `commands/` **recursively** for its
  registry/unregistered scan (`rglob` at `:119`) but the gate-balance half
  (`orphan_permission`, `:246`) reads bodies through a **non-recursive** glob —
  `scripts/verify-ipc-parity.py:272` (`for rs in sorted(cmd_dir.glob("*.rs"))`).
  **Correction to the hand-off:** the line is `:272`, not `:277`. Consequence:
  `apps/desktop-client/src/commands/topology/` — 7 `require_permission` sites today, all in
  `topology/commands.rs` — has never been examined by that half.
- **BR-T2** — the extraction's own count invariant is blind in the same way: `grep -rh
  'pub async fn' apps/desktop-client/src/commands/*.rs` is non-recursive, so it cannot see the
  **12** sites under `commands/topology/`. Measured today: **488** top-level vs **500**
  recursive. Any lane pinning "488" is pinning a glob artefact, not a property of the code.
- **BR-T3** — an isolated git worktree that shares the main `CARGO_TARGET_DIR` can produce a
  **false-fresh compile**: `Finished` with no `Checking` line and no error, because the
  fingerprint/dep-info in the shared dir is owned by the other workspace path — sabotage-proven
  at `manager-2-journal.md:950` (a deliberate type error still "compiled" in 0.52s). And a
  **runtime test binary** built that way may be the *other* tree's image, because the artefact
  path is keyed by crate and profile, not by source directory —
  `manager-2-journal.md:1098`. **Not re-measured here** (this pass ran no cargo, per the shared
  target-dir contention rule); recorded as a gate-provenance rule: a compile proof needs the
  `Checking <crate> (<this tree's path>)` line, and a runtime proof needs the merged tree or a
  private `--target-dir`.
- **BR-T4** — **new, found while cross-checking BR-T1**: `orphan_permission`'s body window is
  the **desktop** file (`scripts/verify-ipc-parity.py:272-291`, "`require_permission` not in
  body → None"), but after extraction the gate text lives in the bridge
  (`crates/oz-bridge/src/pos.rs:232`, `:345`). 16 of the 25 allowlisted orphans now have zero
  gate text in their desktop body; for those 16 the bridge body also has none, so no verdict
  has flipped **yet** — but the check can no longer see an extracted desktop gate, and the
  campaign is still moving bodies. The two GATED verdicts in `BR-D4` were reachable only
  because a **tablet** copy of the body still carries the gate inline.

---

## How to close these

Each finding's original remediation guidance lives in git history under
`audit/<NN>-<slug>.md` (the file was consolidated into this document; the
per-finding fix descriptions, affected files, and commit lists remain
available via `git log` on the deleted path). Re-open a finding here, fix
it, then flip its status in this file.
