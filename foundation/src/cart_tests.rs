//! Unit tests for `Cart` / `CartLine` — sibling test file per AGENTS.md
//! (tests must never live inside production `.rs` files; COR-33).
//!
//! Wired from `cart.rs` via `#[cfg(test)] #[path = "cart_tests.rs"]
//! mod tests;.

use super::*;

fn usd() -> Currency {
    "USD".parse().unwrap()
}
fn eur() -> Currency {
    "EUR".parse().unwrap()
}

#[test]
fn empty_cart_has_zero_total() {
    let cart = Cart::new(usd());
    assert_eq!(cart.total().unwrap().minor_units, 0);
    assert_eq!(cart.line_count(), 0);
}

#[test]
fn add_line_appends_and_returns_id() {
    let mut cart = Cart::new(usd());
    let line = CartLine::new(
        Sku::new("COFFEE"),
        2,
        Money {
            minor_units: 350,
            currency: usd(),
        },
    );
    let id = cart.add_line(line).unwrap();
    assert_eq!(cart.line_count(), 1);
    assert_eq!(cart.lines()[0].id, id);
    assert_eq!(cart.total().unwrap().minor_units, 700);
}

#[test]
fn add_line_currency_mismatch_rejected() {
    let mut cart = Cart::new(usd());
    let bad = CartLine::new(
        Sku::new("TEA"),
        1,
        Money {
            minor_units: 200,
            currency: eur(),
        },
    );
    assert!(matches!(
        cart.add_line(bad),
        Err(CartError::CurrencyMismatch { .. })
    ));
}

#[test]
fn remove_sku_drops_matching_lines() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("B"),
        1,
        Money {
            minor_units: 200,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 150,
            currency: usd(),
        },
    ))
    .unwrap();
    let removed = cart.remove_sku("A").unwrap();
    assert_eq!(removed, 2);
    assert_eq!(cart.line_count(), 1);
}

#[test]
fn total_overflow_returns_none() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("BIG"),
        1,
        Money {
            minor_units: i64::MAX,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("PLUS"),
        1,
        Money {
            minor_units: 1,
            currency: usd(),
        },
    ))
    .unwrap();
    assert!(cart.total().is_none());
}

#[test]
fn cart_id_new_generates_unique_ids() {
    let a = CartId::new();
    let b = CartId::new();
    assert_ne!(a, b);
}

#[test]
fn cart_id_default() {
    let id = CartId::default();
    assert!(!format!("{id}").is_empty());
}

#[test]
fn cart_id_display() {
    let id = CartId::new();
    let display = format!("{id}");
    assert!(!display.is_empty());
    // UUID format: 8-4-4-4-12 hex chars
    assert_eq!(display.len(), 36);
}

#[test]
fn cart_id_serializes_as_uuid_string() {
    let id = CartId::new();
    let json = serde_json::to_string(&id).unwrap();
    // CartId is a newtype over Uuid — serializes as bare UUID string.
    assert!(
        json.starts_with('"'),
        "cart ID should serialize as a bare string, got: {json}"
    );
    let back: CartId = serde_json::from_str(&json).unwrap();
    assert_eq!(id, back);
}

#[test]
fn cart_currency_accessor() {
    let cart = Cart::new(usd());
    assert_eq!(cart.currency(), usd());
}

#[test]
fn cart_id_accessor() {
    let cart = Cart::new(usd());
    assert!(!format!("{}", cart.id()).is_empty());
}

#[test]
fn cart_default_discount() {
    let cart = Cart::new(usd());
    assert_eq!(cart.discount_percent(), 0);
    assert!(cart.discount_label().is_none());
}

#[test]
fn set_discount_valid_range() {
    let mut cart = Cart::new(usd());
    cart.set_discount(Percentage::new(10).unwrap(), Some("VIP 10% off".into()));
    assert_eq!(cart.discount_percent(), 10);
    assert_eq!(cart.discount_label(), Some("VIP 10% off"));
}

#[test]
fn set_discount_zero_clears_label() {
    let mut cart = Cart::new(usd());
    cart.set_discount(Percentage::new(10).unwrap(), Some("sale".into()));
    cart.set_discount(Percentage::zero(), None);
    assert_eq!(cart.discount_percent(), 0);
    assert!(cart.discount_label().is_none());
}

#[test]
fn discount_applied_to_total() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("ITEM"),
        2,
        Money {
            minor_units: 1000,
            currency: usd(),
        },
    ))
    .unwrap();
    // 2 x 1000 = 2000, with 10% discount = 1800
    cart.set_discount(Percentage::new(10).unwrap(), None);
    assert_eq!(cart.total().unwrap().minor_units, 1800);
}

