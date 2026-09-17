-- Multi-KDS architecture: device registry + restaurant_pos scoping
-- See plan_multi_kds_one_location_support.md for full context.

-- 1. KDS device registry — one row per enrolled Kitchen Display.
CREATE TABLE IF NOT EXISTS kds_devices (
    id                  TEXT PRIMARY KEY,          -- UUID v7
    name                TEXT NOT NULL,             -- "Kitchen Display A"
    restaurant_pos_id   TEXT NOT NULL,             -- FK to the owning Restaurant POS terminal
    station_ids         TEXT NOT NULL DEFAULT '[]', -- JSON array of topology station IDs
    pairing_token_hash  TEXT NOT NULL,             -- SHA-256 of the QR enrollment token
    pairing_expires_at  TEXT NOT NULL,             -- ISO-8601 expiry timestamp
    is_active           INTEGER NOT NULL DEFAULT 1,
    last_seen_at        TEXT,                      -- nullable; NULL when never connected
    connection_status   TEXT NOT NULL DEFAULT 'disconnected'
                        CHECK (connection_status IN ('connected', 'disconnected', 'stale')),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (restaurant_pos_id) REFERENCES terminals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kds_devices_restaurant
    ON kds_devices(restaurant_pos_id);

-- 2. Add restaurant_pos_id to existing KDS tables for scoping.
--    Nullable default ensures backward compatibility: existing rows get NULL
--    which means "unscoped" (visible to all, matching current behavior).

ALTER TABLE kds_orders ADD COLUMN restaurant_pos_id TEXT;
ALTER TABLE kds_line_items ADD COLUMN restaurant_pos_id TEXT;
ALTER TABLE kds_order_targets ADD COLUMN restaurant_pos_id TEXT;

-- 3. Add ack tracking columns for optimistic-lock order acknowledgment.
ALTER TABLE kds_orders ADD COLUMN acked_by_device TEXT;
ALTER TABLE kds_orders ADD COLUMN acked_at TEXT;

-- 4. Performance indexes for multi-KDS queries.
CREATE INDEX IF NOT EXISTS idx_kds_orders_restaurant_pos
    ON kds_orders(restaurant_pos_id);
CREATE INDEX IF NOT EXISTS idx_kds_line_items_restaurant_pos
    ON kds_line_items(restaurant_pos_id);
CREATE INDEX IF NOT EXISTS idx_kds_order_targets_restaurant_pos
    ON kds_order_targets(restaurant_pos_id);
