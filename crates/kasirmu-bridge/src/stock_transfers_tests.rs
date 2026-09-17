//! Unit tests for the stock-transfer command bodies (Wave-C test relocation:
//! moved out of `apps/desktop-tauri/src/commands/stock_transfers_tests.rs`).
//!
//! Mounted at the foot of `stock_transfers.rs` with `#[cfg(test)] #[path]`,
//! so `use super::*` resolves the DTOs and scoped operations directly. The
//! desktop file exercised the same behaviour through `AppState` + a Tauri
//! mock app; here the scoped calls go straight to the bridge fns over a
//! `TestBridge` context (the crate's `testing` harness) with sessions
//! seeded through its shared session map and store databases resolved through
//! the harness's per-instance store directory (no tempdir handle). Error
//! assertions are the 1:1 `AppError` -> `BridgeError` rename.

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::session::SessionContext;

// ── ReceivedLineInput ───────────────────────────────────────────────

#[test]
fn received_line_input_deserialize() {
    let json = r#"{"line_id":"l1","received_qty":5}"#;
    let args: ReceivedLineInput = serde_json::from_str(json).unwrap();
    assert_eq!(args.line_id, "l1");
    assert_eq!(args.received_qty, 5);
}

#[test]
fn received_line_input_debug() {
    let args = ReceivedLineInput {
        line_id: "l2".into(),
        received_qty: 10,
    };
    let d = format!("{args:?}");
    assert!(d.contains("l2"));
}

// ── TransferWithLines ───────────────────────────────────────────────

#[test]
fn transfer_with_lines_debug() {
    let transfer = StockTransfer {
        id: "t1".into(),
        transfer_number: "TRF-001".into(),
        source_location: Some("WH-A".into()),
        destination_location: Some("WH-B".into()),
        source_terminal_id: None,
        destination_terminal_id: None,
        status: "draft".into(),
        notes: String::new(),
        created_by: "admin".into(),
        received_by: None,
        sent_at: None,
        received_at: None,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let twl = TransferWithLines {
        transfer,
        lines: vec![],
    };
    let d = format!("{twl:?}");
    assert!(d.contains("TRF-001"));
}

#[test]
fn transfer_with_lines_serialize() {
    let transfer = StockTransfer {
        id: "t2".into(),
        transfer_number: "TRF-002".into(),
        source_location: None,
        destination_location: None,
        source_terminal_id: None,
        destination_terminal_id: None,
        status: "in_transit".into(),
        notes: "Rush".into(),
        created_by: "user1".into(),
        received_by: None,
        sent_at: None,
        received_at: None,
        created_at: "2025-02-01T00:00:00.000Z".into(),
        updated_at: "2025-02-01T00:00:00.000Z".into(),
    };
    let twl = TransferWithLines {
        transfer,
        lines: vec![],
    };
    let json = serde_json::to_value(&twl).unwrap();
    assert_eq!(json["transfer"]["transfer_number"], "TRF-002");
    assert_eq!(json["transfer"]["status"], "in_transit");
}

fn seed_identity(conn: &rusqlite::Connection, user_id: &str, role_id: &str) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    // Custom fixture roles (role-lite) may not be presets — create them
    // first so the user insert's FK holds.
    conn.execute_batch(
        "INSERT OR IGNORE INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]',
                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active,
                            created_at, updated_at)
         VALUES (?1, ?2, 'hash', ?2, ?3, 1,
                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![user_id, user_id, role_id],
    )
    .unwrap();
}

fn scoped_test_bridge() -> TestBridge {
    let global = kasirmu_core::migrations::fresh_db();
    seed_identity(&global, "transfer-owner", "role-owner");
    let bridge = TestBridge::new().with_conn(global);
    bridge.sessions().write().unwrap().insert(
        "transfer-token".into(),
        SessionContext::new(
            "transfer-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    bridge
}

#[tokio::test]
async fn scoped_create_derives_created_by_from_session() {
    let bridge = scoped_test_bridge();
    let transfer = create_stock_transfer_scoped(
        &bridge.ctx(),
        "transfer-token",
        None,
        None,
        None,
        None,
        "session actor test",
        &[],
    )
    .await
    .unwrap();

    assert_eq!(transfer.created_by, "transfer-owner");

    // Authentication is global; the store ledger must not manufacture a
    // local users row merely to satisfy the historical FK.
    let (_, conn) = bridge.ctx().resolve_scope("transfer-token").unwrap();
    let db = conn.lock().unwrap();
    let local_users: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM users WHERE id = 'transfer-owner'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        local_users, 0,
        "transfer writes must not clone global auth users"
    );
}

#[tokio::test]
async fn scoped_transfer_reads_are_isolated_between_store_sessions() {
    let global = kasirmu_core::migrations::fresh_db();
    seed_identity(&global, "transfer-owner", "role-owner");
    let bridge = TestBridge::new().with_conn(global);
    for (token, store_id) in [("store-a-token", "store-a"), ("store-b-token", "store-b")] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "transfer-owner".into(),
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

    create_stock_transfer_scoped(
        &bridge.ctx(),
        "store-a-token",
        None,
        None,
        None,
        None,
        "store A only",
        &[],
    )
    .await
    .unwrap();

    let store_a = list_stock_transfers_scoped(&bridge.ctx(), "store-a-token")
        .await
        .unwrap();
    let store_b = list_stock_transfers_scoped(&bridge.ctx(), "store-b-token")
        .await
        .unwrap();
    assert_eq!(store_a.len(), 1);
    assert!(store_b.is_empty());
}

#[tokio::test]
async fn scoped_transfer_denies_user_without_transfer_permission() {
    let global = kasirmu_core::migrations::fresh_db();
    // Narrow custom role without inventory:transfer — the new role-staff
    // preset grants it (0048 retirement sweep).
    seed_identity(&global, "transfer-cashier", "role-lite");
    let bridge = TestBridge::new().with_conn(global);
    bridge.sessions().write().unwrap().insert(
        "cashier-transfer-token".into(),
        SessionContext::new(
            "transfer-cashier".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-cashier".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    let result = list_stock_transfers_scoped(&bridge.ctx(), "cashier-transfer-token").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── Additional CRUD tests ────────────────────────────────────────

#[tokio::test]
async fn scoped_list_stock_transfers_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let bridge = TestBridge::new().with_conn(conn);

    let result = list_stock_transfers_scoped(&bridge.ctx(), "bad-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_stock_transfer_rejects_invalid_token() {
    let conn = kasirmu_core::migrations::fresh_db();
    let bridge = TestBridge::new().with_conn(conn);

    let result = get_stock_transfer_scoped(&bridge.ctx(), "bad-token", "any-id").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_list_stock_transfers_empty() {
    let bridge = scoped_test_bridge();
    let result = list_stock_transfers_scoped(&bridge.ctx(), "transfer-token")
        .await
        .unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn scoped_list_in_transit_transfers_empty() {
    let bridge = scoped_test_bridge();
    let result = list_in_transit_transfers_scoped(&bridge.ctx(), "transfer-token")
        .await
        .unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn scoped_get_stock_transfer_not_found() {
    let bridge = scoped_test_bridge();
    let result = get_stock_transfer_scoped(&bridge.ctx(), "transfer-token", "nonexistent")
        .await
        .unwrap();
    assert!(result.is_none());
}
