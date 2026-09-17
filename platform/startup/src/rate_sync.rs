//! Exchange rate auto-sync daemon.
/*
last audited 25-07-26 by RSA-Agent (platform-startup slice B: rate_sync deep read)
crate: platform-startup | status: SAFE | lint: CLEAN
findings: exemplary — Frankfurter fetch with per-phase error capture into status; f64 rate to i64 millionths via documented fixed-point rounding with bounded-range safety rationale; RUST-07 poison recovery on both DB phases; spawn_blocking isolation with join-error handling; watch-channel graceful shutdown; per-rate upsert failure warns and continues; settings re-read per tick (no restart needed)
next: none | perf: blocking DB work off the async runtime
*/
//!
//! A background task that periodically fetches exchange rates from the
//! Frankfurter public API (`https://api.frankfurter.app`) and stores them
//! in the `exchange_rates` table using [`modules_currency::repository::CurrencyRepository::upsert_exchange_rate`].

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use modules_currency::repository::CurrencyRepository;
use serde::Deserialize;
use tokio::sync::{Mutex, RwLock, watch};
use tracing;

/// A reference to a shared DB connection, used by the daemon to create
/// temporary [`CurrencyRepository`] instances inside `spawn_blocking` closures.
pub type DbConnection = Arc<std::sync::Mutex<rusqlite::Connection>>;

/// Fixed-point scale from `f64` API rate to `i64` millionths for the
/// `exchange_rates.rate_millionths` column. `1.0` decimal rate = 1_000_000.
/// `6` decimals is sufficient for every fixture in the test suite
/// including the `0.00025` (JPY→KWD) extreme.
const RATE_SCALE: f64 = 1_000_000.0;

/// Convert an untrusted `f64` API rate to fixed-point `rate_millionths`.
///
/// Returns `None` for values that must never reach the repository:
/// non-finite (NaN/±inf), non-positive, magnitudes at or above `1e10`
/// (the bare `as i64` cast *saturates* to `i64::MAX`, which then passes
/// the repo's `> 0` validation and persists a garbage rate), and rates
/// below the fixed-point resolution that would round to zero. Legitimate
/// FX rates sit far inside the bound — the largest real-world pair is
/// ~10^4 per unit.
fn rate_to_millionths(rate: f64) -> Option<i64> {
    if !rate.is_finite() || rate <= 0.0 || rate >= 1e10 {
        return None;
    }
    let scaled = (rate * RATE_SCALE).round();
    if scaled < 1.0 {
        return None;
    }
    // 0 < scaled < 1e16 — far inside the i64 range, so the cast cannot
    // saturate or truncate.
    #[allow(clippy::cast_possible_truncation)]
    Some(scaled as i64)
}

/// Snapshot of the daemon's current state.
#[derive(Debug, Clone, Default)]
pub struct RateSyncStatus {
    /// Whether the daemon is currently running.
    pub running: bool,
    /// ISO-8601 timestamp of the last completed sync cycle.
    pub last_sync_at: Option<String>,
    /// Number of rates updated in the last cycle.
    pub rates_updated: usize,
    /// Base currency used in the last cycle.
    pub base_currency: String,
    /// Error message from the last cycle, if any.
    pub last_error: Option<String>,
}

/// Response shape from the Frankfurter API.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct FrankfurterResponse {
    amount: f64,
    base: String,
    date: String,
    rates: HashMap<String, f64>,
}

/// Default interval between sync cycles (6 hours).
const DEFAULT_SYNC_INTERVAL_MINUTES: u64 = 360;

/// A background task that periodically fetches exchange rates from the
/// Frankfurter public API and stores them in the database.
///
/// Settings are read from the database on every tick, so configuration
/// changes take effect on the next cycle without restarting.
pub struct RateSyncDaemon {
    interval: Duration,
    status: Arc<RwLock<RateSyncStatus>>,
    shutdown_tx: Arc<Mutex<Option<watch::Sender<bool>>>>,
}

