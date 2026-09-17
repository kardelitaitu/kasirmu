//! Integration tests for the staff module — roles, permissions,
//! user deactivation, and edge cases with data.
//!
//! Tests exercise the full persistence layer via the public
//! [`kasirmu_core::Store`] API against an in-memory SQLite database.

use kasirmu_core::{Store, User, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn seed_roles(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-owner',   'owner',   'Full access',           '[\"*\"]',                                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('role-staff',   'staff',   'Operational access',      '[\"sales:process\"]',                     '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('role-manager', 'manager', 'Manage products + sales','[\"products:crud\",\"sales:void\"]',  '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

fn seed_users(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-owner',   'owner',   'Full access',    '[\"*\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('role-staff',   'staff',   'Operational access', '[\"sales:process\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-1', 'alice',   'hash_alice',   'Alice',   'role-staff',   1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('user-2', 'bob',     'hash_bob',     'Bob',     'role-owner',   1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('user-3', 'carol',   'hash_carol',   'Carol',   'role-staff',   0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

// ── Role: Permissions ─────────────────────────────────────────────────

#[test]
fn role_permissions_json_roundtrip() {
    let conn = setup();
    let s = store(&conn);

    let permissions = r#"["sales:process","sales:void","products:crud","products:read","inventory:adjust","reports:view"]"#;
    let r = s
        .create_role(
            "role-supervisor",
            "supervisor",
            "Supervisor access",
            permissions,
        )
        .unwrap();
    assert_eq!(
        r.permissions, permissions,
        "permissions JSON should roundtrip"
    );

    // Reload from DB.
    let loaded = s.get_role("role-supervisor").unwrap().unwrap();
    assert_eq!(
        loaded.permissions, permissions,
        "permissions should persist through DB roundtrip"
    );

    // Verify it's valid JSON.
    let parsed: Vec<String> = serde_json::from_str(&loaded.permissions).unwrap();
    assert_eq!(parsed.len(), 6);
    assert!(parsed.contains(&"sales:process".to_string()));
    assert!(parsed.contains(&"reports:view".to_string()));
}

#[test]
fn role_with_many_permissions() {
    let conn = setup();
    let s = store(&conn);

    // Create a role with 20 permission strings — all registered keys, since
    // the registry rejects unregistered grants (spec 0046).
    const KEYS: [&str; 20] = [
        "sales:process",
        "sales:view",
        "sales:discount",
        "sales:split",
        "products:create",
        "products:read",
        "products:update",
        "products:delete",
        "products:import",
        "products:export",
        "inventory:view",
        "inventory:adjust",
        "inventory:transfer",
        "inventory:count",
        "inventory:locations_manage",
        "customers:create",
        "customers:view",
        "customers:edit",
        "customers:delete",
        "reports:view",
    ];
    let perms: Vec<String> = KEYS.iter().map(|k| k.to_string()).collect();
    let permissions = serde_json::to_string(&perms).unwrap();
    let r = s
        .create_role("role-verbose", "verbose", "Many permissions", &permissions)
        .unwrap();

    let loaded = s.get_role(&r.id).unwrap().unwrap();
    let parsed: Vec<String> = serde_json::from_str(&loaded.permissions).unwrap();
    assert_eq!(parsed.len(), 20, "all 20 permissions should roundtrip");
    assert_eq!(parsed[0], "sales:process");
    assert_eq!(parsed[19], "reports:view");
}

#[test]
fn role_with_single_permission() {
    let conn = setup();
    let s = store(&conn);

    let r = s
        .create_role(
            "role-minimal",
            "minimal",
            "Single permission",
            r#"["sales:view"]"#,
        )
        .unwrap();
    let loaded = s.get_role(&r.id).unwrap().unwrap();
    assert_eq!(loaded.permissions, r#"["sales:view"]"#);
}

// ── Role: FK constraint (cascade / restrict) ──────────────────────────

#[test]
fn delete_role_with_active_users_rejected_by_fk() {
    let conn = setup();
    seed_users(&conn);

    // 'role-staff' has 2 users assigned (user-1/Alice, user-3/Carol).
    // Deleting it should fail due to FK constraint.
    let result = conn.execute("DELETE FROM roles WHERE id = 'role-staff'", []);
    assert!(result.is_err(), "should not delete role with active users");

    // Verify the role still exists.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM roles WHERE id = 'role-staff'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "role-staff should still exist");
}

#[test]
fn delete_role_without_users_succeeds() {
    let conn = setup();
    seed_roles(&conn);

    // Create a role with no users.
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES ('role-viewer', 'viewer', '', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    ).unwrap();

    // Delete the unassigned role.
    let rows = conn
        .execute("DELETE FROM roles WHERE id = 'role-viewer'", [])
        .unwrap();
    assert_eq!(rows, 1, "should delete role with no users");

    let loaded = store(&conn).get_role("role-viewer").unwrap();
    assert!(loaded.is_none(), "deleted role should not exist");
}

// ── Role: Unique name constraint ──────────────────────────────────────

#[test]
fn role_duplicate_name_rejected() {
    let conn = setup();
    seed_roles(&conn);
    let err = store(&conn)
        .create_role("role-owner-dup", "owner", "Duplicate", "[]")
        .unwrap_err();
    assert!(
        err.to_string().contains("role"),
        "duplicate role name should produce an error: {err}"
    );
}

// ── Role: Special characters ──────────────────────────────────────────

#[test]
fn role_with_unicode_characters() {
    let conn = setup();
    let s = store(&conn);

    let r = s
        .create_role(
            "role-i18n",
            "Cajero",                                            // Spanish for "cashier"
            "Usuario con permisos limitados — 限定的なアクセス", // mixed unicode
            r#"["sales:process"]"#,
        )
        .unwrap();
    assert_eq!(r.name, "Cajero");

    let loaded = s.get_role(&r.id).unwrap().unwrap();
    assert_eq!(loaded.name, "Cajero");
    assert!(loaded.description.contains("限定的"));
}

// ── Role: Timestamps ──────────────────────────────────────────────────

#[test]
fn role_created_at_set_on_creation() {
    let conn = setup();
    let s = store(&conn);

    let r = s
        .create_role(
            "role-ts-test",
            "timestamped",
            "Testing timestamps",
            r#"["sales:view"]"#,
        )
        .unwrap();
    assert!(!r.created_at.is_empty(), "created_at should be populated");
    assert!(
        r.created_at.contains('T'),
        "created_at should be ISO-8601: {}",
        r.created_at
    );
    assert!(
        r.created_at.ends_with('Z'),
        "created_at should be UTC: {}",
        r.created_at
    );

    // Verify it's valid RFC-3339.
    let parsed = chrono::DateTime::parse_from_rfc3339(&r.created_at);
    assert!(
        parsed.is_ok(),
        "created_at should be valid RFC-3339: {}",
        r.created_at
    );
}

#[test]
fn role_timestamps_persist_in_db() {
    let conn = setup();
    seed_roles(&conn);

    let r = store(&conn).get_role("role-owner").unwrap().unwrap();
    assert_eq!(r.created_at, "2025-01-01T00:00:00.000Z");
    assert_eq!(r.updated_at, "2025-01-01T00:00:00.000Z");
}

// ── Role: Ordering ────────────────────────────────────────────────────

#[test]
fn roles_listed_in_alphabetical_order() {
    let conn = setup();
    seed_roles(&conn);
    let roles = store(&conn).list_roles().unwrap();
    assert_eq!(roles.len(), 3);
    assert_eq!(roles[0].name, "manager");
    assert_eq!(roles[1].name, "owner");
    assert_eq!(roles[2].name, "staff");
}

// ── User: Timestamps ──────────────────────────────────────────────────

#[test]
fn user_created_at_is_iso8601() {
    let conn = setup();
    seed_roles(&conn);
    let s = store(&conn);

    let u = s
        .create_user("ts-user", "hash", "Timestamp User", "role-staff")
        .unwrap();
    assert!(!u.created_at.is_empty(), "created_at should be populated");
    assert!(
        u.created_at.contains('T'),
        "created_at should be ISO-8601: {}",
        u.created_at
    );
    assert!(
        u.created_at.ends_with('Z'),
        "created_at should be UTC: {}",
        u.created_at
    );

    let parsed = chrono::DateTime::parse_from_rfc3339(&u.created_at);
    assert!(
        parsed.is_ok(),
        "created_at should be valid RFC-3339: {}",
        u.created_at
    );
}

#[test]
fn user_updated_at_increases_on_update() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let updated = s
        .update_user("user-1", "alice", "Alice Updated", "role-staff", true)
        .unwrap();
    assert!(
        !updated.updated_at.is_empty(),
        "updated_at should be set after update"
    );
    assert!(
        updated.updated_at.contains('T'),
        "updated_at should be ISO-8601: {}",
        updated.updated_at
    );
    assert!(
        updated.updated_at.ends_with('Z'),
        "updated_at should be UTC: {}",
        updated.updated_at
    );

    // The seed data has updated_at = 2025-01-01...; the update should set a newer timestamp.
    assert!(
        updated.updated_at.as_str() > "2025-01-01T00:00:00.000Z",
        "updated_at should be more recent than seed timestamp"
    );
}

// ── User: Deactivate / Reactivate ─────────────────────────────────────

#[test]
fn user_deactivate_and_reactivate() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Deactivate an active user.
    let deactivated = s
        .update_user("user-1", "alice", "Alice", "role-staff", false)
        .unwrap();
    assert!(!deactivated.is_active, "user should be deactivated");

    // Verify via get.
    let loaded = s.get_user("user-1").unwrap().unwrap();
    assert!(!loaded.is_active, "user should be inactive in DB");

    // Reactivate the same user.
    let reactivated = s
        .update_user("user-1", "alice", "Alice", "role-staff", true)
        .unwrap();
    assert!(reactivated.is_active, "user should be reactivated");

    // Verify via get.
    let loaded = s.get_user("user-1").unwrap().unwrap();
    assert!(loaded.is_active, "user should be active again in DB");
}

#[test]
fn deactivate_already_inactive_user() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // user-3 (Carol) is already inactive.
    let updated = s
        .update_user("user-3", "carol", "Carol", "role-staff", false)
        .unwrap();
    assert!(!updated.is_active, "user should remain inactive");
}

#[test]
fn reactivate_deactivated_user() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // user-3 (Carol) starts inactive. Reactivate her.
    let reactivated = s
        .update_user("user-3", "carol", "Carol", "role-staff", true)
        .unwrap();
    assert!(reactivated.is_active, "user should be reactivated");
}

// ── User: FK constraint ──────────────────────────────────────────────

#[test]
fn create_user_with_nonexistent_role_rejected_by_fk() {
    let conn = setup();
    seed_roles(&conn);
    let s = store(&conn);

    // After seed_roles, there are roles but none named "role-nonexistent".
    // create_user catches FK violations as CoreError::Conflict.
    let result = s.create_user("orphan", "hash", "Orphan User", "role-nonexistent");
    assert!(
        result.is_err(),
        "creating user with non-existent role should fail"
    );
}

// ── User: Role reassignment ──────────────────────────────────────────

#[test]
fn user_role_reassignment() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Alice (user-1) starts as staff. Promote her to owner.
    let updated = s
        .update_user("user-1", "alice", "Alice", "role-owner", true)
        .unwrap();
    assert_eq!(
        updated.role_id, "role-owner",
        "role should be updated to owner"
    );

    // Verify via get.
    let loaded = s.get_user("user-1").unwrap().unwrap();
    assert_eq!(loaded.role_id, "role-owner");
}

#[test]
fn reassign_to_same_role_is_idempotent() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    let updated = s
        .update_user("user-1", "alice", "Alice", "role-staff", true)
        .unwrap();
    assert_eq!(
        updated.role_id, "role-staff",
        "same role should be preserved"
    );
}

