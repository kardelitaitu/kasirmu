use super::*;
use crate::db::Store;
use crate::migrations;
use crate::{Cart, CartLine, Money, Sale, SaleStatus, Sku};

fn usd() -> crate::Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn seed_sale(conn: &rusqlite::Connection, sku: &str, qty: i64, unit_minor: i64) {
    let s = Store::new(conn);
    s.create_product(sku, sku, price(unit_minor), None, None, 100, None)
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
}

#[test]
fn analytics_bundle_empty_db() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "test-tenant", "Test Store")
        .unwrap();
    assert_eq!(bundle.metadata.tenant_id, "test-tenant");
    assert_eq!(bundle.metadata.store_name, "Test Store");
    assert!(!bundle.metadata.exported_at.is_empty());
    assert!(!bundle.metadata.version.is_empty());
    assert!(bundle.daily_revenue.is_empty());
    assert!(bundle.weekly_revenue.is_empty());
    assert!(bundle.monthly_revenue.is_empty());
    assert!(bundle.top_products.is_empty());
    assert!(bundle.hourly_heatmap.is_empty());
    assert!(bundle.category_breakdown.is_empty());
    assert!(bundle.low_stock_alerts.is_empty());
    assert!(bundle.active_stock_alerts.is_empty());
    assert!(bundle.category_popularity.is_empty());
    assert!(bundle.category_forecast.is_empty());
}

#[test]
fn analytics_bundle_with_data() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "COFFEE", 2, 350);
    seed_sale(&conn, "BAGEL", 1, 450);

    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "", "My Store")
        .unwrap();

    assert_eq!(bundle.metadata.store_name, "My Store");
    assert_eq!(bundle.daily_revenue.len(), 1);
    assert_eq!(bundle.daily_revenue[0].total_minor, 1150);
    assert_eq!(bundle.daily_revenue[0].sale_count, 2);
    assert!(!bundle.weekly_revenue.is_empty());
    assert!(!bundle.monthly_revenue.is_empty());
    assert_eq!(bundle.top_products.len(), 2);
    assert!(!bundle.hourly_heatmap.is_empty());
    assert!(!bundle.category_breakdown.is_empty());
    // Both products land in the uncategorized bucket; the export must
    // carry the standings and a weekly forecast derived from the sales.
    assert_eq!(bundle.category_popularity.len(), 1);
    assert_eq!(bundle.category_popularity[0].product_count, 2);
    assert_eq!(bundle.category_popularity[0].top_products.len(), 2);
    assert_eq!(bundle.category_forecast.len(), 1);
    assert!(bundle.category_forecast[0].forecast_units > 0);
}

#[test]
fn analytics_bundle_serializable() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "TEA", 1, 200);

    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "t1", "S1")
        .unwrap();

    let json = serde_json::to_string_pretty(&bundle).unwrap();
    assert!(json.contains("\"tenant_id\": \"t1\""));
    assert!(json.contains("\"store_name\": \"S1\""));
    assert!(json.contains("\"daily_revenue\""));
    assert!(json.contains("\"top_products\""));
    assert!(json.contains("\"hourly_heatmap\""));
    assert!(json.contains("\"category_breakdown\""));
    assert!(json.contains("\"low_stock_alerts\""));
    assert!(json.contains("\"active_stock_alerts\""));
    assert!(json.contains("\"category_popularity\""));
    assert!(json.contains("\"category_forecast\""));
    assert!(json.contains("\"exported_at\""));
    assert!(json.contains("\"version\""));
}

#[test]
fn analytics_bundle_respects_date_range() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "LATTE", 1, 400);

    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(
            ExportConfig {
                start_date: "2000-01-01".into(),
                end_date: "2000-01-31".into(),
                ..ExportConfig::default()
            },
            "",
            "",
        )
        .unwrap();

    // The sale was created today, which is outside the 2000 date range.
    assert!(bundle.daily_revenue.is_empty());
}

