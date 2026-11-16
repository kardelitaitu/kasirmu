# Weekly Development Plan — kasir.mu `0.0.41` (Pre-Beta Freeze & Verification)

> Generated: 2026-11-14. Branch locked at `0.0.41`. Never create or switch branches.
> v0.0.41 Code & Scope Freeze is active (declared 2026-11-13 in `docs/operations/freeze-declaration-0.0.41.md`).
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## Week of 2026-12-08 → 2026-12-14 · Pre-Beta Pilot Onboarding Dry Run & VIP Protocol Activation

### Status entering this week

| Area | Status |
|---|---|
| Release Milestone | `v0.0.41` pre-beta stabilization; code freeze active (`fa5927e98`) |
| CI on `main` / dev-ci | ✅ All gates pass (`check:all` 9 passed, 1 skipped). Northflank deploy blocked on token rotation. |
| Reliability Ladder Campaign | ✅ 100% contracted (70 of 70 gate checkers with full ladder contract) |
| Register Hygiene | ✅ 249 consecutive rounds (51–299) with honest-limits markers (`check-register-hygiene.py`) |
| Active Plans | `docs/plans/_active/website_carousel.md` (waiting for 5x10s video clips), `notes.md` |
| Security & Invariants | 5 core invariants active (0 new schema migrations, Money `i64`, transaction writes, IPC parity, ladder contracts) |

---

## Day 1 · Mon 12-08 · End-to-End Pilot Merchant First-Run Provisioning Simulation

> Simulates complete pilot onboarding sequence on desktop and tablet shells without network access.

- [x] Run pilot merchant provisioning simulation suites — **DONE 2026-11-16**:
  - `kasirmu-bridge`: 9 setup tests pass (`pilot_merchant_first_run_provisioning_simulation_end_to_end`, `a_provisioning_row_is_what_makes_a_terminal_provisioned`, `the_gate_is_keyed_per_terminal`).
  ```bash
  cargo test -p kasirmu-bridge setup
  ```
- [x] Verify first-run store configuration, tax presets (PPN 11% + service 5%), currency lock (IDR), sample product seeding, and initial shift float.

---

## Day 2 · Tue 12-09 · Thermal Receipt 58mm/80mm Formatting & ESC/POS Protocol Conformity

> Tests ESC/POS thermal receipt formatting, narrow vs standard width layout, and base62 receipt code generators.

- [x] Run receipt formatting and layout verification suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 40 unit tests + 11 integration tests pass (`base62_parsing_and_roundtrip`, `scoped_row_overrides_the_legacy_key_for_the_same_concern`, `receipt_paper_width_default_standard`, `receipt_paper_width_narrow`).
  - `kasirmu-bridge`: 21 receipt format tests pass (`print_sales_receipt_args_deserialise`, `layout_write_scopes_to_the_store_location_and_readback_agrees`).
  ```bash
  cargo test -p kasirmu-core receipt
  cargo test -p kasirmu-bridge receipt
  ```
- [x] Assert layout width validation rejects nonsense widths and derives entity tax regime.

---

## Day 3 · Wed 12-10 · Split Tender & Payment Gateway Resiliency

> Validates multi-split payments, payment idempotency keys, over/underpayment boundaries, and EDC loopbacks.

- [x] Run payment processing and split tender suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 99 unit tests + 16 integration tests pass (`complete_sale_deduction_with_payment_splits`, `find_sale_by_idempotency_key_resolves_every_split_of_one_attempt_to_one_sale`, `multi_payment_split_persists_all_records`).
  - `kasirmu-bridge`: 13 payment bridge tests pass (`loopback_terminal_dynamic_sync_and_payment_simulation`, `payment_gateway_bridge_roundtrip`).
  ```bash
  cargo test -p kasirmu-core payment
  cargo test -p kasirmu-bridge payment
  ```
- [x] Confirm that stock deductions and audit rows are committed atomically per split.

---

## Day 4 · Thu 12-11 · High-Throughput Restaurant Table Management & Course Firing

> Validates dining zone segregation, table status state machines, and line coursing persistence.