// ── User: Listing with active/inactive ────────────────────────────────

#[test]
fn list_users_includes_is_active() {
    let conn = setup();
    seed_users(&conn);
    let users = store(&conn).list_users().unwrap();

    let alice = users.iter().find(|u| u.username == "alice").unwrap();
    assert!(alice.is_active, "Alice should be active");

    let carol = users.iter().find(|u| u.username == "carol").unwrap();
    assert!(!carol.is_active, "Carol should be inactive");

    let bob = users.iter().find(|u| u.username == "bob").unwrap();
    assert!(bob.is_active, "Bob should be active");
}

#[test]
fn list_users_ordered_by_display_name() {
    let conn = setup();
    seed_users(&conn);
    let users = store(&conn).list_users().unwrap();
    assert_eq!(users.len(), 3);
    assert_eq!(users[0].display_name, "Alice");
    assert_eq!(users[1].display_name, "Bob");
    assert_eq!(users[2].display_name, "Carol");
}

// ── User: Multiple users, same role ───────────────────────────────────

#[test]
fn multiple_users_with_same_role() {
    let conn = setup();
    seed_roles(&conn);
    let s = store(&conn);

    s.create_user("u1", "hash1", "User One", "role-staff")
        .unwrap();
    s.create_user("u2", "hash2", "User Two", "role-staff")
        .unwrap();
    s.create_user("u3", "hash3", "User Three", "role-staff")
        .unwrap();

    let users = s.list_users().unwrap();
    let cashiers: Vec<&User> = users.iter().filter(|u| u.role_id == "role-staff").collect();
    assert_eq!(cashiers.len(), 3, "all three users should have role-staff");
}

