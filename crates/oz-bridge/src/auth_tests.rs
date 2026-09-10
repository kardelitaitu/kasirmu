use super::*;
use crate::picker;
use crate::testing::TestBridge;

/// The picker-ticket HMAC key the desktop's AppState::for_test_with_conn seeds
/// (apps/desktop-client/src/state.rs:826), so tickets minted and verified here
/// round-trip against the very secret the shell carried before the relocation.
const TEST_PICKER_SECRET: &[u8] = b"test-picker-ticket-secret";

/// A headless bridge over a caller-supplied global identity DB - the TestBridge
/// stand-in for the desktop's mocked AppState.
fn test_app(conn: rusqlite::Connection) -> TestBridge {
    TestBridge::new()
        .with_conn(conn)
        .with_picker_ticket_secret(TEST_PICKER_SECRET.to_vec())
}

/// Test helper: sign a picker ticket for the given user using the test secret.
fn test_picker_ticket(user_id: &str) -> String {
    let secret = b"test-picker-ticket-secret";
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 300; // 5 min from now
    picker::sign_picker_ticket(secret, user_id, expiry)
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
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = test_app(conn);

    let result = staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
    )
    .await
    .unwrap();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    assert_eq!(
        picker::verify_picker_ticket(TEST_PICKER_SECRET, &result.picker_ticket, now).as_deref(),
        Some("user-owner"),
        "login must mint a ticket bound to the authenticated user"
    );
}

#[tokio::test]
async fn staff_login_returns_granted_permission_keys() {
    // The session carries the role's granted keys verbatim so UI gates
    // can mirror the backend registry. Owner's preset grants the global
    // `"*"` wildcard — the DTO must surface it as-is.
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = test_app(conn);

    let result = staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
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
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let app = test_app(conn);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-cashier".into(),
            role_id: "role-owner".into(), // forged
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-cashier"),
            org_id: None,
        },
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "forged role must not mint a session"
    );
    assert_eq!(
        app.sessions().read().unwrap().len(),
        0,
        "no session token may be created for a forged role"
    );
}

#[tokio::test]
async fn create_session_rejects_unknown_user() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = test_app(conn);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "ghost-user".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("ghost-user"),
            org_id: None,
        },
    )
    .await;
    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "unknown user must not be able to open a session"
    );
    assert_eq!(app.sessions().read().unwrap().len(), 0);
}

#[tokio::test]
async fn create_session_allows_real_owner() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = test_app(conn);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
            org_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(result.context.role_id, "role-owner");
    assert_eq!(result.context.user_id, "user-owner");
    assert_eq!(app.sessions().read().unwrap().len(), 1);
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
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = test_app(conn);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-kds".into(),
            type_key: "kds".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
            org_id: None,
        },
    )
    .await;

    let err = result.expect_err("Free tier must not open a kds session");
    match err {
        BridgeError::Invalid(msg) => {
            assert!(
                msg.contains("not entitled") || msg.contains("subscription"),
                "error must name the tier gate, got: {msg}"
            );
        }
        other => panic!("expected BridgeError::Invalid, got {other:?}"),
    }
}

#[tokio::test]
async fn create_session_rejects_tampered_subscription_signature() {
    // Parity with create_staff_scoped (and every other subscription-
    // trusting command): the tenant_subscription row's RSA signature must
    // be verified before its tier/allowed-types are honored. A tampered
    // row (tier_key -> pro, allowed_types_json -> +kds) with an invalid
    // signature must fail closed — not silently open a kds session.
    let conn = crate::testing::temp_conn();
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
    let app = test_app(conn);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-kds".into(),
            type_key: "kds".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
            org_id: None,
        },
    )
    .await;

    let err = result.expect_err("tampered subscription must not open a kds session");
    match err {
        BridgeError::Invalid(msg) => {
            assert!(
                msg.contains("signature")
                    || msg.contains("subscription")
                    || msg.contains("entitled"),
                "error must name the signature/tier gate, got: {msg}"
            );
        }
        BridgeError::Core { .. } => {}
        other => panic!("expected BridgeError::Invalid/Core, got {other:?}"),
    }
}

// ── refresh_picker_ticket ───────────────────────────────────────────

#[tokio::test]
async fn refresh_picker_ticket_returns_fresh_ticket() {
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = test_app(conn);

    // Create a session first.
    let session_token = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
            org_id: None,
        },
    )
    .await
    .unwrap()
    .session_token;

    let result = refresh_picker_ticket(&app.ctx(), &session_token).unwrap();

    // The fresh ticket must be a valid, non-empty HMAC ticket.
    assert!(!result.picker_ticket.is_empty());

    // Verify it against the process secret — must bind the same user.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    assert_eq!(
        picker::verify_picker_ticket(TEST_PICKER_SECRET, &result.picker_ticket, now,).as_deref(),
        Some("user-owner"),
        "refreshed ticket must bind the session user"
    );
}