- [x] Run table management and coursing verification suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 113 unit tests + 5 integration tests pass (`assign_and_release`, `occupy_with_active_sale_allowed`, `create_table_nan_geometry_rejected`, `kds_fanout_stamps_table_number_from_assigned_table`).
  - `kasirmu-bridge`: 30 table bridge tests pass (`owner_can_create_table`, `owner_can_update_table_status`, `list_tables_scoped_filter_by_section`).
  ```bash
  cargo test -p kasirmu-core table
  cargo test -p kasirmu-bridge table
  ```
- [x] Confirm table occupancy locks prevent concurrent collisions across dining rooms.

---

## Day 5 · Fri 12-12 · KDS Kitchen Routing & Low-Latency Dispatch

> Validates kitchen ticket fan-out, station claim routing, and course-aware item status tracking.

- [x] Run KDS kitchen routing and ticket management suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 182 unit tests + 1 integration test pass (`complete_sale_to_kds_fanout_targets_one_order_to_multiple_instances`, `routing_station_claim_sends_each_line_to_its_zone_device`, `ack_order_first_device_wins`).
  - `kasirmu-bridge`: 56 KDS bridge tests pass (`resolve_with_rule_splits_cocktail_line_to_bar_device`, `scoped_line_item_status_update_and_read_end_to_end`).
  ```bash
  cargo test -p kasirmu-core kds
  cargo test -p kasirmu-bridge kds
  ```
- [x] Verify multi-zone items route accurately to designated kitchen stations (e.g. Bar vs Hot Kitchen).

---

## Day 6 · Sat 12-13 · Multi-Device Roster & Strict Role-Based Access Control (RBAC)

> Validates staff PIN authentication, exponential lockout backoff, and granular permission gates.

- [x] Run staff roster and RBAC authorization suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 98 unit tests + 25 integration tests pass (`gate_denies_permission_not_granted_to_role`, `login_backoff_doubles_per_strike`, `record_login_attempt_locks_after_max`, `soft_delete_hides_the_member_from_the_roster_and_from_login`).
  - `kasirmu-bridge`: 75 auth tests pass (`staff_login_mints_verifiable_picker_ticket`, `staff_login_returns_granted_permission_keys`, `both_timing_mask_copies_degrade_to_a_non_constant_seed`).
  ```bash
  cargo test -p kasirmu-core staff
  cargo test -p kasirmu-bridge auth
  ```
- [x] Assert timing-safe PIN comparison and automatic account lockout after 5 consecutive strikes.

---

## Day 7 · Sun 12-14 · Freeze-Period Code Freeze Audit & Pre-Beta Gate Certification

> Concludes sprint with full application shell check, query plan validation, and static gate certification.

- [x] Compile application shells & verify static gates — **DONE 2026-11-16**:
  - `cargo check -p kasirmu-app -p kasirmu-mobile` → 0 errors.
  - `python scripts/check-query-plans.py --check` → 27 probed queries, none reading LARGE tables in full.
  - `python scripts/verify-doc-uniqueness.py` → 0 duplicate authoritative documents.
  - `python scripts/check-register-hygiene.py` → 249 round-log entries (51–299) consecutive with honest limits.
  - `python scripts/census-checker-contracts.py` → 70 of 70 contracted.
  ```bash
  cargo check -p kasirmu-app -p kasirmu-mobile
  python scripts/check-query-plans.py --check
  python scripts/verify-doc-uniqueness.py
  python scripts/check-register-hygiene.py
  python scripts/census-checker-contracts.py
  ```
- [x] Re-affirm zero P0–P2 open defects and freeze adherence.

---

## Completed — Week of 2026-12-01 → 2026-12-07 (Pre-Beta Release Candidate Freeze & Zero-Defect Burn-down)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Cryptographic Audit Hash Chains & At-Rest Key Lifecycle Verification — ✅ 2026-11-16
- `kasirmu-core` (139 unit + 17 integration tests) and `kasirmu-crypto` (42 unit + 1 integration tests) pass (`audit_chain_verification_detects_field_tampering`, `corrupted_ciphertext_fails`, `domain_separation`).

