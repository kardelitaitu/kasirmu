use super::*;
use crate::migrations;
use chrono::Datelike;

fn fresh() -> rusqlite::Connection {
    migrations::fresh_db()
}

fn seed_product(conn: &rusqlite::Connection, sku: &str) -> String {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) \
         VALUES (?1, ?2, ?2, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, sku],
    )
    .unwrap();
    id
}

#[test]
fn record_product_search_writes_ledger_and_recomputes() {
    let conn = fresh();
    seed_product(&conn, "SKU-A");
    let store = Store::new(&conn);

    store.record_product_search("SKU-A").unwrap();

    let rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM product_activity WHERE sku = 'SKU-A' AND event_type = 'search'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1, "search event must write exactly one ledger row");

    let score: f64 = conn
        .query_row(
            "SELECT popularity_score FROM products WHERE sku = 'SKU-A'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // Search weight (0.3) × smoothed search raw — with zero means the
    // smoothed value is 0, so the score reflects only the search signal.
    assert!(score > 0.0, "score must move after a search event");
}

#[test]
fn update_product_attributes_writes_edit_ledger_row() {
    let conn = fresh();
    seed_product(&conn, "SKU-B");
    let store = Store::new(&conn);

    store
        .update_product_attributes(
            "SKU-B",
            &crate::db::UpdateProductAttributes {
                cost_minor: Some(500),
                brand: Some(Some("Acme".into())),
                rack_location: None,
                notes: None,
                unit: None,
                is_active: None,
                default_supplier_id: None,
            },
        )
        .unwrap();

    let edits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM product_activity WHERE sku = 'SKU-B' AND event_type = 'edit'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        edits, 1,
        "product update must write an edit signal (ADR #37 D2)"
    );

    let cost: i64 = conn
        .query_row(
            "SELECT cost_minor FROM products WHERE sku = 'SKU-B'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cost, 500);
}

#[test]
fn full_pass_backfills_scores_from_sale_lines() {
    let conn = fresh();
    let pid = seed_product(&conn, "SKU-SOLD");
    // A completed sale with 4 units, plus a pending sale that must NOT
    // count (only completed sales feed the sales signal).
    // Use today's timestamp so the sales land inside the 90-day decay
    // window (a 2025 seed would be filtered out by the formula).
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute_batch(
        &format!(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('sale-1', 4000, 'USD', 1, 'completed', '{now}', '{now}'),
            ('sale-2', 3000, 'USD', 1, 'pending',   '{now}', '{now}');
             INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('sl-1', 'sale-1', 'SKU-SOLD', 4, 1000, 4000, 'USD', 1),
            ('sl-2', 'sale-2', 'SKU-SOLD', 3, 1000, 3000, 'USD', 1);"
        ),
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES (?1, ?2, 10)",
        params![pid, crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
    )
    .unwrap();

    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();

    let score: f64 = conn
        .query_row(
            "SELECT popularity_score FROM products WHERE sku = 'SKU-SOLD'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        score > 0.0,
        "sold product must get a positive score after backfill"
    );

    let pending_influence: f64 = conn
        .query_row(
            "SELECT popularity_score FROM products WHERE sku = 'SKU-SOLD'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // Only completed sales feed the signal; the score must equal the
    // 4-unit backfill, not the 7-unit (pending-included) figure.
    // Breadth-scaled raw: 4 completed units across 1 distinct sale.
    let sales_raw = crate::popularity::decayed_sum(&[DayCount {
        days_ago: 0,
        count: 4,
    }]) * crate::popularity::breadth_factor(1);
    // The pending sale's 3 units must NOT inflate the signal: the score
    // can at most reflect the 4 completed units (smoothing toward the
    // catalog mean can only shrink it, never grow it past the raw).
    let seven_units = crate::popularity::decayed_sum(&[DayCount {
        days_ago: 0,
        count: 7,
    }]) * crate::popularity::breadth_factor(2);
    let score_raw_share = crate::popularity::WEIGHT_SALES * sales_raw;
    assert!(
        score_raw_share <= pending_influence + 1e-9
            && pending_influence < crate::popularity::WEIGHT_SALES * seven_units,
        "backfilled score must reflect completed sales only (pending excluded)"
    );
}

fn seed_category(conn: &rusqlite::Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO categories (id, name, colour, icon, created_at, updated_at) \
         VALUES (?1, ?2, '#06b6d4', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, name],
    )
    .unwrap();
}

/// Seed a product in a category with `units` sold today (completed sale).
fn seed_sold_in_category(
    conn: &rusqlite::Connection,
    sku: &str,
    category: Option<&str>,
    units: i64,
) {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, category_id, created_at, updated_at) \
         VALUES (?1, ?2, ?2, 1000, 'USD', ?3, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, sku, category],
    )
    .unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
         (?1, ?2, 'USD', 1, 'completed', ?3, ?3)",
        params![format!("sale-{sku}"), units * 1000, now],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
         (?1, ?2, ?3, ?4, 1000, ?5, 'USD', 1)",
        params![format!("sl-{sku}"), format!("sale-{sku}"), sku, units, units * 1000],
    )
    .unwrap();
}

