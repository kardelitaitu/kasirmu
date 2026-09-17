-- 20260918_payables.sql
--
-- Accounts Payable (Hutang / Beli Tempo) — Phase 4 of the payment-methods
-- plan (docs/plans/payment-methods-plan.md §2b). Records money the store owes
-- a supplier for stock received but not yet paid: the "add product, haven't
-- paid yet" flow. Mirrors the planned receivables (AR) shape so the two sides
-- share one settlement pattern.
--
-- Money is fixed-point i64 minor units (amount_minor / paid_minor), never a
-- float (column-type lint + AGENTS.md). The status CHECK mirrors the
-- `kasirmu_core::payable::PayableStatus` domain enum so a bad state cannot be
-- persisted even if a writer bypasses the store. `tenant_id` is stamped by the
-- store on every write; the table is RLS-exempt on Postgres until its cloud
-- write path lands (see RLS_EXEMPT in scripts/generate-pg-migration.py).

CREATE TABLE IF NOT EXISTS payables (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    supplier_id     TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    -- Optional link to the originating purchase order. NULL for a payable
    -- raised outside a PO (e.g. stock added directly at the register).
    po_id           TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    -- Free-text origin tag ('po_receive', 'stock_add', 'manual', …). Not an
    -- enum: entry points are expected to grow, and this is a display/audit
    -- label, not a state machine.
    source          TEXT NOT NULL DEFAULT 'manual',
    reference       TEXT NOT NULL DEFAULT '',   -- supplier's invoice / bill no.
    amount_minor    INTEGER NOT NULL CHECK (amount_minor >= 0),
    paid_minor      INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    currency        TEXT NOT NULL DEFAULT 'IDR',
    due_date        TEXT,                        -- ISO date (YYYY-MM-DD); NULL = open-ended
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','partial','paid','written_off')),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    settled_at      TEXT,
    written_off_at  TEXT,
    -- Never pay more than owed; the store rejects over-payment before here.
    CHECK (paid_minor <= amount_minor)
);

CREATE INDEX IF NOT EXISTS idx_payables_tenant_status
    ON payables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payables_supplier
    ON payables(supplier_id);
-- Aging / overdue sweep scans only unsettled payables by their deadline.
CREATE INDEX IF NOT EXISTS idx_payables_due
    ON payables(due_date) WHERE status IN ('open','partial');

-- Settlement history: one row per payment made toward a payable. Supports
-- partial payments (payables.paid_minor accumulates the sum of these). The
-- `method` mirrors the payments.method free-string convention so the actual
-- tender (cash / bank_transfer / qris / …) is attributed on the day money
-- leaves the drawer — the collection-day-settlement principle from Q1.
CREATE TABLE IF NOT EXISTS payable_payments (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    payable_id      TEXT NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
    amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
    currency        TEXT NOT NULL DEFAULT 'IDR',
    method          TEXT NOT NULL DEFAULT 'cash',
    paid_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    recorded_by     TEXT,
    note            TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_payable_payments_payable
    ON payable_payments(payable_id);
CREATE INDEX IF NOT EXISTS idx_payable_payments_tenant
    ON payable_payments(tenant_id);
