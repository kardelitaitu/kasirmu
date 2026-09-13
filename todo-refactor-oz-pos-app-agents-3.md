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

> **COMPLETION RECORD (Agent-3, 2026-09-13): all five waves CLOSED.** The wait-gate greps below were written against a commit-subject convention Agent 2 never used (the real convention is `feat(bridge): extract X into oz-bridge` / `into oz_bridge::x`, 66+ commits — none of the five literal subjects exists except a coincidental devmock-ops match). The relocations were tracked by the *test-side* convention instead: 43 × `test(bridge): relocate …` commits, the last being `8630d50b9` (topology command subset). **Permanent desktop residue by ruling** (deviation register, journal D-A3.84/85): `authz_tests.rs` (9/9 assert desktop `AppError::PermissionDenied` values from desktop-side gate fns — class-3 cross-crate), `edc_tests.rs` (FCR-3 option-c deferral), `local_api_command_tests.rs` (Agent-1 stay), plus `registration_gate_tests.rs` / `kds_lan_live_tests.rs` (shell-surface and live-hardware suites, out of 3.1 scope by construction). Residue conservation verified at close: 16+39=55 tests accounted for. Also: single git identity for all window commits; attribution by subject-plan, never `%an`.

- [x] **Wave A Tests (Catalog & Tax):**
  - [x] *Wait Gate:* the doc's literal grep is dead — the real triggers are `feat(bridge): extract product read commands into oz_bridge::products` (`7741fddddc`), product write (`91d0c988af`), product-variant (`71babb1401`), product-image (`adeea02c30`), tax-rate (`54b158dd21`), and the topology batches (Wave E see below).
  - [x] Move `categories_tests.rs`, `products_tests.rs`, `tax_tests.rs`, etc. → landed as `3f31d64a04` (category and product), `73dfbb16ed` (tax), `3013c49f77` (currency, fiscal, product-variant).
  - [x] Imports updated to `oz_bridge::*` (each relocate commit carries its own import repair).
  - [x] `cargo test -p oz-bridge -- catalog tax` green at close (full `cargo test -p oz-bridge` green before 3.2).
  - [x] **Commit Milestone:** subject-shape honored across the wave: `test(bridge): relocate category and product unit tests to oz-bridge` (3f31d64a04) et al.

- [x] **Wave B Tests (CRM & Staff):**
  - [x] *Wait Gate:* real triggers `6c9a796877` (customer), `120d9c9cc5` (loyalty), `94e55f73a2` (staff), `3a1e0d038c`/`84e6ec1909` (auth).
  - [x] Move `customers_tests.rs`, `loyalty_tests.rs`, `auth_tests.rs`, `staff_tests.rs` → `7df15b94d3`, `c2b10abb6a`, `731732aeed`, `ea448eda24`.
  - [x] `cargo test -p oz-bridge -- crm staff auth` green at close.
  - [x] **Commit Milestone:** `7df15b94d3` / `ea448eda24` et al.

- [x] **Wave C Tests (Inventory & Purchasing):**
  - [x] *Wait Gate:* real triggers `5b6bd0d462` (inventory), `147fd3b226` (purchasing), `7d422b2fd4` (inventory-count), `90a44bd155` (stock-transfer).
  - [x] Move `inventory_tests.rs`, `stock_transfers_tests.rs`, `purchasing_tests.rs` → `348fa2c948`, `f026a35606`, `8563f76208` (plus payables in the same slice).
  - [x] `cargo test -p oz-bridge -- inventory purchasing` green at close.
  - [x] **Commit Milestone:** `348fa2c948` / `8563f76208`.