#[test]
fn full_pass_smooths_toward_category_mean_not_catalog_mean() {
    // A hot category (5 × 100 units) inflates the catalog mean to 63.125.
    // Global smoothing then pulls the LOWEST-evidence product up hardest
    // (closest to the inflated mean), inverting the ranking inside the
    // quiet category — the 1-unit seller would outrank the 2-unit seller.
    // Per-category means keep the ordering honest: 2 units beats 1 unit
    // within the quiet category.
    let conn = fresh();
    seed_category(&conn, "cat-hot", "Hot");
    seed_category(&conn, "cat-quiet", "Quiet");
    for i in 0..5 {
        seed_sold_in_category(&conn, &format!("HOT-{i}"), Some("cat-hot"), 100);
    }
    seed_sold_in_category(&conn, "QUIET-2", Some("cat-quiet"), 2);
    seed_sold_in_category(&conn, "QUIET-1", Some("cat-quiet"), 1);
    // An uncategorized product uses the global fallback.
    seed_sold_in_category(&conn, "NO-CAT", None, 2);

    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();

    let score = |sku: &str| -> f64 {
        conn.query_row(
            "SELECT popularity_score FROM products WHERE sku = ?1",
            params![sku],
            |r| r.get(0),
        )
        .unwrap()
    };
    let (two, one) = (score("QUIET-2"), score("QUIET-1"));
    assert!(
        two > one,
        "within the quiet category the 2-unit seller must outrank the \
         1-unit seller (two={two}, one={one})"
    );
    // Reference: the catalog-mean blend inverts that ordering — the
    // whole pathology per-category popularity fixes. The catalog mean is
    // the breadth-scaled average: 5×100, 2, 1, and 2 units, each sold in
    // one transaction → (5·100 + 2 + 1 + 2)·ln2 / 8.
    let catalog_mean = (5.0 * 100.0 + 2.0 + 1.0 + 2.0) * std::f64::consts::LN_2 / 8.0;
    let global_two = crate::popularity::compute_score(
        &[DayCount {
            days_ago: 0,
            count: 2,
        }],
        1,
        &[],
        &[],
        catalog_mean,
        0.0,
        0.0,
    );
    let global_one = crate::popularity::compute_score(
        &[DayCount {
            days_ago: 0,
            count: 1,
        }],
        1,
        &[],
        &[],
        catalog_mean,
        0.0,
        0.0,
    );
    assert!(
        global_one > global_two,
        "catalog-mean blend must invert the ordering (one={global_one}, two={global_two})"
    );
    // Uncategorized falls back to the global mean (identical inputs to
    // the catalog blend above).
    let no_cat = score("NO-CAT");
    assert!(
        (no_cat - global_two).abs() < 1e-9,
        "uncategorized must use the global mean, not the quiet category's \
         (no-cat={no_cat}, expected={global_two})"
    );
    // The hot category still ranks highest.
    let hot = score("HOT-0");
    assert!(hot > two, "hot category must still outrank the quiet one");
}

