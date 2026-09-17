use crate::db::Store;
use crate::db::products::{CreateProductAttributes, UpdateProductAttributes};
use crate::kds::CreateKdsOrderInput;
use crate::money::Currency;
use crate::{Cart, CartLine, Money, Sale, SaleStatus, Sku, migrations};
use rusqlite::{Connection, params};

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
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

fn insert_user(conn: &Connection, id: &str) {
    // Ensure a role exists for the FK reference.
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-staff', 'staff', '', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?1, 'x', ?1, 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        rusqlite::params![id],
    )
    .unwrap();
}

fn seed_completed_sale(conn: &Connection, sku: &str, qty: i64, unit_minor: i64) -> String {
    let s = store(conn);
    let money = Money {
        minor_units: unit_minor,
        currency: usd(),
    };
    s.create_product(sku, sku, money, None, None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), qty, price(unit_minor)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    sale.id
}

// ── Daily revenue ──────────────────────────────────────────────

#[test]
fn daily_revenue_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .daily_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn daily_revenue_with_sales() {
    let conn = fresh();
    seed_completed_sale(&conn, "COFFEE", 2, 350);
    seed_completed_sale(&conn, "BAGEL", 1, 450);
    let rows = store(&conn)
        .daily_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].total_minor, 1150);
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].currency, "USD");
    // No costs were set on the seeded products → COGS 0, profit = revenue.
    assert_eq!(rows[0].cogs_minor, 0);
    assert_eq!(rows[0].gross_profit_minor, 1150);
    assert_eq!(rows[0].gross_margin_percent, 100.0);
}

#[test]
fn daily_revenue_gross_profit_from_product_costs() {
    let conn = fresh();
    // Seed a sale with a costed product and one with no cost at all.
    seed_completed_sale(&conn, "STEAK", 2, 2500);
    conn.execute(
        "UPDATE products SET cost_minor = 800 WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();
    seed_completed_sale(&conn, "FREE", 1, 500);

    let rows = store(&conn)
        .daily_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert_eq!(rows.len(), 1);
    // Revenue 5500, COGS 2 × 800 = 1600 → profit 3900 (~70.9%).
    assert_eq!(rows[0].total_minor, 5500);
    assert_eq!(rows[0].cogs_minor, 1600);
    assert_eq!(rows[0].gross_profit_minor, 3900);
    let expected = 3900.0 / 5500.0 * 100.0;
    assert!(
        (rows[0].gross_margin_percent - expected).abs() < 1e-9,
        "margin was {}",
        rows[0].gross_margin_percent
    );
}

// ── Weekly revenue ─────────────────────────────────────────────

#[test]
fn weekly_revenue_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .weekly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn weekly_revenue_with_sales() {
    let conn = fresh();
    seed_completed_sale(&conn, "TEA", 3, 200);
    let rows = store(&conn)
        .weekly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].total_minor, 600);
    // No costs seeded → COGS 0, profit equals revenue.
    assert_eq!(rows[0].cogs_minor, 0);
    assert_eq!(rows[0].gross_profit_minor, 600);
    assert_eq!(rows[0].gross_margin_percent, 100.0);
}

#[test]
fn weekly_revenue_gross_profit_from_product_costs() {
    let conn = fresh();
    seed_completed_sale(&conn, "STEAK", 2, 2500);
    conn.execute(
        "UPDATE products SET cost_minor = 800 WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();
    let rows = store(&conn)
        .weekly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert_eq!(rows[0].total_minor, 5000);
    assert_eq!(rows[0].cogs_minor, 1600);
    assert_eq!(rows[0].gross_profit_minor, 3400);
}

// ── Monthly revenue ────────────────────────────────────────────

#[test]
fn monthly_revenue_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .monthly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn monthly_revenue_with_sales() {
    let conn = fresh();
    seed_completed_sale(&conn, "JUICE", 1, 500);
    let rows = store(&conn)
        .monthly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].total_minor, 500);
    // No costs seeded → COGS 0, profit equals revenue.
    assert_eq!(rows[0].cogs_minor, 0);
    assert_eq!(rows[0].gross_profit_minor, 500);
    assert_eq!(rows[0].gross_margin_percent, 100.0);
}

#[test]
fn monthly_revenue_gross_profit_from_product_costs() {
    let conn = fresh();
    seed_completed_sale(&conn, "STEAK", 2, 2500);
    conn.execute(
        "UPDATE products SET cost_minor = 800 WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();
    let rows = store(&conn)
        .monthly_revenue("2000-01-01", "2099-12-31")
        .unwrap();
    assert_eq!(rows[0].total_minor, 5000);
    assert_eq!(rows[0].cogs_minor, 1600);
    assert_eq!(rows[0].gross_profit_minor, 3400);
}

// ── Top products ───────────────────────────────────────────────

#[test]
fn top_products_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn top_products_with_sales() {
    let conn = fresh();
    seed_completed_sale(&conn, "COFFEE", 2, 350);
    seed_completed_sale(&conn, "BAGEL", 1, 450);
    let rows = store(&conn)
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert!(!rows.is_empty());
    // BAGEL has higher unit price but lower qty → check ordering
    assert_eq!(rows.len(), 2);
}

#[test]
fn top_products_ranks_by_gross_profit_when_requested() {
    let conn = fresh();
    let s = store(&conn);
    // A: high revenue, thin margin. B: lower revenue, fat margin.
    s.create_product_with_attributes(
        "A",
        "Thin Margin",
        price(1000),
        None,
        None,
        100,
        None,
        &CreateProductAttributes {
            cost_minor: 900,
            ..Default::default()
        },
    )
    .unwrap();
    s.create_product_with_attributes(
        "B",
        "Fat Margin",
        price(500),
        None,
        None,
        100,
        None,
        &CreateProductAttributes {
            cost_minor: 100,
            ..Default::default()
        },
    )
    .unwrap();
    for sku in ["A", "B"] {
        let mut cart = Cart::new(usd());
        cart.add_line(CartLine::new(
            Sku::new(sku),
            10,
            price(if sku == "A" { 1000 } else { 500 }),
        ))
        .unwrap();
        let mut sale = Sale::from_cart(&cart).unwrap();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        sale.created_at = now.clone();
        sale.updated_at = now;
        s.create_sale(&sale).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Completed)
            .unwrap();
    }

    let by_revenue = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert_eq!(by_revenue[0].sku, "A");
    assert_eq!(by_revenue[0].gross_profit_minor, 1000);

    let by_profit = s
        .top_products("2000-01-01", "2099-12-31", 10, "profit")
        .unwrap();
    // Revenue A=10000 > B=5000, but profit B=4000 > A=1000.
    assert_eq!(by_profit[0].sku, "B");
    assert_eq!(by_profit[0].gross_profit_minor, 4000);
    assert_eq!(by_profit[1].sku, "A");

    // Unknown keys fall back to revenue ranking.
    let by_unknown = s
        .top_products("2000-01-01", "2099-12-31", 10, "quantity")
        .unwrap();
    assert_eq!(by_unknown[0].sku, "A");
}

#[test]
fn top_products_respects_limit() {
    let conn = fresh();
    seed_completed_sale(&conn, "A", 1, 100);
    seed_completed_sale(&conn, "B", 1, 200);
    seed_completed_sale(&conn, "C", 1, 300);
    let rows = store(&conn)
        .top_products("2000-01-01", "2099-12-31", 2, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 2);
    // Highest revenue first
    assert_eq!(rows[0].sku, "C");
    assert_eq!(rows[1].sku, "B");
}

