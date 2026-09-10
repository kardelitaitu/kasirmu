# Orchestrator Agent 2: Core Command Middleware & `oz-bridge`

**Document:** `todo-refactor-oz-pos-app-agents-2.md`  
**Role:** Orchestrator Agent 2 (The Bridge Builder)  
**Goal:** Scaffold `crates/oz-bridge` and systematically extract the business logic, SQL access, and DTO handling from all 120+ command files in `apps/desktop-client/src/commands/` into headless Rust modules. Transform Tauri commands in `desktop-client` into lightweight shims.

**Sibling Documents:**
- [`todo-refactor-oz-pos-app-agents-1.md`](./todo-refactor-oz-pos-app-agents-1.md) (Agent 1 — Infrastructure, Daemons & CI Stabilizer)
- [`todo-refactor-oz-pos-app-agents-3.md`](./todo-refactor-oz-pos-app-agents-3.md) (Agent 3 — Test Relocation, Thin Shell & IPC Parity)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history.
2. **Commit Subject Convention:**
   - All commits made by Agent 2 MUST use:
     - `feat(bridge): ...`
3. **Owned Path Fence (Exclusive to Agent 2):**
   - `crates/oz-bridge/` (NEW crate created by Agent 2)
   - Command implementation bodies inside `apps/desktop-client/src/commands/*.rs`
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit CI workflows or `lan_server`/`local_api` files (Owned by Agent 1).
   - DO NOT move or delete `apps/desktop-client/src/commands/*_tests.rs` (Owned by Agent 3).
   - DO NOT modify the `invoke_handler!` macro list in `apps/desktop-client/src/lib.rs` (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Scaffold `crates/oz-bridge`

Create the headless command middleware crate that holds domain command logic without depending on Tauri or WebKitGTK.

- [ ] Create directory `crates/oz-bridge` with a minimal `Cargo.toml`.
- [ ] Dependencies:
  - `foundation`, `oz-core`, `platform-core`, `platform-kernel`, `modules-*`
  - `serde`, `serde_json`, `thiserror`, `anyhow`, `rusqlite`, `chrono`, `tracing`
  - *(CRITICAL: No `tauri`, `gtk`, or `webkit2gtk` dependencies in `oz-bridge`!)*
- [ ] Add `crates/oz-bridge` to root `Cargo.toml` `members = [...]`.
- [ ] Define the shared context trait or struct `BridgeContext` / `BridgeState` providing DB connections, device registry access, and session validation.
- [ ] Run `cargo check -p oz-bridge`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): scaffold crates/oz-bridge command middleware" crates/oz-bridge/ Cargo.toml Cargo.lock
  ```

---

### Phase 2.1: Command Migration — Wave A (Master Data, Taxes & Currencies)

Extract catalog, tax, and currency business operations to `oz-bridge`.

- [ ] Modules to extract:
  - `categories.rs`, `products.rs`, `product_variants.rs`, `products_images.rs`
  - `tax.rs`, `fiscal.rs`, `regional.rs`
  - `currencies.rs`, `exchange_rates.rs`
- [ ] In `crates/oz-bridge/src/`, create corresponding modules (e.g. `catalog`, `tax`, `currency`).
- [ ] In `apps/desktop-client/src/commands/*.rs`, replace domain execution logic with calls to `oz_bridge::*`.
  - Example:
    ```rust
    #[tauri::command]
    pub async fn list_products(state: State<'_, AppState>) -> Result<Vec<ProductDto>, CommandError> {
        oz_bridge::catalog::list_products(&state.bridge_context()).await.map_err(Into::into)
    }
    ```
- [ ] Ensure command names, argument types, and return types remain unchanged.
- [ ] Verify: `python scripts/verify-ipc-parity.py` (Must stay 0 errors).
- [ ] Run `cargo check -p oz-bridge` and `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): extract catalog and tax commands to oz-bridge (Wave A)" crates/oz-bridge/ apps/desktop-client/src/commands/
  ```

---

### Phase 2.2: Command Migration — Wave B (CRM, Auth & Staff)

Extract user, customer, permission, and authentication commands.

- [ ] Modules to extract:
  - `customers.rs`, `loyalty.rs`
  - `auth.rs`, `authz.rs`, `staff.rs`, `security.rs`
- [ ] Implement headless handlers in `oz-bridge::crm`, `oz-bridge::auth`, `oz-bridge::staff`.
- [ ] Wire `desktop-client` commands to delegate to `oz-bridge`.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] Run `cargo check -p oz-bridge` and `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): extract crm, auth, and staff commands to oz-bridge (Wave B)" crates/oz-bridge/ apps/desktop-client/src/commands/
  ```

---

### Phase 2.3: Command Migration — Wave C (Inventory, Stock & Purchasing)

Extract stock levels, inventory transfers, and vendor payables.

- [ ] Modules to extract:
  - `inventory.rs`, `inventory_counts.rs`, `stock_transfers.rs`
  - `purchasing.rs`, `payables.rs`
- [ ] Implement headless handlers in `oz-bridge::inventory`, `oz-bridge::purchasing`.
- [ ] Wire `desktop-client` commands to delegate to `oz-bridge`.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] Run `cargo check -p oz-bridge` and `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): extract inventory and purchasing commands to oz-bridge (Wave C)" crates/oz-bridge/ apps/desktop-client/src/commands/
  ```

---

### Phase 2.4: Command Migration — Wave D (POS Operations, Shifts, Refunds & KDS)

Extract order processing, shift reconciliation, kitchen routing, and peripherals.

- [ ] Modules to extract:
  - `pos.rs`, `shifts.rs`, `refunds.rs`, `void.rs`, `receipt_format.rs`, `promotions.rs`, `gift_cards.rs`
  - `kds.rs`, `kds_device.rs`, `kds_routing.rs`
  - `hardware.rs`, `edc.rs`, `scale.rs`
- [ ] Implement headless handlers in `oz-bridge::pos`, `oz-bridge::kds`, `oz-bridge::hardware`.
- [ ] Wire `desktop-client` commands to delegate to `oz-bridge`.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] Run `cargo check -p oz-bridge` and `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): extract pos, kds, and hardware commands to oz-bridge (Wave D)" crates/oz-bridge/ apps/desktop-client/src/commands/
  ```

---

### Phase 2.5: Command Migration — Wave E (Enterprise, Workspaces & Licensing)

Extract workspace instances, locations, topology graph, analytics, licensing, and audit.

- [ ] Modules to extract:
  - `workspaces.rs`, `locations.rs`, `topology.rs`
  - `analytics.rs`, `reports.rs`, `audit.rs`
  - `license.rs`, `subscription.rs`, `settings.rs`, `setup.rs`
- [ ] Implement headless handlers in `oz-bridge::workspace`, `oz-bridge::topology`, `oz-bridge::licensing`.
- [ ] Wire `desktop-client` commands to delegate to `oz-bridge`.
- [ ] Verify: `python scripts/verify-ipc-parity.py`.
- [ ] Run `cargo check -p oz-bridge` and `cargo check -p oz-pos-app`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(bridge): extract enterprise and settings commands to oz-bridge (Wave E)" crates/oz-bridge/ apps/desktop-client/src/commands/
  ```
