-- 20261016_shifts_drop_cross_db_fks.sql
--
-- Rebuild `shifts` table to drop cross-database foreign keys on `user_id` and
-- `terminal_id`.
--
-- WHY: Under multi-store isolation (ADR #4 / ADR #7 / ADR #35), `users` and
-- `terminals` live exclusively in the global identity database (`kasir.db`).
-- Per-store databases (`store-<id>.sqlite`) execute the migration sequence but
-- never receive user or terminal rows by architectural design.
--
-- `shifts` was authored in 20260813_init.sql with `user_id TEXT NOT NULL REFERENCES users(id)`
-- and `terminal_id TEXT REFERENCES terminals(id)`. Under SQLite `foreign_keys = ON`,
-- inserting any shift into a per-store database failed with a foreign key violation
-- because the target tables are empty in the store database.
--
-- Just like `sales.user_id`, `refunds.processed_by`, and `stock_counts.counted_by`,
-- references to global entities in store databases must be logical references
-- (unconstrained strings), authorized upstream against the global database.
--
-- Table rebuild pattern follows 20260928_document_kind_check.sql and
-- 20260926_tax_rate_scoped_authoring.sql using `PRAGMA defer_foreign_keys = ON;`.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE shifts_new (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    terminal_id           TEXT,
    opened_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closed_at             TEXT,
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    closing_balance_minor INTEGER,
    expected_cash_minor   INTEGER,
    cash_difference_minor INTEGER,
    total_sales_minor     INTEGER NOT NULL DEFAULT 0,
    total_cash_minor      INTEGER NOT NULL DEFAULT 0,
    total_card_minor      INTEGER NOT NULL DEFAULT 0,
    total_other_minor     INTEGER NOT NULL DEFAULT 0,
    total_voids_minor     INTEGER NOT NULL DEFAULT 0,
    total_refunds_minor   INTEGER NOT NULL DEFAULT 0,
    notes                 TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    total_payouts_minor   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO shifts_new
    (id, user_id, terminal_id, opened_at, closed_at, opening_balance_minor,
     closing_balance_minor, expected_cash_minor, cash_difference_minor,
     total_sales_minor, total_cash_minor, total_card_minor, total_other_minor,
     total_voids_minor, total_refunds_minor, notes, status, created_at,
     updated_at, total_payouts_minor)
    SELECT id, user_id, terminal_id, opened_at, closed_at, opening_balance_minor,
           closing_balance_minor, expected_cash_minor, cash_difference_minor,
           total_sales_minor, total_cash_minor, total_card_minor, total_other_minor,
           total_voids_minor, total_refunds_minor, notes, status, created_at,
           updated_at, total_payouts_minor
    FROM shifts;

DROP TABLE shifts;

ALTER TABLE shifts_new RENAME TO shifts;

CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON shifts(opened_at);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON shifts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_open_per_user ON shifts(user_id) WHERE status = 'open';
