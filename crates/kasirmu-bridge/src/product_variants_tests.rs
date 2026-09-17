//! Unit tests for the product-variant command bodies (Wave-A test relocation:
//! moved out of
//! `apps/desktop-tauri/src/commands/product_variants_tests.rs`).
//!
//! Mounted at the foot of `product_variants.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` reaches the DTOs defined there; `foundation` is a dependency
//! of this crate, so the `Barcode` value-object cases move unchanged. Every
//! case here is a pure validation or serde-conformance check — none of them
//! needs a `TestBridge`, and none constructs a `BridgeCtx`. The desktop command
//! shims still own the IPC surface these DTOs feed, so the assertions pin the
//! same wire shape from the side that now implements it.

use super::*;

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

// -- DTO struct tests --

#[test]
fn product_variant_dto_debug() {
    let dto = ProductVariantDto {
        id: "v1".into(),
        parent_sku: "TEA".into(),
        name: "Green".into(),
        sku: "TEA-GREEN".into(),
        price: None,
        barcode: None,
        sort_order: 1,
        is_active: true,
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("TEA-GREEN"));
}

#[test]
fn product_variant_dto_serialize() {
    let dto = ProductVariantDto {
        id: "v2".into(),
        parent_sku: "COFFEE".into(),
        name: "Large".into(),
        sku: "COFFEE-L".into(),
        price: Some(MoneyDto {
            minor_units: 550,
            currency: "USD".into(),
        }),
        barcode: Some("4901234567890".into()),
        sort_order: 2,
        is_active: false,
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["sku"], "COFFEE-L");
    assert_eq!(json["is_active"], false);
}

#[test]
fn money_dto_variant_serialize() {
    let dto = MoneyDto {
        minor_units: 350,
        currency: "IDR".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["minor_units"], 350);
    assert_eq!(json["currency"], "IDR");
}

#[test]
fn create_product_variant_args_deserialize_minimal() {
    let json = r##"{"parent_sku":"TEA","name":"Green","sku":"TEA-GREEN"}"##;
    let args: CreateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.parent_sku, "TEA");
    assert_eq!(args.price_minor, None);
    assert_eq!(args.sort_order, None);
    assert_eq!(args.is_active, None);
}

#[test]
fn create_product_variant_args_debug() {
    let args = CreateProductVariantArgs {
        parent_sku: "P".into(),
        name: "N".into(),
        sku: "S".into(),
        price_minor: None,
        currency: None,
        barcode: None,
        sort_order: None,
        is_active: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("S"));
}

#[test]
fn create_product_variant_result_serialize() {
    let result = CreateProductVariantResult {
        sku: "NEW-VAR".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "NEW-VAR");
}

#[test]
fn update_product_variant_args_deserialize() {
    let json = r##"{"sku":"TEA-GREEN","name":"Green Tea","is_active":true}"##;
    let args: UpdateProductVariantArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku, "TEA-GREEN");
    assert_eq!(args.name.as_deref(), Some("Green Tea"));
    assert_eq!(args.is_active, Some(true));
}

#[test]
fn update_product_variant_args_debug() {
    let args = UpdateProductVariantArgs {
        sku: "S".into(),
        name: None,
        price_minor: None,
        currency: None,
        barcode: None,
        sort_order: None,
        is_active: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("S"));
}

#[test]
fn update_product_variant_result_serialize() {
    let result = UpdateProductVariantResult {
        sku: "UPD-VAR".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["sku"], "UPD-VAR");
}
