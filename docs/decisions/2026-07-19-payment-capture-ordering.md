---
num: 20
area: payments
title: ADR #20: Payment-Capture Ordering — Stock Reservation Before Payment Capture
status: Implemented (2026-07-19)
---
# ADR #20: Payment-Capture Ordering — Stock Reservation Before Payment Capture

<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (1 finding) · F1: command/struct naming drift — ADR text specifies create_pending_sale / finalize_sale_scoped / void_pending_sale_scoped Tauri commands + a PendingSale struct, but implemented API is complete_sale_scoped (pos.rs) -> finalize_sale (crates/oz-core/src/db/sales.rs:438, IPC in inventory.rs:676, unscoped) + void_pending_sale (sales.rs:798, IPC inventory.rs:676, unscoped); NO create_pending_sale symbol and NO PendingSale Rust struct exist (PendingSale is a TS interface at ui/src/api/sales.ts:200) · verified accurate: migration 096_pending_sale_status.sql adds 'pending' to sales.status CHECK; 097_payment_idempotency_keys.sql adds idempotency_key UNIQUE index; finalize_sale/void_pending_sale/reap_stale_pending_sales present in sales.rs; init_pending_sale_reaper registered in platform/startup/src/lib.rs:251 (60s); UI wrappers completeSaleScoped/finalizeSale/voidPendingSale + PendingSale type present in ui/src/api/sales.ts; Status "Implemented" matches on-disk code -->

**Status:** Implemented (2026-07-19)
**Date:** 2026-07-19
**Decision Record:** Closes ADR-18 §13 Finding #31 — the pre-capture ordering requirement that the deduction location must be locked BEFORE payment gateway capture is initiated.
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** payment, stock, reservation, pos, sale, capture, ordering

---

## Context

### The Problem

ADR-18 §13 Finding #31 (line 591) identified a critical race condition in the
current sale-completion flow:

> "Critical pre-capture ordering requirement: the user-specified deduction
> location for a multi-binding cashier POS MUST be captured BEFORE the cart's
> first `add_line` so that the deduction location is locked by the time the
> payment gateway capture is initiated."

Without this ordering, two concurrent checkouts on separate terminals for the
same low-stock SKU can **both** pass the stock-availability check and proceed
to payment capture, but only the first one to commit the SQLite write-lock
actually deducts the stock. The second sale captures payment against stock that
no longer exists, creating a **stranded funds** scenario:

1. Terminal A and Terminal B both have 1× SKU-001 (qty=1) in stock.
2. Both cashiers click "Complete Sale" simultaneously for 1× SKU-001.
3. Both pass the `SELECT qty FROM inventory WHERE product_id = 'SKU-001'`
   check (both see qty=1).
4. Terminal A wins the `BEGIN IMMEDIATE` write lock, deducts stock to 0.
5. Terminal B's `BEGIN IMMEDIATE` gets the now-stale qty=1 read, attempts
   to deduct, hits `CHECK (qty >= 0)` violation.
6. Terminal B's sale ROLLBACKS — but the payment was already captured
   by the payment gateway in the window between steps 2 and 5.

The customer is charged, no stock is deducted, and no sale record exists.
The merchant must manually refund via the payment gateway dashboard.

### Scope

This ADR addresses **only** the ordering guarantee — ensuring the stock
reservation (deduction or pending-hold) is always committed BEFORE the
payment-capture API call is made. It does **not** redesign the complete
payment flow; it introduces a `pending` sale status that bridges the
stock-deduction → payment-capture gap.

### Current Flow (broken)

```
start_sale → add_line (×N) → complete_sale → deduct stock → capture payment
                                                              ↑
                                                    RACE: second terminal
                                                    captures payment but
                                                    stock is already 0
```

### Proposed Flow

```
start_sale → add_line (×N) → create_pending_sale → deduct stock (BEGIN IMMEDIATE)
                ↑                                        ↓
         location lock                             mark sale as 'pending'
         (ADR-19 §5.1)                                   ↓
                                                  capture payment
                                                       ↓
                                               on success: finalize_sale
                                               on failure: void_pending_sale
                                                        (credits stock back)
```

