use super::*;
use crate::migrations;

#[test]
fn should_send_daily_within_window() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // send_at_time to current UTC time ± 1 min (within 2-min window)
    let now = Utc::now();
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".to_string(),
        send_at_time: now.format("%H:%M").to_string(),
        timezone: "UTC".to_string(),
        ..Default::default()
    };

    // Should return true (no last_sent_at record yet)
    let result = should_send_scheduled(&store, &schedule).unwrap();
    assert!(
        result,
        "should send when within time window and no prior send"
    );
}

#[test]
fn should_send_daily_outside_window() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // Set a time far from now (3 hours before current)
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".to_string(),
        send_at_time: Utc::now()
            .checked_sub_signed(chrono::Duration::hours(3))
            .unwrap()
            .format("%H:%M")
            .to_string(),
        timezone: "UTC".to_string(),
        ..Default::default()
    };

    let result = should_send_scheduled(&store, &schedule).unwrap();
    assert!(!result, "should NOT send when outside time window");
}

#[test]
fn dedup_blocks_same_day() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    // Record a send "today"
    record_sent_timestamp(&store).unwrap();

    let now = Utc::now();
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "daily".to_string(),
        send_at_time: now.format("%H:%M").to_string(),
        timezone: "UTC".to_string(),
        ..Default::default()
    };

    let result = should_send_scheduled(&store, &schedule).unwrap();
    assert!(!result, "dedup should block same-day resend");
}

#[test]
fn weekly_blocks_non_monday() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    // Set send time to current time so time check passes
    let now = Utc::now();
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "weekly".to_string(),
        send_at_time: now.format("%H:%M").to_string(),
        timezone: "UTC".to_string(),
        ..Default::default()
    };

    let result = should_send_scheduled(&store, &schedule).unwrap();

    // Only true if today is Monday AND time window matches
    let is_monday = now.weekday() == chrono::Weekday::Mon;
    assert_eq!(result, is_monday, "weekly should only send on Mondays");
}

#[test]
fn monthly_blocks_non_first() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let now = Utc::now();
    let schedule = ReportScheduleConfig {
        enabled: true,
        cadence: "monthly".to_string(),
        send_at_time: now.format("%H:%M").to_string(),
        timezone: "UTC".to_string(),
        ..Default::default()
    };

    let result = should_send_scheduled(&store, &schedule).unwrap();
    let is_first = now.day() == 1;
    assert_eq!(result, is_first, "monthly should only send on the 1st");
}

#[test]
fn filter_removes_unchecked_types() {
    use crate::export::ExportMetadata;

    let mut bundle = AnalyticsBundle {
        metadata: ExportMetadata {
            exported_at: String::new(),
            tenant_id: String::new(),
            store_name: String::new(),
            version: String::new(),
        },
        daily_revenue: vec![crate::db::reports::DailyRevenueRow {
            date: "2026-01-01".into(),
            total_minor: 1000,
            currency: "USD".into(),
            sale_count: 1,
            cogs_minor: 0,
            gross_profit_minor: 1000,
            gross_margin_percent: 100.0,
            refund_minor: 0,
            net_revenue_minor: 0,
        }],
        weekly_revenue: vec![crate::db::reports::WeeklyRevenueRow {
            week_start: "2026-01-01".into(),
            total_minor: 1000,
            currency: "USD".into(),
            sale_count: 1,
            cogs_minor: 0,
            gross_profit_minor: 1000,
            gross_margin_percent: 100.0,
            refund_minor: 0,
            net_revenue_minor: 0,
        }],
        monthly_revenue: vec![],
        top_products: vec![],
        hourly_heatmap: vec![],
        category_breakdown: vec![],
        low_stock_alerts: vec![],
        active_stock_alerts: vec![],
        category_popularity: vec![],
        category_forecast: vec![],
    };

    // Only include weekly_revenue
    let types = vec!["weekly_revenue".to_string()];
    filter_analytics_bundle(&mut bundle, &types);

    assert!(
        bundle.daily_revenue.is_empty(),
        "daily_revenue should be filtered out"
    );
    assert!(
        !bundle.weekly_revenue.is_empty(),
        "weekly_revenue should be kept"
    );
}

#[test]
fn record_and_read_timestamp() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);

    record_sent_timestamp(&store).unwrap();
    let val = store.get_setting(LAST_SENT_KEY).unwrap();
    assert!(val.is_some());
    assert!(val.unwrap().starts_with("20")); // ISO-8601 year
}
// ── COR-34: credentialed plaintext SMTP is refused (fail-closed) ──────────
//
// `build_smtp_transport` is the ONE implementation used by the cloud server, the
// desktop commands and the desktop scheduler (README at email_sender.rs:17-19). Its
// plaintext branch used to hand lettre `builder_dangerous` whatever credentials it had,
// which puts the SMTP username and password on the wire in clear. COR-34 made that an
// error; the module header records the fix and, until this test, nothing else did --
// `grep build_smtp_transport *_tests.rs` returned zero refs, so a regression here would
// silently downgrade every deployment to cleartext credentials and no gate would notice.
//
// The three cases below are the whole truth table of the guard:
//   1. plaintext + credentials            -> Err   (the leak COR-34 closes)
//   2. plaintext + NO credentials         -> Ok    (a local unauthenticated relay)
//   3. TLS + credentials                  -> Ok    (the intended authenticated path)
// Case 2 is the control. Without it, a guard that refused EVERY plaintext config would
// pass case 1 and quietly break every local relay deployment.

fn smtp(port: u16, use_tls: bool, creds: Option<(&str, &str)>) -> SmtpConfig {
    SmtpConfig {
        host: "localhost".to_string(),
        port,
        username: creds.map(|(u, _)| u.to_string()),
        password: creds.map(|(_, p)| p.to_string()),
        from: "reports@example.com".to_string(),
        use_tls,
    }
}

#[test]
fn plaintext_smtp_with_credentials_is_refused() {
    let err = build_smtp_transport(&smtp(587, false, Some(("user", "secret"))))
        .expect_err("credentialed plaintext SMTP must be refused, not built");
    assert!(
        err.contains("plaintext") && err.contains("credentials"),
        "the refusal must name the reason so an operator can act on it; got: {err}"
    );
}

#[test]
fn plaintext_smtp_without_credentials_is_allowed() {
    // The control case. A local relay that takes no credentials is legitimate, and
    // refusing it would be a regression dressed as a security fix.
    assert!(
        build_smtp_transport(&smtp(25, false, None)).is_ok(),
        "unauthenticated plaintext SMTP must still build"
    );
}

#[test]
fn tls_smtp_with_credentials_is_allowed() {
    assert!(
        build_smtp_transport(&smtp(587, true, Some(("user", "secret")))).is_ok(),
        "credentialed SMTP over STARTTLS is the intended path and must build"
    );
}

#[test]
fn implicit_tls_port_465_needs_no_use_tls_flag() {
    // email_sender.rs:66 treats port 465 as implicit TLS even when use_tls is false,
    // so credentials on 465 must NOT hit the refusal. This is the case a naive fix
    // ("refuse whenever use_tls is false") would break.
    assert!(
        build_smtp_transport(&smtp(465, false, Some(("user", "secret")))).is_ok(),
        "port 465 is implicit TLS; credentials there must build"
    );
}