#[test]
fn top_products_with_costs_and_snapshot_fallback() {
    let conn = fresh();
    let s = store(&conn);
    // Product with a cost — the sale-line snapshot freezes it at checkout.
    s.create_product_with_attributes(
        "COFFEE",
        "Coffee",
        price(350),
        None,
        None,
        100,
        None,
        &CreateProductAttributes {
            cost_minor: 150,
            ..Default::default()
        },
    )
    .unwrap();
    // Product with no cost — snapshot stays NULL, falls back to current cost.
    s.create_product("TEA", "Tea", price(200), None, None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("TEA"), 3, price(200)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();

    // Editing HPP after the sale must NOT restate the frozen snapshot.
    s.update_product_attributes(
        "COFFEE",
        &UpdateProductAttributes {
            cost_minor: Some(999),
            ..Default::default()
        },
    )
    .unwrap();

    let rows = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    let coffee = rows.iter().find(|r| r.sku == "COFFEE").unwrap();
    // COGS = snapshot 150 × 2 = 300 (not 999 × 2); profit = 700 − 300.
    assert_eq!(coffee.total_minor, 700);
    assert_eq!(coffee.cogs_minor, 300);
    assert_eq!(coffee.gross_profit_minor, 400);
    assert!((coffee.gross_margin_percent - 57.14).abs() < 0.01);
    let tea = rows.iter().find(|r| r.sku == "TEA").unwrap();
    // No cost recorded anywhere → COGS 0, profit = revenue, margin 100%.
    assert_eq!(tea.total_minor, 600);
    assert_eq!(tea.cogs_minor, 0);
    assert_eq!(tea.gross_profit_minor, 600);
    assert!((tea.gross_margin_percent - 100.0).abs() < f64::EPSILON);
}

// ── Hourly heatmap ─────────────────────────────────────────────

#[test]
fn hourly_heatmap_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .hourly_heatmap("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn hourly_heatmap_with_sales() {
    let conn = fresh();
    seed_completed_sale(&conn, "SNACK", 1, 300);
    let rows = store(&conn)
        .hourly_heatmap("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].sale_count, 1);
}

// ── Low stock alerts ───────────────────────────────────────────

#[allow(deprecated)]
#[test]
fn low_stock_alerts_empty() {
    let conn = fresh();
    let rows = store(&conn).low_stock_alerts(0).unwrap();
    assert!(rows.is_empty());
}

#[allow(deprecated)]
#[test]
fn low_stock_alerts_finds_low_stock() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("LOW", "Low Stock Item", money, None, None, 2, None)
        .unwrap();
    s.create_product("OK", "OK Stock Item", money, None, None, 100, None)
        .unwrap();
    let rows = s.low_stock_alerts(5).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sku, "LOW");
    assert_eq!(rows[0].current_qty, 2);
    assert_eq!(rows[0].threshold, 5);
}

#[allow(deprecated)]
#[test]
fn low_stock_alerts_no_inventory_row() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    // Create a product without inventory record — qty defaults to 0.
    s.create_product("NO-INV", "No Inventory", money, None, None, 0, None)
        .unwrap();
    let rows = s.low_stock_alerts(0).unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].current_qty, 0);
}

// ── Category breakdown ─────────────────────────────────────────

#[test]
fn category_breakdown_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .category_breakdown("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn category_breakdown_with_sales() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-1", "Beverages", "#fff", "").unwrap();

    let money = Money {
        minor_units: 350,
        currency: usd(),
    };
    s.create_product("COFFEE", "Coffee", money, Some("cat-1"), None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].category_name, "Beverages");
    assert_eq!(rows[0].total_minor, 700);
    assert!((rows[0].percentage - 100.0).abs() < f64::EPSILON);
}

#[test]
fn category_breakdown_no_category() {
    let conn = fresh();
    let s = store(&conn);

    let money = Money {
        minor_units: 200,
        currency: usd(),
    };
    s.create_product("GENERIC", "Generic Item", money, None, None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("GENERIC"), 1, price(200)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    assert!(!rows.is_empty());
    assert_eq!(rows[0].category_name, "Uncategorised");
    assert_eq!(rows[0].category_id, None);
}

// ── Low stock alerts at location ───────────────────────────────

#[test]
fn low_stock_alerts_at_location_empty() {
    let conn = fresh();
    let s = store(&conn);
    let rows = s
        .low_stock_alerts_at_location(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID, 0)
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn low_stock_alerts_at_location_finds_low_stock() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("LOW", "Low Stock Item", money, None, None, 2, None)
        .unwrap();
    s.create_product("OK", "OK Stock Item", money, None, None, 100, None)
        .unwrap();
    let rows = s
        .low_stock_alerts_at_location(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID, 5)
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sku, "LOW");
    assert_eq!(rows[0].current_qty, 2);
    assert_eq!(rows[0].threshold, 5);
}

#[test]
fn low_stock_alerts_at_location_respects_custom_threshold() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    let prod = s
        .create_product("CUSTOM", "Custom Threshold", money, None, None, 5, None)
        .unwrap();
    // Set a custom threshold of 10.
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 10, 1, ?4, ?4)",
        rusqlite::params![
            uuid::Uuid::now_v7().to_string(),
            prod.id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
            now
        ],
    )
    .unwrap();

    // Default threshold is 3, but custom threshold (10) overrides it.
    let rows = s
        .low_stock_alerts_at_location(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID, 3)
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sku, "CUSTOM");
    assert_eq!(rows[0].current_qty, 5);
    assert_eq!(
        rows[0].threshold, 10,
        "custom threshold should override default"
    );
}

// ── Active stock alerts ────────────────────────────────────────

#[test]
fn active_stock_alerts_empty() {
    let conn = fresh();
    let s = store(&conn);
    let rows = s
        .active_stock_alerts(crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID)
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn active_stock_alerts_returns_active_only() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    let prod = s
        .create_product("ALERT", "Alert Product", money, None, None, 2, None)
        .unwrap();
    let loc_id = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Create a threshold.
    let tid = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 5, 1, ?4, ?4)",
        rusqlite::params![tid, prod.id, loc_id, now],
    )
    .unwrap();

    // Create an active alert.
    conn.execute(
        "INSERT INTO stock_alert_events (id, threshold_id, product_id, location_id, current_qty, threshold, status, triggered_at)
         VALUES (?1, ?2, ?3, ?4, 2, 5, 'active', ?5)",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tid, prod.id, loc_id, now],
    )
    .unwrap();

    let rows = s.active_stock_alerts(loc_id).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "active");
    assert_eq!(rows[0].current_qty, 2);
    assert_eq!(rows[0].threshold, 5);
    assert_eq!(rows[0].product_sku, "ALERT");
    assert_eq!(rows[0].product_name, "Alert Product");
}

#[test]
fn active_stock_alerts_excludes_resolved() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    let prod = s
        .create_product("RESOLVED", "Resolved Product", money, None, None, 2, None)
        .unwrap();
    let loc_id = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let tid = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 5, 1, ?4, ?4)",
        rusqlite::params![tid, prod.id, loc_id, now],
    )
    .unwrap();

    // Create a resolved alert.
    conn.execute(
        "INSERT INTO stock_alert_events (id, threshold_id, product_id, location_id, current_qty, threshold, status, triggered_at, resolved_at)
         VALUES (?1, ?2, ?3, ?4, 2, 5, 'resolved', ?5, ?6)",
        rusqlite::params![
            uuid::Uuid::now_v7().to_string(),
            tid,
            prod.id,
            loc_id,
            now,
            now
        ],
    )
    .unwrap();

    let rows = s.active_stock_alerts(loc_id).unwrap();
    assert!(rows.is_empty(), "resolved alerts should be excluded");
}

#[test]
fn active_stock_alerts_includes_acknowledged() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    let prod = s
        .create_product("ACK", "Acknowledged Product", money, None, None, 2, None)
        .unwrap();
    let loc_id = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Create a user for the acknowledged_by FK reference.
    insert_user(&conn, "user-1");

    let tid = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO stock_thresholds (id, product_id, location_id, threshold, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, 5, 1, ?4, ?4)",
        rusqlite::params![tid, prod.id, loc_id, now],
    )
    .unwrap();

    // Create an acknowledged alert.
    conn.execute(
        "INSERT INTO stock_alert_events (id, threshold_id, product_id, location_id, current_qty, threshold, status, triggered_at, acknowledged_at, acknowledged_by)
         VALUES (?1, ?2, ?3, ?4, 2, 5, 'acknowledged', ?5, ?5, 'user-1')",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), tid, prod.id, loc_id, now],
    )
    .unwrap();

    let rows = s.active_stock_alerts(loc_id).unwrap();
    assert_eq!(rows.len(), 1, "acknowledged alerts should be included");
    assert_eq!(rows[0].status, "acknowledged");
    assert_eq!(
        rows[0].acknowledged_by.as_deref(),
        Some("user-1"),
        "acknowledged_by should be populated"
    );
}

// ── Extended edge cases ───────────────────────────────────────

#[test]
fn daily_revenue_ignores_sales_outside_range() {
    let conn = fresh();
    // Create a sale with the seeded timestamp (today).
    seed_completed_sale(&conn, "TODAY", 1, 500);
    // Query a date range that doesn't include today.
    let rows = store(&conn)
        .daily_revenue("2000-01-01", "2000-01-31")
        .unwrap();
    assert!(
        rows.is_empty(),
        "sales outside the date range should be excluded"
    );
}

