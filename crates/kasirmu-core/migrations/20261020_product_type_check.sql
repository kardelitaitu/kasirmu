-- 20261020_product_type_check.sql
--
-- Constrain products.product_type to closed set ('retail', 'restaurant', 'service').
--
-- Prior state:
-- `products.product_type` was free TEXT defaulting to 'retail' without a CHECK constraint.
-- Dead variant 'both' was removed from the codebase.
--
-- This migration:
-- 1. Defers foreign keys to allow table rebuild without cascade drops.
-- 2. Backfills any legacy/invalid/NULL product_type (including 'both') to 'retail'.
-- 3. Rebuilds `products` table with strict CHECK constraint (product_type IN ('retail', 'restaurant', 'service')).
-- 4. Re-creates all 6 indexes on products:
--    - idx_products_category_id
--    - idx_products_sku
--    - idx_products_store_category
--    - idx_products_tenant
--    - uq_products_barcode
--    - idx_products_tenant_sku

PRAGMA defer_foreign_keys = ON;

-- 1. Backfill legacy/invalid/NULL/both product_type to 'retail'
UPDATE products
SET product_type = 'retail'
WHERE product_type NOT IN ('retail', 'restaurant', 'service') OR product_type IS NULL;

-- 2. Create replacement table with CHECK constraint
CREATE TABLE products_new (
    id                  TEXT PRIMARY KEY,
    sku                 TEXT NOT NULL,
    name                TEXT NOT NULL,
    price_minor         INTEGER NOT NULL CHECK (price_minor >= 0),
    currency            TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    category_id         TEXT REFERENCES categories(id),
    barcode             TEXT,
    price_updated_at    TEXT DEFAULT '',
    track_serial        INTEGER NOT NULL DEFAULT 0,
    product_type        TEXT NOT NULL DEFAULT 'retail' CHECK (product_type IN ('retail', 'restaurant', 'service')),
    cost_minor          INTEGER NOT NULL DEFAULT 0,
    version             INTEGER NOT NULL DEFAULT 1,
    store_id            TEXT REFERENCES locations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    tenant_id           TEXT NOT NULL DEFAULT 'default',
    kitchen_zone        TEXT,
    brand               TEXT,
    rack_location       TEXT,
    notes               TEXT,
    unit                TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    default_supplier_id TEXT REFERENCES suppliers(id),
    popularity_score    REAL NOT NULL DEFAULT 0,
    image_hash          TEXT
);

-- 3. Copy existing data
INSERT INTO products_new (
    id, sku, name, price_minor, currency, created_at, updated_at, category_id,
    barcode, price_updated_at, track_serial, product_type, cost_minor, version,
    store_id, tenant_id, kitchen_zone, brand, rack_location, notes, unit,
    is_active, default_supplier_id, popularity_score, image_hash
)
SELECT
    id, sku, name, price_minor, currency, created_at, updated_at, category_id,
    barcode, price_updated_at, track_serial, product_type, cost_minor, version,
    store_id, tenant_id, kitchen_zone, brand, rack_location, notes, unit,
    is_active, default_supplier_id, popularity_score, image_hash
FROM products;

-- 4. Swap tables
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

-- 5. Reconstruct indexes
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_store_category ON products(store_id, category_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE UNIQUE INDEX uq_products_barcode ON products(barcode);
CREATE UNIQUE INDEX idx_products_tenant_sku ON products(tenant_id, sku);
