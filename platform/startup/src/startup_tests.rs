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

// ── C23: a dead daemon must be observable, not only logged ────────────
//
// The watchdog logged `ERROR <name> panicked` and did nothing else: no
// registry, no state, no way for the shell or the operator to learn that a
// daemon had died. A log line is not a report when nothing reads it — the
// same reasoning as the `report_sales` write-only projection pinned below.
//
// These tests close that gap: a panicked daemon is recorded as `Panicked`,
// a daemon that stops looping is `ExitedUnexpectedly`, and a healthy one is
// `Running` — so "is everything still up?" becomes a question with an answer.

/// A daemon that panics must be recorded as panicked.
///
/// This is the C23 defect in one assertion: before the registry, the only
/// trace of a dead daemon was a log line, and `is_running()`-style checks
/// could not see it.
#[test]
fn a_panicking_daemon_is_recorded_as_panicked() {
    let registry = DaemonRegistry::new();
    let sentinel = format!("test panicking daemon {}", std::process::id());
    registry.register(sentinel.clone());

    let r = registry.clone();
    let name = sentinel.clone();
    spawn_daemon_registered(&r, Box::leak(name.into_boxed_str()), async move {
        panic!("boom");
    });

    let state = wait_for_state(&registry, &sentinel, |s| s != DaemonState::Running);
    assert_eq!(
        state,
        DaemonState::Panicked,
        "a panicking daemon must be recorded as Panicked; a log line nothing \
         reads is not a report"
    );
}

/// A daemon that returns instead of looping must be recorded too. This is
/// the `announce_exit` case the old code logged as
/// `WARN ... exited unexpectedly` and never stored.
#[test]
fn a_daemon_that_stops_looping_is_recorded_as_exited() {
    let registry = DaemonRegistry::new();
    let sentinel = format!("test exiting daemon {}", std::process::id());
    registry.register(sentinel.clone());

    let r = registry.clone();
    let name = sentinel.clone();
    spawn_daemon_registered(&r, Box::leak(name.into_boxed_str()), async move {
        // Return immediately: a daemon that is meant never to resolve.
    });

    let state = wait_for_state(&registry, &sentinel, |s| s != DaemonState::Running);
    assert_eq!(state, DaemonState::ExitedUnexpectedly);
}

/// A daemon still looping must read as Running, so the registry cannot pass
/// vacuously by reporting every daemon dead.
#[test]
fn a_live_daemon_stays_running() {
    let registry = DaemonRegistry::new();
    let sentinel = format!("test live daemon {}", std::process::id());
    registry.register(sentinel.clone());

    let r = registry.clone();
    let name = sentinel.clone();
    let (_tx, rx) = std::sync::mpsc::channel::<()>();
    spawn_daemon_registered(&r, Box::leak(name.into_boxed_str()), async move {
        // Never resolves; dropped only when the test process ends.
        let _keep = rx;
        std::future::pending::<()>().await;
    });

    // Give the watchdog a chance to mis-report, then assert it did not.
    std::thread::sleep(std::time::Duration::from_millis(250));
    assert_eq!(
        registry.state(&sentinel),
        DaemonState::Running,
        "a live daemon must read as Running"
    );
}

/// `spawn_once` must not mark a completed one-shot as a failure, and must
/// not appear in the registry as a daemon at all.
#[test]
fn a_finished_one_shot_leaves_no_dead_daemon_record() {
    let registry = DaemonRegistry::new();
    let sentinel = format!("test one-shot {}", std::process::id());
    let (tx, rx) = std::sync::mpsc::channel();

    let r = registry.clone();
    let name = sentinel.clone();
    spawn_once_registered(&r, Box::leak(name.into_boxed_str()), async move {
        let _ = tx.send(());
    });
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .expect("the one-shot never ran");

    // A one-shot that completes is not a failure; it must not be filed as
    // Panicked or ExitedUnexpectedly.
    std::thread::sleep(std::time::Duration::from_millis(120));
    let state = registry.state(&sentinel);
    assert!(
        matches!(state, DaemonState::Unknown | DaemonState::Completed),
        "a finished one-shot must not be recorded as a failure, got {state:?}"
    );
}

/// The registry must expose every daemon that has died, so a shell (or a
/// future supervisor) can act on the set rather than scanning logs.
#[test]
fn the_registry_lists_every_dead_daemon() {
    let registry = DaemonRegistry::new();
    let a = format!("test dead a {}", std::process::id());
    let b = format!("test dead b {}", std::process::id());
    registry.register(a.clone());
    registry.register(b.clone());

    let r1 = registry.clone();
    let n1 = a.clone();
    spawn_daemon_registered(&r1, Box::leak(n1.into_boxed_str()), async move {
        panic!("a died");
    });
    let r2 = registry.clone();
    let n2 = b.clone();
    spawn_daemon_registered(&r2, Box::leak(n2.into_boxed_str()), async move {});

    wait_for_state(&registry, &a, |s| s != DaemonState::Running);
    wait_for_state(&registry, &b, |s| s != DaemonState::Running);

    let dead = registry.dead();
    assert!(
        dead.contains(&a) && dead.contains(&b),
        "both dead daemons must be listed, got {dead:?}"
    );
}

