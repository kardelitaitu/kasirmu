use super::*;
use kasirmu_core::migrations;
use kasirmu_core::{Cart, CartLine, Currency, Money, Sale, SaleStatus, Sku};
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
    let store = kasirmu_core::db::Store::new(conn);
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
    let store = kasirmu_core::db::Store::new(conn);
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
    assert_eq!(result.median_volume, 0);
    assert_eq!(result.median_margin, 0);
    assert_eq!(result.median_margin_range(), (0, 0));
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
    assert_eq!(result.median_volume, 2);
    assert_eq!(result.median_margin, 3400);
    assert_eq!(result.median_margin_range(), (3400, 3400));
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
        classify_quadrant(100, 5000, 50, MarginMedian::point(2500)),
        MenuQuadrant::Star
    );
}

#[test]
fn classify_plowhorse() {
    assert_eq!(
        classify_quadrant(100, 1000, 50, MarginMedian::point(2500)),
        MenuQuadrant::Plowhorse
    );
}

#[test]
fn classify_puzzle() {
    assert_eq!(
        classify_quadrant(10, 5000, 50, MarginMedian::point(2500)),
        MenuQuadrant::Puzzle
    );
}

#[test]
fn classify_dog() {
    assert_eq!(
        classify_quadrant(10, 1000, 50, MarginMedian::point(2500)),
        MenuQuadrant::Dog
    );
}

#[test]
fn classify_boundary_equal_median() {
    assert_eq!(
        classify_quadrant(50, 2500, 50, MarginMedian::point(2500)),
        MenuQuadrant::Star
    );
}

#[test]
fn classify_zero_values() {
    assert_eq!(
        classify_quadrant(0, 0, 0, MarginMedian::point(0)),
        MenuQuadrant::Star
    );
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
    let result = median_of(&items, |&x| x);
    assert_eq!(result, MarginMedian::point(0));
    assert_eq!(result.lower_upper(), (0, 0));
    assert_eq!(result.high_water_mark(), 0);
}

/// (a) Odd-length set: the median is a single middle element, and the
/// published threshold is that same element — no rounding anywhere.
#[test]
fn median_odd_count_is_the_exact_middle_element() {
    let items = vec![30, 10, 20]; // deliberately unsorted
    let result = median_of(&items, |&x| x);
    assert_eq!(result, MarginMedian::point(20));
    assert_eq!(result.lower_upper(), (20, 20));
    assert_eq!(result.high_water_mark(), 20);
}

/// (b) Even-length set: the exact median is 25, an INTEGER even though it is
/// not an element, so the published threshold is 25 itself and no rounding
/// happens. The half unit is exercised by the odd-sum test below.
#[test]
fn median_even_count_with_integer_mean_is_exact() {
    let items = vec![40, 10, 30, 20];
    let result = median_of(&items, |&x| x);
    assert_eq!(result.lower_upper(), (20, 30));
    assert_eq!(result.high_water_mark(), 25);
}

/// (b, odd sum) Even-length set whose mean is NOT an integer: `{4, 5}` has
/// median 4.5, so the published threshold is its ceil, 5.
#[test]
fn median_even_count_with_odd_sum_publishes_the_ceil() {
    let result = median_of(&[4_i64, 5], |&x| x);
    assert_eq!(result.lower_upper(), (4, 5));
    assert_eq!(result.high_water_mark(), 5);
}

