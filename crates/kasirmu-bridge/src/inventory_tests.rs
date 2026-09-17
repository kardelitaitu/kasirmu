//! Unit tests for the inventory command bodies (Wave-C test relocation:
//! moved out of `apps/desktop-client/src/commands/inventory_tests.rs`).
//!
//! Mounted at the foot of `inventory.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the 24 bridge command bodies and the module's
//! `Store` import exactly as the desktop sibling module did. The desktop
//! file's `scoped_state_with_token` harness (which built
//! `AppState::for_test_with_conn`, swapped in an isolated
//! `StoreDatabaseManager` and seeded a session) maps 1:1 onto the crate's
//! headless `TestBridge` — fresh migrated global DB via `with_conn`,
//! isolated store-db manager via `with_db_manager`, session seeding via
//! `sessions()`, and the unique per-test store directory replaces
//! `tempfile::tempdir()` (not a dev-dependency of this crate). Every case
//! keeps its `#[tokio::test]` + `.await` (the bridge bodies are async) and
//! the `AppError` arms map 1:1 onto `BridgeError`; the permission-denied
//! assertions exercise the bridge's global-DB gates exactly as the shell's
//! `require_inventory_permission` did.

use super::*;

use crate::testing::TestBridge;
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

use std::sync::atomic::{AtomicU64, Ordering};

use kasirmu_core::db::Store;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

/// Seed a user with inventory:view but NOT inventory:locations_manage.
/// The new role-staff preset grants both, so a limited user must use a
/// custom role (0048 retirement sweep).
fn seed_cashier_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited inventory view', '[\"inventory:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

fn seed_owner_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Instance counter disambiguating store-db directories within one process.
static STORE_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// Unique per-test directory for the isolated store-db manager. The manager
/// creates the directory lazily on first `open_store`; leftovers are left
/// for the OS temp cleaner, exactly like the harness's own store roots (the
/// desktop file used `tempfile::tempdir()`, which is not a dev-dependency of
/// this crate).
fn unique_store_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "oz-bridge-inventory-{}-{}-{}",
        std::process::id(),
        nanos,
        STORE_DIR_SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Isolated store-db manager over a fresh directory — the direct twin of the
/// desktop `scoped_state_with_token` harness's
/// `StoreDatabaseManager::new(temp_dir, migrations::ALL)`. Seeding tests
/// open and mutate their store DB through this handle *before* it is handed
/// to the bridge, because `TestBridge` keeps the manager private.
fn store_manager() -> StoreDatabaseManager {
    StoreDatabaseManager::new(unique_store_dir(), kasirmu_core::migrations::ALL)
}

/// `TestBridge` with a fresh migrated global DB, an isolated store-db dir
/// and one seeded session (the bridge twin of the desktop
/// `scoped_state_with_token` + `mock_app` pair).
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

// ── LOC-06: least-privilege permission matrix ──────────────────────

#[tokio::test]
async fn cashier_can_list_locations_but_cannot_create_them() {
    // The limited role has INVENTORY_VIEW (list is allowed) but must NOT
    // hold INVENTORY_LOCATIONS_MANAGE (create/rename/deactivate/rebind
    // are management capabilities, not sales side-effects).
    let conn = kasirmu_core::migrations::fresh_db();
    seed_cashier_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-cashier",
    );

    // Read: cashier is allowed. Migrations seed two default locations,
    // so the list is non-empty — the point is the read path works.
    let listed = list_inventory_locations(&bridge.ctx(), "cashier-token")
        .await
        .unwrap();
    assert!(
        listed.iter().any(|l| l.name == "Default Inventory"),
        "cashier should be able to list seeded locations"
    );

    // Mutation: cashier is denied with PermissionDenied.
    let created = create_inventory_location(
        &bridge.ctx(),
        "cashier-token",
        "Rogue Loc".into(),
        "store".into(),
        String::new(),
    )
    .await;
    assert!(matches!(created, Err(BridgeError::PermissionDenied(_))));

    // And the denied create must not have leaked a row.
    let after = list_inventory_locations(&bridge.ctx(), "cashier-token")
        .await
        .unwrap();
    assert!(
        !after.iter().any(|l| l.name == "Rogue Loc"),
        "denied create must not insert a location"
    );
}

