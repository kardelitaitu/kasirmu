//! Integration-style unit tests for the product command bodies (Wave-A test
//! relocation: moved out of
//! `apps/desktop-client/src/commands/products_tests.rs`).
//!
//! Mounted at the foot of `products.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and the `run_*` `&Connection` helpers the
//! desktop shims delegate to.
//!
//! Harness mapping: `migrations::fresh_db()` becomes the crate's own
//! `testing::temp_conn` (same fully-migrated in-memory database, reached
//! through the shared seam); `AppState::for_test()` /
//! `for_test_with_conn(conn)` plus a `tauri::test::mock_builder()` app become
//! `TestBridge::new()` / `TestBridge::new().with_conn(conn)`, with sessions
//! seeded through `TestBridge::sessions()`; `state.resolve_session(t)` becomes
//! `ctx.resolve_session(t)` on the borrowed context. Commands map to the bridge
//! fn the shim's adapter delegates to (`create_product_scoped` ->
//! `create_scoped`, `update_product_scoped` -> `update_scoped`), taking
//! `(ctx, token, &args)`. `AppError::` maps 1:1 onto `BridgeError::` with the
//! message text unchanged.
//!
//! One non-mechanical mapping is recorded here: the desktop file's
//! `commands::authz::require_permission_for_user(store, user, perm)` is a
//! three-line desktop wrapper that never entered the bridge, so
//! `edit_cost_permission_membership_is_manager_only` asserts the same role
//! membership on the underlying `Store::require_permission` call it makes,
//! matching `CoreError::PermissionDenied`. The fact pinned is unchanged.

use super::*;
use crate::testing::{TestBridge, temp_conn};
use oz_core::session::SessionContext;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    temp_conn()
}

#[test]
fn list_products_empty_db() {
    let conn = fresh_conn();
    let products = run_list_products(&conn).unwrap();
    assert!(products.is_empty());
}

#[test]
fn list_products_with_seeded_data() {
    let conn = fresh_conn();

    // Seed some products directly via SQL.
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour, icon) VALUES
            ('cat-drinks', 'Drinks', '#06b6d4', ''),
            ('cat-food',   'Food',   '#f97316', '');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at) VALUES
            ('p1', 'LATTE',  'Caffè Latte',  450, 'USD', 'cat-drinks', '4901234567890', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('p2', 'BAGEL',  'Plain Bagel',   250, 'USD', 'cat-food',   NULL,           '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('p3', 'BROWNIE','Fudge Brownie', 295, 'USD', 'cat-food',   '4901234567906', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO inventory (product_id, qty) VALUES
            ('p1', 50),
            ('p2', 12);",
    )
    .unwrap();

    let products = run_list_products(&conn).unwrap();
    assert_eq!(products.len(), 3);

    // Check LATTE.
    let latte = products.iter().find(|p| p.sku == "LATTE").unwrap();
    assert_eq!(latte.name, "Caffè Latte");
    assert_eq!(latte.category.as_deref(), Some("Drinks"));
    assert_eq!(latte.price.minor_units, 450);
    assert_eq!(latte.barcode.as_deref(), Some("4901234567890"));
    // Also verify BROWNIE has a barcode.
    let brownie = products.iter().find(|p| p.sku == "BROWNIE").unwrap();
    assert_eq!(brownie.barcode.as_deref(), Some("4901234567906"));
    assert!(latte.in_stock);

    // Check BROWNIE (has no inventory row).
    let brownie = products.iter().find(|p| p.sku == "BROWNIE").unwrap();
    assert!(!brownie.in_stock);
}

// ── Barcode lookup integration tests ─────────────────────────────

#[test]
fn lookup_by_barcode_found() {
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour, icon) VALUES
            ('cat-drinks', 'Drinks', '#06b6d4', '');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at) VALUES
            ('p1', 'LATTE', 'Caffè Latte', 450, 'USD', 'cat-drinks', '4901234567890', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO inventory (product_id, qty) VALUES ('p1', 50);",
    )
    .unwrap();

    let result = run_lookup_by_barcode(&conn, "4901234567890").unwrap();
    let dto = result.expect("expected product for known barcode");
    assert_eq!(dto.sku, "LATTE");
    assert_eq!(dto.name, "Caffè Latte");
    assert_eq!(dto.category.as_deref(), Some("Drinks"));
    assert_eq!(dto.price.minor_units, 450);
    assert_eq!(dto.barcode.as_deref(), Some("4901234567890"));
    assert!(dto.in_stock);
    assert_eq!(dto.stock_qty, Some(50));
}

