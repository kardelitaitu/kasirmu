use super::*;

#[test]
fn staff_login_args_deserialize() {
    let json = r#"{"username":"cashier1","pin":"1234"}"#;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "cashier1");
    assert_eq!(args.pin, "1234");
}

#[test]
fn staff_login_args_debug() {
    let args = StaffLoginArgs {
        username: "admin".into(),
        pin: "9999".into(),
        device_id: Some("term-1".into()),
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("admin"));
}

#[test]
fn staff_login_args_device_id_defaults_none() {
    // `device_id` is optional — legacy JSON without it must deserialize.
    let json = r#"{"username":"cashier1","pin":"1234"}"#;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.device_id, None);
}

#[test]
fn staff_login_result_serialize() {
    let result = StaffLoginResult {
        session: LoginSession {
            user_id: "u1".into(),
            display_name: "Alice".into(),
            role_name: "Manager".into(),
            role_id: "r1".into(),
            permissions: vec!["analytics:view".into()],
        },
        picker_ticket: String::new(),
    };
    let json = serde_json::to_value(&result).unwrap();
    let session = &json["session"];
    assert_eq!(session["user_id"], "u1");
    assert_eq!(session["display_name"], "Alice");
    assert_eq!(session["role_name"], "Manager");
}

#[test]
fn staff_login_result_debug() {
    let result = StaffLoginResult {
        session: LoginSession {
            user_id: "u1".into(),
            display_name: "Bob".into(),
            role_name: "Cashier".into(),
            role_id: "r2".into(),
            permissions: vec![],
        },
        picker_ticket: String::new(),
    };
    let debug = format!("{:?}", result);
    assert!(debug.contains("Bob"));
}

// ── Session-mint authorization gate (audit-open-findings residual) ───────────
//
// Parity with the desktop client: `create_session` must fail closed
// when the caller claims an identity it has not authenticated. The
// gate itself is `oz_core::Store::verify_instance_access` (shared with
// the desktop client); these tests pin the command-level behavior on
// the tablet too.

use oz_core::migrations;
use tauri::Manager as _;

/// Seed the built-in roles plus one owner user in the GLOBAL identity DB.
fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

#[tokio::test]
async fn staff_login_mints_verifiable_picker_ticket() {
    // audit-open-findings (parity with the desktop client): the picker ticket
    // returned by a successful login must verify against the process
    // secret and bind the authenticated user.
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
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
        Some("user-owner"),
        "login must mint a ticket bound to the authenticated user"
    );
}

#[tokio::test]
async fn staff_login_returns_granted_permission_keys() {
    // Parity with the desktop client: the session carries the role's
    // granted keys verbatim (Owner's preset grants the global `"*"`
    // wildcard) so UI gates can mirror the backend registry.
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(
        result.session.permissions,
        vec!["*".to_string()],
        "owner login must carry the role's granted keys (global wildcard)"
    );
}

#[tokio::test]
async fn create_session_rejects_forged_role_id() {
    // A staff user whose REAL role is role-staff claims role-owner.
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = create_session(
        CreateSessionArgs {
            user_id: "user-cashier".into(),
            role_id: "role-owner".into(), // forged
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await;
    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "forged role must not mint a session"
    );
    let state = app.state::<AppState>();
    assert_eq!(
        state.session_store.read().unwrap().len(),
        0,
        "no session token may be created for a forged role"
    );
}

#[tokio::test]
async fn create_session_rejects_unknown_user() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = create_session(
        CreateSessionArgs {
            user_id: "ghost-user".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await;
    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "unknown user must not be able to open a session"
    );
    let state = app.state::<AppState>();
    assert_eq!(state.session_store.read().unwrap().len(), 0);
}

#[tokio::test]
async fn create_session_allows_real_owner() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(result.context.role_id, "role-owner");
    assert_eq!(result.context.user_id, "user-owner");
    let state = app.state::<AppState>();
    assert_eq!(state.session_store.read().unwrap().len(), 1);
}