#[test]
fn median_single_element() {
    let items = vec![42];
    let result = median_of(&items, |&x| x);
    assert_eq!(result, MarginMedian::point(42));
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
        currency: "USD".into(),
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
    assert_eq!(
        classify_quadrant(100, 0, 50, MarginMedian::point(-500)),
        MenuQuadrant::Star
    );
    // High volume, equal-to-negative-median (0 >= -500) -> Star.
    assert_eq!(
        classify_quadrant(100, -500, 50, MarginMedian::point(-500)),
        MenuQuadrant::Star
    );
    // Low volume (10 < 50), equal-to-negative-median margin → Puzzle.
    assert_eq!(
        classify_quadrant(10, -500, 50, MarginMedian::point(-500)),
        MenuQuadrant::Puzzle
    );
    // Low volume, below negative median → Dog.
    assert_eq!(
        classify_quadrant(10, -600, 50, MarginMedian::point(-500)),
        MenuQuadrant::Dog
    );
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
    let v_odd = vec![-10_i64, 0, 10];
    assert_eq!(median_of(&v_odd, |&x| x), MarginMedian::point(0));

    let v_even = vec![-10_i64, 0];
    assert_eq!(median_of(&v_even, |&x| x).lower_upper(), (-10, 0));
    // Exact median is -5, an integer even though the bounds straddle it.
    assert_eq!(median_of(&v_even, |&x| x).high_water_mark(), -5);

    let v_all_neg = vec![-30_i64, -20, -10];
    assert_eq!(median_of(&v_all_neg, |&x| x), MarginMedian::point(-20));
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

// ── C22: currency separation ─────────────────────────────────────────
//
// C22: this report summed every line regardless of currency, so a USD
// line and an IDR line produced ONE revenue figure that is not money in
// any currency, and the screen then formatted it with the workspace's
// default currency -- actively mislabelling it. `sale_lines.currency`
// is NOT NULL, so the fix is to group by it and carry it to the row.

/// Seed a completed sale whose line carries an explicit currency.
///
/// Built with raw SQL rather than `create_sale` because a sale's cart is
/// single-currency by construction, and this test needs one product sold
/// in two currencies in the same period — the exact shape that used to be
/// summed together.
fn seed_sale_with_line(
    conn: &Connection,
    sale_id: &str,
    sku: &str,
    currency: &str,
    line_minor: i64,
) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, ?3, 1, 'completed', '2026-07-10T10:00:00.000Z', '2026-07-10T10:00:00.000Z', ?2, 0)",
        params![sale_id, line_minor, currency],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5, 0)",
        params![format!("sl-{sale_id}"), sale_id, sku, line_minor, currency],
    )
    .unwrap();
}

/// The defect: two currencies in one period must not be added together.
#[test]
fn menu_engineering_separates_currencies() {
    let conn = fresh();
    seed_product(&conn, "LATTE", 100, 40);
    // SAME unit price in both currencies. This is what makes the fixture
    // reproduce the defect: the old GROUP BY was (product, unit_price), so
    // differing prices would have split the rows by accident and the test
    // would pass with or without the fix -- verified by reverting the fix and
    // watching it pass. Equal prices put both currencies in one row, which is
    // exactly the shape that used to be summed.
    seed_sale_with_line(&conn, "me-usd", "LATTE", "USD", 700);
    seed_sale_with_line(&conn, "me-idr", "LATTE", "IDR", 700);

    let result = query_menu_engineering(&conn, "2026-07-01", "2026-07-31").unwrap();

    assert_eq!(
        result.rows.len(),
        2,
        "one row per (product, currency): adding USD and IDR produced a single \
         meaningless total"
    );

    let usd = result.rows.iter().find(|r| r.currency == "USD").unwrap();
    assert_eq!(usd.total_revenue_minor, 700);
    assert_eq!(usd.total_volume, 1);

    let idr = result.rows.iter().find(|r| r.currency == "IDR").unwrap();
    assert_eq!(idr.total_revenue_minor, 700);
    assert_eq!(idr.total_volume, 1);

    // The bug's signature, asserted directly: nothing may carry the combined
    // total, which is money in neither currency.
    assert!(
        !result.rows.iter().any(|r| r.total_revenue_minor == 1_400),
        "1400 is the meaningless USD+IDR sum; no row may carry it"
    );
}

