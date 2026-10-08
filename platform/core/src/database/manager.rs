//! Store-scoped database manager (ADR #4 Phase 2).
/*
last audited 25-07-26 by RSA-Agent (platform-core slice E: database manager deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean — cache-guard-held check-then-insert (TOCTOU-safe, documented), idempotent migration recovery on open (partial-failure tested), FK/WAL pragmas, per-store isolation tests; PC-1 INFO: store_db_path interpolates store_id into the filename without sanitization (data_dir.join(format!()) line 161) — snapshot-imported ids could path-traverse file creation; ids are UUID-minted in normal flows
next: none — PC-1 closed 2026-09-28: the id is validated at the join (is_safe_store_id / checked_store_db_path), and the open, exists and delete doors all go through it | perf: cached Arc connections
*/
//!
//! Manages per-store SQLite database files alongside the global
//! database. Each store gets its own `store-<id>.sqlite` file with
//! all migrations applied. Databases are created lazily — the file
//! is only created when a store is added.
//!
//! The global database (containing store_profiles, terminals, users,
//! etc.) is maintained separately via `AppState.db`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::database::migrations::Migration;
use crate::error::PlatformError;

/// Manages per-store SQLite databases.
///
/// # Lifecycle
///
/// 1. On startup, the manager is created with the data directory
///    and migration definitions.
/// 2. The global DB (existing `kasir.db`) contains store_profiles,
///    terminals, users, and other cross-store data — it is accessed
///    via `AppState.db`, not through this manager.
/// 3. When a second store is created via `create_store_profile`, the
///    manager creates a new `store-<id>.sqlite` file and runs all
///    migrations against it.
/// 4. When a command needs data from a specific store, it calls
///    `open_store(store_id)` to get the connection.
#[derive(Clone)]
pub struct StoreDatabaseManager {
    /// Path to the data directory containing all SQLite files.
    data_dir: PathBuf,
    /// Lazily-opened per-store databases, keyed by store_id.
    store_dbs: Arc<Mutex<HashMap<String, Arc<Mutex<Connection>>>>>,
    /// Migration definitions applied to every new store database.
    migrations: &'static [Migration],
}

impl StoreDatabaseManager {
    /// Create a new manager.
    ///
    /// `data_dir` is the directory where `store-<id>.sqlite` files
    /// are stored. `migrations` is the list of migrations applied
    /// to every new store database.
    pub fn new(data_dir: PathBuf, migrations: &'static [Migration]) -> Self {
        Self {
            data_dir,
            store_dbs: Arc::new(Mutex::new(HashMap::new())),
            migrations,
        }
    }

    /// Get or create a connection to a store's database.
    ///
    /// Returns an `Arc<Mutex<Connection>>` that can be locked by the
    /// caller. The `Arc` is kept alive by the manager's cache — callers
    /// should lock, use, and drop the guard promptly.
    ///
    /// If the file doesn't exist, creates it with all migrations applied.
    /// Migrations are always run on open to recover from partial failures.
    /// The Mutex guard is held for the entire check-then-insert span, preventing TOCTOU races.
    pub fn open_store(&self, store_id: &str) -> Result<Arc<Mutex<Connection>>, PlatformError> {
        let mut store_dbs = self
            .store_dbs
            .lock()
            .map_err(|e| PlatformError::Internal(format!("store db lock poisoned: {e}")))?;
        if let Some(conn_arc) = store_dbs.get(store_id) {
            return Ok(conn_arc.clone());
        }
        let conn = self.open_or_create_connection(store_id).map_err(|e| {
            tracing::error!(store_id, error = %e, "failed to open store database");
            e
        })?;
        let conn_arc = Arc::new(Mutex::new(conn));
        store_dbs.insert(store_id.to_owned(), conn_arc.clone());
        Ok(conn_arc)
    }

