-- 20260901_product_images.sql
--
-- Product & menu-item image storage spine (spec 0046b).
--
-- Content-addressed images: the DB stores ONLY hashes — never file paths,
-- never bytes. `products.image_hash` is a denormalized mirror of
-- `product_images` slot 1 kept in the same transaction (grid queries read
-- the product row only; no JOIN on the POS hot path). `product_images` is
-- authoritative and holds slots 1..5 (1 = primary, 2..5 = alternatives).
--
-- Invariants:
--   * menu item (product_type = 'restaurant') has exactly 1 image (slot 1);
--   * retail product has 1 primary + at most 4 alternatives;
--   * clearing slot 1 while alternatives exist promotes the first
--     alternative to primary (same transaction — see products_set_image).
--
-- `product_type` is free-text (no CHECK in either engine; the bridge writes
-- raw IPC strings into it), so the invariants above are enforced by the
-- comparators, not the schema — see modules/inventory/src/models.rs:95-97.
--
-- The bytes live in $APPCACHE/images/{hash16}.webp (Tauri asset protocol)
-- on the device and $OZ_IMAGE_DIR on the cloud; this table never sees them.

ALTER TABLE products ADD COLUMN image_hash TEXT;

CREATE TABLE IF NOT EXISTS product_images (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    slot       INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
    hash       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,   -- display order of alternatives
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (product_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_hash ON product_images(hash);
