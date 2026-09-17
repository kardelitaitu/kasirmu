-- ====================================================================
-- OZ-POS Database Schema — Full Reset (v1)
-- Generated from 131 historical migrations
-- Date: 2026-08-13
-- ====================================================================

CREATE TABLE IF NOT EXISTS active_carts (
    id              TEXT PRIMARY KEY NOT NULL,
    cart_data       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, deduction_location_id TEXT
    REFERENCES inventory_locations(id) ON DELETE RESTRICT, location_override_at TEXT);

CREATE TABLE IF NOT EXISTS assignment_branches (
    assignment_user_id TEXT NOT NULL REFERENCES assignments(user_id) ON DELETE CASCADE,
    branch_id          TEXT NOT NULL,
    PRIMARY KEY (assignment_user_id, branch_id)
);

CREATE TABLE IF NOT EXISTS assignment_workspaces (
    assignment_user_id TEXT NOT NULL REFERENCES assignments(user_id) ON DELETE CASCADE,
    workspace_key      TEXT NOT NULL REFERENCES workspaces(key) ON DELETE CASCADE,
    PRIMARY KEY (assignment_user_id, workspace_key)
);

CREATE TABLE IF NOT EXISTS assignments (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role_id         TEXT NOT NULL REFERENCES roles(id),
    scope_mode      TEXT NOT NULL DEFAULT 'global' CHECK (scope_mode IN ('global', 'scoped')),
    branch_scope    TEXT NOT NULL DEFAULT 'all'  CHECK (branch_scope IN ('all', 'list')),
    workspace_scope TEXT NOT NULL DEFAULT 'all'  CHECK (workspace_scope IN ('all', 'list')),
    expires_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,                          -- UUID v4
    user_id     TEXT NOT NULL,                             -- FK to users.id (nullable if action is from system)
    action      TEXT NOT NULL,                             -- e.g. "sale.void", "sale.refund", "settings.change", "login", "export"
    target_type TEXT,                                      -- e.g. "sale", "user", "setting"
    target_id   TEXT,                                      -- e.g. sale UUID, username, setting key
    details     TEXT DEFAULT '{}',                         -- JSON blob with action-specific metadata
    outcome     TEXT NOT NULL DEFAULT 'success',           -- "success" or "failure"
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_review_checkpoints (
    id                           TEXT PRIMARY KEY,
    store_id                     TEXT NOT NULL,
    reviewer_user_id             TEXT NOT NULL,
    reviewed_at                  TEXT NOT NULL,             -- ISO-8601 review action time
    reviewed_through_created_at  TEXT NOT NULL,             -- newest entry.created_at covered
    reviewed_through_id          TEXT NOT NULL,             -- tie-breaker entry id covered
    created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS bundle_items (
    id          TEXT PRIMARY KEY,
    bundle_id   TEXT NOT NULL REFERENCES product_bundles(id),
    sku         TEXT NOT NULL REFERENCES products(sku),
    qty         INTEGER NOT NULL DEFAULT 1,
    -- Override the component's individual price (empty = use product's price)
    unit_price_minor INTEGER
);

CREATE TABLE IF NOT EXISTS cash_payouts (
    id          TEXT PRIMARY KEY,
    shift_id    TEXT NOT NULL REFERENCES shifts(id),
    amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
    reason      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    colour     TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, icon TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS category_taxes (
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    tax_rate_id TEXT NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (category_id, tax_rate_id)
);

CREATE TABLE IF NOT EXISTS currencies (
    code            TEXT PRIMARY KEY,          -- ISO-4217 alpha-3, e.g. "USD"
    numeric_code    TEXT NOT NULL,             -- ISO-4217 numeric, e.g. "840"
    name            TEXT NOT NULL,             -- Display name, e.g. "US Dollar"
    minor_exponent  INTEGER NOT NULL DEFAULT 2, -- Decimal places, e.g. 2 for USD
    symbol          TEXT NOT NULL DEFAULT '',  -- Currency symbol, e.g. "$"
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS "customers" (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    loyalty_points  INTEGER NOT NULL DEFAULT 0,
    total_spent_minor INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'USD',
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    store_id        TEXT REFERENCES store_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id              TEXT PRIMARY KEY,
    from_currency   TEXT NOT NULL REFERENCES currencies(code),
    to_currency     TEXT NOT NULL REFERENCES currencies(code),
    source          TEXT NOT NULL DEFAULT 'manual', -- manual, api, etc.
    effective_date  TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), rate_millionths INTEGER NOT NULL DEFAULT 0,
    UNIQUE (from_currency, to_currency, effective_date)
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id                  TEXT PRIMARY KEY,
    gift_card_id        TEXT NOT NULL REFERENCES gift_cards(id),
    sale_id             TEXT REFERENCES sales(id),
    txn_type            TEXT NOT NULL CHECK (txn_type IN ('issue', 'redeem', 'topup', 'refund')),
    amount_minor        INTEGER NOT NULL,
    balance_after_minor INTEGER NOT NULL,
    notes               TEXT NOT NULL DEFAULT '',
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_cards (
    id                      TEXT PRIMARY KEY,
    card_number             TEXT UNIQUE NOT NULL,
    pin                     TEXT NOT NULL DEFAULT '',
    initial_balance_minor   INTEGER NOT NULL DEFAULT 0,
    current_balance_minor   INTEGER NOT NULL DEFAULT 0,
    currency                TEXT NOT NULL DEFAULT 'IDR',
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'frozen', 'redeemed', 'expired')),
    issued_to               TEXT NOT NULL DEFAULT '',
    issue_date              TEXT NOT NULL,
    expiry_date             TEXT,
    created_by              TEXT REFERENCES users(id),
    updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hardware_profiles (
    terminal_id    TEXT PRIMARY KEY,
    profile_json   TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS held_carts (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    cart_data       TEXT NOT NULL,
    item_count      INTEGER NOT NULL DEFAULT 0,
    total_minor     INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'USD',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, bill_type TEXT NOT NULL DEFAULT 'hold', customer_name TEXT, deduction_location_id TEXT
    REFERENCES inventory_locations(id) ON DELETE RESTRICT);

CREATE TABLE IF NOT EXISTS inventory (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty        INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), location_id TEXT
    NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    PRIMARY KEY (product_id)
);

CREATE TABLE IF NOT EXISTS inventory_locations (
    id          TEXT PRIMARY KEY,                            -- UUID v7
    name        TEXT NOT NULL,                               -- 'Store Inventory', 'Warehouse A'
    type        TEXT NOT NULL DEFAULT 'store'
                CHECK (type IN ('store', 'warehouse', 'transit', 'damaged', 'virtual')),
    description TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS inventory_shifts (
    id          TEXT PRIMARY KEY,                              -- UUID v7
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    terminal_id TEXT REFERENCES terminals(id),                -- nullable; terminal that opened the shift
    started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at    TEXT,                                          -- nullable; non-null when status = 'ended'
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'ended')),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS inventory_transaction_lines (
    id               TEXT PRIMARY KEY,                               -- UUID v7
    transaction_id   TEXT NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
    sku              TEXT NOT NULL,
    product_name     TEXT NOT NULL DEFAULT '',
    qty              INTEGER NOT NULL CHECK (qty > 0),
    barcode_scanned  TEXT,                                           -- nullable; the barcode actually scanned
    sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id                TEXT PRIMARY KEY,                              -- UUID v7
    type              TEXT NOT NULL CHECK (type IN (
                          'receive',        -- goods received (from supplier or PO)
                          'transfer-out',   -- goods sent to another location
                          'transfer-in',    -- goods received from another location
                          'adjust',         -- manual stock correction
                          'count',          -- stock take / physical count
                          'sale',           -- POS sale deduction (ADR-19 §2)
                          'void',           -- sale void compensating credit (ADR-19 §5.3)
                          'refund',         -- sale refund compensating credit (ADR-19 §5.3)
                          'transfer',       -- generic stock transfer
                          'purchase-order-receive', -- PO receipt
                          'stock-count',    -- inventory stock-take / physical count
                          'manual-adjustment' -- manager override adjustment
                      )),
    location_id       TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    staff_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    transfer_id       TEXT REFERENCES stock_transfers(id),            -- nullable; set for transfer types
    purchase_order_id TEXT REFERENCES purchase_orders(id),            -- nullable; set for PO receiving
    notes             TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, inventory_shift_id TEXT
    REFERENCES inventory_shifts(id));

CREATE TABLE IF NOT EXISTS kds_daily_counters (
    -- Display-number counter per (day, store): each store's tickets start
    -- at #1 daily. '' = legacy single-store rows (no store identity).
    date        TEXT NOT NULL,
    store_id    TEXT NOT NULL DEFAULT '',
    counter     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, store_id)
);

CREATE TABLE IF NOT EXISTS kds_line_items (
    id              TEXT PRIMARY KEY,                              -- UUIDv7
    kds_order_id    TEXT NOT NULL REFERENCES kds_orders(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    display_name    TEXT NOT NULL,                                 -- product name at creation time
    qty             INTEGER NOT NULL CHECK(qty > 0),
    course          TEXT,                                          -- NULL | "appetizer" | "main" | "dessert" | "beverage"
    modifiers_json  TEXT,                                          -- NULL | JSON array of { name, choice, price_minor }
    line_position   INTEGER NOT NULL DEFAULT 0,
    item_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK(item_status IN ('pending','preparing','ready','served','cancelled')),
    started_at      TEXT,
    ready_at        TEXT,
    served_at       TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kds_order_targets (
    kds_order_id     TEXT NOT NULL REFERENCES kds_orders(id) ON DELETE CASCADE,
    target_instance_id TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (kds_order_id, target_instance_id)
);

CREATE TABLE IF NOT EXISTS "kds_orders" (
    id              TEXT PRIMARY KEY,
    -- One order per sale AND kitchen zone: a sale with items in multiple
    -- zones fans out into one ticket per zone (multi-KDS routing), so the
    -- uniqueness key is the (sale, zone) pair, not the sale alone.
    sale_id         TEXT NOT NULL REFERENCES sales(id),
    -- Valid states: pending (received, not started), preparing,
    -- ready (cooked, awaiting pickup), served (delivered),
    -- cancelled (voided by kitchen or POS).
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'cancelled')),
    items_summary   TEXT NOT NULL DEFAULT '',
    item_count      INTEGER NOT NULL DEFAULT 0,
    display_number  INTEGER,
    received_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at      TEXT,
    ready_at        TEXT,
    served_at       TEXT,
    prep_time_seconds INTEGER DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT ''
, store_id TEXT, kitchen_zone TEXT, table_number TEXT, priority INTEGER NOT NULL DEFAULT 0, target_instance_id TEXT,
    UNIQUE (sale_id, kitchen_zone));

CREATE TABLE IF NOT EXISTS login_attempts (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    attempted_at INTEGER NOT NULL  -- Unix epoch seconds
, device_id TEXT);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id),
    points      INTEGER NOT NULL DEFAULT 0,
    lifetime_points INTEGER NOT NULL DEFAULT 0,
    tier_id     TEXT REFERENCES loyalty_tiers(id),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    min_points  INTEGER NOT NULL DEFAULT 0,
    points_per_unit INTEGER NOT NULL DEFAULT 10,
    earn_multiplier REAL NOT NULL DEFAULT 1.0,
    colour      TEXT NOT NULL DEFAULT '#6b7280',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES loyalty_accounts(id),
    sale_id     TEXT REFERENCES sales(id),
    points      INTEGER NOT NULL,
    txn_type    TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS modifier_groups (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
    max_selections INTEGER NOT NULL DEFAULT 1 CHECK (max_selections >= 1),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (max_selections >= min_selections)
);

