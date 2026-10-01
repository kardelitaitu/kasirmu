# ADR #20 Implementation Status

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (4 major, 3 minor — all repaired here) · Audited on branch 0.0.40. This file recorded a 2026-07-19 state and was never re-anchored through the workspace restructure, so most of its truth anchors had rotted. MAJOR 1 — §8 row 20-3 said `finalize_sale` "sets `status = 'completed'`, records `payment_method`, `payment_reference`, `captured_at`". Half of that is false: `crates/kasirmu-core/src/db/sales_lifecycle.rs:86-108` runs one UPDATE touching only `status`, `updated_at` and `version`, and `captured_at` — a real column at `crates/kasirmu-core/migrations/20260813_init.sql:621` — is written by NO Rust code in the crate (unfiltered grep for `captured_at` across `crates/kasirmu-core/src/**/*.rs` returns zero files). Repaired to say what the function does. MAJOR 2 — the Backend Implementation table pointed all four lifecycle fns at `crates/oz-core/src/db/sales.rs`; that crate does not exist (`cargo metadata` lists `kasirmu-core`) and the fns live in a file that was split out: `crates/kasirmu-core/src/db/sales_lifecycle.rs`, `finalize_sale:86`, `void_pending_sale:631`, `find_stale_pending_sales:777`, `reap_stale_pending_sales:801` (was 429/779/867/891). MAJOR 3 — "Migration 095" for `pending_expires_at`: the numbered migration series is gone, migrations are date-stamped. The column is in the base schema, `crates/kasirmu-core/migrations/20260813_init.sql:619`, indexed by `idx_sales_pending_expires` at `:1246`. MAJOR 4 — the four `*_scoped` client-command rows named `apps/desktop-client/` and `apps/tablet-client/`, neither of which exists (`apps/` holds cloud-server, desktop-tauri, license-server, mobile-tauri, unified); no `finalize_sale_scoped` or `void_pending_sale_scoped` exists in any client, and the desktop exposes UNSCOPED `finalize_sale` / `void_pending_sale` at `apps/desktop-tauri/src/commands/inventory.rs:457` and `:472`, registered at `apps/desktop-tauri/src/lib.rs:1221-1222`. The tablet app has NEITHER: an unfiltered `git grep` scoped to `apps/mobile-tauri` returns zero matches for either name, so those two rows described a command surface that was never merged. MINOR: `BEGIN IMMEDIATE` cited at "line 126 of sales.rs" is `crates/kasirmu-core/src/db/sales_lifecycle.rs:179`; `reap_stale_pending_sales` cited at 891 is `:801`; `init_pending_sale_reaper` cited at `platform/startup/src/lib.rs:186` is `:490`. · MATCH, re-measured: all four named tests exist in `crates/kasirmu-core/src/db/sales_tests.rs` — `concurrent_complete_sale_serialized_by_begin_immediate:3348`, `reap_stale_pending_sales_voids_expired_sales:3592`, `reap_stale_pending_sales_skips_fresh_sales:3658`, `finalize_and_void_concurrent_exclusive:3701`; and all four UI wrappers exist in `ui/src/api/sales.ts` — `PendingSale:378`, `finalizeSale:388`, `voidPendingSale:394`, `overrideCartDeductionLocation:398`. · NOT re-measured, deliberately: the Validation Summary table (cargo/clippy/npm results), the "39/39 passed" PaymentModal count, commit `439a7937`, criterion 20-1's still-deferred status, and the "~3090" void-test line. Those are point-in-time 2026-07-19 measurements of a tree that has since been restructured; re-running them belongs to a validation pass, not a doc audit, and restating them as current would be the very drift this pass is fixing. -->

