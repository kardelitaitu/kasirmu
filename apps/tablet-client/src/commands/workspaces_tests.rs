use super::*;

use oz_core::StoreProfile;
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

fn make_profile(id: &str, name: &str) -> StoreProfile {
    StoreProfile {
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
/// temp-dir store manager with store-a (1 instance) so role binding can
/// be exercised.
fn picker_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    seed_global_users(&conn);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);

    let conn = state.db_manager.open_store("store-a").unwrap();
    let db = conn.lock().unwrap();
    let store = Store::new(&db);
    store
        .create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    store
        .create_workspace_instance("ws-a-1", "store-pos", "store-a", "POS", "", None)
        .unwrap();
    drop(db);
    (state, temp_dir)
}

fn sign_ticket_for(state: &AppState, user_id: &str, ttl_offset: i64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    picker_ticket::sign_picker_ticket(&state.picker_ticket_secret, user_id, now + ttl_offset)
}

#[tokio::test]
async fn list_workspaces_rejects_forged_or_missing_ticket() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    for ticket in [
        String::new(),
        "garbage-not-a-ticket".into(),
        picker_ticket::sign_picker_ticket(
            b"attacker-secret",
            "user-owner",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
                + 300,
        ),
    ] {
        let result = list_workspaces(app.state(), ticket.clone(), "store-a".into()).await;
        assert!(
            matches!(result, Err(AppError::PermissionDenied(_))),
            "ticket {ticket:?} must be denied"
        );
    }
}