#[tokio::test]
async fn refresh_picker_ticket_rejects_invalid_session() {
    let conn = crate::testing::temp_conn();
    let app = test_app(conn);

    let result = refresh_picker_ticket(&app.ctx(), "nonexistent-token");
    assert!(
        matches!(result, Err(BridgeError::InvalidSession)),
        "invalid session must be rejected"
    );
}

#[tokio::test]
async fn refresh_picker_ticket_rejects_expired_session() {
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', ?1, 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = test_app(conn);

    // Manually insert an expired session.
    {
        let sessions = app.sessions();
        let mut session_store = sessions.write().unwrap();
        let ctx = SessionContext::new(
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

    let result = refresh_picker_ticket(&app.ctx(), "expired-session-token");
    assert!(
        matches!(result, Err(BridgeError::InvalidSession)),
        "expired session must be rejected"
    );
}

#[tokio::test]
async fn refreshed_picker_ticket_can_be_used_for_create_session() {
    // End-to-end: login → refresh ticket → create_session with refreshed ticket.
    let conn = crate::testing::temp_conn();
    seed_owner(&conn);
    let app = test_app(conn);

    // Step 1: Create a session.
    let session_token = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket("user-owner"),
            org_id: None,
        },
    )
    .await
    .unwrap()
    .session_token;

    // Step 2: Refresh the picker ticket.
    let refresh_result = refresh_picker_ticket(&app.ctx(), &session_token).unwrap();

    // Step 3: Use the refreshed ticket to create ANOTHER session.
    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: refresh_result.picker_ticket,
            org_id: None,
        },
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
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("123").unwrap(); // 3 digits
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-1', 'testuser', ?1, 'Test User', 'role-staff', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = test_app(conn);

    let result = staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "testuser".into(),
            pin: "123".into(),
            device_id: None,
        },
    )
    .await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(ref msg)) if msg.contains("at least 4 digits")),
        "3-digit PIN must be rejected with 'at least 4 digits' error, got: {:?}",
        result
    );
}

#[tokio::test]
async fn staff_login_rejects_empty_pin() {
    // S1: An empty PIN must be rejected.
    let conn = crate::testing::temp_conn();
    let app = test_app(conn);

    let result = staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "anyone".into(),
            pin: "".into(),
            device_id: None,
        },
    )
    .await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(ref msg)) if msg.contains("at least 4 digits")),
        "empty PIN must be rejected, got: {:?}",
        result
    );
}

