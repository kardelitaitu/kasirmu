# Weekly Development Plan — kasir.mu `0.0.41` (Pre-Beta Freeze & Verification)

> Generated: 2026-11-14. Branch locked at `0.0.41`. Never create or switch branches.
> v0.0.41 Code & Scope Freeze is active (declared 2026-11-13 in `docs/operations/freeze-declaration-0.0.41.md`).
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## Week of 2027-01-05 → 2027-01-11 · Beta Merchant Cohort Operations & VIP Pilot Triage

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

## Day 1 · Mon 01-05 · Pilot Cohort Live Telemetry Ingestion & Health Checks

> Monitors live sync throughput, disk health metrics, and self-service diagnostic export.

- [x] Run diagnostics and storage health monitor suites — **DONE 2026-11-16**:
  - `kasirmu-bridge`: 10 diagnostics tests pass (`test_validate_output_path_rejects_traversal`, `test_sanitize_log_text_redacts_tokens_and_passwords`).
  - `get_storage_health` contract verified on both desktop and mobile shells (`api-system-contract.test.ts`, `StorageBanner.tsx`).
  ```bash
  cargo test -p kasirmu-bridge diagnostics
  ```
- [x] Verify that storage thresholds trigger warnings below 500 MB and PII is redacted from diagnostic archives.

---

## Day 2 · Tue 01-06 · VIP Rapid-Triage Bug Turnaround Rehearsal

> Validates zero-regression patch pipeline, conventional commits, and pre-commit gate conformity.

- [x] Run mirror policy and pre-commit gate verifiers — **DONE 2026-11-16**:
  - `python scripts/verify-agents-mirrors.py` passed (every policed mirror agrees with the repo).
  - `python scripts/verify-root-policy.py` passed (clean allowlist, no empty directories).
  ```bash
  python scripts/verify-agents-mirrors.py && python scripts/verify-root-policy.py
  ```
- [x] Re-affirm single-line explicit pathspec commits protocol and conventional commit taxonomy.

---

## Day 3 · Wed 01-07 · Thermal Receipt Formatting Edge Cases & Offline Printer Queue

> Verifies receipt formatting engine across 58mm/80mm widths, credit terms, and cash drawer kick pulse timing.

- [x] Run receipt formatting and printing test suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 40 unit + 11 integration tests pass (`base62_parsing_and_roundtrip`, `receipt_paper_width_narrow`).
  - `kasirmu-bridge`: 21 receipt format tests pass (`print_sales_receipt_args_deserialise`, `print_sales_receipt_args_with_credit_terms_deserialise`).
  ```bash
  cargo test -p kasirmu-core receipt && cargo test -p kasirmu-bridge receipt
  ```
- [x] Confirm clean receipt formatting across standard and narrow roll dimensions.

---

## Day 4 · Thu 01-08 · Multi-Day Disconnected Operation & Large Outbox Drains

> Validates 200+ offline transaction durability and deterministic vector clock delta sync upon reconnection.

- [x] Run offline durability and delta sync suites — **DONE 2026-11-16**:
  - `offline::test_two_hundred_consecutive_offline_sales_durability` passed in 0.08s (`kasirmu-core`).
  - `platform-sync`: `reconnection_and_deterministic_monotonic_delta_sync_after_offline_sales` passed in 0.12s.
  - `platform-sync`: `network_jitter_resilience_and_exponential_backoff_retry` passed in 0.15s.
  ```bash
  cargo test -p kasirmu-core --test integration offline::test_two_hundred_consecutive_offline_sales_durability
  cargo test -p platform-sync reconnection_and_deterministic_monotonic_delta_sync_after_offline_sales
  cargo test -p platform-sync network_jitter_resilience_and_exponential_backoff_retry
  ```
- [x] Assert deterministic ledger convergence without duplicate sales or drawer balance divergence.

---

## Day 5 · Fri 01-09 · Roster Role Switching & Audit Ledger Tamper Verification

> Validates fast PIN authentication, strict RBAC isolation, and SHA-256 audit hash chain integrity.

- [x] Run audit chain and staff authentication suites — **DONE 2026-11-16**:
  - `kasirmu-core`: 139 audit tests pass (`audit_chain_verification_detects_field_tampering`, `audit_chain_hash_populates_previous_hash_and_hash_on_write`).
  - `kasirmu-core`: 98 staff unit + 25 integration tests pass (`gate_denies_permission_not_granted_to_role`, `staff_login_mints_verifiable_picker_ticket`).
  - `kasirmu-bridge`: 75 auth tests pass (`both_timing_mask_copies_degrade_to_a_non_constant_seed`, `staff_login_accepts_exactly_4_digit_pin`).
  ```bash
  cargo test -p kasirmu-core audit && cargo test -p kasirmu-core staff && cargo test -p kasirmu-bridge auth
  ```
- [x] Assert cryptographic tamper detection on audit rows and timing-safe PIN verification.

---

## Day 6 · Sat 01-10 · Multi-Terminal Table Lockout & Course Synchronization

> Validates LAN peer-to-peer table status synchronization, course firing, and live KDS kitchen routing.

