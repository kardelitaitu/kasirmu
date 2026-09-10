# Orchestrator Agent 1: Infrastructure, Daemons & CI Stabilizer

**Document:** `todo-refactor-oz-pos-app-agents-1.md`  
**Role:** Orchestrator Agent 1 (The Extractor & Stabilizer)  
**Goal:** Stabilize CI execution by eliminating the memory killer, extract non-GUI networking and background daemons (`lan_server`, `local_api`, `image_push`, `email_scheduler`) from `apps/desktop-client` into dedicated headless crates, and drastically reduce the dependency footprint of the GUI shell.

**Sibling Documents:**
- [`todo-refactor-oz-pos-app-agents-2.md`](./todo-refactor-oz-pos-app-agents-2.md) (Agent 2 — Core Command Middleware & `oz-bridge`)
- [`todo-refactor-oz-pos-app-agents-3.md`](./todo-refactor-oz-pos-app-agents-3.md) (Agent 3 — Test Relocation, Thin Shell & IPC Parity)

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
   - `apps/desktop-client/src/lan_server.rs` & `apps/desktop-client/src/lan_server_tests.rs`
   - `apps/desktop-client/src/local_api.rs` & `apps/desktop-client/src/local_api_tests.rs`
   - `apps/desktop-client/src/image_push.rs` & `apps/desktop-client/src/image_push_tests.rs`
   - `apps/desktop-client/src/email_scheduler.rs` & `apps/desktop-client/src/email_scheduler_tests.rs`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `apps/desktop-client/src/commands/*` (Owned by Agent 2 & Agent 3).
   - DO NOT edit `apps/desktop-client/src/lib.rs` invoke_handler list (Owned by Agent 3).
   - DO NOT edit `apps/tablet-client/` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: CI Nextest Stabilization (P0 Immediate)

Unblocks CircleCI by excluding GUI app crates from the memory-constrained Linux container, matching the repository's canonical `scripts/check.sh` pattern.

- [ ] Inspect `.circleci/workflows/06-cargo-nextest.yml` and note line 37.
- [ ] Update command in `.circleci/workflows/06-cargo-nextest.yml` to:
  ```bash
  cargo nextest run --workspace --all-features --exclude oz-pos-app --exclude oz-pos-tablet -j 2
  ```
- [ ] Run `python scripts/compose-circleci.py` to re-generate `.circleci/config.yml`.
- [ ] Verify `.circleci/config.yml` matches with `python scripts/compose-circleci.py --check`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "ci(circleci): exclude gui app crates from memory-constrained nextest" .circleci/workflows/06-cargo-nextest.yml .circleci/config.yml
  ```
  *(Signaling milestone to Agent 2 and Agent 3: CI is now stabilized for headless runs).*

---

### Phase 1.1: LAN Server Daemon Extraction (`crates/oz-lan`)

`lan_server.rs` manages local peer-to-peer event multicasting, terminal discovery, and encrypted payloads (`snow`, `tokio`, `axum`). It has zero dependency on GUI windowing.

- [ ] Create `crates/oz-lan` with its own `Cargo.toml`.
- [ ] Wire `crates/oz-lan` into the root workspace members in `Cargo.toml`.
- [ ] Move networking, encryption, peer state, and event loop logic from `apps/desktop-client/src/lan_server.rs` into `crates/oz-lan/src/lib.rs` (or modular submodules).
- [ ] Move `lan_server_tests.rs` to `crates/oz-lan/src/tests.rs` (or sibling tests).
- [ ] In `apps/desktop-client`, expose a minimal lifecycle controller (`LanServerHandle`) wrapping `oz_lan::LanServer`.
- [ ] Run `cargo check -p oz-lan` and `cargo test -p oz-lan`.
- [ ] Run `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(lan): extract lan_server to crates/oz-lan" crates/oz-lan/ apps/desktop-client/src/lan_server.rs apps/desktop-client/src/lan_server_tests.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.2: Local REST API Server Extraction (`crates/oz-local-api`)

`local_api.rs` hosts an embedded Axum REST server allowing external scripts to query register status.

- [ ] Create `crates/oz-local-api` (or integrate as headless feature in `crates/oz-api`).
- [ ] Move router setup, handlers, authentication tokens, and request parsing into the headless crate.
- [ ] Move `local_api_tests.rs` and `local_api_command_tests.rs` to the new crate.
- [ ] In `apps/desktop-client/src/local_api.rs`, keep only the IPC toggle commands (`enable_local_api`, `get_local_api_status`) delegating to the crate's server handle.
- [ ] Run `cargo check -p oz-local-api` and `cargo test -p oz-local-api`.
- [ ] Run `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(api): extract local_api server to crates/oz-local-api" crates/oz-local-api/ apps/desktop-client/src/local_api.rs apps/desktop-client/src/local_api_tests.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.3: Background Schedulers Decoupling

Decouple background queue drainers from the desktop shell.

- [ ] **Image Push Queue:**
  - [ ] Relocate queue polling and cloud batch synchronization from `apps/desktop-client/src/image_push.rs` into `crates/oz-media` (or `crates/oz-core/src/tasks/image_push.rs`).
  - [ ] Keep only the scheduler spawn call in `desktop-client` startup.
- [ ] **Email Report Scheduler:**
  - [ ] Relocate report cron evaluation and SMTP dispatch from `apps/desktop-client/src/email_scheduler.rs` into `crates/oz-notification` (or `crates/oz-core`).
  - [ ] Move `email_scheduler_tests.rs` to the respective crate.
- [ ] Verify compilation and tests:
  - `cargo test -p oz-core`
  - `cargo check -p oz-pos-app`
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(daemon): extract background schedulers out of desktop-client" apps/desktop-client/src/image_push.rs apps/desktop-client/src/email_scheduler.rs Cargo.toml Cargo.lock
  ```

---

### Phase 1.4: Hand-off to Sibling Agents

- [ ] Verify that `apps/desktop-client/src/lib.rs` no longer compiles internal networking servers.
- [ ] Verify all gates pass via `cargo check --workspace`.
- [ ] Log completion in this document with exact commit SHAs.
