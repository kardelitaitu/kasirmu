use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_roles(conn: &Connection) {
    store(conn).seed_default_roles().unwrap();
}

fn seed_users(conn: &Connection) {
    store(conn).seed_default_roles().unwrap();
    // role-lite: a narrow custom role (sales:view only) standing in for
    // the retired cashier role � the gate tests below pin its LIMITED
    // grants (view yes, void no), which role-staff no longer provides.
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited sales view', '[\"sales:view\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-1', 'alice',   'hash_alice',   'Alice',   'role-lite',   1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('user-2', 'bob',     'hash_bob',     'Bob',     'role-owner',  1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('user-3', 'carol',   'hash_carol',   'Carol',   'role-lite',   0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

#[test]
fn seed_default_roles_resyncs_stale_builtin_role_permissions() {
    let conn = fresh();
    // Simulate a pre-existing database whose role-staff row still carries
    // the old, too-permissive grant list (folded cashier/kitchen era).
    conn.execute_batch(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-staff', 'Staff', 'stale', '["sales:process","sales:void","products:create"]',
             '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"#,
    )
    .unwrap();
    store(&conn).seed_default_roles().unwrap();
    let role = store(&conn)
        .get_role("role-staff")
        .unwrap()
        .expect("role-staff row must exist");
    // Converged to the preset: checkout-only, stale grants gone.
    assert!(!role.permissions.contains("sales:void"));
    assert!(!role.permissions.contains("products:create"));
    assert!(role.permissions.contains("sales:process"));
    assert!(role.permissions.contains("payments:cash"));
    // The gate enforces the converged grants.
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-s', 'sam', 'h', 'Sam', 'role-staff', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    assert!(
        store(&conn)
            .require_permission("user-s", "sales:process")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-s", "sales:void")
            .is_err()
    );
}

// ── Authorization gate (0047) ──────────────────────────────────

#[test]
fn gate_denies_unregistered_permission_even_for_owner() {
    let conn = fresh();
    seed_users(&conn);
    // bob is role-owner with the global `"*"` grant — a typo'd or
    // future key must STILL deny: unregistered means deny-by-default.
    let err = store(&conn)
        .require_permission("user-2", "sales:typo")
        .unwrap_err();
    assert!(matches!(err, CoreError::PermissionDenied(_)), "got {err:?}");
}

#[test]
fn gate_allows_registered_permission_for_owner() {
    let conn = fresh();
    seed_users(&conn);
    // The global `*` grant covers every registered key.
    assert!(
        store(&conn)
            .require_permission("user-2", "sales:void")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-2", "settings:edit")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-2", "kds:update")
            .is_ok()
    );
}

#[test]
fn gate_denies_unknown_user() {
    let conn = fresh();
    seed_users(&conn);
    let err = store(&conn)
        .require_permission("no-such-user", "sales:view")
        .unwrap_err();
    assert!(matches!(err, CoreError::PermissionDenied(_)), "got {err:?}");
}

#[test]
fn gate_denies_inactive_user() {
    let conn = fresh();
    seed_users(&conn);
    let err = store(&conn)
        .require_permission("user-3", "sales:view")
        .unwrap_err();
    assert!(matches!(err, CoreError::PermissionDenied(_)), "got {err:?}");
}

