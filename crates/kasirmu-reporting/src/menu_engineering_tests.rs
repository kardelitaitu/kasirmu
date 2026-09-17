use super::*;
use oz_core::migrations;
use oz_core::{Cart, CartLine, Currency, Money, Sale, SaleStatus, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn seed_product(conn: &Connection, sku: &str, price_minor: i64, cost_minor: i64) -> String {
    let store = oz_core::db::Store::new(conn);
    let money = Money {
        minor_units: price_minor,
        currency: usd(),
    };
    store
        .create_product(sku, sku, money, None, None, 100, None)
        .unwrap();

    // Set cost_minor after creation.
    conn.execute(
        "UPDATE products SET cost_minor = ?1 WHERE sku = ?2",
        params![cost_minor, sku],
    )
    .unwrap();

    // Return product id.
    conn.query_row(
        "SELECT id FROM products WHERE sku = ?1",
        params![sku],
        |row| row.get(0),
    )
    .unwrap()
}

fn complete_sale(conn: &Connection, sku: &str, qty: i64, unit_minor: i64) -> String {
    let store = oz_core::db::Store::new(conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), qty, price(unit_minor)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    store.create_sale(&sale).unwrap();
    store
        .update_sale_status(&sale.id, SaleStatus::Active)
        .unwrap();
    store
        .update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    sale.id
}

// ── Query tests ──────────────────────────────────────────────

#[test]
fn menu_engineering_empty_range() {
    let conn = fresh();
    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();
    assert!(result.rows.is_empty());
    assert_eq!(result.median_volume, 0.0);
    assert_eq!(result.median_margin, 0.0);
}

#[test]
fn menu_engineering_single_product() {
    let conn = fresh();
    seed_product(&conn, "STEAK", 2500, 800);
    complete_sale(&conn, "STEAK", 2, 2500);

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    assert_eq!(row.sku, "STEAK");
    assert_eq!(row.total_volume, 2);
    assert_eq!(row.unit_cost_minor, 800);
    assert_eq!(row.margin_per_unit, 1700);
    assert_eq!(row.total_margin_minor, 3400);
    assert_eq!(row.total_revenue_minor, 5000);

    // Median should match the single product.
    assert!((result.median_volume - 2.0).abs() < f64::EPSILON);
    assert!((result.median_margin - 3400.0).abs() < f64::EPSILON);
}

#[test]
fn menu_engineering_multiple_products() {
    let conn = fresh();
    seed_product(&conn, "STEAK", 2500, 800);
    seed_product(&conn, "SALAD", 1200, 400);
    seed_product(&conn, "SODA", 300, 100);
    complete_sale(&conn, "STEAK", 2, 2500);
    complete_sale(&conn, "SALAD", 3, 1200);
    complete_sale(&conn, "SODA", 5, 300);

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();

    assert_eq!(result.rows.len(), 3);

    // STEAK: volume=2, margin=(2500-800)*2=3400, revenue=5000
    // SALAD: volume=3, margin=(1200-400)*3=2400, revenue=3600
    // SODA:  volume=5, margin=(300-100)*5=1000, revenue=1500

    let steak = result.rows.iter().find(|r| r.sku == "STEAK").unwrap();
    assert_eq!(steak.total_margin_minor, 3400);

    let salad = result.rows.iter().find(|r| r.sku == "SALAD").unwrap();
    assert_eq!(salad.total_margin_minor, 2400);

    let soda = result.rows.iter().find(|r| r.sku == "SODA").unwrap();
    assert_eq!(soda.total_margin_minor, 1000);
}

#[test]
fn menu_engineering_zero_cost() {
    let conn = fresh();
    seed_product(&conn, "FREE", 500, 0); // cost = 0
    complete_sale(&conn, "FREE", 1, 500);

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();

    let row = &result.rows[0];
    assert_eq!(row.unit_cost_minor, 0);
    assert_eq!(row.margin_per_unit, 500);
    assert_eq!(row.total_margin_minor, 500);
}

// ── Quadrant classification ──────────────────────────────────

#[test]
fn classify_star() {
    assert_eq!(
        classify_quadrant(100, 5000, 50.0, 2500.0),
        MenuQuadrant::Star
    );
}

#[test]
fn classify_plowhorse() {
    assert_eq!(
        classify_quadrant(100, 1000, 50.0, 2500.0),
        MenuQuadrant::Plowhorse
    );
}

#[test]
fn classify_puzzle() {
    assert_eq!(
        classify_quadrant(10, 5000, 50.0, 2500.0),
        MenuQuadrant::Puzzle
    );
}

#[test]
fn classify_dog() {
    assert_eq!(classify_quadrant(10, 1000, 50.0, 2500.0), MenuQuadrant::Dog);
}

#[test]
fn classify_boundary_equal_median() {
    assert_eq!(
        classify_quadrant(50, 2500, 50.0, 2500.0),
        MenuQuadrant::Star
    );
}

#[test]
fn classify_zero_values() {
    assert_eq!(classify_quadrant(0, 0, 0.0, 0.0), MenuQuadrant::Star);
}

// ── Recommendations ──────────────────────────────────────────

#[test]
fn star_recommendation() {
    let rec = quadrant_recommendation(MenuQuadrant::Star);
    assert!(rec.contains("Promote Star"));
}

#[test]
fn plowhorse_recommendation() {
    let rec = quadrant_recommendation(MenuQuadrant::Plowhorse);
    assert!(rec.contains("Increase Price"));
}

#[test]
fn puzzle_recommendation() {
    let rec = quadrant_recommendation(MenuQuadrant::Puzzle);
    assert!(rec.contains("Reposition Puzzle"));
}

#[test]
fn dog_recommendation() {
    let rec = quadrant_recommendation(MenuQuadrant::Dog);
    assert!(rec.contains("Remove Dog"));
}

// ── Median calculation ───────────────────────────────────────

#[test]
fn median_empty() {
    let items: Vec<i64> = vec![];
    let result = median_of(&items, |&x| x as f64);
    assert_eq!(result, 0.0);
}

#[test]
fn median_odd_count() {
    let items = vec![10, 20, 30];
    let result = median_of(&items, |&x| x as f64);
    assert!((result - 20.0).abs() < f64::EPSILON);
}

#[test]
fn median_even_count() {
    let items = vec![10, 20, 30, 40];
    let result = median_of(&items, |&x| x as f64);
    assert!((result - 25.0).abs() < f64::EPSILON);
}

#[test]
fn median_single_element() {
    let items = vec![42];
    let result = median_of(&items, |&x| x as f64);
    assert!((result - 42.0).abs() < f64::EPSILON);
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn menu_quadrant_serde_roundtrip() {
    for q in &[
        MenuQuadrant::Star,
        MenuQuadrant::Plowhorse,
        MenuQuadrant::Puzzle,
        MenuQuadrant::Dog,
    ] {
        let json = serde_json::to_string(q).unwrap();
        let back: MenuQuadrant = serde_json::from_str(&json).unwrap();
        assert_eq!(*q, back);
    }
}

#[test]
fn menu_engineering_row_serde_roundtrip() {
    let row = MenuEngineeringRow {
        product_id: "p-1".into(),
        sku: "COFFEE".into(),
        name: "Coffee".into(),
        total_volume: 100,
        unit_price_minor: 350,
        unit_cost_minor: 100,
        margin_per_unit: 250,
        total_margin_minor: 25000,
        total_revenue_minor: 35000,
    };
    let json = serde_json::to_string(&row).unwrap();
    let back: MenuEngineeringRow = serde_json::from_str(&json).unwrap();
    assert_eq!(back.sku, "COFFEE");
    assert_eq!(back.total_margin_minor, 25000);
}

// ── Boundary / invariant tests for menu_engineering ──────────────

/// When `cost > price`, `margin_per_unit` MUST be negative and
/// `total_margin_minor` MUST accumulate as a negative sum. Pins
/// the loss-leader menu item contract so P&L dashboards reflect
/// negative margin correctly.
#[test]
fn menu_engineering_negative_margin() {
    let conn = fresh();
    seed_product(&conn, "LOSS", 500, 800); // price=500, cost=800
    complete_sale(&conn, "LOSS", 3, 500);

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].margin_per_unit, -300);
    assert_eq!(result.rows[0].total_margin_minor, -900);
    assert_eq!(result.rows[0].total_revenue_minor, 1500);
}

