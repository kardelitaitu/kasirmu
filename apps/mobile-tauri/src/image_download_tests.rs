//! Tests for the tablet image download manager (spec 0046b §3.7).

use super::*;

/// Set a file's mtime. `File::set_modified` needs write access, and the file has
/// to exist first.
fn set_mtime(path: &std::path::Path, t: std::time::SystemTime) {
    let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    f.set_modified(t).unwrap();
}

/// A file's mtime in milliseconds since the epoch.
fn mtime_ms(path: &std::path::Path) -> u128 {
    std::fs::metadata(path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

// ── LRU tracker ──────────────────────────────────────────────────────

#[test]
fn lru_touch_and_evict_respects_budget() {
    let mut lru = LruTracker::new(100); // 100-byte budget
    lru.touch("aaaaaaaaaaaaaaaa", 60);
    lru.touch("bbbbbbbbbbbbbbbb", 60);
    assert_eq!(lru.total_bytes(), 120);
    let evicted = lru.evict();
    // Total 120 > 100 → must evict at least one entry (LRU = a).
    assert_eq!(evicted, vec!["aaaaaaaaaaaaaaaa".to_owned()]);
    assert_eq!(lru.total_bytes(), 60);
    assert_eq!(lru.len(), 1);
}

#[test]
fn lru_touch_refreshes_most_recently_used() {
    let mut lru = LruTracker::new(200);
    lru.touch("aaaaaaaaaaaaaaaa", 80);
    lru.touch("bbbbbbbbbbbbbbbb", 80);
    // Touch a again → it becomes most-recently-used.
    lru.touch("aaaaaaaaaaaaaaaa", 80);
    assert_eq!(lru.total_bytes(), 160);
    // Now total = 160 < 200 → nothing evicted yet. Add more to force eviction.
    lru.touch("cccccccccccccccc", 60);
    assert_eq!(lru.total_bytes(), 220);
    let evicted = lru.evict();
    // b is now the LRU (a was refreshed).
    assert_eq!(evicted, vec!["bbbbbbbbbbbbbbbb".to_owned()]);
}

#[test]
fn lru_remove_frees_bytes() {
    let mut lru = LruTracker::new(1000);
    lru.touch("aaaaaaaaaaaaaaaa", 100);
    lru.touch("bbbbbbbbbbbbbbbb", 200);
    let freed = lru.remove("aaaaaaaaaaaaaaaa");
    assert_eq!(freed, 100);
    assert_eq!(lru.total_bytes(), 200);
    assert_eq!(lru.len(), 1);
}

#[test]
fn lru_default_budget_is_256mb() {
    let lru = LruTracker::with_default_budget();
    assert_eq!(lru.budget_bytes(), 256 * 1024 * 1024);
}

/// A file whose mtime cannot be read must be SKIPPED, not ranked as the oldest.
///
/// `seed_lru` read the mtime with `.unwrap_or(0)`, so an unreadable mtime became
/// 1970 — the smallest possible. The sort below orders ASCENDING and `touch`es in
/// that order, and `LruTracker::evict` pops the FRONT, so the fabricated entry was
/// the first thing discarded. For an image the cache had very likely just
/// downloaded, that throws the download away over a metadata read.
///
/// It was also the odd one out in its own loop: a file whose NAME or whose
/// METADATA cannot be read is skipped with `continue`, and only a failed mtime
/// fabricated a value. Skipping keeps the LRU ignorant of the file instead of
/// ranking it last.
///
/// HONEST SCOPE: this pin covers the RANKING, not the fabrication. The unreadable-
/// mtime branch is not constructible here -- a test cannot make `modified()` fail
/// for a file it just created -- and restoring `.unwrap_or(0)` leaves this test
/// GREEN, verified, because both fixture files have readable mtimes and the
/// default never fires. So it guards the ordering the fix depends on (older file
/// is the eviction victim, newer survives) rather than the branch itself, and it
/// would catch a regression that reordered the sort or the `touch` loop. The
/// branch's correctness rests on reading, not on this test.
#[test]
fn seed_lru_ranks_a_file_by_its_real_mtime_and_keeps_it() {
    let tmp = std::env::temp_dir().join(format!("oz-imgseed-{}", uuid::Uuid::new_v4()));
    let img_dir = tmp.join("images");
    // Fresh dir every run: a panic above skips the cleanup below, and reusing a
    // pid-derived name let a previous failed run's leftovers decide the result.
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&img_dir).unwrap();

    // Two files, so the older one is the legitimate LRU victim and the newer one
    // must survive: that is what proves the ranking uses real mtimes.
    let older = img_dir.join("aaaaaaaaaaaaaaaa.webp");
    let newer = img_dir.join("bbbbbbbbbbbbbbbb.webp");
    std::fs::write(&older, vec![0u8; 80]).unwrap();
    std::fs::write(&newer, vec![0u8; 80]).unwrap();
    // PIN the mtimes rather than hoping two back-to-back writes land in
    // different ticks. They do not always: where the filesystem's timestamps are
    // coarse both files got the SAME mtime, `sort_by_key` is stable so the order
    // fell through to `read_dir`, and the file this test calls "newer" was then
    // touched first and evicted first. That is why it failed 3/3 retries in CI
    // while passing locally -- a fixture that never proved the property its own
    // assertion depends on.
    let base = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    set_mtime(&older, base);
    set_mtime(&newer, base + std::time::Duration::from_secs(60));
    // Prove the fixture before testing the behaviour: both files must exist, and
    // the newer one must actually BE newer -- otherwise the ranking below has
    // nothing to rank and this test grades the filesystem, not the code.
    assert!(
        older.exists() && newer.exists(),
        "fixture: both files must be written"
    );
    assert!(
        mtime_ms(&newer) > mtime_ms(&older),
        "fixture: the two mtimes must differ"
    );

    let mut mgr = ImageDownloadManager::new();
    // A budget that FITS both (160 bytes), so `seed_lru`'s own internal `evict()`
    // has nothing to discard and the LRU ends up holding exactly the two files.
    mgr.lru = LruTracker::new(1000);
    mgr.seed_lru(&tmp);
    assert_eq!(mgr.lru.len(), 2, "both readable files must be seeded");

    // `seed_lru` ranks ASCENDING by mtime and touches in that order, and
    // `evict()` pops the FRONT. So tightening the budget must discard the OLDER
    // file and leave the newer one -- which is exactly the ordering a fabricated
    // 1970 mtime would corrupt by putting the newer file at the front.
    mgr.lru = {
        let mut lru = LruTracker::new(1000);
        lru.touch("aaaaaaaaaaaaaaaa", 80);
        lru.touch("bbbbbbbbbbbbbbbb", 80);
        lru
    };
    // Re-seed into a budget that cannot hold both.
    let mut tight = ImageDownloadManager::new();
    tight.lru = LruTracker::new(100);
    tight.seed_lru(&tmp);
    assert_eq!(
        tight.lru.len(),
        1,
        "a 100-byte budget keeps one of the 160 bytes"
    );

    // The survivor must be the NEWER file: the older one is the legitimate LRU
    // victim. On the old code a file whose mtime could not be read was stamped
    // 1970 and took that victim slot instead.
    let survivor = img_dir.join("bbbbbbbbbbbbbbbb.webp");
    assert!(
        survivor.exists(),
        "the newer file must survive eviction: it is not the LRU while its mtime is readable"
    );
    assert!(
        !img_dir.join("aaaaaaaaaaaaaaaa.webp").exists(),
        "the older file is the one seed_lru discards"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

// ── Missing-set / run_cycle ──────────────────────────────────────────

/// Insert a minimal product row so `set_product_image` finds it.
fn seed_product(conn: &rusqlite::Connection, product_id: &str) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, version)
         VALUES (?1, ?2, ?3, 1000, 'USD', 'retail', 1)",
        rusqlite::params![product_id, format!("SKU-{product_id}"), "Test Product"],
    )
    .unwrap();
}

