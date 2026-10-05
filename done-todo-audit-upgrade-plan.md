# Audit Logging — Upgrade Plan

**Status:** Done  
**Branch:** `0.0.41`  
**Date:** 2026-10-05  
**Target:** Close critical compliance gaps identified in the audit-logging review (P1.1, P1.2, P1.3, P1.4). Phase 2 deferred with architectural rationale.

---

## Executive Summary of Implementation

All 4 Phase 1 critical compliance items have been implemented, tested, and committed:

| Item | Focus | Touch points | Status / Commit |
|---|---|---|---|
| **P1.4** | Missing audit catalog entries (`staff.identity.read`, `staff.payroll.read`, `api.write`) | `auditCatalog.ts`, `shared.ftl`, `shared.id.ftl` | **Completed** (`b2f3a6016`) |
| **P1.3** | Audit settings mutations at bridge layer with actor attribution | `kasirmu-bridge/src/settings/core.rs`, `kasirmu-bridge/src/settings.rs` | **Completed** (`fc3e9375c`) |
| **P1.1** | Audit stock adjustments in canonical ledger writer | `products_stock_adjust/adjust.rs`, `products_stock_adjust/batch.rs` | **Completed** (`550304193`) |
| **P1.2** | Audit product and variant CRUD (create, update, delete) | `products_crud.rs`, `products.rs`, `products_tests.rs` | **Completed** (`4e5dcff45`) |
| **Tests**| Checkout & shortfall audit assertions aligned with stock deduction auditing | `sales_checkout_tests.rs`, `sales_lifecycle_tests.rs` | **Completed** (`5e10614e8`) |

---

## Phase 1 — CRITICAL (🔴) [COMPLETED]

---

### P1.1 Stock adjustment audit — COMPLETED

**Problem:** `products_stock_adjust.rs` (`adjust.rs`, `batch.rs`) wrote `stock_movements` but never called `log_audit`. Every stock change was invisible in `audit_log`.

**Implementation:**
- Added transactional `Store::log_audit_in_tx(tx, &audit)` inside `adjust_stock_at_location_with_reason` in `crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs`.
- Emits action `"stock.adjust"`, target type `"product"`, target id `sku`, with JSON payload `{ sku, delta, reason, location_id, new_qty }`.
- Attributed to caller's `source_user_id` or `"system"`.
- Added unit test `adjust_stock_writes_audit_log_entry` in `products_stock_adjust_tests.rs`. All 28 tests pass.
- Verified in commit `550304193`.

---

### P1.2 Product CRUD audit — COMPLETED

**Problem:** `products_crud.rs` created, updated, and deleted products without audit entries.

**Implementation:**
- `create_product_with_attributes`: writes `"product.create"` audit record with SKU, name, category in the transaction.
- `update_product` & `update_product_attributes`: writes `"product.update"` audit record with changed details in the transaction.
- `set_product_track_serial`: writes `"product.update"` audit record.
- `delete_product`: wrapped in a rusqlite transaction and writes `"product.delete"` audit record.
- `create_product_variant`, `update_product_variant`, `delete_product_variant` in `products.rs`: writes `"product.update"` audit record with variant SKU and product ID.
- Added comprehensive test `product_crud_writes_audit_log_entries` in `products_tests.rs`. All 173 tests pass.
- Verified in commit `4e5dcff45`.

---

### P1.3 Settings change audit — COMPLETED

**Problem:** Settings mutations (`set_setting`, `set_settings_scoped`) never wrote audit records.

**Implementation:**
- Followed Option B (audit at the bridge layer, preserving low-level storage independence).
- Added `run_set_setting_for_user` and `run_set_settings_batch_for_user` in `crates/kasirmu-bridge/src/settings/core.rs` with `actor` parameter, recording `"setting.change"` audit records.
- Wired bridge methods `set_setting` and `set_setting_scoped` / `set_settings_scoped` to extract the session `user_id` and attribute setting modifications.
- Filtered sensitive credentials / managed keys to prevent secret leaks in audit payloads.
- Added test `set_setting_and_batch_write_audit_log_entries` in `crates/kasirmu-bridge/src/settings_tests.rs`. All 100 settings tests pass.
- Verified in commit `fc3e9375c`.