#[test]
fn gate_denies_user_with_unresolvable_role() {
    let conn = fresh();
    seed_roles(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-ghost', 'ghost', 'h', 'Ghost', 'role-staff', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    // The role row disappears out from under the user. FK enforcement
    // normally prevents this, but defense-in-depth demands the gate fail
    // closed even when it happens (FKs off, partial migration, tampered
    // DB) — so the test simulates it with FK enforcement off.
    conn.execute_batch("PRAGMA foreign_keys = OFF; DELETE FROM roles WHERE id = 'role-staff';")
        .unwrap();
    // Fail-closed: an unresolvable role is a denial, not an internal error.
    let err = store(&conn)
        .require_permission("user-ghost", "sales:view")
        .unwrap_err();
    assert!(matches!(err, CoreError::PermissionDenied(_)), "got {err:?}");
}

#[test]
fn gate_denies_permission_not_granted_to_role() {
    let conn = fresh();
    seed_users(&conn);
    // alice is cashier: has sales:view but not sales:void.
    assert!(
        store(&conn)
            .require_permission("user-1", "sales:view")
            .is_ok()
    );
    let err = store(&conn)
        .require_permission("user-1", "sales:void")
        .unwrap_err();
    assert!(matches!(err, CoreError::PermissionDenied(_)), "got {err:?}");
}

#[test]
fn gate_resolves_wildcard_grants_via_registry() {
    let conn = fresh();
    seed_roles(&conn);
    store(&conn)
        .create_role("role-wild", "Wild", "tables wildcard", "[\"tables:*\"]")
        .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-op', 'op', 'h', 'Op', 'role-wild', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    // tables:* has no sensitive keys, so the wildcard is a valid grant
    // and the gate resolves every operational tables action through it.
    assert!(
        store(&conn)
            .require_permission("user-op", "tables:assign")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-op", "tables:close")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-op", "sales:view")
            .is_err()
    );
}

#[test]
fn gate_resolves_sensitive_keys_only_by_explicit_grant() {
    let conn = fresh();
    seed_roles(&conn);
    // Explicit sensitive grant passes; a role without it is denied.
    store(&conn)
        .create_role("role-v", "Void", "explicit void", "[\"sales:void\"]")
        .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-v', 'v', 'h', 'V', 'role-v', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    assert!(
        store(&conn)
            .require_permission("user-v", "sales:void")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-v", "sales:refund")
            .is_err()
    );
}

// ── Assignment-aware gate (0048 cycle 2) ──────────────────────────

/// Seed a user whose legacy `role_id` and assignment role disagree, so
/// the tests prove the gate resolves through the ASSIGNMENT.
fn seed_assigned_user(conn: &rusqlite::Connection, user_id: &str, role_id: &str) {
    seed_roles(conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?2, 'h', ?3, ?4, 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![user_id, user_id, user_id, role_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES (?1, 'role-staff', 'global', 'all', 'all')",
        params![user_id],
    )
    .unwrap();
}

#[test]
fn gate_resolves_role_through_assignment_not_role_id() {
    let conn = fresh();
    // Legacy column says role-manager; the assignment says role-staff.
    // role-manager grants settings:edit; role-staff does NOT — so the
    // denial proves the gate authorized through the ASSIGNMENT.
    seed_assigned_user(&conn, "user-a", "role-manager");
    let store = store(&conn);
    // Staff keeps checkout operations via the assignment.
    assert!(store.require_permission("user-a", "sales:process").is_ok());
    assert!(
        store.require_permission("user-a", "sales:void").is_err(),
        "assignment role (role-staff) is checkout-only — no sales:void"
    );
    assert!(
        store.require_permission("user-a", "settings:edit").is_err(),
        "assignment role (role-staff) must win over the legacy role_id (role-manager)"
    );
}

#[test]
fn gate_falls_back_to_role_id_when_no_assignment() {
    let conn = fresh();
    seed_users(&conn);
    // alice (cashier) has no assignment row — legacy fallback applies.
    assert!(
        store(&conn)
            .require_permission("user-1", "sales:view")
            .is_ok()
    );
    assert!(
        store(&conn)
            .require_permission("user-1", "sales:void")
            .is_err()
    );
}

#[test]
fn gate_scoped_denies_workspace_out_of_scope() {
    let conn = fresh();
    seed_roles(&conn);
    // scoped to the kds workspace only.
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-k', 'k', 'h', 'K', 'role-staff', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
             VALUES ('user-k', 'role-staff', 'scoped', 'all', 'list');
         INSERT INTO assignment_workspaces (assignment_user_id, workspace_key)
             VALUES ('user-k', 'kds');",
    )
    .unwrap();
    let store = store(&conn);
    // In the kds workspace the grant holds; anywhere else it denies.
    assert!(
        store
            .require_permission_scoped("user-k", "sales:view", None, Some("kds"))
            .is_ok()
    );
    assert!(
        store
            .require_permission_scoped("user-k", "sales:view", None, Some("retail-pos"))
            .is_err()
    );
    assert!(
        store
            .require_permission_scoped("user-k", "sales:view", None, None)
            .is_err()
    );
}

