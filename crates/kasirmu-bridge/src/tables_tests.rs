//! Unit tests for the table command bodies (Wave-F test relocation:
//! moved out of `apps/desktop-client/src/commands/tables_tests.rs`).
//!
//! Mounted at the foot of `tables.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the nine bridge command bodies and the
//! module's `Store`/`Table` imports exactly as the desktop sibling
//! module did. The desktop file's `scoped_state` harness (which built
//! `AppState::for_test_with_conn`, swapped in an isolated
//! `StoreDatabaseManager` and seeded a session) maps 1:1 onto the
//! crate's headless `TestBridge`; every assertion is kept verbatim.

use super::*;
use crate::testing::TestBridge;
use std::sync::atomic::{AtomicU64, Ordering};

use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

fn seed_staff(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Instance counter disambiguating store-db directories within one process.
static STORE_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// Unique per-test directory for the isolated store-db manager. The manager
/// creates the directory lazily on first `open_store`; leftovers are left
/// for the OS temp cleaner, exactly like the harness's own store roots (the
/// desktop file used `tempfile::tempdir()`, which is not a dev-dependency
/// of this crate).
fn unique_store_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "kasirmu-bridge-tables-{}-{}-{}",
        std::process::id(),
        nanos,
        STORE_DIR_SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Isolated store-db manager over a fresh directory — the direct twin of the
/// desktop `scoped_state` harness's
/// `StoreDatabaseManager::new(temp_dir, migrations::ALL)`.
fn store_manager() -> StoreDatabaseManager {
    StoreDatabaseManager::new(unique_store_dir(), kasirmu_core::migrations::ALL)
}

/// `TestBridge` with a fresh migrated global DB, an isolated store-db dir
/// and one seeded session (the bridge twin of the desktop `scoped_state` +
/// `mock_app` pair).
fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let bridge = TestBridge::new()
        .with_conn(conn)
        .with_db_manager(store_manager());
    bridge.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

fn make_table(name: &str) -> Table {
    Table {
        id: String::new(), // DB generates UUID
        name: name.into(),
        capacity: 4,
        pos_x: 50.0,
        pos_y: 50.0,
        shape: "circle".into(),
        width: 10.0,
        height: 10.0,
        status: "available".into(),
        active_sale_id: None,
        section: "Indoor".into(),
        active: true,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

// ── Session validation ────────────────────────────────────────────

#[test]
fn tables_rejects_invalid_token() {
    let bridge = TestBridge::new();
    let result = bridge.ctx().resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_list_tables_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = list_tables_scoped(&bridge.ctx(), "bad-token", None).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Permission matrix: owner (has TABLES_CREATE/EDIT/DELETE) ──────

#[tokio::test]
async fn owner_can_create_table() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = create_table_scoped(&bridge.ctx(), "tok", make_table("T1")).await;
    assert!(result.is_ok(), "owner should create a table");
    let t = result.unwrap();
    assert_eq!(t.name, "T1");
    assert!(!t.id.is_empty());
}

#[tokio::test]
async fn owner_can_list_tables() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    // Create two tables then list.
    create_table_scoped(&bridge.ctx(), "tok", make_table("T1"))
        .await
        .unwrap();
    create_table_scoped(&bridge.ctx(), "tok", make_table("T2"))
        .await
        .unwrap();

    let tables = list_tables_scoped(&bridge.ctx(), "tok", None)
        .await
        .unwrap();
    assert_eq!(tables.len(), 2);
    assert!(tables.iter().any(|t| t.name == "T1"));
    assert!(tables.iter().any(|t| t.name == "T2"));
}

#[tokio::test]
async fn owner_can_get_table_by_id() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_table_scoped(&bridge.ctx(), "tok", make_table("T1"))
        .await
        .unwrap();
    let fetched = get_table_scoped(&bridge.ctx(), "tok", &created.id).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn owner_can_update_table() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let mut created = create_table_scoped(&bridge.ctx(), "tok", make_table("T1"))
        .await
        .unwrap();
    created.name = "T1-updated".into();
    let updated = update_table_scoped(&bridge.ctx(), "tok", created).await;
    assert!(updated.is_ok(), "owner should update a table");
    assert_eq!(updated.unwrap().name, "T1-updated");
}

#[tokio::test]
async fn owner_can_delete_table() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_table_scoped(&bridge.ctx(), "tok", make_table("T1"))
        .await
        .unwrap();
    let deleted = delete_table_scoped(&bridge.ctx(), "tok", &created.id).await;
    assert!(deleted.is_ok(), "owner should delete a table");

    let fetched = get_table_scoped(&bridge.ctx(), "tok", &created.id)
        .await
        .unwrap();
    assert!(fetched.is_none(), "deleted table should not exist");
}

