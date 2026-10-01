/*
last audited 25-07-26 by RSA-Agent (cloud-server slice A: verified)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: clean — sharded token buckets with per-route configs and background cleanup; unwraps carry SAFETY comments on static metric names; panic guards are deliberate pool-type mismatches; sweep found no SQL interpolation
next: none | perf: N/A
*/
//! Prometheus metrics for the cloud sync server (P-3 Step 7).
//!
//! Exposes counters and histograms for sync push/pull performance,
//! anchor expiry events, and DB contention. All metrics are registered
//! in a default [`prometheus::Registry`] and exposed via `GET /metrics`.

use std::sync::LazyLock;
use std::time::Instant;

use prometheus::{
    Counter, CounterVec, Histogram, HistogramOpts, HistogramVec, Opts, Registry, TextEncoder,
};

/// The global metrics registry. All metrics defined in this module are
/// registered here during static initialisation.
static REGISTRY: LazyLock<Registry> = LazyLock::new(Registry::new);

// ── Counters ──────────────────────────────────────────────────────────

/// Total number of items pushed to the server, labelled by outcome.
pub static SYNC_PUSHES_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    let c = CounterVec::new(
        Opts::new("sync_pushes_total", "Total items pushed to the server"),
        &["outcome"], // accepted | conflict | rejected
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of anchor-expired responses returned to clients.
pub static SYNC_ANCHOR_EXPIRED_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "sync_anchor_expired_total",
        "Total anchor-expired (410 Gone) responses",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of offline_queue rows that failed to decode during a pull
/// (SYNC-10). A non-zero count indicates schema drift between the server
/// and the sync-store row decoder — the client receives a 5xx rather than
/// a silently truncated page, so this is an operator-visible failure signal.
pub static SYNC_PULL_ROW_DECODE_FAILURES_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "sync_pull_row_decode_failures_total",
        "Total offline_queue rows that failed to decode during pull",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of `offline_queue` rows deleted by the hourly prune loop
/// (P-1 Retention). A rising count over time confirms old rows are being
/// aged out; a flat count while rows age past the 90-day horizon signals
/// the retention path is not covering them (round 121 made the prune
/// status-agnostic, so this counter is the observability counterpart).
pub static PRUNE_QUEUE_DELETED_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "prune_queue_deleted_total",
        "Total offline_queue rows deleted by the hourly prune",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of `sent_reports` claims deleted by the hourly prune loop.
/// The dedup table grows one row per (tenant, period) forever; claims are
/// only useful while a crash-recovery retry window could still collide, so
/// they are aged out at the same 90-day horizon as `offline_queue`. A flat
/// count while claims age past the horizon signals the retention path is
/// not covering them.
pub static PRUNE_SENT_REPORTS_DELETED_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "prune_sent_reports_deleted_total",
        "Total sent_reports claims deleted by the hourly prune",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of `429 Too Many Requests` responses returned by the rate
/// limiters, labelled by limiter. Alerting keys off this: a sustained rate
/// of 429s on `token` means the mint endpoint is being brute-forced; a
/// sustained rate on `sync` means a tenant is misbehaving (or a buggy
/// client is hammering push/pull).
pub static RATE_LIMIT_429_TOTAL: LazyLock<CounterVec> = LazyLock::new(|| {
    let c = CounterVec::new(
        Opts::new(
            "rate_limit_429_total",
            "Total 429 Too Many Requests responses, by limiter",
        ),
        &["limiter"], // sync | token
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of `5xx` responses from the webhook handlers (Stripe /
/// Square). Webhooks are the payment-authenticity boundary: a non-zero
/// count means real events are failing server-side (misconfigured secret,
/// DB error, bad event shape) and the payment/plan state may be stale.
/// Alert on any sustained increase.
pub static WEBHOOK_5XX_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "webhook_5xx_total",
        "Total 5xx responses from webhook handlers",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Times the P-1 anchor-expiry check was SKIPPED because the oldest retained
/// `created_at` could not be read (`SyncStore::oldest_created_at` returned
/// `None` from a FAILED scan rather than from an empty queue).
///
/// The skip is a fail-open on its own: `None` short-circuits the `since <
/// oldest` comparison, so a client behind a pruned horizon receives a normal
/// page instead of the 410 `anchor_expired`. That also SUPPRESSES
/// [`SYNC_ANCHOR_EXPIRED_TOTAL`], which is the only signal for this path — so
/// without this counter a broken min-scan reads as "fewer expiries" rather than
/// as "the check stopped running". Alert on any sustained increase.
pub static SYNC_ANCHOR_CHECK_SKIPPED_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "sync_anchor_check_skipped_total",
        "Times the anchor-expiry check was skipped because the min-scan failed",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

// ── Image storage (spec 0046b §3.4/§3.7) ──────────────────────────────

/// Total bytes currently stored for the tenant's active image refs
/// (refcount > 0). Set by the GC cycle via [`set_image_bytes_gauge`].
/// Alerts key off the 4 GB soft limit (§3.7) — a tenant approaching it
/// should be audited for large catalogs or leaked bytes.
pub static IMAGE_BYTES_USED: LazyLock<prometheus::GaugeVec> = LazyLock::new(|| {
    let g = prometheus::GaugeVec::new(
        Opts::new(
            "oz_image_bytes_used",
            "Total bytes stored for active image refs, by tenant",
        ),
        &["tenant"],
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(g.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    g
});

/// Total number of orphaned image files deleted by the GC loop
/// (spec 0046b §3.4). A rising count confirms the sweep is reclaiming
/// space; a flat count while refcount=0 rows age past the 24h grace
/// signals the GC path is not covering them.
pub static IMAGE_GC_DELETED_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "oz_image_gc_deleted_total",
        "Total orphaned image files deleted by the GC loop",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Set the per-tenant image bytes gauge. Callers should pass the result
/// of `Store::image_bytes_used(tenant_id)` (0 when the query fails — the
/// gauge is best-effort observability, not a hard contract).
pub fn set_image_bytes_gauge(tenant_id: &str, bytes: i64) {
    IMAGE_BYTES_USED
        .with_label_values(&[tenant_id])
        .set(bytes.max(0) as f64);
}

// ── Histograms ────────────────────────────────────────────────────────

/// Duration of push requests in milliseconds.
pub static SYNC_PUSH_DURATION_MS: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(HistogramOpts::new(
        "sync_push_duration_ms",
        "Push handler duration in milliseconds",
    ))
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(h.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    h
});

/// Duration of pull requests in milliseconds.
pub static SYNC_PULL_DURATION_MS: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(HistogramOpts::new(
        "sync_pull_duration_ms",
        "Pull handler duration in milliseconds",
    ))
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(h.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    h
});

/// Size of push request bodies in bytes (before compression).
pub static SYNC_BATCH_SIZE_BYTES: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(HistogramOpts::new(
        "sync_batch_size_bytes",
        "Push request body size in bytes",
    ))
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(h.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    h
});

// ── P8-3: Health-check metrics ──────────────────────────────────────

/// Total number of health check requests served.
pub static HEALTH_CHECKS_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new("health_checks_total", "Total health check requests served").unwrap(); // SAFETY: static metric name/help are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Total number of health check failures (DB unreachable).
pub static HEALTH_CHECK_FAILURES_TOTAL: LazyLock<Counter> = LazyLock::new(|| {
    let c = Counter::new(
        "health_check_failures_total",
        "Total health check requests where DB ping failed",
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(c.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    c
});

/// Database ping latency in microseconds.
pub static HEALTH_DB_LATENCY_MICROS: LazyLock<Histogram> = LazyLock::new(|| {
    let h = Histogram::with_opts(HistogramOpts::new(
        "health_db_latency_micros",
        "Database ping latency in microseconds",
    ))
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(h.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    h
});

/// Duration of database lock acquisitions in seconds.
pub static DB_CONTENTION_SECONDS: LazyLock<HistogramVec> = LazyLock::new(|| {
    let h = HistogramVec::new(
        HistogramOpts::new(
            "db_connection_contention_seconds",
            "Database lock acquisition time in seconds",
        ),
        &["handler"], // push | pull | snapshot | status
    )
    .unwrap(); // SAFETY: static metric name/opts are compile-time constants; construction cannot fail
    REGISTRY.register(Box::new(h.clone())).unwrap(); // SAFETY: static registration of a freshly-constructed metric cannot fail
    h
});

// ── Rendering ─────────────────────────────────────────────────────────

/// Ensure all LazyLock metrics are registered before rendering.
fn ensure_registered() {
    // Force initialisation of all lazy metrics by touching each one.
    // CounterVec metrics need at least one label value pre-created
    // otherwise they won't appear in the Prometheus text output.
    let _ = &*SYNC_PUSHES_TOTAL;
    let _ = SYNC_PUSHES_TOTAL.with_label_values(&["accepted"]);
    let _ = SYNC_PUSHES_TOTAL.with_label_values(&["conflict"]);
    let _ = SYNC_PUSHES_TOTAL.with_label_values(&["rejected"]);
    let _ = &*SYNC_ANCHOR_EXPIRED_TOTAL;
    let _ = &*SYNC_PULL_ROW_DECODE_FAILURES_TOTAL;
    let _ = &*SYNC_PUSH_DURATION_MS;
    let _ = &*SYNC_PULL_DURATION_MS;
    let _ = &*SYNC_BATCH_SIZE_BYTES;
    let _ = &*HEALTH_CHECKS_TOTAL;
    let _ = &*HEALTH_CHECK_FAILURES_TOTAL;
    let _ = &*HEALTH_DB_LATENCY_MICROS;
    // HistogramVec needs its label values pre-created to render — same as
    // the CounterVecs above. Without this, db_connection_contention_seconds
    // registers but never appears in the text output.
    let _ = DB_CONTENTION_SECONDS.with_label_values(&["push"]);
    let _ = DB_CONTENTION_SECONDS.with_label_values(&["pull"]);
    let _ = DB_CONTENTION_SECONDS.with_label_values(&["snapshot"]);
    let _ = DB_CONTENTION_SECONDS.with_label_values(&["status"]);
    let _ = &*PRUNE_QUEUE_DELETED_TOTAL;
    let _ = &*PRUNE_SENT_REPORTS_DELETED_TOTAL;
    let _ = RATE_LIMIT_429_TOTAL.with_label_values(&["sync"]);
    let _ = RATE_LIMIT_429_TOTAL.with_label_values(&["token"]);
    let _ = &*WEBHOOK_5XX_TOTAL;
}

/// Render all registered metrics in Prometheus text format.
pub fn render_metrics() -> String {
    ensure_registered();
    let encoder = TextEncoder::new();
    encoder
        .encode_to_string(&REGISTRY.gather())
        .unwrap_or_default()
}

/// Cache TTL for the rendered `/metrics` body (ADR #43 D3).
///
/// Prometheus scrapes on a fixed interval (commonly 15s); re-encoding the
/// full exposition on every scrape is wasted CPU, and under a scrape burst
/// (multiple scrapers, load-balanced probes) the identical text is encoded
/// once per request.  A short TTL absorbs those bursts while keeping the
/// exposed values fresh enough for alerting.
const METRICS_RENDER_TTL: std::time::Duration = std::time::Duration::from_secs(10);

/// A tiny TTL cache for the rendered `/metrics` text.
///
/// Holds the last rendered exposition plus the `Instant` it was produced.
/// The critical section is only the check-and-set on the cached string —
/// the (relatively costly) `gather()` + text encode happens *outside* the
/// lock, so concurrent scrapers never serialize on the encoder; the first
/// one after expiry re-renders and everyone else reads the stored text.
struct MetricsRenderCache {
    inner: std::sync::Mutex<Option<(Instant, String)>>,
}

impl MetricsRenderCache {
    fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(None),
        }
    }

    /// Return the cached exposition if it is younger than `ttl`.
    ///
    /// Returns `None` when empty or expired, signalling the caller to
    /// re-render (which then populates the cache via [`Self::store`]).
    fn get(&self, ttl: std::time::Duration) -> Option<String> {
        let guard = match self.inner.lock() {
            Ok(g) => g,
            // Poisoned lock: the holder panicked mid-render; treat as a
            // cache miss so the endpoint stays available rather than
            // propagating a poisoned state forever.
            Err(poisoned) => poisoned.into_inner(),
        };
        let (at, text) = (*guard).as_ref()?;
        if at.elapsed() < ttl {
            Some(text.clone())
        } else {
            None
        }
    }

    /// Store a freshly rendered exposition.
    fn store(&self, text: String) {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some((Instant::now(), text));
    }
}

/// Render all registered metrics, caching the text for up to
/// [`METRICS_RENDER_TTL`] (ADR #43 D3).
///
/// The Prometheus endpoint calls this instead of [`render_metrics`] so that
/// a scrape burst re-encodes at most once per TTL window.
pub fn render_metrics_cached() -> String {
    static CACHE: LazyLock<MetricsRenderCache> = LazyLock::new(MetricsRenderCache::new);
    if let Some(cached) = CACHE.get(METRICS_RENDER_TTL) {
        return cached;
    }
    let text = render_metrics();
    CACHE.store(text.clone());
    text
}

#[cfg(test)]
#[path = "metrics_tests.rs"]
mod tests;
