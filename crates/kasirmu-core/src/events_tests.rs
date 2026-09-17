use super::*;

#[test]
fn sale_completed_event_name() {
    let event = SaleCompleted {
        sale_id: "sale-1".into(),
        store_id: None,
        line_items: vec![SaleCompletedLine {
            sku: "COFFEE".into(),
            qty: 2,
            unit_price_minor: 350,
            tax_minor: 0,
            tax_rate_id: None,
        }],
        total_minor: 700,
        currency: "USD".into(),
        customer_id: None,
    };
    assert_eq!(event.event_name(), "sale.completed");
}

#[test]
fn sale_completed_is_send_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<SaleCompleted>();
    assert_sync::<SaleCompleted>();
    assert_send::<SaleCompletedLine>();
    assert_sync::<SaleCompletedLine>();
}

#[test]
fn product_created_event_name() {
    let event = ProductCreated {
        sku: "PROD-1".into(),
        name: "Widget".into(),
        price_minor: 199,
        currency: "USD".into(),
        category_id: None,
        barcode: None,
        initial_stock: 10,
    };
    assert_eq!(event.event_name(), "product.created");
}

#[test]
fn product_created_is_send_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<ProductCreated>();
    assert_sync::<ProductCreated>();
}

#[test]
fn stock_adjusted_event_name() {
    let event = StockAdjusted {
        sku: "COFFEE".into(),
        delta: -3,
        new_qty: 47,
        reason: "sale".into(),
    };
    assert_eq!(event.event_name(), "stock.adjusted");
}

#[test]
fn stock_adjusted_is_send_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<StockAdjusted>();
    assert_sync::<StockAdjusted>();
}

// ── CourseFired ──────────────────────────────────────────────

#[test]
fn course_fired_event_name() {
    let event = CourseFired {
        sale_id: "sale-1".into(),
        store_id: None,
        course_id: "main".into(),
        display_number: Some(42),
        items: vec![CourseItem {
            sku: "STEAK".into(),
            qty: 2,
            name: "Grilled Steak".into(),
        }],
    };
    assert_eq!(event.event_name(), "order.course_fired");
}

#[test]
fn course_fired_is_send_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<CourseFired>();
    assert_sync::<CourseFired>();
    assert_send::<CourseItem>();
    assert_sync::<CourseItem>();
}

#[test]
fn course_fired_serde_roundtrip() {
    let event = CourseFired {
        sale_id: "sale-42".into(),
        store_id: None,
        course_id: "appetizer".into(),
        display_number: Some(101),
        items: vec![
            CourseItem {
                sku: "SPRING".into(),
                qty: 1,
                name: "Spring Rolls".into(),
            },
            CourseItem {
                sku: "SOUP".into(),
                qty: 2,
                name: "Tom Yum Soup".into(),
            },
        ],
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("sale-42"));
    assert!(json.contains("appetizer"));
    assert!(json.contains("101"));
    assert!(json.contains("SPRING"));
    assert!(json.contains("SOUP"));
}

#[test]
fn course_fired_no_display_number() {
    let event = CourseFired {
        sale_id: "sale-3".into(),
        store_id: None,
        course_id: "drinks".into(),
        display_number: None,
        items: vec![CourseItem {
            sku: "SODA".into(),
            qty: 1,
            name: "Cola".into(),
        }],
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("null"));
}

// ── SettingsUpdated (ADR #22 Phase 0e) ───────────────────────

#[test]
fn settings_updated_event_name() {
    let event = SettingsUpdated {
        changed_keys: vec!["receipt.footer".into()],
        terminal_id: "term-1".into(),
    };
    assert_eq!(event.event_name(), "settings.updated");
}

#[test]
fn settings_updated_is_send_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<SettingsUpdated>();
    assert_sync::<SettingsUpdated>();
}

#[test]
fn settings_updated_serde_roundtrip() {
    let event = SettingsUpdated {
        changed_keys: vec!["store.name".into(), "receipt.footer".into()],
        terminal_id: "term-a".into(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("store.name"));
    assert!(json.contains("receipt.footer"));
    assert!(json.contains("term-a"));
}

/// Empty `changed_keys` vec is valid — settings could be updated
/// by a bulk operation that affects no keys.
#[test]
fn settings_updated_empty_changed_keys_serializes() {
    let event = SettingsUpdated {
        changed_keys: vec![],
        terminal_id: "term-a".into(),
    };
    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"changed_keys\":[]"));
    let back: SettingsUpdated = serde_json::from_str(&json).unwrap();
    assert!(back.changed_keys.is_empty());
    assert_eq!(back.terminal_id, "term-a");
}

/// Special characters in terminal_id and changed_keys should
/// survive JSON round-trip (Unicode, quotes, backslashes).
#[test]
fn settings_updated_special_characters_roundtrip() {
    let event = SettingsUpdated {
        changed_keys: vec!["caf\u{00e9}.key".into(), "key with \"quotes\"".into()],
        terminal_id: "term-\u{2603}".into(),
    };
    let json = serde_json::to_string(&event).unwrap();
    let back: SettingsUpdated = serde_json::from_str(&json).unwrap();
    assert_eq!(back.changed_keys.len(), 2);
    assert_eq!(back.changed_keys[0], "caf\u{00e9}.key");
    assert_eq!(back.changed_keys[1], "key with \"quotes\"");
    assert_eq!(back.terminal_id, "term-\u{2603}");
}

/// Large number of changed_keys should serialize and deserialize
/// without truncation or corruption.
#[test]
fn settings_updated_large_changed_keys_vec() {
    let keys: Vec<String> = (0..500).map(|i| format!("key.{i:04}")).collect();
    let event = SettingsUpdated {
        changed_keys: keys.clone(),
        terminal_id: "bulk-sync".into(),
    };
    let json = serde_json::to_string(&event).unwrap();
    let back: SettingsUpdated = serde_json::from_str(&json).unwrap();
    assert_eq!(back.changed_keys.len(), 500);
    assert_eq!(back.changed_keys[0], "key.0000");
    assert_eq!(back.changed_keys[499], "key.0499");
    assert_eq!(back.terminal_id, "bulk-sync");
}

/// Deserializing malformed JSON for SettingsUpdated should fail
/// gracefully — no panics.
#[test]
fn settings_updated_rejects_invalid_json() {
    assert!(serde_json::from_str::<SettingsUpdated>("{}").is_err());
    assert!(serde_json::from_str::<SettingsUpdated>("\"not an object\"").is_err());
    assert!(
        serde_json::from_str::<SettingsUpdated>("{\"changed_keys\":[1,2,3],\"terminal_id\":\"t\"}")
            .is_err()
    );
}
