# Consolidated Integration Test Suite Plan — kasirmu-core

**Status:** Done  
**Branch:** `0.0.41`  
**Date:** 2026-10-05  
**Target:** Consolidate 24 standalone integration test binaries in `crates/kasirmu-core/tests/` into a single unified test binary (`tests/integration/main.rs`), eliminating 23 redundant linker invocations and process spawns.

---

## 1. Problem Statement & Motivation

Previously, `crates/kasirmu-core/tests/` contained **24 individual `.rs` files**:
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
1. **Linker Bloat:** Every file was compiled by rustc and linked by the OS linker (`link.exe` on Windows / `ld` on Linux) into its own executable (`~24 .exe` files in `target/debug/deps/`). Each binary independently linked `rusqlite`, `serde`, `argon2`, `uuid`, `chrono`, and `kasirmu-core`.
2. **Process Spawning Overhead:** When running tests or filtering (e.g. `cargo test -p kasirmu-core <filter>`), Cargo spawned 25 separate processes (1 lib + 24 test executables). Empty runners still booted, scanned, and exited.
3. **Substring Filtering Flaws:** Fuzzy substring filters ran unrelated tests across all 24 binaries while filtering out desired tests within targeted files (as seen when `cargo test -p kasirmu-core audit` only ran 2 of 16 tests in `audit_integration.rs` because only 2 had "audit" in their function name).
4. **CI and Nextest Build Latency:** Nextest still required Cargo to compile and link all 24 binaries before executing tests.

---

## 2. Target Architecture (Implemented)

Standard Rust idiomatic practice for large crates was implemented with a single integration runner with submodules:

```
crates/kasirmu-core/tests/
└── integration/                    # Module directory (not auto-discovered by Cargo)
    ├── main.rs                     # Root binary entrypoint (declares submodules)
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

In `crates/kasirmu-core/Cargo.toml`:
```toml
[[test]]
name = "integration"
path = "tests/integration/main.rs"
```

---

## 3. Benefits & Measured Improvements

| Metric | Before (24 Binaries) | After (1 Binary) |
|---|---|---|
| **Linker invocations** | 24 separate `link.exe` runs | **1 single `link.exe` run** |
| **Output executables** | 24 binaries | **1 binary (`integration-<hash>.exe`)** |
| **Process spawns** | 25 processes | **2 processes (lib + integration)** |
| **Subsystem targeting** | `cargo test -p kasirmu-core audit` (unpredictable substring, ran only 2 of 16 tests) | `cargo test -p kasirmu-core --test integration audit::` (exact module match, runs all 16 tests in 0.49s) |
| **Unit test iteration** | `cargo test -p kasirmu-core --lib` | Skips building integration binaries entirely (1.8s) |
| **Full test suite** | `cargo test -p kasirmu-core --test integration` | Runs all 547 integration tests in one sweep |

---

## 4. Execution Record

- **Phase 1 & 2:** Created `crates/kasirmu-core/tests/integration/main.rs` and moved all 24 integration test files to `tests/integration/<name>.rs` via `git mv`.
- **Phase 3:** Updated `Cargo.toml` with `[[test]] name = "integration" path = "tests/integration/main.rs"`.
- **Phase 4:**
  - Resolved child process invocation target in `credential_storage_form.rs` to use qualified test name `credential_storage_form::decision_pin_child_probe_under_master_key`.
  - Updated legacy `gateway_status` values in `payment_failure.rs` to match database check constraint (`settled`).
  - Committed in `3c6f0f78d`.

---

## 5. Acceptance Verification Record

| Gate | Command | Result |
|---|---|---|
| **Compilation** | `cargo check -p kasirmu-core --tests` | **PASSED** (0 errors / warnings, 2.15s) |
| **Consolidated Suite** | `cargo test -p kasirmu-core --test integration` | **PASSED** (547 passed, 0 failed, 1 ignored) |
| **Scoped Module Run** | `cargo test -p kasirmu-core --test integration audit::` | **PASSED** (all 16 audit integration tests passed in 0.49s) |
| **Lib Unit Tests** | `cargo test -p kasirmu-core --lib audit` | **PASSED** (119 passed, 0 failed, 1.80s) |

> Acceptance verified on 2026-10-05 on branch `0.0.41`.