/// Every row must state the currency its amounts are in, because the
/// screen formats money with the workspace default otherwise.
#[test]
fn every_row_declares_its_currency() {
    let conn = fresh();
    seed_product(&conn, "LATTE", 100, 40);
    seed_sale_with_line(&conn, "me-usd2", "LATTE", "USD", 700);

    let result = query_menu_engineering(&conn, "2026-07-01", "2026-07-31").unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].currency, "USD");
    assert!(
        !result.rows[0].currency.is_empty(),
        "an empty currency would silently reformat as the workspace default"
    );
}

/// Seed one completed sale+line stamped at an explicit instant.
///
/// The plain `seed_sale_with_line` hard-codes 2026-07-10T10:00Z, which cannot
/// express a boundary. This variant exists solely so the range test below can
/// place a sale at the last millisecond of a day and at the first of the next.
fn seed_sale_at(conn: &Connection, sale_id: &str, sku: &str, at: &str, line_minor: i64) {
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
         VALUES (?1, ?2, 'USD', 1, 'completed', ?3, ?3, ?2, 0)",
        params![sale_id, line_minor, at],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position)
         VALUES (?1, ?2, ?3, 1, ?4, ?4, 'USD', 0)",
        params![format!("sl-{sale_id}"), sale_id, sku, line_minor],
    )
    .unwrap();
}

/// O-M54: the date filter is a HALF-OPEN instant range, and this pins where the
/// boundary actually falls.
///
/// The predicate used to be `DATE(created_at) BETWEEN ?1 AND ?2`, which wraps the
/// column in a function and therefore cannot use an index on
/// `sales.created_at` — every report was a full scan growing with history. It
/// is now `created_at >= ?1 AND created_at < date(?2, '+1 day')`.
///
/// The rewrite is only acceptable if it selects EXACTLY the same days. The risk
/// is the upper bound: if `date(end, '+1 day')` were compared against a column
/// that also contains a date-only string, that string would sort BEFORE the
/// bound and a sale at exactly midnight would slip into the next day. This
/// fixture places a sale on each side of the boundary — the last millisecond of
/// the end day, and the first millisecond of the following day — so a bound that
/// is off by one day, or an upper bound that is inclusive of the wrong edge,
/// fails here instead of silently shifting revenue between months.
#[test]
fn menu_engineering_range_is_half_open_on_calendar_days() {
    let conn = fresh();
    seed_product(&conn, "COFFEE", 100, 40);
    // Inside the range: the LAST millisecond of the end day must be included.
    seed_sale_at(
        &conn,
        "me-last-ms",
        "COFFEE",
        "2026-07-31T23:59:59.999Z",
        500,
    );
    // Outside: the FIRST millisecond of the next day must be excluded.
    seed_sale_at(
        &conn,
        "me-next-day",
        "COFFEE",
        "2026-08-01T00:00:00.000Z",
        999,
    );
    // Outside on the other edge: the day before the start must be excluded.
    seed_sale_at(
        &conn,
        "me-prev-day",
        "COFFEE",
        "2026-06-30T23:59:59.999Z",
        111,
    );
    // Inside: the first millisecond of the start day must be included.
    seed_sale_at(
        &conn,
        "me-first-ms",
        "COFFEE",
        "2026-07-01T00:00:00.000Z",
        250,
    );

    let result = query_menu_engineering(&conn, "2026-07-01", "2026-07-31").unwrap();

    assert_eq!(
        result.rows.len(),
        1,
        "all in-range sales of one product/currency must collapse to one row"
    );
    let row = &result.rows[0];
    assert_eq!(
        row.total_volume, 2,
        "exactly the two sales inside the range may be counted; got {}",
        row.total_volume
    );
    assert_eq!(
        row.total_revenue_minor, 750,
        "500 (last ms of end day) + 250 (first ms of start day) = 750;          999 (next day) and 111 (previous day) must be excluded"
    );
}

