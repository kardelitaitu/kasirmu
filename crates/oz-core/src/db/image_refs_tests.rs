//! Tests for image_refs Store methods (spec 0046b §3.7).
//!
//! Covers refcount maintenance, missing-hash computation, GC, push-queue
//! operations, and the backoff/dead-letter logic.

use super::*;
use crate::migrations;

fn fresh_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    conn.pragma_update(None, "busy_timeout", "5000").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

// ── Image refs ───────────────────────────────────────────────────────

#[test]
fn ref_image_inserts_new_row() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.ref_image("tenant-a", "abc123", 1024).unwrap();
    assert!(store.image_ref_exists("tenant-a", "abc123").unwrap());
}

#[test]
fn ref_image_increments_refcount_on_duplicate() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.ref_image("tenant-a", "abc123", 1024).unwrap();
    store.ref_image("tenant-a", "abc123", 2048).unwrap();
    // refcount should be 2
    assert!(store.image_ref_exists("tenant-a", "abc123").unwrap());
    // bytes should be updated to the latest value
    let bytes: i64 = conn
        .query_row(
            "SELECT bytes FROM image_refs WHERE tenant_id = 'tenant-a' AND hash = 'abc123'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bytes, 2048);
}

#[test]
fn unref_image_decrements_refcount() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.ref_image("tenant-a", "abc123", 1024).unwrap();
    store.unref_image("tenant-a", "abc123").unwrap();
    // refcount went to 0 — still exists but refcount=0
    assert!(!store.image_ref_exists("tenant-a", "abc123").unwrap());
}

#[test]
fn unref_image_idempotent_when_nonexistent() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let affected = store.unref_image("tenant-a", "nonexistent").unwrap();
    assert_eq!(affected, 0);
}

#[test]
fn missing_hashes_returns_absent_hashes() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.ref_image("tenant-a", "present1", 100).unwrap();
    store.ref_image("tenant-a", "present2", 200).unwrap();
    let candidates = ["present1", "absent1", "present2", "absent2"];
    let missing = store.missing_hashes("tenant-a", &candidates).unwrap();
    assert_eq!(missing.len(), 2);
    assert!(missing.contains(&"absent1"));
    assert!(missing.contains(&"absent2"));
}

#[test]
fn gc_images_deletes_old_zero_refcount_rows() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    // Insert a row and unref it (refcount → 0)
    store.ref_image("tenant-a", "gc-me", 100).unwrap();
    store.unref_image("tenant-a", "gc-me").unwrap();
    // GC with grace=0 should delete it
    let deleted = store.gc_images("tenant-a", 0).unwrap();
    assert_eq!(deleted, vec!["gc-me"]);
}

#[test]
fn image_bytes_used_sums_active_refs() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.ref_image("tenant-a", "h1", 1000).unwrap();
    store.ref_image("tenant-a", "h2", 2000).unwrap();
    store.ref_image("tenant-b", "h3", 4000).unwrap(); // different tenant
    let bytes = store.image_bytes_used("tenant-a").unwrap();
    assert_eq!(bytes, 3000);
}

// ── Push queue ───────────────────────────────────────────────────────

#[test]
fn enqueue_image_push_inserts_row() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    let batch = store.peek_push_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].0, "hash1");
    assert_eq!(batch[0].1, 500);
    assert_eq!(batch[0].2, 0);
}

#[test]
fn push_queue_ignores_duplicate_enqueue() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    store.enqueue_image_push("hash1", 999).unwrap(); // ignored
    let batch = store.peek_push_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].1, 500); // original size preserved
}

#[test]
fn mark_push_success_deletes_row() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    store.mark_push_attempt("hash1", true).unwrap();
    let batch = store.peek_push_batch(10).unwrap();
    assert!(batch.is_empty());
}

#[test]
fn mark_push_failure_bumps_attempts() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    store.mark_push_attempt("hash1", false).unwrap();
    // The row is still queued, but scheduled into the future (backoff), so
    // it must not be due yet. Verify attempts directly.
    let (attempts,): (i32,) = conn
        .query_row(
            "SELECT attempts FROM image_push_queue WHERE hash = 'hash1'",
            [],
            |r| Ok((r.get(0)?,)),
        )
        .unwrap();
    assert_eq!(attempts, 1);
    // And peek must not return it (backoff pushed it out of the due window).
    let batch = store.peek_push_batch(10).unwrap();
    assert!(batch.is_empty());
}

