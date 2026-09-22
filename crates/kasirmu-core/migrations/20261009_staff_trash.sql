-- 20261009_staff_trash.sql
--
-- Soft delete plus a 90-day retention window for staff accounts.
--
-- WHY THE TRASH MARKS THE ROW INSTEAD OF DELETING IT. `users` is referenced by
-- `inventory_shifts.user_id` and `inventory_transactions.staff_id` ON DELETE
-- RESTRICT, and `audit_log.user_id` is NOT NULL with no cascade — so
-- `DELETE FROM users` fails for any member who ever opened a shift, took stock,
-- or triggered an audit event, which is every member with history worth keeping.
-- Deletion therefore stamps the row, and the 90-day purge ANONYMISES it in place
-- (`Store::purge_expired_users`), keeping the id so historical rows still resolve
-- to a tombstone rather than to nothing.
--
-- deleted_at — when the member entered the trash. This is the retention clock.
-- purged_at  — when the personal data was erased. Written once and never
--              cleared: a purged row is a tombstone and must not be restorable.

ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN purged_at TEXT;

-- Both the trash listing and the retention sweep filter on `deleted_at IS NOT
-- NULL`; the partial index holds trashed rows only, so the live roster — the
-- hot path, and the one that runs on every Boot — pays nothing for it.
CREATE INDEX IF NOT EXISTS idx_users_trash
    ON users(deleted_at)
    WHERE deleted_at IS NOT NULL;