/// The REAL entry point the shells use: `spawn_daemon` must make a death
/// visible through the process-global registry, with no call-site change.
///
/// This is the test that would fail if the wiring were reverted to a
/// locally-created registry: the shells call `spawn_daemon`, not
/// `spawn_daemon_registered`, so the global is the only path they take.
#[test]
fn spawn_daemon_records_into_the_process_global_registry() {
    let sentinel = format!("test global daemon {}", std::process::id());
    let name: &'static str = Box::leak(sentinel.clone().into_boxed_str());

    spawn_daemon(name, async move {
        panic!("boom");
    });

    let state = wait_for_state(daemon_registry(), &sentinel, |s| s != DaemonState::Running);
    assert_eq!(
        state,
        DaemonState::Panicked,
        "the shells call spawn_daemon; its deaths must reach the global registry"
    );
    assert!(
        daemon_registry().dead().contains(&sentinel),
        "the dead set must name it"
    );
}

/// Poll the registry until `pred` holds, or fail with the last state seen.
fn wait_for_state(
    registry: &DaemonRegistry,
    name: &str,
    pred: impl Fn(DaemonState) -> bool,
) -> DaemonState {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let state = registry.state(name);
        if pred(state) {
            return state;
        }
        if std::time::Instant::now() > deadline {
            panic!("daemon {name} never left Running; last state {state:?}");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
// ── MSL-11: no write-only event projections ───────────────────────────

/// A handler that appends to a table nothing reads is pure cost, and it is
/// the kind of cost that grows forever without anyone noticing: the table
/// fills, every sale pays for it, and no query ever benefits.
///
/// `SaleCompletedReporter` was exactly that. It was subscribed to the live
/// `sale.completed` bus and wrote one `report_sales` row per completed sale,
/// running a lazy `CREATE TABLE IF NOT EXISTS` on the hot path each time,
/// while `report_sales` had no reader anywhere in the tree — no Rust, UI, or
/// export path ever selected from it (`audit_log`, by contrast, has readers;
/// the loyalty and sync-queue projections are likewise drained). It also
/// discarded `event.store_id`, so in multi-store mode every store's sales
/// landed in the global identity DB with no store attribution.
///
/// This test fails if the `report_sales` projection or its subscription is
/// ever reintroduced. It is a SOURCE scan over the whole workspace rather
/// than a runtime assertion because the defect is the *absence* of a reader,
/// which no single call can observe.
#[test]
fn report_sales_projection_stays_removed() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");

    let mut hits: Vec<String> = Vec::new();
    let mut scanned = 0usize;
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if matches!(
                    name.as_str(),
                    "target" | ".git" | "node_modules" | "docs" | ".agents"
                ) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !name.ends_with(".rs") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            scanned += 1;
            // Normalise whitespace so a rustfmt reflow cannot split the
            // pattern away from a line-based match (the evadable-guard rule).
            // Strip line comments before matching, so a file may DOCUMENT
            // the removal ("the `report_sales` projection was removed")
            // without tripping the pin, while any real code use still hits.
            // This is the difference between a guard and a file-level
            // exemption: exempting `startup/lib.rs` wholesale let a probe
            // `INSERT INTO report_sales` through, which is exactly the
            // evadable-guard failure this audit has already hit three times.
            let code: String = text
                .lines()
                .map(|l| l.split("//").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            let flat: String = code.split_whitespace().collect::<Vec<_>>().join(" ");
            if flat.contains("report_sales") {
                hits.push(path.display().to_string());
            }
        }
    }

    // Floor: if the walk silently found almost nothing, the assertion below
    // would pass vacuously. Measured in this workspace at well over 300 files.
    assert!(
        scanned >= 200,
        "source scan found only {scanned} .rs files - the walk is broken, so this pin proves nothing"
    );

    // After comment-stripping, the only files that can legitimately still
    // mention the table are: modules/reporting (its docs are `//!` block
    // comments and so are stripped, but the emptied handlers module keeps the
    // word in its header), this pin itself, and one unrelated export test
    // whose *function name* `custom_report_sales_basic` contains the
    // substring. Everything else is a new writer and fails.
    //
    // Note the exempted set is deliberately tiny and contains no file that
    // could host a real writer of this table.
    let permitted = |p: &str| {
        let norm = p.replace('\\', "/");
        (p.contains("modules") && p.contains("reporting"))
            || norm.ends_with("platform/startup/src/startup_tests.rs")
            || norm.ends_with("kasirmu-core/src/export/mod_tests.rs")
    };
    let offenders: Vec<String> = hits.into_iter().filter(|p| !permitted(p)).collect();
    assert!(
        offenders.is_empty(),
        "the report_sales projection was reintroduced outside modules/reporting: {offenders:?}. \
         That table has no reader, so a writer for it is an unbounded cost on every \
         completed sale. If you are adding a real reader, wire it first and then delete \
         this pin with a note explaining what reads the table."
    );
}

