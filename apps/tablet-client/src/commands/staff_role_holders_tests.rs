//! Role-holder reads on the tablet IPC surface.
//!
//! Mirrors the desktop module name for name, assertion for assertion. That is
//! deliberate: the audit slice needed a per-client divergence test because the
//! tablet passes `debug_upgrade: false` to its event sink, and a tier gate can
//! therefore answer differently on the two shells. There is no such knob on a
//! holder READ — no entitlement, no upgrade flag, one shared core predicate —
//! so an identical suite is the correct outcome here, and a divergence would be
//! a bug in one client rather than a documented difference.
//!
//! A separate module from `staff_tests.rs` on purpose: that file is another
//! stream's in-flight work, exactly as in the audit slice. Both are wired from
//! `staff.rs`.
//!
//! What is proven here is the WIRING, not the query. Which accounts resolve to
//! a role — the assignment-first precedence, the orphan cascade, the scope
//! columns — is pinned in `oz-core`. These tests assert the three things only
//! the command layer can get wrong: that the gate is the one the doc claims,
//! that the org-wide ruling survives the trip through the session, and that
//! the cap and the uncapped total arrive as separate numbers rather than being
//! collapsed into one clipped list.

use super::*;

use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// An authored role the surface can be asked about.
const VIEWER: &str = "role-report-viewer";
/// A role with no grants at all, for the caller who must be refused.
const NO_GRANTS: &str = "role-no-grants";

fn base_conn() -> rusqlite::Connection {
    let conn = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        store
            .create_role(VIEWER, "Report Viewer", "", r#"["reports:view"]"#)
            .unwrap();
        store.create_role(NO_GRANTS, "Nobody", "", "[]").unwrap();
    }
    // fresh_db seeds Free, whose staff quota colours any list built from more
    // than one account; raise it so these tests read the command, not the
    // entitlement.
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = 'premium' WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    conn
}

/// A user holding `role`, with the assignment row `create_user` would have
/// written, so the resolver takes its normal arm.
fn add_user(conn: &rusqlite::Connection, id: &str, role: &str) {
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active,
                            created_at, updated_at)
         VALUES (?1, ?1, 'hash', 'Holder', ?2, 1,
                 '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![id, role],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES (?1, ?2, 'global', 'all', 'all')",
        rusqlite::params![id, role],
    )
    .unwrap();
}