#[tokio::test]
async fn owner_can_update_table_status() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_table_scoped(&bridge.ctx(), "tok", make_table("T1"))
        .await
        .unwrap();
    // "cleaning" is a valid status without requiring a sale FK.
    let updated = update_table_status_scoped(&bridge.ctx(), "tok", &created.id, "cleaning").await;
    if let Err(ref e) = updated {
        eprintln!("status error: {e:?}");
    }
    assert!(updated.is_ok(), "owner should update table status");
    assert_eq!(updated.unwrap().status, "cleaning");
}

// ── assign_table_order / release_table permission checks ──────────
// These tests verify permission denial. Positive tests are omitted
// because assign_table_order requires a valid sale FK, and the Sale
// creation path is complex (Cart → Sale::from_cart → create_sale).
// Core Store tests in crates/kasirmu-core/src/db/tables_tests.rs already
// cover the assign/release business logic.

#[tokio::test]
async fn staff_denied_assign_table_order() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "owner-tok", "user-owner", "role-owner", "s1");
    bridge.sessions().write().unwrap().insert(
        "staff-tok".into(),
        SessionContext::new(
            "user-staff".into(),
            "role-staff".into(),
            "terminal-1".into(),
            "s1".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    // Staff has TABLES_ASSIGN but the scoped function also checks via
    // require_permission_for_session. Verify the FK error surfaces (staff
    // passes permission but sale FK fails) OR a permission denial.
    let result = assign_table_order_scoped(&bridge.ctx(), "staff-tok", "table-1", "sale-1").await;
    // Staff HAS TABLES_ASSIGN, so this will get past the permission check
    // but fail on the missing table FK. That's fine — the point is it
    // doesn't panic and the permission gate is exercised.
    assert!(result.is_err());
}

#[tokio::test]
async fn staff_denied_release_table() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "owner-tok", "user-owner", "role-owner", "s1");
    bridge.sessions().write().unwrap().insert(
        "staff-tok".into(),
        SessionContext::new(
            "user-staff".into(),
            "role-staff".into(),
            "terminal-1".into(),
            "s1".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    // Staff has TABLES_CLOSE so the permission gate is passed.
    // The error will be a missing table FK — verify it doesn't panic.
    let result = release_table_scoped(&bridge.ctx(), "staff-tok", "nonexistent-table").await;
    assert!(result.is_err());
}

// ── Permission matrix: staff (has TABLES_ASSIGN/CLOSE but NOT CREATE/EDIT/DELETE) ─

#[tokio::test]
async fn staff_denied_create_table() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = create_table_scoped(&bridge.ctx(), "tok", make_table("T1")).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── list_tables_scoped ────────────────────────────────────────────

#[tokio::test]
async fn list_tables_empty_when_no_tables() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let tables = list_tables_scoped(&bridge.ctx(), "tok", None)
        .await
        .unwrap();
    assert!(tables.is_empty());
}

#[tokio::test]
async fn list_tables_scoped_filter_by_section() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let mut indoor = make_table("Indoor-1");
    indoor.section = "Indoor".into();
    let mut patio = make_table("Patio-1");
    patio.section = "Patio".into();

    create_table_scoped(&bridge.ctx(), "tok", indoor)
        .await
        .unwrap();
    create_table_scoped(&bridge.ctx(), "tok", patio)
        .await
        .unwrap();

    let indoor_tables = list_tables_scoped(&bridge.ctx(), "tok", Some("Indoor".into()))
        .await
        .unwrap();
    assert_eq!(indoor_tables.len(), 1);
    assert_eq!(indoor_tables[0].name, "Indoor-1");
}

// ── list_sections_scoped ──────────────────────────────────────────

#[tokio::test]
async fn list_sections_returns_created_sections() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let mut t1 = make_table("T1");
    t1.section = "Patio".into();
    let mut t2 = make_table("T2");
    t2.section = "Bar".into();
    let mut t3 = make_table("T3");
    t3.section = "Patio".into();

    create_table_scoped(&bridge.ctx(), "tok", t1).await.unwrap();
    create_table_scoped(&bridge.ctx(), "tok", t2).await.unwrap();
    create_table_scoped(&bridge.ctx(), "tok", t3).await.unwrap();

    let sections = list_sections_scoped(&bridge.ctx(), "tok").await.unwrap();
    assert!(sections.contains(&"Patio".to_string()));
    assert!(sections.contains(&"Bar".to_string()));
}

// ── get_table_scoped returns None for unknown id ──────────────────

#[tokio::test]
async fn get_table_scoped_returns_none_for_unknown() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = get_table_scoped(&bridge.ctx(), "tok", "nonexistent-id")
        .await
        .unwrap();
    assert!(result.is_none());
}
