//! Tests for the tablet local payment method commands (slice 6).

use super::*;
use crate::state::AppState;
use kasirmu_core::migrations;
use kasirmu_core::regional::ConfigScope;
use kasirmu_core::session::SessionContext;
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
    // ADR #56 §2.6: a store database is created by MIGRATIONS ONLY, so it is UNPROVISIONED —
    // no `default` location, no legal entity, no `default-*` instances. Every fixture that
    // comes through here drives a provisioned store, so the baseline is rebuilt where the
    // database is created, for the ids these fixtures name.
    for id in ["default", "store-a"] {
        if let Ok(store_conn) = state.db_manager.open_store(id) {
            let db = store_conn.lock().unwrap();
            kasirmu_core::migrations::seed_provisioned_baseline(&db);
        }
    }
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
async fn set_then_get_round_trips_the_rail_surface() {
    let conn = migrations::fresh_db();
    // ADR #56 §2.6: `fresh_db()` is deliberately UNPROVISIONED, so the seeded default
    // location, the `default-*` instances, the legal entity and the free tenant_subscription
    // row are written by provisioning now. This fixture drives a PROVISIONED store, so it
    // rebuilds the baseline the migration chain used to seed (same call the rest of the
    // suite uses for a provisioned store: crates/kasirmu-bridge/src/testing.rs).
    kasirmu_core::migrations::seed_provisioned_baseline(&conn);
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let effective = set_local_payment_methods_scoped(
        "default".into(),
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: "{}".into(),
        }],
        "owner-tok".into(),
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(effective.len(), 1);
    assert_eq!(effective[0].rail_code, "qris");
    assert_eq!(effective[0].scope, ConfigScope::Location);

    let again = get_local_payment_methods_scoped("default".into(), "owner-tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(again, effective);
}

#[tokio::test]
async fn write_rejects_credential_shaped_parameters_as_validation() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let result = set_local_payment_methods_scoped(
        "default".into(),
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: r#"{"gateway_credential": "x"}"#.into(),
        }],
        "owner-tok".into(),
        app.state(),
    )
    .await;

    match result {
        Err(AppError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, kasirmu_core::CoreErrorKind::Validation),
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

    let result = set_local_payment_methods_scoped(
        "default".into(),
        vec![LocalPaymentRailArgs {
            rail_code: "qris".into(),
            label: "QRIS".into(),
            is_enabled: true,
            parameters: "{}".into(),
        }],
        "lite-tok".into(),
        app.state(),
    )
    .await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[test]
fn rail_args_accept_the_snake_case_wire_the_ui_sends() {
    // Wire pin for the 2026-09-13 casing repair: the settings card sends
    // snake_case (`rail_code`, `is_enabled` — the only caller, since
    // slice 6 c549f7e5ab); the old camelCase rename on this shell's local
    // copy rejected it with `missing field 'railCode'`. The re-exported
    // bridge DTO now matches the real wire.
    let json = r#"[{"rail_code":"qris","label":"QRIS","is_enabled":true,"parameters":"{}"}]"#;
    let rails: Vec<LocalPaymentRailArgs> = serde_json::from_str(json).unwrap();
    assert_eq!(rails[0].rail_code, "qris");
    assert!(rails[0].is_enabled);
    assert_eq!(rails[0].parameters, "{}");
}