#[test]
fn gate_scoped_denies_branch_out_of_scope() {
    let conn = fresh();
    seed_roles(&conn);
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-b', 'b', 'h', 'B', 'role-staff', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
             VALUES ('user-b', 'role-staff', 'scoped', 'list', 'all');
         INSERT INTO assignment_branches (assignment_user_id, branch_id)
             VALUES ('user-b', 'store-a');",
    )
    .unwrap();
    let store = store(&conn);
    assert!(
        store
            .require_permission_scoped("user-b", "sales:view", Some("store-a"), None)
            .is_ok()
    );
    assert!(
        store
            .require_permission_scoped("user-b", "sales:view", Some("store-b"), None)
            .is_err()
    );
}

#[test]
fn gate_scoped_global_assignment_ignores_scope() {
    let conn = fresh();
    seed_assigned_user(&conn, "user-g", "role-staff");
    let store = store(&conn);
    // Global assignment: scope context is ignored, like the plain gate.
    assert!(
        store
            .require_permission_scoped("user-g", "sales:view", None, Some("retail-pos"))
            .is_ok()
    );
    assert!(
        store
            .require_permission_scoped("user-g", "sales:view", Some("store-z"), None)
            .is_ok()
    );
}

#[test]
fn gate_scoped_legacy_user_without_assignment_has_no_scope_restriction() {
    let conn = fresh();
    seed_users(&conn);
    // user-1 (cashier) predates assignments — scope is not evaluated.
    assert!(
        store(&conn)
            .require_permission_scoped("user-1", "sales:view", None, Some("retail-pos"))
            .is_ok()
    );
}

#[test]
fn create_user_writes_default_global_assignment() {
    let conn = fresh();
    seed_roles(&conn);
    let store = store(&conn);
    let user = store
        .create_user("newbie", "hash", "Newbie", "role-staff")
        .unwrap();
    let a = store
        .assignment_for_user(&user.id)
        .unwrap()
        .expect("create_user must write an assignment");
    assert_eq!(a.role_id, "role-staff");
    assert_eq!(a.scope_mode, crate::db::assignments::ScopeMode::Global);
}

#[test]
fn update_user_syncs_assignment_role() {
    let conn = fresh();
    seed_roles(&conn);
    let store = store(&conn);
    let user = store
        .create_user("switcher", "hash", "Switcher", "role-staff")
        .unwrap();
    store
        .update_user(&user.id, "switcher", "Switcher", "role-manager", true)
        .unwrap();
    let a = store.assignment_for_user(&user.id).unwrap().unwrap();
    assert_eq!(
        a.role_id, "role-manager",
        "assignment role must follow the update"
    );
}

// ── Role CRUD ───────────────────────────────────────────────────

#[test]
fn list_roles_empty_db() {
    let conn = fresh();
    let roles = store(&conn).list_roles().unwrap();
    assert!(roles.is_empty());
}

#[test]
fn list_roles_seeded() {
    let conn = fresh();
    seed_roles(&conn);
    let roles = store(&conn).list_roles().unwrap();
    assert_eq!(roles.len(), 6);
    // Ordered by name: admin, auditor, custom, manager, owner, staff.
    assert_eq!(roles[0].name, "Admin");
    assert_eq!(roles[0].id, "role-admin");
    assert_eq!(roles[1].name, "Auditor");
    assert_eq!(roles[1].id, "role-auditor");
    assert_eq!(roles[2].name, "Custom");
    assert_eq!(roles[2].id, "role-custom");
    assert_eq!(roles[2].permissions, "[]");
    assert_eq!(roles[3].name, "Manager");
    assert_eq!(roles[3].id, "role-manager");
    assert_eq!(roles[4].name, "Owner");
    assert_eq!(roles[4].id, "role-owner");
    assert_eq!(roles[5].name, "Staff");
    assert_eq!(roles[5].id, "role-staff");
    assert!(!roles[5].permissions.contains("settings:read"));
    assert!(!roles[5].permissions.contains("settings:edit"));
}

#[test]
fn get_role_found() {
    let conn = fresh();
    seed_roles(&conn);
    let r = store(&conn).get_role("role-owner").unwrap().unwrap();
    assert_eq!(r.name, "Owner");
    assert_eq!(r.permissions, "[\"*\"]");
}