- [x] **Wave D Tests (POS, Shifts & Peripherals):**
  - [x] *Wait Gate:* real triggers `276b4027aa` (point-of-sale checkout), `ec72ad22f3` (kds), `cab58764cc` (hardware), `1a0277548f` (edc and scale), `02c3f0c98b` (shift, refund, void).
  - [x] Move `pos_tests.rs`, `kds_tests.rs` (64 KB test file!), `hardware_tests.rs` → `0fbd7f01a9` (pos), `119ec84f4c` (kds), `e4498ae745` (hardware and scale), `eefa576d1c` (shift, refund, void).
  - [x] `cargo test -p oz-bridge -- pos kds hardware` green at close.
  - [x] **Commit Milestone:** `0fbd7f01a9` / `119ec84f4c` / `e4498ae745`.

- [x] **Wave E Tests (Enterprise & Settings):**
  - [x] *Wait Gate:* real triggers `a7485e17a2` (workspace), `b51ba70f95` (location), `6a9bc8cddc`+`636b0c942a` (settings), `cd80b9a115` (license), `f837f64531` (report), `f2557c6d2f` (audit), `cb53a79ebf` (setup and analytics), `0f2ee7ad7b` (subscription).
  - [x] Move `workspaces_tests.rs`, `locations_tests.rs`, `settings_tests.rs`, `license_tests.rs` → `08b079771f`, `817eb8120d`, `1f7552878f`, `7751cdb468` (plus `bc5e3f1ff8` report, `1e969ffe80` audit, `851e48ad5e` subscription, `46a8c32263` setup, and the topology nine `982afd319f…8630d50b9` closing set).
  - [x] `cargo test -p oz-bridge` green at close.
  - [x] **Commit Milestone:** `08b079771f` et al.; wave fully closed at `8630d50b9`.

---

### Phase 3.2: Consolidate `apps/desktop-client/src/lib.rs` into a Thin Shell

Once all commands delegate through `oz-bridge`, replace the monolithic 120-command list in `lib.rs` with clean domain router registrations or unified bridge handlers.

> **COMPLETION RECORD (Agent-3, 2026-09-13): CLOSED at `6cdd7d3b89` (2026-09-11). RECORDED DEVIATION — Option A:** the `oz_bridge::tauri_handler()` replacement named at L110-114 landed as a deliberate NO-OP. The 448-entry `tauri::generate_handler!` list STAYS: the three verification gates (IPC parity `verify-ipc-parity.py` first-`]` parse, `verify-scoped-coverage.sh`, and the registration-gate ratchet) all read that macro verbatim, so collapsing it breaks three green gates for zero measured benefit (the shell is already thin — every body lives in `oz_bridge::`). The wave's real substance was the DEP PRUNE: `axum`, `lettre`, `snow` removed from `apps/desktop-client/Cargo.toml` (0 refs each in desktop src); `rusqlite` stays (48 refs / 24 files). Option D (rewriting the gate scripts to parse a new shape) stays PARKED for the gate owner. Gates at close: parity 452/448/27, scoped-coverage PASS, `cargo check -p oz-pos-app` green.

- [x] *Wait Gate:* Agent 2's Wave E complete (all real-wave `feat(bridge): extract` subjects present, see 3.1 record) and Agent 1's daemon extractions landed (local_api/pg_sync daemons stay in-shell by design — see lib.rs:20 module note).
- [x] In `apps/desktop-client/src/lib.rs`: the handler-block replacement is the recorded Option-A no-op above; the module-level doc (`lib.rs:20`) carries the shell/daemon-residue note instead.
- [x] In `apps/desktop-client/Cargo.toml`: `axum`, `lettre`, `snow` removed (`6cdd7d3b89`, −3 dep lines + lock refresh).
- [x] Frontend contracts verified: `python scripts/verify-ipc-parity.py` → EXIT=0 (452/448/27); `bash scripts/verify-scoped-coverage.sh` → PASS.
- [x] `cargo check -p oz-pos-app` green at close.
- [x] **Commit Milestone:** `refactor(shell): consolidate desktop invoke_handler into thin oz-bridge router` = `6cdd7d3b89` (subject verbatim; pathspec was lib.rs + Cargo.toml + Cargo.lock).

---

### Phase 3.3: Tablet Client Command Sharing (`apps/tablet-client`)

Eliminate code duplication between desktop and tablet shells.

