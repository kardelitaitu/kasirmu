use super::*;
use oz_core::db::Store;
use oz_core::migrations;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

fn analytics_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
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
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);

    let conn = state.db_manager.open_store("store-a").unwrap();
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

    (state, temp_dir)
}

fn mint_session(state: &mut AppState, token: &str, user: &str, role: &str, store: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        oz_core::session::SessionContext::new(
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
    let (mut state, _dir) = analytics_state();
    mint_session(
        &mut state,
        "staff-token",
        "user-staff",
        "role-staff",
        "store-a",
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = get_staff_analytics_scoped(
        "staff-token".into(),
        "2026-07-01".into(),
        "2026-07-31".into(),
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn owner_views_staff_analytics_with_display_names() {
    let (mut state, _dir) = analytics_state();
    mint_session(
        &mut state,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-a",
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let rows = get_staff_analytics_scoped(
        "owner-token".into(),
        "2026-07-01".into(),
        "2026-07-31".into(),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id, "user-staff");
    assert_eq!(rows[0].display_name, "Staff");
    assert_eq!(rows[0].shift_count, 1);
    assert_eq!(rows[0].sale_count, 2);
    assert_eq!(rows[0].sale_total_minor, 20000);
}

#[tokio::test]
async fn analytics_rejects_invalid_session() {
    let state = AppState::for_test();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = get_staff_analytics_scoped(
        "missing-token".into(),
        "2026-07-01".into(),
        "2026-07-31".into(),
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}
