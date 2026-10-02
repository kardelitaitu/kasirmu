-- 20261017_payments_method_check.sql
--
-- ADR-64 (D1 & D5): payments.method and payments.gateway_status closed-set
-- CHECK constraints and table rebuild.
--
-- Prior state:
-- `payments.method` was free TEXT with no validation at storage layer.
-- `payments.gateway_status` was free TEXT with no validation at storage layer.
--
-- This migration:
-- 1. Defers foreign keys to safely allow table rebuild without cascade drops.
-- 2. Backfills any legacy or invalid method to 'other'.
-- 3. Backfills any invalid gateway_status to NULL.
-- 4. Rebuilds `payments` table with strict CHECK constraints for method and gateway_status.
-- 5. Re-creates `idx_payments_idempotency_key` and `idx_payments_sale_id` on the swapped table.

PRAGMA defer_foreign_keys = ON;

-- 1. Backfill legacy/unknown method to 'other'
UPDATE payments
SET method = 'other'
WHERE method NOT IN (
    'cash', 'card', 'card_debit', 'card_credit',
    'qris_manual', 'qris', 'bank_transfer', 'ewallet',
    'open_bill', 'credit', 'pay_later', 'other'
);

-- 2. Backfill invalid gateway_status to NULL
UPDATE payments
SET gateway_status = NULL
WHERE gateway_status IS NOT NULL
  AND gateway_status NOT IN (
    'pending', 'authorized', 'confirmed', 'settled',
    'failed', 'refunded', 'chargeback'
  );

-- 3. Create replacement table with CHECK constraints
CREATE TABLE payments_new (
    id                TEXT PRIMARY KEY,
    sale_id           TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method            TEXT NOT NULL CHECK (method IN (
        'cash', 'card', 'card_debit', 'card_credit',
        'qris_manual', 'qris', 'bank_transfer', 'ewallet',
        'open_bill', 'credit', 'pay_later', 'other'
    )),
    amount_minor      INTEGER NOT NULL,
    currency          TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    gateway_reference TEXT,
    gateway_status    TEXT CHECK (gateway_status IN (
        'pending', 'authorized', 'confirmed', 'settled',
        'failed', 'refunded', 'chargeback'
    ) OR gateway_status IS NULL),
    gateway_response  TEXT,
    settled_at        TEXT,
    settled_by        TEXT,
    idempotency_key   TEXT
);

-- 4. Copy existing data
INSERT INTO payments_new
    (id, sale_id, method, amount_minor, currency, created_at,
     gateway_reference, gateway_status, gateway_response, settled_at,
     settled_by, idempotency_key)
    SELECT id, sale_id, method, amount_minor, currency, created_at,
           gateway_reference, gateway_status, gateway_response, settled_at,
           settled_by, idempotency_key
    FROM payments;

-- 5. Drop old table and rename new table
DROP TABLE payments;

ALTER TABLE payments_new RENAME TO payments;

-- 6. Explicitly reconstruct indexes
CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX idx_payments_sale_id ON payments(sale_id);
