-- 20261107_payments_gift_card_method.sql
--
-- Gift card tender unblocking (ADR-64 & owner-question-gift-card-tender.md Q1 Option A).
-- Widens payments.method CHECK constraint to include 'gift_card'.
--
-- Prior state:
-- 20261018_gateway_status_adr64_vocabulary.sql constrained payments.method to:
--     'cash', 'card', 'card_debit', 'card_credit',
--     'qris_manual', 'qris', 'bank_transfer', 'ewallet',
--     'open_bill', 'credit', 'pay_later', 'other'
--
-- Widened state adds 'gift_card'.
--
-- SQLite cannot ALTER a CHECK constraint, so the rebuild is the canonical route
-- (precedent: 20261017_payments_method_check.sql, 20261018_gateway_status_adr64_vocabulary.sql).
-- The rebuild preserves all 12 columns, the gateway_status CHECK, and re-creates
-- both idx_payments_idempotency_key and idx_payments_sale_id.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE payments_new (
    id                TEXT PRIMARY KEY,
    sale_id           TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method            TEXT NOT NULL CHECK (method IN (
        'cash', 'card', 'card_debit', 'card_credit',
        'qris_manual', 'qris', 'bank_transfer', 'ewallet',
        'open_bill', 'credit', 'pay_later', 'gift_card', 'other'
    )),
    amount_minor      INTEGER NOT NULL,
    currency          TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    gateway_reference TEXT,
    gateway_status    TEXT CHECK (gateway_status IN (
        'pending', 'authorized', 'confirmed', 'settled',
        'failed', 'voided', 'refunded', 'disputed', 'unconfirmed'
    ) OR gateway_status IS NULL),
    gateway_response  TEXT,
    settled_at        TEXT,
    settled_by        TEXT,
    idempotency_key   TEXT
);

INSERT INTO payments_new
    (id, sale_id, method, amount_minor, currency, created_at,
     gateway_reference, gateway_status, gateway_response, settled_at,
     settled_by, idempotency_key)
    SELECT id, sale_id, method, amount_minor, currency, created_at,
           gateway_reference, gateway_status, gateway_response, settled_at,
           settled_by, idempotency_key
    FROM payments;

DROP TABLE payments;

ALTER TABLE payments_new RENAME TO payments;

CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX idx_payments_sale_id ON payments(sale_id);
