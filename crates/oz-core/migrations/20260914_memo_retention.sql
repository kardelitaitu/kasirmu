-- 20260914_memo_retention.sql
--
-- Memo retention (Phase 2 P1, ruled 2026-09-07): stopped and expired Memos
-- remain archived for 30 days before deletion or anonymization.
--
-- The 30-day clock needs an instant anchored to ARCHIVAL, not to the memo's
-- end: `stopped_at`/`expires_at` record when a memo ended, but a memo swept
-- to `archived` later would otherwise have no timestamp to age from. The
-- nullable `archived_at` column is stamped by the retention sweep when it
-- transitions `stopped/expired → archived`, and the same sweep deletes rows
-- whose `archived_at` is past the window. `archived` is terminal in the
-- state machine, so only the sweep ever writes the column.
--
-- Plain ADD COLUMN: `memos` carries no FK participation for SQLite to trip
-- on (20260913 already rebuilt the table without `location_id`), and NULL
-- keeps every existing row exactly where it is — a draft/published/stopped/
-- expired memo has never been archived.

ALTER TABLE memos ADD COLUMN archived_at TEXT;
