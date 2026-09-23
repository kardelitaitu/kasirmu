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
    // Split the registry at the ADR-47 migration: apply everything up to
    // but not including it, seed a legacy assignment row, then apply the
    // rest — the row must come out org-wide with NULL scope_id.
    let split = crate::migrations::ALL
        .iter()
        .position(|m| m.id == "20260916_role_assignment_scopes.sql")
        .expect("ADR-47 migration present in registry");
    // Use a blank connection, not fresh_db(): fresh_db() returns a snapshot with
    // ALL migrations already recorded, so the boot guard would see the post-split
    // migrations as "from a newer build" and refuse to run the prefix slice.
    let mut conn = rusqlite::Connection::open_in_memory()
        .expect("blank in-memory DB for migration split test");
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

// ── Diagnostics mirror: Store::assignment_covers_resource ────────────
//
// The availability resolver's `scope` reason code reads this helper
// rather than calling the gate, because a gate denial throws and a
// diagnostic must not. Two properties keep that honest: it never reports
// a denial the gate would not throw, and never a clearance the gate would
// not grant. Both are asserted against the gate itself, so a future edit
// to either side fails here instead of shipping a diagnostic that lies.

#[test]
fn coverage_diagnostic_agrees_with_the_resource_gate() {
    let assignments = [
        ("organization", None),
        ("legal_entity", Some("ent-1")),
        ("location", Some("loc-ent1")),
        ("location", Some("loc-other")),
    ];
    let resources = [
        (ScopeType::Location, "loc-ent1"),
        (ScopeType::Location, "loc-ent2"),
        (ScopeType::Location, "loc-orphan"),
        (ScopeType::Location, "loc-unknown"),
        (ScopeType::LegalEntity, "ent-1"),
        (ScopeType::LegalEntity, "ent-2"),
        (ScopeType::Organization, "default"),
    ];

    for (scope_type, scope_id) in assignments {
        for (res_type, res_id) in resources {
            let conn = migrations::fresh_db();
            seed_user(&conn);
            insert_scoped_assignment(&conn, scope_type, scope_id);
            seed_entity_topology(&conn);
            let store = Store::new(&conn);

            let covered = store
                .assignment_covers_resource("u1", res_type, res_id)
                .unwrap();
            // `sales:view` is the permission role-staff holds, so any gate
            // denial here is a scope denial and nothing else.
            let gate_allows = store
                .require_permission_for_resource("u1", "sales:view", res_type, res_id)
                .is_ok();

            assert_eq!(
                covered != Some(false),
                gate_allows,
                "diagnostic {covered:?} disagrees with the gate for assignment \
                 ({scope_type}, {scope_id:?}) over {res_type:?} {res_id}"
            );
        }
    }
}

#[test]
fn coverage_diagnostic_is_silent_for_a_user_with_no_assignment_row() {
    // Ruling 5's `None` is not a denial. A legacy user with no row has no
    // scope to report, and the resolver must leave `scope` out of the
    // precedence contest rather than answer "not covered".
    let conn = migrations::fresh_db();
    seed_user(&conn); // deliberately no assignment row
    let store = Store::new(&conn);

    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-any")
            .unwrap(),
        None,
        "no assignment row means no scope answer, not a denial"
    );
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::Location, "loc-any")
        .expect("the gate agrees: a no-row user is not scope-restricted");
}

#[test]
fn coverage_diagnostic_walks_down_to_entity_owned_locations() {
    // The trap this pins: `Assignment::covers_resource` returns false for a
    // (legal_entity assignment, location resource) pair on purpose — the
    // walk needs the `locations` table, which the model layer must not
    // assume. A diagnostic calling the model method directly would report
    // `scope` for a manager standing in a location their own entity owns:
    // a false denial about enforcement, which is worse than no diagnostic.
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "legal_entity", Some("ent-1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-ent1")
            .unwrap(),
        Some(true),
        "the entity's own location is covered by the walk"
    );
    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-ent2")
            .unwrap(),
        Some(false),
        "a sibling entity's location is not"
    );
    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-orphan")
            .unwrap(),
        Some(false),
        "a NULL-entity location cannot prove ownership — fail closed"
    );
    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-unknown")
            .unwrap(),
        Some(false),
        "an unknown location fails closed"
    );
}

