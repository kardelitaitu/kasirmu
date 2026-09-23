//! Unit tests for the sale CRUD compare-and-set (C18 / P1.1).
//!
//! The subject is `update_sale_status`'s race: the status read and the
//! status write must be one atomic decision, so a transition that lands in
//! between cannot be silently overwritten and the `Conflict` branch is a
//! real outcome rather than decoration. The happy-path and state-machine
//! cases already live in `sales_tests.rs`; these pins are the race.

use super::*;
use crate::migrations;
use crate::{Cart, CartLine, SaleStatus, Sku};
use rusqlite::Connection;

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

/// A migrated file-backed database, so two connections see the same rows
/// (an in-memory database is private per connection, which is exactly what a
/// race test cannot use).
fn fresh_file(dir: &std::path::Path) -> Connection {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join("kasir.db");
    let mut file_conn = Connection::open(&path).unwrap();
    {
        let template = migrations::fresh_db();
        let backup = rusqlite::backup::Backup::new(&template, &mut file_conn).unwrap();
        backup
            .run_to_completion(10, std::time::Duration::from_millis(0), None)
            .unwrap();
    }
    migrations::seed_provisioned_baseline(&file_conn);
    file_conn
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    file_conn
        .pragma_update(None, "busy_timeout", "5000")
        .unwrap();
    file_conn
}

/// A pending sale in a file-backed database, and its id.
fn seed_pending_sale(conn: &Connection) -> String {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    store(conn).create_sale(&sale).unwrap();
    assert_eq!(sale.status, SaleStatus::Pending);
    sale.id
}

fn stored_status(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT status FROM sales WHERE id = ?1", params![id], |r| {
        r.get(0)
    })
    .unwrap()
}

// ── C18 / P1.1: the read and the write are one decision ────────────

/// The race the pre-fix code lost, forced rather than hoped for.
///
/// `update_sale_status` used to read the status in autocommit and then issue
/// an unconditional `UPDATE … WHERE id = ?`, so a transition that landed in
/// that window was silently overwritten and the `rows == 0` branch could
/// never fire for a status race. Here connection B stages its own transition
/// under a held `BEGIN IMMEDIATE` write lock, so the window stays open for as
/// long as this test wants: A reads the pre-B status (WAL readers do not
/// block on a writer) and then blocks on the write. B commits, and A's
/// conditional UPDATE is evaluated against the committed row — which is no
/// longer in the state A validated its transition against, so A must report
/// the conflict and B's status must survive.
///
/// Against the pre-fix statement this test returns `Ok` and the row ends up
/// `active`, silently discarding B's transition.
#[test]
fn a_transition_that_lost_the_race_reports_the_conflict() {
    // The interleaving this test needs is: A reads the status, B commits a
    // move, A writes. A runs on the main thread, so its read lands as soon as
    // B announces its lock; a spawned A could be descheduled past B's commit,
    // which would let A read `completed` and turn the expected conflict into
    // a plain invalid-transition `Validation`.
    //
    // The loop is a safety net for the residual window (a stop-the-world
    // stall longer than B's beat). It cannot mask the bug it guards: the
    // pre-fix unconditional UPDATE returns `Ok` on the first attempt, which
    // panics immediately rather than retrying.
    for _attempt in 0..8 {
        let dir = std::env::temp_dir().join(format!("oz_sale_race_{}", uuid::Uuid::now_v7()));
        let conn = fresh_file(&dir);
        let sale_id = seed_pending_sale(&conn);
        let db_path = dir.join("kasir.db");

        // B moves the sale forward and holds the write lock for a fixed beat,
        // then commits. The beat is what keeps the check-then-act window open:
        // A (below) runs on the main thread the instant `locked` arrives, so
        // its read lands well inside it, and its write then blocks on B's lock
        // until the commit lands.
        //
        // B releases on its own timer rather than on a signal from A, because
        // A cannot signal mid-call: it is blocked inside `update_sale_status`.
        // Running A on the *main* thread is what makes this deterministic —
        // a spawned A could be descheduled past B's commit, which turns the
        // expected conflict into a plain invalid-transition `Validation`.
        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let mover = {
            let db_path = db_path.clone();
            let sale_id = sale_id.clone();
            std::thread::spawn(move || {
                let mut conn_b = Connection::open(&db_path).unwrap();
                conn_b.pragma_update(None, "busy_timeout", "5000").unwrap();
                let tx = conn_b
                    .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                    .unwrap();
                tx.execute(
                    "UPDATE sales SET status = 'completed', version = version + 1 WHERE id = ?1",
                    params![sale_id],
                )
                .unwrap();
                locked_tx.send(()).unwrap();
                // Hold the window open long enough for A's read to land inside
                // it, then commit — releasing the lock A is blocked on.
                std::thread::sleep(std::time::Duration::from_millis(300));
                tx.commit().unwrap();
            })
        };
        locked_rx.recv().unwrap();

        // A is the caller that observed `pending` and is mid-transition.
        let conn_a = Connection::open(&db_path).unwrap();
        conn_a.pragma_update(None, "busy_timeout", "5000").unwrap();
        let outcome = Store::new(&conn_a).update_sale_status(&sale_id, SaleStatus::Active);
        mover.join().unwrap();

        match outcome {
            // The intended interleaving: A read `pending`, B committed, A's
            // compare-and-set matched nothing.
            Err(CoreError::Conflict { .. }) => {
                // The decisive assertion: B's transition is still on disk.
                let after = Connection::open(&db_path).unwrap();
                assert_eq!(
                    stored_status(&after, &sale_id),
                    "completed",
                    "the losing transition overwrote the winner"
                );
                let _ = std::fs::remove_dir_all(&dir);
                return;
            }
            // A read too late — B had already committed, so there was no race
            // left to lose. Restage.
            Err(CoreError::Validation { .. }) => {
                let _ = std::fs::remove_dir_all(&dir);
                continue;
            }
            // The pre-fix behaviour: the losing transition succeeded and
            // silently discarded the winner's `completed`.
            Ok(sale) => panic!(
                "a transition that lost the race must not succeed, got status {:?}",
                sale.status
            ),
            Err(other) => panic!("unexpected outcome for a lost race: {other:?}"),
        }
    }
    panic!("could not stage the read-before-commit interleaving in 8 attempts");
}

