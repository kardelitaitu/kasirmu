//! Unit tests for the stock-count command bodies (Wave-C test relocation:
//! moved out of `apps/desktop-client/src/commands/inventory_counts_tests.rs`).
//!
//! Mounted at the foot of `inventory_counts.rs` with `#[cfg(test)] #[path]`,
//! so `use super::*` resolves the DTOs, args and scoped operations directly.
//! The desktop file exercised the same behaviour through `AppState` + a Tauri
//! mock app; here the scoped calls go straight to the bridge fns over a
//! `TestBridge` context (the crate's `testing` harness) with sessions seeded
//! through its shared session map and store products seeded through the
//! harness's per-instance store directory (no tempdir handle). Error
//! assertions are the 1:1 `AppError` -> `BridgeError` rename.

use super::*;
use crate::testing::TestBridge;
use oz_core::session::SessionContext;

// ── Existing tests (preserved) ────────────────────────────────────

#[test]
fn create_args_reject_legacy_actor_field() {
    let args: CreateStockCountArgs =
        serde_json::from_str(r#"{"countType":"full","notes":"cycle","countedBy":"forged"}"#)
            .unwrap();
    assert_eq!(args.count_type, "full");
    assert_eq!(args.notes, "cycle");
}

#[test]
fn complete_args_use_camel_case() {
    let args: CompleteStockCountArgs = serde_json::from_str(r#"{"countId":"count-1"}"#).unwrap();
    assert_eq!(args.count_id, "count-1");
}

#[test]
fn quantity_validation_rejects_negative_values() {
    assert!(validate_quantity("counted_qty", -1).is_err());
    assert!(validate_quantity("counted_qty", 0).is_ok());
}

// ── Helpers ───────────────────────────────────────────────────────

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

fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let bridge = TestBridge::new().with_conn(conn);
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

fn make_count_args(count_type: &str) -> CreateStockCountArgs {
    CreateStockCountArgs {
        count_type: count_type.into(),
        notes: format!("Test count: {count_type}"),
    }
}

fn create_product_in_store(bridge: &TestBridge, sku: &str, name: &str) {
    let store_db = bridge.ctx().db_manager.open_store("s1").unwrap();
    let db = store_db.lock().unwrap();
    let s = Store::new(&db);
    s.create_product(
        sku,
        name,
        oz_core::Money {
            minor_units: 1000,
            currency: "USD".parse().unwrap(),
        },
        None,
        None,
        10,
        None,
    )
    .unwrap();
}

// ── Session validation ────────────────────────────────────────────

#[tokio::test]
async fn scoped_list_stock_counts_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = list_stock_counts_scoped(&bridge.ctx(), "bad-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_stock_count_rejects_invalid_token() {
    let conn = oz_core::migrations::fresh_db();
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = get_stock_count_scoped(&bridge.ctx(), "bad-token", "count-1").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Permission matrix: owner (has INVENTORY_COUNT) ────────────────

#[tokio::test]
async fn owner_can_create_stock_count() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full")).await;
    assert!(result.is_ok(), "owner should create a stock count");
    let c = result.unwrap();
    assert_eq!(c.status, "draft");
    assert_eq!(c.count_type, "full");
}

#[tokio::test]
async fn owner_can_get_stock_count_by_id() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let created = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("cyclic"))
        .await
        .unwrap();
    let fetched = get_stock_count_scoped(&bridge.ctx(), "tok", &created.id).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn owner_can_list_stock_counts() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();
    create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("cyclic"))
        .await
        .unwrap();

    let counts = list_stock_counts_scoped(&bridge.ctx(), "tok")
        .await
        .unwrap();
    assert_eq!(counts.len(), 2);
}

#[tokio::test]
async fn owner_can_add_count_line() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    create_product_in_store(&bridge, "WG-001", "Widget");

    let count = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();

    let args = AddCountLineArgs {
        count_id: count.id.clone(),
        sku: "WG-001".into(),
        product_name: "Widget".into(),
        expected_qty: 10,
    };
    let result = add_count_line_scoped(&bridge.ctx(), "tok", args).await;
    assert!(result.is_ok(), "owner should add a count line");
}

