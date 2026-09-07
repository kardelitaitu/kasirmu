use super::*;
use crate::migrations;

fn seed_user(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('u1', 'u1', 'h', 'U1', 'role-staff', 1,
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');",
    )
    .unwrap();
}

fn insert_assignment(
    conn: &rusqlite::Connection,
    mode: &str,
    branch_scope: &str,
    workspace_scope: &str,
) {
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ('u1', 'role-staff', ?1, ?2, ?3)",
        params![mode, branch_scope, workspace_scope],
    )
    .unwrap();
}

#[test]
fn write_assignment_scope_joins_an_open_transaction() {
    let conn = migrations::fresh_db();
    seed_user(&conn);

    // The in-tx writer must not open a nested transaction: when called
    // inside a caller's transaction, the statements join it and a
    // subsequent rollback undoes the assignment write too.
    let tx = conn.unchecked_transaction().unwrap();
    let in_tx = Store::new(&tx);
    in_tx
        .write_assignment_scope(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Scoped,
                branches_all: false,
                branches: vec!["store-a".into()],
                workspaces_all: false,
                workspaces: vec!["retail-pos".into()],
                scope_type: ScopeType::Organization,
                scope_id: None,
            },
        )
        .unwrap();
    tx.rollback().unwrap();

    // Rolled back: no assignment row survives.
    let store = Store::new(&conn);
    assert!(store.assignment_for_user("u1").unwrap().is_none());
}

#[test]
fn assignment_for_user_loads_global_assignment() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_assignment(&conn, "global", "all", "all");
    let store = Store::new(&conn);

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.user_id, "u1");
    assert_eq!(a.role_id, "role-staff");
    assert_eq!(a.scope_mode, ScopeMode::Global);
    assert!(a.branches.is_empty() && a.workspaces.is_empty());
}

#[test]
fn assignment_for_user_returns_none_when_absent() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    assert!(store.assignment_for_user("u1").unwrap().is_none());
    assert!(store.assignment_for_user("no-such-user").unwrap().is_none());
}

#[test]
fn assignment_for_user_loads_scoped_lists() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_assignment(&conn, "scoped", "list", "list");
    conn.execute_batch(
        "INSERT INTO assignment_branches (assignment_user_id, branch_id) VALUES
             ('u1', 'store-a'), ('u1', 'store-b');
         INSERT INTO assignment_workspaces (assignment_user_id, workspace_key)
         VALUES ('u1', 'retail-pos');",
    )
    .unwrap();
    let store = Store::new(&conn);

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_mode, ScopeMode::Scoped);
    assert!(!a.branches_all && !a.workspaces_all);
    assert_eq!(a.branches, vec!["store-a", "store-b"]);
    assert_eq!(a.workspaces, vec!["retail-pos"]);
}

#[test]
fn set_assignment_writes_scoped_dimensions() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Scoped,
                branches_all: false,
                branches: vec!["store-a".into(), "store-b".into()],
                workspaces_all: false,
                workspaces: vec!["retail-pos".into()],
                scope_type: ScopeType::Organization,
                scope_id: None,
            },
        )
        .unwrap();

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_mode, ScopeMode::Scoped);
    assert!(!a.branches_all && !a.workspaces_all);
    assert_eq!(a.branches, vec!["store-a", "store-b"]);
    assert_eq!(a.workspaces, vec!["retail-pos"]);
}

#[test]
fn set_assignment_replaces_existing_scope_and_clears_stale_rows() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);
    store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Scoped,
                branches_all: false,
                branches: vec!["store-a".into()],
                workspaces_all: false,
                workspaces: vec!["retail-pos".into()],
                scope_type: ScopeType::Organization,
                scope_id: None,
            },
        )
        .unwrap();

    // Switch to global all/all: the previous dimension rows must not
    // survive as stale grants (ADR #35 D5: empty lists never mean "all",
    // and `all` must mean every branch/workspace).
    store
        .set_assignment(
            "u1",
            "role-staff",
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

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_mode, ScopeMode::Global);
    assert!(a.branches_all && a.workspaces_all);
    assert!(a.branches.is_empty() && a.workspaces.is_empty());
    // The dimension tables carry no stale rows either.
    let branches_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assignment_branches WHERE assignment_user_id = 'u1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let workspaces_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assignment_workspaces WHERE assignment_user_id = 'u1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(branches_left, 0);
    assert_eq!(workspaces_left, 0);
}

#[test]
fn matches_scope_global_ignores_dimensions() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.matches_scope(None, None));
    assert!(a.matches_scope(Some("store-a"), Some("retail-pos")));
    assert!(a.matches_scope(Some("anything"), Some("anything-else")));
}

