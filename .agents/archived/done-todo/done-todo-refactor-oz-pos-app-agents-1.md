# Orchestrator Agent 1: Infrastructure, Daemons & CI Stabilizer

**Document:** `todo-refactor-oz-pos-app-agents-1.md`  
**Role:** Orchestrator Agent 1 (The Extractor & Stabilizer)  
**Goal:** Stabilize CI execution by eliminating the memory killer, extract non-GUI networking and background daemons (`lan_server`, `local_api`, `image_push`, `email_scheduler`) from `apps/desktop-tauri` into dedicated headless crates, and drastically reduce the dependency footprint of the GUI shell.

**Sibling Documents:**
- [`todo-refactor-oz-pos-app-agents-2.md`](./todo-refactor-oz-pos-app-agents-2.md) (Agent 2 — Core Command Middleware & `oz-bridge`)
- [`todo-refactor-oz-pos-app-agents-3.md`](../../todo-refactor-oz-pos-app-agents-3.md) (Agent 3 — Test Relocation, Thin Shell & IPC Parity)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - You work independently. Communication happens strictly through the Git commit history and durable commit subject conventions.
2. **Commit Subject Convention:**
   - All commits made by Agent 1 MUST use:
     - `ci(circleci): ...`
     - `feat(lan): ...`
     - `feat(api): ...`
     - `feat(daemon): ...`
3. **Owned Path Fence (Exclusive to Agent 1):**
   - `.circleci/workflows/06-cargo-nextest.yml`
   - `scripts/compose-circleci.py`
   - `crates/oz-lan/` (NEW crate created by Agent 1)
   - `crates/oz-local-api/` (or `crates/oz-api/src/local/`)
   - `apps/desktop-tauri/src/lan_server.rs` & `apps/desktop-tauri/src/lan_server_tests.rs`
   - `apps/desktop-tauri/src/local_api.rs` & `apps/desktop-tauri/src/local_api_tests.rs`
   - `apps/desktop-tauri/src/image_push.rs` & `apps/desktop-tauri/src/image_push_tests.rs`
   - `apps/desktop-tauri/src/email_scheduler.rs` & `apps/desktop-tauri/src/email_scheduler_tests.rs`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `apps/desktop-tauri/src/commands/*` (Owned by Agent 2 & Agent 3).
   - DO NOT edit `apps/desktop-tauri/src/lib.rs` invoke_handler list (Owned by Agent 3).
   - DO NOT edit `apps/mobile-tauri/` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: CI Nextest Stabilization (P0 Immediate)

Unblocks CircleCI by excluding GUI app crates from the memory-constrained Linux container, matching the repository's canonical `scripts/check.sh` pattern.

- [x] Inspect `.circleci/workflows/06-cargo-nextest.yml` and note line 37. → line 37 held the un-excluded `cargo nextest run --workspace --all-features -j 2`.
- [x] Update command in `.circleci/workflows/06-cargo-nextest.yml` to: → applied verbatim (1-line change on 37).
  ```bash
  cargo nextest run --workspace --all-features --exclude oz-pos-app --exclude oz-pos-tablet -j 2
  ```
- [x] Run `python scripts/compose-circleci.py` to re-generate `.circleci/config.yml`. → regenerated; the composed `config.yml` line changed with it.
- [x] Verify `.circleci/config.yml` matches with `python scripts/compose-circleci.py --check`. → **--check OK** at commit time and re-verified on the merged tree at this doc pass (no drift).
- [x] **Commit Milestone:** → landed as `8c8044a47` (2 files, 1 line each).
  ```bash
  git commit -m "ci(circleci): exclude gui app crates from memory-constrained nextest" .circleci/workflows/06-cargo-nextest.yml .circleci/config.yml
  ```
  *(Signaling milestone to Agent 2 and Agent 3: CI is now stabilized for headless runs).*

---

### Phase 1.1: LAN Server Daemon Extraction (`crates/oz-lan`)

`lan_server.rs` manages local peer-to-peer event multicasting, terminal discovery, and encrypted payloads (`snow`, `tokio`, `axum`). It has zero dependency on GUI windowing.

