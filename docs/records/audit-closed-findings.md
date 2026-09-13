# Audit Closed Findings — Archive

> **Five settled sector closures, moved out of [audit-open-findings.md](./audit-open-findings.md) on 2026-09-14.**
> Each block below carried its own closure commit *and* stated no work still owed: no residual to fix,
> no parked item, no owner action outstanding, no unverified claim left standing. Nothing was reworded,
> softened, re-dated or re-scoped and every sha it names is intact; where a heading exceeded 75
> characters it was shortened to fit the records-heading limit and the body under it is unchanged.
>
> What did **not** come here, and why: every dated correction, dated retraction and gate-integrity
> block from the 2026-09-13/14 run stayed in the open register. Nine of those sixteen blocks state work
> still owed (`PARKED`, an allowlist entry the owner should drop, `Reported, not fixed`, residuals
> escalated rather than buried, a `--self-test` that enforces nothing until someone wires it), and the
> rest cross-reference that cluster — each names a residual the next section closes or parks — so moving
> any one of them would strand the sentence that answers it. A closure recorded as a sentence filed is
> not the same claim as a defect removed, and an archive titled closed is the wrong home for either.
> The open register keeps a one-line pointer per moved block naming the finding, its closure commit and
> this file.

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

## Money — Frontend (`32-money-frontend.md` — FULLY REMEDIATED)

**Status:** FRONTEND-01/02/03/04 all closed (04 found + fixed during the FRONTEND-03 sweep, 2026-08-30).

- **FRONTEND-01** — PaymentModal charge-amount row inflates by base exponent (P1, FIXED)
- **FRONTEND-02** — usePosState silently mixes currencies in the subtotal (P1, FIXED)
- ~~**FRONTEND-03** — IPC boundary drops line currency (P2, **DEFERRED to Phase 5 — open, needs backend change**)~~ — **CLOSED 2026-08-30**, commit `fc8eae22`: `AddLineArgs.unit_price_currency` (optional, wire-compatible) added on desktop + tablet; commands build the line in the wire currency so `Cart::add_line`'s (previously dead) mismatch check rejects cross-currency lines; invalid ISO codes fail closed. PaymentModal sends `line.unit_price.currency` on both sale paths. Pinned by tablet e2e (EUR line into USD cart → Err) + desktop serde-shape/helper tests + UI contract tests. Follow-up also **CLOSED 2026-08-30**, commit `4439cfa3`: `CartLineData.unit_price_currency` in `complete_sale_with_resolved_shortfalls_scoped` (both clients) — same helper pattern, same fail-closed parse; PaymentModal's shortfall-dialog mapping sends the line currency, dialog passthrough pinned by test.
- ~~**FRONTEND-04** (P2, found 2026-08-30 during the FRONTEND-03 sweep) — multi-currency charge + stock shortfall settles the second command in the WRONG currency~~ — **CLOSED 2026-08-30**, commit `0e5e8bf9`. Semantics decision: the retry must settle in the SAME currency the first command used (charge currency) — it is a retry of the same sale. Fix (UI-only; the Rust struct already accepted all five CUR-02 fields): CUR-02 tender metadata lifted into a shared `tenderSnapshot` memo used by the QRIS path, main path, and shortfall dialog; dialog now receives `lineItemsInCartCurrency` + `cartCurrency` + `effectiveTotalInCartCurrency` + `tenderedMinorInCartCurrency` and forwards tip/service/base fields into the retry args. Pinned by a multi-currency e2e (USD cart → IDR charge at 16500: retry payload currency IDR, converted line amounts, baseCurrency/baseTotalMinor/tenderRateMillionths) + single-currency tip/service pin (previously the retry recorded tip=0/service=0 even without multi-currency).

---

## Money — TDD sweep (`MONEY-01..05` — CLOSED 2026-08-31, LOYALTY-01 too)

A `/tdd` pass over the money area (foundation `money.rs` came back exemplary — deep-audited, property-tested, no change needed; the weaknesses were all in the UI conversion/input edges and one daemon cast):