#[test]
fn discount_amount_calculated_correctly() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("ITEM"),
        3,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    // 3 x 500 = 1500, with 10% discount = 150 discount
    cart.set_discount(Percentage::new(10).unwrap(), Some("10%".into()));
    assert_eq!(cart.discount_amount().unwrap().minor_units, 150);
}

#[test]
fn discount_amount_zero_when_no_discount() {
    let cart = Cart::new(usd());
    assert_eq!(cart.discount_amount().unwrap().minor_units, 0);
}

#[test]
fn fixed_discount_is_capped_and_survives_serialization() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("ITEM"),
        1,
        Money {
            minor_units: 1000,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_fixed_discount(1500, Some("Loyalty points".into()));
    assert_eq!(cart.total().unwrap().minor_units, 0);
    assert_eq!(cart.discount_amount().unwrap().minor_units, 1000);

    let json = serde_json::to_string(&cart).unwrap();
    let restored: Cart = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.fixed_discount_minor(), 1500);
    assert_eq!(restored.total().unwrap().minor_units, 0);
}

#[test]
fn discount_overflow_returns_none() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("BIG"),
        1,
        Money {
            minor_units: i64::MAX,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("HUGE"),
        1,
        Money {
            minor_units: i64::MAX,
            currency: usd(),
        },
    ))
    .unwrap();
    // Subtotal = i64::MAX + i64::MAX overflows → total and discount_amount
    // must be None. (A single line with 50% discount succeeds now — the
    // overflow-free Percentage decomposition computes i64::MAX * 50 / 100
    // = i64::MAX/2 without overflowing the intermediate product.)
    cart.set_discount(Percentage::new(50).unwrap(), None);
    assert!(cart.total().is_none());
    assert!(cart.discount_amount().is_none());
}

#[test]
fn remove_sku_not_found_returns_error() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    ))
    .unwrap();
    assert!(matches!(
        cart.remove_sku("Z"),
        Err(CartError::SkuNotInCart(..))
    ));
}

#[test]
fn cart_line_new_panics_on_zero_qty() {
    use std::panic::catch_unwind;
    let sku = Sku::new("TEST");
    let price = Money {
        minor_units: 100,
        currency: usd(),
    };
    let result = catch_unwind(|| CartLine::new(sku, 0, price));
    assert!(result.is_err());
}

#[test]
fn cart_line_new_panics_on_negative_qty() {
    use std::panic::catch_unwind;
    let sku = Sku::new("TEST");
    let price = Money {
        minor_units: 100,
        currency: usd(),
    };
    let result = catch_unwind(|| CartLine::new(sku, -1, price));
    assert!(result.is_err());
}

#[test]
fn cart_line_total_calculated() {
    let line = CartLine::new(
        Sku::new("TEA"),
        3,
        Money {
            minor_units: 150,
            currency: usd(),
        },
    );
    assert_eq!(line.total().unwrap().minor_units, 450);
}

#[test]
fn cart_line_total_overflow_returns_none() {
    let line = CartLine::new(
        Sku::new("BIG"),
        2,
        Money {
            minor_units: i64::MAX,
            currency: usd(),
        },
    );
    assert!(line.total().is_none());
}

/// MONEY-AUDIT-3: `CartLine::total()` must return `None` (fail closed)
/// when `qty <= 0` arrives via serde deserialization — `CartLine::new`
/// asserts `qty > 0`, but the public fields + `Deserialize` bypass the
/// constructor, so a corrupt persisted cart could otherwise silently
/// compute a zero or negative line total.
#[test]
fn cart_line_total_fails_closed_on_zero_or_negative_qty_from_serde() {
    // The JSON payloads below hard-code the unit price, so no local
    // `unit_price` binding is needed (the MONEY-AUDIT-3 invariant is
    // about qty, not price).
    // qty = 0 via JSON (would be free money without the guard).
    let json_zero = r#"{"id":"00000000-0000-0000-0000-000000000001","sku":"TEA","qty":0,"unit_price":{"minor_units":500,"currency":"USD"},"overridden_price":null}"#;
    let line: CartLine = serde_json::from_str(json_zero).unwrap();
    assert_eq!(line.qty, 0);
    assert!(line.total().is_none(), "qty=0 must fail closed");

    // qty = -2 via JSON (would be a negative total / money creation).
    let json_neg = r#"{"id":"00000000-0000-0000-0000-000000000002","sku":"TEA","qty":-2,"unit_price":{"minor_units":500,"currency":"USD"},"overridden_price":null}"#;
    let line: CartLine = serde_json::from_str(json_neg).unwrap();
    assert_eq!(line.qty, -2);
    assert!(line.total().is_none(), "qty<0 must fail closed");
}