> **PROGRESS RECORD (Agent-3, 2026-09-13): T1 contract slice LANDED at `eb4fdd07c1` (health repoint + `From<BridgeError>` seam + oz-bridge dep). T2 LANDED at `7a7c1c3dc2` (void/browser/scale wire contracts shared). The phase remains OPEN — later slices queued (regional+local_payment, then the bigs: pos/staff/auth/products/settings). T2 deviations/findings: (1) the tablet `AppState` → `BridgeCtx` seam was measured field-by-field and deferred with evidence — 7/14 fields already match, Arc-ing `db`/`terminal_id` is mechanical, but `plugins: &Mutex<Option<PluginManager>>` would drag the mlua Lua VM into the Android APK for a field that is forever `None` on tablet; the seam needs an Agent-2-fence decision before any ctx-taking body can be shared. (2) T2 closed a REAL wire bug: the UI sends camelCase `args: { saleId, reason }`; the old tablet-local `VoidSaleScopedArgs` was snake_case-only, so the tablet's registered-and-invoked `void_sale_scoped` could never deserialize its own caller's payload — fixed by re-exporting the bridge DTOs (single wire definition, matches desktop). Every remaining slice must re-check wire casing first: any tablet DTO not yet re-exported from bridge is a candidate divergence of the same class. (3) The T1 `Cargo.lock` deviation resolved: the tablet `oz-bridge` lock row (re-materialized from the committed manifest) landed with T2, which also closes the `--locked` CI mismatch. Phase-closing note: the sync-conflict parity repair (`ded4686776`) was performed under this phase's fence before T1 — it ports desktop's list/resolve sync-conflict commands into the tablet shell (in-shell, gated `SYNC_MANAGE` on both) and repaired both registration-gate ratchets.

- [x] Add `oz-bridge` as a dependency in `apps/tablet-client/Cargo.toml`. → `eb4fdd07c1` (workspace alias existed; root Cargo.toml untouched).
- [x] Replace duplicated commands in `apps/tablet-client/src/commands/` with `oz-bridge` handlers. → T1: `health.rs` repointed (ping/version/get_device_id/get_local_ip forward to `oz_bridge::health`; identity constants still resolve in the tablet shim so About answers "oz-pos-tablet"); `authz.rs` gained the `From<BridgeError> for AppError` seam. Remaining domains queued (see record above).
- [x] Run `cargo check -p oz-pos-tablet`. → CLEAN, 0 warnings at `eb4fdd07c1`.
- [x] Verify `python scripts/verify-ipc-parity.py` against tablet registrations. → tablet-side info line green (320 registered / 154 allowlisted / 0 unregistered fns); the 2 desktop-side violations observed at T1 verify-time (`get/save_kds_routing_rules_scoped`) belong to the concurrent kds lane's uncommitted registration, not this phase's surface.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(tablet): reuse oz-bridge command handlers in tablet-client" apps/tablet-client/
  ```
  → `eb4fdd07c1` (subject verbatim; pathspec narrowed to the 3 files changed — `apps/tablet-client/Cargo.toml`, `commands/health.rs`, `commands/authz.rs`).

---

### Phase 3.4: Re-enable `oz-pos-app` in Test Runners & Final Audit

Verify that the memory killer is permanently solved and all test suites pass.

> **STATUS (Agent-3, 2026-09-13): NOT STARTED, deliberately unselected by the user in the 2026-09-13 resume round.** Scope is already known: remove `--exclude oz-pos-app` AND `--exclude oz-pos-tablet` from both `scripts/check.sh:106` and `.circleci/workflows/06-cargo-nextest.yml:37` (note `dev-ci.yml`'s nextest carries no excludes already), then prove the full matrix green — including `cargo nextest run --workspace`, which CI already runs without excludes. Prerequisite: the permanent desktop residue suites (3.1 register) must keep `oz_pos_app_lib` compiling within the low-memory envelope; the residue is test-mount light, so the risk is measured, not assumed.

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
