-- 20261025_product_activity_created_at.sql
-- Covering range index for unrestricted window popularity recompute (O-M68).
--
-- `recompute_all_popularity` (crates/kasirmu-core/src/db/popularity.rs) executes:
--   SELECT sku, event_type, strftime('%Y-%m-%d', created_at) AS day, COUNT(*) AS cnt
--     FROM product_activity
--    WHERE created_at >= datetime('now', ?1)
--    GROUP BY sku, event_type, day
--
-- Before this migration, `product_activity` only carried `idx_product_activity_sku(sku)`.
-- Without a sku predicate in the query, SQLite fell back to:
--   SCAN product_activity USING INDEX idx_product_activity_sku
-- traversing every row in the entire activity ledger before applying `created_at >=`.
--
-- This index leads on `created_at` to turn the scan into a range `SEARCH ... (created_at>?)`,
-- and covers `sku` and `event_type` so the query is answered entirely from the index
-- without fetching table pages.

CREATE INDEX IF NOT EXISTS idx_product_activity_created_at
    ON product_activity(created_at, sku, event_type);