### Day 2 · Multi-Tenant Isolation & Zero Cross-Store Leakage Partitioning — ✅ 2026-11-16
- `kasirmu-core` (67 unit + 4 integration tests) and `kasirmu-bridge` (8 tests) pass (`check_tenant_integrity_rejects_foreign_user`, `tenant_isolation`, `cross_tenant_revision_is_rejected`).

### Day 3 · Hardware Abstraction Layer (HAL) Driver Loopbacks & Peripherals — ✅ 2026-11-16
- `kasirmu-hal` (435 unit + 21 mock integration + 1 TCP reconnect + 6 custom scanner tests) and `kasirmu-bridge` (45 hardware tests) pass (`print_receipt_reconnects_after_connection_drop`, `mock_integration`).

### Day 4 · Offline Sync Outbox Pruning & Storage Quota Health Monitoring — ✅ 2026-11-16
- `kasirmu-bridge` offline queue tests (10 passed) and `get_storage_health` contract verified on both desktop and mobile shells (`api-system-contract.test.ts`, `StorageBanner.tsx`).

### Day 5 · Master Architecture Boundaries & API Parity Enforcement — ✅ 2026-11-16
- Master architecture boundaries (0 violations across 41 crates and 626 UI files), IPC parity (510 desktop / 437 tablet commands), core size (40,900 / 40,900), and contract census (70/70) verified.

### Day 6 · Release Package Integrity & Authenticode / Minisign Crypto Rehearsal — ✅ 2026-11-16
- Minisign Ed25519 updater self-test, Windows NSIS manifests (`verify-windows-config.py`), release workflow (`verify-release-workflow.py`), and release version gate (`check-release-version.mjs v0.0.41`) all pass.

### Day 7 · Pre-Beta RC Acceptance Sign-off & Application Shell Baseline — ✅ 2026-11-16
- Application shells compile cleanly (`cargo check -p kasirmu-app -p kasirmu-mobile`), UI lint and typecheck clean, gzip bundle budgets satisfied, and query plans probe clean (27 probed queries).

</details>

---

## Completed — Week of 2026-11-24 → 2026-11-30 (Pre-Beta Operational Resilience & Stress Hardening)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Multi-Terminal Peer-to-Peer LAN Synchronization & CRDT Convergence — ✅ 2026-11-14
- 89 unit tests, 3 integration suites in `crates/kasirmu-lan` pass (`tests/crdt_replication_tests.rs`, `tests/distributed_lease_tests.rs`, `tests/reconnect_snapshot_tests.rs`).

### Day 2 · Dirty Shutdown & SQLite WAL Recovery Simulation — ✅ 2026-11-14
- `python scripts/test-wal-dirty-shutdown.py` passes 5/5 brutal terminations mid-transaction with zero corruption, `PRAGMA integrity_check: OK`.

### Day 3 · High-Volume Shift Stress Simulation (200+ Rapid Transactions) — ✅ 2026-11-14
- Multi-transaction offline durability suites pass: 200 consecutive offline sales durability and full pilot dry run (50 sales onboarding to sync).

### Day 4 · Touch Target Accessibility & Modal Keyboard Traps Audit — ✅ 2026-11-14
- `touchTargetSizing.test.tsx` (9 tests pass) verifying `--touch-target-min: 44px` (48px coarse) across all button, keypad, and modal selectors.

### Day 5 · Static Gate Integrity & Register Hygiene Sweep — ✅ 2026-11-14
- Register hygiene (249 rounds clean), debt ledger (165 closed), quarantine manifest (0 entries), and 70/70 checker contracts verified.

### Day 6 · Diagnostic Export Packaging & Error Trace Sanitization — ✅ 2026-11-14
- `cargo test -p kasirmu-bridge diagnostics` (10 passed) verifying path traversal rejection, redaction of JWT/secrets, and PII sanitization.

### Day 7 · Beta Candidate Full Acceptance Dry Run — ✅ 2026-11-14
- `cargo check -p kasirmu-app -p kasirmu-mobile` (0 errors), UI lint/typecheck clean, and beta roadmap reconciled in `todo-beta-testing-january-2027.md`.