impl RateSyncDaemon {
    /// Create a new rate sync daemon with the default interval (6 hours).
    pub fn new() -> Self {
        Self {
            interval: Duration::from_secs(DEFAULT_SYNC_INTERVAL_MINUTES * 60),
            status: Arc::new(RwLock::new(RateSyncStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Create a new rate sync daemon with a custom interval.
    pub fn with_interval(interval: Duration) -> Self {
        Self {
            interval,
            status: Arc::new(RwLock::new(RateSyncStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the background rate sync daemon.
    ///
    /// Spawns a `tokio` task that periodically:
    /// 1. Reads settings from the DB (blocking)
    /// 2. Fetches rates from the Frankfurter API (async)
    /// 3. Stores rates in the DB (blocking)
    ///
    /// If the daemon is already running, this is a no-op.
    pub async fn start(&self, db: DbConnection) {
        if self.is_running().await {
            tracing::warn!("rate sync daemon is already running");
            return;
        }

        let (tx, rx) = watch::channel(false);
        *self.shutdown_tx.lock().await = Some(tx);

        let daemon_status = Arc::clone(&self.status);

        {
            let mut s = daemon_status.write().await;
            s.running = true;
            s.last_error = None;
        }

        // COR-31: was a bare Client::new(), which has no timeout. In a
        // daemon this is worse than a hang in a request path, not better:
        // run_tick never returns, the loop never reaches the next tick, and
        // daemon_status.running stays true — so rate sync silently stops
        // updating while still reporting itself healthy. Small JSON GETs to
        // a rates API, so 10s connect / 30s total, matching the convention
        // used elsewhere for non-bulk calls.
        let http_client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                tracing::error!(
                    error = %e,
                    "could not build bounded HTTP client for rate sync; ticks are unbounded"
                );
                reqwest::Client::new()
            });
        let interval = self.interval;

        tokio::spawn(async move {
            let mut rx = rx;

            tracing::info!("rate sync daemon started");

            loop {
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {
                        Self::run_tick(&db, &daemon_status, &http_client).await;
                    }
                    res = rx.changed() => {
                        if res.is_err() || *rx.borrow() {
                            tracing::info!("rate sync daemon shutting down");
                            break;
                        }
                    }
                }
            }

            let mut s = daemon_status.write().await;
            s.running = false;
        });
    }

    async fn run_tick(
        db: &DbConnection,
        daemon_status: &Arc<RwLock<RateSyncStatus>>,
        client: &reqwest::Client,
    ) {
        let db_clone = db.clone();
        let (enabled, base_currency, interval_minutes) =
            match tokio::task::spawn_blocking(move || {
                // RUST-07: recover from a poisoned lock by reusing the guard
                // (the Connection itself is still usable) instead of panicking.
                let conn = db_clone.lock().unwrap_or_else(|e| e.into_inner());
                let enabled =
                    kasirmu_core::settings::Settings::is_rate_sync_enabled(&conn).unwrap_or(false);
                let base = kasirmu_core::settings::Settings::get_rate_sync_base_currency(&conn)
                    .unwrap_or_else(|_| "USD".into());
                let interval = kasirmu_core::settings::Settings::get_rate_sync_interval(&conn)
                    .unwrap_or_else(|_| "360".into());
                (enabled, base, interval)
            })
            .await
            {
                Ok(v) => v,
                Err(join_err) => {
                    let msg = format!("rate sync settings read panicked: {join_err}");
                    tracing::error!(error = %msg, "rate sync read phase failed");
                    let mut s = daemon_status.write().await;
                    s.last_sync_at = Some(
                        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    );
                    s.last_error = Some(msg);
                    s.rates_updated = 0;
                    return;
                }
            };

        // Update status with base currency
        {
            let mut s = daemon_status.write().await;
            s.base_currency = base_currency.clone();
        }

        if !enabled {
            tracing::debug!("rate sync is disabled, skipping cycle");
            return;
        }

        let _ = interval_minutes; // used for logging if needed

        // Fetch rates from the Frankfurter API
        let url = format!("https://api.frankfurter.app/latest?from={base_currency}");
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                let err_msg = format!("HTTP request failed: {e}");
                tracing::error!(error = ?err_msg, "rate sync fetch failed");
                let mut s = daemon_status.write().await;
                s.last_sync_at =
                    Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
                s.last_error = Some(err_msg);
                s.rates_updated = 0;
                return;
            }
        };

        let parsed: FrankfurterResponse = match resp.json().await {
            Ok(p) => p,
            Err(e) => {
                let err_msg = format!("JSON parse failed: {e}");
                tracing::error!(error = ?err_msg, "rate sync parse failed");
                let mut s = daemon_status.write().await;
                s.last_sync_at =
                    Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
                s.last_error = Some(err_msg);
                s.rates_updated = 0;
                return;
            }
        };

        // All rates returned are FROM base_currency TO target_currency
        let effective_date = parsed.date.clone();
        let source = "auto-sync";
        let rates = parsed.rates.clone();
        let count = rates.len();
        let base = parsed.base.clone();

        // Store rates in the DB (blocking)
        let db_clone = db.clone();
        let base_inner = base.clone();
        let date_inner = effective_date.clone();
        let result = tokio::task::spawn_blocking(move || {
            // RUST-07: recover from a poisoned lock by reusing the guard
            // (the Connection itself is still usable) instead of panicking.
            let conn = db_clone.lock().unwrap_or_else(|e| e.into_inner());
            let repo = CurrencyRepository::new(&conn);
            let mut updated = 0usize;
            for (to_currency, rate) in &rates {
                // The Frankfurter API returns `f64` rates. Conversion to
                // `i64` millionths goes through `rate_to_millionths`,
                // which rejects non-finite, non-positive, sub-resolution,
                // and absurd-magnitude values outright — an untrusted
                // response can no longer saturate the cast into a
                // "valid" i64::MAX rate.
                let Some(rate_millionths) = rate_to_millionths(*rate) else {
                    tracing::warn!(
                        from = %base_inner,
                        to = %to_currency,
                        rate = %rate,
                        "rejected out-of-range API exchange rate"
                    );
                    continue;
                };
                if let Err(e) = repo.upsert_exchange_rate(
                    &base_inner,
                    to_currency,
                    rate_millionths,
                    source,
                    &date_inner,
                ) {
                    tracing::warn!(
                        from = %base_inner,
                        to = %to_currency,
                        error = %e,
                        "failed to upsert exchange rate"
                    );
                } else {
                    updated += 1;
                }
            }
            updated
        })
        .await
        .unwrap_or_else(|join_err| {
            tracing::error!(
                error = %join_err,
                "rate sync: rate storage spawn_blocking panicked"
            );
            0
        });

        tracing::info!(
            base_currency = %base,
            rates = count,
            updated = result,
            date = %effective_date,
            "rate sync cycle completed"
        );

        let mut s = daemon_status.write().await;
        s.last_sync_at =
            Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        s.rates_updated = result;
        s.last_error = None;
    }

    /// Gracefully stop the background rate sync daemon.
    pub async fn stop(&self) {
        let tx = self.shutdown_tx.lock().await.take();
        if let Some(tx) = tx {
            let _ = tx.send(true);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Check if the daemon is currently running.
    pub async fn is_running(&self) -> bool {
        self.status.read().await.running
    }

    /// Get a snapshot of the daemon's current status.
    pub async fn status(&self) -> RateSyncStatus {
        self.status.read().await.clone()
    }

    /// Set the sync interval (applied on next cycle).
    pub fn set_interval(&mut self, interval: Duration) {
        self.interval = interval;
    }

    /// Get the current sync interval.
    pub fn interval(&self) -> Duration {
        self.interval
    }
}

impl Default for RateSyncDaemon {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

#[cfg(test)]
#[path = "rate_sync_tests.rs"]
mod conversion_tests;
