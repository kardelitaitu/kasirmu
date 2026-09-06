use super::*;
use crate::state::AppState;
use oz_core::db::Store;
use oz_core::migrations;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager;

// ── StoreProfileDto ─────────────────────────────────────────────────

#[test]
fn store_profile_dto_debug() {
    let dto = StoreProfileDto {
        id: "sp1".into(),
        name: "Main Store".into(),
        address: "123 Main St".into(),
        tax_id: "TAX-001".into(),
        currency: "USD".into(),
        timezone: "UTC".into(),
        is_primary: true,
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Main Store"));
    assert!(d.contains("USD"));
}

#[test]
fn store_profile_dto_serialize() {
    let dto = StoreProfileDto {
        id: "sp2".into(),
        name: "Branch".into(),
        address: String::new(),
        tax_id: String::new(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        is_primary: false,
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Branch");
    assert_eq!(json["is_primary"], false);
}

// ── CreateStoreProfileArgs ──────────────────────────────────────────

#[test]
fn create_store_profile_args_deserialize_minimal() {
    let json = r#"{"id":"sp-new","name":"New Store"}"#;
    let args: CreateStoreProfileArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "sp-new");
    assert_eq!(args.address, None);
    assert_eq!(args.currency, None);
}

#[test]
fn create_store_profile_args_deserialize_full() {
    let json = r##"{"id":"sp-full","name":"Full Store","address":"123 Rd","tax_id":"T1","currency":"EUR","timezone":"CET"}"##;
    let args: CreateStoreProfileArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.currency.as_deref(), Some("EUR"));
    assert_eq!(args.timezone.as_deref(), Some("CET"));
}

#[test]
fn create_store_profile_args_debug() {
    let args = CreateStoreProfileArgs {
        id: "x".into(),
        name: "Y".into(),
        address: None,
        tax_id: None,
        currency: None,
        timezone: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("Y"));
}

// ── UpdateStoreProfileArgs ──────────────────────────────────────────

#[test]
fn update_store_profile_args_deserialize() {
    let json = r##"{"id":"sp1","name":"Updated","address":"New Rd","tax_id":"T2","currency":"USD","timezone":"EST"}"##;
    let args: UpdateStoreProfileArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "Updated");
    assert_eq!(args.address, "New Rd");
}

#[test]
fn update_store_profile_args_debug() {
    let args = UpdateStoreProfileArgs {
        id: "x".into(),
        name: "Z".into(),
        address: "A".into(),
        tax_id: "T".into(),
        currency: "C".into(),
        timezone: "TZ".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("Z"));
}

// ── create_store_profile_scoped flow ────────────────────────────────
//
// The scoped command resolves the session's STORE database and then runs
// the tenant-subscription quota gate + profile INSERT against it. These
// tests pin the end-to-end behaviour (C1.2 quota, seeded rows, permission
// gating) so the branch-creation flow cannot silently regress.

/// Seed roles + the owner user (full permissions) into the global DB.
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

/// AppState with a fresh migrated global DB and an isolated store-db dir
/// (mirrors the security_scoped_integration_tests harness).
fn flow_state(conn: rusqlite::Connection) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    // Leak the tempdir for the lifetime of the test process — the manager
    // keeps connections open and the path must outlive the state.
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

/// The full happy path on a fresh migrated state: the store db the session
/// resolves to already contains exactly one `default` profile row (the
/// migration seed). Debug builds mirror `get_subscription_capabilities`'s
/// dev shim — the bootstrap Free tier is upgraded to Premium before the
/// quota gate — so branch creation must SUCCEED here. This is the exact
/// flow that used to dead-end every dev user with a subscription-limit
/// rejection despite the UI reporting unlimited stores.
#[tokio::test]
async fn create_store_profile_scoped_end_to_end_owner() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    state.session_store.write().unwrap().insert(
        "owner-tok".into(),
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
    let app = mock_app(state);

    let result = create_store_profile_scoped(
        CreateStoreProfileArgs {
            id: "store-test-1".into(),
            name: "Second Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
        "owner-tok".into(),
        app.state(),
    )
    .await;

    let created = result.unwrap();
    assert_eq!(created.id, "store-test-1");
    assert_eq!(created.name, "Second Branch");
    assert!(!created.is_primary);

    // The row must now exist in the store-scoped profile registry.
    let conn = app
        .state::<AppState>()
        .db_manager
        .open_store("default")
        .unwrap();
    let count: i64 = conn
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2); // migration seed + the new branch
}

/// A Plus tenant allows 1 store, and the migrated store db already contains
/// the `default` profile row — so a second creation must be rejected with
/// the typed subscription-limit error (mapped to the localized plan copy on
/// the front-end), NEVER a generic Internal/Db error. Plus is used instead
/// of Free because debug builds upgrade only the bootstrap Free tier.
#[tokio::test]
async fn create_store_profile_scoped_rejects_when_plus_quota_reached() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    state.session_store.write().unwrap().insert(
        "owner-tok".into(),
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
    // Re-tier the tenant to Plus (max 1 store — already consumed by the
    // migration-seeded `default` profile). Debug builds shim only Free, so
    // this row exercises the real quota gate.
    {
        let store_conn = state.db_manager.open_store("default").unwrap();
        store_conn
            .lock()
            .unwrap()
            .execute(
                "UPDATE tenant_subscription SET tier_key = 'plus' WHERE tenant_id = 'default'",
                [],
            )
            .unwrap();
    }
    let app = mock_app(state);

    let result = create_store_profile_scoped(
        CreateStoreProfileArgs {
            id: "store-test-2".into(),
            name: "Third Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
        "owner-tok".into(),
        app.state(),
    )
    .await;

    match result {
        // Typed quota rejection is the CORRECT outcome (mapped to the
        // subscription error copy on the front-end).
        Err(AppError::Core { sub_kind, .. }) => {
            assert_eq!(
                format!("{sub_kind:?}").to_lowercase(),
                "subscriptionlimitexceeded"
            );
        }
        other => panic!("expected typed subscription-limit rejection, got: {other:?}"),
    }
}

/// A staff session without `settings:edit` must be denied — typed
/// PermissionDenied, not Internal.
#[tokio::test]
async fn create_store_profile_scoped_denies_staff_without_settings_edit() {
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

    let result = create_store_profile_scoped(
        CreateStoreProfileArgs {
            id: "store-test-3".into(),
            name: "Staff Branch".into(),
            address: None,
            tax_id: None,
            currency: None,
            timezone: None,
        },
        "lite-tok".into(),
        app.state(),
    )
    .await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