</details>

---

## Completed — Week of 2026-11-17 → 2026-11-23 (Pre-Beta Stabilization & Verification)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Release Artifact Build & SHA-256 Digest Verification — ✅ 2026-11-13
- Produced desktop NSIS installer (`target/release/bundle/nsis/kasir.mu_0.0.41_x64-setup.exe`, SHA-256 `d76551c22369ff453f4395d657d2c60f0505fa340f1e865545ac1e6ef32141fb`) and MSI installer (`target/release/bundle/msi/kasir.mu_0.0.41_x64_en-US.msi`, SHA-256 `6f9ca442af9839775841129bc5e2a2388ecbe406f6cd36c7ef740008424d38af`).
- Verified release configuration and workflow gates (`check-release-version.mjs`, `verify-windows-config.py`, `verify-release-workflow.py`).

### Day 2 · Pilot Merchant First-Run Provisioning Simulation — ✅ 2026-11-13
- Authored and verified `pilot_merchant_first_run_provisioning_simulation_end_to_end` in `setup_tests.rs`.
- Walked 5-step onboarding, tax presets (PPN 11% + service 5%), thermal ESC/POS formatting, multi-tender split checkout (Cash + QRIS 0% MDR), and Z-report zero discrepancy. Committed `52a294c8f`.

### Day 3 · Tab Leases & Multi-Terminal Concurrency Stress Testing — ✅ 2026-11-13
- Verified optimistic tab lease broadcast (`tabs:changed`), table merge flow (`tables-merge-confirm-btn`), and 60-second lease expiration timeout across `kasirmu-lan` and UI suites. Committed `0935eed6d`.

### Day 4 · Hardware Fault Injection & Printer Offline Fallback — ✅ 2026-11-13
- Verified printer disconnection handling mid-checkout, cash drawer kick fallback when auto-kick pulse is unacknowledged, barcode scanner keystroke buffer, and driver error containment. Committed `2746c5c91`.

### Day 5 · Quarantine Audit & Static Gate Health Sweep — ✅ 2026-11-13
- Verified quarantine manifest (0 entries), AGENTS mirrors, IPC parity, and contract ladders (70/70).
- Hardened `check-ui.mjs`, `run-e2e.mjs`, and `docker-compose.e2e.yml` against port collisions and WSL path resolution. Committed `3b1846a1e`.

### Day 6 · Documentation Portal Synchronization & Runbook Audit — ✅ 2026-11-13
- Regenerated SUMMARY.md (21 guides, 86 ADRs, 10 releases, 14 ops), built full mdBook HTML book at `docs/book` with 0 dead links.
- Verified doc uniqueness, rust doc paths, and CI drift. Cross-checked `upgrade-and-rollback-procedure.md` with `freeze-declaration-0.0.41.md`. Committed `2d3a865b9`.

### Day 7 · Weekly Bug Triage & Beta Readiness Review — ✅ 2026-11-13
- Triaged issue backlog against `.github/ISSUE_TEMPLATE/bug_report.md` (0 open P0–P2 bugs).
- Audited operational carry-forward blockers (Northflank token, hero carousel video assets, PG-gated receipt tests). Committed `2d3a865b9`.

</details>

---

## Blocked / Carry-Forward

| Item | Blocker | Owner |
|---|---|---|
| Hero carousel video assets | Owner must supply 5 × 10 s clips (`website_carousel.md` §6) | Product / Media |
| Northflank API token (HTTP 401) | Owner must refresh secret in Northflank console & GitHub secrets | Infrastructure |
| PostgreSQL-gated receipts (§1.1) | Requires Docker Desktop daemon running on host (`localhost:15432`) | Platform / DevOps |
| Android physical tablet timings (§3.1) | Requires wireless ADB connection to physical device (`23073RPBFG`) | QA / Hardware |
| MIDTRANS sandbox credential (R6) | Owner declined; wiremock offline tests run cleanly | Product |
| Physical EDC terminal model (R7) | Owner "none yet"; loopback simulator is active implementation | Hardware |