#[tokio::test]
async fn create_session_denies_tier_disallowed_workspace_type() {
    // Parity with the desktop client: ADR #5 subscription tier gates which
    // workspace types a session may open. The default tenant is Free, which
    // allows only store-pos / restaurant-pos / admin — `kds` is NOT entitled.
    // Role access alone (verify_instance_access) must not be enough.
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-kds".into(),
            type_key: "kds".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await;

    let err = result.expect_err("Free tier must not open a kds session");
    match err {
        AppError::Invalid(msg) => {
            assert!(
                msg.contains("not entitled") || msg.contains("subscription"),
                "error must name the tier gate, got: {msg}"
            );
        }
        other => panic!("expected AppError::Invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn create_session_rejects_tampered_subscription_signature() {
    // Parity with the desktop client and create_staff_scoped: the
    // tenant_subscription row's RSA signature must be verified before its
    // tier/allowed-types are honored. A tampered row (forged pro tier with
    // kds allowed, invalid signature) must fail closed.
    let conn = migrations::fresh_db();
    conn.execute(
        "UPDATE tenant_subscription
         SET tier_key = 'pro',
             allowed_types_json = '[\"store-pos\",\"restaurant-pos\",\"admin\",\"kds\"]',
             signature = 'TAMPERED_SIGNATURE'
         WHERE tenant_id = 'default'",
        [],
    )
    .unwrap();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-kds".into(),
            type_key: "kds".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await;

    let err = result.expect_err("tampered subscription must not open a kds session");
    match err {
        AppError::Invalid(msg) => {
            assert!(
                msg.contains("signature")
                    || msg.contains("subscription")
                    || msg.contains("entitled"),
                "error must name the signature/tier gate, got: {msg}"
            );
        }
        AppError::Core { .. } => {}
        other => panic!("expected AppError::Invalid/Core, got {other:?}"),
    }
}
// ── Basic security events on the auth paths (todo-global-saas-2.md P1) ─
//
// Pins that staff_login and destroy_session actually WRITE audit rows. The
// core recorder has its own suite in oz-core; what matters here is the
// wiring and the tablet half of the per-client divergence: the tablet passes
// debug_upgrade: false, so unlike the desktop it records NOTHING on a Free
// row even in a debug build.

/// Move the seeded subscription onto another tier. The signature covers
/// `signed_payload` only, never `tier_key`, so this keeps the row loaded and
/// changes only the projected tier.
fn set_tier(conn: &rusqlite::Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

/// A global DB with built-in roles, one PIN-able owner, and an optional tier.
fn login_app(tier_key: Option<&str>) -> tauri::App<tauri::test::MockRuntime> {
    let conn = migrations::fresh_db();
    if let Some(tier) = tier_key {
        set_tier(&conn, tier);
    }
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
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

#[tokio::test]
async fn staff_login_records_a_success_event_for_a_paid_tier() {
    let app = login_app(Some("pro"));
    staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: Some("tablet-2".into()),
        },
        app.state(),
    )
    .await
    .unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "one login event, got {rows:?}");
    let (user_id, action, outcome, target_id, details) = &rows[0];
    assert_eq!(user_id, "user-owner");
    assert_eq!(action, "login", "the value auditCatalog.ts already labels");
    assert_eq!(outcome, "success");
    assert_eq!(target_id, "user-owner");
    assert!(
        details.contains("tablet-2"),
        "device id recorded: {details}"
    );
    assert!(
        !details.contains("1234"),
        "the PIN must never reach the table"
    );
}

#[tokio::test]
async fn staff_login_records_a_failure_event_with_its_classifier() {
    let app = login_app(Some("pro"));
    let err = staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "9999".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap_err();
    assert!(
        err.to_string().contains("invalid username or PIN"),
        "the client still gets the uniform message, got {err}"
    );

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1);
    let (_, action, outcome, _, details) = &rows[0];
    assert_eq!(action, "login.failed");
    assert_eq!(outcome, "failure");
    assert!(
        details.contains("wrong_pin"),
        "classifier recorded: {details}"
    );
}

#[tokio::test]
async fn free_tier_records_nothing_even_in_a_debug_build() {
    // The per-client divergence, pinned from the tablet side. The desktop
    // promotes its own active Free row in debug builds; the tablet must not
    // mirror it (dfbc41b2), so a Free tenant writes no security events here
    // in ANY build profile. If the tablet helper ever starts passing
    // debug_upgrade: true, this test goes red in dev where it is green today.
    let app = login_app(Some("free"));
    staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(
        audit_rows(&app).await.len(),
        0,
        "the tablet never promotes Free, so nothing is recorded"
    );
}

#[tokio::test]
async fn destroy_session_records_a_logout_for_a_paid_tier() {
    let app = login_app(Some("premium"));
    {
        let state = app.state::<AppState>();
        state.session_store.write().unwrap().insert(
            "tok-1".into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "tablet-1".into(),
                "default".into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }

    destroy_session(app.state(), "tok-1".into()).await.unwrap();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1, "one logout event, got {rows:?}");
    let (user_id, action, outcome, _, details) = &rows[0];
    assert_eq!(action, "logout");
    assert_eq!(outcome, "success", "a logout is not a failure");
    assert_eq!(user_id, "user-owner");
    assert!(details.contains("tablet-1"), "terminal recorded: {details}");
}