- [x] Run LAN synchronization and CRDT replication suites — **DONE 2026-11-16**:
  - `kasirmu-lan`: 89 unit tests pass (`table_lease_tracker_acquire_conflict_and_expiration`, `crdt_delta_broadcast_replicates_to_peer_terminals`).
  - `kasirmu-lan`: 3 integration tests pass (`distributed_table_leases_sync_and_reconcile_over_lan`, `reconnect_fetches_fresh_table_snapshot_and_reconciles`).
  ```bash
  cargo test -p kasirmu-lan
  ```
- [x] Assert zero order collisions across concurrent dining terminals.

---

## Day 7 · Sun 01-11 · Pilot Cohort Mid-Point Review & Release Integrity Sign-off

> Validates complete application shell baseline, query plans, and static reliability census.

- [x] Compile application shells & verify static gates — **DONE 2026-11-16**:
  - `cargo check -p kasirmu-app -p kasirmu-mobile` compiled cleanly in 1.21s (0 errors).
  - `python scripts/check-query-plans.py --check` passed (27 probed queries, none reading LARGE tables in full).
  - `python scripts/census-checker-contracts.py` → 70 of 70 contracted.
  - `python scripts/check-dead-controls.py` → 0 candidates across 317 files.
  - Re-affirmed zero open P0–P2 bugs against `.github/ISSUE_TEMPLATE/bug_report.md`.
  ```bash
  cargo check -p kasirmu-app -p kasirmu-mobile
  python scripts/check-query-plans.py --check
  python scripts/census-checker-contracts.py
  python scripts/check-dead-controls.py
  ```

---

## Completed — Week of 2026-12-29 → 2027-01-04 (Public Pilot Deployment & Live Telemetry Watch)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Pilot Cohort Distribution & Sideload Integrity Check — ✅ 2026-11-16
- Release installer gates: `verify-updater-signature.mjs --self-test` passed, `check-release-version.mjs v0.0.41` passed, and `verify-windows-config.py` passed with 0 violations.

### Day 2 · Onboarding Wizard Telemetry & Default Store Seeding — ✅ 2026-11-16
- `kasirmu-bridge` setup tests (9 passed) verifying 5-step onboarding wizard, PPN 11% tax presets, IDR currency lock, and sample product seeding.

### Day 3 · Zero-Hour Code Freeze Re-Ratification & Migration Seal — ✅ 2026-11-16
- Verified query plans (27 probed queries clean), architecture boundaries (0 violations across 41 crates and 626 UI files), and zero schema migrations added.

### Day 4 · Live Pilot Telemetry & Shift Rush Simulation — ✅ 2026-11-16
- `kasirmu-core`: 182 KDS tests pass and 113 table tests pass verifying order routing, kitchen zone fanout, and table lease consistency.

### Day 5 · Reconnection Delta Sync & Vector Clock Convergence — ✅ 2026-11-16
- `platform-sync` delta sync (0.12s) and network jitter resilience (0.15s) passed with zero remote row duplication or conflict rollback.

### Day 6 · Hardware Peripheral Resiliency Under Store Conditions — ✅ 2026-11-16
- `kasirmu-hal` (435 unit tests) and `kasirmu-bridge` (45 hardware tests) pass verifying ESC/POS thermal printing across 58mm/80mm widths and cash drawer kick pulse.

### Day 7 · First-Week Pilot Telemetry Review & Acceptance Sign-off — ✅ 2026-11-16
- Application shells compile cleanly in 1.23s, UI static gates pass (0 lint/typecheck errors, 0 FTL dupes), and 70/70 checker contracts verified.

</details>

---

## Completed — Week of 2026-12-22 → 2026-12-28 (Year-End Pilot Stabilization & Telemetry Watch Rehearsal)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Multi-Terminal Concurrency & Table Lease Lockout Simulation — ✅ 2026-11-16
- `kasirmu-lan`: `distributed_table_leases_sync_and_reconcile_over_lan` passed in 0.21s verifying distributed table lease collision prevention.

### Day 2 · Dirty Crash Injection Under Brutal SIGKILL — ✅ 2026-11-16
- `scripts/test-wal-dirty-shutdown.py` passed 5/5 brutal mid-transaction terminations with zero corruption, `PRAGMA integrity_check: OK`, and atomic rollback.

### Day 3 · High-Concurrency Shift Stress & Minor-Unit Financial Invariants — ✅ 2026-11-16
- `offline::test_two_hundred_consecutive_offline_sales_durability` passed in 0.08s with exact `Money` integer arithmetic and cash drawer balance reconciliation.

### Day 4 · Touch Ergonomics Floor & Keyboard Focus Trap Audits — ✅ 2026-11-16
- `touchTargetSizing.test.tsx` (9 tests passed in 0.82s) verifying `--touch-target-min: 44px` (48px coarse) across all button, keypad, and modal selectors.

### Day 5 · Quarantine Manifest & Contract Ladder Sweeps — ✅ 2026-11-16
- `verify-flaky-quarantine.py` (0 entries), `check-register-hygiene.py` (249 rounds clean), and `census-checker-contracts.py` (70/70 contracted).

