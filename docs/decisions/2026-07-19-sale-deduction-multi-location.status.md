# ADR #19 Implementation Status

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (3 minor) · Fresh full audit; the 2026-09-29 body and the merged 2026-07-26 stamp are retained below as original evidence. · MINOR (line-number drift on the resolver helpers and one struct): re-derived at HEAD — `location_resolver.rs` `resolve_all_locations:424` (was 391), `resolve_location_chain_for_sku:513` (was 480); the first two are unchanged (`get_default_location_id:110`, `resolve_primary_location:304`); `sale_deduction.rs` `PartialStockResult:113` (was 112). · VERIFIED AND LEFT ALONE, re-measured: all four resolver helpers and the four sale-deduction structs (`LocationStock:51`, `Shortfall:66`, `CompleteSaleResult:89`, `PartialStockResult:113`) exist at their paths; `crates/kasirmu-core/src/sale_deduction.rs` and `location_resolver.rs` both present with their unit-test files; the Cross-Client Parity correction the 2026-09-29 pass made (desktop has NO `void_pending_sale_scoped`; it voids via unscoped `void_pending_sale`) stands. · NOT re-measured, deliberately: the Validation Summary counts (`2,654 passed`) and the "13 new scoped command variants"/"18 new commands" figures — 2026-07-19 measurements, same limit the prior pass recorded. · Prior stamps retained verbatim below. -->

<!-- STAMPS MERGED INTO THIS ONE (superseded 2026-07-26) — kept verbatim per the no-stacked-stamps rule. Its observation O1 (the Inventory label vs the warehouse key) is unaffected by this pass and still stands. -->
<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (1 observation) · O1: doc lists "Inventory" as a workspace type (Cross-Client Parity + UI Integration) while ADR-18 §13-37 renamed the workspace_types.key to 'warehouse' via migration 091; the user-facing module name stays "Inventory" (modules/inventory/manifest.json id="inventory", name="Inventory") so the label is consistent — only the internal key changed, not a contradiction · verified accurate: crates/oz-core/src/sale_deduction.rs exists with LocationStock:50/Shortfall:65/CompleteSaleResult:88/PartialStockResult:107; adjust_stock #[deprecated] at products.rs:735+1173; migrations 092/093/094 present; location_resolver.rs 4 helpers; void_pending_sale + process_refund FIFO flow in sale_deduction.rs; StockShortfallDialog.tsx + CartPanel.tsx + PaymentModal.tsx + FastPINOverlay.tsx present; UI wrappers completeSaleScoped/voidPendingSale/overrideCartDeductionLocation present in sales.ts; Status "All §15 implemented" matches on-disk code -->


**Date:** 2026-07-19 (updated)
**Based on:** [2026-07-19-sale-deduction-multi-location.md](./2026-07-19-sale-deduction-multi-location.md)
**Status:** ✅ All §15 Acceptance Criteria implemented

---

## §15 Acceptance Criteria — Final Status

