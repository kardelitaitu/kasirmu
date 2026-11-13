# Weekly Development Plan — kasir.mu `0.0.41` (Pre-Beta Freeze & Verification)

> Generated: 2026-11-14. Branch locked at `0.0.41`. Never create or switch branches.
> v0.0.41 Code & Scope Freeze is active (declared 2026-11-13 in `docs/operations/freeze-declaration-0.0.41.md`).
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## Week of 2026-11-24 → 2026-11-30 · Pre-Beta Operational Resilience & Stress Hardening

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

## Day 1 · Mon 11-24 · Multi-Terminal Peer-to-Peer LAN Synchronization & CRDT Convergence

> Exercises peer-to-peer sync, noise transport encryption, and CRDT delta distribution without cloud WAN access.

- [x] Run peer-to-peer LAN replication & lease tests — **DONE 2026-11-14**: 89 unit tests, 3 integration suites, and doc tests pass in `crates/kasirmu-lan`:
  - `crdt_delta_broadcast_replicates_to_peer_terminals` (`tests/crdt_replication_tests.rs`)
  - `distributed_table_leases_sync_and_reconcile_over_lan` (`tests/distributed_lease_tests.rs`)
  - `reconnect_fetches_fresh_table_snapshot_and_reconciles` (`tests/reconnect_snapshot_tests.rs`)
  ```bash
  cargo test -p kasirmu-lan
  ```
- [x] Confirm table lock synchronization and lease collision prevention across local network terminals without cloud gateway.

---

## Day 2 · Tue 11-25 · Dirty Shutdown & SQLite WAL Recovery Simulation

> Validates transaction durability and crash recovery under brutal kernel termination (`kill -9` / `TerminateProcess`).

- [x] Execute 5-cycle dirty shutdown stress simulation — **DONE 2026-11-14**: `python scripts/test-wal-dirty-shutdown.py` passes 5/5 brutal terminations mid-transaction with zero corruption, `PRAGMA integrity_check: OK`, `PRAGMA foreign_key_check: OK`, and atomic rollback of partial transactions.
  ```bash
  python scripts/test-wal-dirty-shutdown.py
  ```
- [x] Verify that committed transactions remain durable and no orphaned records exist.

---

## Day 3 · Wed 11-26 · High-Volume Shift Stress Simulation (200+ Rapid Transactions)

> Simulates sustained offline sales burst during peak retail/dining rush.

- [x] Run multi-transaction offline durability suites — **DONE 2026-11-14**:
  - `offline::test_two_hundred_consecutive_offline_sales_durability` (200 sales executed in memory, zero leaks, exact `Money` integer arithmetic)
  - `offline::test_full_pilot_dry_run_onboarding_to_50_sales_shift_and_sync` (50 sales full onboarding to shift close and sync queue)
  ```bash
  cargo test -p kasirmu-core --test integration offline::
  ```
- [x] Assert end-of-shift Z-report generation matches exact drawer cash float down to minor units.

---

## Day 4 · Thu 11-27 · Touch Target Accessibility & Modal Keyboard Traps Audit

> Enforces touch ergonomic standards on POS/tablet screens (WCAG 2.2 / AAA compliance).

- [x] Run touch target floor validation — **DONE 2026-11-14**: `npm run test -- touchTargetSizing.test.tsx` (9 tests pass) verifying `--touch-target-min: 44px` (48px coarse) across all button, keypad, and modal selectors.
  ```bash
  cd ui && npm run test -- touchTargetSizing.test.tsx
  ```
- [x] Verify WAI-ARIA roving tabindex, focus traps, and Escape key dismissal across confirmation and checkout modals.

---

## Day 5 · Fri 11-28 · Static Gate Integrity & Register Hygiene Sweep

> Ensures full static gate health and zero drift across documentation anchors.

- [x] Run register hygiene and contract sweep — **DONE 2026-11-14**:
  - `python scripts/check-register-hygiene.py` → `register hygiene OK: 249 round-log entries (51-299), consecutive, honest-limits from r114 on, 1 addendum(s)`.
  - `python scripts/check-debt-ledger.py` → `check-debt-ledger: OK - 165 entries defined, 122 sections`.
  - `python scripts/verify-flaky-quarantine.py` → `PASS: quarantine manifest valid (0 entries, none expired)`.
  - `python scripts/census-checker-contracts.py` → `70 of 70 contracted`.
  - `python scripts/verify-agents-mirrors.py` → `every policed mirror agrees`.
  - `python scripts/verify-ipc-parity.py` → `IPC parity: OK`.
  ```bash
  python scripts/check-register-hygiene.py
  python scripts/check-debt-ledger.py
  python scripts/verify-flaky-quarantine.py
  python scripts/census-checker-contracts.py
  python scripts/verify-agents-mirrors.py
  python scripts/verify-ipc-parity.py
  ```

---

## Day 6 · Sat 11-29 · Diagnostic Export Packaging & Error Trace Sanitization

> Tests self-service support export tooling without leaking merchant secrets or customer PII.

- [x] Verify diagnostic export security and sanitization — **DONE 2026-11-14**: `cargo test -p kasirmu-bridge diagnostics` (10 passed) verifying path traversal rejection, redaction of JWT tokens, passwords, and API secrets, PII sanitization, and RBAC `SETTINGS_READ` gating.
  ```bash
  cargo test -p kasirmu-bridge diagnostics
  ```

---

## Day 7 · Sun 11-30 · Beta Candidate Full Acceptance Dry Run

> Concludes sprint with full application shell check and beta milestone reconciliation.

- [x] Compile application shells — **DONE 2026-11-14**: `cargo check -p kasirmu-app -p kasirmu-mobile` (19 crates compiled clean in 48s, 0 errors).
  ```bash
  cargo check -p kasirmu-app -p kasirmu-mobile
  ```
- [x] Validate UI gates clean — **DONE 2026-11-14**: `npm run lint` (0 errors), `npm run typecheck` (0 errors), `npm run lint:i18n` (no issues detected), Vitest unit suite (13,130 passed, 3 skipped, 3 todo).
- [x] Reconcile beta roadmap against [todo-beta-testing-january-2027.md](file:///c:/dev/kasirmu/todo-beta-testing-january-2027.md).

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