#[test]
fn weekly_revenue_multiple_weeks() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("W1", "Week 1", money, None, None, 100, None)
        .unwrap();
    s.create_product("W2", "Week 2", money, None, None, 100, None)
        .unwrap();

    // Create a sale with an old date (simulate week 1).
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("W1"), 1, price(100)))
        .unwrap();
    let mut sale1 = Sale::from_cart(&cart).unwrap();
    sale1.created_at = "2026-01-05T12:00:00.000Z".to_string();
    sale1.updated_at = "2026-01-05T12:00:00.000Z".to_string();
    s.create_sale(&sale1).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Completed)
        .unwrap();

    // Create a sale with a later date (simulate week 2).
    let mut cart2 = Cart::new(usd());
    cart2
        .add_line(CartLine::new(Sku::new("W2"), 1, price(100)))
        .unwrap();
    let mut sale2 = Sale::from_cart(&cart2).unwrap();
    sale2.created_at = "2026-01-12T12:00:00.000Z".to_string();
    sale2.updated_at = "2026-01-12T12:00:00.000Z".to_string();
    s.create_sale(&sale2).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.weekly_revenue("2026-01-01", "2026-01-31").unwrap();
    assert_eq!(rows.len(), 2, "should have two weekly rows");
    // Both rows should have 100 each.
    assert_eq!(rows[0].total_minor, 100);
    assert_eq!(rows[1].total_minor, 100);
}

#[test]
fn monthly_revenue_multiple_months() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("M1", "Month 1", money, None, None, 100, None)
        .unwrap();
    s.create_product("M2", "Month 2", money, None, None, 100, None)
        .unwrap();

    // January sale.
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("M1"), 1, price(100)))
        .unwrap();
    let mut sale1 = Sale::from_cart(&cart).unwrap();
    sale1.created_at = "2026-01-15T12:00:00.000Z".to_string();
    sale1.updated_at = "2026-01-15T12:00:00.000Z".to_string();
    s.create_sale(&sale1).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Completed)
        .unwrap();

    // February sale.
    let mut cart2 = Cart::new(usd());
    cart2
        .add_line(CartLine::new(Sku::new("M2"), 1, price(100)))
        .unwrap();
    let mut sale2 = Sale::from_cart(&cart2).unwrap();
    sale2.created_at = "2026-02-10T12:00:00.000Z".to_string();
    sale2.updated_at = "2026-02-10T12:00:00.000Z".to_string();
    s.create_sale(&sale2).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.monthly_revenue("2026-01-01", "2026-02-28").unwrap();
    assert_eq!(rows.len(), 2, "should have two monthly rows");
    assert_eq!(rows[0].month, "2026-01");
    assert_eq!(rows[0].total_minor, 100);
    assert_eq!(rows[1].month, "2026-02");
    assert_eq!(rows[1].total_minor, 100);
}

#[test]
fn top_products_keeps_deleted_product_sales_under_their_sku() {
    // REP-05: the INNER JOIN to products silently DROPPED sales of
    // deleted products from top_products, so the report's totals no
    // longer reconciled with actual revenue (money vanished from the
    // report without a trace). Deleted products now surface under
    // their stored sku.
    let conn = fresh();
    let s = store(&conn);
    seed_completed_sale(&conn, "DELETED", 2, 500);

    // Delete the product (simulate what happens when a product is removed).
    conn.execute("DELETE FROM products WHERE sku = 'DELETED'", [])
        .unwrap();

    let rows = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 1, "the sale must still be reported");
    assert_eq!(rows[0].sku, "DELETED");
    assert_eq!(
        rows[0].name, "DELETED",
        "name falls back to the stored sku when the product row is gone"
    );
    assert_eq!(rows[0].total_minor, 1000);
}

#[test]
fn category_breakdown_keeps_deleted_product_in_its_snapshot_category() {
    // REP-05: sales of deleted products vanished from the category
    // breakdown entirely (INNER JOIN products), inflating every
    // remaining category's percentage — the pie claimed 100% of
    // revenue while a quarter of it was missing. With the identity
    // snapshot, a deleted product's revenue not only stays visible,
    // it keeps the CATEGORY the product actually had at sale time.
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-keep", "Drinks", "#00f", "").unwrap();
    s.create_product(
        "GONE",
        "Gone",
        price(1000),
        Some("cat-keep"),
        None,
        100,
        None,
    )
    .unwrap();
    s.create_product(
        "HERE",
        "Here",
        price(3000),
        Some("cat-keep"),
        None,
        100,
        None,
    )
    .unwrap();
    for sku in ["GONE", "HERE"] {
        let mut cart = Cart::new(usd());
        cart.add_line(CartLine::new(
            Sku::new(sku),
            1,
            price(if sku == "GONE" { 1000 } else { 3000 }),
        ))
        .unwrap();
        let mut sale = Sale::from_cart(&cart).unwrap();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        sale.created_at = now.clone();
        sale.updated_at = now;
        s.create_sale(&sale).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Completed)
            .unwrap();
    }
    conn.execute("DELETE FROM products WHERE sku = 'GONE'", [])
        .unwrap();

    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    let total: i64 = rows.iter().map(|r| r.total_minor).sum();
    assert_eq!(total, 4000, "no revenue may vanish from the breakdown");
    assert_eq!(
        rows.len(),
        1,
        "the snapshot keeps the deleted product in Drinks, not Uncategorised"
    );
    let drinks = rows.iter().find(|r| r.category_name == "Drinks").unwrap();
    assert_eq!(drinks.total_minor, 4000);
    assert!(
        (drinks.percentage - 100.0).abs() < 0.01,
        "all revenue is Drinks, got {}",
        drinks.percentage
    );
}

#[test]
fn category_breakdown_legacy_deleted_product_falls_back_to_uncategorised() {
    // Legacy rows (NULL snapshot) of deleted products still land in the
    // Uncategorised bucket — the join fallback has nothing to resolve.
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-keep", "Drinks", "#00f", "").unwrap();
    s.create_product(
        "GONE",
        "Gone",
        price(1000),
        Some("cat-keep"),
        None,
        100,
        None,
    )
    .unwrap();
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("GONE"), 1, price(1000)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    conn.execute(
        "UPDATE sale_lines SET category_id = NULL, product_id = NULL, product_name = NULL",
        [],
    )
    .unwrap();
    conn.execute("DELETE FROM products WHERE sku = 'GONE'", [])
        .unwrap();

    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].category_name, "Uncategorised");
    assert_eq!(rows[0].total_minor, 1000);
}

#[test]
fn hourly_heatmap_multiple_hours() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("H1", "Hour 1", money, None, None, 100, None)
        .unwrap();
    s.create_product("H2", "Hour 2", money, None, None, 100, None)
        .unwrap();

    // Morning sale.
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("H1"), 1, price(100)))
        .unwrap();
    let mut sale1 = Sale::from_cart(&cart).unwrap();
    sale1.created_at = "2026-06-01T08:30:00.000Z".to_string();
    sale1.updated_at = "2026-06-01T08:30:00.000Z".to_string();
    s.create_sale(&sale1).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Completed)
        .unwrap();

    // Afternoon sale.
    let mut cart2 = Cart::new(usd());
    cart2
        .add_line(CartLine::new(Sku::new("H2"), 1, price(100)))
        .unwrap();
    let mut sale2 = Sale::from_cart(&cart2).unwrap();
    sale2.created_at = "2026-06-01T14:00:00.000Z".to_string();
    sale2.updated_at = "2026-06-01T14:00:00.000Z".to_string();
    s.create_sale(&sale2).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.hourly_heatmap("2026-06-01", "2026-06-01").unwrap();
    assert_eq!(rows.len(), 2, "should have two hourly entries");
    // Use hour comparison instead of position-dependent assert
    let hours: Vec<i64> = rows.iter().map(|r| r.hour).collect();
    assert!(hours.contains(&8), "should include hour 8");
    assert!(hours.contains(&14), "should include hour 14");
}

