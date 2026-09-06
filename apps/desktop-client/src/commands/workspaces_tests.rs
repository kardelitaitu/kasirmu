use super::*;

// ── Token Rejection ─────────────────────────────────────────────────

#[test]
fn workspaces_scoped_rejects_invalid_token() {
    let state = AppState::for_test();
    let result = state.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

// ── WorkspaceTypeDto ─────────────────────────────────────────────────

#[test]
fn workspace_type_dto_debug() {
    let dto = WorkspaceTypeDto {
        key: "retail".into(),
        name: "Retail".into(),
        description: "Retail POS".into(),
        icon: "store".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("retail"));
    assert!(d.contains("Retail POS"));
}

#[test]
fn workspace_type_dto_serialize() {
    let dto = WorkspaceTypeDto {
        key: "restaurant".into(),
        name: "Restaurant".into(),
        description: String::new(),
        icon: "utensils".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["key"], "restaurant");
    assert_eq!(json["description"], "");
}

// ── WorkspaceScreenDto ──────────────────────────────────────────────

#[test]
fn workspace_screen_dto_debug() {
    let dto = WorkspaceScreenDto {
        screen_key: "pos".into(),
        sort_order: 1,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("pos"));
    assert!(d.contains("1"));
}

#[test]
fn workspace_screen_dto_serialize() {
    let dto = WorkspaceScreenDto {
        screen_key: "history".into(),
        sort_order: 5,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["screen_key"], "history");
    assert_eq!(json["sort_order"], 5);
}

// ── CreateInstanceRequest ───────────────────────────────────────────

#[test]
fn create_instance_request_deserializes() {
    let json = r#"{
        "id": "ws-dt-1",
        "type_key": "restaurant-pos",
        "store_id": "store-downtown",
        "name": "Downtown - Cashier 1"
    }"#;
    let req: CreateInstanceRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.id, "ws-dt-1");
    assert_eq!(req.type_key, "restaurant-pos");
    assert_eq!(req.name, "Downtown - Cashier 1");
    assert!(req.description.is_none());
    assert!(req.colour.is_none());
    assert!(req.purpose_key.is_none());
}

// ── BootResolution (ADR #4 Phase 3) ─────────────────────────────────

#[test]
fn boot_resolution_dto_serialize_bound() {
    let res = BootResolution {
        is_bound: true,
        store_id: "store-downtown".into(),
        instance_id: Some("ws-dt-cashier-1".into()),
    };
    let json = serde_json::to_value(&res).unwrap();
    assert_eq!(json["isBound"], true);
    assert_eq!(json["storeId"], "store-downtown");
    assert_eq!(json["instanceId"], "ws-dt-cashier-1");
}

#[test]
fn boot_resolution_dto_serialize_unbound() {
    let res = BootResolution {
        is_bound: false,
        store_id: "default".into(),
        instance_id: None,
    };
    let json = serde_json::to_value(&res).unwrap();
    assert_eq!(json["isBound"], false);
    assert_eq!(json["storeId"], "default");
    assert!(json["instanceId"].is_null());
}

#[test]
fn boot_resolution_dto_debug() {
    let res = BootResolution {
        is_bound: false,
        store_id: "default".into(),
        instance_id: None,
    };
    let d = format!("{res:?}");
    assert!(d.contains("default"));
    assert!(d.contains("false"));
}

// ── Pre-session picker ticket binding (audit-open-findings residual) ──────────
//
// TDD red: `list_workspaces` / `list_workspace_screens` must bind the
// listing to the authenticated user server-side. Previously the commands
// trusted the caller-supplied `role_id` / `user_id`, so any caller who
// knew an owner's id could enumerate instances in any store as
// `role-owner`. Now the caller presents a short-lived HMAC ticket and the
// REAL role is resolved from the global identity DB.

