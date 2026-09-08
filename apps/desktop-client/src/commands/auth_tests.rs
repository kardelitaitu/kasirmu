use super::*;

/// Test helper: sign a picker ticket for the given user using the test secret.
fn test_picker_ticket(user_id: &str) -> String {
    let secret = b"test-picker-ticket-secret";
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 300; // 5 min from now
    picker_ticket::sign_picker_ticket(secret, user_id, expiry)
}

// ── StaffLoginArgs ──────────────────────────────────────────────────

#[test]
fn staff_login_args_deserialize() {
    let json = r##"{"username":"jdoe","pin":"1234"}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "jdoe");
    assert_eq!(args.pin, "1234");
}

#[test]
fn staff_login_args_debug() {
    let args = StaffLoginArgs {
        username: "u".into(),
        pin: "0000".into(),
        device_id: Some("term-1".into()),
    };
    let d = format!("{args:?}");
    assert!(d.contains("u"));
}

#[test]
fn staff_login_args_device_id_defaults_none() {
    // `device_id` is optional — legacy JSON without it must deserialize.
    let json = r##"{"username":"jdoe","pin":"1234"}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.device_id, None);
}

#[test]
fn staff_login_args_device_id_deserializes() {
    let json = r##"{"username":"jdoe","pin":"1234","device_id":"term-7"}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.device_id.as_deref(), Some("term-7"));
}

// ── StaffLoginArgs edge cases ────────────────────────────────────────

#[test]
fn staff_login_args_whitespace_username() {
    let json = r##"{"username":"   ","pin":"1234"}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    // After trimming in staff_login, this becomes empty
    assert_eq!(args.username, "   ");
    assert_eq!(args.pin, "1234");
}

#[test]
fn staff_login_args_empty_pin() {
    let json = r##"{"username":"jdoe","pin":""}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.username, "jdoe");
    assert_eq!(args.pin, "");
}

#[test]
fn staff_login_args_long_pin() {
    let json = r##"{"username":"jdoe","pin":"12345678901234567890"}"##;
    let args: StaffLoginArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.pin.len(), 20);
}

// ── StaffLoginResult ────────────────────────────────────────────────

#[test]
fn staff_login_result_serialize() {
    let session = LoginSession {
        user_id: "u1".into(),
        display_name: "John".into(),
        role_name: "Manager".into(),
        role_id: "r1".into(),
        permissions: vec!["analytics:view".into()],
    };
    let result = StaffLoginResult {
        session,
        picker_ticket: String::new(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["session"]["user_id"], "u1");
    assert_eq!(json["session"]["role_name"], "Manager");
}

#[test]
fn staff_login_result_debug() {
    let session = LoginSession {
        user_id: "u2".into(),
        display_name: "Alice".into(),
        role_name: "Cashier".into(),
        role_id: "r2".into(),
        permissions: vec![],
    };
    let result = StaffLoginResult {
        session,
        picker_ticket: String::new(),
    };
    let d = format!("{result:?}");
    assert!(d.contains("Alice"));
}

// ── Error mapping edge cases ────────────────────────────────────────

#[test]
fn staff_login_result_empty_display_name() {
    let session = LoginSession {
        user_id: "u3".into(),
        display_name: "".into(),
        role_name: "Cashier".into(),
        role_id: "r3".into(),
        permissions: vec![],
    };
    let result = StaffLoginResult {
        session,
        picker_ticket: String::new(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["session"]["display_name"], "");
}

#[test]
fn staff_login_result_null_role_id() {
    let session = LoginSession {
        user_id: "u4".into(),
        display_name: "Bob".into(),
        role_name: "".into(),
        role_id: "".into(),
        permissions: vec![],
    };
    let result = StaffLoginResult {
        session,
        picker_ticket: String::new(),
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["session"]["role_name"], "");
    assert_eq!(json["session"]["role_id"], "");
}

// ── Session-mint authorization gate (audit-open-findings residual) ───────────
//
// TDD red: `create_session` must fail closed when the caller claims an
// identity it has not authenticated — unknown user, or a role_id that
// does not match the user's actual database role. Previously the gate
// (oz_core `Store::verify_instance_access`) trusted the claimed role
// and never resolved the user, so a caller who knew an owner's user id
// could mint a session as that owner and inherit every permission.

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
    // audit-open-findings: the picker ticket returned by a successful login must
    // verify against the process secret and bind the authenticated user.
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
    // The session carries the role's granted keys verbatim so UI gates
    // can mirror the backend registry. Owner's preset grants the global
    // `"*"` wildcard — the DTO must surface it as-is.
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
            picker_ticket: test_picker_ticket("user-cashier"),
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
            picker_ticket: test_picker_ticket("ghost-user"),
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
            picker_ticket: test_picker_ticket("user-owner"),
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
    // ADR #5: the tenant subscription gates which workspace types a
    // session may open. The default tenant is on the Free tier, which
    // allows only store-pos / restaurant-pos / admin — `kds` is NOT
    // entitled. Even though the owner role can access the kds instance
    // (verify_instance_access), opening a session into it must fail
    // closed: a downgraded tenant must not keep working in workspace
    // types their subscription no longer covers.
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
            picker_ticket: test_picker_ticket("user-owner"),
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
    // Parity with create_staff_scoped (and every other subscription-
    // trusting command): the tenant_subscription row's RSA signature must
    // be verified before its tier/allowed-types are honored. A tampered
    // row (tier_key -> pro, allowed_types_json -> +kds) with an invalid
    // signature must fail closed — not silently open a kds session.
    let conn = migrations::fresh_db();
    // Replace the bootstrap Free row with a forged higher-tier row whose
    // signature is NOT the debug-only BOOTSTRAP_FREE sentinel.
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
            picker_ticket: test_picker_ticket("user-owner"),
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

// ── refresh_picker_ticket ───────────────────────────────────────────

#[tokio::test]
async fn refresh_picker_ticket_returns_fresh_ticket() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    // Create a session first.
    let session_token = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
        },
        app.state(),
    )
    .await
    .unwrap()
    .session_token;

    let result = refresh_picker_ticket(session_token, app.state())
        .await
        .unwrap();

    // The fresh ticket must be a valid, non-empty HMAC ticket.
    assert!(!result.picker_ticket.is_empty());

    // Verify it against the process secret — must bind the same user.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let state = app.state::<AppState>();
    assert_eq!(
        picker_ticket::verify_picker_ticket(
            &state.picker_ticket_secret,
            &result.picker_ticket,
            now,
        )
        .as_deref(),
        Some("user-owner"),
        "refreshed ticket must bind the session user"
    );
}

