//! Sibling tests for [`ProductType::parse_stored_or_default`], the one helper
//! every reader of `products.product_type` now funnels through.
//!
//! The four arms are the whole contract: a valid value returns its variant,
//! and each way the column can go wrong — unmapped, empty, NULL — returns the
//! default. Each of those three is also the warn arm, because `parse_str`
//! returns `None` for exactly those inputs and the helper's `match` falls
//! through to the `tracing::warn!`. The paired `parse_str` assertions below
//! pin that: they prove the input reached the arm that logs rather than a
//! silently-swallowed one. Asserting the emitted line itself would need a
//! `tracing-subscriber` dev-dependency this crate does not carry.

use super::*;

#[test]
fn parse_stored_or_default_unknown_value_warns_and_returns_default() {
    // Case-sensitive miss: "RETAIL" is not a stored form of anything.
    assert_eq!(ProductType::parse_str("RETAIL"), None);
    assert_eq!(
        ProductType::parse_stored_or_default(Some("RETAIL"), "SKU-1", "test::unknown"),
        ProductType::default()
    );
    assert_eq!(
        ProductType::parse_stored_or_default(Some("RETAIL"), "SKU-1", "test::unknown"),
        ProductType::Retail
    );
}

#[test]
fn parse_stored_or_default_empty_string_warns_and_returns_default() {
    assert_eq!(ProductType::parse_str(""), None);
    assert_eq!(
        ProductType::parse_stored_or_default(Some(""), "SKU-2", "test::empty"),
        ProductType::default()
    );
}

#[test]
fn parse_stored_or_default_null_returns_default() {
    // `None` is the NULL / missing-column arm; it is distinguishable from the
    // empty-string arm only in the log (`stored` is Debug-formatted), which is
    // why both are covered separately above.
    assert_eq!(
        ProductType::parse_stored_or_default(None, "SKU-3", "test::null"),
        ProductType::default()
    );
}

#[test]
fn parse_stored_or_default_valid_value_returns_variant() {
    for variant in [
        ProductType::Retail,
        ProductType::Restaurant,
        ProductType::Both,
        ProductType::Service,
    ] {
        assert_eq!(
            ProductType::parse_stored_or_default(Some(variant.as_str()), "SKU-4", "test::valid"),
            variant
        );
    }
}

// ── Moved out of the inline mod tests in models.rs (sibling-file rule) ─

// ── LocationId ──────────────────────────────────────────────────