/// MONEY-AUDIT-3b: `Cart::total()` propagates the fail-closed `None`
/// from a corrupted line (qty=0 via serde) instead of summing a free
/// item into the cart total.
#[test]
fn cart_total_fails_closed_when_serde_line_has_zero_qty() {
    let json = r#"{"id":"00000000-0000-0000-0000-000000000003","currency":"USD","lines":[{"id":"00000000-0000-0000-0000-000000000004","sku":"TEA","qty":0,"unit_price":{"minor_units":500,"currency":"USD"},"overridden_price":null}],"discount_percent":0,"discount_label":null,"fixed_discount_minor":0}"#;
    let cart: Cart = serde_json::from_str(json).unwrap();
    assert!(cart.total().is_none(), "corrupt line must fail closed");
    assert!(
        cart.discount_amount().is_none(),
        "corrupt line must fail closed in discount_amount too"
    );
}

#[test]
fn cart_error_display_currency_mismatch() {
    let err = CartError::CurrencyMismatch {
        cart: "USD".into(),
        line: "EUR".into(),
    };
    let msg = err.to_string();
    assert!(msg.contains("USD"), "msg should contain USD, got: {msg}");
    assert!(msg.contains("EUR"), "msg should contain EUR, got: {msg}");
}

#[test]
fn cart_error_display_sku_not_in_cart() {
    let err = CartError::SkuNotInCart("XYZ".into());
    assert_eq!(err.to_string(), "sku not in cart: XYZ");
}

