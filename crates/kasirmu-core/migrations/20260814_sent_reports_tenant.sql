-- 20260814_sent_reports_tenant.sql
-- Add created_at to sent_reports (from commit 3eb5ed76).
-- tenant_id already exists from old migration 114 / 20260814_sent_reports.sql.

ALTER TABLE sent_reports ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
