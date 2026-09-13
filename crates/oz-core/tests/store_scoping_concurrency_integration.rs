//! Concurrency audit for store-scoped isolation (migration 117 end-state).
//!
//! The raw-SQL audit (`migrations::tests::store_scoped_*`) and the
//! repository-layer audit (`store_scoping_integration.rs`) prove isolation
//! on a single connection. This suite proves the SAME guarantee under real
//! concurrency — parallel writers on separate connections to a shared
//! file-based database:
//!
//! 1. **Cross-store parallel writers** — two threads insert products for
//!    store-a and store-b concurrently. Both must succeed (SQLite
//!    serializes writers at the file level, so the busy timeout is what
//!    lets both land), and afterwards each scoped read returns exactly its
//!    own store's row with a clean `foreign_key_check`.
//! 2. **Same-store racing writers** — two threads race identical
//!    store-a-scoped updates inside `BEGIN IMMEDIATE` transactions. Exactly
//!    one wins; the loser fails cleanly at the transaction boundary with a
//!    SQLite busy/locked serialization error. The final row is
//!    byte-consistent (no torn state) and still scoped to store-a.
//!
//! File-based (not in-memory) because separate connections can only share
//! a database on disk — the same pattern as
//! `db::sales::tests::concurrent_complete_sale_serialized_by_begin_immediate`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use oz_core::{LocationProfile, Store};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

/// Create a temp dir + file DB with the full migration set applied
/// (schema + seeded baseline cloned from `fresh_db()`), FK enforcement ON.
/// Returns `(dir, db_path)`; the caller removes `dir` on cleanup.
fn setup_file_db() -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("oz_scoping_conc_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");

    // Clone the schema from a fresh_db() snapshot into the file DB.
    {
        let mut file_conn = Connection::open(&db_path).unwrap();
        {
            let template = oz_core::migrations::fresh_db();
            let backup = rusqlite::backup::Backup::new(&template, &mut file_conn).unwrap();
            backup
                .run_to_completion(10, std::time::Duration::from_millis(0), None)
                .unwrap();
        }
        file_conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    }
    (dir, db_path)
}

fn make_profile(id: &str, name: &str) -> LocationProfile {
    LocationProfile {
        id: id.to_owned(),
        name: name.to_owned(),
        address: String::new(),
        tax_id: String::new(),
        currency: "USD".to_owned(),
        timezone: "UTC".to_owned(),
        is_primary: false,
        created_at: "2026-07-01T10:00:00Z".to_owned(),
        updated_at: "2026-07-01T10:00:00Z".to_owned(),
    }
}

/// Seed store-a / store-b profiles in the shared file DB.
fn seed_locations(db_path: &std::path::Path) {
    let conn = Connection::open(db_path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    let s = Store::new(&conn);
    s.create_location_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    s.create_location_profile(&make_profile("store-b", "Store B"))
        .unwrap();
}

/// Spin on an atomic flag with a bounded wall-clock deadline.
///
/// A handshake partner that errors or panics before setting its flag must
/// produce a fast, diagnosable failure — never an unbounded spin that
/// hangs the whole test (and CI with it). The deadline is generous because
/// SQLite's busy-fail on `BEGIN IMMEDIATE` under a held write lock can take
/// a few seconds on some platforms (the sales.rs precedent shows ~5s); the
/// bound exists only to convert a hung handshake into a panicked test.
fn wait_for_flag(flag: &AtomicBool, what: &str) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while !flag.load(Ordering::SeqCst) {
        std::thread::yield_now();
        if std::time::Instant::now() >= deadline {
            panic!("handshake timed out waiting for {what}");
        }
    }
}

/// Count FK violations across the whole DB (migration 117 ownership
/// integrity must hold under concurrency too).
fn fk_violations(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
        r.get(0)
    })
    .unwrap()
}

// ── Cross-store parallel writers ──────────────────────────────────────