/// Quadrant classification is a relative comparison against the
/// median; when `median_margin < 0`, products performing at or
/// above this negative median are STILL classified as "high
/// margin". Pins the contract that classify uses ≥ (not >) so
/// equal-to-median counts as high.
#[test]
fn classify_quadrant_with_negative_median_margin() {
    // High volume (100 >= 50), High margin (0 >= -500) -> Star.
    assert_eq!(classify_quadrant(100, 0, 50.0, -500.0), MenuQuadrant::Star);
    // High volume, equal-to-negative-median (0 >= -500) -> Star.
    assert_eq!(
        classify_quadrant(100, -500, 50.0, -500.0),
        MenuQuadrant::Star
    );
    // Low volume (10 < 50), equal-to-negative-median margin → Puzzle.
    assert_eq!(
        classify_quadrant(10, -500, 50.0, -500.0),
        MenuQuadrant::Puzzle
    );
    // Low volume, below negative median → Dog.
    assert_eq!(classify_quadrant(10, -600, 50.0, -500.0), MenuQuadrant::Dog);
}

/// The same SKU sold at multiple disparate unit prices MUST
/// aggregate into a SINGLE reporting row. Pins the merge logic
/// in `merge_same_product_rows` so a price-promotion period
/// (e.g., happy hour at 60% off) shows up as one row.
#[test]
fn menu_engineering_merge_same_product_different_prices() {
    let conn = fresh();
    seed_product(&conn, "VAR", 500, 200); // price=500, cost=200
    complete_sale(&conn, "VAR", 1, 500); // 1 @ 500
    complete_sale(&conn, "VAR", 1, 600); // 1 @ 600

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].total_volume, 2);
    assert_eq!(result.rows[0].total_revenue_minor, 1100);
    // margin = (500-200)*1 + (600-200)*1 = 700.
    assert_eq!(result.rows[0].total_margin_minor, 700);
}

