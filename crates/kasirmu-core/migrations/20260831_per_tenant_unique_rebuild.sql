-- 20260831_per_tenant_unique_rebuild.sql
--
-- Restore the per-tenant uniqueness INTENT that 20260815 documented but
-- never actually achieved.
--
-- Story: commit e3f1bc80 gave products `UNIQUE (tenant_id, sku)` and users
-- `UNIQUE (tenant_id, username)`; the revert (62224b00) restored the
-- pre-drift init.sql — which carries the OLD inline global constraints
-- (`sku TEXT NOT NULL UNIQUE`, `username TEXT NOT NULL UNIQUE`) — and
-- 20260815 only re-created the composite indexes on top. The global
-- inline UNIQUE survived every upgrade and dominates the composite:
-- two tenants can never share a SKU or username, and the cloud snapshot
-- upserts (`ON CONFLICT (tenant_id, sku)` in sync_client) fail with a
-- bare constraint error instead of resolving. The Postgres port had been
-- silently hand-fixing this (composite FKs, no global uniques), which is
-- why only the faithful-schema PG tests caught it — once the regenerated
-- init.pg.sql stopped lying.
--
-- Fix (mirroring the old PG semantics exactly):
--   * rebuild products + users WITHOUT the inline global UNIQUE — the
--     20260815 composite indexes become the surviving uniqueness rule;
--   * retarget the four children whose FKs referenced products(sku)
--     (which requires a global unique on sku) to the composite
--     FOREIGN KEY (tenant_id, sku) REFERENCES products(tenant_id, sku),
--     matching the PG port; their own global uniques (variant sku,
--     bundle sku) stay — the PG tests encode exactly that;
--   * users' children reference users(id) (the PK) and need no change.
--
-- Mechanics: `PRAGMA defer_foreign_keys` (settable INSIDE the runner's
-- transaction, unlike `foreign_keys`) lets each parent DROP + RENAME
-- proceed while 10+ tables reference it; the deferred check at COMMIT
-- passes because every referenced row is copied. Same rebuild shape as
-- 20260822_kds_counter_store, plus the FK deferral. Indexes belong to
-- the table — DROP takes them with it — so each rebuild recreates its
-- full index set.

PRAGMA defer_foreign_keys = ON;

-- ── product_activity: tenant_id parity ────────────────────────────────
-- The cloud analytics bundle (email_pg.rs) joins this ledger on
-- a.tenant_id; the hand-ported PG schema carried a PG-only tenant_id
-- column to satisfy it while SQLite never had one — the exact drift the
-- faithful generator refuses to reproduce. Add the column on the SQLite
-- side (same shape 20260814 used for the other product children) so the
-- port is honest and the RLS entry is real on both engines.
ALTER TABLE product_activity ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- ── products ──────────────────────────────────────────────────────────
CREATE TABLE products_new (
    id          TEXT PRIMARY KEY,
    sku         TEXT NOT NULL,
    name        TEXT NOT NULL,
    price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
    currency    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    category_id TEXT REFERENCES categories(id),
    barcode     TEXT,
    price_updated_at TEXT DEFAULT '',
    track_serial INTEGER NOT NULL DEFAULT 0,
    product_type TEXT NOT NULL DEFAULT 'retail',
    cost_minor  INTEGER NOT NULL DEFAULT 0,
    version     INTEGER NOT NULL DEFAULT 1,
    store_id    TEXT REFERENCES store_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    kitchen_zone TEXT,
    brand TEXT,
    rack_location TEXT,
    notes TEXT,
    unit TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    default_supplier_id TEXT REFERENCES suppliers(id),
    popularity_score REAL NOT NULL DEFAULT 0
);