#[test]
fn single_sku_recompute_uses_cached_category_means() {
    let conn = fresh();
    seed_category(&conn, "cat-hot", "Hot");
    seed_category(&conn, "cat-quiet", "Quiet");
    for i in 0..5 {
        seed_sold_in_category(&conn, &format!("HOT-{i}"), Some("cat-hot"), 100);
    }
    seed_sold_in_category(&conn, "QUIET-1", Some("cat-quiet"), 2);

    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();
    let full_pass_score: f64 = conn
        .query_row(
            "SELECT popularity_score FROM products WHERE sku = 'QUIET-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    // A later single-SKU recompute (e.g. after a search event) must
    // reproduce the same category-relative score via the JSON cache.
    store.recompute_popularity("QUIET-1").unwrap();
    let after: f64 = conn
        .query_row(
            "SELECT popularity_score FROM products WHERE sku = 'QUIET-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        (full_pass_score - after).abs() < 1e-9,
        "single-SKU recompute must reuse the category means \
         (full-pass={full_pass_score}, recomputed={after})"
    );
}

#[test]
fn category_popularity_ranks_categories_and_top_products() {
    let conn = fresh();
    seed_category(&conn, "cat-hot", "Hot");
    seed_category(&conn, "cat-quiet", "Quiet");
    for (sku, cat, score) in [
        ("HOT-A", "cat-hot", 9.0),
        ("HOT-B", "cat-hot", 5.0),
        ("HOT-C", "cat-hot", 3.0),
        ("HOT-D", "cat-hot", 1.0),
        ("QUIET-1", "cat-quiet", 4.0),
        ("QUIET-2", "cat-quiet", 2.0),
        ("NO-CAT", "", 6.0),
    ] {
        let id = uuid::Uuid::now_v7().to_string();
        let cat = if cat.is_empty() { None } else { Some(cat) };
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, \
             popularity_score, created_at, updated_at) VALUES (?1, ?2, ?2, 1000, 'USD', \
             ?3, ?4, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![id, sku, cat, score],
        )
        .unwrap();
    }

    let store = Store::new(&conn);
    let rows = store.category_popularity(3).unwrap();

    // Catalog mean = (9+5+3+1+4+2+6)/7 = 4.2857…
    assert_eq!(rows.len(), 3, "hot, quiet, and the uncategorized bucket");

    let hot = rows.iter().find(|r| r.category_id == "cat-hot").unwrap();
    assert_eq!(hot.category_name.as_deref(), Some("Hot"));
    assert_eq!(hot.product_count, 4);
    assert!((hot.mean_score - 4.5).abs() < 1e-9);
    assert!((hot.catalog_ratio - 4.5 / (30.0 / 7.0)).abs() < 1e-9);
    // Top-3 limited to 3, ranked by score with SKU tiebreak.
    let top: Vec<(&str, i64, f64)> = hot
        .top_products
        .iter()
        .map(|t| (t.sku.as_str(), t.rank, t.percentile))
        .collect();
    assert_eq!(
        top,
        vec![
            ("HOT-A", 1, 1.0),
            ("HOT-B", 2, 2.0 / 3.0),
            ("HOT-C", 3, 1.0 / 3.0)
        ]
    );

    let uncat = rows.iter().find(|r| r.category_id.is_empty()).unwrap();
    assert_eq!(uncat.category_name, None);
    assert_eq!(uncat.product_count, 1);
    // Single-product category: percentile is 1.0 by definition.
    assert_eq!(uncat.top_products[0].percentile, 1.0);

    // Categories sort by mean score descending: hot (4.5) > uncat (6.0)?
    // No — the uncategorized bucket's mean is 6.0, so it ranks first.
    assert_eq!(rows[0].category_id, "");
    assert_eq!(rows[1].category_id, "cat-hot");
    assert_eq!(rows[2].category_id, "cat-quiet");
    assert!((rows[2].mean_score - 3.0).abs() < 1e-9);

    // top_per_category=1 keeps only the leader.
    let one = store.category_popularity(1).unwrap();
    let hot_one = one.iter().find(|r| r.category_id == "cat-hot").unwrap();
    assert_eq!(hot_one.top_products.len(), 1);
    assert_eq!(hot_one.top_products[0].sku, "HOT-A");
}

