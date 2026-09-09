//! Security integration tests — session gating across modules.
//!
//! Verifies that the `_scoped` command pattern enforces session
//! authentication uniformly across categories, settings, sync,
//! products, and the refresh_picker_ticket flow.

use crate::commands::auth::{self, CreateSessionArgs};
use crate::commands::categories;
use crate::commands::picker_ticket;
use crate::commands::products;
use crate::commands::settings;
use crate::commands::shifts;
use crate::commands::sync;
use crate::error::AppError;
use crate::state::AppState;

use oz_core::db::Store;
use oz_core::migrations;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager;

// ── Helpers ──────────────────────────────────────────────────────

/// Seed roles + an owner user into the global DB.
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

/// Seed roles + a staff user with NO product permissions.
fn seed_staff_no_products(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite User', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

/// Mint a picker ticket for a given user.
fn mint_ticket(state: &AppState, user_id: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    picker_ticket::sign_picker_ticket(&state.picker_ticket_secret, user_id, now + 300)
}

/// Build an `AppState` with a fresh global DB and an isolated store directory.
fn test_state(conn: rusqlite::Connection) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state
}

/// Insert a session into the session store.
fn insert_session(state: &AppState, token: &str, user_id: &str, role_id: &str, store_id: &str) {
    state.session_store.write().unwrap().insert(
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
}

/// Insert an already-expired session.
fn insert_expired_session(state: &AppState, token: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            Some(-1), // already expired
            0,
        ),
    );
}

// ── Cross-module: invalid session rejection ─────────────────────