#[test]
fn cart_error_debug() {
    let err = CartError::SkuNotInCart("TEST".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn cart_error_partial_eq() {
    assert_eq!(
        CartError::SkuNotInCart("A".into()),
        CartError::SkuNotInCart("A".into()),
    );
    assert_ne!(
        CartError::SkuNotInCart("A".into()),
        CartError::SkuNotInCart("B".into()),
    );
}

// ── CartLine overridden price ──

#[test]
fn cartline_overridden_price_none_by_default() {
    let line = CartLine::new(
        Sku::new("TEA"),
        2,
        Money {
            minor_units: 150,
            currency: usd(),
        },
    );
    assert!(line.overridden_price.is_none());
}

#[test]
fn cartline_set_overridden_price() {
    let mut line = CartLine::new(
        Sku::new("TEA"),
        2,
        Money {
            minor_units: 150,
            currency: usd(),
        },
    );
    line.set_overridden_price(Money {
        minor_units: 100,
        currency: usd(),
    })
    .unwrap();
    assert_eq!(line.overridden_price.unwrap().minor_units, 100);
}

#[test]
fn cartline_total_uses_overridden_price() {
    let mut line = CartLine::new(
        Sku::new("TEA"),
        3,
        Money {
            minor_units: 200,
            currency: usd(),
        },
    );
    // Without override: 3 x 200 = 600
    assert_eq!(line.total().unwrap().minor_units, 600);
    // With override: 3 x 150 = 450
    line.set_overridden_price(Money {
        minor_units: 150,
        currency: usd(),
    })
    .unwrap();
    assert_eq!(line.total().unwrap().minor_units, 450);
}

#[test]
fn cartline_clone_preserves_fields() {
    let mut line = CartLine::new(
        Sku::new("LATTE"),
        1,
        Money {
            minor_units: 450,
            currency: usd(),
        },
    );
    line.set_overridden_price(Money {
        minor_units: 400,
        currency: usd(),
    })
    .unwrap();
    let clone = line.clone();
    assert_eq!(clone.sku, line.sku);
    assert_eq!(clone.qty, line.qty);
    assert_eq!(clone.unit_price, line.unit_price);
    assert_eq!(clone.overridden_price, line.overridden_price);
}

#[test]
fn cartline_serialization_roundtrip() {
    let line = CartLine::new(
        Sku::new("MOCHA"),
        2,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    );
    let json = serde_json::to_string(&line).unwrap();
    let back: CartLine = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, line.sku);
    assert_eq!(back.qty, line.qty);
    assert_eq!(back.unit_price, line.unit_price);
}

#[test]
fn cartline_set_overridden_price_currency_mismatch_returns_error() {
    let mut line = CartLine::new(
        Sku::new("TEA"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    );
    let eur_price = Money {
        minor_units: 90,
        currency: eur(),
    };
    let result = line.set_overridden_price(eur_price);
    assert!(matches!(result, Err(CartError::CurrencyMismatch { .. })));
    // The original price should not have been overwritten
    assert!(line.overridden_price.is_none());
}
#[test]
fn cartline_total_debug_assert_currency_mismatch_on_direct_mutation() {
    // set_overridden_price now validates currency, but the fields are pub
    // so a caller could bypass it with direct mutation. The debug_assert!
    // in total() catches this in debug/test builds.
    let mut line = CartLine::new(
        Sku::new("TEA"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    );
    // Direct mutation bypasses set_overridden_price validation
    line.overridden_price = Some(Money {
        minor_units: 90,
        currency: eur(),
    });
    // debug_assert! should fire — verify with catch_unwind
    let result = std::panic::catch_unwind(|| {
        let _ = line.total();
    });
    assert!(
        result.is_err(),
        "debug_assert! should have panicked on currency mismatch from direct field mutation"
    );
}

#[test]
fn cart_total_debug_assert_on_line_currency_mismatch() {
    // Cart::total() checks every line's unit_price.currency matches the cart.
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("ITEM"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    ))
    .unwrap();
    // Direct mutation: change unit_price currency via pub field
    cart.lines_mut()[0].unit_price.currency = eur();
    let result = std::panic::catch_unwind(|| {
        let _ = cart.total();
    });
    assert!(
        result.is_err(),
        "debug_assert! should have panicked on line currency mismatch in Cart::total()"
    );
}

#[test]
fn cart_discount_amount_debug_assert_on_line_currency_mismatch() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("ITEM"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_discount(Percentage::new(10).unwrap(), None);
    // Direct mutation
    cart.lines_mut()[0].unit_price.currency = eur();
    let result = std::panic::catch_unwind(|| {
        let _ = cart.discount_amount();
    });
    assert!(
        result.is_err(),
        "debug_assert! should have panicked on line currency mismatch in Cart::discount_amount()"
    );
}

// ── Cart accessors & serialization ──

#[test]
fn cart_discount_percentage_accessor() {
    let mut cart = Cart::new(usd());
    cart.set_discount(Percentage::new(15).unwrap(), None);
    assert_eq!(cart.discount_percentage().get(), 15);
}

#[test]
fn cart_lines_and_lines_mut() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 100,
            currency: usd(),
        },
    ))
    .unwrap();
    assert_eq!(cart.lines().len(), 1);
    cart.lines_mut()[0]
        .set_overridden_price(Money {
            minor_units: 50,
            currency: usd(),
        })
        .unwrap();
    assert_eq!(cart.lines()[0].overridden_price.unwrap().minor_units, 50);
}

#[test]
fn cart_serialization_roundtrip() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        2,
        Money {
            minor_units: 300,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_discount(Percentage::new(10).unwrap(), Some("sale".into()));
    let json = serde_json::to_string(&cart).unwrap();
    let back: Cart = serde_json::from_str(&json).unwrap();
    assert_eq!(back.line_count(), 1);
    assert_eq!(back.currency(), usd());
    assert_eq!(back.discount_percent(), 10);
    assert_eq!(back.fixed_discount_minor(), 0);
    assert_eq!(back.discount_label(), Some("sale"));
}

// ── Additional Cart edge-case tests ──────────────────────────────────

#[test]
fn fixed_discount_capped_to_total() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    // Total is 500. Fixed discount of 1000 should be capped to 500.
    cart.set_fixed_discount(1000, Some("Over-cap".into()));
    assert_eq!(cart.fixed_discount_minor(), 1000);
    // ...but total() caps the effective discount to the available amount.
    assert_eq!(cart.total().unwrap().minor_units, 0);
}

#[test]
fn fixed_discount_exactly_equals_total() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_fixed_discount(500, Some("Exact".into()));
    assert_eq!(cart.total().unwrap().minor_units, 0);
}

#[test]
fn fixed_discount_less_than_total() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 1000,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_fixed_discount(300, Some("Partial".into()));
    assert_eq!(cart.total().unwrap().minor_units, 700);
}

#[test]
fn discount_amount_with_fixed_discount() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        2,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    // Total = 1000. Fixed discount = 250.
    cart.set_fixed_discount(250, Some("Coupon".into()));
    assert_eq!(cart.discount_amount().unwrap().minor_units, 250);
}

