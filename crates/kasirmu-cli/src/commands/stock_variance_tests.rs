//! Tests for `oz stock-variance`.
//!
//! The report itself is already verified in core (`stock_variance_tests.rs`), so
//! these tests are about the SURFACE, not about re-deriving the query: that it
//! reaches the report at all, that it stays read-only, that a missing database
//! path is refused rather than created, and that the row bound and the
//! validation errors SURFACE instead of being swallowed.

use super::*;
use rusqlite::Connection;
use std::path::PathBuf;

use crate::cli::StockVarianceArgs;
use kasirmu_core::stock_variance::STOCK_VARIANCE_MAX_ROWS;

fn fresh_db() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

/*
 * A temp directory that is removed even when the test fails.
 *
 * Same shape as the credential-deltas fixture, for the same measured reason:
 * cleanup on the last line of the test body never runs on a panic, so a failed
 * run seeds the next one with a stale file — and a test whose precondition is
 * "this path must not exist" then flickers red once and green on the retry.
 * Removing in Drop, which unwinding does run, closes the class.
 */
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // pid alone is not unique across runs; the clock makes it per-run.
        let path = std::env::temp_dir().join(format!("oz-sv-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create the per-run temp dir");
        Self(path)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn args(min_difference: i64, limit: i64) -> StockVarianceArgs {
    StockVarianceArgs {
        min_difference,
        limit,
    }
}

// ── seeding (mirrors core's stock_variance_tests fixtures) ───────────

fn seed_product(conn: &Connection, sku: &str) -> String {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, sku, sku],
    )
    .unwrap();
    id
}

fn seed_location(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO inventory_locations (id, name, type, created_at, updated_at)
         VALUES (?1, ?1, 'store', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id],
    )
    .unwrap();
}

fn seed_movement(conn: &Connection, item_id: &str, location_id: &str, delta: i64) {
    conn.execute(
        "INSERT INTO stock_movements (id, item_id, location_id, delta, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, 'sale', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![
            uuid::Uuid::now_v7().to_string(),
            item_id,
            location_id,
            delta
        ],
    )
    .unwrap();
}

fn seed_summary(conn: &Connection, item_id: &str, location_id: &str, qty: i64) {
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at)
         VALUES (?1, ?2, ?3, '2025-01-01T00:00:00.000Z')",
        rusqlite::params![item_id, location_id, qty],
    )
    .unwrap();
}

/// The C12 scenario: a terminal re-applied its own pushed sale, so the ledger
/// shows -6 while the summary was deducted twice, down to 8.
fn seed_divergent(conn: &Connection) -> (String, &'static str) {
    let loc = "loc-main";
    seed_location(conn, loc);
    let item = seed_product(conn, "SV-DIVERGENT");
    seed_movement(conn, &item, loc, 10);
    seed_movement(conn, &item, loc, -6);
    seed_summary(conn, &item, loc, 8); // ledger says 4, summary says 8
    (item, loc)
}

/// Total row count of every table the report touches, for the read-only proof.
fn state_fingerprint(conn: &Connection) -> (i64, i64, i64) {
    let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    (
        q("SELECT COUNT(*) FROM stock_movements"),
        q("SELECT COALESCE(SUM(qty), 0) FROM stock_summary"),
        q("SELECT COUNT(*) FROM stock_summary"),
    )
}

// ── (1) the subcommand reaches the report and renders its rows ───────

