use super::*;
use kasirmu_core::migrations;
use kasirmu_core::permissions;

fn seeded_store() -> rusqlite::Connection {
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    // role-lite: narrow custom role with loyalty:view only — the new
    // role-staff preset grants loyalty:manage too, which would flip the
    // LOYALTY_MANAGE denial below (0048 retirement sweep).
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited loyalty view', '[\"loyalty:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    conn
}

#[test]
fn unregistered_permission_denies_owner_through_the_gate() {
    let conn = seeded_store();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);

    // The `*` Owner grant covers every registered key but must NOT cover
    // an unregistered one — deny-by-default survives the client wrapper
    // and still surfaces as `permissionDenied`, not a core error.
    assert!(matches!(
        require_permission_for_user(&store, "user-owner", "sales:typo"),
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        require_permission_for_user(&store, "user-owner", "sales:void"),
        Ok(())
    ));
}

#[test]
fn user_permission_check_uses_database_role() {
    let conn = seeded_store();
    let store = Store::new(&conn);

    assert!(require_permission_for_user(&store, "user-cashier", permissions::LOYALTY_VIEW).is_ok());
    assert!(matches!(
        require_permission_for_user(&store, "user-cashier", permissions::LOYALTY_MANAGE),
        Err(AppError::PermissionDenied(_))
    ));
}

#[test]
fn missing_user_is_denied_even_when_role_id_is_known() {
    let conn = seeded_store();
    let store = Store::new(&conn);

    assert!(matches!(
        require_permission_for_user(&store, "role-owner", permissions::LOYALTY_MANAGE),
        Err(AppError::PermissionDenied(_))
    ));
}

#[test]
fn inactive_user_is_denied_even_with_granted_permission() {
    let conn = seeded_store();
    conn.execute(
        "UPDATE users SET is_active = 0 WHERE id = 'user-cashier'",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);

    assert!(matches!(
        require_permission_for_user(&store, "user-cashier", permissions::LOYALTY_VIEW),
        Err(AppError::PermissionDenied(message)) if message == "user is inactive"
    ));
}

#[test]
fn owner_role_grants_loyalty_management() {
    let conn = seeded_store();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);

    assert!(require_permission_for_user(&store, "user-owner", permissions::LOYALTY_MANAGE).is_ok());
}

/// Pins the identity-DB authorization design: scoped commands must
/// authorize the session user against the GLOBAL identity DB, never the
/// store-scoped DB. The global DB holds the owner row (STAFF_UPDATE
/// granted); the store DB runs the same migrations but has NO users, so
/// the old pattern (`require_permission_for_user` on the store
/// connection) denied every caller — the topology Apply "You don't have
/// permission to do this." bug.
#[tokio::test]
async fn session_permission_checks_global_identity_db_not_store_db() {
    use kasirmu_core::session::SessionContext;

    use crate::state::AppState;

    // Global identity DB: migrated, roles seeded, owner created with a
    // FIXED id (create_user mints a UUID). This mirrors `bootstrap_owner`
    // (staff lives ONLY here).
    let conn = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }

    let mut state = AppState::for_test_with_conn(conn);
    // Isolate the store DBs in a temp dir so the store-scoped file is
    // created fresh (empty `users` table) instead of reusing temp-dir
    // leftovers from other tests.
    let dir = std::env::temp_dir().join(format!("oz-authz-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(dir.clone(), kasirmu_core::migrations::ALL);

    let session = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-a".into(),
        "i1".into(),
        "store-pos".into(),
        None,
        0,
    );

    // The new gate: resolves the owner from the global DB -> allowed.
    require_permission_for_session(&state, &session, permissions::STAFF_UPDATE)
        .await
        .expect("owner must be authorized from the global identity DB");

    // The old gate: same user looked up on the store DB -> denied,
    // exactly the reported "You don't have permission to do this.".
    let store_conn = state
        .db_manager
        .open_store("store-a")
        .expect("open store db");
    let store_db = store_conn.lock().unwrap();
    let store = Store::new(&store_db);
    assert!(
        store.get_user("user-owner").unwrap().is_none(),
        "store DB must not contain global identity rows"
    );
    assert!(matches!(
        require_permission_for_user(&store, "user-owner", permissions::STAFF_UPDATE),
        Err(AppError::PermissionDenied(_))
    ));

    drop(store_db);
    drop(state);
    let _ = std::fs::remove_dir_all(&dir);
}

