//! Backup, restore, and CSV export commands.
//!
//! `run_backup` snapshots the live database; `run_restore` validates the
//! candidate, checkpoints the WAL and hands the swap to
//! `kasirmu_core::db::restore_from` (CLI-4 sidecar handling kept, C8 slice S2
//! adds validation, the pre-restore snapshot and the atomic swap);
//! `run_export` writes CSV reports to stdout.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::Connection;

use kasirmu_core::db::{Store, pre_restore_snapshot_path, restore_from};

/// Create an online SQLite snapshot of the database.
pub(crate) fn run_backup(conn: &Connection, output: &str) -> Result<()> {
    let store = Store::new(conn);
    eprintln!("creating backup -> {output}...");
    store
        .backup(output)
        .with_context(|| format!("backup to {output}"))?;
    eprintln!("backup complete");
    Ok(())
}

/// Write a CSV report to stdout for the given kind.
pub(crate) fn run_export(conn: &Connection, kind: &str) -> Result<()> {
    let store = Store::new(conn);

    match kind {
        "daily-summary" => {
            let rows = store.export_daily_summary()?;
            let mut wtr = csv::Writer::from_writer(std::io::stdout());
            for r in &rows {
                wtr.serialize(r)?;
            }
            wtr.flush()?;
        }
        "sales-by-hour" => {
            let rows = store.export_sales_by_hour()?;
            let mut wtr = csv::Writer::from_writer(std::io::stdout());
            for r in &rows {
                wtr.serialize(r)?;
            }
            wtr.flush()?;
        }
        other => {
            eprintln!("unknown export kind '{other}'");
            eprintln!("available kinds: daily-summary, sales-by-hour");
            return Err(anyhow::anyhow!("unknown export kind '{other}'"));
        }
    }

    Ok(())
}

/// Restore the database from a backup file.
///
/// CLI-4 fix: dropping the connection does not remove the `*-wal` /
/// `*-shm` sidecar files — a live process (or a crashed previous one)
/// can leave a hot WAL whose frames would win the next open and silently
/// resurrect pre-restore data over the copied backup (torn restore).
/// The restore therefore checkpoints away the connection's WAL, then
/// hands over to `kasirmu_core::db::restore_from`, which validates the
/// candidate, takes the pre-restore snapshot, deletes both sidecars and
/// performs the atomic swap — the same validator and the same swap the
/// future in-app restore path uses (C8 slice S2).
pub(crate) fn run_restore(conn: Connection, input: &str) -> Result<()> {
    eprintln!("restoring from {input}...");

    // Close the existing connection cleanly, then let core perform the swap.
    let db_path = conn
        .path()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("kasir.db"));

    // Fold any WAL frames back into the main file so nothing live is
    // stranded in the sidecars (and so the pre-restore snapshot core takes
    // carries the committed WAL content), then close.
    if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        // In-memory or non-WAL databases return an error here; nothing
        // to checkpoint is fine — the swap below is the load-bearing step.
        eprintln!("  note: wal_checkpoint skipped ({e})");
    }
    drop(conn);

    let report = restore_from(Path::new(input), &db_path)
        .with_context(|| format!("restoring from {input}"))?;
    eprintln!("  candidate accepted: {}", report.reason);
    eprintln!(
        "  pre-restore snapshot: {}",
        pre_restore_snapshot_path(&db_path).display()
    );
    eprintln!("restore complete — database replaced with backup");
    Ok(())
}