#[test]
fn lookup_by_barcode_not_found() {
    let conn = fresh_conn();
    let result = run_lookup_by_barcode(&conn, "0000000000000").unwrap();
    assert!(result.is_none(), "unknown barcode should return None");
}

#[test]
fn lookup_by_barcode_returns_product_without_barcode() {
    // A product with no barcode stored (NULL in DB) should NOT be
    // returned when looking up a barcode — confirm the DB query works.
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, barcode, created_at, updated_at) VALUES
            ('p1', 'TEA', 'Green Tea', 275, 'USD', NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();

    let result = run_lookup_by_barcode(&conn, "2750000000000").unwrap();
    assert!(result.is_none(), "no match for random barcode");
}

// ── SKU lookup integration tests ─────────────────────────────────

#[test]
fn lookup_product_by_sku_found() {
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour, icon) VALUES
            ('cat-drinks', 'Drinks', '#06b6d4', '');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at) VALUES
            ('p1', 'LATTE', 'Caffè Latte', 450, 'USD', 'cat-drinks', '4901234567890', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO inventory (product_id, qty) VALUES ('p1', 50);",
    )
    .unwrap();

    let result = run_lookup_product_by_sku(&conn, "LATTE").unwrap();
    let dto = result.expect("expected product for known SKU");
    assert_eq!(dto.sku, "LATTE");
    assert_eq!(dto.name, "Caffè Latte");
    assert_eq!(dto.category.as_deref(), Some("Drinks"));
    assert_eq!(dto.price.minor_units, 450);
    assert_eq!(dto.barcode.as_deref(), Some("4901234567890"));
    assert!(dto.in_stock);
    assert_eq!(dto.stock_qty, Some(50));
}

#[test]
fn lookup_product_by_sku_not_found() {
    let conn = fresh_conn();
    let result = run_lookup_product_by_sku(&conn, "NO-SUCH-SKU").unwrap();
    assert!(result.is_none(), "unknown SKU should return None");
}

#[test]
fn lookup_product_by_sku_without_stock() {
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, barcode, created_at, updated_at) VALUES
            ('p1', 'UNSTOCKED', 'Unstocked Item', 199, 'USD', NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();

    let result = run_lookup_product_by_sku(&conn, "UNSTOCKED").unwrap();
    let dto = result.expect("expected product for known SKU without stock");
    assert_eq!(dto.sku, "UNSTOCKED");
    assert_eq!(dto.name, "Unstocked Item");
    assert_eq!(dto.price.minor_units, 199);
    assert!(!dto.in_stock);
    assert_eq!(dto.stock_qty, None);
}

// -- DTO struct tests --

#[test]
fn product_dto_serialize() {
    let dto = ProductDto {
        id: "prod-1".into(),
        sku: "COFFEE".into(),
        name: "Caffe Latte".into(),
        category: Some("Drinks".into()),
        price: MoneyDto {
            minor_units: 450,
            currency: "USD".into(),
        },
        barcode: Some("4901234567890".into()),
        in_stock: true,
        stock_qty: Some(50),
        tax_rate_ids: vec!["t1".into()],
        created_at: "2025-01-01".into(),
        price_updated_at: "2025-01-01".into(),
        product_type: "retail".into(),
        cost_minor: 0,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
        default_supplier_id: None,
        popularity_score: 0.0,
        image_hash: None,
        images: None,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["sku"], "COFFEE");
    assert_eq!(json["price"]["minor_units"], 450);
}