#[tokio::test]
async fn categories_scoped_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = categories::list_categories_scoped("bogus-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn settings_scoped_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        settings::get_setting_scoped("some.key".into(), "bogus-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn sync_scoped_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = sync::get_sync_settings_scoped("bogus-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn products_scoped_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = products::list_products_scoped(app.state(), "bogus-token".into()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn shifts_scoped_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = shifts::list_shifts_scoped("bogus-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

// ── Cross-module: expired session rejection ──────────────────────

#[tokio::test]
async fn categories_scoped_rejects_expired_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    insert_expired_session(&state, "expired-tok");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = categories::list_categories_scoped("expired-tok".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn settings_scoped_rejects_expired_session() {
    let conn = migrations::fresh_db();
    let state = test_state(conn);
    insert_expired_session(&state, "expired-tok");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        settings::get_setting_scoped("some.key".into(), "expired-tok".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

// ── Cross-module: permission denial ──────────────────────────────

#[tokio::test]
async fn categories_scoped_denies_staff_without_permission() {
    let conn = migrations::fresh_db();
    seed_staff_no_products(&conn);
    let state = test_state(conn);
    insert_session(&state, "lite-tok", "user-lite", "role-lite", "default");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result = categories::create_category_scoped(
        "lite-tok".into(),
        categories::CreateCategoryArgs {
            id: "test".into(),
            name: "Test".into(),
            colour: String::new(),
            icon: String::new(),
        },
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

// ── refresh_picker_ticket integration ────────────────────────────

#[tokio::test]
async fn refresh_picker_ticket_end_to_end() {
    // 1. Login → session + picker ticket
    // 2. Refresh picker ticket via session token
    // 3. Create another session with the refreshed ticket
    let conn = migrations::fresh_db();
    seed_owner_user(&conn);
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Step 1: Create session via picker ticket (simulates login → workspace pick)
    let login_result = auth::create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: {
                let state = app.state::<AppState>();
                mint_ticket(&state, "user-owner")
            },
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    // Step 2: Refresh the picker ticket
    let refresh = auth::refresh_picker_ticket(login_result.session_token.clone(), app.state())
        .await
        .unwrap();
    assert!(!refresh.picker_ticket.is_empty());

    // Step 3: Create a second session with the refreshed ticket
    let second = auth::create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: refresh.picker_ticket,
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(second.context.user_id, "user-owner");
    assert_ne!(
        login_result.session_token, second.session_token,
        "refreshed ticket produces a new session token"
    );
}

// ── Operator impersonation (operator:impersonate) ─────────────────────

/// Seed a second owner-privileged user so an operator can impersonate an
/// in-scope target. Owner users sit in the role bypass set, so they always
/// pass `verify_instance_access` for an existing, active instance — exactly the
/// in-scope case the command must allow.
fn seed_target_owner(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)          VALUES ('user-target', 'target', 'hash', 'Target', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

#[tokio::test]
async fn impersonate_user_scoped_creates_target_scoped_session() {
    let conn = migrations::fresh_db();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Operator session (owner holds operator:impersonate via the `*` preset).
    let login = auth::create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: {
                let s = app.state::<AppState>();
                mint_ticket(&s, "user-owner")
            },
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let result = auth::impersonate_user_scoped(
        login.session_token.clone(),
        "user-target".into(),
        app.state(),
    )
    .await;
    assert!(result.is_ok(), "in-scope impersonation must succeed");
    let imp = result.unwrap();

    // The impersonated context is TARGET-scoped for identity, but reuses the
    // operator's store/instance/type/terminal scope. No operator grant is
    // merged and the impersonation capability is never carried into the token.
    assert_eq!(imp.context.user_id, "user-target");
    assert_eq!(imp.context.role_id, "role-owner");
    assert_eq!(imp.context.store_id, "default");
    assert_eq!(imp.context.instance_id, "default-restaurant-pos");
    assert_eq!(imp.context.type_key, "restaurant-pos");
    assert_eq!(imp.context.terminal_id, "terminal-1");

    // The produced token resolves to the target's scope.
    let resolved = app
        .state::<AppState>()
        .resolve_session(&imp.session_token)
        .expect("impersonation token must resolve");
    assert_eq!(resolved.user_id, "user-target");
    assert_eq!(resolved.role_id, "role-owner");
    assert_eq!(resolved.store_id, "default");
}

#[tokio::test]
async fn impersonate_user_scoped_revoked_by_destroy_session() {
    let conn = migrations::fresh_db();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let login = auth::create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: {
                let s = app.state::<AppState>();
                mint_ticket(&s, "user-owner")
            },
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let imp = auth::impersonate_user_scoped(
        login.session_token.clone(),
        "user-target".into(),
        app.state(),
    )
    .await
    .unwrap();

    // Stopping the impersonation (destroy_session) must revoke the token.
    let revoked = auth::destroy_session(app.state(), imp.session_token.clone()).await;
    assert!(
        revoked.is_ok(),
        "destroy_session must accept the impersonation token"
    );

    let after = app.state::<AppState>().resolve_session(&imp.session_token);
    assert!(
        matches!(after, Err(AppError::InvalidSession)),
        "revoked impersonation token must not resolve: {:?}",
        after.err()
    );
}

#[tokio::test]
async fn impersonate_user_scoped_enforces_ttl() {
    let conn = migrations::fresh_db();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let login = auth::create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: {
                let s = app.state::<AppState>();
                mint_ticket(&s, "user-owner")
            },
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let imp = auth::impersonate_user_scoped(
        login.session_token.clone(),
        "user-target".into(),
        app.state(),
    )
    .await
    .unwrap();

    // The impersonation session must carry a finite TTL reflecting the named
    // constant — never an open-ended (None) session.
    let stored = app
        .state::<AppState>()
        .session_store
        .read()
        .unwrap()
        .get(&imp.session_token)
        .cloned()
        .expect("impersonation session stored");
    let expiry = stored
        .expires_at
        .expect("impersonation must set expires_at");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert!(expiry > now, "impersonation expiry must be in the future");
    assert!(
        expiry >= now + auth::IMPERSONATION_SESSION_TTL_SECONDS - 2
            && expiry <= now + auth::IMPERSONATION_SESSION_TTL_SECONDS + 2,
        "impersonation expiry must reflect IMPERSONATION_SESSION_TTL_SECONDS (now={now}, expiry={expiry})"
    );

    // And the TTL is actually enforced: forcing the stored session into the past
    // makes the token reject on resolution.
    {
        let app_state = app.state::<AppState>();
        let mut sessions = app_state.session_store.write().unwrap();
        if let Some(ctx) = sessions.get_mut(&imp.session_token) {
            ctx.expires_at = Some(1); // far in the past
        }
    }
    let expired = app.state::<AppState>().resolve_session(&imp.session_token);
    assert!(
        matches!(expired, Err(AppError::InvalidSession)),
        "expired impersonation token must not resolve"
    );
}

#[tokio::test]
async fn impersonate_user_scoped_denies_without_operator_permission() {
    let conn = migrations::fresh_db();
    // A staff user with no operator:impersonate grant.
    seed_staff_no_products(&conn);
    seed_target_owner(&conn);
    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Operator is a lite (staff) user — holds sales:view only.
    insert_session(
        &app.state::<AppState>(),
        "lite-token",
        "user-lite",
        "role-lite",
        "default",
    );

    let result =
        auth::impersonate_user_scoped("lite-token".into(), "user-target".into(), app.state()).await;
    assert!(
        matches!(result, Err(AppError::PermissionDenied(_))),
        "impersonation without operator:impersonate must be denied: {:?}",
        result.err()
    );
}

// ── get_setting secret redaction (C-2) ───────────────────────────

#[tokio::test]
async fn get_setting_scoped_redacts_sync_api_key() {
    let conn = migrations::fresh_db();
    // F-017: get_setting_scoped now requires settings:read — seed the owner
    // user/role so the gate passes and the redaction itself is exercised.
    seed_owner_user(&conn);
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('sync_api_key', 'sk-live-abc123', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let state = test_state(conn);
    insert_session(&state, "owner-tok", "user-owner", "role-owner", "default");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        settings::get_setting_scoped("sync_api_key".into(), "owner-tok".into(), app.state()).await;
    // C-2: secret key must return None, not the plaintext value
    assert!(matches!(result, Ok(None)), "secret key must be redacted");
}
#[tokio::test]
async fn get_setting_scoped_allows_non_secret_key() {
    // Settings live in the global DB; get_setting (unscoped) reads from
    // it via state.db. This test verifies that non-secret keys pass
    // through the deny-list check correctly.
    let conn = migrations::fresh_db();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('store.name', 'My Store', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let state = test_state(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Use the unscoped get_setting (reads from global DB).
    let result = settings::get_setting("store.name".into(), app.state()).await;
    assert_eq!(result.unwrap(), Some("My Store".into()));
}