#[test]
fn matches_scope_explicit_all_matches_any_context() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Scoped,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.matches_scope(None, None));
    assert!(a.matches_scope(Some("store-z"), Some("kds")));
}

#[test]
fn matches_scope_branch_list_requires_branch_in_scope() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Scoped,
        branches_all: false,
        branches: vec!["store-a".into()],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.matches_scope(Some("store-a"), None));
    assert!(!a.matches_scope(Some("store-b"), None));
    // No branch context on a list dimension denies (fail closed).
    assert!(!a.matches_scope(None, None));
}

#[test]
fn matches_scope_workspace_list_requires_workspace_in_scope() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Scoped,
        branches_all: true,
        branches: vec![],
        workspaces_all: false,
        workspaces: vec!["retail-pos".into()],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.matches_scope(None, Some("retail-pos")));
    assert!(!a.matches_scope(None, Some("kds")));
    assert!(!a.matches_scope(None, None));
}

#[test]
fn matches_scope_both_lists_require_combination() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Scoped,
        branches_all: false,
        branches: vec!["store-a".into()],
        workspaces_all: false,
        workspaces: vec!["retail-pos".into()],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.matches_scope(Some("store-a"), Some("retail-pos")));
    assert!(!a.matches_scope(Some("store-a"), Some("kds")));
    assert!(!a.matches_scope(Some("store-b"), Some("retail-pos")));
    assert!(!a.matches_scope(Some("store-b"), Some("kds")));
}

#[test]
fn matches_scope_empty_list_is_deny_not_all() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Scoped,
        branches_all: false,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    // An empty list must never mean "all" — it denies everything.
    assert!(!a.matches_scope(Some("store-a"), None));
    assert!(!a.matches_scope(None, None));
}

#[test]
fn scope_mode_parse_roundtrips_and_unknown_is_none() {
    assert_eq!(ScopeMode::parse("global"), Some(ScopeMode::Global));
    assert_eq!(ScopeMode::parse("scoped"), Some(ScopeMode::Scoped));
    assert_eq!(ScopeMode::parse("bogus"), None);
    assert_eq!(ScopeMode::parse(""), None);
    assert_eq!(ScopeMode::Global.as_str(), "global");
    assert_eq!(ScopeMode::Scoped.as_str(), "scoped");
}

// ── ADR #47 slice 1: the hierarchical scope axis (20260916) ─────────

#[test]
fn scope_type_parse_roundtrips_and_unknown_is_none() {
    assert_eq!(
        ScopeType::parse("organization"),
        Some(ScopeType::Organization)
    );
    assert_eq!(
        ScopeType::parse("legal_entity"),
        Some(ScopeType::LegalEntity)
    );
    assert_eq!(ScopeType::parse("location"), Some(ScopeType::Location));
    // Fail closed: an unparsable value must NOT become org-wide.
    assert_eq!(ScopeType::parse("bogus"), None);
    assert_eq!(ScopeType::parse(""), None);
    assert_eq!(ScopeType::Organization.as_str(), "organization");
    assert_eq!(ScopeType::LegalEntity.as_str(), "legal_entity");
    assert_eq!(ScopeType::Location.as_str(), "location");
}

#[test]
fn covers_resource_org_wide_covers_everything() {
    // The backfill's bit-for-bit behavior preservation (ruling 5): an
    // organization row grants every resource kind.
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Organization),
        scope_id: None,
    };
    assert!(a.covers_resource(ScopeType::Organization, "whatever"));
    assert!(a.covers_resource(ScopeType::LegalEntity, "ent-1"));
    assert!(a.covers_resource(ScopeType::Location, "loc-9"));
}

#[test]
fn covers_resource_location_scoped_denies_other_locations() {
    // The P0 sentence pinned at the model layer: a manager assigned to
    // Location A must not automatically manage Location B.
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-manager".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::Location),
        scope_id: Some("loc-a".into()),
    };
    assert!(a.covers_resource(ScopeType::Location, "loc-a"));
    assert!(!a.covers_resource(ScopeType::Location, "loc-b"));
    // A location row never grants legal-entity-level authority
    // (downward-only inheritance, ruling 3).
    assert!(!a.covers_resource(ScopeType::LegalEntity, "ent-1"));
    assert!(!a.covers_resource(ScopeType::Organization, "org"));
}

