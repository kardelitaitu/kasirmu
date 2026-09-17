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
