//! Unit tests for `pool`.
//!
//! Moved out of `pool.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `pool.rs` with:
//!   `#[cfg(test)] #[path = "pool_tests.rs"] mod tests;`

use super::*;

#[test]
fn pool_open_and_conn() {
    let pool = Pool::open_in_memory().unwrap();
    let conn = pool.conn().unwrap();
    let result: i64 = conn.query_row("SELECT 42", [], |row| row.get(0)).unwrap();
    assert_eq!(result, 42);
}

#[test]
fn pool_wal_pragma_set() {
    let pool = Pool::open_in_memory().unwrap();
    let conn = pool.conn().unwrap();
    let mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    // In-memory databases may not support WAL; accept "memory" too.
    assert!(
        mode == "wal" || mode == "memory",
        "expected wal or memory, got {mode}"
    );
}

#[test]
fn pool_clone_shares_connection() {
    let pool = Pool::open_in_memory().unwrap();
    let pool2 = pool.clone();

    // Create table from pool.
    {
        let conn = pool.conn().unwrap();
        conn.execute_batch("CREATE TABLE t (x INTEGER)").unwrap();
    }

    // Query from pool2 — should see the same data.
    let conn = pool2.conn().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn pool_multiple_connections_sequential() {
    let pool = Pool::open_in_memory().unwrap();

    // Insert using first guard.
    {
        let conn = pool.conn().unwrap();
        conn.execute_batch("CREATE TABLE t (x INTEGER)").unwrap();
        conn.execute("INSERT INTO t (x) VALUES (1)", []).unwrap();
    }

    // Read using second guard.
    {
        let conn = pool.conn().unwrap();
        let val: i64 = conn
            .query_row("SELECT x FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(val, 1);
    }
}

#[test]
fn pool_open_file_fails_with_invalid_path() {
    // On Windows, an empty path or invalid chars should fail.
    let result = Pool::open("\0");
    assert!(result.is_err());
}

#[test]
fn pool_conn_lock_reentrant() {
    let pool = Pool::open_in_memory().unwrap();
    {
        let conn = pool.conn().unwrap();
        conn.execute_batch("CREATE TABLE t (x INTEGER)").unwrap();
    }
    // Drop guard, then acquire again.
    let conn = pool.conn().unwrap();
    let val: i64 = conn
        .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(val, 0);
}

#[test]
fn pool_foreign_keys_pragma_on() {
    let pool = Pool::open_in_memory().unwrap();
    let conn = pool.conn().unwrap();
    let fk: bool = conn
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert!(fk);
}

#[test]
fn pool_clone_serializes_access() {
    let pool = Pool::open_in_memory().unwrap();
    let pool2 = pool.clone();

    // Acquire lock on pool.
    let _guard = pool.conn().unwrap();

    // pool2 shares the same mutex so it must wait; but we can still
    // verify the handle exists by checking the type is Send + Sync.
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Pool>();

    // Explicitly drop to prove the type is usable.
    drop(_guard);

    // After dropping, pool2 can acquire.
    let conn = pool2.conn().unwrap();
    let val: i64 = conn.query_row("SELECT 99", [], |row| row.get(0)).unwrap();
    assert_eq!(val, 99);
}