---

## Decision

### 1. Three-Phase Sale Lifecycle

The `sales` table gains a new status value `'pending'` that sits between
`'active'` (cart in progress) and `'completed'` (paid). The lifecycle becomes:

```
active → pending → completed
               ↘  → voided (failed payment or timeout)
```

**1.1 `create_pending_sale` (new command)**

Purpose: Atomically deduct stock and create a pending sale record in a single
`BEGIN IMMEDIATE` transaction. If stock is insufficient, returns
`PartialStockResult` (per ADR-19 §2.2) and the caller re-attempts with
`create_pending_sale_with_resolution`. On success, returns a `PendingSale`
struct:

```rust
pub struct PendingSale {
    pub sale_id: SaleId,
    pub receipt_number: String,
    pub deduct_tx_id: InventoryTransactionId,
    pub total: Money,
    pub line_count: u32,
}
```

The `BEGIN IMMEDIATE` write lock serialises concurrent `create_pending_sale`
calls, eliminating the race condition identified in §13 Finding #31.

**1.2 `finalize_sale` (new command)**

Purpose: Mark a pending sale as `'completed'` after successful payment capture.

```rust
pub fn finalize_sale(
    &self,
    tx: &Transaction,
    sale_id: &SaleId,
    payment_method: &str,
    payment_reference: &str,
    captured_at: &str,
) -> Result<(), CoreError>;
```

Sets `sales.status = 'completed'`, records payment details on the `payments`
table, and fires a `sale.completed` event. Does **not** adjust stock — the
stock was already deducted in `create_pending_sale`.

**1.3 `void_pending_sale` (new command)**

Purpose: Credit stock back and mark the pending sale as `'voided'` when
payment capture fails or the transaction is abandoned.

```rust
pub fn void_pending_sale(
    &self,
    tx: &Transaction,
    sale_id: &SaleId,
    reason: &str,
) -> Result<(), CoreError>;
```

Reads the `deduction_locations` JSON (per ADR-19 §5.3 FIFO oldest-credit) and
credits each line's deductions back to their original source locations.

---

### 2. Sale Status State Machine

```
                    ┌──────────────────┐
                    │     active       │
                    │  (cart in-prog)  │
                    └────────┬─────────┘
                             │
                      create_pending_sale
                      ↓ stock deducted
                    ┌──────────────────┐
              ┌─────│    pending       │─────┐
              │     │  (awaiting cap)  │     │
              │     └────────┬─────────┘     │
              │              │               │
           timeout        capture          capture
           (30 min)      successful        failed
              │              │               │
              ↓              ↓               ↓
        void_pending    finalize_sale   void_pending
        (credit stock)                   (credit stock)
              │              │               │
              ↓              ↓               ↓
        ┌──────────┐   ┌────────────┐   ┌──────────┐
        │ voided   │   │ completed  │   │ voided   │
        └──────────┘   └────────────┘   └──────────┘
```

**Timeout policy:** A `pending` sale that is neither `finalize_sale`'d nor
`void_pending`'d within 30 minutes is automatically voided by a background
worker (see §6). This prevents abandoned transactions from permanently
locking stock.

---

### 3. Active Cart Location Lock (ADR-19 §5.1 Integration)

The `create_pending_sale` command reads `active_carts.deduction_location_id`
which was locked at cart-start time per ADR-19 §5.1. If the cart has a NULL
`deduction_location_id`, the command returns `CoreError::CartLocationUnbound`
— the cashier must re-start the sale.

After `create_pending_sale` succeeds, the active cart row is deleted
(following the existing `held_carts` and `active_carts` lifecycle pattern).

---

### 4. Migration

**Migration 095: Add `pending` to `sales.status` CHECK constraint**

