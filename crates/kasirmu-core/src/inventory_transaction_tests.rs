use super::*;

#[test]
fn inventory_transaction_id_constructors() {
    let s = InventoryTransactionId::new();
    assert!(!s.as_str().is_empty());
    let from_str = InventoryTransactionId::from("abc-123");
    assert_eq!(from_str.as_str(), "abc-123");
    let from_string = InventoryTransactionId::from(String::from("xyz-789"));
    assert_eq!(from_string.as_str(), "xyz-789");
}

#[test]
fn inventory_transaction_type_roundtrip() {
    for t in [
        InventoryTransactionType::Sale,
        InventoryTransactionType::Void,
        InventoryTransactionType::Refund,
        InventoryTransactionType::Transfer,
        InventoryTransactionType::PurchaseOrderReceive,
        InventoryTransactionType::StockCount,
        InventoryTransactionType::ManualAdjustment,
    ] {
        let stored = t.as_stored_str();
        let parsed = InventoryTransactionType::from_stored_str(stored);
        assert_eq!(parsed, Some(t));
    }
}

#[test]
fn inventory_transaction_type_unknown_returns_none() {
    assert_eq!(
        InventoryTransactionType::from_stored_str("legacy-future-type"),
        None
    );
}

#[test]
fn inventory_transaction_serde_roundtrip() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-001"),
        transaction_type: InventoryTransactionType::Sale,
        location_id: "loc-001".into(),
        staff_id: "user-001".into(),
        transfer_id: None,
        purchase_order_id: None,
        notes: "Cashier sale #42".into(),
        created_at: "2026-07-20T10:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&tx).unwrap();
    let back: InventoryTransaction = serde_json::from_str(&json).unwrap();
    assert_eq!(back, tx);
}

