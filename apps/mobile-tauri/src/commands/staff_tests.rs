use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::picker_ticket;

// ── StaffMemberDto ──────────────────────────────────────────────────

#[test]
fn staff_member_dto_debug() {
    let dto = StaffMemberDto {
        id: "u1".into(),
        username: "jdoe".into(),
        display_name: "John Doe".into(),
        avatar: None,
        phone: None,
        deleted_at: None,
        role_id: "r1".into(),
        role_name: "Manager".into(),
        is_active: true,
        national_id_masked: "*****6789".into(),
        is_profile_complete: true,
        assignment: assignment_dto(None),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("jdoe"));
    assert!(d.contains("John Doe"));
    assert!(d.contains("Manager"));
}

#[test]
fn staff_member_dto_serialize() {
    let dto = StaffMemberDto {
        id: "u2".into(),
        username: "asmith".into(),
        display_name: "Alice Smith".into(),
        avatar: None,
        phone: None,
        deleted_at: None,
        role_id: "r2".into(),
        role_name: "Cashier".into(),
        is_active: false,
        national_id_masked: "****".into(),
        is_profile_complete: false,
        assignment: assignment_dto(None),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["username"], "asmith");
    assert_eq!(json["role_name"], "Cashier");
    assert_eq!(json["is_active"], false);
}

// ── RoleDto ─────────────────────────────────────────────────────────

#[test]
fn role_dto_debug() {
    let dto = RoleDto {
        id: "r1".into(),
        name: "Admin".into(),
        description: "Full access".into(),
        permissions: vec![],
        deleted_at: None,
        // preset-guard fields (7948344e): a preset-owned builtin row with
        // no references — the common default shape.
        is_builtin: true,
        reference_count: 0,
        holder_count: 0,
        grant_count: 0,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Admin"));
    assert!(d.contains("Full access"));
}

#[test]
fn role_dto_serialize() {
    let dto = RoleDto {
        id: "r2".into(),
        name: "Viewer".into(),
        description: String::new(),
        permissions: vec![],
        deleted_at: None,
        is_builtin: false,
        reference_count: 0,
        holder_count: 0,
        grant_count: 0,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Viewer");
    assert_eq!(json["description"], "");
    // The two split counts are on the wire, not computed front-end: TS
    // declares them required, and a label that reads accounts has to get
    // them from the resolver predicate rather than derive them from rows.
    assert_eq!(json["holder_count"], 0);
    assert_eq!(json["grant_count"], 0);
}

// ── BootstrapOwnerArgs / BootstrapOwnerResult ────────────────────────

#[test]
fn bootstrap_owner_args_deserialize() {
    let json = r##"{"username":"owner","pin":"1234","display_name":"Store Owner"}"##;
    let args: BootstrapOwnerArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "owner");
    assert_eq!(args.pin, "1234");
    assert_eq!(args.display_name, "Store Owner");
}

#[test]
fn bootstrap_owner_args_debug() {
    let args = BootstrapOwnerArgs {
        username: "owner".into(),
        pin: "0000".into(),
        display_name: "Owner".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("owner"));
    assert!(d.contains("Owner"));
}

#[test]
fn bootstrap_owner_result_serialize() {
    let result = BootstrapOwnerResult {
        session: kasirmu_core::auth::LoginSession {
            user_id: "u1".into(),
            display_name: "Owner".into(),
            role_name: "Owner".into(),
            role_id: "role-owner".into(),
            permissions: vec!["*".into()],
        },
        picker_ticket: "ticket".into(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["session"]["role_id"], "role-owner");
    assert_eq!(json["picker_ticket"], "ticket");
}

#[test]
fn bootstrap_owner_result_debug() {
    let result = BootstrapOwnerResult {
        session: kasirmu_core::auth::LoginSession {
            user_id: "u2".into(),
            display_name: "Boss".into(),
            role_name: "Owner".into(),
            role_id: "role-owner".into(),
            permissions: vec![],
        },
        picker_ticket: String::new(),
    };
    let d = format!("{result:?}");
    assert!(d.contains("Boss"));
}

// ── run_bootstrap_owner logic ───────────────────────────────────────

use kasirmu_core::migrations;
use tauri::Manager as _;

#[test]
fn run_bootstrap_owner_creates_owner_role_user() {
    let conn = migrations::fresh_db();
    let result = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "owner".into(),
            pin: "1234".into(),
            display_name: "Store Owner".into(),
        },
    )
    .unwrap();

    assert_eq!(result.session.role_id, "role-owner");
    assert_eq!(result.session.role_name, "Owner");
    assert_eq!(result.session.display_name, "Store Owner");

    let store = Store::new(&conn);
    let user = store.get_user(&result.session.user_id).unwrap().unwrap();
    assert_eq!(user.role_id, kasirmu_core::builtin_roles::OWNER);
    assert!(user.is_active);
}

