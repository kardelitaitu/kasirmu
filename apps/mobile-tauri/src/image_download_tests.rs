//! Tests for the tablet image download manager (spec 0046b §3.7).

use super::*;

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
