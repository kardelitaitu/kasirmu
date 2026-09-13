/*
last audited 25-07-26 by RSA-Agent (oz-reporting slice A: verified)
crate: oz-reporting | status: SAFE | lint: CLEAN
findings: clean — parameterized queries, integer minor units, sibling tests per convention
next: none | perf: N/A
*/
//! Prometheus metrics registry for OZ-POS.
//!
//! Gauge, counter and histogram helpers over one global registry, plus
//! [`gather_metrics`] to render that registry as Prometheus text.
//!
//! NO exporter is wired. `git grep gather_metrics` finds only its definition
//! and its own unit test — no production caller — so an HTTP exposition is
//! something a consumer must build, not something this module provides. Its
//! only renderer was the metrics server in `platform/startup/src/metrics.rs`,
//! deleted at c472485d0 (2026-09-12). Do not read the cloud server's
//! `GET /metrics` as this surface: it renders `apps/cloud-server`'s own
//! separate registry, and that crate does not depend on this one.
//!
//! Feature-gated behind `metrics` — compiled out when it is not enabled.

use prometheus::{Histogram, HistogramOpts, IntCounter, IntGauge, Opts, Registry};

use std::sync::OnceLock;

/// Global Prometheus registry.
fn registry() -> &'static Registry {
    static REG: OnceLock<Registry> = OnceLock::new();
    REG.get_or_init(Registry::new)
}

// ── Business metrics ──────────────────────────────────────────────

/// Total sales completed (counter).
pub fn sales_completed() -> &'static IntCounter {
    static METRIC: OnceLock<IntCounter> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = Opts::new(
            "oz_pos_sales_completed_total",
            "Total number of completed sales",
        )
        .namespace("oz_pos")
        .subsystem("sales");
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let counter = IntCounter::with_opts(opts).expect("invalid sales_completed counter opts");
        registry()
            .register(Box::new(counter.clone()))
            .expect("register sales_completed counter"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        counter
    })
}

/// Current inventory count per product (gauge).
pub fn inventory_level() -> &'static IntGauge {
    static METRIC: OnceLock<IntGauge> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = Opts::new("oz_pos_inventory_level", "Current inventory level")
            .namespace("oz_pos")
            .subsystem("inventory");
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let gauge = IntGauge::with_opts(opts).expect("invalid inventory_level gauge opts");
        registry()
            .register(Box::new(gauge.clone()))
            .expect("register inventory_level gauge"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        gauge
    })
}

/// Active cash session amount (gauge).
pub fn cash_session_amount() -> &'static IntGauge {
    static METRIC: OnceLock<IntGauge> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = Opts::new(
            "oz_pos_cash_session_amount",
            "Current cash session amount in minor units",
        )
        .namespace("oz_pos")
        .subsystem("cash");
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let gauge = IntGauge::with_opts(opts).expect("invalid cash_session_amount gauge opts");
        registry()
            .register(Box::new(gauge.clone()))
            .expect("register cash_session_amount gauge"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        gauge
    })
}

/// Sync queue depth (gauge).
pub fn sync_queue_depth() -> &'static IntGauge {
    static METRIC: OnceLock<IntGauge> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = Opts::new(
            "oz_pos_sync_queue_depth",
            "Number of pending sync queue items",
        )
        .namespace("oz_pos")
        .subsystem("sync");
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let gauge = IntGauge::with_opts(opts).expect("invalid sync_queue_depth gauge opts");
        registry()
            .register(Box::new(gauge.clone()))
            .expect("register sync_queue_depth gauge"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        gauge
    })
}

/// Barcode lookup latency (histogram in seconds).
pub fn barcode_lookup_duration() -> &'static Histogram {
    static METRIC: OnceLock<Histogram> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = HistogramOpts::new(
            "oz_pos_barcode_lookup_duration",
            "Barcode lookup latency in seconds",
        )
        .namespace("oz_pos")
        .subsystem("db")
        .buckets(vec![0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1]);
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let histogram = Histogram::with_opts(opts)
            // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
            .expect("invalid barcode_lookup_duration histogram opts");
        registry()
            .register(Box::new(histogram.clone()))
            .expect("register barcode_lookup_duration histogram"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        histogram
    })
}

/// Transaction commit latency (histogram in seconds).
pub fn transaction_commit_duration() -> &'static Histogram {
    static METRIC: OnceLock<Histogram> = OnceLock::new();
    METRIC.get_or_init(|| {
        let opts = HistogramOpts::new(
            "oz_pos_transaction_commit_duration",
            "Transaction commit latency in seconds",
        )
        .namespace("oz_pos")
        .subsystem("db")
        .buckets(vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0]);
        // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
        let histogram = Histogram::with_opts(opts)
            // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
            .expect("invalid transaction_commit_duration histogram opts");
        registry()
            .register(Box::new(histogram.clone()))
            .expect("register transaction_commit_duration histogram"); // SAFETY: static registration of a freshly-constructed metric cannot fail
        histogram
    })
}

/// Gather all metrics as Prometheus-format text.
pub fn gather_metrics() -> String {
    use prometheus::TextEncoder;
    let encoder = TextEncoder::new();
    let metric_families = registry().gather();
    encoder
        .encode_to_string(&metric_families)
        .unwrap_or_else(|e| format!("# Error encoding metrics: {e}\n"))
}

#[cfg(test)]
#[path = "metrics_tests.rs"]
mod tests;