#[test]
fn category_breakdown_percentage_multiple_categories() {
    let conn = fresh();
    let s = store(&conn);

    s.create_category("cat-drinks", "Drinks", "#00f", "")
        .unwrap();
    s.create_category("cat-food", "Food", "#f00", "").unwrap();

    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("COLA", "Cola", money, Some("cat-drinks"), None, 100, None)
        .unwrap();
    s.create_product("BURGER", "Burger", money, Some("cat-food"), None, 100, None)
        .unwrap();

    // Drinks: 2 colas × 100 = 200
    let mut cart1 = Cart::new(usd());
    cart1
        .add_line(CartLine::new(Sku::new("COLA"), 2, price(100)))
        .unwrap();
    let mut sale1 = Sale::from_cart(&cart1).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale1.created_at = now.clone();
    sale1.updated_at = now.clone();
    s.create_sale(&sale1).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale1.id, SaleStatus::Completed)
        .unwrap();

    // Food: 1 burger × 100 = 100; grand_total = 300
    let mut cart2 = Cart::new(usd());
    cart2
        .add_line(CartLine::new(Sku::new("BURGER"), 1, price(100)))
        .unwrap();
    let mut sale2 = Sale::from_cart(&cart2).unwrap();
    sale2.created_at = now.clone();
    sale2.updated_at = now.clone();
    s.create_sale(&sale2).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale2.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    assert_eq!(rows.len(), 2);
    // Drinks should be first (higher total_minor = 200), Food second (100).
    assert_eq!(rows[0].category_name, "Drinks");
    assert_eq!(rows[0].total_minor, 200);
    // Drinks: 200/300 = 66.666...%
    assert!((rows[0].percentage - 200.0 / 3.0).abs() < 0.01);
    assert_eq!(rows[1].category_name, "Food");
    assert_eq!(rows[1].total_minor, 100);
    // Food: 100/300 = 33.333...%
    assert!((rows[1].percentage - 100.0 / 3.0).abs() < 0.01);
    // Percentages should sum to ~100.
    let total_pct: f64 = rows.iter().map(|r| r.percentage).sum();
    assert!(
        (total_pct - 100.0).abs() < 0.01,
        "percentages should sum to 100"
    );
}

// ── Weekly revenue boundary / invariant tests ──────────────────

/// Non-completed sales (Draft, Active, Voided) MUST NOT appear
/// in `weekly_revenue`. Same `status='completed'` filter as the
/// daily / monthly variants — pins contract parity across.
#[test]
fn weekly_revenue_excludes_non_completed() {
    let conn = fresh();
    let s = store(&conn);
    let sku = "SKU1";
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product(sku, sku, money, None, None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), 1, price(100)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    sale.created_at = "2026-07-20T12:00:00.000Z".into();
    sale.updated_at = sale.created_at.clone();
    s.create_sale(&sale).unwrap();
    // Status stays at Draft — never advanced to Active/Completed.

    let rows = s.weekly_revenue("2026-07-01", "2026-07-31").unwrap();
    assert!(
        rows.is_empty(),
        "weekly_revenue must only include completed sales"
    );
}

/// A range narrower than a full calendar week produces exactly
/// 1 row containing the bucket. Pins that single-day queries
/// return a single weekly bucket (Sunday-based).
#[test]
fn weekly_revenue_partial_week_range() {
    let conn = fresh();
    seed_completed_sale(&conn, "SKU", 1, 100);
    // Override the seeded created_at to a known Monday.
    conn.execute(
        "UPDATE sales SET created_at = '2026-07-20T10:00:00.000Z'",
        [],
    )
    .unwrap();

    let rows = store(&conn)
        .weekly_revenue("2026-07-20", "2026-07-20")
        .unwrap();
    assert_eq!(rows.len(), 1);
    // 2026-07-20 is a Monday → Monday-first week starts the same day.
    assert_eq!(rows[0].week_start, "2026-07-20");
    assert_eq!(rows[0].total_minor, 100);
    assert_eq!(rows[0].sale_count, 1);
}

/// Leap days are bucketed to their Monday-first week by SQLite's
/// `'-6 days', 'weekday 1'` modifier. Pins: Feb 29, 2024 (Thursday)
/// falls into the week that starts Monday 2024-02-26.
#[test]
fn weekly_revenue_leap_day_falls_in_week() {
    let conn = fresh();
    seed_completed_sale(&conn, "SKU", 1, 100);
    conn.execute(
        "UPDATE sales SET created_at = '2024-02-29T10:00:00.000Z'",
        [],
    )
    .unwrap();

    let rows = store(&conn)
        .weekly_revenue("2024-02-29", "2024-02-29")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].week_start, "2024-02-26",
        "Feb 29 2024 (Thursday) -> Monday 2024-02-26"
    );
    assert_eq!(rows[0].total_minor, 100);
}

/// Week start must be Monday-first, matching the UI's `weekStartKey`
/// (tables/basket/heatmap), `rangeForGranularity('weekly')` and the
/// dev mock. Pins the two boundaries: a sale on Sunday 2026-08-16
/// belongs to the week that started Mon 2026-08-10, and a sale on a
/// Monday is its own week start.
#[test]
fn weekly_revenue_monday_first_week_start() {
    let conn = fresh();
    seed_completed_sale(&conn, "SKU", 1, 100);
    let s = store(&conn);

    // Sunday 2026-08-16 → week starting Monday 2026-08-10 (NOT the
    // preceding Sunday 2026-08-09, and not the following Sunday).
    conn.execute(
        "UPDATE sales SET created_at = '2026-08-16T10:00:00.000Z'",
        [],
    )
    .unwrap();
    let rows = s.weekly_revenue("2026-08-16", "2026-08-16").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].week_start, "2026-08-10");
    assert_eq!(rows[0].total_minor, 100);

    // A Monday sale starts its own week.
    conn.execute(
        "UPDATE sales SET created_at = '2026-08-10T10:00:00.000Z'",
        [],
    )
    .unwrap();
    let rows = s.weekly_revenue("2026-08-10", "2026-08-10").unwrap();
    assert_eq!(rows[0].week_start, "2026-08-10");
}

/// Currency zero-boundary: a sale with `total_minor = 0` MUST
/// still increment `sale_count` and contribute 0 to `total_minor`.
#[test]
fn weekly_revenue_zero_revenue_sale() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 0,
        currency: usd(),
    };
    s.create_product("ZERO", "Zero Item", money, None, None, 100, None)
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("ZERO"), 1, price(0)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.weekly_revenue("2000-01-01", "2099-12-31").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sale_count, 1, "zero-revenue sale still counted");
    assert_eq!(rows[0].total_minor, 0);
}

/// Multi-currency week: two sales in different currencies within
/// the same calendar week produce TWO rows (GROUP BY week, currency).
#[test]
fn weekly_revenue_multiple_currencies_separate_rows() {
    let conn = fresh();
    let s = store(&conn);
    let gbp = "GBP".parse().unwrap();

    // USD sale.
    let usd_money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("USD_A", "USD Item", usd_money, None, None, 100, None)
        .unwrap();
    let mut cart_usd = Cart::new(usd());
    cart_usd
        .add_line(CartLine::new(Sku::new("USD_A"), 1, price(100)))
        .unwrap();
    let mut sale_usd = Sale::from_cart(&cart_usd).unwrap();
    sale_usd.created_at = "2026-07-20T10:00:00.000Z".into();
    sale_usd.updated_at = "2026-07-20T10:00:00.000Z".into();
    s.create_sale(&sale_usd).unwrap();
    s.update_sale_status(&sale_usd.id, SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale_usd.id, SaleStatus::Completed)
        .unwrap();

    // GBP sale (separate currency). Construct GBP Money manually
    // since the `price()` helper returns USD.
    let gbp_money = Money {
        minor_units: 200,
        currency: gbp,
    };
    s.create_product("GBP_A", "GBP Item", gbp_money, None, None, 100, None)
        .unwrap();
    let mut cart_gbp = Cart::new(gbp);
    cart_gbp
        .add_line(CartLine::new(Sku::new("GBP_A"), 1, gbp_money))
        .unwrap();
    let mut sale_gbp = Sale::from_cart(&cart_gbp).unwrap();
    sale_gbp.created_at = "2026-07-22T10:00:00.000Z".into();
    sale_gbp.updated_at = "2026-07-22T10:00:00.000Z".into();
    s.create_sale(&sale_gbp).unwrap();
    s.update_sale_status(&sale_gbp.id, SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale_gbp.id, SaleStatus::Completed)
        .unwrap();

    let rows = s.weekly_revenue("2026-07-01", "2026-07-31").unwrap();
    // Both sales are in the same week (Mon 2026-07-20 -> Sun 2026-07-26).
    assert_eq!(
        rows.len(),
        2,
        "two currencies in same week should produce 2 rows"
    );
    let currencies: Vec<String> = rows.iter().map(|r| r.currency.clone()).collect();
    assert!(currencies.contains(&"USD".to_string()));
    assert!(currencies.contains(&"GBP".to_string()));
    assert!(rows.iter().all(|r| r.week_start == "2026-07-20"));
}

