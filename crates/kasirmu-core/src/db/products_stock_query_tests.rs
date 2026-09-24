//! Sibling tests for `products_stock_query.rs` — C18 P1.9.
//!
//! The discriminating direction: a write that JOINS the caller's transaction
//! disappears on rollback, while one that opens and commits its own does not.

use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}


// ── PROBE: does a sync-replay adjustment leave a stale cached qty? ──
#[derive(Default)]
struct ProbeCache {
    inv: std::sync::Mutex<std::collections::HashMap<String, i64>>,
}
impl crate::cache::Cache for ProbeCache {
    fn get_product(&self, _s: &str) -> Option<crate::ProductWithDetails> { None }
    fn set_product(&self, _s: &str, _p: &crate::ProductWithDetails) {}
    fn invalidate_product(&self, _s: &str) {}
    fn get_inventory(&self, id: &str) -> Option<i64> { self.inv.lock().unwrap().get(id).copied() }
    fn set_inventory(&self, id: &str, q: i64) { self.inv.lock().unwrap().insert(id.to_string(), q); }
    fn invalidate_inventory(&self, id: &str) { self.inv.lock().unwrap().remove(id); }
    fn is_healthy(&self) -> bool { true }
}

/// A sync-replay adjustment must not leave a stale cached quantity.
///
/// `adjust_stock_in_tx` writes the same three rows as its non-tx sibling
/// `adjust_stock_with_reason`, but it omitted the cache invalidation the
/// sibling performs. That omission is not cosmetic, because `get_stock`
/// serves the cache FIRST and populates it on a miss: a single read before a
/// replayed adjustment was enough to poison the entry, after which every
/// subsequent read served the pre-adjustment figure. Measured: the database
/// held 6 while `get_stock` returned 10 — a phantom 4 units a register would
/// sell against stock that does not exist.
///
/// This is also the second finding of the sibling-divergence class in this
/// audit, where the defect is visible only by comparing twin functions.
#[test]
#[allow(deprecated)] // the deprecated tx path is exactly what is under test
fn sync_replay_adjustment_invalidates_the_cached_quantity() {
    let conn = fresh();
    let cache = std::sync::Arc::new(ProbeCache::default());
    let s = Store::with_cache(&conn, cache.clone());
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES ('p1', 'SKU-1', 'Thing', 100, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO inventory (product_id, qty, updated_at)
         VALUES ('p1', 10, '2025-01-01T00:00:00.000Z');"
    )
    .unwrap();

    // A read populates the cache (get_stock caches on miss).
    let before = s.get_stock("p1").unwrap();
    assert_eq!(before, 10);
    assert_eq!(
        crate::cache::Cache::get_inventory(cache.as_ref(), "p1"),
        Some(10),
        "the read path caches on miss, which is what makes a missing
         invalidation destructive rather than merely wasteful"
    );

    // Sync replay adjusts stock inside its own transaction.
    let tx = conn.unchecked_transaction().unwrap();
    s.adjust_stock_in_tx(&tx, "SKU-1", -4).unwrap();
    tx.commit().unwrap();

    let raw: i64 = conn
        .query_row("SELECT qty FROM inventory WHERE product_id = 'p1'", [], |r| r.get(0))
        .unwrap();
    let via_get_stock = s.get_stock("p1").unwrap();
    assert_eq!(raw, 6, "the adjustment itself must land");
    assert_eq!(
        via_get_stock, raw,
        "a replayed adjustment must not leave the cache serving the pre-adjustment quantity"
    );
}
/// P1.9 — `insert_stock_movement` joins an open transaction.
#[test]
fn insert_stock_movement_joins_a_caller_transaction() {
    let conn = fresh();

    let tx = conn.unchecked_transaction().unwrap();
    Store::new(&conn)
        .insert_stock_movement(
            "mv-rollback",
            "item-1",
            5,
            Some("test"),
            None,
            None,
            "default",
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();
    let inside: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE id = 'mv-rollback'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(inside, 1, "visible inside the caller's transaction");
    tx.rollback().unwrap();

    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE id = 'mv-rollback'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, 0, "a rolled-back caller must leave no ledger row");
}

/// P1.9 — the autocommit arm still persists, so the join did not become a
/// silent no-op for every standalone caller.
#[test]
fn insert_stock_movement_still_commits_in_autocommit() {
    let conn = fresh();
    Store::new(&conn)
        .insert_stock_movement(
            "mv-auto",
            "item-1",
            7,
            None,
            None,
            None,
            "default",
            "2025-01-01T00:00:00.000Z",
        )
        .unwrap();
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE id = 'mv-auto'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "the own-transaction arm must still persist");
    assert!(conn.is_autocommit(), "the owned transaction must be closed");
}
