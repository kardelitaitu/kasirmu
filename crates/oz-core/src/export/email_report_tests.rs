use super::*;
use crate::db::Store;
use crate::db::reports::{CategoryBreakdownRow, HourlyHeatmapRow, LowStockAlert, TopProductRow};
use crate::export::{AnalyticsBundle, ExportConfig, ExportMetadata};
use crate::migrations;

// ── Helper: build a minimal AnalyticsBundle without DB ───────────────────────

fn minimal_bundle() -> AnalyticsBundle {
    AnalyticsBundle {
        metadata: ExportMetadata {
            exported_at: "2026-08-31T00:00:00Z".into(),
            tenant_id: "t1".into(),
            store_name: "Test".into(),
            version: "0.0.33".into(),
        },
        daily_revenue: vec![],
        weekly_revenue: vec![],
        monthly_revenue: vec![],
        top_products: vec![],
        hourly_heatmap: vec![],
        category_breakdown: vec![],
        low_stock_alerts: vec![],
        active_stock_alerts: vec![],
        category_popularity: vec![],
        category_forecast: vec![],
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXISTING TESTS (preserved)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn smtp_config_defaults() {
    let cfg = SmtpConfig::default();
    assert!(cfg.host.is_empty());
    assert_eq!(cfg.port, 587);
    assert!(cfg.username.is_none());
    assert!(cfg.password.is_none());
    assert!(cfg.from.is_empty());
    assert!(cfg.use_tls);
}

#[test]
fn smtp_config_valid_passes() {
    let cfg = SmtpConfig {
        host: "smtp.example.com".into(),
        port: 587,
        username: Some("user".into()),
        password: Some("pass".into()),
        from: "reports@store.com".into(),
        use_tls: true,
    };
    assert!(cfg.validate().is_ok());
}

#[test]
fn smtp_config_empty_host_fails() {
    let cfg = SmtpConfig {
        host: "".into(),
        ..SmtpConfig::default()
    };
    let err = cfg.validate().unwrap_err();
    assert!(format!("{err}").contains("host"));
}

#[test]
fn smtp_config_zero_port_fails() {
    let cfg = SmtpConfig {
        host: "smtp.example.com".into(),
        port: 0,
        ..SmtpConfig::default()
    };
    let err = cfg.validate().unwrap_err();
    assert!(format!("{err}").contains("port"));
}

#[test]
fn smtp_config_invalid_from_email_fails() {
    let cfg = SmtpConfig {
        host: "smtp.example.com".into(),
        port: 587,
        from: "not-an-email".into(),
        ..SmtpConfig::default()
    };
    let err = cfg.validate().unwrap_err();
    assert!(format!("{err}").contains("valid email"));
}

#[test]
fn smtp_config_from_with_at_only_fails() {
    let cfg = SmtpConfig {
        host: "smtp.example.com".into(),
        port: 587,
        from: "user@".into(),
        ..SmtpConfig::default()
    };
    let err = cfg.validate().unwrap_err();
    assert!(format!("{err}").contains("valid email"));
}

#[test]
fn smtp_config_save_and_load() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let loaded = s.get_smtp_config().unwrap();
    assert!(loaded.is_none());

    let cfg = SmtpConfig {
        host: "smtp.example.com".into(),
        port: 587,
        username: Some("apikey".into()),
        password: Some("secret123".into()),
        from: "pos@mystore.com".into(),
        use_tls: true,
    };
    s.save_smtp_config(&cfg).unwrap();
    let loaded = s.get_smtp_config().unwrap().unwrap();
    assert_eq!(loaded.host, "smtp.example.com");
    assert_eq!(loaded.port, 587);
    assert_eq!(loaded.username, Some("apikey".into()));
    assert_eq!(loaded.password, Some("secret123".into()));
    assert_eq!(loaded.from, "pos@mystore.com");
    assert!(loaded.use_tls);
}

#[test]
fn smtp_config_roundtrip_none_values() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let cfg = SmtpConfig {
        host: "mail.server.com".into(),
        port: 25,
        username: None,
        password: None,
        from: "noreply@server.com".into(),
        use_tls: false,
    };
    s.save_smtp_config(&cfg).unwrap();
    let loaded = s.get_smtp_config().unwrap().unwrap();
    assert_eq!(loaded.host, "mail.server.com");
    assert!(loaded.username.is_none());
    assert!(loaded.password.is_none());
    assert!(!loaded.use_tls);
}
// ── Keep-on-blank merge (the smtp_config data-loss guard) ───────────────────

