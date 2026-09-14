# Orchestrator Agent 3: Test Relocation, Thin Shell & IPC Parity

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE-after-repair (every [x] re-confirmed landed; 15 numeric/reference corrections applied) · corrections applied: 15 · The worst error was not a count but a phantom CI system: L129/L132 sent the next worker to delete test excludes in `.circleci/workflows/06-cargo-nextest.yml:37`, a path that does not exist here (no `.circleci` directory on disk, `git ls-files | grep -c circleci` = 0) — the live Rust test job is `.github/workflows/dev-ci.yml`, whose nextest at :244 already carries no `--exclude`, and the only excludes left to remove are at `scripts/check.sh:106`; found by listing the tree and searching the git index rather than trusting the box. -->

**Document:** `todo-refactor-oz-pos-app-agents-3.md`  
**Role:** Orchestrator Agent 3 (The Closer & Auditor)  
**Goal:** Relocate unit tests from `apps/desktop-client/src/commands/` into `crates/oz-bridge` to eliminate memory bloat during test compilation, consolidate `apps/desktop-client/src/lib.rs` into a thin Tauri router, share handlers with `apps/tablet-client`, and perform full matrix parity verification.

**Sibling Documents:**
- `done-todo-refactor-oz-pos-app-agents-1.md` (Agent 1 — Infrastructure, Daemons & CI Stabilizer) — **retired/closed work order**; cite by bare name, the file may sit at the root or under the archive directory depending on checkout state
- `done-todo-refactor-oz-pos-app-agents-2.md` (Agent 2 — Core Command Middleware & `oz-bridge`) — **retired/closed work order**; same convention

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

- [x] Run `python scripts/verify-ipc-parity.py` and record exit code (must be 0). → **EXIT=0, "IPC parity: OK"**; re-run 2026-09-14 at HEAD `ec2edf258` (same exit 0): desktop 458 UI strings / 453 registered / 27 unregistered (27 allowlisted) · tablet 458/322/156 (157 allowlisted) · dev-mock 541 handlers, 16 allowlisted unanswerable · 24 allowlisted scoped orphans of which **2** are GATED DEAD SURFACE (`get_active_cart_scoped`, `list_active_carts_scoped`). The 2026-09-10 figures recorded here (452/448/27 · 534 handlers · 10 gated dead) are superseded.
- [x] Run `bash scripts/verify-scoped-coverage.sh` (must be PASS). → **EXIT=0, PASS: all registered commands covered** (Git-bash path, not WSL).
- [x] Record current lines of code in `apps/desktop-client/src/lib.rs` (Baseline: ~1,282 lines). → was **1,281 lines** at baseline; **1,349 today** (`wc -l < apps/desktop-client/src/lib.rs` at HEAD `ec2edf258`; a newline-split count reads 1,350 — convention, not error). `generate_handler!` begins at **lib.rs:843** (block ends :1338), and the list holds **453 command-path entries across 59 distinct module prefixes**, not 448/57. ⚠ The code carries the same rot: `lib.rs:21` still asserts "the 448-entry `tauri::generate_handler` list". That comment is outside this doc's fence — recorded here as a known follow-up for the shell owner.
- [x] Record current total file count in `apps/desktop-client/src/commands/` (Baseline: ~123 files). → baseline read **137 files** = 123 top-level + 14 under `topology/`, **70 `*_tests.rs` / 31,803 lines** (largest then: topology_command_tests 2,071 · topology_stress 1,936 · kds 1,877). That census is obsolete — Phase 3.1 has since landed. Re-measured 2026-09-14 (`find <dir> -name '*.rs' | wc -l`; sizes `wc -l`): **70 top-level + 9 under `topology/` = 79 `.rs` files**, of which **10 `*_tests.rs` totalling 5,873 lines** (a newline-split count reads 5,883). Largest now `registration_gate_tests.rs` **2,057** and `topology/topology_command_tests.rs` **1,732**; `kds_tests.rs` and most of `topology/` no longer live desktop-side.
- [x] **Commit Baseline Record (Optional / Local note):** Keep record ready. → Kept as local note in `docs/archived/manager-2-journal.md` (Agent-3 section, D-A3; moved from root at archival), per "Optional" — no commit; measured at HEAD `38d08f115` (branch `0.0.37`), zero refactor-campaign commits existed at audit time; and `crates/oz-bridge` was absent. That last clause is **no longer true and that is the point** — the crate now exists: `find crates/oz-bridge/src -name '*.rs' | wc -l` = **135 files** (121 top-level + 14 under `topology/`), including `pos_tests.rs` 1,479 · `kds_tests.rs` 1,651 · `settings_tests.rs` 1,925 · `staff_tests.rs` 1,514 · `topology/topology_stress_tests.rs` 1,910 (`wc -l`). Baseline kept as history; the relocation it predicted is done.

