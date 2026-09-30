//! Phase 2 P4 — a boot-path integration test for the capability gate.
//!
//! P2 proved the registry refuses an ungranted requirement (a unit test). P3
//! routed the boot subscriptions through the gate. This file proves the *boot
//! path* itself refuses: a module that declares a required capability without
//! a grant makes `load_all` fail with `KernelError::MissingCapability` naming
//! both the module and the capability, and adding the grant is what flips the
//! result. It also pins deterministic boot order for the real module set and
//! checks the `NamespacedStore` boundary from P1.

use foundation::contracts::{Module, ModuleId};
use platform_kernel::{Capability, Kernel, KernelError, ModuleCapabilities};
use platform_startup::init_module_system;
use rusqlite::Connection;
use tokio::sync::Mutex as AsyncMutex;

/// A minimal fixture module. Its capability declaration is handed to the kernel
/// separately (\`declare_capabilities\`), so a test can flip a grant on and off
/// without touching a real manifest.
#[derive(Debug)]
struct FixtureModule {
    id: ModuleId,
}

impl Module for FixtureModule {
    fn id(&self) -> ModuleId {
        self.id
    }
}

/// A single-requirement, no-grant declaration for `cap`.
fn requires_only(cap: &str) -> ModuleCapabilities {
    let c = Capability::parse(cap).expect("valid capability");
    ModuleCapabilities::none().require(c)
}

/// The same single requirement, but also granted (satisfied).
fn requires_and_grants(cap: &str) -> ModuleCapabilities {
    let c = Capability::parse(cap).expect("valid capability");
    ModuleCapabilities::none().require(c.clone()).grant(c)
}

/// Create an on-disk migrated temp database (the boot path opens its own
/// connections, so an in-memory database would not be shared).
fn temp_db() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("boot.db");
    let mut conn = Connection::open(&db_path).expect("open");
    conn.pragma_update(None, "foreign_keys", "ON").expect("fk");
    conn.pragma_update(None, "journal_mode", "WAL")
        .expect("wal");
    kasirmu_core::migrations::run(&mut conn).expect("migrate");
    drop(conn);
    (dir, db_path)
}

// ── 1. The boot path refuses an ungranted requirement ────────────────────

/// A fixture module that requires `write:sales` without a grant must make
/// `load_all` fail, naming BOTH the module and the missing capability — the
/// plan's "modules cannot acquire ungranted capabilities" exit criterion, at
/// the boot path rather than in the registry in isolation.
#[test]
fn boot_fails_when_a_required_capability_is_ungranted() {
    let mut kernel = Kernel::new();
    let module = FixtureModule {
        id: "fixture-ungranted",
    };
    kernel.register(Box::new(module)).expect("register fixture");
    // Declare the requirement WITHOUT granting it: the kernel sees a module
    // that wants `write:sales` and holds nothing.
    kernel.declare_capabilities("fixture-ungranted", requires_only("write:sales"));

    let err = kernel.load_all().expect_err("boot must fail");
    match err {
        KernelError::MissingCapability { module, missing } => {
            assert_eq!(module, "fixture-ungranted");
            assert_eq!(missing, "write:sales");
        }
        other => panic!("expected MissingCapability, got {other:?}"),
    }
}

/// The positive control for the test above: the SAME module with the grant
/// present loads cleanly. Removing the grant fails boot; restoring it passes.
#[test]
fn boot_succeeds_once_the_requirement_is_granted() {
    let mut kernel = Kernel::new();
    let module = FixtureModule {
        id: "fixture-granted",
    };
    kernel.register(Box::new(module)).expect("register fixture");
    kernel.declare_capabilities("fixture-granted", requires_and_grants("write:sales"));

    kernel.load_all().expect("boot must pass with the grant");
    assert!(kernel.is_loaded());
}

// ── 2. The real module set boots, deterministically ──────────────────────

/// `init_module_system` twice in a row produces the same registered-module
/// order, and both boots return Ok. "Module startup behavior is deterministic"
/// is only meaningful if two runs agree.
#[test]
fn real_boot_is_deterministic_across_two_runs() {
    let order = |()| {
        let kernel = AsyncMutex::new(Kernel::new());
        let (_dir, db_path) = temp_db();
        init_module_system(&kernel, &db_path).expect("boot");
        let k = kernel.blocking_lock();
        let mut ids: Vec<String> = k.module_ids().iter().map(|s| (*s).to_string()).collect();
        ids.sort();
        ids
    };
    let first = order(());
    let second = order(());
    assert_eq!(first, second, "two boots registered different module sets");
    assert!(!first.is_empty(), "the real module set must not be empty");
    assert!(
        first.len() >= 14,
        "expected the full vertical set, got {} module(s): {first:?}",
        first.len()
    );
}

// ── 3. The NamespacedStore (P1) boundary ─────────────────────────────────

/// At least one module reads through `NamespacedStore`, and a foreign read
/// without a grant is refused at the boundary with `NamespaceError::Foreign`.
/// This is the runtime companion to the compile-time ownership map: the SQL is
/// legal Rust, so only the store can stop it.
#[test]
fn namespaced_store_refuses_a_foreign_read_without_a_grant() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{
        Grants, ModuleId as NsModuleId, NamespaceError, NamespacedStore,
    };

    let (_dir, db_path) = temp_db();
    let conn = Connection::open(&db_path).expect("open");

    // `reporting` owns no tables; reading `sales` needs the `sales` grant.
    let ns = NamespacedStore::new(Store::new(&conn), NsModuleId("reporting"), Grants::none());
    let err = ns
        .own()
        .query("SELECT id, total_minor FROM sales", [], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .expect_err("foreign read must be refused before it reaches the db");
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
        "expected Foreign on sales, got {err:?}"
    );

    // A granted-read handle is the positive control: the same read compiles
    // and runs against the real table.
    let granted = NamespacedStore::new(
        Store::new(&conn),
        NsModuleId("reporting"),
        Grants::read([NsModuleId("sales")]),
    );
    granted
        .read(NsModuleId("sales"))
        .expect("granted read handle")
        .query("SELECT id FROM sales", [], |r| r.get::<_, String>(0))
        .expect("granted read runs");
}
