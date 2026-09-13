-- 20260906_rename_store_to_location.sql
--
-- Rename the physical site unit from Store to Location while preserving
-- identifiers, rows, foreign-key relationships, and primary-location state.
--
-- This is deliberately limited to the site-unit schema surface. Workspace
-- types (including `warehouse`) and inventory stock points remain separate
-- concepts. The license-server wire field is renamed in a later, versioned
-- compatibility change; this migration only changes the local snapshot.

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = ON;

ALTER TABLE store_profiles RENAME TO locations;
ALTER TABLE user_store_access RENAME TO user_location_access;
ALTER TABLE user_location_access RENAME COLUMN store_id TO location_id;
ALTER TABLE tenant_subscription RENAME COLUMN max_stores TO max_locations;
ALTER TABLE workspace_instances RENAME COLUMN store_id TO location_id;
ALTER TABLE terminals RENAME COLUMN bound_store_id TO bound_location_id;

DROP INDEX IF EXISTS idx_store_profiles_primary;
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_primary
    ON locations(is_primary) WHERE is_primary = 1;

DROP INDEX IF EXISTS idx_user_store_access_user_id;
CREATE INDEX IF NOT EXISTS idx_user_location_access_user_id
    ON user_location_access(user_id);

UPDATE workspace_screens
SET screen_key = 'locations'
WHERE workspace_key = 'admin' AND screen_key = 'stores';