| # | Criterion | Status | Key Commits / Files |
|---|---|---|---|
| **19-1** | `rebuild_stock_summary()` no longer aggregates across locations | ✅ **Done** | `crates/kasirmu-core/src/db/inventory.rs` (the numbered migration series is gone; see the stamp on migration renumbering) |
| **19-2** | `adjust_stock_at_location_with_reason` signature implemented and tested | ✅ **Done** | `crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs` — canonical function + unit tests |
| **19-3** | `complete_sale` + `complete_sale_with_resolved_shortfalls` commands reworked; both variants for desktop + tablet clients | ✅ **Done** | Desktop: `apps/desktop-tauri/src/commands/pos.rs:339`/`:305`; Tablet: `apps/mobile-tauri/src/commands/pos/checkout.rs:529` and `apps/mobile-tauri/src/commands/pos.rs:735` — both have `complete_sale_scoped` (calls `complete_sale_deduction`) and `complete_sale_with_resolved_shortfalls_scoped` |
| **19-4** | `resolve_primary_location`, `resolve_all_locations`, `resolve_location_chain_for_sku`, `get_default_location_id` implemented | ✅ **Done** | `crates/kasirmu-core/src/location_resolver.rs` — 4 helpers (`get_default_location_id:110`, `resolve_primary_location:304`, `resolve_all_locations:424`, `resolve_location_chain_for_sku:513`) with unit tests (unbound→canonical, single-binding, multi-binding primary-first, explicit override, empty stock, split-brain detection) |
| **19-5** | `PartialStockResult` + `CompleteSaleResult` discriminators shipped; UI renders both | ✅ **Done** | Backend: `crates/kasirmu-core/src/sale_deduction.rs` structs; UI: `ui/src/features/sales/StockShortfallDialog.tsx` renders shortfall resolution with location picker and split fulfillment |
| **19-6** | `deduction_locations` JSON column populated on every successful commit | ✅ **Done** | `deduction_locations` is a column of the base schema, `crates/kasirmu-core/migrations/20260813_init.sql:618`; Both `complete_sale_deduction` and `complete_sale_with_resolved_shortfalls` write it; `crates/kasirmu-core/src/db/sales_lifecycle.rs` |
| **19-7** | Void + refund inverse flow credits original deduction source per FIFO oldest-credit | ✅ **Done** | `void_pending_sale` reads `deduction_locations` JSON, reverses each entry to original location; FIFO committed in `crates/kasirmu-core/src/sale_deduction.rs`; `process_refund` in both desktop & tablet reads `deduction_locations` |
| **19-8** | `BEGIN IMMEDIATE` atomicity enforced; concurrent sales serialize via SQLite write lock | ✅ **Done** | `unchecked_transaction()` / `TransactionBehavior::Immediate` in both `complete_sale_deduction` and `complete_sale_with_resolved_shortfalls` |
| **19-9** | §5.1 cart-start location lock implemented; `add_line` rejects on unbound cart | ✅ **Done** | The cart location lock lives in `crates/kasirmu-core/src/db/cart.rs`; `start_sale_scoped` resolves and locks; `add_line_scoped` calls `ensure_cart_deduction_location_lock`; `override_cart_deduction_location_scoped` for manager override with authz |
| **19-10** | 11+ behavior-level cargo tests pass (per §16.2 table) | ✅ **Done** | All location_resolver + sale_deduction + migration tests pass |
| **19-11** | §13-37 file-level rename cascade paired with ADR's runtime commit | ✅ **Done** | The workspace rename cascade is folded into the base schema; `adjust_stock` etc. marked `#[deprecated]` with convenience wrappers |
| **19-12** | All existing `adjust_stock[_with_reason]` callsites marked `#[deprecated]` and refactored | ✅ **Done** | Original functions carry `#[deprecated(note = "use adjust_stock_at_location_with_reason")]`; wrappers route through canonical function |

---

## Cross-Client Parity

| Client | Scoped Commands | Deduction Lock | Void/Refund FIFO |
|---|---|---|---|
| **Desktop** (`apps/desktop-tauri/`) | ✅ `_scoped` variants for complete/add/override — but **no** `void_pending_sale_scoped`; the desktop voids through unscoped `void_pending_sale` (`commands/inventory.rs:472`) and refunds through `process_refund_scoped` (`commands/refunds.rs:33`) | ✅ `start_sale_scoped` → resolve → lock | ✅ `void_pending_sale` (unscoped) + `process_refund_scoped` |
| **Tablet** (`apps/mobile-tauri/`) | ✅ `_scoped` variants (added 2026-07-19) | ✅ `start_sale_scoped` → resolve → lock | ✅ `void_sale_scoped` (`commands/void.rs:37`) + `process_refund_scoped` (`commands/refunds.rs:65`) with shared `run_process_refund` (`:83`) |
| **UI PosScreen** | ✅ `sessionToken` passed to `PaymentModal` | ✅ Deduction badge + FastPIN override | ✅ Via backend |
| **UI RetailPosScreen** | ✅ `sessionToken` passed to `PaymentModal` (added 2026-07-19) | ✅ Deduction-aware flow | ✅ Via backend |

---

## UI Integration Points

### CartPanel (`ui/src/features/sales/components/CartPanel.tsx`)
- ADR-19 §17 locked deduction location badge: `.pos-cart-deduction-badge` shows `[Deducting: Store Inventory]`
- Click badge → opens FastPINOverlay → `overrideCartDeductionLocation` on verify
- CSS: `CartPanel.css` — `.pos-cart-deduction-badge` styles with warning color scheme

