use super::*;

#[test]
fn product_bundle_serde_roundtrip() {
    let pb = ProductBundle {
        id: "b1".into(),
        bundle_sku: "GIFT-BOX".into(),
        name: "Gift Box".into(),
        description: "A curated gift box".into(),
        bundle_price_minor: Some(25000),
        currency: "IDR".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-07-01T12:00:00Z".into(),
    };
    let json = serde_json::to_string(&pb).unwrap();
    let back: ProductBundle = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, pb.id);
    assert_eq!(back.bundle_sku, pb.bundle_sku);
    assert_eq!(back.name, pb.name);
    assert_eq!(back.description, pb.description);
    assert_eq!(back.bundle_price_minor, pb.bundle_price_minor);
    assert_eq!(back.currency, pb.currency);
    assert_eq!(back.active, pb.active);
}

#[test]
fn product_bundle_null_price() {
    let pb = ProductBundle {
        id: "b2".into(),
        bundle_sku: "SIMPLE".into(),
        name: "Simple".into(),
        description: String::new(),
        bundle_price_minor: None,
        currency: "USD".into(),
        active: false,
        created_at: "2026-06-01T00:00:00Z".into(),
        updated_at: "2026-06-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&pb).unwrap();
    assert!(json.contains("\"bundle_price_minor\":null"));
    let back: ProductBundle = serde_json::from_str(&json).unwrap();
    assert_eq!(back.bundle_price_minor, None);
    assert!(!back.active);
}

#[test]
fn bundle_item_serde_roundtrip() {
    let item = BundleItem {
        id: "i1".into(),
        bundle_id: "b1".into(),
        sku: "SKU-001".into(),
        qty: 3,
        unit_price_minor: Some(1500),
    };
    let json = serde_json::to_string(&item).unwrap();
    let back: BundleItem = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, item.id);
    assert_eq!(back.bundle_id, item.bundle_id);
    assert_eq!(back.sku, item.sku);
    assert_eq!(back.qty, item.qty);
    assert_eq!(back.unit_price_minor, item.unit_price_minor);
}

#[test]
fn bundle_item_null_unit_price() {
    let item = BundleItem {
        id: "i2".into(),
        bundle_id: "b2".into(),
        sku: "SKU-002".into(),
        qty: 1,
        unit_price_minor: None,
    };
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"unit_price_minor\":null"));
    let back: BundleItem = serde_json::from_str(&json).unwrap();
    assert_eq!(back.unit_price_minor, None);
}

#[test]
fn bundle_with_items_serde_roundtrip() {
    let bundle = ProductBundle {
        id: "b3".into(),
        bundle_sku: "COMBO".into(),
        name: "Combo Deal".into(),
        description: String::new(),
        bundle_price_minor: Some(50000),
        currency: "IDR".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let items = vec![
        BundleItem {
            id: "ci1".into(),
            bundle_id: "b3".into(),
            sku: "A".into(),
            qty: 2,
            unit_price_minor: Some(10000),
        },
        BundleItem {
            id: "ci2".into(),
            bundle_id: "b3".into(),
            sku: "B".into(),
            qty: 1,
            unit_price_minor: None,
        },
    ];
    let bwi = BundleWithItems {
        bundle: bundle.clone(),
        items: items.clone(),
    };
    let json = serde_json::to_string(&bwi).unwrap();
    let back: BundleWithItems = serde_json::from_str(&json).unwrap();
    assert_eq!(back.bundle.id, bundle.id);
    assert_eq!(back.items.len(), 2);
    assert_eq!(back.items[0].sku, "A");
    assert_eq!(back.items[1].sku, "B");
}

#[test]
fn bundle_with_items_empty_items() {
    let bundle = ProductBundle {
        id: "b4".into(),
        bundle_sku: "EMPTY".into(),
        name: "Empty".into(),
        description: String::new(),
        bundle_price_minor: None,
        currency: "IDR".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let bwi = BundleWithItems {
        bundle,
        items: vec![],
    };
    let json = serde_json::to_string(&bwi).unwrap();
    let back: BundleWithItems = serde_json::from_str(&json).unwrap();
    assert!(back.items.is_empty());
}

// ── Debug ────────────────────────────────────────────────────

#[test]
fn product_bundle_debug() {
    let pb = ProductBundle {
        id: "b1".into(),
        bundle_sku: "GIFT-BOX".into(),
        name: "Gift Box".into(),
        description: String::new(),
        bundle_price_minor: None,
        currency: "IDR".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let debug = format!("{:?}", pb);
    assert!(debug.contains("GIFT-BOX"));
    assert!(debug.contains("Gift Box"));
}

#[test]
fn bundle_item_debug() {
    let item = BundleItem {
        id: "i1".into(),
        bundle_id: "b1".into(),
        sku: "SKU-001".into(),
        qty: 5,
        unit_price_minor: Some(999),
    };
    let debug = format!("{:?}", item);
    assert!(debug.contains("SKU-001"));
    assert!(debug.contains("5"));
}

#[test]
fn bundle_with_items_debug() {
    let bundle = ProductBundle {
        id: "b9".into(),
        bundle_sku: "DBG".into(),
        name: "Debug Bundle".into(),
        description: String::new(),
        bundle_price_minor: None,
        currency: "IDR".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let bwi = BundleWithItems {
        bundle,
        items: vec![],
    };
    let debug = format!("{:?}", bwi);
    assert!(debug.contains("Debug Bundle"));
}

// ── Edge cases ───────────────────────────────────────────────

#[test]
fn bundle_item_large_qty() {
    let item = BundleItem {
        id: "i3".into(),
        bundle_id: "b1".into(),
        sku: "BULK".into(),
        qty: 999,
        unit_price_minor: Some(1),
    };
    let json = serde_json::to_string(&item).unwrap();
    let back: BundleItem = serde_json::from_str(&json).unwrap();
    assert_eq!(back.qty, 999);
}

#[test]
fn product_bundle_zero_price() {
    let pb = ProductBundle {
        id: "b6".into(),
        bundle_sku: "FREE".into(),
        name: "Freebie".into(),
        description: String::new(),
        bundle_price_minor: Some(0),
        currency: "USD".into(),
        active: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };
    let json = serde_json::to_string(&pb).unwrap();
    let back: ProductBundle = serde_json::from_str(&json).unwrap();
    assert_eq!(back.bundle_price_minor, Some(0));
}
