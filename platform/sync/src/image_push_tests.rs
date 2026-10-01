//! Tests for the image push scheduler (spec 0046b §3.6).

use super::*;
use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use std::collections::HashMap;

// ── Helpers ──────────────────────────────────────────────────────────

/// Build a scheduler backed by an in-memory DB and a temp cache dir.
fn test_scheduler(cache_dir: &std::path::Path) -> ImagePushScheduler {
    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    ImagePushScheduler {
        db,
        cache_dir: cache_dir.to_path_buf(),
        client: super::bounded_http_client(),
    }
}

/// Extract the batch frames parsing — used to verify the build logic.
/// Returns (frames_bytes, hashes) for a set of (hash, bytes) files.
fn build_frames(files: &[(&str, &[u8])]) -> (Vec<u8>, Vec<String>) {
    let mut frames = Vec::new();
    let mut hashes = Vec::new();
    for (hash, bytes) in files {
        frames.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        frames.extend_from_slice(bytes);
        hashes.push((*hash).to_owned());
    }
    (frames, hashes)
}

// ── Frame-building ──────────────────────────────────────────────────

#[test]
fn build_frames_encodes_length_prefixes() {
    let a = b"hello";
    let b2 = b"world!";
    let (frames, hashes) = build_frames(&[("aaaaaaaaaaaaaaaa", a), ("bbbbbbbbbbbbbbbb", b2)]);
    assert_eq!(hashes.len(), 2);
    // 4-byte length prefix + 5 bytes, then 4-byte prefix + 6 bytes.
    assert_eq!(frames.len(), 4 + 5 + 4 + 6);
    assert_eq!(&frames[0..4], &5u32.to_be_bytes());
    assert_eq!(&frames[4..9], a);
    assert_eq!(&frames[9..13], &6u32.to_be_bytes());
    assert_eq!(&frames[13..19], b2);
}

#[test]
fn build_frames_matches_endpoint_contract() {
    // The cloud batch endpoint reads length-prefixed big-endian frames.
    let files = [("cccccccccccccccc", &[1u8, 2, 3, 4][..])];
    let (frames, hashes) = build_frames(&files);
    assert_eq!(hashes, vec!["cccccccccccccccc".to_owned()]);
    assert_eq!(frames, [0, 0, 0, 4, 1, 2, 3, 4]);
}

// ── Scheduler drain logic ────────────────────────────────────────────