/// The bug this pins: `smtp_config` is on `SECRET_KEY_DENY_LIST`, so the
/// email-report card cannot read the stored password back. It renders an
/// empty field and saves a blob whose `password` is null. Before the merge,
/// that write replaced the stored secret with null and mail silently stopped
/// sending; now the stored password survives and every other field updates.
#[test]
fn save_smtp_config_null_password_preserves_stored_password() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    s.save_smtp_config(&SmtpConfig {
        host: "smtp.old.com".into(),
        port: 465,
        username: Some("ops@mystore.com".into()),
        password: Some("stored-secret".into()),
        from: "reports@mystore.com".into(),
        use_tls: true,
    })
    .unwrap();

    // What the card posts when the operator edits host/from and never
    // touches the (unreadable) password field.
    s.save_smtp_config(&SmtpConfig {
        host: "smtp.new.com".into(),
        port: 587,
        username: Some("new-user@mystore.com".into()),
        password: None,
        from: "changed@mystore.com".into(),
        use_tls: false,
    })
    .unwrap();

    let loaded = s.get_smtp_config().unwrap().unwrap();
    assert_eq!(
        loaded.password.as_deref(),
        Some("stored-secret"),
        "an absent/null password means the masked field was not modified, not clear it"
    );
    // The rest of the blob must still update — the merge is password-only.
    assert_eq!(loaded.host, "smtp.new.com");
    assert_eq!(loaded.port, 587);
    assert_eq!(loaded.username.as_deref(), Some("new-user@mystore.com"));
    assert_eq!(loaded.from, "changed@mystore.com");
    assert!(!loaded.use_tls);
}

/// The same guard on the raw-JSON entry point the generic settings write
/// surface uses: a blob with an explicit `"password":null` keeps the secret.
#[test]
fn save_smtp_config_json_null_password_preserves_stored_password() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    s.save_smtp_config(&SmtpConfig {
        host: "smtp.old.com".into(),
        from: "reports@mystore.com".into(),
        password: Some("stored-secret".into()),
        ..SmtpConfig::default()
    })
    .unwrap();

    s.save_smtp_config_json(
        r#"{"host":"smtp.new.com","port":2525,"username":null,"password":null,"from":"x@mystore.com","use_tls":false}"#,
    )
    .unwrap();

    let loaded = s.get_smtp_config().unwrap().unwrap();
    assert_eq!(loaded.password.as_deref(), Some("stored-secret"));
    assert_eq!(loaded.host, "smtp.new.com");
    assert_eq!(loaded.port, 2525);
    assert_eq!(loaded.from, "x@mystore.com");
}

/// Keep-on-blank must not become keep-forever: a genuinely supplied password
/// still overwrites the stored one, and it is still encrypted at rest.
#[test]
fn save_smtp_config_supplied_password_still_overwrites() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    s.save_smtp_config(&SmtpConfig {
        host: "smtp.old.com".into(),
        from: "reports@mystore.com".into(),
        password: Some("old-secret".into()),
        ..SmtpConfig::default()
    })
    .unwrap();

    s.save_smtp_config(&SmtpConfig {
        host: "smtp.old.com".into(),
        from: "reports@mystore.com".into(),
        password: Some("rotated-secret".into()),
        ..SmtpConfig::default()
    })
    .unwrap();

    let loaded = s.get_smtp_config().unwrap().unwrap();
    assert_eq!(loaded.password.as_deref(), Some("rotated-secret"));
    let raw = s.get_setting(SMTP_CONFIG_SETTINGS_KEY).unwrap().unwrap();
    assert!(
        !raw.contains("rotated-secret"),
        "a supplied password must still be encrypted at rest, got: {raw}"
    );

    // An explicit empty string is the one shape that means clear.
    s.save_smtp_config_json(
        r#"{"host":"smtp.old.com","port":587,"username":null,"password":"","from":"reports@mystore.com","use_tls":true}"#,
    )
    .unwrap();
    let cleared = s.get_smtp_config().unwrap().unwrap();
    assert!(
        cleared.password.is_none(),
        "an explicit empty password is a clear, not a keep"
    );
}