#[tokio::test]
async fn refresh_picker_ticket_rejects_invalid_session() {
    let conn = migrations::fresh_db();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = refresh_picker_ticket("nonexistent-token".into(), app.state()).await;
    assert!(
        matches!(result, Err(AppError::InvalidSession)),
        "invalid session must be rejected"
    );
}

#[tokio::test]
async fn refresh_picker_ticket_rejects_expired_session() {
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

    // Manually insert an expired session.
    {
        let state = app.state::<AppState>();
        let mut session_store = state.session_store.write().unwrap();
        let ctx = oz_core::session::SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "default-restaurant-pos".into(),
            "restaurant-pos".into(),
            Some(-1), // already expired
            0,
        );
        session_store.insert("expired-session-token".into(), ctx);
    }

    let result = refresh_picker_ticket("expired-session-token".into(), app.state()).await;
    assert!(
        matches!(result, Err(AppError::InvalidSession)),
        "expired session must be rejected"
    );
}

#[tokio::test]
async fn refreshed_picker_ticket_can_be_used_for_create_session() {
    // End-to-end: login → refresh ticket → create_session with refreshed ticket.
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    // Step 1: Create a session.
    let session_token = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
        },
        app.state(),
    )
    .await
    .unwrap()
    .session_token;

    // Step 2: Refresh the picker ticket.
    let refresh_result = refresh_picker_ticket(session_token, app.state())
        .await
        .unwrap();

    // Step 3: Use the refreshed ticket to create ANOTHER session.
    let result = create_session(
        CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: refresh_result.picker_ticket,
        },
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(result.context.user_id, "user-owner");
    assert_eq!(result.context.role_id, "role-owner");
    assert!(!result.session_token.is_empty());
}

// ── S1: PIN minimum length enforcement ──────────────────────────────

#[tokio::test]
async fn staff_login_rejects_short_pin() {
    // S1: A 3-digit PIN must be rejected with a clear error message,
    // even if the user exists and the hash would match.
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("123").unwrap(); // 3 digits
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-1', 'testuser', ?1, 'Test User', 'role-staff', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = staff_login(
        StaffLoginArgs {
            username: "testuser".into(),
            pin: "123".into(),
            device_id: None,
        },
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(ref msg)) if msg.contains("at least 4 digits")),
        "3-digit PIN must be rejected with 'at least 4 digits' error, got: {:?}",
        result
    );
}