#[tokio::test]
async fn destroy_session_with_an_unknown_token_records_nothing() {
    // A replayed or already-evicted logout must not manufacture phantom
    // events — and it must still return Ok, exactly as it did before this
    // wiring.
    let app = login_app(Some("premium"));
    destroy_session(app.state(), "never-issued".into())
        .await
        .unwrap();
    assert!(audit_rows(&app).await.is_empty());
}

#[tokio::test]
async fn an_unreadable_subscription_row_still_records_on_the_tablet() {
    // Fail-open arm, reached from the client rather than the core suite: a
    // tenant that corrupts its own subscription row must not be able to turn
    // the security trail off. The tablet's debug_upgrade: false is irrelevant
    // here — the gate keys on `loaded`, not on the promotion.
    let app = login_app(Some("premium"));
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().await;
        db.execute(
            "UPDATE tenant_subscription SET signature = 'not-a-signature' WHERE tenant_id = 'default'",
            [],
        )
        .unwrap();
    }
    staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(audit_rows(&app).await.len(), 1, "the trail stays on");
}
// ── SaaS-3 L194: multi-Organization switching — isolation suite (tablet) ─
//
// Tablet mirror of the desktop L194 isolation suite. The tablet create_session
// trusts args.user_id directly (no picker ticket), but the fail-closed org gate
// and switch_organization are identical in authority: old token dead before new
// session (invalidate-then-mint), authority re-derived from the assignment, no
// credential carryover, enumerated-list-only, integrity re-check on switch.

use oz_core::db::assignments::{AssignmentSpec, ScopeMode};

/// Seed a legal entity owned by `tenant_id` with the given id and name.
fn seed_legal_entity(conn: &rusqlite::Connection, tenant_id: &str, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO legal_entities (id, tenant_id, name, legal_name, status)
         VALUES (?1, ?2, ?3, ?4, 'active')",
        rusqlite::params![id, tenant_id, name, name],
    )
    .unwrap();
}

/// Override a user's assignment: None -> Organization-wide; Some(org_id) ->
/// single LegalEntity scope covering only that org.
fn set_user_assignment(
    conn: &rusqlite::Connection,
    user_id: &str,
    role_id: &str,
    org_id: Option<&str>,
) {
    let store = Store::new(conn);
    let spec = AssignmentSpec {
        scope_mode: ScopeMode::Global,
        branches_all: true,
        branches: vec![],
        workspaces_all: true,
        workspaces: vec![],
        scope_type: match org_id {
            Some(_) => ScopeType::LegalEntity,
            None => ScopeType::Organization,
        },
        scope_id: org_id.map(|s| s.to_string()),
    };
    store.set_assignment(user_id, role_id, &spec).unwrap();
}

/// Build an app with an owner (role-owner) scoped by `org_scope`. Returns the
/// app and the real uuid user_id (tablet create_session consumes it directly).
fn l194_app_with(
    conn: rusqlite::Connection,
    org_scope: Option<&str>,
) -> (tauri::App<tauri::test::MockRuntime>, String) {
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    let user = store
        .create_user("alice", &hash, "Alice", "role-owner")
        .unwrap();
    let user_id = user.id.clone();
    set_user_assignment(&conn, &user_id, "role-owner", org_scope);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    (app, user_id)
}

#[tokio::test]
async fn l194_list_organizations_device_local_only() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, _uid) = l194_app_with(conn, None);

    let orgs = list_organizations(app.state()).await.unwrap();
    let ids: Vec<&String> = orgs.iter().map(|o| &o.id).collect();
    assert!(
        ids.iter().any(|i| *i == "org-a"),
        "org-a must surface: {ids:?}"
    );
    assert!(
        ids.iter().any(|i| *i == "org-b"),
        "org-b must surface: {ids:?}"
    );
    assert!(
        !ids.iter().any(|i| i.starts_with("other:")),
        "no foreign-tenant entity may surface: {ids:?}"
    );
    assert!(orgs.iter().any(|o| o.name == "Alpha Co"));
    assert!(orgs.iter().any(|o| o.name == "Bravo Co"));
}