#[test]
fn analytics_bundle_respects_top_product_limit() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "A", 1, 100);
    seed_sale(&conn, "B", 1, 200);
    seed_sale(&conn, "C", 1, 300);

    let s = Store::new(&conn);
    let config = ExportConfig {
        top_product_limit: 2,
        ..ExportConfig::default()
    };
    let bundle = s.export_analytics_bundle(config, "", "").unwrap();

    assert_eq!(bundle.top_products.len(), 2);
    assert_eq!(bundle.top_products[0].sku, "C");
    assert_eq!(bundle.top_products[1].sku, "B");
}

#[test]
fn export_config_defaults() {
    let cfg = ExportConfig::default();
    assert_eq!(cfg.start_date, "2000-01-01");
    assert_eq!(cfg.end_date, "2099-12-31");
    assert_eq!(cfg.top_product_limit, 25);
    assert_eq!(cfg.low_stock_threshold, 10);
}

// ── Report schedule ────────────────────────────────────────────

#[test]
fn schedule_config_defaults() {
    let cfg = ReportScheduleConfig::default();
    assert!(!cfg.enabled);
    assert_eq!(cfg.cadence, "daily");
    assert_eq!(cfg.report_types.len(), 2);
    assert!(cfg.recipients.is_empty());
    assert_eq!(cfg.send_at_time, "08:00");
    assert_eq!(cfg.timezone, "UTC");
    assert_eq!(cfg.lookback_days, 1);
}

#[test]
fn schedule_save_and_load() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);

    // Initially no schedule
    let loaded = s.get_report_schedule().unwrap();
    assert!(loaded.is_none());

    // Save a schedule
    let cfg = ReportScheduleConfig {
        enabled: true,
        cadence: "weekly".to_string(),
        report_types: vec![
            "daily_revenue".to_string(),
            "top_products".to_string(),
            "hourly_heatmap".to_string(),
        ],
        recipients: vec!["owner@store.com".to_string()],
        send_at_time: "06:00".to_string(),
        timezone: "Asia/Jakarta".to_string(),
        lookback_days: 7,
    };
    s.save_report_schedule(&cfg).unwrap();

    // Load and verify
    let loaded = s.get_report_schedule().unwrap().unwrap();
    assert!(loaded.enabled);
    assert_eq!(loaded.cadence, "weekly");
    assert_eq!(loaded.report_types.len(), 3);
    assert_eq!(loaded.recipients, vec!["owner@store.com"]);
    assert_eq!(loaded.send_at_time, "06:00");
    assert_eq!(loaded.timezone, "Asia/Jakarta");
    assert_eq!(loaded.lookback_days, 7);
}

#[test]
fn schedule_serde_roundtrip() {
    let cfg = ReportScheduleConfig {
        enabled: true,
        cadence: "monthly".to_string(),
        report_types: vec!["daily_revenue".to_string()],
        recipients: vec!["a@b.com".to_string(), "c@d.com".to_string()],
        send_at_time: "09:00".to_string(),
        timezone: "America/New_York".to_string(),
        lookback_days: 30,
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let back: ReportScheduleConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.cadence, cfg.cadence);
    assert_eq!(back.recipients, cfg.recipients);
    assert_eq!(back.lookback_days, cfg.lookback_days);
}

// ── Custom report builder ──────────────────────────────────────

#[test]
fn custom_report_customers_dataset() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "customers".to_string(),
        columns: vec!["id".to_string(), "name".to_string(), "email".to_string()],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 3);
    assert_eq!(resp.columns[0], "id");
    assert_eq!(resp.columns[1], "name");
    assert_eq!(resp.columns[2], "email");
}

#[test]
fn custom_report_staff_dataset() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "staff".to_string(),
        columns: vec![
            "username".to_string(),
            "display_name".to_string(),
            "is_active".to_string(),
        ],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 3);
    assert_eq!(resp.columns[0], "username");
    assert_eq!(resp.columns[1], "display_name");
    assert_eq!(resp.columns[2], "is_active");
}

