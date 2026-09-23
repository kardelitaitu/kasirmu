//! Stock variance report — `oz stock-variance`.
//!
//! Wires the existing read-only core report
//! ([`kasirmu_core::db::Store::stock_variance_report`], checklist item C12) to
//! an operator surface. The report itself is finished and verified; this module
//! adds no logic to it — it opens the store, calls the report, and renders what
//! comes back.
//!
//! WHY A CLI SUBCOMMAND, and not a desktop or tablet panel: the CLI already
//! owns the read-only maintenance surface (`oz backup`, `oz restore`,
//! `oz export`, `oz credential-deltas`), so this reuses an existing surface
//! instead of inventing one, and it drags no UI gate (vitest, bundle budget,
//! locale strings) behind it. It is the shape the neighbouring read-only
//! operations already use.
//!
//! WHY TEXT AND NOT CSV: `oz export` writes CSV because it dumps BULK data.
//! This is a bounded triage view of at most
//! [`STOCK_VARIANCE_MAX_ROWS`] rows, which is the same shape as `oz sale get`
//! (a fixed-width table). The core row type carries no `Serialize`, and core is
//! out of scope here, so a hand-rolled second serialization would be a second
//! definition of the row — the drift this codebase avoids.
//!
//! READ-ONLY IN CONTENT, NOT BYTE-FOR-BYTE: the report issues one `SELECT` and
//! writes no row, but [`crate::commands::open_db`] sets `PRAGMA
//! journal_mode=WAL` on every CLI path, so a run persists WAL in the file header
//! and creates `<db>-wal` / `<db>-shm` beside it. See
//! [`HELP_BYTES_NOT_CONTENT`].

use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::Connection;

use kasirmu_core::db::Store;
use kasirmu_core::stock_variance::{STOCK_VARIANCE_MAX_ROWS, StockVarianceRow};

use crate::cli::StockVarianceArgs;

/// Why the numbers can disagree at all, so the output is actionable.
pub(crate) const HELP_WHY: &str = concat!(
    "A divergence normally means a terminal re-applied a sale it had already pushed: the same\n",
    "deduction landed twice in the ledger (or once in the summary), and the two tables drifted\n",
    "apart per (item, location). A pair with movement history but NO summary row is reported with\n",
    "stored_qty = 0 rather than omitted — the ledger drives the join, so an unwritten summary row\n",
    "is visible drift, not a missing report line."
);

/// The byte-level caveat, in the help rather than discovered by an operator.
pub(crate) const HELP_BYTES_NOT_CONTENT: &str = concat!(
    "READ-ONLY IN CONTENT, NOT BYTE-FOR-BYTE: no row is written, but the CLI opens the database\n",
    "with PRAGMA journal_mode=WAL, which persists WAL in the file header and creates <db>-wal and\n",
    "<db>-shm beside it for the duration of the run, so the bytes and the mtime DO change. A clean\n",
    "close checkpoints the sidecars away, so their absence afterwards is NOT evidence the file was\n",
    "untouched. This command refuses a --db path it would have to create (unlike migrate / init-db\n",
    "/ restore, which provision on purpose), because a report computed against a freshly created\n",
    "empty file is not a clean database — it is a lie about one."
);

/// The whole long help, assembled from the same constants the run prints.
pub(crate) const LONG_HELP: &str = concat!(
    "Report stock_summary vs the stock_movements ledger, read-only.\n\n",
    "WHAT IT REPORTS. Every (item_id, location_id) whose materialised stock_summary.qty disagrees\n",
    "with SUM(stock_movements.delta) — the ledger. The report is a READ-ONLY diagnostic: it never\n",
    "rewrites history, because a blind qty = SUM(delta) repair would destroy legitimate manual\n",
    "adjustments. The operator decides what to correct. Rows are ordered by absolute difference\n",
    "descending, so the worst disagreement is first.\n\n",
    "WHY THE NUMBERS CAN DISAGREE. A divergence normally means a terminal re-applied a sale it had\n",
    "already pushed: the same deduction landed twice in the ledger (or once in the summary), and the\n",
    "two tables drifted apart per (item, location). A pair with movement history but NO summary row\n",
    "is reported with stored_qty = 0 rather than omitted — the ledger drives the join, so an\n",
    "unwritten summary row is visible drift, not a missing report line.\n\n",
    "READ-ONLY IN CONTENT, NOT BYTE-FOR-BYTE. No row is written, but the CLI opens the database with\n",
    "PRAGMA journal_mode=WAL, which persists WAL in the file header and creates <db>-wal and\n",
    "<db>-shm beside it for the duration of the run, so the bytes and the mtime DO change. This\n",
    "command refuses a --db path it would have to create, because a report computed against a\n",
    "freshly created empty file is not a clean database — it is a lie about one."
);

