//! Scoped-write permission coverage for `tables` (T8).
//!
//! This module had **no test file at all** before this pass: the six scoped
//! table writes were unreachable on a real tablet (each demanded a
//! `user_id: String` that `ui/src/api/tables.ts` never sends, so Tauri rejected
//! the call at `tauri-2.11.3/src/ipc/command.rs:100` before any body ran) and
//! nothing in the repository noticed. Not from the Rust side — no test resolves
//! command arguments (the `mock_ipc` / `handle_invoke` idioms match no file in
//! either shell) — and not from the JS side either, where the suite that *does*
//! pin this payload, `ui/src/__tests__/api-tables-contract.test.ts:47`, asserts
//! `{ sessionToken, table }` and stayed green the whole time the signature these
//! cases exercise refused it. A contract test written in the caller's language
//! cannot see the callee's requirements; that asymmetry is T9 in the plan file.
//!
//! The permission split asserted here is not "staff may not touch tables".
//! `platform/core/src/rbac_presets.rs:152-155` grants the built-in Staff role
//! `tables:assign`, `tables:merge`, `tables:split` and `tables:close`, and withholds
//! `tables:create`, `tables:edit` and `tables:delete`. So a cashier putting a table
//! into cleaning is authorized behavior that this file pins as *allowed*, while the
//! same cashier defining the floor plan is refused. Writing the denial case for all
//! six — which is what a first draft of this file did — failed on exactly the three
//! that are supposed to pass, and that failure is the more useful result: it
//! documented the mapping instead of guessing it.
//!
//! The harness is a second copy of the shape in `terminals_tests.rs`; if a third
//! module wants it, that is the moment for a shared `#[cfg(test)]` helper rather
//! than another copy.

use oz_core::Table;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

use super::*;

/// Seed the GLOBAL identity DB: default roles, an owner, and a cashier on
/// `role-staff`.
fn seed_identity(conn: &rusqlite::Connection) {
    Store::new(conn).seed_default_roles().unwrap();
    for (id, role) in [("user-owner", "role-owner"), ("user-cashier", "role-staff")] {
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active,
                                created_at, updated_at)
             VALUES (?1, ?1, 'hash', ?1, ?2, 1, '2026-07-31T00:00:00.000Z',
                     '2026-07-31T00:00:00.000Z')",
            rusqlite::params![id, role],
        )
        .unwrap();
    }
}

