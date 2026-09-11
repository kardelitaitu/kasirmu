//! Unit tests for the terminal command bodies (Wave-F test relocation:
//! moved out of `apps/desktop-client/src/commands/terminals_tests.rs`).
//!
//! Mounted at the foot of `terminals.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the bridge command bodies, the DTOs and the
//! module's `Store`/`Terminal` imports exactly as the desktop sibling
//! module did. The desktop `AppState::for_test` / `scoped_state` harness
//! (which built `AppState::for_test_with_conn`, swapped in a
//! `tempfile::tempdir()`-backed `StoreDatabaseManager` and seeded a
//! session) maps 1:1 onto the crate's headless `TestBridge`; the harness's
//! own unique store directory replaces `tempfile`, which is not a
//! dev-dependency of this crate. Global-DB seeding happens on the
//! connection BEFORE `with_conn` (no global-db accessor exists), and every
//! `AppError` arm maps 1:1 onto its `BridgeError` twin with the message
//! texts unchanged. Nothing observed was fixed or improved: the terminals
//! global-vs-store DB asymmetry (roles/users gated against the GLOBAL
//! identity db while terminal rows are read and written in the per-store
//! db) is preserved exactly as extracted.

use super::*;
use crate::testing::{TestBridge, temp_conn};

use oz_core::session::SessionContext;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    temp_conn()
}

#[test]
fn terminals_scoped_rejects_invalid_token() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let result = ctx.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[test]
fn list_terminals_empty_db() {
    let conn = fresh_conn();
    let terminals = run_list_terminals(&conn).unwrap();
    assert!(terminals.is_empty());
}

#[test]
fn list_terminals_with_seeded_data() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t1 = Terminal::new("Front Counter", "host-01");
    store.create_terminal(&t1).unwrap();
    let t2 = Terminal::new("Drive-Thru", "host-02");
    store.create_terminal(&t2).unwrap();

    let terminals = run_list_terminals(&conn).unwrap();
    assert_eq!(terminals.len(), 2);
    assert_eq!(terminals[0].name, "Drive-Thru");
    assert_eq!(terminals[1].name, "Front Counter");
}

#[test]
fn get_terminal_by_device_id() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Counter", "host-04");
    store.create_terminal(&t).unwrap();

    let loaded = store.get_terminal_by_device_id("host-04").unwrap().unwrap();
    assert_eq!(loaded.id, t.id);
    assert_eq!(loaded.name, "Counter");
}

// -- DTO struct tests --

#[test]
fn terminal_dto_debug() {
    let dto = TerminalDto {
        id: "t1".into(),
        name: "Front Counter".into(),
        device_id: "host-01".into(),
        is_active: true,
        last_seen_at: None,
        metadata: None,
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let d = format!("{dto:?}");
    assert!(d.contains("Front Counter"));
}

#[test]
fn terminal_dto_serialize() {
    let dto = TerminalDto {
        id: "t2".into(),
        name: "Drive-Thru".into(),
        device_id: "host-02".into(),
        is_active: false,
        last_seen_at: Some("2025-06-01".into()),
        metadata: Some(r#"{"os":"linux"}"#.into()),
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "Drive-Thru");
    assert_eq!(json["isActive"], false);
}

#[test]
fn register_terminal_args_deserialize() {
    let json = r##"{"name":"POS-1","deviceId":"host-03"}"##;
    let args: RegisterTerminalArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "POS-1");
    assert_eq!(args.terminal_secret, None);
}

#[test]
fn register_terminal_args_debug() {
    let args = RegisterTerminalArgs {
        name: "N".into(),
        device_id: "D".into(),
        terminal_secret: None,
        metadata: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("N"));
}

#[test]
fn register_terminal_result_serialize() {
    let result = RegisterTerminalResult { id: "t99".into() };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["id"], "t99");
}

#[test]
fn register_terminal_result_debug() {
    let result = RegisterTerminalResult { id: "t42".into() };
    let d = format!("{result:?}");
    assert!(d.contains("t42"));
}

#[test]
fn update_terminal_args_deserialize_minimal() {
    let json = r##"{"id":"t1"}"##;
    let args: UpdateTerminalArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "t1");
    assert_eq!(args.name, None);
    assert_eq!(args.is_active, None);
}