#[test]
fn discount_amount_with_percentage_discount() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 1000,
            currency: usd(),
        },
    ))
    .unwrap();
    // 15% of 1000 = 150
    cart.set_discount(Percentage::new(15).unwrap(), Some("VIP".into()));
    assert_eq!(cart.discount_amount().unwrap().minor_units, 150);
}

#[test]
fn cart_with_multiple_lines_total() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        2,
        Money {
            minor_units: 300,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("B"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    // 2*300 + 1*500 = 1100
    assert_eq!(cart.total().unwrap().minor_units, 1100);
    assert_eq!(cart.line_count(), 2);
}

#[test]
fn cart_total_with_all_lines_removed() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("A"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("B"),
        1,
        Money {
            minor_units: 300,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.remove_sku("A").unwrap();
    cart.remove_sku("B").unwrap();
    assert_eq!(cart.line_count(), 0);
    assert_eq!(cart.total().unwrap().minor_units, 0);
}

#[test]
fn set_fixed_discount_zero_clears_label() {
    let mut cart = Cart::new(usd());
    cart.set_fixed_discount(100, Some("Test".into()));
    assert!(cart.discount_label().is_some());
    cart.set_fixed_discount(0, None);
    assert!(cart.discount_label().is_none());
    assert_eq!(cart.fixed_discount_minor(), 0);
}

#[test]
fn set_fixed_discount_negative_treated_as_zero() {
    let mut cart = Cart::new(usd());
    cart.set_fixed_discount(-500, Some("Neg".into()));
    assert_eq!(cart.fixed_discount_minor(), 0);
    assert!(cart.discount_label().is_none());
}

#[test]
fn discount_percentage_accessor() {
    let mut cart = Cart::new(usd());
    assert_eq!(cart.discount_percentage().get(), 0);
    cart.set_discount(Percentage::new(25).unwrap(), None);
    assert_eq!(cart.discount_percentage().get(), 25);
}

#[test]
fn set_discount_clears_fixed_discount() {
    let mut cart = Cart::new(usd());
    cart.set_fixed_discount(500, Some("Fixed".into()));
    assert_eq!(cart.fixed_discount_minor(), 500);
    cart.set_discount(Percentage::new(10).unwrap(), None);
    assert_eq!(cart.fixed_discount_minor(), 0);
}

#[test]
fn cart_serialization_roundtrip_with_lines_and_discount() {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("SKU-1"),
        3,
        Money {
            minor_units: 250,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.set_discount(Percentage::new(5).unwrap(), Some("test".into()));
    let json = serde_json::to_string(&cart).unwrap();
    let back: Cart = serde_json::from_str(&json).unwrap();
    assert_eq!(back.line_count(), 1);
    // 3*250 = 750. 5% discount via complement_apply: 750 * 95 / 100 = 712
    assert_eq!(back.total().unwrap().minor_units, 712);
    assert_eq!(back.discount_percentage().get(), 5);
}

#[test]
fn normalize_course_maps_legacy_drinks_to_beverage() {
    assert_eq!(normalize_course(None), None);
    assert_eq!(normalize_course(Some("")), None);
    assert_eq!(normalize_course(Some("   ")), None);
    assert_eq!(
        normalize_course(Some("drinks")),
        Some("beverage".to_owned())
    );
    assert_eq!(normalize_course(Some("main")), Some("main".to_owned()));
}

#[test]
fn set_course_assigns_and_clears_with_normalization() {
    let mut line = CartLine::new(
        Sku::new("STEAK"),
        1,
        Money {
            minor_units: 1500,
            currency: usd(),
        },
    );
    assert_eq!(line.course, None);
    line.set_course(Some("main"));
    assert_eq!(line.course.as_deref(), Some("main"));
    line.set_course(Some("drinks"));
    assert_eq!(line.course.as_deref(), Some("beverage"));
    line.set_course(Some(""));
    assert_eq!(line.course, None);
    line.set_course(None);
    assert_eq!(line.course, None);
}

#[test]
fn cart_line_deserializes_without_course_for_legacy_carts() {
    // Carts persisted before the course field existed must still load:
    // `course` is #[serde(default)] and reads as None.
    let line: CartLine = serde_json::from_str(
        r#"{"id":"11111111-1111-1111-1111-111111111111","sku":"COFFEE","qty":2,"unit_price":{"minor_units":350,"currency":"USD"},"overridden_price":null}"#,
    )
    .unwrap();
    assert_eq!(line.course, None);
    assert_eq!(line.sku.as_str(), "COFFEE");
}
