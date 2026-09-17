-- 20260814_offline_queue_index.sql
-- Index for offline queue pull path (from commit 5b5f81b8).

CREATE INDEX IF NOT EXISTS idx_offline_queue_tenant_created
    ON offline_queue(tenant_id, created_at);
