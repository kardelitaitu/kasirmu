-- 20260814_sale_lines_tenant.sql
-- Add tenant_id to sale_lines (from commit 7e627e2e).

ALTER TABLE sale_lines ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