// ── User: Delete does not affect role ─────────────────────────────────

#[test]
fn delete_user_does_not_affect_role() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // Delete a user.
    s.delete_user("user-1").unwrap();

    // The role should still exist.
    let role = s.get_role("role-staff").unwrap().unwrap();
    assert_eq!(
        role.name, "staff",
        "role should still exist after user deletion"
    );

    // Other users with the same role should remain.
    let remaining = s.list_users().unwrap();
    assert_eq!(remaining.len(), 2);
    assert!(
        remaining
            .iter()
            .all(|u| u.role_id == "role-owner" || u.role_id == "role-staff")
    );
}

// ── User: Special characters ──────────────────────────────────────────

#[test]
fn user_with_unicode_display_name() {
    let conn = setup();
    seed_roles(&conn);
    let s = store(&conn);

    let u = s
        .create_user(
            "i18n-user",
            "hash",
            "José María — 佐藤", // mixed Latin-1 supplement + CJK
            "role-staff",
        )
        .unwrap();
    assert_eq!(u.display_name, "José María — 佐藤");

    let loaded = s.get_user(&u.id).unwrap().unwrap();
    assert_eq!(loaded.display_name, "José María — 佐藤");
}

#[test]
fn user_username_with_leading_trailing_spaces_is_trimmed() {
    let conn = setup();
    seed_roles(&conn);
    let s = store(&conn);

    let u = s
        .create_user("  spaced-user  ", "hash", "Spaced User", "role-staff")
        .unwrap();
    assert_eq!(u.username, "spaced-user", "username should be trimmed");
}

// ── User: Update preserves unrelated fields ───────────────────────────

#[test]
fn update_pin_hash_only_via_raw_sql() {
    let conn = setup();
    seed_users(&conn);
    let s = store(&conn);

    // The Store API does not expose pin_hash update directly.
    // Update pin_hash via raw SQL.
    conn.execute(
        "UPDATE users SET pin_hash = 'new_hash_456' WHERE id = 'user-1'",
        [],
    )
    .unwrap();

    let loaded = s.get_user("user-1").unwrap().unwrap();
    assert_eq!(
        loaded.pin_hash, "new_hash_456",
        "pin_hash should be updated"
    );

    // Verify other fields unchanged.
    assert_eq!(loaded.username, "alice");
    assert_eq!(loaded.display_name, "Alice");
    assert!(loaded.is_active);
    assert_eq!(loaded.role_id, "role-staff");
}