#[test]
fn get_role_not_found() {
    let conn = fresh();
    let r = store(&conn).get_role("nope").unwrap();
    assert!(r.is_none());
}

// ── User CRUD ───────────────────────────────────────────────────

#[test]
fn list_users_empty_db() {
    let conn = fresh();
    let users = store(&conn).list_users().unwrap();
    assert!(users.is_empty());
}

#[test]
fn list_users_returns_all() {
    let conn = fresh();
    seed_users(&conn);
    let users = store(&conn).list_users().unwrap();
    assert_eq!(users.len(), 3);
    // Ordered by display_name: Alice, Bob, Carol.
    assert_eq!(users[0].username, "alice");
    assert_eq!(users[1].username, "bob");
    assert_eq!(users[2].username, "carol");
}

#[test]
fn get_user_found() {
    let conn = fresh();
    seed_users(&conn);
    let u = store(&conn).get_user("user-1").unwrap().unwrap();
    assert_eq!(u.username, "alice");
    assert_eq!(u.display_name, "Alice");
    assert_eq!(u.role_id, "role-lite");
    assert!(u.is_active);
}

#[test]
fn get_user_not_found() {
    let conn = fresh();
    let u = store(&conn).get_user("nope").unwrap();
    assert!(u.is_none());
}

// ── Staff quota enforcement (C1.1) ───────────────────────────────

#[test]
fn count_staff_users_excludes_owner_and_inactive() {
    let conn = fresh();
    seed_users(&conn);
    // alice (active, role-lite) counts; bob (role-owner) and
    // carol (inactive) do not.
    assert_eq!(store(&conn).count_staff_users().unwrap(), 1);
}

#[test]
fn test_staff_quota_enforcement() {
    let conn = fresh();
    seed_users(&conn); // 1 active staff (alice)
    let s = store(&conn);

    // Free allows 1 staff — alice already fills it, so another is blocked.
    let err = s.enforce_staff_quota(&SubscriptionTier::Free).unwrap_err();
    assert!(err.to_string().contains("allows maximum 1 staff users"));
    assert!(err.to_string().contains("Free"));

    // Plus (5) / Pro (20) have headroom at current=1.
    assert!(s.enforce_staff_quota(&SubscriptionTier::Plus).is_ok());
    assert!(s.enforce_staff_quota(&SubscriptionTier::Pro).is_ok());

    // Unlimited tiers always pass.
    assert!(s.enforce_staff_quota(&SubscriptionTier::Premium).is_ok());
    assert!(s.enforce_staff_quota(&SubscriptionTier::Enterprise).is_ok());
}

#[test]
fn test_staff_quota_enforcement_blocks_at_limit() {
    let conn = fresh();
    seed_users(&conn); // 1 active staff (alice)
    let s = store(&conn);

    // Fill Plus to its cap (5): add 4 more active non-owner users.
    for i in 0..4 {
        s.create_user(
            &format!("extra{i}"),
            "hash",
            &format!("Extra {i}"),
            "role-staff",
        )
        .unwrap();
    }
    assert_eq!(s.count_staff_users().unwrap(), 5);

    // At the cap, the next creation is blocked.
    let err = s.enforce_staff_quota(&SubscriptionTier::Plus).unwrap_err();
    assert!(err.to_string().contains("allows maximum 5 staff users"));

    // Pro (20) still has headroom.
    assert!(s.enforce_staff_quota(&SubscriptionTier::Pro).is_ok());
}

#[test]
fn test_staff_quota_owner_does_not_consume_slot() {
    let conn = fresh();
    let s = store(&conn);
    seed_roles(&conn);
    // A store with only the owner (role-owner) has 0 staff — Free passes.
    s.create_user("owner", "hash", "Owner", "role-owner")
        .unwrap();
    assert_eq!(s.count_staff_users().unwrap(), 0);
    assert!(s.enforce_staff_quota(&SubscriptionTier::Free).is_ok());
}

#[test]
fn get_user_by_username_found() {
    let conn = fresh();
    seed_users(&conn);
    let u = store(&conn).get_user_by_username("bob").unwrap().unwrap();
    assert_eq!(u.id, "user-2");
    assert_eq!(u.display_name, "Bob");
}