#[test]
fn resource_axis_answers_where_the_branch_axis_clears() {
    // Why the verdict reads the ADR #47 axis and not spec 0048's
    // `matches_scope`. This pair is creatable from the staff UI today: the
    // resource-scope picker renders outside the `scoped` conditional, so
    // `global` mode and a narrowed resource coexist. For it,
    // `matches_scope` is unconditionally true — a diagnostic built on that
    // axis could never report a denial, because the session gate already
    // enforced it before the command body ran.
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "location", Some("loc-ent1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    let a = store
        .assignment_for_user("u1")
        .unwrap()
        .expect("assignment");
    assert_eq!(a.scope_mode, ScopeMode::Global);
    assert!(
        a.matches_scope(Some("loc-ent2"), Some("retail-pos")),
        "global mode ignores both branch dimensions — the dead axis"
    );
    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-ent2")
            .unwrap(),
        Some(false),
        "the resource axis is the one that can actually answer"
    );
    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-ent1")
            .unwrap(),
        Some(true),
        "and it clears the caller's own location"
    );
}
// ── What the agreement matrix does NOT pin ───────────────────────────
//
// The four tests above compare the diagnostic against the gate on the
// scope axis, always with a permission the role actually holds. That
// leaves three ways the diagnostic can start lying without any of them
// noticing: it can grow the gate's other denial paths (registry,
// permission grant, user resolution), it can resolve the entity walk
// from something other than the live locations row, and its fail-closed
// guards can be dropped because no SQL-storable row reaches them. Each
// test below kills one of those mutations.

/// The gate's denial reasons other than scope. None of them may move
/// the diagnostic's answer: assignment_covers_resource takes no
/// permission key at all, so an availability verdict that reads it can
/// never blame the scope axis for a missing grant, an unregistered key,
/// or a dead account.
#[test]
fn coverage_diagnostic_answers_coverage_and_nothing_else() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "legal_entity", Some("ent-1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    let covers_own_entity = || {
        store
            .assignment_covers_resource("u1", ScopeType::LegalEntity, "ent-1")
            .unwrap()
    };

    // Baseline: the resource IS covered, and the gate agrees.
    assert_eq!(covers_own_entity(), Some(true));
    store
        .require_permission_for_resource("u1", "sales:view", ScopeType::LegalEntity, "ent-1")
        .expect("held permission over a covered resource");

    // 1. A registered permission the role lacks. The gate denies on the
    //    grant; coverage is unchanged, so a verdict must not read it as
    //    a scope denial.
    let err = store
        .require_permission_for_resource("u1", "settings:edit", ScopeType::LegalEntity, "ent-1")
        .expect_err("coverage never replaces the permission check");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    assert_eq!(
        covers_own_entity(),
        Some(true),
        "a missing grant must not read as an uncovered resource"
    );

    // 2. An unregistered key: denied before the user is even looked at.
    //    Same answer again, which is the point: the diagnostic never
    //    sees the required permission at all.
    let err = store
        .require_permission_for_resource(
            "u1",
            "nope:not-registered",
            ScopeType::LegalEntity,
            "ent-1",
        )
        .expect_err("deny-by-default on an unregistered key");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    assert_eq!(covers_own_entity(), Some(true));

    // 3. A user the gate cannot resolve at all. The gate throws; the
    //    diagnostic answers None — no row, no answer, and crucially no
    //    error, which is the whole reason a verdict may call it.
    let err = store
        .require_permission_for_resource("ghost", "sales:view", ScopeType::Location, "loc-ent1")
        .expect_err("the gate cannot authorize a user that does not exist");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    assert_eq!(
        store
            .assignment_covers_resource("ghost", ScopeType::Location, "loc-ent1")
            .unwrap(),
        None,
        "a user with no assignment row has no scope answer, and must not throw"
    );

    // 4. A deactivated account whose assignment still covers the
    //    resource. The gate denies on the account; the diagnostic keeps
    //    answering the scope question — Some(true) is a coverage verdict,
    //    never an authorization one.
    conn.execute("UPDATE users SET is_active = 0 WHERE id = 'u1'", params![])
        .unwrap();
    let err = store
        .require_permission_for_resource("u1", "sales:view", ScopeType::LegalEntity, "ent-1")
        .expect_err("an inactive user is denied by the gate");
    assert!(matches!(err, crate::CoreError::PermissionDenied(_)));
    assert_eq!(
        covers_own_entity(),
        Some(true),
        "the diagnostic does not resolve users, so it cannot report the account's state"
    );
}

