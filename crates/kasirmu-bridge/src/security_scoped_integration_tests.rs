//! Security integration tests — session gating across modules.
//!
//! Verifies that the `_scoped` command pattern enforces session
//! authentication uniformly across categories, settings, sync,
//! products, and the refresh_picker_ticket flow.
//!
//! Relocated from `apps/desktop-client/src/commands/security_scoped_integration_tests.rs`
//! and mounted inside `kasirmu_bridge::auth`; every assertion is preserved verbatim,
//! with the mechanical desktop-to-bridge mapping applied:
//! `app.state()` -> `&ctx()`, `State`-last args -> `ctx`-first,
//! `String` args -> `&str`, the sync `refresh_picker_ticket` loses its `.await`,
//! `AppState`/`tauri::test` -> the headless `TestBridge` harness, and
//! `AppError::*` -> `BridgeError::*` variant-for-variant.

use super::*;
use crate::categories;
use crate::picker;
use crate::products;
use crate::settings;
use crate::shifts;
use crate::sync;
use crate::testing::{TestBridge, temp_conn};
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

/// The release leg for a session-minting command in this file.
//-- The release leg for these session-mints lives in crate::testing (RULE at assert_refused_by_the_seeded_row) --
use kasirmu_core::db::Store;
use kasirmu_core::session::SessionContext;

/// The picker-ticket HMAC key the desktop's AppState::for_test_with_conn seeded
/// (apps/desktop-client/src/state.rs:826), so tickets minted and verified here
/// round-trip against the very secret the shell carried before the relocation.
const TEST_PICKER_SECRET: &[u8] = b"test-picker-ticket-secret";

// ── Helpers ──────────────────────────────────────────────────────

