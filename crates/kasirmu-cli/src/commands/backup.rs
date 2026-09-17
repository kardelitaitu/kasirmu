//! Backup, restore, and CSV export commands.
//!
//! `run_backup` snapshots the live database; `run_restore` replaces it
//! (CLI-4: checkpointing the WAL and deleting stale `-wal`/`-shm`
//! sidecars before the copy); `run_export` writes CSV reports to stdout.

use anyhow::{Context, Result};
use rusqlite::Connection;

use kasirmu_core::db::Store;

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
/// deletes both sidecars before the copy.
pub(crate) fn run_restore(conn: Connection, input: &str) -> Result<()> {
    eprintln!("restoring from {input}...");

    // Close the existing connection cleanly, then copy the backup over.
    let db_path = conn
        .path()
        .map(|p| p.to_owned())
        .unwrap_or_else(|| "kasir.db".into());

    // Fold any WAL frames back into the main file so nothing live is
    // stranded in the sidecars, then close.
    if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        // In-memory or non-WAL databases return an error here; nothing
        // to checkpoint is fine — the sidecar deletion below is the
        // load-bearing step.
        eprintln!("  note: wal_checkpoint skipped ({e})");
    }
    drop(conn);

    for sidecar_ext in ["-wal", "-shm"] {
        let sidecar = format!("{db_path}{sidecar_ext}");
        match std::fs::remove_file(&sidecar) {
            Ok(()) => eprintln!("  removed stale sidecar {sidecar}"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(anyhow::Error::from(e))
                    .with_context(|| format!("removing sidecar {sidecar} before restore"));
            }
        }
    }

    std::fs::copy(input, &db_path)
        .with_context(|| format!("copying backup {input} to {db_path}"))?;

    eprintln!("restore complete — database replaced with backup");
    Ok(())
}
