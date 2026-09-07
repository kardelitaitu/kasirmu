use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// An authored role — an id outside `ROLE_PRESETS`, which is what makes it
/// authorable at all.
const AUTHORED: &str = "role-night-manager";

fn insert_authored_role(conn: &Connection, permissions: &str) {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES (?1, 'Night Manager', 'Overnight shift lead', ?2,
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![AUTHORED, permissions],
    )
    .unwrap();
}

fn insert_user_with_role(conn: &Connection, user_id: &str, role_id: &str) {
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?1, 'hash', 'Holder', ?2, 1,
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![user_id, role_id],
    )
    .unwrap();
}

// ── update_role ────────────────────────────────────────────────────────

#[test]
fn update_role_rewrites_grants_and_enforcement_follows() {
    // The point of the feature: editing a role changes what its holders
    // may do, through the same gate every other path consults.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, r#"["sales:view"]"#);
    insert_user_with_role(&conn, "holder", AUTHORED);

    let s = store(&conn);
    assert!(s.require_permission("holder", "sales:view").is_ok());
    assert!(
        s.require_permission("holder", "sales:void").is_err(),
        "the role does not grant void yet"
    );

    s.update_role(
        AUTHORED,
        "Night Manager",
        "",
        r#"["sales:view","sales:void"]"#,
    )
    .unwrap();

    assert!(
        s.require_permission("holder", "sales:void").is_ok(),
        "the widened grant reaches the gate without touching the user"
    );
}

#[test]
fn update_role_renames_and_preserves_created_at() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let before = store(&conn).get_role(AUTHORED).unwrap().unwrap();

    let after = store(&conn)
        .update_role(
            AUTHORED,
            "  Closing Supervisor  ",
            "closes the night",
            r#"["reports:view"]"#,
        )
        .unwrap();

    assert_eq!(after.name, "Closing Supervisor", "name is trimmed");
    assert_eq!(after.description, "closes the night");
    assert_eq!(
        after.created_at, before.created_at,
        "an edit never rewrites the creation stamp"
    );
    assert_ne!(
        after.updated_at, before.updated_at,
        "an edit always bumps the update stamp"
    );
    let reread = store(&conn).get_role(AUTHORED).unwrap().unwrap();
    assert_eq!(reread.name, "Closing Supervisor", "the write is durable");
}