#[tokio::test]
async fn staff_login_accepts_exactly_4_digit_pin() {
    // S1: A 4-digit PIN should pass the length check (even if wrong password).
    let conn = crate::testing::temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("5678").unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-1', 'testuser', ?1, 'Test User', 'role-staff', 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')",
        [hash],
    )
    .unwrap();
    let app = test_app(conn);

    let result = staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "testuser".into(),
            pin: "1234".into(), // 4 digits but wrong
            device_id: None,
        },
    )
    .await;

    // Should NOT be rejected for length — should be rejected for wrong PIN
    assert!(
        matches!(result, Err(BridgeError::Invalid(ref msg)) if msg.contains("invalid username or PIN")),
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
fn login_app(tier_key: Option<&str>) -> TestBridge {
    let conn = crate::testing::temp_conn();
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
    test_app(conn)
}

/// Every audit row in the global DB.
async fn audit_rows(app: &TestBridge) -> Vec<(String, String, String, String, String)> {
    let db = app.ctx().lock_global().await;
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
        &app.ctx(),
        &StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: Some("term-4".into()),
        },
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
        &app.ctx(),
        &StaffLoginArgs {
            username: "owner".into(),
            pin: "9999".into(),
            device_id: Some("term-4".into()),
        },
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
        &app.ctx(),
        &StaffLoginArgs {
            username: "ghost".into(),
            pin: "1234".into(),
            device_id: None,
        },
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
        &app.ctx(),
        &StaffLoginArgs {
            username: "owner".into(),
            pin: "1234".into(),
            device_id: None,
        },
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
        app.sessions().write().unwrap().insert(
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

    destroy_session(&app.ctx(), "tok-1").await.unwrap();

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
    destroy_session(&app.ctx(), "never-issued").await.unwrap();
    assert!(audit_rows(&app).await.is_empty());
}

#[tokio::test]
async fn a_rejected_login_leaves_exactly_one_event() {
    // Guards against double-recording: the unknown-account arm returns early,
    // so it must not also fall through to the wrong-PIN arm.
    let app = login_app(Some("enterprise"));
    staff_login(
        &app.ctx(),
        &StaffLoginArgs {
            username: "nobody".into(),
            pin: "0000".into(),
            device_id: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(audit_rows(&app).await.len(), 1);
}
// ── SaaS-3 L194: multi-Organization switching — isolation suite ────────
//
// Mirrors the impersonation isolation suite's leak-class coverage. The
// defining property of switch_organization is that the OLD token is dead
// BEFORE any new session exists (invalidate-then-mint), and the new session
// re-derives its authority purely from the user assignment — no credential
// carryover, no grant merge. org_label is display-only and never an auth input.
//
// These tests seed legal_entities (the device-local Organization enumeration)
// and override the user assignment directly. They do NOT touch core
// SessionContext — org_label lives only on SessionContextDto, so the
// fail-closed authority path is exercised end to end.

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

/// Override a user's single effective assignment: `None` -> Organization-wide
/// (covers every legal entity); `Some(org_id)` -> a single LegalEntity scope
/// covering only that org. This is the authoritative grant the org switch gate
/// reads via `assignment_covers_resource`.
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

/// Build an app with an owner (role-owner) whose assignment is scoped by
/// `org_scope` (None = org-wide, Some(id) = single LegalEntity). Returns the
/// app and the real uuid user_id (needed to sign the picker ticket).
fn l194_app_with(conn: rusqlite::Connection, org_scope: Option<&str>) -> (TestBridge, String) {
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    let hash = oz_core::auth::hash_pin("1234").unwrap();
    let user = store
        .create_user("alice", &hash, "Alice", "role-owner")
        .unwrap();
    let user_id = user.id.clone();
    set_user_assignment(&conn, &user_id, "role-owner", org_scope);
    let app = test_app(conn);
    (app, user_id)
}

#[tokio::test]
async fn l194_list_organizations_device_local_only() {
    // enumerated-list-only: only the device tenant's legal_entities surface.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, _uid) = l194_app_with(conn, None);

    let orgs = list_organizations(&app.ctx()).await.unwrap();
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
    // cross-tenant escape blocked: a legal_entity in another tenant is never
    // offered as a switch target on this device.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "other", "org-x", "Cross-Tenant");
    let (app, _uid) = l194_app_with(conn, None);

    let orgs = list_organizations(&app.ctx()).await.unwrap();
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
    // assignment-covers happy path at login: an org-wide user may open a
    // session scoped to any device-local org and receives org_label.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: Some("org-a".into()),
        },
    )
    .await
    .unwrap();

    assert_eq!(result.context.org_label.as_deref(), Some("Alpha Co"));
    assert_eq!(app.sessions().read().unwrap().len(), 1);
}

#[tokio::test]
async fn l194_create_session_org_denied_without_assignment_coverage() {
    // fail-closed: a user whose assignment covers only org-a cannot open a
    // session against org-b. No token is minted.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, uid) = l194_app_with(conn, Some("org-a"));

    let result = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: Some("org-b".into()),
        },
    )
    .await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "org-b is outside the user's assignment — must be refused"
    );
    assert_eq!(
        app.sessions().read().unwrap().len(),
        0,
        "no session token may be created without assignment coverage"
    );
}

#[tokio::test]
async fn l194_switch_organization_old_token_dead() {
    // the defining invariant: after a successful switch the OLD token is dead
    // before the new session exists (invalidate-then-mint).
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();
    assert!(
        app.ctx().resolve_session(&old_token).is_ok(),
        "old token live before switch"
    );

    let switched = switch_organization(&app.ctx(), &old_token, "org-a", "1234")
        .await
        .unwrap();
    let new_token = switched.session_token.clone();

    assert_eq!(
        switched.context.org_label.as_deref(),
        Some("Alpha Co"),
        "switched session carries the target org label"
    );
    assert!(
        app.ctx().resolve_session(&old_token).is_err(),
        "old token must be dead after switch"
    );
    assert!(
        app.ctx().resolve_session(&new_token).is_ok(),
        "new token must be live after switch"
    );
    assert_eq!(app.sessions().read().unwrap().len(), 1);
}