> **Baseline record (Agent-3, 2026-09-10):** measurement commands and full output tails live in `docs/archived/manager-2-journal.md` § Objective: todo-refactor-oz-pos-app-agents-3.md / D-A3. Phase 3.1–3.4 are gated on Agent-2's `feat(bridge):` per-wave commits (wait protocol L28-33); battle plan accepted in journal (thin-shell Option A with recorded deviation, adjacent-test placement, per-wave slices A0–E5d).
>
> **Re-measurement method (2026-09-14, HEAD `ec2edf258`, branch `main`):** every count above was taken through Git-bash (`C:/Program Files/Git/bin/bash.exe`) with `wc -l`, `find | wc -l`, `grep -c` and `sort -u`; handler-list counts by stripping `//` comments then splitting on commas; and `python scripts/verify-ipc-parity.py` plus `bash scripts/verify-scoped-coverage.sh` were re-run to EXIT=0 rather than quoted from memory. Where another session's figure differs by exactly 1 line per file, the cause is `wc -l` (counts newlines) vs a split-on-newline count, not a disagreement about the code. Counts in this file are volatile by nature — parallel sessions register commands and add tests continuously; re-run the named command before repeating any number.

---

### Phase 3.1: Unit Test Relocation (Follows Agent 2's Waves)

Move command unit tests out of the Tauri application target (`apps/desktop-client`) into `crates/oz-bridge`. This removes the need for `rustc` to compile Tauri, WebKitGTK, and GUI dependencies when running unit tests.

> **COMPLETION RECORD (Agent-3, 2026-09-13): all five waves CLOSED.** The wait-gate greps below were written against a commit-subject convention Agent 2 never used (the real convention is `feat(bridge): extract X into oz-bridge` / `into oz_bridge::x`, 65 commits bearing that subject prefix (`git log --oneline --grep "^feat(bridge)" | wc -l` = 65; 66 if the match is not anchored) — none of the five literal subjects exists except a coincidental devmock-ops match). The relocations were tracked by the *test-side* convention instead: 43 × `test(bridge): relocate …` commits, the last being `8630d50b9` (topology command subset). **Permanent desktop residue by ruling** (deviation register, journal D-A3.84/85): `authz_tests.rs` (9/9 assert desktop `AppError::PermissionDenied` values from desktop-side gate fns — class-3 cross-crate), `edc_tests.rs` (FCR-3 option-c deferral), `local_api_command_tests.rs` (Agent-1 stay), plus `registration_gate_tests.rs` / `kds_lan_live_tests.rs` (shell-surface and live-hardware suites, out of 3.1 scope by construction). Residue conservation verified at close: 16+39=55 tests accounted for — **this arithmetic could not be reproduced at HEAD `ec2edf258` and is kept as an at-close observation, not a current measurement** (the six surviving desktop-side files now hold **45** test fns between them: `authz_tests` 5 `#[test]` + 4 `#[tokio::test]` · `edc_tests` 5+3 · `local_api_command_tests` 0+9 · `registration_gate_tests` 12+0 · `kds_lan_live_tests` 0+5 · `settings_tests` 2+0; method `grep -cE '^\s*#\[(test\]|tokio::test\]'`). Also: single git identity for all window commits; attribution by subject-plan, never `%an`.
>
> **Re-measured 2026-09-14 — three register corrections.** (1) The register names 5 files but **6** survive: `settings_tests.rs` (163 ln, 2 `#[test]`, added by `ab7cd72d5` *test(settings): pin the read door refusing stripe.api_key in both shells*, 2026-09-13) was never listed. It is a **6th permanent residue file, not stragglers from a wave** — it pins the desktop shim's read door (and asserts `get_setting` reaches `oz_bridge::settings::run_get_setting`), which is shell-surface work exactly like `registration_gate_tests.rs`. (2) `authz_tests.rs`'s "9/9" is **5 `#[test]` + 4 `#[tokio::test]`** fns — the count 9 holds, but there are no `rstest`/`#[case]` markers on disk; `grep -c '^#\[test\]'` alone returns 5. (3) The commit-count folklore: "66+ commits" is 65 subjects beginning `feat(bridge):` / 66 matching anywhere in the subject (`git log --oneline --grep "^feat(bridge)" | wc -l` = 65); **"43 × `test(bridge): relocate …`" reproduces exactly** (`git log --oneline --grep "test(bridge): relocate" | wc -l` = 43, newest = `8630d50b9`). Every one of the 58 short SHAs cited in this file resolves as a commit (`git cat-file -e <sha>^{commit}`) at both 9- and 10-char forms, so they are left untouched.

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