#[tokio::test]
async fn run_cycle_noop_when_sync_disabled() {
    let db = tokio::sync::Mutex::new(kasirmu_core::migrations::fresh_db());
    let tmp = std::env::temp_dir().join(format!("oz-id-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(tmp.join("images")).unwrap();
    let mut mgr = ImageDownloadManager::new();
    // Sync disabled in fresh DB → config None → no-op.
    mgr.run_cycle(&db, &tmp).await;
    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn run_cycle_downloads_missing_images_from_dead_server() {
    // A dead server (127.0.0.1:1) means the GETs fail → hashes stay
    // missing; nothing panics and the cache dir is untouched.
    let db = tokio::sync::Mutex::new(kasirmu_core::migrations::fresh_db());
    let tmp = std::env::temp_dir().join(format!("oz-id-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(tmp.join("images")).unwrap();
    {
        let guard = db.lock().await;
        let store = kasirmu_core::Store::new(&guard);
        kasirmu_core::settings::Settings::set_sync_enabled(&guard, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&guard, "http://127.0.0.1:1")
            .unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&guard, "sk-test").unwrap();
        // Assign a primary image to a product.
        let product_id = uuid::Uuid::new_v4().to_string();
        seed_product(&guard, &product_id);
        store
            .set_product_image(&product_id, 1, "aaaaaaaaaaaaaaaa")
            .unwrap();
    }
    let mut mgr = ImageDownloadManager::new();
    mgr.run_cycle(&db, &tmp).await;
    // No file downloaded (server unreachable).
    let img_dir = tmp.join("images");
    let count = std::fs::read_dir(&img_dir).map(|d| d.count()).unwrap_or(0);
    assert_eq!(count, 0, "no files should be downloaded from a dead server");
    let _ = std::fs::remove_dir_all(&tmp);
}

#[tokio::test]
async fn run_cycle_seeds_lru_from_existing_cache() {
    let db = tokio::sync::Mutex::new(kasirmu_core::migrations::fresh_db());
    let tmp = std::env::temp_dir().join(format!("oz-id-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(tmp.join("images")).unwrap();
    // Pre-existing cached file.
    std::fs::write(tmp.join("images").join("cccccccccccccccc.webp"), b"data").unwrap();
    let mut mgr = ImageDownloadManager::new();
    {
        let guard = db.lock().await;
        let store = kasirmu_core::Store::new(&guard);
        kasirmu_core::settings::Settings::set_sync_enabled(&guard, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&guard, "http://127.0.0.1:1")
            .unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&guard, "sk-test").unwrap();
        // Reference a hash that IS present and one that is not.
        let product_id = uuid::Uuid::new_v4().to_string();
        seed_product(&guard, &product_id);
        store
            .set_product_image(&product_id, 1, "cccccccccccccccc")
            .unwrap();
        store
            .set_product_image(&product_id, 2, "dddddddddddddddd")
            .unwrap();
    }
    mgr.run_cycle(&db, &tmp).await;
    // The seeded LRU should contain the pre-existing file.
    assert!(mgr.seeded, "LRU should be seeded after the first cycle");
    assert_eq!(mgr.lru.len(), 1, "only the pre-existing file is tracked");
    // ddddd is missing → attempted download from dead server → still missing.
    assert!(mgr.lru.len() == 1, "missing hash not downloaded");
    let _ = std::fs::remove_dir_all(&tmp);
}