/// The masked read-back ships a boolean and nothing else — the deny list
/// stays intact, so no surface returns the password itself.
#[test]
fn smtp_password_configured_reports_boolean_only() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    assert!(!s.smtp_password_configured().unwrap());

    s.save_smtp_config(&SmtpConfig {
        host: "smtp.test.com".into(),
        from: "t@t.com".into(),
        password: Some("a-secret".into()),
        ..SmtpConfig::default()
    })
    .unwrap();
    assert!(s.smtp_password_configured().unwrap());

    // A save that omits the password leaves the indicator true.
    s.save_smtp_config(&SmtpConfig {
        host: "smtp.other.com".into(),
        from: "t@t.com".into(),
        password: None,
        ..SmtpConfig::default()
    })
    .unwrap();
    assert!(s.smtp_password_configured().unwrap());
}

fn sample_bundle() -> AnalyticsBundle {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    s.create_product(
        "COFFEE",
        "Coffee",
        crate::Money::from_major(3_50, "USD".parse().unwrap()).unwrap(),
        None,
        None,
        100,
        None,
    )
    .unwrap();
    s.create_product(
        "BAGEL",
        "Bagel",
        crate::Money::from_major(4_50, "USD".parse().unwrap()).unwrap(),
        None,
        None,
        50,
        None,
    )
    .unwrap();

    let mut cart = crate::Cart::new("USD".parse().unwrap());
    cart.add_line(crate::CartLine::new(
        crate::Sku::new("COFFEE"),
        2,
        crate::Money::from_major(3_50, "USD".parse().unwrap()).unwrap(),
    ))
    .unwrap();
    cart.add_line(crate::CartLine::new(
        crate::Sku::new("BAGEL"),
        1,
        crate::Money::from_major(4_50, "USD".parse().unwrap()).unwrap(),
    ))
    .unwrap();

    let mut sale = crate::Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Completed)
        .unwrap();

    s.export_analytics_bundle(ExportConfig::default(), "t1", "Test Store")
        .unwrap()
}

#[test]
fn report_email_subject_contains_store_and_date() {
    let bundle = sample_bundle();
    let email = ReportEmailBuilder::build(&bundle, "My Store", "2026-07-20");
    assert!(email.subject.contains("My Store"));
    assert!(email.subject.contains("2026-07-20"));
    assert!(email.subject.contains("OZ-POS Report"));
}

#[test]
fn report_email_html_contains_tables() {
    let bundle = sample_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("<table"));
    assert!(email.html_body.contains("Daily Revenue"));
    assert!(email.html_body.contains("Top Products"));
    assert!(email.html_body.contains("Gross Profit"));
    assert!(email.html_body.contains("Margin"));
    assert!(email.html_body.contains("OZ-POS Report"));
    assert!(email.html_body.contains("</html>"));
}

#[test]
fn report_email_text_contains_sections() {
    let bundle = sample_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("DAILY REVENUE"));
    assert!(email.text_body.contains("TOP PRODUCTS"));
    assert!(email.text_body.contains("Gross Profit"));
    assert!(email.text_body.contains("Margin"));
    assert!(email.text_body.contains("OZ-POS Report"));
}

#[test]
fn report_email_top_products_show_gross_profit_and_margin() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    s.create_product_with_attributes(
        "COFFEE",
        "Coffee",
        crate::Money::from_major(3_50, "USD".parse().unwrap()).unwrap(),
        None,
        None,
        100,
        None,
        &crate::db::products::CreateProductAttributes {
            cost_minor: 20000,
            ..Default::default()
        },
    )
    .unwrap();
    let mut cart = crate::Cart::new("USD".parse().unwrap());
    cart.add_line(crate::CartLine::new(
        crate::Sku::new("COFFEE"),
        2,
        crate::Money::from_major(3_50, "USD".parse().unwrap()).unwrap(),
    ))
    .unwrap();
    let mut sale = crate::Sale::from_cart(&cart).unwrap();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    sale.created_at = now.clone();
    sale.updated_at = now;
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Completed)
        .unwrap();

    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "t1", "Store")
        .unwrap();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains(">300.00</td>"));
    assert!(email.html_body.contains("42.9%"));
    assert!(email.text_body.contains("300.00"));
    assert!(email.text_body.contains("42.9%"));
}

#[test]
fn report_email_empty_bundle_generates_minimal() {
    let conn = migrations::fresh_db();
    let s = Store::new(&conn);
    let bundle = s
        .export_analytics_bundle(ExportConfig::default(), "", "")
        .unwrap();
    let email = ReportEmailBuilder::build(&bundle, "Empty Store", "period");
    assert!(email.html_body.contains("OZ-POS Report"));
    assert!(!email.html_body.contains("Daily Revenue"));
    assert!(email.text_body.contains("OZ-POS Report"));
}

