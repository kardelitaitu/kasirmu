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
            exported_at: "".into(),
            tenant_id: "".into(),
            store_name: "".into(),
            version: "".into(),
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
