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

// ── soft_delete_role (the trash) ────────────────────────────────────────────────────────

#[test]
fn soft_delete_role_trashes_an_unreferenced_authored_role() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    assert!(store(&conn).get_role(AUTHORED).unwrap().is_some());

    store(&conn).soft_delete_role(AUTHORED).unwrap();

    // Kept, not removed: the row surviving is what lets a restore read it back
    // inside the window. It leaves every LIVE surface at once instead.
    assert!(
        store(&conn).get_role(AUTHORED).unwrap().is_some(),
        "the row is kept so the trash can read it back"
    );
    assert!(
        store(&conn)
            .list_roles()
            .unwrap()
            .iter()
            .all(|r| r.id != AUTHORED)
    );
    let trashed = store(&conn).list_trashed_roles().unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].role.id, AUTHORED);
}

#[test]
fn soft_delete_role_is_refused_twice() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    store(&conn).soft_delete_role(AUTHORED).unwrap();
    // A second trashing must not silently restart the retention clock.
    let err = store(&conn).soft_delete_role(AUTHORED).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "deleted_at"));
}

#[test]
fn restore_role_returns_it_to_the_live_list() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    store(&conn).soft_delete_role(AUTHORED).unwrap();

    let restored = store(&conn).restore_role(AUTHORED).unwrap();
    assert_eq!(restored.id, AUTHORED);
    assert!(
        store(&conn)
            .list_roles()
            .unwrap()
            .iter()
            .any(|r| r.id == AUTHORED)
    );
    assert!(store(&conn).list_trashed_roles().unwrap().is_empty());
    // Restoring something that is not in the trash is NotFound, not a silent
    // success: the trash is not a way to prove a role exists.
    assert!(matches!(
        store(&conn).restore_role("nope").unwrap_err(),
        CoreError::NotFound { .. }
    ));
}

#[test]
fn purge_expired_roles_removes_only_past_the_window() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    store(&conn).soft_delete_role(AUTHORED).unwrap();

    // Inside the window: untouched.
    assert_eq!(store(&conn).purge_expired_roles().unwrap(), 0);
    assert_eq!(store(&conn).list_trashed_roles().unwrap().len(), 1);

    let old = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS + 1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE roles SET deleted_at = ?1 WHERE id = ?2",
        params![old, AUTHORED],
    )
    .unwrap();

    assert_eq!(store(&conn).purge_expired_roles().unwrap(), 1);
    // Unlike the staff purge, this one really deletes: a role carries no
    // personal data, and the delete guard proved nothing references it.
    assert!(store(&conn).get_role(AUTHORED).unwrap().is_none());
    assert!(store(&conn).list_trashed_roles().unwrap().is_empty());
}

#[test]
fn a_closed_window_role_is_not_listed_as_restorable() {
    // The purge REFUSES to delete a row something still references, so a window can
    // close with the row on disk. The read must not offer it: restorable is the one
    // word a caller acts on, and a row past its deadline is not. This is the pair to
    // purge_expired_roles_removes_only_past_the_window above — one pins the sweep,
    // this pins the read the Trash tab is fed by.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    store(&conn).soft_delete_role(AUTHORED).unwrap();
    let old = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS + 1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE roles SET deleted_at = ?1 WHERE id = ?2",
        params![old, AUTHORED],
    )
    .unwrap();

    assert!(
        store(&conn).list_trashed_roles().unwrap().is_empty(),
        "a window that has closed must not be listed as if it still had time"
    );
    // And the sweep still reaches it — the read's predicate is a VIEW, not a lock.
    assert_eq!(store(&conn).purge_expired_roles().unwrap(), 1);
}

