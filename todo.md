# Weekly Development Plan — kasir.mu `0.0.41` (Pre-Beta Freeze & Verification)

> Generated: 2026-11-13. Branch locked at `0.0.41`. Never create or switch branches.
> v0.0.41 Code & Scope Freeze is active (declared 2026-11-13 in `docs/operations/freeze-declaration-0.0.41.md`).
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## Week of 2026-11-17 → 2026-11-23

### Status entering this week

| Area | Status |
|---|---|
| Release Milestone | `v0.0.41` pre-beta stabilization; code freeze active (`fa5927e98`) |
| CI on `main` / dev-ci | ✅ All gates pass (`check:all` 9 passed, 1 skipped). Northflank deploy blocked on token rotation. |
| Reliability Ladder Campaign | ✅ 100% contracted (70 of 70 gate checkers with full ladder contract) |
| Active Plans | `docs/plans/_active/website_carousel.md` (waiting for 5x10s video clips), `notes.md` |
| Security & Invariants | 5 core invariants active (0 new schema migrations, Money `i64`, transaction writes, IPC parity, ladder contracts) |

---

## Day 1 · Mon 11-17 · Release Artifact Build & SHA-256 Digest Verification

> Satisfies `plan-next-30-days.md` §4.3: rebuild signed installers from a clean tree and record digests.

- [x] Run release version and windows config verifications — **DONE 2026-11-13**: `node scripts/check-release-version.mjs --self-test` → `self-test: all cases passed`; `python scripts/verify-windows-config.py` → `0 violation(s) (population examined: 2 tauri.conf.json walked, 6 source app.manifest checked, 0 built exe scanned)`; `python scripts/verify-release-workflow.py` → `release.yml validates (pins, paths, inventory, signing guard, ordering, privileges)`.
  ```bash
  node scripts/check-release-version.mjs --self-test
  python scripts/verify-windows-config.py
  python scripts/verify-release-workflow.py
  ```
- [x] Build desktop production release installer — **DONE 2026-11-13**, 2 bundles produced. **It does NOT build from a plain shell on this host, and the failure is misleading:** `cargo tauri build --bundles nsis,msi` reaches `beforeBuildCommand npm run build --prefix ../ui` and dies at `[vite:esbuild-transpile] remove C:\Windows\TEMP\esbuild-<hash>: Access is denied`, which reads like a build error and is a **temp-directory ACL problem**. Running it with a process-owned temp dir fixes it, the same remedy `scripts/check-ui.mjs` already carries (`target/mstmp`) for the identical class:
  ```bash
  mkdir -p target/mstmp
  TMP=$(cygpath -w "$PWD/target/mstmp") TEMP=$(cygpath -w "$PWD/target/mstmp") \
    TMPDIR=$(cygpath -w "$PWD/target/mstmp") cargo tauri build --bundles nsis,msi
  ```
  ```bash
  cargo tauri build --bundles nsis,msi
  ```
- [x] Compute and record SHA-256 digests of generated installer binaries — **recorded 2026-11-13**:

  | Artifact | Bytes | SHA-256 |
  |---|---|---|
  | `target/release/bundle/nsis/kasir.mu_0.0.41_x64-setup.exe` | 12,636,571 | `d76551c22369ff453f4395d657d2c60f0505fa340f1e865545ac1e6ef32141fb` |
  | `target/release/bundle/msi/kasir.mu_0.0.41_x64_en-US.msi` | 17,498,112 | `6f9ca442af9839775841129bc5e2a2388ecbe406f6cd36c7ef740008424d38af` |

  Both were produced from the tree at `6b1637572`, and both digests are from that one build — a rebuild will change them, so re-derive rather than quote.
  ```powershell
  Get-FileHash -Algorithm SHA256 target\release\bundle\nsis\*.exe
  Get-FileHash -Algorithm SHA256 target\release\bundle\msi\*.msi
  ```
- [ ] Verify installer matches Minisign updater manifest signature — **NOT RUN 2026-11-13, blocked on a credential, and the reason is recorded rather than worked around.** `cargo tauri build` emits a `.sig` and an updater `latest.json` only when `TAURI_SIGNING_PRIVATE_KEY` is present; it is **not set** in this environment, so neither exists under `target/release/bundle/` and there is nothing to verify against. The verification *machinery* is proven independently: `node scripts/verify-updater-signature.mjs --self-test` → `signature verification (incl. tamper rejection) PASSED`. To close this box the owner must supply the key (user-scope env var, per AGENTS §4) and re-run the build — it is a signing-authority decision, not a code task.
  ```bash
  node scripts/verify-updater-signature.mjs latest.json windows-x86_64 target\release\bundle\nsis\*.exe
  ```

---

## Day 2 · Tue 11-18 · Pilot Merchant First-Run Provisioning Simulation

> Exercises the 5-minute onboarding flow defined in `docs/operations/pilot-merchant-onboarding.md` §2.

- [x] Walk the 5-step provisioning sequence in local standalone mode (`crates/kasirmu-bridge/src/setup_tests.rs:pilot_merchant_first_run_provisioning_simulation_end_to_end`):
  1. Profile initialization: trade name (*Warung Kopi Nusantara*) + timezone (`Asia/Jakarta`).
  2. Currency validation: locked `IDR` minor units (0 exponent).
  3. Tax preset activation: verify `ppn11` (1100 bps default) and `ppn11_service5` (1100 bps PPN + 500 bps Service Charge).
  4. Hardware pairing: test thermal printer receipt formatting (`Rp` glyph, dot thousand separator, header/footer, paper cut).
  5. Test transaction: multi-tender checkout (Split Cash + QRIS 0% MDR with gross-equals-net validation).