#[test]
fn custom_report_tax_rates_dataset() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "tax_rates".to_string(),
        columns: vec!["name".to_string(), "rate_bps".to_string()],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    assert_eq!(resp.columns[0], "name");
    assert_eq!(resp.columns[1], "rate_bps");
}

#[test]
fn custom_report_shifts_dataset() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "shifts".to_string(),
        columns: vec![
            "id".to_string(),
            "status".to_string(),
            "total_sales_minor".to_string(),
        ],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 3);
    assert_eq!(resp.columns[0], "id");
    assert_eq!(resp.columns[1], "status");
    assert_eq!(resp.columns[2], "total_sales_minor");
}

#[test]
fn custom_report_shifts_date_filter_uses_opened_at() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    // Date-filtered query on shifts should use opened_at, not created_at.
    let req = CustomReportRequest {
        dataset: "shifts".to_string(),
        columns: vec!["id".to_string(), "status".to_string()],
        start_date: Some("2026-01-01".to_string()),
        end_date: Some("2026-12-31".to_string()),
        limit: None,
        offset: None,
    };
    // Should not error — if it used created_at against shifts table, the
    // SQL would be invalid since shifts has opened_at, not created_at.
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    assert!(resp.rows.is_empty(), "shifts table empty at test time");
}

#[test]
fn custom_report_unknown_dataset() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "nonexistent".to_string(),
        columns: vec!["id".to_string()],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let err = s.build_custom_report(req).unwrap_err();
    assert!(
        format!("{err}").contains("unknown dataset")
            || format!("{err}").contains("validation error"),
        "got: {err}"
    );
}

#[test]
fn custom_report_invalid_columns_filtered() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    // Request includes a column that's not in the whitelist — it gets silently dropped.
    let req = CustomReportRequest {
        dataset: "sales".to_string(),
        columns: vec!["id".to_string(), "password_hash".to_string()],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    // Only "id" is in the whitelist
    assert_eq!(resp.columns, vec!["id"]);
}

#[test]
fn custom_report_sales_basic() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "A", 1, 100);
    seed_sale(&conn, "B", 2, 200);

    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "sales".to_string(),
        columns: vec![
            "id".to_string(),
            "total_minor".to_string(),
            "status".to_string(),
        ],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 3);
    assert_eq!(resp.rows.len(), 2);
    // Each row has 3 columns
    assert!(resp.rows.iter().all(|r| r.len() == 3));
}

#[test]
fn custom_report_inventory_columns() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "inventory".to_string(),
        columns: vec![
            "sku".to_string(),
            "name".to_string(),
            "price_minor".to_string(),
        ],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 3);
    // All three columns must be present header order
    assert_eq!(resp.columns[0], "sku");
    assert_eq!(resp.columns[1], "name");
    assert_eq!(resp.columns[2], "price_minor");
}

#[test]
fn custom_report_empty_columns_returns_empty() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "X", 1, 50);
    let s = Store::new(&conn);
    let req = CustomReportRequest {
        dataset: "sales".to_string(),
        columns: vec![],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert!(resp.columns.is_empty());
    assert!(resp.rows.is_empty());
}

// ── CSV export ─────────────────────────────────────────────────

#[test]
fn csv_export_creates_files() {
    let conn = migrations::fresh_db();
    seed_sale(&conn, "LATTE", 1, 400);

    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "t1", "S1")
        .unwrap();

    let tmp = std::env::temp_dir().join("oz-pos-test-csv");
    let files = write_analytics_bundle_csv(&bundle, tmp.to_str().unwrap()).unwrap();

    // Should have created at least metadata.json + daily_revenue.csv + top_products.csv + heatmap + categories
    assert!(files.iter().any(|f| f.ends_with("metadata.json")));
    assert!(files.iter().any(|f| f.ends_with("daily_revenue.csv")));
    assert!(files.iter().any(|f| f.ends_with("top_products.csv")));
    // The popularity standings + forecast ride the export too.
    assert!(files.iter().any(|f| f.ends_with("category_popularity.csv")));
    assert!(files.iter().any(|f| f.ends_with("category_forecast.csv")));
}