#[test]
fn coverage_diagnostic_writes_nothing_for_a_user_with_no_row() {
    // Ruling 5's None is only stable if reading it is a pure read. A
    // backfill-on-read would silently promote a legacy user from None
    // (no answer, so the resolver leaves scope out of the precedence
    // contest) to Some(true) (org-wide) just because something asked.
    let conn = migrations::fresh_db();
    seed_user(&conn); // deliberately no assignment row
    let store = Store::new(&conn);

    assert_eq!(
        store
            .assignment_covers_resource("u1", ScopeType::Location, "loc-any")
            .unwrap(),
        None
    );
    assert!(
        store.assignment_for_user("u1").unwrap().is_none(),
        "the diagnostic wrote an assignment row for a user that had none"
    );
}

/// The walk reads the location's legal_entity_id at query time. Pinning
/// the flip in both directions is what separates "resolved from the
/// table" from "remembered from somewhere else": a cached or
/// denormalized answer gets step 2 or step 3 wrong while every static
/// matrix still passes.
#[test]
fn coverage_diagnostic_resolves_the_entity_walk_from_the_live_locations_row() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "legal_entity", Some("ent-1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    let covers = |location_id: &str| {
        store
            .assignment_covers_resource("u1", ScopeType::Location, location_id)
            .unwrap()
    };
    let gate_allows = |location_id: &str| {
        store
            .require_permission_for_resource("u1", "sales:view", ScopeType::Location, location_id)
            .is_ok()
    };

    // 1. Start state: loc-ent1 belongs to ent-1.
    assert_eq!(covers("loc-ent1"), Some(true));
    assert!(gate_allows("loc-ent1"));

    // 2. Re-parent it to a sibling entity. The assignment row never
    //    changed, yet gate and diagnostic must both flip to a denial:
    //    coverage is a property of the location, not of the grant.
    conn.execute(
        "UPDATE locations SET legal_entity_id = 'ent-2' WHERE id = 'loc-ent1'",
        params![],
    )
    .unwrap();
    assert_eq!(
        covers("loc-ent1"),
        Some(false),
        "a location moved out of the entity is no longer covered"
    );
    assert!(!gate_allows("loc-ent1"), "the gate agrees");

    // 3. Adopt the orphan. The same row the static tests deny becomes
    //    covered the moment it gains this entity, with no write to
    //    assignments at all.
    assert_eq!(covers("loc-orphan"), Some(false));
    conn.execute(
        "UPDATE locations SET legal_entity_id = 'ent-1' WHERE id = 'loc-orphan'",
        params![],
    )
    .unwrap();
    assert_eq!(
        covers("loc-orphan"),
        Some(true),
        "the walk follows the current row, not the row as first read"
    );
    assert!(gate_allows("loc-orphan"), "the gate agrees");

    // 4. And back again: moving loc-ent1 home restores coverage, so
    //    nothing about the earlier denial was latched.
    conn.execute(
        "UPDATE locations SET legal_entity_id = 'ent-1' WHERE id = 'loc-ent1'",
        params![],
    )
    .unwrap();
    assert_eq!(covers("loc-ent1"), Some(true));
    assert!(gate_allows("loc-ent1"));
}