// ── Payment method breakdown ───────────────────────────────────

#[test]
fn payment_method_breakdown_groups_by_method() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, created_at) VALUES
            ('p1', 1000, 'USD', 1, 'completed', 'cash', '2026-07-10T09:00:00Z'),
            ('p2', 2000, 'USD', 1, 'completed', 'card', '2026-07-11T09:00:00Z'),
            ('p3', 500,  'USD', 1, 'completed', 'cash', '2026-07-12T09:00:00Z');",
    )
    .unwrap();
    let rows = store(&conn)
        .payment_method_breakdown("2026-07-01", "2026-07-31")
        .unwrap();
    let cash = rows.iter().find(|r| r.payment_method == "cash").unwrap();
    let card = rows.iter().find(|r| r.payment_method == "card").unwrap();
    assert_eq!(cash.total_minor, 1500);
    assert_eq!(cash.sale_count, 2);
    assert_eq!(card.total_minor, 2000);
    assert_eq!(card.sale_count, 1);
    // Highest revenue first
    assert_eq!(rows[0].payment_method, "card");
}

#[test]
fn payment_method_breakdown_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .payment_method_breakdown("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

// ── Voided sales summary ───────────────────────────────────────

#[test]
fn voided_sales_summary_counts_and_totals() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at) VALUES
            ('v1', 1000, 'USD', 1, 'voided',    '2026-07-10T09:00:00Z'),
            ('v2', 2500, 'USD', 1, 'voided',    '2026-07-11T09:00:00Z'),
            ('c1', 900,  'USD', 1, 'completed', '2026-07-12T09:00:00Z');",
    )
    .unwrap();
    // REP-06: per-currency rows (single currency → one row).
    let rows = store(&conn)
        .voided_sales_summary("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].void_count, 2);
    assert_eq!(rows[0].void_total_minor, 3500);
}

#[test]
fn voided_sales_summary_empty() {
    let conn = fresh();
    let rows = store(&conn)
        .voided_sales_summary("2000-01-01", "2099-12-31")
        .unwrap();
    assert!(rows.is_empty());
}

// ── Voided items ───────────────────────────────────────────────

#[test]
fn voided_items_ranks_products_by_qty() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("A", "Alpha", money, None, None, 100, None)
        .unwrap();
    s.create_product("B", "Beta", money, None, None, 100, None)
        .unwrap();
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("A"), 3, price(100)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("B"), 1, price(100)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Voided).unwrap();

    let rows = s.voided_items("2000-01-01", "2099-12-31", 5).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].name, "Alpha");
    assert_eq!(rows[0].qty, 3);
    assert_eq!(rows[1].name, "Beta");
}

// ── Average basket size ────────────────────────────────────────

#[test]
fn avg_basket_size_computes_mean_line_count() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at) VALUES
            ('b1', 1000, 'USD', 2, 'completed', '2026-07-10T09:00:00Z'),
            ('b2', 2000, 'USD', 4, 'completed', '2026-07-11T09:00:00Z'),
            ('b3', 500,  'USD', 1, 'voided',    '2026-07-12T09:00:00Z');",
    )
    .unwrap();
    let row = store(&conn)
        .avg_basket_size("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(row.sale_count, 2);
    assert!((row.avg_line_count - 3.0).abs() < 1e-9);
}

#[test]
fn avg_basket_size_empty() {
    let conn = fresh();
    let row = store(&conn)
        .avg_basket_size("2000-01-01", "2099-12-31")
        .unwrap();
    assert_eq!(row.sale_count, 0);
    assert_eq!(row.avg_line_count, 0.0);
}

// ── Customer split ─────────────────────────────────────────────

#[test]
fn customer_split_new_vs_returning() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO customers (id, name, created_at, updated_at) VALUES
            ('cust-returning', 'Returning', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
            ('cust-new',       'New',       '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, customer_id, created_at) VALUES
            ('old1', 100, 'USD', 1, 'completed', 'cust-returning', '2026-06-01T09:00:00Z'),
            ('r1',   200, 'USD', 1, 'completed', 'cust-returning', '2026-07-10T09:00:00Z'),
            ('n1',   300, 'USD', 1, 'completed', 'cust-new',       '2026-07-11T09:00:00Z'),
            ('n2',   400, 'USD', 1, 'completed', 'cust-new',       '2026-07-12T09:00:00Z'),
            ('anon', 500, 'USD', 1, 'completed', NULL,             '2026-07-13T09:00:00Z');",
    )
    .unwrap();
    let row = store(&conn)
        .customer_split("2026-07-01", "2026-07-31")
        .unwrap();
    // cust-new has no sale before the range -> new; cust-returning does -> returning.
    assert_eq!(row.new_count, 1);
    assert_eq!(row.returning_count, 1);
}

#[test]
fn customer_split_empty() {
    let conn = fresh();
    let row = store(&conn)
        .customer_split("2000-01-01", "2099-12-31")
        .unwrap();
    assert_eq!(row.new_count, 0);
    assert_eq!(row.returning_count, 0);
}

// ── Discounts summary ──────────────────────────────────────────

#[test]
fn discounts_summary_counts_and_lists_codes() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, discount_percent, discount_label, created_at) VALUES
            ('d1', 1000, 'USD', 1, 'completed', 10, 'WELCOME10', '2026-07-10T09:00:00Z'),
            ('d2', 2000, 'USD', 1, 'completed', 15, 'WELCOME10', '2026-07-11T09:00:00Z'),
            ('d3', 500,  'USD', 1, 'completed', 5,  'PROMO8.8',  '2026-07-12T09:00:00Z'),
            ('d4', 300,  'USD', 1, 'completed', 0,  NULL,        '2026-07-13T09:00:00Z');",
    )
    .unwrap();
    let row = store(&conn)
        .discounts_summary("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(row.sale_count, 4);
    assert_eq!(row.discounted_sale_count, 3);
    assert!((row.share_percent - 75.0).abs() < 1e-9);
    assert_eq!(row.codes.len(), 2);
    assert_eq!(row.codes[0].label, "WELCOME10");
    assert_eq!(row.codes[0].redeemed_count, 2);
}

// ── Inventory turnover + trend ─────────────────────────────────

#[test]
fn inventory_turnover_uses_stock_summary_and_range() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("A", "Alpha", money, None, None, 10, None)
        .unwrap();
    s.create_product("B", "Beta", money, None, None, 20, None)
        .unwrap();
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("A"), 3, price(100)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();

    let row = s
        .inventory_turnover(
            "2000-01-01",
            "2099-12-31",
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        )
        .unwrap();
    assert_eq!(row.units_sold, 3);
    assert_eq!(row.sku_count, 2);
    assert_eq!(row.range_days, 36525); // 2000-01-01 ..= 2099-12-31 (25 leap years)
    // stock_on_hand reflects the seeded inventory rows for the two products.
    assert_eq!(row.stock_on_hand, 30);
}

#[test]
fn inventory_trend_returns_daily_units() {
    let conn = fresh();
    let s = store(&conn);
    let money = Money {
        minor_units: 100,
        currency: usd(),
    };
    s.create_product("A", "Alpha", money, None, None, 100, None)
        .unwrap();
    // Two completed sales for product A on the same day (7 units total).
    for qty in [2, 5] {
        let mut cart = Cart::new(usd());
        cart.add_line(CartLine::new(Sku::new("A"), qty, price(100)))
            .unwrap();
        let mut sale = Sale::from_cart(&cart).unwrap();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        sale.created_at = now.clone();
        sale.updated_at = now;
        s.create_sale(&sale).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
        s.update_sale_status(&sale.id, SaleStatus::Completed)
            .unwrap();
    }
    let rows = s.inventory_trend("2000-01-01", "2099-12-31").unwrap();
    // Both sales share the same day -> one row with 7 units.
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].units_sold, 7);
}

// ── Table turnover ────────────────────────────────────────────