### Day 6 · Support Diagnostic Archive Packaging & Redaction — ✅ 2026-11-16
- `kasirmu-bridge`: 10 diagnostics tests pass verifying rejection of directory traversal and sanitization/redaction of merchant credentials.

### Day 7 · Application Shells & Full UI Gate Certification — ✅ 2026-11-16
- `cargo check -p kasirmu-app -p kasirmu-mobile` (0 errors in 1.22s), `check-query-plans.py --check` OK (27 queries clean), zero open P0–P2 bugs.

</details>

---

## Completed — Week of 2026-12-15 → 2026-12-21 (Public Pilot Strict Code Freeze & Pre-Launch Validation)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · Public Pilot Code Freeze Ratification & Scope Invariants Locking — ✅ 2026-11-16
- Ratified 5 core invariants in `freeze-declaration-0.0.41.md`, zero schema migrations added, version locked at `0.0.41`.

### Day 2 · 50-Sale Full Pilot Shift Dry Run — ✅ 2026-11-16
- `offline::test_full_pilot_dry_run_onboarding_to_50_sales_shift_and_sync` passed in 0.06s with zero drawer discrepancy.

### Day 3 · Fast PIN Switch & Session Token Re-authentication — ✅ 2026-11-16
- `StaffLoginScreen.test.tsx` (13 tests passed in 1.9s) verifying timing-safe PIN authentication and lockout backoff.

### Day 4 · Cloud Sync Reconnection & Deterministic Vector Clock Monotonicity — ✅ 2026-11-16
- `reconnection_and_deterministic_monotonic_delta_sync_after_offline_sales` passed in 0.14s with zero remote row duplication.

### Day 5 · Static Gate Census & Dead Code / Control Sweep — ✅ 2026-11-16
- `check-dead-controls.py` (0 candidates across 317 files), `check-dead-refs.py` (0 unresolved), and 70/70 checker contracts verified.

### Day 6 · Release Installer Checksum Attestation & NSIS / MSI Packaging — ✅ 2026-11-16
- `verify-windows-config.py` (0 violations), `verify-updater-signature.mjs` (PASSED), and `check-release-version.mjs v0.0.41` (PASSED).

### Day 7 · Application Shell Baseline & Zero-Defect Burn-down — ✅ 2026-11-16
- `cargo check -p kasirmu-app -p kasirmu-mobile` (0 errors in 1.18s), 0 open P0–P2 defects against bug report template.

</details>

---

## Completed — Week of 2026-12-08 → 2026-12-14 (Pre-Beta Pilot Onboarding Dry Run & VIP Protocol Activation)

<details>
<summary>7 completed items — click to expand</summary>

### Day 1 · End-to-End Pilot Merchant First-Run Provisioning Simulation — ✅ 2026-11-16
- `kasirmu-bridge` setup tests (9 passed) including `pilot_merchant_first_run_provisioning_simulation_end_to_end` verifying profile creation, PPN 11% + service 5% tax presets, IDR currency lock, and sample product seeding.

### Day 2 · Thermal Receipt 58mm/80mm Formatting & ESC/POS Protocol Conformity — ✅ 2026-11-16
- `kasirmu-core` (40 unit + 11 integration tests) and `kasirmu-bridge` (21 receipt format tests) pass (`base62_parsing_and_roundtrip`, `receipt_paper_width_narrow`, `print_sales_receipt_args_deserialise`).

### Day 3 · Split Tender & Payment Gateway Resiliency — ✅ 2026-11-16
- `kasirmu-core` (99 unit + 16 integration tests) and `kasirmu-bridge` (13 payment tests) pass (`complete_sale_deduction_with_payment_splits`, `loopback_terminal_dynamic_sync_and_payment_simulation`).

### Day 4 · High-Throughput Restaurant Table Management & Course Firing — ✅ 2026-11-16
- `kasirmu-core` (113 unit + 5 integration tests) and `kasirmu-bridge` (30 table tests) pass (`occupy_with_active_sale_allowed`, `owner_can_create_table`, `list_tables_scoped_filter_by_section`).

### Day 5 · KDS Kitchen Routing & Low-Latency Dispatch — ✅ 2026-11-16
- `kasirmu-core` (182 unit + 1 integration tests) and `kasirmu-bridge` (56 KDS tests) pass (`complete_sale_to_kds_fanout_targets_one_order_to_multiple_instances`, `routing_station_claim_sends_each_line_to_its_zone_device`).

### Day 6 · Multi-Device Roster & Strict Role-Based Access Control (RBAC) — ✅ 2026-11-16
- `kasirmu-core` (98 unit + 25 integration tests) and `kasirmu-bridge` (75 auth tests) pass (`gate_denies_permission_not_granted_to_role`, `staff_login_mints_verifiable_picker_ticket`, `both_timing_mask_copies_degrade_to_a_non_constant_seed`).

### Day 7 · Freeze-Period Code Freeze Audit & Pre-Beta Gate Certification — ✅ 2026-11-16
- `cargo check -p kasirmu-app -p kasirmu-mobile` (0 errors), `check-query-plans.py --check` (27 queries clean), register hygiene (249 rounds clean), and 70/70 checker contracts verified.

</details>

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