use oz_core::LocationProfile;
use oz_core::db::assignments::{AssignmentSpec, ScopeMode};
use oz_core::migrations;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Seed the GLOBAL identity DB with an owner and a limited user whose
/// role has no workspace-type grants (so it sees no instances — the
/// retired cashier role behaved the same way; 0048 sweep).
fn seed_global_users(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner',   'owner',   'hash', 'Owner',   'role-owner',   1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite',    1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

fn make_profile(id: &str, name: &str) -> LocationProfile {
    LocationProfile {
        id: id.to_owned(),
        name: name.to_owned(),
        address: String::new(),
        tax_id: String::new(),
        currency: "USD".to_owned(),
        timezone: "UTC".to_owned(),
        is_primary: false,
        created_at: "2026-07-01T10:00:00Z".to_owned(),
        updated_at: "2026-07-01T10:00:00Z".to_owned(),
    }
}

/// Build an AppState with a global identity DB (users seeded) and a
/// temp-dir store manager with store-a (1 instance) and store-b (1
/// instance) so cross-store isolation can be exercised.
fn picker_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    seed_global_users(&conn);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);

    for (store_id, instance_id) in [("store-a", "ws-a-1"), ("store-b", "ws-b-1")] {
        let conn = state.db_manager.open_store(store_id).unwrap();
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store
            .create_location_profile(&make_profile(store_id, store_id))
            .unwrap();
        store
            .create_workspace_instance(instance_id, "store-pos", store_id, "POS", "", None)
            .unwrap();
    }
    (state, temp_dir)
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_rejects_invalid_session() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        list_workspaces_for_store_scoped("missing-token".into(), "store-a".into(), app.state())
            .await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_uses_session_role() {
    let (state, _dir) = picker_state();
    state.session_store.write().unwrap().insert(
        "cashier-token".into(),
        oz_core::session::SessionContext::new(
            "user-cashier".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "store-a".into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // The session token binds the real role — a limited session listing
    // store-a must not see owner-level instances (same as the ticket path).
    let rows =
        list_workspaces_for_store_scoped("cashier-token".into(), "store-a".into(), app.state())
            .await
            .unwrap();
    assert!(
        rows.is_empty(),
        "cashier session must not enumerate store-a instances, got {rows:?}"
    );
}

// ── Scoped-sessions follow-up: post-login listings ────────────────────
//
// TDD red: a scoped member must not be able to switch into an
// out-of-scope workspace type or store AFTER login. `list_workspaces_scoped`
// and `list_workspaces_for_store_scoped` must scope-filter through the
// user's assignment (ADR #35 D5 / spec 0048), mirroring the picker.
// `restaurant-pos` is used as the out-of-scope type because the Free tier
// allows it (so tier entitlement filtering cannot hide it — only the
// assignment can).

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
async fn scoped_assignment_filters_session_workspace_listing() {
    let (mut state, _dir) = picker_state();
    // A second store-a instance of a type the Free tier ALLOWS
    // (restaurant-pos) so only the assignment scope can hide it.
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance(
                "ws-a-rest",
                "restaurant-pos",
                "store-a",
                "Restaurant",
                "",
                None,
            )
            .unwrap();
    }
    // Owner scoped to workspace type `store-pos` only.
    {
        let db = state.db.lock().await;
        Store::new(&db)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: false,
                    workspaces: vec!["store-pos".into()],
                },
            )
            .unwrap();
    }
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

    let rows = list_workspaces_scoped("owner-token".into(), app.state())
        .await
        .unwrap();
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "in-scope workspace type must list, got {rows:?}"
    );
    assert!(
        rows.iter().all(|d| d.type_key != "restaurant-pos"),
        "out-of-scope workspace type must be hidden after login, got {rows:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_branch_dimension_denies_out_of_scope_store_for_session() {
    let (mut state, _dir) = picker_state();
    // Owner scoped to branch store-a only — store-b is out of scope, so
    // the terminal-management listing of store-b must yield nothing
    // (fail closed, same as the picker).
    {
        let db = state.db.lock().await;
        Store::new(&db)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: false,
                    branches: vec!["store-a".into()],
                    workspaces_all: true,
                    workspaces: vec![],
                },
            )
            .unwrap();
    }
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

    let in_scope =
        list_workspaces_for_store_scoped("owner-token".into(), "store-a".into(), app.state())
            .await
            .unwrap();
    assert!(in_scope.iter().any(|d| d.instance_id == "ws-a-1"));

    let out_of_scope =
        list_workspaces_for_store_scoped("owner-token".into(), "store-b".into(), app.state())
            .await
            .unwrap();
    assert!(
        out_of_scope.is_empty(),
        "branch out of scope must deny the whole store listing, got {out_of_scope:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_workspace_dimension_filters_for_store_listing() {
    let (mut state, _dir) = picker_state();
    // Same Free-tier-allowed out-of-scope type as the session listing test.
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance(
                "ws-a-rest",
                "restaurant-pos",
                "store-a",
                "Restaurant",
                "",
                None,
            )
            .unwrap();
    }
    // Owner scoped to workspace type `store-pos` only.
    {
        let db = state.db.lock().await;
        Store::new(&db)
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: false,
                    workspaces: vec!["store-pos".into()],
                },
            )
            .unwrap();
    }
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

    let rows =
        list_workspaces_for_store_scoped("owner-token".into(), "store-a".into(), app.state())
            .await
            .unwrap();
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "in-scope workspace type must list, got {rows:?}"
    );
    assert!(
        rows.iter().all(|d| d.type_key != "restaurant-pos"),
        "out-of-scope workspace type must be hidden, got {rows:?}"
    );
}

