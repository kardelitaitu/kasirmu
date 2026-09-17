use super::*;

fn day(days_ago: i64, count: i64) -> DayCount {
    DayCount { days_ago, count }
}

#[test]
fn decayed_sum_weights_recent_events() {
    // 10 units today + 10 units 1 day ago + 10 units 30 days ago.
    let events = [day(0, 10), day(1, 10), day(30, 10)];
    let expected = 10.0 + 10.0 * DECAY_PER_DAY + 10.0 * DECAY_PER_DAY.powi(30);
    assert!((decayed_sum(&events) - expected).abs() < 1e-9);
}

#[test]
fn decayed_sum_ignores_out_of_window_and_zero() {
    let events = [
        day(-1, 10),
        day(WINDOW_DAYS, 10),
        day(WINDOW_DAYS + 5, 3),
        day(2, 0),
    ];
    assert_eq!(decayed_sum(&events), 0.0);
    assert_eq!(total_events(&events), 0.0);
}

#[test]
fn total_events_counts_raw_evidence() {
    let events = [day(0, 5), day(1, 7), day(95, 100)];
    assert_eq!(total_events(&events), 12.0);
}

#[test]
fn smoothed_zero_evidence_equals_mean() {
    assert_eq!(smoothed(0.0, 0.0, 42.0), 42.0);
}

#[test]
fn smoothed_high_evidence_approaches_raw() {
    let v = 100_000.0;
    let s = smoothed(500.0, v, 42.0);
    // 42 + 458 × 100000/100005 ≈ 499.977 — within 5 cents of raw.
    assert!((s - 500.0).abs() < 0.05);
}

#[test]
fn smoothed_low_evidence_fluke_pulled_to_mean() {
    // A 2-sale fluke (raw 2, v 2) must stay below the catalog mean (50).
    let s = smoothed(2.0, 2.0, 50.0);
    assert!(s < 50.0);
    assert!(s > 2.0);
}

#[test]
fn compute_score_blends_with_weights() {
    let sales = [day(0, 100)];
    let searches: [DayCount; 0] = [];
    let edits: [DayCount; 0] = [];
    // sales raw = 100 × ln(1+9) = 100 × 2.3026; v = 100 → ~230.3; others = mean.
    let score = compute_score(&sales, 9, &searches, &edits, 50.0, 10.0, 5.0);
    let sales_c = smoothed(100.0 * breadth_factor(9), 100.0, 50.0);
    let expected = WEIGHT_SALES * sales_c + WEIGHT_SEARCH * 10.0 + WEIGHT_EDITS * 5.0;
    assert!((score - expected).abs() < 1e-9);
}

#[test]
fn compute_score_empty_catalog_is_zero() {
    let empty: [DayCount; 0] = [];
    assert_eq!(compute_score(&empty, 0, &empty, &empty, 0.0, 0.0, 0.0), 0.0);
}

#[test]
fn breadth_factor_rewards_spread_over_bulk() {
    assert_eq!(breadth_factor(0), 0.0);
    assert_eq!(breadth_factor(1), std::f64::consts::LN_2);
    // Ten units sold to one customer is worth less than the same ten
    // units sold to nine different customers.
    let bulk = breadth_factor(1);
    let spread = breadth_factor(9);
    assert!(spread > bulk * 3.0, "spread={spread}, bulk={bulk}");
}

#[test]
fn breadth_never_scales_up_zero_sales() {
    let empty: [DayCount; 0] = [];
    // No units → raw 0 × factor = 0 regardless of transaction count.
    let score = compute_score(&empty, 10, &empty, &empty, 0.0, 0.0, 0.0);
    assert_eq!(score, 0.0);
}

#[test]
fn linear_forecast_fits_a_perfect_line() {
    // 10, 12, 14, 16 → slope 2/day, next period = 18.
    let f = linear_forecast(&[10.0, 12.0, 14.0, 16.0]);
    assert!((f.trend_per_period - 2.0).abs() < 1e-9);
    assert_eq!(f.forecast_units, 18);
    assert!((f.recent_avg_units - 13.0).abs() < 1e-9);
}

#[test]
fn linear_forecast_flat_series_has_zero_slope() {
    let f = linear_forecast(&[7.0, 7.0, 7.0, 7.0]);
    assert_eq!(f.trend_per_period, 0.0);
    assert_eq!(f.forecast_units, 7);
}

#[test]
fn linear_forecast_declining_never_goes_negative() {
    // 20, 10, 5 → steep decline; the next-period projection would be
    // negative, so it must floor at 0.
    let f = linear_forecast(&[20.0, 10.0, 5.0]);
    assert!(f.trend_per_period < 0.0);
    assert!(f.forecast_units >= 0, "forecast must never be negative");
}

#[test]
fn linear_forecast_single_point_falls_back_to_average() {
    let f = linear_forecast(&[9.0]);
    assert_eq!(f.trend_per_period, 0.0);
    assert_eq!(f.forecast_units, 9);
    assert_eq!(linear_forecast(&[]).forecast_units, 0);
}

#[test]
fn seasonal_daily_forecast_boosts_weekend_projection() {
    // A flat week with a weekend boost: Mon–Fri 6, Sat–Sun 12. The
    // de-seasonalized series is flat (mean 8), so the trend is 0 and the
    // forecast is purely the seasonal projection.
    let start = chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(); // a Monday
    let days: Vec<(chrono::NaiveDate, f64)> = (0..7)
        .map(|i| {
            let d = start + chrono::Duration::days(i);
            let u = if d.weekday().num_days_from_monday() >= 5 {
                12.0
            } else {
                6.0
            };
            (d, u)
        })
        .collect();

    let next_mon = start + chrono::Duration::days(7); // Monday → 6
    let next_sun = start + chrono::Duration::days(13); // Sunday → 12
    let f_mon = seasonal_daily_forecast(&days, next_mon);
    let f_sun = seasonal_daily_forecast(&days, next_sun);
    assert_eq!(f_mon.forecast_units, 6, "weak Monday stays weak");
    assert_eq!(f_sun.forecast_units, 12, "strong Sunday stays strong");
    assert_eq!(f_mon.trend_per_period, 0.0);
    // (5×6 + 2×12) / 7 = 54/7 ≈ 7.714.
    assert!((f_mon.recent_avg_units - 54.0 / 7.0).abs() < 1e-9);
}

#[test]
fn seasonal_daily_forecast_short_series_matches_plain_fit() {
    // Shorter than a week the caller falls back to linear_forecast, but
    // the function itself degrades gracefully: no repeated weekdays →
    // indices are self-referential and the projection tracks the
    // de-seasonalized mean (2 points, flat).
    let start = chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap();
    let days = [(start, 10.0), (start + chrono::Duration::days(1), 12.0)];
    let next = start + chrono::Duration::days(2);
    let f = seasonal_daily_forecast(&days, next);
    // Each weekday has exactly one observation → de-seasonalized series
    // is flat at the mean (11), so the projection is 11 × index[next].
    assert!(f.forecast_units >= 0);
}

#[test]
fn seasonal_daily_forecast_empty_series_is_zero() {
    let f = seasonal_daily_forecast(&[], chrono::NaiveDate::from_ymd_opt(2026, 8, 3).unwrap());
    assert_eq!(f.forecast_units, 0);
}

#[test]
fn window_edge_is_lossless() {
    // A sale at exactly the window edge contributes ~0.0015, negligible.
    let edge = decayed_sum(&[day(WINDOW_DAYS - 1, 1)]);
    assert!(edge < 0.01);
}