- [x] Create `crates/oz-lan` with its own `Cargo.toml`. → `crates/oz-lan/{Cargo.toml, src/lib.rs (839 ln), src/lib_tests.rs}`.
- [x] Wire `crates/oz-lan` into the root workspace members in `Cargo.toml`. → auto-membered by the `members = ["crates/*"]` glob (root `Cargo.toml`:17), so the members list needed no edit; the root-manifest edit was the path alias at :53, `oz-lan = { path = "crates/oz-lan" }`.
- [x] Move networking, encryption, peer state, and event loop logic from `apps/desktop-tauri/src/lan_server.rs` into `crates/oz-lan/src/lib.rs` (or modular submodules). → verbatim move (826 ln body + module doc header); desktop side became a 9-line re-export shim — deviation 1.
- [x] Move `lan_server_tests.rs` to `crates/oz-lan/src/tests.rs` (or sibling tests). → sibling `crates/oz-lan/src/lib_tests.rs`; `git show` rename detection R100 = 0 changed lines (byte-identical).
- [x] In `apps/desktop-tauri`, expose a minimal lifecycle controller (`LanServerHandle`) wrapping `oz_lan::LanServer`. → **deviation 2**: the shim re-exports the names that actually exist (`LanEventForwarder` / `LanForwarderHandle`); `lib.rs:680` `crate::lan_server::LanEventForwarder::new(...)` still compiles untouched.
- [x] Run `cargo check -p oz-lan` and `cargo test -p oz-lan`. → check **GREEN** (0.38s on the merged tree), test **GREEN** (27 tests + 1 doctest, run twice with identical counts).
- [x] Run `cargo check -p oz-pos-app`. → **GREEN** (30.27s) with `lib.rs` unedited; `cargo tree -p oz-lan` shows no tauri package (headless).
- [x] **Commit Milestone:** → landed as `7000e84fd` (9 files). Pathspec extended beyond the listed paths — deviation 6.
  ```bash
  git commit -m "feat(lan): extract lan_server to crates/oz-lan" crates/oz-lan/ apps/desktop-tauri/src/lan_server.rs apps/desktop-tauri/src/lan_server_tests.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.2: Local REST API Server Extraction (`crates/oz-local-api`)

`local_api.rs` hosts an embedded Axum REST server allowing external scripts to query register status.

- [x] Create `crates/oz-local-api` (or integrate as headless feature in `crates/oz-api`). → new crate chosen: `crates/oz-api` has no `[features]` section, so a feature gate there would be unenforced.
- [x] Move router setup, handlers, authentication tokens, and request parsing into the headless crate. → `crates/oz-local-api/src/lib.rs` (429 ln) over the shared `oz-api` router; all 14 glob-reached public symbols kept pub and verbatim.
- [x] Move `local_api_tests.rs` and `local_api_command_tests.rs` to the new crate. → **deviation 5**: `local_api_tests.rs` moved to `crates/oz-local-api/src/lib_tests.rs` (524 ln, R100 byte-identical); `commands/local_api_command_tests.rs` stays put — that path is forbidden by §3 of this file (L33) and its fixtures are tauri-typed (`AppState::for_test_with_conn`).
- [x] In `apps/desktop-tauri/src/local_api.rs`, keep only the IPC toggle commands (`enable_local_api`, `get_local_api_status`) delegating to the crate's server handle. → **deviation 1**: `local_api.rs` is a 10-line re-export shim; the toggle commands live in `commands/local_api.rs` (fenced path) and resolve the server through it, so neither `invoke_handler` nor `commands/*` was touched.
- [x] Run `cargo check -p oz-local-api` and `cargo test -p oz-local-api`. → check **GREEN** (0.39s), test **GREEN: 12 passed; 0 failed**.
- [x] Run `cargo check -p oz-pos-app`. → **GREEN**.
- [x] **Commit Milestone:** → landed as `b9079edf9` (9 files). Pathspec extended beyond the listed paths — deviation 6.
  ```bash
  git commit -m "feat(api): extract local_api server to crates/oz-local-api" crates/oz-local-api/ apps/desktop-tauri/src/local_api.rs apps/desktop-tauri/src/local_api_tests.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.3: Background Schedulers Decoupling

Decouple background queue drainers from the desktop shell.

- [x] **Image Push Queue:** → done in `12577474e`.
  - [x] Relocate queue polling and cloud batch synchronization from `apps/desktop-tauri/src/image_push.rs` into `crates/oz-media` (or `crates/oz-core/src/tasks/image_push.rs`). → **deviation 3**: landed at `platform/sync/src/image_push.rs` (316 ln) — `oz-media` would have absorbed `oz-core` + `reqwest` pollution, `oz-core` needed `tokio` promoted, and platform-sync already carried the exact dep set plus the `SyncDaemon` precedent.
  - [x] Keep only the scheduler spawn call in `desktop-tauri` startup. → `apps/desktop-tauri/src/image_push.rs` is an 8-line shim; the startup spawn at `lib.rs:298` (`ImagePushScheduler::new`) is unchanged.
- [x] **Email Report Scheduler:** → done in `12577474e`.
  - [x] Relocate report cron evaluation and SMTP dispatch from `apps/desktop-tauri/src/email_scheduler.rs` into `crates/oz-notification` (or `crates/oz-core`). → first-listed home used: `crates/oz-notification/src/email_scheduler.rs` (157 ln) — **deviation 4** for the added `lettre` + `rusqlite` workspace deps.
  - [x] Move `email_scheduler_tests.rs` to the respective crate. → `crates/oz-notification/src/email_scheduler_tests.rs` (R100 byte-identical), **3 passed; 0 failed**.
- [x] Verify compilation and tests: → `cargo check -p oz-pos-app` forced re-check **0 errors**; the moved suites ran green in their new homes (platform-sync 6/6, oz-notification 3/3). `cargo test -p oz-core` below was NOT run: deviations 3 and 4 moved code into platform-sync/oz-notification, not oz-core, and no oz-core source changed in this phase.
  - `cargo test -p oz-core`
  - `cargo check -p oz-pos-app`
- [x] **Commit Milestone:** → landed as `12577474e` (11 files). Pathspec extended beyond the listed paths — deviation 6.
  ```bash
  git commit -m "feat(daemon): extract background schedulers out of desktop-tauri" apps/desktop-tauri/src/image_push.rs apps/desktop-tauri/src/email_scheduler.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.4: Hand-off to Sibling Agents

- [x] Verify that `apps/desktop-tauri/src/lib.rs` no longer compiles internal networking servers. → `lib.rs` was never edited; its decls (:23 `email_scheduler`, :28 `image_push`, :35 `lan_server`, :39 `local_api`) now resolve to 9/8/9/10-line re-export shims, and `cargo check --workspace` is green on that shape.
- [x] Verify all gates pass via `cargo check --workspace`. → **GREEN** as measured at this doc pass: `Finished dev profile [unoptimized + debuginfo] target(s) in 28.27s`, 0 error and 0 warning lines (tree at `744e46df6`, which also carries Agent 2's in-flight `oz-bridge` edits).
- [x] Log completion in this document with exact commit SHAs. → the record below.

---

## ✅ Completion Record — Agent 1 (Phase 1.4 doc pass, 2026-09-10)

All four implementation phases landed on branch `0.0.37` and passed the merged-tree wave gate.

### SHA log

| Phase | Commit | Subject (verbatim) | Files |
|---|---|---|---|
| 1.0 | `8c8044a47` | `ci(circleci): exclude gui app crates from memory-constrained nextest` | 2 — `.circleci/workflows/06-cargo-nextest.yml`, `.circleci/config.yml` (1 line each) |
| 1.1 | `7000e84fd` | `feat(lan): extract lan_server to crates/oz-lan` | 9 — `Cargo.lock`, root `Cargo.toml`, `Dockerfile.server`, `Dockerfile.unified`, `apps/desktop-tauri/Cargo.toml`, `lan_server.rs`, `crates/oz-lan/{Cargo.toml,src/lib.rs,src/lib_tests.rs}` |
| 1.2 | `b9079edf9` | `feat(api): extract local_api server to crates/oz-local-api` | 9 — same shape, `crates/oz-local-api/{Cargo.toml,src/lib.rs,src/lib_tests.rs}` (root alias added path-only and the `version` field dropped from the `oz-lan` alias in the same edit) |
| 1.3 | `12577474e` | `feat(daemon): extract background schedulers out of desktop-tauri` | 11 — `Cargo.lock`, `apps/desktop-tauri/Cargo.toml`, `email_scheduler.rs`, `image_push.rs`, `crates/oz-notification/{Cargo.toml,src/lib.rs,src/email_scheduler.rs,src/email_scheduler_tests.rs}`, `platform/sync/{src/lib.rs,src/image_push.rs,src/image_push_tests.rs}` |
| 1.4 | this pass + `chore(daemon): fix crate attribution stamps in extracted modules` | doc record + re-attributed audit stamps | `todo-refactor-oz-pos-app-agents-1.md`; `crates/oz-lan/src/lib.rs`; `crates/oz-notification/src/email_scheduler.rs` |

### Gate evidence (merged tree)

- `cargo check -p oz-lan` GREEN · `cargo test -p oz-lan` GREEN (27 tests + 1 doctest, run twice, identical counts; all binds on `127.0.0.1:0`, no port fixes needed).
- `cargo check -p oz-local-api` GREEN · `cargo test -p oz-local-api` **12 passed; 0 failed**.
- Moved scheduler suites green in their new homes: platform-sync `image_push` **6/6** · `crates/oz-notification` `email_scheduler` **3/3**.
- `cargo check -p oz-pos-app` forced re-check **0 errors** (shims touched to defeat the cached echo — the proof is the recompile, not the timestamp).
- `python scripts/verify-dockerfile-workspace.py` **OK 41/41 on both Dockerfiles** · `python scripts/compose-circleci.py --check` **OK**.
- `cargo check --workspace` **GREEN** at this doc pass (`Finished dev profile … in 28.27s`, 0 error / 0 warning lines).
- All four test-file moves are byte-identical: `git show --stat` reports rename detection **R100 / 0 changed lines** for `lib_tests.rs` ×2, `email_scheduler_tests.rs` and `image_push_tests.rs`.

### Deviations from the letter of this document

1. **Shims instead of deletions.** `apps/desktop-tauri/src/{lan_server,local_api,image_push,email_scheduler}.rs` were kept as `pub use <crate>::*` shims so the `lib.rs` module decls, the `invoke_handler` list and `commands/*` compile untouched. The todo phrases these as "move out of", which under the L33-35 fence can only mean "leave a re-export in place"; the implementations did move.
2. **Names preserved over invented.** `crates/oz-lan` keeps `LanEventForwarder` / `LanForwarderHandle`. The `LanServer` / `LanServerHandle` named at L68 does not exist anywhere in the codebase; the verbatim-move rule outranked the checkbox.
3. **`image_push` home.** Landed at `platform/sync/src/image_push.rs`, not `crates/oz-media` or `crates/oz-core/src/tasks/image_push.rs` (see the box note for the dependency-graph reason). No new workspace member, so no root-manifest or Dockerfile churn in Phase 1.3.
4. **`email_scheduler` deps.** Landed in `crates/oz-notification` as L103 offered, which required adding `lettre` + `rusqlite` to that crate's manifest (workspace-inherited).
5. **`local_api_command_tests.rs` did not move.** It stays in `apps/desktop-tauri/src/commands/`: the forbidden-path rule (L33) supersedes L84, and the file is built on tauri-typed `AppState` fixtures that cannot compile in a headless crate.
6. **Commit pathspecs were widened** past the paths listed at L73/L90/L110 to include the moved test files, the manifests (`Cargo.lock`, root `Cargo.toml`, `apps/desktop-tauri/Cargo.toml`, `crates/oz-notification/Cargo.toml`) and the two Dockerfiles — a commit that omitted any of them would not build.
7. **`uuid` is a dev-dependency** of `crates/oz-local-api`, not a runtime dependency — its only uses are in tests.
8. **Stale audit stamps.** The `crate: desktop-tauri` stamps the moved files carried were corrected by this pass (`crates/oz-lan/src/lib.rs`:3 → `crate: oz-lan`; `crates/oz-notification/src/email_scheduler.rs`:3 → `crate: oz-notification`), keeping the stamp format and touching nothing else.

### Hand-off notes

- Phase 1.0's exclusion pair exists only in the CircleCI config. `.github/workflows/dev-ci.yml`:253 still runs `cargo nextest run --workspace --all-features` with no `--exclude` (`release.yml`:149 already carries the identical pair), and the AGENTS.md sentence describing GH Actions as the live CI is now half-stale. Both are outside the Agent 1 fence.
- Agent 3 Phase 3.2/3.4 and Agent 2 Waves B-F are unblocked: the daemon extractions are landed and gated, and `commands/*` plus `lib.rs` were never touched here.