    /// Open or create a store database connection, running all migrations.
    ///
    /// Migrations are always run on open — this recovers from
    /// partially-failed previous creations (the runner is idempotent).
    fn open_or_create_connection(&self, store_id: &str) -> Result<Connection, PlatformError> {
        // PC-1: this is the door that CREATES a file at the joined path, so the id is checked
        // here and not only in `delete_store_db`, where it used to be the whole guard.
        let path = self.checked_store_db_path(store_id)?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PlatformError::Internal(format!("creating data dir {parent:?}: {e}"))
            })?;
        }

        let is_new = !path.exists();
        let mut conn = Connection::open(&path)
            .map_err(|e| PlatformError::Internal(format!("opening store db {path:?}: {e}")))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| PlatformError::Internal(format!("enabling FK on {path:?}: {e}")))?;
        // Bound page cache to 8 MiB (negative value = KiB) to prevent runaway cache memory on 3GB/4GB devices
        let _ = conn.pragma_update(None, "cache_size", "-8000");
        // Bound prepared statement cache capacity (Phase 3 optimization)
        conn.set_prepared_statement_cache_capacity(64);

        if is_new {
            conn.pragma_update(None, "journal_mode", "WAL")
                .map_err(|e| PlatformError::Internal(format!("enabling WAL on {path:?}: {e}")))?;
            tracing::info!(store_id, path = %path.display(), "creating store database");
        }

        // Always run migrations — idempotent, and recovers from partial failures.
        crate::database::migrations::run(&mut conn, self.migrations)?;

        if is_new {
            tracing::info!(store_id, path = %path.display(), "store database created and migrated");
        }
        Ok(conn)
    }

    /// Create a new store database eagerly (called on store profile creation).
    ///
    /// Creates the file, sets pragmas, and runs all migrations.
    /// Idempotent — safe to call multiple times.
    pub fn create_store_db(&self, store_id: &str) -> Result<(), PlatformError> {
        let _conn = self.open_or_create_connection(store_id)?;
        Ok(())
    }

    /// Close a store's database connection.
    ///
    /// The connection is removed from the cache. If any code still
    /// holds an `Arc<Mutex<Connection>>` from a prior `open_store`,
    /// the connection file remains open until those Arcs are dropped.
    pub fn close_store(&self, store_id: &str) {
        let mut store_dbs = match self.store_dbs.lock() {
            Ok(dbs) => dbs,
            Err(poison) => {
                tracing::error!(store_id, error = %poison, "store_dbs mutex poisoned during close_store");
                return;
            }
        };
        if store_dbs.remove(store_id).is_some() {
            tracing::debug!(store_id, "store database closed");
        }
    }

    /// Close all store database connections.
    pub fn close_all(&self) {
        let mut store_dbs = match self.store_dbs.lock() {
            Ok(dbs) => dbs,
            Err(poison) => {
                tracing::error!(error = %poison, "store_dbs mutex poisoned during close_all");
                return;
            }
        };
        let count = store_dbs.len();
        store_dbs.clear();
        tracing::info!(count, "all store databases closed");
    }

    /// Is this store id safe to interpolate into a database filename?
    ///
    /// PC-1: `store-<id>.sqlite` puts the id straight into a path. The predicate used to live
    /// inline in [`Self::delete_store_db`], which was the only door that checked — the open path
    /// and `store_db_exists` reached the same join unguarded. One definition, at the join, so a
    /// new door cannot be added without it.
    #[must_use]
    pub fn is_safe_store_id(store_id: &str) -> bool {
        !store_id.is_empty()
            && store_id.len() <= 128
            && !store_id.contains("..")
            && store_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    }

    /// Get the filesystem path for a store's database file.
    ///
    /// The raw join, kept for tests and for callers that have already validated. Everything that
    /// touches the filesystem goes through [`Self::checked_store_db_path`] instead.
    pub fn store_db_path(&self, store_id: &str) -> PathBuf {
        self.data_dir.join(format!("store-{store_id}.sqlite"))
    }

    /// The path for a store, or an error naming an id that cannot be one.
    pub fn checked_store_db_path(&self, store_id: &str) -> Result<PathBuf, PlatformError> {
        if !Self::is_safe_store_id(store_id) {
            return Err(PlatformError::Internal(format!(
                "refused store id {store_id:?}: a store id is 1..=128 characters of alphanumeric, \
                 '-', '_' or '.', and never contains '..', because it names a file inside the \
                 data directory"
            )));
        }
        Ok(self.store_db_path(store_id))
    }

    /// Check if a store's database file exists on disk.
    ///
    /// An id that cannot name a store names no file, so `false` is the honest answer — and it
    /// keeps the callers that use this as a guard from being where a bad id surfaces.
    pub fn store_db_exists(&self, store_id: &str) -> bool {
        self.checked_store_db_path(store_id)
            .is_ok_and(|path| path.exists())
    }

    /// Delete a store's database file and its WAL/SHM sidecars.
    ///
    /// Closes the cached connection first — on Windows an open file cannot be
    /// deleted, and this manager holds the only handle. A file that is already
    /// absent is not an error: the caller asked for an absent state.
    ///
    /// Deleting a profile used to remove only its `store_profiles` row, so every
    /// removed store left a multi-megabyte database behind in the data directory
    /// with nothing pointing at it.
    ///
    /// `store_id` is validated here rather than trusted. This module's audit stamp
    /// records PC-1: the id is interpolated straight into a filename. Creating a
    /// file at a traversed path is bad; *deleting* one would be strictly worse, so
    /// an unsafe id is refused before any filesystem call. Policy — which stores
    /// may be deleted at all — stays with the caller.
    pub fn delete_store_db(&self, store_id: &str) -> Result<(), PlatformError> {
        // The predicate moved to `is_safe_store_id`; this door keeps its own wording because
        // "refused to delete" is the sentence an operator needs when a delete does not happen.
        if !Self::is_safe_store_id(store_id) {
            return Err(PlatformError::Internal(format!(
                "refused to delete store database: unsafe store id {store_id:?}"
            )));
        }

        self.close_store(store_id);

        let base = self.store_db_path(store_id);
        let mut failure = None;
        for suffix in ["", "-wal", "-shm"] {
            let path = PathBuf::from(format!("{}{}", base.display(), suffix));
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => failure = Some((path, e)),
            }
        }
        if let Some((path, e)) = failure {
            return Err(PlatformError::Internal(format!(
                "failed to delete {store_id} database at {}: {e}",
                path.display()
            )));
        }
        tracing::info!(store_id, "store database deleted");
        Ok(())
    }

    /// List IDs of currently open store databases.
    pub fn open_store_ids(&self) -> Vec<String> {
        let store_dbs = match self.store_dbs.lock() {
            Ok(dbs) => dbs,
            Err(_) => return Vec::new(),
        };
        store_dbs.keys().cloned().collect()
    }
}

// Unit tests live in a sibling file per AGENTS.md ("never put unit tests
// inside production .rs files"). Both the lifecycle tests that used to sit
// in an inline `mod tests` block here and the delete-path tests live there.
#[cfg(test)]
#[path = "manager_tests.rs"]
mod manager_tests;
