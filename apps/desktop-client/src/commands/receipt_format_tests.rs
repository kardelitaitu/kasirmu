//! Tests for the receipt format commands (receipt-format axis).

use super::*;
use crate::state::AppState;
use oz_core::db::receipt_formats::ReceiptSource;
use oz_core::migrations;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager;

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

fn flow_state(conn: rusqlite::Connection) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    let path = temp_dir.keep();
    state.db_manager = StoreDatabaseManager::new(path, migrations::ALL);
    state
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

fn owner_session(state: &AppState, token: &str) {
    state.session_store.write().unwrap().insert(
        token.to_string(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
}

#[tokio::test]
async fn read_falls_back_to_legacy_keys_with_legacy_provenance() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    // Legacy keys live in the STORE db (the one resolve_scope opens), not
    // the global db.
    {
        let store_conn = state.db_manager.open_store("default").unwrap();
        let guard = store_conn.lock().unwrap();
        platform_core::settings::Settings::set(&guard, "receipt.footer", "legacy footer").unwrap();
    }
    {
        let store_conn = state.db_manager.open_store("default").unwrap();
        let guard = store_conn.lock().unwrap();
        platform_core::settings::Settings::set(&guard, "receipt.paper_width", "narrow").unwrap();
    }
    let app = mock_app(state);

    let eff = get_receipt_format_scoped(
        Some("term-1".into()),
        Some("loc-1".into()),
        "owner-tok".into(),
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(eff.content_source, ReceiptSource::Legacy);
    assert_eq!(eff.content.as_ref().unwrap().footer_text, "legacy footer");
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout_source, ReceiptSource::Legacy);
}

#[tokio::test]
async fn layout_write_scopes_to_the_store_location_and_readback_agrees() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let eff = set_receipt_layout_scoped(
        ReceiptLayoutArgs {
            paper_width_mm: Some(58),
            margin_top_mm: Some(2),
            margin_bottom_mm: Some(1),
            margin_left_mm: Some(0),
            margin_right_mm: Some(0),
            show_logo: Some(false),
            print_copies: Some(2),
            show_table_number: Some(false),
            footer_note: Some("counter copy".into()),
        },
        "loc-1".into(),
        "owner-tok".into(),
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(eff.layout_source, ReceiptSource::Workspace);
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout.print_copies, Some(2));

    // Readback agrees with the write's read-back.
    let again =
        get_receipt_format_scoped(None, Some("loc-1".into()), "owner-tok".into(), app.state())
            .await
            .unwrap();
    assert_eq!(again.layout.paper_width_mm, Some(58));
}

#[tokio::test]
async fn layout_write_rejects_nonsense_width_as_validation() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let result = set_receipt_layout_scoped(
        ReceiptLayoutArgs {
            paper_width_mm: Some(500),
            margin_top_mm: None,
            margin_bottom_mm: None,
            margin_left_mm: None,
            margin_right_mm: None,
            show_logo: None,
            print_copies: None,
            show_table_number: None,
            footer_note: None,
        },
        "loc-1".into(),
        "owner-tok".into(),
        app.state(),
    )
    .await;

    match result {
        Err(AppError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, oz_core::CoreErrorKind::Validation),
                "{sub_kind:?}"
            );
        }
        other => panic!("expected typed Validation rejection, got: {other:?}"),
    }
}

#[tokio::test]
async fn denies_staff_without_settings_edit() {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite User', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let state = flow_state(conn);
    state.session_store.write().unwrap().insert(
        "lite-tok".into(),
        SessionContext::new(
            "user-lite".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let app = mock_app(state);

    let result = set_receipt_layout_scoped(
        ReceiptLayoutArgs {
            paper_width_mm: Some(80),
            margin_top_mm: None,
            margin_bottom_mm: None,
            margin_left_mm: None,
            margin_right_mm: None,
            show_logo: None,
            print_copies: None,
            show_table_number: None,
            footer_note: None,
        },
        "loc-1".into(),
        "lite-tok".into(),
        app.state(),
    )
    .await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
