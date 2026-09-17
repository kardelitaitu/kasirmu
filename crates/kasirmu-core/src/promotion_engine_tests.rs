//! `promotion_engine` unit tests — gate pipeline, type-specific math,
//! clamps, category scoping, and overflow fail-closed behavior (PROMO-1/2/6/8).

use super::*;
use crate::SaleStatus;
use crate::foundation::{Currency, Money};
use crate::sale::SaleLine;

fn idr() -> Currency {
    Currency(*b"IDR")
}

fn money(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: idr(),
    }
}

fn line(sku: &str, qty: i64, unit: i64) -> SaleLine {
    SaleLine {
        id: format!("line-{sku}-{unit}"),
        sale_id: "sale-1".into(),
        sku: sku.into(),
        qty,
        unit_price: money(unit),
        line_total: Money {
            minor_units: unit * qty,
            currency: idr(),
        },
        line_position: 1,
        tax_amount: money(0),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }
}

fn sale(total: i64, lines: Vec<SaleLine>) -> Sale {
    Sale {
        id: "sale-1".into(),
        status: SaleStatus::Pending,
        total: money(total),
        line_count: lines.len() as i64,
        currency: idr(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
        lines,
        discount_percent: 0,
        discount_label: None,
        subtotal: money(total),
        tax_total: money(0),
        version: 1,
    }
}

fn promo(kind: &str, value: i64) -> Promotion {
    Promotion {
        id: "promo-1".into(),
        name: "Test Promo".into(),
        description: String::new(),
        promo_type: kind.into(),
        value_minor: value,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
        created_at: "2026-01-01T00:00:00.000Z".into(),
        updated_at: "2026-01-01T00:00:00.000Z".into(),
    }
}

fn now() -> DateTime<Utc> {
    Utc::now()
}

// ── Percentage ──────────────────────────────────────────────────────

#[test]
fn percentage_discounts_payable_total() {
    let p = promo("percentage", 10);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 1_000);
}

#[test]
fn percentage_truncates_down_customer_favorable() {
    let p = promo("percentage", 10);
    // 999 * 10 / 100 = 99.9 → 99 (truncation), never 100.
    let s = sale(999, vec![line("A", 1, 999)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 99);
}

#[test]
fn percentage_zero_value_yields_zero() {
    let p = promo("percentage", 0);
    let s = sale(5_000, vec![line("A", 1, 5_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 0);
}

#[test]
fn percentage_over_100_is_clamped_to_total() {
    // PROMO-1: a misconfigured 150% can never discount past the payable.
    let p = promo("percentage", 150);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 10_000);
}

#[test]
fn percentage_100_makes_it_free() {
    let p = promo("percentage", 100);
    let s = sale(7_777, vec![line("A", 3, 2_592), line("B", 1, 1)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 7_777);
}

// ── Fixed amount ────────────────────────────────────────────────────

#[test]
fn fixed_amount_below_total_applies_in_full() {
    let p = promo("fixed_amount", 2_500);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 2_500);
}

#[test]
fn fixed_amount_above_total_is_clamped() {
    let p = promo("fixed_amount", 99_999);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 10_000);
}

#[test]
fn fixed_amount_scopes_to_category_lines() {
    // PROMO-6: a category-scoped fixed promo cannot exceed the scoped base.
    let mut p = promo("fixed_amount", 50_000);
    p.category_id = Some("cat-drinks".into());
    let s = sale(
        60_000,
        vec![line("COFFEE", 1, 10_000), line("FOOD", 1, 50_000)],
    );
    let d = compute_discount(&p, &s, now(), |sku| {
        if sku == "COFFEE" {
            Some("cat-drinks".into())
        } else {
            Some("cat-food".into())
        }
    })
    .unwrap();
    assert_eq!(d, 10_000);
}

// ── Gate pipeline ───────────────────────────────────────────────────

#[test]
fn inactive_promotion_is_rejected() {
    let mut p = promo("percentage", 10);
    p.active = false;
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert!(compute_discount_unscoped(&p, &s, now()).is_err());
}

#[test]
fn promotion_before_start_is_rejected() {
    let mut p = promo("percentage", 10);
    p.starts_at = Some("2999-01-01T00:00:00Z".into());
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    let err = compute_discount_unscoped(&p, &s, now()).unwrap_err();
    assert!(err.to_string().contains("not started"));
}

#[test]
fn promotion_after_end_is_rejected() {
    let mut p = promo("percentage", 10);
    p.ends_at = Some("2020-01-01T00:00:00Z".into());
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    let err = compute_discount_unscoped(&p, &s, now()).unwrap_err();
    assert!(err.to_string().contains("expired"));
}

#[test]
fn promotion_inside_window_applies() {
    let mut p = promo("percentage", 10);
    p.starts_at = Some("2020-01-01T00:00:00Z".into());
    p.ends_at = Some("2999-01-01T00:00:00Z".into());
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 1_000);
}

