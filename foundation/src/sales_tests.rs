//! Sibling unit tests for `sales.rs` (AGENTS.md: no tests in production files).
//!
//! Moved here with the types from `modules/sales/src/models_tests.rs`; the assertions are
//! unchanged, and `foundation::` paths became `crate::` because a crate cannot name itself by path.


use super::*;

use crate::{Cart, CartLine, Percentage, Sku};

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn cart_with_two_lines() -> Cart {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("COFFEE"),
        2,
        Money {
            minor_units: 350,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("CAKE"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    cart
}

// ── Sale::from_cart ───────────────────────────────────────────

#[test]
fn sale_from_cart_builds_lines_and_totals() {
    let sale = Sale::from_cart(&cart_with_two_lines()).unwrap();

    assert_eq!(sale.status, SaleStatus::Pending);
    assert_eq!(sale.currency, usd());
    assert_eq!(sale.line_count, 2);
    // 2 × 350 + 1 × 500 = 1200
    assert_eq!(sale.total.minor_units, 1200);
    assert_eq!(sale.lines.len(), 2);
    assert_eq!(sale.lines[0].sku, "COFFEE");
    assert_eq!(sale.lines[0].qty, 2);
    assert_eq!(sale.lines[0].line_position, 1);
    assert_eq!(sale.lines[0].unit_price.minor_units, 350);
    assert_eq!(sale.lines[0].line_total.minor_units, 700);
    assert_eq!(sale.lines[1].sku, "CAKE");
    assert_eq!(sale.lines[1].line_position, 2);
    assert_eq!(sale.lines[1].line_total.minor_units, 500);
    // Every line belongs to the sale.
    for line in &sale.lines {
        assert_eq!(line.sale_id, sale.id);
    }
    assert_eq!(sale.version, 1);
    assert!(sale.payment_method.is_none());
    assert!(sale.user_id.is_none());
    assert!(!sale.created_at.is_empty());
    assert!(!sale.updated_at.is_empty());
}

#[test]
fn sale_from_cart_with_user() {
    let sale = Sale::from_cart_with_user(&cart_with_two_lines(), Some("u-1".to_string())).unwrap();
    assert_eq!(sale.user_id.as_deref(), Some("u-1"));
}

#[test]
fn sale_from_cart_empty_yields_zero_line_sale() {
    // An empty cart produces a sale with a zero total and no lines.
    let empty = Cart::new(usd());
    let sale = Sale::from_cart(&empty).unwrap();
    assert_eq!(sale.line_count, 0);
    assert!(sale.lines.is_empty());
    assert_eq!(sale.total.minor_units, 0);
}

#[test]
fn sale_from_cart_preserves_discount_fields() {
    let mut cart = cart_with_two_lines();
    cart.set_discount(Percentage::new(10).unwrap(), Some("Senior 10%".into()));
    let sale = Sale::from_cart(&cart).unwrap();
    assert_eq!(sale.discount_percent, 10);
    assert_eq!(sale.discount_label.as_deref(), Some("Senior 10%"));
    // Discounted total: 1200 × 0.9 = 1080
    assert_eq!(sale.total.minor_units, 1080);
}

#[test]
fn sale_from_cart_line_total_matches_qty_times_unit() {
    let sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    for line in &sale.lines {
        assert_eq!(
            line.line_total.minor_units,
            line.unit_price.minor_units * line.qty
        );
    }
}

// ── Sale::transition_to ───────────────────────────────────────

#[test]
fn sale_valid_transition_path() {
    let mut sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    assert!(sale.transition_to(SaleStatus::Active).is_ok());
    assert_eq!(sale.status, SaleStatus::Active);
    assert!(sale.transition_to(SaleStatus::Completed).is_ok());
    assert_eq!(sale.status, SaleStatus::Completed);
}

#[test]
fn sale_skipping_pending_rejected() {
    let mut sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    assert!(sale.transition_to(SaleStatus::Completed).is_err());
    assert_eq!(sale.status, SaleStatus::Pending);
}

#[test]
fn sale_terminal_states_cannot_advance() {
    let mut sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    sale.transition_to(SaleStatus::Active).unwrap();
    sale.transition_to(SaleStatus::Voided).unwrap();
    assert!(sale.is_terminal());
    assert!(sale.transition_to(SaleStatus::Completed).is_err());
    assert_eq!(sale.status, SaleStatus::Voided);
}

#[test]
fn sale_is_terminal() {
    let pending = Sale::from_cart(&cart_with_two_lines()).unwrap();
    assert!(!pending.is_terminal());
    assert!(!SaleStatus::Active.is_terminal());
    assert!(SaleStatus::Completed.is_terminal());
    assert!(SaleStatus::Voided.is_terminal());
}

#[test]
fn sale_from_cart_pending_is_not_terminal() {
    let sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    assert!(!sale.is_terminal());
}

// ── Refund / RefundLine ───────────────────────────────────────

#[test]
fn refund_new_stamps_id_on_lines() {
    let line = RefundLine::new("sl-1", "COFFEE", 2, Money::zero(usd()), Money::zero(usd()));
    let refund = Refund::new(
        "sale-1",
        Money::zero(usd()),
        "damaged",
        "customer complaint",
        "staff-1",
        vec![line],
    );
    assert_eq!(refund.sale_id, "sale-1");
    assert_eq!(refund.reason, "damaged");
    assert_eq!(refund.note, "customer complaint");
    assert_eq!(refund.processed_by, "staff-1");
    assert_eq!(refund.lines.len(), 1);
    assert_eq!(refund.lines[0].refund_id, refund.id);
    assert!(!refund.id.is_empty());
}

#[test]
fn refund_line_new_has_unique_id_and_timestamps() {
    let line = RefundLine::new("sl-2", "TEA", 1, Money::zero(usd()), Money::zero(usd()));
    assert_eq!(line.sale_line_id, "sl-2");
    assert_eq!(line.sku, "TEA");
    assert_eq!(line.qty, 1);
    assert!(!line.id.is_empty());
    assert!(!line.created_at.is_empty());
}

#[test]
fn refund_line_preserves_money_fields() {
    let unit = Money {
        minor_units: 350,
        currency: usd(),
    };
    let total = Money {
        minor_units: 700,
        currency: usd(),
    };
    let line = RefundLine::new("sl-3", "COFFEE", 2, unit, total);
    assert_eq!(line.unit_price, unit);
    assert_eq!(line.line_total, total);
}

#[test]
fn default_version_is_one() {
    assert_eq!(default_version(), 1);
}

// ── Row types ─────────────────────────────────────────────────

#[test]
fn sale_serde_roundtrip() {
    let sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    let json = serde_json::to_string(&sale).unwrap();
    let back: Sale = serde_json::from_str(&json).unwrap();
    assert_eq!(back, sale);
}

#[test]
fn sale_line_serde_roundtrip() {
    let sale = Sale::from_cart(&cart_with_two_lines()).unwrap();
    let line = &sale.lines[0];
    let json = serde_json::to_string(line).unwrap();
    let back: SaleLine = serde_json::from_str(&json).unwrap();
    assert_eq!(&back, line);
}

#[test]
fn refund_serde_roundtrip() {
    let line = RefundLine::new("sl-9", "SKU", 1, Money::zero(usd()), Money::zero(usd()));
    let refund = Refund::new("s-1", Money::zero(usd()), "r", "n", "u", vec![line]);
    let json = serde_json::to_string(&refund).unwrap();
    let back: Refund = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sale_id, refund.sale_id);
    assert_eq!(back.lines.len(), 1);
}