#[tokio::test]
async fn list_workspaces_rejects_expired_ticket() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let expired = sign_ticket_for(&app.state(), "user-owner", -1);
    let result = list_workspaces(app.state(), expired, "store-a".into()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn list_workspaces_rejects_unknown_user_even_with_valid_signature() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let ghost = sign_ticket_for(&app.state(), "user-deleted", 300);
    let result = list_workspaces(app.state(), ghost, "store-a".into()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn list_workspaces_uses_real_role_not_claimed_role() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let owner_ticket = sign_ticket_for(&app.state(), "user-owner", 300);
    let owner_rows = list_workspaces(app.state(), owner_ticket, "store-a".into())
        .await
        .unwrap();
    assert!(owner_rows.iter().any(|d| d.instance_id == "ws-a-1"));

    let cashier_ticket = sign_ticket_for(&app.state(), "user-cashier", 300);
    let cashier_rows = list_workspaces(app.state(), cashier_ticket, "store-a".into())
        .await
        .unwrap();
    assert!(
        cashier_rows.is_empty(),
        "cashier role must not see owner-level instances, got {cashier_rows:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_filters_picker_workspace_list() {
    let (state, _dir) = picker_state();
    // Add a second instance of a different workspace type to store-a so
    // the workspace dimension of a scoped assignment has something to
    // filter (the owner bypass would otherwise list both).
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        Store::new(&db)
            .create_workspace_instance("ws-a-2", "kds", "store-a", "Kitchen", "", None)
            .unwrap();
    }
    // The owner keeps the legacy owner bypass (both instances would
    // list) but the assignment scope now limits the picker to the
    // store-pos workspace type (ADR #35 D5 / spec 0048).
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
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let ticket = sign_ticket_for(&app.state(), "user-owner", 300);
    let rows = list_workspaces(app.state(), ticket, "store-a".into())
        .await
        .unwrap();
    assert!(
        rows.iter().any(|d| d.type_key == "store-pos"),
        "in-scope workspace type must list, got {rows:?}"
    );
    assert!(
        rows.iter().all(|d| d.type_key != "kds"),
        "out-of-scope workspace type must be hidden, got {rows:?}"
    );
}

#[tokio::test]
async fn scoped_assignment_branch_dimension_denies_out_of_scope_store() {
    let (state, _dir) = picker_state();
    // Add store-b so the branch dimension has an out-of-scope target.
    {
        let conn = state.db_manager.open_store("store-b").unwrap();
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store
            .create_store_profile(&make_profile("store-b", "Store B"))
            .unwrap();
        store
            .create_workspace_instance("ws-b-1", "store-pos", "store-b", "POS", "", None)
            .unwrap();
    }
    // Owner scoped to branch store-a only — store-b is out of scope, so
    // listing it must yield nothing (fail closed per ADR #35 D5).
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
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    let ticket = sign_ticket_for(&app.state(), "user-owner", 300);
    let in_scope = list_workspaces(app.state(), ticket.clone(), "store-a".into())
        .await
        .unwrap();
    assert!(in_scope.iter().any(|d| d.instance_id == "ws-a-1"));
    let out_of_scope = list_workspaces(app.state(), ticket, "store-b".into())
        .await
        .unwrap();
    assert!(
        out_of_scope.is_empty(),
        "branch out of scope must deny the whole store, got {out_of_scope:?}"
    );
}

#[tokio::test]
async fn list_workspaces_inactive_user_is_denied() {
    let (state, _dir) = picker_state();
    {
        let db = state.db.lock().await;
        db.execute("UPDATE users SET is_active = 0 WHERE id = 'user-owner'", [])
            .unwrap();
    }
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let ticket = sign_ticket_for(&app.state(), "user-owner", 300);
    let result = list_workspaces(app.state(), ticket, "store-a".into()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn list_workspace_screens_requires_valid_ticket() {
    let (state, _dir) = picker_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let denied = list_workspace_screens(
        app.state(),
        "bogus".into(),
        "store-pos".into(),
        "store-a".into(),
    )
    .await;
    assert!(matches!(denied, Err(AppError::PermissionDenied(_))));

    let ticket = sign_ticket_for(&app.state(), "user-owner", 300);
    let allowed =
        list_workspace_screens(app.state(), ticket, "store-pos".into(), "store-a".into()).await;
    assert!(allowed.is_ok());
}

#[tokio::test]
async fn resolve_boot_store_returns_primary_store() {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let now = "2026-07-31T00:00:00.000Z";
    conn.execute(
        "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
         VALUES ('store-main', 'Main', '', '', 'USD', 'UTC', 1, ?1, ?1)",
        [now],
    )
    .unwrap();
    let _ = store;
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let resolution = resolve_boot_store(app.state(), None).await.unwrap();
    assert_eq!(resolution.store_id, "store-main");
    assert!(!resolution.is_bound);
    assert!(resolution.instance_id.is_none());
}

// ── Device binding auto-boot (parity with desktop client) ───────────

use oz_core::Terminal;
use oz_security::Keyring as _;

/// HMAC-SHA256 hex over `{terminal}:{store}:{instance}` with a fixed
/// secret — mirrors `sign_binding` so tests can forge bindings.
fn hmac_hex(secret: &str, terminal_id: &str, store_id: &str, instance_id: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(terminal_id.as_bytes());
    mac.update(b":");
    mac.update(store_id.as_bytes());
    mac.update(b":");
    mac.update(instance_id.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Global DB with a bound terminal (device "tablet-1" → store-a/ws-a-1,
/// signed with a known in-memory keyring secret) + a store-a DB with the
/// instance. Primary store row exists in the global DB for fallbacks.
fn binding_state() -> (AppState, tempfile::TempDir, oz_security::InMemoryKeyring) {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    let keyring = oz_security::InMemoryKeyring::new();
    keyring
        .set_secret(
            crate::commands::terminals::DEVICE_BINDING_KEYRING_NAME,
            "test-binding-secret",
        )
        .unwrap();

    let terminal = Terminal::new("Tablet-1", "tablet-1");
    store.create_terminal(&terminal).unwrap();
    // `bound_store_id` is FK-enforced against the global `locations`,
    // and `resolve_boot_store` reads the primary from the same table.
    let now = "2026-07-31T00:00:00.000Z";
    conn.execute(
        "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
         VALUES ('store-a', 'Store A', '', '', 'USD', 'UTC', 0, ?1, ?1), ('store-main', 'Main', '', '', 'USD', 'UTC', 1, ?1, ?1)",
        [now],
    )
    .unwrap();
    let sig = hmac_hex("test-binding-secret", &terminal.id, "store-a", "ws-a-1");
    store
        .update_terminal_binding(&terminal.id, "store-a", "ws-a-1", &sig)
        .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    let conn = state.db_manager.open_store("store-a").unwrap();
    let db = conn.lock().unwrap();
    let store = Store::new(&db);
    store
        .create_store_profile(&make_profile("store-a", "Store A"))
        .unwrap();
    store
        .create_workspace_instance("ws-a-1", "store-pos", "store-a", "POS", "", None)
        .unwrap();
    drop(db);
    (state, temp_dir, keyring)
}

#[tokio::test]
async fn resolve_boot_store_autoboots_into_bound_instance() {
    let (state, _dir, keyring) = binding_state();
    let db = state.db.lock().await;
    let resolution =
        resolve_boot_store_core(&db, &state.db_manager, "tablet-1", Some(&keyring)).unwrap();
    assert!(resolution.is_bound, "valid binding must auto-boot");
    assert_eq!(resolution.store_id, "store-a");
    assert_eq!(resolution.instance_id.as_deref(), Some("ws-a-1"));
}

#[tokio::test]
async fn resolve_boot_store_tampered_binding_falls_back_to_primary() {
    let (state, _dir, _keyring) = binding_state();
    // A DIFFERENT keyring secret — the DB row was not signed by this
    // device's secret, so the HMAC must fail and resolution degrades.
    let other = oz_security::InMemoryKeyring::new();
    other
        .set_secret(
            crate::commands::terminals::DEVICE_BINDING_KEYRING_NAME,
            "attacker-secret",
        )
        .unwrap();
    let db = state.db.lock().await;
    let resolution =
        resolve_boot_store_core(&db, &state.db_manager, "tablet-1", Some(&other)).unwrap();
    assert!(!resolution.is_bound);
    assert_eq!(resolution.store_id, "store-main");
}

#[tokio::test]
async fn resolve_boot_store_bound_instance_missing_falls_back_to_primary() {
    let (state, _dir, keyring) = binding_state();
    // Valid signature, but the bound instance was archived/deleted.
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store.archive_instance("ws-a-1").unwrap();
        drop(db);
    }
    let db = state.db.lock().await;
    let resolution =
        resolve_boot_store_core(&db, &state.db_manager, "tablet-1", Some(&keyring)).unwrap();
    assert!(!resolution.is_bound);
    assert_eq!(resolution.store_id, "store-main");
}

#[tokio::test]
async fn resolve_boot_store_unknown_device_falls_back_to_primary() {
    let (state, _dir, keyring) = binding_state();
    let db = state.db.lock().await;
    let resolution =
        resolve_boot_store_core(&db, &state.db_manager, "ghost-device", Some(&keyring)).unwrap();
    assert!(!resolution.is_bound);
    assert_eq!(resolution.store_id, "store-main");
}

#[test]
fn verify_binding_hmac_valid_signature_passes() {
    let sig = hmac_hex("secret", "term-1", "store-a", "ws-a-1");
    assert!(verify_binding_hmac(
        "secret", "term-1", "store-a", "ws-a-1", &sig
    ));
}

#[test]
fn verify_binding_hmac_tampered_signature_fails() {
    let sig = hmac_hex("secret", "term-1", "store-a", "ws-a-1");
    assert!(!verify_binding_hmac(
        "secret", "term-1", "store-a", "ws-a-2", &sig
    ));
    assert!(!verify_binding_hmac(
        "other", "term-1", "store-a", "ws-a-1", &sig
    ));
}

#[test]
fn verify_binding_hmac_garbage_hex_fails() {
    assert!(!verify_binding_hmac(
        "secret", "term-1", "store-a", "ws-a-1", "not-hex!"
    ));
    assert!(!verify_binding_hmac(
        "secret", "term-1", "store-a", "ws-a-1", ""
    ));
}
