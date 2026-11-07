<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file, and at 1,679 lines it is the fourth-largest document this campaign has audited — behind the 0.0.36 backlog, the manager journal, and the analytics backlog. Its header calls it the source of truth for still-open audit findings, which makes the integrity of its CLOSED entries the single most load-bearing property it has: a register that closes findings which are not actually closed is worse than no register, because it converts unresolved risk into a clean status line. · THE CLOSE ENTRIES HOLD UP UNDER CHECKING, which is the substantive result. This register closes findings by naming a commit, and that is a falsifiable claim in a way a vague status line is not. Six commits sampled across three different sectors were resolved against the repository's own history and all six are real — the CRM cluster's two closure commits, the loyalty cluster's atomic-earn fix, and the reporting cluster's security-boundary and cloud-parity commits. A register that cites commits which do not exist would be the common failure and it is not present here. · THE CONVENTIONS IT USES ARE WORTH RECORDING, because they are what make it auditable at all. A closed finding is struck through rather than deleted, so the original text survives beside its resolution; each carries a date and the commit that landed it; and a finding closed inside a FOREIGN commit is labelled as such rather than quietly absorbed. That last one is a discipline worth copying — several entries here record that the fix landed inside someone else's commit and that the content was verified intact afterwards, which is exactly the situation this campaign operates in continuously on a shared branch. · It also explains its own consolidation: the per-sector reports were merged in and removed, and the file states that each finding keeps its original ID so commit history and code comments still resolve. Preserving identifiers across a consolidation is what stops a rename from orphaning a reference. · THE ONE CROSS-FILE PROPERTY A READER SHOULD KNOW, recorded here because it is the seam between the two halves of this register. Its partner file exists and is present in the tree. The register's own header notes that fully-remediated sectors are not repeated here, which is the right call for size — but it means the two files must be read together, and this stamp does not treat that as a defect. Its sibling was audited earlier in this campaign and was found to cite two sector-report filenames that exist in neither git nor the working tree, which is the expected consequence of a consolidation that removed those reports: the register keeps the FINDING ids, while the prose that named the deleted report files did not survive. Recorded for the next pass rather than repaired here, because the fix belongs with whoever performed the consolidation. · NOT re-measured: whether any finding marked open is still open, and whether any marked closed stayed closed. Re-deriving that is the work of the audits themselves, one sector at a time, and this register is a pointer to that work rather than a substitute for it. · No stamp existed; this is the first. -->
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

- **Moved to [audit-closed-findings.md](./audit-closed-findings.md):** CRM-01–CRM-11 (`01-crm-module.md` — PARTIALLY REMEDIATED) — all closed 2026-08-31 (`7967cc2d`, `23b78594`, `841448ca`); the residual it names was found and fixed the same day.

---

## Loyalty (`02-loyalty-module.md` — AUDITED)

**Status:** Loyalty cluster FULLY CLOSED 2026-08-31 — LOY-01 remediated; **LOY-06 CLOSED 2026-08-30** (earn now fires atomically at completion); SF-01 closed with it; **LOY-03 CLOSED 2026-08-31** (proportional refund reversal in-tx; void path proven unreachable + `void_sale` race fixed as CAS); LOY-04 verified fixed; LOY-05 verified fixed.

Key open items:
- ~~**LOY-02** — Earning points is not idempotent by sale~~ — **VERIFIED FIXED 2026-08-30**: migration 128 enforces a unique earn/redeem projection index (`crates/kasirmu-core/src/db/loyalty_tests.rs:556`).
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
- ~~**REP-06** — cross-currency SUMs in the remaining report queries~~ — **CLOSED 2026-08-31** (core `38b456bd`, UI `3f9ced5c`): `top_products`, `hourly_heatmap`, `category_breakdown`, `payment_method_breakdown` and `voided_sales_summary` summed minor units across currencies into one number (the REP-02 class below the revenue trends). All five now GROUP BY currency with a `currency` field on every row; category percentages normalize WITHIN each currency; voided summary returns one row per currency; heatmap cells aggregate currency rows (orders sum, intensity tracks the display currency, labels list every amount); the refunds analytics card + its CSV are per-currency. **Follow-ups recorded:** (a) ~~the category PIE still compares slice areas across currencies — visual-semantics decision needed (per-currency pies vs currency filter)~~ — **CLOSED 2026-08-31 (`0c7f91e1`)**: per-currency tabs on the pie card (display currency default, strip only when the range spans currencies) + the CSV gained its missing currency column with per-row currency formatting; (b) ~~cloud `email_pg.rs` mirrors the old single-currency shapes AND lacks REP-04 refund netting — parity slice~~ — **CLOSED 2026-08-31**: the cloud already had the REP-06 per-currency shapes (note was stale; `4b8a630e`), REP-05 erasure fixed same-day, and **REP-04 netting landed in `88ea4e8c`** — the earlier "cloud schema has NO refunds table" note was WRONG: `refunds` existed in `init.pg.sql` all along (the prior grep had searched only `apps/`, missing `crates/kasirmu-core/migrations/`); the real gaps were `tenant_id`, RLS policy, oz_app grants, cutover coverage and query wiring — all closed. `daily/weekly/monthly_revenue_pg` now mirror the local FULL OUTER netting semantics (PG rejects the correlated COGS subquery over ungrouped outer columns — E42803 — so COGS moved to a pre-aggregated CTE). **Still open:** the forecast queries (`category_popularity_pg`, `category_means_pg`) still INNER JOIN products (advisory consumers, deliberately not expanded); cloud email reports bucket in UTC — per-tenant timezone config does not exist in the cloud schema (REP-03 parity follow-up, needs a tenant-level setting + the same offset-string contract).
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

## Topology — Rust (`30-topology-rust.md` — ✅ ALL CLOSED 2026-08-31)

<!-- Heading corrected 2026-11-05. It read "⚠️ 8 FINDINGS, OPEN" from 2026-08-31
     until this edit, while the Status line directly under it said "ALL CLOSED —
     verified fixed 2026-08-31". The body is untouched: it was right the whole
     time and only the label in the register's scan list was wrong, which is the
     one line a reader looking for open work actually reads. Same failure as a
     stale index row: the entry is correct and the pointer to it is not. -->

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

- **Moved to [audit-closed-findings.md](./audit-closed-findings.md):** FRONTEND-01…04 (`32-money-frontend.md` — FULLY REMEDIATED) — all closed 2026-08-30 (`fc8eae22`, `0e5e8bf9`, `4439cfa3`); the Phase 5 deferral inside it was closed, not left.

---

- **Moved to [audit-closed-findings.md](./audit-closed-findings.md):** MONEY-01…05, LOYALTY-01 and the test-hygiene fallout — closed 2026-08-31 (`79247c92`, `89589dae`, `6736fb02`, `46fd1ab0`, `803f6239`, `02b264cd`, `0ffdd2c3`).

---

## Currency — Exchange & Settlement (`34-currency-exchange.md` — ✅ ALL CLOSED 2026-09-29)

<!-- Heading corrected 2026-11-05: "MOSTLY REMEDIATED" outlived the closure it was
     hedging. The Status line below says every CUR entry is closed and names CUR-09
     (2026-09-29) as "the last open entry in this register". A heading that hedges
     about work nobody owes reads as work still owed. -->

**Status:** CUR-02/03/04/05/06/08/09/10/11 ALL closed — **CUR-09 CLOSED 2026-09-29** (verified fixed, see below; it was the last open entry in this register). Design-recommendation leftovers also landed 2026-08-31: shortfall-receipt preview parity (`8f79bd43`) and CurrencyContext refresh + workspace bridge (`319f03dd`).

- ~~**CUR-02** (P0) — PaymentModal displays converted currency but settles the base currency amount (multi-currency settlement)~~ — **CLOSED 2026-08-30** (see Currency section: local snapshot verified in code; cloud persistence gap in `pg::create_sale` fixed, commit bc8bb29c, pinned by the PG roundtrip test).
- ~~**CUR-05** (remaining) — exchange-rate input / effective-date validation residuals~~ — **VERIFIED FIXED 2026-08-30** (registry was stale): `validate_create_rate_args` on desktop AND tablet (shared by legacy + scoped paths) rejects non-positive rates, same-currency pairs, non-ISO-4217 codes, and malformed `YYYY-MM-DD` effective dates; UI side `ExchangeRateScreen` gates Save on the same conditions incl. the millionths conversion (exact `parseMinorUnits(form.rate, 6)` since MONEY-02), and the date field is `type="date"` (browser-enforced format). Pinned by `exchange_rates_tests.rs` (zero/negative, same-pair, non-ISO, malformed-date, valid-input).
- ~~**CUR-06** — default-currency command scope~~ — **CLOSED 2026-08-30**, commit `aa1f831f`: backend scoped variants (`get/set_default_currency_scoped`, rate commands) already enforced `SETTINGS_READ`/`SETTINGS_EDIT` + store resolution with ISO validation on set; the residual was the UI — `ExchangeRateScreen` still called the legacy global-DB APIs for list/create/delete. Now routes through the `*_scoped` wrappers whenever a workspace session exists. Pinned by 3 new tests (token passthrough + legacy-not-called).
- ~~**CUR-10** — missing delete confirmation~~ — **VERIFIED FIXED 2026-08-30**: `ExchangeRateScreen` renders a `ConfirmDialog` (`currency-delete-confirm`, danger variant) before `deleteExchangeRate`; pinned by the delete tests.
- ~~**CUR-09** — Currency locale bundles are incomplete for active UI contracts~~ — **VERIFIED FIXED 2026-09-29** (stale; the last open entry in this register). Re-derived claim by claim against the tree rather than accepting "unverified; low value":
  — *stale `currency-delete-confirm`*: now **used**, `ExchangeRateScreen.tsx:378` passes it to `ConfirmDialog`, and both bundles define it (`shared-ui/locales/currency.ftl:11`, `currency.id.ftl:9`).
  — *no dedicated retry context*: the screen renders the shared `error-state-retry` key through `<Localized>` at `:210`, which is the sanctioned pattern rather than a gap.
  — *literal English toast fallbacks*: `Failed to save exchange rate` / `Failed to delete exchange rate` no longer exist anywhere under `ui/src`, and the file contains **zero** `getString(…) || '<literal>'` fallbacks.
  — *ID-bundle placeholder contract*: all three attribute-only messages (`currency-select-placeholder`, `currency-rate-placeholder`, `currency-source-placeholder`) are consumed via `<Localized … attrs={{ placeholder: true }}>` at `:288`, `:308`, `:322`, `:343` — exactly the consumption CUR-09 said they required, so the "direct `getString` would return nothing" hazard cannot fire.
  The finding was closed by the currency work recorded above (CUR-05/06/10/11 and the ARCH-01 REST batch) reaching the UI half; nothing was outstanding for it on its own. No code change; this is the register catching up.
- ~~**CUR-11** — bounded/latest-rate APIs + e2e coverage~~ — **CLOSED 2026-08-31** (`8f026449` + `41598afa`): `CurrencyRepository::list_latest_exchange_rates` returns one row per pair (newest `effective_date`; `UNIQUE(pair, date)` makes ties impossible, `created_at`/`rowid` tail is defence in depth — `rowid`, not `id`, because rate ids are UUIDs), exposed as `list_latest_exchange_rates_scoped` on both clients behind `SETTINGS_READ`, and wired into the PaymentModal currency load (the picker needs current rates per pair, not the history; the rate editor keeps the full list). Playwright coverage added as a SCREEN-CONTRACT spec (route, columns, Save gating incl. same-pair rejection, CUR-10 delete-confirm) — the e2e run surfaced that **the exchange-rate commands have no cloud REST counterpart** (web/e2e mode serves them from the dev-mock; real CRUD is impossible there), an ARCH-01-family gap recorded rather than silently extended.
- ~~**ARCH-01-family: rate REST gap**~~ — **CLOSED 2026-08-31** (`5b0f1662` + this batch): `crates/kasirmu-api` gained the full rate surface mirroring the scoped IPC commands 1:1 — `GET /api/v1/exchange-rates` (CUR-04 order), `GET …/latest` (CUR-11), `GET …/latest/{from}/{to}` (case-insensitive), `POST …` (CUR-05 validation shared via `pg::validate_exchange_rate_request`), `DELETE …/{id}`. Dual-path like tax-rates: PG helpers in `pg.rs` (unique→409, FK→400) or SQLite fallback via `CurrencyRepository` with an explicit duplicate pre-check (the repo surfaces the constraint as a raw Db error). Rates are global reference data in the cloud schema (no `tenant_id`, no RLS — same treatment as categories). OpenAPI spec + protected-route assertions updated; 11 route tests + live-PG roundtrip + real-CRUD e2e (`api.spec.ts`, per-worker dates to survive parallel projects).
- **UUID-vs-rowid tiebreaker sweep — CLEAN 2026-08-31**: every other `ORDER BY … id` recency pattern was checked. `audit_log` (`created_at DESC, id DESC`) and `offline_queue` (`created_at ASC, id ASC`) are safe — both ids are UUID **v7** (time-ordered); `prune.rs` `ORDER BY id` is batch stability, not recency; `recipes`/PO-lines/transfer-lines `ORDER BY id` is listing order. `exchange_rates` was the only genuine trap (mixed id lineage possible) and it already pins `rowid` in SQLite / relies on `UNIQUE(pair, date)` in PG. No code change needed.
- **.env poison — HARDENED 2026-08-31**: six Paddle note-lines with spaces in keys (`PADDLE PROD IDS = …`) broke `docker compose` for the whole e2e stack with the terse `failed to read .env: line 21: key cannot contain a space` (the root `.env` is untracked — the poison was local-only, commented out on discovery). Hardened with `scripts/validate-env.mjs` — a quote-state-aware dotenv validator (handles the real multi-line PEM value without false positives) wired as a pre-flight in `run-e2e.mjs startDocker()`, so the next poisoned line fails fast with every offending line numbered instead of dying inside compose. `.env.example` verified clean.
- **Foreign breakage at HEAD — RESOLVED UPSTREAM + VERIFIED 2026-08-31**: the unused-`total` warning in tablet `pos.rs` (`192c5bc6`) and the nine red PaymentModal tests were fixed by the PROMO-3 owner's follow-up `100dcdef` mid-repair. Verified at the gate rather than assumed: fresh `cargo check` warning-free, `cargo clippy -p oz-pos-tablet -p oz-api --all-targets` clean, payment family 99/99 green.
- **Leftovers landed 2026-08-31 (design batch, not numbered findings):** shortfall-resolved sales now show the same receipt print preview as the normal path — `StockShortfallDialog` forwards the `CompleteSaleResult` and the modal builds items from the COMMITTED sale lines (resolutions change what sold; the local cart no longer does); `CurrencyProvider` gained `refresh(token?)` (scoped per-store default when a session exists, global bootstrap otherwise, errors keep the last good value) plus a `CurrencyWorkspaceSync` bridge below `WorkspaceProvider` in both entries — per-store defaults (CUR-03 commands) now reach `useCurrency` consumers without a page reload.

---

- **Moved to [audit-closed-findings.md](./audit-closed-findings.md):** COR-25 and COR-26 in `create_refund` — closed 2026-08-30 (`8f01a5d0`, `a53feaea`).

- **Moved to [audit-closed-findings.md](./audit-closed-findings.md):** silently-skipped PG integration harness — closed 2026-08-30 (`a022b4fb`); the quiet-skip risk it records is stated there as by design, not as owed work.

---

