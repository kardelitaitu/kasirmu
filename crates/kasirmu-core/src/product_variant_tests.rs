use super::*;

fn usd() -> crate::Currency {
    "USD".parse().unwrap()
}

fn test_price() -> Money {
    Money::from_major(12, usd()).unwrap()
}

#[test]
fn new_variant_has_generated_id() {
    let v = ProductVariant::new("PARENT", "Small", "PARENT-SMALL");
    assert!(!v.id.is_empty(), "id should be generated");
    assert_eq!(v.parent_sku, "PARENT");
    assert_eq!(v.name, "Small");
    assert_eq!(v.sku, "PARENT-SMALL");
    assert!(v.price.is_none());
    assert!(v.barcode.is_none());
    assert_eq!(v.sort_order, 0);
    assert!(v.is_active);
    assert!(v.created_at.is_empty());
    assert!(v.updated_at.is_empty());
}

#[test]
fn new_variant_sets_fields() {
    let v = ProductVariant::new("COFFEE", "Large", "COFFEE-LARGE");
    assert_eq!(v.parent_sku, "COFFEE");
    assert_eq!(v.name, "Large");
    assert_eq!(v.sku, "COFFEE-LARGE");
}

#[test]
fn builder_methods() {
    let v = ProductVariant::new("TEA", "Green", "TEA-GREEN")
        .with_price(test_price())
        .with_barcode(Barcode::new("4901234567890").unwrap())
        .with_sort_order(1);
    assert_eq!(v.price, Some(test_price()));
    assert_eq!(v.barcode, Some(Barcode::new("4901234567890").unwrap()));
    assert_eq!(v.sort_order, 1);
}

#[test]
fn serde_roundtrip() {
    let v = ProductVariant::new("TEA", "Green", "TEA-GREEN")
        .with_price(test_price())
        .with_barcode(Barcode::new("4901234567890").unwrap())
        .with_sort_order(2);
    let json = serde_json::to_string(&v).unwrap();
    let back: ProductVariant = serde_json::from_str(&json).unwrap();
    assert_eq!(back, v);
}

#[test]
fn variant_ids_are_unique() {
    let a = ProductVariant::new("P1", "A", "P1-A");
    let b = ProductVariant::new("P1", "B", "P1-B");
    assert_ne!(a.id, b.id);
}

#[test]
fn debug_output() {
    let v = ProductVariant::new("TEA", "Green", "TEA-GREEN")
        .with_price(test_price())
        .with_sort_order(1);
    let debug = format!("{v:?}");
    assert!(debug.contains("TEA-GREEN"));
    assert!(debug.contains("Green"));
}

#[test]
fn serde_deserialize_minimal() {
    let json = r#"{"id":"v1","parent_sku":"TEA","name":"Oolong","sku":"T-O","price":null,"barcode":null,"sort_order":0,"is_active":true,"created_at":"","updated_at":""}"#;
    let v: ProductVariant = serde_json::from_str(json).unwrap();
    assert_eq!(v.sku, "T-O");
    assert_eq!(v.name, "Oolong");
    assert!(v.price.is_none());
    assert!(v.is_active);
}
