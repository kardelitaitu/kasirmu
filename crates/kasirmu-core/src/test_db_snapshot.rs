//! The migrated-snapshot disk cache used by `crate::migrations::fresh_db`.
//!
//! # Why this is its own module
//!
//! Two reasons, in order of weight.
//!
//! **The cache is a performance property and belongs where it reads as one.**
//! `fresh_db()` is the test-database constructor; the disk cache is what stops
//! every process from re-running the whole migration chain. Separating them lets
//! the constructor read as a constructor and the cache read as a cache.
//!
//! **`migrations.rs` was 972 lines against a 1000-line house rule.** Extracting
//! the cache took it to 867, which also brought `verify-core-size` back under its
//! ceiling instead of raising the ceiling for a feature that had a home available.
//!
//! # The measured numbers this exists for
//!
//! Measured 2026-10-23 on kasirmu-core (82 migrations):
//!
//! ```text
//! run the 82 migrations        440.66 ms   <- what every process paid
//! clone an existing snapshot     1.05 ms   <- 420x cheaper
//! ```
//!
//! `cargo test` runs one process per test BINARY, so it pays the chain once and
//! clones for the rest. nextest forks a process per TEST, so without this cache it
//! paid the chain per test: 294.89 s for the full suite against 65.10 s under
//! `cargo test --test-threads=4`. With the cache, nextest is 48.52 s.

/// The snapshot cache file for the CURRENT migration set.
///
/// Named by fingerprint, so a build whose migrations changed gets a different
/// file rather than reusing a schema from before the change. Two builds sharing
/// one checkout therefore never read each other's snapshot.
use super::ALL;
pub(crate) fn snapshot_cache_path() -> std::path::PathBuf {
    scratch_root().join(format!(
        "kasirmu-core-migrated-snapshot-{:016x}.sqlite",
        migration_fingerprint(),
    ))
}

pub(crate) fn scratch_root() -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest
        .ancestors()
        .find(|p| p.join("Cargo.lock").is_file() && p.join("target").is_dir())
        .unwrap_or(manifest)
        .join("target")
        .join("test-scratch");
    let _ = std::fs::create_dir_all(&root);
    root
}

/// A fingerprint of the embedded migration set, used as the disk-cache key.
///
/// Every migration is a compile-time constant, so this is stable across runs
/// on the same build. It covers ids AND sql lengths: a migration whose SQL
/// changes without its id changing would otherwise reuse a stale snapshot --
/// the classic cache-key bug, and this crate is exactly where that would be
/// expensive to debug.
pub(crate) fn migration_fingerprint() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    ALL.len().hash(&mut h);
    for mig in ALL {
        mig.id.hash(&mut h);
        mig.sql.len().hash(&mut h);
    }
    h.finish()
}

/// Build the in-memory snapshot connection.
///
/// Split out of fresh_db so the disk-cache path can call it when the cache
/// is cold.
pub(crate) fn build_snapshot_conn() -> rusqlite::Connection {
    use std::sync::LazyLock;

    fn cached_sql() -> &'static str {
        static SQL: LazyLock<String> = LazyLock::new(|| {
            let mut buf = String::with_capacity(48_000);
            buf.push_str("PRAGMA foreign_keys = ON;\n");
            buf.push_str(
                "CREATE TABLE IF NOT EXISTS schema_migrations (\n\
                 id         TEXT PRIMARY KEY,\n\
                 applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n\
                 checksum   TEXT\n\
                 );\n",
            );
            for mig in ALL {
                buf.push_str("BEGIN;\n");
                buf.push_str(mig.sql);
                buf.push('\n');
                buf.push_str("INSERT INTO schema_migrations (id) VALUES ('");
                buf.push_str(mig.id);
                buf.push_str("');\nCOMMIT;\n");
            }
            buf
        });
        &SQL
    }

    // INVARIANT: an in-memory database allocates a private pager and touches no file,
    // so it cannot fail for an environmental reason. See the twin note in
    // `migrations.rs::fresh_db`.
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    // INVARIANT: `cached_sql()` is the embedded migration set compiled into the binary,
    // and `frozen_migration_sql_replays_cleanly` executes the same text on every run. If
    // this batch ever failed, that test would fail first and name the migration.
    conn.execute_batch(cached_sql()).unwrap();
    conn
}

pub(crate) fn write_snapshot_file(target: &std::path::Path) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WRITING: AtomicBool = AtomicBool::new(false);
    // Only one thread writes; the others continue with the in-memory copy. A
    // second writer would just reproduce the same bytes, so skipping it is free.
    if WRITING.swap(true, Ordering::SeqCst) {
        return;
    }
    let staging = target.with_extension("staging");
    {
        let src = build_snapshot_conn();
        // INVARIANT: `staging` sits beside `target` inside the gitignored
        // `target/test-scratch`, which `scratch_root()` creates before returning. Both
        // the directory and its writability are established by that call, so a failure
        // here means the checkout's build directory was removed mid-run.
        let mut file = rusqlite::Connection::open(&staging)
            .expect("staging snapshot file must be creatable in the scratch root");
        let backup = rusqlite::backup::Backup::new(&src, &mut file)
            .expect("backup into the staging file cannot fail");
        backup
            .run_to_completion(100, std::time::Duration::from_millis(0), None)
            .expect("page copy into the staging file cannot fail");
    }
    if std::fs::rename(&staging, target).is_err() {
        // Another process won the race, or the file is locked. Either way the
        // in-memory path is correct; just do not leave the staging file behind.
        let _ = std::fs::remove_file(&staging);
    }
}