---

### P1.4 Add missing catalog entries — COMPLETED

**Problem:** Three actions emitted by production code had no entry in TypeScript catalog, rendering as "Unknown Action":
- `staff.identity.read`
- `staff.payroll.read`
- `api.write`

**Implementation:**
- Added all 3 actions to `AUDIT_ACTION_I18N_KEYS` and `CRITICAL_ACTIONS` in `ui/src/features/audit/auditCatalog.ts`.
- Added Fluent localization strings to `shared-ui/locales/shared.ftl`:
  - `audit-action-staff-identity-read = Identity Read`
  - `audit-action-staff-payroll-read = Payroll Read`
  - `audit-action-api-write = API Write`
- Added Indonesian Fluent localization strings to `shared-ui/locales/shared.id.ftl`:
  - `audit-action-staff-identity-read = Identitas Dibaca`
  - `audit-action-staff-payroll-read = Penggajian Dibaca`
  - `audit-action-api-write = Tulis API`
- Verified in commit `b2f3a6016`.

---

## Phase 2 — ENHANCEMENT (🟡) [DEFERRED WITH RATIONALE]

---

### P2.1 Off-device audit log shipping — DEFERRED

**Rationale:**
- The tablet operates as a local-first offline SQLite POS.
- The cloud backend currently does not provide an endpoint (`POST /sync/audit`) to ingest shipped audit batches.
- Pushing unrouted audit entries into the existing sync outbox without server-side schema support risks queue backpressure or delivery drops.
- **Disposition:** Deferred until cloud server introduces dedicated audit sink endpoints.

---

### P2.2 Tamper detection (chain-hash / HMAC integrity) — DEFERRED

**Rationale:**
- In an offline SQLite embedded environment, the verifier and storage share the same host file.
- Without a hardware secure element / enclave or remote KMS, chain-hashing detects row edits but does not prevent an attacker with filesystem access from re-computing hashes.
- True cryptographic tamper evidence requires remote signing or off-device log shipping (P2.1).
- **Disposition:** Deferred to align with off-device audit shipping (P2.1).

---

### P2.3 Rate limiting on audit writes — DEFERRED

**Rationale:**
- POS user-initiated operations are bounded by cashier interaction speed.
- High-frequency automated loops do not target the audit writer.
- Existing SQLite write locks already serialize mutations.
- Adding in-memory sliding windows introduces non-deterministic drop semantics during bulk imports or reconcile sweeps.
- **Disposition:** Deferred as low-risk in current desktop/tablet single-user profile.

---

## Acceptance Criteria & Verification Record

All acceptance commands were executed and passed on branch `0.0.41`:

| Gate | Command | Result |
|---|---|---|
| **TypeScript** | `cd ui && npm run typecheck` | **PASSED** (0 errors) |
| **Lint** | `cd ui && npm run lint` | **PASSED** (0 errors, 61 existing warnings) |
| **Rust backend** | `cargo check -p kasirmu-core -p kasirmu-bridge` | **PASSED** (clean check) |
| **Rust tests (Audit)** | `cargo test -p kasirmu-core audit` | **PASSED** (119 lib tests, 2 integration tests, 1 refund tax test passed; 0 failed) |
| **Rust tests (Products)** | `cargo test -p kasirmu-core products` | **PASSED** (173 passed; 0 failed) |
| **Rust tests (Settings)** | `cargo test -p kasirmu-bridge settings` | **PASSED** (100 passed; 0 failed) |
| **Bundle parity** | `python3 scripts/verify-bundle-parity.py` | **PASSED** (0 missing keys across en/id bundles) |

> Acceptance verified on 2026-10-05 on branch `0.0.41`.