#[tokio::test]
async fn owner_can_create_and_deactivate_locations() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let created = create_inventory_location(
        &bridge.ctx(),
        "owner-token",
        "Backroom".into(),
        "warehouse".into(),
        "Secondary storage".into(),
    )
    .await;
    // Release: the create is refused at the signature, so there is no id and
    // the deactivation below has nothing to deactivate - it stays debug-only
    // rather than being re-cut into a second assertion of the same cause.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, created, "free").await;
        return;
    }
    let id = created.unwrap();
    assert!(!id.is_empty());

    let deactivated = deactivate_inventory_location(&bridge.ctx(), "owner-token", id).await;
    assert!(deactivated.is_ok());
}

#[tokio::test]
async fn sales_process_gated_inventory_commands_authorise_via_global_db() {
    // The SALES_PROCESS-gated inventory commands (shifts/transactions/
    // thresholds/alerts/pending-sale) must also authorise against the
    // GLOBAL identity DB — the store DB has no users, so a store-scoped
    // check would deny every caller with "user not found".
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let shifts = list_inventory_shifts(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    assert!(shifts.is_empty());
}

#[tokio::test]
async fn location_read_is_scoped_to_session_store() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let manager = store_manager();

    // Seed a location ONLY into store A's database. The guard is scoped
    // to a block so it drops before the async commands below.
    {
        let store_a_conn = manager.open_store("store-a").unwrap();
        let store_a_db = store_a_conn.lock().unwrap();
        Store::new(&store_a_db)
            .create_inventory_location("Store A Only", "warehouse", "")
            .unwrap();
    }
    let bridge = TestBridge::new().with_conn(conn).with_db_manager(manager);
    for (token, store_id) in [("store-a-token", "store-a"), ("store-b-token", "store-b")] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }

    let store_a = list_inventory_locations(&bridge.ctx(), "store-a-token")
        .await
        .unwrap();
    let store_b = list_inventory_locations(&bridge.ctx(), "store-b-token")
        .await
        .unwrap();
    assert!(
        store_a.iter().any(|l| l.name == "Store A Only"),
        "store A must see its own location"
    );
    assert!(
        !store_b.iter().any(|l| l.name == "Store A Only"),
        "store B must not see store A locations"
    );
}

// ── LOC-07: update inventory location ──────────────────────────────

#[tokio::test]
async fn owner_can_update_location_name_and_type() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let created = create_inventory_location(
        &bridge.ctx(),
        "owner-token",
        "Original".into(),
        "warehouse".into(),
        String::new(),
    )
    .await;
    // Release: refused before any row is written, so the rename round-trip
    // below (update -> list -> find) has no referent to follow.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, created, "free").await;
        return;
    }
    let id = created.unwrap();

    update_inventory_location(
        &bridge.ctx(),
        "owner-token",
        id.clone(),
        "Renamed".into(),
        "store".into(),
        "".into(),
    )
    .await
    .unwrap();

    let listed = list_inventory_locations(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    let loc = listed.iter().find(|l| l.id == id).unwrap();
    assert_eq!(loc.name, "Renamed");
    assert_eq!(loc.location_type, "store");
}