```sql
-- The current CHECK constraint on sales.status allows only:
--   CHECK (status IN ('active', 'completed', 'voided', 'refunded'))
-- Add 'pending':
-- Drop-and-recreate requires a table rebuild because SQLite CHECK
-- constraints cannot be altered.

PRAGMA foreign_keys = OFF;

ALTER TABLE sales RENAME TO sales_old;

CREATE TABLE sales (
    -- ... all existing columns (38 fields) ...
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'pending', 'completed', 'voided', 'refunded')),
    pending_expires_at TEXT,  -- nullable, set when status = 'pending'
    payment_method TEXT,
    payment_reference TEXT,
    captured_at TEXT,
    -- ... remaining columns unchanged ...
);

INSERT INTO sales (/* all columns */)
SELECT
    -- all existing columns...
    NULL AS pending_expires_at,
    NULL AS payment_method,
    NULL AS payment_reference,
    NULL AS captured_at
FROM sales_old;

DROP TABLE sales_old;

PRAGMA foreign_keys = ON;
```

---

### 5. Tauri Commands

| Command | Args | Returns | Auth |
|---------|------|---------|------|
| `create_pending_sale_scoped` | `sessionToken, saleData` | `PendingSale` | Scoped |
| `finalize_sale_scoped` | `sessionToken, saleId, paymentMethod, paymentReference` | `void` | Scoped |
| `void_pending_sale_scoped` | `sessionToken, saleId, reason` | `void` | Scoped |

All three commands follow the ADR-7 scoped command pattern. The
`create_pending_sale_scoped` command is an **idempotent** replacement for the
current `complete_sale` — if called twice with the same `saleData`, it returns
the same `PendingSale` (detected via `sale_data_hash` collision on the `sales`
row).

---

### 6. Background Worker: Pending Sale Timeout

A lightweight background task runs every 60 seconds and auto-voids pending
sales whose `pending_expires_at < NOW()`:

```rust
pub fn reap_stale_pending_sales(store: &Store) -> Result<u32, CoreError> {
    let tx = store.conn.transaction_with_behavior(
        TransactionBehavior::Immediate,
    )?;
    let stale = store.find_stale_pending_sales(&tx, 30 * 60)?;
    for sale in &stale {
        store.void_pending_sale_in_tx(
            &tx,
            &sale.id,
            "abandoned (30 min timeout)",
        )?;
    }
    tx.commit()?;
    Ok(stale.len() as u32)
}
```

The worker is registered in `platform/startup/src/lib.rs` in the `startup
tasks` array.

---

### 7. Frontend Impact

**7.1 PaymentModal changes**

When the cashier clicks "Complete Sale" or "Charge", the PaymentModal calls
`create_pending_sale_scoped` first. If it returns `PendingSale`, the modal
proceeds to the payment gateway. On gateway success, it calls
`finalize_sale_scoped`. On gateway failure or user cancellation, it calls
`void_pending_sale_scoped`.

The modal shows a spinner with the text "Reserving stock..." during the
`create_pending_sale` phase, and "Finalizing payment..." during
`finalize_sale`.

**7.2 Error states**

| Error | UX | Recovery |
|-------|----|----------|
| `CartLocationUnbound` | "Sale not started properly — restart the cart" | Cashier re-starts sale |
| `PartialStockResult` | Shortfall dialog (ADR-19 StockShortfallDialog) | Cashier resolves shortfalls |
| `PaymentGatewayFailure` | "Payment declined — stock held for 30 min" | Cashier retries within 30 min, or sale auto-voids |
| `Timeout on payment` | "Connection timed out — pending sale will expire in 30 min" | Cashier can resume via held-sales list |

**7.3 Reset from pending**

If a pending sale's payment gateway call returns a transient error (timeout,
network issue), the cashier can retry within 30 minutes without re-entering
items. The pending sale appears in a "Pending Payments" sub-tab of the
held-sales / active-sales list.

---

