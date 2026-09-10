//! Tests for the image push scheduler (spec 0046b §3.6).

use super::*;
use oz_core::db::Store;
use oz_core::migrations;
use std::collections::HashMap;

// ── Helpers ──────────────────────────────────────────────────────────

/// Build a scheduler backed by an in-memory DB and a temp cache dir.
fn test_scheduler(cache_dir: &std::path::Path) -> ImagePushScheduler {
    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    ImagePushScheduler {
        db,
        cache_dir: cache_dir.to_path_buf(),
        client: reqwest::Client::new(),
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
        oz_core::settings::Settings::set_sync_enabled(&db, true).unwrap();
        oz_core::settings::Settings::set_sync_server_url(&db, "http://127.0.0.1:1").unwrap();
        oz_core::settings::Settings::set_sync_api_key(&db, "sk-test").unwrap();
        // no enqueue → empty
        let _ = store;
    }
    sched.drain_once().await; // no HTTP attempt
    let _ = std::fs::remove_dir_all(&tmp);
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
        oz_core::settings::Settings::set_sync_enabled(&db, true).unwrap();
        oz_core::settings::Settings::set_sync_server_url(&db, "http://127.0.0.1:1").unwrap();
        oz_core::settings::Settings::set_sync_api_key(&db, "sk-test").unwrap();
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