/// Open the store for `stock-variance` ONLY, refusing a `--db` path this
/// command would have to CREATE before `open_db` gets the chance to do it.
///
/// The footgun is the same one `open_store_for_credential_deltas` documents, and
/// it is worse for a report: `--db` defaults to `./kasir.db` in the CURRENT
/// directory and `Connection::open` CREATES a missing path, so a mistyped
/// database would open as an empty file, every variance count would come back
/// zero, and the operator would read that as "the ledger reconciles" — a clean
/// bill of health about a file the command itself had just made.
///
/// Scoped to this subcommand on purpose, exactly as the credential-deltas guard
/// is: `migrate`, `init-db` and `restore` legitimately PROVISION a database on
/// first run, so pushing this check into the shared `open_db` would convert a
/// one-command footgun into a first-run outage for the rest of the tool.
pub(crate) fn open_store_for_stock_variance(path: &str) -> Result<Connection> {
    if !Path::new(path).is_file() {
        anyhow::bail!(
            "oz stock-variance reads an existing store and never creates one: no database exists at {path}. --db defaults to ./kasir.db in the CURRENT directory, so a mistyped or relative path lands here as a file that is not there, and a variance report over an empty file would read as a clean ledger rather than as a missing database. Take a copy of a live store and run against the copy: oz backup --output <copy.db>, then oz stock-variance --db <copy.db>. Nothing was created, read, or written."
        );
    }
    crate::commands::open_db(path)
}

/// Render the report as fixed-width text lines, header first.
///
/// Pure and separate from the runner for the same reason
/// `credential_deltas::format_delta_counts` is: stdout is not captured in this
/// crate's tests, so the rendering is asserted directly and the runner only
/// prints it. Ids are NOT truncated — a UUID is 36 characters and an elided id
/// is an id the operator cannot act on.
pub(crate) fn format_variance_rows(rows: &[StockVarianceRow]) -> Vec<String> {
    let mut lines = Vec::with_capacity(rows.len() + 2);
    lines.push(format!(
        "{:<38} {:<38} {:>8} {:>8} {:>8}",
        "ITEM_ID", "LOCATION_ID", "STORED", "LEDGER", "DIFF"
    ));
    lines.push(format!(
        "{:-<38} {:-<38} {:->8} {:->8} {:->8}",
        "", "", "", "", ""
    ));
    for r in rows {
        lines.push(format!(
            "{:<38} {:<38} {:>8} {:>8} {:>8}",
            r.item_id, r.location_id, r.stored_qty, r.ledger_qty, r.difference
        ));
    }
    lines
}

/// The line that keeps a capped report honest, or `None` when it was not capped.
///
/// A truncated list the operator cannot detect reads as "this is everything",
/// which is the one failure mode a reconciliation report must not have. When the
/// returned count reaches the requested `limit` the report MAY have more rows
/// behind it, and this says so.
pub(crate) fn bound_note(returned: usize, limit: i64) -> Option<String> {
    if returned as i64 >= limit {
        Some(format!(
            "ROW BOUND REACHED: {returned} row(s) returned, exactly the --limit of {limit}. This report is CAPPED, so further divergent (item, location) pairs may exist. Re-run with a higher --limit (the report's hard ceiling is {STOCK_VARIANCE_MAX_ROWS}) or narrow with a higher --min-difference."
        ))
    } else {
        None
    }
}

/// `oz stock-variance` — report `stock_summary` vs the `stock_movements` ledger.
///
/// Read-only: the only statement issued is the report's own `SELECT`. Validation
/// errors from the report (`--min-difference` negative, `--limit` outside
/// `1..=STOCK_VARIANCE_MAX_ROWS`) are PROPAGATED, never swallowed — the operator
/// gets a field-named refusal and a non-zero exit rather than a silently
/// unfiltered or silently truncated table.
pub(crate) fn run_stock_variance(conn: &Connection, args: &StockVarianceArgs) -> Result<()> {
    let store = Store::new(conn);
    let rows = store
        .stock_variance_report(args.min_difference, args.limit)
        .with_context(|| {
            format!(
                "stock variance report (--min-difference {}, --limit {}; the report accepts --min-difference >= 0 and --limit in 1..={STOCK_VARIANCE_MAX_ROWS})",
                args.min_difference, args.limit
            )
        })?;

    if rows.is_empty() {
        println!(
            "No stock variance at --min-difference {}. Every (item, location) with movement history has stock_summary.qty agreeing with SUM(stock_movements.delta) at or above this threshold.",
            args.min_difference
        );
        return Ok(());
    }

    println!(
        "Stock variance — stock_summary vs stock_movements, {} divergent (item, location) pair(s), ordered by absolute difference:",
        rows.len()
    );
    for line in format_variance_rows(&rows) {
        println!("{line}");
    }
    if let Some(note) = bound_note(rows.len(), args.limit) {
        println!();
        println!("{note}");
    }
    println!();
    println!("{}", HELP_WHY);
    println!();
    println!("{}", HELP_BYTES_NOT_CONTENT);
    Ok(())
}

#[cfg(test)]
#[path = "stock_variance_tests.rs"]
mod tests;