#[tokio::test]
async fn drain_once_noop_when_sync_disabled() {
    // Fresh DB: sync disabled → config None → drain is a no-op.
    let tmp = std::env::temp_dir().join(format!("oz-ip-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let sched = test_scheduler(&tmp);
    sched.drain_once().await; // must not panic
    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn drain_once_noop_when_queue_empty() {
    // Enable sync + point at a dead URL. With an empty queue, no HTTP call.
    let tmp = std::env::temp_dir().join(format!("oz-ip-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let sched = test_scheduler(&tmp);
    {
        let db = sched.db.lock().await;
        let store = Store::new(&db);
        kasirmu_core::settings::Settings::set_sync_enabled(&db, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&db, "http://127.0.0.1:1").unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&db, "sk-test").unwrap();
        // no enqueue → empty
        let _ = store;
    }
    sched.drain_once().await; // no HTTP attempt
    let _ = std::fs::remove_dir_all(&tmp);
}

/// A push-queue read that FAILS must not be treated as an empty queue.
///
/// `drain_once` read the batch with `.unwrap_or_default()`, so a failed read
/// became an empty `pending`, the file loop below never ran, and the cycle ended
/// having logged nothing -- indistinguishable from the genuinely-empty queue,
/// which at least logs a `trace!`. Every other failure in this module logs
/// (`warn!` when it degrades, `error!` when it is real), so a broken read was the
/// one silent path and the image queue would simply stop draining with no operator
/// signal anywhere.
///
/// This drives `read_push_batch`, the extracted helper, because `drain_once`
/// returns early on BOTH the failure and the empty case -- so no assertion on the
/// scheduler can tell them apart, and this crate has no tracing-capture harness to
/// read the log. The helper's `None` is the distinction, which is why it was
/// extracted rather than fixed in place.
///
/// NOTE: an earlier version of this pin drove `peek_push_batch` directly and
/// asserted it errors on a dropped table. That passed BOTH before and after the
/// fix -- it tested unchanged core code, not this defect -- so it was replaced.
#[tokio::test]
async fn read_push_batch_returns_none_when_the_queue_table_is_unreadable() {
    let db = migrations::fresh_db();
    let store = Store::new(&db);

    // Happy path first, so the failure below is the only change.
    let hash = "b".repeat(16);
    store.enqueue_image_push(&hash, 16).unwrap();
    let pending = read_push_batch(&store).expect("a readable queue must yield a batch");
    assert_eq!(pending.len(), 1);

    // Drop the table: the SELECT can no longer be prepared.
    db.execute_batch("DROP TABLE image_push_queue;").unwrap();

    assert!(
        read_push_batch(&store).is_none(),
        "an unreadable queue must be `None`, not an empty batch"
    );
}

#[tokio::test]
async fn drain_once_enqueues_and_marks_failed_on_network_error() {
    // A dead port (127.0.0.1:1) makes the POST fail → all hashes marked
    // as failed attempts (queue retains them with bumped attempts).
    let tmp = std::env::temp_dir().join(format!("oz-ip-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(tmp.join("images")).unwrap();
    let sched = test_scheduler(&tmp);

    let hash_a = "a".repeat(16);
    let bytes_a = b"fake-webp-bytes-a";
    // Write the WebP file to the cache dir.
    std::fs::write(tmp.join("images").join(format!("{hash_a}.webp")), bytes_a).unwrap();

    {
        let db = sched.db.lock().await;
        let store = Store::new(&db);
        kasirmu_core::settings::Settings::set_sync_enabled(&db, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&db, "http://127.0.0.1:1").unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&db, "sk-test").unwrap();
        store
            .enqueue_image_push(&hash_a, bytes_a.len() as i64)
            .unwrap();
    }

    sched.drain_once().await;

    // After the failed attempt the queue row still exists with attempts = 1.
    let db = sched.db.lock().await;
    let store = Store::new(&db);
    let pending = store.peek_push_batch(16).unwrap();
    // Backoff schedules next_attempt_at into the future, so peek returns empty.
    assert!(
        pending.is_empty(),
        "backoff moves the row out of the due window"
    );
    // Verify the row survived with attempts bumped.
    let attempts: i32 = {
        use rusqlite::OptionalExtension;
        db.query_row(
            "SELECT attempts FROM image_push_queue WHERE hash = ?1",
            rusqlite::params![hash_a],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .unwrap_or(0)
    };
    assert_eq!(attempts, 1, "one failed attempt recorded");
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn batch_outcome_parse_marks_stored_as_success() {
    // Mirrors the parse logic inside drain_once for the success path.
    let json: serde_json::Value = serde_json::json!({
        "results": [
            {"hash": "aaaaaaaaaaaaaaaa", "status": "stored"},
            {"hash": "bbbbbbbbbbbbbbbb", "status": "duplicate"},
            {"hash": "cccccccccccccccc", "status": "rejected"}
        ]
    });
    let mut map: HashMap<String, String> = HashMap::new();
    for item in json["results"].as_array().unwrap() {
        let status = item["status"].as_str().unwrap_or("rejected").to_owned();
        let hash = item["hash"].as_str().unwrap_or_default().to_owned();
        map.insert(hash, status);
    }
    assert_eq!(
        map.get("aaaaaaaaaaaaaaaa").map(|s| s.as_str()),
        Some("stored")
    );
    assert_eq!(
        map.get("bbbbbbbbbbbbbbbb").map(|s| s.as_str()),
        Some("duplicate")
    );
    assert_eq!(
        map.get("cccccccccccccccc").map(|s| s.as_str()),
        Some("rejected")
    );
    assert!(!map.contains_key("dddddddddddddddd"));
}

// ── COR-31: the scheduler's HTTP client must be bounded ─────────────

/// The scheduler used a bare `reqwest::Client::new()`, which has NO
/// timeout. In a daemon that is worse than in a request path: a hung
/// POST to `/api/v1/images:batch` never returns, the drain loop never
/// reaches its next tick, and the queue silently stops draining while
/// the scheduler is still alive. `run_sync_cycle`'s cousin in
/// `rate_sync.rs` carries the same warning.
///
/// Why an `include_str!` assertion and not a behavioural one: reqwest's
/// `Client` does not expose its configured timeouts, so a bounded
/// client and an unbounded one are indistinguishable at runtime. The
/// coupling we care about is "the constructor builds through
/// `Client::builder()` with an explicit timeout", which is a property
/// of the source. (Same technique `apps/cloud-server/src/sync_api_tests.rs`
/// uses for the sync-store source contract.)
#[test]
fn push_client_is_bounded_by_a_timeout() {
    let src = include_str!("image_push.rs");
    assert!(
        src.contains("reqwest::Client::builder()"),
        "the scheduler must build its client through Client::builder() so a timeout can be set",
    );
    assert!(
        src.contains(".connect_timeout("),
        "the scheduler's client must bound the connect phase",
    );
    assert!(
        src.contains(".timeout("),
        "the scheduler's client must bound the total request",
    );
    // The bare constructor must not survive anywhere in the file: a
    // later edit that reintroduces it would restore the unbounded hang.
    assert!(
        !src.contains("client: reqwest::Client::new()"),
        "the bare Client::new() in the constructor is the COR-31 defect; it must not come back",
    );
}