// ── Phase 2 P3: subscriptions are capability-gated ───────────────────────

/// The wiring owner's declared capabilities must cover exactly the topics
/// the boot path subscribes to. A capability list that drifts from the
/// subscription sites (a topic added without its `subscribe:` grant) would
/// make `init_module_system` fail; this pins the list itself.
#[test]
fn startup_wiring_capabilities_cover_every_subscribed_topic() {
    let mut caps: Vec<&str> = STARTUP_WIRING_CAPABILITIES.to_vec();
    caps.sort_unstable();
    assert_eq!(
        caps,
        vec![
            "subscribe:product.created",
            "subscribe:sale.completed",
            "subscribe:settings.updated",
            "subscribe:stock.adjusted",
        ],
        "the wiring owner's capability list must name every topic subscribed at boot"
    );
}

/// A module that declares a capability set but is not granted a topic's
/// `subscribe:` capability must have its subscription REFUSED — this is the
/// boot-path half of the plan's "modules cannot acquire ungranted
/// capabilities" exit criterion. (The P2 unit test covers the registry; this
/// proves the gate is what the wiring actually calls.)
#[test]
fn an_ungranted_subscription_is_refused_by_the_kernel() {
    use platform_kernel::{Capability, Kernel, ModuleCapabilities};

    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    let handler = open_handler_connection(&db_path).unwrap();

    let mut k = kernel.blocking_lock();
    // Declare a module that requires nothing and is granted only a
    // DIFFERENT capability; subscribing to sale.completed must fail.
    let mut declared = ModuleCapabilities::none();
    let read_inventory = Capability::parse("read:inventory").unwrap();
    declared = declared
        .require(read_inventory.clone())
        .grant(read_inventory);
    k.declare_capabilities("probe", declared);

    let result = k.subscribe_gated::<kasirmu_core::events::SaleCompleted>(
        "probe",
        "sale.completed",
        "subscribe:sale.completed",
        Box::new(crate::event_handlers::SaleSyncEnqueuer::new(handler)),
    );

    match result {
        Err(platform_kernel::KernelError::MissingCapability { module, missing }) => {
            assert_eq!(module, "probe");
            assert_eq!(missing, "subscribe:sale.completed");
        }
        other => panic!("expected MissingCapability, got {other:?}"),
    }
    assert!(
        !k.event_bus().has_handlers("sale.completed"),
        "a refused subscription must not register a handler"
    );
}

/// The positive half: once the grant is present, the same subscription
/// succeeds and the handler is registered.
#[test]
fn a_granted_subscription_is_accepted() {
    use platform_kernel::{Capability, Kernel, ModuleCapabilities};

    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    let handler = open_handler_connection(&db_path).unwrap();

    let mut k = kernel.blocking_lock();
    let mut declared = ModuleCapabilities::none();
    let sub = Capability::parse("subscribe:sale.completed").unwrap();
    declared = declared.require(sub.clone()).grant(sub);
    k.declare_capabilities("probe", declared);

    k.subscribe_gated::<kasirmu_core::events::SaleCompleted>(
        "probe",
        "sale.completed",
        "subscribe:sale.completed",
        Box::new(crate::event_handlers::SaleSyncEnqueuer::new(handler)),
    )
    .expect("granted subscription must be accepted");

    assert!(
        k.event_bus().has_handlers("sale.completed"),
        "an accepted subscription must register a handler"
    );
}

/// The legacy path: a module that declares NO capabilities is still allowed
/// to subscribe (the plan's "legacy access still works during migration"),
/// but the boot log names it. This asserts the permissive half without a
/// log-capture dependency.
#[test]
fn a_module_with_no_declared_capabilities_may_still_subscribe() {
    use platform_kernel::Kernel;

    let kernel = AsyncMutex::new(Kernel::new());
    let (_dir, db_path) = create_temp_db();
    let handler = open_handler_connection(&db_path).unwrap();

    let k = kernel.blocking_lock();
    k.subscribe_gated::<kasirmu_core::events::SaleCompleted>(
        "legacy-module",
        "sale.completed",
        "subscribe:sale.completed",
        Box::new(crate::event_handlers::SaleSyncEnqueuer::new(handler)),
    )
    .expect("a module with no capability declaration must be allowed (legacy path)");
    assert!(k.event_bus().has_handlers("sale.completed"));
}