---

## Completed — Week of 2026-11-10 → 2026-11-16 (Sprint 0.0.41 Milestone)

<details>
<summary>14 completed items — click to expand</summary>

### 1. Hardware Permission Gap (BRIDGE-7) — ✅ 2026-11-10
- Gated `print_kasbon_settlement_slip_scoped` on `permissions::RECEIVABLES_VIEW`.
- Verified 10 other hardware commands session-auth sufficiency; 45/45 bridge tests pass. Committed `d46119269`.

### 2. Course Firing Architecture (ADR-68) — ✅ 2026-11-13
- Adopted Option 1 (Cart-Level State Persistence). Added `coursing_status` to `CartLine` in foundation.
- Persisted line coursing in mobile/desktop Tauri commands and POS UI. 610/610 foundation tests pass.

### 3. Analytics Cards Visual Backlog (`notes.md`) — ✅ 2026-11-11
- Audited and resolved analytics cards issues in live Chromium: portaled menu tokens, KPI tiles wrap, 7 chart option guards, low-stock layout. Committed `e2d536346`.

### 4. SEA Market Tax Tables (ADR-59 Phase 2) — ✅ 2026-11-10
- Added statutory rate tables in basis points for 6 SEA markets (ID, SG, MY, TH, PH, VN) in `regional.rs`. 58/58 tests pass. Committed `67d563c04`.

### 5. Plans Folder Housekeeping — ✅ 2026-11-11
- Archived `owner-question-2026-09-28-r4-r6-r7.md` to `_done/`. Committed `00ca02d43`.

### 6. Core-Size Ratchet Ladder (Round 277) — ✅ 2026-11-11
- Added 7-rung shell ladder to `verify-core-size.py` (15 assertions); verified mutant kill. Committed `d87bbd4e3`.

### 7. Contract Ladder Campaign 100% Completion (Rounds 278–299) — ✅ 2026-11-13
- Contracted all remaining checkers in `scripts/census-checker-contracts.py` (70 of 70, 100% complete).

### 8. Backup / Restore Rehearsal Asserting Ledger Equality — ✅ 2026-11-13
- Added `recovery_midshift_backup_restore_rehearsal_asserts_ledger_equality` in `recovery_inline_tests.rs`.
- Proved exact equality of shift float, active status, stock (`70`), completed sale (`3,000`), gift card balance (`3,500`), and audit log hash continuity (`is_valid: true`, 4 checked). Committed `e03d0bc12`.

### 9. Two-Tablet Sync Convergence Under Hostile Clocks — ✅ 2026-11-13
- Added `two_tablets_sync_convergence_under_hostile_clock_skew_and_equal_timestamps` in `daemon_tests.rs`.
- Skewed clocks (14 days past vs 14 days future + timestamp collision). Drained queues in 4 cycles; asserted exact stock convergence (`117`), zero duplicate sales, deduplication keys applied. Committed `5a34a5b39`.

### 10. Upgrade Round-Trip & Emergency Rollback Procedure — ✅ 2026-11-13
- Verified Minisign updater crypto self-test. Authored `docs/operations/upgrade-and-rollback-procedure.md` covering pre-upgrade snapshotting, forward migration, and 4-step emergency rollback. Committed `284fbc319`.

### 11. Security Posture Table & i18n Cleanup Debt Decision — ✅ 2026-11-13
- Verified IPC parity. Formulated fail-closed (`OZ_ADMIN_KEY`, `OZ_API_SECRET`, `OZ_LICENSE_PRIVATE_KEY`) vs fail-open (`OZ_ENFORCE_PLANS`) posture. Preserved 55 Indonesian-only keys (`I18N-01`) as permanent fixtures. Committed `2cd7606ef`.

### 12. Offline Error-Message Path Audit — ✅ 2026-11-13
- Audited offline user paths (checkout, KDS, inventory, kasbon, QRIS gateway, sync reconciliation). Verified no raw Rust leaks or false cloud promises. UI lint and typecheck clean. Committed `ba4494605`.