#[tokio::test]
async fn l194_switch_organization_records_an_org_switch_event() {
    // todo-global-saas-3.md L227 follow-up: a successful organization
    // switch is a session-lifecycle security event — the operator
    // re-authenticated in full and re-scoped their data authority. The
    // row names the actor in user_id and the TARGET ORG in target_id,
    // so an investigator can answer "who entered which org" without
    // parsing the details blob.
    let conn = crate::testing::temp_conn();
    // A paid tier, so the recording is deterministic rather than riding the
    // desktop helper's debug Free->Premium promotion.
    set_tier(&conn, "premium");
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();

    switch_organization(&app.ctx(), &login.session_token, "org-a", "1234")
        .await
        .unwrap();

    let rows = audit_rows(&app).await;
    let hit = rows
        .iter()
        .find(|(_, action, ..)| *action == oz_core::db::audit_security::SECURITY_ACTION_ORG_SWITCH)
        .expect("a successful switch must record an org.switch row");
    let (user_id, action, outcome, target_id, _details) = hit;
    assert_eq!(
        action,
        &oz_core::db::audit_security::SECURITY_ACTION_ORG_SWITCH
    );
    assert_eq!(outcome, &"success");
    assert_eq!(user_id, &uid, "the row names the operator who switched");
    assert_eq!(target_id, &"org-a", "target_id carries the org entered");
}

#[tokio::test]
async fn l194_switch_organization_wrong_pin_keeps_old_token() {
    // full re-auth, no credential carryover: a wrong PIN must refuse the
    // switch and leave the old session intact.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(
        &app.ctx(),
        &old_token,
        "org-a",
        "0000", // wrong PIN
    )
    .await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "wrong PIN must not switch"
    );
    assert!(
        app.ctx().resolve_session(&old_token).is_ok(),
        "old session must survive a failed switch"
    );
    assert_eq!(app.sessions().read().unwrap().len(), 1);
}

#[tokio::test]
async fn l194_switch_organization_enumerated_list_only() {
    // enumerated-list-only: requesting an org not present on this device is
    // refused and the live session is untouched.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(
        &app.ctx(),
        &old_token,
        "org-z", // not seeded on this device
        "1234",
    )
    .await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "org not in device-local enumerated set must be refused"
    );
    assert!(
        app.ctx().resolve_session(&old_token).is_ok(),
        "old session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_requires_assignment_coverage() {
    // fail-closed at switch: a user assigned only to org-a cannot switch to
    // org-b, and the old session stays live.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    seed_legal_entity(&conn, "default", "org-b", "Bravo Co");
    let (app, uid) = l194_app_with(conn, Some("org-a"));

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    let result = switch_organization(&app.ctx(), &old_token, "org-b", "1234").await;

    assert!(
        matches!(result, Err(BridgeError::Invalid(_))),
        "switch to an uncovered org must be refused"
    );
    assert!(
        app.ctx().resolve_session(&old_token).is_ok(),
        "old session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_no_grant_carryover() {
    // no grant carryover: the new session's authority is derived FRESH from
    // the user assignment, not copied from the old session. The old session
    // had org_label = None (no org at login); after switching, the new token
    // carries the label only because the assignment is re-checked.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(login.context.org_label, None, "login session had no org");
    let old_token = login.session_token.clone();

    let switched = switch_organization(&app.ctx(), &old_token, "org-a", "1234")
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
    // defense-in-depth: switch_organization re-runs check_tenant_integrity on
    // the open tenant DB. A foreign-tenant row (tamper) makes the switch fail
    // and leaves the live session untouched.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();
    let old_token = login.session_token.clone();

    // Tamper: inject a foreign-tenant user row so check_tenant_integrity fails.
    {
        let db = app.ctx().lock_global().await;
        db.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id, created_at, updated_at)
             VALUES ('evil-uuid', 'evil', 'hash', 'Evil', 'role-owner', 'evil', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }

    let result = switch_organization(&app.ctx(), &old_token, "org-a", "1234").await;

    assert!(
        result.is_err(),
        "switch must refuse when tenant integrity is violated"
    );
    assert!(
        app.ctx().resolve_session(&old_token).is_ok(),
        "live session must survive a refused switch"
    );
}

#[tokio::test]
async fn l194_switch_organization_happy_path_returns_label_and_token() {
    // assignment-covers happy path at switch returns a fresh token and the
    // target org_label.
    let conn = crate::testing::temp_conn();
    seed_legal_entity(&conn, "default", "org-a", "Alpha Co");
    let (app, uid) = l194_app_with(conn, None);

    let login = create_session(
        &app.ctx(),
        &CreateSessionArgs {
            user_id: uid.clone(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: test_picker_ticket(&uid),
            org_id: None,
        },
    )
    .await
    .unwrap();

    let switched = switch_organization(&app.ctx(), &login.session_token, "org-a", "1234")
        .await
        .unwrap();

    assert!(!switched.session_token.is_empty());
    assert_eq!(switched.context.org_label.as_deref(), Some("Alpha Co"));
    assert_eq!(app.sessions().read().unwrap().len(), 1);
    assert!(
        app.sessions()
            .read()
            .unwrap()
            .contains_key(&switched.session_token)
    );
}