/// An app whose `tok` session belongs to `caller` (holding `caller_role`)
/// and is standing in `store_id`; every name in `holders` holds [`VIEWER`].
fn app_for(
    caller: &str,
    caller_role: &str,
    store_id: &str,
    holders: &[&str],
) -> tauri::App<tauri::test::MockRuntime> {
    let conn = base_conn();
    add_user(&conn, caller, caller_role);
    for id in holders {
        add_user(&conn, id, VIEWER);
    }
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "tok".into(),
        oz_core::session::SessionContext::new(
            caller.into(),
            caller_role.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

fn owner_app(store_id: &str, holders: &[&str]) -> tauri::App<tauri::test::MockRuntime> {
    app_for("user-owner", "role-owner", store_id, holders)
}

#[tokio::test]
async fn lists_the_accounts_that_hold_a_role() {
    let app = owner_app("default", &["user-a", "user-b"]);
    let dto = list_role_holders_scoped(VIEWER.into(), "tok".into(), app.state())
        .await
        .unwrap();

    assert_eq!(dto.total, 2);
    assert_eq!(dto.holders.len(), 2);
    let ids: Vec<&str> = dto.holders.iter().map(|h| h.user_id.as_str()).collect();
    assert!(
        ids.contains(&"user-a") && ids.contains(&"user-b"),
        "{ids:?}"
    );
    // The caller is an Owner, so it must not appear in a list about VIEWER.
    assert!(!ids.contains(&"user-owner"));

    // Scope columns arrive as data, not flattened into a display string, so
    // the surface can compose them with its own localisation.
    assert!(dto.holders.iter().all(|h| h.has_assignment));
    assert!(
        dto.holders
            .iter()
            .all(|h| h.scope_mode.as_deref() == Some("global"))
    );
    assert!(
        dto.holders
            .iter()
            .all(|h| h.scope_type.as_deref() == Some("organization"))
    );
    assert!(dto.holders.iter().all(|h| h.scope_id.is_none()));
    // A default assignment is global with branch_scope "all", so the count
    // being zero means unrestricted. The surface needs both fields to say so
    // without lying — see a_zero_list_count_does_not_mean_an_unscoped_holder.
    assert!(dto.holders.iter().all(|h| h.branch_count == Some(0)));
    assert!(
        dto.holders
            .iter()
            .all(|h| h.branch_scope.as_deref() == Some("all"))
    );
    assert!(
        dto.holders
            .iter()
            .all(|h| h.workspace_scope.as_deref() == Some("all"))
    );
}

#[tokio::test]
async fn holders_are_org_wide_even_for_a_store_bound_session() {
    // The ruling this slice implements: users, assignments and roles are
    // tenant-global (ADR #4 / #7), so a session standing in one location still
    // sees every holder in the organization. Inventing a per-store filter here
    // would under-report silently, and an admin reading a short list before a
    // revoke is exactly the failure this surface exists to prevent.
    let app = owner_app("loc-elsewhere", &["user-a", "user-b"]);
    let dto = list_role_holders_scoped(VIEWER.into(), "tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(
        dto.total, 2,
        "the caller's store must not clip an org-wide list"
    );
}

#[tokio::test]
async fn the_cap_and_the_uncapped_total_both_cross_the_wire() {
    // The whole point of the pair: a clipped list with no total is a lie, and a
    // total with no reported ceiling leaves the UI to hardcode one.
    let many: Vec<String> = (0..60).map(|i| format!("user-{i:02}")).collect();
    let refs: Vec<&str> = many.iter().map(|s| s.as_str()).collect();
    let app = owner_app("default", &refs);

    let dto = list_role_holders_scoped(VIEWER.into(), "tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(dto.holders.len(), 50, "capped");
    assert_eq!(dto.total, 60, "the uncapped count survives");
    assert_eq!(dto.cap, 50, "the ceiling is reported, not assumed");
    assert_eq!(
        dto.total - dto.holders.len() as i64,
        10,
        "this difference is the and-N-more figure the screen renders"
    );
}

#[tokio::test]
async fn a_caller_without_staff_read_is_refused() {
    // staff:read is the gate by design (list_staff_scoped already discloses
    // these accounts and their roles) — but read is still a gate, and a
    // grant-less role must not be able to enumerate the organization.
    let app = app_for("user-plain", NO_GRANTS, "default", &["user-a"]);
    let err = list_role_holders_scoped(VIEWER.into(), "tok".into(), app.state())
        .await
        .expect_err("a holder list is not public to the organization");
    assert!(
        format!("{err:?}").to_lowercase().contains("permission"),
        "expected a permission refusal, got {err:?}"
    );
}

#[tokio::test]
async fn an_unknown_session_token_is_refused_before_any_read() {
    let app = owner_app("default", &["user-a"]);
    let err = list_role_holders_scoped(VIEWER.into(), "not-a-token".into(), app.state())
        .await
        .expect_err("a stale token must not read");
    assert!(
        format!("{err:?}").to_lowercase().contains("session"),
        "{err:?}"
    );
}

#[tokio::test]
async fn a_missing_role_is_an_error_rather_than_an_empty_list() {
    // "Nobody holds this" and "there is no such role" must not look the same on
    // the wire: the first is the sentence that licenses a delete.
    let app = owner_app("default", &[]);
    let err = list_role_holders_scoped("role-typo".into(), "tok".into(), app.state())
        .await
        .expect_err("a typoed role must not read as unheld");
    assert!(
        format!("{err:?}").to_lowercase().contains("not found"),
        "expected a not-found refusal, got {err:?}"
    );
}
// ── the DTO split: accounts and grants are different facts ─────────────

fn dto_for(conn: &rusqlite::Connection, id: &str) -> RoleDto {
    let s = Store::new(conn);
    let role = s.get_role(id).unwrap().expect("fixture role exists");
    role_dto(&s, role).unwrap()
}

#[test]
fn role_dto_counts_one_account_once_even_though_it_has_two_rows() {
    // The everyday case the summed label got wrong. create_user writes a
    // users row AND an assignments row for the same person, so
    // reference_count is 2 for one holder. Worded as accounts it reported
    // double for every normally-created account — three holders rendered as
    // six — and no arithmetic over rows fixes that.
    let conn = base_conn();
    add_user(&conn, "user-one", VIEWER);

    let dto = dto_for(&conn, VIEWER);
    assert_eq!(dto.holder_count, 1, "one person");
    assert_eq!(dto.reference_count, 2, "two FK rows for that person");
    assert_eq!(dto.grant_count, 0);
}

#[test]
fn role_dto_keeps_a_workspace_grant_out_of_the_holder_count() {
    // Mirrors the state core constructs in
    // delete_role_refuses_a_role_named_only_by_a_workspace_type: a role
    // nobody holds and something still grants. Pre-split the surface rendered
    // reference_count there and asserted one account about a role with zero
    // accounts, one line above "No accounts hold this role."
    let conn = base_conn();
    conn.execute_batch(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail-pos', 'Retail POS');
         INSERT OR IGNORE INTO workspaces (id, key, name) VALUES ('ws-retail', 'retail-pos', 'Retail');",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO role_workspace_types (role_id, type_key) VALUES (?1, 'retail-pos')",
        [VIEWER],
    )
    .unwrap();

    let dto = dto_for(&conn, VIEWER);
    assert_eq!(dto.holder_count, 0, "nobody holds it");
    assert_eq!(dto.grant_count, 1, "a workspace grant does");
    assert!(
        dto.reference_count > 0,
        "and it must still block deletion — FK truth is unchanged"
    );
}

#[test]
fn a_divergent_account_is_a_referrer_without_being_a_holder() {
    // Why reference_count is kept rather than computed as holder_count plus
    // grant_count. This account's users row points at VIEWER while its
    // assignment resolves it elsewhere: authorization sends it to the other
    // role, so listing it as a VIEWER holder would credit access it does not
    // have — yet the FK row is real, so VIEWER must stay undeletable.
    let conn = base_conn();
    add_user(&conn, "user-drift", VIEWER);
    conn.execute(
        "UPDATE assignments SET role_id = ?2 WHERE user_id = ?1",
        rusqlite::params!["user-drift", "role-owner"],
    )
    .unwrap();

    let dto = dto_for(&conn, VIEWER);
    assert_eq!(dto.holder_count, 0, "resolves elsewhere, so not a holder");
    assert_eq!(
        dto.reference_count, 1,
        "the users row is still a real reference: delete must stay blocked"
    );
}