#[tokio::test]
async fn list_workspaces_for_store_scoped_filters_by_tier_entitlement() {
    let (mut state, _dir) = picker_state();
    // Add a kds instance to store-a. The Free tier (default subscription)
    // does NOT allow kds — only store-pos, restaurant-pos, admin.
    // The scoped listing must filter it out.
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance("ws-a-kds", "kds", "store-a", "KDS", "", None)
            .unwrap();
    }
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

    let rows =
        list_workspaces_for_store_scoped("owner-token".into(), "store-a".into(), app.state())
            .await
            .unwrap();
    // store-pos (ws-a-1) is allowed by the Free tier → must be present.
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "Free tier must still list store-pos, got {rows:?}"
    );
    // kds is NOT allowed by the Free tier → must be filtered out.
    assert!(
        rows.iter().all(|d| d.type_key != "kds"),
        "Free tier must not list kds, got {rows:?}"
    );
}

#[tokio::test]
async fn list_workspaces_scoped_rejects_tampered_subscription_signature() {
    // Parity with create_session (round 6) and every other subscription-
    // trusting command: the tenant_subscription row's RSA signature must
    // be verified before its tier/allowed-types are honored. A tampered
    // row (forged pro tier + kds, invalid signature) must fail closed.
    let (mut state, _dir) = picker_state();
    // Tamper the subscription before minting the session.
    {
        let db = state.db.lock().await;
        db.execute(
            "UPDATE tenant_subscription
             SET tier_key = 'pro',
                 allowed_types_json = '[\"store-pos\",\"restaurant-pos\",\"admin\",\"kds\"]',
                 signature = 'TAMPERED_SIGNATURE'
             WHERE tenant_id = 'default'",
            [],
        )
        .unwrap();
    }
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

    let result = list_workspaces_scoped("owner-token".into(), app.state()).await;
    let err = result.expect_err("tampered subscription must fail the scoped listing");
    match err {
        AppError::Invalid(msg) => {
            assert!(
                msg.contains("signature") || msg.contains("subscription"),
                "error must name the signature gate, got: {msg}"
            );
        }
        AppError::Core { .. } => {}
        other => panic!("expected AppError::Invalid/Core, got {other:?}"),
    }
}
