//! Access-resolution tests for `db::workspaces_instances`.
//!
//! These pin the ADR #4 phase-2 read (`user_workspace_instances`): a corrupt
//! assignment row must not silently degrade into the wider role-type fallback,
//! while a genuinely absent assignment set still falls through as documented.
use super::*;
use crate::migrations;

/// Seed a role, a user, a store, two active instances, and a role→type grant
/// of `kds`. The role deliberately does NOT bypass workspace assignment, so
/// resolution reaches phase 2 (explicit assignment) and, on failure, phase 3.
/// The caller owns the connection, so this no longer `Box::leak`s a
/// database per test to manufacture a `'static` (O-T03).
fn fresh(db: &rusqlite::Connection) -> (Store<'_>, &rusqlite::Connection) {
    let store = Store::new(db);

    db.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-test', 'Test', 'Test', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, created_at, updated_at)
         VALUES ('user-1', 'alice', 'hash', 'Alice', 'role-test', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO locations (id, name, is_primary) VALUES ('default', 'Default Store', 1);
         INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, status, last_accessed_at) VALUES
            ('default-kds', 'kds', 'default', 'Kitchen Display', 'Kitchen order queue display', NULL, 'active', NULL),
            ('default-store-pos', 'store-pos', 'default', 'Store POS', 'Cashier terminal for retail', NULL, 'active', NULL);
         INSERT INTO role_workspace_types (role_id, type_key) VALUES ('role-test', 'kds');",
    )
    .unwrap();

    (store, db)
}

/// A corrupt `user_workspace_instances` row must abort resolution.
///
/// Phase 2 read the assignment ids with `.filter_map(|r| r.ok())`, so a row
/// whose `instance_id` cannot decode as TEXT was dropped. Because empty is the
/// sentinel for "no explicit assignment", dropping every row made resolution
/// fall through to phase 3's `role_workspace_types` grant — *wider* than the
/// explicit assignment the user actually had. `get_user_workspace_instance_ids`
/// and `verify_instance_access` read the same column and propagate the error,
/// so the drop is a fail-open sibling divergence (COR-11/25/30 family).
#[test]
fn list_workspaces_refuses_a_corrupt_assignment_row_instead_of_widening_to_role_types() {
    let store_db = migrations::fresh_db();
    let (store, conn) = fresh(&store_db);

    // Recreate the join table as a shim so a BLOB can sit in `instance_id`
    // without the FK to `workspace_instances` rejecting the orphan value.
    conn.execute_batch(
        "DROP TABLE user_workspace_instances;
         CREATE TABLE user_workspace_instances (
             user_id     TEXT NOT NULL,
             instance_id BLOB NOT NULL,
             is_default  INTEGER NOT NULL DEFAULT 0
         );
         INSERT INTO user_workspace_instances (user_id, instance_id, is_default)
         VALUES ('user-1', x'deadbeef', 0);",
    )
    .unwrap();

    match store.list_workspaces("role-test", Some("user-1"), "default") {
        // RED: the dropped row leaves an empty assignment set, so resolution
        // widens to the role-type fallback and hands back the KDS instance the
        // user was never assigned.
        Ok(list) => panic!("corrupt assignment row widened access to role types: {list:?}"),
        // GREEN: the decode error propagates instead of being read as absence.
        Err(_) => {}
    }
}

/// The documented phase-3 fallback survives: a user with NO assignment rows
/// (a genuine absence, not a read failure) still resolves through their role's
/// workspace types.
#[test]
fn list_workspaces_falls_through_to_role_types_when_no_assignment_exists() {
    let store_db = migrations::fresh_db();
    let (store, _conn) = fresh(&store_db);

    let list = store
        .list_workspaces("role-test", Some("user-1"), "default")
        .expect("a genuine absence must not be an error");

    assert_eq!(
        list.iter()
            .map(|d| d.instance_id.as_str())
            .collect::<Vec<_>>(),
        vec!["default-kds"],
        "role-type fallback must still grant the role's allowed types"
    );
}
