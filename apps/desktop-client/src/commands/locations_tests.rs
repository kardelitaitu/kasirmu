// Canonical location command tests. The pre-migration file also pinned the
// deprecated `store_profile` alias shapes and invoked the legacy IPC names;
// those aliases retired with the Store → Location caller migration
// (todo-global-saas-1.md slice 1c/1d), so the suite now exercises the
// canonical names only.
#![allow(deprecated)]

use super::*;
use crate::state::AppState;
use oz_core::db::Store;
use oz_core::migrations;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use serde_json::json;
use tauri::Manager;

// ── DTO + args serde shapes ─────────────────────────────────────────

#[test]
fn location_profile_dto_serialize() {
    let dto = LocationProfileDto {
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
    let v = serde_json::to_value(&dto).unwrap();
    assert_eq!(v["id"], "sp2");
    assert_eq!(v["name"], "Branch");
    assert_eq!(v["is_primary"], false);
    assert_eq!(v["currency"], "IDR");
    assert_eq!(v["timezone"], "Asia/Jakarta");
}

#[test]
fn create_location_args_deserialize_minimal() {
    let v = json!({"id":"sp-new","name":"New Location"});
    let args: CreateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.id, "sp-new");
    assert_eq!(args.address, None);
    assert_eq!(args.currency, None);
}

#[test]
fn create_location_args_deserialize_full() {
    let v = json!({"id":"sp-full","name":"Full Location","address":"123 Rd","tax_id":"T1","currency":"EUR","timezone":"CET"});
    let args: CreateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.currency.as_deref(), Some("EUR"));
    assert_eq!(args.timezone.as_deref(), Some("CET"));
}

#[test]
fn update_location_args_deserialize() {
    let v = json!({"id":"sp1","name":"Updated","address":"New Rd","tax_id":"T2","currency":"USD","timezone":"EST"});
    let args: UpdateLocationArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.name, "Updated");
    assert_eq!(args.address, "New Rd");
}

// ── create_location_profile_scoped flow ─────────────────────────────
//
// The scoped command resolves the session's location database and then runs
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

/// AppState with a fresh migrated global DB and an isolated location-db dir
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

/// The full happy path on a fresh migrated state: the location db the session
/// resolves to already contains exactly one `default` profile row (the
/// migration seed). Debug builds mirror `get_subscription_capabilities`'s
/// dev shim — the bootstrap Free tier is upgraded to Premium before the
/// quota gate — so branch creation must SUCCEED here. This is the exact
/// flow that used to dead-end every dev user with a subscription-limit
/// rejection despite the UI reporting unlimited locations.
#[tokio::test]
async fn create_location_profile_scoped_end_to_end_owner() {
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

    let result = create_location_profile_scoped(
        CreateLocationArgs {
            id: "location-test-1".into(),
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
    assert_eq!(created.id, "location-test-1");
    assert_eq!(created.name, "Second Branch");
    assert!(!created.is_primary);

    // The row must now exist in the location-scoped profile registry.
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

/// A Plus tenant allows 1 location, and the migrated location db already
/// contains the `default` profile row — so a second creation must be rejected
/// with the typed subscription-limit error (mapped to the localized plan copy
/// on the front-end), NEVER a generic Internal/Db error. Plus is used instead
/// of Free because debug builds upgrade only the bootstrap Free tier.
#[tokio::test]
async fn create_location_profile_scoped_rejects_when_plus_quota_reached() {
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
    // Re-tier the tenant to Plus (max 1 location — already consumed by the
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

    let result = create_location_profile_scoped(
        CreateLocationArgs {
            id: "location-test-2".into(),
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
async fn create_location_profile_scoped_denies_staff_without_settings_edit() {
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

    let result = create_location_profile_scoped(
        CreateLocationArgs {
            id: "location-test-3".into(),
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

// ── ADR #47 resource-scope gating ───────────────────────────────────

/// Seed a manager user whose assignment is location-scoped to
/// `location_id`. `scope_mode` stays `global` so the spec-0048
/// branch/workspace axis passes any session context and the ADR #47
/// resource gate is exercised in isolation.
fn seed_location_scoped_manager(conn: &rusqlite::Connection, location_id: &str) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-manager', 'Manager', 'Location manager', '[\"settings:edit\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('user-manager', 'role-manager', 'global', 'all', 'all', 'location', ?1)",
        [location_id],
    )
    .unwrap();
}

fn manager_session(state: &AppState, token: &str) {
    state.session_store.write().unwrap().insert(
        token.to_string(),
        SessionContext::new(
            "user-manager".into(),
            "role-manager".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
}

/// ADR #47 ruling-3 pin: a manager assigned to location A cannot update
/// location B. The branch/workspace axis deliberately passes (global
/// scope_mode), so the typed denial can only come from the resource
/// scope — the gate this slice added.
#[tokio::test]
async fn update_location_profile_scoped_denies_manager_of_other_location() {
    let conn = migrations::fresh_db();
    seed_location_scoped_manager(&conn, "loc-a");
    let state = flow_state(conn);
    manager_session(&state, "mgr-tok");
    let app = mock_app(state);

    let result = update_location_profile_scoped(
        UpdateLocationArgs {
            id: "loc-b".into(),
            name: "Hostile Rename".into(),
            address: "1 Elsewhere".into(),
            tax_id: String::new(),
            currency: "USD".into(),
            timezone: "UTC".into(),
        },
        "mgr-tok".into(),
        app.state(),
    )
    .await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

/// The mirror pin: the SAME manager CAN update the location their
/// assignment covers (here `default`, whose profile row exists in the
/// session's migrated location db) — the gate narrows scoped roles, it
/// does not blanket-deny them.
#[tokio::test]
async fn update_location_profile_scoped_allows_manager_of_own_location() {
    let conn = migrations::fresh_db();
    seed_location_scoped_manager(&conn, "default");
    let state = flow_state(conn);
    manager_session(&state, "mgr-tok");
    let app = mock_app(state);

    let result = update_location_profile_scoped(
        UpdateLocationArgs {
            id: "default".into(),
            name: "Renamed Flagship".into(),
            address: "1 Main St".into(),
            tax_id: String::new(),
            currency: "USD".into(),
            timezone: "UTC".into(),
        },
        "mgr-tok".into(),
        app.state(),
    )
    .await;

    let updated = result.expect("own-location update must pass the resource gate");
    assert_eq!(updated.name, "Renamed Flagship");
}
