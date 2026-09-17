-- 20260827_refunds_tenant.sql
-- Add tenant_id to refunds, mirroring 20260814_sale_lines_tenant.sql.
--
-- Required for the cloud cutover tool (which copies columns verbatim) and
-- for Postgres row-level security on the new refunds table: email reports
-- net refunds per tenant exactly like sales.

ALTER TABLE refunds ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