#[test]
fn category_popularity_trend_buckets_daily_and_scores() {
    let conn = fresh();
    seed_category(&conn, "cat-a", "A");
    seed_category(&conn, "cat-b", "B");
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let yesterday = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(1))
        .unwrap()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute_batch(
        &format!(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, created_at, updated_at) VALUES
            ('p-1', 'A-1', 'A one', 1000, 'USD', 'cat-a', '{now}', '{now}'),
            ('p-2', 'A-2', 'A two', 1000, 'USD', 'cat-a', '{now}', '{now}'),
            ('p-3', 'B-1', 'B one', 1000, 'USD', 'cat-b', '{now}', '{now}');
            INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('s1', 2000, 'USD', 1, 'completed', '{now}', '{now}'),
            ('s2', 1000, 'USD', 1, 'completed', '{yesterday}', '{yesterday}'),
            ('s3', 3000, 'USD', 1, 'completed', '{now}', '{now}');
            INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
            ('sl1', 's1', 'A-1', 2, 1000, 2000, 'USD', 1),
            ('sl2', 's2', 'A-2', 1, 1000, 1000, 'USD', 1),
            ('sl3', 's3', 'B-1', 3, 1000, 3000, 'USD', 1);"
        ),
    )
    .unwrap();
    // Cache means via a full pass so single-point scores smooth
    // consistently with the rest of the system.
    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();

    let today = chrono::Utc::now().date_naive().to_string();
    let yesterday_s = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(1))
        .unwrap()
        .date_naive()
        .to_string();
    let points = store
        .category_popularity_trend("2000-01-01", "2099-12-31", "daily", 5)
        .unwrap();

    // Only (period, category) pairs with activity produce points:
    // cat-a sold both days, cat-b only today (uncategorized never sold).
    // Within a period, categories sort by mean-score rank (cat-b first).
    let keys: Vec<(&str, &str)> = points
        .iter()
        .map(|p| (p.period_start.as_str(), p.category_id.as_str()))
        .collect();
    assert_eq!(
        keys,
        vec![
            (yesterday_s.as_str(), "cat-a"),
            (today.as_str(), "cat-b"),
            (today.as_str(), "cat-a"),
        ]
    );

    let a_today = points
        .iter()
        .find(|p| p.period_start == today && p.category_id == "cat-a")
        .unwrap();
    assert_eq!(a_today.units_sold, 2);
    assert_eq!(a_today.distinct_transactions, 1);
    assert_eq!(a_today.searches, 0);
    assert_eq!(a_today.edits, 0);
    assert!(a_today.score > 0.0, "sales-driven period score must be > 0");

    let b_today = points
        .iter()
        .find(|p| p.period_start == today && p.category_id == "cat-b")
        .unwrap();
    assert!(b_today.score > a_today.score, "3 units must beat 2 units");
}

#[test]
fn category_popularity_trend_monthly_and_top_limit() {
    let conn = fresh();
    seed_category(&conn, "cat-a", "A");
    seed_category(&conn, "cat-b", "B");
    for (sku, cat, score) in [
        ("A-1", "cat-a", 8.0),
        ("A-2", "cat-a", 6.0),
        ("B-1", "cat-b", 2.0),
        ("C-1", "", 9.0),
    ] {
        let id = uuid::Uuid::now_v7().to_string();
        let cat = if cat.is_empty() { None } else { Some(cat) };
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, \
             popularity_score, created_at, updated_at) VALUES (?1, ?2, ?2, 1000, 'USD', \
             ?3, ?4, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![id, sku, cat, score],
        )
        .unwrap();
    }
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute_batch(&format!(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
         ('s1', 1000, 'USD', 1, 'completed', '{now}', '{now}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
         ('sl1', 's1', 'A-1', 1, 1000, 1000, 'USD', 1);"
    ))
    .unwrap();

    let store = Store::new(&conn);
    let points = store
        .category_popularity_trend("2000-01-01", "2099-12-31", "monthly", 2)
        .unwrap();

    // Top 2 categories by mean score: uncategorized (9.0) and cat-a
    // (7.0) — cat-b (2.0) is excluded. Only cat-a has a sales point.
    let cats: Vec<&str> = points.iter().map(|p| p.category_id.as_str()).collect();
    assert_eq!(cats, vec!["cat-a"], "only top categories appear");
    assert_eq!(
        points[0].period_start,
        chrono::Utc::now().date_naive().format("%Y-%m").to_string(),
        "monthly bucket is YYYY-MM"
    );
    assert_eq!(points[0].units_sold, 1);
}