> **COMPLETION RECORD (Agent-3, 2026-09-13): CLOSED at `6cdd7d3b89` (2026-09-11). RECORDED DEVIATION — Option A:** the `oz_bridge::tauri_handler()` replacement from the pre-record plan text landed as a deliberate NO-OP. (The old cross-reference "named at L110-114" is now stale — those lines are Phase 3.3 prose; no `tauri_handler()` step survives in this file outside this sentence.) The **453**-entry `tauri::generate_handler!` list STAYS (measured 2026-09-14; `lib.rs:843-1338`): the three verification gates (IPC parity `verify-ipc-parity.py` first-`]` parse, `verify-scoped-coverage.sh`, and the registration-gate ratchet) all read that macro verbatim, so collapsing it breaks three green gates for zero measured benefit (the shell is already thin — every body lives in `oz_bridge::`). The wave's real substance was the DEP PRUNE: `axum`, `lettre`, `snow` removed from `apps/desktop-client/Cargo.toml` (0 refs each in desktop src); `rusqlite` stays (53 refs across 24 files — `grep -rn rusqlite apps/desktop-client/src --include=*.rs`; the baseline said 48/24, so the file count held and the ref count moved). Option D (rewriting the gate scripts to parse a new shape) stays PARKED for the gate owner. Gates at close: parity 452/448/27, scoped-coverage PASS, `cargo check -p oz-pos-app` green. Re-run 2026-09-14: parity **458/453/27** EXIT=0, scoped-coverage still `PASS: all registered commands covered` (EXIT=0).

- [x] *Wait Gate:* Agent 2's Wave E complete (all real-wave `feat(bridge): extract` subjects present, see 3.1 record) and Agent 1's daemon extractions landed (local_api/pg_sync daemons stay in-shell by design — see lib.rs:20 module note).
- [x] In `apps/desktop-client/src/lib.rs`: the handler-block replacement is the recorded Option-A no-op above; the module-level doc (`lib.rs:20`) carries the shell/daemon-residue note instead.
- [x] In `apps/desktop-client/Cargo.toml`: `axum`, `lettre`, `snow` removed (`6cdd7d3b89`, −3 dep lines + lock refresh).
- [x] Frontend contracts verified: `python scripts/verify-ipc-parity.py` → EXIT=0 (452/448/27 at close; **458/453/27** re-measured 2026-09-14, still EXIT=0); `bash scripts/verify-scoped-coverage.sh` → PASS (re-run 2026-09-14: PASS, EXIT=0).
- [x] `cargo check -p oz-pos-app` green at close.
- [x] **Commit Milestone:** `refactor(shell): consolidate desktop invoke_handler into thin oz-bridge router` = `6cdd7d3b89` (subject verbatim; pathspec was lib.rs + Cargo.toml + Cargo.lock).

---

### Phase 3.3: Tablet Client Command Sharing (`apps/tablet-client`)

Eliminate code duplication between desktop and tablet shells.