#[tokio::test]
async fn owner_can_get_count_lines() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    create_product_in_store(&bridge, "WG-001", "Widget");

    let count = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();

    add_count_line_scoped(
        &bridge.ctx(),
        "tok",
        AddCountLineArgs {
            count_id: count.id.clone(),
            sku: "WG-001".into(),
            product_name: "Widget".into(),
            expected_qty: 10,
        },
    )
    .await
    .unwrap();

    let lines = get_count_lines_scoped(&bridge.ctx(), "tok", &count.id).await;
    assert!(lines.is_ok());
    assert_eq!(lines.unwrap().len(), 1);
}

#[tokio::test]
async fn owner_can_update_count_line() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    create_product_in_store(&bridge, "WG-001", "Widget");

    let count = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();

    let line = add_count_line_scoped(
        &bridge.ctx(),
        "tok",
        AddCountLineArgs {
            count_id: count.id.clone(),
            sku: "WG-001".into(),
            product_name: "Widget".into(),
            expected_qty: 10,
        },
    )
    .await
    .unwrap();

    let result = update_count_line_scoped(
        &bridge.ctx(),
        "tok",
        UpdateCountLineArgs {
            line_id: line.id.clone(),
            counted_qty: Some(8),
            notes: "2 missing".into(),
        },
    )
    .await;
    assert!(result.is_ok(), "owner should update a count line");
}

#[tokio::test]
async fn owner_can_remove_count_line() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    create_product_in_store(&bridge, "WG-001", "Widget");

    let count = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();

    let line = add_count_line_scoped(
        &bridge.ctx(),
        "tok",
        AddCountLineArgs {
            count_id: count.id.clone(),
            sku: "WG-001".into(),
            product_name: "Widget".into(),
            expected_qty: 10,
        },
    )
    .await
    .unwrap();

    let result = remove_count_line_scoped(
        &bridge.ctx(),
        "tok",
        RemoveCountLineArgs { line_id: line.id },
    )
    .await;
    assert!(result.is_ok(), "owner should remove a count line");

    let lines = get_count_lines_scoped(&bridge.ctx(), "tok", &count.id)
        .await
        .unwrap();
    assert!(lines.is_empty(), "removed line should not exist");
}

#[tokio::test]
async fn owner_can_complete_stock_count() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let count = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full"))
        .await
        .unwrap();

    let result = complete_stock_count_scoped(
        &bridge.ctx(),
        "tok",
        CompleteStockCountArgs {
            count_id: count.id.clone(),
        },
    )
    .await;
    assert!(result.is_ok(), "owner should complete a stock count");

    let completed = get_stock_count_scoped(&bridge.ctx(), "tok", &count.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completed.status, "completed");
}

#[tokio::test]
async fn owner_can_list_stock_adjustments() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    // No adjustments yet — should return empty list.
    let result = list_stock_adjustments_scoped(&bridge.ctx(), "tok").await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

// ── Permission matrix: staff (no INVENTORY_COUNT) ─────────────────

#[tokio::test]
async fn staff_denied_create_stock_count() {
    let conn = oz_core::migrations::fresh_db();
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("full")).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_add_count_line() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = add_count_line_scoped(
        &bridge.ctx(),
        "tok",
        AddCountLineArgs {
            count_id: "nonexistent".into(),
            sku: "WG-001".into(),
            product_name: "Widget".into(),
            expected_qty: 10,
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_complete_stock_count() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    seed_staff(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");

    let result = complete_stock_count_scoped(
        &bridge.ctx(),
        "tok",
        CompleteStockCountArgs {
            count_id: "nonexistent".into(),
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── Edge cases ────────────────────────────────────────────────────

#[tokio::test]
async fn list_stock_counts_empty_when_none() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let counts = list_stock_counts_scoped(&bridge.ctx(), "tok")
        .await
        .unwrap();
    assert!(counts.is_empty());
}

#[tokio::test]
async fn get_stock_count_returns_none_for_unknown() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result = get_stock_count_scoped(&bridge.ctx(), "tok", "nonexistent-id").await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_none());
}

#[tokio::test]
async fn create_stock_count_validates_count_type() {
    let conn = oz_core::migrations::fresh_db();
    seed_owner(&conn);
    let bridge = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    let result =
        create_stock_count_scoped(&bridge.ctx(), "tok", make_count_args("invalid_type")).await;
    assert!(result.is_err(), "invalid count type should be rejected");
}