#[test]
fn push_queue_dead_letters_after_8_attempts() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    // Simulate 8 failed attempts
    for _ in 0..8 {
        store.mark_push_attempt("hash1", false).unwrap();
    }
    let batch = store.peek_push_batch(10).unwrap();
    assert!(batch.is_empty(), "dead-lettered entry should be removed");
}

#[test]
fn clear_push_entry_removes_row() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    store.enqueue_image_push("hash1", 500).unwrap();
    store.clear_push_entry("hash1").unwrap();
    let batch = store.peek_push_batch(10).unwrap();
    assert!(batch.is_empty());
}

// `── Dynamic `IN (…)` chunking ────────────────────────

/// The chunk size is a CHUNK SIZE, never a threshold that switches the filter
/// off: a candidate list longer than `IMAGE_REFS_IN_CHUNK` must be
/// read in MORE chunks, and the union of the per-chunk hits must equal what
/// one query over the whole list returns — no chunk skipped, none bleeding
/// into another, tenant scoping intact on every chunk.
///
/// The fixture interleaves present and absent hashes on BOTH sides of the
/// chunk boundary (`IMAGE_REFS_IN_CHUNK + 100` candidates → exactly
/// 2 chunks), so a present hash from the FIRST chunk must still be excluded
/// after the SECOND chunk ran (accumulator = union, not last chunk), and the
/// result must come back in the caller's candidate order (the statement has no
/// ORDER BY and never had one — ordering is the caller's list, not the
/// query's). Absent hashes carry an active `tenant-b` ref so a chunk
/// that dropped the tenant filter would wrongly report them present. A
/// placeholder-numbering regression (the `?1` tenant-id collision
/// class) becomes a parameter-count error or a wrong set, which fails HERE
/// instead of being swallowed by the route handlers' `unwrap_or_default()`
/// into an empty nudge.
#[test]
fn missing_hashes_survives_a_list_longer_than_the_chunk() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let total = IMAGE_REFS_IN_CHUNK + 100; // forces exactly 2 chunks
    let candidates: Vec<String> = (0..total)
        .map(|i| {
            if i % 5 == 0 {
                format!("absent{i:06}")
            } else {
                format!("present{i:06}")
            }
        })
        .collect();
    for (i, hash) in candidates.iter().enumerate() {
        if i % 5 == 0 {
            store.ref_image("tenant-b", hash, 100).unwrap();
        } else {
            store.ref_image("tenant-a", hash, 100).unwrap();
        }
    }
    let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
    let missing = store.missing_hashes("tenant-a", &refs).unwrap();
    let expected: Vec<String> = candidates
        .iter()
        .enumerate()
        .filter(|(i, _)| i % 5 == 0)
        .map(|(_, h)| h.clone())
        .collect();
    assert_eq!(missing.len(), expected.len());
    let missing: Vec<String> = missing.into_iter().map(str::to_owned).collect();
    assert_eq!(
        missing, expected,
        "result is the candidate-ordered union across all chunks, not the last chunk"
    );
}

/// Mirrors the compile-time `const _: () = assert!(…)` in
/// `image_refs.rs` so raising the chunk past the historical ceiling
/// fails a test run too, not only a build.
// The operands are constants by design; clippy's `const { assert!(..) }` form
// would abort the build, which is the single signal this test duplicates. The
// level has to sit on the function: as a statement attribute on `assert!`
// itself rustc reports `unused_attribute`.
#[allow(clippy::assertions_on_constants)]
#[test]
fn image_refs_in_chunk_stays_under_the_sqlite_ceiling() {
    // SQLITE_MAX_VARIABLE_NUMBER: 32 766 on the bundled 3.4x, 999 pre-3.32.
    assert_eq!(SQLITE_MAX_VARIABLES, 999);
    assert!(IMAGE_REFS_IN_CHUNK + IMAGE_REFS_LEAD_PARAMS < SQLITE_MAX_VARIABLES);
}