#[test]
fn category_forecast_projects_next_period_from_trend_series() {
    let conn = fresh();
    seed_category(&conn, "cat-a", "A");
    seed_category(&conn, "cat-b", "B");
    let mk = |sku: &str, cat: &str, days_ago: i64, units: i64| {
        let id = uuid::Uuid::now_v7().to_string();
        let ts = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::days(days_ago))
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, created_at, updated_at) \
             VALUES (?1, ?2, ?2, 1000, 'USD', ?3, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![id, sku, cat],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
             (?1, ?2, 'USD', 1, 'completed', ?3, ?3)",
            params![format!("sale-{sku}"), units * 1000, ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
             (?1, ?2, ?3, ?4, 1000, ?5, 'USD', 1)",
            params![format!("sl-{sku}"), format!("sale-{sku}"), sku, units, units * 1000],
        )
        .unwrap();
    };
    // cat-a: 10 → 12 → 14 → 16 units over the last 4 days (slope 2).
    mk("A-0", "cat-a", 3, 10);
    mk("A-1", "cat-a", 2, 12);
    mk("A-2", "cat-a", 1, 14);
    mk("A-3", "cat-a", 0, 16);
    // cat-b: flat 5 units a day.
    mk("B-0", "cat-b", 3, 5);
    mk("B-1", "cat-b", 2, 5);
    mk("B-2", "cat-b", 1, 5);
    mk("B-3", "cat-b", 0, 5);

    let store = Store::new(&conn);
    let rows = store
        .category_forecast("2000-01-01", "2099-12-31", "daily", 5)
        .unwrap();

    let a = rows.iter().find(|r| r.category_id == "cat-a").unwrap();
    assert_eq!(a.forecast_units, 18, "10,12,14,16 → next = 18");
    assert!((a.trend_per_period - 2.0).abs() < 1e-9);
    assert!((a.recent_avg_units - 13.0).abs() < 1e-9);

    let b = rows.iter().find(|r| r.category_id == "cat-b").unwrap();
    assert_eq!(b.forecast_units, 5, "flat series → 5");
    assert_eq!(b.trend_per_period, 0.0);

    // Sorted by forecast descending: cat-a (18) before cat-b (5).
    assert_eq!(rows[0].category_id, "cat-a");
    assert_eq!(rows[1].category_id, "cat-b");
}

#[test]
fn category_forecast_daily_weekend_seasonality() {
    // Two flat weeks with a weekend boost: Mon–Fri 6, Sat–Sun 12. The
    // next-day projection must respect the target weekday (a Monday
    // stays weak, a Sunday stays strong) instead of the flat mean 8.
    let conn = fresh();
    seed_category(&conn, "cat-s", "S");
    let start = chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(); // Monday
    for i in 0..14 {
        let d = start + chrono::Duration::days(i);
        let dow = d.weekday().num_days_from_monday();
        let units = if dow >= 5 { 12 } else { 6 };
        let id = uuid::Uuid::now_v7().to_string();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, created_at, updated_at) \
             VALUES (?1, ?2, ?2, 1000, 'USD', 'cat-s', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![id, format!("S-{i}")],
        )
        .unwrap();
        let ts = d
            .and_hms_opt(12, 0, 0)
            .unwrap()
            .and_utc()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        conn.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
             (?1, ?2, 'USD', 1, 'completed', ?3, ?3)",
            params![format!("sale-S-{i}"), units * 1000, ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
             (?1, ?2, ?3, ?4, 1000, ?5, 'USD', 1)",
            params![format!("sl-S-{i}"), format!("sale-S-{i}"), format!("S-{i}"), units, units * 1000],
        )
        .unwrap();
    }

    let store = Store::new(&conn);
    let rows = store
        .category_forecast("2000-01-01", "2099-12-31", "daily", 5)
        .unwrap();
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    // Last day is a Sunday (2026-08-16 + …): the next day is Monday.
    // Two flat weeks → slope 0, forecast = mean × index[Mon] = 6.
    let last = start + chrono::Duration::days(13); // Sunday
    let next = last + chrono::Duration::days(1); // Monday
    assert_eq!(
        next.weekday().num_days_from_monday(),
        0,
        "next day is Monday"
    );
    assert_eq!(row.forecast_units, 6, "Monday projection must stay weak");
    // (10×6 + 4×12) / 14 = 108/14 ≈ 7.714.
    assert!((row.recent_avg_units - 108.0 / 14.0).abs() < 1e-9);
}

