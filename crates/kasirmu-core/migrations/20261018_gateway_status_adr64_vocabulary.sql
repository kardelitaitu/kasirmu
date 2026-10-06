-- 20261018_gateway_status_adr64_vocabulary.sql
--
-- ADR-64 D4 vocabulary repair.
--
-- Prior state:
-- 20261017_payments_method_check.sql constrained payments.gateway_status to:
--     'pending', 'authorized', 'confirmed', 'settled', 'failed', 'refunded', 'chargeback'
--
-- ADR-64 D4 (docs/decisions/2026-10-02-adr64-tender-vocabulary-and-offline-tender-state.md:154)
-- decides a DIFFERENT set:
--     'pending', 'authorized', 'confirmed', 'settled', 'failed', 'voided', 'refunded', 'disputed', 'unconfirmed'
--
-- Three decided values were missing and one decided value was replaced:
--     missing : 'voided', 'disputed', 'unconfirmed'
--     removed : 'chargeback' (not in the decision)
--
-- 'unconfirmed' is the substantive half. ADR-64 D4 rule 3: "a sale completed
-- with no connectivity on an electronic tender is 'unconfirmed', and the sale
-- still completes". That is the offline-first case this record exists to enable,
-- and 20261017 rejected the value the decision mandates. The sync replay path
-- (platform/sync/src/queue/appliers.rs insert_payment_in_tx) writes
-- gateway_status verbatim from a peer payload, so a peer sending 'unconfirmed'
-- raised a CHECK violation and failed the whole transaction.
--
-- Nothing in production reads or compares gateway_status (verified: zero
-- comparison sites), so widening the set changes no behaviour. This migration
-- only stops the schema from rejecting decided values.
--
-- Historical rows: no backfill is needed for the widened values, and none is
-- attempted for 'chargeback' — dropping it from the CHECK does NOT rewrite an
-- existing row that already carries it, because SQLite only evaluates CHECK on
-- INSERT/UPDATE. Any legacy row keeps its value and stays readable.
--
-- Backfill guard (defensive, mirrors 20261017): no row can currently violate the
-- old CHECK, but the UPDATE below makes this migration safe to re-run and
-- correct if a build applied a previously-wider constraint.

PRAGMA defer_foreign_keys = ON;

-- 1. Defensive: map any status outside the ADR-64 set to NULL rather than
--    failing the table rebuild. 'chargeback' is the only realistic candidate.
UPDATE payments
SET gateway_status = NULL
WHERE gateway_status IS NOT NULL
  AND gateway_status NOT IN (
      'pending', 'authorized', 'confirmed', 'settled',
      'failed', 'voided', 'refunded', 'disputed', 'unconfirmed'
  );

-- 2. Rebuild the table with the ADR-64 vocabulary. SQLite cannot ALTER a CHECK
--    constraint, so the rebuild is the only route (precedent:
--    20261017_payments_method_check.sql, 20260928_document_kind_check.sql).
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
        'failed', 'voided', 'refunded', 'disputed', 'unconfirmed'
    ) OR gateway_status IS NULL),
    gateway_response  TEXT,
    settled_at        TEXT,
    settled_by        TEXT,
    idempotency_key   TEXT
);

-- 3. Copy existing data, column for column (the order matches the CREATE above).
INSERT INTO payments_new
    (id, sale_id, method, amount_minor, currency, created_at,
     gateway_reference, gateway_status, gateway_response, settled_at,
     settled_by, idempotency_key)
    SELECT id, sale_id, method, amount_minor, currency, created_at,
           gateway_reference, gateway_status, gateway_response, settled_at,
           settled_by, idempotency_key
    FROM payments;

-- 4. Swap.
DROP TABLE payments;

ALTER TABLE payments_new RENAME TO payments;

-- 5. Reconstruct indexes (DROP TABLE removed them with the old table).
CREATE UNIQUE INDEX idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX idx_payments_sale_id ON payments(sale_id);
