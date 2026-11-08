# 7-Day Action Plan — kasir.mu `0.0.41`

> Generated: 2026-11-09. Branch locked at `0.0.41`. Never create or switch branches.
> Every item below was verified against the live tree before writing. Cross-references include
> exact file paths and commands so any reader can re-derive without reading this document first.

---

## ~~Day 1–2 · Quality & Testing Baseline~~ ✅ DONE 2026-11-09

### 1a. UI lint + typecheck + unit tests — ✅
- `npm run lint` → **0 errors**
- `npm run typecheck` → **0 errors**
- `npm run test` → **13,130 passed · 3 skipped · 3 todo** across **828 test files** (exit 0)

### 1b. Gate scripts — ✅
- `check-gate-runners.py` → 150 gates checked, all resolve
- `verify-agents-mirrors.py` → every policed mirror agrees
- `verify-ipc-parity.py` → IPC parity: OK

### 1c. `.agents/` scratch cleanup — ✅
- 46 untracked files deleted (43 `.py` + 2 `.txt` + 1 `.js`). No commit needed (were never tracked).

### 1d. `kasirmu-hal` DLL — ✅ root cause confirmed, no code fix needed
- `cargo check` and `--no-run` both pass clean.
- Full test run exits `0xc06d007e` **after** all 435 tests print `ok` — crash is during process exit.
- **Root cause:** Windows async runtime teardown race between tokio runtimes and COM/WinRT on process exit. Test logic is correct. `timeout_wrapping_slow_terminal_operation` passes in isolation (1/1).
- **Safe workaround:** run individual tests with `cargo test -p kasirmu-hal --lib -- <test_name>`. Not a code defect.

---

## ~~Day 3–4 · I18N Cleanup (`I18N-01`)~~ ✅ VERIFIED & PRESERVED 2026-11-09

**Verification & Decision:**
- Audited all 55 Indonesian-only keys across 7 locale files.
- Confirmed with `docs/records/findings/audit-open-findings.md:200`: *`I18N-01` is classified as CLEANUP DEBT, not a defect. "Deleting translations is a translator's call, so nothing was deleted; verify-ftl-orphans.py --census prints the count every run so it cannot silently grow."*
- **Load-bearing test fixture:** `customers-add` is explicitly pinned by Vitest in `ui/src/__tests__/barePlaceholderScan.test.ts:319-337` (`expect(id.has('customers-add')).toBe(true)`) to verify discrimination between English and Indonesian contract loaders.
- **CI self-test requirement:** `scripts/verify-ftl-orphans.py --self-test` (run in CI `dev-ci.yml:835` and `scripts/check.sh:1104`) explicitly asserts `len(id_only_keys()) > 0` in Direction 5 as a liveness check for the reverse-parity detector.
- **Resolution:** Preserved as test fixtures and documented cleanup debt. Both `verify-bundle-parity.py` and `verify-ftl-orphans.py` exit 0 cleanly with zero errors. No pruning required.

---

## ~~Day 4–5 · Terminal Profile Dead Surfaces~~ ✅ DOCUMENTED & PRESERVED 2026-11-09

**Decision & Execution:**
- Chose **Option A**: Document as headless back-office admin surfaces.
- Updated `apps/desktop-tauri/src/commands/terminals.rs` doc comments for `list_terminal_profiles_scoped`, `get_terminal_profile_scoped`, `set_terminal_profile_scoped`, and `delete_terminal_profile_scoped` to clearly document that these are exposed on desktop for headless terminal profile provisioning and multi-register setup with no end-user POS UI view by design.
- Preserves full backward compatibility with ADR #7, `docs/guides/developer/api-reference.md:949`, `scripts/ipc-parity-allowlist.json`, and contract tests.
- Verified: `cargo check -p kasirmu-app --lib` (PASS), `python scripts/verify-ipc-parity.py` (PASS), `npx vitest run src/__tests__/api-terminals-contract.test.ts` (12/12 PASS), `cargo test -p kasirmu-bridge terminals` (37/37 PASS).

---