#[test]
fn get_user_by_username_not_found() {
    let conn = fresh();
    let u = store(&conn).get_user_by_username("nobody").unwrap();
    assert!(u.is_none());
}

#[test]
fn get_user_inactive_user() {
    let conn = fresh();
    seed_users(&conn);
    let u = store(&conn).get_user("user-3").unwrap().unwrap();
    assert_eq!(u.username, "carol");
    assert!(!u.is_active);
}

#[test]
fn create_user_minimal() {
    let conn = fresh();
    seed_roles(&conn);
    let u = store(&conn)
        .create_user("diana", "hash_diana", "Diana", "role-staff")
        .unwrap();
    assert_eq!(u.username, "diana");
    assert_eq!(u.display_name, "Diana");
    assert_eq!(u.role_id, "role-staff");
    assert!(u.is_active);
    assert!(!u.id.is_empty());
}

#[test]
fn create_user_empty_username() {
    let conn = fresh();
    seed_roles(&conn);
    let err = store(&conn)
        .create_user("", "hash", "Diana", "role-staff")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "username"));
}

#[test]
fn create_user_empty_display_name() {
    let conn = fresh();
    seed_roles(&conn);
    let err = store(&conn)
        .create_user("diana", "hash", "   ", "role-staff")
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "display_name"));
}

#[test]
fn create_user_duplicate_username() {
    let conn = fresh();
    seed_users(&conn);
    let err = store(&conn)
        .create_user("alice", "hash2", "Alice 2", "role-owner")
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { .. }));
}

#[test]
fn update_user_basic() {
    let conn = fresh();
    seed_users(&conn);
    let updated = store(&conn)
        .update_user("user-1", "alice_new", "Alice Updated", "role-owner", true)
        .unwrap();
    assert_eq!(updated.username, "alice_new");
    assert_eq!(updated.display_name, "Alice Updated");
    assert_eq!(updated.role_id, "role-owner");
    assert!(updated.is_active);
    assert!(updated.updated_at.as_str() > "2025-01-01");
}

#[test]
fn update_user_deactivate() {
    let conn = fresh();
    seed_users(&conn);
    let updated = store(&conn)
        .update_user("user-1", "alice", "Alice", "role-staff", false)
        .unwrap();
    assert!(!updated.is_active);
}

#[test]
fn update_user_not_found() {
    let conn = fresh();
    // Seed roles so the G-2 role guard passes and the test exercises the
    // user-not-found path it exists for (a fresh DB has no role-owner).
    seed_roles(&conn);
    let err = store(&conn)
        .update_user("nope", "u", "U", "role-owner", true)
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn update_user_empty_display_name() {
    let conn = fresh();
    seed_users(&conn);
    let err = store(&conn)
        .update_user("user-1", "alice", "", "role-staff", true)
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "display_name"));
}

#[test]
fn delete_user_removes_row() {
    let conn = fresh();
    seed_users(&conn);
    store(&conn).delete_user("user-3").unwrap();
    let u = store(&conn).get_user("user-3").unwrap();
    assert!(u.is_none());
}

