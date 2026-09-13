-- Multi-station KDS routing rules (todo-kds-agents-1.md, backend slice).
-- An explicit per-line station assignment that overrides/augments the
-- product kitchen_zone default consumed by resolve_kds_targets. Rules
-- COMPOSE with the frozen 3-phase router: a matched rule supplies the
-- station for its line, unmatched lines fall back to kitchen_zone, and
-- device matching / broadcast fallback / catch-all are untouched.
-- No money columns and no floats: priority is an integer rank
-- (lower number = higher priority).
--
-- 'tag' is admitted by the CHECK for schema stability, but the catalog
-- does not model product tags yet — a tag rule stores and round-trips
-- cleanly and never matches at routing time (stamped in the work order).

CREATE TABLE IF NOT EXISTS kds_routing_rules (
    id                 TEXT PRIMARY KEY,          -- UUID v7
    restaurant_pos_id  TEXT NOT NULL,             -- FK to the owning Restaurant POS terminal
    priority           INTEGER NOT NULL,          -- lower number = higher priority; ranks rules per line
    matcher_kind       TEXT NOT NULL
                       CHECK (matcher_kind IN ('sku', 'category', 'tag')),
    matcher_value      TEXT NOT NULL,             -- SKU string or category id, per matcher_kind
    target_station     TEXT NOT NULL,             -- topology station the matched line routes to
    is_active          INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (restaurant_pos_id) REFERENCES terminals(id) ON DELETE CASCADE
);

-- No secondary index: a rule set is O(tens) of rows per terminal inside
-- the per-store DB, and the only read path filters by restaurant_pos_id.