/// The other half of the same guarantee, without threads: a competing
/// transition that has *already committed* must not be overwritten by a call
/// that is still holding the status it saw before it. The row is moved on a
/// second connection, and the caller's transition is then refused — the
/// write never lands.
///
/// This is the deterministic companion to the staged race above: that one
/// pins the conflict branch (the row moved mid-flight), this one pins the
/// no-overwrite property for the committed case.
#[test]
fn a_committed_competing_transition_is_not_overwritten() {
    let dir = std::env::temp_dir().join(format!("oz_sale_cas_{}", uuid::Uuid::now_v7()));
    let conn = fresh_file(&dir);
    let sale_id = seed_pending_sale(&conn);

    // A second connection, the shape a second terminal or a sync replay
    // would use, moves the sale forward and commits.
    let other = Connection::open(dir.join("kasir.db")).unwrap();
    other.pragma_update(None, "busy_timeout", "5000").unwrap();
    Store::new(&other)
        .update_sale_status(&sale_id, SaleStatus::Active)
        .expect("the first transition must win");
    assert_eq!(stored_status(&other, &sale_id), "active");

    // The caller that still believes the sale is pending must not move it
    // back to active; the state machine refuses, and nothing is written.
    let before: i64 = other
        .query_row(
            "SELECT version FROM sales WHERE id = ?1",
            params![sale_id],
            |r| r.get(0),
        )
        .unwrap();
    let err = store(&conn)
        .update_sale_status(&sale_id, SaleStatus::Active)
        .expect_err("a sale that already moved must not be transitioned again");
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "the state machine guard must refuse the repeat, got: {err:?}"
    );

    let after: i64 = other
        .query_row(
            "SELECT version FROM sales WHERE id = ?1",
            params![sale_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(after, before, "the refused call still bumped the version");
    assert_eq!(stored_status(&other, &sale_id), "active");

    let _ = std::fs::remove_dir_all(&dir);
}