/// O-M54, the half that actually matters: the planner must be able to SEEK.
///
/// The boundary test above proves the rewrite selects the same DAYS. It does not
/// prove it is any faster — a full scan selects the right rows too. The defect
/// was never the answer, it was the cost: `DATE(created_at)` wraps the COLUMN in
/// a function, so SQLite cannot use `idx_sales_created_at` and every report scans
/// the whole `sales` table, growing with history.
///
/// This asserts the query plan directly, the same way
/// `migrations_tests::analytics_query_uses_status_created_date_index` does for
/// the analytics path. If a future edit reintroduces `DATE(s.created_at)` in the
/// WHERE clause, this fails and names the plan — the boundary test would still
/// pass, which is exactly why both exist.
#[test]
fn menu_engineering_date_filter_can_use_an_index() {
    let mut conn = fresh();
    migrations::run(&mut conn).unwrap();
    // SEED BEFORE PLANNING. On an empty table SQLite has no statistics and
    // answers with a scan of whichever index it likes best — measured: with zero
    // rows the OLD `DATE(created_at)` predicate came back as
    // `SCAN s USING COVERING INDEX idx_sales_created_at`, which made the
    // counterfactual below pass for a reason unrelated to the rewrite. A plan is
    // only meaningful against a table big enough for the choice to matter.
    for i in 0..200 {
        let at = format!("2026-07-{:02}T10:00:00.000Z", (i % 28) + 1);
        conn.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, subtotal_minor, tax_total_minor)
             VALUES (?1, 100, 'USD', 1, 'completed', ?2, ?2, 100, 0)",
            params![format!("plan-{i}"), at],
        )
        .unwrap();
    }
    conn.execute_batch("ANALYZE").unwrap();

    // The SAME SQL the product runs, prefixed with EXPLAIN. Reading a constant
    // rather than a copy is the whole point: the earlier version of this test
    // kept its own literal and stayed GREEN when the production predicate was
    // reverted to `DATE(s.created_at) BETWEEN ?1 AND ?2`.
    let plan_of = |conn: &Connection, sql: &str, params: [&str; 2]| -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        stmt.query_map(params, |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n")
    };
    let plan = plan_of(&conn, MENU_ENGINEERING_SQL, ["2026-07-01", "2026-07-31"]);

    // MEASURED (2026-10-22), and LESS dramatic than the debt entry claimed, so
    // these assertions state what is true rather than what the entry promised:
    //
    //   old `DATE(s.created_at) BETWEEN ?1 AND ?2`, SEEDED table:
    //     SEARCH s USING INDEX idx_sales_status_created_date
    //   new half-open range, SEEDED table:
    //     SEARCH s USING INDEX idx_sales_status_created_date
    //
    // BOTH SEEK. The reason is in `20260814_analytics_index.sql`:
    //     CREATE INDEX idx_sales_status_created_date ON sales(status, date(created_at))
    // — an EXPRESSION index built for exactly the `status = … AND
    // DATE(created_at) BETWEEN …` shape. So the "full scan that grows with
    // history" this entry describes was already fixed by that index; the
    // rewrite buys PORTABILITY, not speed.
    //
    // What the rewrite genuinely buys, and what these assertions pin: the query
    // no longer DEPENDS on an expression index existing. Drop that index and the
    // old form falls back to a scan while the new form still seeks — asserted
    // below, and mirrored in `the_old_date_predicate_depends_on_the_expression_index`.
    assert!(
        plan.contains("SEARCH"),
        "the date filter must SEEK the range, not scan the table; plan:\n{plan}"
    );
    assert!(
        !plan.contains("SCAN s"),
        "`sales` must not be scanned; plan:\n{plan}"
    );

    // FACT 3: drop the expression index and the query must STILL seek. This is
    // the real justification for the rewrite, and the only way to prove it —
    // on a schema that has only a plain `idx_sales_created_at`.
    conn.execute_batch("DROP INDEX IF EXISTS idx_sales_status_created_date")
        .unwrap();
    conn.execute_batch("ANALYZE").unwrap();
    let plan_no_expr = plan_of(&conn, MENU_ENGINEERING_SQL, ["2026-07-01", "2026-07-31"]);
    assert!(
        plan_no_expr.contains("SEARCH"),
        "without the expression index the half-open range must still seek; \
         plan:\n{plan_no_expr}"
    );
    assert!(
        plan_no_expr.contains("idx_sales_created_at"),
        "expected the plain created_at index to serve the range; plan:\n{plan_no_expr}"
    );
}