#[tokio::test]
async fn l194_list_organizations_excludes_other_tenant() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "other", "org-x", "Cross-Tenant");
    let (app, _uid) = l194_app_with(conn, None);

    let orgs = list_organizations(app.state()).await.unwrap();
    let ids: Vec<&String> = orgs.iter().map(|o| &o.id).collect();
    assert!(
        ids.iter().any(|i| *i == "org-a"),
        "device-tenant entity must surface"
    );
    assert!(
        !ids.iter().any(|i| *i == "org-x"),
        "cross-tenant entity must not surface"
    );
    assert!(
        !ids.iter().any(|i| i.starts_with("other:")),
        "no foreign-tenant entity may surface"
    );
}

#[tokio::test]
async fn l194_create_session_org_wide_user_gets_label() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let result = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: Some("org-a".into()),
        },
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(result.context.org_label.as_deref(), Some("Alpha Co"));
    assert_eq!(
        app.state::<AppState>().session_store.read().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn l194_create_session_org_denied_without_assignment_coverage() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, uid) = l194_app_with(conn, Some("org-a"));

    let result = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: Some("org-b".into()),
        },
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "org-b is outside the user's assignment — must be refused"
    );
    assert_eq!(
        app.state::<AppState>().session_store.read().unwrap().len(),
        0,
        "no session token may be created without assignment coverage"
    );
}

#[tokio::test]
async fn l194_switch_organization_old_token_dead() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_ok(),
        "old token live before switch"
    );

    let switched = switch_organization(
        old_token.clone(),
        "org-a".into(),
        "1234".into(),
        app.state(),
    )
    .await
    .unwrap();
    let new_token = switched.session_token.clone();

    assert_eq!(switched.context.org_label.as_deref(), Some("Alpha Co"));
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_err(),
        "old token must be dead after switch"
    );
    assert!(
        app.state::<AppState>().resolve_session(&new_token).is_ok(),
        "new token must be live after switch"
    );
    assert_eq!(
        app.state::<AppState>().session_store.read().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn l194_switch_organization_wrong_pin_keeps_old_token() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(
        old_token.clone(),
        "org-a".into(),
        "0000".into(),
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "wrong PIN must not switch"
    );
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_ok(),
        "old session must survive a failed switch"
    );
    assert_eq!(
        app.state::<AppState>().session_store.read().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn l194_switch_organization_enumerated_list_only() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(
        old_token.clone(),
        "org-z".into(),
        "1234".into(),
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "org not in device-local enumerated set must be refused"
    );
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_ok(),
        "old session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_requires_assignment_coverage() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, uid) = l194_app_with(conn, Some("org-a"));

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(
        old_token.clone(),
        "org-b".into(),
        "1234".into(),
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(_))),
        "switch to an uncovered org must be refused"
    );
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_ok(),
        "old session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_no_grant_carryover() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(login.context.org_label, None, "login session had no org");
    let old_token = login.session_token.clone();

    let switched = switch_organization(old_token, "org-a".into(), "1234".into(), app.state())
        .await
        .unwrap();

    assert_eq!(
        switched.context.org_label.as_deref(),
        Some("Alpha Co"),
        "new session org_label is computed from the assignment, not copied"
    );
}

#[tokio::test]
async fn l194_switch_organization_rejects_tampered_db() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    {
        let app_state = app.state::<AppState>();
        let db = app_state.db.lock().await;
        db.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id, created_at, updated_at)
             VALUES ('evil-uuid', 'evil', 'hash', 'Evil', 'role-owner', 'evil', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }

    let result = switch_organization(
        old_token.clone(),
        "org-a".into(),
        "1234".into(),
        app.state(),
    )
    .await;

    assert!(
        result.is_err(),
        "switch must refuse when tenant integrity is violated"
    );
    assert!(
        app.state::<AppState>().resolve_session(&old_token).is_ok(),
        "live session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_happy_path_returns_label_and_token() {
    let conn = migrations::fresh_db();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            org_id: None,
        },
        app.state(),
    )
    .await
    .unwrap();

    let switched = switch_organization(
        login.session_token.clone(),
        "org-a".into(),
        "1234".into(),
        app.state(),
    )
    .await
    .unwrap();

    assert!(!switched.session_token.is_empty());
    assert_eq!(switched.context.org_label.as_deref(), Some("Alpha Co"));
    assert_eq!(
        app.state::<AppState>().session_store.read().unwrap().len(),
        1
    );
    assert!(
        app.state::<AppState>()
            .session_store
            .read()
            .unwrap()
            .contains_key(&switched.session_token)
    );
}
