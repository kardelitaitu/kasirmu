-- 20261023_offline_queue_sale_id.sql
--
-- Indexed sale_id column on offline_queue for O(1) point-probe idempotency checks (O-M04).
-- Replaces full backlog scanning on the checkout path with a covering index seek.
--
-- PRE-MIGRATION: has_pending_outbox_row_for_sale ran an index range over EVERY
-- pending outbox row using idx_offline_queue_status(status), substring-scanning
-- each payload with instr(payload, '"sale_id":"..."'). The cost was proportional
-- to the entire pending backlog, paid by every checkout settlement.
--
-- POST-MIGRATION: indexed sale_id column allows a covering index seek
-- (sale_id, status, action) in O(log N). For legacy pre-existing rows where
-- sale_id IS NULL, the probe preserves backward compatibility via fallback.
--
-- ADD COLUMN has no IF NOT EXISTS in SQLite, so the column stands on the
-- drift path's pragma_table_info fallback (precedent: 20261007_sync_origin_and_effect_key.sql),
-- while the indexes are guarded outright.

ALTER TABLE offline_queue ADD COLUMN sale_id TEXT;

CREATE INDEX IF NOT EXISTS idx_offline_queue_sale_pending
    ON offline_queue(sale_id, status, action)
    WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offline_queue_status_action
    ON offline_queue(status, action);