/// The counterfactual, on its own connection: the OLD `DATE(column)` predicate
/// LOSES its seek once the expression index is gone — the fragility the rewrite
/// removes. Separate test because it drops an index.
#[test]
fn the_old_date_predicate_depends_on_the_expression_index() {
    let mut conn = fresh();
    migrations::run(&mut conn).unwrap();
    conn.execute_batch("DROP INDEX IF EXISTS idx_sales_status_created_date")
        .unwrap();
    conn.execute_batch("ANALYZE").unwrap();

    let mut stmt = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT 1 FROM sales s
              WHERE s.status = 'completed' AND DATE(s.created_at) BETWEEN ?1 AND ?2",
        )
        .unwrap();
    let old_plan = stmt
        .query_map(["2026-07-01", "2026-07-31"], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join("\n");

    assert!(
        !old_plan.contains("SEARCH"),
        "the OLD DATE(column) predicate can still seek without the expression \
         index — the rewrite would be redundant; plan:\n{old_plan}"
    );
}
/// Single-currency behaviour must be unchanged: the common case still yields
/// exactly one row per product, so this fix is not a behaviour change there.
#[test]
fn a_single_currency_period_still_yields_one_row_per_product() {
    let conn = fresh();
    seed_product(&conn, "STEAK", 2500, 800);
    seed_sale_with_line(&conn, "me-a", "STEAK", "USD", 5000);
    seed_sale_with_line(&conn, "me-b", "STEAK", "USD", 2500);

    let result = query_menu_engineering(&conn, "2026-07-01", "2026-07-31").unwrap();
    assert_eq!(result.rows.len(), 1, "same currency must still merge");
    assert_eq!(result.rows[0].currency, "USD");
    assert_eq!(result.rows[0].total_volume, 2);
    assert_eq!(result.rows[0].total_revenue_minor, 7500);
}

// ── O-L20: the published scalar and the classifier must never disagree ────
//
// The menu-engineering screen does NOT consume `classify_quadrant`; it
// re-derives the quadrant in TypeScript from the two published scalars:
//
//   MenuEngineeringScreen:
//     const volumeHigh = volume >= medianVolume;
//     const marginHigh = margin >= medianMargin;
//
// So the screen's answer is a pure function of `median_margin`, and if that
// scalar is the exact (fractional) median rounded the wrong way, Rust and the
// screen classify the same row differently. These tests spell the UI's rule
// out and hold the two implementations to the same answer.

/// The screen's rule, transcribed (`MenuEngineeringScreen`).
fn ui_classify(volume: i64, margin: i64, median_volume: i64, median_margin: i64) -> MenuQuadrant {
    let volume_high = volume >= median_volume;
    let margin_high = margin >= median_margin;
    match (volume_high, margin_high) {
        (true, true) => MenuQuadrant::Star,
        (true, false) => MenuQuadrant::Plowhorse,
        (false, true) => MenuQuadrant::Puzzle,
        (false, false) => MenuQuadrant::Dog,
    }
}

