//! Unit tests for the untrusted-API rate → fixed-point conversion.

use super::*;

#[test]
fn converts_ordinary_rates_exactly() {
    assert_eq!(rate_to_millionths(1.0), Some(1_000_000));
    assert_eq!(rate_to_millionths(1.08), Some(1_080_000));
    assert_eq!(rate_to_millionths(16_000.0), Some(16_000_000_000));
    assert_eq!(rate_to_millionths(0.92), Some(920_000));
}

#[test]
fn neutralises_fp_offbyone_at_the_sixth_decimal() {
    // 1.495 * 1e6 = 1494999.9999999998 in binary — .round() must recover 1495000.
    assert_eq!(rate_to_millionths(1.495), Some(1_495_000));
    assert_eq!(rate_to_millionths(149.5), Some(149_500_000));
}

#[test]
fn rejects_non_positive_and_non_finite() {
    assert_eq!(rate_to_millionths(0.0), None);
    assert_eq!(rate_to_millionths(-1.0), None);
    assert_eq!(rate_to_millionths(f64::NAN), None);
    assert_eq!(rate_to_millionths(f64::INFINITY), None);
    assert_eq!(rate_to_millionths(f64::NEG_INFINITY), None);
}

#[test]
fn rejects_absurd_magnitudes_that_would_saturate_the_cast() {
    // The pre-fix `(rate * RATE_SCALE).round() as i64` saturates these to
    // i64::MAX, which then PASSES the repo's >0 validation and persists a
    // garbage rate from an untrusted network response.
    assert_eq!(rate_to_millionths(1e300), None);
    assert_eq!(rate_to_millionths(1e10), None);
    assert_eq!(rate_to_millionths(f64::MAX), None);
}

#[test]
fn rejects_rates_below_the_fixed_point_resolution() {
    // 5e-7 rounds to 1 (half-up); 1e-7 rounds to 0 — a zero millionths
    // rate would be rejected by the repo anyway, so the helper says None
    // and the sync logs it instead of swallowing an error.
    assert_eq!(rate_to_millionths(5e-7), Some(1));
    assert_eq!(rate_to_millionths(1e-7), None);
}

#[test]
fn accepts_the_top_of_the_bounded_range() {
    // Just under the 1e10 bound; the product stays inside f64 exactness.
    assert_eq!(rate_to_millionths(999_999_999.0), Some(999_999_999_000_000));
}

// ── Daemon behaviour tests ───────────────────────────────────────────
//
// Moved here from the inline `mod tests` block in `rate_sync.rs` (C28).

#[tokio::test]
async fn daemon_starts_stopped() {
    let daemon = RateSyncDaemon::new();
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_start_and_stop() {
    let conn = kasirmu_core::migrations::fresh_db();
    let db = Arc::new(std::sync::Mutex::new(conn));
    let daemon = RateSyncDaemon::new();
    daemon.start(db).await;
    assert!(daemon.is_running().await);
    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_status_defaults() {
    let daemon = RateSyncDaemon::new();
    let status = daemon.status().await;
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert_eq!(status.rates_updated, 0);
    assert!(status.last_error.is_none());
}

#[tokio::test]
async fn daemon_custom_interval() {
    let daemon = RateSyncDaemon::with_interval(Duration::from_millis(50));
    assert_eq!(daemon.interval(), Duration::from_millis(50));
}

#[tokio::test]
async fn daemon_set_interval() {
    let mut daemon = RateSyncDaemon::new();
    daemon.set_interval(Duration::from_secs(10));
    assert_eq!(daemon.interval(), Duration::from_secs(10));
}

#[tokio::test]
async fn daemon_stop_when_not_running_is_noop() {
    let daemon = RateSyncDaemon::new();
    daemon.stop().await;
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_double_start_is_noop() {
    let conn = kasirmu_core::migrations::fresh_db();
    let db = Arc::new(std::sync::Mutex::new(conn));
    let daemon = RateSyncDaemon::new();
    daemon.start(db.clone()).await;
    assert!(daemon.is_running().await);
    daemon.start(db).await;
    assert!(daemon.is_running().await);
    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn frankfurter_response_deserialization() {
    let json = r#"{
            "amount": 1.0,
            "base": "USD",
            "date": "2026-06-30",
            "rates": {
                "EUR": 0.9234,
                "GBP": 0.7932,
                "JPY": 149.85
            }
        }"#;
    let resp: FrankfurterResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.base, "USD");
    assert_eq!(resp.date, "2026-06-30");
    assert!((resp.rates["EUR"] - 0.9234).abs() < 0.0001);
    assert!((resp.rates["GBP"] - 0.7932).abs() < 0.0001);
    assert!((resp.rates["JPY"] - 149.85).abs() < 0.01);
    assert_eq!(resp.rates.len(), 3);
}