- ~~**MONEY-01** — PaymentModal tender conversion mis-rounded .5 boundaries~~ — **FIXED `79247c92`**: the conversion chain (`baseMinor/10^exp × float-rate × 10^exp`) turned exact decimal halves into float values slightly below the tie — brute-forced counterexamples: 0.03 USD @ 149.5 → 448 instead of 449, 0.41 → 6129 vs 6130. Replaced by `convertMinorUnits` (BigInt, half-up toward +∞, inverse-pair aware via an `inverted` flag) + `reciprocalMillionths` for the persisted `tender_rate_millionths` (the snapshot now carries the ORIGINAL integer, not a float round-trip). 11 unit tests.
- ~~**MONEY-02** — every user-entered money field parsed with `Math.round(parseFloat(s) × 10^scale)`~~ — **FIXED `89589dae`**: "1.005" USD → 100 cents (exact: 101); parseFloat also swallowed "1e3" → 1000 and "1,500" → 1 on free-text fields. `parseMinorUnits` (strict decimal regex + BigInt scaling + half-up) migrated to all sites: tender, split amounts (×3), rate editor (scale 6), shift balances, staff pay (garbage → absent, not NaN). 12 unit tests.
- ~~**MONEY-03** — rate-sync daemon cast untrusted API floats with saturating `as i64`~~ — **FIXED `6736fb02`**: a `1e300` response became `i64::MAX`, which PASSES the repo's `>0` validation and persists. `rate_to_millionths` now rejects non-finite/non-positive/≥1e10/sub-resolution before the cast; rejected rows warn+skip. 6 unit tests.
- ~~**MONEY-04** — Rp discount tab hardcoded ×100~~ — **FIXED `46fd1ab0`**: for IDR (exponent 0) the ratio inflated 100× — Rp 2,000 off Rp 100,000 computed pct=200 → `setDiscount` clamps → **100% off, free goods**. Now scales by `minorUnitExponent(subtotal.currency)`. Red test pinned first (the tab had zero coverage).
- ~~**MONEY-05** — shift open/close balances hardcoded ×100~~ — **FIXED `46fd1ab0`**: `opening_balance_minor` is store-currency minor units; every IDR drawer count was stored 100× inflated, breaking `expected_cash` reconciliation. Now scales by `minorUnitExponent(storeSettings.currency)`. The old test PINNED the bug (100000 → 10000000); corrected.
- ~~**LOYALTY-01 (OPEN)** — `db/loyalty.rs` computed `points = ((base as f64)/100 × earn_multiplier).round() as i64` with the multiplier stored as `REAL`~~ — **CLOSED 2026-08-31**, commits `803f6239` (core) + `02b264cd` (UI): the multiplier is now **fixed-point millionths** end to end (`earn_multiplier_millionths INTEGER`, the repo's own `rate_millionths` precedent). Evidence that justified it: exhaustive scan (double vs exact-decimal, half-away) — multiplier 1.4 flipped at 585 bases ≤ 2,000,000, e.g. base=2250 (a $22.50 sale at points_per_unit=1): float 31.499999999999996 → 31 points where exact decimal gives 32, always DOWNWARD for 1.4; 1.1/1.2/1.3/1.5/1.75/2.0 never flipped in range (1.5/1.75/2.0 binary-exact; the others' error snaps back at the tie — which is why the seeded tiers 1.0/1.25/1.5/2.0 hid this for so long). The corruption was at WRITE time (UI JS number → f64 IPC → REAL column), so no compute-site patch could recover intent. Fix: migration `20260831_loyalty_multiplier_fixedpoint.sql` (drop triggers → ADD COLUMN → backfill `CAST(ROUND(old × 1e6) AS INTEGER)` → DROP COLUMN → recreate triggers; no table rebuild, the `loyalty_accounts.tier_id` FK is never disturbed), `compute_points()` exact i128 half-up toward +∞, DTO/wire rename to `earn_multiplier_millionths`, tier editor parses via `parseMinorUnits(x, 6)` and displays via `millionthsToDecimalString` (integer-only). Postgres intentionally untouched — the cloud has no loyalty code path and `init.pg.sql` is a generated artifact. 5 new Rust tests (boundary grid, extremes saturate, end-to-end $22.50→32, legacy backfill, seeded-tier exactness) + 3 UI tests (prefill "1.25", save 1_400_000, zero rejected).
- **Test hygiene fallout (CLOSED `0ffdd2c3`)** — the full-suite run surfaced 6 tests red at HEAD *before* the money batch: the scoped-IPC audit (`5e0d4caa`) and REP-06 shipped without updating RefundModal (wire object dropped `userId`; token is arg 0), VoidOrdersScreen (`voidSaleScoped` positional), a11yTransitions (StatusBar's scoped offline call), and AnalyticsScreen ×2 (category fixture missing the REP-06 row currency — `Intl.NumberFormat` currency-style throws on a missing code; CSV export predates the REP-06a currency column). The ERR-10 compliance whitelist pinned PaymentModal line numbers and drifted under MONEY-01/02 — now content-anchored with a per-entry sanity check.

---

## Refund guards — rust-auditor COR-25/COR-26 (CLOSED 2026-08-30)

- ~~**COR-25** (MEDIUM) — over-refund guard ran outside the transaction and read the cumulative refunded SUM with `.unwrap_or(0)`: a read error read as "zero refunds" and the money guard failed OPEN~~ — fixed: guard inside the tx, SUM errors propagate (`crates/oz-core/src/db/refunds.rs`, commit 8f01a5d0; regression test `over_refund_guard_fails_closed_when_cumulative_sum_unreadable`).
- ~~**COR-26** (LOW) — refund currency never compared to the sale currency~~ — fixed: `create_refund` rejects a mismatch with `CoreError::CurrencyMismatch` (commit a53feaea; regression test `create_refund_rejects_currency_mismatch`).

---

## PG integration harness — silently-skipped tests (CLOSED 2026-08-30)

`throwaway_test_pool` built DB names from UUID `Display` (hyphens) inside an
unquoted `CREATE DATABASE` identifier → server syntax error → every
throwaway-DB PG test (REST roundtrip, RLS non-owner, concurrent adjust,
sync-store) printed "skipped" and reported PASS — cloud money-path coverage
was silently zero. Fixed with `.simple()` hex names + probe connections
retargeted to the throwaway DB (commit a022b4fb). **Verified live: oz-api
198/198 and oz-cloud-server 224/224 with ZERO skips.** Residual risk: on
machines/CI without PG the skip is still quiet (PASS) by design.
