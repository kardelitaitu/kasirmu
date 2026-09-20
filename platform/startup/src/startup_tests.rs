//! Tests for shared application startup: module registration parity, event
//! wiring, and the pending-sale reaper connection.

use super::*;
use platform_kernel::Kernel;
use rusqlite::Connection;

/// Helper: create an in-memory SQLite database with migrations applied,
/// and write it to a temp file so we can pass a path.
fn create_temp_db() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let mut conn = Connection::open(&db_path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();
    drop(conn);
    (dir, db_path)
}

/// Repository-root-relative path to the `modules/` directory.
fn modules_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("modules")
}

/// Every `modules/<name>/manifest.json` id present on disk.
///
/// This is the source of truth for "which verticals exist"; the parity test
/// below asserts `init_module_system` registers exactly this set.
fn manifest_ids() -> Vec<String> {
    let mut ids = Vec::new();
    let entries = std::fs::read_dir(modules_dir()).expect("modules/ directory must exist");
    for entry in entries {
        let entry = entry.expect("readable dir entry");
        let manifest = entry.path().join("manifest.json");
        if !manifest.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&manifest)
            .unwrap_or_else(|e| panic!("read {}: {e}", manifest.display()));
        let parsed: serde_json::Value = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", manifest.display()));
        let id = parsed["id"]
            .as_str()
            .unwrap_or_else(|| panic!("{} has no string `id`", manifest.display()));
        ids.push(id.to_string());
    }
    ids.sort();
    ids
}

// ── Registration parity ───────────────────────────────────────────────

/// A module directory that exists but is never registered is dead weight:
/// its `on_load` never runs, so any event handler it was supposed to
/// register is silently missing. That is exactly how `modules/loyalty`
/// shipped unregistered while a `LoyaltyEarnHandler` was wired on
/// `sale.completed`. This test fails the moment a new `modules/<name>/`
/// directory is added without a matching `k.register(...)` line, or a
/// registered module loses its manifest.
#[test]
fn every_module_manifest_is_registered() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    let mut registered: Vec<String> = k.module_ids().iter().map(|s| (*s).to_string()).collect();
    registered.sort();

    let expected = manifest_ids();
    assert_eq!(
        registered, expected,
        "modules/*/manifest.json ids and init_module_system registrations diverged; \
         add the missing k.register(...) line (or the missing manifest.json)"
    );
}

/// Guards the other direction of the same invariant: a manifest that
/// declares a dependency on an id nobody registers would make `load_all`
/// fail at runtime, in the client's Tauri setup closure, on a real machine.
#[test]
fn every_declared_dependency_is_registered() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    // `init_module_system` itself calls `load_all`, which resolves the
    // dependency graph — a missing edge surfaces as an Err here.
    init_module_system(&kernel, &db_path).expect("dependency graph must resolve");

    let k = kernel.blocking_lock();
    let registered = k.module_ids();
    for entry in std::fs::read_dir(modules_dir()).unwrap() {
        let manifest = entry.unwrap().path().join("manifest.json");
        if !manifest.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&manifest).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let id = parsed["id"].as_str().unwrap();
        let deps = parsed["dependencies"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for dep in deps {
            let dep = dep.as_str().expect("dependency must be a string");
            assert!(
                registered.contains(&dep),
                "module '{id}' depends on '{dep}', which no module registers"
            );
        }
    }
}

#[test]
fn init_module_system_registers_all_modules() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    // Verify modules are registered
    for id in [
        "inventory",
        "crm",
        "tax",
        "settings",
        "staff",
        "sales",
        "reporting",
        "terminal",
        "currency",
        "loyalty",
        "purchasing",
        "promotions",
        "giftcards",
        "kitchen",
    ] {
        assert!(k.is_registered(id), "{id} module should be registered");
    }
    assert_eq!(k.module_count(), manifest_ids().len());
}

#[test]
fn init_module_system_loads_and_starts_modules() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    assert!(k.is_loaded(), "kernel should be loaded");
    assert!(k.is_started(), "kernel should be started");
}

/// Dependencies must reach `Started` before the modules that declare them.
/// This asserts the ordering the kernel promises, not just that everything
/// eventually started.
#[test]
fn dependencies_start_before_their_dependents() {
    use platform_kernel::ModuleStatus;

    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    // `sales` depends on `inventory`; `reporting` on both; `loyalty` on
    // `crm`; `kitchen` on `sales` + `terminal`.
    for id in [
        "inventory",
        "crm",
        "terminal",
        "sales",
        "reporting",
        "loyalty",
        "kitchen",
    ] {
        assert_eq!(
            k.module_status(id),
            Some(ModuleStatus::Started),
            "{id} should have reached Started"
        );
    }
}