#[test]
fn product_dto_debug() {
    let dto = ProductDto {
        id: "prod-2".into(),
        sku: "TEA".into(),
        name: "Green Tea".into(),
        category: None,
        price: MoneyDto {
            minor_units: 275,
            currency: "USD".into(),
        },
        barcode: None,
        in_stock: false,
        stock_qty: None,
        tax_rate_ids: vec![],
        created_at: "2025-01-01".into(),
        price_updated_at: "2025-01-01".into(),
        product_type: "retail".into(),
        cost_minor: 0,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
        default_supplier_id: None,
        popularity_score: 0.0,
        image_hash: None,
        images: None,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Green Tea"));
}

#[test]
fn money_dto_serialize() {
    let dto = MoneyDto {
        minor_units: 1550,
        currency: "IDR".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["minor_units"], 1550);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn money_dto_debug() {
    let dto = MoneyDto {
        minor_units: 100,
        currency: "EUR".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("EUR"));
}

#[test]
fn adjust_stock_args_deserialize() {
    let json = r##"{"sku":"COFFEE","delta":10,"reason":"restock"}"##;
    let args: AdjustStockArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "COFFEE");
    assert_eq!(args.delta, 10);
}

#[test]
fn adjust_stock_args_debug() {
    let args = AdjustStockArgs {
        sku: "S".into(),
        delta: -5,
        reason: "damaged".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("damaged"));
}

#[test]
fn create_product_args_deserialize() {
    let json = r##"{"user_id":"u1","sku":"LATTE","name":"Latte","price_minor":450,"currency":"USD","category_id":null,"barcode":null,"initial_stock":0,"tax_rate_ids":[]}"##;
    let args: CreateProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "LATTE");
    assert_eq!(args.price_minor, 450);
}

#[test]
fn create_product_scoped_args_deserialize() {
    let json = r##"{"sku":"LATTE","name":"Latte","price_minor":450,"currency":"USD","category_id":null,"barcode":null,"initial_stock":0,"tax_rate_ids":[]}"##;
    let args: CreateProductScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "LATTE");
    assert_eq!(args.price_minor, 450);

    // user_id is intentionally absent — verify it's not deserialized
    let json_with_user = r##"{"user_id":"u1","sku":"LATTE","name":"Latte","price_minor":450,"currency":"USD","category_id":null,"barcode":null,"initial_stock":0,"tax_rate_ids":[]}"##;
    let args2: CreateProductScopedArgs = serde_json::from_str(json_with_user).unwrap();
    assert_eq!(args2.sku, "LATTE"); // extra fields ignored by serde
}

#[test]
fn get_product_track_serial_batch_maps_known_and_unknown_skus() {
    let conn = fresh_conn();
    conn.execute_batch(
        "INSERT INTO categories (id, name, colour, icon) VALUES
            ('cat-1', 'Gadgets', '#06b6d4', '');
         INSERT INTO products (id, sku, name, price_minor, currency, category_id, track_serial, barcode, created_at, updated_at) VALUES
            ('p1', 'TRACKED', 'Tracked Widget', 100, 'USD', 'cat-1', 1, '4901234567890', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('p2', 'PLAIN', 'Plain Widget', 200, 'USD', 'cat-1', 0, NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();

    let store = Store::new(&conn);
    let skus = vec![
        "TRACKED".to_string(),
        "PLAIN".to_string(),
        "MISSING".to_string(),
    ];
    let rows = run_get_product_track_serial_batch(&store, &skus);

    assert_eq!(rows.len(), 3);
    assert!(rows[0].track_serial);
    assert!(!rows[1].track_serial);
    // Unknown SKUs resolve to false (matches the single-SKU behaviour).
    assert!(!rows[2].track_serial);
    // Response preserves request order.
    assert_eq!(rows[0].sku, "TRACKED");
    assert_eq!(rows[1].sku, "PLAIN");
    assert_eq!(rows[2].sku, "MISSING");
}

#[test]
fn get_product_track_serial_batch_empty_input() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let rows = run_get_product_track_serial_batch(&store, &[]);
    assert!(rows.is_empty());
}

#[test]
fn create_product_args_debug() {
    let args = CreateProductArgs {
        user_id: "u".into(),
        sku: "S".into(),
        name: "N".into(),
        price_minor: 100,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        initial_stock: 0,
        tax_rate_ids: vec![],
        product_type: "retail".into(),
        cost_minor: 0,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
        default_supplier_id: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("N"));
}

#[test]
fn create_product_result_serialize() {
    let result = CreateProductResult {
        sku: "NEW-SKU".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "NEW-SKU");
}

#[test]
fn create_product_result_debug() {
    let result = CreateProductResult { sku: "X".into() };
    let d = format!("{result:?}");
    assert!(d.contains("X"));
}

#[test]
fn update_product_args_deserialize() {
    let json = r##"{"user_id":"u1","sku":"LATTE","name":"Latte Updated","price_minor":500,"currency":"USD","category_id":null,"barcode":null,"tax_rate_ids":[]}"##;
    let args: UpdateProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Latte Updated");
    assert_eq!(args.price_minor, 500);
}

#[test]
fn update_product_scoped_args_deserialize() {
    let json = r##"{"sku":"LATTE","name":"Latte Updated","price_minor":500,"currency":"USD","category_id":null,"barcode":null,"tax_rate_ids":[]}"##;
    let args: UpdateProductScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Latte Updated");
    assert_eq!(args.price_minor, 500);
}

#[test]
fn update_product_result_serialize() {
    let result = UpdateProductResult {
        sku: "UPD-SKU".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "UPD-SKU");
}

#[test]
fn delete_product_args_deserialize() {
    let json = r##"{"user_id":"u1","sku":"OLD-SKU"}"##;
    let args: DeleteProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "OLD-SKU");
}

#[test]
fn delete_product_scoped_args_deserialize() {
    let json = r##"{"sku":"OLD-SKU"}"##;
    let args: DeleteProductScopedArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "OLD-SKU");
}