#[test]
fn table_turnover_counts_completed_table_orders() {
    let conn = fresh();
    let s = store(&conn);
    let t1 = seed_completed_sale(&conn, "STEAK", 1, 12000);
    let t2 = seed_completed_sale(&conn, "PASTA", 2, 9000);
    let takeaway = seed_completed_sale(&conn, "SANDWICH", 1, 5000);
    // Two table-service orders with a table number, one takeaway without.
    for sale_id in [&t1, &t2] {
        s.create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "x".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: Some("T5".into()),
            priority: false,
        })
        .unwrap();
    }
    s.create_kds_order(CreateKdsOrderInput {
        sale_id: takeaway.clone(),
        store_id: None,
        items_summary: "x".into(),
        item_count: 1,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap();

    let rows = s.table_turnover("2000-01-01", "2099-12-31").unwrap();
    // Both table orders share today's date -> one row counting 2 turns;
    // the takeaway order is excluded.
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].table_orders, 2);
}

#[test]
fn hourly_table_activity_groups_completed_table_orders_by_hour() {
    let conn = fresh();
    let s = store(&conn);
    let t1 = seed_completed_sale(&conn, "STEAK", 1, 12000);
    let t2 = seed_completed_sale(&conn, "PASTA", 2, 9000);
    let t3 = seed_completed_sale(&conn, "SANDWICH", 1, 5000);
    // Two table-service orders at distinct hours, one takeaway without a
    // table number that must be excluded.
    for (sale_id, at) in [
        (&t1, "2026-01-01T08:30:00.000Z"),
        (&t2, "2026-01-01T12:45:00.000Z"),
    ] {
        s.create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "x".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: Some("T5".into()),
            priority: false,
        })
        .unwrap();
        // Pin the completion hour so the grouping is deterministic.
        conn.execute(
            "UPDATE sales SET created_at = ?1 WHERE id = ?2",
            params![at, sale_id],
        )
        .unwrap();
    }
    s.create_kds_order(CreateKdsOrderInput {
        sale_id: t3.clone(),
        store_id: None,
        items_summary: "x".into(),
        item_count: 1,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap();

    let rows = s.hourly_table_activity("2000-01-01", "2099-12-31").unwrap();
    // Two table orders at hours 8 and 12 -> two rows; the takeaway is
    // excluded entirely.
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].hour, 8);
    assert_eq!(rows[0].table_orders, 1);
    assert_eq!(rows[1].hour, 12);
    assert_eq!(rows[1].table_orders, 1);
}

#[test]
fn basket_size_trend_groups_daily_averages() {
    let conn = fresh();
    let s = store(&conn);
    let t1 = seed_completed_sale(&conn, "STEAK", 1, 12000);
    let t2 = seed_completed_sale(&conn, "PASTA", 1, 9000);
    // A two-line sale so the average can exceed 1.
    s.create_product("SIDE", "SIDE", price(4000), None, None, 100, None)
        .unwrap();
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("STEAK"), 1, price(12000)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("SIDE"), 1, price(4000)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    sale.created_at = "2026-01-02T12:00:00.000Z".into();
    sale.updated_at = sale.created_at.clone();
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    let t3 = sale.id;
    // Pin the first two single-line sales to the day before.
    for (id, at) in [
        (&t1, "2026-01-01T08:00:00.000Z"),
        (&t2, "2026-01-01T10:00:00.000Z"),
    ] {
        conn.execute(
            "UPDATE sales SET created_at = ?1 WHERE id = ?2",
            params![at, id],
        )
        .unwrap();
    }

    let rows = s.basket_size_trend("2000-01-01", "2099-12-31").unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].date, "2026-01-01");
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].avg_line_count, 1.0);
    assert_eq!(rows[1].date, "2026-01-02");
    assert_eq!(rows[1].sale_count, 1);
    assert_eq!(rows[1].avg_line_count, 2.0);
    let _ = t3;
}

// ── REP-04: refund netting on revenue reports ──────────────────
//
// Refunds never change the sale row (status stays 'completed'), so the
// revenue queries counted refunded sales at full value and the refund
// ledger was invisible in every report. These tests pin the netting:
// gross revenue unchanged, `refund_minor` attributed to the REFUND's
// own day/week/month (accounting convention), `net_revenue_minor`
// derived, per currency — and refund-only periods must still produce
// a row (a day with only refunds must not silently drop the refund).

fn seed_completed_sale_at(conn: &Connection, id: &str, total: i64, currency: &str, date: &str) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at)
         VALUES (?1, ?2, ?3, 1, 'completed', ?4)",
        params![id, total, currency, format!("{date}T09:00:00Z")],
    )
    .unwrap();
}

fn seed_refund_at(
    conn: &Connection,
    id: &str,
    sale_id: &str,
    total: i64,
    currency: &str,
    date: &str,
) {
    conn.execute(
        "INSERT INTO refunds (id, sale_id, total_minor, currency, processed_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'user-1', ?5)",
        params![id, sale_id, total, currency, format!("{date}T12:00:00Z")],
    )
    .unwrap();
}

#[test]
fn daily_revenue_nets_refunds_on_refund_day() {
    let conn = fresh();
    seed_completed_sale_at(&conn, "rn-1", 1000, "USD", "2026-07-10");
    seed_refund_at(&conn, "rf-1", "rn-1", 300, "USD", "2026-07-10");
    let rows = store(&conn)
        .daily_revenue("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].total_minor, 1000, "gross revenue unchanged");
    assert_eq!(rows[0].refund_minor, 300);
    assert_eq!(rows[0].net_revenue_minor, 700);
}

#[test]
fn daily_revenue_attributes_refund_to_refund_day_not_sale_day() {
    let conn = fresh();
    seed_completed_sale_at(&conn, "rn-2", 1000, "USD", "2026-07-10");
    seed_refund_at(&conn, "rf-2", "rn-2", 400, "USD", "2026-07-15");
    let rows = store(&conn)
        .daily_revenue("2026-07-01", "2026-07-31")
        .unwrap();
    // Two rows: the sale day (gross, no refund) and the refund day
    // (zero revenue, refund, NEGATIVE net — the refund is visible).
    assert_eq!(rows.len(), 2, "refund-only day must produce a row");
    let sale_day = rows.iter().find(|r| r.date == "2026-07-10").unwrap();
    assert_eq!(sale_day.total_minor, 1000);
    assert_eq!(sale_day.refund_minor, 0);
    assert_eq!(sale_day.net_revenue_minor, 1000);
    let refund_day = rows.iter().find(|r| r.date == "2026-07-15").unwrap();
    assert_eq!(refund_day.total_minor, 0);
    assert_eq!(refund_day.sale_count, 0);
    assert_eq!(refund_day.refund_minor, 400);
    assert_eq!(refund_day.net_revenue_minor, -400);
}

#[test]
fn daily_revenue_refund_netting_is_per_currency() {
    let conn = fresh();
    seed_completed_sale_at(&conn, "rn-usd", 1000, "USD", "2026-07-10");
    seed_completed_sale_at(&conn, "rn-idr", 165000, "IDR", "2026-07-10");
    seed_refund_at(&conn, "rf-usd", "rn-usd", 500, "USD", "2026-07-10");
    let rows = store(&conn)
        .daily_revenue("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 2);
    let usd_row = rows.iter().find(|r| r.currency == "USD").unwrap();
    let idr_row = rows.iter().find(|r| r.currency == "IDR").unwrap();
    assert_eq!(usd_row.refund_minor, 500);
    assert_eq!(usd_row.net_revenue_minor, 500);
    assert_eq!(
        idr_row.refund_minor, 0,
        "USD refund must not net IDR revenue"
    );
    assert_eq!(idr_row.net_revenue_minor, 165000);
}

#[test]
fn weekly_revenue_nets_refunds() {
    let conn = fresh();
    // Friday sale + Sunday refund: same Monday-first week (07-06..07-12).
    seed_completed_sale_at(&conn, "rw-1", 2000, "USD", "2026-07-10");
    seed_refund_at(&conn, "rf-w1", "rw-1", 600, "USD", "2026-07-12");
    let rows = store(&conn)
        .weekly_revenue("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].total_minor, 2000);
    assert_eq!(rows[0].refund_minor, 600);
    assert_eq!(rows[0].net_revenue_minor, 1400);
}

#[test]
fn monthly_revenue_nets_refunds() {
    let conn = fresh();
    seed_completed_sale_at(&conn, "rm-1", 5000, "USD", "2026-07-10");
    seed_refund_at(&conn, "rf-m1", "rm-1", 1200, "USD", "2026-07-28");
    let rows = store(&conn)
        .monthly_revenue("2026-01-01", "2026-12-31")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].total_minor, 5000);
    assert_eq!(rows[0].refund_minor, 1200);
    assert_eq!(rows[0].net_revenue_minor, 3800);
}

// ── REP-06: per-currency report aggregation ────────────────────
//
// top_products, hourly_heatmap, category_breakdown,
// payment_method_breakdown and voided_sales_summary summed minor
// units across currencies into one number (the REP-02 class bug
// below the revenue trends). Each must aggregate per currency.

// REP-06 helper: 8 params is the natural shape for seeding a sale + its
// single line; restructuring into a params struct would obscure the 11
// call sites more than the extra argument does.
#[allow(clippy::too_many_arguments)]
fn seed_sale_with_line(
    conn: &Connection,
    sale_id: &str,
    sku: &str,
    currency: &str,
    line_minor: i64,
    method: &str,
    status: &str,
    date: &str,
) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, created_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)",
        params![sale_id, line_minor, currency, status, method, format!("{date}T10:00:00Z")],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5, 0)",
        params![format!("sl-{sale_id}"), sale_id, sku, line_minor, currency],
    )
    .unwrap();
}

