//! Security-event wiring on the staff-management paths.
//!
//! A separate module from `staff_tests.rs` on purpose: that file is another
//! stream's in-flight work, and the audit baseline's tests belong to the audit
//! slice. Both are wired from `staff.rs`.
//!
//! These prove the WRITE side of the staff class end to end through the real
//! commands — that an account creation and a profile edit actually land audit
//! rows naming the ACTOR and the SUBJECT separately, and that a rejected
//! mutation leaves no phantom event. The recorder's own semantics (tier gate,
//! fail-open, payload shape) are covered in `oz-core`.

use super::*;

use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// A complete ADR #35 D6 profile — creation requires the mandatory fields.
fn profile() -> ProfileArgs {
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

/// Global DB with an owner, on a tier with staff-quota headroom.
///
/// `fresh_db` seeds Free, which caps staff users at 1 — the quota check
/// would reject the create before the command ever reached the recorder, so
/// every test here raises the tier first.
fn seeded_conn(tier_key: &str) -> rusqlite::Connection {
    let conn = oz_core::migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
    conn
}

/// An app whose `owner-token` session resolves to the owner.
fn owner_app(tier_key: &str) -> tauri::App<tauri::test::MockRuntime> {
    let conn = seeded_conn(tier_key);
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "owner-token".into(),
        oz_core::session::SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
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

/// Every audit row in the global DB.
async fn audit_rows(
    app: &tauri::App<tauri::test::MockRuntime>,
) -> Vec<(String, String, String, String, String)> {
    let state = app.state::<AppState>();
    let db = state.db.lock().await;
    let mut stmt = db
        .prepare(
            "SELECT user_id, action, outcome, COALESCE(target_id,''), COALESCE(details,'{}')
             FROM audit_log ORDER BY created_at ASC",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .map(|r| r.unwrap())
    .collect()
}

fn create_args(username: &str) -> CreateStaffScopedArgs {
    CreateStaffScopedArgs {
        username: username.into(),
        pin: "1234".into(),
        display_name: "New Hire".into(),
        role_id: "role-staff".into(),
        profile: profile(),
        assignment: None,
    }
}

#[tokio::test]
async fn create_staff_scoped_records_a_security_event() {
    // Creating an account is how an attacker with a stolen admin session
    // installs persistence — the trail must name who did it and who appeared.
    let app = owner_app("premium");
    create_staff_scoped("owner-token".into(), create_args("jdoe"), app.state())
        .await
        .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "one create event, got {rows:?}");
    let (user_id, action, outcome, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner", "user_id is the ACTOR");
    assert_eq!(action, "user.create", "already in auditCatalog.ts");
    assert_eq!(outcome, "success");
    assert_ne!(
        target_id, "user-owner",
        "target_id is the SUBJECT, not the actor"
    );
    let created = {
        let state = app.state::<AppState>();
        let db = state.db.lock().await;
        db.query_row::<String, _, _>("SELECT id FROM users WHERE username = 'jdoe'", [], |r| {
            r.get(0)
        })
        .unwrap()
    };
    assert_eq!(target_id, &created);
    assert!(details.contains("jdoe"), "subject username: {details}");
    assert!(details.contains("account_created"), "classifier: {details}");
    assert!(
        !details.contains("1234"),
        "the PIN must never reach the table"
    );
}

#[tokio::test]
async fn a_rejected_create_records_no_security_event() {
    // The recorder runs only after the account exists, so a create refused
    // by validation or a duplicate username leaves no phantom row.
    let app = owner_app("premium");
    create_staff_scoped("owner-token".into(), create_args("jdoe"), app.state())
        .await
        .unwrap();
    let before = audit_rows(&app).await.len();

    let dup = create_staff_scoped("owner-token".into(), create_args("jdoe"), app.state()).await;
    assert!(dup.is_err(), "duplicate username must be refused");
    assert_eq!(
        audit_rows(&app).await.len(),
        before,
        "a refused create must not add an event"
    );
}

#[tokio::test]
async fn update_staff_scoped_records_one_event_without_a_pin_change() {
    let app = owner_app("premium");
    let result = update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner Renamed".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: None,
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await;
    assert!(result.is_ok(), "{:?}", result.err());

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "one update event, got {rows:?}");
    let (user_id, action, _, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner", "actor");
    assert_eq!(action, "user.update");
    assert_eq!(
        target_id, "user-owner",
        "self-edit: actor and subject coincide"
    );
    assert!(details.contains("profile_changed"), "got {details}");
    assert!(
        !details.contains("pin_rotated"),
        "no PIN was supplied: {details}"
    );
}

#[tokio::test]
async fn update_staff_scoped_records_two_events_when_the_pin_rotates() {
    // A rotation is a distinct security fact: it dropped every other session
    // for the account (STAFF-03). Collapsing it into the profile event would
    // lose which of the two happened, so both are written.
    let app = owner_app("premium");
    update_staff_scoped(
        "owner-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
            role_id: "role-owner".into(),
            is_active: true,
            pin: Some("9876".into()),
            profile: None,
            assignment: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 2, "profile + rotation, got {rows:?}");
    assert!(rows.iter().all(|(_, a, _, _, _)| a == "user.update"));
    let reasons: Vec<&str> = rows
        .iter()
        .map(|(_, _, _, _, d)| {
            if d.contains("pin_rotated") {
                "pin_rotated"
            } else {
                "profile_changed"
            }
        })
        .collect();
    assert!(reasons.contains(&"profile_changed"), "got {reasons:?}");
    assert!(reasons.contains(&"pin_rotated"), "got {reasons:?}");
    // The rotation is separable WITHOUT inventing an uncatalogued action.
    assert_eq!(
        rows.iter()
            .filter(|(_, a, _, _, _)| a == "user.pin_change")
            .count(),
        0,
        "no uncatalogued action string may be emitted"
    );
}

#[tokio::test]
async fn a_denied_update_records_no_security_event() {
    // The permission check runs before any write, so a refused edit leaves the
    // trail untouched.
    let conn = seeded_conn("premium");
    conn.execute(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '["sales:view"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')"#,
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), oz_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "lite-token".into(),
        oz_core::session::SessionContext::new(
            "user-lite".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let denied = update_staff_scoped(
        "lite-token".into(),
        UpdateStaffScopedArgs {
            id: "user-owner".into(),
            username: "owner".into(),
            display_name: "Owner".into(),
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
        matches!(denied, Err(AppError::PermissionDenied(_))),
        "{denied:?}"
    );
    assert!(audit_rows(&app).await.is_empty());
}