#[test]
fn delete_product_args_debug() {
    let args = DeleteProductArgs {
        user_id: "u".into(),
        sku: "S".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("S"));
}

// ── Session resolution ───────────────────────────────────────────

#[test]
fn create_product_scoped_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn update_product_scoped_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("bad-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn delete_product_scoped_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("bogus");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn list_products_scoped_rejects_invalid_token() {
    // Verify that an invalid/nonexistent session token returns InvalidSession.
    // list_products_scoped is an async command, so we can't call it directly.
    // Instead, test that resolve_session rejects unknown tokens.
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn list_products_scoped_accepts_valid_token() {
    // Verify that a valid session token resolves and returns products.
    let bridge = TestBridge::new();
    let session = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "default".into(),
        "default-restaurant-pos".into(),
        "restaurant-pos".into(),
        None,
        0,
    );
    bridge
        .sessions()
        .write()
        .unwrap()
        .insert("tok-valid".into(), session);

    let resolved = bridge.ctx().resolve_session("tok-valid").unwrap();
    assert_eq!(resolved.store_id, "default");
    assert_eq!(resolved.type_key, "restaurant-pos");
}

// ── ADR #36 D7 cost gate ─────────────────────────────────────────

/// Seed the identity DB with the cost-gate roles/users and hand back a bridge
/// carrying the three sessions. The desktop built a Tauri mock app over
/// `AppState::for_test_with_conn`; `TestBridge` owns the same Arcs
/// headlessly, and its store manager stands in for the desktop tempdir.
fn seeded_cost_gate_bridge() -> TestBridge {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    // role-costless is a custom role that holds PRODUCTS_CREATE/
    // PRODUCTS_UPDATE but NOT PRODUCTS_EDIT_COST (ADR #36 D7 - manager+
    // only); role-staff is checkout-only and holds none of them.
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-costless', 'Costless', 'Custom', '[\"products:create\",\"products:update\"]',
             '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-staff',    'staff',    'hash', 'Staff',    'role-staff',    1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-costless', 'costless', 'hash', 'Costless', 'role-costless', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-manager',  'manager',  'hash', 'Manager',  'role-manager',  1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = TestBridge::new().with_conn(conn);
    for (token, user, role) in [
        ("staff-token", "user-staff", "role-staff"),
        ("costless-token", "user-costless", "role-costless"),
        ("manager-token", "user-manager", "role-manager"),
    ] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                user.into(),
                role.into(),
                "terminal-1".into(),
                "store-1".into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    bridge
}

fn create_args(sku: &str, cost_minor: i64) -> CreateProductScopedArgs {
    CreateProductScopedArgs {
        sku: sku.into(),
        name: sku.into(),
        price_minor: 100,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        initial_stock: 0,
        tax_rate_ids: vec![],
        product_type: "retail".into(),
        cost_minor,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
        default_supplier_id: None,
    }
}

fn update_args(sku: &str, cost_minor: Option<i64>) -> UpdateProductScopedArgs {
    UpdateProductScopedArgs {
        sku: sku.into(),
        name: sku.into(),
        price_minor: 100,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        tax_rate_ids: vec![],
        product_type: Some("retail".into()),
        cost_minor,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: None,
        default_supplier_id: None,
    }
}

#[tokio::test]
async fn create_product_scoped_denies_cost_without_edit_cost_permission() {
    let bridge = seeded_cost_gate_bridge();

    // A create-capable role (custom: products:create, no edit_cost)
    // creating a product WITHOUT cost passes the gate (the call then fails
    // on the store DB - the point is it is NOT a permission denial).
    let no_cost = create_scoped(
        &bridge.ctx(),
        "costless-token",
        &create_args("SKU-NO-COST", 0),
    )
    .await;
    assert!(!matches!(no_cost, Err(BridgeError::PermissionDenied(_))));

    // The same role setting a cost is rejected outright.
    let with_cost = create_scoped(
        &bridge.ctx(),
        "costless-token",
        &create_args("SKU-COST", 100),
    )
    .await;
    assert!(matches!(with_cost, Err(BridgeError::PermissionDenied(_))));

    // Staff is checkout-only and cannot create products at all.
    let staff = create_scoped(&bridge.ctx(), "staff-token", &create_args("SKU-STAFF", 0)).await;
    assert!(matches!(staff, Err(BridgeError::PermissionDenied(_))));

    // Manager passes the gate (then fails on the store DB, not on the
    // permission).
    let manager = create_scoped(&bridge.ctx(), "manager-token", &create_args("SKU-MGR", 100)).await;
    assert!(!matches!(manager, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn update_product_scoped_denies_cost_change_without_edit_cost_permission() {
    let bridge = seeded_cost_gate_bridge();

    // A create-capable role (custom: products:update, no edit_cost) PATCH
    // without touching cost passes the gate.
    let no_cost = update_scoped(&bridge.ctx(), "costless-token", &update_args("SKU-1", None)).await;
    assert!(!matches!(no_cost, Err(BridgeError::PermissionDenied(_))));

    // The same role PATCH that changes cost is rejected.
    let with_cost = update_scoped(
        &bridge.ctx(),
        "costless-token",
        &update_args("SKU-1", Some(100)),
    )
    .await;
    assert!(matches!(with_cost, Err(BridgeError::PermissionDenied(_))));

    // Staff is checkout-only and cannot update products at all.
    let staff = update_scoped(&bridge.ctx(), "staff-token", &update_args("SKU-1", None)).await;
    assert!(matches!(staff, Err(BridgeError::PermissionDenied(_))));

    // Manager PATCH with cost passes the gate.
    let manager = update_scoped(
        &bridge.ctx(),
        "manager-token",
        &update_args("SKU-1", Some(100)),
    )
    .await;
    assert!(!matches!(manager, Err(BridgeError::PermissionDenied(_))));
}

#[test]
fn edit_cost_permission_membership_is_manager_only() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);
    // Owner (wildcard) and Manager presets hold it; Staff does not. Desktop
    // asserted this through commands::authz::require_permission_for_user, a
    // three-line wrapper over Store::require_permission that never moved to the
    // bridge, so the test pins the same membership on the wrapped call.
    assert!(
        store
            .require_permission("user-owner", permissions::PRODUCTS_EDIT_COST)
            .is_ok()
    );
    assert!(
        store
            .require_permission("user-manager", permissions::PRODUCTS_EDIT_COST)
            .is_ok()
    );
    assert!(matches!(
        store.require_permission("user-staff", permissions::PRODUCTS_EDIT_COST),
        Err(oz_core::CoreError::PermissionDenied(_))
    ));
}