#[test]
fn update_terminal_args_debug() {
    let args = UpdateTerminalArgs {
        id: "x".into(),
        name: None,
        device_id: None,
        terminal_secret: None,
        is_active: None,
        metadata: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("x"));
}

#[test]
fn update_terminal_result_serialize() {
    let result = UpdateTerminalResult { id: "t-up".into() };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["id"], "t-up");
}

// ── Scoped command integration tests ─────────────────────────────

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

fn seed_staff(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-staff', 'staff', 'hash', 'Staff', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Headless twin of the desktop `scoped_state` helper: the caller's
/// connection becomes the GLOBAL identity db, the harness supplies the
/// isolated store-db manager (its own unique directory) and the session is
/// seeded into `sessions()`. Same five parameters, same order.
fn scoped_bridge(
    conn: rusqlite::Connection,
    token: &str,
    user_id: &str,
    role_id: &str,
    store_id: &str,
) -> TestBridge {
    let tb = TestBridge::new().with_conn(conn);
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
    tb
}

// ── Session validation ────────────────────────────────────────────

#[tokio::test]
async fn scoped_list_terminals_rejects_invalid_token() {
    let conn = temp_conn();
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = list_terminals_scoped(&ctx, "bad-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_get_terminal_rejects_invalid_token() {
    let conn = temp_conn();
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = get_terminal_scoped(&ctx, "bad-token", "any-id".into()).await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_register_terminal_rejects_invalid_token() {
    let conn = temp_conn();
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = register_terminal_scoped(
        &ctx,
        "bad-token",
        RegisterTerminalArgs {
            name: "POS-1".into(),
            device_id: "dev-1".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Owner CRUD ────────────────────────────────────────────────────

#[tokio::test]
async fn owner_can_list_terminals_empty() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let terminals = list_terminals_scoped(&ctx, "tok").await.unwrap();
    assert!(terminals.is_empty());
}

#[tokio::test]
async fn owner_can_register_terminal() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = register_terminal_scoped(
        &ctx,
        "tok",
        RegisterTerminalArgs {
            name: "POS-1".into(),
            device_id: "dev-001".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await;
    assert!(result.is_ok(), "owner should register a terminal");
    let registered = result.unwrap();
    assert!(!registered.id.is_empty());
}

#[tokio::test]
async fn owner_can_get_terminal_by_id() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let registered = register_terminal_scoped(
        &ctx,
        "tok",
        RegisterTerminalArgs {
            name: "POS-1".into(),
            device_id: "dev-001".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await
    .unwrap();

    let fetched = get_terminal_scoped(&ctx, "tok", registered.id.clone()).await;
    assert!(fetched.is_ok());
    assert!(fetched.unwrap().is_some());
}

#[tokio::test]
async fn get_terminal_returns_none_for_unknown() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = get_terminal_scoped(&ctx, "tok", "nonexistent".into())
        .await
        .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn owner_can_list_terminal_overrides() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    // Need a terminal_id — use an empty string to test the endpoint exists.
    let result = list_terminal_overrides_scoped(&ctx, "tok", "any-terminal".into()).await;
    assert!(result.is_ok());
    assert!(result.unwrap().is_empty());
}

#[tokio::test]
async fn owner_can_list_terminal_profiles() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let ctx = tb.ctx();

    let result = list_terminal_profiles_scoped(&ctx, "tok").await;
    assert!(result.is_ok());
}

// ── Staff permission tests ────────────────────────────────────────

#[tokio::test]
async fn staff_denied_list_terminals() {
    let conn = temp_conn();
    seed_owner(&conn);
    seed_staff(&conn);
    let tb = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");
    let ctx = tb.ctx();

    let result = list_terminals_scoped(&ctx, "tok").await;
    // F-017: terminal state requires terminals:read — staff is denied
    // (Manager/Admin presets grant the key; checkout-only staff does not).
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_denied_register_terminal() {
    let conn = temp_conn();
    seed_owner(&conn);
    seed_staff(&conn);
    let tb = scoped_bridge(conn, "tok", "user-staff", "role-staff", "s1");
    let ctx = tb.ctx();

    let result = register_terminal_scoped(
        &ctx,
        "tok",
        RegisterTerminalArgs {
            name: "POS-1".into(),
            device_id: "dev-001".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await;
    // Staff does NOT have TERMINALS_REGISTER — only Manager/Admin do.
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}
