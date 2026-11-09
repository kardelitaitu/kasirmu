-- 20261021_receivables.sql
--
-- Accounts Receivable (Piutang / Jual Tempo / Kasbon) — Phase 3 of the
-- payment-methods plan (docs/plans/payment-methods-plan.md §1.5 & §2c).
-- Records customer debts for sales made on credit / pay-later ("goods now,
-- paid later"). Mirrors the payables (AP) schema so both sides share one
-- settlement pattern.
--
-- Money is fixed-point i64 minor units (amount_minor / paid_minor), never a
-- float (column-type lint + AGENTS.md). The status CHECK mirrors the
-- `kasirmu_core::receivable::ReceivableStatus` domain enum so a bad state
-- cannot be persisted even if a writer bypasses the store. `tenant_id` is
-- stamped by the store on every write; the table is RLS-exempt on Postgres
-- until its cloud write path lands (see RLS_EXEMPT in
-- scripts/generate-pg-migration.py).

CREATE TABLE IF NOT EXISTS receivables (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    customer_id     TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    -- Optional link to the originating sale. NULL for a receivable
    -- raised outside a POS sale (e.g. manual balance adjustment).
    sale_id         TEXT REFERENCES sales(id) ON DELETE SET NULL,
    -- Free-text origin tag ('pos', 'manual', …). Not an enum: entry points
    -- are expected to grow, and this is a display/audit label, not a state
    -- machine.
    source          TEXT NOT NULL DEFAULT 'pos',
    reference       TEXT NOT NULL DEFAULT '',   -- invoice / receipt number
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

CREATE INDEX IF NOT EXISTS idx_receivables_tenant_status
    ON receivables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_receivables_customer
    ON receivables(customer_id);
-- Aging / overdue sweep scans only unsettled receivables by their deadline.
CREATE INDEX IF NOT EXISTS idx_receivables_due
    ON receivables(due_date) WHERE status IN ('open','partial');

-- Settlement history: one row per repayment collected toward a receivable.
-- Supports partial repayments (receivables.paid_minor accumulates the sum).
-- The `method` mirrors the payments.method free-string convention so the
-- actual tender (cash / bank_transfer / qris / …) is attributed on the day
-- money enters the drawer — the collection-day-settlement principle from Q1.
CREATE TABLE IF NOT EXISTS receivable_payments (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    receivable_id   TEXT NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
    amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
    currency        TEXT NOT NULL DEFAULT 'IDR',
    method          TEXT NOT NULL DEFAULT 'cash',
    paid_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    recorded_by     TEXT,
    note            TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable
    ON receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_tenant
    ON receivable_payments(tenant_id);

-- Optional customer credit limit in minor units (Q5b: warn-only check).
-- NULL means no limit set.
ALTER TABLE customers ADD COLUMN credit_limit_minor INTEGER;