#[test]
fn top_products_separates_currencies() {
    let conn = fresh();
    let s = store(&conn);
    s.create_product("LATTE", "Latte", price(350), None, None, 100, None)
        .unwrap();
    seed_sale_with_line(
        &conn,
        "tp-usd",
        "LATTE",
        "USD",
        700,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "tp-idr",
        "LATTE",
        "IDR",
        115500,
        "cash",
        "completed",
        "2026-07-10",
    );
    let rows = s
        .top_products("2026-07-01", "2026-07-31", 10, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 2, "one row per (product, currency)");
    let usd_row = rows.iter().find(|r| r.currency == "USD").unwrap();
    assert_eq!(usd_row.total_minor, 700);
    assert_eq!(usd_row.total_qty, 1);
    let idr_row = rows.iter().find(|r| r.currency == "IDR").unwrap();
    assert_eq!(idr_row.total_minor, 115500);
}

#[test]
fn hourly_heatmap_separates_currencies() {
    let conn = fresh();
    seed_sale_with_line(
        &conn,
        "hm-usd",
        "COFFEE",
        "USD",
        1000,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "hm-idr",
        "COFFEE",
        "IDR",
        165000,
        "cash",
        "completed",
        "2026-07-10",
    );
    let rows = store(&conn)
        .hourly_heatmap("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 2);
    for row in &rows {
        assert_eq!(row.hour, 10);
    }
    let usd_row = rows.iter().find(|r| r.currency == "USD").unwrap();
    assert_eq!(usd_row.total_minor, 1000);
    let idr_row = rows.iter().find(|r| r.currency == "IDR").unwrap();
    assert_eq!(idr_row.total_minor, 165000);
}

#[test]
fn category_breakdown_percentages_are_per_currency() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-1", "Beverages", "#fff", "").unwrap();
    s.create_category("cat-2", "Bakery", "#eee", "").unwrap();
    s.create_product("P1", "One", price(100), Some("cat-1"), None, 100, None)
        .unwrap();
    s.create_product("P2", "Two", price(100), Some("cat-2"), None, 100, None)
        .unwrap();
    s.create_product("P3", "Three", price(100), Some("cat-1"), None, 100, None)
        .unwrap();
    seed_sale_with_line(
        &conn,
        "cb-1",
        "P1",
        "USD",
        1000,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "cb-2",
        "P2",
        "USD",
        300,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "cb-3",
        "P3",
        "IDR",
        165000,
        "cash",
        "completed",
        "2026-07-10",
    );
    let rows = s.category_breakdown("2026-07-01", "2026-07-31").unwrap();
    assert_eq!(rows.len(), 3, "one row per (category, currency)");
    let usd_rows: Vec<_> = rows.iter().filter(|r| r.currency == "USD").collect();
    let idr_rows: Vec<_> = rows.iter().filter(|r| r.currency == "IDR").collect();
    assert_eq!(usd_rows.len(), 2);
    assert_eq!(idr_rows.len(), 1);
    // Percentages normalize WITHIN the currency, never across.
    let usd_pct_sum: f64 = usd_rows.iter().map(|r| r.percentage).sum();
    assert!(
        (usd_pct_sum - 100.0).abs() < 0.001,
        "USD percentages must sum to 100, got {usd_pct_sum}"
    );
    let bev_usd = usd_rows
        .iter()
        .find(|r| r.category_id == Some("cat-1".into()))
        .unwrap_or(&usd_rows[0]);
    let _ = bev_usd;
    assert!((idr_rows[0].percentage - 100.0).abs() < f64::EPSILON);
}

#[test]
fn payment_method_breakdown_separates_currencies() {
    let conn = fresh();
    seed_sale_with_line(
        &conn,
        "pm-1",
        "COFFEE",
        "USD",
        1000,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "pm-2",
        "COFFEE",
        "IDR",
        165000,
        "cash",
        "completed",
        "2026-07-10",
    );
    seed_sale_with_line(
        &conn,
        "pm-3",
        "COFFEE",
        "IDR",
        50000,
        "qris",
        "completed",
        "2026-07-10",
    );
    let rows = store(&conn)
        .payment_method_breakdown("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 3, "cash appears once per currency");
    let cash_usd = rows
        .iter()
        .find(|r| r.payment_method == "cash" && r.currency == "USD")
        .unwrap();
    assert_eq!(cash_usd.total_minor, 1000);
    let cash_idr = rows
        .iter()
        .find(|r| r.payment_method == "cash" && r.currency == "IDR")
        .unwrap();
    assert_eq!(cash_idr.total_minor, 165000);
}

#[test]
fn voided_sales_summary_groups_by_currency() {
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at) VALUES
            ('v-usd-1', 1000,   'USD', 1, 'voided', '2026-07-10T09:00:00Z'),
            ('v-usd-2', 500,    'USD', 1, 'voided', '2026-07-11T09:00:00Z'),
            ('v-idr-1', 165000, 'IDR', 1, 'voided', '2026-07-11T09:00:00Z');",
    )
    .unwrap();
    let rows = store(&conn)
        .voided_sales_summary("2026-07-01", "2026-07-31")
        .unwrap();
    assert_eq!(rows.len(), 2);
    let usd_row = rows.iter().find(|r| r.currency == "USD").unwrap();
    assert_eq!(usd_row.void_count, 2);
    assert_eq!(usd_row.void_total_minor, 1500);
    let idr_row = rows.iter().find(|r| r.currency == "IDR").unwrap();
    assert_eq!(idr_row.void_count, 1);
    assert_eq!(idr_row.void_total_minor, 165000);
}

// ── REP-05 (rewrite half): sale-line product snapshots ─────────────
//
// sale_lines now stores product_id / product_name / category_id at
// sale creation. Reports read the snapshot first and fall back to the
// mutable products join for legacy rows, so renaming a product,
// moving it between categories, or reusing a deleted product's sku
// can no longer relabel historical revenue.

/// Seed a product with a real name + optional category and one
/// completed sale; returns the sale id.
fn seed_named_sale(
    conn: &Connection,
    sku: &str,
    name: &str,
    category: Option<&str>,
    qty: i64,
    unit: i64,
) -> String {
    let s = store(conn);
    let money = Money {
        minor_units: unit,
        currency: usd(),
    };
    s.create_product(sku, name, money, category, None, 100, None)
        .unwrap();
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), qty, price(unit)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Active).unwrap();
    s.update_sale_status(&sale.id, SaleStatus::Completed)
        .unwrap();
    sale.id
}

#[test]
fn create_sale_snapshots_product_identity_on_lines() {
    let conn = fresh();
    store(&conn)
        .create_category("cat-drinks", "Drinks", "#00f", "")
        .unwrap();
    seed_named_sale(&conn, "SNAP-1", "Caffe Latte", Some("cat-drinks"), 1, 500);
    let (pid, pname, cid): (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT product_id, product_name, category_id FROM sale_lines WHERE sku = 'SNAP-1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    let product_id: String = conn
        .query_row("SELECT id FROM products WHERE sku = 'SNAP-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(pid.as_deref(), Some(product_id.as_str()));
    assert_eq!(pname.as_deref(), Some("Caffe Latte"));
    assert_eq!(cid.as_deref(), Some("cat-drinks"));
}

#[test]
fn top_products_keeps_snapshot_name_after_rename() {
    let conn = fresh();
    let s = store(&conn);
    seed_named_sale(&conn, "RN-1", "Caffe Latte", None, 2, 500);
    conn.execute(
        "UPDATE products SET name = 'Caffè Mocha' WHERE sku = 'RN-1'",
        [],
    )
    .unwrap();
    let rows = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].name, "Caffe Latte",
        "historical revenue must keep the name the product had at sale time"
    );
    assert_eq!(rows[0].total_minor, 1000);
}