> **PROGRESS RECORD (Agent-3, 2026-09-13): T1 contract slice LANDED at `eb4fdd07c1` (health repoint + `From<BridgeError>` seam + oz-bridge dep). T2 LANDED at `7a7c1c3dc2` (void/browser/scale wire contracts shared — closed a tablet-only wire bug: the UI sends camelCase `args: { saleId, reason }`; the old local `VoidSaleScopedArgs` was snake_case-only). T3 LANDED at `e821c2814b` (regional+local_payment DTOs shared — closed a **three-shell wire bug** dating to slice 6: `LocalPaymentRailArgs` declared `rename_all = "camelCase"` on desktop, bridge, and tablet while the only UI caller has always sent snake_case, so the settings card's save never worked on a real backend; fixed in the shared bridge DTO with back-compat aliases + the first wire-deserialization tests). The phase remains OPEN — later slices queued (the bigs: pos/staff/auth/products/settings, **wire-audit first**: the shared-DTO pattern is 2-for-2 on hidden casing bugs). T2's other findings: the tablet `AppState` → `BridgeCtx` seam was measured field-by-field and deferred with evidence (7/14 fields match; Arc-ing `db`/`terminal_id` is mechanical; `plugins` would drag the mlua Lua VM into the Android APK for a forever-`None` field — needs an Agent-2-fence decision); the T1 `Cargo.lock` deviation resolved (the tablet `oz-bridge` lock row landed with T2). Phase-closing note: the sync-conflict parity repair (`ded4686776`) was performed under this phase's fence before T1 — it ports desktop's list/resolve sync-conflict commands into the tablet shell (in-shell, gated `SYNC_MANAGE` on both) and repaired both registration-gate ratchets.

- [x] Add `oz-bridge` as a dependency in `apps/tablet-client/Cargo.toml`. → `eb4fdd07c1` (workspace alias existed; root Cargo.toml untouched).
- [x] Replace duplicated commands in `apps/tablet-client/src/commands/` with `oz-bridge` handlers. → T1: `health.rs` repointed (ping/version/get_device_id/get_local_ip forward to `oz_bridge::health`; identity constants still resolve in the tablet shim so About answers "oz-pos-tablet"); `authz.rs` gained the `From<BridgeError> for AppError` seam. Remaining domains queued (see record above).
- [x] Run `cargo check -p oz-pos-tablet`. → CLEAN, 0 warnings at `eb4fdd07c1`.
- [x] Verify `python scripts/verify-ipc-parity.py` against tablet registrations. → tablet-side info line green. **Resolved tablet figure: 322 registered command paths**, block `apps/tablet-client/src/lib.rs:445-784` in a 796-line file (`wc -l`), 156 unregistered names / 157 allowlisted / 0 unregistered tauri fns. This replaces the two conflicting numbers previously in this file (L43's "tablet … 318" and this box's "320 registered"), and a third figure circulating in another session — **338 entries — could not be reproduced at HEAD `ec2edf258`**: four independent counts (comma-token split, trailing-comma lines, comment-stripped tokens, whole-file `commands::` token grep) all return 322, as does the gate itself. Method note for the next reader: ask the question you are answering — *distinct registered `commands::<mod>::<fn>` paths* = 322 here, and there is no duplicate-entry variant to compare it against (`uniq -d` on the block is empty); a *lines-in-block* count reads 324. Cross-shell caution: `settings` registers **28** commands on tablet vs **19** on desktop, so never quote one settings count for both shells. The 2 desktop-side violations observed at T1 verify-time (`get/save_kds_routing_rules_scoped`) are now registered at `apps/desktop-client/src/lib.rs:1032-1033` — closed history, not this phase's debt.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(tablet): reuse oz-bridge command handlers in tablet-client" apps/tablet-client/
  ```
  → `eb4fdd07c1` (subject verbatim; pathspec narrowed to the 3 files changed — `apps/tablet-client/Cargo.toml`, `commands/health.rs`, `commands/authz.rs`).

---

### Phase 3.4: Re-enable `oz-pos-app` in Test Runners & Final Audit

Verify that the memory killer is permanently solved and all test suites pass.

> **STATUS (Agent-3, 2026-09-13): NOT STARTED, deliberately unselected by the user in the 2026-09-13 resume round.** Scope is already known: remove `--exclude oz-pos-app` AND `--exclude oz-pos-tablet` from **`scripts/check.sh:106`** — the one and only place either exclude exists (`grep -n -- "--exclude oz-pos" scripts/check.sh` → line 106, both flags, one `step` line). The file this box used to name, `.circleci/workflows/06-cargo-nextest.yml:37`, **does not exist in this repository**: there is no `.circleci` directory and no CircleCI path in the git index (`git ls-files | grep -c circleci` = 0); the two live workflows are `.github/workflows/dev-ci.yml` and `release.yml`. The live Rust test job is `dev-ci.yml#cargo-nextest`, whose `cargo nextest run --workspace --all-features` at **`dev-ci.yml:244`** already carries **no `--exclude`** — CI therefore already tests both app crates and has been doing so; only `check.sh` skips them. Then prove the full matrix green — including `cargo nextest run --workspace`, which CI already runs without excludes. Prerequisite: the permanent desktop residue suites (3.1 register, now **6** files) must keep `oz_pos_app_lib` compiling within the low-memory envelope; the residue is test-mount light, so the risk is measured, not assumed.

- [ ] Run `cargo test -p oz-bridge` (verify execution finishes rapidly with low RAM).
- [ ] In `scripts/check.sh` (line 106 — there is **no `.circleci/` in this repo**; the earlier text of this box named a file that never existed), test running without `--exclude oz-pos-app` and `--exclude oz-pos-tablet`.
  - Confirm `oz_pos_app_lib` compiles in seconds because all unit tests have moved to `oz-bridge`.
- [ ] Run full project verification:
  - `npm run check:all` in `ui/`
  - `python scripts/verify-ipc-parity.py`
  - `cargo check --workspace`
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "ci(desktop): re-enable oz-pos-app in full nextest matrix post-refactor"
  ```