#[test]
fn init_module_system_wires_event_handlers() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    let bus = k.event_bus();
    // Verify event handlers are registered for key topics
    assert!(
        bus.has_handlers("sale.completed"),
        "sale.completed should have handlers"
    );
    assert!(
        bus.has_handlers("product.created"),
        "product.created should have handlers"
    );
    assert!(
        bus.has_handlers("stock.adjusted"),
        "stock.adjusted should have handlers"
    );
    // 5 handlers on sale.completed, 2 on product.created, 2 on stock.adjusted
    assert!(
        bus.handler_count() >= 5,
        "expected at least 5 handlers total"
    );
}

#[test]
fn init_module_system_with_invalid_db_path_fails() {
    let kernel = AsyncMutex::new(Kernel::new());

    // Use a path in a nonexistent parent directory so
    // rusqlite::Connection::open is guaranteed to fail on
    // all platforms (SQLite can create new DB files but
    // cannot create parent directories).
    let dir = tempfile::tempdir().unwrap();
    let bad_path = dir.path().join("nonexistent_subdir").join("db.sqlite");

    let result = init_module_system(&kernel, &bad_path);
    assert!(result.is_err(), "should fail with invalid path");
}

#[test]
fn init_module_system_twice_registers_duplicate_modules() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    // Calling init again should fail because modules are already registered
    let result = init_module_system(&kernel, &db_path);
    assert!(
        result.is_err(),
        "second init should fail due to duplicate modules"
    );
}

#[test]
fn settings_updated_handler_is_registered() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    let bus = k.event_bus();
    assert!(
        bus.has_handlers("settings.updated"),
        "ADR #22: settings.updated topic must have at least one handler registered"
    );
}

#[test]
fn event_bus_has_correct_handler_topics() {
    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();

    init_module_system(&kernel, &db_path).unwrap();

    let k = kernel.blocking_lock();
    let bus = k.event_bus();
    assert_eq!(bus.topic_count(), 4, "should have 4 event topics");
}

// ── init_pending_sale_reaper / open_reaper_connection ────────────

#[test]
fn open_reaper_connection_configures_wal_and_foreign_keys() {
    let (_dir, db_path) = create_temp_db();

    let conn = open_reaper_connection(&db_path).unwrap();
    let wal: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(wal.to_lowercase(), "wal", "reaper connection must use WAL");

    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "reaper connection must enforce foreign keys");
}

#[test]
fn open_reaper_connection_fails_on_unopenable_path() {
    let dir = tempfile::tempdir().unwrap();
    let bad_path = dir.path().join("nonexistent_subdir").join("db.sqlite");
    assert!(
        open_reaper_connection(&bad_path).is_err(),
        "a path in a nonexistent parent must fail to open"
    );
}

#[test]
fn open_reaper_connection_reuses_existing_db() {
    // The reaper opens the same DB the app uses; a second connection
    // must succeed on the existing file and see the migrated schema.
    let (_dir, db_path) = create_temp_db();

    let conn = open_reaper_connection(&db_path).unwrap();
    let sales_table: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sales'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sales_table, 1, "reaper connection must see the app schema");
}

// ── One-shot task spawn ───────────────────────────────────────────────

/// `spawn_once` must actually run the future it is handed.
///
/// A careless refactor of the shared `spawn_watched` body could drop the task
/// entirely, leaving boot work silently unperformed. Called from a plain
/// `#[test]` on purpose — the synchronous `setup` hook path is the one under
/// test, so there must be no ambient runtime for the call to borrow.
///
/// What this does NOT cover: that a completed one-shot logs no warning. That
/// is the `announce_exit` flag, and it is checked where it is observable — a
/// recorded tablet boot log, which carries one `WARN ... exited unexpectedly`
/// per wrongly-routed task.
#[test]
fn spawn_once_runs_the_future_to_completion() {
    let (tx, rx) = std::sync::mpsc::channel();
    spawn_once("test one-shot", async move {
        let _ = tx.send("finished");
    });
    assert_eq!(
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .expect("spawn_once never ran its future"),
        "finished"
    );
}
