-- 20260814_sales_tenant.sql
-- Add tenant_id to sales. The PostgreSQL init schema already carries it and
-- the code (db/sales.rs, db/kds.rs) inserts and queries sales.tenant_id, but
-- the SQLite init + incremental migrations never added the column — so every
-- sales write/read fails with "no column named tenant_id". Mirrors
-- 20260814_sale_lines_tenant.sql.

ALTER TABLE sales ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