/// The point of C12b: the report had no caller. This asserts the surface
/// actually reaches it and returns the divergent pair.
#[test]
fn run_stock_variance_reports_the_divergent_pair() {
    let conn = fresh_db();
    let (item, loc) = seed_divergent(&conn);

    let result = run_stock_variance(&conn, &args(1, 50));
    assert!(
        result.is_ok(),
        "the subcommand must reach the core report: {result:?}"
    );

    // The same call the runner makes, so the assertion is about the data the
    // surface renders rather than about stdout (which this crate cannot capture).
    let rows = Store::new(&conn).stock_variance_report(1, 50).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].item_id, item);
    assert_eq!(rows[0].location_id, loc);
    assert_eq!(rows[0].stored_qty, 8);
    assert_eq!(rows[0].ledger_qty, 4);
    assert_eq!(rows[0].difference, 4);

    // And the rendered text carries those numbers, header included.
    let lines = format_variance_rows(&rows);
    assert!(lines[0].contains("ITEM_ID"), "header first: {:?}", lines[0]);
    assert!(
        lines.iter().any(|l| l.contains(&item) && l.contains(loc)),
        "the divergent pair is rendered: {lines:?}"
    );
    assert!(
        lines
            .iter()
            .any(|l| l.trim_end().ends_with("8        4        4")),
        "stored/ledger/diff are rendered: {lines:?}"
    );
}

/// A clean database is a real answer, not an error and not a silent nothing.
#[test]
fn run_stock_variance_on_a_clean_ledger_is_ok() {
    let conn = fresh_db();
    let loc = "loc-main";
    seed_location(&conn, loc);
    let item = seed_product(&conn, "SV-CLEAN");
    seed_movement(&conn, &item, loc, 5);
    seed_movement(&conn, &item, loc, -2);
    seed_summary(&conn, &item, loc, 3); // agrees

    assert!(run_stock_variance(&conn, &args(1, 50)).is_ok());
    assert!(
        Store::new(&conn)
            .stock_variance_report(1, 50)
            .unwrap()
            .is_empty(),
        "a consistent pair is not a variance"
    );
}

// ── (2) READ-ONLY, asserted rather than assumed ──────────────────────

/// Reuses core's own proof pattern (`report_performs_no_writes`): fingerprint
/// every table the report reads before and after the SURFACE call, and require
/// the numbers to be byte-identical. A future "helpful" `qty = SUM(delta)`
/// repair landing in this path would move one of them.
#[test]
fn run_stock_variance_performs_no_writes() {
    let conn = fresh_db();
    let (item, loc) = seed_divergent(&conn);
    let before = state_fingerprint(&conn);

    run_stock_variance(&conn, &args(1, 50)).unwrap();
    // Also exercise the two paths that could plausibly write: the empty result
    // and the capped result.
    run_stock_variance(&conn, &args(1, 1)).unwrap();
    run_stock_variance(&conn, &args(0, STOCK_VARIANCE_MAX_ROWS)).unwrap();

    assert_eq!(
        state_fingerprint(&conn),
        before,
        "the surface must not write: summary qty, summary rows and ledger rows are unchanged"
    );
    let stored: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = ?1 AND location_id = ?2",
            rusqlite::params![item, loc],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        stored, 8,
        "the divergent stored qty is reported, never repaired"
    );
}

// ── (3) a missing or unreadable path fails clearly, without panicking ─

/// THE case that separates the fix from the decoration: a mistyped `--db` must
/// be refused AND must not leave a created file behind. A report over a
/// freshly created empty database would read as a clean ledger, which is the
/// one answer a reconciliation report must never give falsely.
#[test]
fn a_missing_db_path_is_refused_and_not_created() {
    let dir = TempDir::new("missing");
    let path = dir.file("mistyped.db");
    assert!(
        !path.exists(),
        "a fresh per-run temp dir must not already contain {path:?}"
    );

    let err = open_store_for_stock_variance(&path.to_string_lossy())
        .expect_err("a path that does not exist must be refused, not opened");
    let msg = err.to_string();
    assert!(msg.contains("mistyped.db"), "must name the path: {msg}");
    assert!(
        msg.contains("never creates one"),
        "must say the create is the reason: {msg}"
    );
    assert!(
        msg.contains("oz backup"),
        "must name the safe way to inspect a live store: {msg}"
    );

    // The load-bearing half: absence, not wording.
    assert!(
        !path.exists(),
        "the refused call must NOT have created {path:?}"
    );
    for sidecar in ["mistyped.db-wal", "mistyped.db-shm"] {
        assert!(
            !dir.file(sidecar).exists(),
            "no sidecar may be created beside a refused path: {sidecar}"
        );
    }
}

