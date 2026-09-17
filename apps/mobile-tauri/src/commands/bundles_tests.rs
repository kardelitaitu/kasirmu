use super::*;

#[test]
fn create_bundle_args_deserialize() {
    let json = r#"{"bundle_sku":"BUNDLE-001","name":"Breakfast Combo","description":"Coffee + croissant","bundle_price_minor":1500,"currency":"USD","items":[{"sku":"SKU-1","qty":2,"unit_price_minor":500}]}"#;
    let args: CreateBundleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.bundle_sku, "BUNDLE-001");
    assert_eq!(args.name, "Breakfast Combo");
    assert_eq!(args.description.unwrap(), "Coffee + croissant");
    assert_eq!(args.bundle_price_minor.unwrap(), 1500);
    assert_eq!(args.items.len(), 1);
}

#[test]
fn create_bundle_args_debug() {
    let args = CreateBundleArgs {
        bundle_sku: "B-TEST".into(),
        name: "Test".into(),
        description: None,
        bundle_price_minor: None,
        currency: None,
        items: vec![],
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("B-TEST"));
}

#[test]
fn create_bundle_item_arg_deserialize() {
    let json = r#"{"sku":"SKU-A","qty":3,"unit_price_minor":200}"#;
    let item: CreateBundleItemArg = serde_json::from_str(json).unwrap();
    assert_eq!(item.sku, "SKU-A");
    assert_eq!(item.qty, 3);
    assert_eq!(item.unit_price_minor.unwrap(), 200);
}

#[test]
fn create_bundle_item_arg_debug() {
    let item = CreateBundleItemArg {
        sku: "SKU-X".into(),
        qty: 1,
        unit_price_minor: Some(100),
    };
    let debug = format!("{:?}", item);
    assert!(debug.contains("SKU-X"));
    assert!(debug.contains("100"));
}