<!-- STAMPS MERGED INTO THIS ONE (superseded 2026-07-26) — kept verbatim per the no-stacked-stamps rule; its O1 and O2 both still hold and O1 is now the basis of MAJOR 4 above. -->
<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (2 observations) · O1: lines 45-48 list finalize_sale_scoped / void_pending_sale_scoped IPC commands in pos.rs for both clients — actual IPC is finalize_sale + void_pending_sale (unscoped) in apps/desktop-client/src/commands/inventory.rs:676, registered in lib.rs:315-316; complete_sale_scoped / complete_sale_with_resolved_shortfalls_scoped live in pos.rs — the scoped suffixes are mis-attributed (see ADR#20 F1) · O2: line 43 "pending_expires_at column | Migration 095" — actual migration is 096_pending_sale_status.sql (095 is held_carts_deduction_location); minor number off-by-one · verified accurate: commit 439a7937 exists ("feat: complete ADR-20 Payment-Capture Ordering"); PendingSale interface at ui/src/api/sales.ts:200; completeSaleScoped/finalizeSale/voidPendingSale/overrideCartDeductionLocation wrappers present; sales.rs fns at 438/798/867/910 (doc cited 429/779/867/891 — close); init_pending_sale_reaper at platform/startup/src/lib.rs:251 (doc cited :186 — line drift); 20-1 sale_data_hash dedup correctly marked Not implemented; 20-2..20-6 Implemented with named tests -->


**Date:** 2026-07-19 (updated)
**Based on:** [2026-07-19-payment-capture-ordering.md](./2026-07-19-payment-capture-ordering.md)
**Status:** ✅ Implemented

---

## §8 Acceptance Criteria — Final Status

| # | Criterion | Status | Implementation | Test Function(s) |
|---|---|---|---|---|
| **20-1** | `create_pending_sale` deduplicates on identical `sale_data_hash` | ❌ **Not implemented — deferred** | The `complete_sale_deduction` function does not implement `sale_data_hash` dedup. Each call creates a new sale row. This was deferred as a low-severity edge case — in practice, the UI prevents duplicate submissions via button disable + loading state. A future PR can add the `sale_data_hash` column and dedup check if merchants report double-click issues. | No test |
| **20-2** | `create_pending_sale` serialises concurrent calls via `BEGIN IMMEDIATE` | ✅ **Implemented** | `unchecked_transaction()` with `BEGIN IMMEDIATE` at `crates/kasirmu-core/src/db/sales_lifecycle.rs:179` ensures only one thread succeeds per SKU; the other gets `InsufficientStockAtLocation` | `concurrent_complete_sale_serialized_by_begin_immediate` |
| **20-3** | `finalize_sale` updates status to `'completed'` | ✅ **Implemented** | `finalize_sale` at `crates/kasirmu-core/src/db/sales_lifecycle.rs:86` sets `status = 'completed'` (guarded by `AND status = 'pending'`) and bumps `updated_at`/`version`; it awards loyalty points atomically on the same transition. It does **not** record `payment_method`, `payment_reference` or `captured_at` — `captured_at` is a column at `crates/kasirmu-core/migrations/20260813_init.sql:621` that no Rust code in the crate writes. Verified by `finalize_and_void_concurrent_exclusive` test which checks `status == "completed"` after finalize. | `finalize_and_void_concurrent_exclusive` |
| **20-4** | `void_pending_sale` credits stock back to original deduction sources | ✅ **Implemented** | Void test at line ~3090 creates a sale with resolved shortfalls from two locations, voids it, and verifies stock credited back to each original location | Void test in `sales.rs` (checks stock returned to `loc-a` and `loc-b`) |
| **20-5** | Stale pending sale after 30 min is auto-voided | ✅ **Implemented** | `reap_stale_pending_sales` at `crates/kasirmu-core/src/db/sales_lifecycle.rs:801` auto-voids expired sales. `init_pending_sale_reaper` runs every 60s in `platform/startup/src/lib.rs`. Two tests verify: expired sales are voided, fresh sales are skipped. | `reap_stale_pending_sales_voids_expired_sales`, `reap_stale_pending_sales_skips_fresh_sales` |
| **20-6** | Concurrent `finalize_sale` and `void_pending_sale` on same sale — one wins | ✅ **Implemented** | `finalize_and_void_concurrent_exclusive` test: finalize succeeds (status = 'completed'), then void fails with `NotFound` because status is no longer 'pending' | `finalize_and_void_concurrent_exclusive` |

**Total: 5/6 criteria implemented (83%).** Criterion 20-1 (sale_data_hash dedup) is deferred — see note above.

---

## Frontend Integration

| Component | Status | Details |
|-----------|--------|---------|
| **PaymentModal.tsx** | ✅ **Done** | Calls `finalizeSale(sessionToken, saleId)` after `completeSaleScoped` succeeds; calls `voidPendingSale(sessionToken, saleId)` on failure. See commit `439a7937`. |
| **API wrappers** (`ui/src/api/sales.ts`) | ✅ **Done** | `finalizeSale`, `voidPendingSale`, `PendingSale` type, `overrideCartDeductionLocation` all available |
| **TypeScript typecheck** | ✅ **0 errors** | |
| **UI tests** (PaymentModal) | ✅ **39/39 passed** | All existing tests pass with no regressions |

---

## Backend Implementation

| Component | File | Location |
|-----------|------|----------|
| `finalize_sale` | `crates/kasirmu-core/src/db/sales_lifecycle.rs` | Line 86 |
| `void_pending_sale` | `crates/kasirmu-core/src/db/sales_lifecycle.rs` | Line 631 |
| `find_stale_pending_sales` | `crates/kasirmu-core/src/db/sales_lifecycle.rs` | Line 777 |
| `reap_stale_pending_sales` | `crates/kasirmu-core/src/db/sales_lifecycle.rs` | Line 801 |
| `pending_expires_at` column | `crates/kasirmu-core/migrations/20260813_init.sql` | Line 619 (base schema; indexed by `idx_sales_pending_expires`, line 1246) |
| Background reaper daemon | `platform/startup/src/lib.rs` | Line 490 (`init_pending_sale_reaper`), spawned at line 280 |
| Desktop command: `finalize_sale` (unscoped) | `apps/desktop-tauri/src/commands/inventory.rs` | Line 457; registered `apps/desktop-tauri/src/lib.rs:1221` |
| Desktop command: `void_pending_sale` (unscoped) | `apps/desktop-tauri/src/commands/inventory.rs` | Line 472; registered `apps/desktop-tauri/src/lib.rs:1222` |
| Tablet command: `finalize_sale` | — does not exist | The tablet app (`apps/mobile-tauri/`) exposes no finalize/void command; `git grep` over that tree returns no match for either name |
| Tablet command: `void_pending_sale` | — does not exist | As above |

---

## Validation Summary

| Check | Status |
|-------|--------|
| `cargo check --workspace` | ✅ 0 errors |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ 0 warnings |
| `cargo test` (full workspace) | ✅ All passing |
| `npm run typecheck` (ui/) | ✅ 0 errors |
| `npm run test` (ui/) | ✅ All passing |
| `scripts/check.ps1` | ✅ 13/13 checks green |

---

## Known Gap

**Criterion 20-1 (`sale_data_hash` dedup):** Not implemented. The ADR spec describes a `sale_data_hash` collision detection mechanism so that calling `create_pending_sale` twice with the same data returns the same `PendingSale`. This was deferred because:

1. The UI already prevents double-submission via button disable + loading state during `completeSaleScoped`.
2. The `BEGIN IMMEDIATE` write lock serialises all writes, preventing a second `complete_sale_deduction` from committing if the first is still in-flight.
3. Adding `sale_data_hash` requires a new column on the `sales` table, a hash computation at the API boundary, and a UNIQUE constraint — non-trivial for a low-probability edge case.

**Recommendation:** Implement if merchants report duplicate-sale issues. Estimated effort: 2–3 hours (migration + hash logic + test).

> last audited 29-09-26 by docs-auditor