> **Path currency (added 08-09-26).** Entries below are dated findings and are not
> rewritten — a finding that named `ui/src/features/stores/` on 2026-08-26 named the right
> directory then. Two renames since then make several paths dead: `ui/src/features/stores/`
> is now `ui/src/features/locations/`, and the `StoreProfile` type (and the `store` →
> `location` vocabulary around it) is now `LocationProfile` in
> `crates/kasirmu-core/src/location_profile.rs`. `docs/api-reference.md` was renamed to
> `docs/guides/developer/api-reference.md` (the intermediate `docs/guides/api-reference.md`
> spelling has itself since moved, so use the `developer/` path).
> Nothing else in these entries should be read as a
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
- **TOP-UI-04** — `docs/guides/developer/api-reference.md` missing `can_save_topology` command; row added. (This cited `docs/api-reference.md`, which moved during the docs restructure; repointed 2026-09-25 while closing C62's dead-ref guard.)
- **TOP-UI-05** — `topology.rs` module doc said "four #[tauri::command]" but only 3 exist
  (the 4th is a startup daemon); comment corrected to "three".
- **TOP-UI-06** — 4 pre-existing `topologyNodeCard.test.tsx` failures (validation text renders
  twice: tooltip + SR-only span; dismiss button hidden in the tooltip portal); tests now query
  `getAllByText` / `hidden: true`.
- **TOP-UI-07** — `docs/archived/multi_pos_one_location_support.md` cited `topologyEditor.tsx`; actual
  file is `NodeTopologyEditor.tsx`; path corrected.

---

## Schema — SQLite/Postgres drift (`CLOSED 2026-08-31`)

Surfaced while making the loyalty fixed-point migration land on both engines; the new drift guard found a second one the same day it was written.

- ~~**SCHEMA-01** — inline global `UNIQUE` on `products.sku` / `users.username` dominated the composite per-tenant uniqueness that `20260815_tenant_unique_indexes.sql` documents~~ — **FIXED `6f47c964`**: the revert (`62224b00`) restored a pre-drift init.sql carrying the global constraints and 20260815 only added the composite indexes on top, so two tenants could never share a SKU/username and the sync upserts (`ON CONFLICT (tenant_id, sku)`) failed with a bare constraint error. The PG port had been *silently hand-fixing this* — which is why only the faithful regenerated schema made `pg_integration_tenant_sku_isolation` fail. `20260831_per_tenant_unique_rebuild.sql` rebuilds both tables without the inline UNIQUE (composite indexes become the surviving rule), retargets the four `products(sku)` child FKs to composite `(tenant_id, sku)` (mirroring the PG semantics), and adds the real `product_activity.tenant_id` the cloud analytics join already expects. `PRAGMA defer_foreign_keys` carries the 10 inbound FKs per parent through each DROP+RENAME inside the runner's transaction. Regression test pins cross-tenant duplicates allowed, same-tenant rejected, upsert resolving, zero FK violations.
- ~~**PG-DRIFT-01** — `20260813_init.pg.sql` was hand-ported, not generated~~ — **FIXED `16aa2dc8`**: the committed PG file was init.sql@old-date plus hand-ported incrementals (incl. PG-only columns and the silent SCHEMA-01 fix); the old text-based generator could not reproduce it in either direction. `scripts/generate-pg-migration.py` rewritten as a migration-engine snapshot: applies the full registry chain to in-memory SQLite, dumps final state + seed rows, translates to PG (topo-sorted tables, unique indexes inline after their table for composite FK targets, curated RLS list with staleness validation, strict trigger-port parity). `--check` renders twice (determinism self-proof) and diffs against the committed file; wired as a pre-commit gate + CI job (`pg-schema-drift`). Supersedes the "Postgres intentionally untouched" note in LOYALTY-01 — the file was not a generated artifact then; it is now, and the loyalty column has since been ported faithfully.
- **Follow-ups flagged, not in scope**: `scripts/rls-cutover.sql` role grants may lag the curated `RLS_TABLES` list; `sale_lines` carries `tenant_id` but the REST insert does not populate it (RLS stays off there — write-path work); the cloud-server pg suite has a pre-existing shared-container deadlock flake under parallel test threads (serial run green).

---

## i18n — Fluent localization (`PARTIALLY REMEDIATED 2026-09-03`)

Full working journal, per-phase evidence and the retracted claims: [`fluent-page-audit.md`](../audits/frontend/fluent-page-audit.md).

Closed by that audit: the parity gate's scope (1 surface / `features/**` only → 6 surfaces / all of `ui/src`), its promotion from `--report-only` to fail-closed, 14 phantom keys, 74 hardcoded sites, the PO-Receive label bug, two screen-reader names built from raw keys or unlocalized array entries, 16 split en/id locale pairs, the stray `ui/locales/` bundle, and the missing CI job.

- **I18N-01 — keys exist only in `.id.ftl`, with no English twin anywhere** — **CLEANUP DEBT, not a defect** (re-measured 2026-10-27; the original read 78 as `OPEN`): `verify-ftl-orphans.py --census` reports **55** at HEAD and files them under its own heading — *"Not a defect while nothing references them"*. Independently confirmed this round by the sharper test: of the 56 keys my per-file diff found, **0 are referenced by the UI** (4614 distinct ids extracted from `<Localized id>` / `getString('…')` / `requiredLocalized(l10n, '…')` across every `.ts(x)` under `ui/src`, intersected with the id-only set). Unreachable in English AND unasked-for by any component, so they cost bundle bytes and translation effort for a screen nobody can reach. Per-file at HEAD: sales 19, inventory 14, shared 9, customers 7, settings 4, reports 2, products 1. Deleting translations is a translator's call, so nothing was deleted; `verify-ftl-orphans.py --census` prints the count every run so it cannot silently grow. THE COUNT MOVED AND NOBODY NOTICED: 78 -> 55 with no entry recording the drop, which is why the number is now quoted from the gate rather than restated here.
- **I18N-02 — programmatic `<Localized id={expr}>` sites** — **MOSTLY CLOSED 2026-09-03**: the audit surveyed all 98 and found the majority were literals in disguise. `verify-bundle-parity.py --include-dynamic-literals` now extracts key-shaped literals from those expressions and checks them — **82 recovered ids across 39 ternaries**, which immediately exposed three real gaps: `pos-close-shift-confirm`, `pos-close-shift-closing` and `pos-open-shift-opening` existed in `sales.id.ftl` but never in `sales.ftl`, so English was rendering hardcoded JSX fallback children. Added. The extractor also had to learn to ignore *comparison* operands, since `id={ws === 'restaurant-pos' ? …}` names a workspace type, not a message id. Still unresolvable statically: 27 template-literal ids whose domains come from data (the prefix is now covered by enumerating each domain, even where the site itself is not), and four families whose ids derive from server strings or DB rows (`gift-cards-status-`, `gift-cards-txn-`, `sales-report-category-`, `topology-purpose-`) — there the requirement is a graceful fallback, which each site already has.

  Two further surfaces were added in the same sweep, taking the gate from 1 to **8** and the census from 4188 to 4434 checked key sites: `--include-id-maps` covers the 8 `MAP[key]` lookup objects (**67 ids**, all resolving) that the key-field surface missed because their field names are `login`/`void`/`refund` rather than `*Key`; and `KEY_FIELD_ID_PATTERN` was widened on survey evidence — `labelKey` (35 sites), `messageId` (25), `fluentKey` (14), `rightLabelId` (9), `ariaId` (8), `typeLabelId` (4), `rightAriaLabelId` (2), `okKey` (1).

  `restaurant-sort-${mode}` turned out to be **entirely missing from both bundles** — four ids never written, invisible in English because each button carries a hardcoded fallback child, so Indonesian users read English sort labels in an otherwise-localised menu. Added, and pinned against the now-exported `SORT_MODES` (with `SortMode` derived from it, so a fifth mode cannot be added silently); `day-${dayKey}` verified complete the same way via exported `DAY_KEYS`.

  **A broad `return '<kebab-case>'` surface was measured and rejected**: 21 such literals resolve as ids but 6 must not be — `status-pending`/`status-synced`/`status-failed` are CSS class names returned by `statusClass()`, and `branch-location` is a topology port key. Demanding keys for those would have manufactured junk, exactly the `portId` trap. The three `id={fn(x)}` helpers are pinned by enumerating their switch returns instead.
- **I18N-03 — the untranslated-value count is not trustworthy** — **RECONCILED 2026-10-27; the count is 342/5967 (5.7%), not 225 or 440**. The two figures came from different SCOPE, not different normalization: re-running both methods over all 27 locale pairs gives **342 identical values either way** — raw equality and whitespace-collapsed/trailing-dot/lowercased equality produce the identical count, so normalisation is not the variable the audit suspected. What the 342 are, classified for the first time here: **54 contain Fluent placeables** (`{ $count }`, timezones, `{ $name }, { $price }`) and are language-neutral by construction; **219 are token-like** (≤12 chars: `PIN`, `QRIS`, `SKU`, `KDS`, brand marks, currency codes); and of the remainder, the English-word filter surfaces **26 candidates of which 24 are the single word `Total`** across eight files — a word that is `Total` in Indonesian too, which is why it is correctly identical. One real candidate survives that screen: `settings/workspace-modal-admin-settings` = "Admin Settings ↗", which a translator should look at. **The lesson is the one this file keeps re-learning: a percentage over a corpus is only meaningful with its denominator and its classifier.** Both earlier figures were arithmetically right and neither was actionable; 5.7% with a breakdown is. The measurement is reproducible from `shared-ui/locales/*.ftl` alone, no gate runs it, and no file was changed.
- **I18N-04 — hardcoded sites classified benign, open to challenge** — **PARTLY SETTLED 2026-10-27; one class was a real defect, not a judgment call**. The audit's own caveat held: "not worth localizing" was a judgment, and for user-visible hint text it was wrong. **FIXED** (commit `2a39fa5de`): the opening-balance inputs on `ShiftModals.tsx` and `ShiftManagementScreen.tsx` each carried a hardcoded `placeholder={minorUnitExponent(...) > 0 ? "e.g. 50.00" : "e.g. 50000"}` *inside* a `<Localized id="…-balance-placeholder" attrs={{ placeholder: true }}>` wrapper. Both keys existed and were already translated (`sales.ftl` and `shifts.ftl` `= .placeholder = e.g. 100.00`, `.id.ftl` `= mis. 50.000` / `mis. 100.000`), but the explicit JSX prop beat the localised attribute, so the FTL value was dead and every Indonesian user read English. Deleting the two props makes the existing translation reach the DOM — proved by rendering the wrapper alone and reading the attribute back: `RENDERED_PLACEHOLDER:"e.g. 100.00"`. Both sites keep their localised `aria-label` on the same input, which is why the defect was easy to miss: the element *looked* localised. **STILL A JUDGMENT, unchanged:** brand marks (`kasir.mu`), `Ctrl`/`S`/`F12` key hints, the `Pro` badge and the `aria-hidden` preview remain defensible as-is. **NO LONGER PRESENT:** `pcs / kg / box` returns 0 hits at HEAD, and the `A-01` hits the audit named are substrings of the debt marker `DATA-01`, not placeholders.
- ~~**I18N-05 — `verify-ci-docs-drift.py` is red and unenforced** — **RESOLVED 2026-09 (0.0.37 CI-gate restoration)**: the two retired gates were restored into `dev-ci.yml#static-gates` + `#ci-docs-drift` (commits `bf8f0da3`, `ecbcc635`, `af246396`, `f5d94a20`, `6e270d70`), `scripts/gates.json` now carries 69 gate records (52 required + 1 advisory + 16 retired), and `verify-ci-docs-drift.py` exits **0 with 0 drift items** when run today. The "78 dead workflow references" were closed by `af246396` (police the hook's CI pointers, fix the four that were already wrong). The original root cause — `23c96330` retired `ci.yml`/`nightly.yml` without a `gates.json` record — is no longer live; the checker now polices hook→workflow references (consistent with AGENTS.md's re-injected "10 gates / dev-ci.yml" claims, which are accurate).~~

## Bridge extraction (`crates/kasirmu-bridge`) — 2026-09-11 — PRESERVED, NOT REMEDIATED

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
  `.backup.db` beside the live db: `apps/desktop-tauri/src/commands/data.rs:33`
  (`get_backup_status`), `:42` (`create_backup`) → `crates/kasirmu-bridge/src/data.rs:274` /
  `:294`, target derived at `crates/kasirmu-bridge/src/data.rs:148` (`set_extension("backup.db")`);
  `DATA_EXPORT` is held only by the twins `crates/kasirmu-bridge/src/data.rs:712` and `:725`.
  Not scope-aware, so it stays not scope-aware.
- **BR-S2** — **[PBD]** `set_brand_logo_path` writes an **unvalidated** path whenever no
  `AppHandle` is present, under a comment skipping validation "for backward
  compatibility" — `crates/kasirmu-bridge/src/branding.rs:188-192` (comment `:189-190`) — and the
  scoped twin repeats the same skip at `crates/kasirmu-bridge/src/branding.rs:254-256`, so the
  H-3 containment rule (`branding.rs:71-74`) is conditional on the shell, not on the caller.
- ~~**BR-S3** — `set_brand_logo_path_scoped` gates `SETTINGS_EDIT` and persists to global instead of store db~~ —
  **CLOSED 2026-09-27** (`83b2f6c1f1 fix(branding): write the scoped logo where its scoped reader reads`).
  `set_brand_logo_path_scoped` in `crates/kasirmu-bridge/src/branding.rs:240-268` binds the store connection
  returned by `resolve_scope` and persists the logo path to the session's store DB, matching
  `get_brand_settings_scoped` and sibling setters. Pinned by `scoped_brand_logo_round_trips_through_the_store_db`
  in `branding_tests.rs` (14 passed, 0 failed). Stamped closed in register.
- ~~**BR-S4** — `open_product_images_scoped` authenticates and authorises nothing~~ —
  **CLOSED 2026-11-07** (`fix(browser): gate open_product_images_scoped with PRODUCTS_READ (BR-S4)`).
  `product_image_search_url` in `crates/kasirmu-bridge/src/browser.rs:56-85` now calls
  `ctx.require_session_permission(&session, permissions::PRODUCTS_READ)` after session resolution
  and before accessing the store DB. Pinned by `product_image_search_url_refuses_session_lacking_products_read`
  and `product_image_search_url_accepts_session_with_products_read` in `browser_tests.rs`.
- **BR-S5** — **[PBD]** `pick_logo_file` has no gate (`apps/desktop-tauri/src/commands/branding.rs:102`)
  where `pick_logo_file_scoped` holds `SETTINGS_EDIT`
  (`apps/desktop-tauri/src/commands/branding.rs:164`, gate at `:171`). Both keep their bodies
  desktop-side (no seam for `tauri::dialog` — ADR #49 §What was NOT extracted).
- **BR-S6** — **[PBD]** `set_setting` authorises a **caller-supplied** identity:
  `crates/kasirmu-bridge/src/settings.rs:989` takes `user_id: &str` (`:993`) and gates *that* at
  `:1007` (`require_permission_for_user`), while the value arrives from the renderer at
  `apps/desktop-tauri/src/commands/settings.rs:277` — the gate answers for whoever the
  caller names, not for the session.
- **BR-S7** — **[PBD]** `resolve_report_scope` authorises against the **global** identity db
  (`crates/kasirmu-bridge/src/reports.rs:65`, `:67-69`) and then opens
  `session.store_id`'s store db (`:71-73`) with no re-check of the binding between them.
- **BR-S8** — **[PBD]** `get_customer_scoped` is the one customer door that fails on gate
  **kind** rather than gate order, and it is why the door is *not* delegated (ADR #49 §4:
  *"Gates that are not scope-aware stay not scope-aware; an extraction is not the place to
  widen a gate."*). The tablet gates with the **non-scope-aware**
  `require_customer_permission` (`apps/mobile-tauri/src/commands/customers.rs:91` →
  `require_permission_for_user` on the global identity db, `:279-286`), where
  `crates/kasirmu-bridge/src/customers.rs:428` uses the scope-aware
  `ctx.require_session_permission`. The bridge's doc block (`:410-414`) asserts the shell
  used the scope-aware form — true of the **desktop** (`apps/desktop-tauri/src/
  commands/customers.rs:193-195` already delegates), false of the tablet. A third
  two-shell fork for the same owner ruling as `history`'s five export doors and
  `settings`' six scoped setters.
- **BR-S9** — **[PBD]** the two receipt-format **setters** are a two-shell gate fork, which is why they
  are *not* delegated. The tablet runs **one** gate, the scope-aware
  `require_permission_for_session(&state, &session, permissions::SETTINGS_EDIT)`
  (`apps/mobile-tauri/src/commands/receipt_format.rs:41`, `:99`); the bridge twins run the **same** gate
  and then a **second**, ADR #47 hierarchical-resource gate —
  `ctx.require_permission_for_session_resource(session, SETTINGS_EDIT, ScopeType::Location, …)` at
  `crates/kasirmu-bridge/src/receipt_format.rs:65-69` (the workspace id) and `:150-154` (the primary location
  id, resolved by the bridge-only helper `primary_location_id`, `:120`). Delegating would therefore
  **add** a gate the tablet has never enforced, which §4 forbids as plainly as removing one. The
  tablet's own module doc (`receipt_format.rs:1-4`) already records why: *"the location-resource scoping
  the desktop layers on top (ADR #47) has no tablet helper yet"*. `get_receipt_format_scoped` carries
  only the shared gate and **is** delegated. Same owner question as BR-S8 and BR-X4: which shell's gate
  set is authoritative.
- **BR-S10** — **[PBD]** `update_staff_scoped` is not delegated because the two shells disagree on the
  security-audit `debug_upgrade` flag — a divergence in **what gets audited**, not in a gate, so it is
  not covered by the BR-S8/BR-X4/BR-S9 ruling. `Store::record_security_event(event, debug_upgrade)`
  (`crates/kasirmu-core/src/db/audit_security.rs:382-392`) drops the write for a CONFIRMED Free tier
  (`ent.loaded && ent.tier.audit_retention_days().is_none()`), and `debug_upgrade` decides whether the
  desktop's dev Free→Premium promotion applies first. The tablet wrapper passes **`false`**
  (`apps/mobile-tauri/src/commands/auth.rs:81`); the bridge wrapper passes **`true`**
  (`crates/kasirmu-bridge/src/auth.rs:160`) — the desktop's behaviour. The core doc states the intent at
  `audit_security.rs:370-374`: *"tablet passes `false` so it never mirrors the desktop divergence"*.
  Delegating would therefore begin writing security events for Free-tier staff updates on the tablet in
  debug builds. Pinned by `confirmed_free_records_nothing_even_in_a_debug_build`
  (`apps/mobile-tauri/src/commands/staff_security_events_tests.rs:179-194`), which went red during the
  port and is how this was found. `create_staff_scoped` carries the same fork but not the exposure:
  `enforce_staff_quota` precedes the recorder and Free caps staff at one account, so a Free tenant
  cannot reach that `record_security_event` call.

### Correctness / robustness

- ~~**BR-C1** — `register_terminal` is a registered-shaped command that is **not in
  `invoke_handler!`** (16 of 17).~~ — **STALE 2026-11-05**: there is no bare `register_terminal`
  left in the desktop shell to register. The only `register_terminal` in `apps/desktop-tauri`
  is `sync_client::register_terminal` (`src/sync_bootstrap.rs:351`), a client call, not a
  command; the command is `register_terminal_scoped` and it IS registered
  (`apps/desktop-tauri/src/lib.rs:1654`). All sixteen `commands::terminals::` entries at
  `:1652-1667` are `_scoped`, so the 16-of-17 arithmetic no longer describes any state the
  shell can be in. Re-checked by grepping every `.rs` under `apps/` and `crates/` for the bare
  name: four hits, none of them a Tauri command.
- ~~**BR-C2** — `build_device_binding_dto` treated a keyring **read failure** as an
  invalid signature: `crates/kasirmu-bridge/src/terminals.rs:343` →
  `verify_binding(...).unwrap_or(false)` at `:357-364`, so `signature_valid:false` could not be
  distinguished from "the device secret could not be read" (`verify_binding` is at `:78`).~~ — **CLOSED**
  2026-11-06 (`fix(bridge): do not treat an unreadable keyring as a forged device binding (BR-C2)`).
  The DTO now propagates `verify_binding`'s `Err` as an `Internal` error named after the credential
  store, and keeps the unbound case answering `false` without consulting the keyring — those are
  different facts and they prompt opposite actions (re-bind vs. unlock the store).
  Pinned by `binding_dto_surfaces_an_unreadable_keyring_instead_of_a_false_verdict` and
  `binding_dto_answers_unbound_without_reading_the_keyring`:
  `cargo test -p kasirmu-bridge --lib terminals` → **2 passed** for those two cases (37 passed, 0 failed in the module).
- ~~**BR-C3** — `export_data` accepts `date_from` / `date_to` over IPC and **never reads
them** — a user-scoped "export this date range" silently exported everything.~~ — **CLOSED
2026-11-05** (`fix(bridge): honour the export date window instead of ignoring it`). The window
is now parsed at the boundary and applied to `sales` — the only dated collection the package
carries — as an INCLUSIVE day range (`helpers::export_date_window` /
`helpers::created_at_in_window`). Three refusals replace the silent ignore: a bound that does
not parse as `YYYY-MM-DD`, an inverted range, and a window presented without `sales` among
`types` (that last one is the case that used to ship an unfiltered package while the request
said otherwise). The `date_to` DAY IS KEPT — comparing the whole RFC-3339 `created_at`
against a bare date string drops every sale on the last day, which is the bug a naive fix
would have introduced — and a timestamp too short to carry a day is kept rather than
dropped, because this filter's failure mode is an export that quietly omits rows. Pinned by
ten cases in `data_tests` (`created_at_in_window_keeps_both_end_days`,
`export_window_refuses_a_bound_it_cannot_read`,
`export_refuses_a_window_when_sales_is_not_exported`, …); `cargo test -p kasirmu-bridge --lib
data::` -> **50 passed, 0 failed**.
- ~~**BR-C4** — `create_backup` holds the **global connection guard** from `Store::backup`
  through a filesystem stat with no explicit drop.~~ — **CLOSED 2026-11-05** (`fix(bridge):
  release the global guard before the backup size stat`). The guard now lives in its own
  scope that ends with `store.backup`; the `metadata` stat runs after it is released. Safe
  because the snapshot file is complete when `store.backup` returns and nothing else may
  write it under the same guard. `cargo test -p kasirmu-bridge --lib data::` -> **51 passed,
  0 failed**; the pin is structural (a lock scope is not observable from a test), so the
  guard against regression is the scope block itself, not an assertion.
- ~~**BR-C5** — `import_data` used to mix connection-bound existence probes with
  transaction writes inside one open transaction.~~ — **CLOSED 2026-11-06**.
  The cited shape no longer exists and was replaced by the crate's own design: `import_data` now opens
  a single `tx` (`crates/kasirmu-bridge/src/data.rs:540`) and does every existence read through
  `tx.prepare_cached("SELECT …")` + `rows.next()` plus `tx.execute(` writes — there are **no**
  `store.conn()` probes left in the body. The only reads that touch `conn` before the `tx` opens are
  the two pre-transaction batch gates (`gate_import_product_batch`, `gate_import_user_batch` at
  `:530`/`:537`), and each of those is exactly one `store.conn().prepare_cached("SELECT …")`
  read used to build a pre-tx snapshot, then it refuses (never writes) via the centralised
  `Store::ensure_quota_allows` (W4-S2 / `quota_gate`, W4-S1). That is the same read-only-pre-tx-
  snapshot-then-write-transaction shape the quota gate already centralises, so the original "two paths
  can disagree about the same row" concern is now covered by the existing design rather than by a
  module-local fix: the gate's snapshot cannot disagree with the tx's eventual writes because the gate
  only refuses and WAL sees the pre-tx state for that snapshot. The stale citations (`tx` at `:518`,
  `store.conn()` probes at `:562`/`:589`/`:614`/`:645`) are dead text; today's `tx` opens at `:540`
  and the body has no `store.conn()` calls. Pinned by re-grep: `rg -n "store.conn()|tx.execute|tx.prepare"
  crates/kasirmu-bridge/src/data.rs` shows the body has no `store.conn()` and the only `conn`-touched
  reads before `tx` are the two W4-S2 gates. The PBR verdict from the original text does not apply to
  the current shape.
- ~~**BR-C6** — `export_data`'s features map silently **empties** on a read error
  (`load_features().map(...).unwrap_or_default()`) — a failed feature read exported as "no
  features", not as an error.~~ — **CLOSED 2026-11-05**. The export now propagates with `?`,
  matching every other `load_features()` site in the crate (`features.rs:56`, `:150`, `:286`,
  `:635`). The consequence was not cosmetic: the package RESTORES with every flag off while
  the export reported success, so a merchant's features came back disabled with nothing in
  the result saying why. Pinned by `export_data_propagates_a_failed_feature_read`, a source
  scan rather than a driven test — provoking the failure needs a corrupt settings row whose
  parse behaviour is a property of `Settings::load_features`, not of this command, so only
  this body's choice to propagate is ours to pin.  `cargo test -p kasirmu-bridge --lib data::`
  -> **51 passed, 0 failed**.
- ~~**BR-C7** — `gather_usage` turns four database faults into logged zeros.~~ —
  **CLOSED 2026-11-06** (`refactor(subscription): fail-closed quota usage counts on database read errors`).
  `gather_usage` in `crates/kasirmu-bridge/src/subscription.rs:132-150` now logs the database error and
  reports `i64::MAX` for the faulted counter rather than `0`. Quota gates evaluate against the limit
  and fail closed (locking creation doors on DB errors) rather than assuming zero usage. Pinned by
  `cargo test -p kasirmu-bridge --lib subscription` (35 passed, 0 failed).
- **BR-C8** — **[PBD]** `per_location_over_quota_rows` has a TOCTOU shape:
  `crates/kasirmu-bridge/src/subscription.rs:639` probes `manager.store_db_exists(store_id)` and
  `:642` then opens it (`open_store`); the file can appear or vanish between the two. A
  store that fails to answer is skipped, not fatal (`:660-663`).
- ~~**BR-C9** — `gate_permission` is computed twice for the same feature in one verdict.~~ —
  **CLOSED 2026-11-05** (`refactor(subscription): derive the gated permission once per
  verdict`). One binding now feeds both the `require_permission` probe and the permission
  reported beside it, so the enforced and the reported answer cannot diverge. Pinned by the
  module suite: `cargo test -p kasirmu-bridge --lib subscription` -> **35 passed, 0 failed**.
- ~~**BR-C10** — `get_hardware_settings_scoped` carries an inherited **double session read**.~~ —
  **CLOSED 2026-11-06** (`refactor(settings): eliminate redundant resolve_scope in get_hardware_settings_scoped`).
  The redundant `resolve_scope` call following `resolve_session` and permission validation was removed;
  hardware profiles utilize the global DB, and token resolution is already complete. Pinned by
  `cargo test -p kasirmu-bridge --lib settings` (107 passed, 0 failed).
- ~~**BR-C11** — `run_list_credit_sales` binds the **payment reference** into the **customer
  name** column.~~ — **STALE 2026-11-05**: the function moved to
  `crates/kasirmu-bridge/src/settings/core.rs:72` and the faulty selection is gone. The query
  now reads `COALESCE(c.name, '') AS customer_name` at index 1 through
  `LEFT JOIN customers c ON c.id = s.customer_id` (`core.rs:80-86`), so the column holds the
  customer's name (empty when the sale is unattached) and `gateway_reference` is never
  selected. The finding's line references describe a shape the file no longer has; whoever
  picks this up next should re-grep `gateway_reference` in the bridge before trusting any
  older note about it.

### Consistency across modules — **a PATTERN, three independent instances**

- **BR-X1** — **[PBD]** store-open asymmetry inside one module:
  `crates/kasirmu-bridge/src/terminals.rs` reaches the store db through `db_manager.open_store` in
  **9** commands (`:436`, `:474`, `:525`, `:556`, `:591`, `:664`, `:700`, `:758`, `:810`) and
  through `ctx.resolve_store` in **7** (`:187`, `:217`, `:240`, `:265`, `:285`, `:308`, `:332`)
  — two session-resolution paths with different failure text and different re-entry
  behaviour, in the same file.
- **BR-X2** — **[PBD]** same split as a *db-selection* asymmetry in features:
  `list_all_features` reads the **global** db (`crates/kasirmu-bridge/src/features.rs:53-54`) while
  `list_all_features_scoped` reads the scope's **store** db
  (`crates/kasirmu-bridge/src/features.rs:629-633`) — the pair can answer differently for one user.
- **BR-X3** — **[PBD]** and in prose: `apps/desktop-tauri/src/commands/settings.rs:9-11`
  still promises that store name / currency / features "may be exposed here in the future",
  while the generic key-value (`:274` `set_setting`), hardware (`:178`, `:351`) and batch
  (`:311` `set_settings_scoped`) commands are already exposed in that same file.
- **BR-X4** — **[PBD]** and as a **two-shell fork** in `customers`, which is why five of its
  seven doors are *not* delegated. The tablet opens the store db **before** the permission
  gate (`resolve_scope` → `require_customer_permission`) at
  `apps/mobile-tauri/src/commands/customers.rs:115-116` (`create`), `:141-142` (`update`),
  `:167-168` (`delete`), `:194-195` (`search`) and `:226-227` (`history`); the bridge twins
  gate first and open afterwards (`crates/kasirmu-bridge/src/customers.rs:458-460`, `:488-490`,
  `:516-518`, `:545-547`, `:579-581`). The bridge is **not** consistent about this — it
  preserves the open-before-gate order in `gift_cards` (`:49-51`), `loyalty` (`:87-89`) and
  `purchasing` (`:500-502`) — so this is the desktop body the module was ported from, not a
  crate rule. It matters because `open_store` is not free: on a cache miss it creates the
  directory, creates the database file and runs migrations
  (`platform/core/src/database/manager.rs:73-103`). So against an unopenable store an
  unauthorized caller gets `Internal("opening store db: …")` on the tablet and
  `PermissionDenied` on the desktop. **Owner ruling needed** — one answer settles this,
  BR-S8, `history`'s five export doors and `settings`' six scoped setters.

### Doc / test debt

- ~~**BR-D1** — `"all 32 features"` is wrong while the enum carries **39** variants.~~ —
  **CLOSED 2026-11-05** (`docs(features): stop restating a feature count the enum already
  answers`). It was wrong in **five** places, not three: the register missed
  `apps/mobile-tauri/src/commands/features.rs:3` and `:345` and
  `crates/kasirmu-core/src/features.rs:9`. The count is now not stated at all rather than
  corrected to 39 — a prose count is the drift, and the enum is the source of truth. The
  core module doc is the one every other copy was derived from, which is why the sweep
  started there.
  STILL OPEN as a separate question: the two core test enumerations carry **33** and **37**
  (`crates/kasirmu-core/src/features_tests.rs:181`, `:389`). Neither matches 39, but a test
  that enumerates a subset may be deliberate — pinning it needs a reading of what each case
  asserts, and this pass did not do that. Do not "fix" the numbers without it.
- ~~**BR-D2** — `device_hostname` is undocumented because its doc block is fused into
  `feature_to_module_id`'s comment run, so rustdoc attaches both to `feature_to_module_id`
  and `missing_docs` never fires for the helper.~~ — **CLOSED 2026-11-05**, same commit as
  BR-D1: the block now sits directly above `fn device_hostname()`, which is where the
  attribute was always meant to land.
- **BR-D3** — **[PBD]** caller-outside-tests-only desktop adapters. **Correction to the
  hand-off:** the count is **15**, not five, and the two named precedents are already
  harvested — the settings adapter went in `2d233fc5b` and the tax rounding-mode adapter in
  `ee56fd04d`. Remaining: `commands/data.rs:53`, `:86`, `:95`; `commands/features.rs:33`,
  `:38`; `commands/offline.rs:24`, `:31`, `:36`; `commands/products_images.rs:139`;
  `commands/sync.rs:81`, `:95`, `:105`, `:135`, `:148`; `commands/terminals.rs:270`.
  Each is `#[allow(dead_code)]` with a comment naming its test file as the only caller; all
  are cleanup candidates **once their tests relocate to `oz-bridge`**, not before.
- ~~**BR-D4** — **[PBD]** dead IPC surface per the parity gate~~ — **CLOSED 2026-11-06**
  (`refactor(pos): retire uncalled get_active_cart_scoped and list_active_carts_scoped`).
  Both dead commands were removed from `apps/mobile-tauri/src/commands/pos.rs` and its
  `generate_handler![]`, unmounted from `ui/src/dev-mock/handlers/sales.ts`, removed from
  `docs/guides/developer/api-reference.md`, and pruned from both `scripts/shell-divergence.json`
  (109 → 107) and `scripts/ipc-parity-allowlist.json` (`scoped_orphans` debt reduced from
  24 → 22, gated dead surface from 10 → 8). All IPC and surface checkers confirm clean parity.
  wrong lines of that file.
- ~~**BR-D5** — four model helpers are `pub` only so `model_tests.rs` can reach them~~ —
  **CLOSED 2026-11-07** (`refactor(topology): scope serialization helpers to pub(crate) (BR-D5)`).
  `ser_f64_finite`, `de_f64_or_null`, `de_direction_or_null`, and `default_direction` in
  `crates/kasirmu-bridge/src/topology/model.rs` are narrowed from `pub` to `pub(crate)` now that
  `model_tests.rs` is mounted internally as a sibling module. Pinned by `cargo test -p kasirmu-bridge --lib topology`
  (333 passed, 0 failed).

### Tooling gaps found while building the gates

- ~~**BR-T1** — `scripts/verify-ipc-parity.py` gate-balance scan non-recursive glob~~ —
  **CLOSED 2026-11-06** (`scripts/verify-ipc-parity.py:2639`). The scanner now uses `cmd_dir.rglob("*.rs")`,
  matching the reach of the registry scan and examining `apps/desktop-tauri/src/commands/topology/`.
- **BR-T2** — the extraction's own count invariant is blind in the same way: `grep -rh
  'pub async fn' apps/desktop-tauri/src/commands/*.rs` is non-recursive, so it cannot see the
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
  (`crates/kasirmu-bridge/src/pos.rs:232`, `:345`). 16 of the 25 allowlisted orphans now have zero
  gate text in their desktop body; for those 16 the bridge body also has none, so no verdict
  has flipped **yet** — but the check can no longer see an extracted desktop gate, and the
  campaign is still moving bodies. The two GATED verdicts in `BR-D4` were reachable only
  because a **tablet** copy of the body still carries the gate inline.

### dated addendum, 2026-09-13 09:50 +07 (tip `ad76c16c2`) — the two cart orphans, and the recurrence

- dead **and** gated, zero ui callers (four greps, 09:45 +07): scoped names over `ui/` → 0; wrappers `listActiveCartsScoped|getActiveCartScoped` over `ui/src` → 0; unscoped literals over `ui/src` → the only 2 hits are handler rows at `ui/src/dev-mock/handlers/sales.ts:515-516`, not callers; tree-wide the names exist only in tablet `pos.rs:278`/`:313`, tablet `lib.rs:550-551`, the allowlist and docs. their unscoped twins at `pos.rs:268`/`:300` are declared but registered in neither shell (same grep over `apps/desktop-tauri` and `apps/mobile-tauri`).
- the guard cannot fire: `SALES_PROCESS` is granted at `platform/core/src/rbac_presets.rs:53`, `:137`, `:166` — Manager, Staff and Admin, which is both presets carrying `TERMINALS_REGISTER` (`:117`, `:231`) — and Owner holds `&["*"]` at `:46`. note that `apps/desktop-client/src/rbac_presets.rs` does not exist (`git ls-files apps/desktop-client/src/rbac_presets.rs` → empty, 09:47 +07): rbac lives in `platform/core`, and notes and briefs keep citing the phantom path.
- a pin over unreachable code is a monument, so the honest repair is **deletion**, parked with the tablet crate owner because the delete slice crosses into `apps/mobile-tauri` and into the allowlist, neither of which this lane edits.
- the recurrence: `docs/plans/_backlog/0.0.36-backlog.md:3127-3135` records this exact error once — a manual triage reported 6 gated, the gate found 8, because permissions were checked only for orphans whose unscoped twin the ui calls and the group where neither was called was skipped. tonight's sweep (`python scripts/verify-ipc-parity.py`, 09:48 +07, exit 1) prints `2 GATED DEAD SURFACE -> get_active_cart_scoped=SALES_PROCESS, list_active_carts_scoped=SALES_PROCESS` against those 8. one mechanism, one sentence: **a manual sweep restricted to orphans with a called unscoped twin systematically undercounts the gated ones.** that backlog file is right and was not touched.

## Git scratch — `git clean -xdf` deletes the ignored `.agents/` set and `.env` (`GH-CLEAN-01`, PARTLY MITIGATED 2026-10-27, added 2026-09-13 11:15 +07, tip `867cec26a`)

**Status: the hazard is real; the top-level guard now sits where every agent reads.** A rule was
added to `AGENTS.md` §3 (commit `ed4382cc0`) — **NEVER run `git clean -x…`** — carrying the
measured numbers and a pointer back here. That is the REQUEST half of this entry fulfilled at the
top level; the hook/wrapper half is still the owner's to place, and nothing in `.gitignore`,
`.githooks/`, `scripts/gates.json`, `.agents/salvage/` or `C:/dev/ozpos/backups/` was touched.

**Re-measured 2026-10-27, and both halves of the claim still hold.** `git clean -xdn` names **82**
removable entries (`.env` among them, plus live scratch under `.agents/`); `git clean -dn` WITHOUT
`-x` names **0**. The whole hazard is the one flag, exactly as written below. The `.agents/`
contribution has fallen from the 23 paths recorded in September to **4** as older scratch was
collected — the hazard shrank, it did not close. Every figure below keeps the minute it was taken;
a total quoted without its minute is worthless in this checkout, where sibling sessions write
continuously.

- **The command.** `git clean -xdf`. `-x` is the load-bearing flag: it means *also remove ignored
  files*, and this repo has been parking in-flight agent work in ignored paths all morning.
  Measured in this worktree (`git clean -xdn`, 11:15 +07, tip `867cec26a`): 71 entries, 21 of them
  directories collapsed to a single line each; 23 entries — 59 files — belong to the `.agents/`
  ignore block below. The same run also names `.env` (ignored at `.gitignore:66`, never committed,
  named by `AGENTS.md` as the source of truth for every `OZPOS_*` key), so a command repeated as
  routine "reset the tree" advice deletes the credential file along with the recovery material.
  `git clean -dfn` without `-x` names 8 entries and touches nothing under `.agents/` (11:19 +07):
  the whole hazard is the one flag.
- **What it deletes, by line, as measured now** (`git check-ignore -v` against a live path per
  pattern, 11:09 +07 — not from memory): the block is **`.gitignore:259`–`:267` plus
  `:272`–`:273`**. Salvage is `:259`, *outside* the 260–267 range it is usually quoted with, and
  two more ignored scratch paths sit below that range. `git blame` puts all of them on
  2026-09-13 **morning**, not tonight — `9d14f999fff` 07:29:48 (`:259`, `:262`–`:267`),
  `bc3a12e67b8` 07:46:54 (`:272`–`:273`), `b37ca26436b` 08:31:33 (`:260`–`:261`):

  | line | pattern | live matches | files | bytes |
  |---|---|---|---|---|
  | `:259` | `/.agents/salvage/` | dir present | 37 | 1,007,612 |
  | `:260` | `/.agents/devmock-*` | 8 | 8 | 39,998 |
  | `:261` | `/.agents/tauri-api.pre-*.ts` | 5 | 5 | 953,512 |
  | `:262` | `/.agents/gate-cont*.sh` | 4 | 4 | 3,932 |
  | `:263` | `/.agents/gate-continuation.sh` | 1 | 1 | 665 (already inside `:262`'s 4) |
  | `:264` | `/.agents/gate-wave-12.sh` | 1 | 1 | 1,370 |
  | `:265` | `/.agents/gate-gap.raw.txt` | 1 | 1 | 36,599 |
  | `:266` | `/.agents/phase21-commitmsg.txt` | 1 | 1 | 2,502 |
  | `:267` | `/.agents/registration-gate-harness-state.md` | 1 | 1 | 18,473 |
  | `:272` | `/..rev_ae_bridge_commands.rs` | 1, repo root | 1 | 44,987 |
  | `:273` | `/.agents/orphan-mod-rs.diff` | 1 | 1 | 1,429 |

  Counts and bytes at 11:12 +07: 23 distinct paths, nothing missing, 2,110,414 bytes across the
  whole block including salvage. One of the 23 is **tracked** — `.agents/devmock-kds-extract.py`
  (`git ls-files --error-unmatch`, 11:12 +07) — so `clean` will not take it and the removable set
  is 22 scratch + 37 salvage = 59, which is exactly what the dry run prints.
- **Is any live path there right now? Yes, both halves.** `.agents/salvage/` exists and is **not**
  empty — 37 files / 1,007,612 bytes, 14 of them under `salvage/blobs/` (11:12 +07). So for the 22
  other paths the hazard is **current**, and for the salvage set it is **prospective and covered**.
  Writing it the other way round either way is the error this entry exists to avoid.
- **The claimed mitigation, verified from the filesystem rather than trusted.**
  `C:/dev/ozpos/backups/salvage-outside-repo-0755` **exists**: 37 files, 1,007,612 bytes, the same
  37 names as the in-repo set with **zero** one-sided files, and **37/37 sha256 pairs identical**
  between the copy and the working tree (11:12 +07). It carries **two** manifests —
  `MANIFEST.sha256` (19 rows) and `blobs/MANIFEST.sha256` (14 rows) — and all **33 rows verify**
  against both copies. Two gaps to record honestly: the rows name paths as `.agents/salvage/...`
  relative to the **repo**, so `sha256sum -c` run *inside* the backup dir fails on every row — the
  hashes are right, the recorded paths are unusable from there; and two files appear in **neither**
  manifest (`eodpin-reland-msg.txt` 2,774 B, `sixth-name.COMMIT-MSG.txt` 3,947 B) — copied but
  unlisted, so the manifests prove 33 of 35 contents files and are silent on the rest. The newest
  `mtime` on both sides is 06:15 +07 (dir `mtime` 06:15:46 +07, not the 07:55 the name implies), so
  the copy is **in sync with the live set at the minute measured**, not merely once made.
- **What the mitigation does NOT cover.** The salvage directory and nothing else. A name scan of
  every sibling under `C:/dev/ozpos/backups` (`git-20260913-061103`, `packdir-20260913-062232`,
  `probe`, `reflog-0634`) for `devmock|gate-cont|tauri-api\.pre|orphan-mod-rs|phase21-commitmsg|registration-gate-harness|rev_ae_bridge`
  returns **zero** hits (11:12 +07), and the object store is no fallback for those 22 files either:
  `git hash-object` + `git cat-file -t` per file (11:12 +07) shows **16 with no git object at all** —
  the 7 non-kds `devmock-*`, all 4 `gate-cont*.sh`, `gate-wave-12.sh`, `gate-gap.raw.txt`,
  `phase21-commitmsg.txt`, `registration-gate-harness-state.md`, `orphan-mod-rs.diff` — against 6
  that exist as blobs (the five `tauri-api.pre-*.ts` and `..rev_ae_bridge_commands.rs`). Within
  salvage, 5 of its 21 non-blob contents are likewise absent from the store
  (`registration_gate_tests.rs` and `.CEILINGS`, `kernel_lifecycle.COMMIT-MSG.txt`, plus the two
  unlisted files above). Separately the 14 salvaged blob names **all still resolve**
  (`cat-file --batch-check` → `blob` ×14) but **0 of 14** appear in `git rev-list --objects --all`
  (79,057 objects) and **0 of 14** are loose — packs only, which puts `git gc --prune` on the same
  material as a different command, mitigated by the outside copies at
  `backups/git-20260913-061103` and `backups/packdir-20260913-062232` (`.agents/incidents/incident-object-loss.md:8`,
  `:144`). The 14 salvaged blobs are therefore **not** the fragile half; the 16 uncommitted scratch
  files are.
- **Residual risk, one line:** an in-flight scratch directory is unrecoverable if cleaned — 16 of
  the 22 removable paths exist nowhere else by any measure above, and nothing that was never
  committed has any backup.
- **The fix is NOT this file, NOT `.gitignore`, and NOT a git config.** Editing `.gitignore` only
  changes what `git status` shows; widening a pattern is not safety, and this block disproves it
  twice — `:263` is already inside `:262`, and `:260` reaches a **tracked** file that `clean`
  refuses to delete. An ignore line is a visibility filter, not a guard. Nor is a config:
  `core.hooksPath` = `.githooks` here, and `git config --get clean.requireForce` is **unset**
  (11:15 +07), whose default only refuses a force-less clean — every invocation typed with `-f`,
  which is every invocation anyone types in a hurry, walks straight past it. `git --version` is
  2.50.0.windows.2 and its `githooks(5)` documents **no `pre-clean` hook** (no match for
  `pre-clean` in `share/doc/git-doc/githooks.html`; it does document `pre-auto-gc`), so a
  clean-time guard has to be a policy or a wrapper that owns the `-x` flag, with `pre-auto-gc`
  carrying the prune side. `.githooks/` holds four hooks today (`commit-msg`, `post-commit`,
  `pre-commit`, `pre-push`) and no `CODEOWNERS` is tracked, so the owner is whoever lands
  `.githooks` commits — last three `9898b3b1e`, `1c59fea5f`, `df5d0dc16`, all 2026-09-12/13.
  **This entry is the request to that owner; the guard is theirs to place.**
- **Where this hazard was recorded before now:** only in
  `.agents/manager-journal-repair-validated-findings.md:2992`, which is itself ignored
  (`.gitignore:252` `.agents/manager-journal*`, `git check-ignore -v` 11:15 +07) — the sole
  written record of the deletion sat in a file the same command deletes. `git grep -n "xdf"` over
  tracked files returns nothing (exit 1, 11:15 +07), which is why it is filed here.

## Six gate-integrity findings this lane measured and cannot repair (`GI-1`–`GI-6`, OPEN, added 2026-09-13 11:55 +07, tip `335dcc306`)

**Status:** SIX OPEN findings, recorded as a register entry and a request, not as a repair — every one
of them sits in a path another session owns, so the owner is named **by file** (no `CODEOWNERS` is
tracked: `git ls-files -- CODEOWNERS .github/CODEOWNERS` returns nothing, 11:48 +07). Each figure
carries the minute and the unit it was measured with, and the command that reproduces it. Nothing
outside this file was written; the only gate run here was read-only (`python3
scripts/verify-ipc-parity.py`, never with a writer flag), and `scripts/gates.json` was read through
`git show HEAD:scripts/gates.json` rather than opened. Three figures handed to this lane did not
reproduce; each correction is inline, in the bullet that carries it.

- **GI-1 — `scripts/gates.json` answers one question two ways.** Measured 11:36–11:42 +07: three gate
  records assert in their own note that they are local-only while the same record carries a `ci` key —
  `scoped-coverage` note `:120` / `ci` `:121`; `topology-parity` note `:136` ("Local-only:
  check.sh is its only runner.") / `ci` `:137`; `test-shadow-copies` note `:187` / `ci` `:188`.
  The workflow settles which half is false: `.github/workflows/dev-ci.yml` runs
  `verify-test-shadow-copies.py` at `:588`, `verify-topology-parity.py` at `:598` and
  `verify-scoped-coverage.sh` at `:606` (all three, 11:42 +07), so the **notes** are the wrong half —
  and `gates.json` is the file that calls itself the source of truth for gate coverage. A reader who
  trusts the note and a reader who trusts the key get opposite answers about whether a gate exists in
  CI, from inside one JSON object. **Correction to the hand-off:** it named `:128` (`ipc-parity`) as
  one of the three; at 11:38 +07 that note is already self-corrected prose ("the note claiming it
  local-only was itself stale and was corrected here"), so `ipc-parity` is a false positive of the
  pattern search and `test-shadow-copies` is the instance the summary missed. Mechanically: 4 records
  match `local[- ]only|no ci key` and carry a `ci` key; 3 still state the falsehood (11:36 +07).
  Owner: `scripts/gates.json`.
- **GI-2 — the same file's numbers are prose, and no code can refresh them.** `gates.json:128` quotes
  "Measured on the current tree: 406 UI command strings; desktop 400 registered / 28 unregistered
  references / 5 unregistered fns; tablet 283 registered / 142 unregistered references". The gate
  printed at 11:37 and 11:48 +07 — in the words it used then, `info[desktop]: 453 UI command strings,
  451 registered, 27 unregistered references (16 unregistered command fns)` and `info[tablet]: 453 UI
  command strings, 320 registered, 153 unregistered references (0 unregistered command fns)`, the
  same line reworded to "unregistered UI command names / tauri command fns" by 11:55 +07 as another
  lane edited the reporter —
  every one of the six quoted figures has moved (406→453 strings, +47; 400→451 desktop registered;
  28→27 desktop unregistered names; 5→16 unregistered fns; 283→320 tablet registered; 142→153 tablet
  unregistered names). Nothing can close that gap by itself: the checker's writer flag targets
  `scripts/ipc-parity-allowlist.json` and never `scripts/gates.json`, and
  `scripts/verify-ci-docs-drift.py`, whose declared subject is this manifest ("source of truth:
  scripts/gates.json", `:24`), touches `_note` at exactly one place — `:264`, a non-empty test — so
  it polices that a note exists and not that its numbers are true (11:48 +07). **A number written into
  prose cannot be refreshed by the code it describes; it can only be re-typed, which is why it rots.**
  Owner: `scripts/gates.json`.
- **GI-3 — `--staged-only` is one flag name carrying three semantics, and only one of the three reads
  what a commit will contain.** Measured 11:43 +07, on working copies clean at that minute.
  `scripts/verify-ftl-orphans.py` builds its verdict from `staged_diff()` at `:117-121`, which shells
  `git diff --cached -U0 -- ui/src/locales ui/src` → true index-vs-HEAD content.
  `scripts/verify-migration-column-types.py` takes the file **names** from the index at `:145-146`
  (`git diff --cached --name-only --diff-filter=ACM -z`) but the **bytes** off disk — `:141` globs the
  migrations directory, `:150` filters that list down to the names, `:118` `path.read_text` reads the
  working copy — so a migration staged half-way is judged on content no commit contains.
  `scripts/verify-bundle-parity.py` documents its own third reading at `:114`: "`--staged-only PATH
  …` reads the FULL post-stage file content (not the diff vs. HEAD)", the flag filtering paths only.
  So the flag answers "which files" for one script and "what is committed" for another, and in two of
  the three a green `--staged-only` is a statement about the mutable surface — which is exactly how a
  working-tree claim gets read as a HEAD claim, by the next hook log or the next agent. Owner: the
  three `scripts/verify-*.py` paths.
- **GI-4 — five unwired checkers (seven files): verification that reads as coverage and enforces
  nothing.** Census 11:41 +07 over the **30** tracked `scripts/verify-*`: 21 are named in
  `.github/workflows/dev-ci.yml`, 23 in `scripts/check.sh` or `scripts/check-ui.mjs`, 3 in
  `.githooks/pre-commit`, 8 in `scripts/gates.json` — and **7 in none of those**:
  `verify-fluent-dynamic-families.py`, `verify-dockerfile-workspace.py`,
  `verify-quota-coverage.sh`, `verify-flaky-quarantine.py`, `verify-docker-all.sh`,
  `verify-docker-digests.sh`, `verify-docker-persistence.sh`. Per-name `git grep -n
  --fixed-strings <name> -- .` (11:40 +07): fluent-dynamic-families → **0 hits repo-wide**, a tracked
  checker with no reference of any kind; dockerfile-workspace → 9 hits whose only runner-shaped one is
  the retired `.github/workflows/ci.yml.bak:668`, while `Dockerfile.server:87` states in a comment
  that the file is validated "by scripts/verify-dockerfile-workspace.py in CI" — and the two live
  workflows are `dev-ci.yml` and `release.yml` (11:46 +07), neither naming it; quota-coverage → 4
  hits, three of them its own header and one a work-order's past tense; flaky-quarantine → 10 hits
  including two retired `.bak` workflows, a `CONTRIBUTING.md:283` instruction to run it by hand, and
  one live caller that is `scripts/diagnose-pr.py:31` — a diagnostic, not a gate; the docker-all
  family → `verify-docker-all.sh` from `scripts/diagnose-pr.py:44` and two `docs/plans/_active/notes.md`
  lines, its two children only from `verify-docker-all.sh:57` and `:45` plus a `.bak` workflow each.
  Note one of the seven is already documented as unwired — `docs/operations/ci-pipeline.md:68` records
  `flaky-quarantine` as "❌ Runs nowhere" — so the hazard is not that nobody wrote it down, it is that
  the file still exists and a grep for `verify-` finds it. **An unwired checker reads as coverage to
  the reader who greps, and a `.bak` line makes a retired gate look wired to that same reader.**
  Owner: `scripts/` for the files; `.github/workflows/dev-ci.yml` for any of them meant to be
  enforced.

  **Progress 2026-11-06 -- re-measured the named-seven today; the "5 remain" line is stale.**
  Re-measured by grepping each name against the live runners (
  `.github/workflows/dev-ci.yml`, `scripts/check.sh`, `scripts/check-ui.mjs`,
  `.githooks/pre-commit`) plus `scripts/gates.json`, on the tracked `scripts/verify-*` set
  (51 files today; the earlier census of 30 predated the self-test sweep that added ~20
  self-test-only companions). Today **0 of the named-seven are unwired in all** -- every one
  of the seven is named in at least one live runner. The honest split today is not "unwired
  vs wired" but "fully wired and running vs self-test-only vs resolved-not-to-wire":
  `verify-flaky-quarantine.py` and `verify-dockerfile-workspace.py` are both invoked by
  `check.sh` now, each with a `--self-test` beside it, all four steps registered in
  `gates.json`. `verify-flaky-quarantine.py` also gained a real `--self-test` (it used to
  REFUSE the flag) and a zone-agnostic strict-argument rule, so the leg that had the
  documented silent fall-through is now covered.

  The docker FAMILY is the last item and its fix is known; what is missing is a
  decision, not a defect. Measured 2026-09-29: this repo has NO live `schedule:`
  trigger. All four in the tree are in retired .bak files (`docker-digest-drift.yml.bak:16`,
  `docker-persistence.yml.bak:20`, `nightly.yml.bak:18`, `security.yml.bak:4`), and
  `dev-ci.yml:575` carries an explicit "WHY NOT A SCHEDULE" note: a `schedule:` there would
  run all its jobs nightly, which is not what a weekly pin check wants. So the answer is a
  DEDICATED scheduled workflow, not a schedule on dev-ci -- which is exactly what
  `docker-digest-drift.yml.bak:5-10` was, down to its own rationale ("if pins are refreshed
  deliberately, this scheduled job re-resolves..." and "on drift the job exits 1, so a
  scheduled-run failure alerts maintainers"). The retired file is a usable draft.

  Not done here, and the reason is a decision rather than effort: this would be the FIRST
  live schedule in the repository, and GitHub bills scheduled runs on private and
  inactive repos. That is an owner's call about cost and about whether the repo wants
  nightly CI at all, and it is not something a documentation commit should decide.

    - `verify-fluent-dynamic-families.py` -- **wired and running**: `check.sh:1199` (the gate)
    and `check.sh:1206` (its `--self-test`), and `dev-ci.yml:1603`. Same shape the Progress
    note credits `flaky-quarantine`/`dockerfile-workspace` with. RESOLVED and wired.
  - `verify-dockerfile-workspace.py` -- **wired and running**: `check.sh:300` and
    `check.sh:301` (`--self-test`), and `dev-ci.yml:1252`. RESOLVED and wired.
  - `verify-flaky-quarantine.py` -- **wired and running**: `check.sh:1143` and
    `check.sh:1144` (`--self-test`). RESOLVED and wired. (The Progress note itself records
    this one; it just omits that `fluent-dynamic-families` got the same treatment.)
  - `verify-quota-coverage.sh` -- **self-test-only, by design, RESOLVED**: `check.sh:1176`
    runs its `--self-test`; the gate itself is NOT a step because its non-zero exit is a
    REPORT, not a verdict (the `seed_primary_store` bootstrap door is deliberately ungated for
    good -- gating it makes a fresh install unbootable). Same shape the note already records
    for this one: "a report whose finding is information for a human, not a PR condition."
    Do NOT wire it as a blocking step.
  - `verify-docker-all.sh` -- **self-test-only**: `check.sh:319` runs its `--self-test`; the
    gate itself is not a step because every stage needs a live Docker daemon and
    `verify-docker-all.sh` orchestrates four stages, so the body cannot run in a no-daemon
    step. The self-test is the enforceable half (text analysis, no daemon).
  - `verify-docker-digests.sh` -- **self-test-only**: `check.sh:312` runs its `--self-test`;
    the gate itself re-resolves every `image:tag@sha256:` against a REGISTRY, so a real run
    is a manual "refresh a pin" action, not a PR condition. The file itself argues for that
    cadence ("manual script, not gate -- run by hand before refreshing a pin"), and that
    argument is the finding, not a defect in the wiring.
  - `verify-docker-persistence.sh` -- **self-test-only**: `check.sh:330` runs its
    `--self-test`; the gate itself is reachable only through `verify-docker-all.sh`'s stage 1,
    which `--self-test` exits before, so the body has no independent runner. The self-test is
    the enforceable half.

  So today the named-seven split is: **3 fully wired and running** (
  `verify-fluent-dynamic-families.py`, `verify-dockerfile-workspace.py`,
  `verify-flaky-quarantine.py`), **3 self-test-only** (the docker family
  `verify-docker-all.sh` / `verify-docker-digests.sh` / `verify-docker-persistence.sh`), and
  **1 resolved-not-to-wire** (`verify-quota-coverage.sh`). The "5 remain" line is stale on
  both counts: three of the five it names are now wired and running, and one of the five
  (`quota-coverage`) is resolved, not unwired. The only state that has not changed is the
  docker family's: its self-tests are wired and its gates are still not steps, which is the
  same partial-wire shape the note already describes for them.

  The docker family decision is unchanged and is still a decision, not a defect: giving the
  three docker gates a real (non-self-test) runner means a live Docker daemon and/or a
  registry hit, which is a different cadence from a PR gate. The draft that did this (
  `docker-digest-drift.yml.bak:5-10`) is still in the tree and still argues for a dedicated
  scheduled workflow rather than a schedule on `dev-ci.yml`, and `dev-ci.yml:575` still
  carries the "WHY NOT A SCHEDULE" note. First live schedule in the repository = owner's call
  about cost and about whether the repo wants nightly CI at all; not a documentation commit's
  call. The part that IS a documentation defect and IS fixed here is the "5 remain" line and
  the "five still unwired" list: they no longer describe the tree.

  **Corrected 2026-09-29: the Docker caution below was wrong, and `fluent-dynamic` is
  resolved.** I wrote that "the docker three likely need a Docker daemon and so cannot
  go in a job that has none." Measured: `dev-ci.yml:932` says the e2e job "needs the
  Docker backend", so a daemon is available; the real constraint is that
  `verify-docker-digests.sh` re-resolves every `image:tag@sha256:` against a REGISTRY,
  and a hit there means "a pin rotted, refresh it deliberately" -- a different cadence
  from a PR gate, not a different machine. `scripts/verify-docker-digests.sh:11-23` had
  already made exactly this census, with dates, and concluded: "the honest state is
  'manual script', not 'gate'. Run it by hand before refreshing a pin." That file was
  better informed than this note; the question is whether to give it a schedule, and
  the file already argues for the cadence it implies.

  `verify-quota-coverage.sh` is RESOLVED, and the answer is DO NOT WIRE IT. Run by
  hand it exits 1, reporting an INSERT site at
  `apps/desktop-tauri/src/state.rs::seed_primary_store` whose own comment reads:
  "first-run bootstrap of the ONE primary location an empty install needs, before any
  subscription row exists, so there is no tier to ask. Gating it makes a fresh install
  unbootable, so this door is deliberately ungated for good rather than pending a gate."
  So its non-zero exit is a REPORT, not a verdict, and making it a blocking step would
  fail every run on a decision that was taken deliberately. Its `--self-test` IS wired
  (added 2026-09-29), which is the half that can be enforced. Same shape as the docker
  digests gate: a report whose finding is information for a human, not a PR condition.

  `verify-fluent-dynamic-families.py` is RESOLVED: its "setup feature label" family was
  stale -- the keys are in neither bundle and no source file references the prefix -- so
  the family was deleted rather than satisfied with 27 unread keys, and the checker is
  now wired into check.sh and dev-ci.yml. See the commit that removed the family.
- **GI-5 — two gate-integrity checkers have no backstop off a developer's own machine, and both
  `ci` records claim one.** `verify-doc-uniqueness.py`: its only live runners are
  `scripts/check.sh:376` and `:377` (11:40 +07); counting the string `uniqueness` per live workflow
  returns **0** in `dev-ci.yml` and **0** in `release.yml` (11:46 +07) — yet `scripts/gates.json:455`
  declares id `doc-uniqueness`, `status: required`, with `"ci": { "workflow": "dev-ci.yml",
  "job": "static-gates" }` at `:458` and a note saying it was "Promoted to required with a ci block in
  the same ruling" (`:459`). The manifest promises a job the workflow does not contain, and the drift
  checker whose subject is this manifest does not see it. `verify-ftl-orphans.py`: the mode that can
  block a commit is `--staged-only`, run in exactly one place, `.githooks/pre-commit:257` (11:40
  +07); CI runs `--self-test` (`dev-ci.yml:332`) and `--census` (`:339`) and `check.sh` runs
  `--self-test` (`:244-245`) — the `i18n` job cannot reproduce the staged check because CI has no
  index, so the enforcing check has no backstop outside a developer's machine while its record's `ci`
  block reads as though it does. **Correction to the hand-off:** "two of the eighteen count-or-set
  gates" does not reproduce — `count-or-set` and `count or set` return 0 hits repo-wide (11:41 +07)
  and no such class exists in the manifest. Measured denominators (11:47 +07): 70 gate records, 53
  `required`, 47 carrying a `ci` key, 23 carrying none, and exactly 6 `required` without one
  (`docker-dry-run`, `migration`, `bundle-budget`, `e2e`, `perf-smoke`, `updater-signature`).
  Neither checker above is in that 6 — both carry a `ci` key, which is the defect. The defensible
  denominator is the script census: of the 30 tracked `scripts/verify-*`, 9 are not named in
  `dev-ci.yml` (11:41 +07). Owner: `scripts/gates.json` for the two `ci` claims;
  `.github/workflows/dev-ci.yml` for the jobs they describe.
- **GI-6 — the `scoped_orphans` staleness loop is keyed on a name ending in `_scoped`, so an entry
  without that suffix is invisible in both directions and reports clean.** In
  `scripts/verify-ipc-parity.py`: the reverse collector is `return sorted(c for c in handlers if
  c.endswith("_scoped") and c not in called)` (`:647` at 11:55 +07; the same statement sat at
  `:631` at 11:43 +07 while another lane edited this file — `git status` showed it `M` at 11:48 and
  clean at 11:49 — so cite the statement, not the line number), and the self-clean is `for command in
  sorted(orphan_allow - set(all_orphans)):` guarded on `if command.endswith("_scoped"):`
  (`:1339-1340` at 11:55 +07, `:1284-1285` at 11:48 +07). A name lacking the suffix can never be
  collected as an orphan and is never examined for staleness: never a violation, never stale,
  permanently clean. **Measured state, this minute:** `scripts/ipc-parity-allowlist.json` holds **25**
  entries in `scoped_orphans`, of which **0 of 25** lack the suffix (11:55 +07, JSON-parsed; the file
  clean and byte-identical to HEAD at that minute) — so the hazard is prospective, not current, and it
  is a statement about the data **right now** rather than about the code, which is why it is filed here
  instead of as a code comment.

**PINNED 2026-10-24 — the invariant this bullet predicted would rot is now graded.** Re-measured: the
allowlist holds **21** entries, **0** lacking the suffix (JSON-parsed), so the data has not drifted.
The code now asserts the invariant rather than trusting it: self-test case 10 drives the real collector
(`orphan_scoped`) with a suffixed AND an unsuffixed name, pins that the unsuffixed one is dropped,
and asserts every committed `scoped_orphans` entry is visible to that collector.

**The first draft of that case was vacuous and the mutation found it.** It asserted the SHAPE of an
entry (that `section_names` reads a bare name) rather than driving the COLLECTOR — and
`section_names` reads a bare name perfectly well, so the predicate was always true. Proven by
replacing the assertion with `True`: the suite stayed green. Rewritten against `orphan_scoped`, the
collector mutation `c.endswith("_scoped") and` → deleted now KILLS the suite. **A case about a filter
must run the filter**, not a function that happens to read the same data. One adjacent inaccuracy was measured and then repaired underneath this
  bullet: at 11:48 +07 the gate's summary printed "27 allowlisted" while the allowlist held 25, because
  that line counted the *detected* orphans (`all_orphans`, `:1309`/`:1313`) under the word
  "allowlisted"; by 11:55 +07 the same line printed "25 entries allowlisted, 27 orphans measured in the
  tree" (`:1471`). It is recorded anyway, because it is the same failure mode as GI-2 — a number a
  reader would quote that was not the number in the file. Owner: `scripts/verify-ipc-parity.py`.

- **NOT A FINDING — one item the hand-off listed as open was closed by another session during this
  measurement pass, recorded with its commit and minute so nobody re-parks it.** The tablet
  sync-conflict review route, parked twice today waiting on its owner, was resolved from outside at
  **11:24:12 +07** by `ded4686776` `fix(tablet): register and gate sync-conflict review commands for
  IPC parity`: **317 insertions / 3 deletions across 6 files** (`git show --numstat
  --date=iso-strict ded4686776`, 11:38 +07) — `apps/mobile-tauri/src/commands/sync.rs` 186/0 (the 186
  lines of real tablet commands), `apps/mobile-tauri/src/commands/sync_tests.rs` 89/0,
  `apps/mobile-tauri/src/lib.rs` 2/0 (the two registrations,
  `commands::sync::list_sync_conflicts_scoped` and `resolve_sync_conflict_scoped`),
  `apps/mobile-tauri/src/commands/registration_gate_tests.rs` 22/1,
  `apps/desktop-tauri/src/commands/sync.rs` 7/1,
  `apps/desktop-tauri/src/commands/registration_gate_tests.rs` 11/1. It was fixed by **registering**,
  not by allowlisting: both names are present in `apps/mobile-tauri/src/lib.rs` at HEAD and neither
  `sync_conflict` string appears in `scripts/ipc-parity-allowlist.json` (11:49 +07), so the
  crate-owning lane took the port option and the inert stubs are gone at the source. **Two figures in
  the hand-off are corrected by this record, and neither correction is a criticism of the repair.**
  (a) The commit was quoted as `ded468676`, which is not a valid object — `git cat-file -t ded468676`
  → "fatal: Not a valid object name" (11:38 +07); the forms that resolve are `ded4686776` and
  `ded468677`. (b) It was quoted as leaving `python3 scripts/verify-ipc-parity.py` printing IPC
  parity OK, and that did not reproduce at any minute measured here: the command **exits 1** at 11:37
  +07 (tip `9c6a30099`), at 11:48 +07 (tip `81e4589c1`) and at 11:55 +07 (tip `25dfa4659`), each time
  with 2 violations — now `get_kds_routing_rules_scoped` and `save_kds_routing_rules_scoped`, desktop
  registrations present in `apps/desktop-tauri/src/lib.rs` and absent from the allowlist (11:48 +07).
  What the repair demonstrably closed is the class it named: no `sync_conflict` name appears anywhere
  in the gate's output at 11:55 +07. The parity verdict on this checkout changed state under three
  different tips inside twenty minutes because the tree is shared and moving, so cite it only with its
  minute and its tip. This belongs to `apps/mobile-tauri`, not to this lane.

### Dated correction (2026-09-20, 13:53 +07) — GI-1's note half is closed, and the `ci` keys were the true half

**The finding reproduced exactly, a week after it was filed.** Re-ran GI-1's pattern
(`local[- ]only|no ci key` matched against `_note`, restricted to records that also carry a `ci` key)
over `scripts/gates.json` at 13:45 +07: **4 records matched and 3 still stated the falsehood** — the
same figures the 09-13 pass reported, so nothing had rotted in the week it sat, and the three notes
were still the wrong half. The workflow settles it again on today's tree, at shifted lines:
`verify-test-shadow-copies.py` at `dev-ci.yml:673`, `verify-ipc-parity.py` at `:675`,
`verify-topology-parity.py` at `:683`, `verify-scoped-coverage.sh` at `:691` (13:50 +07) — all four
run in CI, so a note reading "check.sh is its only runner" contradicted its own record.

**Repair.** The three `_note` values (`scoped-coverage`, `topology-parity`, `test-shadow-copies`) now
state the CI runner and the local runner and cite this entry. The false wording was **removed rather
than annotated**, because `gates.json` is a live manifest and not a dated record; the historical
wording is preserved here, in this register, which is what a register is for. The `runners` field was
**not** touched: `runners` lists local runners only and `ci` carries the workflow — the convention
every other wired record follows (`no-hardcoded-money-format`, `doc-uniqueness`, `ipc-parity`) — so
only the prose was stale.

**Re-measured after the repair.** 11 records mention local-only; 7 carry no `ci` key at all and are
correctly local-only (`root-policy`, `docker-dry-run`, `migration`, `a11y-advisory`, `perf-smoke`,
`updater-signature`, `server-origins`); 4 carry a `ci` value; **1 still matches the pattern and is not
a defect** — `ipc-parity`, whose note already records that its local-only claim "was itself stale and
was corrected here". GI-1's note half is therefore 3 defects → 0.

**Still open, unchanged.** GI-1's deeper observation stands: nothing polices whether a note is
*true*. `python3 scripts/verify-ci-docs-drift.py` reports **0 drift items** both before and after this
repair (13:52 +07), because it tests that a `_note` exists rather than that its content matches the
tree. That is GI-2's point and this correction does not touch it.

### Dated refresh (2026-11-06, 19:45 +07) — GI-1, GI-2, GI-3, GI-5, GI-6 live status census

Re-measured each finding against the current tree (tip `0b11d9246`, 149 gates in `scripts/gates.json`,
51 tracked `scripts/verify-*` checkers, live runners `.github/workflows/dev-ci.yml`,
`scripts/check.sh`, `scripts/check-ui.mjs`, `.githooks/pre-commit`):

- **GI-1 (Dual answers in gates.json): RE-MEASURED & REPAIRED (2026-11-06).** Of the 149 gates,
  113 carry both `runners` and `ci`, 4 carry `ci`-only, 17 carry `runners`-only (local/hook only),
  and 15 are retired records.
  The two remaining dual-answer prose notes (`root-policy` claiming local-only despite being in CI,
  and `ownership-map-parity` claiming local-only while having a CI block) were repaired in `scripts/gates.json`.
  Both are now explicitly wired and tested in `dev-ci.yml#static-gates` and in `scripts/check.sh`.

- **GI-2 (Prose numbers that rot): RE-MEASURED.** Ran `python scripts/verify-ipc-parity.py` and
  `python scripts/verify-shell-registration.py` (both OK, 19:46 +07).
  - `gates.json:446` (`ipc-parity`) frozen note claims: *"Measured 2026-09-18: 441 UI command strings;
    desktop 455 registered / 9 unregistered UI names / 3 unregistered fns; tablet 320 registered /
    138 unregistered UI names / 3 unregistered fns. The 25 allowlisted scoped orphans..."*
    - **Current live numbers (2026-11-06):**
      - Total UI command strings: **503** (+62 from 441)
      - Desktop: **510** registered (+55 from 455) / **15** unregistered UI names / **2** unregistered
        command fns
      - Tablet: **439** registered (+119 from 320) / **78** unregistered UI names / **3** unregistered
        command fns
      - Scoped orphans: **24** allowlisted entries (**0** unsuffixed; down from 25 on 09-18, up from
        21 on 10-24).
  - `gates.json:461` (`shell-registration`) note claims: *"desktop 511 handler entries, tablet 440,
    90 desktop-only and 19 tablet-only."*
    - **Current live numbers (2026-11-06):** 109 total documented divergences in `scripts/shell-divergence.json`,
      with exact split **90 desktop** and **19 tablet** preserved and verified across both shells.

- **GI-3 (--staged-only three semantics): RE-MEASURED.** Verified all `scripts/verify-*.py`
  implementations. Exactly three scripts define `--staged-only`, each preserving its distinct semantic:
  1. `scripts/verify-ftl-orphans.py:493`: Inspects true git index diff (`git diff --cached -U0`).
  2. `scripts/verify-migration-column-types.py:118/145`: Inspects staged file names from index
     (`git diff --cached --name-only`), but reads working tree bytes off disk via `path.read_text`.
  3. `scripts/verify-bundle-parity.py:119`: Pathlist filtering CLI argument (`--staged-only PATH...`),
     reading full post-stage file contents off disk.
  The semantic split is stable, ununified by design, and owned by the respective checker scripts.

- **GI-5 (Two CI claims with no backstop): RE-MEASURED & REPAIRED (2026-11-06).**
  1. `doc-uniqueness`: Previously, `scripts/gates.json:1175` promised `"ci": {"workflow": "dev-ci.yml",
     "job": "static-gates"}` and claimed in `_note:1177` *"Promoted to required with a ci block in the same
     ruling"*, but `.github/workflows/dev-ci.yml` lacked any step running `verify-doc-uniqueness.py`.
     **Closed 2026-11-06**: Added `Doc uniqueness` and `Doc uniqueness self-test` steps to
     `dev-ci.yml#static-gates`. The gate now has true CI backstop off the developer's machine.
  2. `verify-ftl-orphans.py` (`--staged-only`): Remains pre-commit step 7 only (`.githooks/pre-commit:257`).
     CI runs `--self-test` and `--census` (`dev-ci.yml:332, 339`), which serves as a full-repo backstop,
     though commit-staged indexing has no representation in CI by design.

- **GI-6 (Staleness loop keyed on _scoped suffix): RE-MEASURED.** `scripts/ipc-parity-allowlist.json`
  currently holds **24** entries under `scoped_orphans`. **24 of 24** end with `_scoped` (**0 unsuffixed**).
  Self-test case 10 in `verify-ipc-parity.py` guards this invariant, asserting that unsuffixed entries are
  dropped while all 24 allowlisted entries match the collector filter. The invariant remains unbroken.

### Dated correction (2026-10-27) — GI-7's F-TWO is closed; the empty-corpus green now refuses

**Re-measured by reproducing it, not by reading the code.** A throwaway root was built from
HEAD blobs — `scripts/verify-scoped-reads.py`, `scripts/ipc-parity-allowlist.json` and the
`scripts/allowlist-schema.py` module it loads — with **no `ui/src`**, and the gate run from
inside it:

```
$ python scripts/verify-scoped-reads.py          # in a root with no ui/src
exit 2
error: the corpus this gate grades is not there: <root>\ui\src is not a directory, so the
walk found 0 production files. That is not a clean tree, it is no tree -- the verdict is
drawn FROM these files. REPO is derived from __file__ ... Run it from the repository root,
and if this IS the root then the checkout is incomplete and nothing can tell you from here
whether the code is clean.
```

That is the exact hazard this entry describes, answered in the shape the three already-closed
siblings use: **exit 2 and the sentence that says nothing was graded**, naming the missing
path and the reason a copy of the script grades the tree beside it. The one-line
`clean for desktop.` green the original pass could not tell apart from a real run is gone.

**A first attempt at this measurement was inconclusive and is recorded so it is not repeated.**
Copying only the gate and the allowlist gives **exit 2 as well**, but for a different reason —
`allowlist-schema.py` is absent, so the gate refuses before it ever looks for a corpus. A red
that is not the red you were aiming at is no evidence, so the schema module was copied too and
the run repeated; only the second run tests the empty-corpus path.

**What this does NOT close.** F-ONE stands unchanged: `ALLOWLIST` remains script-relative
(`:71`) with no `--allowlist` flag, so an operator still cannot demonstrate a bad allowlist
member without reaching into the module namespace. And the scan's other open member,
`verify-ftl-orphans`, is untouched — its `nothing staged under ui/src; nothing to verify.` is a
different class, index-bound by construction. The standing count for the sibling sweep is
therefore **one open, four closed**, not the two-of-five this entry last recorded.

**Not repaired here:** this register is a dated record, so the entry above is left as written.
No workflow and no `scripts/check.sh` line was edited by this pass; nothing
outside this file was edited.

## GI-4 scope — this register is itself an enumeration mirror, outside MIRRORS (`GI-4-SCOPE`, OPEN, added 2026-09-13 12:12 +07, tip `222839216`)

**Status:** ONE finding, filed from another worker's pass and kept verbatim below. The measured
  half and the not-confirmed half are held apart rather than merged into the more interesting
  number: the scope claim is measured, the numeric pairing is explicitly not confirmed, and that
  distinction is the entry's content. Owner named by file, as the rest of this register does it:
  `scripts/verify-agents-mirrors.py`.

- **The mirror exists and nothing polices it.** docs/records/audit-open-findings.md is an enumeration mirror outside MIRRORS, 695 lines,
  tracked, clean in status, holding step and command counts in the same shape the policed
  mirrors do, :568 quotes 451 registered, 27 unregistered references, 16 unregistered command
  fns and info[tablet] 453 UI, and it is invisible to scripts/verify-agents-mirrors.py, git grep
  for its path in that checker returns nothing, the gate exits 0 around it, measured at 12:0x
  +0700 with tip 620824fdfe.
- **Where it sits in this register's own taxonomy.** same class as GI-2, new instance, a scope hole rather than a numeric one.
- **What was NOT confirmed, filed as not confirmed.** the 14-stated-against-16-real pairing reported by an earlier pass was NOT confirmed, two greps
  found no such claim in the file and its 14 hits are other subjects, the files own 16
  references agree with .agents/planning/parity-unanswerable-16.md, so the confirmed defect is the scope
  and not the number.
- **Why it is left open rather than fixed here.** widening MIRRORS is a design change with its own noise cost and this pass learned that the hard
  way.
- **Ledger-owner re-check at 12:12 +07 on tip 222839216 — this lane's own numbers, added so the
  verbatim text above is attributable and not so it is restated. `python3
  scripts/verify-agents-mirrors.py` exits 0 and prints "all 2 mirrors agree with the repo";
  `MIRRORS` is the two-entry list at `scripts/verify-agents-mirrors.py:97` (`AGENTS.md`,
  `.agents/AGENTS.md`) and nothing else; `git grep -n docs/records/audit-open-findings --
  scripts/verify-agents-mirrors.py` returns no hits; **this file was** 695 **lines at 12:11 +07**
  (tracked, and clean in status at that minute), **and it is 731 lines with this entry in it (731 after the line below is fixed), so the
  count quoted in the verbatim text above is already one entry behind — which is the finding, not an
  error in it**; the quoted figures are reproduced at `docs/records/audit-open-findings.md:568`;
  `.agents/planning/parity-unanswerable-16.md` exists, 17,581 bytes, and carries the 16. The
  non-confirmation holds on this lane's re-grep too: the only two lines pairing 14 against 16 in
  this file are `:249` (`BridgeCtx` public fields) and `:513` (salvaged-blob and scratch counts
  under `GH-CLEAN-01`) — both other subjects. So the scope half is measured and the numeric half
  stays unconfirmed, and that is how it is filed above.

## A gate that read nothing reports clean: the empty-corpus green, plus four siblings (`GI-7`,
  OPEN, added 2026-09-13 13:14 +07, tip `c5a42a33a`)

**Status:** ONE OPEN finding — handed over as "F TWO" with "F ONE" attached, reproduced here
before being written, nothing outside this file touched. Owner named by file:
`scripts/verify-scoped-reads.py`.

- **F TWO, re-run 13:0x +07** (measured three times today; this is this lane's). HEAD blob of
  `scripts/verify-scoped-reads.py` plus a HEAD copy of `scripts/ipc-parity-allowlist.json`,
  same relative layout in a throwaway directory, cwd inside it: **exit 0**, one line —
  `verify-scoped-reads: clean for desktop.` — the identical line and exit code from the real
  repository, so a reader cannot tell the two runs apart from the output. `REPO` is two
  `dirname`s off `__file__` (`:70`), so it resolves to the temp directory; `ui/src` absent, 0
  production files walked (**569** in the real tree), 0 violations, counted through an
  `importlib` probe because the gate prints no tally of its own — and the `REPO -> … ; files walked:
  0 ; violations: 0` line that script's own F-2 stamp quotes at `:64` is emitted by nothing in it (the
  only live printer of that phrase is `verify-agents-mirrors.py:902`), so the tally the stamp shows a
  reader is one the gate cannot produce.
- **F ONE, as its sub-bullet:** `ALLOWLIST` is script-relative (`:71`) with no path argument —
  `--self-test` and `--shell` are the only flags, and `--allowlist` appears nowhere in the file
  — so a bad allowlist member cannot be demonstrated by an operator without reaching into the
  module namespace, which is one reason the hazard survived being described in two other
  scripts' docstrings.
- **Allowlist left out: exit 1** (`FileNotFoundError` naming the path) — a crash and not a
  false green, and the distinction matters: a loud failure is not the hazard, a quiet green is.
- **Scope:** the hand-off swept 21 gates, each run as its own HEAD blob in a fresh temp
  directory with the data files it names copied beside it, and found **five that return a false
  green; the other 16 fail loudly, with the missing path in the message.** All five were re-run
  here at exit 0 in the temp tree at 13:0x +07; the standing count is **two open, three closed**,
  and a register still saying five would hide finished work the way it hid the defect. Closed —
  `verify-flaky-quarantine` at `ae7f19c03` (106 insertions / 8 deletions),
  `verify-no-hardcoded-money-format` at `1f7c2311c` (129 / 9) and
  `verify-migration-column-types` at `c1fa2d0f9` (111 / 13), all re-measured by this lane in a
  throwaway root at 13:3x +07: the quarantine blob beside its own manifest now exits **1** on
  `FAIL: REFUSED -- the manifest at this root has no test corpus behind it` and its real-tree PASS
  names the root plus `1134 candidate .rs file(s) found`; the money-format blob exits **2** on
  `REFUSED — a gate that walked nothing must not print clean` and its real-tree line reads
  `PASS (1080 production .rs file(s) under <root>, from current working directory)`. Still open —
  `verify-scoped-reads` (re-run 13:3x +07: still exit 0, still the one indistinguishable line);
  `verify-ftl-orphans` — `nothing staged under ui/src; nothing to verify.` against
  `ftl orphans: OK` in the real tree, arguably a different class because it is legitimately
  index-bound; and `verify-migration-column-types`, which printed nothing here at 13:0x
  (`if not files: return 0`, old `:151-152`) against `(59 files scanned, 12 float hits all
  exempt)` — its blob in a migration-less root now exits **2** on `REFUSED — a gate that scanned no
  migration files must not print clean`, and its real-tree line names the root and the count.
- **One flag, three behaviours** (measured at `a89f1f12d`, 13:5x +07): `--self-test` on
  `verify-migration-column-types` → **exit 0**, its ordinary `ok: … (59 migration file(s) scanned
  under …)`; on `verify-flaky-quarantine` → **exit 0**, its ordinary `PASS: quarantine manifest
  valid …`; on `verify-no-hardcoded-money-format` → **exit 2**, `error: unrecognized arguments:
  --self-test` — the only one of the three that parses argv rather than testing membership in it
  (`:219`, `:105`). Two of three answer a request they cannot satisfy with a green about a
  different thing; the class is **a permissive parser turns a typo into evidence**, and the defense
  is strict unknown-argument handling, which another lane is adding to those two files right now —
  its outcome is deliberately not recorded here. On their own axis the three closures are unpinned:
  `self.?test` (case-insensitive) occurs **zero** times in each of the three HEAD blobs, and
  `git grep -n REFUSED` over `.github`, `scripts/check.sh`, `scripts/run-pre-push.py`,
  `.githooks` and `scripts/gates.json` returns nothing (exit 1), so each closure is one file with
  no case that plants an empty corpus and asserts the refusal — the next lane to edit root
  resolution can restore the false green without turning anything red.
- **The shared shape, in one line:** same asymmetry as `RI-1` one section below — a case nobody
  runs and a flag nobody rejects are both greens that mean less than they print.
- **The closed instance** is `scripts/verify-agents-mirrors.py` at `6809719a91`, 149 insertions
  / 5 deletions, which additionally prints a `files walked` tally whenever the walk is not
  whole (`:896-905`), git answering the root with script-relative kept only as the recorded
  fallback (`:116-129`). Measured: HEAD exits 0 and adds no byte on a whole walk, and the same
  blob in a temp dir exits 1 naming `Cargo.toml` — a zero walk can no longer read as clean.
- **General form:** a verifier has to assert that it read its own inputs — a count of files
  scanned is half of it, a count of inputs found is the other. **Caution in the same breath:**
  `AGENTS.md:14` sanctions script-relative resolution so tools work across the multi-root
  layout, so a blanket switch to `git rev-parse --show-toplevel` is a behaviour change in a
  CI-enforced path and not a pure robustness fix — one lane proposed it, another declined on
  that evidence. The load-bearing half of the closure is the refusal on an empty walk and on an
  absent input, not the anchor.

## The records index has no caller, and its drift report counts positions (`RI-1` parked, `RI-2`
  mechanism, added 2026-09-13 13:4x +07, tip `ae7f19c03`)

**Status:** **`RI-1` is CLOSED — the recommendation below was carried out.** Measured
2026-10-24: `node scripts/generate-records-index.mjs --check` exits **0** ("ok: docs/records/README.md
matches the generator"), and `.github/workflows/dev-ci.yml:923` runs exactly that command in the
`static-gates` job — the lane this entry handed it to did what it recommended. `RI-2` remains a
mechanism note, not a defect, and is unchanged.

- **RI-1 — CLOSED 2026-10-24. (The text below is the original finding, kept as the record of
  what was true on 2026-09-13; it no longer describes the tree.)** The five live runners were
  grepped individually (13:3x +07) — `.githooks`, `scripts/check.sh`, `scripts/run-pre-push.py`,
  `scripts/gates.json`, `.github/workflows` — and **none names it** (exit 1 each); the workspace
  grep's hits at this tip are 26, all prose, self-references inside the generator, or
  `scripts/test-records-index-escaping.sh` driving it against a temp tree, and that script is
  named in none of the five runners either, so the only executable caller has no caller. Nothing
  regenerates or gates the index, which is why one row sat missing and why drift returns the
  moment another record lands. **Recommendation, stated not done:** wire `--check` into the
  `static-gates` job — that means editing `scripts/gates.json` and
  `.github/workflows/dev-ci.yml`, both outside what this session may touch, so it is parked for
  an owner and not an open task for us.
- **RI-2 — a mechanism, not a bug: `--check` reports differences by position.**
  `scripts/generate-records-index.mjs:498-506` seeds `differing` at `Math.abs(g.length -
  c.length)` and then compares `g[i]` to `c[i]`, so one insertion near the top of a sorted group
  makes every following line look changed. That is what turned `0d5eb0e00`'s real nine-line diff
  (`git show --numstat` → 5/4: five of them the ADR-51 row, four genuine
  generator-versus-hand-edit differences — `mdCell` `:161` strips code-span backticks from three
  status cells, ADR 5, ADR 39 and the Structured Logging row, and `TITLE_MAX = 120` at `:155`,
  applied to labels only at `:182`, truncates the ADR 41 title with an ellipsis) into a reported
  cascade of 48 differing lines. **General form, same family as a count that agrees while its
  content disagrees:** a positional red is a statement about the checker's arithmetic and not
  about the tree, and the only defense is to ask what the real diff is before repeating a
  reported number.

  **Dated correction (2026-11-06) — it WAS a defect, and the size of the miss was 676 to 1.** The
  "mechanism, not a bug" framing above was too generous, and this was measured rather than argued:
  inserting ONE row into the real `docs/records/README.md` made the old comparison report **676
  differing lines** — ten of them printed as consecutive noise — while the true change was one row
  at line 14. A drift report a reader cannot act on is the defect, not a footnote to one, and the
  exit code never said which row moved. `3a1f132d2` replaces the positional walk with a
  common-prefix / common-suffix block, prints the removed lines then the added ones, and names the
  first differing line; the same insertion now reports **1 differing line**. Pinned by
  `scripts/__tests__/generate-records-index.test.mjs` (3 cases driven through
  `KASIRMU_RECORDS_ROOT` against a throwaway tree, mutation-proven: removing the prefix scan fails
  2 of the 3).

---

### Dated correction (2026-09-13, 14:18) — the three-command-line table above is now history, not a standing defect

The row that said strict unknown-argument handling was "being added right now, outcome
deliberately not recorded" can be closed against measured exits: `7b4c2bc5a` and
`45e2521a3` landed it, and `python3 scripts/verify-migration-column-types.py --self-test`
and `... verify-flaky-quarantine.py --self-test` now both exit **2**, naming the flags each
script actually implements (`--staged-only`, `--report`), while both bare invocations still
exit 0. The money gate was already the argparse one (exit 2). **Three gates that answered one
command line three ways now answer it one way.** Bare-run stdout was hash-compared before and
after (`54c2e8cb…`/152 B, `6b40bfa7…`/212 B) — unchanged, so the refusal is addition and not
noise. Both rejection cases are mutation-proven load-bearing: removing the guard returns the
false green at exit 0 printing the ordinary `ok:`/`PASS:` line.

The paragraph claiming the closures were **unpinned** is also superseded, for the money gate
only: `805159081` (198/0) added a real `--self-test` with `tally: 3 green = 3 CAUGHT + 0 CLEAN
/ 0 red`. Its own stdout states why `0 CLEAN` is not a weakness — a clean-tree case reddens
under none of the three mutations, so it would have been a tautology, and the real-tree run is
that gate’s clean half outside the flag. It also records the disjunct `scanned == 0` in the
refusal guard as **unobservable** (an all-empty tree always leaves `starved` non-empty too),
and prints its own limit: **nothing calls the flag.** `scripts/gates.json` already runs
`verify-ftl-orphans.py --self-test` blocking in CI, so the wiring precedent exists; the
remaining change is one line naming this gate beside it, in `gates.json` and `dev-ci.yml` —
both outside this session’s authority, recorded here rather than done.

**Still open after this correction:** `verify-scoped-reads.py` F-2 (a copy prints
`0 production file(s) graded against … clean for desktop.` at exit 0) and
`verify-ftl-orphans.py --staged-only` (`staged_diff()` has no `check=True`, swallows git 129, measured 16:30, note, the 62 bytes are the caller's own vacuous-clean verdict, git contributes 0 bytes,
and emits a 62-byte line identical to a real run — index-bound, a different class).


### Dated correction (2026-09-13, 14:47) — F-2 and its wrong-shape sibling are closed in `verify-scoped-reads.py`

`4d103182c` (158/3, one file, `973 → 1125` lines) put a `require_allowlist_shape()` guard between
reading the parsed JSON and any `.get` on it, refusing when the object it wanted — a JSON object
keyed by the shell section, default `"desktop"`, a key name read off the live loader rather than
guessed — is absent or wrong-typed. Measured against the **committed blob** in a temp dir:
`{}` and `{"entries":[]}` — both of which previously exited **0** printing
`0 production file(s) graded … clean for desktop.` having compared nothing — now exit **1**
with a sentence naming what was wanted and what was got; `[{"a":1}]` no longer escapes as an
uncaught `AttributeError` at `allowlist_names:303`; `not json` is unchanged. Four cells, all
refuse, no tracebacks, no `clean` line. Re-verified by the director, not only by the lane:
bare exit 0 still reporting `568 production file(s) graded`, `--self-test` PASS through case 8
(the director's own count of "~40 ok lines, was 34" was a mis-prefixed grep; the `    ok` line counts measured by the lane are **34 → 39**, later **39 → 41**), `verify-agents-mirrors` exit 0.

**Still open, three of them, all named, none touched:** the identical wrong-shape hazard in
`verify-ipc-parity.py`, whose `load_allowlist()` hands raw `json.loads` output to
`payload.get(section)` at `:547 :592 :730 :765 :794` with no top-level check — and that gate is
the *writer* of the same shared file, so it can re-publish a shape nothing can read; a valid-
JSON **UTF-16** file still escaping `read_allowlist` as an uncaught `UnicodeDecodeError` **[closed 14:57 by `dd4888194` — see the next section]**
(it catches only `PermissionError` and `JSONDecodeError`, unchanged before and after this
commit); and `--shell ''`, which exits 0 printing `clean for .` because with no section named **[closed 15:18 by `4f841a673`]**
there is no key to require. The last is the same class one level further in: a refusal needs a
named section before the shape question exists.

### Dated correction (2026-09-13, 15:00) — the UTF-16 cell above is closed, and my own count corrected

`dd4888194` (58/2, one file) added `AllowlistUndecodable` as a subclass of the existing
`AllowlistUnreadable` with one `except UnicodeDecodeError` arm placed *after* `JSONDecodeError`
inside the retry loop, so the guard order stayed `exists → isdir → denial-retries → decode`,
properties of the argument before properties of the read and only a denial retrying. Director-run
repro against the committed blob (`git show HEAD:` into a temp dir, a real `encoding="utf-16"`
allowlist) at 15:00 — exit **1**, stdout **1** line, `grep -c Traceback` **0**, where before the
same input produced a 19-line traceback ending `UnicodeDecodeError: … byte 0xff in position 0`.
The sentence says the gate cannot decode rather than calling the file invalid JSON, *it may be
valid JSON in an encoding this reader will not guess*, and both new cells forbid the busy
sentence, keeping the misdiagnosis class closed. Self-test PASS, ok lines **39 → 41** (cases 9
and 10); bare still exit 0 at `568 production file(s) graded` with byte-identical stdout.

Reported, not fixed — `scripts/coverage_top.py:40` opens a JSON file with no `encoding=`, so it
inherits the locale codec and takes the same uncaught error; `extract-updater-seed.py:167` and
`verify-exhaustive-deps.py:49` do name `encoding="utf-8"`, and `verify-ipc-parity.py:101` already
catches `(OSError, UnicodeDecodeError)`. Two of the three still-open items above remain as
written, the wrong-shape hazard in `verify-ipc-parity.py` and `--shell ''`, and the second is
the same class one level further in, a refusal needs a named section before a shape can be asked
of it.
### Dated correction (2026-09-13, 15:21) — `--shell` is closed too, so that three-item list is now two

`4f841a673` (154/2, one file, `scripts/verify-scoped-reads.py` `1184 → 1336`) refuses a `--shell`
value that names no shell, placed where the shell list resolves rather than inside the walk,
because an empty shell list is a property of the argument and not of the read, and it refuses
rather than defaulting to every shell, since guessing what an empty argument means is how a typo
becomes evidence. Director-measured: `--shell ""` now exits **1** with one `FAIL: --shell
received ""…` line and no `clean` anywhere in the output where HEAD exited **0** printing
`clean for .` having graded nothing, self-test `    ok` lines **41 → 44**, bare still exit 0 at
`568 production file(s) graded`, `--shell desktop` exit 0 and `--shell desktop --shell tablet`
exit 1 on the pre-existing tablet violations, so neither path regressed.

### Dated correction (2026-09-13, 16:15) — `coverage_top.py` is closed, and the worker corrected *my* diagnosis of it

`dfb3e10e9` (36/2, one file) names `encoding="utf-8"` at the open and refuses with one `UNREADABLE:`
line. Director-measured on the committed blob at 16:12: a real UTF-16 JSON file now exits **1** with
**0** `Traceback` where the pre-fix blob exits **1** with **1**, ending
`JSONDecodeError: Expecting value: line 1 column 1`.

**My brief was wrong about the symptom and the worker said so.** I told it the failure was an
uncaught `UnicodeDecodeError`; on this box the locale codec is **cp1252** (measured
`locale.getpreferredencoding`, Python 3.14.5), which happily *decodes* UTF-16 bytes into mojibake
that then fails to **parse**, so the real exception was `JSONDecodeError`. Under `PYTHONUTF8=1` the
same pre-fix run does raise `UnicodeDecodeError`, so my finding described only one of two platform
states. The worker kept its narrow `except UnicodeDecodeError` arm and defended it: **because the
encoding is asserted at the open, the mojibake path stops existing** — the bytes become
undecodable rather than decodable-and-wrong, so both symptoms converge on one refusal. Widening
the catch to `JSONDecodeError` would let one sentence claim "not UTF-8" about a file that *is*
UTF-8 and merely malformed, the very mislabel `dd4888194` argues against.

**Verified separately by me:** the identical input fed to the pre-fix and post-fix copies both die
later with `AttributeError: 'list' object has no attribute 'get'` — **pre-existing**, my fixture
shape, not the change; the two tracebacks differ only in the filename line. An object-shaped valid
UTF-8 file exits **0** and prints `NO MATCHES: scanned 0 files`, proving the guard does not
over-refuse.

**Reported, not fixed, output side:** a *valid UTF-8* file containing a non-ASCII path now reads
fine and dies 30 lines later on `UnicodeEncodeError: 'charmap' codec can't encode character
'\u1f8d'` — the **print** codec, not the read. No partial ranking can exit 0, but stdout does
carry a partial report. Fixing it needs an output-side decision outside the brief, so it is
recorded here. Every path in this repo's real cargo-llvm-cov exports is ASCII.

### New verified finding (2026-09-13, 19:45) — `.ftl` reads race live writers, and the crash impersonates a verdict

`scripts/verify-ftl-orphans.py` dies with a `Traceback` at **exit 1** when a locale file is being
written underneath it. Reported by the closing worker at 19:39 from a run it made at 19:29:
the *real tree*, not a temp copy — a `PermissionError` reading `shared-ui/locales/kds.ftl` while
another session was writing it, exit 1, one traceback. Same shape as the hollow-root crash fixed
by `683eb1eac` (12/0, 19:38), and **`hollow_root_reason()` cannot see it**: the directory exists,
the bundles exist, the read simply fails this instant. It hits `--census` identically.

**Why exit 1 is the damage.** In this file exit 1 means *the gate reached a verdict and the verdict
was bad* — `FAIL: N orphan problem(s)`. So a transient lock collision on a machine where sessions
commit every few minutes reports as an orphan finding, and nobody goes looking for the file that
was mid-write. Mechanism 4 (reading a mutable surface) arriving not as a wrong belief but as a
wrong **exit code**.

**Precedent already in-repo, cite it rather than inventing a third shape.**
`verify-scoped-reads.py` (`AllowlistUndecodable`, `dd4888194`) encodes the guard-ordering law:
`exists` and `isdir` checked *before* the retry loop, `PermissionError`/`JSONDecodeError`/decode
*inside* it, and **only denial retries**. `coverage_top.py` (`dfb3e10e9`) is the report-only
variant: one `UNREADABLE: <path>` line naming the file, and the verdict still runs over what was
read. Which of the two applies to `--census` is an enforcement question, not a code question.

**Verification note, mine, same class.** `kds.ftl` was clean again by 19:44 — this finding cannot
be reproduced on demand, it needs a concurrent writer, so any future fix must be proven by
forcing the race (hold the file open, or point the parser at a path that denies sharing) rather
than by an absence of crashes in a quiet tree. A green here proves nothing; mechanism 9 with the
receipt inverted.

### New finding (2026-09-13, 20:47) — the census step is labelled informational and is not

`.github/workflows/dev-ci.yml:338-339` (read at 20:46):

```yaml
      - name: FTL orphan census (informational)
        run: python3 scripts/verify-ftl-orphans.py --census
```

There is no `continue-on-error`, so this step blocks `static-gates` on any nonzero exit, while the
prose around it calls the census "reported and never blocking". Reported by the closing worker of
`4d1a85b15` as adjacent to its fence and outside it; confirmed by me reading the lines at 20:46.

**Why it changed state today.** Before `ef2058f28` (19:22) `--census` could exit only 0 or 1. It now
exits **2** on a hollow root, and after `4d1a85b15` (20:28) a refusal path exists for bundles that
will not open. So a runner whose checkout is partial, or whose locale surface is being written,
turns an "informational" report red — a label promising one thing while the job does another.

**Not mine to pull.** `.github/**` is outside my authority and *(both claims in this paragraph were retracted at 23:45, see the dated retraction below — `gates.json` holds no such number, and `--fail-on-recoverable` is wired)* and `scripts/gates.json` holds a stale
`130 / 0` for this same scanner. The owner chooses one of: add `continue-on-error: true` to honour
the label, rename the step to admit it gates, or make census report-only for the hollow case too.
Any of the three is consistent; a blocking step called informational is the only one that is not.

**Second residual, same family, deliberately not fixed by `4d1a85b15`:** a malformed but *readable*
`scripts/ftl-orphan-allowlist.json` still dies inside `json.loads` at exit 1 with a traceback — the
`AllowlistUndecodable` case closed in `verify-scoped-reads.py` by `dd4888194` is open here. Recorded
as left-on-purpose: a committed defect is a different animal from a transient race.

### Dated correction (2026-09-14, 00:53) — the guard classifier errs in BOTH directions, and I briefed the wrong one

A researcher I had to interrupt at 30 minutes came back in 12 with the load-bearing measurement, and my framing was inverted. I had
briefed the `??` bug as producing FALSE POSITIVES: `sessionToken ?? null` read as a token test, so guarded-looking code gets cleared...
wait. That framing was the right pattern and the wrong direction.

**`GUARD_RE`, `scripts/verify-scoped-reads.py:486-487`, verified by me against the source at 00:52:**

```
r"(?:sessionToken|token)\s*\?|\?\s*(?:await\s+)?\w+Scoped\s*\("
```

The first arm matches `sessionToken` plus optional whitespace plus a `?`, so it matches the **first `?` of `??`**. On a window containing
`const token = sessionToken ?? null;` and one bare `await getSale(id);`, `_window_is_guarded` returns **true**: the second arm needs a
`…Scoped(` and gets `null`, yet the site is still certified compliant. **A call that passes a null token by default is a guarded call.**

**So the bug suppresses; it never invents.** That reverses what I expected on two counts at once:
1. **None of the 17 newly-visible sites is a false positive of it.** All 17 had `guard_re=false`, verdict **GENUINE** on all 17. I had
   framed the sweep as "find the noise"; the sweep found none, and I should not have expected it to.
2. **Tightening the classifier makes the count go UP, not down.** Measured on the real tree by blinding `??` and re-running the gate's own
   `_window_is_guarded`: **`FAIL: 129` → `134`**, five sites suppressed by nothing else — `StockAlertPanel.tsx:51`,
   `ProductManagementScreen.tsx:125`, and `setSettingsScoped(sessionToken ?? null, …)` at
   `Workspace-{Inventory,Kds,RestaurantPos}Settings.tsx:97/136/114`.

**The other direction, same classifier, also wrong.** A window of `if (!sessionToken) { return; }` followed by a scoped call returns
**false**. The repo's dominant bail idiom — **54 files** carry `if (!sessionToken` — is not recognised as a guard, so a genuinely
guarded site can only ever be *nagged*, never cleared, by this rule. One regex, two opposite failures: it forgives a null default and
it distrusts an early return.

**Verdict, and it is the sentence that decides sequencing:** tighten `GUARD_RE` **before** anyone edits call sites. Code shaped to
satisfy a classifier that accepts a nullish default as a token check is compliance theatre, and the honest `+5` is debt that was hidden
all night, not new damage. Filed as the fourteenth item; the 17 are queued behind it as product work, in `ui/`, where a lane must prove
the finding still exists before it "fixes" it.

### Dated correction (2026-09-14, 00:16) — gate thirteen: the pattern was the whole gap, and 17 real findings were hiding behind it

`73afbf0b65` (163/8), `scripts/verify-scoped-reads.py`, verified by me at 00:15: default now prints
`27 of 27`, CI form `180 of 181` with **`FAIL: 129 unguarded`**, self-test 37 cases exit 0, mirrors 0,
allowlist `e5663346ef` in worktree and HEAD.

**The number that matters is not the coverage, it is the delta.** `FAIL: 112` → `FAIL: 129`, and the
worker proved the direction by parsing both reports into (shell, command, file:line) triples and taking
the symmetric difference: **+17, −0**. Zero removals is the proof — a quieted finding would show as a
removal, and the failure mode I briefed it to watch was exactly that, the widened pattern matching a
*call site* as a wrapper and thereby hiding it. An independent second parser confirmed 0 mispairings
across 491 new (command, wrapper) pairs and that all 412 commands the old pattern saw are kept, a
strict superset.

**So 17 unguarded ambient IPC calls existed the whole time and no tool could see them**, in
`LicenseSettings.tsx`, `AppShell.tsx`, `TopologyScreen.tsx`, `StaffManagementScreen.tsx`,
`EmailReportSettings.tsx`, `useAuthConnection.ts`. Tonight was about gates that pass over nothing; this
is the payoff case, the gate was not lying about a refusal, it was blind to real code. One correction to
my own brief, I cited `features/license/LicenseActivationScreen.tsx`; the file is
`features/auth/LicenseActivationScreen.tsx`. Line 106 matched, the dir did not.

**Two claims retired by this commit.** The researcher guessed bucket C, eleven `license.ts` names are
cloud-server commands with no Tauri wrapper; **its own reading refuted that**, they are registered at
`lib.rs:1177-1192` and cloud-facing *behind* a Tauri command. And the worker's residual 5 asserted that
`verify-ipc-parity.py`'s write-side refusals still spend exit 1 — **stale by three commits**, closed at
`8b3f52c8db`. I have now seen two lanes report a residual that a earlier lane had already fixed, which
is the cost of working a shared tree on self-report; the register is the dedupe point.

**What the sole residual is.** `rotate_encryption_key` does not resolve, and it is not a blind spot —
the command was ungated and deleted (`ui/src/api/security.ts:29-36`), so it is a stale allowlist entry.
Deliberately *not* special-cased in code, a comment names it. That leaves the informational ratio line as
the only witness, and nothing branches on it, so **the owner should drop one name from
`scripts/ipc-parity-allowlist.json`**, which is not mine to edit.

**The next idiom is the same bug.** `export default function`, a wrapper built in a loop, a re-export —
each would silently drop the ratio again and every command it loses becomes unfindable. The ratio line is

now the canary; it is informational by contract, so a human has to read line 2.

### Dated correction (2026-09-14, 02:23) — the 105 are a shell gap

**The premise under the entry above is false, and two lanes disproved it.** That entry counted `17`
newly-visible sites, and the 00:53 entry queued them as product work in `ui/`, both on the reading that
a missing token check had been found. Measured at 02:23 the reading was wrong: the finding says a
command is not registered on the shell being graded. That is an `apps/mobile-tauri` registration and
allowlist fact, not a component fact, and it is not fixable in `ui/`.

**`LicenseActivationScreen.tsx` has no token string at all.** In the 361-line file, `sessionToken`,
`useAuth`, `token`, `invoke(` and `Scoped` each return **0** matches. Four of its call sites are in the
tablet list — `:96`, `:100`, `:106`, `:115` — and its wrappers take no token argument. It is the
pre-auth cold path: `AppShell.tsx:642` mounts it inside the `step === 'activate'` branch, before any
session exists, so a token bail there guards nothing and disables license activation on both shells.
And there is no twin to route to. `activate_license_scoped` has **0** references across `ui/src`, `apps`
and `crates`; `apps/mobile-tauri/src` registers `activate_license` **0** times while
`apps/desktop-tauri/src/lib.rs:1177` registers it once; and
`apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs:102` already carries
`("license::activate_license", "no_session_resolution")` — a no-session command recorded as accepted,
which is the opposite of a missed guard.

**One message template, in all 17 committed versions of the gate.** `git log --oneline` over
`scripts/verify-scoped-reads.py` is 17 commits, and the string `is not registered in that shell`
appears exactly once in each of the 17 blobs — there is no second per-finding voice the report could
have used. The word `unguarded` appears **once** in a tablet report, in the headline
`FAIL: 105 unguarded ambient IPC call(s):`, and **0** times in the desktop run. I read a headline as a reason,
which is the same class this file closed three times tonight, and I filed it against other lanes while
committing it myself.

**The counts, with their units, all measured on this tree at 02:23.** `--shell tablet` prints **105**
finding lines over **64** distinct command names; `--shell desktop` prints **0** findings. Of the 105
sites, **61** across **34** names already call something ending in `_scoped` — for those the advice
footer, "route through the scoped twin under the ADR #7 conditional", describes work already done. The
remaining **44** sites across **30** names carry no `_scoped` suffix, and of those 30 names **23** have
no `*_scoped` reference anywhere in `ui/src`, `apps` or `crates` while **7** have a twin the tablet
shell never registers. The brief asking for this correction paraphrased that last split as "30 commands
with no twin anywhere"; measured it is 23 and 7, and the difference is between a command that does not
exist and one that is not registered.

**CI has never graded the half that reports anything.** `dev-ci.yml:602`, step "Unguarded ambient IPC
call sites", runs the gate **bare**, and `scripts/verify-scoped-reads.py:1048` defaults `--shell` to
`desktop`; the only other invocation is the `--self-test` at `:600`. The bare run right now prints
`550 production file(s) graded`, then `27 of 27 (desktop 27 of 27)`, then `clean for desktop.` at exit
**0**. So for the whole life of this gate CI has shown the desktop verdict of a checker whose 105 real
findings are all tablet. Filed as its own open item, and it is a one-word change in a workflow this
lane will not edit: the step needs `--shell desktop,tablet`.

**RE-MEASURED 2026-10-24 — the fix is still not applied, and the backlog is shrinking.** Reproduced
from scratch, on the current tree, exactly as the entry above describes:

```
$ python scripts/verify-scoped-reads.py                 # what dev-ci.yml:1537 and check.sh:183 run
verify-scoped-reads: 1 shell section graded by no verdict in this run -- tablet: 34 unguarded
call site(s) across 19 file(s) and 27 command(s), 28 cleared ...
verify-scoped-reads: clean for desktop.        exit 0
$ python scripts/verify-scoped-reads.py --shell tablet
FAIL: 34 call site(s) ...                 exit 1
$ python scripts/verify-scoped-reads.py --shell desktop,tablet     # what both runners SHOULD run
FAIL: 34 call site(s) ...                 exit 1
```

The three invocation sites are unchanged and all still default to desktop: `dev-ci.yml:1537`,
`check.sh:183`, and the bare form in the step label. The number moved **101 → 34**, so the tablet
backlog is two-thirds cleared — which is progress no log records, because the lane that clears it
cannot make CI go red. The checker itself documents the trap at :1239-1263, including that the
"visibility" line it added costs a full extra scan per ungraded section.

**Still not done, and why:** the fix is one flag in two files, but applying it turns CI red against
a 34-site backlog spread over shared UI (`ui/src/features/auth/LicenseActivationScreen.tsx`,
`locations/topologyApply.ts`, `terminals/TerminalManagementScreen.tsx`, `design/DevToolbar.tsx`,
`memo/MemosScreen.tsx`, `reports/DebtRemindersCard.tsx`, `app/UpdateBanner.tsx`, ...). The checker
has no `--baseline` and no report-only mode, so there is no way to turn it on "yellow" while the
backlog is worked off. That is an owner's call on sequencing, not a lane's.

**What survives tonight, by commit.** `2050292bf` (01:31) tightened `GUARD_RE` and stands — the guard
fix is real, and the lane holding the gate audited it at **0** false clearances across a 28-site
sample. `85101c0c5` (01:54) and `32173bfd95` (01:36) adopted the shared allowlist schema validator in
the two gates and are unaffected. `af89fee21` (02:08) made the dead-api exclusion match on Windows and
moved the corpus from 614 to **550** graded files, which is why the byte counts and the unguarded
totals quoted across the 20:30-to-00:16 entries (`FAIL: 112`, `FAIL: 129`) are stale as arithmetic
even where the verdicts they describe still hold.

**An accounting gap, reported here and not reproduced.** The lane holding the gate reports **30** sites
cleared today by the guard veto with **nothing printed saying so**: the veto counts internally and
stays silent, so a cleared site and an unexamined site are indistinguishable in the log. I did not
independently reproduce that number, and it is labelled as theirs rather than mine for that reason. It
is the silent-continue class this file closed three times tonight — the hollow-root `--census`, the
staged-diff swallow, the empty-corpus green — one level further in, because this time the silence sits
inside a guard rather than around a read.

**Who owns what, once the two gates are read as themselves.** `verify-ipc-parity.py` owns the set of
NAMES and already filed the same fact on its own side, in one line:
`info[tablet]: 458 UI command strings, 322 registered, 156 unregistered UI command names … (154 allowlisted)`,
with per-name lines naming
`apps/mobile-tauri/src/lib.rs` `generate_handler` as the place a name is missing.
`verify-scoped-reads.py` owns the set of CALL SITES: 105 of them over those same 64 names. So 105
component tickets would double-book 64 gaps that are already known, against an owner that is not the
reporting component — and the 00:53 entry's queue of 17 pointed "in `ui/`" is aimed at the wrong tree.

### Dated corrections (2026-09-14, 00:10) — gates ten, eleven and twelve, and a premise of mine corrected by the lane holding the fence

**Gate 10, `a6998faef0`** (316/4), `scripts/verify-migration-column-types.py`. Verified by me 23:57: a typo
in a bare positional root, `crates/oz-core/migratios`, went exit 0 printing a clean full scan of 59
migrations; it now exits 2 with no count line and no Traceback. Plain run byte-identical at 152 B exit 0.
The file had no `--self-test` at all; the lane added one, eight cases, and pinned a red self-test at exit
2 so a broken test cannot impersonate a float-column finding.

**Gate 11, `84425ba057`** (193/23), `scripts/scan-unwrap-panic.py`. Verified by me 00:06: `--roots crates
nope` went exit 0 reporting 96 calls as if it were the world; now exit 2, 0 stdout, 0 count-bearing
lines. A deliberate narrow scan (`--roots crates`) still exits 0 and scans, which is the distinction that
makes this usable rather than annoying. Equation intact: total 136, invariant_annotated 136, recoverable
0, tolerance 0. **The pair that ends this family:** a genuinely empty root printed
`# total: 0 production unwrap/expect calls`, and that same line printed for the empty root plus one typo,
two runs byte-indistinguishable, one honest and one starved. Now only the honest one speaks.

**Gate 12, `8b3f52c8db`** (238/25), `scripts/verify-ipc-parity.py`. Verified by me 00:09: default grade
still byte-identical at exit 1, 3379 B stdout, 628 B stderr; self-test 0 (22 cases, 102 assertions);
mirrors 0; zero scratch; allowlist `e5663346ef` in worktree and HEAD, never written, though this is the
gate that writes it. Write-path refusals (drift, busy rename, and a previously-uncought OSError arm that
escaped as a traceback, i.e. exit 1) now go to `error:` plus exit 2, while an entry-level shape finding
keeps exit 1. This closes the residual registered at `6b405857d`, including the sharpest form of it, a
lock collision wearing the verdict code.

**My premise was wrong and the fence-holder corrected it.** I briefed gate 10 against
`verify-migration-column-types.py` on the strength of a measurement saying `--roots crates nope` exited 0
there. That file never had a `--roots` flag, it died at the unknown-flag guard. The symptom I described
reproduces in `scan-unwrap-panic.py`, and that lane closed it as gate 11 rather than assuming my brief was
right. A lane that disproves its own brief in the same turn has done more than a lane that completes it.

**One thing I nearly got wrong in the other direction:** I measured 2 hits for `allowlist write problem`
in the gate-12 file where the lane reported none, suspected a stale claim, and read them, both are
past-tense docstring prose, "Until now all three came back ... printed as" and "used to print". Checking
resolved it in the lane favour. Grep counts are not findings; the lines are.

**Left open on purpose:** the new write refusal prints to stderr while the older nothing-resolves refusal
prints to stdout, because `run-pre-push` merges them, same exit 2, same no-count rule, different streams,
deliberately not churned mid-session, a one-line follow-up. And gate 10 note stands, `--self-test` is a
developer tool in both files, named by neither `gates.json` nor `dev-ci.yml`, so the new tests enforce
nothing until someone wires them.

### Dated retraction (2026-09-13, 23:45) — two false claims I made about CI, both now measured

A lane dispatched to *fix* one of them checked instead, and found the opposite. Both were mine, both
were stated as facts in reports to the human, and one of them became a recommendation with a cost
estimate attached.

1. **"Nothing runs `scan-unwrap-panic.py --fail-on-recoverable`, so its green is a property of a
    command nobody invokes."** **False.** It is wired at `dev-ci.yml:489`, step "Panic inventory
(ADR #33)", and `scripts/gates.json` lists `panic-inventory` with `"status": "required"` mapped to
`dev-ci.yml#static-gates`. Measured 23:41.
2. **"`scripts/gates.json` holds a stale `130 / 0` for this scanner."** **False.** `grep -c 130
    scripts/gates.json` → **0**. No `130` anywhere in the file, and the file has no expectation
    fields at all — an entry is `{id, label, status, runners, _note, ci}`. The "130/0" was a
    scanner-output pair I had detached from its source and re-attached to a file that does not
    contain it.

**The shape of the failure is worth naming, because it is not a typo.** Claim 1 is about a real line I
had *not* grepped; claim 2 was the same sentence about a different surface, built by attaching a number
I had genuinely measured once (some earlier total/expected pair) to a filename I had genuinely inspected
(its shape). Both halves real, the glue invented. It propagated into `cc0c9d277` and `6b405857d` and
then into an authorization request — the human lifted a prohibition for a fix that turned out not to
exist, which is the most expensive form of a wrong belief: it buys permission.

**What changed as a result.** The `gates.json` fix is **cancelled**, not deferred. The live CI work is
exactly one item, `5C`, and it landed as `eb5e57d452`: `continue-on-error: true` on the
"FTL orphan census (informational)" step, the blocking `--self-test` step untouched — which finally makes
the AGENTS.md promise "in CI, non-blocking" true rather than aspirational. Remaining, and correctly
withheld by that lane: repointing `:489` at the bare strict default once `scan-unwrap-panic.py` settles,
since the flag is today an inert alias.

**Standing rule, restated where it will hurt:** before asserting a file contains a value, grep the file
in the same breath as writing the sentence. Two of my four retracted numbers tonight were about
*structure* I had looked at and *values* I had not.
### Dated correction (2026-09-13, 22:55) — the ninth gate: an api layer that resolves to nothing no longer grades clean

`2fabafb78b` (252/9), `scripts/verify-scoped-reads.py` only — the residual the eighth gate named, closed
in the same fence. Verified by me at 22:52: numstat **one file**; allowlist still `e5663346ef`; default
**180 B exit 0**; CI form **20473 B exit 1** still reading `FAIL: 112 unguarded`, unmoved and unquieted;
`--self-test` exit 0; mirrors from the repository root exit 0; zero scratch.

**The acceptance test was the sentence, not the code — and that test is my own fault for existing.** In a
temp tree with `ui/src` populated and `ui/src/api` absent, I measured exit **2**, **0 stdout**, **no**
`graded` line, **no** verdict line, no Traceback, and the stderr beginning
`error: the wrapper surface this gate grades is not there:` — naming the **wrapper** arm and *not* the
corpus arm. Because at 22:02 an unexplained exit 2 was a broken allowlist path wearing the wrong guard\u0027s
face, a bare status is no longer admissible evidence in this family, and the brief said so.

**What it closes:** an absent api layer produced an empty command-to-wrapper map, so every allowlisted
command resolved to zero wrappers, zero call sites, and the gate printed `clean for desktop.` at exit 0 on
a **3-file** corpus — the eighth guard passed happily because the corpus was non-empty. Same zero, one
level deeper: the walk is not the surface.

**A platform divergence it surfaced, deliberately left alone:** `production_files()`\x27s `ui/src/api`
exclusion builds `os.path.join("ui","api")` unnormalized and compares it against a normalized root, so on
**Windows it never fires** and api files are graded as production source too (fixture counts moved 3 → 4).
The lane declined to touch it because changing it would move the 612 and the 20473 mid-audit — the right
call, but the consequence is that *the set of files this gate grades differs by operating system*. That
deserves its own change with its own before/after counts, not a ride-along.

**The residual this one cannot close, and correctly refused to invent:** `if cmd_to_wrapper:` tests
*emptiness*, not *coverage*. An api layer holding one wrapper for an unrelated command makes the map
non-empty, so a real command resolving to nothing still grades clean (the lane\x27s own case 19 is the
reproduction). Closing it needs a threshold — per shell? per name? which names must have wrappers at all?
— and that is the allowlist contract owner\x27s policy, not a number to guess. Recorded as **PARKED** below.

### Dated correction (2026-09-13, 22:35) — a number I invented, and an inference of mine that was a harness artifact

Two of my own errors, both surfaced by a worker *measuring* rather than by me checking. Written here because
they are the kind that survive into other documents if only the fix is recorded.

**One. `14 unguarded calls` was never measured; the truth is `112`.** A lane reported "14", I repeated it,
and it then propagated into `6b405857d` and `958a56009` — into three places, all of them mine, none of them
mineasured. The worker that landed `3cf078aad` corrected itself (`grep -o 'FAIL: [0-9]* unguarded'` →
`FAIL: 112 unguarded ambient IPC call(s)`), and I reproduced **112** myself at 22:31. The byte-identity
claims were never at risk: the 20473-byte CI-form output is identical on both sides and carries 112 on both
sides. A wrong adjective on a right verdict is still wrong, and this repo has now twice seen a number
invent itself a life in prose (the `130 / 0` I cited there does not exist, see the 23:45 retraction, it was my second invented number in an hour, in `scripts/gates.json`).

**Two. My "the guard already refuses a genuinely missing root" (in `6b405857d`) was my own broken path.**
At 22:02 I built a temp tree, put the allowlist at `<root>/ipc-parity-allowlist.json`, and watched the gate
exit 2. I read that as the corpus guard. It was `read_allowlist()` failing on a path it could not find —
the gate reads `REPO/scripts/ipc-parity-allowlist.json` (line 110). The lane measured the same cell with a
*valid* allowlist and a missing `ui/`: **rc 0, 197 B, `0 production file(s) graded`, `clean for desktop.`**
The seventh gate therefore did **not** already cover the missing root; the eighth gate (`3cf078aad`) is what
covers it, and my inference had shrunk a bigger hole into a smaller one. That is the failure mode of a
reasonable-sounding exit code, and I wrote the paragraph about it in the same document two lines later.

**The rule, restated where it will be read:** an exit code identifies *that* something refused; only the
sentence it prints identifies *what*. Read the `error:` line, or reproduce the cell with the input you
actually intended, before writing that a guard exists. I have now confirmed this gate refuses a missing root
the honest way, at 22:31, allowlist present and correct, `ui/` gone: exit **2**, 0 stdout, no graded line.

### Dated correction (2026-09-13, 22:32) — the eighth gate: an empty corpus no longer grades as clean

`3cf078aad` (211/3), `scripts/verify-scoped-reads.py` only — the residual the seventh gate left open,
closed inside the same fence. Verified by me at 22:29, and this time against **my own** baselines taken
30 minutes earlier at 22:02: bare default **180 B exit 0** and `--shell desktop,tablet` **20473 B at
exit 1** both reproduced exactly, the 1 still carrying the tree's 112 unguarded-call verdict (a
*regression* if it had moved), `--self-test` exit 0, allowlist still `e5663346ef`, zero scratch.

**The two-sided proof, run in isolation.** With a *valid* stated-empty allowlist in place, so only the
corpus could trip it: `ui/src` present and empty → exit **2**, 0 stdout, no Traceback, no verdict line,
`error: …\ui\src exists an…`; add **one** production file → exit **0** and `1 production file(s)
graded … clean for desktop.` Same guard, opposite outcomes, which is the only pair of results that
shows it discriminates rather than simply failing.

**A methodological confession worth the page.** My first attempt at that cell put the allowlist at
`<root>/ipc-parity-allowlist.json`; the gate reads `REPO/scripts/ipc-parity-allowlist.json` (line 110).
So the run exited 2 for the *wrong reason* — the allowlist guard, not the corpus guard — and the exit
code looked like success. An exit 2 that names nothing is no evidence at all; I only caught it by
reading the `error:` text instead of the status. A refusal must be identified by the sentence it
prints, not by the code it returns.

### Dated correction (2026-09-13, 22:05) — the seventh gate, and a residual that turned out smaller than reported

`551f2a38eb` (111/29), `scripts/verify-scoped-reads.py` only — the *other* reader of the same shared
`scripts/ipc-parity-allowlist.json`, which the `e931220d9a` guard did not cover. Verified by me at
22:02 on the committed tree: numstat one file; default run **byte-identical 180 B exit 0** against a
baseline copy placed inside `scripts/`; CI form `--shell desktop,tablet` **byte-identical 20473 B at
exit 1**, that 1 being the tree's own pre-existing verdict (112 unguarded calls) which the lane
correctly did *not* silence; `--self-test` exit 0; mirrors from the repository root exit 0; allowlist
still `e5663346ef` in worktree and HEAD; zero scratch.

**The hole it closed was timing, not presence.** The old shape guard asked only for *membership*, so
`{"desktop": "abc"}` cleared it, **walked 612 production files**, and only then reported a member
problem under the verdict code — a refusal one second late and one door too far. Membership plus
`isinstance(..., list)` now refuses before the walk, and refusals moved off exit 1 (three real
verdicts spend it here) onto 2, with `error:` on stderr. Note this file's own header and three class
docstrings *declared* the old behaviour as the design, "ONE voice, `FAIL: <sentence>`, exit 1" — a
comment documenting a bug as intent is still a bug.

**A residual I shrank by testing it rather than repeating it.** The lane reported (1): a copy with
`ui/src` present but holding nothing exits **0** printing `0 production file(s) graded`. True. I
tried the stricter case, `ui/` absent entirely, and it exits **2** with **0 stdout bytes** — the
guard already refuses a genuinely missing root. So the live gap is only *present-but-empty*, which
is narrower than "nothing refuses it" and should be written down that way.

**Two residuals to carry, both real:** (2) exit 1 still means two different things in this file,
"the tree has unguarded calls" and "one of your allowlist entries is malformed", separated only by
wording; (3) the two gates now hold **near-but-not-identical schemas for one shared file** — this
one requires only the sections `--shell` names (right for a two-of-four reader), `verify-ipc-parity.py
refuses unless all four are stated lists — so a `{desktop, tablet}` file is *graded* by one and
*refused* by the other. Honest per role, but nothing outside either file polices that they keep
agreeing; the next edit to that allowlist format needs both gates open in front of whoever makes it.

### Dated correction (2026-09-13, 21:35) — the sixth gate: ipc-parity refused a malformed allowlist, and did not rewrite it

`e931220d9a` (253/18) + `21da42e70f` (8/0), `scripts/verify-ipc-parity.py` only, both one file. This was
the highest-blast file left because it *writes* `scripts/ipc-parity-allowlist.json`: an unreadable or
wrong-shaped read was treated as an empty allowlist, the gate printed its verdict, and `--write-*`
flags could persist that emptiness — the `{}` case wrote 1227 bytes where the probe held 2. Now a
read-site refusal (`AllowlistUnusable` → `error:` + exit **2**, the same voice as the ftl-orphans
refusals) and all three writer flags route through `write_or_refuse`, so a refusal writes nothing.

**Verified by me at 21:32, on the committed tree, sibling runs at one instant:** the default grade
is **byte-identical** before/after (exit 1, stdout 3379 B, stderr 628 B, `cmp` clean on both) so the
refusal is purely additive on the failure path; `--self-test` exit **0** "self-test: OK";
`verify-agents-mirrors.py` **from the repository root** exit **0**; and
`git hash-object scripts/ipc-parity-allowlist.json` = `e5663346ef` in the worktree **and** at HEAD —
the frozen baseline I took at 20:50 *before* briefing the worker, so the destructive case is proven
not to have touched the shared file. Zero scratch (`tmp-ipc*`/`tmp-ab*`) left in `scripts/`.

**The distinction that makes this correct, not just quiet:** "stated-empty is a claim,
defaulted-empty is this run's own invention." `{"dev_mock": []}` — key present, value a list, zero
entries — is a claim the file makes, so it grades (and `--write-allowlist` legitimately emits it on
a clean tree). An absent file, a non-object, `{}`, or a section holding a scalar is a value never
received, and `payload.get(section)` was *manufacturing* the emptiness. Told apart by
`section in payload and isinstance(..., list)`, before any walk.

**A worker fixing its own refusal is the tell worth reading.** Its first commit's decode arm called
`.strerror` on a `UnicodeDecodeError`, which has none, so the refusal itself raised AttributeError —
"a refusal that crashes is worse than one that does not", and per §3 it went in as a second one-file
commit rather than an amend, with every check re-run on the final bytes. That is the behaviour.

**Residuals the worker named, which I am escalating rather than burying.** (1)
`scripts/verify-scoped-reads.py:266` still opens the *same* shared allowlist under its own rules — my
guard is this gate only, not that path. (2) Four sections each stated `[]` is legal and grades clean,
so a truncate-the-entries-but-keep-the-keys edit still passes on `(0 allowlisted)` reporting alone.
(3) Entry-level shape findings and every *write-side* refusal still spend verdict code 1 — including
a busy-rename lock collision, the exact case the ftl file says must never leave a 1. (4)
`extract_ui_commands`/`read_dev_mock_sources` answer an unreadable source with `warn:` + `continue`,
so a hole in the walked corpus is a shorter walk, not a refusal. Each is real; (1) is the cheapest to
follow next because it is a small file that already has an `AllowlistUndecodable` precedent.

### Dated corrections (2026-09-13, 20:30) — the live-writer race, and the same class in a fifth gate

**The 19:45 finding is closed by `4d1a85b15`** (20:28, `scripts/verify-ftl-orphans.py`, 186/7 — one
file). A locale file that cannot be *read* is now routed instead of crashing: `PermissionError`
appears at two handling sites, and exit **1** (which in this file means `FAIL: N orphan
problem(s)`) is no longer reachable from a failed read. Verified by me at 20:29 on the committed
tree, with the baseline blob placed *inside* `scripts/` so `ROOT` resolves to the real repo, then
deleted: `--census` **1781 B exit 0**, `--self-test` **68 B exit 0**, `--staged-only` **62 B exit 0**
— all three **byte-identical** to `HEAD^`, so the refusal is purely additive on the failure path.
**Honest limit on this entry**: the forced-`PermissionError` repro was *reported* by the worker
(a holder process keeping the file open, correct for this OS, since `chmod 000` does not deny reads
under msys/NTFS). I did not re-drive that race myself and this line does not claim I did.

**A fifth gate, same class, closed earlier: `868fe3582`** (19:59, `scripts/verify-commit-subjects.py`,
71/7). Its git helper returned `r.stdout` with no `check=` and `returncode` unread, so a rejected
revision and a genuinely empty range were the same value. Verified by me at 20:01: the old code
printed `0 commit(s) checked, 0 non-conforming subject(s)` at exit **1** over a range git had
**rejected**; the new code exits **2** with **0 stdout bytes**. Healthy-path output unchanged.

**Two verification traps found while closing these, both mine, both worth keeping.**
1. *Identical results can mean two crashes.* My first attempt ran the extracted blob from a temp
   dir, where `ROOT` (derived from `__file__`) pointed outside the repo; both old and new died on
   an unrelated `FileNotFoundError` reading `.githooks/commit-msg` and returned the *same* exit and
   byte counts. A diff that shows no change is only evidence when both sides ran the intended code.
2. *A single read of a file being written is a photograph of a transit.* At 20:14 `wc -l` returned
   493 and clean while the lane was mid-write; I concluded a 176-line rollback and told the worker
   so. Two minutes later the same file read 669, dirty. The lesson generalises the porcelain rule
   in §3 — inspect twice, and only where you are not the disturbance.

**Residuals left open deliberately.** `--range HEAD..HEAD` still prints its `0 commit(s) checked`
verdict to stdout *before* its own honest exit-1 refusal — print ordering, and reordering it would
change healthy-path output. And an unreadable `.githooks/commit-msg` is still a `FileNotFoundError`
traceback rather than a refusal: same family, different read.

### Dated correction (2026-10-26, 13:05) — the 34 lingering ` M` entries are STALE INDEX STAT, not CRLF

**The misdiagnosis being corrected, and it lasted sixteen rounds.** `git status --porcelain`
in this checkout has read "34 modified" for most of a working session. The standing explanation
was "CRLF/stat noise", and it was half right for the wrong reason: no CRLF exists on any of the
34 paths. Measured directly — `shared-ui/locales/inventory.ftl` has **0 CRLF** and 187 LF-only
on disk, and `HEAD`'s blob has **0 CRLF** and 187 LF-only too. `.config/nextest.toml` likewise
(0 CRLF, 118 LF). The line-ending theory could not have been true of these files.

**What is actually true, in git's own words.** `git diff --stat` (worktree vs index) is **empty**;
`git diff --cached --stat` (index vs HEAD) is **empty**; `git diff --numstat` is **empty**. So is
`--ignore-cr-at-eol` and `-w`. For every one of the 34 paths, `git hash-object <path>` equals
`git rev-parse :<path>` **and** `git rev-parse HEAD:<path>` — 0 of 34 differ from the index,
0 differ from HEAD. There is nothing to commit on any of them, and nothing was ever lost.

**The mechanism, isolated to one file.** `.config/nextest.toml` on disk is **6546 bytes**; the
index entry still records `size: 6664` with an `mtime`/ctime that do not match the file. Reading
the blob with `git cat-file blob :.config/nextest.toml` gives **6546 bytes**, byte-for-byte equal
to the disk file (`disk == blob` is `True`). The index therefore holds a **stale stat cache** for
a blob whose content already matches: the entry was rewritten by another writer mid-`add`, so git
reports "modified" from the stat comparison rather than from content. `git update-index -q
--refresh` exits 0 and does not clear it, because refresh only rewrites entries it can prove
current and this checkout is shared.

**Why this matters beyond tidiness.** Two of the 34 paths are locale bundles
(`shared-ui/locales/inventory.ftl`, `inventory.id.ftl`). A session that trusted the CRLF label
and then ran a "fix line endings" pass over them would rewrite 187 lines of an FTL bundle to
repair a defect that does not exist — and the same class of mistake on the `*baseline.json`
files in that list would silently reset an l10n ratchet. The correct handling is the one
`AGENTS.md` §7.3 already states: compare `git hash-object` with the index and HEAD, and when
they agree, there is nothing to commit. **Do not "fix" these files.**

**The classification bug that produced the wrong answer first.** A first attempt at this
measurement read the porcelain status as `x, y = line[0], line[1]` and then branched on
`if x == 'M'`, which sent every entry down the `else` arm and printed all 34 as genuine
"REAL content changes" with a fabricated `(status  M)` annotation. Porcelain v1 is
`XY<space>path`: a **worktree-only** modification is `' M'` — the space is column 0. Branching
on column 0 inverted the answer. The reliable test never parses the column at all: hash the
worktree file and compare it to `:<path>` and `HEAD:<path>`.

**Provenance of this entry.** Commit `ed01e97c0` (`fix(settings)`) closed the last four *real*
dirty files — the `SyncConflictsPanel` load-path raw-rejection fix plus its two FTL keys and its
test. After that commit the working tree held exactly these 34 stat-only entries and no
untracked files, which is what made a clean measurement possible. The fix itself was verified by
mutation: reverting `l10nErrorMessage(e, l10n, 'sync-conflicts-load-failed')` to `String(e)`
reddens exactly one test (the load-path case) and the file was restored byte-identically
(`3e9d5e7e5e` before and after).

### Dated correction (2026-09-13, 19:28) — the hollow-root census finding is closed by `ef2058f28`

`ef2058f28` (38/1, one file) adds a `hollow_root_reason()` gate on the `LOCALES` surface. Proven by
me on the committed tree, not on the report: run from outside any repository `--census` now exits
**2** printing one `error: cannot run --census here: the required directory \`ui/src/locales\` is
missing (looked under ROOT=…); nothing was counted, so this refusal is not an orphan verdict.` line
(stderr, 0 stdout bytes, **0** occurrences of `candidates`, **0** tracebacks). Inside the real tree
`HEAD^` and `ef2058f28` censused back to back at 19:22 are **byte-identical** at 1,781 bytes, exit 0
both, `candidates` still 68.

**A caution for anyone re-verifying this entry.** The `declared`/`referenced` figures above are not
stable: they drifted 4823 → 4831 → 4871 while this finding was being closed, because other sessions
were landing `.ftl` keys mid-flight. Only `candidates` (68) and the byte count (1,781) held. A
diff-and-blame against a quoted figure from this page is therefore meaningless — compare two
*sibling* runs taken from the same tree at the same instant, never a run against a number written
in prose.

**Still open in the same file, newly confirmed rather than inherited:** at a hollow ROOT,
`--self-test` **crashes** — exit **1**, one `Traceback`, measured by me at 19:27 — where `--census`
and `--staged-only` now refuse at exit 2. This was recorded at 17:04 on a worker report and
explicitly labelled unverified; it is verified now. Same class, smaller fix: the guard already
exists in the file, `self_test()` just does not call it. Worth noting how easily this one hides —
the crash exits **1**, the same code a real self-test failure produces, so a hollow invocation
looks exactly like a genuine check that found something. The worker also reported `ui_blob()`
still reachable (a tree with bundles but no `ui/src/**/*.ts*` censuses every key as a candidate,
loud rather than clean-looking) and `load_allowlist()` still returning `{}` for an absent file.

### New verified finding (2026-09-13, 17:04) — `--census` reports a clean orphan sheet over a hollow root

`scripts/verify-ftl-orphans.py --census` run with `ROOT` resolving **outside any checkout** exits
**0** and prints `info[census]: 0 declared en keys, 0 referenced, 0 candidates` (385 bytes);
the same committed code in the real tree prints `4823 declared en keys, 4755 referenced, 68
candidates` (1781 bytes), exit 0 both ways. Director-measured at 17:04, not taken from a report.

This is the empty-corpus class surviving in the *other* mode of a file whose staged mode was just
closed by `cd2b55fa3`. Five functions reach the same nothing-instead-of-failure state through
`Path.glob`, which yields no items rather than raising: `declared_keys()`, `bundle_keys()`,
`ui_blob()`, `intra_bundle_refs()`, plus `load_allowlist()` which returns `{}` when the file is
absent. Under the same hollow root `--self-test` dies with a `Traceback` at exit 1 — reported by
the closing worker as pre-existing and outside its brief, unverified here.

**Why it matters more than the cell already fixed:** `--staged-only` is the blocking hook step at
`.githooks/pre-commit:257` and is now refused; `--census` is the **advisory CI-side** report, so
a hollow invocation looks like a genuinely clean orphan sheet to a job that runs from a partial
checkout or a mis-rooted working directory.

**Recommendation, not applied:** a zero-denominator refusal rather than a second voice, in the
shape `verify-no-hardcoded-money-format.py:805159081` documented at 13:51, where `scanned == 0`
in the starve check was recorded as an **unobservable disjunct**. A census that declares zero
files is not a census of zero orphans. Owner decision needed on whether `--census` stays advisory
or whether a hollow root should exit non zero, because changing `--census` to fail is an
enforcement change, not a bug fix.

### Dated correction (2026-09-13, 16:57) — the staged-diff swallow is closed by `cd2b55fa3`

`cd2b55fa3` (40/6, one file) makes `verify-ftl-orphans.py` **refuse** when its staged diff cannot be
obtained. Proven both directions on the committed blob at 16:56: run from outside any repository it
exits **2** with one `error: cannot read the staged diff (\`git diff --cached -U0\`…)` line, **0**
tracebacks and **0** occurrences of the phrase `nothing staged`; inside the real repo with nothing
staged under `ui/src` it still prints `staged-only: nothing staged under ui/src; nothing to verify.`
at exit **0** — the honest empty verdict is untouched, which is the case a refusal-shaped fix
most often breaks. The voice follows the house decision from `409d09334`: `error:` on **stderr**,
exit **2**, because in this file **exit 1 already means a verdict was reached about someone
else's keys**, and a refusal must not be able to read as one. Enforcement note for the owner:
this gate is called at `.githooks/pre-commit:257` and the hook aborts on nonzero, so the refusal
now blocks a commit instead of green-lighting it.

**Class sweep, measured:** across all 50 `scripts/*.py` and all 60 tracked `.py` files, **0**
remaining text-mode `open()` feeding a `json.load` without an `encoding=`. The 9 bare-`open(` hits
are 7 `urllib.request.urlopen`, one `open(path, "rb")` PEM read, and one prose string in a doc.
`coverage_top.py` had no invokers at all — the only `git grep` hit is its own usage line at `:5`,
so no caller inherits a new exit code.

Two of the three named items remain genuinely open: the identical wrong-shape hazard in
`verify-ipc-parity.py` (`:547 :592 :730 :765 :794`), which is also the *writer* of the shared
allowlist and so can re-publish a shape nothing can read, and `scripts/coverage_top.py:40`
opening JSON with no `encoding=`. Recorded as findings, not touched.

**(later same day)** the first of those two was taken up and closed by `409d09334` (78/8, one file,
`scripts/verify-bundle-parity.py`): `--scan-dirs` with a blank value, a lone comma, or `""` all now
exit **2** with one `error:` line on stderr, **0 bytes on stdout**, and no `missing key` token in
either stream, so a CI log grep for the verdict string cannot match a refusal. Note the`""`
case was worse than reported, it did not merely scan nothing, it silently *widened* to a full
scan of 330 files, so a typo in the flag turned into a different audit than the one asked for.
Director-measured at 15:38: bare run exit 0 at 685 bytes, byte-identical to the lane's 15:26
baseline, and the six-dir CI form still `scanned 448 file(s)`. The voice question was decided by
the worker and accepted here, it refused with this gate's own `error:`/exit 2 rather than the
`FAIL:`/exit 1 of the reference gate, because in this file **exit 1 already means "a scan ran and
found missing keys"**, so a shared voice would have been a shared *lie*; consistency of format is
worthless when the code means something different on the other side. It also reported, without
being asked, that `--staged-only` with no paths prints `0 missing key(s)` and exits 0, and did NOT
change it, because that behaviour is documented in the file's own EXIT CODES and relied on by
`.githooks/pre-commit` for delete-only commits, a contract decision rather than a fence edit.

### New verified finding (2026-09-16, 10:10) — the Tools grid and the page it links to give opposite answers for a manager, and the two plan docs disagree about which one is right

**Found while attempting `todo-open-debt-program.md` box 3a.2 ("Replace the rank comparisons with
permission checks"). The box cannot be executed as written, and the reason is not missing work — it
is two documents that state opposite policies about the same gate.**

**The disagreement, live today on presets.** The `analytics` route carries two gates that do not
agree:

| Where | Gate | Read at |
|---|---|---|
| Home Tools card | `minimumRole: 'admin'` (a **rank**) | `ui/src/features/workspaces/tools.tsx:180` |
| The route itself | `requiredRole: 'manager'` + `requiredPermission: 'analytics:view'` | `ui/src/features/analytics/register.tsx:12` |

The route's permission arm is **authoritative**, not advisory — `passesGate`
(`ui/src/registries/page-registry/index.ts:166`) returns `hasGrantedPermission(permissions, …)` and
never consults `requiredRole` whenever the session carries granted keys. And the `role-manager` preset
**does** hold that key: `permissions::ANALYTICS_VIEW` is the 36th entry of its list
(`platform/core/src/rbac_presets.rs:84`, inside the block opening at `:49`).

So a manager session is **shown Analytics in the nav and hidden Analytics in the Tools grid, at the
same time, on the same route** — `getEnabledPages` admits the page, `roleAtLeast(roleName,
'admin')` refuses the card. This is not a custom-role edge case; it is the default preset.

**Why it was not simply fixed here.** The two plan documents prescribe opposite resolutions, and
choosing between them changes who can see an admin surface:

- `todo-tools.md:730-732` states the current shape as **deliberate**: *"the home `minimumRole` is
  never LOOSER than the route's `requiredRole` (**home-stricter is the documented policy choice**;
  Settings stays `manager` + authoritative `settings:read` at the route until the §H scope pass)."*
  Under that policy the grid is a stricter front-door filter and the nav is the authoritative gate —
  the two surfaces are *supposed* to differ, and the defect is only that nothing says so at either
  site.
- `todo-open-debt-program.md` box 3a.2 asks for the rank comparisons to be **replaced** by permission
  checks, one gate at a time, each pinned by *"a custom role holding the gate permission passing the
  same way a preset would"*.

Those cannot both hold for `analytics`. The preset that holds `analytics:view` — `manager` — is
exactly the role the home gate excludes, so 3a.2's required test is unsatisfiable without
contradicting `todo-tools.md:730`. Either the documented home-stricter policy is retired, or the Tools
grid keeps its rank and 3a.2 shrinks to the gates that have no route twin.

**RULED 2026-09-20 — this entry is CLOSED and is kept only as the record of the question.** The
owner ruled for the documented front-door policy: *"the rank stays authoritative for the home grid; 3a.2
is narrowed to the gates that have no route twin"* (docs/plans/_done/done-todo-owner-rulings.md:182,
R20). The code carries the citation — ui/src/features/workspaces/tools.tsx:30 cites R20 by name and
:282 records the same ruling — which is exactly sub-question 2 above ("should be cited *at*
tools.tsx:180"), so that request was honoured in code even though the register below was never
updated. The register's census (6 of 17) remains accurate; only the status line was wrong.

The three sub-questions, none of which a lane should answer:

1. If the permission wins, the Analytics card becomes visible to every manager. Is that intended?
2. If the rank wins, `todo-tools.md:730` should be cited *at* `tools.tsx:180`, because the current
   file documents only `minimumRole` and `minimumTier` and a reader cannot tell the two gates are
   meant to differ.
3. Does the same split exist on any other tool? Only a per-tool census answers it, and that census has
   not been run — see below.

**CENSUS RUN 2026-09-16, 10:25 — the population is bounded: 6 of 17, and the widener is the
auditor.** The paragraph that stood here said the population was unmeasured. It has since been
measured, so it is corrected in place rather than left to rot. All **17** catalogue entries were
compared against the **45** registered pages, with preset grants resolved from the registry rather
than from prose:

| Result | Count | Tools |
|---|---|---|
| Home gate agrees with the route | 9 | `locations` `terminals` `memo` `promotions` `tax-config` `exchange-rates` `offline-queue` `features` `data-management` |
| Invariant **violated** (`todo-tools.md:730`) | **0** | — |
| Would **widen** if gated on the permission | **6** | `staff` `shifts` `analytics` `reports` `audit` `settings` |
| No registered page — deep link into the Settings hub | 2 | `settings/topology`, `settings/sync` |

**The documented invariant holds.** Zero tools carry a home `minimumRole` looser than their route's
`requiredRole`, so `todo-tools.md:730` is accurate as written and no card is a plain bug.

**What the 6 would admit — and this is the whole decision.** In five of the six the role that gains
the card is the **auditor**, because the auditor preset genuinely holds read keys the home gate never
consults. Verified at `platform/core/src/rbac_presets.rs:262-272`: `STAFF_READ`, `SETTINGS_READ`,
`REPORTS_VIEW`, `AUDIT_VIEW`, `SHIFTS_VIEW_ANY`. A permission-gated grid would therefore hand a
**read-only** role the Staff, Shifts, Reports, Audit Log and Settings cards. The sixth is `analytics`,
where the gainer is `manager`.

That generalises the `analytics` table above. The route gate already admits these roles today — their
nav already shows the pages — so the question is not *whether the auditor should see the audit log*
(it does) but whether the home grid should mirror the nav or stay the stricter front door.

**Census instrument** (read-only; parses the four files; nothing above is carried from another
document): `%TEMP%/tool-gate-census.py`, run at HEAD `845ecf0f4`. It is a scratch instrument, not a
gate — nothing in CI calls it, and it was deliberately **not** added to `scripts/`.

**Re-derive, verbatim — no number above rests on another document:**

```bash
sed -n '180p' ui/src/features/workspaces/tools.tsx
sed -n '12p' ui/src/features/analytics/register.tsx
sed -n '84p' platform/core/src/rbac_presets.rs
sed -n '166p' ui/src/registries/page-registry/index.ts
sed -n '730,732p' todo-tools.md
```

**Nothing in the tree was changed to measure this** — every line above was read, not written, and the
three files it names were clean in `git status --porcelain` at the time of reading.

### ~~New verified finding (2026-09-16, 11:24) — the tablet's manual sync retry pushes to the server and then writes the outcomes to the wrong database~~ — **CLOSED 2026-09-23 (`78276320f`)**

**Closed.** Phase 1 read the pending queue from the STORE database and Phase 3 wrote the outcomes to
`state.db`, the GLOBAL identity database — so `mark_offline_synced` hit ids that did not exist there,
`CoreError::NotFound` propagated out of `apply_sync_outcomes`, and the store's rows stayed `pending`,
making every retry re-send the same items. Phase 3 now re-resolves the STORE scope for its write
(`apps/mobile-tauri/src/commands/offline.rs`), the same shape as its bridge twin
(`crates/kasirmu-bridge/src/offline.rs`) and as this shell's own `sync_run_scoped`.

Proven by `retry_offline_sync_scoped_pushes_critical_before_an_earlier_low_item`
(`apps/mobile-tauri/src/commands/offline_tests.rs`), which drives a real push through a loopback socket
and asserts the store rows end `OfflineQueueStatus::Synced` with `pending_offline_count() == 0`, plus
that the global queue stays empty. Its sibling
`retry_offline_sync_scoped_records_a_push_failure_without_marking_synced` pins the other direction: a
genuine HTTP failure records `Failed` and never `Synced`. The C54 divergence pin that asserted the old
`NotFound` behaviour was deleted by the fixing commit, on purpose.

**Path note (corrected here).** This entry originally named `apps/mobile-tauri/src/commands/offline.rs`,
`crates/kasirmu-bridge/src/offline.rs`, `apps/mobile-tauri/src/state.rs`, `crates/kasirmu-bridge/src/ctx.rs` and
`crates/kasirmu-core/*` — all pre-rebrand paths that no longer exist, so a reader following the record could
not reach the code. The real paths are `apps/mobile-tauri/src/commands/offline.rs`,
`crates/kasirmu-bridge/src/offline.rs`, `apps/mobile-tauri/src/state.rs`, `crates/kasirmu-bridge/src/ctx.rs`
and `crates/kasirmu-core/src/*`.

**Re-derive, verbatim:**

```bash
grep -n "resolve_scope(&session_token)" apps/mobile-tauri/src/commands/offline.rs
grep -n "fn retry_offline_sync_scoped" crates/kasirmu-bridge/src/offline.rs
cargo test -p kasirmu-mobile offline
```

## How to close these

Each finding's original remediation guidance lives in git history under
`audit/<NN>-<slug>.md` (the file was consolidated into this document; the
per-finding fix descriptions, affected files, and commit lists remain
available via `git log` on the deleted path). Re-open a finding here, fix
it, then flip its status in this file.

> **Re-verified 2026-10-11 (docs-auditor).** Two claims in the I18N-05 entry above need a dated
> qualification, and neither touches its substance — the two retired gates ARE restored
> (`dev-ci.yml` carries both `static-gates` and `ci-docs-drift`; `scripts/gates.json` holds the
> records; `verify-ci-docs-drift.py` exits 0 today).
>
> (1) **Three of the five restore SHAs in that parenthetical do not resolve.** `bf8f0da3` and
> `f5d94a20` are real 2026-09-04 commits; `ecbcc635`, `af246396` and `6e270d70` match no object
> anywhere in this repository — not a commit, tree or blob prefix. They are not 8-hex role ids (the
> journal convention) and not checksums; they read as transposed prefixes from a branch state this
> checkout no longer carries. The re-derive is `git cat-file -t <sha>`. Left as written because the
> finding is closed and its evidence is the gate state, not the SHA list; recorded so a reader does
> not treat the five as equally checkable.
>
> (2) **The gate census has moved on.** This entry says `scripts/gates.json` "now carries 69 gate
> records (52 required + 1 advisory + 16 retired)"; at HEAD it carries **120** (101 required +
> 4 advisory + 15 retired). The roster grew by other lanes' work, which is the expected direction.
>
> The `ded468676` correction at the head of the registration-gate section needed no work: that
> entry already documents the invalid object itself and names the two forms that resolve
> (`ded4686776`, `ded468677`) — both verified again here.

> last audited 29-09-26 by docs-auditor

### Dated correction (2026-11-06) — BR-T1's blind spot is closed, and its example was already stale

`orphan_permission()` read each shell's command bodies through `cmd_dir.glob("*.rs")` at
:2597 while the registry scan beside it walked the whole tree with `rglob` (:537). Made
recursive in `061cbae93`. The reach difference, measured by running both globs over both shells:
**desktop 75 → 84 files, tablet 114 → 116** — eleven files no run of this gate had ever opened.
One of them matters: `apps/mobile-tauri/src/commands/pos/checkout.rs` defines **4** gated
scoped commands (`preview_promoted_total_scoped`, `preview_promoted_total_from_lines_scoped`,
`run_complete_sale_scoped`, `complete_sale_scoped`, all `SALES_PROCESS`).

**No verdict moved, and that is the number to keep.** The gate reports the same 24 allowlisted /
24 measured orphans, 14 redundant twins and 10 GATED DEAD SURFACE before and after, and
`--self-test` still passes its 27 cases + 70 extra guards (195 assertions). So the change closes
a hole nothing is standing in today; what it buys is that a future allowlisted orphan defined
under `commands/<feature>/` gets a verdict instead of silence.

**BR-T1's own illustration is stale, and repeating it would spread it.** It names "7
`require_permission` sites" in `apps/desktop-tauri/src/commands/topology/`; measured
2026-11-06 that directory holds **0** (`grep -c require_permission
apps/desktop-tauri/src/commands/topology/*.rs` → 0 in all nine files). The gate text moved to
the bridge, exactly as the neighbouring BR-T4 records — so the file the entry pointed at had
stopped being the risk while the mis-globbed file that *did* hold gates sat on the tablet side,
where the entry never looked. A finding's example and a finding's shape age at different rates.

**Still open, same family, NOT fixed here:** `orphan_permission()` returns from the FIRST shell
whose file defines the command, so a command defined in both shells is judged by one copy only.
Whether any allowlisted orphan is in that shape is unmeasured; the recursive scan is a
precondition for asking that question cleanly, not an answer to it.

### Dated correction (2026-11-06) — BR-T4's forward warning is wrong: the extracted gate IS visible, and the follow is load-bearing

BR-T4 ends `but the check can no longer see an extracted desktop gate`. Measured tonight by
deleting the `DELEGATION_RE` follow in `orphan_permission()` — the lines that look up
`kasirmu_bridge::<mod>::<fn>` and test the bridge body — and re-running the gate:

| mutation | redundant twins | GATED DEAD SURFACE |
|---|---|---|
| baseline | 14 | 10 |
| delegation follow deleted | **22** | **2** |
| restored | 14 | 10 |

**Eight of the ten GATED verdicts exist only because that follow runs** — `PRODUCTS_CREATE`,
`PRODUCTS_DELETE`, `CUSTOMERS_VIEW`, `PRODUCTS_READ`, `PRODUCTS_UPDATE`,
`SECURITY_MANAGE` (both `get_key_rotation_info_scoped` and `rotate_encryption_key_scoped`) and SETTINGS_EDIT.
Both of BR-T4's premises are stale: the desktop body is no longer the only body consulted, and an
extracted gate is no longer invisible. And the failure mode runs the dangerous way — with the follow
removed, 22 of the 24 allowlisted orphans read as 'guards nothing', which would retire real posture
as dead weight.

**What BR-T4 is still right about, kept as the limit:** the follow is **one level**. A command whose
gate sits two delegations away (shell → bridge A → bridge B) is still reported as ungated. That case
is unmeasured tonight; what the measurement does say is that the follow must not be deleted as dead
code, and the comment beside it now says why.

**Corroboration from outside the function:** the same both-shells scan was then run against the
full allowlist, not just the four named here. **8 of the 24 allowlisted orphans are defined in both
shells** — `create_product_variant_scoped`, `delete_product_variant_scoped`,
`enqueue_offline_scoped`, `get_product_variant_scoped`, `list_pending_offline_scoped`,
`list_product_variants_scoped`, `list_scale_devices_scoped`, `update_product_variant_scoped` — and on
all 24 entries the first-shell verdict equals the both-shells union. So `orphan_permission()` returning
from the first shell that defines the command currently produces the same answer as if it unioned both
shells, and the first-shell-wins return noted in the BR-T1 correction above is a latent hazard today,
not a live false negative.

**The latent hazard, stated as a falsifiable invariant rather than a worry:** a both-shells-defined
orphan whose **desktop** body guards nothing and whose **tablet** body does (or vice-versa) would be
reported as ungated today while one shell gates it. Today no allowlisted orphan is in that shape, and
the scan order that `orphan_permission()` actually iterates — `SHELLS.values()`, i.e. desktop then
tablet — is the order a future both-shells test must union across. The hazard is real but dormant; the
measurement that would wake it (any both-shells orphan whose per-shell verdicts disagree) is the one
that should fail loudly before it ever reads as "no check".

### Dated correction (2026-11-06, later the same night) — the one-hop limit is now measured, and it has names

The correction above closed with `a two-hop delegation reports 'no check'. That case is unmeasured`.
Measured: every allowlisted scoped orphan's gate was resolved with a four-hop budget, recording the
minimum hop count it needed.

| minimum hops to a gate | entries |
|---|---|
| 0 — in the command's own body | 4 |
| 1 — one `kasirmu_bridge::<mod>::<fn>` hop | 6 |
| ≥2 | **0** |
| none within four hops | 14 |

So the one-hop follow is sufficient for every entry TODAY, and the limit is now a guard rather than a
comment: `_gate_within(body, budget, lookup)` carries the depth, `orphan_permission(command,
delegations=1)` keeps the shipped behaviour, and the self-test asserts that
`orphan_permission(n) == orphan_permission(n, delegations=4)` for all 24 entries. A future entry needing
a second hop fails that case and gets a decision instead of a silent 'no check'.

**Both new cases were proven able to fail.** Setting the default budget to 0 turns the real-tree case
red and names eight entries; making `_gate_within` ignore its budget turns case 25 red. A pre-existing
guard — `gate   the real command that was misreported is now read as gated` — also fired under the
first mutation, so this pair is not the only thing between the tree and a wrong 'ungated' verdict.

**The two extra names are the first-shell-wins hazard from the BR-T1 correction, now with evidence.**
With the budget at 0 the failing list is `create_product_variant_scoped`,
`delete_product_variant_scoped`, `get_key_rotation_info_scoped`, `get_product_variant_scoped`,
`list_product_variants_scoped`, `renew_license_scoped`, `rotate_encryption_key_scoped` and
`update_product_variant_scoped`. Strip the follow and the last two come back as 'no check' even though
the TABLET body carries the gate — because `orphan_permission()` returns from the first shell that
defines the command and the desktop body is read first. Today the bridge delegation rescues them, which
masks the defect rather than fixing it: a command whose two shell bodies differ in gating, and which
does not itself delegate, would be reported as guarding nothing while the other shell gates it. Still
open, and unmeasured for commands outside this allowlist.

### Dated correction (2026-11-06, later still) — first-shell-wins is closed, and the fix is invisible to the shipped gate

`orphan_permission()` walked the shells in order and, at the FIRST definition of the command whose body
carried no gate, did `return None` — abandoning the search with the rest of the tree unread. A command
whose desktop body guards nothing and whose tablet body gates therefore read as "no check". Two
allowlisted entries are that shape: `create_product_variant_scoped` and `update_product_variant_scoped`.
The early return is gone; `None` now means the whole tree was asked, not the first file that answered.

**Why the shipped gate never showed it.** Both entries delegate from the desktop body, so the one-hop
follow reached the bridge first and returned a gate — the defect was masked, not absent. That makes the
repair invisible at the default budget, which is why the new assertion pins `delegations=0`, where the
follow cannot rescue anything:

| run | `create_product_variant_scoped` | `update_product_variant_scoped` |
|---|---|---|
| early return restored (mutation) | None | None |
| shipped code | PRODUCTS_CREATE | PRODUCTS_UPDATE |

The case prints its own measurements in its name, so a red will show those dicts rather than asking the
next reader to re-derive them. Restoring the early return by hand turns exactly that one case red and
leaves the other 28 green — the assertion is specific to this defect, not a general alarm.

**Verdicts did not move** (24 allowlisted / 24 measured / 14 redundant twins / 10 GATED DEAD SURFACE,
identical before and after), which is the expected result of repairing a masked defect rather than one
with a live symptom.

**Out of scope, still open:** this reads the several bodies of ONE command name across shells. A command
reached under a different name in the other shell (an alias or a forwarding twin) is not cross-checked at
all — unmeasured, and not implied by this fix.

### Dated correction (2026-11-06) — the scoped-coverage gate graded one shell, and the tablet had nine commands outside the rule

`scripts/verify-scoped-coverage.sh` opened by naming its subject: *every registered Tauri command in
the desktop client*. It was accurate. The subject came from `apps/desktop-tauri/src/lib.rs` and the twins
from `apps/desktop-tauri/src/commands`, with no reference to the tablet anywhere in the file — so half
the IPC surface sat outside the rule written to protect it, and the gate printed PASS the whole time.

Measured 2026-11-06 with the gate's own rule applied to `apps/mobile-tauri`: **93** registered unscoped
commands, **346** `_scoped` twins, **9** with no twin. The desktop, same rule: **106 / 404 / 0**.

| shell | registered unscoped | twins | violations under the gate's own rule |
|---|---|---|---|
| desktop | 106 | 404 | 0 |
| tablet | 93 | 346 | 9 |

The script is now parameterised (`run_shell` with its own floors and its own allowlist) and grades both
shells against the SHARED categories plus a per-shell list, so an entry justified for one shell cannot
silence the other. The nine tablet entries are categorised in the script itself: the updater triple and
`create_backup_to` are device-level, `get_build_fingerprint` / `notify_memory_pressure` touch no database,
and `list_workspaces` / `list_workspace_screens` run on a picker ticket against the global db.

**The ninth is debt, not a blessing, and the script says so.** `browser::open_product_images` reads the
ambient db with no session — the exact hazard the gate exists to catch. It is already registered as debt in
`apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs` ("no_session_resolution"), so it is
allowlisted here only so the shell can be graded at all; the entry names the ledger where closing it is
tracked, because this file's own NOTE warns that an addition silences the gate forever.

**Proof the new half can fail:** dropping `list_workspace_screens` from the tablet list turns the gate red
with `[tablet] commands::workspaces::list_workspace_screens has no _scoped variant`; restoring it returns
PASS. The desktop half is unchanged — its floors, subject and allowlist are exactly what shipped.

### Dated correction (2026-11-06) — BR-T2: the glob artefact was in a live gate, not only in a hand-off

BR-T2 recorded the non-recursive `pub async fn` count as a *pinning* hazard: 488 top-level against 500
recursive, so any lane quoting 488 is quoting a glob artefact. Both of those numbers are stale, and one
place where the artefact mattered was never a quotation at all — it was a gate reading the tree.

Re-measured 2026-11-06:

| shell | `pub async fn` top-level (`commands/*.rs`) | recursive | delta |
|---|---|---|---|
| desktop | 513 | 524 | 11 |
| tablet | 446 | 449 | 3 |

`apps/desktop-tauri/src/commands/topology/` holds **11** `pub async fn` today, not the 12 this entry
records — so BR-T2's "500 recursive / 12 topology" pair has moved in both halves. The archived plan's G6
row (`done-todo-refactor-oz-pos-app-agents-2.md:319`, "488 / 499, delta 11") lands on the same *delta* as
today's measurement by coincidence, not by still describing the tree: its two counts are 25 short of the
recursive total. A delta surviving while both sides moved is exactly why the rule here is 're-derive, never
re-quote'.

**The live consequence:** `scripts/verify-invoke-parity.py` read its subjects with
`commands_dir.glob("*.rs")` — non-recursive — and fed the result to BOTH of its classes (`token_cmds`,
`currency_cmds`). Measured by replaying the same classifier over `glob` versus `rglob`: **13 commands were
invisible** — the 10 desktop topology commands (`load_topology`, `can_save_topology`, `apply_topology_diff`,
the four template commands, the three revision commands) and, tablet-side, `complete_sale_scoped`,
`preview_promoted_total_scoped`, `preview_promoted_total_from_lines_scoped`. A caller that dropped
`sessionToken` for `load_topology` could not be flagged, because the scanner did not know the command takes
one. The sweep is now `rglob`, with a self-test case ("a command under commands/<subdir>/ is scanned") that
fails on the old glob and passes on the new one.

**What this is not:** a repair of a red gate. The gate measures **534 invokes across 58 api files, 0
violations** under both globs — the 13 commands happened to be called correctly. The change buys coverage,
not a fixed defect, and the register says so rather than implying a violation was found and closed.

### Dated correction (2026-11-06) — the raw-parameter gate graded one shell, and the tablet had two sites

`scripts/verify-no-raw-params.sh` hard-coded `target_dir="apps/desktop-tauri/src/commands"`, and its header
said so — *no Tauri command in the desktop client*. Honest, and half the surface: the tablet registers 93
unscoped commands and ADR #7's rule had never been applied to one of them. This is the second gate in two
rounds found grading a single shell; the shape is the same and so is the cause — a subject written when the
desktop was the only shell, never revisited when the tablet began registering commands.

Measured 2026-11-06 with the gate's own classifier (it skips struct fields, so the count is smaller than a
raw grep of `store_id: String` suggests):

| shell | files | parameters classified | covered by a twin | allowlisted | violations |
|---|---|---|---|---|---|
| desktop | 84 | 15 | 15 | 0 | 0 |
| tablet | 116 | 7 | 5 | 2 | 0 |

The two tablet sites are `workspaces.rs:40` (`list_workspaces`) and `:73` (`list_workspace_screens`) —
the same pair round 25 allowlisted in `verify-scoped-coverage.sh`. Their `store_id` is the PURPOSE of the
call rather than a scope shortcut: both authenticate with a picker ticket and read the global db while the
operator is still choosing a workspace, so there is no session to resolve a store from and the id names
WHICH workspace to list. They are allowlisted in both gates, and each comment points at the other so the pair
cannot be removed from one and left in the other.

**Proof the new half can fail:** dropping `list_workspaces` from `RAW_PARAM_ALLOW` turns the gate red with
`VIOLATION in apps/mobile-tauri/src/commands/workspaces.rs:40: store_id: String,` and `1 violation(s)`;
restoring it returns PASS. The falsification suite (`scripts/test-no-raw-params.sh`, which plants a probe in
the real directory) still proves both directions, and the classifier self-test is unchanged at 7 cases.

### Dated correction (2026-11-06) — the scoped-reads gap was closed, and three documents kept claiming it open

Rounds 25 and 27 found gates that graded one shell **silently**. This one is the opposite and worth
recording for that reason: `scripts/verify-scoped-reads.py` graded one shell **loudly** — it printed the
ungraded section's numbers and said the verdict covered the other one — and its documentation, plus the
operations doc, kept quoting that gap years after the tree had closed it.

Three separate stale claims, all measured today:

| where | claim | measured 2026-11-06 |
|---|---|---|
| `verify-scoped-reads.py` docstring (fourth-line paragraph) | tablet contributes **101** findings at exit 1 | `--shell tablet` → `clean for tablet`, **0** findings, exit 0 |
| `docs/operations/agent-gates.md:1892` + its `docs/src` mirror | prints **29** tablet findings | same run, **0** |
| same paragraph, bullet 1 | `--shell` defaults to desktop and "that is what `check.sh:189` and CI run" | `scripts/check.sh:224` and `dev-ci.yml:1718` run **`--shell desktop,tablet`** |

The repair that closed the gap happened between `e6d211b98` (2026-09-16) and today; nothing in this round
changed the gate's behaviour. What changed is what the three places say about it: each now carries a dated
correction that keeps the historical number, states today's measurement with the command that produced it,
and says which part of the original reasoning survives — the line stays because a gate must announce an
ungraded section rather than hide it, and that is exactly what made the closure visible.

**Why this is worth a round:** a stale finding count is not neutral. Rounds 25 and 27 both started from a
gate whose *subject* was one shell; this round started from a gate whose *documentation* said its subject was
one shell, when the wiring had already moved to two. Both directions cost a reader the same thing — a walk to
a place where the fact no longer lives.

**Verified after the edits:** `verify-scoped-reads.py --self-test` passes; desktop, tablet and
`desktop,tablet` runs each print clean; `cite lines` 227 OK / 0 drifted / 0 symbol-gone; dead refs 0 in 13
live docs; `verify-agents-mirrors.py` reports its one policed mirror agrees. Only
`docs/operations/agent-gates.md` is tracked — `docs/src/operations/` is gitignored output that
`scripts/build-docs.sh` copies from `docs/operations/` (`.gitignore:170`), so it regenerates from the
tracked correction; the untracked copy was edited as well so an existing local build shows the fix without
a rebuild. The mirror gate (`verify-agents-mirrors.py`) does not compare those two copies and this note does
not claim it does.

### Dated correction (2026-11-06) — the F-2 anchor is closed in `verify-scoped-reads.py`

The file's own F-2 note said the root came from `__file__` with nothing arguing for it, and that a
HEAD-identical copy run from a temp directory printed `clean for desktop` over **0 files walked**. Half of
that was closed earlier by `require_gradeable_corpus()` (a zero walk now refuses at exit 2); what stayed
open was the anchor itself — the refusal fired in the *wrong checkout* instead of pointing at the right one.

**The change:** `REPO = resolve_repo()`, and `resolve_repo()` asks `git rev-parse --show-toplevel` from
the directory holding the script, falling back to the script-relative parent only when git cannot answer (no
binary, no repository, non-zero exit, empty answer, timeout). Same closure `verify-agents-mirrors.py`
already takes.

| probe | before | after |
|---|---|---|
| copy at `.anchor-copy-a/scripts/` (inside this checkout) | grades `.anchor-copy-a` → 0 files → refusal | grades **669 files** of the real checkout, clean |
| copy at `%TEMP%/anchor-probe-d/scripts/` (outside any repo) | allowlist-not-found, exit 2, naming the copy's tree | unchanged — exit 2, naming the copy's tree |

**Not closed, and named rather than implied:** there is still no `--repo` flag, so a tree git cannot find
from the script's own location cannot be named; the zero-walk refusal remains what catches that. The
docstring says so at the anchor block instead of leaving a reader to discover it.

**Proof the new cases can fail:** with the git probe removed from `resolve_repo()`, case 40a reddens
(`git -> C:\dev\kasirmu\scripts; __file__-style -> C:\dev\kasirmu\scripts`) and the self-test exits
`FAIL (1)`; restoring the probe returns `self-test: PASS`. Cases 40a–40c write no files: 40a uses a path
that need not exist, 40c computes its expectation from a second git probe so it cannot flake on a box where
the probe's drive happens to be a repository.

**Verified:** desktop, tablet and `desktop,tablet` runs each clean; self-test PASS; the by-hand copy
measurements above; scratch directories removed (`git status` shows none).

### Dated correction (2026-11-06) — six gates call an empty corpus clean; one of them no longer does

Round 29 closed the `__file__` anchor in `verify-scoped-reads.py`. This round asked the same question
of every python gate `scripts/check.sh` wires, by running each one **from a temp directory holding only
a copy of the script** — a corpus that is not a repository and has no sources in it. Method: 69 wired
python steps; the scripts were copied alone, so a local import or a missing fixture is a refusal and only
the runs that come back **exit 0** are interesting.

| gate | what it printed over an empty corpus |
|---|---|
| `verify-settled-read-copies.py` | `OK -- 0 file(s) swept` |
| `check-dead-controls.py` | `0 candidate(s) with no handler` |
| `check-pipeline-verdicts.py` | `OK - no condition reads a swallower's status` |
| `check-state-closure-after-await.py` | `0 candidates in ui/src` |
| `census-orphan-modules.py` | `ORPHAN=0, LIVE=0` |
| `sabotage-selftests.py` | `0 checker(s), 0 SURVIVED` |

Nine other gates refused in their own voice (exit 2 with `BROKEN`/`not found`, exit 1 with a traceback,
or a `git` failure), which is the honest direction: a gate that cannot find its corpus should not be
able to say the corpus is clean.

**Fixed this round — `verify-settled-read-copies.py`:** two changes in one file, because it had both
halves. The root now asks `git rev-parse --show-toplevel` first with `__file__` as the fallback, and
`main()` refuses a sweep of **zero** files with exit 2 and a sentence that names the tree it swept and
the flag that would have named a different one. The floor is safe to set at one because the live tree
sweeps **1575** files.

| probe | before | after |
|---|---|---|
| copy in `%TEMP%/settled-copy-a/scripts/` | `OK -- 0 file(s) swept`, exit 0 | `error: swept ... found no .ts/.tsx source file`, exit 2 |
| copy at `.settled-copy-b/scripts/` (inside this checkout) | walks the copy's own empty parent | walks **1575** files of the real checkout |
| floor deleted, copy outside the repo | — | reproduces the old false green: `OK -- 0 file(s) swept`, and the self-test drops to 11/12 |

**Still open, with the measurement attached:** the other five gates in the table still print a clean-
looking line over an empty corpus. They are not all the same severity — `census-orphan-modules.py` and
`sabotage-selftests.py` print counts that a reader can see are zero, while `check-dead-controls.py` and
`check-pipeline-verdicts.py` print a verdict-shaped `OK`. Also still true: 52 of the 69 wired python
gates derive a root from `__file__` and only two of them ask git. Both numbers come from the same
scan; neither is graded by anything yet.

**Verified:** live run `OK -- 1575 file(s) swept`; self-test 12/12 (two new cases, both driven through
`main()`); `--root` added so the tree under test can be named; scratch copies removed
(`git status` shows none).

### Dated correction (2026-11-06) — the dead-controls gate printed defects and passed

`scripts/check-dead-controls.py` is the gate that found two real inert controls
(`TransactionLogScreen` "Details", `WorkspaceHome` "user profile"). It ended `main()` with an
unconditional `return 0`: the candidate list went to stdout, the exit code stayed 0, and the wired step
`scripts/check.sh:1218` therefore passed with a dead control on the tree. Measured by planting
`<button>Click me</button>` under `ui/src/features/`: the row appeared, exit stayed **0**. A step that
prints a defect and passes is a report wearing a gate's name — the same class as round 30's floor, in the
other half of the contract.

**Fixed, both halves in one file:**

| change | evidence |
|---|---|
| `sweep_verdict(scanned, candidates)`: 2 when nothing was read, 1 when a control is dead, 0 clean | planted probe → exit **1** with `ui/src/features/__dead_control_probe__/DeadProbe.tsx:2` |
| a corpus count, printed on every run (`317 file(s) read` today) and refused at zero | copy of the script outside the repo → exit **2**, `error: swept … and read no .tsx source file` |
| four verdict relationships added to the self-test (0 files, 0 files with candidates, 317/0, 317/1) | self-test now `9 detector cases + 4 verdict cases` |

**Proof the enforce line is load-bearing:** with `if inert: return 1` deleted, the planted probe goes back
to exit **0** while still printing the row — the pre-fix behaviour reproduced from the fix's own source.

**Kept as a limit, not hidden:** the corpus count excludes nothing, but the candidate scan still skips
`features/design/` and `DesignSystem.tsx` as measured noise (44 of the 48 hits in the round-156 sweep), and
the INERT/RESCUED split is still not automated — the summary line says so. So this gate can now fail, but it
cannot yet tell the two classes apart.

**Verified:** live run 0 candidates over 317 files, exit 0; plant → exit 1; copy → exit 2; mutation → exit 0 as
before; probe file and scratch directories removed (`git status` clean under `ui/src/features`).

### Dated correction (2026-11-06) — pipeline-verdicts called an empty sweep OK

Third gate from round 30's survey to get a verdict. `scripts/check-pipeline-verdicts.py` walked
`*.sh` under five directories and printed `OK - no condition reads a swallower's status` with exit 0
whether it had read 71 scripts or none — zero findings and zero files are the same value inside that
loop. Measured by copying the script outside the checkout, where the five directories do not exist: the
body never ran and the gate reported the tree clean.

**Fixed:** `verdict(scanned, findings)` is now the only source of the exit code (2 read nothing, 1 a
wrong-status read, 0 clean); the count is printed on every run (`71 shell script(s) read`); and a zero
sweep writes the refusal to stderr instead of the `OK` line, naming the five directories searched.

**The two guards do different work, and the mutation shows which is which:**

| mutation | result |
|---|---|
| refusal message removed only | exit **2**, but the `OK ... (0 shell script(s) read)` line is printed first — the confusing direction |
| refusal message AND the `scanned == 0` arm of `verdict()` removed | exit **0** with `OK ... (0 shell script(s) read)` — the pre-fix false green — and the self-test reddens at `verdict(0 file(s), 0 finding(s)): expected 2, got 0` |
| restored | live `OK ... (71 shell script(s) read)` exit 0; self-test 9 detector + 4 verdict cases pass |

A planted `scripts/__pipeline_probe__.sh` holding `if s=$(printf x | tail -1); then` still exits **1** with the
existing repair text, so the detection half was already load-bearing and is unchanged.

**Verified:** live run 71 files, exit 0; copy outside the repo exits 2; both mutations as tabled; probe
deleted (`git status` clean under `scripts/` apart from this edit).

### Dated correction (2026-11-06) — state-closure printed "0 candidates" for a sweep of nothing

Fourth gate from round 30's survey. `scripts/check-state-closure-after-await.py` is wired twice in
`scripts/check.sh` (:263 self-test, :264 report) and the report step deliberately omits `--strict`, so
a candidate does not fail the build — every hit needs a human to confirm the variable is the stale closure.
**That design is unchanged and is not the defect.** The defect was the other half: a sweep that read
nothing printed `0 candidates in ui/src` and exited 0, so "no stale closure found" and "no file was
opened" produced the same sentence. Measured by copying the script outside the checkout: no `ui/src`,
nothing walked, tree reported clean.

**Fixed:** `run_scan()` now returns `(findings, scanned)` and `verdict(scanned, findings, strict)` is
the only source of the exit code (2 read nothing, 1 a candidate **under --strict**, 0 otherwise); the live
count prints on the report line (`0 candidates in ui/src (730 file(s) read)`); a zero sweep refuses at
exit 2 naming the directory it walked.

| probe | result |
|---|---|---|
| copy of the script outside any checkout | before: `0 candidates in ui/src`, exit 0 — after: `error: read no .ts/.tsx file under …`, exit **2** |
| planted stale closure under `ui/src/__state_closure_probe__/` | report step: 1 candidate, exit **0** (by design); `--strict`: exit **1** |
| both guards removed, copy outside the repo | `0 candidates in ui/src (0 file(s) read)`, exit **0** — the pre-fix false green; self-test reddens at `verdict(0 file(s), 4 hit(s), strict=True) expected 2, got 1` |
| restored | `0 candidates in ui/src (730 file(s) read)`, exit 0; self-test 5 detector + 6 verdict cases pass |

**Verified:** all four rows above, probe directory removed (`git status` clean under `ui/src`).

### Dated correction (2026-11-06) — the sabotage harness reports 17 survivors, and nothing gates it

The survey tool from round 30's list turned out not to be a gate at all. `scripts/sabotage-selftests.py`
blanks a function body in each checker and asks whether that checker's `--self-test` notices. Its own
`--self-test` is wired (`scripts/check.sh:1241`); the **survey is not wired anywhere**, and
`scripts/gates.json:353` records it as *Advisory / local matrix only* with a reasoned `_note`. So the
numbers below have never failed a build.

Measured at HEAD this round: **82 checkers, 18 SURVIVED, 64 killed, exit 1.** A survivor is a checker
whose self-test stays green when its detector is gutted — the same class as rounds 29-33, one layer up.

**Closed this round — `verify-unsafe-safety.py` / `scan`.** Its self-test graded `_matches()` and
`_has_finding()` only; the function that does the `git grep`, the file read and the loop was never called,
so replacing its body with `return [], 0` changed nothing. New case (8) builds a **scratch git repository**
with one file holding an unmarked and a marked construct, calls `scan(scratch)`, and asserts one finding at
`probe.rs:2` out of two constructs seen. Proof: gut `scan` to `return [], 0` → self-test exits **1** at that
case; restore → passes. The harness itself now reports **17 SURVIVED / 65 killed**.

**Still surviving (17), unchanged this round:**

| checker | gutted function |
|---|---|
| `verify-coverage-floors.py` | `load_floors` |
| `verify-deployment.py` | `probe` |
| `verify-exhaustive-deps.py` | `run_eslint` |
| `verify-flaky-quarantine.py` | `_git_toplevel` |
| `verify-fluent-dynamic-families.py` | `bundle_files` |
| `verify-runner-commands.py` | `live_runner_files` |
| `verify-status-fallbacks.py` | `_read` |
| `verify-ui-coverage-floors.py` | `load_floors` |
| `check-chokepoints.py` | `repo_root` |
| `check-orphan-prototype-files.py` | `tracked_files` |
| `check-query-plans.py` | `probe_source` |
| `check-rust-doc-paths.py` | `tracked` |
| `verify-docker-persistence.sh` | `cleanup` |
| `verify-scoped-coverage.sh` | `run_shell` |
| `check-bundle.mjs` | `gzipBytes` |
| `check-server-origins.mjs` | `read` |
| `check-testid.mjs` | `isExcluded` |

Each needs the same treatment: a case that CALLS the gutted function over a fixture. `load_floors`,
`repo_root`, `_git_toplevel` and `_read` survive in pairs or triples, so one shared fixture helper would
close several at once — a candidate for one round of its own rather than seventeen.

**Not changed:** the survey stays unwired. Wiring it would fail most builds today (exit 1 at 17
survivors), so it is an owner decision, not a silent tightening — the `gates.json` advisory note is the
record of that choice and is left intact.

### Dated correction (2026-11-06, round 35) — two more survivors closed: the `git ls-files` wrappers

Round 34 left 17 survivors in `scripts/sabotage-selftests.py`. This round took the pair whose gutted
function is the **corpus** rather than a predicate: `tracked()` in `check-rust-doc-paths.py` and
`tracked_files()` in `check-orphan-prototype-files.py`. Both are thin `git ls-files` wrappers, and both
self-tests graded only the functions FED by them (`scan()`, `orphans()`) with hand-written file lists —
so a body replaced by `return set()` / `return []` left every case green and the checker quietly comparing
documents against an empty corpus.

**Fix, same recipe in both files:** the wrapper takes a `root` parameter, and one new case builds a
**scratch git repository** (a `.rs` plus a `.txt` in one; `prototypes/a.js` plus a file outside the tree in
the other), stages it, and asserts what comes back. `check-rust-doc-paths.py` also asserts the answer is
that root's, not this checkout's (`Cargo.toml` absent), which is what a cached or hardcoded corpus would
get wrong.

| mutation | self-test |
|---|---|
| `tracked()` → `return set()` | exit **2**: `tracked() lists the repository it is pointed at: expected {'crates/real.rs', 'notes.txt'}, got set()` |
| `tracked_files()` → `return []` | exit **2**: `tracked_files() over a scratch repository: expected ['prototypes/a.js'], got []` |
| restored | both pass: `25 cases; one scratch repository` / `5 detector cases + 1 corpus case` |

**Second fix in the orphan checker, same file:** its `main()` printed `no tracked files under prototypes/ --
nothing to check` and returned **0** — the empty-corpus pass that rounds 30-33 closed elsewhere. It now
refuses at exit 2 naming the checkout it looked in. Neither count changed on the live tree
(`1430 .rs file(s) scanned`, `0 orphan(s) among 10 deployed file(s)`).

**Harness confirms both:** rerun of `scripts/sabotage-selftests.py` → **82 checkers, 15 SURVIVED, 67 killed**
(was 17 / 65).

**Still surviving (15):**

| checker | gutted function |
|---|---|
| `verify-coverage-floors.py` | `load_floors` |
| `verify-deployment.py` | `probe` |
| `verify-exhaustive-deps.py` | `run_eslint` |
| `verify-flaky-quarantine.py` | `_git_toplevel` |
| `verify-fluent-dynamic-families.py` | `bundle_files` |
| `verify-runner-commands.py` | `live_runner_files` |
| `verify-status-fallbacks.py` | `_read` |
| `verify-ui-coverage-floors.py` | `load_floors` |
| `check-chokepoints.py` | `repo_root` |
| `check-query-plans.py` | `probe_source` |
| `verify-docker-persistence.sh` | `cleanup` |
| `verify-scoped-coverage.sh` | `run_shell` |
| `check-bundle.mjs` | `gzipBytes` |
| `check-server-origins.mjs` | `read` |
| `check-testid.mjs` | `isExcluded` |

Two of the remaining are pairs (`load_floors` in both coverage-floor checkers) and two are shell scripts,
where the mutator blanks a shell function instead of a Python one.

### Dated correction (2026-11-06, round 36) — the `load_floors` pair, and my own sweep was reading a fifth of the gate file

**Part 1 — two more survivors closed.** `load_floors()` exists in both `verify-coverage-floors.py` and
`verify-ui-coverage-floors.py`, and in both files **every** case handed `grade()` a dict literal, so the one
function that touches disk had no case at all. The sabotage sweep scored both SURVIVED: a body replaced by
`return {}` would have gated every crate against nothing and printed a clean sheet.

Fix: a case that writes a real manifest to a temp file and calls `load_floors()` on it, plus the refusal
direction — `{"floors": {}}` (py), and `{}` / `{"ui_floors": {}}` / `{"ui_floors": [1, 2]}` (ui) must
raise rather than read as "no metric is gated". Proof: gutting either body reddens 2 and 4 cases
respectively; restored, both pass. Live runs unchanged (`ui-coverage-floors: OK`, every metric above floor).
The UI self-test's own printed count was stale at "4 cases" while it ran 8 — corrected in the same edit.

**Part 2 — the sweep numbers this session has been reporting were wrong, and by a factor of two.** The
ad-hoc helper I used to run `scripts/check.sh`'s python steps matched only lines beginning with `step "` at
column 0. **76 of the 155 step calls are indented** (they sit inside `if`/`case` blocks), so every
"79 gates, 78 green" line since round 28 measured the unindented subset only. Re-measured this round with
a whitespace-tolerant parse:

| measurement | before (my helper) | true |
|---|---|---|
| python steps in `scripts/check.sh` | 79 | **155** (76 indented, 69 of them `--self-test`) |
| green | 78 | **152** |
| red | 1 | **3** — `query plan gate` (no MSVC env in a bare shell), `coverage floors` (no `coverage-probe.json`; needs the llvm-cov run the step prints), `test workspace flake receipt (junit)` (no `target/nextest/default/junit.xml`; needs the nextest run) |

A fourth step read red (`analytics tz invariance`) and was my runner's fault, not the gate's: that step runs
with `ui/` as its cwd, so `python3 ../scripts/check-tz-invariance.py` resolves there. Re-run from `ui/` it
is **exit 0** (`PASS: identical result under 5 host zones -> 429 passed, 0 failed`). None of the three true
reds was introduced by this session's commits; all three need an artifact only a full local matrix run
produces.

**Harness:** rerun of `scripts/sabotage-selftests.py` → **82 checkers, 13 SURVIVED, 69 killed** (15 → 13).

### Dated correction (2026-11-06, round 37) — `verify-docker-persistence.sh`: a survivor, and a case that had never tested anything

**The survivor.** `cleanup()` was scored SURVIVED by `scripts/sabotage-selftests.py`: no self-test case called
it. It is also the function a real run depends on to leave no containers and no volumes behind — the
failure it prevents is silent volume growth across runs, so a broken `cleanup()` costs nothing visible
until the host fills up.

**The defect found while fixing it — case 3 was vacuous, and had been since the block was written.**
`fail()` was defined 100 lines BELOW the `--self-test` block, so `( fail "planted" )` died of `command not
found` (exit 127) rather than by running `fail()`. The case accepted any non-zero exit, so it passed with
`fail()`'s body blanked. Measured on the pre-change file:

```
HEAD (pre-fix), fail() body blanked -> SELF-TEST OK (7 cases, no daemon), exit 0
fixed file,    fail() body blanked -> SELF-TEST FAILED (1 of 8 cases), exit 2
               "SELF-TEST WRONG: fail() returned instead of exiting"
```

**Fix, three parts:**

1. The verdict vocabulary (`GREEN/RED/NC`, `pass`, `fail`) and `cleanup()` moved **above** the self-test
   block, so the cases grade the real functions. Case 3 now genuinely proves that `fail()` exits.
2. New case for `cleanup()`: a shell FUNCTION named `docker` shadows the binary and records argv; the case
   sets the four name variables to probes and asserts exactly two calls — `rm -f probe-cloud-1
   probe-license-1` and `volume rm probe-cloud-vol probe-license-vol`. Blank the body → `SELF-TEST WRONG:`
   naming the empty recorder, exit 2. No daemon involved.
3. Case 4's structural guard rewritten. It asserted "the first `docker` line is below this block", which
   stopped meaning anything the moment `cleanup()`'s body (`docker rm`, `docker volume rm`) moved above it —
   a definition executes nothing. It now asserts the stronger, still-textual invariant: `--self-test` exits
   before the script's first executable statement (`cd "$(dirname "$0")/.."`) and before `trap cleanup EXIT`.

**Verified:** `bash -n` parses; self-test `8 cases` green; both mutations red; the pre-fix vacuity measured
on a copy of `HEAD:scripts/verify-docker-persistence.sh`; harness rerun → **82 checkers, 12 SURVIVED, 70
killed** (13 → 12).

**Commit attribution, corrected the same day.** The code half of this round is NOT in `278b1c934`;
that commit holds this note alone. Another session's `bdd11a725` (*chore(scripts): refresh l10n baseline
and harden verify-scoped-coverage gate*) recorded the working-tree copy of `scripts/verify-scoped-coverage.sh`
with my in-flight edit in it — checked: its diff for that path is exactly the `run_shell()` move plus the
three fixture cases, no foreign hunks, and `git status` is clean there. Two consequences worth writing down,
because neither is visible from the commit graph:

* The change is committed and correct, but the subject that carries it describes someone else's intent.
* The move was made by `fs.writeFileSync` on a file another lane was touching at the same moment (their
  commit landed 16:56; my writes were 16:33 and 16:45). If they had an uncommitted hunk in that file, my
  write replaced it and it is not in their commit. Flagged for that lane rather than assumed harmless.

Re-verified after the fact: `git show HEAD:scripts/verify-scoped-coverage.sh` contains the fixture cases
(`one temp fixture tree`), self-test `9 cases`, live gate green.

### Dated correction (2026-11-06, round 39) — `verify-status-fallbacks.py`: `_read` was the one unproven path

Every self-test case in this gate graded a string already in memory. `_read()` is the only way a file reaches
the rule, and it had no case, so the sabotage sweep scored it SURVIVED. The failure direction that matters is
not a crash: it is a silent empty string. `grade()` would then print
`status-fallbacks: OK (no default names a concrete status)` over a tree it never read — the gate reporting
clean on zero evidence.

**Fix:** three cases in `self_test()`, over a `tempfile.TemporaryDirectory` —

| case | asserts |
|---|---|
| a readable temp file | `_read()` returns the file's exact text, not `""` |
| a missing file | refuses with `SystemExit` (exit 2), does not return |
| a directory | refuses too — `IsADirectoryError` is an `OSError`, so one `except` covers both |

**Mutations measured, because a case that cannot fail is the thing this file keeps finding:**

```
_read() body -> return ""                    exit 1, 3 FAILURE(S): text, missing file, directory
report refuses but except OSError -> return ""  exit 1, 2 FAILURE(S): missing file, directory
restored                                      exit 0, 3 defects + 3 honest shapes + 3 _read cases
```

The second mutation is the realistic one: a future edit that keeps `read_text` but turns the refusal into a
fallback value. It reddens exactly the two cases that name it and leaves the text case green, which is what
distinguishes a targeted case from a blanket one.

Live: `status-fallbacks: OK (no default names a concrete status)`. Harness rerun → **82 checkers, 10 SURVIVED,
72 killed** (11 → 10).

**Sweep disclosure, same day.** `bf6cc38d7` carried this register under a two-path pathspec while it was
already dirty with another session's uncommitted section (48 added lines about which gates are wired, near
`@@ -744`). Their work is in HEAD and nothing was lost, but the subject is wrong for that hunk. §7.3 says a
path dirty with content that is not yours is a stop; I checked the status and committed anyway. The rule held;
I did not follow it. Recorded here rather than annotated onto their section, which I have not read in full.

### Dated correction (2026-11-06, round 40) — `check-testid.mjs`: the corpus predicate had no case

All twenty fixture rows call `parseSource()` with a filename the fixture already chose. `isExcluded()` is the
predicate that decides which files exist at all, and nothing graded it — the sabotage sweep scored it
SURVIVED. The two mutations fail in opposite, both silent, directions:

| mutation | self-test | meaning |
|---|---|---|
| `isExcluded` → `return false` | exit 1, 9 of 30 rows: every exclusion case | tests, e2e and dev-mock rejoin the corpus; R2 findings that are not product defects |
| `isExcluded` → `return true` | exit 1, 1 of 30 rows: the production file | the corpus empties; `runCheck([])` refuses at exit 2, so the gate stops rather than passes — but nothing had said so |
| restored | exit 0, 30/30 | live: 699 files, 469 plain + 104 brace attributes, 0 collisions, 1 live contract |

**Fix:** ten rows over the real predicate — `__tests__`, `.test.ts`, `.spec.tsx`, the three excluded
prefixes, `test-setup.ts`, a stylesheet extension, a path with no extension (all `true`), and one production
`.tsx` expecting `false`. The single negative row is deliberate: a table of only `true` expectations cannot
tell "excludes the right things" from "excludes everything", which is exactly what the second mutation shows.

Harness rerun → **82 checkers, 9 SURVIVED, 73 killed** (10 → 9).

### Dated correction (2026-11-06, round 41) — `check-bundle.mjs`: the measurement had no case

Forty odd pages of this file argue that a comparison which silently stops happening reports CLEAN. The number
every comparison is made of — `gzipBytes()` — was the one function with no case, and the sabotage sweep
scored it SURVIVED. Its dangerous mutation is not a crash: `return 0` makes every row read `0 KB / 500 KB
✔`, which is precisely the silent-zero class R2 was written against, one level lower.

| mutation | self-test | rows that caught it |
|---|---|---|
| `gzipBytes` → `return 0` | exit 2, 3 of 34 | R6a finite/positive, R6b empty≠0, R6e bigger measures bigger |
| `gzipBytes` → raw `readFileSync().length` | exit 2, 2 of 34 | R6b empty≠0, R6c 100 KB compresses far below raw |
| restored | exit 0, 34 cases | live run unchanged |

**Fix:** five cases over a scratch directory (`mkdtempSync` under `os.tmpdir()`, removed in a `finally`): a
real file measures finite and positive; an EMPTY file is not 0 bytes (gzip always carries a header); 100 KB
of one byte compresses below a tenth of its raw size; the same file measures the same twice; a larger
payload measures larger. The raw-length mutation is the one a "simplification" would actually produce — it
passes R6a and R6e and fails exactly the two cases that name compression.

The self-test footer said `no files touched`, which was true until this commit and is not any more: it now
reads `one scratch dir removed`, and the header comment says what the directory is for. Verified under both
the agent's shell and pwsh, and the scratch directory does not survive the run.

Harness rerun → **82 checkers, 8 SURVIVED, 74 killed** (9 → 8).

### Dated correction (2026-11-06, round 42) — `check-server-origins.mjs`: `read` was structurally unprovable

This one is not a missing case, it is a case that could not be written where the self-test lives. The block
runs at line 38 and exits 0; the gate reads its first file at line 63. So `--self-test` never touches
`read()`, and the sweep's gutted stub (`return undefined`) leaves it exiting 0 — SURVIVED by construction.

The failure that matters is the tolerant edit: `catch (e) { return ''; }`. Then every `check()` runs over an
empty string, `constant()` refuses with exit 2 for `server_origin.rs` (so this gate stops) — but the same edit
in a sibling checker whose parse tolerates empty input prints `ok:` over a tree it never read.

**Fix:** a child-process probe, not a refactor. `--probe-read <path>` is handled immediately after `read()` is
defined, before any other work: it calls `read()` on a path that must refuse and exits with whatever `read()`
decided. Two self-test cases assert the probe exits 2 and that stderr names the file. The self-test still reads
no checkout — the probe is this file with a flag that exits before the gate — and the recursion is one level
deep, unlike the docker gate's `--self-test` loop that re-entered the whole script.

| mutation | self-test |
|---|---|
| `read()` → `return undefined` (the sweep's stub) | exit 2: probe exits 0, stderr has no refusal |
| `catch` → `return ''` | exit 2: identical two failures |
| restored | exit 0, `8 cases: 6 predicates + 1 child probe in 2 halves` |

Live line unchanged. Harness rerun → **82 checkers, 7 SURVIVED, 75 killed** (8 → 7). Described as a probe
rather than a rewrite deliberately: moving the gate body into `main()` would have touched sixty lines of a
drift guard to grade one branch.

### Dated correction (2026-11-06, round 43) — `check-chokepoints.py`: `repo_root` decided every read, ungraded

`--self-test` builds its file dictionaries in memory, so nothing called `repo_root()`; the sweep blanked it and
the self-test still exited 0. It is the one function that decides WHERE every other read happens: `""` makes
each `_git()` run `-C ""` and the failure surfaces later as `git diff failed`, naming neither the cause nor the
missing root.

**Also fixed, unrelated to the case:** `repo_root` ran `text=True` without `encoding`, while `_git()` twelve
lines below documents at length why that is silent on Windows — a non-ASCII checkout path decodes through the
locale codec to mojibake. It now passes `encoding="utf-8", errors="replace"`, takes an optional `cwd`, and
refuses an empty `rev-parse` answer instead of returning `""`.

| mutation | self-test |
|---|---|
| `repo_root` → `return None` | exit 2, 3 rows: returned None (twice), accepted a non-repo dir |
| `repo_root` → `return ""` | exit 2, 3 rows: returned '' (twice), accepted a non-repo dir |
| drop `cwd=cwd` from the subprocess call | exit 2, 3 rows: returns this checkout's root for the scratch dir |
| restored | exit 0, 12 rule cases + 3 root cases |

**Fix:** three cases over a scratch `git init` directory in `tempfile.mkdtemp`, so the self-test still needs no
checkout: the root IS the scratch dir; a nested cwd resolves to the same parent (proves it asks git instead of
echoing cwd); a plain temp dir raises `SystemExit` (proves the refusal). The first version let `return None`
crash on `os.path.realpath(None)` and exit 1 — killed, but by a `TypeError`, not by a named row. Hardened with a
`_root_case` helper that reports a non-string answer as a failure; it now reds 3 named rows.

Harness rerun → **82 checkers, 6 SURVIVED, 76 killed** (7 → 6).

### Dated correction (2026-11-06, round 44) — `check-query-plans.py`: `probe_source` was the mild survivor

Honesty first: this is the lowest-stakes survivor fixed in this series. `main()` refuses a falsy source at
exit 2 (`probe file not found`), so the sweep's blanked stub — `return None` — would have STOPPED the gate,
not passed it. It survived because `--self-test` grades only strings built in memory and never calls the
function; the mutation is invisible to the self-test by the same construction as round 42's `read()`.

The edit that earns the cases is the tolerant one: `except Exception: return ""` would leave `main()` printing
`probe file not found` forever while the probe file sits right there — a permanently red gate whose message
accuses the wrong half.

| mutation | self-test |
|---|---|
| `probe_source` → `return None` (the sweep's stub) | exit 2: expected the file's text, got None |
| `probe_source` → `return ""` | exit 2: same row |
| refusal dropped (`return PROBE_FILE.read_text(...)`, no except) | exit 1: FileNotFoundError traceback on the missing-file case — killed by crash, not by a named row |
| restored | exit 0, 28 cases |

**Fix:** two cases repoint the module-global `PROBE_FILE` at a temp file (`global PROBE_FILE`, restored in a
`finally` even on failure — verified the live `--list` still finds the real probe afterwards): a file with
known text comes back as exactly that text, and a missing path returns `""`, pinning the contract `main()`'s
exit-2 refusal depends on. The docstring's `Pure: synthetic strings only` claim was adjusted the way round
41's footer was: the self-test now touches one temp dir and still builds and runs nothing.

Harness rerun → **82 checkers, 5 SURVIVED, 77 killed** (6 → 5).

### Dated correction (2026-11-06, round 45) — `verify-flaky-quarantine.py`: `_git_toplevel` had no case

Same shape as round 43: `--self-test` graded argv lists and two regexes, so the function feeding two of
`resolve_root()`'s four candidates was never called. Honesty about the stakes, though — this is between
round 43 (real) and round 44 (mild): in the standard layout `here.parent` still finds the root, so a blanked
stub keeps THIS checkout green. What it silently loses is the contract for every other layout — a repo the
script does not sit in, resolved via `git rev-parse` from an arbitrary cwd — and the `None` refusal
`resolve_root()` relies on to skip a candidate.

| mutation | self-test |
|---|---|
| `_git_toplevel` → `return None` (the sweep's stub) | exit 2: scratch root cases expected the repo, got None |
| drop `cwd=str(start)` from the subprocess call | exit 2: returns the process cwd (`C:/dev/kasirmu`) for the scratch dir — proves the case really checks WHICH repo, not just any answer |
| never refuses (`return Path(str(start))`) | exit 2: returns the nested cwd itself, and accepts a non-repo dir |
| restored | exit 0, 13 cases |

**Fix:** three cases over a scratch `git init` repo in `tempfile.mkdtemp` (removed in a `finally`): the root
IS the scratch dir; a nested cwd resolves to the same parent; a plain temp dir returns `None`. The docstring's
`Pure: argv lists in, no file is read or written` was adjusted before it went stale, and a dead branch the
first draft left in the helper was removed before committing.

Harness rerun → **82 checkers, 4 SURVIVED, 78 killed** (5 → 4).

### Dated correction (2026-11-06, round 46) — `verify-fluent-dynamic-families.py`: the walker was ungraded

`bundle_files()` decides WHICH files the gate reads; every self-test case graded strings and sets built in
memory, so the sweep blanked it invisibly. A blanked stub crashes `load_bundles()` with a `TypeError` — loud,
the round-44 shape — but the mutations worth pinning are the SCOPE ones, and those are quiet:

| mutation | self-test |
|---|---|
| `bundle_files` → `return []` (reads nothing) | exit 2, both rows: the walker case and `load_bundles` → `(set(), set(), 0)` |
| pattern → `"**/*.ftl"` (recursive) | exit 2, both rows: the nested `d.ftl` joins the corpus and its keys join EN |
| `bundle_files` → `return None` (the sweep's stub) | exit 1 by `TypeError` crash — killed loudly, not by a named row |
| restored | exit 0, 32 cases |

**Fix:** one scratch tree (`tempfile.mkdtemp`, removed in a `finally`) holding `a.ftl`, `z.ftl`, `z.id.ftl`, a
decoy `notes.txt`, and a `nested/d.ftl`: the walker must return exactly the three root bundles sorted (`.txt`
excluded, nested `.ftl` excluded — glob is non-recursive and that is now PINNED, so a well-meant recursive
"fix" fails by name), and `load_bundles` must union the EN files, read the ID file, and count 3. The docstring's
`No file is read or written` claim was adjusted before it went stale.

Harness rerun → **82 checkers, 3 SURVIVED, 79 killed** (4 → 3).

### Dated correction (2026-11-06, round 47) — `verify-runner-commands.py`: the runner walker was ungraded

`live_runner_files()` decides which files the gate reads; every self-test case handed text straight to
`references()`, so the sweep blanked the walker invisibly. A blanked stub crashes `dangling()` loudly; the
quiet mutations are the scope ones, and each now has a named row:

| mutation | self-test |
|---|---|
| attic skip dropped | exit 2: `retired.yml` rejoins the corpus — a retired runner's stale refs become false findings |
| plain-file branch dropped (`elif False`) | exit 2: `pre-commit` vanishes — the hook files are runners too, not just the workflow directory |
| `*.yaml` pattern dropped | exit 2: `b.yaml` vanishes silently |
| `return None` (the sweep's stub) | exit 1 by `TypeError` — killed loudly, not by name |
| restored | exit 0, 9 cases |

**Fix:** a scratch tree (`workflows/` with `a.yml`, `b.yaml`, `Attic/retired.yml` — capitalized, pinning the
case-insensitive skip — and `nested/c.yml` for recursion, plus a plain `pre-commit` file) with the module-global
`RUNNERS` repointed to it and restored in a `finally`. The docstring's `No file is created, read or written`
claim was adjusted before it went stale.

Two write-time bugs this round caught in MY OWN draft, worth recording because they are the same class the
sweep hunts: forgetting `global RUNNERS` (the assignment made the name local and the read raised
`UnboundLocalError`), and reaching for an `ok()` helper this file never defines (each file's self-test has its
own assertion style; helpers do not transfer). Both reddened immediately and were fixed before committing —
the self-test grading the walker graded itself in the process.

Harness rerun → **82 checkers, 2 SURVIVED, 80 killed** (3 → 2).

### Dated correction (2026-11-06, round 48) — `verify-exhaustive-deps.py`: `run_eslint` was ungraded

`measure()` had six thorough pure cases; `run_eslint()` — the only leg that touches the real world — was
never called by the self-test. A blanked stub crashes `main()` on the tuple unpack, but the quiet mutations
are scope ones, and each now has a named row:

| mutation | self-test |
|---|---|
| drop `cwd=UI` | exit 2: the fake linter's marker never appears — it ran in the wrong tree |
| existence guard dropped (`if False`) | exit 2: `FileNotFoundError` where the friendly SystemExit refusal is the contract |
| stderr concat dropped | exit 2: `STDERR-PING` missing from the captured output — config errors would surface empty |
| `return None` (the sweep's stub) | exit 1: `TypeError` on the tuple unpack — killed loudly, not by name |
| restored | exit 0, 10 cases (6 pure + 4 through the fake) |

**Fix:** a fake eslint in a scratch `node_modules/.bin/` (both spellings: `eslint.cmd` for nt, an executable
`eslint` sh script for the other branch — only the .cmd half is provable on this machine), which `type`s a
marker (proving WHERE it ran), pings stderr, emits one real-shaped `exhaustive-deps` finding, and exits 1.
The `UI` module global is repointed and restored in a `finally`. The real eslint is never invoked: the
self-test must not depend on `node_modules` or take as long as the gate itself. The docstring's
`no file is read, written or shelled out to` claim and the `--self-test` help text were adjusted before
they went stale.

Write-time confession: the `global UI` declaration was missed on the first run — the same Python trap
round 47 recorded for `RUNNERS`, caught immediately by the same class of check. Second occurrence of an
identical mistake in two rounds is a pattern, not an accident: every monkeypatched module global now gets
its `global` line written at the same time as the repoint.

Harness rerun → **82 checkers, 1 SURVIVED, 81 killed** (2 → 1).

### Dated correction (2026-11-06, round 49) — `verify-deployment.py`: `probe` was ungraded — and that was the LAST survivor

`classify()` had eight pure cases; `probe()` — the only leg that leaves the process — was never called.
This looked like the one survivor that might deserve a documented refusal-to-grade ("needs a live
deployment"), and that reading was wrong: every property worth grading is gradeable against a LOOPBACK
HTTP server in a daemon thread — real HTTP, real sockets, no DNS, no TLS, no external network.

| mutation | self-test |
|---|---|
| body/header dropped (`data = None`) | exit 2: `Content-Type None`, body `<unparseable>` — named, not crashed |
| HTTPError branch read as transport | exit 2: the 400 arrives as `(None, ...)` — every expected-4xx route would misreport |
| Location header dropped | exit 2: the 200 answers with `''` — and a redirect IS the answer here |
| transport branch made to raise | exit 2: `URLError` named where `(None, reason)` is the contract |
| `return None` (the sweep's stub) | exit 1: `TypeError` on the tuple unpack — killed loudly, not by name |
| restored | exit 0, 14 cases: 8 pure + 6 over loopback |

**Fix:** six cases over a scratch `http.server` on `127.0.0.1:0` (200+Location, POST JSON shape as seen
server-side, 404 through the HTTPError branch, a trailing-slash base pinning `rstrip()`, a 302 that must
not be followed, and a dead port for the transport branch), shut down in a `finally`. A first-draft dead
line (`srv.handle_one_request = None`) was removed before committing; the POST case parses defensively so
a dropped body NAMES itself instead of crashing the case.

**Milestone: the sabotage survey is fully green — 82 checkers, 0 SURVIVED, 82 killed.** Trajectory across
rounds 39–49: 11 → 10 → 9 → 8 → 7 → 6 → 5 → 4 → 3 → 2 → 1 → 0. Every checker's self-test now notices a
gutted first candidate function. This closes the SURVIVOR class of finding only: the survey blanks one
function per checker and grades the self-test's response — a self-test that grades the wrong thing
thoroughly still passes, and the ~40 bash gate steps outside the python sweep remain unpoliced by it.

Harness rerun → **82 checkers, 0 SURVIVED, 82 killed** (1 → 0).

### Dated note (2026-11-07, round 50) — `verify-scoped-reads.py`: the F-2 note's other half shipped as `--repo`

The anchor fix (`30c3282ea`) made a copy grade the tree it sits in but left no way to NAME a tree git
cannot find from the script's own location. `audit()` always owned a `repo=` seam; `main()` never passed
one. Commit `25051aa8b` exposes it: `resolve_repo_flag()` returns (tree, provenance); a named tree that is
not a directory is refused at resolution as an `EmptyCorpus` — the one handler, `error:`, exit 2, before any
verdict; `--repo` without `--allowlist` grades the named tree's OWN `scripts/ipc-parity-allowlist.json` and
the surfaces line says so; an explicit `--allowlist` still wins.

**Aiming migration.** The self-test's drive helpers no longer rebind `audit.__defaults__` — they pass
`--repo` through the real `main()`, so every fixture case now exercises the flag path itself (the rebind
trick silently graded the real checkout the moment `main()` passed `repo=` explicitly — 14 cases caught it
before the repair). `describe_unggraded()` now takes the run's repo, so the ungraded-shell line's digits
describe the same tree the verdict covers; case 39 pins stated-digits == independent-audit-digits.

| mutation | self-test |
|---|---|
| blank resolver default (`return None`) | case 41a red + unpack `TypeError` through every drive case — killed |
| drop the isdir refusal | case 41c red alone — killed |
| drop the `--repo` default-allowlist branch | case 41d red alone — killed |
| drop the ungraded-line repo threading | case 39 red (stated 0/0/0 vs truth 1) — killed |
| drop `repo=` in `main`'s audit call | attempted 3× — concurrent writer kept restoring HEAD mid-write; mutant never survived a read-back. PENDING, expected row: 41d |

The pending row is honest, not stylistic: the four proven mutations each ran ~45 s on live mutants; the
fifth could not be placed (8 retries over ~24 s, read-back verified). A quiet lane should finish it.

**Incident, recorded because it shaped the commit.** Two rounds of uncommitted work on this file were
silently reverted by a concurrent lane's buffer saves (measured 23:37 and 00:15: `git status` clean, my
patch absent, HEAD unchanged). Countermeasure: patch + self-test + commit in ONE call — `25051aa8b` landed
that way, 174 insertions, 23 deletions, self-test PASS at commit time.

Harness rerun → pending (launched this round; result lands on the round card).

### Dated correction (2026-11-07, round 50) — the M3 mutation row above blamed the wrong mechanism

The "concurrent writer kept restoring HEAD" reading of the pending M3 row was wrong on both halves. The
mutant WAS placed every time — but `String.replace` with a bare `audit(shells, repo=repo, ...)` needle hits
the FIRST occurrence in file order, which is `real_audit(...)` inside `forced()` (line 2620), not `main`'s
call — so the mutant that ran was a different, non-killing one, and the placement guard (`needle must be
gone`) could never pass while `main`'s identical call remained. Re-run with a context-anchored needle
(`cleared = audit(...)`): **killed — 14 rows red, led by case 41d.** All five --repo mutations now proven.
The two full-patch losses of 23:37/00:15 stand as measured (whole-file revert, clean status); only the M3
row's mechanism claim is corrected.

Harness rerun (round 50, foreground, quiet tree) → **82 checkers, 0 SURVIVED, 82 killed.** The six exit-1
survey jobs another lane logged 23:46–02:12 were survey-vs-survey contention (each run saw the other's
blanks), not a regression: the same commit measures green when only one survey runs.

Python gate sweep (round 50, check.sh `step` commands, 144 steps) → **143 green, 1 red.** The red is
`verify-core-size.py`: kasirmu-core non-db grew +4 production lines over the 40805 ceiling — from other
lanes' core commits (`428694f9c` et al.); the gate's input set (crates/kasirmu-core/src) is untouched by
`25051aa8b`, which touched only this script. The ceiling call belongs to whoever grew core.

### Round 51 (2026-11-07) — census: what the sabotage survey actually covers in check.sh

The round-50 note above said "~40 bash gate steps outside the python sweep remain unpoliced".
Measured now, that phrasing is wrong at the mechanism level and THIS note supersedes it:
scripts/sabotage-selftests.py globs `scripts/{verify,check}-*.{py,sh,mjs}` — bash IS surveyed —
and keeps files containing the quoted literal `"--self-test"`. The genuinely unpoliced set is
smaller, different, and nameable.

check.sh, measured: **187 `step` invocations** — python3 143, bash 19, node 17, cargo 3, sh 2,
bare `python` 1, RUSTDOCFLAGS-wrapped rustdoc 1, prose-pseudo 1 ("migration idempotency": the
quoted arg is prose, the real body is the `bash -c` that follows). Python splits 79 base / 65
`--self-test` twins.

| bucket | count | policing |
|---|---|---|
| scripts/ verify-*/check-* with a self-test | 82 | survey blanks them — 0 SURVIVED (round 50) |
| docs-auditor checkers (.agents/skills/docs-auditor/scripts/) | 11 | self-tested by explicit calls in scripts/check-auditor-selftests.sh — outside the survey glob |
| generate-*.mjs `--check` | 2 | scripts/__tests__/*.test.mjs via the node --test step |
| test-*.sh / test-*.py falsification steps | ~15 | the step IS the police: a gutted test fails the gate |
| cargo fmt / clippy / rustdoc | 3 | compiler-enforced; nothing project-authored to gut |
| migration smoke + idempotency | 2 | behavioral (run migrate; run twice) |

Named gaps — a self-test exists but its mutation is never blanked (survey glob misses them):
1. `.agents/skills/docs-auditor/scripts/check-*.py` × 11 — glob covers scripts/ only;
2. `website/scripts/verify-deploy.mjs` — glob covers scripts/ only;
3. `scripts/backup-db.sh`, `scripts/restore-db.sh` — names do not match verify-*/check-*.

Recorded, not defects:
- verify-ipc-parity.py: surveyed; its --self-test has NO dedicated check.sh step (possibly deliberate: file comments record it once cost 163–289 s); the survey still polices it locally, so this is a wiring observation, not a defect
- verify-website-assets.py: no --self-test by design (the survey docstring records why);
- the survey run itself stays advisory-only (scripts/gates.json; see the 2026-11-06 correction).

Next candidate (round 52): widen the survey enumeration to the three outside-glob sets —
expected ~+15 checkers, all must measure 0 SURVIVED; a survivor is a new register row.

### Round 52 (2026-11-07) — survey widened past scripts/; the relocation control re-baselines the whole matrix

`09584a8b3` and `a0ce023ff` land the round-51 census's next candidate, with one addition the
widening forced: a **relocation control**. The harness runs each mutated checker from a temp
copy — but a self-test that resolves paths through `__file__` fails from a copy for reasons
that have nothing to do with the mutation, and that failure scored as a KILL it did not earn.
The control now runs the UNMUTATED file through the same temp treatment first; a self-test
that cannot survive relocation gets its own verdict (RELOCATION-SENSITIVE) instead of a
borrowed one. Measured immediately: check-cite-lines.py is green in place and red from a copy —
the widened sweep would have reported a false kill without the control. `--skip` joins `--limit`
so the doubled matrix fits one tool call (measured in three chunks).

Measured state, all rows through the real code path (96 checkers enumerated, +14 outside scripts/):

| set | killed | SURVIVED | RELOCATION-SENSITIVE | NO MUTATABLE FUNCTION |
|---|---|---|---|---|
| existing 1–41 | 25 | 0 | 16 | 0 |
| existing 42–82 | 26 | 0 | 13 | 2 (docker-digests.sh, scoped-authorization.sh — known limits) |
| new 14 | 6 | 6 | 1 (check-cite-lines.py) | 1 (verify-deploy.mjs — inline body) |
| total | 57 | 6 | 30 | 3 |

**Finding 1 — six new survivors, all docs-auditor checkers.** Gutting the first candidate
function leaves each self-test green: check-api-surface.py (`registered`), check-audit-stamps.py
(`_git_ignored`), check-gate-runners.py (`repo_root`), check-nav-paths.py (`repo_root`),
check-orphans.py (`md_files`), check-site-links.py (`_display`). Same class as rounds 29–33 and
the 18 survivors of 2026-11-06; the fix pattern that worked there applies: main() delegates to
the same function the cases grade, or the cases grow until the gutted detector goes red.
Open until each is fixed and re-measured killed.

**Finding 2 — the relocation control re-baselines history.** The round-50 note above says
"82 checkers, 0 SURVIVED, 82 killed". With the control, 28 of those 82 prove UNMEASURABLE by
the temp-copy mechanism (26 RELOCATION-SENSITIVE + 2 NO MUTATABLE) — the old count scored them
as killed without evidence. This note supersedes that number: the honest state is 57 proven
kills, 30 unmeasured, 6 survivors, 3 structurally unmutatable. Nothing was gated on the old
count (the survey stays advisory per scripts/gates.json), so no gate decision changes — but
every future register row must use the new vocabulary.

**Finding 3 — the exit-0 discipline held.** Every chunk exited 0 despite 36 non-kill rows:
RELOCATION-SENSITIVE and NO MUTATABLE FUNCTION are honest "cannot measure" states, not verdicts,
and only SURVIVED reddens the survey — exactly the semantics the summary line now spells out.

Next candidate (round 53): make the mutation copy a TREE copy (scripts/ + the two outside
directories, relative layout preserved) so `__file__`-relative self-tests run true — the 30
RELOCATION-SENSITIVE rows become measurable, and the six survivors become the only red left.

### Round 53 (2026-11-07) — the staged tree measures true; twelve more false kills surface

`84439b88c` and `a822f6fe0` replace the single-file temp copy with a STAGED TREE:
the harness builds a repo-shaped temp root (every top-level entry of the real repo junctioned
in, the three gate directories — scripts/, .agents, website/ — copied for real), mutates the
checker inside the copy, and runs it there. The tracked checkout is never written; the tree
builds in 1.0 s; a staged run costs the same as an in-place run (verify-agents-mirrors.py:
22.1 s both, exit 0). `--skip`/`--limit` briefly died in the rewrite — a "--limit 32" smoke
measured all 96 — and the truncation is restored and proven (`--skip 95 --limit 1` runs
exactly restore-db.sh).

The staged tree converts 26 of the 30 RELOCATION-SENSITIVE rows into real verdicts. The full
matrix, all 96 checkers, one 500 s run:

| verdict | count |
|---|---|
| killed | 71 |
| SURVIVED | 18 |
| RELOCATION-SENSITIVE (still unmeasurable from any copy) | 4 |
| NO MUTATABLE FUNCTION | 3 |

**Finding — twelve NEW survivors.** These rows were counted as kills by every earlier
mechanism; with the control they proved to be relocation failures, and with the staged tree
they prove to be genuine: gutting the first candidate leaves each self-test green —
verify-ci-docs-drift.py (`load_gates`), verify-commit-subjects.py (`git`),
verify-dockerfile-workspace.py (`workspace_members`), verify-ftl-orphans.py (`_rel`),
verify-ps-syntax.py (`is_powershell`), verify-runner-claims.py (`live_ci_scripts`),
verify-windows-config.py (`check_tauri_configs`), verify-workflow-syntax.py (`live_workflows`),
check-debt-ledger.py (`git`), verify-updater-signature.mjs (`selfTest`), check-ui.mjs
(`dockerAvailable`), check-updater-compat.mjs (`check`). With the six docs-auditor survivors
from the round-52 note, eighteen are open. Two were re-verified through an independent route
(mutant text confirmed different, staged mutant run exit 0):

``
check-ui.mjs mutated_differs= True relo_rc= 0 mutant_rc= 0
verify-ci-docs-drift.py mutated_differs= True relo_rc= 0 mutant_rc= 0
``

The history of this number, honestly: 2026-11-05 "82 killed, 0 SURVIVED" → round 52
"57 proven, 30 unmeasured, 6 survivors" → now "71 proven, 18 survivors, 4 unmeasured".
Eleven checkers moved from killed to survived the moment the mechanism could see them; none of
those kills was ever earned. Nothing was gated on any of it (the survey stays advisory per
scripts/gates.json), but every future claim must come from the staged-tree mechanism.

The four stragglers — verify-migration-column-types.py, verify-release-workflow.py,
verify-scoped-reads.py, check-font-bundle.mjs — still fail from ANY copy; their self-tests
resolve something the staging cannot mirror. Each needs its self-test made location-independent
before the harness can grade it. Noted limit: the staging junctions are read-only by
CONVENTION, not enforcement — a self-test that writes through one writes the real tree; none
is known to.

Next candidate (round 54): start paying down the eighteen survivors with the proven pattern
from the 2026-11-06 round — main() delegates to the same function the cases grade, or the
cases grow until the gutted detector goes red — beginning with the six docs-auditor checkers,
which already have a dedicated runner to verify against.

### Round 54 (2026-11-07) — six survivors paid down; the wired police policed the fixer

`45e9044d9` closes six of the eighteen open survivors — all docs-auditor — with the pattern
the 2026-11-06 round proved: each self-test now depends on the very function the survey
guts first, graded through synthetic tempdir fixtures, never a live path, per each checker's
own design rules. check-api-surface.py grew cases for `registered`/`defined`/`documented`
(handler list, command fn, doc entries — the docstring now says so); check-audit-stamps.py
grades `_git_ignored` against a throwaway `git init` repo plus the non-repo fallback;
check-gate-runners.py and check-nav-paths.py grade their `repo_root` resolvers live;
check-orphans.py grades `md_files` walk and `--file` modes on a throwaway tree;
check-site-links.py pins the house finding format — a finding must START with
`_display(path)`. Function order untouched everywhere, so the survey's first-candidate
choice is unchanged.

**Finding — the wired police caught what the survey cannot.** The first cut of the api-surface
fixture fed `documented()` entry lines without the backticks ENTRY_RE requires; the survey
still said KILLED (it only grades `registered`), but `scripts/check-auditor-selftests.sh` —
the runner wired into the docs-auditor's own policing — went red: SELF-TEST FAILED (1 of 10).
Fixed and re-proven: runner 11/11 exit 0, staged survey over the outside-scripts set
13 killed, 1 NO MUTATABLE FUNCTION (verify-deploy.mjs, known limit), 0 SURVIVED,
0 RELOCATION-SENSITIVE, exit 0. The lesson is the same one the relocation control taught,
pointed the other way: the survey answers "does the FIRST candidate matter"; only the runner
answers "is the self-test right". Both must be green before any survivor is called closed.

Survivors open: 12 (verify-ci-docs-drift, verify-commit-subjects, verify-dockerfile-workspace,
verify-ftl-orphans, verify-ps-syntax, verify-runner-claims, verify-windows-config,
verify-workflow-syntax, check-debt-ledger, verify-updater-signature.mjs, check-ui.mjs,
check-updater-compat.mjs). Unmeasured: 4 stragglers. Next candidate (round 55): the same
fixture pattern on the nine scripts/ survivors — they share one shape (pure-core self-test,
ungraded resolver or parser), so they can go in one batch with the same two-gate proof.

### Round 55 (2026-11-07) — nine scripts/ survivors closed; the ledger reaches 3

`28a06cf04` applies the round-54 pattern to the nine scripts/ survivors, closing twelve of
the eighteen survivors across two rounds. Each self-test now grades the function the survey
guts first: load_gates (four fail-closed manifest cases), the two git() wrappers (throwaway
repos: toplevel resolution, the None-vs-empty refusal contract, failure -> empty stdout),
workspace_members (glob expansion over a throwaway workspace), _rel (both branches),
is_powershell (suffix contract, case folding, .bak exclusion), live_ci_scripts (synthetic
workflow feed via the imported _live_workflow_files), check_tauri_configs (through its own
configs parameter: perMachine flagged, currentUser clean, nsis-less skipped), and
live_workflows (the re-export pinned with a stubbed feed).

**Two binding forms.** Where the self-test never mentions the patched name before the patch
point, a plain `global X` statement works (dockerfile-workspace, debt-ledger). Where it
does — ci-docs-drift reads GATES_MANIFEST, commit-subjects reads ROOT — a trailing global
statement would not compile, so the constant is rebound through globals() and restored in
finally. A pre-edit scan of each self_test body chose the form mechanically; the survey's
relocation run proves the rebound constant does not leak.

**Two fixture lessons the direct gate caught.** verify-dockerfile-workspace: the members
regex reads quoted lines, so an inline `members = ["crates/*"]` matches nothing — the
throwaway manifest must be pretty-printed. check-debt-ledger: git stdout carries a
trailing newline, so toplevel output is stripped before the path comparison.

Two-gate proof: nine direct --self-test runs exit 0, then the full staged survey measures
86 killed, 3 SURVIVED, 4 RELOCATION-SENSITIVE, 3 NO MUTATABLE FUNCTION, exit 1. No new
survivors, no already-red rows.

Survivors open: 3, all .mjs — verify-updater-signature.mjs (selfTest), check-ui.mjs
(dockerAvailable), check-updater-compat.mjs (check). Next candidate (round 56): close the
trio with the same fixture pattern in their JS self-tests, then the 4 RELOCATION-SENSITIVE
stragglers (verify-migration-column-types.py, verify-release-workflow.py,
verify-scoped-reads.py, check-font-bundle.mjs) need location-independent self-tests.

### Round 56 (2026-11-07) — the survivor ledger reaches zero

`fe02d1972` closes the last three survivors. Round 54 took eighteen to
twelve, round 55 twelve to three, and round 56 three to zero — every closure across the
three rounds two-gate proven (direct --self-test green, then the staged survey). The trio
needed three different mechanisms, each worth recording:

1. **check-ui.mjs (dockerAvailable)** — the E2E and perf gates SKIP on their probes'
   falsy return, so a probe that stopped returning a boolean would silently skip its
   gate forever: the exact failure mode this file measured on 2026-10-23. The self-test
   now type-pins both probes (dockerAvailable, playwrightAvailable). Value stays the
   machine's business; the mutant's `return undefined` is what the type pin catches.
2. **check-updater-compat.mjs (check)** — its first function IS its assertion helper.
   Gutting it made every assertion vacuous while the run still exited 0. A census floor
   (`checksRun === 0` fails the run) converts vacuity into exit 1 — the same floor the
   register already demands of gates, applied to a harness.
3. **verify-updater-signature.mjs (selfTest)** — its only function IS its self-test.
   Gutting it cannot be caught by that self-test: the empty stub still exits 0. The
   survey now carries "selfTest" in SKIP_DEFS, so the file reports NO MUTATABLE
   FUNCTION instead of counting as a survivor. A survivor count that includes files
   with no measurable detector overstates the risk.

End state of the full staged survey: 88 killed, 0 SURVIVED, 4 RELOCATION-SENSITIVE
(verify-migration-column-types.py, verify-release-workflow.py, verify-scoped-reads.py,
check-font-bundle.mjs — self-tests that cannot run from a copy; unmeasured, not proven),
4 NO MUTATABLE FUNCTION, exit 0 — the first full-survey exit 0 of the campaign.

What remains is not survivors but blind spots: the 4 RELOCATION-SENSITIVE self-tests
need location-independence (they must run from the staged copy the survey makes) before
their detectors can be measured at all. Next candidate (round 57): the first of the four,
verify-migration-column-types.py — find which live path its self-test hardcodes and
resolve it relative to the module.

### Round 57 (2026-11-07) — the first relocation straggler is measured

`d434e419c` converts verify-migration-column-types.py from RELOCATION-SENSITIVE
(unmeasured, not proven) to KILLED: the survey now guts strip_comments and the self-test
notices from the staged copy (exit 0 -> 2). Survey end state: 89 killed, 0 SURVIVED,
3 RELOCATION-SENSITIVE, 4 NO MUTATABLE, exit 0.

The defect was an environment assumption written into a case, not into the gate. The
harness stages a repo-shaped tree WITHOUT .git by design (history and secrets never
enter the staging tree), and self-test case (8) ran the gate's --staged-only mode, whose
corpus comes from `git diff --cached`. In the copy the index is unreadable, the gate
refused exactly as its own docstring requires — and the case called that refusal a red
run. The self-test had conflated "this environment has no git index" with "the gate
misbehaved": an unknown scope is not an empty one, and the case punished the gate for
saying so.

The fix pins BOTH correct answers, keyed to where the file runs: inside a checkout the
staged count line (exit 0/1); outside one — no .git, or git absent — the exit-2 refusal
naming the unreadable index, with no count and no ok line. Both branches assert the
absence of a hollow verdict. The staged copy now exercises the refusal branch (7 CAUGHT
+ 1 CLEAN there) — more of the contract than the live tree ever exercised, which is the
point of measuring from a copy.

Two-gate proof: live --self-test exit 0; the harness's own build_temp_root staging,
self-test run from the staged path, exit 0; then the full staged survey, 89/0/3/4, exit 0.

Relocation stragglers remaining: 3 — verify-release-workflow.py, verify-scoped-reads.py,
check-font-bundle.mjs. Next candidate (round 58): verify-release-workflow.py, same
diagnosis first (which live path or git assumption reddens its self-test in the copy),
then the same two-gate proof.

### Round 58 (2026-11-07) — the pin cross-reference gets a history-less answer

`05f655759` converts verify-release-workflow.py from RELOCATION-SENSITIVE to
KILLED: the survey guts validate() and the self-test notices from the staged copy
(exit 0 -> 1, every mutation MISSED against a None verdict). Survey end state: 90 killed,
0 SURVIVED, 2 RELOCATION-SENSITIVE, 4 NO MUTATABLE, exit 0.

The relocation artifact this time: validate() cross-verifies every `uses:` pin against
pin pairs harvested from OTHER workflow files AND from git history (`git log --grep=
dependabot` over .github/workflows) — the second source exists because Dependabot bumps
can leave a SHA unique to release.yml. The harness stages a tree without .git by design,
so in the copy seven pins (signpath, artifact upload/download, attest-build-provenance,
and friends) are honestly unverifiable, the baseline reported them as findings, and the
self-test read a correct refusal-shaped baseline as a broken gate. The self-test had
made an environment claim its baseline could not keep outside a checkout.

The fix is the round-57 pattern applied to a baseline instead of a refusal: the baseline
has two correct shapes, keyed to `git rev-parse --is-inside-work-tree` from the file's
own root. In a checkout, clean or FAIL. In a history-less copy, exactly the
unverifiable-pin findings are expected — any problem of ANOTHER kind still fails — and
the mutation loop runs unchanged (all 8 mutations are git-independent and stay caught;
measured: 7 unverifiable-pin findings in the staged copy, 8/8 mutations caught there,
baseline clean with 8/8 in the checkout).

Two-gate proof: live --self-test exit 0; the harness build_temp_root staging with the
self-test run from the staged path, exit 0; then the full staged survey, 90/0/2/4, exit 0.

Relocation stragglers remaining: 2 — verify-scoped-reads.py and check-font-bundle.mjs.
Next candidate (round 59): verify-scoped-reads.py, same diagnosis first, then the same
two-gate proof.

### Round 59 (2026-11-07) — the root anchor answers in a history-less copy

`1bc2ff5ac` converts verify-scoped-reads.py from RELOCATION-SENSITIVE to
KILLED: the survey guts _git_toplevel (the file's first function) and the self-test
notices from the staged copy (exit 0 -> 1). Survey end state: 91 killed, 0 SURVIVED,
1 RELOCATION-SENSITIVE, 4 NO MUTATABLE, exit 0.

The relocation artifact was anchor_self_test case 40a: it asserts that resolve_repo()
lets git's answer beat the old script-relative rule, using a nested probe path. In a
copy with no .git both answers collapse to the same fallback and the module constant
REPO is the copy's own root, so both conjuncts failed — a correct fallback read as a
broken priority. The fix is the round-57/58 pattern applied to a priority claim: 40a
branches on whether git can answer for the probe's directory. Where it can, the original
assertion holds (live: git -> the checkout beats the scripts dir). Where it cannot, the
assertion flips to the contract that IS observable there: the fallback must equal the
script-relative rule exactly for the same nested probe.

The priority claim needed a place where git CAN answer in any world, so a new case 40d
git-inits a throwaway repo in the system tempdir and requires _git_toplevel to return
it (os.path.samefile, case-insensitive). This is also the kill: gutting _git_toplevel
-- the file's first function, measured for the first time today -- makes 40d unrun
instead of vacuously green, and the mutant exits 1 from the staged copy. The docstring's
"none of them writes a file" stays true for 40a-40c; 40d writes only inside its own
TemporaryDirectory, the pattern case 41c/41e already established.

Two-gate proof: live --self-test exit 0; the harness build_temp_root staging with the
self-test run from the staged path, exit 0 (40a fallback branch, 40d git branch, all
PASS); then the full staged survey, 91/0/1/4, exit 0.

Relocation straggler remaining: 1 — check-font-bundle.mjs. Next candidate (round 60):
the same diagnosis on its JS self-test, the last unmeasured detector in the repo.

### Round 60 (2026-11-07) — the last straggler measured; the survey is fully measured

`8d7007482` converts check-font-bundle.mjs from RELOCATION-SENSITIVE to
KILLED. Survey end state: 92 killed, 0 SURVIVED, 0 RELOCATION-SENSITIVE,
4 NO MUTATABLE, exit 0 — every detector the 96-checker survey stages is now
measured. This closes the campaign this register has tracked since round 50.

The defect was not in the checker's cases; it was in the module the checker imports.
font-freshness.mjs computed FONT_SURFACE at MODULE LOAD -- line 61 called
fontSurfaceSheets(repoRoot(HERE)) inside the array initializer -- and that function
throws when git cannot answer, by contract, because returning [] would let a
freshness check report CURRENT by measuring nothing. The contract was right and the
placement was wrong: a throw at import time makes the module unimportable anywhere
git cannot answer -- the harness staging copy, a bundled tool, a test runner cwd'd
elsewhere -- so check-font-bundle's self-test in the copy never ran at all: node
exited 1 with a stack trace from the import, before its first case.

The fix separates the loud answer from the load fact. Load records the failure:
loadDerivedSheets is null when git could not answer, FONT_SURFACE degrades to its
static entries, and surfaceCommitsSince re-derives lazily against the repo its caller
names -- restoring the narrow filter in a checkout, or firing the same loud throw
where git still cannot answer. fontSurfaceSheets itself is untouched, and its throw
contract keeps its independent pin: scripts/__tests__/font-freshness.test.mjs,
assert.throws(/git ls-files failed/), ran green after the fix (node --test, 8/8).

Two-gate proof: live check-font-bundle.mjs --self-test exit 0; the harness
build_temp_root staging running the copy's self-test, exit 0 ("SELF-TEST OK (35 rows,
no build read)"; the stderr git-fatal noise in a copy is cosmetic); then the full
staged survey, 92/0/0/4, exit 0.

Survey fully measured. Remaining honest gaps: the 4 NO MUTATABLE checkers (no
mutable function to gut -- verify-deploy.mjs, verify-docker-digests.sh,
verify-scoped-authorization.sh, verify-updater-signature.mjs) and whatever new
checkers land unmeasured next. Next candidate (round 61+): re-run the survey against
new arrivals, and consider hardening the harness itself (e.g. asserting staged
junction read-only-ness).

### Round 61 (2026-11-07) — the NO MUTATABLE set is now three; a fourth straggler appears

`f53e7f0a8` converts verify-updater-signature.mjs from NO MUTATABLE to
KILLED: the verification decision that lived inline in main() -- parse the base64
minisign pubkey, verify the installer bytes against the manifest signature -- is now
an exported function, verifyUpdaterSignature, that BOTH the live path and the
self-test drive. Gutting it leaves ok !== true, so the live path fails CLOSED
(release blocked) and the self-test fails loudly (exit 1): the survey's mutant
exits 0 -> 1. The self-test also pins the throw contract (an unparseable pubkey
must throw, not return false) and the tamper rejection through the same wrapper.
The live usage/bad-manifest exits (2/1) are unchanged. Survey end state: 92 killed,
0 SURVIVED, 1 RELOCATION-SENSITIVE, 3 NO MUTATABLE, exit 0.

NEW STRAGGLER, found by the survey mid-session: check-updater-compat.mjs flipped to
RELOCATION-SENSITIVE between the round-60 survey (06:08, KILLED) and this round's
(--:--), with NO commit in between and its file unchanged since fe02d1972. Mechanism,
diagnosed: its self-test shells out to `cargo build --release` of a Rust harness
(line 144), the staging strips target/ so every staged run re-links, and rust-lld
could not open kernel32.lib -- the MSVC link environment was present for the first
survey of the morning and absent for the second, an environment claim a staging copy
cannot always keep. The live self-test stayed green throughout. Round 62 candidate:
make the harness-build probe honest under a dead toolchain (printed skip, census
floor still meaningful), the same observable-branch pattern as rounds 57-61.

Honest limits this round: the error message for an unparseable pubkey merged from
"Failed to parse updater pubkey:" into "Failed to verify updater signature:" (the
underlying parse error text still names the cause); the root cause of the mid-session
link-env loss is not pinned -- only its mechanism and reproducibility are recorded.

### Round 62 (2026-11-07) — a relocation verdict that was never the checker's fault; the survey is fully measured again, 93/0/0/3

`d8b5003f` gives check-updater-compat.mjs a real --self-test mode: the phases that
need no Rust (generate-latest-json round-trip, Node-verifier agreement, keyid match,
committed pubkey parse, both child self-tests) are ALWAYS graded — the census floor stays
meaningful — while the Rust-harness phases attempt the build and, when the toolchain
cannot answer, PRINT the skip and name the bare run as their grader (it still refuses
with exit 2). Proven in both shapes: healthy toolchain -> 10 checks, full run incl.
harness; simulated dead linker (bogus RUSTC_WRAPPER) -> 7-check subset, exit 0, skips
printed; bare run under the same simulation -> FATAL exit 2, refusal kept. The staged
control in the genuinely broken-for-fresh-compiles linker environment now exits 0 —
the exact condition that produced exit 2 under the old code.

`184d306f` is the deeper finding: THE SURVEY NEVER RESTORED A CHECKER'S STAGED
BYTES AFTER ITS MUTANT RUN. The relocation verdict on check-updater-compat was produced
by the harness itself: verify-updater-signature.mjs runs earlier (verify-*.mjs before
check-*.mjs), its gutted mutant stayed in the shared staged tree, and check-updater-compat's
control then spawned the still-gutted file and failed with "verifyUpdaterSignature
rejected a valid signature" — cross-checker contamination, not relocation. This also
CORRECTS round 61's finding: the mid-morning "flip" was this poison (present only once
round 61 made verify-updater-signature mutable — in round 60 it was NO MUTATABLE, so no
mutant, no poison), not the cargo link environment; the linker failure is real for fresh
staged compiles (serde_core/libc build scripts) but now degrades to the printed skip.
Fix: the survey restores the original bytes after every mutant run; the harness self-test
stays green; the full survey reads 93 killed, 0 SURVIVED, 0 RELOCATION-SENSITIVE,
3 NO MUTATABLE, exit 0 — every mutable checker measured from a staged copy.

Honest limits: the dead-toolchain shape was proven by simulation (a bogus RUSTC_WRAPPER),
not by waiting for a live dead environment; the linker env's true state machine
(healthy live builds vs failing fresh compiles in the same minutes) is still not
root-caused. Remaining unmeasured: verify-deploy.mjs, verify-docker-digests.sh,
verify-scoped-authorization.sh (NO MUTATABLE).

### Round 63 (2026-11-07) — the mutator was blind, not the checker: a JS-aware stripper makes verify-deploy.mjs measurable, 94/0/0/2

verify-deploy.mjs carried a real --self-test all along (28 fixture cases driving the
exported routePatterns/originsFor/planOrigins/verdict/... and the real main() with fs
and fetch stubbed) — its NO MUTATABLE verdict was the mutator failing to SEE the
functions, the same class as round 56's export-regex miss. Mechanism, diagnosed:
strip_comments_and_strings had no notion of JS regex literals; the route extraction
regex /"([^"]+)"/g in routePatterns was read as a string opening at its first double
quote, and the phantom string then swallowed source until the next double quote
ANYWHERE in the file — balanced function braces included — so braces_span never
balanced and every candidate in the file was dropped.

`810959a8` adds _strip_js (used when text_functions runs with js=True): a mode-stack
stripper for .mjs covering line/block comments, quoted strings, backtick templates
with nested ${...} interpolation, and regex literals with [...] class handling. A
regex may start only after ( = , : [ ! & | ? { ; < or a value-yielding keyword — never
directly after an identifier or a close paren, which is division. The .sh path is
byte-identical (default js=False). The harness self-test earned five new cases — and
they EARNED their keep twice in the writing: a garbled template fixture (a stray
backtick re-opening a template that swallows the function close) failed the self-test
before it could lie, and the fixture rewrite then exposed a real stripper defect: the
interpolation's closing } passed through unblanked in code mode, so braces_span took
it for the function's close (close - open = 1 < 2 -> candidate dropped). Interpolation
braces are template machinery and are now blanked like their ${ opener.

Proof: harness --self-test 15 cases, exit 0; text_functions on the live file finds 8
candidates, routePatterns first; full survey 94 killed, 0 SURVIVED, 0
RELOCATION-SENSITIVE, 2 NO MUTATABLE, exit 0 — verify-deploy.mjs routePatterns KILLED
0 -> 2 (gutting it makes the self-test's very first case throw), and no other .mjs row
changed either its verdict or its mutated function.

Honest limits: the regex-start heuristic is a counter, not a parser — division directly
after ( = , : [ etc. is impossible in JS, but exotic shapes (`a++ / 2` is handled by
excluding +/- from the preceders; others may not be) could still misclassify, and the
fail-safe direction is relied on and recorded: a misclassification can only DROP
candidates (NO MUTATABLE), never produce a false KILLED. The stripper is graded only by
the harness's synthetic fixtures. Remaining unmeasured: verify-docker-digests.sh,
verify-scoped-authorization.sh.

### Round 64 (2026-11-07) — the digest gate's self-test graded a COPY of its decision; pin_verdict() makes it grade the live one, 95/0/0/1

verify-docker-digests.sh was NO MUTATABLE because none of its functions are visible to
the shell extraction: self_test is skip-listed, and n_pins/chk are defined INDENTED
inside it (SH_FUNC anchors on column 0) and n_pins is a one-liner besides. The real
gap the row was pointing at: the live drift decision — pinned vs currently-resolved
digest — lived INLINE in the scan loop (lines 144-150), and the self-test's two
comparison cases graded an inline COPY of it (`[ "$a" = "$b" ] && echo same || echo diff`),
breaking the file's own stated principle (line 50-51: "named once so the self-test
grades the SAME regex the live scan uses").

`3486b4e84` extracts pin_verdict() as a top-level function wired into BOTH
paths: the scan loop now decides with `[ "$(pin_verdict "$pinned" "$current")" = "same" ]` and
the self-test's two comparison cases call pin_verdict directly. Gutting it (staged,
via the survey's own blank_text_body + run_self_test machinery) makes both comparison
cases fail -> exit 2; the bare live run under the same gutting would report drift on
every pin — the fail-closed direction. Pre-gates before the survey: live --self-test
8 cases exit 0; text_functions finds exactly one candidate (pin_verdict, lines 58-65);
staged mutant probe KILLED exit 2.

Two process notes recorded honestly: (1) the first wiring said "drift" where the
gate's case vocabulary says "diff" — the live gate caught it (1 of 8 cases FAIL)
before any survey ran, which is the gate working; (2) a mutant probe written with a
BARE `bash` died at exit 127 — the WSL trap the harness's run_self_test comment already
documents (Git's bash by full path, MSYS path conversion); re-running the probe through
sab.run_self_test itself removed the divergence between probe and survey.

Proof: full survey 95 killed, 0 SURVIVED, 0 RELOCATION-SENSITIVE, 1 NO MUTATABLE,
exit 0 — verify-docker-digests.sh pin_verdict KILLED 0 -> 2, no other row changed.

Honest limits: the unresolvable-pin branch stays in the scan loop (it needs per-file
drift bookkeeping) and is NOT fixture-graded — it is graded only by its fail-closed
exit direction; the script remains a manual gate that nothing schedules (its own
header, measured 2026-09-16, still stands). Remaining unmeasured:
verify-scoped-authorization.sh.

### Round 65 (2026-11-07) — the last NO MUTATABLE row falls: the survey is fully measured, 96/0/0/0

verify-scoped-authorization.sh was NO MUTATABLE for structural reasons: its whole
classifier lives in an awk heredoc ($AWK_PROG), self_test is skip-listed, and run_case
is indented (SH_FUNC anchors on column 0) — so no bash function existed for the mutator
to reach, even though the self-test was already strong (it drives the EXACT $AWK_PROG
text the live scan runs, over synthetic Rust fixtures, both directions, plus a
scanned-floor refusal case).

`` extracts run_classifier() as the classifier's single invocation site: the live scan
(line 241) and every self-test case now call the same top-level wrapper, which carries
PERM/STORE/LISTED and appends the caller's -v arguments before $AWK_PROG. The kill is
doubled: gutting it makes all seven cases fail (empty output != expected UNREASONED
count) -> exit 2, AND a bare live run of the same mutant refuses at the pre-existing
`self_test || { echo "CLASSIFIER WENT DEAF..."; exit 2; }` guard before ever scanning — the
live path fails closed too, not just the graded one. Two dead vestiges in the exact
edited lines went with it: a no-op `if ... then : ; fi` block that ran the awk twice for
nothing, and `-v FLOOR=0` — a variable the awk program has NEVER read (the floor is
hardcoded at 150), propping up a false comment claiming the SRC label disables the
floor. The truth, now written there: cases parse the UNREASONED line, so the floor
firing under them is harmless, and the floor itself is case 7.

Pre-gates before the survey: live --self-test 7 cases exit 0; text_functions finds
exactly one candidate (run_classifier, lines 144-146); staged gutted mutant via
sab.run_self_test -> exit 2, KILLED. Proof: full survey 96 killed, 0 SURVIVED,
0 RELOCATION-SENSITIVE, 0 NO MUTATABLE FUNCTION, exit 0 — every one of the 96 checkers
in the sabotage survey is now measured from a staged copy, and no row changed this
round except the target.

Milestone context (this register, rounds 50-65): the survey opened with 18 SURVIVED;
round 56 drove survivors to zero but left 18 unmeasured (relocation or NO MUTATABLE);
rounds 57-63 cleared relocation 4 -> 0 (ending in the r62 discovery that the survey
itself poisoned a control by never restoring staged bytes); rounds 63-65 cleared
NO MUTATABLE 3 -> 0 (r63: the mutator's JS stripper was blind to regex/template
literals; r64: the digest gate's self-test graded a COPY of its decision; r65: this
extraction).

Honest limits: the mutator only reaches BASH functions — the awk program inside the
heredoc (classify(), the 150-hardcoded floor) is graded by the self-test's fixtures
but is outside the survey's gutting reach; a change to the PERM regex or the floor
constant would redden the self-test yet would never be probed by the survey. The
--strict mode remains wired nowhere (report mode is the default by design until the
unreasoned count reaches zero — the header's own words). The survey being fully
measured is a state, not a finish line: new checkers must arrive measured, and the
harness's own blind spots (r62 restore, r63 stripper) were found by running it.