/// THE regression this entry exists for: an even-length product set whose two
/// middle margins have an ODD sum, so the exact median (4.5) is not an
/// integer. The published scalar must be the ceil (5), and both rows must
/// receive the same quadrant from this crate and from the screen's rule.
#[test]
fn even_length_odd_sum_median_agrees_with_the_screen_rule() {
    let median = median_of(&[4_i64, 5], |&x| x);
    assert_eq!(
        median.lower_upper(),
        (4, 5),
        "the exact median 4.5 is kept as its bounds"
    );

    let published = median.high_water_mark();
    assert_eq!(
        published, 5,
        "the published scalar must be the ceil of 4.5: 4 is BELOW the median, \
         so publishing 4 would let the screen paint row 4 as high"
    );

    // Row 4 is at/below the median of 4.5 -> low margin; row 5 -> high.
    assert_eq!(
        classify_quadrant(10, 4, 10, median),
        MenuQuadrant::Plowhorse,
        "margin 4 < 4.5 is low margin"
    );
    assert_eq!(
        classify_quadrant(10, 5, 10, median),
        MenuQuadrant::Star,
        "margin 5 > 4.5 is high margin"
    );

    // The cross-layer assertion: the screen, given only the published scalar,
    // must reach the same quadrant for every row.
    for row_margin in [4_i64, 5] {
        assert_eq!(
            ui_classify(10, row_margin, 10, published),
            classify_quadrant(10, row_margin, 10, median),
            "row with margin {row_margin}: the screen (margin >= median_margin) \
             and classify_quadrant disagree -- the published scalar is not the \
             threshold the classifier uses"
        );
    }
}

/// The same equivalence, swept across the interesting integer range, so a
/// future change to the published scalar or to `high_water_mark` cannot
/// reintroduce the split. Covers odd and even sums, negatives and a zero
/// straddle.
#[test]
fn published_threshold_reproduces_classify_for_every_integer_margin() {
    let pairs: [(i64, i64); 9] = [
        (4, 5),
        (4, 6),
        (0, 0),
        (-4, -5),
        (-12, -9),
        (-10, 0),
        (-1, 1),
        (0, 1),
        (-7, -6),
    ];
    for (lower, upper) in pairs {
        let mut items = vec![lower, upper];
        items.sort_unstable();
        let median = median_of(&items, |&x| x);
        let published = median.high_water_mark();
        for margin in -20_i64..=20 {
            assert_eq!(
                ui_classify(10, margin, 10, published),
                classify_quadrant(10, margin, 10, median),
                "median {{{lower}, {upper}}} published as {published}, margin {margin}: \
                 screen and classifier disagree"
            );
        }
    }
}

/// The old `f64` comparison, kept here ONLY as the oracle: this is the exact
/// expression O-L20 deleted, and the integer rule must reproduce it. A single
/// divergent input means a boundary case silently moved.
#[test]
fn integer_threshold_reproduces_the_removed_f64_comparison() {
    for lower in -12_i64..=12 {
        for upper in lower..=12 {
            let mean = (lower as f64 + upper as f64) / 2.0;
            let published = median_of(&[lower, upper], |&x| x).high_water_mark();
            for margin in -15_i64..=15 {
                let old_high = (margin as f64) >= mean;
                let new_high = margin >= published;
                assert_eq!(
                    old_high, new_high,
                    "median {{{lower}, {upper}}} (mean {mean}), margin {margin}: \
                     the f64 rule said high={old_high}, the integer threshold \
                     {published} says high={new_high}"
                );
            }
        }
    }
}

/// A fractional median that is BELOW zero must round up (toward zero), not
/// away from it: the median of `{-4, -5}` is `-4.5`, whose ceil is `-4`, and
/// margin `-4` is high while `-5` is low — the mirror of the positive case.
#[test]
fn negative_fractional_median_ceils_toward_zero() {
    let mut items = vec![-4_i64, -5];
    items.sort_unstable();
    let median = median_of(&items, |&x| x);
    assert_eq!(median.lower_upper(), (-5, -4));
    assert_eq!(median.high_water_mark(), -4);
    assert_eq!(
        classify_quadrant(10, -5, 10, median),
        MenuQuadrant::Plowhorse
    );
    assert_eq!(classify_quadrant(10, -4, 10, median), MenuQuadrant::Star);
}