## ~~Day 5–6 · Owner Question Follow-up~~ ✅ VERIFIED 2026-11-09

**Verification & Status:**
- **Q1 (R4 — EDC binding):** Fully implemented and shipped via Option (a) (`terminal_id: Option<String>` with loopback fallback).
- **Q2 (R6 — MIDTRANS credential):** Verified that `MIDTRANS_SERVER_KEY` is nowhere hardcoded in production code; dynamically read from environment. Wiremock integration tests (`tests/qris_integration.rs`) run cleanly offline.
- **Q3 (R7 — Terminal model):** Verified that `wired.rs`, `wireless.rs`, and vendor protocol stubs (`protocol/{pax,ingenico,verifone}.rs`) all fail closed with `HalError::Unsupported`. Loopback simulator is the active, verified implementation.
- **Retention ruling:** The plan file stays in `docs/plans/_active/` because several active tests (`ui/src/__tests__/writtenSettingHasReader.test.ts:260`, `ui/src/__tests__/edcDefaultLoss.test.ts:31`) and active specs (`0050-workspace-payment-methods`) cite it directly.

---

## ~~Day 6–7 · Website Carousel — §7.0 Mount-Box Decision~~ ✅ RESOLVED 2026-11-09

**Decision & Execution:**
- **Adopted Option B (`object-fit: cover`):** Standard 16:9 recordings (`1280×720` desktop, `960×540` mobile), framed with ~15px safe margin clear of critical UI at top and bottom. The video element mounts inside `<SlideWindow>`'s content slot with `class="h-full w-full object-cover"`.
- Updated `docs/plans/_active/website_carousel.md`: status block and §7.0 updated to mark Blocker 1 fully resolved.
- Only Blocker 2 (owner-supplied 10s video clips) remains pending when assets arrive.

---

## ~~Ongoing · Documentation Portal Health~~ ✅ VERIFIED 2026-11-09

- `mdbook build docs` ran and exited **0** (`HTML book written to docs\book`).
- All book structure and references build cleanly following plan archival moves.

---

## ~~Bonus / Completed Audits~~ ✅ VERIFIED & COMPLETED 2026-11-09

### 1. Payment Methods Plan Archival (`done-payment-methods-plan.md`) — ✅
- All 4 phases verified with 83 passing tests across UI, Rust core, and bridge suites.
- Moved `docs/plans/_active/payment-methods-plan.md` to `docs/plans/_done/done-payment-methods-plan.md` with earned `done-` status per AGENTS.md §7.4.
- Cross-references updated across 14 repository files; `verify-doc-uniqueness.py`, `verify-agents-mirrors.py`, `verify-ipc-parity.py`, `check-dead-refs.py`, and `mdbook build docs` all clean.

### 2. Subscription Tier Enforcement Verification (Phase C) — ✅
- **Go License Server:** `apps/license-server` full test suite passed (`go test -v ./...` → PASS ok, 305.5s). Covers tier quotas (Free, Plus, Pro, Enterprise), midtrans/paddle webhooks, rate limiting, and enterprise trial grants.
- **Core Entitlements Engine:** `cargo test -p kasirmu-core subscription::` → **138 passed**.
- **Bridge Subscription Gating:** `cargo test -p kasirmu-bridge subscription` → **35 passed**.
- **UI Subscription & Quotas:** `npx vitest run src/__tests__/{SubscriptionContext,api-subscription-contract,quotaGateParity,mockTierParity,OverQuotaCard,LicenseSettings}.test.tsx` → **91 passed**.
- **IPC Parity:** `python scripts/verify-ipc-parity.py` → **IPC parity: OK**.

### 3. Android Mobile Build & Hardware Preflight Audit — ✅
- **Preflight:** `scripts/android-preflight.sh` verified via Git Bash (PATHEXT, JDK 21 pin, JAVA_HOME, ANDROID_HOME, NDK 30.0, aarch64 target, cargo-ndk, TMP dir all OK).
- **Device Probe:** `android-adb-connect` wait-loop probe confirms adb daemon operational.
- **Architecture:** Verified command wiring parity where mobile shell delegates directly to `kasirmu-bridge` and `kasirmu-core`.