/// Rows the assignments pair triggers refuse to store, so the DB-backed
/// matrix above can never reach them — but resource_covered_by takes an
/// already-loaded Assignment, and those arms are the fail-closed ones.
/// Built by hand, which is also the only way to kill a dropped
/// entity.is_some() guard: with a NULL assignment id, comparing the two
/// Options alone reports an orphan location as covered.
#[test]
fn resource_covered_by_fails_closed_on_rows_the_schema_cannot_store() {
    let row = |scope_type: Option<ScopeType>, scope_id: Option<&str>| Assignment {
        user_id: "u1".into(),
        role_id: "role-staff".into(),
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type,
        scope_id: scope_id.map(str::to_string),
    };

    let conn = migrations::fresh_db();
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    // Positive control first: with a usable id the walk does cover, so
    // every false below is the guard working and not a broken arm.
    assert!(
        store
            .resource_covered_by(
                &row(Some(ScopeType::LegalEntity), Some("ent-1")),
                ScopeType::Location,
                "loc-ent1"
            )
            .unwrap(),
        "control: the entity walk covers its own location"
    );

    // The mutation this exists to kill: drop entity.is_some() and the
    // NULL assignment id compares equal to the NULL entity of
    // loc-orphan, granting an entity-less manager every orphan location.
    assert!(
        !store
            .resource_covered_by(
                &row(Some(ScopeType::LegalEntity), None),
                ScopeType::Location,
                "loc-orphan"
            )
            .unwrap(),
        "a NULL assignment id must never match a NULL location entity"
    );
    // Same row against a location that does have an entity: no match.
    assert!(
        !store
            .resource_covered_by(
                &row(Some(ScopeType::LegalEntity), None),
                ScopeType::Location,
                "loc-ent1"
            )
            .unwrap()
    );
    // And it never reaches the entity level either.
    assert!(
        !store
            .resource_covered_by(
                &row(Some(ScopeType::LegalEntity), None),
                ScopeType::LegalEntity,
                "ent-1"
            )
            .unwrap()
    );

    // An unparsable or absent scope_type: the load path turns that into
    // no assignment at all, and the model rule denies on its own too.
    assert!(
        !store
            .resource_covered_by(&row(None, None), ScopeType::Location, "loc-ent1")
            .unwrap()
    );
    assert!(
        !store
            .resource_covered_by(&row(None, Some("ent-1")), ScopeType::Location, "loc-ent1")
            .unwrap()
    );

    // A location row with a NULL id matches nothing, not even the
    // location its id would otherwise have named.
    assert!(
        !store
            .resource_covered_by(
                &row(Some(ScopeType::Location), None),
                ScopeType::Location,
                "loc-ent1"
            )
            .unwrap()
    );

    // The location arm must not consult the locations table at all: on a
    // DB with no topology, an exact id match still covers. Broadening
    // the walk's guard to "any location resource" breaks this and
    // nothing else.
    let bare = migrations::fresh_db();
    let bare_store = Store::new(&bare);
    assert!(
        bare_store
            .resource_covered_by(
                &row(Some(ScopeType::Location), Some("loc-ghost")),
                ScopeType::Location,
                "loc-ghost"
            )
            .unwrap(),
        "a location assignment's own id needs no locations row"
    );
    assert!(
        !bare_store
            .resource_covered_by(
                &row(Some(ScopeType::LegalEntity), Some("ent-ghost")),
                ScopeType::Location,
                "loc-ghost"
            )
            .unwrap(),
        "with no locations row the walk fails closed"
    );
}

// ── The session composite: Store::assignment_covers_session ──────────
//
// e4c8ab56 collapsed the desktop and tablet verdict commands onto this
// helper. Its only coverage is indirect, and that coverage is thinner
// than it looks: every client test seeds an assignment with no
// scope_type/scope_id pair, so the column default makes the row
// `organization`, whose resource axis is unconditionally true. The
// client tests therefore exercise the spec-0048 axis only and never the
// ADR #47 axis they were written to share. Both gaps below are on that
// untested half.

/// The composite is an AND, and the resource half of it still owes the
/// legal_entity downward walk. A scoped row whose resource axis is a
/// legal entity reaches neither half in any existing test: the 0048
/// tests use an org-wide row, and the coverage tests use global mode.
#[test]
fn assignment_covers_session_requires_both_axes_and_walks_for_the_resource_one() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    seed_entity_topology(&conn);
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
                scope_type: ScopeType::LegalEntity,
                scope_id: Some("ent-1".into()),
            },
        )
        .unwrap();

    let session = |resource_type: ScopeType, resource_id: &str, branch: &str, workspace: &str| {
        store
            .assignment_covers_session("u1", resource_type, resource_id, branch, workspace)
            .unwrap()
    };

    // Both axes pass: the 0048 dimension names this branch/workspace, and
    // the resource is a location the assignment's entity owns. The second
    // half is the walk, so this is the composite's only true row.
    assert_eq!(
        session(ScopeType::Location, "loc-ent1", "store-a", "retail-pos"),
        Some(true),
        "0048 axis and the ADR #47 walk both clear"
    );
    // The entity itself, matched directly rather than walked down to.
    assert_eq!(
        session(ScopeType::LegalEntity, "ent-1", "store-a", "retail-pos"),
        Some(true)
    );

    // 0048 axis denies while the resource is covered: the branch the
    // session stands in is not in the list.
    assert_eq!(
        session(ScopeType::Location, "loc-ent1", "store-b", "retail-pos"),
        Some(false),
        "a covered resource cannot rescue an out-of-scope branch"
    );
    // Same for the workspace dimension alone.
    assert_eq!(
        session(ScopeType::Location, "loc-ent1", "store-a", "warehouse"),
        Some(false),
        "a covered resource cannot rescue an out-of-scope workspace"
    );

    // 0048 axis passes while the resource axis denies: a sibling entity's
    // location, reached from a branch the assignment does name.
    assert_eq!(
        session(ScopeType::Location, "loc-ent2", "store-a", "retail-pos"),
        Some(false),
        "standing in an allowed branch does not cover a sibling location"
    );
    // And a NULL-entity location: the walk cannot prove ownership.
    assert_eq!(
        session(ScopeType::Location, "loc-orphan", "store-a", "retail-pos"),
        Some(false)
    );

    // Ruling 5 through the composite: no row is no answer, not a denial.
    assert_eq!(
        Store::new(&migrations::fresh_db())
            .assignment_covers_session(
                "u-ghost",
                ScopeType::Location,
                "loc-ent1",
                "store-a",
                "retail-pos",
            )
            .unwrap(),
        None
    );
}