CREATE TABLE IF NOT EXISTS modifiers (
    id             TEXT PRIMARY KEY,
    group_id       TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    price_minor    INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_default     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS offline_queue (
    id              TEXT PRIMARY KEY,
    action          TEXT NOT NULL,          -- e.g. "complete_sale", "void_sale"
    payload         TEXT NOT NULL,          -- JSON-serialized action data
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | synced | failed
    retry_count     INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    synced_at       TEXT
, tenant_id TEXT NOT NULL DEFAULT 'default', priority INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS payments (
    id          TEXT PRIMARY KEY,
    sale_id     TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method      TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency    TEXT NOT NULL,
    created_at  TEXT NOT NULL
, gateway_reference TEXT, gateway_status TEXT, gateway_response TEXT, settled_at TEXT, settled_by TEXT, idempotency_key TEXT);

CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,   -- 'stripe' or 'square'
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    event_type TEXT           -- e.g. 'payment_intent.succeeded'
);

CREATE TABLE IF NOT EXISTS product_activity (
    id         TEXT PRIMARY KEY,
    sku        TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('search', 'edit')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS product_bundles (
    id          TEXT PRIMARY KEY,
    bundle_sku  TEXT NOT NULL UNIQUE REFERENCES products(sku),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- The bundle's own price in minor units (overrides the sum of components if set)
    bundle_price_minor INTEGER,
    -- Currency (must match component currencies)
    currency    TEXT NOT NULL DEFAULT 'USD',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_id   TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS product_recipes (
    id                    TEXT PRIMARY KEY,
    parent_product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_required     INTEGER NOT NULL CHECK (quantity_required > 0),
    unit                  TEXT NOT NULL DEFAULT 'pcs',
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (parent_product_id, ingredient_product_id)
);

CREATE TABLE IF NOT EXISTS product_taxes (
    product_sku  TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
    tax_rate_id  TEXT NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (product_sku, tax_rate_id)
);

CREATE TABLE IF NOT EXISTS product_variants (
    id              TEXT PRIMARY KEY,
    parent_sku      TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    sku             TEXT NOT NULL UNIQUE,
    price_minor     INTEGER,           -- NULL means use parent price
    currency        TEXT,
    barcode         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS "products" (
    id          TEXT PRIMARY KEY,
    sku         TEXT NOT NULL UNIQUE,
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
    kitchen_zone TEXT
, brand TEXT, rack_location TEXT, notes TEXT, unit TEXT, is_active INTEGER NOT NULL DEFAULT 1, default_supplier_id TEXT REFERENCES suppliers(id), popularity_score REAL NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS promotion_applications (
    id          TEXT PRIMARY KEY,
    promotion_id TEXT NOT NULL REFERENCES promotions(id),
    sale_id     TEXT NOT NULL REFERENCES sales(id),
    discount_minor INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS promotions (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- 'percentage', 'fixed_amount', 'buy_x_get_y'
    promo_type  TEXT NOT NULL,
    -- For percentage: value is the percent (e.g., 10 = 10% off)
    -- For fixed_amount: value is in minor units
    -- For buy_x_get_y: value is the discount % on the free item
    value_minor INTEGER NOT NULL DEFAULT 0,
    -- Buy-X-get-Y: minimum quantity the customer must buy
    min_qty     INTEGER,
    -- Buy-X-get-Y: product SKU that must be purchased
    trigger_sku TEXT,
    -- Buy-X-get-Y: product SKU that gets the discount (empty = same as trigger)
    reward_sku  TEXT,
    -- Buy-X-get-Y: how many reward items the customer gets
    reward_qty  INTEGER DEFAULT 1,
    -- Time-limited: optional start/end
    starts_at   TEXT,
    ends_at     TEXT,
    -- Minimum order total in minor units for the promotion to apply
    min_order_minor INTEGER DEFAULT 0,
    -- Which product category this applies to (empty = all products)
    category_id TEXT,
    -- Whether this promotion is currently active
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id                TEXT PRIMARY KEY NOT NULL,
    po_id             TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    sku               TEXT NOT NULL DEFAULT '',
    product_name      TEXT NOT NULL DEFAULT '',
    qty               INTEGER NOT NULL DEFAULT 0,
    unit_cost_minor   INTEGER NOT NULL DEFAULT 0,
    line_total_minor  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              TEXT PRIMARY KEY NOT NULL,
    po_number       TEXT NOT NULL,
    supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
    status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'approved', 'received', 'cancelled')),
    order_date      TEXT NOT NULL,
    expected_date   TEXT NOT NULL DEFAULT '',
    received_date   TEXT,
    subtotal_minor  INTEGER NOT NULL DEFAULT 0,
    tax_minor       INTEGER NOT NULL DEFAULT 0,
    total_minor     INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT '',
    created_by      TEXT REFERENCES users(id),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
, location_id TEXT
    REFERENCES inventory_locations(id) ON DELETE RESTRICT);

CREATE TABLE IF NOT EXISTS receipt_barcodes (
    id          TEXT PRIMARY KEY,
    sale_id     TEXT NOT NULL REFERENCES sales(id),
    barcode     TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS refund_lines (
    id              TEXT PRIMARY KEY,
    refund_id       TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    sale_line_id    TEXT NOT NULL,          -- FK to sale_lines.id (logical ref, no CASCADE)
    sku             TEXT NOT NULL,
    qty             INTEGER NOT NULL CHECK (qty > 0),
    unit_minor      INTEGER NOT NULL CHECK (unit_minor >= 0),
    line_minor      INTEGER NOT NULL CHECK (line_minor >= 0),
    currency        TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS refunds (
    id              TEXT PRIMARY KEY,
    sale_id         TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    total_minor     INTEGER NOT NULL CHECK (total_minor >= 0),
    currency        TEXT NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    processed_by    TEXT NOT NULL,          -- user_id who processed the refund
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS role_workspace_types (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id   TEXT NOT NULL REFERENCES roles(id),
    type_key  TEXT NOT NULL REFERENCES workspace_types(key),
    UNIQUE(role_id, type_key)
);

CREATE TABLE IF NOT EXISTS role_workspaces (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id       TEXT NOT NULL REFERENCES roles(id),
    workspace_key TEXT NOT NULL REFERENCES workspaces(key),
    UNIQUE(role_id, workspace_key)
);

CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,          -- e.g. "owner", "manager", "cashier"
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',     -- JSON array of permission strings
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS "sale_lines" (
    id            TEXT PRIMARY KEY,
    sale_id       TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    sku           TEXT NOT NULL,
    qty           INTEGER NOT NULL CHECK (qty > 0),
    unit_minor    INTEGER NOT NULL,
    line_minor    INTEGER NOT NULL,
    currency      TEXT NOT NULL,
    line_position INTEGER NOT NULL,
    tax_minor     INTEGER NOT NULL DEFAULT 0,
    tax_rate_id   TEXT REFERENCES tax_rates(id),
    serial_number TEXT,
    store_id      TEXT REFERENCES store_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
    course        TEXT,
    modifiers_json TEXT,
    tax_breakdown_json TEXT, cost_minor INTEGER,
    UNIQUE (sale_id, line_position)
);

CREATE TABLE IF NOT EXISTS "sales" (
    id                  TEXT PRIMARY KEY,
    total_minor         INTEGER NOT NULL,
    currency            TEXT NOT NULL,
    line_count          INTEGER NOT NULL CHECK (line_count >= 0),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'pending', 'completed', 'voided', 'refunded')),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    payment_method      TEXT,
    tendered_minor      INTEGER,
    discount_percent    INTEGER NOT NULL DEFAULT 0,
    discount_label      TEXT,
    user_id             TEXT,
    subtotal_minor      INTEGER NOT NULL DEFAULT 0,
    tax_total_minor     INTEGER NOT NULL DEFAULT 0,
    customer_id         TEXT REFERENCES customers(id),
    version             INTEGER NOT NULL DEFAULT 1,
    store_id            TEXT REFERENCES store_profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
    deduction_locations TEXT,
    pending_expires_at  TEXT,
    payment_reference   TEXT,
    captured_at         TEXT
);

CREATE TABLE IF NOT EXISTS setting_updated (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,
    terminal_id TEXT    NOT NULL DEFAULT 'unknown',
    version     INTEGER NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS shifts (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id),
    terminal_id           TEXT REFERENCES terminals(id),
    opened_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    closed_at             TEXT,
    opening_balance_minor INTEGER NOT NULL DEFAULT 0,
    closing_balance_minor INTEGER,                     -- counted cash at close
    expected_cash_minor   INTEGER,                     -- opening + cash sales - cash payouts
    cash_difference_minor INTEGER,                     -- closing - expected (positive = over, negative = short)
    total_sales_minor     INTEGER NOT NULL DEFAULT 0,  -- total sales amount during shift
    total_cash_minor      INTEGER NOT NULL DEFAULT 0,  -- cash sales amount
    total_card_minor      INTEGER NOT NULL DEFAULT 0,  -- card sales amount
    total_other_minor     INTEGER NOT NULL DEFAULT 0,  -- other payment method sales
    total_voids_minor     INTEGER NOT NULL DEFAULT 0,  -- voided amount
    total_refunds_minor   INTEGER NOT NULL DEFAULT 0,  -- refunded amount
    notes                 TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, total_payouts_minor INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS "stock_adjustments" (
    id            TEXT PRIMARY KEY,
    count_id      TEXT REFERENCES "stock_counts"(id) ON DELETE SET NULL,
    sku           TEXT NOT NULL,
    product_name  TEXT NOT NULL DEFAULT '',
    previous_qty  INTEGER NOT NULL DEFAULT 0 CHECK (previous_qty >= 0),
    adjusted_qty  INTEGER NOT NULL DEFAULT 0 CHECK (adjusted_qty >= 0),
    reason        TEXT NOT NULL DEFAULT '',
    created_by    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS stock_alert_events (
    id              TEXT PRIMARY KEY,
    threshold_id    TEXT NOT NULL REFERENCES stock_thresholds(id) ON DELETE CASCADE,
    product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id     TEXT REFERENCES inventory_locations(id) ON DELETE CASCADE,
    current_qty     INTEGER NOT NULL,                         -- qty at trigger time
    threshold       INTEGER NOT NULL,                         -- threshold value that was breached
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'acknowledged', 'resolved')),
    triggered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    acknowledged_at TEXT,
    acknowledged_by TEXT REFERENCES users(id),
    resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS "stock_count_lines" (
    id           TEXT PRIMARY KEY,
    count_id     TEXT NOT NULL REFERENCES "stock_counts"(id) ON DELETE CASCADE,
    sku          TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    expected_qty INTEGER NOT NULL DEFAULT 0 CHECK (expected_qty >= 0),
    counted_qty  INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
    difference   INTEGER NOT NULL DEFAULT 0,
    notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS "stock_counts" (
    id           TEXT PRIMARY KEY,
    count_number TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
    count_type   TEXT NOT NULL DEFAULT 'full'
                 CHECK (count_type IN ('full', 'cyclic', 'spot')),
    notes        TEXT NOT NULL DEFAULT '',
    counted_by   TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));

CREATE TABLE IF NOT EXISTS stock_movements (
    id                  TEXT PRIMARY KEY,        -- UUID v4
    item_id             TEXT NOT NULL,           -- product ID (FK to products.id)
    delta               INTEGER NOT NULL,        -- +N or -N
    reason              TEXT,                    -- 'sale', 'restock', 'correction', 'stock-take', etc.
    source_terminal_id  TEXT,                    -- terminal that performed the operation
    source_user_id      TEXT,                    -- user who performed the operation
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, store_id TEXT NOT NULL DEFAULT '', location_id TEXT
    NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT, inventory_transaction_id TEXT
    REFERENCES inventory_transactions(id) ON DELETE RESTRICT);

CREATE TABLE IF NOT EXISTS stock_movements_archive (
    id                  TEXT PRIMARY KEY,
    item_id             TEXT NOT NULL,
    delta               INTEGER NOT NULL,
    reason              TEXT,
    source_terminal_id  TEXT,
    source_user_id      TEXT,
    store_id            TEXT NOT NULL DEFAULT '',
    created_at          TEXT NOT NULL
, location_id TEXT
    NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
    REFERENCES inventory_locations(id) ON DELETE RESTRICT, inventory_transaction_id TEXT
    REFERENCES inventory_transactions(id) ON DELETE RESTRICT);

CREATE TABLE IF NOT EXISTS stock_summary (
    item_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
                REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    qty         INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_thresholds (
    id          TEXT PRIMARY KEY,                              -- UUID v7
    product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id TEXT REFERENCES inventory_locations(id) ON DELETE CASCADE,
    threshold   INTEGER NOT NULL CHECK (threshold >= 0),
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(product_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id           TEXT PRIMARY KEY,
    transfer_id  TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    sku          TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    qty          INTEGER NOT NULL CHECK (qty > 0),
    received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0)
);

CREATE TABLE IF NOT EXISTS "stock_transfers" (
    id                     TEXT PRIMARY KEY,
    transfer_number        TEXT NOT NULL UNIQUE,
    status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN (
                               'draft',
                               'pending',
                               'in_transit',
                               'received',
                               'received_partial',
                               'cancelled'
                           )),
    source_location_old    TEXT,
    destination_location_old TEXT,
    source_location_id     TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
                           REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    destination_location_id TEXT NOT NULL DEFAULT '01926b3a-0000-7000-8000-000000000001'
                           REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    source_terminal_id     TEXT REFERENCES terminals(id),
    destination_terminal_id TEXT REFERENCES terminals(id),
    notes                  TEXT NOT NULL DEFAULT '',
    created_by             TEXT NOT NULL,
    received_by            TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at                TEXT,
    received_at            TEXT,
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS store_profiles (
    id          TEXT PRIMARY KEY,                                   -- "default" or UUID for additional stores
    name        TEXT NOT NULL,
    address     TEXT DEFAULT '',
    tax_id      TEXT DEFAULT '',
    currency    TEXT NOT NULL DEFAULT 'USD',
    timezone    TEXT NOT NULL DEFAULT 'UTC',
    is_primary  INTEGER NOT NULL DEFAULT 0,                        -- exactly one store is the primary
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS stripe_customers (
    stripe_customer_id TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
    id          TEXT PRIMARY KEY NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    contact_person TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    tax_id      TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_applied_items (
    item_id    TEXT PRIMARY KEY,                     -- remote offline_queue item id
    action     TEXT NOT NULL,                        -- action applied (for diagnostics)
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sync_pull_state (
    id         INTEGER PRIMARY KEY CHECK (id = 1),   -- single-row guard
    since      TEXT,                                  -- ISO-8601 anchor timestamp
    cursor     TEXT                                   -- opaque pagination cursor (P-3)
);

CREATE TABLE IF NOT EXISTS sync_remote_failures (
    item_id         TEXT PRIMARY KEY,
    action          TEXT NOT NULL,
    payload         TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error      TEXT NOT NULL,
    first_failed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_failed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    dead_lettered   INTEGER NOT NULL DEFAULT 0 CHECK (dead_lettered IN (0, 1))
);

CREATE TABLE IF NOT EXISTS sync_terminals (
    terminal_id   TEXT PRIMARY KEY,
    -- SHA-256 hex digest of the device secret (never the plaintext).
    secret_hash   TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT '',
    tenant_id     TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tables (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    capacity        INTEGER NOT NULL DEFAULT 4,
    pos_x           REAL NOT NULL DEFAULT 0,
    pos_y           REAL NOT NULL DEFAULT 0,
    shape           TEXT NOT NULL DEFAULT 'circle',
    width           REAL NOT NULL DEFAULT 10,
    height          REAL NOT NULL DEFAULT 10,
    status          TEXT NOT NULL DEFAULT 'available',
    active_sale_id  TEXT REFERENCES sales(id),
    section         TEXT NOT NULL DEFAULT '',
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tax_rates (
    id          TEXT PRIMARY KEY,                            -- UUID v4
    name        TEXT NOT NULL,                               -- e.g. "Sales Tax"
    rate_bps    INTEGER NOT NULL CHECK(rate_bps >= 0),       -- basis points (e.g. 825 = 8.25%)
    is_default  INTEGER NOT NULL DEFAULT 0,                  -- 1 if this is the default rate
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, is_inclusive INTEGER NOT NULL DEFAULT 0, tenant_id TEXT NOT NULL DEFAULT 'default', is_active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS tenant_plans (
    tenant_id   TEXT PRIMARY KEY,
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tenant_subscription (
    tenant_id          TEXT PRIMARY KEY,
    tier_key           TEXT NOT NULL,        -- 'free', 'pro', 'premium', 'enterprise'
    status             TEXT NOT NULL,        -- 'active', 'past_due', 'canceled'
    expires_at         TEXT NULL,            -- ISO timestamp (NULL = lifetime/free)
    max_stores         INTEGER NOT NULL,
    max_pos_instances  INTEGER NOT NULL,     -- Per-store register limit
    allowed_types_json TEXT NOT NULL,        -- '["restaurant-pos", "store-pos", "admin"]'
    signature          TEXT NOT NULL,        -- RSA/HMAC signature from apps/cloud-server
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, signed_payload TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS terminal_feature_overrides (
    terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    feature     TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (terminal_id, feature)
);

CREATE TABLE IF NOT EXISTS terminal_profiles (
    terminal_id TEXT PRIMARY KEY REFERENCES terminals(id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL DEFAULT 'unrestricted'
        CHECK (profile_type IN ('counter_pos', 'kds_kiosk', 'customer_display', 'unrestricted')),
    locked_screen TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS terminals (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    device_id       TEXT NOT NULL UNIQUE,
    terminal_secret TEXT,                   -- optional shared secret for sync auth
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_seen_at    TEXT,
    metadata        TEXT,                   -- JSON blob for extra info
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, bound_store_id TEXT REFERENCES store_profiles(id), bound_instance_id TEXT, binding_signature TEXT);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id    TEXT NOT NULL,
    pref_key   TEXT NOT NULL,
    pref_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, pref_key)
);

CREATE TABLE IF NOT EXISTS "user_store_access" (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id     TEXT NOT NULL REFERENCES store_profiles(id)
                              ON DELETE RESTRICT
                              ON UPDATE CASCADE,
    access_level TEXT NOT NULL DEFAULT 'operator',
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, store_id)
);

CREATE TABLE IF NOT EXISTS "user_workspace_instances" (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id  TEXT NOT NULL REFERENCES "workspace_instances"(id) ON DELETE CASCADE,
    is_default   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, instance_id)
);

CREATE TABLE IF NOT EXISTS user_workspaces (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ws_key     TEXT NOT NULL REFERENCES workspaces(key) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, ws_key)
);

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    pin_hash    TEXT NOT NULL,                 -- bcrypt or argon2 hash
    display_name TEXT NOT NULL,
    role_id     TEXT NOT NULL REFERENCES roles(id),
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, tenant_id TEXT NOT NULL DEFAULT 'default', date_of_birth TEXT, phone TEXT, national_id_type TEXT, national_id TEXT, email TEXT, monthly_take_home_minor INTEGER, emergency_contact_name TEXT, emergency_contact_phone TEXT, job_title TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', address TEXT, language TEXT, avatar TEXT, tax_id TEXT, national_id_expires_at TEXT, emergency_contact_relationship TEXT, hire_date TEXT, national_id_hash TEXT);

CREATE TABLE IF NOT EXISTS "workspace_instances" (
    id          TEXT PRIMARY KEY,
    type_key    TEXT NOT NULL REFERENCES workspace_types(key),
    store_id    TEXT NOT NULL REFERENCES store_profiles(id)
                              ON DELETE RESTRICT
                              ON UPDATE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    colour      TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    last_accessed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, bound_location_id TEXT
    REFERENCES inventory_locations(id) ON DELETE RESTRICT, purpose_key TEXT NOT NULL DEFAULT 'general');

CREATE TABLE IF NOT EXISTS workspace_inventory_locations (
    id                   TEXT PRIMARY KEY,
    instance_id          TEXT NOT NULL REFERENCES workspace_instances(id) ON DELETE CASCADE,
    location_id          TEXT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    is_primary           INTEGER NOT NULL DEFAULT 0
                         CHECK (is_primary IN (0, 1)),
    allow_negative_stock INTEGER NOT NULL DEFAULT 0
                         CHECK (allow_negative_stock IN (0, 1)),
    sort_order           INTEGER NOT NULL DEFAULT 0,
    UNIQUE(instance_id, location_id)
);

CREATE TABLE IF NOT EXISTS workspace_screens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_key TEXT NOT NULL REFERENCES workspaces(key),
    screen_key    TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(workspace_key, screen_key)
);

CREATE TABLE IF NOT EXISTS workspace_type_screens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type_key    TEXT NOT NULL REFERENCES workspace_types(key),
    screen_key  TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(type_key, screen_key)
);

CREATE TABLE IF NOT EXISTS workspace_types (
    key            TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    layout_mode    TEXT NOT NULL DEFAULT 'fullscreen',  -- 'fullscreen' | 'sidebar'
    icon           TEXT NOT NULL DEFAULT '',
    sort_order     INTEGER NOT NULL DEFAULT 0,
    accent_colour  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workspaces (
    id        TEXT PRIMARY KEY,
    key       TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon      TEXT NOT NULL DEFAULT ''
);

CREATE TRIGGER IF NOT EXISTS audit_log_immutable_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'audit_log entries are immutable: DELETE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_immutable_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'audit_log entries are immutable: UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS loyalty_tiers_validate_insert
BEFORE INSERT ON loyalty_tiers
WHEN trim(NEW.name) = ''
  OR NEW.min_points < 0
  OR NEW.points_per_unit <= 0
  OR NEW.earn_multiplier <= 0
  OR length(NEW.colour) <> 7
  OR substr(NEW.colour, 1, 1) <> '#'
  OR substr(NEW.colour, 2) GLOB '*[^0-9A-Fa-f]*'
BEGIN
    SELECT RAISE(ABORT, 'invalid loyalty tier configuration');
END;

CREATE TRIGGER IF NOT EXISTS loyalty_tiers_validate_update
BEFORE UPDATE OF name, min_points, points_per_unit, earn_multiplier, colour
ON loyalty_tiers
WHEN trim(NEW.name) = ''
  OR NEW.min_points < 0
  OR NEW.points_per_unit <= 0
  OR NEW.earn_multiplier <= 0
  OR length(NEW.colour) <> 7
  OR substr(NEW.colour, 1, 1) <> '#'
  OR substr(NEW.colour, 2) GLOB '*[^0-9A-Fa-f]*'
BEGIN
    SELECT RAISE(ABORT, 'invalid loyalty tier configuration');
END;

CREATE INDEX IF NOT EXISTS idx_active_carts_updated_at ON active_carts(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_assignment_branches_user ON assignment_branches(assignment_user_id);

CREATE INDEX IF NOT EXISTS idx_assignment_workspaces_user ON assignment_workspaces(assignment_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_review_checkpoints_reviewed_at
    ON audit_review_checkpoints(reviewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_payouts_shift_id ON cash_payouts(shift_id);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

CREATE INDEX IF NOT EXISTS idx_currencies_code ON currencies(code);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_from ON exchange_rates(from_currency);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_to   ON exchange_rates(to_currency);

CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_gift_card_id ON gift_card_transactions(gift_card_id);

CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_sale_id ON gift_card_transactions(sale_id);

CREATE INDEX IF NOT EXISTS idx_gift_cards_card_number ON gift_cards(card_number);

CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);

CREATE INDEX IF NOT EXISTS idx_held_carts_bill_type ON held_carts(bill_type);

CREATE INDEX IF NOT EXISTS idx_held_carts_created_at ON held_carts(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_shifts_active_per_user_location
    ON inventory_shifts(user_id, location_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_inv_shifts_location
    ON inventory_shifts(location_id, started_at);

CREATE INDEX IF NOT EXISTS idx_inv_shifts_status
    ON inventory_shifts(status);

CREATE INDEX IF NOT EXISTS idx_inv_shifts_user
    ON inventory_shifts(user_id, started_at);

CREATE INDEX IF NOT EXISTS idx_inv_tx_lines_tx
    ON inventory_transaction_lines(transaction_id);

CREATE INDEX IF NOT EXISTS idx_inv_tx_location
    ON inventory_transactions(location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inv_tx_shift
    ON inventory_transactions(inventory_shift_id)
    WHERE inventory_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_tx_staff
    ON inventory_transactions(staff_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inv_tx_transfer
    ON inventory_transactions(transfer_id) WHERE transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_location_product
    ON inventory(location_id, product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_locations_active
    ON inventory_locations(is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_name_unique
    ON inventory_locations(name) WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_inventory_locations_type
    ON inventory_locations(type);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created
ON inventory_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_kds_line_items_order ON kds_line_items(kds_order_id, line_position);

CREATE INDEX IF NOT EXISTS idx_kds_line_items_status ON kds_line_items(kds_order_id, item_status);

CREATE INDEX IF NOT EXISTS idx_kds_order_targets_instance
    ON kds_order_targets(target_instance_id, kds_order_id);

CREATE INDEX IF NOT EXISTS idx_kds_orders_target_instance
    ON kds_orders(target_instance_id);

CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at);

CREATE INDEX IF NOT EXISTS idx_login_attempts_device ON login_attempts(device_id);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username);

CREATE INDEX IF NOT EXISTS idx_modifiers_group_id ON modifiers(group_id);

CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status);

CREATE INDEX IF NOT EXISTS idx_offline_queue_tenant_status ON offline_queue(tenant_id, status);

-- Serves the health endpoint's `MAX(synced_at)` query (runs every 15s on
-- the Docker healthcheck). Without this, that query is a full table scan
-- over the whole 90-day retention queue on every health poll.
CREATE INDEX IF NOT EXISTS idx_offline_queue_synced_at ON offline_queue(synced_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_payments_sale_id ON payments(sale_id);

CREATE INDEX IF NOT EXISTS idx_po_lines_po_id ON purchase_order_lines(po_id);

CREATE INDEX IF NOT EXISTS idx_product_activity_sku ON product_activity(sku);

CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product ON product_modifier_groups(product_id);

CREATE INDEX IF NOT EXISTS idx_product_recipes_ingredient ON product_recipes(ingredient_product_id);

CREATE INDEX IF NOT EXISTS idx_product_recipes_parent ON product_recipes(parent_product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_parent ON product_variants(parent_sku);

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

CREATE INDEX IF NOT EXISTS idx_products_store_category ON products(store_id, category_id);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON purchase_orders(po_number);

CREATE INDEX IF NOT EXISTS idx_receipt_barcodes_barcode ON receipt_barcodes(barcode);

CREATE INDEX IF NOT EXISTS idx_receipt_barcodes_sale_id ON receipt_barcodes(sale_id);

CREATE INDEX IF NOT EXISTS idx_refunds_sale_id ON refunds(sale_id);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);

CREATE INDEX IF NOT EXISTS idx_sale_lines_sale_id ON sale_lines(sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_lines_sku ON sale_lines(sku);

CREATE INDEX IF NOT EXISTS idx_sale_lines_store_sale ON sale_lines(store_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);

CREATE INDEX IF NOT EXISTS idx_sales_pending_expires ON sales(pending_expires_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sales_store_status ON sales(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_setting_updated_key_version
    ON setting_updated(key, version DESC);

CREATE INDEX IF NOT EXISTS idx_setting_updated_terminal
    ON setting_updated(terminal_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_setting_updated_unique_version
    ON setting_updated(key, terminal_id, version);

CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON shifts(opened_at);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

CREATE INDEX IF NOT EXISTS idx_shifts_user_id ON shifts(user_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_count_id ON stock_adjustments(count_id);

CREATE INDEX IF NOT EXISTS idx_stock_alert_events_product
    ON stock_alert_events(product_id, location_id);

CREATE INDEX IF NOT EXISTS idx_stock_alert_events_status
    ON stock_alert_events(status, triggered_at);

CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count_id ON stock_count_lines(count_id);

CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON stock_counts(status);

CREATE INDEX IF NOT EXISTS idx_stock_movements_archive_inventory_transaction_id
    ON stock_movements_archive(inventory_transaction_id) WHERE inventory_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_archive_location_created
    ON stock_movements_archive(location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory_transaction_id
    ON stock_movements(inventory_transaction_id) WHERE inventory_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_item
    ON stock_movements(item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_location_created
    ON stock_movements(location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_summary_location
    ON stock_summary(location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_thresholds_global
    ON stock_thresholds(product_id) WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_thresholds_location
    ON stock_thresholds(location_id);

CREATE INDEX IF NOT EXISTS idx_stock_thresholds_product
    ON stock_thresholds(product_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer_id
    ON stock_transfer_lines(transfer_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_created
    ON stock_transfers(created_at);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination_location
    ON stock_transfers(destination_location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_location
    ON stock_transfers(source_location_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_status
    ON stock_transfers(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_store_profiles_primary
    ON store_profiles(is_primary) WHERE is_primary = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(code);

CREATE INDEX IF NOT EXISTS idx_sync_applied_items_applied_at
    ON sync_applied_items(applied_at);

CREATE INDEX IF NOT EXISTS idx_sync_remote_failures_dead_lettered
    ON sync_remote_failures(dead_lettered, last_failed_at);

CREATE INDEX IF NOT EXISTS idx_tax_rates_active ON tax_rates(is_active);

CREATE INDEX IF NOT EXISTS idx_tax_rates_name ON tax_rates(name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_single_default
  ON tax_rates(is_default)
  WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant ON tax_rates(tenant_id);

CREATE INDEX IF NOT EXISTS idx_terminals_device_id ON terminals(device_id);

CREATE INDEX IF NOT EXISTS idx_user_store_access_user_id
    ON user_store_access(user_id);

CREATE INDEX IF NOT EXISTS idx_user_wsi_user_id
    ON user_workspace_instances(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_national_id ON users(national_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_national_id_hash ON users(national_id_hash);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE INDEX IF NOT EXISTS idx_workspace_instances_bound_location
    ON workspace_instances(bound_location_id);

CREATE INDEX IF NOT EXISTS idx_workspace_instances_type
    ON workspace_instances(type_key);

CREATE INDEX IF NOT EXISTS idx_ws_inv_locations_instance
    ON workspace_inventory_locations(instance_id);

CREATE INDEX IF NOT EXISTS idx_ws_inv_locations_location
    ON workspace_inventory_locations(location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_inv_locations_one_primary_per_instance
    ON workspace_inventory_locations(instance_id) WHERE is_primary = 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_earn_sale
    ON loyalty_transactions(account_id, sale_id)
    WHERE sale_id IS NOT NULL AND txn_type = 'earn';

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redeem_sale
    ON loyalty_transactions(account_id, sale_id)
    WHERE sale_id IS NOT NULL AND txn_type = 'redeem';

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_barcode ON product_variants(barcode);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode ON products(barcode);




-- ====================================================================
-- SEED DATA (matches state after all 131 original migrations)
-- ====================================================================

-- Currencies (from migration 006)
INSERT OR IGNORE INTO currencies (code, numeric_code, name, minor_exponent, symbol) VALUES
    ('USD', '840', 'US Dollar',    2, '$'),
    ('IDR', '360', 'Indonesian Rupiah', 0, 'Rp');

-- Default store profile (from migration 025)
INSERT OR IGNORE INTO store_profiles (id, name, is_primary)
VALUES ('default', 'Default Store', 0);

-- Loyalty tiers (from migration 031)
INSERT OR IGNORE INTO loyalty_tiers (id, name, min_points, points_per_unit, earn_multiplier, colour, sort_order) VALUES
    ('tier-bronze',   'Bronze',   0,    10, 1.0, '#cd7f32', 1),
    ('tier-silver',   'Silver',   100,  10, 1.25, '#c0c0c0', 2),
    ('tier-gold',     'Gold',     500,  10, 1.5, '#ffd700', 3),
    ('tier-platinum', 'Platinum', 2000, 10, 2.0, '#e5e4e2', 4);

-- Workspaces (from migrations 035, 048, 128)
INSERT OR IGNORE INTO workspaces (id, key, name, description, icon) VALUES
    ('ws-restaurant-pos', 'restaurant-pos', 'Restaurant POS', 'Cashier terminal for restaurant ordering with menu categories and table management', 'restaurant'),
    ('ws-store-pos', 'store-pos', 'Store POS', 'Cashier terminal for retail with product lookup, customer management, and loyalty', 'store'),
    ('ws-inventory', 'warehouse', 'Warehouse', 'Manage products, stock levels, bundles, categories, and inventory reports', 'inventory'),
    ('ws-admin', 'admin', 'Admin', 'System settings, staff management, reports, audit logs, and configuration', 'admin'),
    ('ws-kds', 'kds', 'Kitchen Display', 'Order queue display for the kitchen — tap tickets to advance their status', 'kds'),
    ('ws-retail-pos', 'retail-pos', 'Retail POS', 'Cashier terminal for retail checkout', 'store');

-- Workspace screens (from migration 035)
INSERT OR IGNORE INTO workspace_screens (workspace_key, screen_key, sort_order) VALUES
    ('restaurant-pos', 'sales', 1),
    ('restaurant-pos', 'kds', 2),
    ('restaurant-pos', 'orders', 3),
    ('restaurant-pos', 'tables', 4),
    ('store-pos', 'sales', 1),
    ('store-pos', 'customers', 2),
    ('store-pos', 'loyalty', 3),
    ('store-pos', 'sales-history', 4),
    ('store-pos', 'promotions', 5),
    ('warehouse', 'products', 1),
    ('warehouse', 'inventory', 2),
    ('warehouse', 'inventory-adjustment', 3),
    ('warehouse', 'bundles', 4),
    ('warehouse', 'categories', 5),
    ('warehouse', 'inventory-report', 6),
    ('admin', 'staff', 1),
    ('admin', 'settings', 2),
    ('admin', 'dashboard', 3),
    ('admin', 'reports', 4),
    ('admin', 'sales-dashboard', 5),
    ('admin', 'eod-report', 6),
    ('admin', 'features', 7),
    ('admin', 'data-management', 8),
    ('admin', 'audit-log', 9),
    ('admin', 'offline-queue', 10),
    ('admin', 'shifts', 11),
    ('admin', 'terminals', 12),
    ('admin', 'stores', 13),
    ('admin', 'exchange-rates', 14),
    ('admin', 'design', 15);

-- Workspace types (from migration 060 + rename 091)
-- After migration 091: inventory -> warehouse
INSERT OR IGNORE INTO workspace_types (key, name, description, layout_mode, icon, sort_order, accent_colour) VALUES
    ('restaurant-pos', 'Restaurant POS', 'Cashier terminal for restaurant ordering', 'fullscreen', 'restaurant', 1, ''),
    ('store-pos', 'Store POS', 'Cashier terminal for retail', 'fullscreen', 'store', 2, ''),
    ('kds', 'Kitchen Display', 'Kitchen order queue display', 'fullscreen', 'kds', 3, ''),
    ('warehouse', 'Warehouse', 'Product and stock management', 'sidebar', 'inventory', 4, ''),
    ('admin', 'Admin', 'System administration', 'sidebar', 'settings', 5, ''),
    ('retail-pos', 'Retail POS', 'Cashier terminal for retail checkout', 'fullscreen', 'store', 6, '');

-- Workspace type screens (from migration 060)
INSERT OR IGNORE INTO workspace_type_screens (type_key, screen_key, sort_order) VALUES
    ('restaurant-pos', 'sales', 1),
    ('restaurant-pos', 'kds', 2),
    ('restaurant-pos', 'orders', 3),
    ('restaurant-pos', 'tables', 4),
    ('store-pos', 'sales', 1),
    ('store-pos', 'customers', 2),
    ('store-pos', 'loyalty', 3),
    ('store-pos', 'sales-history', 4),
    ('store-pos', 'promotions', 5),
    ('kds', 'kds', 1),
    ('warehouse', 'products', 1),
    ('warehouse', 'inventory', 2),
    ('warehouse', 'inventory-adjustment', 3),
    ('warehouse', 'bundles', 4),
    ('warehouse', 'categories', 5),
    ('warehouse', 'inventory-report', 6),
    ('admin', 'staff', 1),
    ('admin', 'settings', 2),
    ('admin', 'dashboard', 3),
    ('admin', 'reports', 4),
    ('admin', 'sales-dashboard', 5),
    ('admin', 'eod-report', 6),
    ('admin', 'features', 7),
    ('admin', 'data-management', 8),
    ('admin', 'audit-log', 9),
    ('admin', 'offline-queue', 10),
    ('admin', 'shifts', 11),
    ('admin', 'terminals', 12),
    ('admin', 'stores', 13),
    ('admin', 'exchange-rates', 14),
    ('admin', 'design', 15),
    ('retail-pos', 'sales', 1),
    ('retail-pos', 'customers', 2),
    ('retail-pos', 'loyalty', 3),
    ('retail-pos', 'sales-history', 4),
    ('retail-pos', 'promotions', 5);

-- Default workspace instances (from migrations 060, 120, 121)
-- NOTE: retail-pos does NOT get a default instance because migration 128
-- (which adds retail-pos to workspaces) runs AFTER migration 121
-- (which creates instances from workspace_types). So only 5 instances.
INSERT OR IGNORE INTO workspace_instances (id, type_key, store_id, name, description, colour, status, last_accessed_at) VALUES
    ('default-restaurant-pos', 'restaurant-pos', 'default', 'Restaurant POS', 'Cashier terminal for restaurant ordering', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('default-store-pos', 'store-pos', 'default', 'Store POS', 'Cashier terminal for retail', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('default-warehouse', 'warehouse', 'default', 'Warehouse', 'Product and stock management', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('default-admin', 'admin', 'default', 'Admin', 'System administration', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ('default-kds', 'kds', 'default', 'Kitchen Display', 'Kitchen order queue display', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Default tenant subscription (from migration 061)
INSERT OR IGNORE INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_stores, max_pos_instances, allowed_types_json, signature)
VALUES ('default', 'free', 'active', NULL, 1, 1, '["store-pos", "restaurant-pos", "admin"]', 'BOOTSTRAP_FREE');

-- Default inventory locations (from migration 078)
INSERT OR IGNORE INTO inventory_locations (id, name, type, description)
VALUES ('01926b3a-0000-7000-8000-000000000001',
        'Default Inventory',
        'store',
        'Canonical default location for legacy single-location deployments and migration backfills.');

INSERT OR IGNORE INTO inventory_locations (id, name, type, description)
VALUES ('01926b3a-0000-7000-8000-000000000002',
        'In Transit',
        'transit',
        'System-managed pseudo-location for in-flight stock between source and destination during a transfer.');


PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