/// A Tauri test app carrying the given (token, user id) sessions, all bound to
/// store `store-tables`. The tempdir travels with the app: it holds the per-store
/// database the `StoreDatabaseManager` opens on demand.
fn tables_app(
    sessions: &[(&str, &str)],
) -> (tauri::App<tauri::test::MockRuntime>, tempfile::TempDir) {
    let conn = oz_core::migrations::fresh_db();
    seed_identity(&conn);
    let temp = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp.path().to_path_buf(), oz_core::migrations::ALL);
    for (token, user_id) in sessions {
        let role = if *user_id == "user-owner" {
            "role-owner"
        } else {
            "role-staff"
        };
        state.session_store.write().unwrap().insert(
            (*token).into(),
            SessionContext::new(
                (*user_id).into(),
                role.into(),
                "terminal-1".into(),
                "store-tables".into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();
    (app, temp)
}

fn table(id: &str) -> Table {
    Table {
        id: id.into(),
        name: format!("Table {id}"),
        capacity: 4,
        pos_x: 10.0,
        pos_y: 20.0,
        shape: "circle".into(),
        width: 10.0,
        height: 10.0,
        status: "available".into(),
        active_sale_id: None,
        section: "Main".into(),
        active: true,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

/// The three floor-plan writes: `tables:create`, `tables:edit` and
/// `tables:delete` are withheld from Staff, so the gate must refuse this session.
/// Before this pass the refusal depended on whichever `user_id` the caller named;
/// now the session decides.
#[tokio::test]
async fn scoped_table_definition_writes_deny_a_cashier() {
    let (app, _temp) = tables_app(&[("cashier-token", "user-cashier")]);

    assert!(
        matches!(
            create_table_scoped("cashier-token".into(), table("t1"), app.state()).await,
            Err(AppError::PermissionDenied(_))
        ),
        "tables:create is not a Staff grant"
    );
    assert!(
        matches!(
            update_table_scoped("cashier-token".into(), table("t1"), app.state()).await,
            Err(AppError::PermissionDenied(_))
        ),
        "tables:edit is not a Staff grant"
    );
    assert!(
        matches!(
            delete_table_scoped("cashier-token".into(), "t1".into(), app.state()).await,
            Err(AppError::PermissionDenied(_))
        ),
        "tables:delete is not a Staff grant"
    );
}

/// The three service writes ARE Staff grants (`tables:assign`, `tables:close`
/// twice), so a cashier must get to the body. Asserted as "not a permission
/// refusal" because the store under test holds no such tables — NotFound is a
/// body working correctly. This case is what stops a future tightening from
/// passing the suite by refusing everyone.
#[tokio::test]
async fn scoped_table_service_writes_reach_the_body_for_a_cashier() {
    let (app, _temp) = tables_app(&[("cashier-token", "user-cashier")]);

    assert!(!matches!(
        assign_table_order_scoped(
            "cashier-token".into(),
            "t-missing".into(),
            "sale-1".into(),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        update_table_status_scoped(
            "cashier-token".into(),
            "t-missing".into(),
            "cleaning".into(),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        release_table_scoped("cashier-token".into(), "t-missing".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
}

/// The functional half, which is what the missing `user_id` actually cost: this
/// sequence is the payload shape `ui/src/api/tables.ts` sends, and before this
/// pass none of it could be attempted on a tablet.
///
/// `cleaning` rather than `occupied` because the store refuses that transition
/// without an active sale (`crates/oz-core/src/db/tables.rs:256-263`: "occupied
/// requires an active sale — use assign_table_order"). The first draft of this
/// test learned that the hard way, which is worth recording: a scoped write that
/// now reaches its body can still be refused by the body, and only a functional
/// test tells those two failures apart.
#[tokio::test]
async fn scoped_table_write_path_actually_writes_for_an_owner() {
    let (app, _temp) = tables_app(&[("owner-token", "user-owner")]);

    let created = create_table_scoped("owner-token".into(), table("t-live"), app.state())
        .await
        .expect("create_table_scoped must succeed for an owner");
    assert_eq!(created.name, "Table t-live");

    let mut renamed = created.clone();
    renamed.name = "Window Two".into();
    let updated = update_table_scoped("owner-token".into(), renamed, app.state())
        .await
        .expect("update_table_scoped must succeed for an owner");
    assert_eq!(updated.name, "Window Two");

    let flipped = update_table_status_scoped(
        "owner-token".into(),
        "t-live".into(),
        "cleaning".into(),
        app.state(),
    )
    .await
    .expect("update_table_status_scoped must succeed for an owner");
    assert_eq!(flipped.status, "cleaning");

    // Read it back through the scoped list command, so the assertion is about
    // what landed on disk rather than about what each command echoed.
    let listed = list_tables_scoped("owner-token".into(), None, app.state())
        .await
        .expect("the owner may list the store's tables");
    assert_eq!(listed.len(), 1, "one table was created");
    assert_eq!(listed[0].name, "Window Two");
    assert_eq!(listed[0].status, "cleaning");

    delete_table_scoped("owner-token".into(), "t-live".into(), app.state())
        .await
        .expect("delete_table_scoped must succeed for an owner");
    assert!(
        list_tables_scoped("owner-token".into(), None, app.state())
            .await
            .expect("list after delete")
            .is_empty(),
        "the delete must take effect in the store, not merely answer Ok"
    );
}