#[test]
fn html_escape_handles_special_chars() {
    assert_eq!(html_escape("a&b<c>d\"e"), "a&amp;b&lt;c&gt;d&quot;e");
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TESTS: COR-36 bug, format_amount, edge cases, sections
// ═══════════════════════════════════════════════════════════════════════════════

// ── COR-36: char-boundary truncation (fixed) ──────────────────────────────────
//
// render_text previously truncated product names at byte 21: `&row.name[..21]`,
// which panicked on multi-byte UTF-8. Now uses char_indices for char-boundary
// slicing — multi-byte names are truncated safely with `…` appended.

#[test]
fn render_text_multibyte_name_truncates_safely() {
    // "Café Latte 拿鐵 濃縮" is 28 bytes in UTF-8.
    // Byte 21 falls inside the 3-byte character 拿 (bytes 20-22).
    // The old code panicked — the new code truncates at char boundary.
    let name = "Café Latte 拿鐵 濃縮";
    let mut bundle = minimal_bundle();
    bundle.top_products = vec![TopProductRow {
        currency: "USD".into(),
        product_id: "p1".into(),
        sku: "COFFEE".into(),
        name: name.to_string(),
        total_qty: 10,
        total_minor: 3500,
        cogs_minor: 2000,
        gross_profit_minor: 1500,
        gross_margin_percent: 42.9,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today").text_body;
    // COR-36: must not panic — the truncated name ends with `…`.
    assert!(
        email.contains("…"),
        "multi-byte name should be truncated with …"
    );
    // The full name should NOT appear (it's longer than 22 chars).
    assert!(
        !email.contains("濃縮"),
        "full multi-byte name must not appear"
    );
}

#[test]
fn render_text_ascii_name_truncates_correctly() {
    // ASCII name > 22 bytes should be truncated safely.
    let name = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 bytes
    let mut bundle = minimal_bundle();
    bundle.top_products = vec![TopProductRow {
        currency: "USD".into(),
        product_id: "p1".into(),
        sku: "SKU".into(),
        name: name.to_string(),
        total_qty: 5,
        total_minor: 1000,
        cogs_minor: 500,
        gross_profit_minor: 500,
        gross_margin_percent: 50.0,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    // ASCII truncation: &name[..21] = "ABCDEFGHIJKLMNO……PQRSTU" + "\u{2026}"
    assert!(email.text_body.contains("ABCDEFGHIJKLMNO"));
    // The full name should NOT appear (it's longer than 22 chars)
    assert!(!email.text_body.contains(name));
}

#[test]
fn render_text_short_name_not_truncated() {
    // Name ≤ 22 bytes should NOT be truncated.
    let name = "Latte"; // 5 bytes
    let mut bundle = minimal_bundle();
    bundle.top_products = vec![TopProductRow {
        currency: "USD".into(),
        product_id: "p1".into(),
        sku: "SKU".into(),
        name: name.to_string(),
        total_qty: 5,
        total_minor: 1000,
        cogs_minor: 500,
        gross_profit_minor: 500,
        gross_margin_percent: 50.0,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("Latte"));
    assert!(!email.text_body.contains("Latte…"));
}

// ── format_amount ────────────────────────────────────────────────────────────

#[test]
fn format_amount_with_currency() {
    let result = format_amount(35000, "USD");
    assert!(result.contains("USD"));
    assert!(result.contains("350.00"));
}

#[test]
fn format_amount_without_currency() {
    let result = format_amount(35000, "");
    assert!(!result.contains("USD"));
    assert!(result.contains("350.00"));
}

#[test]
fn format_amount_zero() {
    let result = format_amount(0, "USD");
    assert!(result.contains("0.00"));
}

#[test]
fn format_amount_negative() {
    let result = format_amount(-5000, "USD");
    assert!(result.contains("-50.00"));
}

#[test]
fn format_amount_large_value() {
    let result = format_amount(100_000_000, "USD");
    assert!(result.contains("1000000.00"));
    assert!(result.contains("USD"));
}

// ── html_escape edge cases ───────────────────────────────────────────────────

#[test]
fn html_escape_empty_string() {
    assert_eq!(html_escape(""), "");
}

#[test]
fn html_escape_no_special_chars() {
    assert_eq!(html_escape("hello world"), "hello world");
}

#[test]
fn html_escape_multiple_special_chars() {
    let input = "a&b<c>d\"e'f";
    let escaped = html_escape(input);
    assert!(escaped.contains("&amp;"));
    assert!(escaped.contains("&lt;"));
    assert!(escaped.contains("&gt;"));
    assert!(escaped.contains("&quot;"));
    // Note: single quotes are NOT escaped by the current implementation
}

#[test]
fn html_escape_unicode_passthrough() {
    let input = "Café ☕ 日本語";
    assert_eq!(html_escape(input), input);
}

// ── SmtpConfig serde roundtrip ───────────────────────────────────────────────

#[test]
fn smtp_config_serde_roundtrip() {
    let cfg = SmtpConfig {
        host: "smtp.gmail.com".into(),
        port: 465,
        username: Some("user@gmail.com".into()),
        password: Some("app-password".into()),
        from: "reports@mystore.com".into(),
        use_tls: true,
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let parsed: SmtpConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.host, "smtp.gmail.com");
    assert_eq!(parsed.port, 465);
    assert_eq!(parsed.username, Some("user@gmail.com".into()));
    assert_eq!(parsed.password, Some("app-password".into()));
    assert_eq!(parsed.from, "reports@mystore.com");
    assert!(parsed.use_tls);
}

#[test]
fn smtp_config_serde_with_none_fields() {
    let cfg = SmtpConfig {
        host: "mail.test.com".into(),
        port: 25,
        username: None,
        password: None,
        from: "test@test.com".into(),
        use_tls: false,
    };
    let json = serde_json::to_string(&cfg).unwrap();
    let parsed: SmtpConfig = serde_json::from_str(&json).unwrap();
    assert!(parsed.username.is_none());
    assert!(parsed.password.is_none());
}

#[test]
fn smtp_config_debug_and_clone() {
    let cfg = SmtpConfig::default();
    let cloned = cfg.clone();
    assert_eq!(cloned.host, cfg.host);

    let debug = format!("{cfg:?}");
    assert!(debug.contains("SmtpConfig"));
}

// ── SmtpConfig validation edge cases ─────────────────────────────────────────

#[test]
fn smtp_config_whitespace_only_host_fails() {
    let cfg = SmtpConfig {
        host: "   ".into(),
        ..SmtpConfig::default()
    };
    assert!(cfg.validate().is_err());
}

#[test]
fn smtp_config_whitespace_only_from_fails() {
    let cfg = SmtpConfig {
        host: "smtp.test.com".into(),
        from: "   ".into(),
        ..SmtpConfig::default()
    };
    assert!(cfg.validate().is_err());
}

#[test]
fn smtp_config_from_without_dot_fails() {
    let cfg = SmtpConfig {
        host: "smtp.test.com".into(),
        from: "user@localhost".into(),
        ..SmtpConfig::default()
    };
    let err = cfg.validate().unwrap_err();
    assert!(format!("{err}").contains("valid email"));
}

#[test]
fn smtp_config_port_max_valid() {
    let cfg = SmtpConfig {
        host: "smtp.test.com".into(),
        port: 65535,
        from: "test@test.com".into(),
        ..SmtpConfig::default()
    };
    assert!(cfg.validate().is_ok());
}

#[test]
fn smtp_config_port_one_valid() {
    let cfg = SmtpConfig {
        host: "smtp.test.com".into(),
        port: 1,
        from: "test@test.com".into(),
        ..SmtpConfig::default()
    };
    assert!(cfg.validate().is_ok());
}

// ── ReportEmail struct ───────────────────────────────────────────────────────

#[test]
fn report_email_debug_and_clone() {
    let email = ReportEmail {
        subject: "Test".into(),
        html_body: "<p>Hi</p>".into(),
        text_body: "Hi".into(),
    };
    let cloned = email.clone();
    assert_eq!(cloned.subject, "Test");

    let debug = format!("{email:?}");
    assert!(debug.contains("ReportEmail"));
}

// ── Low Stock Alerts section ─────────────────────────────────────────────────

#[test]
fn report_email_low_stock_alerts_html() {
    let mut bundle = minimal_bundle();
    bundle.low_stock_alerts = vec![LowStockAlert {
        product_id: "p1".into(),
        sku: "WIDGET".into(),
        name: "Widget".into(),
        current_qty: 2,
        threshold: 10,
        currency: "USD".into(),
        price_minor: 1000,
        cost_minor: 500,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("Low Stock Alerts"));
    assert!(email.html_body.contains("WIDGET"));
    assert!(email.html_body.contains("Widget"));
    assert!(email.html_body.contains("2")); // current_qty
    assert!(email.html_body.contains("10")); // threshold
}

#[test]
fn report_email_low_stock_alerts_text() {
    let mut bundle = minimal_bundle();
    bundle.low_stock_alerts = vec![LowStockAlert {
        product_id: "p1".into(),
        sku: "WIDGET".into(),
        name: "Widget".into(),
        current_qty: 2,
        threshold: 10,
        currency: "USD".into(),
        price_minor: 1000,
        cost_minor: 500,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("LOW STOCK ALERTS"));
    assert!(email.text_body.contains("WIDGET"));
    assert!(email.text_body.contains("2 in stock"));
    assert!(email.text_body.contains("threshold: 10"));
}

#[test]
fn report_email_empty_low_stock_no_section() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(!email.html_body.contains("Low Stock"));
    assert!(!email.text_body.contains("LOW STOCK"));
}

// ── Hourly Heatmap section ───────────────────────────────────────────────────

#[test]
fn report_email_hourly_heatmap_html() {
    let mut bundle = minimal_bundle();
    bundle.hourly_heatmap = vec![
        HourlyHeatmapRow {
            currency: "USD".into(),
            day_of_week: 1,
            hour: 9,
            total_minor: 5000,
            sale_count: 10,
        },
        HourlyHeatmapRow {
            currency: "USD".into(),
            day_of_week: 1,
            hour: 12,
            total_minor: 8000,
            sale_count: 15,
        },
    ];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("Hourly Activity"));
    assert!(email.html_body.contains("Peak hour"));
    assert!(email.html_body.contains("15 sales")); // peak
}

#[test]
fn report_email_hourly_heatmap_text() {
    let mut bundle = minimal_bundle();
    bundle.hourly_heatmap = vec![
        HourlyHeatmapRow {
            currency: "USD".into(),
            day_of_week: 1,
            hour: 9,
            total_minor: 5000,
            sale_count: 10,
        },
        HourlyHeatmapRow {
            currency: "USD".into(),
            day_of_week: 1,
            hour: 12,
            total_minor: 8000,
            sale_count: 15,
        },
    ];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("HOURLY ACTIVITY"));
    assert!(email.text_body.contains("Peak"));
    assert!(email.text_body.contains("15 sales"));
}

// ── Category Breakdown section ───────────────────────────────────────────────

#[test]
fn report_email_category_breakdown_html() {
    let mut bundle = minimal_bundle();
    bundle.category_breakdown = vec![CategoryBreakdownRow {
        currency: "USD".into(),
        category_id: Some("cat-1".into()),
        category_name: "Drinks".into(),
        total_minor: 10000,
        sale_count: 20,
        percentage: 60.0,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("Category Breakdown"));
    assert!(email.html_body.contains("Drinks"));
    assert!(email.html_body.contains("60.0%"));
}

#[test]
fn report_email_category_breakdown_text() {
    let mut bundle = minimal_bundle();
    bundle.category_breakdown = vec![CategoryBreakdownRow {
        currency: "USD".into(),
        category_id: Some("cat-1".into()),
        category_name: "Drinks".into(),
        total_minor: 10000,
        sale_count: 20,
        percentage: 60.0,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("CATEGORY BREAKDOWN"));
    assert!(email.text_body.contains("Drinks"));
    assert!(email.text_body.contains("60.0%"));
}

// ── Empty sections ───────────────────────────────────────────────────────────

#[test]
fn report_email_empty_daily_revenue_no_section() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(!email.html_body.contains("Daily Revenue"));
    assert!(!email.text_body.contains("DAILY REVENUE"));
}

#[test]
fn report_email_empty_top_products_no_section() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(!email.html_body.contains("Top Products"));
    assert!(!email.text_body.contains("TOP PRODUCTS"));
}

#[test]
fn report_email_empty_category_no_section() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(!email.html_body.contains("Category Breakdown"));
    assert!(!email.text_body.contains("CATEGORY BREAKDOWN"));
}

#[test]
fn report_email_empty_hourly_no_section() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(!email.html_body.contains("Hourly Activity"));
    assert!(!email.text_body.contains("HOURLY ACTIVITY"));
}

// ── HTML structure ───────────────────────────────────────────────────────────

#[test]
fn report_email_html_is_valid_document() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.starts_with("<!DOCTYPE html>"));
    assert!(email.html_body.contains("<html"));
    assert!(email.html_body.contains("</html>"));
    assert!(email.html_body.contains("<head>"));
    assert!(email.html_body.contains("<body"));
    assert!(email.html_body.contains("</body>"));
}

#[test]
fn report_email_html_escapes_store_name() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "<script>alert(1)</script>", "today");
    assert!(email.html_body.contains("&lt;script&gt;"));
    assert!(!email.html_body.contains("<script>"));
}

