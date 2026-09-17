//! Security-event wiring on the tablet's staff-management paths.
//!
//! A separate module from `staff_tests.rs` on purpose: that file is another
//! stream's in-flight work, and the audit baseline's tests belong to the audit
//! slice. Both are wired from `staff.rs`.
//!
//! Mirrors the desktop suite, plus the one test the desktop cannot carry: the
//! tablet passes `debug_upgrade: false` to its security-event sink, so a Free
//! tenant records NOTHING here even in a debug build. That is the per-client
//! invariant from dfbc41b2, pinned from the write side.

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
fn seeded_conn(tier_key: &str) -> rusqlite::Connection {
    let conn = kasirmu_core::migrations::fresh_db();
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
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    state.session_store.write().unwrap().insert(
        "owner-token".into(),
        kasirmu_core::session::SessionContext::new(
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

fn update_args(pin: Option<String>) -> UpdateStaffScopedArgs {
    UpdateStaffScopedArgs {
        id: "user-owner".into(),
        username: "owner".into(),
        display_name: "Owner".into(),
        role_id: "role-owner".into(),
        is_active: true,
        pin,
        profile: None,
        assignment: None,
    }
}

#[tokio::test]
async fn create_staff_scoped_records_a_security_event() {
    let app = owner_app("premium");
    create_staff_scoped(
        "owner-token".into(),
        CreateStaffScopedArgs {
            username: "jdoe".into(),
            pin: "1234".into(),
            display_name: "New Hire".into(),
            role_id: "role-staff".into(),
            profile: profile(),
            assignment: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "one create event, got {rows:?}");
    let (user_id, action, outcome, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner", "user_id is the ACTOR");
    assert_eq!(action, "user.create", "already in auditCatalog.ts");
    assert_eq!(outcome, "success");
    assert_ne!(target_id, "user-owner", "target_id is the SUBJECT");
    assert!(details.contains("account_created"), "classifier: {details}");
    assert!(
        !details.contains("1234"),
        "the PIN must never reach the table"
    );
}

#[tokio::test]
async fn update_staff_scoped_records_one_event_without_a_pin_change() {
    let app = owner_app("premium");
    update_staff_scoped("owner-token".into(), update_args(None), app.state())
        .await
        .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "got {rows:?}");
    assert_eq!(rows[0].1, "user.update");
    assert!(rows[0].4.contains("profile_changed"), "got {}", rows[0].4);
}

#[tokio::test]
async fn update_staff_scoped_records_two_events_when_the_pin_rotates() {
    let app = owner_app("premium");
    update_staff_scoped(
        "owner-token".into(),
        update_args(Some("9876".into())),
        app.state(),
    )
    .await
    .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 2, "profile + rotation, got {rows:?}");
    assert!(rows.iter().all(|(_, a, _, _, _)| a == "user.update"));
    assert!(rows.iter().any(|(_, _, _, _, d)| d.contains("pin_rotated")));
    assert!(
        rows.iter()
            .any(|(_, _, _, _, d)| d.contains("profile_changed"))
    );
}

#[tokio::test]
async fn confirmed_free_records_nothing_even_in_a_debug_build() {
    // THE cross-client divergence, pinned from the write side. The desktop
    // promotes its own active Free row in debug builds and so cannot carry
    // this assertion; the tablet never promotes, so a Free tenant writes no
    // security events in any build profile. An UPDATE is used rather than a
    // CREATE because Free caps staff at one account — the quota check would
    // reject a create before the recorder was ever reached.
    let app = owner_app("free");
    update_staff_scoped("owner-token".into(), update_args(None), app.state())
        .await
        .unwrap();
    assert!(
        audit_rows(&app).await.is_empty(),
        "the tablet must not mirror the desktop's dev promotion"
    );
}

#[tokio::test]
async fn a_rejected_create_records_no_security_event() {
    let app = owner_app("premium");
    let args = || CreateStaffScopedArgs {
        username: "jdoe".into(),
        pin: "1234".into(),
        display_name: "New Hire".into(),
        role_id: "role-staff".into(),
        profile: profile(),
        assignment: None,
    };
    create_staff_scoped("owner-token".into(), args(), app.state())
        .await
        .unwrap();
    let before = audit_rows(&app).await.len();

    let dup = create_staff_scoped("owner-token".into(), args(), app.state()).await;
    assert!(dup.is_err(), "duplicate username must be refused");
    assert_eq!(
        audit_rows(&app).await.len(),
        before,
        "a refused create must not add an event"
    );
}