#[test]
fn covers_resource_legal_entity_is_entity_scoped() {
    let a = Assignment {
        user_id: "u1".into(),
        role_id: "role-manager".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: Some(ScopeType::LegalEntity),
        scope_id: Some("ent-1".into()),
    };
    assert!(a.covers_resource(ScopeType::LegalEntity, "ent-1"));
    assert!(!a.covers_resource(ScopeType::LegalEntity, "ent-2"));
    assert!(!a.covers_resource(ScopeType::Location, "ent-1"));
    assert!(!a.covers_resource(ScopeType::Organization, "org"));
}

#[test]
fn covers_resource_unparsable_pair_denies() {
    // A row that somehow lost its type (hand-edited DB) or its id must
    // deny rather than silently act org-wide — the scope_mode precedent.
    let mut a = Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: None,
        scope_id: None,
    };
    assert!(!a.covers_resource(ScopeType::Location, "loc-a"));
    a.scope_type = Some(ScopeType::Location);
    a.scope_id = None; // type without id — the pair triggers forbid this
    assert!(!a.covers_resource(ScopeType::Location, "loc-a"));
    a.scope_type = Some(ScopeType::Organization);
    a.scope_id = Some("stray-id".into()); // org with a stray id: still org-wide
    assert!(a.covers_resource(ScopeType::Location, "loc-a"));
}

#[test]
fn migration_backfills_existing_assignments_to_organization() {
    use crate::migrations;

    // Split the registry at the ADR-47 migration: apply everything up to
    // but not including it, seed a legacy assignment row, then apply the
    // rest — the row must come out org-wide with NULL scope_id.
    let split = crate::migrations::ALL
        .iter()
        .position(|m| m.id == "20260916_role_assignment_scopes.sql")
        .expect("ADR-47 migration present in registry");
    let mut conn = migrations::fresh_db();
    platform_core::database::run(&mut conn, &crate::migrations::ALL[..split]).unwrap();

    seed_user(&conn);
    insert_assignment(&conn, "global", "all", "all");

    platform_core::database::run(&mut conn, &crate::migrations::ALL[split..]).unwrap();

    let store = Store::new(&conn);
    let a = store
        .assignment_for_user("u1")
        .expect("load after backfill")
        .expect("assignment survives the migration");
    assert_eq!(a.scope_type, Some(ScopeType::Organization));
    assert_eq!(a.scope_id, None);
    // And the gate still authorizes exactly as before the migration.
    assert!(store.require_permission("u1", "sales:view").is_ok());
}

#[test]
fn assignments_scope_pair_triggers_enforce_null_iff_organization() {
    use crate::migrations;

    let conn = migrations::fresh_db();
    seed_user(&conn);

    // Location row without scope_id → the insert trigger aborts.
    let err = conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('u1', 'role-staff', 'global', 'all', 'all', 'location', NULL)",
        [],
    );
    assert!(
        err.is_err(),
        "location row without scope_id must be rejected"
    );

    // Organization row with a scope_id → likewise aborted.
    let err = conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('u1', 'role-staff', 'global', 'all', 'all', 'organization', 'loc-a')",
        [],
    );
    assert!(
        err.is_err(),
        "organization row with scope_id must be rejected"
    );

    // Both valid shapes pass: org-wide (NULL) and location-scoped.
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('u1', 'role-staff', 'global', 'all', 'all', 'organization', NULL)",
        [],
    )
    .expect("organization row with NULL scope_id is the valid org-wide shape");
    conn.execute(
        "UPDATE assignments SET scope_type = 'location', scope_id = 'loc-a' WHERE user_id = 'u1'",
        [],
    )
    .expect("location row with scope_id is a valid shape");

    // The update trigger also fires: flipping back to organization while
    // keeping the id aborts.
    let err = conn.execute(
        "UPDATE assignments SET scope_type = 'organization' WHERE user_id = 'u1'",
        [],
    );
    assert!(
        err.is_err(),
        "update to organization keeping scope_id must be rejected"
    );
}