INSERT INTO products_new (
    id, sku, name, price_minor, currency, created_at, updated_at, category_id,
    barcode, price_updated_at, track_serial, product_type, cost_minor, version,
    store_id, tenant_id, kitchen_zone, brand, rack_location, notes, unit,
    is_active, default_supplier_id, popularity_score
)
SELECT
    id, sku, name, price_minor, currency, created_at, updated_at, category_id,
    barcode, price_updated_at, track_serial, product_type, cost_minor, version,
    store_id, tenant_id, kitchen_zone, brand, rack_location, notes, unit,
    is_active, default_supplier_id, popularity_score
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_store_category ON products(store_id, category_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE UNIQUE INDEX uq_products_barcode ON products(barcode);
CREATE UNIQUE INDEX idx_products_tenant_sku ON products(tenant_id, sku);

-- ── users ─────────────────────────────────────────────────────────────
CREATE TABLE users_new (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    pin_hash    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role_id     TEXT NOT NULL REFERENCES roles(id),
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    date_of_birth TEXT,
    phone TEXT,
    national_id_type TEXT,
    national_id TEXT,
    email TEXT,
    monthly_take_home_minor INTEGER,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    job_title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    address TEXT,
    language TEXT,
    avatar TEXT,
    tax_id TEXT,
    national_id_expires_at TEXT,
    emergency_contact_relationship TEXT,
    hire_date TEXT,
    national_id_hash TEXT
);

INSERT INTO users_new (
    id, username, pin_hash, display_name, role_id, is_active, created_at,
    updated_at, tenant_id, date_of_birth, phone, national_id_type, national_id,
    email, monthly_take_home_minor, emergency_contact_name,
    emergency_contact_phone, job_title, notes, address, language, avatar,
    tax_id, national_id_expires_at, emergency_contact_relationship, hire_date,
    national_id_hash
)
SELECT
    id, username, pin_hash, display_name, role_id, is_active, created_at,
    updated_at, tenant_id, date_of_birth, phone, national_id_type, national_id,
    email, monthly_take_home_minor, emergency_contact_name,
    emergency_contact_phone, job_title, notes, address, language, avatar,
    tax_id, national_id_expires_at, emergency_contact_relationship, hire_date,
    national_id_hash
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_national_id ON users(national_id);
CREATE UNIQUE INDEX idx_users_national_id_hash ON users(national_id_hash);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_username ON users(username);
CREATE UNIQUE INDEX idx_users_tenant_username ON users(tenant_id, username);

-- ── product_variants (FK retarget; own sku uniqueness stays global,
--    matching the PG port) ─────────────────────────────────────────────
CREATE TABLE product_variants_new (
    id              TEXT PRIMARY KEY,
    parent_sku      TEXT NOT NULL,
    name            TEXT NOT NULL,
    sku             TEXT NOT NULL UNIQUE,
    price_minor     INTEGER,
    currency        TEXT,
    barcode         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (tenant_id, parent_sku) REFERENCES products(tenant_id, sku) ON DELETE CASCADE
);

INSERT INTO product_variants_new (
    id, parent_sku, name, sku, price_minor, currency, barcode, sort_order,
    is_active, created_at, updated_at, tenant_id
)
SELECT
    id, parent_sku, name, sku, price_minor, currency, barcode, sort_order,
    is_active, created_at, updated_at, tenant_id
FROM product_variants;

DROP TABLE product_variants;
ALTER TABLE product_variants_new RENAME TO product_variants;

CREATE INDEX idx_product_variants_parent ON product_variants(parent_sku);
CREATE UNIQUE INDEX uq_product_variants_barcode ON product_variants(barcode);

-- ── bundle_items (FK retarget) ────────────────────────────────────────
CREATE TABLE bundle_items_new (
    id          TEXT PRIMARY KEY,
    bundle_id   TEXT NOT NULL REFERENCES product_bundles(id),
    sku         TEXT NOT NULL,
    qty         INTEGER NOT NULL DEFAULT 1,
    unit_price_minor INTEGER,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (tenant_id, sku) REFERENCES products(tenant_id, sku)
);

INSERT INTO bundle_items_new (id, bundle_id, sku, qty, unit_price_minor, tenant_id)
SELECT id, bundle_id, sku, qty, unit_price_minor, tenant_id
FROM bundle_items;

DROP TABLE bundle_items;
ALTER TABLE bundle_items_new RENAME TO bundle_items;

-- ── product_taxes (FK retarget; PK unchanged) ─────────────────────────
CREATE TABLE product_taxes_new (
    product_sku  TEXT NOT NULL,
    tax_rate_id  TEXT NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    PRIMARY KEY (product_sku, tax_rate_id),
    FOREIGN KEY (tenant_id, product_sku) REFERENCES products(tenant_id, sku) ON DELETE CASCADE
);

INSERT INTO product_taxes_new (product_sku, tax_rate_id, created_at, tenant_id)
SELECT product_sku, tax_rate_id, created_at, tenant_id
FROM product_taxes;

DROP TABLE product_taxes;
ALTER TABLE product_taxes_new RENAME TO product_taxes;

-- ── product_bundles (FK retarget; own bundle_sku uniqueness stays
--    global, matching the PG port) ─────────────────────────────────────
CREATE TABLE product_bundles_new (
    id          TEXT PRIMARY KEY,
    bundle_sku  TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    bundle_price_minor INTEGER,
    currency    TEXT NOT NULL DEFAULT 'USD',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (tenant_id, bundle_sku) REFERENCES products(tenant_id, sku)
);

INSERT INTO product_bundles_new (
    id, bundle_sku, name, description, bundle_price_minor, currency, active,
    created_at, updated_at, tenant_id
)
SELECT
    id, bundle_sku, name, description, bundle_price_minor, currency, active,
    created_at, updated_at, tenant_id
FROM product_bundles;

DROP TABLE product_bundles;
ALTER TABLE product_bundles_new RENAME TO product_bundles;