#[tokio::test]
async fn staff_login_rejects_empty_pin() {
    // S1: An empty PIN must be rejected.
    let conn = migrations::fresh_db();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = staff_login(
        StaffLoginArgs {
            username: "anyone".into(),
            pin: "".into(),
            device_id: None,
        },
        app.state(),
    )
    .await;

    assert!(
        matches!(result, Err(AppError::Invalid(ref msg)) if msg.contains("at least 4 digits")),
        "empty PIN must be rejected, got: {:?}",
        result
    );
}

#[tokio::test]
async fn staff_login_accepts_exactly_4_digit_pin() {
    // S1: A 4-digit PIN should pass the length check (even if wrong password).
    let conn = migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("5678").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-1', 'testuser', ?1, 'Test User', 'role-staff', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();

    let result = staff_login(
        StaffLoginArgs {
            username: "testuser".into(),
            pin: "1234".into(), // 4 digits but wrong
            device_id: None,
        },
        app.state(),
    )
    .await;

    // Should NOT be rejected for length — should be rejected for wrong PIN
    assert!(
        matches!(result, Err(AppError::Invalid(ref msg)) if msg.contains("invalid username or PIN")),
        "4-digit wrong PIN should get 'invalid username or PIN', not length error, got: {:?}",
        result
    );
}
// ── Basic security events on the auth paths (todo-global-saas-2.md P1) ─
//
// The audit baseline promises paid tiers keep basic security events. These
// pin that staff_login and destroy_session actually WRITE them — the core
// recorder has its own suite in oz-core; what is proven here is the wiring,
// including the desktop debug_upgrade divergence, which is the one place the
// two clients are allowed to disagree.

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
    let app = login_app(Some("premium"));
    staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: Some("term-4".into()),
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
    assert!(details.contains("term-4"), "device id recorded: {details}");
    assert!(
        !details.contains("1234"),
        "the PIN must never reach the table"
    );
}

#[tokio::test]
async fn staff_login_records_a_failure_event_with_its_classifier() {
    let app = login_app(Some("premium"));
    let err = staff_login(
        StaffLoginArgs {
            username: "owner".into(),
            pin: "9999".into(),
            device_id: Some("term-4".into()),
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
    let (user_id, action, outcome, _, details) = &rows[0];
    assert_eq!(action, "login.failed");
    assert_eq!(outcome, "failure");
    assert_eq!(
        user_id, "user-owner",
        "the account DID resolve on a wrong PIN"
    );
    assert!(
        details.contains("wrong_pin"),
        "classifier recorded: {details}"
    );
}

#[tokio::test]
async fn staff_login_records_an_unknown_account_against_the_attempted_name() {
    let app = login_app(Some("premium"));
    staff_login(
        StaffLoginArgs {
            username: "ghost".into(),
            pin: "1234".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap_err();

    let rows = audit_rows(&app).await;
    assert_eq!(rows.len(), 1);
    let (user_id, action, _, target_id, details) = &rows[0];
    assert_eq!(action, "login.failed");
    assert_eq!(user_id, "system", "no users row exists to reference");
    assert_eq!(target_id, "ghost", "the probe is still groupable by name");
    assert!(details.contains("unknown_user"), "got {details}");
}

#[tokio::test]
async fn staff_login_on_free_records_only_because_a_debug_build_promotes_it() {
    // The desktop passes debug_upgrade: true to its tier reads, matching
    // require_audit_tier. apply_debug_upgrade is cfg!(debug_assertions)-gated,
    // so this row records in a test/dev build while a production Free tenant
    // writes nothing. Pinned as an equality so flipping either half — the
    // client flag or the core gate — fails one of the two branches.
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
        usize::from(cfg!(debug_assertions)),
        "Free records only through the dev promotion"
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
                "term-2".into(),
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
    let (user_id, action, outcome, target_id, details) = &rows[0];
    assert_eq!(action, "logout");
    assert_eq!(outcome, "success", "a logout is not a failure");
    assert_eq!(user_id, "user-owner");
    assert_eq!(target_id, "user-owner");
    assert!(
        details.contains("owner"),
        "username resolved for the event: {details}"
    );
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
async fn a_rejected_login_leaves_exactly_one_event() {
    // Guards against double-recording: the unknown-account arm returns early,
    // so it must not also fall through to the wrong-PIN arm.
    let app = login_app(Some("enterprise"));
    staff_login(
        StaffLoginArgs {
            username: "nobody".into(),
            pin: "0000".into(),
            device_id: None,
        },
        app.state(),
    )
    .await
    .unwrap_err();
    assert_eq!(audit_rows(&app).await.len(), 1);
}