### PaymentModal (`ui/src/features/sales/PaymentModal.tsx`)
- Accepts optional `sessionToken` prop
- Both `complete` and `handleQrConfirmed` callbacks conditionally use scoped commands (with `sessionToken`) vs non-scoped fallback
- Catches `PartialStockResult` from backend errors → displays `StockShortfallDialog`
- Imports: `startSaleScoped`, `addLineScoped`, `completeSaleScoped`, `setCartDiscountScoped`

### StockShortfallDialog (`ui/src/features/sales/StockShortfallDialog.tsx`)
- Location picker component for split fulfillment
- Renders per-line shortfall with alternative locations and live stock counts
- Submits `complete_sale_with_resolved_shortfalls_scoped` with resolution plan

### PosScreen (`ui/src/features/sales/PosScreen.tsx`)
- Uses `useWorkspace()` → `sessionToken`
- Passes `sessionToken` to `PaymentModal` via conditional spread
- Deduction badge + FastPIN overlay flow wired

### RetailPosScreen (`ui/src/features/retail/RetailPosScreen.tsx`)
- Now uses `useWorkspace()` → `sessionToken` (added 2026-07-19)
- Passes `sessionToken` to `PaymentModal` via conditional spread
- Desktop retail POS now flows through deduction-aware cart lifecycle

### FastPINOverlay (`ui/src/components/FastPINOverlay.tsx`)
- Added optional `onVerified` callback prop
- Fires after successful PIN verification and session swap
- Used by deduction location override flow

---

## Key Design Decisions

1. **Single-DB tablet architecture**: Tablet doesn't have `db_manager` or multi-store support — scoped commands use `state.db.lock().await` directly with session-based authz
2. **No plugin hooks in tablet**: Lacks the `plugins` field on `AppState` — plugin validation/discount steps are skipped (same as original tablet design)
3. **Backward compatibility**: All original non-scoped commands preserved; only `override_cart_deduction_location` marked with deprecation comment
4. **Conditional scoped commands**: UI components use `sessionToken ? scoped : non-scoped` branching to maintain compatibility when running without a session (e.g., browser dev mode)
5. **FIFO oldest-credit on void/refund**: `deduction_locations` JSON parsed in order (oldest deduction first); credits issued in same order

---

## Validation Summary

| Check | Status |
|---|---|
| `cargo check --workspace` | ✅ 0 errors |
| `cargo clippy --workspace --all-targets -- -D warnings` | ✅ 0 warnings |
| `cargo test` (full workspace) | ✅ All passing |
| `npm run typecheck` (ui/) | ✅ 0 errors |
| `npm run lint` (ui/) | ✅ 0 errors/warnings |
| `npm run test` (ui/) | ✅ 2,654 passed, 0 failed |

---

## Gap Closure History

### Session 2026-07-19 — Tablet Client Parity
- Added 13 new scoped command variants to the tablet client's `src/commands/pos.rs`
- Added `void_sale_scoped` to the tablet client's `src/commands/void.rs`
- Added scoped refund commands with shared `run_process_refund` to the tablet client's `src/commands/refunds.rs`
- Registered all 18 new commands in the tablet client's `src/lib.rs`

> These four bullets are a dated 2026-07-19 work log. The files have since moved from
> `apps/tablet-client/` to `apps/mobile-tauri/` (see the stamp), so the client is named by
> role here rather than by a path that no longer resolves; the commands themselves are
> re-verified as present in the audit stamp above.

### Session 2026-07-19 — PaymentModal Scoped Commands
- Added `sessionToken` prop to `PaymentModalProps`
- Modified `complete` and `handleQrConfirmed` callbacks to use scoped commands conditionally
- Wired `sessionToken` from `PosScreen` to `PaymentModal`

### Session 2026-07-19 — RetailPosScreen Scoped Commands
- Added `useWorkspace` import and `sessionToken` destructuring
- Added `sessionToken` conditional spread to `PaymentModal` rendering
- Desktop retail POS now uses deduction-aware cart lifecycle

### Open (Deferred to Future ADRs)
- **Held carts** `deduction_location_id` lock (ADR-22 candidate)
- **Offline queue** reconciler for two-command flow (ADR-21 candidate)
- **Cache strategy** for `resolve_primary_location` (ADR-20 candidate)
- **BOM/Recipe** per-ingredient location routing (future ADR)

> last audited 11-10-26 by docs-auditor
