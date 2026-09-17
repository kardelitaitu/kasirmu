-- 20260815_tenant_unique_indexes.sql
-- Restore the per-tenant SKU/username unique indexes on SQLite.
--
-- Commit e3f1bc80 gave products `UNIQUE (tenant_id, sku)` and users
-- `UNIQUE (tenant_id, username)` in the consolidated init, matching the
-- Postgres port. The migration revert (62224b00) restored the pre-drift
-- init.sql but only kept the child-table tenant_id columns, so SQLite lost
-- the composite unique targets that the cloud snapshot upserts
-- (sync_client `ON CONFLICT (tenant_id, sku)` / `(tenant_id, username)`)
-- and the Store create path resolve against. Without them the upserts fail
-- with "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE
-- constraint". Re-creating the indexes here keeps fresh installs and
-- upgraded databases identical (DB-02).

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tenant_sku
    ON products(tenant_id, sku);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username
    ON users(tenant_id, username);
