use super::*;

fn sample_promotion() -> Promotion {
    Promotion {
        id: "promo-1".into(),
        name: "10% Off".into(),
        description: "Get 10% off everything".into(),
        promo_type: "percentage".into(),
        value_minor: 10,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

// ── PromotionType ────────────────────────────────────────────

#[test]
fn promotion_type_roundtrip() {
    for (s, expected) in [
        ("percentage", PromotionType::Percentage),
        ("fixed_amount", PromotionType::FixedAmount),
        ("buy_x_get_y", PromotionType::BuyXGetY),
    ] {
        assert_eq!(PromotionType::from_str(s), Some(expected));
        assert_eq!(expected.as_str(), s);
    }
}

#[test]
fn promotion_type_from_str_unknown() {
    assert_eq!(PromotionType::from_str("unknown"), None);
}

#[test]
fn promotion_type_from_str_case_sensitive() {
    assert_eq!(PromotionType::from_str("PERCENTAGE"), None);
    assert_eq!(PromotionType::from_str("Percentage"), None);
}

#[test]
fn promotion_type_debug() {
    assert!(format!("{:?}", PromotionType::Percentage).contains("Percentage"));
    assert!(format!("{:?}", PromotionType::FixedAmount).contains("FixedAmount"));
    assert!(format!("{:?}", PromotionType::BuyXGetY).contains("BuyXGetY"));
}

#[test]
fn promotion_type_serde_json_format() {
    // No #[serde(rename_all)] — uses PascalCase variant names.
    let json = serde_json::to_value(PromotionType::Percentage).unwrap();
    assert_eq!(json, "Percentage");
    let json = serde_json::to_value(PromotionType::FixedAmount).unwrap();
    assert_eq!(json, "FixedAmount");
    let json = serde_json::to_value(PromotionType::BuyXGetY).unwrap();
    assert_eq!(json, "BuyXGetY");
}

#[test]
fn promotion_type_serde_roundtrip_all() {
    for variant in [
        PromotionType::Percentage,
        PromotionType::FixedAmount,
        PromotionType::BuyXGetY,
    ] {
        let json = serde_json::to_string(&variant).unwrap();
        let back: PromotionType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn serde_roundtrip() {
    let p = sample_promotion();
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

#[test]
fn serde_roundtrip_all_fields() {
    let p = Promotion {
        id: "promo-bogo".into(),
        name: "Buy 1 Get 1 50% Off".into(),
        description: "Buy one coffee, get the second at half price".into(),
        promo_type: "buy_x_get_y".into(),
        value_minor: 50,
        min_qty: Some(2),
        trigger_sku: Some("COFFEE".into()),
        reward_sku: Some("COFFEE".into()),
        reward_qty: Some(1),
        starts_at: Some("2026-01-01T00:00:00.000Z".into()),
        ends_at: Some("2026-12-31T23:59:59.000Z".into()),
        min_order_minor: 500,
        category_id: Some("cat-drinks".into()),
        active: true,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-15T12:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, "Buy 1 Get 1 50% Off");
    assert_eq!(back.promo_type, "buy_x_get_y");
    assert_eq!(back.min_qty, Some(2));
    assert_eq!(back.trigger_sku, Some("COFFEE".into()));
    assert_eq!(back.reward_sku, Some("COFFEE".into()));
    assert_eq!(back.reward_qty, Some(1));
    assert_eq!(back.min_order_minor, 500);
    assert_eq!(back.category_id, Some("cat-drinks".into()));
}

#[test]
fn serde_json_field_names() {
    let p = sample_promotion();
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["promo_type"], "percentage");
    assert!(json.get("min_qty").unwrap().is_null());
    assert!(json.get("trigger_sku").unwrap().is_null());
    assert_eq!(json["active"], true);
}

// ── Active/inactive ──────────────────────────────────────────

#[test]
fn promotion_can_be_inactive() {
    let p = Promotion {
        active: false,
        ..sample_promotion()
    };
    assert!(!p.active);
}

#[test]
fn serde_roundtrip_inactive() {
    let p = Promotion {
        active: false,
        ..sample_promotion()
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert!(!back.active);
}

// ── Time-range fields ────────────────────────────────────────

#[test]
fn promotion_with_time_range() {
    let p = Promotion {
        starts_at: Some("2026-06-01T00:00:00.000Z".into()),
        ends_at: Some("2026-06-30T23:59:59.000Z".into()),
        ..sample_promotion()
    };
    assert_eq!(p.starts_at.as_deref(), Some("2026-06-01T00:00:00.000Z"));
    assert_eq!(p.ends_at.as_deref(), Some("2026-06-30T23:59:59.000Z"));
}

#[test]
fn promotion_without_end_date() {
    let p = Promotion {
        starts_at: Some("2026-06-01T00:00:00.000Z".into()),
        ends_at: None,
        ..sample_promotion()
    };
    assert!(p.starts_at.is_some());
    assert!(p.ends_at.is_none());
}

// ── Min order ────────────────────────────────────────────────

#[test]
fn promotion_with_min_order() {
    let p = Promotion {
        min_order_minor: 10000,
        ..sample_promotion()
    };
    assert_eq!(p.min_order_minor, 10000);
}

#[test]
fn promotion_min_order_defaults_to_zero() {
    let p = Promotion {
        min_order_minor: 0,
        ..sample_promotion()
    };
    assert_eq!(p.min_order_minor, 0);
}

#[test]
fn promotion_min_order_large_value() {
    let p = Promotion {
        min_order_minor: i64::MAX,
        ..sample_promotion()
    };
    assert_eq!(p.min_order_minor, i64::MAX);
}

// ── Category-specific ────────────────────────────────────────

#[test]
fn promotion_category_specific() {
    let p = Promotion {
        category_id: Some("cat-drinks".into()),
        ..sample_promotion()
    };
    assert_eq!(p.category_id.as_deref(), Some("cat-drinks"));
}

#[test]
fn promotion_no_category_applies_to_all() {
    let p = Promotion {
        category_id: None,
        ..sample_promotion()
    };
    assert!(p.category_id.is_none());
}

// ── Value fields ─────────────────────────────────────────────

#[test]
fn promotion_value_zero() {
    let p = Promotion {
        value_minor: 0,
        ..sample_promotion()
    };
    assert_eq!(p.value_minor, 0);
}

#[test]
fn promotion_value_large() {
    let p = Promotion {
        value_minor: 100_000,
        ..sample_promotion()
    };
    assert_eq!(p.value_minor, 100_000);
}

// ── Clone + equality ─────────────────────────────────────────

#[test]
fn promotion_clone_eq() {
    let a = sample_promotion();
    let b = a.clone();
    assert_eq!(a, b);
}

#[test]
fn promotion_neq_when_field_differs() {
    let a = sample_promotion();
    let b = Promotion {
        value_minor: 20,
        ..sample_promotion()
    };
    assert_ne!(a, b);
}

// ── PromotionApplication ─────────────────────────────────────

#[test]
fn application_serde() {
    let a = PromotionApplication {
        id: "app-1".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 150,
        description: "10% off".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&a).unwrap();
    let back: PromotionApplication = serde_json::from_str(&json).unwrap();
    assert_eq!(back.discount_minor, 150);
}

#[test]
fn application_serde_large_discount() {
    let a = PromotionApplication {
        id: "app-2".into(),
        promotion_id: "promo-2".into(),
        sale_id: "sale-2".into(),
        discount_minor: 999_999_999,
        description: "big savings".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&a).unwrap();
    let back: PromotionApplication = serde_json::from_str(&json).unwrap();
    assert_eq!(back.discount_minor, 999_999_999);
}

#[test]
fn application_serde_zero_discount() {
    let a = PromotionApplication {
        id: "app-3".into(),
        promotion_id: "promo-3".into(),
        sale_id: "sale-3".into(),
        discount_minor: 0,
        description: String::new(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&a).unwrap();
    let back: PromotionApplication = serde_json::from_str(&json).unwrap();
    assert_eq!(back.discount_minor, 0);
    assert!(back.description.is_empty());
}

#[test]
fn application_clone_eq() {
    let a = PromotionApplication {
        id: "app-1".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 150,
        description: "10% off".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let b = a.clone();
    assert_eq!(a, b);
}

#[test]
fn application_json_field_names() {
    let a = PromotionApplication {
        id: "app-1".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 150,
        description: "10% off".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(&a).unwrap();
    assert_eq!(json["promotion_id"], "promo-1");
    assert_eq!(json["discount_minor"], 150);
}

// ── Debug output ────────────────────────────────────────────

#[test]
fn promotion_debug_output() {
    let p = sample_promotion();
    let debug = format!("{p:?}");
    assert!(debug.contains("10% Off"));
    assert!(debug.contains("percentage"));
}

#[test]
fn promotion_application_debug_output() {
    let a = PromotionApplication {
        id: "app-1".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 150,
        description: "10% off".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let debug = format!("{a:?}");
    assert!(debug.contains("app-1"));
    assert!(debug.contains("promo-1"));
}

#[test]
fn promotion_neq_when_active_differs() {
    let a = sample_promotion();
    let b = Promotion {
        active: false,
        ..sample_promotion()
    };
    assert_ne!(a, b);
}

#[test]
fn promotion_neq_when_name_differs() {
    let a = sample_promotion();
    let b = Promotion {
        name: "Different".into(),
        ..sample_promotion()
    };
    assert_ne!(a, b);
}

// ── NEW TESTS: gaps identified in TDD analysis ───────────────────────

// ── promo_type String vs PromotionType enum sync ─────────────────────

#[test]
fn promo_type_string_matches_promotion_type_as_str() {
    // The struct stores promo_type as a raw String. Every valid value
    // must be parseable by PromotionType::from_str().
    for (promo_type_str, expected) in [
        ("percentage", PromotionType::Percentage),
        ("fixed_amount", PromotionType::FixedAmount),
        ("buy_x_get_y", PromotionType::BuyXGetY),
    ] {
        let p = Promotion {
            promo_type: promo_type_str.into(),
            ..sample_promotion()
        };
        let parsed =
            PromotionType::from_str(&p.promo_type).expect("promo_type should be parseable");
        assert_eq!(parsed, expected);
        assert_eq!(parsed.as_str(), promo_type_str);
    }
}

#[test]
fn promo_type_invalid_string_returns_none() {
    let result = PromotionType::from_str("invalid_type");
    assert_eq!(result, None);
}

#[test]
fn promo_type_empty_string_returns_none() {
    let result = PromotionType::from_str("");
    assert_eq!(result, None);
}

// ── PromotionType Copy trait ──────────────────────────────────────────

#[test]
fn promotion_type_is_copy() {
    let a = PromotionType::Percentage;
    let b = a; // Copy, not move
    assert_eq!(a, b); // Both still valid
}

#[test]
fn promotion_type_copy_semantics() {
    let original = PromotionType::BuyXGetY;
    let copied = original;
    // Both should be equal and independent
    assert_eq!(original, copied);
    assert_eq!(original.as_str(), "buy_x_get_y");
    assert_eq!(copied.as_str(), "buy_x_get_y");
}

// ── Negative value_minor ─────────────────────────────────────────────

#[test]
fn promotion_negative_value_minor_allowed() {
    // Negative value_minor could represent a surcharge or fee.
    // The struct doesn't validate — it's the caller's responsibility.
    let p = Promotion {
        value_minor: -500,
        ..sample_promotion()
    };
    assert_eq!(p.value_minor, -500);
}

#[test]
fn promotion_negative_value_minor_serde_roundtrip() {
    let p = Promotion {
        value_minor: -100,
        ..sample_promotion()
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert_eq!(back.value_minor, -100);
}

// ── All Optional fields as None ───────────────────────────────────────

#[test]
fn promotion_all_optional_fields_none() {
    let p = Promotion {
        id: "promo-none".into(),
        name: "No Optionals".into(),
        description: String::new(),
        promo_type: "percentage".into(),
        value_minor: 10,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    assert!(p.min_qty.is_none());
    assert!(p.trigger_sku.is_none());
    assert!(p.reward_sku.is_none());
    assert!(p.reward_qty.is_none());
    assert!(p.starts_at.is_none());
    assert!(p.ends_at.is_none());
    assert!(p.category_id.is_none());
}

#[test]
fn promotion_all_optional_fields_none_serde() {
    let p = Promotion {
        id: "promo-none".into(),
        name: "No Optionals".into(),
        description: String::new(),
        promo_type: "percentage".into(),
        value_minor: 10,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert_eq!(back, p);
}

// ── PromotionApplication description with content ─────────────────────

#[test]
fn application_description_with_content() {
    let a = PromotionApplication {
        id: "app-desc".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 500,
        description: "Buy 2 Get 1 Free — coffee loyalty reward".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&a).unwrap();
    let back: PromotionApplication = serde_json::from_str(&json).unwrap();
    assert_eq!(back.description, "Buy 2 Get 1 Free — coffee loyalty reward");
}

// ── PromotionType serde from JSON string ──────────────────────────────

#[test]
fn promotion_type_serde_from_json_string() {
    // The enum serializes as PascalCase ("Percentage"), not snake_case.
    // This is different from the struct's promo_type field which uses snake_case.
    let json = "\"Percentage\"";
    let t: PromotionType = serde_json::from_str(json).unwrap();
    assert_eq!(t, PromotionType::Percentage);
}

#[test]
fn promotion_type_serde_roundtrip_all_variants() {
    for variant in [
        PromotionType::Percentage,
        PromotionType::FixedAmount,
        PromotionType::BuyXGetY,
    ] {
        let json = serde_json::to_string(&variant).unwrap();
        let back: PromotionType = serde_json::from_str(&json).unwrap();
        assert_eq!(back, variant);
    }
}

// ── BuyXGetY specific fields ──────────────────────────────────────────

#[test]
fn buy_x_get_y_all_fields_populated() {
    let p = Promotion {
        id: "promo-bogo".into(),
        name: "Buy 2 Get 1 Free".into(),
        description: "Buy two coffees, get one free".into(),
        promo_type: "buy_x_get_y".into(),
        value_minor: 100, // 100% discount on reward
        min_qty: Some(2),
        trigger_sku: Some("COFFEE".into()),
        reward_sku: Some("COFFEE".into()),
        reward_qty: Some(1),
        starts_at: Some("2026-01-01T00:00:00.000Z".into()),
        ends_at: Some("2026-12-31T23:59:59.000Z".into()),
        min_order_minor: 0,
        category_id: Some("cat-drinks".into()),
        active: true,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-15T12:00:00.000Z".into(),
    };
    assert_eq!(p.min_qty, Some(2));
    assert_eq!(p.trigger_sku.as_deref(), Some("COFFEE"));
    assert_eq!(p.reward_sku.as_deref(), Some("COFFEE"));
    assert_eq!(p.reward_qty, Some(1));
    assert_eq!(p.value_minor, 100);
}

#[test]
fn buy_x_get_y_different_trigger_and_reward_sku() {
    let p = Promotion {
        promo_type: "buy_x_get_y".into(),
        trigger_sku: Some("PIZZA".into()),
        reward_sku: Some("SODA".into()),
        min_qty: Some(1),
        reward_qty: Some(1),
        value_minor: 100, // free soda
        ..sample_promotion()
    };
    assert_eq!(p.trigger_sku.as_deref(), Some("PIZZA"));
    assert_eq!(p.reward_sku.as_deref(), Some("SODA"));
    assert_ne!(p.trigger_sku, p.reward_sku);
}

// ── Edge cases ────────────────────────────────────────────────────────

#[test]
fn promotion_empty_name() {
    let p = Promotion {
        name: String::new(),
        ..sample_promotion()
    };
    assert!(p.name.is_empty());
}

#[test]
fn promotion_empty_description() {
    let p = Promotion {
        description: String::new(),
        ..sample_promotion()
    };
    assert!(p.description.is_empty());
}

#[test]
fn promotion_empty_promo_type() {
    let p = Promotion {
        promo_type: String::new(),
        ..sample_promotion()
    };
    assert!(p.promo_type.is_empty());
    // from_str on empty string should return None
    assert_eq!(PromotionType::from_str(&p.promo_type), None);
}

#[test]
fn promotion_large_id() {
    let long_id = "a".repeat(1000);
    let p = Promotion {
        id: long_id.clone(),
        ..sample_promotion()
    };
    assert_eq!(p.id.len(), 1000);
}

#[test]
fn promotion_unicode_name() {
    let p = Promotion {
        name: " Diskon 10% untuk Kopi ".into(),
        ..sample_promotion()
    };
    let json = serde_json::to_string(&p).unwrap();
    let back: Promotion = serde_json::from_str(&json).unwrap();
    assert_eq!(back.name, " Diskon 10% untuk Kopi ");
}

#[test]
fn promotion_application_negative_discount() {
    // Negative discount could represent a surcharge or fee adjustment.
    let a = PromotionApplication {
        id: "app-neg".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: -100,
        description: "surcharge".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&a).unwrap();
    let back: PromotionApplication = serde_json::from_str(&json).unwrap();
    assert_eq!(back.discount_minor, -100);
}
