//! Unit tests for the analytics command bodies (relocated from
//! `apps/desktop-tauri/src/commands/analytics_tests.rs`).
//!
//! Mounted at the foot of `analytics.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the analytics fns and DTOs exactly as the
//! desktop sibling module did. Harness mapping: the desktop file booted a
//! Tauri mock app over `AppState::for_test_with_conn` plus a
//! `tempfile::tempdir()` store manager; here `TestBridge::new().with_conn(conn)`
//! supplies the same shape headlessly and the harness's own unique store
//! directory stands in for the temp dir. Global-DB mutations are hoisted
//! onto the connection BEFORE `.with_conn()` (the bridge has no global-db
//! accessor); `AppError::` maps 1:1 onto `BridgeError::`.

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};

/// Global identity DB (owner / manager / staff presets) + a store manager
/// with store-a seeded with one staff's shifts + sales. `pre_seed` runs on
/// the global connection before it is handed to the bridge (the hoisted
/// stand-in for the desktop's post-construction `state.db` mutations).
fn analytics_state(pre_seed: impl FnOnce(&rusqlite::Connection)) -> TestBridge {
    let conn = crate::testing::temp_conn();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute_batch(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('user-owner',   'owner',   'hash', 'Owner',   'role-owner',   1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-staff',   'staff',   'hash', 'Staff',   'role-staff',   1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
        )
        .unwrap();
    }
    pre_seed(&conn);
    let bridge = TestBridge::new().with_conn(conn);

    // Store-a: the store DB has no identity rows, but shifts.user_id FKs
    // to users(id) — seed the store-side user rows (as the shift open
    // path does) plus one shift + completed sales for the analytics.
    let conn = bridge.db_manager().open_store("store-a").unwrap();
    let db = conn.lock().unwrap();
    db.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-staff', 'Staff', 'Staff', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at) VALUES
            ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, user_id, created_at) VALUES
            ('s1', 12000, 'USD', 1, 'completed', 'user-staff', '2026-07-10T09:00:00Z'),
            ('s2', 8000,  'USD', 1, 'completed', 'user-staff', '2026-07-10T14:00:00Z');
         INSERT INTO shifts (id, user_id, opened_at, closed_at, status, total_sales_minor, created_at, updated_at) VALUES
            ('sh1', 'user-staff', '2026-07-10T08:00:00Z', '2026-07-10T16:00:00Z', 'closed', 20000, '2026-07-10T08:00:00Z', '2026-07-10T16:00:00Z');",
    )
    .unwrap();
    drop(db);

    bridge
}

fn mint_session(bridge: &TestBridge, token: &str, user: &str, role: &str, store: &str) {
    bridge.sessions().write().unwrap().insert(
        token.into(),
        kasirmu_core::session::SessionContext::new(
            user.into(),
            role.into(),
            "terminal-1".into(),
            store.into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
}

#[tokio::test]
async fn staff_role_cannot_view_analytics() {
    let bridge = analytics_state(|_| ());
    mint_session(
        &bridge,
        "staff-token",
        "user-staff",
        "role-staff",
        "store-a",
    );
    let ctx = bridge.ctx();

    let result = get_staff_analytics_scoped(
        &ctx,
        "staff-token",
        "2026-07-01".into(),
        "2026-07-31".into(),
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "role-staff lacks analytics:view, got {result:?}"
    );
}

#[tokio::test]
async fn owner_views_staff_analytics_with_display_names() {
    let bridge = analytics_state(|_| ());
    mint_session(
        &bridge,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-a",
    );
    let ctx = bridge.ctx();

    let rows = get_staff_analytics_scoped(
        &ctx,
        "owner-token",
        "2026-07-01".into(),
        "2026-07-31".into(),
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, "user-staff");
    // Enriched from the GLOBAL identity DB, not the store-side row.
    assert_eq!(rows[0].display_name, "Staff");
    assert_eq!(rows[0].shift_count, 1);
    assert_eq!(rows[0].closed_shift_count, 1);
    assert_eq!(rows[0].shift_sales_minor, 20000);
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].sale_total_minor, 20000);
}

#[tokio::test]
async fn manager_views_daily_series_for_a_staff_member() {
    let bridge = analytics_state(|_| ());
    mint_session(
        &bridge,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    );
    let ctx = bridge.ctx();

    let rows = get_staff_analytics_daily_scoped(
        &ctx,
        "manager-token",
        "user-staff".into(),
        "2026-07-01".into(),
        "2026-07-31".into(),
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].day, "2026-07-10");
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].sale_total_minor, 20000);
    assert_eq!(rows[0].shift_count, 1);
    assert_eq!(rows[0].shift_sales_minor, 20000);
}

#[tokio::test]
async fn scoped_manager_session_out_of_scope_store_is_denied() {
    // Manager scoped to branch store-a only — a session minted for
    // store-b is out of scope and must be denied fail-closed before any
    // store DB is touched (ADR #35 D5 / spec 0048). The assignment lands
    // on the global connection BEFORE .with_conn() (no global-db
    // accessor on the bridge — BW1b/CW1 hoist rule).
    let bridge = analytics_state(|conn| {
        Store::new(conn)
            .set_assignment(
                "user-manager",
                "role-manager",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-a".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    });
    mint_session(
        &bridge,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-b",
    );
    let ctx = bridge.ctx();

    let result = get_staff_analytics_scoped(
        &ctx,
        "manager-token",
        "2026-07-01".into(),
        "2026-07-31".into(),
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "out-of-scope session must be denied, got {result:?}"
    );
}

#[tokio::test]
async fn analytics_rejects_invalid_session() {
    let bridge = TestBridge::new();
    let ctx = bridge.ctx();

    let result = get_staff_analytics_scoped(
        &ctx,
        "missing-token",
        "2026-07-01".into(),
        "2026-07-31".into(),
    )
    .await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}