### 13. Full Acceptance Dry Run & Environment Hardening — ✅ 2026-11-13
- Hardened `check-ui.mjs` for Windows Git Bash and `target/mstmp`. Ran `npm run check:all` with 9 passed, 1 skipped (Docker), 0 failed. Committed `a24e947e1`.

### 14. v0.0.41 Code Freeze Declaration & Bug Triage Workflow — ✅ 2026-11-13
- Formally declared v0.0.41 code freeze in `docs/operations/freeze-declaration-0.0.41.md`.
- Published bug report template in `.github/ISSUE_TEMPLATE/bug_report.md` and updated `plan-next-30-days.md`. Committed `fa5927e98`.

</details>

---

## Completed — Week of 2026-11-02 → 2026-11-09

<details>
<summary>13 completed items — click to expand</summary>

### 1. UI lint + typecheck + unit tests — ✅ 2026-11-09
- `npm run lint` → 0 errors · `npm run typecheck` → 0 errors
- `npm run test` → 13,130 passed · 3 skipped · 3 todo across 828 test files

### 2. Gate scripts — ✅ 2026-11-09
- `check-gate-runners.py` → 150 gates checked, all resolve
- `verify-agents-mirrors.py` → every policed mirror agrees
- `verify-ipc-parity.py` → IPC parity: OK

### 3. I18N Cleanup (`I18N-01`) — ✅ PRESERVED 2026-11-09
- 55 Indonesian-only keys confirmed as load-bearing test fixtures and documented cleanup debt.
- `verify-bundle-parity.py` and `verify-ftl-orphans.py` exit 0 cleanly.

### 4. Terminal Profile Dead Surfaces — ✅ DOCUMENTED 2026-11-09
- Chose Option A: document as headless back-office admin surfaces.
- Updated doc comments in `apps/desktop-tauri/src/commands/terminals.rs`.
- `verify-ipc-parity.py` PASS · `api-terminals-contract.test.ts` 12/12 · bridge terminals 37/37.

### 5. Owner Question Follow-up (R4/R6/R7) — ✅ VERIFIED 2026-11-09
- R4 (EDC binding): shipped as `terminal_id: Option<String>` with loopback fallback.
- R6 (MIDTRANS credential): declined; wiremock offline tests run cleanly.
- R7 (EDC terminal model): "none yet"; loopback simulator is the active implementation.

### 6. Website Carousel §7.0 Mount-Box Decision — ✅ RESOLVED 2026-11-09
- Adopted Option B (`object-fit: cover`), standard 16:9 recordings with 15px safe margin.
- Updated `docs/plans/_active/website_carousel.md`. Only video assets remain blocked.

### 7. Documentation Portal Health — ✅ VERIFIED 2026-11-09
- `mdbook build docs` → exit 0, HTML book written.

### 8. Payment Methods Plan Archival — ✅ 2026-11-09
- 83 passing tests across UI, Rust core, and bridge suites.
- Moved to `docs/plans/_done/done-payment-methods-plan.md`. All cross-references updated.

### 9. Subscription Tier Enforcement Verification — ✅ 2026-11-09
- Go license server: PASS (305.5s) · Core: 138 passed · Bridge: 35 passed · UI: 91 passed.

### 10. Android Mobile Build & Hardware Preflight — ✅ 2026-11-09
- `android-preflight.sh` verified via Git Bash. adb daemon operational.

### 11. Feature Flag Test Enumeration (BR-D1) — ✅ 2026-11-09
- All 39 feature variants reconciled in `features_tests.rs`. Committed `828a954fd`.

### 12. Gate-Integrity Checker Audit (GI-1–GI-7) — ✅ 2026-11-09
- 150 gates · 104/106 self-tests wired · 101 self-tests executed · all scripts clean.

### 13. SEA Market Expansion Presets (ADR-59 Phase 2) — ✅ 2026-11-09
- `SEA_MARKET_PRESETS` for 6 markets + `regional_preset_for_country()` in `regional.rs`.
- 53/53 tests passing. Committed `54c474ddd`.

</details>
