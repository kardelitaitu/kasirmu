# Consolidated Integration Test Suite Plan — kasirmu-core

**Status:** Plan  
**Branch:** `0.0.41`  
**Date:** 2026-10-05  
**Target:** Consolidate 24 standalone integration test binaries in `crates/kasirmu-core/tests/` into a single unified test binary (`tests/integration.rs`), eliminating 23 redundant linker invocations and process spawns.

---

## 1. Problem Statement & Motivation

Today, `crates/kasirmu-core/tests/` contains **24 individual `.rs` files**:
- `audit_integration.rs`
- `backup_restore_integration.rs`
- `corruption_recovery_integration.rs`
- `credential_storage_form.rs`
- `currency_integration.rs`
- `customer_integration.rs`
- `feature_matrix_tests.rs`
- `gift_card_integration.rs`
- `inventory_integration.rs`
- `loyalty_integration.rs`
- `manifest_schema_test.rs`
- `offline_integration.rs`
- `payment_failure_integration.rs`
- `purchase_order_integration.rs`
- `refund_tax_integration.rs`
- `settings_integration.rs`
- `shift_integration.rs`
- `staff_integration.rs`
- `stock_count_integration.rs`
- `stock_transfer_integration.rs`
- `store_scoping_concurrency_integration.rs`
- `store_scoping_integration.rs`
- `supplier_integration.rs`
- `terminal_integration.rs`

### The Costs of 24 Separate Integration Binaries:
1. **Linker Bloat:** Every file is compiled by rustc and linked by the OS linker (`link.exe` on Windows / `ld` on Linux) into its own full executable (`~24 .exe` files in `target/debug/deps/`). Each binary independently links `rusqlite`, `serde`, `argon2`, `uuid`, `chrono`, and `kasirmu-core`.
2. **Process Spawning Overhead:** When running tests or filtering (e.g. `cargo test -p kasirmu-core <filter>`), Cargo spawns 25 separate processes (1 lib + 24 test executables). Empty runners still boot, scan, and exit.
3. **Substring Filtering Flaws:** Fuzzy substring filters run unrelated tests across all 24 binaries while filtering out desired tests within targeted files (as seen when `cargo test -p kasirmu-core audit` only ran 2 of 16 tests in `audit_integration.rs` because only 2 had "audit" in their function name).
4. **CI and Nextest Build Latency:** Nextest still requires Cargo to compile and link all 24 binaries before it can execute any tests.

---

## 2. Target Architecture

Standard Rust idiomatic practice for large crates is a single integration runner with submodules:

```
crates/kasirmu-core/tests/
├── integration.rs                  # Root binary entrypoint (declares submodules)
└── integration/                    # Module directory (not auto-discovered by Cargo)
    ├── audit.rs                    # (formerly audit_integration.rs)
    ├── backup_restore.rs           # (formerly backup_restore_integration.rs)
    ├── corruption_recovery.rs      # (formerly corruption_recovery_integration.rs)
    ├── credential_storage_form.rs  # (formerly credential_storage_form.rs)
    ├── currency.rs                 # (formerly currency_integration.rs)
    ├── customer.rs                 # (formerly customer_integration.rs)
    ├── feature_matrix.rs           # (formerly feature_matrix_tests.rs)
    ├── gift_card.rs                # (formerly gift_card_integration.rs)
    ├── inventory.rs                # (formerly inventory_integration.rs)
    ├── loyalty.rs                  # (formerly loyalty_integration.rs)
    ├── manifest_schema.rs          # (formerly manifest_schema_test.rs)
    ├── offline.rs                  # (formerly offline_integration.rs)
    ├── payment_failure.rs          # (formerly payment_failure_integration.rs)
    ├── purchase_order.rs           # (formerly purchase_order_integration.rs)
    ├── refund_tax.rs               # (formerly refund_tax_integration.rs)
    ├── settings.rs                 # (formerly settings_integration.rs)
    ├── shift.rs                    # (formerly shift_integration.rs)
    ├── staff.rs                    # (formerly staff_integration.rs)
    ├── stock_count.rs              # (formerly stock_count_integration.rs)
    ├── stock_transfer.rs           # (formerly stock_transfer_integration.rs)
    ├── store_scoping.rs            # (formerly store_scoping_integration.rs)
    ├── store_scoping_concurrency.rs# (formerly store_scoping_concurrency_integration.rs)
    ├── supplier.rs                 # (formerly supplier_integration.rs)
    └── terminal.rs                 # (formerly terminal_integration.rs)
```