// ── Unicode in data ──────────────────────────────────────────────────────────

#[test]
fn report_email_unicode_category_name() {
    let mut bundle = minimal_bundle();
    bundle.category_breakdown = vec![CategoryBreakdownRow {
        currency: "USD".into(),
        category_id: Some("cat-1".into()),
        category_name: "Minuman ☕".into(),
        total_minor: 5000,
        sale_count: 10,
        percentage: 100.0,
    }];
    let email = ReportEmailBuilder::build(&bundle, "Toko", "hari ini");
    assert!(email.html_body.contains("Minuman ☕"));
    assert!(email.text_body.contains("Minuman ☕"));
}

#[test]
fn report_email_unicode_store_name() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Toko Kopi ☕", "2026-08-31");
    assert!(email.subject.contains("Toko Kopi ☕"));
    assert!(email.html_body.contains("Toko Kopi ☕"));
    assert!(email.text_body.contains("Toko Kopi ☕"));
}

// ── Version in footer ────────────────────────────────────────────────────────

#[test]
fn report_email_html_contains_version_footer() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("Generated by OZ-POS v"));
}

#[test]
fn report_email_text_contains_version_footer() {
    let bundle = minimal_bundle();
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.text_body.contains("Generated by OZ-POS v"));
}

// ── Multiple daily revenue rows ──────────────────────────────────────────────