/// Two threads concurrently insert products for DIFFERENT stores. Both
/// must succeed (disjoint ownership scopes never contend), and afterwards
/// each scoped read surfaces exactly its own store's row — never the
/// other's — with a clean `foreign_key_check`.
#[test]
fn cross_store_parallel_writers_never_leak_across_scopes() {
    let (dir, db_path) = setup_file_db();
    seed_locations(&db_path);

    let pa = db_path.clone();
    let writer_a = std::thread::spawn(move || {
        let conn = Connection::open(&pa).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        // A busy timeout turns transient write-lock contention into a wait
        // (both writes are legitimate and must both land).
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
             VALUES ('p-a', 'SKU-A', 'Prod A', 100, 'USD', 'store-a')",
            [],
        )
        .unwrap();
    });

    let pb = db_path.clone();
    let writer_b = std::thread::spawn(move || {
        let conn = Connection::open(&pb).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        conn.busy_timeout(std::time::Duration::from_secs(30))
            .unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
             VALUES ('p-b', 'SKU-B', 'Prod B', 200, 'USD', 'store-b')",
            [],
        )
        .unwrap();
    });

    writer_a.join().unwrap();
    writer_b.join().unwrap();

    // Both rows landed, each scoped to its own store.
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    let s = Store::new(&conn);

    let a = s.list_products_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|r| r.product.sku.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["SKU-A"],
        "store-a must see exactly its own concurrently-inserted row"
    );

    let b = s.list_products_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|r| r.product.sku.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["SKU-B"],
        "store-b must see exactly its own concurrently-inserted row"
    );

    // No cross-store leakage through the raw table either.
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, 2, "exactly the two concurrent rows exist");

    assert_eq!(
        fk_violations(&conn),
        0,
        "no FK violations after parallel writes"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ── Same-store racing writers ─────────────────────────────────────────

/// Two threads race identical store-a-scoped updates inside `BEGIN
/// IMMEDIATE` transactions. Exactly one wins; the loser fails cleanly with
/// a SQLite busy/locked serialization error (no torn state), the row stays
/// scoped to store-a, and `foreign_key_check` stays clean.
#[test]
fn same_store_racing_writers_serialize_exactly_one_wins() {
    let (dir, db_path) = setup_file_db();
    seed_locations(&db_path);

    // Seed one store-a-owned product row.
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, store_id)
             VALUES ('p-a', 'SKU-A', 'Prod A', 100, 'USD', 'store-a')",
            [],
        )
        .unwrap();
    }

    // Handshake so the race is deterministic:
    //  - Writer A takes the write lock (BEGIN IMMEDIATE), does its update,
    //    then WAITS until writer B's BEGIN attempt has COMPLETED before
    //    committing — so A provably still holds the write lock for the
    //    whole window in which B attempts BEGIN.
    //  - Writer B waits until A holds the lock, then attempts BEGIN
    //    IMMEDIATE (must fail with SQLITE_BUSY while A is still inside the
    //    transaction), and only THEN signals completion.
    let lock_held = Arc::new(AtomicBool::new(false));
    let loser_done = Arc::new(AtomicBool::new(false));

    let lh_a = lock_held.clone();
    let ld_a = loser_done.clone();
    let pa = db_path.clone();
    let writer_a = std::thread::spawn(move || {
        let conn = Connection::open(&pa).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        // BEGIN IMMEDIATE takes the write lock up front (ADR-19 §5.2).
        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE products SET price_minor = price_minor + 50 WHERE id = 'p-a'",
            [],
        )
        .map_err(|e| e.to_string())?;
        lh_a.store(true, Ordering::SeqCst);
        // Hold the write lock until the loser's BEGIN attempt has finished.
        wait_for_flag(&ld_a, "loser BEGIN attempt to complete");
        conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    });

    let lh_b = lock_held.clone();
    let ld_b = loser_done.clone();
    let pb = db_path.clone();
    let writer_b = std::thread::spawn(move || {
        let conn = Connection::open(&pb).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        // Wait until writer A is inside its transaction, then attempt BEGIN.
        wait_for_flag(&lh_b, "writer A to hold the write lock");
        let result = conn.execute("BEGIN IMMEDIATE", []);
        // Signal AFTER the attempt so A cannot commit before it has run.
        ld_b.store(true, Ordering::SeqCst);
        result.map(|_| ()).map_err(|e| e.to_string())
    });

    let a_res = writer_a.join().unwrap();
    let b_res = writer_b.join().unwrap();

    // Exactly one winner.
    assert!(a_res.is_ok(), "lock holder must win, got: {a_res:?}");
    assert!(
        b_res.is_err(),
        "the racing writer must fail at BEGIN IMMEDIATE, got: {b_res:?}"
    );
    let b_msg = b_res.unwrap_err().to_lowercase();
    assert!(
        b_msg.contains("busy") || b_msg.contains("locked"),
        "loser must fail with a SQLite serialization error, got: {b_msg}"
    );

    // No torn state: the winner's update applied exactly once.
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    let price: i64 = conn
        .query_row(
            "SELECT price_minor FROM products WHERE id = 'p-a'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        price, 150,
        "exactly one racing writer applied; row must not be torn"
    );

    // Still scoped to store-a; store-b sees nothing.
    let s = Store::new(&conn);
    let a = s.list_products_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|r| r.product.sku.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(a_ids, vec!["SKU-A"]);
    let b = s.list_products_for_store("store-b").unwrap();
    assert!(
        b.is_empty(),
        "racing updates must not cross store boundaries"
    );

    assert_eq!(fk_violations(&conn), 0, "no FK violations after the race");

    let _ = std::fs::remove_dir_all(&dir);
}