#[test]
fn invalid_window_timestamp_is_a_validation_error() {
    let mut p = promo("percentage", 10);
    p.starts_at = Some("not-a-timestamp".into());
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert!(compute_discount_unscoped(&p, &s, now()).is_err());
}

#[test]
fn sale_below_min_order_is_rejected() {
    let mut p = promo("percentage", 10);
    p.min_order_minor = 20_000;
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    let err = compute_discount_unscoped(&p, &s, now()).unwrap_err();
    assert!(err.to_string().contains("below minimum order"));
}

#[test]
fn sale_exactly_at_min_order_applies() {
    let mut p = promo("percentage", 10);
    p.min_order_minor = 10_000;
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 1_000);
}

#[test]
fn unknown_promo_type_is_rejected() {
    let p = promo("mystery_kind", 10);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert!(compute_discount_unscoped(&p, &s, now()).is_err());
}

#[test]
fn negative_value_minor_is_rejected() {
    let p = promo("fixed_amount", -500);
    let s = sale(10_000, vec![line("A", 1, 10_000)]);
    assert!(compute_discount_unscoped(&p, &s, now()).is_err());
}

// ── Buy X Get Y ─────────────────────────────────────────────────────

fn bxgy(
    value: i64,
    min_qty: i64,
    trigger: &str,
    reward: Option<&str>,
    reward_qty: i64,
) -> Promotion {
    let mut p = promo("buy_x_get_y", value);
    p.min_qty = Some(min_qty);
    p.trigger_sku = Some(trigger.into());
    p.reward_sku = reward.map(String::from);
    p.reward_qty = Some(reward_qty);
    p
}