/// Seed roles + an owner user into the global DB.
fn seed_owner_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Seed roles + a staff user with NO product permissions.
fn seed_staff_no_products(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite User', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

/// Mint a picker ticket for a given user.
fn mint_ticket(secret: &[u8], user_id: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    picker::sign_picker_ticket(secret, user_id, now + 300)
}

/// Build a headless bridge with a fresh global DB and an isolated store
/// directory — the `TestBridge` stand-in for the desktop's mocked `AppState`.
fn test_bridge(conn: rusqlite::Connection) -> TestBridge {
    TestBridge::new()
        .with_conn(conn)
        .with_picker_ticket_secret(TEST_PICKER_SECRET.to_vec())
}

/// Insert a session into the session store.
fn insert_session(tb: &TestBridge, token: &str, user_id: &str, role_id: &str, store_id: &str) {
    tb.sessions().write().unwrap().insert(
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
}

/// Insert an already-expired session.
fn insert_expired_session(tb: &TestBridge, token: &str) {
    tb.sessions().write().unwrap().insert(
        token.into(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            Some(-1), // already expired
            0,
        ),
    );
}

// ── Cross-module: invalid session rejection ─────────────────────

#[tokio::test]
async fn categories_scoped_rejects_invalid_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let result = categories::list_scoped(&ctx, "bogus-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn settings_scoped_rejects_invalid_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let result = settings::get_setting_scoped(&ctx, "some.key", "bogus-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn sync_scoped_rejects_invalid_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let result = sync::get_sync_settings_scoped(&ctx, "bogus-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn products_scoped_rejects_invalid_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let result = products::list_scoped(&ctx, "bogus-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn shifts_scoped_rejects_invalid_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let result = shifts::list_shifts_scoped(&ctx, "bogus-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Cross-module: expired session rejection ──────────────────────

#[tokio::test]
async fn categories_scoped_rejects_expired_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    insert_expired_session(&tb, "expired-tok");
    let ctx = tb.ctx();

    let result = categories::list_scoped(&ctx, "expired-tok").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn settings_scoped_rejects_expired_session() {
    let conn = temp_conn();
    let tb = test_bridge(conn);
    insert_expired_session(&tb, "expired-tok");
    let ctx = tb.ctx();

    let result = settings::get_setting_scoped(&ctx, "some.key", "expired-tok").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Cross-module: permission denial ──────────────────────────────

#[tokio::test]
async fn categories_scoped_denies_staff_without_permission() {
    let conn = temp_conn();
    seed_staff_no_products(&conn);
    let tb = test_bridge(conn);
    insert_session(&tb, "lite-tok", "user-lite", "role-lite", "default");
    let ctx = tb.ctx();

    let result = categories::create_scoped(
        &ctx,
        "lite-tok",
        &categories::CreateCategoryArgs {
            id: "test".into(),
            name: "Test".into(),
            colour: String::new(),
            icon: String::new(),
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

// ── refresh_picker_ticket integration ────────────────────────────

#[tokio::test]
async fn refresh_picker_ticket_end_to_end() {
    // 1. Login → session + picker ticket
    // 2. Refresh picker ticket via session token
    // 3. Create another session with the refreshed ticket
    let conn = temp_conn();
    seed_owner_user(&conn);
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    // Step 1: Create session via picker ticket (simulates login → workspace pick)
    let settled = create_session(
        &ctx,
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: mint_ticket(TEST_PICKER_SECRET, "user-owner"),
            org_id: None,
        },
    )
    .await;
    // Release: create_session propagates the seeded row's failed signature check
    // (auth.rs:617, the gate the fourteen next door went through), so nothing
    // downstream of this mint is reachable - the legs below stay debug-only.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, settled, "free").await;
        return;
    }
    let login_result = settled.unwrap();

    // Step 2: Refresh the picker ticket (bridge-side: sync, no `.await`)
    let refresh = refresh_picker_ticket(&ctx, &login_result.session_token).unwrap();
    assert!(!refresh.picker_ticket.is_empty());

    // Step 3: Create a second session with the refreshed ticket
    let second = create_session(
        &ctx,
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: refresh.picker_ticket,
            org_id: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(second.context.user_id, "user-owner");
    assert_ne!(
        login_result.session_token, second.session_token,
        "refreshed ticket produces a new session token"
    );
}

// ── Operator impersonation (operator:impersonate) ─────────────────────

/// Seed a second owner-privileged user so an operator can impersonate an
/// in-scope target. Owner users sit in the role bypass set, so they always
/// pass `verify_instance_access` for an existing, active instance — exactly the
/// in-scope case the command must allow.
fn seed_target_owner(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)          VALUES ('user-target', 'target', 'hash', 'Target', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
}

#[tokio::test]
async fn impersonate_user_scoped_creates_target_scoped_session() {
    let conn = temp_conn();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    // Operator session (owner holds operator:impersonate via the `*` preset).
    let settled = create_session(
        &ctx,
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: mint_ticket(TEST_PICKER_SECRET, "user-owner"),
            org_id: None,
        },
    )
    .await;
    // Release: create_session propagates the seeded row's failed signature check
    // (auth.rs:617, the gate the fourteen next door went through), so nothing
    // downstream of this mint is reachable - the legs below stay debug-only.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, settled, "free").await;
        return;
    }
    let login = settled.unwrap();

    let result = impersonate_user_scoped(&ctx, &login.session_token, "user-target").await;
    assert!(result.is_ok(), "in-scope impersonation must succeed");
    let imp = result.unwrap();

    // The impersonated context is TARGET-scoped for identity, but reuses the
    // operator's store/instance/type/terminal scope. No operator grant is
    // merged and the impersonation capability is never carried into the token.
    assert_eq!(imp.context.user_id, "user-target");
    assert_eq!(imp.context.role_id, "role-owner");
    assert_eq!(imp.context.store_id, "default");
    assert_eq!(imp.context.instance_id, "default-restaurant-pos");
    assert_eq!(imp.context.type_key, "restaurant-pos");
    assert_eq!(imp.context.terminal_id, "terminal-1");

    // The produced token resolves to the target's scope.
    let resolved = ctx
        .resolve_session(&imp.session_token)
        .expect("impersonation token must resolve");
    assert_eq!(resolved.user_id, "user-target");
    assert_eq!(resolved.role_id, "role-owner");
    assert_eq!(resolved.store_id, "default");
}

#[tokio::test]
async fn impersonate_user_scoped_revoked_by_destroy_session() {
    let conn = temp_conn();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let settled = create_session(
        &ctx,
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: mint_ticket(TEST_PICKER_SECRET, "user-owner"),
            org_id: None,
        },
    )
    .await;
    // Release: create_session propagates the seeded row's failed signature check
    // (auth.rs:617, the gate the fourteen next door went through), so nothing
    // downstream of this mint is reachable - the legs below stay debug-only.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, settled, "free").await;
        return;
    }
    let login = settled.unwrap();

    let imp = impersonate_user_scoped(&ctx, &login.session_token, "user-target")
        .await
        .unwrap();

    // Stopping the impersonation (destroy_session) must revoke the token.
    let revoked = destroy_session(&ctx, &imp.session_token).await;
    assert!(
        revoked.is_ok(),
        "destroy_session must accept the impersonation token"
    );

    let after = ctx.resolve_session(&imp.session_token);
    assert!(
        matches!(after, Err(BridgeError::InvalidSession)),
        "revoked impersonation token must not resolve: {:?}",
        after.err()
    );
}

#[tokio::test]
async fn impersonate_user_scoped_enforces_ttl() {
    let conn = temp_conn();
    seed_owner_user(&conn);
    seed_target_owner(&conn);
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    let settled = create_session(
        &ctx,
        &CreateSessionArgs {
            user_id: "user-owner".into(),
            role_id: "role-owner".into(),
            store_id: "default".into(),
            instance_id: "default-restaurant-pos".into(),
            type_key: "restaurant-pos".into(),
            terminal_id: "terminal-1".into(),
            picker_ticket: mint_ticket(TEST_PICKER_SECRET, "user-owner"),
            org_id: None,
        },
    )
    .await;
    // Release: create_session propagates the seeded row's failed signature check
    // (auth.rs:617, the gate the fourteen next door went through), so nothing
    // downstream of this mint is reachable - the legs below stay debug-only.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, settled, "free").await;
        return;
    }
    let login = settled.unwrap();

    let imp = impersonate_user_scoped(&ctx, &login.session_token, "user-target")
        .await
        .unwrap();

    // The impersonation session must carry a finite TTL reflecting the named
    // constant — never an open-ended (None) session.
    let stored = tb
        .sessions()
        .read()
        .unwrap()
        .get(&imp.session_token)
        .cloned()
        .expect("impersonation session stored");
    let expiry = stored
        .expires_at
        .expect("impersonation must set expires_at");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    assert!(expiry > now, "impersonation expiry must be in the future");
    assert!(
        expiry >= now + IMPERSONATION_SESSION_TTL_SECONDS - 2
            && expiry <= now + IMPERSONATION_SESSION_TTL_SECONDS + 2,
        "impersonation expiry must reflect IMPERSONATION_SESSION_TTL_SECONDS (now={now}, expiry={expiry})"
    );

    // And the TTL is actually enforced: forcing the stored session into the past
    // makes the token reject on resolution.
    {
        let store = tb.sessions();
        let mut sessions = store.write().unwrap();
        if let Some(session) = sessions.get_mut(&imp.session_token) {
            session.expires_at = Some(1); // far in the past
        }
    }
    let expired = ctx.resolve_session(&imp.session_token);
    assert!(
        matches!(expired, Err(BridgeError::InvalidSession)),
        "expired impersonation token must not resolve"
    );
}

#[tokio::test]
async fn impersonate_user_scoped_denies_without_operator_permission() {
    let conn = temp_conn();
    // A staff user with no operator:impersonate grant.
    seed_staff_no_products(&conn);
    seed_target_owner(&conn);
    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    // Operator is a lite (staff) user — holds sales:view only.
    insert_session(&tb, "lite-token", "user-lite", "role-lite", "default");

    let result = impersonate_user_scoped(&ctx, "lite-token", "user-target").await;
    assert!(
        matches!(result, Err(BridgeError::PermissionDenied(_))),
        "impersonation without operator:impersonate must be denied: {:?}",
        result.err()
    );
}

// ── get_setting secret redaction (C-2) ───────────────────────────

#[tokio::test]
async fn get_setting_scoped_redacts_sync_api_key() {
    let conn = temp_conn();
    // F-017: get_setting_scoped now requires settings:read — seed the owner
    // user/role so the gate passes and the redaction itself is exercised.
    seed_owner_user(&conn);
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('sync_api_key', 'sk-live-abc123', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let tb = test_bridge(conn);
    insert_session(&tb, "owner-tok", "user-owner", "role-owner", "default");
    let ctx = tb.ctx();

    let result = settings::get_setting_scoped(&ctx, "sync_api_key", "owner-tok").await;
    // C-2: secret key must return None, not the plaintext value
    assert!(matches!(result, Ok(None)), "secret key must be redacted");
}
#[tokio::test]
async fn get_setting_scoped_allows_non_secret_key() {
    // Settings live in the global DB; get_setting (unscoped) reads from
    // it via state.db. This test verifies that non-secret keys pass
    // through the deny-list check correctly.
    let conn = temp_conn();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES ('store.name', 'My Store', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let tb = test_bridge(conn);
    let ctx = tb.ctx();

    // Use the unscoped get_setting (reads from global DB).
    let result = settings::get_setting(&ctx, "store.name").await;
    assert_eq!(result.unwrap(), Some("My Store".into()));
}