#[test]
fn category_breakdown_keeps_snapshot_category_after_move() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-drinks", "Drinks", "#00f", "")
        .unwrap();
    s.create_category("cat-food", "Food", "#f00", "").unwrap();
    seed_named_sale(&conn, "MV-1", "Latte", Some("cat-drinks"), 1, 500);
    // Move the product to another category AFTER the sale.
    conn.execute(
        "UPDATE products SET category_id = 'cat-food' WHERE sku = 'MV-1'",
        [],
    )
    .unwrap();
    let rows = s.category_breakdown("2000-01-01", "2099-12-31").unwrap();
    assert_eq!(rows.len(), 1, "the sale must not move to Food");
    assert_eq!(rows[0].category_id.as_deref(), Some("cat-drinks"));
    assert_eq!(rows[0].category_name, "Drinks");
    assert_eq!(rows[0].total_minor, 500);
}

#[test]
fn top_products_splits_rows_when_sku_is_reused() {
    let conn = fresh();
    let s = store(&conn);
    seed_named_sale(&conn, "REUSE", "Old Widget", None, 1, 400);
    conn.execute("DELETE FROM products WHERE sku = 'REUSE'", [])
        .unwrap();
    seed_named_sale(&conn, "REUSE", "New Widget", None, 1, 600);
    let rows = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 2, "each sale era keeps its own snapshot label");
    let old = rows.iter().find(|r| r.name == "Old Widget").unwrap();
    let new = rows.iter().find(|r| r.name == "New Widget").unwrap();
    assert_eq!(old.total_minor, 400);
    assert_eq!(new.total_minor, 600);
}

#[test]
fn reports_fall_back_to_join_for_legacy_null_snapshots() {
    // Rows written before the snapshot migration have NULL snapshots;
    // reports must keep working via the products join (best-effort
    // labelling, identical to pre-fix behavior).
    let conn = fresh();
    let s = store(&conn);
    seed_named_sale(&conn, "LEG-1", "Legacy Name", None, 1, 700);
    conn.execute(
        "UPDATE sale_lines SET product_id = NULL, product_name = NULL, category_id = NULL WHERE sku = 'LEG-1'",
        [],
    )
    .unwrap();
    let rows = s
        .top_products("2000-01-01", "2099-12-31", 10, "revenue")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].name, "Legacy Name");
    assert_eq!(rows[0].total_minor, 700);
}

// ── REP-03: store-timezone bucketing ───────────────────────────────
//
// Contract: locations.timezone holds a FIXED UTC OFFSET string
// ('+HH:MM' / '-HH:MM' / 'UTC'). IANA names are NOT interpreted (no
// tzdata dependency in core) — anything unparseable falls back to UTC
// so a misconfigured store never silently shifts money into wrong
// buckets without an obvious audit trail. All report date bucketing
// uses DATE(created_at, <offset>) and the UI submits store-local
// boundary dates.

fn set_primary_store_tz(conn: &Connection, tz: &str) {
    conn.execute(
        "INSERT INTO locations (id, name, timezone, is_primary)
         VALUES ('store-tz', 'TZ Store', ?1, 1)
         ON CONFLICT(id) DO UPDATE SET timezone = excluded.timezone",
        params![tz],
    )
    .unwrap();
}

fn seed_sale_at_full(conn: &Connection, id: &str, total: i64, currency: &str, at: &str) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at)
         VALUES (?1, ?2, ?3, 1, 'completed', ?4)",
        params![id, total, currency, at],
    )
    .unwrap();
}

#[test]
fn daily_revenue_buckets_by_store_timezone() {
    let conn = fresh();
    let s = store(&conn);
    set_primary_store_tz(&conn, "+01:00");
    // 23:30Z is 00:30 next day in UTC+1 — the sale belongs to 07-11.
    seed_sale_at_full(&conn, "tz-d1", 5000, "USD", "2026-07-10T23:30:00.000Z");
    let rows = s.daily_revenue("2026-07-11", "2026-07-11").unwrap();
    assert_eq!(
        rows.len(),
        1,
        "a UTC+1 store's day must include the 23:30Z sale"
    );
    assert!(
        rows[0].date.starts_with("2026-07-11"),
        "got {}",
        rows[0].date
    );
    assert_eq!(rows[0].total_minor, 5000);
}

#[test]
fn hourly_heatmap_shifts_hours_with_store_timezone() {
    let conn = fresh();
    let s = store(&conn);
    set_primary_store_tz(&conn, "+02:00");
    // Monday 22:30Z → Tuesday 00:30 local. %w: 0=Sun → Tuesday = 2.
    seed_sale_at_full(&conn, "tz-h1", 1000, "USD", "2026-07-06T22:30:00.000Z");
    let rows = s.hourly_heatmap("2026-07-06", "2026-07-07").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].day_of_week, 2, "store-local day must be Tuesday");
    assert_eq!(rows[0].hour, 0, "store-local hour must be 00");
}

#[test]
fn weekly_revenue_week_key_shifts_across_store_timezone() {
    let conn = fresh();
    let s = store(&conn);
    set_primary_store_tz(&conn, "-05:00");
    // Monday 01:00Z → Sunday 20:00 local → the PREVIOUS Monday-first week.
    seed_sale_at_full(&conn, "tz-w1", 3000, "USD", "2026-07-06T01:00:00.000Z");
    let rows = s.weekly_revenue("2026-06-29", "2026-07-05").unwrap();
    assert_eq!(
        rows.len(),
        1,
        "the sale lands in the week starting 2026-06-29 for UTC-5"
    );
    assert!(rows[0].week_start.starts_with("2026-06-29"));
    assert_eq!(rows[0].total_minor, 3000);
}

#[test]
fn refunds_net_in_store_timezone() {
    let conn = fresh();
    let s = store(&conn);
    set_primary_store_tz(&conn, "+03:00");
    seed_sale_at_full(&conn, "tz-r1", 9000, "USD", "2026-07-01T08:00:00.000Z");
    // 22:00Z is 01:00 next day at UTC+3 → the refund belongs to 07-11.
    conn.execute(
        "INSERT INTO refunds (id, sale_id, total_minor, currency, processed_by, created_at)
         VALUES ('tz-rf1', 'tz-r1', 500, 'USD', 'user-1', '2026-07-10T22:00:00.000Z')",
        [],
    )
    .unwrap();
    let rows = s.daily_revenue("2026-07-11", "2026-07-11").unwrap();
    assert_eq!(rows.len(), 1, "refund-only store-local day must appear");
    assert_eq!(rows[0].refund_minor, 500);
    assert_eq!(rows[0].total_minor, 0);
    assert_eq!(rows[0].net_revenue_minor, -500);
}

#[test]
fn report_rejects_malformed_date_bounds() {
    let conn = fresh();
    let s = store(&conn);
    for bad in [
        "2026-7-01",
        "2026-07-1",
        "20260701",
        "2026-13-01",
        "2026-07-32",
        "",
    ] {
        let err = s
            .daily_revenue(bad, "2026-07-31")
            .expect_err(&format!("{bad:?} must be rejected"));
        assert!(
            matches!(err, crate::CoreError::Validation { .. }),
            "expected Validation for {bad:?}, got {err:?}"
        );
    }
    // Valid bounds still accepted.
    s.daily_revenue("2026-07-01", "2026-07-31").unwrap();
}

#[test]
fn iana_timezone_names_fall_back_to_utc() {
    let conn = fresh();
    let s = store(&conn);
    set_primary_store_tz(&conn, "Asia/Jakarta");
    seed_sale_at_full(&conn, "tz-i1", 5000, "USD", "2026-07-10T23:30:00.000Z");
    let rows = s.daily_revenue("2026-07-10", "2026-07-10").unwrap();
    assert_eq!(
        rows.len(),
        1,
        "unparseable timezone must not shift buckets — UTC semantics"
    );
}

#[test]
fn no_store_profile_defaults_to_utc() {
    let conn = fresh();
    let s = store(&conn);
    seed_sale_at_full(&conn, "tz-n1", 5000, "USD", "2026-07-10T23:30:00.000Z");
    let rows = s.daily_revenue("2026-07-10", "2026-07-10").unwrap();
    assert_eq!(rows.len(), 1);
}