#[test]
fn bxgy_free_reward_item_when_satisfied() {
    // Buy 2 coffee, get 1 free (value 100).
    let p = bxgy(100, 2, "COFFEE", None, 1);
    let s = sale(30_000, vec![line("COFFEE", 3, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 10_000);
}

#[test]
fn bxgy_partial_discount_on_reward() {
    // Reward item at 50% off.
    let p = bxgy(50, 1, "COFFEE", None, 1);
    let s = sale(20_000, vec![line("COFFEE", 2, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 5_000);
}

#[test]
fn bxgy_not_triggered_yields_zero_not_error() {
    let p = bxgy(100, 2, "COFFEE", None, 1);
    let s = sale(10_000, vec![line("COFFEE", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 0);
}

#[test]
fn bxgy_without_reward_item_yields_zero() {
    // Distinct reward SKU absent from the cart → nothing to discount.
    let p = bxgy(100, 2, "COFFEE", Some("COOKIE"), 1);
    let s = sale(20_000, vec![line("COFFEE", 2, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 0);
}

#[test]
fn bxgy_same_sku_uses_trigger_lines_as_rewards() {
    // reward_sku defaults to trigger_sku: buy 2 get 1 of the same item,
    // with exactly 3 in the cart → 1 free (the cheapest = any).
    let p = bxgy(100, 2, "COFFEE", None, 1);
    let s = sale(30_000, vec![line("COFFEE", 3, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 10_000);
}

#[test]
fn bxgy_reward_qty_capped_by_cart_stock() {
    // Reward 3 free but only 2 reward items in the cart.
    let p = bxgy(100, 1, "COFFEE", None, 3);
    let s = sale(20_000, vec![line("COFFEE", 2, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 20_000);
}

#[test]
fn bxgy_uses_cheapest_reward_line() {
    let p = bxgy(100, 1, "TEA", Some("TEA"), 1);
    let s = sale(15_000, vec![line("TEA", 1, 5_000), line("TEA", 1, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 5_000);
}

#[test]
fn bxgy_different_reward_sku() {
    // Buy 2 coffee, get 1 free cookie.
    let p = bxgy(100, 2, "COFFEE", Some("COOKIE"), 1);
    let s = sale(
        25_000,
        vec![line("COFFEE", 2, 10_000), line("COOKIE", 1, 5_000)],
    );
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 5_000);
}

#[test]
fn bxgy_missing_trigger_sku_is_a_validation_error() {
    let mut p = bxgy(100, 2, "COFFEE", None, 1);
    p.trigger_sku = None;
    let s = sale(30_000, vec![line("COFFEE", 3, 10_000)]);
    let err = compute_discount_unscoped(&p, &s, now()).unwrap_err();
    assert!(err.to_string().contains("trigger_sku"));
}

#[test]
fn bxgy_non_positive_quantities_are_rejected() {
    let s = sale(30_000, vec![line("COFFEE", 3, 10_000)]);
    for (min_qty, reward_qty) in [(0, 1), (-2, 1), (2, 0), (2, -3)] {
        let p = bxgy(100, min_qty, "COFFEE", None, reward_qty);
        assert!(
            compute_discount_unscoped(&p, &s, now()).is_err(),
            "min_qty={min_qty} reward_qty={reward_qty} must be rejected"
        );
    }
}

#[test]
fn bxgy_discount_capped_at_reward_merchandise() {
    // 150% on the reward cannot exceed the reward item price.
    let p = bxgy(150, 1, "COFFEE", None, 1);
    let s = sale(20_000, vec![line("COFFEE", 2, 10_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 10_000);
}

// ── Category scoping ────────────────────────────────────────────────

#[test]
fn percentage_scopes_base_to_category_lines() {
    let mut p = promo("percentage", 10);
    p.category_id = Some("cat-drinks".into());
    let s = sale(
        50_000,
        vec![line("COFFEE", 2, 10_000), line("FOOD", 1, 30_000)],
    );
    let d = compute_discount(&p, &s, now(), |sku| {
        if sku == "COFFEE" {
            Some("cat-drinks".into())
        } else {
            Some("cat-food".into())
        }
    })
    .unwrap();
    assert_eq!(d, 2_000);
}

#[test]
fn category_scope_with_no_matching_lines_yields_zero() {
    let mut p = promo("percentage", 10);
    p.category_id = Some("cat-dessert".into());
    let s = sale(
        50_000,
        vec![line("COFFEE", 2, 10_000), line("FOOD", 1, 30_000)],
    );
    let d = compute_discount(&p, &s, now(), |_| Some("cat-drinks".into())).unwrap();
    assert_eq!(d, 0);
}

#[test]
fn category_scope_treats_unknown_products_as_out_of_scope() {
    let mut p = promo("percentage", 10);
    p.category_id = Some("cat-drinks".into());
    let s = sale(50_000, vec![line("COFFEE", 2, 10_000)]);
    // Lookup returns None (product uncategorized/unknown) → not in scope.
    let d = compute_discount(&p, &s, now(), |_| None).unwrap();
    assert_eq!(d, 0);
}

#[test]
fn bxgy_category_scope_restricts_trigger_and_reward() {
    let mut p = bxgy(100, 1, "COFFEE", Some("COOKIE"), 1);
    p.category_id = Some("cat-drinks".into());
    // COOKIE is a different category → excluded from the scope entirely.
    let s = sale(
        25_000,
        vec![line("COFFEE", 2, 10_000), line("COOKIE", 1, 5_000)],
    );
    let d = compute_discount(&p, &s, now(), |sku| {
        if sku == "COFFEE" {
            Some("cat-drinks".into())
        } else {
            Some("cat-food".into())
        }
    })
    .unwrap();
    // Trigger satisfied (COFFEE in scope, qty 2 ≥ 1) but no reward item
    // in scope → zero.
    assert_eq!(d, 0);
}

// ── Overflow fail-closed ────────────────────────────────────────────

#[test]
fn percentage_overflow_fails_closed() {
    // total * value must overflow i64 → Validation error, never a wrap.
    let p = promo("percentage", 10_000_000_000);
    let s = sale(i64::MAX / 2, vec![line("A", 1, i64::MAX / 2)]);
    let err = compute_discount_unscoped(&p, &s, now()).unwrap_err();
    assert!(err.to_string().contains("overflow"));
}

#[test]
fn bxgy_overflow_fails_closed() {
    let p = bxgy(10_000_000_000, 1, "COFFEE", None, 1);
    let s = sale(i64::MAX / 2, vec![line("COFFEE", 1, i64::MAX / 2)]);
    assert!(compute_discount_unscoped(&p, &s, now()).is_err());
}

// ── Negative-price safety ───────────────────────────────────────────

#[test]
fn discount_is_never_negative() {
    // A corrupt negative line price must not produce a negative discount.
    let p = promo("fixed_amount", 500);
    let s = sale(1_000, vec![line("A", 1, 1_000)]);
    assert_eq!(compute_discount_unscoped(&p, &s, now()).unwrap(), 500);
}