- [x] Confirm zero errors in dev console and app log (`%LOCALAPPDATA%\kasirmu\logs\app.log`).
- [x] Validate EOD reconciliation: perform shift close and verify Z-report receipt totals with zero cash discrepancy (`cash_difference_minor = Some(0)`).

---

## Day 3 · Wed 11-19 · Tab Leases & Multi-Terminal Concurrency Stress Testing

> Validates dining operations and optimistic concurrency leases (`pilot-merchant-onboarding.md` §3).

- [x] Verify optimistic tab lease broadcast (`tabs:changed`) across simulated multi-terminal sessions (`TableManagementFloorSyncScope.test.ts`, `TableManagementScreen.test.tsx` 80 passed, `usePosHeldCarts.ts:169`).
- [x] Test table merge flow: source held cart appended to destination cart, source table released (`ui/e2e/restaurant-table-merge.spec.ts`, `TableManagementScreen.test.tsx:tables-merge-confirm-btn`).
- [x] Verify 60-second lease expiration timeout: ensure inactive tab lock releases without deadlocking other tills (`crates/kasirmu-lan/src/table_sync_tests.rs:table_lease_tracker_acquire_conflict_and_expiration`, `tests/distributed_lease_tests.rs`, `ui/src/__tests__/hooks/useTabLeases.test.ts`).
- [x] Validate automated "86 / Habis" menu badge when component ingredient inventory reaches 0 (`ui/src/__tests__/RestaurantMenu.test.tsx` 61 passed, `usePosCartActions.ts:170`).

---

## Day 4 · Thu 11-20 · Hardware Fault Injection & Printer Offline Fallback

> Tests cash drawer and thermal printer disconnection handling during mid-shift retail checkout.

- [x] Simulate printer disconnection mid-checkout: verify receipt spooling / warning without crashing the checkout modal (`PaymentModalSaleFlow.test.tsx:warns instead of reporting success when the receipt cannot print`).
- [x] Verify cash drawer kick fallback: manual drawer release prompt displayed when ESC/POS kick pulse is unacknowledged (`PaymentModalSaleFlow.test.tsx:2854`, `RestaurantPaymentsScreen.test.tsx:824`).
- [x] Test barcode scanner rapid-fire input: ensure input buffer handles rapid scans without dropping keystrokes or double-adding items (`useBarcodeScanner.test.tsx` 24 passed).
- [x] Confirm no raw hardware driver exceptions escape to the cashier UI (`crates/kasirmu-bridge/src/hardware_tests.rs`, `PosScreen.test.tsx:684:Scanner disconnected — check USB connection`).

---

## Day 5 · Fri 11-21 · Quarantine Audit & Static Gate Health Sweep

> Ensures quarantine cleanliness and gate parity maintenance under freeze.

- [x] Audit test quarantine manifest — **DONE 2026-11-13**: `python scripts/verify-flaky-quarantine.py` → `PASS: quarantine manifest valid (0 entries, none expired)`.
  ```bash
  python scripts/verify-flaky-quarantine.py
  ```
- [x] Verify AGENTS mirrors, IPC parity, and contract ladders — **DONE 2026-11-13**: `every policed mirror (1) agrees with the repo`, `IPC parity: OK`, `census-checker-contracts: 70 of 70 contracted`.
  ```bash
  python scripts/verify-agents-mirrors.py
  python scripts/verify-ipc-parity.py
  python scripts/census-checker-contracts.py
  ```
- [x] Run full UI validation suite — **DONE 2026-11-13**: `npm run lint` (0 errors), `npm run typecheck` (0 errors), `npm run lint:i18n` (no issues detected), Vitest unit suite (13,130 passed, 3 skipped, 3 todo). Hardened `check-ui.mjs`, `run-e2e.mjs`, and `docker-compose.e2e.yml` against host port collisions and Windows WSL path resolution.
  ```bash
  cd ui && npm run lint && npm run typecheck
  cd ui && npm run lint:i18n
  ```

---

## Day 6 · Sat 11-22 · Documentation Portal Synchronization & Runbook Audit

> Keeps mdBook portal and operational guides aligned with HEAD.

- [ ] Audit docs portal links and build:
  ```bash
  python scripts/gen-summary.py
  mdbook build docs
  ```
- [ ] Verify doc uniqueness:
  ```bash
  python scripts/verify-doc-uniqueness.py
  ```
- [ ] Cross-check runbook procedures with latest freeze declaration:
  - [upgrade-and-rollback-procedure.md](file:///c:/dev/kasirmu/docs/operations/upgrade-and-rollback-procedure.md)
  - [freeze-declaration-0.0.41.md](file:///c:/dev/kasirmu/docs/operations/freeze-declaration-0.0.41.md)

---

## Day 7 · Sun 11-23 · Weekly Bug Triage & Beta Readiness Review

> Weekly retrospective and bug backlog review against P0–P3 triage criteria.

- [ ] Triage any logged issues using [.github/ISSUE_TEMPLATE/bug_report.md](file:///c:/dev/kasirmu/.github/ISSUE_TEMPLATE/bug_report.md).
- [ ] Review carry-forward operational blockers:
  - Northflank API deployment token rotation (Owner: Infrastructure).
  - 5 × 10 s hero carousel screen recordings (Owner: Product / Media).
  - Docker Desktop daemon status for PG-gated receipts (Owner: Platform).
- [ ] Compile Week 2026-11-17 retrospective log and formulate next sprint roadmap.

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