#[tokio::test]
async fn cashier_cannot_update_location() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_cashier_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-cashier",
    );

    // First create a location as owner to have something to update.
    let owner_conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&owner_conn);
    let owner_bridge = scoped_bridge(
        owner_conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );
    let created = create_inventory_location(
        &owner_bridge.ctx(),
        "owner-token",
        "Target".into(),
        "warehouse".into(),
        String::new(),
    )
    .await;
    // Release: the OWNER SETUP is what the signature kills here, and without
    // it there is no target row - so the cashier-denial claim below is left
    // uncovered in the shipping profile rather than propped up on a refused
    // id. Its sibling `cashier_can_list_locations_but_cannot_create_them`
    // still exercises the PermissionDenied arm in both profiles.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&owner_bridge, created, "free").await;
        return;
    }
    let id = created.unwrap();

    let result = update_inventory_location(
        &bridge.ctx(),
        "cashier-token",
        id,
        "Hacked".into(),
        "warehouse".into(),
        "".into(),
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── SHIFT-01: inventory shift lifecycle ────────────────────────────

#[tokio::test]
async fn owner_can_start_and_end_inventory_shift() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let manager = store_manager();
    // Seed user, role, and terminal in the store DB.
    // inventory_shifts has FKs to users(id) and terminals(id).
    {
        let store_arc = manager.open_store("store-owner").unwrap();
        let db = store_arc.lock().unwrap();
        let store = Store::new(&db);
        store.seed_default_roles().unwrap();
        db.execute(
            "INSERT OR IGNORE INTO users \
             (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) \
             VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, \
                     '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT OR IGNORE INTO terminals \
             (id, name, device_id, is_active, created_at, updated_at) \
             VALUES ('terminal-1', 'Test Terminal', 'dev-1', 1, \
                     '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    let bridge = TestBridge::new().with_conn(conn).with_db_manager(manager);
    bridge.sessions().write().unwrap().insert(
        "owner-token".into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-owner".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    // Create a location first.
    let created = create_inventory_location(
        &bridge.ctx(),
        "owner-token",
        "Warehouse".into(),
        "warehouse".into(),
        String::new(),
    )
    .await;
    // Release: no location id, so the whole shift lifecycle that hangs off it
    // (start -> active -> end -> none) is debug-only.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&bridge, created, "free").await;
        return;
    }
    let loc_id = created.unwrap();

    // Start shift.
    let shift = start_inventory_shift(&bridge.ctx(), "owner-token", loc_id, "Morning count".into())
        .await
        .unwrap();
    assert!(!shift.id.is_empty());

    // Active shift should exist.
    let active = get_active_inventory_shift(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    assert!(active.is_some());
    assert_eq!(active.unwrap().id, shift.id);

    // End shift.
    end_inventory_shift(&bridge.ctx(), "owner-token", shift.id)
        .await
        .unwrap();

    // No active shift after ending.
    let after = get_active_inventory_shift(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    assert!(after.is_none());
}

// ── THRESHOLD-01: stock threshold management ───────────────────────

// ── list_inventory_shifts ──────────────────────────────────────────

#[tokio::test]
async fn owner_can_list_inventory_shifts() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let shifts = list_inventory_shifts(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    assert!(shifts.is_empty(), "no shifts yet");
}

// ── list_inventory_transactions ────────────────────────────────────

#[tokio::test]
async fn owner_can_list_inventory_transactions() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let txns = list_inventory_transactions(&bridge.ctx(), "owner-token")
        .await
        .unwrap();
    assert!(txns.is_empty(), "no transactions yet");
}

// ── delete_stock_threshold ─────────────────────────────────────────

// ── get_low_stock_alerts_at_location_scoped ────────────────────────

#[tokio::test]
async fn owner_can_get_low_stock_alerts() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let result = get_low_stock_alerts_at_location_scoped(
        &bridge.ctx(),
        "owner-token",
        "loc-default".into(),
        10,
    )
    .await;
    assert!(result.is_ok(), "owner should get low stock alerts");
}

// ── active_stock_alerts_scoped ─────────────────────────────────────

#[tokio::test]
async fn owner_can_get_active_stock_alerts() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let result =
        active_stock_alerts_scoped(&bridge.ctx(), "owner-token", "loc-default".into()).await;
    assert!(result.is_ok(), "owner should get active stock alerts");
    assert!(result.unwrap().is_empty());
}

// ── acknowledge_stock_alert_scoped ─────────────────────────────────

#[tokio::test]
async fn acknowledge_nonexistent_alert_returns_error() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_owner_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-owner",
    );

    let result =
        acknowledge_stock_alert_scoped(&bridge.ctx(), "owner-token", "nonexistent-alert".into())
            .await;
    assert!(result.is_err(), "nonexistent alert should fail");
}

// ── Staff permission matrix ────────────────────────────────────────

#[tokio::test]
async fn cashier_denied_inventory_shifts() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_cashier_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-cashier",
    );

    // Cashier has inventory:view but NOT SALES_PROCESS.
    let result = list_inventory_shifts(&bridge.ctx(), "cashier-token").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn cashier_denied_inventory_transactions() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_cashier_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-cashier",
    );

    let result = list_inventory_transactions(&bridge.ctx(), "cashier-token").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn cashier_denied_delete_stock_threshold() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_cashier_user(&conn);
    let bridge = scoped_bridge(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-cashier",
    );

    let result = delete_stock_threshold(&bridge.ctx(), "cashier-token", "any-id".into()).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}
