/*
last audited 25-07-26 by RSA-Agent (oz-media slice A: verified)
crate: oz-media | status: SAFE | lint: CLEAN
findings: clean — no unwrap/panic/unsafe; sibling tests per convention
next: none | perf: N/A
*/
//! Media pipeline metrics — lightweight atomic counters.
//!
//! PLANNED: these counters are wired to the runtime metrics backend
//! (prometheus on cloud, tracing on Tauri). They exist now so the
//! pipeline can record measurements without coupling to a specific
//! exporter; a later step maps them to registered prometheus metrics.

use std::sync::atomic::{AtomicU64, Ordering};

/// Snapshot of media pipeline counters.
#[derive(Debug, Clone, Copy, Default)]
pub struct MediaMetricsSnapshot {
    /// Total images ingested.
    pub images_ingested: u64,
    /// Total bytes ingested.
    pub bytes_ingested: u64,
    /// Total thumbnails generated.
    pub thumbnails_generated: u64,
    /// Total images compressed.
    pub images_compressed: u64,
    /// Total images auto-cropped.
    pub images_cropped: u64,
    /// Total failures (decode, storage, ...).
    pub failures: u64,
    /// Number of content-hash dedup hits (bytes not re-stored).
    pub dedup_hits: u64,
}

/// Process-wide media pipeline counters.
///
/// These are cheap `AtomicU64` counters; a real exporter (prometheus)
/// can read [`Self::snapshot`] and register them as gauge/counter metrics.
#[derive(Debug, Default)]
pub struct MediaMetrics {
    images_ingested: AtomicU64,
    bytes_ingested: AtomicU64,
    thumbnails_generated: AtomicU64,
    images_compressed: AtomicU64,
    images_cropped: AtomicU64,
    failures: AtomicU64,
    dedup_hits: AtomicU64,
}

impl MediaMetrics {
    /// Create a new zeroed counter set.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one ingested image (plus its byte size).
    pub fn record_ingest(&self, bytes: u64) {
        self.images_ingested.fetch_add(1, Ordering::Relaxed);
        self.bytes_ingested.fetch_add(bytes, Ordering::Relaxed);
    }

    /// Record one generated thumbnail.
    pub fn record_thumbnail(&self) {
        self.thumbnails_generated.fetch_add(1, Ordering::Relaxed);
    }

    /// Record one compressed image.
    pub fn record_compression(&self) {
        self.images_compressed.fetch_add(1, Ordering::Relaxed);
    }

    /// Record one auto-cropped image.
    pub fn record_crop(&self) {
        self.images_cropped.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a pipeline failure.
    pub fn record_failure(&self) {
        self.failures.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a content-hash dedup hit (bytes avoided re-storing).
    pub fn record_dedup(&self) {
        self.dedup_hits.fetch_add(1, Ordering::Relaxed);
    }

    /// Snapshot the current counter values.
    #[must_use]
    pub fn snapshot(&self) -> MediaMetricsSnapshot {
        MediaMetricsSnapshot {
            images_ingested: self.images_ingested.load(Ordering::Relaxed),
            bytes_ingested: self.bytes_ingested.load(Ordering::Relaxed),
            thumbnails_generated: self.thumbnails_generated.load(Ordering::Relaxed),
            images_compressed: self.images_compressed.load(Ordering::Relaxed),
            images_cropped: self.images_cropped.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
            dedup_hits: self.dedup_hits.load(Ordering::Relaxed),
        }
    }
}

/// The process-wide media metrics instance.
///
/// Media pipeline code records into this; an exporter reads
/// [`MediaMetrics::snapshot`] for registration.
pub static MEDIA_METRICS: std::sync::LazyLock<MediaMetrics> =
    std::sync::LazyLock::new(MediaMetrics::new);

#[cfg(test)]
#[path = "metrics_tests.rs"]
mod tests;