#[test]
fn migration_backfills_rowless_users_org_wide() {
    use crate::migrations;

    // Build the genuine pre-backfill state: run everything up to (but not
    // including) the backfill on an EMPTY connection — fresh_db() would
    // pre-apply all migrations and make the split a no-op. Then seed one
    // user WITH a (location-scoped) row and two WITHOUT any row, apply the
    // rest, and assert the backfill: the row-less users gain the org-wide
    // pair (bit-for-bit the legacy "not scope-restricted" semantics) and
    // the existing scoped row is untouched.
    let split = crate::migrations::ALL
        .iter()
        .position(|m| m.id == "20260917_assignment_backfill_org_wide.sql")
        .expect("backfill migration present in registry");
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    platform_core::database::run(&mut conn, &crate::migrations::ALL[..split]).unwrap();

    conn.execute_batch(
        "INSERT INTO roles (id, name, permissions) VALUES
             ('role-staff', 'staff', '[\"sales:view\"]');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
             ('u-scoped', 'scoped', 'h', 'Scoped', 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('u-rowless', 'rowless', 'h', 'Rowless', 'role-staff', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
             ('u-inactive', 'inactive', 'h', 'Inactive', 'role-staff', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id) VALUES
             ('u-scoped', 'role-staff', 'global', 'all', 'all', 'location', 'loc-keep');",
    )
    .unwrap();

    platform_core::database::run(&mut conn, &crate::migrations::ALL[split..]).unwrap();

    let store = Store::new(&conn);

    // The pre-existing scoped row is untouched by the backfill.
    let scoped = store
        .assignment_for_user("u-scoped")
        .unwrap()
        .expect("scoped row survives");
    assert_eq!(scoped.scope_type, Some(ScopeType::Location));
    assert_eq!(scoped.scope_id.as_deref(), Some("loc-keep"));

    // The row-less user gains the org-wide pair — the same authorization
    // the no-row fallback used to give, now as an explicit row.
    let backfilled = store
        .assignment_for_user("u-rowless")
        .unwrap()
        .expect("row-less user backfilled");
    assert_eq!(backfilled.scope_type, Some(ScopeType::Organization));
    assert_eq!(backfilled.scope_id, None);
    assert_eq!(backfilled.scope_mode, ScopeMode::Global);

    // Inactive users are backfilled too: reactivation must not silently
    // resurrect the no-row fallback path.
    let inactive = store
        .assignment_for_user("u-inactive")
        .unwrap()
        .expect("inactive user backfilled");
    assert_eq!(inactive.scope_type, Some(ScopeType::Organization));

    // And the org-wide backfilled row authorizes exactly like the legacy
    // fallback did.
    store
        .require_permission_for_resource("u-rowless", "sales:view", ScopeType::Location, "loc-any")
        .expect("backfilled org-wide row covers any resource");
}

// ── ADR #47 choke point: Store::require_permission_for_resource ──────
//
// The gate semantics tests live here (next to the Assignment model
// tests) because the choke point is the DB-backed composition of
// `covers_resource` + the entity→location walk + `authorize_with`.

/// Seed the two-entity / three-location topology used by the walk tests:
/// ent-1 owns loc-ent1, ent-2 owns loc-ent2, and loc-orphan carries no
/// entity (the 20260908 backfill only touched pre-existing NULL rows, so a
/// fresh NULL insert stays NULL).
fn seed_entity_topology(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO legal_entities (id, tenant_id, name) VALUES
             ('ent-1', 'default', 'Entity One'),
             ('ent-2', 'default', 'Entity Two');
         INSERT INTO locations (id, name, tenant_id, legal_entity_id) VALUES
             ('loc-ent1', 'Location One', 'default', 'ent-1'),
             ('loc-ent2', 'Location Two', 'default', 'ent-2'),
             ('loc-orphan', 'Orphan', 'default', NULL);",
    )
    .unwrap();
}

/// Insert a `global`-mode assignment with an explicit ADR #47 scope pair.
/// Global mode keeps the spec-0048 branch/workspace axis out of the way so
/// each test exercises the resource axis in isolation.
fn insert_scoped_assignment(conn: &rusqlite::Connection, scope_type: &str, scope_id: Option<&str>) {
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope, scope_type, scope_id)
         VALUES ('u1', 'role-staff', 'global', 'all', 'all', ?1, ?2)",
        params![scope_type, scope_id],
    )
    .unwrap();
}

#[test]
fn resource_gate_org_assignment_covers_every_resource_kind() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "organization", None);
    let store = Store::new(&conn);

    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-x")
        .expect("org assignment covers any location");
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::LegalEntity, "ent-x")
        .expect("org assignment covers any legal entity");
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Organization, "default")
        .expect("org assignment covers org-level resources");
}

#[test]
fn resource_gate_location_assignment_covers_only_own_location() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "location", Some("loc-1"));
    let store = Store::new(&conn);

    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-1")
        .expect("own location is covered");

    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-2")
        .expect_err("another location must deny");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));

    // Upward access denies: a location assignment never reaches its parent
    // entity or the org level (ruling 3's downward-only inheritance).
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::LegalEntity, "ent-1")
        .expect_err("location assignment must not reach its parent entity");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Organization, "default")
        .expect_err("location assignment must not reach the org level");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));

    // Coverage is not permission: role-staff lacks settings:edit even on
    // its OWN location.
    let err = store
        .require_permission_for_resource("u1", "settings:edit", ScopeType::Location, "loc-1")
        .expect_err("coverage does not replace the permission check");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
}