/// End to end through the query: an even-length product set with an odd-sum
/// margin median publishes the ceil, and the screen's rule applied to that
/// published value classifies both products the way the crate does.
#[test]
fn query_even_length_set_publishes_a_screen_agreeing_threshold() {
    let conn = fresh();
    seed_product(&conn, "A", 100, 0); // margin/unit 100
    seed_product(&conn, "B", 105, 0); // margin/unit 105
    complete_sale(&conn, "A", 1, 100); // total_margin 100, revenue 100
    complete_sale(&conn, "B", 1, 105); // total_margin 105, revenue 105

    let result = query_menu_engineering(&conn, "2000-01-01", "2099-12-31").unwrap();
    assert_eq!(result.rows.len(), 2);

    let (lower, upper) = result.median_margin_range();
    assert_eq!((lower, upper), (100, 105), "exact median is 102.5");
    assert_eq!(
        result.median_margin, 103,
        "ceil(102.5) = 103; publishing 102 would misclassify the 102-margin row"
    );
    assert_eq!(result.median_volume, 1, "volume median is odd-length here");

    // Recompute the crate's own classification from the published thresholds
    // and the exact interval, then hold the screen's rule to it row by row.
    let margin_median = margin_median_of(&result.rows);
    for row in &result.rows {
        let exact = classify_quadrant(
            row.total_volume,
            row.total_margin_minor,
            result.median_volume,
            margin_median,
        );
        let via_screen_rule = ui_classify(
            row.total_volume,
            row.total_margin_minor,
            result.median_volume,
            result.median_margin,
        );
        assert_eq!(
            via_screen_rule, exact,
            "row {} classified differently by the screen and the crate",
            row.sku
        );
    }
    // Margins are 100 and 105 against a median of 102.5: the 100 row is low
    // margin (Plowhorse, volumes tie at the median so volume is high) and the
    // 105 row is high margin (Star).
    let a = result.rows.iter().find(|r| r.sku == "A").unwrap();
    assert_eq!(
        classify_quadrant(
            a.total_volume,
            a.total_margin_minor,
            result.median_volume,
            margin_median
        ),
        MenuQuadrant::Plowhorse
    );
}

/// `classify_quadrant_with_range` is the same classifier, so it must agree
/// with `classify_quadrant` for the same median — including a reversed pair.
#[test]
fn classify_with_range_matches_classify() {
    let median = median_of(&[4_i64, 5], |&x| x);
    for margin in -5_i64..=15 {
        assert_eq!(
            classify_quadrant_with_range(10, margin, 10, (4, 5)),
            classify_quadrant(10, margin, 10, median),
            "margin {margin}"
        );
        assert_eq!(
            classify_quadrant_with_range(10, margin, 10, (5, 4)),
            classify_quadrant(10, margin, 10, median),
            "reversed pair, margin {margin}"
        );
    }
}

/// `high_water_mark` must never overflow: the previous `f64` form added the
/// two middle values, which overflows `i64` for a large positive/negative
/// pair even though their mean is representable.
#[test]
fn high_water_mark_does_not_overflow_at_the_extremes() {
    let big = median_of(&[i64::MAX, i64::MAX], |&x| x);
    assert_eq!(big.high_water_mark(), i64::MAX);

    let small = median_of(&[i64::MIN, i64::MIN], |&x| x);
    assert_eq!(small.high_water_mark(), i64::MIN);

    // The pair that overflowed the old `(a + b) / 2.0`? The f64 form did not
    // overflow, but an integer `(a + b) / 2` would: this is why the sum is
    // never formed.
    // `i64::MIN` with a near-maximum partner: BOTH `lower + upper` and
    // `upper - lower` overflow here, which is why the halves are taken
    // separately. The true ceil of (MIN + MAX - 1) / 2 is -1.
    let spread = median_of(&[i64::MIN, i64::MAX - 1], |&x| x);
    assert_eq!(spread.lower_upper(), (i64::MIN, i64::MAX - 1));
    assert_eq!(spread.high_water_mark(), -1);

    // A zero mean across the widest span.
    let wide = median_of(&[i64::MIN, i64::MAX], |&x| x);
    assert_eq!(wide.high_water_mark(), 0);
}