#[test]
fn csv_export_empty_bundle_writes_metadata_only() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "", "")
        .unwrap();

    let tmp = std::env::temp_dir().join("oz-pos-test-csv-empty");
    let files = write_analytics_bundle_csv(&bundle, tmp.to_str().unwrap()).unwrap();

    // Only metadata.json should be written (bundle is empty)
    assert_eq!(files.len(), 1);
    assert!(files[0].ends_with("metadata.json"));
}

// ── REP-07: Custom report pagination ──────────────────────────────

#[test]
fn custom_report_unbounded_without_limit() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);

    // Create 150 products to test unbounded results
    for i in 0..150 {
        let sku = format!("PROD{:03}", i);
        s.create_product(&sku, &sku, price(100), None, None, 100, None)
            .unwrap();
    }

    // Request without limit should return all rows (current behavior - unbounded)
    let req = CustomReportRequest {
        dataset: "inventory".to_string(),
        columns: vec!["sku".to_string(), "name".to_string()],
        start_date: None,
        end_date: None,
        limit: None,
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    assert_eq!(resp.rows.len(), 150); // All 150 products returned
    assert!(!resp.truncated, "without limit, should not be truncated");
}

#[test]
fn custom_report_respects_limit() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);

    // Create 150 products
    for i in 0..150 {
        let sku = format!("PROD{:03}", i);
        s.create_product(&sku, &sku, price(100), None, None, 100, None)
            .unwrap();
    }

    // Request with limit=50 should return only 50 rows
    let req = CustomReportRequest {
        dataset: "inventory".to_string(),
        columns: vec!["sku".to_string(), "name".to_string()],
        start_date: None,
        end_date: None,
        limit: Some(50),
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    assert_eq!(resp.rows.len(), 50);
    assert!(
        resp.truncated,
        "with limit < total rows, should be truncated"
    );
}

#[test]
fn custom_report_respects_offset_and_limit() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);

    // Create 150 products
    for i in 0..150 {
        let sku = format!("PROD{:03}", i);
        s.create_product(&sku, &sku, price(100), None, None, 100, None)
            .unwrap();
    }

    // Request with offset=50, limit=50 should return rows 51-100
    let req = CustomReportRequest {
        dataset: "inventory".to_string(),
        columns: vec!["sku".to_string(), "name".to_string()],
        start_date: None,
        end_date: None,
        limit: Some(50),
        offset: Some(50),
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    assert_eq!(resp.rows.len(), 50);
    assert!(resp.truncated);
    // First row should be PROD050 (0-indexed)
    assert_eq!(resp.rows[0][0], "PROD050");
}

#[test]
fn custom_report_limit_clamped_to_max() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);

    // Create 150 products
    for i in 0..150 {
        let sku = format!("PROD{:03}", i);
        s.create_product(&sku, &sku, price(100), None, None, 100, None)
            .unwrap();
    }

    // Request with limit=10000 (exceeds max) should be clamped to 1000
    // But we only have 150 products, so we get all 150 (not truncated)
    let req = CustomReportRequest {
        dataset: "inventory".to_string(),
        columns: vec!["sku".to_string(), "name".to_string()],
        start_date: None,
        end_date: None,
        limit: Some(10000),
        offset: None,
    };
    let resp = s.build_custom_report(req).unwrap();
    assert_eq!(resp.columns.len(), 2);
    // Should be clamped to MAX_LIMIT (1000) but we only have 150 products
    assert_eq!(resp.rows.len(), 150);
    assert!(
        !resp.truncated,
        "should not be truncated when total < clamped limit"
    );
}

#[test]
fn csv_cell_escaping() {
    assert_eq!(csv_cell("hello"), "hello");
    assert_eq!(csv_cell("hello, world"), "\"hello, world\"");
    assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
}