#[test]
fn inventory_transaction_line_serde_roundtrip() {
    let line = InventoryTransactionLine {
        id: "line-001".into(),
        transaction_id: InventoryTransactionId::from("tx-001"),
        sku: "CHO-001".into(),
        product_name: "Chocolate Bar".into(),
        qty: 2,
        barcode_scanned: Some("5901234123457".into()),
        sort_order: 1,
    };
    let json = serde_json::to_string(&line).unwrap();
    let back: InventoryTransactionLine = serde_json::from_str(&json).unwrap();
    assert_eq!(back, line);
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────────

// ── InventoryTransactionId edge cases ─────────────────────────────────

#[test]
fn id_default_returns_new_uuid() {
    let id = InventoryTransactionId::default();
    assert!(!id.as_str().is_empty());
}

#[test]
fn id_display() {
    let id = InventoryTransactionId::from("test-id-123");
    let displayed = format!("{id}");
    assert_eq!(displayed, "test-id-123");
}

#[test]
fn id_deref_to_str() {
    let id = InventoryTransactionId::from("deref-test");
    let s: &str = &id;
    assert_eq!(s, "deref-test");
}

#[test]
fn id_hash_used_in_hashset() {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    let id1 = InventoryTransactionId::from("id-1");
    let id2 = InventoryTransactionId::from("id-2");
    set.insert(id1.clone());
    set.insert(id2.clone());
    set.insert(id1.clone()); // duplicate
    assert_eq!(set.len(), 2);
}

#[test]
fn id_uniqueness() {
    let a = InventoryTransactionId::new();
    let b = InventoryTransactionId::new();
    assert_ne!(a.as_str(), b.as_str());
}

#[test]
fn id_clone() {
    let id = InventoryTransactionId::from("clone-test");
    let cloned = id.clone();
    assert_eq!(id, cloned);
}

#[test]
fn id_debug() {
    let id = InventoryTransactionId::from("debug-id");
    let debug = format!("{id:?}");
    assert!(debug.contains("debug-id"));
}

// ── InventoryTransactionType edge cases ───────────────────────────────

#[test]
fn type_serde_kebab_case() {
    let json = serde_json::to_value(InventoryTransactionType::Sale).unwrap();
    assert_eq!(json, "sale");
    let json = serde_json::to_value(InventoryTransactionType::PurchaseOrderReceive).unwrap();
    assert_eq!(json, "purchase-order-receive");
    let json = serde_json::to_value(InventoryTransactionType::ManualAdjustment).unwrap();
    assert_eq!(json, "manual-adjustment");
}

#[test]
fn type_serde_roundtrip_all() {
    for t in [
        InventoryTransactionType::Sale,
        InventoryTransactionType::Void,
        InventoryTransactionType::Refund,
        InventoryTransactionType::Transfer,
        InventoryTransactionType::PurchaseOrderReceive,
        InventoryTransactionType::StockCount,
        InventoryTransactionType::ManualAdjustment,
    ] {
        let json = serde_json::to_string(&t).unwrap();
        let back: InventoryTransactionType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }
}

#[test]
fn type_from_stored_str_empty() {
    assert_eq!(InventoryTransactionType::from_stored_str(""), None);
}

#[test]
fn type_from_stored_str_case_sensitive() {
    assert_eq!(InventoryTransactionType::from_stored_str("Sale"), None);
    assert_eq!(InventoryTransactionType::from_stored_str("SALE"), None);
}

#[test]
fn type_copy_semantics() {
    let a = InventoryTransactionType::Refund;
    let b = a;
    assert_eq!(a, b);
}

#[test]
fn type_hash_used_in_hashset() {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    set.insert(InventoryTransactionType::Sale);
    set.insert(InventoryTransactionType::Void);
    set.insert(InventoryTransactionType::Sale);
    assert_eq!(set.len(), 2);
}

#[test]
fn type_all_stored_str_are_unique() {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for t in [
        InventoryTransactionType::Sale,
        InventoryTransactionType::Void,
        InventoryTransactionType::Refund,
        InventoryTransactionType::Transfer,
        InventoryTransactionType::PurchaseOrderReceive,
        InventoryTransactionType::StockCount,
        InventoryTransactionType::ManualAdjustment,
    ] {
        assert!(
            seen.insert(t.as_stored_str()),
            "duplicate stored str: {}",
            t.as_stored_str()
        );
    }
}

// ── InventoryTransaction with optional fields ─────────────────────────

#[test]
fn transaction_with_transfer_id() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-1"),
        transaction_type: InventoryTransactionType::Transfer,
        location_id: "loc-1".into(),
        staff_id: "user-1".into(),
        transfer_id: Some("transfer-42".into()),
        purchase_order_id: None,
        notes: "Transfer to warehouse".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    assert_eq!(tx.transfer_id.as_deref(), Some("transfer-42"));
    assert!(tx.purchase_order_id.is_none());
}

#[test]
fn transaction_with_purchase_order_id() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-2"),
        transaction_type: InventoryTransactionType::PurchaseOrderReceive,
        location_id: "loc-1".into(),
        staff_id: "user-1".into(),
        transfer_id: None,
        purchase_order_id: Some("po-99".into()),
        notes: "Received PO #99".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    assert!(tx.transfer_id.is_none());
    assert_eq!(tx.purchase_order_id.as_deref(), Some("po-99"));
}

#[test]
fn transaction_empty_notes() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-3"),
        transaction_type: InventoryTransactionType::Sale,
        location_id: "loc-1".into(),
        staff_id: "user-1".into(),
        transfer_id: None,
        purchase_order_id: None,
        notes: String::new(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    assert!(tx.notes.is_empty());
}

#[test]
fn transaction_serde_json_field_names() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-1"),
        transaction_type: InventoryTransactionType::Sale,
        location_id: "loc-1".into(),
        staff_id: "user-1".into(),
        transfer_id: None,
        purchase_order_id: None,
        notes: "test".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    let json = serde_json::to_value(&tx).unwrap();
    assert!(
        json.get("type").is_some(),
        "expected 'type' field (renamed)"
    );
    assert!(
        json.get("location_id").is_some(),
        "expected snake_case location_id"
    );
    assert!(
        json.get("staff_id").is_some(),
        "expected snake_case staff_id"
    );
    assert!(
        json.get("transfer_id").is_some(),
        "expected snake_case transfer_id"
    );
    assert!(
        json.get("purchase_order_id").is_some(),
        "expected snake_case purchase_order_id"
    );
}

