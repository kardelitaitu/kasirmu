-- ── 20260823_po_receive_state.sql ─────────────────────────────────────
-- Adds per-line receive quantities to purchase_order_lines so the
-- warehouse receive workflow can record received, damaged, and short
-- quantities separately (Phase 2 of the warehouse POS console).
--
-- Forward-only: ALTER TABLE ADD COLUMN is idempotent with IF NOT EXISTS
-- (SQLite ignores the whole statement when the column already exists).

ALTER TABLE purchase_order_lines ADD COLUMN received_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_lines ADD COLUMN damaged_qty  INTEGER NOT NULL DEFAULT 0;