#[test]
fn delete_user_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_user("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Username normalization ────────────────────────────────────

#[test]
fn create_user_uppercase_normalized_to_lowercase() {
    let conn = fresh();
    seed_roles(&conn);
    let u = store(&conn)
        .create_user("ALICE_UPPER", "hash", "Alice Upper", "role-staff")
        .unwrap();
    assert_eq!(u.username, "alice_upper", "username should be lowercased");
}

#[test]
fn create_user_mixed_case_normalized_to_lowercase() {
    let conn = fresh();
    seed_roles(&conn);
    let u = store(&conn)
        .create_user("MiXeDcAsE", "hash", "Mixed", "role-staff")
        .unwrap();
    assert_eq!(u.username, "mixedcase");
}

#[test]
fn get_user_by_username_case_insensitive_after_normalization() {
    let conn = fresh();
    seed_roles(&conn);
    store(&conn)
        .create_user("CASE_USER", "hash", "Case User", "role-staff")
        .unwrap();
    // Lookup with the normalized (lowercase) form should find it.
    let u = store(&conn)
        .get_user_by_username("case_user")
        .unwrap()
        .expect("user should be found by normalized username");
    assert_eq!(u.username, "case_user");
}

#[test]
fn update_user_normalizes_username_to_lowercase() {
    let conn = fresh();
    seed_users(&conn);
    let updated = store(&conn)
        .update_user("user-1", "ALICE_NEW", "Alice Updated", "role-owner", true)
        .unwrap();
    assert_eq!(updated.username, "alice_new");
}

// ── PIN rotation (STAFF-03) ───────────────────────────────────

#[test]
fn update_user_pin_rotates_hash() {
    let conn = fresh();
    seed_users(&conn);
    let updated = store(&conn).update_user_pin("user-1", "new_hash").unwrap();
    assert_eq!(updated.pin_hash, "new_hash");
    // Verify persistence via a fresh read.
    let user = store(&conn).get_user("user-1").unwrap().unwrap();
    assert_eq!(user.pin_hash, "new_hash");
}

#[test]
fn update_user_pin_not_found() {
    let conn = fresh();
    let err = store(&conn).update_user_pin("nope", "hash").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "user"));
}

// ── Login attempt rate limiting (STAFF-07) ──────────────────────

#[test]
fn login_backoff_first_lockout_is_window() {
    // strikes=1 → base * 2^0 = base.
    assert_eq!(Store::login_backoff_secs(60, 1, 3600), 60);
}

#[test]
fn login_backoff_doubles_per_strike() {
    assert_eq!(Store::login_backoff_secs(60, 2, 3600), 120);
    assert_eq!(Store::login_backoff_secs(60, 3, 3600), 240);
}

#[test]
fn login_backoff_caps_at_max() {
    assert_eq!(Store::login_backoff_secs(60, 100, 3600), 3600);
}

/// Test limits: 3/account, 20/device, 100/global within 60s.
const LIMITS: LoginLimits = LoginLimits {
    max_attempts: 3,
    window_secs: 60,
    device_max_attempts: 20,
    global_max_attempts: 100,
    max_backoff_secs: 3600,
};

#[test]
fn record_login_attempt_locks_after_max() {
    let conn = fresh();
    let s = store(&conn);
    // 3 max attempts within a 60s window.
    assert!(
        s.record_login_attempt_scoped("alice", None, LIMITS)
            .unwrap()
            .is_ok()
    );
    assert!(
        s.record_login_attempt_scoped("alice", None, LIMITS)
            .unwrap()
            .is_ok()
    );
    let third = s
        .record_login_attempt_scoped("alice", None, LIMITS)
        .unwrap();
    assert!(matches!(third, Err(retry) if retry >= 1));
    // Still locked on the next attempt.
    let fourth = s
        .record_login_attempt_scoped("alice", None, LIMITS)
        .unwrap();
    assert!(fourth.is_err());
}

#[test]
fn record_login_attempt_returns_remaining() {
    let conn = fresh();
    let s = store(&conn);
    let first = s
        .record_login_attempt_scoped("alice", None, LIMITS)
        .unwrap()
        .unwrap();
    assert_eq!(first, 2);
    let second = s
        .record_login_attempt_scoped("alice", None, LIMITS)
        .unwrap()
        .unwrap();
    assert_eq!(second, 1);
}

#[test]
fn device_limit_applies_across_usernames() {
    // device_max=2 → two usernames sharing a device exhaust the device
    // cap even though each account individually is below its limit.
    let conn = fresh();
    let s = store(&conn);
    let device_limits = LoginLimits {
        device_max_attempts: 2,
        ..LIMITS
    };
    assert!(
        s.record_login_attempt_scoped("alice", Some("term-1"), device_limits)
            .unwrap()
            .is_ok()
    );
    assert!(
        s.record_login_attempt_scoped("bob", Some("term-1"), device_limits)
            .unwrap()
            .is_ok()
    );
    let third = s
        .record_login_attempt_scoped("carol", Some("term-1"), device_limits)
        .unwrap();
    assert!(third.is_err(), "device cap must lock out across usernames");
}