#[test]
fn a_trashed_role_cannot_be_assigned_to_an_account() {
    // The hole this closes: a trashed role stayed assignable, and every re-reference
    // makes purge_expired_roles refuse the row for ever — the window never closes, and
    // the role keeps granting while list_roles hides it from every picker.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    store(&conn).soft_delete_role(AUTHORED).unwrap();

    let err = store(&conn)
        .create_user("late", "pin-hash", "Late Starter", AUTHORED)
        .expect_err("a trashed role must not be assignable");
    assert!(
        matches!(&err, CoreError::Validation { field, message }
            if *field == "role_id" && message.contains("is in the trash")),
        "expected the trash refusal, got {err:?}"
    );

    // The same door from the update side: rebinding a live account onto it.
    store(&conn)
        .create_user("live", "pin-hash", "Live User", "role-staff")
        .unwrap();
    let err = store(&conn)
        .update_user("live", "live", "Live User", AUTHORED, true)
        .expect_err("rebinding onto a trashed role must be refused too");
    assert!(
        matches!(&err, CoreError::Validation { field, .. } if *field == "role_id"),
        "expected the trash refusal, got {err:?}"
    );

    // Which is what keeps the window closable: nothing references it, so the sweep
    // can still delete it once the window closes.
    let old = (chrono::Utc::now() - chrono::Duration::days(TRASH_RETENTION_DAYS + 1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "UPDATE roles SET deleted_at = ?1 WHERE id = ?2",
        params![old, AUTHORED],
    )
    .unwrap();
    assert_eq!(store(&conn).purge_expired_roles().unwrap(), 1);
}

#[test]
fn soft_delete_role_refuses_every_builtin_preset_id() {
    // Deleting a preset would not just lose a row: users hold these ids,
    // and `authorize_with` fails closed on an unresolvable role, so the
    // effect would be silent loss of access rather than an error.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    let s = store(&conn);
    for preset in platform_core::rbac::ROLE_PRESETS {
        let err = s.soft_delete_role(preset.id).expect_err(&format!(
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
fn soft_delete_role_refuses_a_role_still_held_by_a_user() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "holder", AUTHORED);

    let err = store(&conn)
        .soft_delete_role(AUTHORED)
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
fn soft_delete_role_refuses_a_role_named_only_by_an_assignment() {
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
        matches!(
            s.soft_delete_role(AUTHORED),
            Err(CoreError::Validation { .. })
        ),
        "and that alone still blocks the delete"
    );
    assert!(
        s.get_role(AUTHORED).unwrap().is_some(),
        "the row survives the refused delete"
    );
}

#[test]
fn soft_delete_role_reports_missing_role_as_not_found() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    assert!(
        matches!(
            store(&conn).soft_delete_role("role-nope"),
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
    insert_user_with_role(&conn, "holder", AUTHORED);

    let s = store(&conn);
    // Referenced: the numbers say so, and the delete agrees.
    assert!(!s.role_reference_counts(AUTHORED).unwrap().is_empty());
    assert!(
        s.soft_delete_role(AUTHORED).is_err(),
        "referrers present, so the delete is refused"
    );

    // Unreferenced: the numbers say so, and the delete agrees. The row cannot
    // be re-inserted to prove this — a soft delete KEEPS it, which is the whole
    // point of the trash — so the referrer is removed instead and the order
    // reversed. Both directions of the pairing are still covered.
    conn.execute("DELETE FROM users WHERE id = 'holder'", [])
        .unwrap();
    assert!(s.role_reference_counts(AUTHORED).unwrap().is_empty());
    s.soft_delete_role(AUTHORED)
        .expect("no referrers, so the delete succeeds");
}

// ── The two referrer tables nothing inserted into ─────────────────────
//
// ROLE_REFERRERS names four tables. The tests above reach two of them
// (users, assignments); role_workspace_types and role_workspaces appear
// nowhere in this file, so nothing pins that the delete guard sees them.
// Dropping either entry from the array would let soft_delete_role clear its
// own pre-check and then hit a bare FK constraint violation — exactly the
// failure the guard exists to turn into "reassign these rows first" — and
// every test here would stay green.

/// Make sure the workspace dimension has a 'retail-pos' type and
/// workspace to point at. Both are already seeded by the migrations, so
/// this is an idempotent guarantee rather than a fresh insert: the FK on
/// role_workspace* needs the key to exist, and the test must not care who
/// put it there.
fn seed_workspace_dimension(conn: &Connection) {
    conn.execute_batch(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail-pos', 'Retail POS');
         INSERT OR IGNORE INTO workspaces (id, key, name) VALUES ('ws-retail', 'retail-pos', 'Retail');",
    )
    .unwrap();
}

#[test]
fn soft_delete_role_refuses_a_role_named_only_by_a_workspace_type() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    seed_workspace_dimension(&conn);
    conn.execute(
        "INSERT INTO role_workspace_types (role_id, type_key) VALUES (?1, 'retail-pos')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();

    let s = store(&conn);
    assert_eq!(
        s.role_reference_counts(AUTHORED).unwrap(),
        vec![("role_workspace_types", 1)],
        "the workspace-type grant is a referrer in its own right"
    );
    let err = s
        .soft_delete_role(AUTHORED)
        .expect_err("a role still granting a workspace type is in use");
    let CoreError::Validation { message, .. } = err else {
        panic!("expected a typed Validation error, got {err:?}");
    };
    assert!(
        message.contains("role_workspace_types=1"),
        "the refusal names the referrer and its count: {message}"
    );
    assert!(s.get_role(AUTHORED).unwrap().is_some());
}

#[test]
fn soft_delete_role_refuses_a_role_named_only_by_a_workspace() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    seed_workspace_dimension(&conn);
    conn.execute(
        "INSERT INTO role_workspaces (role_id, workspace_key) VALUES (?1, 'retail-pos')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();

    let s = store(&conn);
    assert_eq!(
        s.role_reference_counts(AUTHORED).unwrap(),
        vec![("role_workspaces", 1)],
        "and so is the per-workspace grant, which is a different table"
    );
    let err = s
        .soft_delete_role(AUTHORED)
        .expect_err("a role still bound to a workspace is in use");
    let CoreError::Validation { message, .. } = err else {
        panic!("expected a typed Validation error, got {err:?}");
    };
    assert!(
        message.contains("role_workspaces=1"),
        "the refusal names the referrer and its count: {message}"
    );
    assert!(s.get_role(AUTHORED).unwrap().is_some());
}

#[test]
fn role_reference_counts_enumerates_every_referrer_table_in_declared_order() {
    // One role, all four referrers, distinct counts. This is the test that
    // makes ROLE_REFERRERS itself load-bearing: it fails if an entry is
    // dropped, if a count is summed across tables, or if the order changes
    // (the refusal message is read by a human, so the order is part of the
    // contract, not an accident).
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    seed_workspace_dimension(&conn);
    insert_user_with_role(&conn, "holder-a", AUTHORED);
    insert_user_with_role(&conn, "holder-b", AUTHORED);
    insert_user_with_role(
        &conn,
        "assign-only",
        platform_core::rbac::builtin_roles::OWNER,
    );
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ('assign-only', ?1, 'global', 'all', 'all')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO role_workspace_types (role_id, type_key) VALUES (?1, 'retail-pos')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO role_workspaces (role_id, workspace_key) VALUES (?1, 'retail-pos')",
        rusqlite::params![AUTHORED],
    )
    .unwrap();

    let s = store(&conn);
    assert_eq!(
        s.role_reference_counts(AUTHORED).unwrap(),
        vec![
            ("users", 2),
            ("assignments", 1),
            ("role_workspace_types", 1),
            ("role_workspaces", 1),
        ],
        "every referrer table, in ROLE_REFERRERS order, each with its own count"
    );

    let err = s
        .soft_delete_role(AUTHORED)
        .expect_err("a role referenced anywhere cannot be dropped");
    let CoreError::Validation { message, .. } = err else {
        panic!("expected a typed Validation error, got {err:?}");
    };
    for named in [
        "users=2",
        "assignments=1",
        "role_workspace_types=1",
        "role_workspaces=1",
    ] {
        assert!(
            message.contains(named),
            "the refusal lists {named}: {message}"
        );
    }
}

// ── create_role: the folded-in fourth write ────────────────────────────

#[test]
fn create_role_refuses_every_builtin_preset_id() {
    // The create-side half of the guard update_role and soft_delete_role already
    // had. Deliberately run on an UNSEEDED database: with no preset rows
    // present, the primary-key constraint cannot be what stops these writes,
    // so a refusal here can only come from the guard.
    let conn = fresh();
    let s = store(&conn);
    for preset in platform_core::rbac::ROLE_PRESETS {
        let err = s
            .create_role(preset.id, "Renamed", "", r#"["sales:view"]"#)
            .expect_err(&format!("{} is a preset and must be refused", preset.id));
        assert!(
            matches!(&err, CoreError::Validation { field, .. } if *field == "id"),
            "preset {} rejected with a typed id error, got {err:?}",
            preset.id
        );
    }
    // Nothing landed, so there is no half-authored preset for a later seed
    // to silently overwrite.
    for preset in platform_core::rbac::ROLE_PRESETS {
        assert!(
            s.get_role(preset.id).unwrap().is_none(),
            "a refused create must not leave a row at {}",
            preset.id
        );
    }
}

#[test]
fn the_preset_guard_is_what_refuses_create_not_a_constraint() {
    // The mutation check, committed as a fact rather than a dev-time ritual.
    // On the SAME unseeded database a non-preset id inserts fine — so the
    // loop above is refusing on the guard, not on SQLite. Neuter
    // reject_builtin_role_id and this pair splits: the preset loop starts
    // succeeding while this test keeps passing, which is exactly the
    // difference that has to be visible.
    let conn = fresh();
    let s = store(&conn);
    assert!(
        s.create_role(
            platform_core::rbac::builtin_roles::OWNER,
            "x",
            "",
            r#"["sales:view"]"#
        )
        .is_err(),
        "a preset id must be refused even when no row exists to collide with"
    );
    let ok = s
        .create_role(AUTHORED, "Night Manager", "", r#"["sales:view"]"#)
        .expect("a non-preset id must be authorable on an unseeded DB");
    assert_eq!(ok.name, "Night Manager");
    assert!(
        s.get_role(AUTHORED).unwrap().is_some(),
        "the accepted write is durable"
    );
}

#[test]
fn create_and_update_share_one_rule_set() {
    // The property the fold buys: create and update cannot disagree about
    // what a legal role row is, because they call the same two validators.
    // If either grows a private copy of a rule again, this test splits.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    let s = store(&conn);

    let illegal: &[(&str, &str)] = &[
        ("permissions", r#"["sales:not_a_key"]"#),
        ("permissions", r#"["*"]"#),
        ("permissions", r#"["staff:*"]"#),
        ("permissions", "not json at all"),
        ("permissions", "[42]"),
        // Whitespace only: both writes trim, so this is the empty-name rule.
        ("name", "   "),
    ];
    for (field, payload) in illegal {
        let grants = if *field == "name" { "[]" } else { *payload };
        let name = if *field == "name" { *payload } else { "Parity" };
        let c = s
            .create_role("role-create-parity", name, "", grants)
            .expect_err("create must refuse");
        let u = s
            .update_role(AUTHORED, name, "", grants)
            .expect_err("update must refuse the same input");
        for (err, op) in [(&c, "create"), (&u, "update")] {
            match err {
                CoreError::Validation { field: f, .. } => assert_eq!(
                    *f, *field,
                    "{op} reported the wrong field for name={name:?} grants={grants:?}"
                ),
                other => panic!(
                    "{op} must refuse name={name:?} grants={grants:?} with Validation, got {other:?}"
                ),
            }
        }
    }

    // Parity is not only parity of refusal: the same legal payload has to be
    // accepted by both, or one of them is stricter than the shared rule.
    // Distinct names: role.name is unique, so reusing one across the two
    // legs would make the second leg fail on a collision this test caused.
    let legal = r#"["sales:process","reports:view"]"#;
    s.create_role("role-create-parity", "Parity Created", "", legal)
        .expect("create accepts a legal grant set");
    s.update_role(AUTHORED, "Parity Updated", "", legal)
        .expect("update accepts the same legal grant set");
}

// The five below moved here with the fold: they exercise `create_role`, which
// until `9c582a069` lived in `db/staff.rs` and so was tested from
// `staff_tests.rs`. They are kept as-is rather than folded into the parity
// test above — each names one refusal in its own test name, which is what a
// red run points a reader at — and the parity test is the one that would catch
// a future private copy of a rule.

#[test]
fn create_role_basic() {
    let conn = fresh();
    let r = store(&conn)
        .create_role(
            "role-viewer",
            "viewer",
            "Read-only access",
            r#"["sales:view"]"#,
        )
        .unwrap();
    assert_eq!(r.name, "viewer");
    assert_eq!(r.description, "Read-only access");
    assert_eq!(r.permissions, r#"["sales:view"]"#);
}

#[test]
fn create_role_duplicate_name() {
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    // 'Owner' is already taken by the preset — duplicate name should conflict.
    let err = store(&conn)
        .create_role("role-dup", "Owner", "Dup", "[]")
        .unwrap_err();
    assert!(matches!(err, CoreError::Conflict { entity, .. } if entity == "role"));
}

#[test]
fn create_role_rejects_unregistered_permission() {
    let conn = fresh();
    let err = store(&conn)
        .create_role("role-x", "X", "x", r#"["sales:typo"]"#)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "permissions"),
        "unregistered key must fail validation: {err}"
    );
}

#[test]
fn create_role_rejects_sensitive_family_wildcard() {
    let conn = fresh();
    let err = store(&conn)
        .create_role("role-x", "X", "x", r#"["sales:*"]"#)
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "permissions"),
        "a wildcard covering sensitive keys must fail validation: {err}"
    );
}

#[test]
fn create_role_accepts_valid_permission_set() {
    let conn = fresh();
    let grants = r#"["sales:process", "products:*", "sales:void"]"#;
    let r = store(&conn)
        .create_role("role-x", "X", "x", grants)
        .unwrap();
    assert_eq!(r.permissions, grants);
}

// ── role_holders ───────────────────────────────────────────────────────

/// A second authored role, so holder rows can point at something other than
/// AUTHORED and the two sets stay distinguishable.
const OTHER: &str = "role-other-manager";

fn insert_role(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES (?1, ?2, '', '[]',
                 '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        rusqlite::params![id, id.to_uppercase()],
    )
    .unwrap();
}

/// A user bound to a role with NO assignment row — the legacy shape the
/// resolver still has to answer.
fn insert_legacy_user(conn: &Connection, user_id: &str, role_id: &str) {
    insert_user_with_role(conn, user_id, role_id);
}

/// A user whose assignment says one role and whose `users` row says another.
/// Pass the same value twice for a synced user; different values to model
/// drift, which nothing in the schema prevents.
fn insert_user_with_assignment(
    conn: &Connection,
    user_id: &str,
    user_role: &str,
    assignment_role: &str,
) {
    insert_user_with_role(conn, user_id, user_role);
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES (?1, ?2, 'global', 'all', 'all')",
        rusqlite::params![user_id, assignment_role],
    )
    .unwrap();
}

fn holder_ids(holders: &[RoleHolder]) -> Vec<&str> {
    holders.iter().map(|h| h.user_id.as_str()).collect()
}

#[test]
fn role_holders_follow_the_assignment_when_it_disagrees_with_the_user_row() {
    // The load-bearing case, and the one a naive query gets silently wrong.
    // authorize_with resolves assignment-first, so this account can DO what
    // OTHER grants. Listing it as an AUTHORED holder would be a false claim
    // about permissions, which is worse than omitting it.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    insert_role(&conn, OTHER);
    insert_user_with_assignment(&conn, "drifted", AUTHORED, OTHER);

    let s = store(&conn);
    let (authored, _) = s.role_holders(AUTHORED, 50).unwrap();
    let (other, other_total) = s.role_holders(OTHER, 50).unwrap();
    assert!(
        authored.is_empty(),
        "a stale users.role_id must not list a holder"
    );
    assert_eq!(holder_ids(&other), vec!["drifted"]);
    assert_eq!(other_total, 1);
}

#[test]
fn role_holders_include_legacy_users_without_an_assignment() {
    // The other half: an account with no assignment row resolves through
    // users.role_id and must still be listed. Dropping it would hide a real
    // holder behind the JOIN.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    insert_legacy_user(&conn, "legacy-cashier", AUTHORED);

    let (holders, total) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    assert_eq!(holder_ids(&holders), vec!["legacy-cashier"]);
    assert_eq!(total, 1);
    assert!(
        !holders[0].has_assignment,
        "flagged as resolving via the fallback"
    );
    assert_eq!(holders[0].scope_mode, None, "no assignment, so no scope");
    assert_eq!(holders[0].scope_type, None);
    assert_eq!(
        holders[0].branch_count, None,
        "None means unknown-by-shape, not zero-branches"
    );
    assert_eq!(holders[0].branch_scope, None, "no dimension either");
    assert_eq!(holders[0].workspace_scope, None);
}

#[test]
fn role_holders_report_the_assignment_scope() {
    // The scope column the screen exists to show: the ADR #47 resource axis
    // plus the 0048 list dimensions, per holder.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "loc-mgr", AUTHORED);
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope,
                                  workspace_scope, scope_type, scope_id)
         VALUES ('loc-mgr', ?1, 'scoped', 'list', 'list', 'location', 'loc-1')",
        [AUTHORED],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignment_branches (assignment_user_id, branch_id)
         VALUES ('loc-mgr', 'br-1'), ('loc-mgr', 'br-2')",
        [],
    )
    .unwrap();
    // assignment_workspaces.workspace_key has a real FK, unlike branch_id,
    // so the workspace has to exist before it can be named in a scope.
    conn.execute(
        "INSERT INTO workspaces (id, key, name) VALUES ('ws-floor', 'floor', 'Floor')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignment_workspaces (assignment_user_id, workspace_key)
         VALUES ('loc-mgr', 'floor')",
        [],
    )
    .unwrap();

    let (holders, _) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    let h = &holders[0];
    assert!(h.has_assignment);
    assert_eq!(h.scope_mode.as_deref(), Some("scoped"));
    assert_eq!(h.scope_type.as_deref(), Some("location"));
    assert_eq!(h.scope_id.as_deref(), Some("loc-1"));
    assert_eq!(h.branch_scope.as_deref(), Some("list"));
    assert_eq!(h.workspace_scope.as_deref(), Some("list"));
    assert_eq!(h.branch_count, Some(2));
    assert_eq!(h.workspace_count, Some(1));
}

#[test]
fn role_holders_cap_at_fifty_and_still_report_the_total() {
    // The contract the UI renders as "and N more": the cap is a display
    // decision, so the total has to survive it or the message becomes a lie.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    for i in 0..60 {
        insert_legacy_user(&conn, &format!("user-{i:03}"), AUTHORED);
    }

    let (holders, total) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    assert_eq!(holders.len(), 50, "capped");
    assert_eq!(total, 60, "the full count is not clipped by the cap");
    assert_eq!(
        total - holders.len() as i64,
        10,
        "this difference is the and-N-more number the screen shows"
    );

    // A smaller ask gets a smaller page; the cap is a ceiling, not a default.
    let (small, small_total) = store(&conn).role_holders(AUTHORED, 5).unwrap();
    assert_eq!(small.len(), 5);
    assert_eq!(small_total, 60);

    // And the order is stable, or paging would shuffle the same faces.
    let (again, _) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    assert_eq!(holder_ids(&holders), holder_ids(&again));
}

#[test]
fn a_deleted_user_stops_being_a_holder_and_leaves_no_orphan() {
    // The orphan-cascade property. assignments.user_id is both the primary
    // key and REFERENCES users(id) ON DELETE CASCADE, and both list tables
    // cascade from the assignment. So deleting an account can never leave a
    // phantom holder behind.
    let conn = fresh();
    // The migrated snapshot is cloned onto a handle where the pragma is not
    // guaranteed on; enable it so CASCADE fires, as the app opens it.
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    insert_authored_role(&conn, "[]");
    insert_user_with_assignment(&conn, "walks-away", AUTHORED, AUTHORED);
    conn.execute(
        "INSERT INTO assignment_branches (assignment_user_id, branch_id)
         VALUES ('walks-away', 'br-1')",
        [],
    )
    .unwrap();

    let (before, total_before) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    assert_eq!(holder_ids(&before), vec!["walks-away"]);
    assert_eq!(total_before, 1);

    conn.execute("DELETE FROM users WHERE id = 'walks-away'", [])
        .unwrap();

    let (after, total_after) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    assert!(
        after.is_empty(),
        "a deleted account is not a holder: {after:?}"
    );
    assert_eq!(total_after, 0);
    let orphans: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assignments WHERE user_id = 'walks-away'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphans, 0, "the assignment row must cascade away");
    let orphan_branches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assignment_branches WHERE assignment_user_id = 'walks-away'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphan_branches, 0, "the scope list must cascade too");
}

#[test]
fn role_holders_refuse_a_missing_role_rather_than_reporting_nobody() {
    // An empty list for a role that does not exist is the shape of answer a
    // delete decision gets made from, so a typo must not read as "unheld".
    let conn = fresh();
    let err = store(&conn)
        .role_holders("role-does-not-exist", 50)
        .expect_err("a missing role must be reported, not emptied");
    assert!(
        matches!(&err, CoreError::NotFound { entity, .. } if *entity == "role"),
        "{err:?}"
    );
}

#[test]
fn role_holders_agree_with_reference_counts_when_synced() {
    // The common case, pinned rather than assumed: for users whose assignment
    // and user row agree — every row create_user makes — the holder list and
    // the FK referrer counts name the same number.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    for id in ["synced-a", "synced-b", "synced-c"] {
        insert_user_with_assignment(&conn, id, AUTHORED, AUTHORED);
    }

    let s = store(&conn);
    let (holders, total) = s.role_holders(AUTHORED, 50).unwrap();
    assert_eq!(holders.len(), 3);
    assert_eq!(total, 3);
    let refs = s.role_reference_counts(AUTHORED).unwrap();
    let users_ref = refs.iter().find(|(t, _)| *t == "users").map(|(_, c)| *c);
    let assign_ref = refs
        .iter()
        .find(|(t, _)| *t == "assignments")
        .map(|(_, c)| *c);
    assert_eq!(users_ref, Some(3), "same set the FK view sees");
    assert_eq!(assign_ref, Some(3));
}
#[test]
fn a_zero_list_count_does_not_mean_an_unscoped_holder() {
    // The reason branch_scope exists next to branch_count. An assignment
    // covering EVERY branch has zero explicit rows, so a column that showed
    // only the count would render an all-branches manager as holding no
    // branches — the opposite of the truth, in the one list an admin reads
    // before revoking something.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    insert_user_with_role(&conn, "all-branches", AUTHORED);
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ('all-branches', ?1, 'scoped', 'all', 'all')",
        [AUTHORED],
    )
    .unwrap();

    let (holders, _) = store(&conn).role_holders(AUTHORED, 50).unwrap();
    let h = &holders[0];
    assert_eq!(h.scope_mode.as_deref(), Some("scoped"));
    assert_eq!(h.branch_count, Some(0), "no rows, because none are needed");
    assert_eq!(
        h.branch_scope.as_deref(),
        Some("all"),
        "the dimension is what makes the zero mean unrestricted",
    );
    assert_eq!(h.workspace_scope.as_deref(), Some("all"));
    assert_eq!(h.workspace_count, Some(0));
}
#[test]
fn role_holder_count_counts_accounts_and_never_referrer_rows() {
    // The reason this is a query and not an arithmetic shortcut on
    // role_reference_counts. create_user writes a users row AND an
    // assignments row for the SAME person, so summing referrer rows counts
    // every ordinary account twice — three holders would read as six, which
    // is the exact bug the label this field exists to feed was shipping.
    let conn = fresh();
    store(&conn).seed_default_roles().unwrap();
    insert_authored_role(&conn, "[]");
    for id in ["synced-a", "synced-b", "synced-c"] {
        insert_user_with_assignment(&conn, id, AUTHORED, AUTHORED);
    }

    let s = store(&conn);
    let summed_referrers: i64 = s
        .role_reference_counts(AUTHORED)
        .unwrap()
        .iter()
        .map(|(_, c)| *c)
        .sum();
    assert_eq!(
        summed_referrers, 6,
        "three accounts across two tables each — what the naive sum gives"
    );
    assert_eq!(
        s.role_holder_count(AUTHORED).unwrap(),
        3,
        "the count is accounts, not rows"
    );
}

#[test]
fn role_holder_count_and_role_holders_cannot_disagree() {
    // Both read the shared HOLDERS_FROM_WHERE, so the "N accounts" a surface
    // prints beside its expanded list is the list it is beside — including
    // through the cap, which is the point: the total is not the page length.
    let conn = fresh();
    insert_authored_role(&conn, "[]");
    for i in 0..7 {
        // Three the synced way, four the legacy way: both arms exercised.
        if i < 3 {
            insert_user_with_assignment(&conn, &format!("u{i}"), AUTHORED, AUTHORED);
        } else {
            insert_legacy_user(&conn, &format!("u{i}"), AUTHORED);
        }
    }

    let s = store(&conn);
    let (page, total) = s.role_holders(AUTHORED, 4).unwrap();
    assert_eq!(page.len(), 4, "capped at the requested size");
    assert_eq!(total, 7);
    assert_eq!(
        s.role_holder_count(AUTHORED).unwrap(),
        total,
        "the standalone count equals the list total"
    );

    let err = s
        .role_holder_count("role-nope")
        .expect_err("a missing role must refuse, not report zero");
    assert!(
        matches!(&err, CoreError::NotFound { entity, .. } if *entity == "role"),
        "{err:?}"
    );
}
