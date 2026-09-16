//! Store-scoped database manager (ADR #4 Phase 2).
/*
last audited 25-07-26 by RSA-Agent (platform-core slice E: database manager deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean — cache-guard-held check-then-insert (TOCTOU-safe, documented), idempotent migration recovery on open (partial-failure tested), FK/WAL pragmas, per-store isolation tests; PC-1 INFO: store_db_path interpolates store_id into the filename without sanitization (data_dir.join(format!()) line 161) — snapshot-imported ids could path-traverse file creation; ids are UUID-minted in normal flows
next: sanitize/validate store ids before path join (PC-1) | perf: cached Arc connections
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
        let path = self.store_db_path(store_id);

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PlatformError::Internal(format!("creating data dir {:?}: {e}", parent))
            })?;
        }

        let is_new = !path.exists();
        let mut conn = Connection::open(&path)
            .map_err(|e| PlatformError::Internal(format!("opening store db {:?}: {e}", path)))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| PlatformError::Internal(format!("enabling FK on {:?}: {e}", path)))?;

        if is_new {
            conn.pragma_update(None, "journal_mode", "WAL")
                .map_err(|e| PlatformError::Internal(format!("enabling WAL on {:?}: {e}", path)))?;
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

    /// Get the filesystem path for a store's database file.
    pub fn store_db_path(&self, store_id: &str) -> PathBuf {
        self.data_dir.join(format!("store-{store_id}.sqlite"))
    }

    /// Check if a store's database file exists on disk.
    pub fn store_db_exists(&self, store_id: &str) -> bool {
        self.store_db_path(store_id).exists()
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
        let safe_id = !store_id.is_empty()
            && store_id.len() <= 128
            && !store_id.contains("..")
            && store_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if !safe_id {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_migrations() -> &'static [Migration] {
        Box::leak(Box::new(vec![Migration {
            id: "001_test.sql",
            sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
        }]))
    }

    fn setup() -> (StoreDatabaseManager, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_path_buf();

        let manager = StoreDatabaseManager::new(data_dir, make_migrations());
        (manager, dir)
    }

    #[test]
    fn create_store_db_creates_file() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-1").unwrap();
        assert!(manager.store_db_exists("store-1"));
    }

    #[test]
    fn create_store_db_idempotent() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-1").unwrap();
        manager.create_store_db("store-1").unwrap();
    }

    #[test]
    fn open_store_creates_db_lazily() {
        let (manager, _dir) = setup();
        assert!(!manager.store_db_exists("store-2"));
        {
            let arc = manager.open_store("store-2").unwrap();
            let conn = arc.lock().unwrap();
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1);
        }
        assert!(manager.store_db_exists("store-2"));
    }

    #[test]
    fn open_store_returns_cached_connection() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-1").unwrap();

        let arc1 = manager.open_store("store-1").unwrap();
        let arc2 = manager.open_store("store-1").unwrap();
        assert!(Arc::ptr_eq(&arc1, &arc2));

        let ids = manager.open_store_ids();
        assert_eq!(ids.len(), 1);
        assert!(ids.contains(&"store-1".to_string()));
    }

    #[test]
    fn close_store_removes_from_cache() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-1").unwrap();
        {
            let _arc = manager.open_store("store-1").unwrap();
        }
        assert_eq!(manager.open_store_ids().len(), 1);
        manager.close_store("store-1");
        assert_eq!(manager.open_store_ids().len(), 0);
    }

    #[test]
    fn close_all_clears_cache() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-a").unwrap();
        manager.create_store_db("store-b").unwrap();
        {
            let _a = manager.open_store("store-a").unwrap();
            let _b = manager.open_store("store-b").unwrap();
        }
        assert_eq!(manager.open_store_ids().len(), 2);
        manager.close_all();
        assert_eq!(manager.open_store_ids().len(), 0);
    }

    #[test]
    fn store_db_path_uses_correct_naming() {
        let (manager, _dir) = setup();
        let path = manager.store_db_path("downtown");
        assert!(path.to_str().unwrap().contains("store-downtown.sqlite"));
    }

    #[test]
    fn store_db_exists_initially_false() {
        let (manager, _dir) = setup();
        assert!(!manager.store_db_exists("nonexistent"));
    }

    #[test]
    fn data_is_isolated_between_stores() {
        let (manager, _dir) = setup();
        manager.create_store_db("store-a").unwrap();
        manager.create_store_db("store-b").unwrap();

        {
            let arc = manager.open_store("store-a").unwrap();
            let conn = arc.lock().unwrap();
            conn.execute("INSERT INTO test_table (id, name) VALUES (1, 'Apple')", [])
                .unwrap();
        }
        {
            let arc = manager.open_store("store-b").unwrap();
            let conn = arc.lock().unwrap();
            conn.execute("INSERT INTO test_table (id, name) VALUES (1, 'Banana')", [])
                .unwrap();
        }
        {
            let arc = manager.open_store("store-a").unwrap();
            let conn = arc.lock().unwrap();
            let name: String = conn
                .query_row("SELECT name FROM test_table WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(name, "Apple");
        }
        {
            let arc = manager.open_store("store-b").unwrap();
            let conn = arc.lock().unwrap();
            let name: String = conn
                .query_row("SELECT name FROM test_table WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(name, "Banana");
        }
    }

    #[test]
    fn migrations_recover_from_partial_failure() {
        let (manager, _dir) = setup();
        let path = manager.store_db_path("store-recover");

        // Simulate a partially-created DB file (exists but has no tables).
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        // Don't run migrations — simulate a crash during creation.
        drop(conn);

        assert!(path.exists());

        // Now open_store should detect the file, run migrations, and succeed.
        let arc = manager.open_store("store-recover").unwrap();
        let conn = arc.lock().unwrap();
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='test_table'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1);
    }

    #[test]
    fn open_store_propagates_error_not_silent_in_memory_fallback() {
        // Bug #1: open_store caught errors in or_insert_with and fell back
        // to an in-memory connection, silently losing all data. After the fix,
        // errors from open_or_create_connection must propagate to the caller.
        //
        // Trigger the error by using a regular file as the data_dir —
        // create_dir_all inside open_or_create_connection will fail because
        // the "directory" is actually a file.
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("blocker");
        std::fs::write(&file_path, b"block").unwrap();
        // Now file_path is a file, not a directory. When open_or_create_connection
        // calls create_dir_all on file_path.join("store-X.sqlite").parent(),
        // it'll fail because the parent exists as a file.
        let manager = StoreDatabaseManager::new(file_path, make_migrations());
        let result = manager.open_store("test-store");
        assert!(
            result.is_err(),
            "Bug #1: open_store must propagate errors, \
             not silently return an in-memory fallback"
        );
    }
}

// New tests live in a sibling file per AGENTS.md ("never put unit tests inside
// production .rs files"). The inline `mod tests` above predates that rule and is
// left alone rather than expanded.
#[cfg(test)]
#[path = "manager_tests.rs"]
mod manager_tests;
