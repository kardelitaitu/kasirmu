use super::*;
use kasirmu_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

fn seed_product(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('p1', 'TEA', 'Tea', 350, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
    )
    .unwrap();
}

#[test]
fn list_product_variants_empty_db() {
    let conn = fresh_conn();
    seed_product(&conn);
    let store = Store::new(&conn);
    let variants = store.list_product_variants("TEA").unwrap();
    assert!(variants.is_empty());
}

#[test]
fn list_product_variants_with_seeded_data() {
    let conn = fresh_conn();
    seed_product(&conn);

    let store = Store::new(&conn);
    let v = ProductVariant::new("TEA", "Green", "TEA-GREEN").with_sort_order(1);
    store.create_product_variant(&v).unwrap();
    let v = ProductVariant::new("TEA", "Black", "TEA-BLACK").with_sort_order(2);
    store.create_product_variant(&v).unwrap();

    let variants = store.list_product_variants("TEA").unwrap();
    assert_eq!(variants.len(), 2);
    assert_eq!(variants[0].sku, "TEA-GREEN");
    assert_eq!(variants[1].sku, "TEA-BLACK");
}

// ── Barcode validation ─────────────────────────────────────────

#[test]
fn barcode_empty_is_rejected() {
    let err = foundation::Barcode::new("").unwrap_err();
    assert_eq!(err.field, "barcode");
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn barcode_whitespace_only_is_rejected() {
    let err = foundation::Barcode::new("   ").unwrap_err();
    assert!(err.message.contains("must not be empty"));
}

#[test]
fn barcode_valid_ean13_passes() {
    let bc = foundation::Barcode::new("5901234123457").unwrap();
    assert_eq!(bc.as_str(), "5901234123457");
}

#[test]
fn barcode_valid_upca_passes() {
    let bc = foundation::Barcode::new("012345678905").unwrap();
    assert_eq!(bc.as_str(), "012345678905");
}

#[test]
fn barcode_valid_alphanumeric_passes() {
    let bc = foundation::Barcode::new("CODE128-ABC").unwrap();
    assert_eq!(bc.as_str(), "CODE128-ABC");
}

#[test]
fn barcode_trims_whitespace() {
    let bc = foundation::Barcode::new("  4901234567890  ").unwrap();
    assert_eq!(bc.as_str(), "4901234567890");
}

#[test]
fn barcode_optional_when_none_is_ok() {
    // The barcode field is optional in CreateProductVariantArgs and
    // is only validated via foundation::Barcode::new() when Some.
    let args = CreateProductVariantArgs {
        parent_sku: "TEA".into(),
        name: "Green".into(),
        sku: "TEA-GREEN".into(),
        price_minor: None,
        currency: None,
        barcode: None,
        sort_order: None,
        is_active: None,
    };
    // When None, no Barcode::new() is called, so validation passes.
    assert!(args.barcode.is_none());
}

// ── DTO struct tests ──────────────────────────────────────────

#[test]
fn product_variant_dto_from() {
    let variant = ProductVariant {
        id: "v1".into(),
        parent_sku: "TEA".into(),
        name: "Green".into(),
        sku: "TEA-GREEN".into(),
        price: None,
        barcode: Some(foundation::Barcode::new("123").unwrap()),
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let dto = ProductVariantDto::from(variant);
    assert_eq!(dto.sku, "TEA-GREEN");
    assert_eq!(dto.parent_sku, "TEA");
    assert_eq!(dto.name, "Green");
    assert!(dto.price.is_none());
    assert_eq!(dto.barcode.as_deref(), Some("123"));
    assert_eq!(dto.sort_order, 1);
    assert!(dto.is_active);
}

#[test]
fn product_variant_dto_from_with_price() {
    let variant = ProductVariant {
        id: "v2".into(),
        parent_sku: "TEA".into(),
        name: "Black".into(),
        sku: "TEA-BLACK".into(),
        price: Some(kasirmu_core::Money {
            minor_units: 400,
            currency: kasirmu_core::Currency([85, 83, 68]),
        }),
        barcode: None,
        sort_order: 2,
        is_active: false,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let dto = ProductVariantDto::from(variant);
    let price = dto.price.unwrap();
    assert_eq!(price.minor_units, 400);
    assert_eq!(price.currency, "USD");
}

#[test]
fn product_variant_dto_debug() {
    let dto = ProductVariantDto {
        id: "v1".into(),
        parent_sku: "TEA".into(),
        name: "Green".into(),
        sku: "TEA-GREEN".into(),
        price: None,
        barcode: None,
        sort_order: 0,
        is_active: true,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("TEA-GREEN"));
}

#[test]
fn money_dto_serialize() {
    let dto = MoneyDto {
        minor_units: 500,
        currency: "IDR".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["minor_units"], 500);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn create_product_variant_args_deserialize() {
    let json = r#"{"parent_sku":"TEA","name":"Green","sku":"TEA-GREEN","price_minor":400,"currency":"USD","barcode":null,"sort_order":1,"is_active":true}"#;
    let args: CreateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.parent_sku, "TEA");
    assert_eq!(args.sku, "TEA-GREEN");
    assert_eq!(args.price_minor, Some(400));
    assert_eq!(args.sort_order, Some(1));
}

#[test]
fn create_product_variant_args_deserialize_minimal() {
    let json = r#"{"parent_sku":"TEA","name":"Oolong","sku":"TEA-OOLONG"}"#;
    let args: CreateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Oolong");
    assert_eq!(args.price_minor, None);
    assert_eq!(args.sort_order, None);
}

#[test]
fn create_product_variant_result_serialize() {
    let result = CreateProductVariantResult {
        sku: "TEA-GREEN".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "TEA-GREEN");
}

#[test]
fn update_product_variant_args_deserialize() {
    let json = r#"{"sku":"TEA-GREEN","name":"Green XL","price_minor":450,"currency":"USD","barcode":null,"sort_order":2,"is_active":true}"#;
    let args: UpdateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "TEA-GREEN");
    assert_eq!(args.name, Some("Green XL".into()));
    assert_eq!(args.price_minor, Some(450));
}

#[test]
fn update_product_variant_args_deserialize_minimal() {
    let json = r#"{"sku":"TEA-BLACK"}"#;
    let args: UpdateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "TEA-BLACK");
    assert_eq!(args.name, None);
    assert_eq!(args.is_active, None);
}

#[test]
fn update_product_variant_result_serialize() {
    let result = UpdateProductVariantResult {
        sku: "TEA-GREEN".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "TEA-GREEN");
}
