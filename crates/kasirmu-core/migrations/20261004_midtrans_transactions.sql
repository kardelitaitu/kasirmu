-- Midtrans QRIS issue ledger — the cloud-side reconciliation book for
-- online QRIS charges (agents-1, D2 design decision 2026-09-13).
--
-- Written by `payment_api.rs` at QR ISSUE time (tenant from JWT claims) and
-- read/updated by the `webhooks.rs` midtrans notification handler. The table
-- exists because a customer can pay seconds after the QR renders — long
-- before the device's sync push carries the sale's `payments` row into the
-- cloud — and the existing webhook resolver (`lookup_sale_by_gateway_reference`)
-- needs a `sales` JOIN, i.e. it cannot resolve an early settlement. This
-- ledger resolves `(order_id) -> (tenant_id, sale_id)` without the device
-- having synced at all; `finalize_sale` then rides `offline_queue`, which is
-- consumed by the device, so no cloud-side sale needs to pre-exist.
--
-- Deliberately NO foreign key on `sale_id`: the ledger row is written before
-- the sale it guards reaches the cloud — the exact reason `20261001_sale_idempotency.sql`
-- also skips its FK (claim-before-sale precedent).
--
-- `amount_minor` for IDR is whole Rupiah (Midtrans parses "15000.00" as exp-0
-- minor units — same convention the oz-payment driver settled in PAY-1), so
-- the webhook amount check compares minor units 1:1.
CREATE TABLE IF NOT EXISTS midtrans_transactions (
    order_id     TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    sale_id      TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency     TEXT NOT NULL DEFAULT 'IDR',
    status       TEXT NOT NULL DEFAULT 'issued',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_midtrans_transactions_tenant
    ON midtrans_transactions(tenant_id);
