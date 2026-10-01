//! Tests for [`StoreDatabaseManager`]: `delete_store_db` (ADR #45 §4.2 follow-up)
//! plus the management lifecycle (create / open / cache / close / migrations).
//!
//! Deleting a store profile removed its `store_profiles` row and nothing else,
//! leaving the per-store `store-<id>.sqlite` behind in the data directory. These
//! cover the removal itself, its idempotence, the WAL/SHM sidecars, and the
//! unsafe-id refusal that keeps a path-traversal id from becoming a delete primitive.
//!
//! The lifecycle tests were moved here from the inline `mod tests` block in
//! `manager.rs` (C28); the `make_migrations` and `setup` helpers they used are
//! byte-identical to the ones defined below, so nothing was duplicated.

use std::path::Path;
use std::sync::Arc;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::database::manager::StoreDatabaseManager;
use crate::database::migrations::Migration;

fn make_migrations() -> &'static [Migration] {
    Box::leak(Box::new(vec![Migration {
        id: "001_test.sql",
        sql: "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)",
    }]))
}

fn setup() -> (StoreDatabaseManager, TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let manager = StoreDatabaseManager::new(dir.path().to_path_buf(), make_migrations());
    (manager, dir)
}

/// Open a store so its file actually exists on disk, then release the handle.
fn create_store_db(manager: &StoreDatabaseManager, store_id: &str) -> std::path::PathBuf {
    let conn = manager
        .open_store(store_id)
        .expect("open_store should create the database");
    // Force the connection out of the cache so a later delete is not testing
    // "the file happened to be closed already".
    drop(conn);
    manager.close_store(store_id);
    manager.store_db_path(store_id)
}

#[test]
fn deleting_a_store_drops_its_database_file() {
    let (manager, _dir) = setup();
    let path = create_store_db(&manager, "store-alpha");
    assert!(path.exists(), "precondition: the file was created");

    manager.delete_store_db("store-alpha").unwrap();

    assert!(
        !path.exists(),
        "the database file must be gone once the store is deleted"
    );
}

#[test]
fn deleting_a_store_drops_its_wal_and_shm_sidecars() {
    // WAL mode leaves `<file>-wal` and `<file>-shm` beside the database. Removing
    // only the main file would still orphan them, which is the same leak with a
    // different suffix — and on Windows the sidecars are what stay locked longest.
    let (manager, _dir) = setup();
    let path = create_store_db(&manager, "store-sidecars");
    let wal_name = format!("{}-wal", path.display());
    let shm_name = format!("{}-shm", path.display());
    let wal = Path::new(&wal_name);
    let shm = Path::new(&shm_name);
    std::fs::write(wal, b"wal").unwrap();
    std::fs::write(shm, b"shm").unwrap();

    manager.delete_store_db("store-sidecars").unwrap();

    assert!(!path.exists());
    assert!(!wal.exists(), "the -wal sidecar must be removed too");
    assert!(!shm.exists(), "the -shm sidecar must be removed too");
}

#[test]
fn deleting_an_absent_store_is_not_an_error() {
    // The caller has already removed the row; asking for an absent file is
    // asking for a state that holds. Failing here would surface a spurious error
    // for a store that never had a database.
    let (manager, _dir) = setup();
    assert!(!manager.store_db_exists("store-never"));
    manager.delete_store_db("store-never").unwrap();
}

#[test]
fn deleting_a_store_leaves_other_stores_intact() {
    let (manager, _dir) = setup();
    let keep = create_store_db(&manager, "store-keep");
    let remove = create_store_db(&manager, "store-remove");

    manager.delete_store_db("store-remove").unwrap();

    assert!(keep.exists(), "an unrelated store database must survive");
    assert!(!remove.exists());
}

#[test]
fn a_deleted_store_can_be_recreated_cleanly() {
    // Guards the close-before-delete ordering: if the stale cached connection
    // survived, reopening would either fail or hand back a handle to an unlinked
    // file, and writes would silently go nowhere.
    let (manager, _dir) = setup();
    let path = create_store_db(&manager, "store-recreate");
    manager.delete_store_db("store-recreate").unwrap();
    assert!(!path.exists());

    let again = manager.open_store("store-recreate").unwrap();
    drop(again);
    assert!(
        path.exists(),
        "reopening after a delete must create a fresh file"
    );
}

