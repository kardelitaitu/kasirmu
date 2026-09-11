//! Unit tests for the product-bundle argument DTOs.
//!
//! Relocated verbatim from `apps/desktop-client/src/commands/bundles_tests.rs`
//! (Wave F); mounted at the foot of the `bundles` bridge module, so
//! `use super::*;` resolves the moved arg structs.

use super::*;

// ── CreateBundleArgs ────────────────────────────────────────────────

#[test]
fn create_bundle_args_deserialize_minimal() {
    let json = r#"{"bundle_sku":"BUNDLE-1","name":"Breakfast Combo","items":[]}"#;
    let args: CreateBundleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.bundle_sku, "BUNDLE-1");
    assert_eq!(args.description, None);
    assert_eq!(args.bundle_price_minor, None);
}

#[test]
fn create_bundle_args_deserialize_full() {
    let json = r#"{"bundle_sku":"BUNDLE-2","name":"Lunch Combo","description":"Great deal","bundle_price_minor":1500,"currency":"IDR","items":[{"sku":"SKU-A","qty":2,"unit_price_minor":750}]}"#;
    let args: CreateBundleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.description.as_deref(), Some("Great deal"));
    assert_eq!(args.bundle_price_minor, Some(1500));
    assert_eq!(args.items.len(), 1);
}

#[test]
fn create_bundle_args_debug() {
    let args = CreateBundleArgs {
        bundle_sku: "BS".into(),
        name: "Test".into(),
        description: None,
        bundle_price_minor: None,
        currency: None,
        items: vec![],
    };
    let d = format!("{args:?}");
    assert!(d.contains("Test"));
}

// ── CreateBundleItemArg ─────────────────────────────────────────────

#[test]
fn create_bundle_item_arg_deserialize_minimal() {
    let json = r#"{"sku":"SKU-1","qty":3}"#;
    let args: CreateBundleItemArg = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "SKU-1");
    assert_eq!(args.qty, 3);
    assert_eq!(args.unit_price_minor, None);
}

#[test]
fn create_bundle_item_arg_deserialize_with_price() {
    let json = r#"{"sku":"SKU-2","qty":1,"unit_price_minor":500}"#;
    let args: CreateBundleItemArg = serde_json::from_str(json).unwrap();
    assert_eq!(args.qty, 1);
    assert_eq!(args.unit_price_minor, Some(500));
}

#[test]
fn create_bundle_item_arg_debug() {
    let args = CreateBundleItemArg {
        sku: "S".into(),
        qty: 5,
        unit_price_minor: Some(100),
    };
    let d = format!("{args:?}");
    assert!(d.contains("S"));
}