/// Every caller today passes the session location twice: the current
/// location is both the 0048 branch and the ADR #47 resource. That
/// coincidence is a trap. If the composite ever answers the resource
/// question about `branch` instead of `resource_id`, no existing caller
/// can notice, and the first one to ask about a different resource gets
/// a verdict computed from the wrong id. These two calls are the only
/// place the two parameters differ, and they disagree in opposite
/// directions, so a swap fails whichever way it is made.
#[test]
fn assignment_covers_session_asks_about_the_resource_not_the_branch() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    insert_scoped_assignment(&conn, "legal_entity", Some("ent-1"));
    seed_entity_topology(&conn);
    let store = Store::new(&conn);

    // Global mode, so the 0048 axis is out of the way and the answer is
    // purely the resource axis. `store-a` is not a location at all.
    assert_eq!(
        store
            .assignment_covers_session(
                "u1",
                ScopeType::Location,
                "loc-ent1",
                "store-a",
                "retail-pos",
            )
            .unwrap(),
        Some(true),
        "the covered resource must win over an unrelated branch id"
    );
    // The mirror case: an uncovered resource named alongside a branch id
    // that would have been covered. A swap reports true here.
    assert_eq!(
        store
            .assignment_covers_session(
                "u1",
                ScopeType::Location,
                "loc-ent2",
                "loc-ent1",
                "retail-pos",
            )
            .unwrap(),
        Some(false),
        "the branch id is not the resource being asked about"
    );
}

// ── C18 P3: the replacement write is one unit of work ─────────────

/// DISCRIMINATING. `write_assignment_scope` replaces both dimension sets
/// (DELETE-then-INSERT) after upserting the assignment row. A mid-sequence
/// failure must leave NOTHING behind, not a half-replaced scope.
///
/// The failure is reachable and does not need a mock: the second dimension's
/// INSERT carries a real FK (`assignment_workspaces.workspace_key REFERENCES
/// workspaces(key)`), so an unknown workspace key aborts the sequence AFTER the
/// assignment row was upserted and AFTER the branch rows were deleted. Pre-fix
/// (autocommit, no transaction) the caller observed an error and the database
/// still held the new assignment row with its branch rows already destroyed —
/// a silently narrowed scope. This test fails against that code and passes now.
#[test]
fn write_assignment_scope_leaves_nothing_behind_when_a_later_step_fails() {
    let conn = migrations::fresh_db();
    seed_user(&conn);
    let store = Store::new(&conn);

    // A first, good scope: one branch, one real workspace.
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
    assert_eq!(
        store.assignment_for_user("u1").unwrap().unwrap().branches,
        vec!["store-a".to_string()]
    );

    // A second scope that fails on the workspace INSERT: the key does not exist.
    let err = store.write_assignment_scope(
        "u1",
        "role-staff",
        &AssignmentSpec {
            scope_mode: ScopeMode::Scoped,
            branches_all: false,
            branches: vec!["store-b".into()],
            workspaces_all: false,
            workspaces: vec!["no-such-workspace".into()],
            scope_type: ScopeType::Organization,
            scope_id: None,
        },
    );
    assert!(
        err.is_err(),
        "the unknown workspace key must abort the write"
    );

    // The FIRST scope must still be intact — not the new branches with no
    // workspaces, and not a deleted branch set.
    let after = store.assignment_for_user("u1").unwrap().unwrap();
    assert_eq!(
        after.branches,
        vec!["store-a".to_string()],
        "a failed replacement must not have destroyed the previous branch set"
    );
    assert_eq!(
        after.workspaces,
        vec!["retail-pos".to_string()],
        "a failed replacement must not have cleared the previous workspaces"
    );
}