#[test]
fn unsafe_store_ids_are_refused_before_any_filesystem_call() {
    // PC-1: `store_db_path` interpolates the id straight into a filename. That is
    // a file-creation primitive today; this method would have made it a
    // file-DELETION primitive, so an unsafe id must be rejected outright.
    let (manager, dir) = setup();

    // Plant a file outside the intended name so a traversal attempt has something
    // it could destroy if the guard were missing.
    let victim = dir.path().join("innocent.sqlite");
    std::fs::write(&victim, b"must survive").unwrap();

    let too_long = format!("s{}", "a".repeat(200));
    for bad in [
        "",
        "../innocent",
        "..\\..\\innocent",
        "a/b",
        "a\\b",
        "..",
        "x/../../y",
        too_long.as_str(),
    ] {
        let result = manager.delete_store_db(bad);
        assert!(
            result.is_err(),
            "store id {bad:?} must be refused, not resolved to a path"
        );
    }

    assert!(
        victim.exists(),
        "no refused id may have reached the filesystem at all"
    );
}

#[test]
fn an_open_connection_does_not_block_the_delete() {
    // The real failure mode on Windows: the manager holds an Arc<Mutex<Connection>>
    // and an open handle makes remove_file fail with a sharing violation. The
    // method closes the store first, so a still-cached handle must not leak an
    // error to the caller.
    let (manager, _dir) = setup();
    let conn = manager.open_store("store-open").unwrap();
    let path = manager.store_db_path("store-open");
    drop(conn); // release OUR handle; the manager still holds its cached one
    assert!(path.exists());
    assert!(
        manager.open_store_ids().contains(&"store-open".to_string()),
        "precondition: the store is cached as open, so the delete must evict it"
    );

    manager.delete_store_db("store-open").unwrap();

    assert!(
        !path.exists(),
        "the cached connection must be released before the file is removed"
    );
    assert!(
        manager.open_store_ids().is_empty(),
        "the store must no longer be cached as open"
    );
}

// ── Management-lifecycle tests ───────────────────────────────────────
//
// Moved here from the inline `mod tests` block in `manager.rs` (C28).
// The `make_migrations` and `setup` helpers they used are defined above and
// are byte-identical to the ones that block carried, so nothing was duplicated.
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

/// PC-1, the OPEN door: an id that would escape the data directory is refused before a file is
/// created, not merely before one is deleted.
///
/// The delete door carried this check first and alone, so the same id could still create a file
/// through `open_store`. Note the shape that actually escapes: the `store-` prefix absorbs a bare
/// `..`, so the dangerous ids are the ones with a separator followed by enough `..` to climb back
/// out — `x/../../escaped` lands in the data directory's PARENT, which is what this asserts is
/// never created.
#[test]
fn open_refuses_a_store_id_that_would_escape_the_data_dir() {
    let (manager, dir) = setup();
    for bad in [
        "",
        "..",
        "../escaped",
        "a/b",
        "x/../../escaped",
        "a\\\\b",
        "way..too..many",
    ] {
        assert!(
            manager.open_store(bad).is_err(),
            "open_store accepted the unsafe id {bad:?}"
        );
        assert!(
            manager.checked_store_db_path(bad).is_err(),
            "checked_store_db_path accepted {bad:?}"
        );
        assert!(
            !manager.store_db_exists(bad),
            "store_db_exists claimed {bad:?} exists"
        );
    }

    let escaped = dir.path().parent().unwrap().join("escaped.sqlite");
    assert!(!escaped.exists(), "a traversed id created {escaped:?}");
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "a refused id still left a file in the data directory"
    );

    // The guard is not a wall in front of every id: the ordinary shape passes.
    assert!(StoreDatabaseManager::is_safe_store_id("store-alpha"));
    assert!(manager.checked_store_db_path("store-alpha").is_ok());
}