#[test]
fn location_id_default_is_canonical() {
    let id = LocationId::default();
    assert_eq!(id.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

#[test]
fn location_id_new_returns_unique_uuid() {
    let a = LocationId::new();
    let b = LocationId::new();
    assert_ne!(a.as_str(), b.as_str());
    // Must be parseable as a UUID v7.
    let parsed = uuid::Uuid::parse_str(a.as_str()).unwrap();
    assert_eq!(parsed.get_version_num(), 7);
}

#[test]
fn location_id_display_matches_as_str() {
    let id = LocationId::from("custom-loc");
    assert_eq!(format!("{id}"), id.as_str());
}

#[test]
fn location_id_deref_to_str() {
    let id = LocationId::from("loc-123");
    assert_eq!(&*id, "loc-123");
    assert_eq!(id.len(), 7);
}

#[test]
fn location_id_from_string_roundtrip() {
    let id = LocationId::from("abc".to_string());
    assert_eq!(id.as_str(), "abc");
}

#[test]
fn location_id_from_str_roundtrip() {
    let id = LocationId::from("xyz");
    assert_eq!(id.as_str(), "xyz");
}

#[test]
fn location_id_default_eq_canonical_constant() {
    let id = LocationId::default();
    assert_eq!(id.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
    // Must also round-trip through serde.
    let json = serde_json::to_string(&id).unwrap();
    let back: LocationId = serde_json::from_str(&json).unwrap();
    assert_eq!(back.as_str(), CANONICAL_DEFAULT_LOCATION_UUID);
}

// ── ProductType ─────────────────────────────────────────────────

#[test]
fn product_type_parse_str_roundtrip() {
    for variant in [
        ProductType::Retail,
        ProductType::Restaurant,
        ProductType::Both,
        ProductType::Service,
    ] {
        let s = variant.as_str();
        assert_eq!(ProductType::parse_str(s), Some(variant));
    }
}

#[test]
fn product_type_parse_str_unknown_returns_none() {
    assert!(ProductType::parse_str("unknown").is_none());
    assert!(ProductType::parse_str("").is_none());
    assert!(ProductType::parse_str("RETAIL").is_none());
}

#[test]
fn product_type_tracks_inventory_for_physical_types() {
    assert!(ProductType::Retail.tracks_inventory());
    assert!(ProductType::Restaurant.tracks_inventory());
    assert!(ProductType::Both.tracks_inventory());
    assert!(!ProductType::Service.tracks_inventory());
}

#[test]
fn product_type_default_is_retail() {
    assert_eq!(ProductType::default(), ProductType::Retail);
}

#[test]
fn product_type_serde_roundtrip() {
    for variant in [
        ProductType::Retail,
        ProductType::Restaurant,
        ProductType::Both,
        ProductType::Service,
    ] {
        let json = serde_json::to_string(&variant).unwrap();
        let back: ProductType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

// ── Product ─────────────────────────────────────────────────────

fn make_product() -> Product {
    Product::new(
        "SKU-1",
        "Widget",
        Money::from_major(10, "USD".parse().unwrap()).unwrap(),
    )
}

#[test]
fn product_new_sets_defaults() {
    let p = make_product();
    assert_eq!(p.sku.as_str(), "SKU-1");
    assert_eq!(p.name, "Widget");
    assert_eq!(
        p.price,
        Money::from_major(10, "USD".parse().unwrap()).unwrap()
    );
    assert!(p.category_id.is_none());
    assert!(p.barcode.is_none());
    assert!(!p.track_serial);
    assert_eq!(p.product_type, ProductType::Retail);
    assert_eq!(p.version, 1);
    assert_eq!(p.cost_minor, 0);
    assert!(p.brand.is_none());
    assert!(p.rack_location.is_none());
    assert!(p.notes.is_none());
    assert!(p.unit.is_none());
    assert!(p.is_active);
    assert!(p.default_supplier_id.is_none());
}

#[test]
fn product_new_trims_name() {
    let p = Product::new(
        "SKU-2",
        "  Spaced  ",
        Money::from_major(1, "USD".parse().unwrap()).unwrap(),
    );
    assert_eq!(p.name, "Spaced");
}

#[test]
#[should_panic(expected = "product name must not be empty")]
fn product_new_rejects_empty_name_after_trim() {
    Product::new(
        "SKU-3",
        "   ",
        Money::from_major(1, "USD".parse().unwrap()).unwrap(),
    );
}

#[test]
fn product_new_generates_unique_id() {
    let a = make_product();
    let b = make_product();
    assert_ne!(a.id, b.id);
}

#[test]
fn product_builder_with_category() {
    let p = make_product().with_category("cat-1");
    assert_eq!(p.category_id.as_deref(), Some("cat-1"));
}

#[test]
fn product_builder_with_product_type() {
    let p = make_product().with_product_type(ProductType::Service);
    assert_eq!(p.product_type, ProductType::Service);
}

#[test]
fn product_serde_roundtrip() {
    let p = make_product();
    let json = serde_json::to_string(&p).unwrap();
    let back: Product = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, p.id);
    assert_eq!(back.sku, p.sku);
    assert_eq!(back.name, p.name);
    assert_eq!(back.price, p.price);
    assert_eq!(back.version, 1);
    assert!(back.is_active);
}

#[test]
fn product_default_version_is_one() {
    let p = make_product();
    assert_eq!(p.version, 1);
}

#[test]
fn product_default_is_active_is_true() {
    let p = make_product();
    assert!(p.is_active);
}

#[test]
fn product_cost_minor_not_synced() {
    let mut p = make_product();
    p.cost_minor = 750;
    let json = serde_json::to_string(&p).unwrap();
    let back: Product = serde_json::from_str(&json).unwrap();
    assert_eq!(back.cost_minor, 750);
}

// ── Category ────────────────────────────────────────────────────

#[test]
fn category_new_sets_fields() {
    let c = Category::new("cat-1", "Drinks", "#ff0000", "coffee");
    assert_eq!(c.id, "cat-1");
    assert_eq!(c.name, "Drinks");
    assert_eq!(c.colour, "#ff0000");
    assert_eq!(c.icon, "coffee");
}

#[test]
fn category_new_trims_name() {
    let c = Category::new("cat-2", "  Food  ", "#000", "utensils");
    assert_eq!(c.name, "Food");
}

#[test]
#[should_panic(expected = "category name must not be empty")]
fn category_new_rejects_empty_name() {
    Category::new("cat-3", "  ", "#000", "icon");
}

#[test]
fn category_serde_roundtrip() {
    let c = Category::new("cat-1", "Drinks", "#ff0000", "coffee");
    let json = serde_json::to_string(&c).unwrap();
    let back: Category = serde_json::from_str(&json).unwrap();
    assert_eq!(back, c);
}

// ── Inventory ───────────────────────────────────────────────────

#[test]
fn inventory_new_sets_defaults() {
    let inv = Inventory::new("SKU-1", 10);
    assert_eq!(inv.sku.as_str(), "SKU-1");
    assert_eq!(inv.qty, 10);
    assert_eq!(inv.low_stock_threshold, 5);
    assert_eq!(inv.location_id, LocationId::default());
}

#[test]
#[should_panic(expected = "quantity must not be negative")]
fn inventory_new_rejects_negative_qty() {
    Inventory::new("SKU-1", -1);
}

#[test]
fn inventory_new_zero_qty_is_valid() {
    let inv = Inventory::new("SKU-1", 0);
    assert_eq!(inv.qty, 0);
}

#[test]
fn inventory_is_low_stock_at_threshold() {
    let mut inv = Inventory::new("SKU-1", 5);
    inv.low_stock_threshold = 5;
    assert!(inv.is_low_stock()); // 5 <= 5
}

#[test]
fn inventory_is_not_low_stock_above_threshold() {
    let mut inv = Inventory::new("SKU-1", 6);
    inv.low_stock_threshold = 5;
    assert!(!inv.is_low_stock());
}

#[test]
fn inventory_is_low_stock_below_threshold() {
    let mut inv = Inventory::new("SKU-1", 3);
    inv.low_stock_threshold = 5;
    assert!(inv.is_low_stock());
}

#[test]
fn inventory_serde_roundtrip() {
    let inv = Inventory::new("SKU-1", 42);
    let json = serde_json::to_string(&inv).unwrap();
    let back: Inventory = serde_json::from_str(&json).unwrap();
    assert_eq!(back.qty, 42);
    assert_eq!(back.sku.as_str(), "SKU-1");
}

// ── ProductWithDetails ──────────────────────────────────────────

#[test]
fn product_with_details_serde_roundtrip() {
    let pwd = ProductWithDetails {
        product: make_product(),
        category_name: Some("Drinks".into()),
        stock_qty: Some(100),
    };
    let json = serde_json::to_string(&pwd).unwrap();
    let back: ProductWithDetails = serde_json::from_str(&json).unwrap();
    assert_eq!(back.category_name.as_deref(), Some("Drinks"));
    assert_eq!(back.stock_qty, Some(100));
}

#[test]
fn product_with_details_none_fields_roundtrip() {
    let pwd = ProductWithDetails {
        product: make_product(),
        category_name: None,
        stock_qty: None,
    };
    let json = serde_json::to_string(&pwd).unwrap();
    let back: ProductWithDetails = serde_json::from_str(&json).unwrap();
    assert!(back.category_name.is_none());
    assert!(back.stock_qty.is_none());
}

// ── InventoryLocation ───────────────────────────────────────────

#[test]
fn inventory_location_serde_roundtrip() {
    let loc = InventoryLocation {
        id: "loc-1".into(),
        name: "Main".into(),
        location_type: "warehouse".into(),
        description: "Primary".into(),
        is_active: true,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&loc).unwrap();
    let back: InventoryLocation = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "loc-1");
    assert_eq!(back.location_type, "warehouse");
}

// ── WorkspaceInventoryLocation ──────────────────────────────────

#[test]
fn workspace_inventory_location_serde_roundtrip() {
    let w = WorkspaceInventoryLocation {
        id: "binding-1".into(),
        instance_id: "ws-1".into(),
        location_id: "loc-1".into(),
        is_primary: true,
        allow_negative_stock: false,
        sort_order: 0,
    };
    let json = serde_json::to_string(&w).unwrap();
    let back: WorkspaceInventoryLocation = serde_json::from_str(&json).unwrap();
    assert!(back.is_primary);
    assert!(!back.allow_negative_stock);
}

// ── InventoryShift ──────────────────────────────────────────────

#[test]
fn inventory_shift_serde_roundtrip() {
    let shift = InventoryShift {
        id: "shift-1".into(),
        user_id: "u-1".into(),
        location_id: "loc-1".into(),
        terminal_id: Some("term-1".into()),
        started_at: "2025-01-01T09:00:00Z".into(),
        ended_at: None,
        status: "active".into(),
        notes: String::new(),
    };
    let json = serde_json::to_string(&shift).unwrap();
    let back: InventoryShift = serde_json::from_str(&json).unwrap();
    assert_eq!(back.status, "active");
    assert!(back.ended_at.is_none());
}

// ── StockThreshold ──────────────────────────────────────────────

#[test]
fn stock_threshold_serde_roundtrip() {
    let t = StockThreshold {
        id: "t-1".into(),
        product_id: "p-1".into(),
        location_id: Some("loc-1".into()),
        threshold: 10,
        enabled: true,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&t).unwrap();
    let back: StockThreshold = serde_json::from_str(&json).unwrap();
    assert_eq!(back.threshold, 10);
    assert!(back.location_id.is_some());
}

#[test]
fn stock_threshold_location_id_nullable() {
    let t = StockThreshold {
        id: "t-2".into(),
        product_id: "p-1".into(),
        location_id: None,
        threshold: 5,
        enabled: false,
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&t).unwrap();
    let back: StockThreshold = serde_json::from_str(&json).unwrap();
    assert!(back.location_id.is_none());
}
