//! Background image GC daemon for the cloud sync server (spec 0046b §3.4/§3.7).
//!
//! Sweeps `image_refs` rows where `refcount = 0` and `updated_at` is older than
//! the grace period (24 hours), then deletes the corresponding files from the
//! image volume.  Runs on an hourly interval.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::metrics;
use kasirmu_core::db::Store;
use rusqlite::Connection;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// Grace period for orphaned image refs (seconds).  A hash with `refcount = 0`
/// must sit untouched for this long before the file is deleted.
const GC_GRACE_SECS: i64 = 86400; // 24 hours

/// How often the GC sweep runs.
const GC_INTERVAL_SECS: u64 = 3600; // 1 hour

/// Start the background image GC loop on a shared SQLite connection.
///
/// Spawns a `tokio` task that runs every hour.  Each cycle:
/// 1. Queries all distinct tenant IDs from `image_refs`.
/// 2. For each tenant, calls `Store::gc_images` with a 24-hour grace period.
/// 3. Deletes the corresponding files from `image_dir`.
/// 4. Logs the freed bytes and count.
pub fn start_image_gc_loop(db: Arc<Mutex<Connection>>, image_dir: PathBuf) {
    tokio::spawn(async move {
        info!("image GC loop started (interval = 1 hour, grace = 24 hours)");

        // Run immediately on startup so orphaned files don't accumulate.
        run_image_gc_cycle(&db, &image_dir).await;

        let mut interval = tokio::time::interval(Duration::from_secs(GC_INTERVAL_SECS));
        interval.tick().await; // skip the immediate first tick

        loop {
            interval.tick().await;
            run_image_gc_cycle(&db, &image_dir).await;
        }
    });
}

/// Execute a single GC cycle.
async fn run_image_gc_cycle(db: &Arc<Mutex<Connection>>, image_dir: &std::path::Path) {
    let result = tokio::task::spawn_blocking({
        let db = db.clone();
        let image_dir = image_dir.to_path_buf();
        move || {
            let conn = db.blocking_lock();
            let store = Store::new(&conn);

            // Collect distinct tenant IDs from image_refs.
            let tenants: Vec<String> = match conn
                .prepare("SELECT DISTINCT tenant_id FROM image_refs")
                .and_then(|mut stmt| {
                    let rows = stmt.query_map([], |row| row.get(0))?;
                    rows.collect::<Result<Vec<_>, _>>()
                }) {
                Ok(t) => t,
                Err(e) => {
                    error!(error = %e, "image GC: failed to query tenants");
                    return;
                }
            };

            let mut total_freed_bytes: i64 = 0;
            let mut total_count: usize = 0;

            for tenant_id in &tenants {
                match store.gc_images(tenant_id, GC_GRACE_SECS) {
                    Ok(hashes) => {
                        let count = hashes.len();
                        if count == 0 {
                            continue;
                        }
                        let mut freed_bytes: i64 = 0;
                        for hash in &hashes {
                            let path = image_dir.join(format!("{hash}.webp"));
                            // Read the size BEFORE deletion — the row is
                            // gone from image_refs afterwards, so the file
                            // size is the only bytes signal we have.
                            let size = std::fs::metadata(&path)
                                .map(|m| m.len() as i64)
                                .unwrap_or(0);
                            match std::fs::remove_file(&path) {
                                Ok(()) => {
                                    freed_bytes += size;
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                                    // File already gone — not an error.
                                }
                                Err(e) => {
                                    warn!(hash, error = %e, "image GC: failed to delete file");
                                }
                            }
                        }
                        total_count += count;
                        total_freed_bytes += freed_bytes;
                        // Observability (spec 0046b §3.7): a rising GC counter
                        // confirms the sweep is reclaiming space; the bytes
                        // gauge feeds the 4 GB soft-alert per tenant.
                        metrics::IMAGE_GC_DELETED_TOTAL.inc_by(count as f64);
                        let used = store.image_bytes_used(tenant_id).unwrap_or(0);
                        metrics::set_image_bytes_gauge(tenant_id, used);
                        info!(
                            tenant = %tenant_id,
                            count,
                            "image GC: swept {count} orphaned hashes for tenant {tenant_id}"
                        );
                    }
                    Err(e) => {
                        error!(tenant = %tenant_id, error = %e, "image GC: gc_images failed");
                    }
                }
            }

            if total_count > 0 {
                info!(
                    tenants = tenants.len(),
                    total_count, total_freed_bytes, "image GC cycle complete"
                );
            }
        }
    });

    if let Err(e) = result.await {
        error!(error = %e, "image GC: spawn_blocking panicked");
    }
}

#[cfg(test)]
#[path = "image_gc_tests.rs"]
mod tests;