#[test]
fn category_forecast_empty_catalog() {
    let conn = fresh();
    let store = Store::new(&conn);
    let rows = store
        .category_forecast("2000-01-01", "2099-12-31", "daily", 5)
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn category_popularity_empty_catalog() {
    let conn = fresh();
    let store = Store::new(&conn);
    let rows = store.category_popularity(3).unwrap();
    assert!(rows.is_empty(), "no products → no category rows");
}

#[test]
fn breadth_weighting_ranks_spread_over_single_bulk_sale() {
    // Same volume (10 units), same day: 10 units in one sale vs 10 units
    // spread across 5 different customers. The spread seller must
    // outrank the bulk seller (ADR #37 D6 reach-over-bulk).
    let conn = fresh();
    for sku in ["BULK", "SPREAD"] {
        let id = uuid::Uuid::now_v7().to_string();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) \
             VALUES (?1, ?2, ?2, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
            params![id, sku],
        )
        .unwrap();
    }
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut batch = String::new();
    // BULK: one sale of 10 units.
    batch.push_str(&format!(
        "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
         ('s-bulk', 10000, 'USD', 1, 'completed', '{now}', '{now}');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
         ('sl-bulk', 's-bulk', 'BULK', 10, 1000, 10000, 'USD', 1);"
    ));
    // SPREAD: five sales of 2 units each.
    for i in 0..5 {
        batch.push_str(&format!(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
             ('s-spread-{i}', 2000, 'USD', 1, 'completed', '{now}', '{now}');
             INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position) VALUES
             ('sl-spread-{i}', 's-spread-{i}', 'SPREAD', 2, 1000, 2000, 'USD', 1);"
        ));
    }
    conn.execute_batch(&batch).unwrap();

    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();

    let score = |sku: &str| -> f64 {
        conn.query_row(
            "SELECT popularity_score FROM products WHERE sku = ?1",
            params![sku],
            |r| r.get(0),
        )
        .unwrap()
    };
    let (spread, bulk) = (score("SPREAD"), score("BULK"));
    assert!(
        spread > bulk,
        "same volume across more customers must rank higher \
         (spread={spread}, bulk={bulk})"
    );
}

#[test]
fn full_pass_ranks_backfilled_edit_events_by_recency() {
    // Day-one upgrade: migration 134 seeded one synthetic edit event per
    // recently-touched product at its last update. With zero sales and
    // zero searches the full pass must rank the most-recently managed
    // product first, a product last touched 80 days ago below the
    // catalog mean (stale), and an untouched product exactly at it.
    let conn = fresh();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let ts = |days_ago: i64| {
        chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::days(days_ago))
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    };
    conn.execute_batch(&format!(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('p-a', 'SKU-A', 'Managed today',    1000, 'USD', '{now}', '{now}'),
            ('p-b', 'SKU-B', 'Touched 80d ago',  1000, 'USD', '{}', '{}'),
            ('p-c', 'SKU-C', 'Never touched',    1000, 'USD', '{}', '{}');",
        ts(400),
        ts(80),
        ts(400),
        ts(400),
    ))
    .unwrap();
    // The ledger rows migration 134 would have written.
    conn.execute_batch(&format!(
        "INSERT INTO product_activity (id, sku, event_type, created_at) VALUES
            ('backfill-edit-p-a', 'SKU-A', 'edit', '{now}'),
            ('backfill-edit-p-b', 'SKU-B', 'edit', '{}');",
        ts(80),
    ))
    .unwrap();

    let store = Store::new(&conn);
    store.recompute_all_popularity().unwrap();

    let score = |sku: &str| -> f64 {
        conn.query_row(
            "SELECT popularity_score FROM products WHERE sku = ?1",
            params![sku],
            |r| r.get(0),
        )
        .unwrap()
    };
    let (a, b, c) = (score("SKU-A"), score("SKU-B"), score("SKU-C"));
    assert!(
        a > c && c > b && a > 0.0,
        "day-one sort must rank recently-managed products first \
         (A={a}, C={c}, B={b})"
    );
}