// ── InventoryTransactionLine edge cases ───────────────────────────────

#[test]
fn line_no_barcode() {
    let line = InventoryTransactionLine {
        id: "line-2".into(),
        transaction_id: InventoryTransactionId::from("tx-1"),
        sku: "SKU".into(),
        product_name: "Product".into(),
        qty: 1,
        barcode_scanned: None,
        sort_order: 1,
    };
    assert!(line.barcode_scanned.is_none());
}

#[test]
fn line_qty_positive() {
    // Schema CHECK requires qty > 0.
    for qty in [1, 2, 100, i64::MAX] {
        let line = InventoryTransactionLine {
            id: "line-pos".into(),
            transaction_id: InventoryTransactionId::from("tx-1"),
            sku: "SKU".into(),
            product_name: "Product".into(),
            qty,
            barcode_scanned: None,
            sort_order: 1,
        };
        assert!(line.qty > 0, "qty should be > 0, got {qty}");
    }
}

#[test]
fn line_sort_order_1_indexed() {
    let line = InventoryTransactionLine {
        id: "line-so".into(),
        transaction_id: InventoryTransactionId::from("tx-1"),
        sku: "SKU".into(),
        product_name: "Product".into(),
        qty: 1,
        barcode_scanned: None,
        sort_order: 1,
    };
    assert_eq!(line.sort_order, 1);
}

#[test]
fn line_serde_json_field_names() {
    let line = InventoryTransactionLine {
        id: "line-1".into(),
        transaction_id: InventoryTransactionId::from("tx-1"),
        sku: "SKU".into(),
        product_name: "Product".into(),
        qty: 5,
        barcode_scanned: Some("12345".into()),
        sort_order: 3,
    };
    let json = serde_json::to_value(&line).unwrap();
    assert!(
        json.get("transaction_id").is_some(),
        "expected snake_case transaction_id"
    );
    assert!(
        json.get("product_name").is_some(),
        "expected snake_case product_name"
    );
    assert!(
        json.get("barcode_scanned").is_some(),
        "expected snake_case barcode_scanned"
    );
    assert!(
        json.get("sort_order").is_some(),
        "expected snake_case sort_order"
    );
}

// ── Debug output ──────────────────────────────────────────────────────

#[test]
fn transaction_debug() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-dbg"),
        transaction_type: InventoryTransactionType::Sale,
        location_id: "loc-dbg".into(),
        staff_id: "user-dbg".into(),
        transfer_id: None,
        purchase_order_id: None,
        notes: "debug test".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    let debug = format!("{tx:?}");
    assert!(debug.contains("tx-dbg"));
    assert!(debug.contains("Sale"));
}

#[test]
fn line_debug() {
    let line = InventoryTransactionLine {
        id: "line-dbg".into(),
        transaction_id: InventoryTransactionId::from("tx-1"),
        sku: "DBG-SKU".into(),
        product_name: "Debug Product".into(),
        qty: 3,
        barcode_scanned: None,
        sort_order: 1,
    };
    let debug = format!("{line:?}");
    assert!(debug.contains("line-dbg"));
    assert!(debug.contains("DBG-SKU"));
}

// ── Clone ─────────────────────────────────────────────────────────────

#[test]
fn transaction_clone() {
    let tx = InventoryTransaction {
        id: InventoryTransactionId::from("tx-clone"),
        transaction_type: InventoryTransactionType::Void,
        location_id: "loc-1".into(),
        staff_id: "user-1".into(),
        transfer_id: Some("t-1".into()),
        purchase_order_id: None,
        notes: "clone test".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
    };
    let cloned = tx.clone();
    assert_eq!(cloned, tx);
}

#[test]
fn line_clone() {
    let line = InventoryTransactionLine {
        id: "line-clone".into(),
        transaction_id: InventoryTransactionId::from("tx-1"),
        sku: "SKU".into(),
        product_name: "Product".into(),
        qty: 1,
        barcode_scanned: Some("123".into()),
        sort_order: 2,
    };
    let cloned = line.clone();
    assert_eq!(cloned, line);
}
