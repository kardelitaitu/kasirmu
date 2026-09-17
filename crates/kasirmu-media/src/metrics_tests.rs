//! Media metrics — tests.

use super::{MEDIA_METRICS, MediaMetrics};

#[test]
fn counters_accumulate() {
    let m = MediaMetrics::new();
    m.record_ingest(100);
    m.record_ingest(200);
    m.record_thumbnail();
    m.record_failure();

    let snap = m.snapshot();
    assert_eq!(snap.images_ingested, 2);
    assert_eq!(snap.bytes_ingested, 300);
    assert_eq!(snap.thumbnails_generated, 1);
    assert_eq!(snap.failures, 1);
}

#[test]
fn static_is_accessible() {
    let snap = MEDIA_METRICS.snapshot();
    let _ = snap;
}