/// TDD red (scoped sessions follow-up): the session gate must be
/// scope-aware. A scoped user whose session context is out of scope is
/// denied even when the role grants the permission — a session minted
/// for a store/workspace the assignment does not cover must fail
/// closed on EVERY command, not just at the picker.
#[tokio::test]
async fn session_gate_enforces_scoped_assignment_workspace_dimension() {
    use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};
    use kasirmu_core::session::SessionContext;

    use crate::state::AppState;

    // Owner scoped to workspace type `store-pos` only (branches all).
    let conn = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        store
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Scoped,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: false,
                    workspaces: vec!["store-pos".into()],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    }
    let state = AppState::for_test_with_conn(conn);

    // In-scope session context (store-a / store-pos) passes.
    let in_scope = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-a".into(),
        "i1".into(),
        "store-pos".into(),
        None,
        0,
    );
    require_permission_for_session(&state, &in_scope, permissions::STAFF_UPDATE)
        .await
        .expect("in-scope session must pass the scope-aware gate");

    // Out-of-scope workspace type (store-a / kds): the role grants
    // STAFF_UPDATE but the assignment does not cover kds — deny.
    let out_of_scope_type = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-a".into(),
        "i2".into(),
        "kds".into(),
        None,
        0,
    );
    assert!(matches!(
        require_permission_for_session(&state, &out_of_scope_type, permissions::STAFF_UPDATE).await,
        Err(AppError::PermissionDenied(_))
    ));
}

#[tokio::test]
async fn session_gate_enforces_scoped_assignment_branch_dimension() {
    use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};
    use kasirmu_core::session::SessionContext;

    use crate::state::AppState;

    // Owner scoped to branch store-a only (workspaces all).
    let conn = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        store
            .set_assignment(
                "user-owner",
                "role-owner",
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
    }
    let state = AppState::for_test_with_conn(conn);

    // In-scope branch passes.
    let in_scope = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-a".into(),
        "i1".into(),
        "store-pos".into(),
        None,
        0,
    );
    require_permission_for_session(&state, &in_scope, permissions::STAFF_UPDATE)
        .await
        .expect("in-scope branch must pass the scope-aware gate");

    // Out-of-scope branch (store-b): deny fail-closed.
    let out_of_scope_branch = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-b".into(),
        "i1".into(),
        "store-pos".into(),
        None,
        0,
    );
    assert!(matches!(
        require_permission_for_session(&state, &out_of_scope_branch, permissions::STAFF_UPDATE)
            .await,
        Err(AppError::PermissionDenied(_))
    ));
}

#[tokio::test]
async fn session_gate_passes_global_and_legacy_users_unrestricted() {
    // Note: "unrestricted" refers to SCOPE (no assignment row = global
    // scope), not permissions — legacy role-staff is checkout-only and is
    // still denied staff:* grants.
    use kasirmu_core::db::assignments::{AssignmentSpec, ScopeMode, ScopeType};
    use kasirmu_core::session::SessionContext;

    use crate::state::AppState;

    // user-legacy: NO assignment row — not scope-restricted.
    let conn = kasirmu_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute_batch(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('user-owner',  'owner',  'hash', 'Owner',  'role-owner',  1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
                ('user-legacy', 'legacy', 'hash', 'Legacy', 'role-staff',  1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
        )
        .unwrap();
        store
            .set_assignment(
                "user-owner",
                "role-owner",
                &AssignmentSpec {
                    scope_mode: ScopeMode::Global,
                    branches_all: true,
                    branches: vec![],
                    workspaces_all: true,
                    workspaces: vec![],
                    scope_type: ScopeType::Organization,
                    scope_id: None,
                },
            )
            .unwrap();
    }
    let state = AppState::for_test_with_conn(conn);

    // A global assignment ignores both dimensions — any context passes.
    let global_session = SessionContext::new(
        "user-owner".into(),
        "role-owner".into(),
        "t1".into(),
        "store-b".into(),
        "i1".into(),
        "kds".into(),
        None,
        0,
    );
    require_permission_for_session(&state, &global_session, permissions::STAFF_UPDATE)
        .await
        .expect("global assignments must not be scope-restricted");

    // A legacy user without an assignment is not scope-restricted, so a
    // checkout grant passes in any context — but the role decides which
    // grants exist: staff:read is denied (checkout-only).
    let legacy_session = SessionContext::new(
        "user-legacy".into(),
        "role-staff".into(),
        "t1".into(),
        "store-a".into(),
        "i1".into(),
        "store-pos".into(),
        None,
        0,
    );
    require_permission_for_session(&state, &legacy_session, permissions::SALES_PROCESS)
        .await
        .expect("legacy users without an assignment must not be scope-restricted");
    let denied =
        require_permission_for_session(&state, &legacy_session, permissions::STAFF_READ).await;
    assert!(
        matches!(denied, Err(AppError::PermissionDenied(_))),
        "legacy role-staff is checkout-only — staff:read must be denied"
    );
}