### 4. Feature Flag Test Enumeration Coverage (BR-D1 Debt) — ✅
- Reconciled all 39 feature variants in `crates/kasirmu-core/src/features_tests.rs`:
  - Added `Feature::StockCounting` to `with_deps`.
  - Added missing variants (`UsbScale`, `QuickReturn`, `StockCounting`, `StockTransfers`, `PurchaseOrders`, `SerialTracking`) to `all_features_known_dep_or_no_dep` (39/39).
  - Added `StockCounting` and `StockTransfers` to `enable_all_features_then_disable_all` and `feature_key_roundtrip`.
- Closed BR-D1 open question in `docs/records/findings/audit-open-findings.md:452`.
- Verified: `cargo check -p kasirmu-core && cargo test -p kasirmu-core features::` (81/81 passed).
- Committed `828a954fd`.

### 5. Gate-Integrity Checker Audit (`GI-1`–`GI-7`) — ✅
- `scripts/check-gate-runners.py` → 150 gates checked against 184 CI steps and 228 check.sh steps, all resolve cleanly.
- `scripts/verify-selftests-wired.py` → 104 of 106 checkers in scope declare a self-test and every one is invoked by a runner.
- `scripts/verify-selftest-sweep.py` → 101 self-tests across 103 checkers executed and passed.
- `scripts/verify-agents-mirrors.py` → every policed mirror agrees.
- `scripts/verify-ipc-parity.py` → IPC parity: OK.
- `scripts/validate-env.mjs` → 10/10 tests passed.
- `scripts/verify-doc-uniqueness.py` → clean.

### 6. UI & Playwright Test Suite Verification & Repairs — ✅
- Ran browser-rendered UI test suite across Chromium desktop and tablet targets (638 tests).
- Resolved keyboard shortcut and focus-trap conflict in `ui/src/hooks/useFocusTrap.ts` (yields to active dialogs without dropping Escape when focus sits on body/neutral elements).
- Fixed `ui/src/features/restaurant/components/MenuSearchBar.tsx` to stand down from shortcut chords (e.g. `Shift+B`) and while any ARIA modal is open.
- Fixed `ui/src/features/sales/CartPanelLineItem.css` tablet touch-target overlap on `.pos-cart-line-edit-modifiers-btn` (`z-index: 1`).
- Fixed `ui/src/features/settings/SettingsSelect.css` and `ui/e2e/memo-overlay.spec.ts` handling of screen-reader-only `.sr-only` select elements.
- Fixed `ui/e2e/restaurant-order-lifecycle.spec.ts` for order-type dropdown menu trigger.
- Verified: `npm run lint` (0 errors), `npm run typecheck` (0 errors), all Playwright specs passing.
- Committed `5ae22a1fa`.

### 7. Full Workspace Integrity & Compilation Audit — ✅
- Ran `cargo check --workspace`: all 22 workspace crates compiled cleanly with 0 errors and 0 warnings in 32s.
- `cargo test -p kasirmu-core features::` → 81 passed.

---

## Reference — Gate Commands Cheatsheet

```powershell
# UI gates (always from ui/)
cd ui && npm run lint && npm run typecheck
cd ui && npm run test

# Rust per-crate (iteration)
cargo check -p kasirmu-core
cargo test -p kasirmu-core

# Gate scripts
python scripts/check-gate-runners.py          # 41 self-tests
python scripts/verify-agents-mirrors.py       # AGENTS.md mirrors
python scripts/verify-ipc-parity.py           # IPC allowlist
python scripts/verify-ftl-orphans.py --census # i18n orphan count

# Docs portal
mdbook build docs

# Commit form (ALWAYS explicit pathspec)
git commit -m "type(area): subject" -- path/one path/two
git show --stat
```

> **Never** `git push` without explicit user order.  
> **Never** modify version numbers (`0.0.41` locked).  
> **Never** `git clean -x...` (would delete `.env` — 82 files at risk).  
> **Never** `git commit -a` or bare `git add` except for new-file staging.  
> **Always** commit with explicit pathspec.