/// A path that exists but cannot be opened is an error, not a panic. A
/// directory is the cheapest unreadable path on every platform.
#[test]
fn an_unopenable_path_is_an_error_not_a_panic() {
    let dir = TempDir::new("unreadable");
    let as_dir = dir.file("not-a-file.db");
    std::fs::create_dir_all(&as_dir).unwrap();
    assert!(as_dir.is_dir(), "precondition: the path is a directory");

    let result = open_store_for_stock_variance(&as_dir.to_string_lossy());
    assert!(
        result.is_err(),
        "a directory is not an openable database, and must be reported as an error"
    );
}

// ── (4) the row bound and validation errors SURFACE ─────────────────

/// A capped report must SAY it is capped. A truncated list the operator cannot
/// detect reads as "this is everything".
#[test]
fn the_row_bound_surfaces_when_the_report_is_capped() {
    // Exactly at the limit: the note fires.
    let note = bound_note(2, 2).expect("a report that hit its limit must say so");
    assert!(note.contains("ROW BOUND REACHED"), "{note}");
    assert!(note.contains("CAPPED"), "{note}");
    assert!(
        note.contains(&STOCK_VARIANCE_MAX_ROWS.to_string()),
        "the note names the hard ceiling: {note}"
    );

    // Below the limit: nothing to say.
    assert_eq!(
        bound_note(2, 50),
        None,
        "an uncapped report must not claim a bound it did not hit"
    );

    // End to end: 3 divergent pairs read with --limit 2 really are capped.
    let conn = fresh_db();
    let loc = "loc-main";
    seed_location(&conn, loc);
    for sku in ["SV-B1", "SV-B2", "SV-B3"] {
        let item = seed_product(&conn, sku);
        seed_movement(&conn, &item, loc, 5);
        seed_summary(&conn, &item, loc, 1);
    }
    let rows = Store::new(&conn).stock_variance_report(1, 2).unwrap();
    assert_eq!(rows.len(), 2, "the limit bounds the read");
    assert!(
        bound_note(rows.len(), 2).is_some(),
        "and the surface reports that the read was bounded"
    );
    run_stock_variance(&conn, &args(1, 2)).unwrap();
}

/// Validation errors from the core report must reach the operator, not be
/// swallowed into an empty table. Both bound parameters are covered.
#[test]
fn validation_errors_surface_instead_of_being_swallowed() {
    let conn = fresh_db();

    let negative = run_stock_variance(&conn, &args(-1, 50))
        .expect_err("a negative min-difference must be refused, not silently ignored");
    let msg = format!("{negative:?}");
    assert!(
        msg.contains("min_abs_difference"),
        "the refusal names the offending field: {msg}"
    );

    let zero_limit = run_stock_variance(&conn, &args(0, 0))
        .expect_err("a zero limit must be refused, not silently treated as unlimited");
    assert!(
        format!("{zero_limit:?}").contains("limit"),
        "the refusal names the offending field: {zero_limit:?}"
    );

    let too_many = run_stock_variance(&conn, &args(0, STOCK_VARIANCE_MAX_ROWS + 1))
        .expect_err("a limit above the ceiling must be refused, not silently truncated");
    let msg = format!("{too_many:?}");
    assert!(
        msg.contains(&STOCK_VARIANCE_MAX_ROWS.to_string()),
        "the refusal names the ceiling: {msg}"
    );

    // The boundary itself is accepted.
    assert!(run_stock_variance(&conn, &args(0, STOCK_VARIANCE_MAX_ROWS)).is_ok());
}
