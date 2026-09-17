-- 20260814_tenant_uniqueness.sql
-- Per-tenant SKU and username uniqueness (from commit e3f1bc80).

ALTER TABLE bundle_items ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE product_bundles ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE product_taxes ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE product_variants ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
