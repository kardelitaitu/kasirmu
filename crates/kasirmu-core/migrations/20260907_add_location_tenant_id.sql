-- 20260907_add_location_tenant_id.sql
--
-- Add a `tenant_id` column to `locations` and `user_location_access` so the
-- cloud Postgres layer can enforce per-tenant isolation on location scopes
-- (Phase 1 tenant-isolation P0 item). These tables were created by the
-- 20260906 Store → Location rename but carried no tenant key, so cloud
-- RLS could not scope them.
--
-- Default 'default' preserves single-tenant store-DB semantics: a desktop
-- store database is scoped to one tenant by construction, and the cloud
-- seed row is the 'default' tenant's location.

ALTER TABLE locations
    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE user_location_access
    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
