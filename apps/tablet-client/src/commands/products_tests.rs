use super::*;
use kasirmu_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
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

// ── DTO struct tests ──────────────────────────────────────────

#[test]
fn product_dto_debug() {
    let dto = ProductDto {
        id: "prod-1".into(),
        sku: "LATTE".into(),
        name: "Caffè Latte".into(),
        category: Some("Drinks".into()),
        price: MoneyDto {
            minor_units: 450,
            currency: "USD".into(),
        },
        barcode: Some("4901234567890".into()),
        in_stock: true,
        stock_qty: Some(50),
        tax_rate_ids: vec![],
        created_at: "2025-01-01T00:00:00Z".into(),
        price_updated_at: "2025-01-01T00:00:00Z".into(),
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
    assert!(d.contains("LATTE"));
    assert!(d.contains("Drinks"));
}

#[test]
fn money_dto_serialize() {
    let dto = MoneyDto {
        minor_units: 1000,
        currency: "IDR".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["minor_units"], 1000);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn adjust_stock_args_deserialize() {
    let json = r#"{"sku":"LATTE","delta":5,"reason":"restock"}"#;
    let args: AdjustStockArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "LATTE");
    assert_eq!(args.delta, 5);
    assert_eq!(args.reason, "restock");
}

#[test]
fn adjust_stock_args_debug() {
    let args = AdjustStockArgs {
        sku: "TEA".into(),
        delta: -2,
        reason: "damaged".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("TEA"));
    assert!(d.contains("damaged"));
}

#[test]
fn create_product_args_deserialize() {
    let json = r#"{"user_id":"u1","sku":"LATTE","name":"Latte","price_minor":450,"currency":"USD","category_id":null,"barcode":null,"initial_stock":10,"tax_rate_ids":[]}"#;
    let args: CreateProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "LATTE");
    assert_eq!(args.price_minor, 450);
    assert_eq!(args.initial_stock, 10);
}

#[test]
fn create_product_args_debug() {
    let args = CreateProductArgs {
        user_id: "u1".into(),
        sku: "TEA".into(),
        name: "Green Tea".into(),
        price_minor: 275,
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
    assert!(d.contains("Green Tea"));
}

#[test]
fn create_product_result_serialize() {
    let result = CreateProductResult {
        sku: "LATTE".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "LATTE");
}

#[test]
fn update_product_args_deserialize() {
    let json = r#"{"user_id":"u1","sku":"LATTE","name":"Latte XL","price_minor":500,"currency":"USD","category_id":null,"barcode":null,"tax_rate_ids":[]}"#;
    let args: UpdateProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Latte XL");
    assert_eq!(args.price_minor, 500);
}

#[test]
fn update_product_result_serialize() {
    let result = UpdateProductResult {
        sku: "LATTE".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "LATTE");
}

#[test]
fn delete_product_args_deserialize() {
    let json = r#"{"user_id":"u1","sku":"OLD-SKU"}"#;
    let args: DeleteProductArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.user_id, "u1");
    assert_eq!(args.sku, "OLD-SKU");
}

#[test]
fn delete_product_args_debug() {
    let args = DeleteProductArgs {
        user_id: "u1".into(),
        sku: "OLD".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("OLD"));
}