#[test]
fn update_role_refuses_every_builtin_preset_id() {
    // The silent-revert guard. `seed_default_roles` upserts these ids and
    // overwrites their grants, and it is reachable from the UI
    // (`seed_default_roles_scoped`), so an accepted edit here would be
    // destroyed later without an error. Note this set includes
    // `role-custom`: the empty-grant placeholder is itself a preset, so a
    // role being *called* custom does not make its row authored.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    let s = store(&conn);
    for preset in platform_core::rbac::ROLE_PRESETS {
        let err = s
            .update_role(preset.id, "Renamed", "", r#"["sales:view"]"#)
            .expect_err(&format!("{} is a preset and must be refused", preset.id));
        assert!(
            matches!(&err, CoreError::Validation { field, .. } if *field == "id"),
            "preset {} rejected with a typed id error, got {err:?}",
            preset.id
        );
    }
    // Nothing was written: Owner still holds exactly the preset grant.
    assert_eq!(
        s.get_role(platform_core::rbac::builtin_roles::OWNER)
            .unwrap()
            .unwrap()
            .name,
        "Owner"
    );
}

#[test]
fn authored_role_survives_a_reseed() {
    // The mirror of the guard above, and its justification stated as a
    // fact about the world: a non-preset id is untouched by seeding, so
    // authoring it is safe; a preset id is rewritten, so it is not.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, r#"["sales:void"]"#);

    let s = store(&conn);
    s.update_role(AUTHORED, "Night Manager", "edited", r#"["sales:void"]"#)
        .unwrap();
    let count = s.seed_default_roles().unwrap();
    assert!(count > 0, "the reseed actually ran and did work");

    let after = s
        .get_role(AUTHORED)
        .unwrap()
        .expect("authored row survives");
    assert_eq!(after.name, "Night Manager");
    assert_eq!(after.description, "edited");
    assert!(
        after.permissions.contains("sales:void"),
        "authored grants are never re-synced away"
    );
}

#[test]
fn update_role_rejects_unregistered_permission() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let err = store(&conn)
        .update_role(AUTHORED, "Night Manager", "", r#"["sales:not_a_key"]"#)
        .expect_err("an unregistered key must not be writable");
    assert!(
        matches!(&err, CoreError::Validation { field, .. } if *field == "permissions"),
        "{err:?}"
    );
    assert!(
        store(&conn)
            .get_role(AUTHORED)
            .unwrap()
            .unwrap()
            .permissions
            .is_empty()
            || store(&conn)
                .get_role(AUTHORED)
                .unwrap()
                .unwrap()
                .permissions
                == "[]",
        "a rejected write leaves the previous grants intact"
    );
}

#[test]
fn update_role_rejects_global_and_sensitive_family_wildcards() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let s = store(&conn);

    // `*` is the Owner seed's alone.
    assert!(
        s.update_role(AUTHORED, "x", "", r#"["*"]"#).is_err(),
        "an authored role cannot take the global wildcard"
    );
    // A sensitive key must be named, never swept in by a family wildcard.
    assert!(
        s.update_role(AUTHORED, "x", "", r#"["staff:*"]"#).is_err(),
        "staff:manage_roles is sensitive and must not ride staff:*"
    );
    // Naming it exactly is allowed — that is what authoring means.
    assert!(
        s.update_role(AUTHORED, "x", "", r#"["staff:manage_roles"]"#)
            .is_ok()
    );
}

#[test]
fn update_role_rejects_empty_name_and_reports_missing_role() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let s = store(&conn);

    assert!(
        matches!(
            s.update_role(AUTHORED, "   ", "", "[]"),
            Err(CoreError::Validation { .. })
        ),
        "a blank name is a validation error, not a rename to empty"
    );
    assert!(
        matches!(
            s.update_role("role-nope", "x", "", "[]"),
            Err(CoreError::NotFound { .. })
        ),
        "editing a role that does not exist is not an insert"
    );
}

#[test]
fn update_role_conflicts_on_a_taken_name() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let err = store(&conn)
        .update_role(AUTHORED, "Owner", "", "[]")
        .expect_err("role names are unique");
    assert!(
        matches!(err, CoreError::Conflict { .. }),
        "a name clash is a typed Conflict, not a raw FK error"
    );
    // Renaming to its own current name is not a conflict.
    store(&conn)
        .update_role(AUTHORED, "Night Manager", "", "[]")
        .expect("a no-op rename must pass");
}

// ── delete_role ────────────────────────────────────────────────────────

#[test]
fn delete_role_removes_an_unreferenced_authored_role() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    assert!(store(&conn).get_role(AUTHORED).unwrap().is_some());

    store(&conn).delete_role(AUTHORED).unwrap();
    assert!(
        store(&conn).get_role(AUTHORED).unwrap().is_none(),
        "the row is gone"
    );
}

#[test]
fn delete_role_refuses_every_builtin_preset_id() {
    // Deleting a preset would not just lose a row: users hold these ids,
    // and `authorize_with` fails closed on an unresolvable role, so the
    // effect would be silent loss of access rather than an error.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    let s = store(&conn);
    for preset in platform_core::rbac::ROLE_PRESETS {
        let err = s.delete_role(preset.id).expect_err(&format!(
            "{} is a preset and must not be deletable",
            preset.id
        ));
        assert!(
            matches!(&err, CoreError::Validation { field, .. } if *field == "id"),
            "{err:?}"
        );
        assert!(
            s.get_role(preset.id).unwrap().is_some(),
            "and the row is still there afterwards"
        );
    }
}

#[test]
fn delete_role_refuses_a_role_still_held_by_a_user() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "holder", AUTHORED);

    let err = store(&conn)
        .delete_role(AUTHORED)
        .expect_err("a role in use cannot be dropped from under its holder");
    let CoreError::Validation { message, .. } = err else {
        panic!("expected a typed Validation error, got {err:?}");
    };
    assert!(
        message.contains("users=1"),
        "the error names the referrer and its count: {message}"
    );
    assert!(store(&conn).get_role(AUTHORED).unwrap().is_some());
}

#[test]
fn delete_role_refuses_a_role_named_only_by_an_assignment() {
    // `assignments.role_id` is an independent referrer. It cannot be
    // demonstrated by deleting the user — that row cascades away with them
    // (the first draft of this test assumed otherwise and correctly failed)
    // — but it does not need a user whose own `role_id` matches. The
    // assignment is what the gate resolves, so a role named only there is
    // still a role in use.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "holder", platform_core::rbac::builtin_roles::OWNER);
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ('holder', ?1, 'global', 'all', 'all')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();

    let s = store(&conn);
    let refs = s.role_reference_counts(AUTHORED).unwrap();
    assert_eq!(
        refs,
        vec![("assignments", 1)],
        "the assignment is the only referrer; users.role_id points at Owner"
    );
    assert!(
        matches!(s.delete_role(AUTHORED), Err(CoreError::Validation { .. })),
        "and that alone still blocks the delete"
    );
    assert!(
        s.get_role(AUTHORED).unwrap().is_some(),
        "the row survives the refused delete"
    );
}

#[test]
fn delete_role_reports_missing_role_as_not_found() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    assert!(
        matches!(
            store(&conn).delete_role("role-nope"),
            Err(CoreError::NotFound { .. })
        ),
        "deleting nothing reports that there was nothing, not success"
    );
}

#[test]
fn reference_counts_agree_with_the_delete_decision() {
    // The UI disables Delete from these numbers; the delete path decides
    // from the same query. If the two ever disagreed the button would lie
    // about what it can do, so the pairing is pinned rather than assumed.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");

    let s = store(&conn);
    assert!(s.role_reference_counts(AUTHORED).unwrap().is_empty());
    s.delete_role(AUTHORED)
        .expect("no referrers, so the delete succeeds");

    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "holder", AUTHORED);
    assert!(!s.role_reference_counts(AUTHORED).unwrap().is_empty());
    assert!(
        s.delete_role(AUTHORED).is_err(),
        "referrers present, so the delete is refused"
    );
}
