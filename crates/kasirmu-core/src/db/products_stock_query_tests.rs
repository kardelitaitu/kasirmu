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