#[test]
fn report_email_multiple_daily_revenue_rows() {
    let mut bundle = minimal_bundle();
    bundle.daily_revenue = vec![
        crate::db::reports::DailyRevenueRow {
            date: "2026-08-29".into(),
            total_minor: 50000,
            currency: "USD".into(),
            sale_count: 10,
            cogs_minor: 30000,
            gross_profit_minor: 20000,
            gross_margin_percent: 40.0,
            refund_minor: 0,
            net_revenue_minor: 0,
        },
        crate::db::reports::DailyRevenueRow {
            date: "2026-08-30".into(),
            total_minor: 75000,
            currency: "USD".into(),
            sale_count: 15,
            cogs_minor: 45000,
            gross_profit_minor: 30000,
            gross_margin_percent: 40.0,
            refund_minor: 0,
            net_revenue_minor: 0,
        },
    ];
    let email = ReportEmailBuilder::build(&bundle, "Store", "Aug 29-30");
    assert!(email.html_body.contains("2026-08-29"));
    assert!(email.html_body.contains("2026-08-30"));
    assert!(email.text_body.contains("2026-08-29"));
    assert!(email.text_body.contains("2026-08-30"));
}

// ── Multiple top products ────────────────────────────────────────────────────

#[test]
fn report_email_multiple_top_products() {
    let mut bundle = minimal_bundle();
    bundle.top_products = vec![
        TopProductRow {
            currency: "USD".into(),
            product_id: "p1".into(),
            sku: "COFFEE".into(),
            name: "Coffee".into(),
            total_qty: 50,
            total_minor: 175000,
            cogs_minor: 100000,
            gross_profit_minor: 75000,
            gross_margin_percent: 42.9,
        },
        TopProductRow {
            currency: "USD".into(),
            product_id: "p2".into(),
            sku: "BAGEL".into(),
            name: "Bagel".into(),
            total_qty: 30,
            total_minor: 135000,
            cogs_minor: 90000,
            gross_profit_minor: 45000,
            gross_margin_percent: 33.3,
        },
    ];
    let email = ReportEmailBuilder::build(&bundle, "Store", "today");
    assert!(email.html_body.contains("COFFEE"));
    assert!(email.html_body.contains("BAGEL"));
    assert!(email.text_body.contains("COFFEE"));
    assert!(email.text_body.contains("BAGEL"));
}
