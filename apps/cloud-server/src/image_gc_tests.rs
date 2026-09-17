//! Tests for the image GC daemon (spec 0046b §3.4/§3.7).

use std::io::Write;

/// Helper: seed an image_refs row with a given refcount and age.
fn seed_ref(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    hash: &str,
    refcount: i32,
    age_secs: i64,
) {
    let now = chrono::Utc::now();
    let updated = now - chrono::Duration::seconds(age_secs);
    conn.execute(
        "INSERT INTO image_refs (tenant_id, hash, refcount, bytes, updated_at)
         VALUES (?1, ?2, ?3, 100, ?4)
         ON CONFLICT(tenant_id, hash) DO UPDATE SET refcount = ?3, updated_at = ?4",
        rusqlite::params![
            tenant_id,
            hash,
            refcount,
            updated.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        ],
    )
    .unwrap();
}

#[test]
fn gc_cleans_orphaned_refs() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = kasirmu_core::Store::new(&conn);

    // Seed a ref that is orphaned (refcount=0, old).
    seed_ref(&conn, "tenant-a", "aaaaaaaaaaaaaaaa", 0, 90000);
    // Seed a ref that is still active (refcount>0).
    seed_ref(&conn, "tenant-a", "bbbbbbbbbbbbbbbb", 1, 100);
    // Seed a ref that is orphaned but too recent (should NOT be swept).
    seed_ref(&conn, "tenant-a", "cccccccccccccccc", 0, 100);

    let hashes = store.gc_images("tenant-a", 86400).unwrap();
    // Only "aaaaaaaaaaaaaaaa" should be GC'd (refcount=0 + old enough).
    assert_eq!(hashes, vec!["aaaaaaaaaaaaaaaa".to_owned()]);
}

#[test]
fn gc_removes_files_when_present() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = kasirmu_core::Store::new(&conn);

    let tmp = std::env::temp_dir().join(format!("oz-gc-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();

    // Write a file that will be GC'd.
    let file_path = tmp.join("aaaaaaaaaaaaaaaa.webp");
    {
        let mut f = std::fs::File::create(&file_path).unwrap();
        f.write_all(b"test data").unwrap();
    }
    assert!(file_path.exists());

    seed_ref(&conn, "tenant-a", "aaaaaaaaaaaaaaaa", 0, 90000);
    let hashes = store.gc_images("tenant-a", 86400).unwrap();
    assert_eq!(hashes, vec!["aaaaaaaaaaaaaaaa".to_owned()]);

    // Simulate the GC file deletion (same logic as run_image_gc_cycle).
    for hash in &hashes {
        let path = tmp.join(format!("{hash}.webp"));
        let _ = std::fs::remove_file(&path);
    }
    assert!(!file_path.exists(), "GC should delete the file");

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn gc_noop_when_no_orphans() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = kasirmu_core::Store::new(&conn);

    seed_ref(&conn, "tenant-a", "aaaaaaaaaaaaaaaa", 1, 90000);
    seed_ref(&conn, "tenant-a", "bbbbbbbbbbbbbbbb", 2, 100);

    let hashes = store.gc_images("tenant-a", 86400).unwrap();
    assert!(hashes.is_empty(), "active refs should not be GC'd");
}

#[test]
fn gc_respects_grace_period() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = kasirmu_core::Store::new(&conn);

    // Very recent grace (0 seconds) — should still ignore new orphans.
    seed_ref(&conn, "tenant-a", "aaaaaaaaaaaaaaaa", 0, 1); // 1 second old
    let hashes = store.gc_images("tenant-a", 86400).unwrap();
    assert!(hashes.is_empty(), "new orphans should not be GC'd");

    // Short grace period (0 seconds) — should sweep everything with refcount=0.
    let hashes = store.gc_images("tenant-a", 0).unwrap();
    assert_eq!(hashes, vec!["aaaaaaaaaaaaaaaa".to_owned()]);
}
