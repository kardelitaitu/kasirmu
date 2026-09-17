-- 20260814_sent_reports.sql
-- Cloud report-send dedup table (from commit 47ffcc5b).
-- One row per (tenant, period), claimed BEFORE the email is sent.

CREATE TABLE IF NOT EXISTS sent_reports (
    tenant_id TEXT NOT NULL,
    period    TEXT NOT NULL,
    report_id TEXT NOT NULL,
    sent_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (tenant_id, period)
);