/// A sale line with `unit_price = 0` (currency zero-boundary) MUST
/// contribute 0 to revenue. Pins the contract so 100%-discount
/// promotions and gift card zero-balance sales don't inflate
/// the in-app reports. (Note: `qty = 0` is rejected at the
/// foundation Cart boundary; testing it would be unreachable
/// code, so we test the equivalent real-world shape —
/// qty=1 with unit_price=0.)
#[test]
fn menu_engineering_zero_unit_price_product() {
    let conn = fresh();
    seed_product(&conn, "ZERO", 0, 0); // unit_price=0, cost=0
    complete_sale(&conn, "ZERO", 1, 0);

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].total_volume, 1);
    assert_eq!(result.rows[0].total_revenue_minor, 0);
    assert_eq!(result.rows[0].total_margin_minor, 0);
}

/// `median_of` correctly handles negative values. Pins the
/// algorithm contract for loss-leader menu engineering: medians
/// can be negative when many products lose money.
#[test]
fn median_of_handles_negatives() {
    let v_odd = vec![-10.0_f64, 0.0, 10.0];
    assert!((median_of(&v_odd, |&x| x) - 0.0).abs() < f64::EPSILON);

    let v_even = vec![-10.0_f64, 0.0];
    assert!((median_of(&v_even, |&x| x) - (-5.0)).abs() < f64::EPSILON);

    let v_all_neg = vec![-30, -20, -10];
    assert!((median_of(&v_all_neg, |&x| x as f64) - (-20.0)).abs() < f64::EPSILON);
}

/// Each `MenuQuadrant` recommendation MUST contain its
/// identifying keyword so downstream grep-based audit tools
/// can filter by quadrant without parsing JSON.
#[test]
fn menu_quadrant_recommendation_strings_stable() {
    assert!(quadrant_recommendation(MenuQuadrant::Star).contains("Star"));
    assert!(quadrant_recommendation(MenuQuadrant::Plowhorse).contains("Plowhorse"));
    assert!(quadrant_recommendation(MenuQuadrant::Puzzle).contains("Puzzle"));
    assert!(quadrant_recommendation(MenuQuadrant::Dog).contains("Dog"));
}