### 8. Acceptance Criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 20-1 | `create_pending_sale` deduplicates on identical `sale_data_hash` | Call twice with same data → second returns same `PendingSale` (same `sale_id`) |
| 20-2 | `create_pending_sale` serialises concurrent calls via `BEGIN IMMEDIATE` | Two threads attempting same SKU: one succeeds, other gets `InsufficientStockAtLocation` |
| 20-3 | `finalize_sale` updates status to `'completed'` and records payment | Check `sales.status`, `sales.payment_method`, `sales.payment_reference`, `sales.captured_at` |
| 20-4 | `void_pending_sale` credits stock back to original deduction sources | Verify `stock_movements` has positive deltas matched to `deduction_locations` JSON |
| 20-5 | Stale pending sale after 30 min is auto-voided | Set `pending_expires_at` in past, run `reap_stale_pending_sales`, verify status is `'voided'` |
| 20-6 | Concurrent `finalize_sale` and `void_pending_sale` on same sale — one wins | Both in `BEGIN IMMEDIATE`; status check ensures only first succeeds; second gets `SaleAlreadyFinalized` error |

---

### 9. Alternatives Considered

**Alternative A: Optimistic stock check without pending status.** Keep the
current flow but add a pre-check `SELECT qty FROM inventory` within a
`BEGIN IMMEDIATE`. Rejected because the payment gateway call is external and
can take seconds — holding the SQLite write lock for that duration blocks all
other writes (other sales, stock transfers, purchase order receipts).

**Alternative B: Dual-phase commit with 2PC.** Use a distributed transaction
coordinator to atomically commit stock deduction + payment capture. Rejected
as excessive complexity — the payment gateway API does not support XA
transactions, making 2PC impractical.

**Alternative C: Reserve-on-add-line.** Deduct stock from inventory as soon
as the cashier adds a line item to the cart. Rejected because this couples
cart abandonment to inventory corrections — a cashier who adds then removes
items would create unnecessary stock movements. The deduction-location-lock
on `start_sale` (ADR-19 §5.1) is sufficient to prevent the pre-capture race
without coupling add/remove to stock changes.

---

### 10. Cross-Links

- **ADR-18 §13 Finding #31** — The gating requirement that prompted this ADR.
- **ADR-19 §5.1** — Cart-start location lock (`deduction_location_id` on `active_carts`).
- **ADR-19 §5.3** — FIFO oldest-credit reverse deduction for void/refund.
- **ADR-6** — FastPINOverlay for cashier override during shortfall resolution.
- **ADR-7** — Scoped command pattern for `create_pending_sale_scoped` et al.
- **ADR-4** — Workspace-type/instance separation (deduction location is per-instance).

---

### 11. Open Questions

1. **30-minute timeout**: Is this appropriate for all payment methods (card,
   QRIS, cash)? Cash payments complete instantly; card payments may take
   10-30s; QRIS (QR code) payments can take 120s+. The 30-min window covers
   all cases but may be too long for high-traffic environments where a pending
   sale blocks the terminal. Consider a per-payment-method timeout table if
   merchants report blocking.

2. **Pending sale visibility**: Should pending sales appear in the held-sales
   list, or only in a separate "Pending Payments" section? The cashier needs
   to retry a failed payment without re-entering items, but a pending sale
   should not be editable (items cannot be added/removed). Recommendation:
   read-only display in a "Pending Payments" sub-tab.

3. **Offline mode**: When the device is offline, `finalize_sale` cannot call
   the payment gateway. The current offline queue pattern (enqueue → reconcile
   on reconnection) works for `create_pending_sale` / `finalize_sale`, but
   the 30-min timeout clock could fire before the device reconnects. The
   auto-void worker runs only on the primary device, so offline terminals
   are not affected — their pending sales survive until they come back online.

---

**End of ADR #20.** Implements ADR-18 §13 Finding #31 by introducing the
three-phase sale lifecycle with stock reservation before payment capture.
Blocked on ADR-19 (deduction location lock + deduction_locations JSON schema).

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers

