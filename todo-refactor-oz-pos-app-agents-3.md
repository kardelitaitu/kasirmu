# Orchestrator Agent 3: Test Relocation, Thin Shell & IPC Parity

**Document:** `todo-refactor-oz-pos-app-agents-3.md`  
**Role:** Orchestrator Agent 3 (The Closer & Auditor)  
**Goal:** Relocate unit tests from `apps/desktop-client/src/commands/` into `crates/oz-bridge` to eliminate memory bloat during test compilation, consolidate `apps/desktop-client/src/lib.rs` into a thin Tauri router, share handlers with `apps/tablet-client`, and perform full matrix parity verification.

**Sibling Documents:**
- [`todo-refactor-oz-pos-app-agents-1.md`](./todo-refactor-oz-pos-app-agents-1.md) (Agent 1 — Infrastructure, Daemons & CI Stabilizer)
- [`todo-refactor-oz-pos-app-agents-2.md`](./todo-refactor-oz-pos-app-agents-2.md) (Agent 2 — Core Command Middleware & `oz-bridge`)

---

## 🔒 Coordination & Dependency Checking Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `test(bridge): ...`
     - `refactor(shell): ...`
     - `refactor(tablet): ...`
     - `ci(desktop): ...`
3. **Owned Path Fence (Exclusive to Agent 3):**
   - `apps/desktop-client/src/commands/*_tests.rs` (Moving to `crates/oz-bridge/`)
   - `apps/desktop-client/src/lib.rs` (The `invoke_handler!` macro & shell builder)
   - `apps/desktop-client/Cargo.toml` (Dependency cleanup)
   - `apps/tablet-client/` (Adopting shared `oz-bridge` handlers)
4. **Git Commit Waiting Protocol:**
   - Before moving tests for a specific wave, check that Agent 2 has committed that wave using:
     ```powershell
     git log -n 50 --oneline --grep="feat(bridge): extract <wave-name>"
     ```
   - If the commit is not found, pause and wait for the commit to appear in the Git history.

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit & Invariant Protection

Establish baseline metrics before performing test relocations and shell consolidations.

- [x] Run `python scripts/verify-ipc-parity.py` and record exit code (must be 0). → **EXIT=0, "IPC parity: OK"** (desktop 452 UI strings / 448 registered / 27 unreg refs; tablet 452/318/154; dev-mock 534 handlers, 16 allowlisted unanswerable; 10 gated dead `_scoped` surfaces).
- [x] Run `bash scripts/verify-scoped-coverage.sh` (must be PASS). → **EXIT=0, PASS: all registered commands covered** (Git-bash path, not WSL).
- [x] Record current lines of code in `apps/desktop-client/src/lib.rs` (Baseline: ~1,282 lines). → **1,281 lines**; generate_handler block starts ~:780, 448 entries / 57 module prefixes.
- [x] Record current total file count in `apps/desktop-client/src/commands/` (Baseline: ~123 files). → **137 files** = 123 top-level + 14 under `topology/`; **70 `*_tests.rs` totalling 31,803 lines** (largest: topology_command_tests 2,071 ln · topology_stress 1,936 · kds 1,877).
- [x] **Commit Baseline Record (Optional / Local note):** Keep record ready. → Kept as local note in `manager-2-journal.md` (Agent-3 section, D-A3), per "Optional" — no commit; measured at HEAD `38d08f115` (branch `0.0.37`), zero refactor-campaign commits existed at audit time; crates/oz-bridge absent.

> **Baseline record (Agent-3, 2026-09-10):** measurement commands and full output tails live in `manager-2-journal.md` § Objective: todo-refactor-oz-pos-app-agents-3.md / D-A3. Phase 3.1–3.4 are gated on Agent-2's `feat(bridge):` per-wave commits (wait protocol L28-33); battle plan accepted in journal (thin-shell Option A with recorded deviation, adjacent-test placement, per-wave slices A0–E5d).

---

### Phase 3.1: Unit Test Relocation (Follows Agent 2's Waves)

Move command unit tests out of the Tauri application target (`apps/desktop-client`) into `crates/oz-bridge`. This removes the need for `rustc` to compile Tauri, WebKitGTK, and GUI dependencies when running unit tests.

- [ ] **Wave A Tests (Catalog & Tax):**
  - [ ] *Wait Gate:* Check `git log --grep="feat(bridge): extract catalog and tax commands"`.
  - [ ] Move `categories_tests.rs`, `products_tests.rs`, `tax_tests.rs`, etc., from `apps/desktop-client/src/commands/` into `crates/oz-bridge/src/tests/` (or adjacent `*_tests.rs` in `oz-bridge`).
  - [ ] Update imports in test files from `crate::commands::*` to `oz_bridge::*`.
  - [ ] Run `cargo test -p oz-bridge -- catalog tax`.
  - [ ] **Commit Milestone:**
    ```bash
    git commit -m "test(bridge): relocate Wave A catalog and tax unit tests to oz-bridge"
    ```

- [ ] **Wave B Tests (CRM & Staff):**
  - [ ] *Wait Gate:* Check `git log --grep="feat(bridge): extract crm, auth, and staff commands"`.
  - [ ] Move `customers_tests.rs`, `loyalty_tests.rs`, `auth_tests.rs`, `staff_tests.rs` into `oz-bridge`.
  - [ ] Run `cargo test -p oz-bridge -- crm staff auth`.
  - [ ] **Commit Milestone:**
    ```bash
    git commit -m "test(bridge): relocate Wave B crm, auth, and staff unit tests to oz-bridge"
    ```

- [ ] **Wave C Tests (Inventory & Purchasing):**
  - [ ] *Wait Gate:* Check `git log --grep="feat(bridge): extract inventory and purchasing commands"`.
  - [ ] Move `inventory_tests.rs`, `stock_transfers_tests.rs`, `purchasing_tests.rs` into `oz-bridge`.
  - [ ] Run `cargo test -p oz-bridge -- inventory purchasing`.
  - [ ] **Commit Milestone:**
    ```bash
    git commit -m "test(bridge): relocate Wave C inventory and purchasing unit tests to oz-bridge"
    ```

- [ ] **Wave D Tests (POS, Shifts & Peripherals):**
  - [ ] *Wait Gate:* Check `git log --grep="feat(bridge): extract pos, kds, and hardware commands"`.
  - [ ] Move `pos_tests.rs`, `kds_tests.rs` (64 KB test file!), `hardware_tests.rs` into `oz-bridge`.
  - [ ] Run `cargo test -p oz-bridge -- pos kds hardware`.
  - [ ] **Commit Milestone:**
    ```bash
    git commit -m "test(bridge): relocate Wave D pos, kds, and hardware unit tests to oz-bridge"
    ```

- [ ] **Wave E Tests (Enterprise & Settings):**
  - [ ] *Wait Gate:* Check `git log --grep="feat(bridge): extract enterprise and settings commands"`.
  - [ ] Move `workspaces_tests.rs`, `locations_tests.rs`, `settings_tests.rs`, `license_tests.rs` into `oz-bridge`.
  - [ ] Run `cargo test -p oz-bridge`.
  - [ ] **Commit Milestone:**
    ```bash
    git commit -m "test(bridge): relocate Wave E enterprise and settings unit tests to oz-bridge"
    ```

---

### Phase 3.2: Consolidate `apps/desktop-client/src/lib.rs` into a Thin Shell

Once all commands delegate through `oz-bridge`, replace the monolithic 120-command list in `lib.rs` with clean domain router registrations or unified bridge handlers.

- [ ] *Wait Gate:* Ensure Agent 2 has completed Wave E and Agent 1 has completed daemon extractions.
- [ ] In `apps/desktop-client/src/lib.rs`:
  - Replace the 1,000-line `tauri::generate_handler![...]` with clustered modular handlers exposed by `oz-bridge` (or domain command modules):
    ```rust
    .invoke_handler(oz_bridge::tauri_handler())
    ```
- [ ] In `apps/desktop-client/Cargo.toml`:
  - Remove direct dependencies that are now encapsulated inside `oz-bridge` or `oz-lan` (`axum`, `lettre`, `snow`, `rusqlite`, etc. where possible).
- [ ] Verify frontend contracts:
  - `python scripts/verify-ipc-parity.py` (Must be 0 errors).
  - `bash scripts/verify-scoped-coverage.sh` (Must be PASS).
- [ ] Run `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(shell): consolidate desktop invoke_handler into thin oz-bridge router" apps/desktop-client/src/lib.rs apps/desktop-client/Cargo.toml
  ```

---

### Phase 3.3: Tablet Client Command Sharing (`apps/tablet-client`)

Eliminate code duplication between desktop and tablet shells.

- [ ] Add `oz-bridge` as a dependency in `apps/tablet-client/Cargo.toml`.
- [ ] Replace duplicated commands in `apps/tablet-client/src/commands/` with `oz-bridge` handlers.
- [ ] Run `cargo check -p oz-pos-tablet`.
- [ ] Verify `python scripts/verify-ipc-parity.py` against tablet registrations.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(tablet): reuse oz-bridge command handlers in tablet-client" apps/tablet-client/
  ```

---

### Phase 3.4: Re-enable `oz-pos-app` in Test Runners & Final Audit

Verify that the memory killer is permanently solved and all test suites pass.

- [ ] Run `cargo test -p oz-bridge` (verify execution finishes rapidly with low RAM).
- [ ] In `.circleci/workflows/06-cargo-nextest.yml` and `scripts/check.sh`, test running without `--exclude oz-pos-app`.
  - Confirm `oz_pos_app_lib` compiles in seconds because all unit tests have moved to `oz-bridge`.
- [ ] Run full project verification:
  - `npm run check:all` in `ui/`
  - `python scripts/verify-ipc-parity.py`
  - `cargo check --workspace`
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "ci(desktop): re-enable oz-pos-app in full nextest matrix post-refactor"
  ```
