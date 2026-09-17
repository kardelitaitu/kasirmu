-- PLANNED (stubs): media assets (images) + EDC terminal registry.
-- These tables are created now so the schema is ready, but the Store
-- methods that use them are stubs until the features are implemented.
--
-- All three tables are tenant-scoped for cloud parity: they carry a
-- `tenant_id` column and are listed in the PG RLS policy array (see
-- scripts/generate-pg-migration.py RLS_SQL + the hand-ported block in
-- 20260813_init.pg.sql). Local single-tenant SQLite rows use the
-- 'default' tenant.

-- Drop draft tables if re-applying due to DB-02 drift on existing dev DBs
DROP TABLE IF EXISTS media_thumbnails;
DROP TABLE IF EXISTS media_assets;
DROP TABLE IF EXISTS edc_terminals;

-- 1. Media assets — one row per uploaded image/file (product photos,
--    category icons, store logos, KDS images, etc.).
CREATE TABLE IF NOT EXISTS media_assets (
    id          TEXT PRIMARY KEY,          -- UUID v7
    tenant_id   TEXT NOT NULL DEFAULT 'default',  -- RLS tenant scope
    owner_type  TEXT NOT NULL,             -- 'product' | 'category' | 'store' | 'kds'
    owner_id    TEXT NOT NULL,             -- FK to the owning entity
    file_path   TEXT NOT NULL,             -- relative path under the media root
    mime_type   TEXT NOT NULL,             -- e.g. image/jpeg
    content_hash TEXT,                     -- SHA-256 of file bytes (dedup), NULL until indexed
    width       INTEGER,                   -- pixel width (NULL until decoded)
    height      INTEGER,                   -- pixel height (NULL until decoded)
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    original_name TEXT,                    -- user-supplied file name
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner
    ON media_assets(tenant_id, owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_media_assets_content_hash
    ON media_assets(tenant_id, content_hash);

-- 2. Media thumbnails — one row per generated thumbnail variant, linked
--    to its source asset.
CREATE TABLE IF NOT EXISTS media_thumbnails (
    id          TEXT PRIMARY KEY,          -- UUID v7
    tenant_id   TEXT NOT NULL DEFAULT 'default',  -- RLS tenant scope
    asset_id    TEXT NOT NULL,             -- FK to media_assets
    preset      TEXT NOT NULL,             -- 'icon' | 'small' | 'medium' | 'large'
    file_path   TEXT NOT NULL,             -- relative path under the media root
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_thumbnails_asset
    ON media_thumbnails(tenant_id, asset_id);

-- 3. EDC terminal registry — one row per configured card-payment
--    terminal (wired serial/USB or wireless Bluetooth/WiFi).
CREATE TABLE IF NOT EXISTS edc_terminals (
    id              TEXT PRIMARY KEY,      -- UUID v7
    tenant_id       TEXT NOT NULL DEFAULT 'default',  -- RLS tenant scope
    name            TEXT NOT NULL,         -- "Front counter EDC"
    connection_type TEXT NOT NULL          -- 'wired' | 'wireless'
                    CHECK (connection_type IN ('wired', 'wireless')),
    transport       TEXT NOT NULL,         -- 'serial' | 'usb' | 'bluetooth' | 'tcp'
    address         TEXT NOT NULL,         -- device path / MAC / host:port
    vendor          TEXT,                  -- e.g. 'ingenico' | 'verifone' | 'pax'
    model           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_edc_terminals_tenant
    ON edc_terminals(tenant_id, is_active);