#[test]
fn different_devices_do_not_interfere() {
    let conn = fresh();
    let s = store(&conn);
    // Alice exhausts her own per-account limit (max_attempts: 1) on term-1.
    let account_limits = LoginLimits {
        max_attempts: 1,
        ..LIMITS
    };
    assert!(
        s.record_login_attempt_scoped("alice", Some("term-1"), account_limits)
            .unwrap()
            .is_err()
    );
    // term-2 is unaffected by term-1's failures.
    let ok_limits = LoginLimits {
        max_attempts: 5,
        ..LIMITS
    };
    assert!(
        s.record_login_attempt_scoped("alice", Some("term-2"), ok_limits)
            .unwrap()
            .is_ok()
    );
}

#[test]
fn global_limit_locks_everyone() {
    // global_max=3 → a fourth attempt from any account is rejected even
    // though that account has never tried before.
    let conn = fresh();
    let s = store(&conn);
    let global_limits = LoginLimits {
        global_max_attempts: 3,
        ..LIMITS
    };
    assert!(
        s.record_login_attempt_scoped("a", Some("d1"), global_limits)
            .unwrap()
            .is_ok()
    );
    assert!(
        s.record_login_attempt_scoped("b", Some("d2"), global_limits)
            .unwrap()
            .is_ok()
    );
    assert!(
        s.record_login_attempt_scoped("c", Some("d3"), global_limits)
            .unwrap()
            .is_ok()
    );
    let fourth = s
        .record_login_attempt_scoped("d", Some("d4"), global_limits)
        .unwrap();
    assert!(fourth.is_err(), "global cap must lock out new accounts");
}

#[test]
fn clear_login_attempts_by_device_only_clears_that_device() {
    let conn = fresh();
    let s = store(&conn);
    let device_limits = LoginLimits {
        device_max_attempts: 5,
        ..LIMITS
    };
    let _ = s.record_login_attempt_scoped("alice", Some("term-1"), device_limits);
    let _ = s.record_login_attempt_scoped("bob", Some("term-2"), device_limits);

    s.clear_login_attempts_by_device("term-1").unwrap();

    // term-1 is now free for its next attempt.
    assert!(
        s.record_login_attempt_scoped("alice", Some("term-1"), device_limits)
            .unwrap()
            .is_ok()
    );
    // term-2's history is untouched.
    let remaining = s
        .record_login_attempt_scoped("bob", Some("term-2"), device_limits)
        .unwrap();
    assert!(remaining.is_ok(), "other device history must survive");
}

#[test]
fn legacy_record_login_attempt_delegates_to_scoped() {
    let conn = fresh();
    let s = store(&conn);
    assert!(s.record_login_attempt("alice", 3, 60).unwrap().is_ok());
    assert!(s.record_login_attempt("alice", 3, 60).unwrap().is_ok());
    assert!(s.record_login_attempt("alice", 3, 60).unwrap().is_err());
}

// ── G-2: role existence validation ──────────────────────────────────

#[test]
fn create_user_rejects_unknown_role_with_typed_error() {
    let conn = fresh();
    seed_roles(&conn);
    // No role 'role-ghost' exists — the create must fail with a Validation
    // error naming role_id, not a mislabelled Conflict or a zombie user.
    let err = store(&conn)
        .create_user("zombie", "hash_z", "Zombie", "role-ghost")
        .unwrap_err();
    match err {
        CoreError::Validation { field, message } => {
            assert_eq!(field, "role_id");
            assert!(message.contains("role-ghost"), "message: {message}");
        }
        other => panic!("expected Validation error, got: {other:?}"),
    }
    // Nothing was written — the user row must not exist.
    assert!(
        store(&conn)
            .get_user_by_username("zombie")
            .unwrap()
            .is_none()
    );
}

#[test]
fn update_user_rejects_unknown_role_before_any_write() {
    let conn = fresh();
    seed_users(&conn);
    let err = store(&conn)
        .update_user("user-1", "alice", "Alice", "role-ghost", true)
        .unwrap_err();
    match err {
        CoreError::Validation { field, .. } => assert_eq!(field, "role_id"),
        other => panic!("expected Validation error, got: {other:?}"),
    }
    // The user's real role is untouched — no partial write happened.
    let user = store(&conn).get_user("user-1").unwrap().expect("user");
    assert_eq!(user.role_id, "role-lite");
}