#[test]
fn resource_gate_legal_entity_assignment_walks_down_to_owned_locations() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "legal_entity", Some("ent-1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::LegalEntity, "ent-1")
        .expect("own entity id is covered directly");
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-ent1")
        .expect("the downward walk covers locations owned by the entity");

    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-ent2")
        .expect_err("another entity's location is a sibling, not a child");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));

    // Fail closed: an unknown location and a NULL-entity location both
    // deny — the walk cannot prove ownership for either.
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-unknown")
        .expect_err("unknown location must deny");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-orphan")
        .expect_err("NULL-entity location must deny");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));

    // Upward: an entity assignment never reaches the org level.
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Organization, "default")
        .expect_err("entity assignment must not reach the org level");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
}

#[test]
fn resource_gate_no_assignment_row_keeps_legacy_unrestricted_scope() {
    // Ruling 5 bit-for-bit: a user with NO assignments row (the legacy
    // shape) is not scope-restricted — but the permission itself is still
    // enforced. Tightening no-row users is deliberately deferred to the
    // assignment-creation slice, not silently dropped.
    let conn = migrations::fresh_db();
    seed_user(&conn); // u1 + role-staff, deliberately NO assignment row
    let store = Store::new(&conn);

    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-any")
        .expect("legacy no-row user is not scope-restricted");

    let err = store
        .require_permission_for_resource("u1", "settings:edit", ScopeType::Location, "loc-any")
        .expect_err("no-row preserves scope freedom, not permission");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
}

#[test]
fn set_assignment_writes_location_scoped_resource_pair() {
    // The assignment-creation slice (ruling 1A): the writer now grants
    // narrower-than-org rows, and the loaded model round-trips the pair so
    // the ADR #47 gate can enforce manager-of-A-cannot-touch-B.
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Global,
                branches_all: true,
                branches: vec![],
                workspaces_all: true,
                workspaces: vec![],
                scope_type: ScopeType::Location,
                scope_id: Some("loc-a".into()),
            },
        )
        .expect("location-scoped assignment is a valid pair");

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_type, Some(ScopeType::Location));
    assert_eq!(a.scope_id.as_deref(), Some("loc-a"));
    assert!(a.covers_resource(ScopeType::Location, "loc-a"));
    assert!(!a.covers_resource(ScopeType::Location, "loc-b"));
    // End to end through the gate: own location passes, another denies.
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-a")
        .expect("own location is covered");
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-b")
        .expect_err("another location must deny");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
}

#[test]
fn set_assignment_writes_legal_entity_resource_pair() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Global,
                branches_all: true,
                branches: vec![],
                workspaces_all: true,
                workspaces: vec![],
                scope_type: ScopeType::LegalEntity,
                scope_id: Some("ent-1".into()),
            },
        )
        .expect("entity-scoped assignment is a valid pair");

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_type, Some(ScopeType::LegalEntity));
    assert_eq!(a.scope_id.as_deref(), Some("ent-1"));
    assert!(a.covers_resource(ScopeType::LegalEntity, "ent-1"));
}

#[test]
fn set_assignment_rejects_invalid_resource_pairs() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    // A narrowed kind without its id violates the pair triggers — the
    // Rust-side validation must reject it with a typed error before SQL
    // ever sees it.
    let err = store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Global,
                branches_all: true,
                branches: vec![],
                workspaces_all: true,
                workspaces: vec![],
                scope_type: ScopeType::Location,
                scope_id: None,
            },
        )
        .expect_err("location without scope_id must be rejected");
    assert!(matches!(err, crate::CoreError::Validation { .. }));

    // Organization with a stray id is the mirror-invalid pair.
    let err = store
        .set_assignment(
            "u1",
            "role-staff",
            &AssignmentSpec {
                scope_mode: ScopeMode::Global,
                branches_all: true,
                branches: vec![],
                workspaces_all: true,
                workspaces: vec![],
                scope_type: ScopeType::Organization,
                scope_id: Some("stray".into()),
            },
        )
        .expect_err("organization with scope_id must be rejected");
    assert!(matches!(err, crate::CoreError::Validation { .. }));

    // Nothing was written: the raw-SQL-seeded user still has no row.
    assert!(store.assignment_for_user("u1").unwrap().is_none());
}
