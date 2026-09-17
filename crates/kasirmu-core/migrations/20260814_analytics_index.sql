-- 20260814_analytics_index.sql
-- Expression index for analytics queries (from commit ed76ebc6).

CREATE INDEX IF NOT EXISTS idx_sales_status_created_date
    ON sales(status, date(created_at));