### Root Entry Point (`tests/integration.rs`)
```rust
//! Consolidated integration test suite for `kasirmu-core`.
//!
//! Replaces 24 standalone test binaries with a single test binary,
//! reducing linker invocations from 24 to 1 while preserving complete test coverage.

mod audit;
mod backup_restore;
mod corruption_recovery;
mod credential_storage_form;
mod currency;
mod customer;
mod feature_matrix;
mod gift_card;
mod inventory;
mod loyalty;
mod manifest_schema;
mod offline;
mod payment_failure;
mod purchase_order;
mod refund_tax;
mod settings;
mod shift;
mod staff;
mod stock_count;
mod stock_transfer;
mod store_scoping;
mod store_scoping_concurrency;
mod supplier;
mod terminal;
```

---

## 3. Benefits & Measured Improvements

| Metric | Before (24 Binaries) | After (1 Binary) |
|---|---|---|
| **Linker invocations** | 24 separate `link.exe` runs | **1 single `link.exe` run** |
| **Output executables** | 24 binaries | **1 binary (`integration-<hash>.exe`)** |
| **Process spawns** | 25 processes | **2 processes (lib + integration)** |
| **Subsystem targeting** | `cargo test -p kasirmu-core audit` (unpredictable substring) | `cargo test -p kasirmu-core --test integration audit::` (precise module match) |
| **Unit test iteration** | `cargo test -p kasirmu-core --lib` | Unchanged (skips integration binary) |
| **Full test suite** | `cargo test -p kasirmu-core --test integration` | Runs all 526 integration tests in one sweep |

---

## 4. Execution Plan (Phased)

### Phase 1: Setup & Root Harness
1. Create directory `crates/kasirmu-core/tests/integration/`.
2. Create `crates/kasirmu-core/tests/integration.rs` with documentation and module declarations.

### Phase 2: Migration of Test Modules
Move each of the 24 files into `crates/kasirmu-core/tests/integration/<name>.rs`:
- Keep each module's internal code unchanged. Because Rust modules encapsulate private items, local helper functions (like `setup()`, `fresh_db()`, `store()`) will remain scoped to their respective modules without namespace collisions.
- Verify module compilation incrementally.

### Phase 3: Removal of Legacy Top-Level Files
- Delete the 24 legacy `.rs` files directly under `crates/kasirmu-core/tests/`.
- Ensure no lingering `.rs` files remain directly under `tests/` except `integration.rs`.

### Phase 4: Verification & Test Execution
- Run `cargo check -p kasirmu-core --tests` to verify compiler clean pass.
- Run `cargo test -p kasirmu-core --test integration` to ensure all 526 tests execute and pass.
- Test module-specific execution: `cargo test -p kasirmu-core --test integration audit::`.
- Verify CI compatibility: run `cargo nextest list -p kasirmu-core` (or nextest run).

---

## 5. Risk Analysis & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Namespace collision** | `fn setup()` or helpers conflicting across tests | Submodules (`mod audit; mod customer;`) provide natural private item isolation. Each module's functions remain private to that module. |
| **Test concurrency / DB locks** | Multiple tests accessing SQLite simultaneously | Tests use in-memory SQLite (`migrations::fresh_db()`) or isolated `tempfile::tempdir()`. For tests with specific concurrency checks (`store_scoping_concurrency`), they already use unique store IDs or temporary file paths. |
| **Nextest partition compatibility** | CI partitions tests across shards | Nextest discovers individual `#[test]` functions by qualified path (`integration::audit::test_name`), so partitioning works identically or better. |
| **Dead reference in scripts/CI** | CI workflow or script expecting old binary name | Audited codebase: no CI workflows or production scripts call `cargo test --test <old_name>` for `kasirmu-core`. |

---

## 6. Acceptance Criteria

| Gate | Command | Expected Result |
|---|---|---|
| **Compilation** | `cargo check -p kasirmu-core --tests` | Clean check, 0 warnings / errors |
| **Consolidated Suite** | `cargo test -p kasirmu-core --test integration` | All 526 integration tests pass (0 failures) |
| **Scoped Module Run** | `cargo test -p kasirmu-core --test integration audit::` | All 16 audit integration tests pass (0 skipped) |
| **Lib Unit Tests** | `cargo test -p kasirmu-core --lib` | Lib unit tests continue to pass without building 24 binaries |
| **Workspace CI check** | `cargo test -p kasirmu-core` | Single integration runner executed |

> Stamped as `done-` only when acceptance commands are executed and verified.