#[test]
fn run_bootstrap_owner_lowercases_username() {
    let conn = migrations::fresh_db();
    let result = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "  OWNER  ".into(),
            pin: "1234".into(),
            display_name: "  Store Owner  ".into(),
        },
    )
    .unwrap();
    // `create_user` assigns a UUID id; the USERNAME must be normalized.
    assert_eq!(result.session.display_name, "Store Owner");
    let user = Store::new(&conn)
        .get_user_by_username("owner")
        .unwrap()
        .unwrap();
    assert_eq!(user.id, result.session.user_id);
}

#[test]
fn run_bootstrap_owner_rejects_when_users_exist() {
    let conn = migrations::fresh_db();
    // Bootstrap once, then try again — the second call must fail closed.
    run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "owner".into(),
            pin: "1234".into(),
            display_name: "Owner".into(),
        },
    )
    .unwrap();
    let err = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "owner2".into(),
            pin: "1234".into(),
            display_name: "Owner 2".into(),
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    // No second user may exist.
    assert_eq!(Store::new(&conn).list_users().unwrap().len(), 1);
}

#[test]
fn run_bootstrap_owner_rejects_empty_username() {
    let conn = migrations::fresh_db();
    let err = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "  ".into(),
            pin: "1234".into(),
            display_name: "Owner".into(),
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[test]
fn run_bootstrap_owner_rejects_empty_display_name() {
    let conn = migrations::fresh_db();
    let err = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "owner".into(),
            pin: "1234".into(),
            display_name: "  ".into(),
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[test]
fn run_bootstrap_owner_rejects_short_pin() {
    let conn = migrations::fresh_db();
    let err = run_bootstrap_owner(
        &conn,
        &BootstrapOwnerArgs {
            username: "owner".into(),
            pin: "123".into(),
            display_name: "Owner".into(),
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[tokio::test]
async fn bootstrap_owner_mints_verifiable_picker_ticket() {
    // audit-open-findings (parity with the desktop client): the command-level
    // bootstrap must mint a ticket bound to the NEW owner so the
    // pre-session workspace picker works immediately after setup.
    let conn = migrations::fresh_db();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = bootstrap_owner(
        BootstrapOwnerArgs {
            username: "owner".into(),
            pin: "1234".into(),
            display_name: "Store Owner".into(),
        },
        app.state(),
    )
    .await
    .unwrap();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let state = app.state::<AppState>();
    assert_eq!(
        picker_ticket::verify_picker_ticket(
            &state.picker_ticket_secret,
            &result.picker_ticket,
            now
        )
        .as_deref(),
        Some(result.session.user_id.as_str()),
        "bootstrap must mint a ticket bound to the new owner"
    );
    assert!(!result.picker_ticket.is_empty());
    assert_eq!(result.session.role_id, "role-owner");
}

// ── STAFF-13 residual: command-level security tests for the TABLET's
// duplicated policy copy. The tablet enforces the same role-assignment
// policy as the desktop (staff.rs:545) but had ZERO command-level tests
// — only DTO/bootstrap coverage. These mirror the desktop's
// branch-pinned set (d45d1119): each guard fires in isolation with an
// exact-message assert where the branch is distinguishable.

use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

fn scoped_state_with_token(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        token.into(),
        SessionContext::new(
            user_id.into(),
            role_id.into(),
            "terminal-1".into(),
            store_id.into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    state
}

fn complete_profile_args() -> ProfileArgs {
    ProfileArgs {
        date_of_birth: Some("1990-05-14".into()),
        phone: Some("+14155550123".into()),
        national_id_type: Some("ssn".into()),
        national_id: Some("123456789".into()),
        email: Some("fixture@example.com".into()),
        monthly_take_home_minor: Some(5_000_000),
        emergency_contact_name: Some("Bob".into()),
        emergency_contact_phone: Some("+14155550987".into()),
        ..Default::default()
    }
}

fn build_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

#[tokio::test]
async fn scoped_create_staff_denies_cashier_session() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    ));

    let result = create_staff_scoped(
        "cashier-token".into(),
        CreateStaffScopedArgs {
            username: "mallory".into(),
            pin: "1234".into(),
            display_name: "Mallory".into(),
            role_id: "role-staff".into(),
            profile: complete_profile_args(),
            assignment: None,
        },
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_list_staff_requires_staff_read() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "cashier-token",
        "user-cashier",
        "role-lite",
        "store-a",
    ));
    let result = list_staff_scoped("cashier-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_update_staff_denies_manager_promoting_to_owner() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    ));

    let result = update_staff_scoped(
        "manager-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Cashier".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    assert!(
        matches!(result, Err(AppError::PermissionDenied(_))),
        "Manager must not promote a user to Owner"
    );
}

#[tokio::test]
async fn scoped_update_staff_denies_self_promotion() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-manager', 'manager', 'hash', 'Manager', 'role-manager', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "manager-token",
        "user-manager",
        "role-manager",
        "store-a",
    ));

    let result = update_staff_scoped(
        "manager-token".into(),
        UpdateStaffScopedArgs {
            id: "user-manager".into(),
            username: "manager".into(),
            display_name: "Manager".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_update_staff_protects_last_active_owner() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-a",
    ));

    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    assert!(
        matches!(result, Err(AppError::PermissionDenied(_))),
        "last active Owner must not be deactivated"
    );
}

#[tokio::test]
async fn scoped_update_staff_denies_self_deactivation_by_manager() {
    // Branch pin: caller is NOT an Owner — only the self-deactivation
    // rule can reject this, so the message must name it.
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-hr', 'HR', 'Staff updater', '[\"staff:update\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-hr', 'hr', 'hash', 'HR Admin', 'role-hr', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn, "hr-token", "user-hr", "role-hr", "store-a",
    ));

    let result = update_staff_scoped(
        "hr-token".into(),
        UpdateStaffScopedArgs {
            id: "user-hr".into(),
            username: "hr".into(),
            display_name: "HR Admin".into(),
            role_id: "role-hr".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    match result {
        Err(AppError::PermissionDenied(msg)) => {
            assert!(
                msg.contains("your own account"),
                "expected the self-deactivation message, got: {msg}"
            );
        }
        other => panic!(
            "expected self-deactivation denial, got ok={}",
            other.is_ok()
        ),
    }
}

#[tokio::test]
async fn scoped_update_staff_protects_last_owner_from_other_admin() {
    // Branch pin: caller holds staff:manage_roles (Owner-role gate
    // passes) and edits a DIFFERENT user — only the last-active-Owner
    // protection can reject this.
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-hrboss', 'HR Boss', 'Can manage staff incl. roles', '[\"staff:update\",\"staff:manage_roles\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-hrboss', 'hrboss', 'hash', 'HR Boss', 'role-hrboss', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "hrboss-token",
        "user-hrboss",
        "role-hrboss",
        "store-a",
    ));

    let result = update_staff_scoped(
        "hrboss-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: false,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    match result {
        Err(AppError::PermissionDenied(msg)) => {
            assert!(
                msg.contains("last active Owner"),
                "expected the last-owner message, got: {msg}"
            );
        }
        other => panic!(
            "expected last-owner protection denial, got ok={}",
            other.is_ok()
        ),
    }
}

// STAFF-05 atomicity pin for the recurring audit question "does the tablet's
// staff update hold a cross-database write together with only an in-memory
// snapshot/restore?": it does not. The user update and the assignment scope
// ride ONE transaction on the one AppState connection (update_staff_scoped),
// so a failure AFTER the scope write must roll BOTH writes back. This fires
// exactly that failure — the short-PIN branch validates after the scope
// write — and asserts on the rows themselves, not the DTO.
#[tokio::test]
async fn scoped_update_staff_rolls_back_user_and_assignment_on_late_failure() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
            ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         -- assignment_workspaces.workspace_key carries an FK to workspaces(key)
         -- in the SAME identity DB; seed the grant target so the scope write
         -- succeeds and the failure lands strictly after it.
         INSERT INTO workspaces (id, key, name) VALUES ('ws-b', 'ws-b', 'Workspace B');",
    )
    .unwrap();
    let app = build_app(scoped_state_with_token(
        conn,
        "owner-token",
        "user-owner",
        "role-owner",
        "store-a",
    ));

    // Role stays role-lite (require_role_assignable short-circuits on an
    // unchanged role), the display-name change is write 1, the assignment
    // upsert is write 2, and THEN the 3-char PIN fails validation — the
    // first failure point after write 2 inside the transaction.
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-cashier".into(),
            username: "cashier".into(),
            display_name: "Renamed Cashier".into(),
            role_id: "role-lite".into(),
            is_active: true,
            pin: Some("123".into()),
            profile: None,
            assignment: Some(AssignmentArgs {
                scope_mode: "scoped".into(),
                branches_all: false,
                branch_ids: vec![],
                workspaces_all: false,
                workspace_keys: vec!["ws-b".into()],
                scope_type: None,
                scope_id: None,
            }),
        },
        app.state(),
    )
    .await;
    match result {
        Err(AppError::Invalid(_)) => {}
        other => panic!("a 3-char PIN must fail validation after the scope write, got: {other:?}"),
    }

    // Both writes are gone: the user row kept its old display name and no
    // assignment row / workspace dimension row exists for the target.
    let state = app.state::<AppState>();
    let db = state.db.lock().await;
    let display_name: String = db
        .query_row(
            "SELECT display_name FROM users WHERE id = 'user-cashier'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(display_name, "Cashier", "user write must roll back");
    let assignments: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM assignments WHERE user_id = 'user-cashier'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        assignments, 0,
        "assignment scope write must roll back with the failed update"
    );
    let workspace_keys: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM assignment_workspaces WHERE assignment_user_id = 'user-cashier'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        workspace_keys, 0,
        "no workspace dimension row may survive the rollback"
    );
}
