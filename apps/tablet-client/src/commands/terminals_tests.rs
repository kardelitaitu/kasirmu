use super::*;
use oz_core::migrations;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    migrations::fresh_db()
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
    // Ordered by name: Drive-Thru, Front Counter
    assert_eq!(terminals[0].name, "Drive-Thru");
    assert_eq!(terminals[1].name, "Front Counter");
}

#[test]
fn register_and_get_terminal() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Back Office", "host-03")
        .with_secret("s3cr3t")
        .with_metadata(r#"{"os":"windows"}"#);
    store.create_terminal(&t).unwrap();

    let loaded = store.get_terminal(&t.id).unwrap().unwrap();
    assert_eq!(loaded.name, "Back Office");
    assert_eq!(loaded.device_id, "host-03");
    assert_eq!(loaded.terminal_secret, Some("s3cr3t".into()));
    assert!(loaded.is_active);
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

#[test]
fn get_terminal_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = store.get_terminal("nonexistent").unwrap();
    assert!(t.is_none());
}

#[test]
fn update_terminal_fields() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Old Name", "host-05");
    store.create_terminal(&t).unwrap();

    let mut updated = t.clone();
    updated.name = "New Name".into();
    store.update_terminal(&updated).unwrap();

    let loaded = store.get_terminal(&t.id).unwrap().unwrap();
    assert_eq!(loaded.name, "New Name");
}

#[test]
fn update_terminal_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Ghost", "ghost");
    let err = store.update_terminal(&t).unwrap_err();
    assert!(matches!(err, oz_core::CoreError::NotFound { .. }));
}

#[test]
fn ping_terminal_updates_timestamp() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Counter", "host-06");
    store.create_terminal(&t).unwrap();

    // Initially last_seen_at is None.
    assert!(
        store
            .get_terminal(&t.id)
            .unwrap()
            .unwrap()
            .last_seen_at
            .is_none()
    );

    store.ping_terminal(&t.id).unwrap();
    let loaded = store.get_terminal(&t.id).unwrap().unwrap();
    assert!(
        loaded.last_seen_at.is_some(),
        "ping should set last_seen_at"
    );
}

#[test]
fn ping_terminal_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let err = store.ping_terminal("nope").unwrap_err();
    assert!(matches!(err, oz_core::CoreError::NotFound { .. }));
}

// ── Terminal Feature Override tests ────────────────────────────

#[test]
fn list_terminal_overrides_empty() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    let overrides = store.list_terminal_overrides(&t.id).unwrap();
    assert!(overrides.is_empty());
}

#[test]
fn list_terminal_overrides_with_data() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    store
        .set_terminal_override(&t.id, "card-payment", false)
        .unwrap();
    store
        .set_terminal_override(&t.id, "receipt-printing", true)
        .unwrap();

    let overrides = store.list_terminal_overrides(&t.id).unwrap();
    assert_eq!(overrides.len(), 2);
    // Ordered by feature ASC.
    assert_eq!(overrides[0].feature, "card-payment");
    assert!(!overrides[0].enabled);
    assert_eq!(overrides[1].feature, "receipt-printing");
    assert!(overrides[1].enabled);
    assert_eq!(overrides[0].terminal_id, t.id);
    assert_eq!(overrides[1].terminal_id, t.id);
}

#[test]
fn list_terminal_overrides_scoped_by_terminal() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t1 = Terminal::new("Term-1", "host-1");
    let t2 = Terminal::new("Term-2", "host-2");
    store.create_terminal(&t1).unwrap();
    store.create_terminal(&t2).unwrap();

    store
        .set_terminal_override(&t1.id, "card-payment", true)
        .unwrap();
    store
        .set_terminal_override(&t2.id, "card-payment", false)
        .unwrap();

    let t1_overrides = store.list_terminal_overrides(&t1.id).unwrap();
    assert_eq!(t1_overrides.len(), 1);
    assert!(t1_overrides[0].enabled);

    let t2_overrides = store.list_terminal_overrides(&t2.id).unwrap();
    assert_eq!(t2_overrides.len(), 1);
    assert!(!t2_overrides[0].enabled);
}

#[test]
fn set_terminal_override_insert() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    store
        .set_terminal_override(&t.id, "cash-payment", false)
        .unwrap();

    let o = store
        .get_terminal_override(&t.id, "cash-payment")
        .unwrap()
        .unwrap();
    assert_eq!(o.feature, "cash-payment");
    assert!(!o.enabled);
    assert_eq!(o.terminal_id, t.id);
    assert!(!o.created_at.is_empty());
    assert!(!o.updated_at.is_empty());
}

#[test]
fn set_terminal_override_update_existing() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    store
        .set_terminal_override(&t.id, "card-payment", false)
        .unwrap();
    store
        .set_terminal_override(&t.id, "card-payment", true)
        .unwrap();

    let o = store
        .get_terminal_override(&t.id, "card-payment")
        .unwrap()
        .unwrap();
    assert!(o.enabled);
}

#[test]
fn delete_terminal_override_removes_row() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    store
        .set_terminal_override(&t.id, "card-payment", false)
        .unwrap();
    store
        .delete_terminal_override(&t.id, "card-payment")
        .unwrap();

    let o = store.get_terminal_override(&t.id, "card-payment").unwrap();
    assert!(o.is_none());
}

#[test]
fn set_terminal_override_nonexistent_terminal_fails() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    // No terminal created — FK constraint should reject.
    let err = store
        .set_terminal_override("no-such-terminal", "card-payment", true)
        .unwrap_err();
    assert!(matches!(err, oz_core::CoreError::Db(_)));
}

#[test]
fn delete_terminal_override_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Test", "host-override");
    store.create_terminal(&t).unwrap();

    let err = store
        .delete_terminal_override(&t.id, "nonexistent")
        .unwrap_err();
    assert!(
        matches!(err, oz_core::CoreError::NotFound { entity, .. } if entity == "terminal_feature_override")
    );
}

// ── Store::delete_terminal ───────────────────────────────────────
// These cases reach the `oz_core` store method, not a command fn: the unscoped
// `delete_terminal` command this banner used to name was retired on 2026-09-16 (T7-4) and all 37
// cases passed unchanged before and after, which is the proof that none of them ever called it.

#[test]
fn delete_terminal_removes_row() {
    let conn = fresh_conn();
    let store = Store::new(&conn);

    let t = Terminal::new("Temp", "host-07");
    store.create_terminal(&t).unwrap();
    store.delete_terminal(&t.id).unwrap();

    let loaded = store.get_terminal(&t.id).unwrap();
    assert!(loaded.is_none());
}

#[test]
fn delete_terminal_not_found() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let err = store.delete_terminal("nope").unwrap_err();
    assert!(matches!(err, oz_core::CoreError::NotFound { .. }));
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

// ── Device binding (parity with desktop client) ─────────────────────

#[test]
fn sign_binding_roundtrip_matches() {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    let sig = sign_binding(&keyring, "term-1", "store-a", "ws-a-1").unwrap();
    assert!(!sig.is_empty());
    assert_eq!(
        sign_binding(&keyring, "term-1", "store-a", "ws-a-1").unwrap(),
        sig,
        "signing the same payload with the same keyring must be stable"
    );
}

#[test]
fn sign_binding_different_secret_differs() {
    let signer = kasirmu_security::InMemoryKeyring::new();
    let other = kasirmu_security::InMemoryKeyring::new();
    let sig = sign_binding(&signer, "term-1", "store-a", "ws-a-1").unwrap();
    assert_ne!(
        sign_binding(&other, "term-1", "store-a", "ws-a-1").unwrap(),
        sig,
        "a signature from a different keyring secret must not match"
    );
}

#[test]
fn sign_binding_differs_for_wrong_payload() {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    let sig = sign_binding(&keyring, "term-1", "store-a", "ws-a-1").unwrap();
    assert_ne!(
        sign_binding(&keyring, "term-1", "store-a", "ws-a-2").unwrap(),
        sig,
        "signature for a different instance must not match"
    );
}

#[test]
fn run_set_device_binding_writes_verifiable_binding() {
    let conn = fresh_conn();
    let store = Store::new(&conn);
    let t = Terminal::new("Counter", "host-bind");
    store.create_terminal(&t).unwrap();

    // `bound_store_id` is FK-enforced against the global `locations`.
    let now = "2026-07-31T00:00:00.000Z";
    conn.execute(
        "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
         VALUES ('store-a', 'Store A', '', '', 'USD', 'UTC', 0, ?1, ?1)",
        [now],
    )
    .unwrap();

    let keyring = kasirmu_security::InMemoryKeyring::new();
    run_set_device_binding(
        &conn,
        &keyring,
        &SetDeviceBindingArgs {
            terminal_id: t.id.clone(),
            bound_store_id: "store-a".into(),
            bound_instance_id: "ws-a-1".into(),
        },
    )
    .unwrap();
    let (store_id, instance_id, sig) = store.get_terminal_binding(&t.id).unwrap().unwrap();
    assert_eq!(store_id, "store-a");
    assert_eq!(instance_id, "ws-a-1");
    assert_eq!(
        sign_binding(&keyring, &t.id, &store_id, &instance_id).unwrap(),
        sig,
        "persisted binding must match the same keyring's signature"
    );
}

#[test]
fn set_device_binding_args_deserialize() {
    let json = r##"{"terminalId":"t1","boundStoreId":"store-a","boundInstanceId":"ws-a-1"}"##;
    let args: SetDeviceBindingArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.terminal_id, "t1");
    assert_eq!(args.bound_store_id, "store-a");
    assert_eq!(args.bound_instance_id, "ws-a-1");
}

#[test]
fn set_device_binding_args_debug() {
    let args = SetDeviceBindingArgs {
        terminal_id: "t1".into(),
        bound_store_id: "store-a".into(),
        bound_instance_id: "ws-a-1".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("store-a"));
    assert!(d.contains("ws-a-1"));
}

// ── Scoped-command permission gates (F-017 parity) ────────────────────
//
// Added with `50b2fd14e`, which gave nine of this module's scoped commands the
// gate their `kasirmu_bridge::terminals` twins already enforced under a comment
// naming the work item. Nothing above reaches a scoped command: every case in
// this file drives `run_*` or the store helpers directly, which is precisely
// why four of the reads could resolve a session, bind it to a store, and then
// assume the caller may read — with this shell's own ledger recording each one
// as `resolves_session_names_no_permission` the whole time.
//
// What these cases can and cannot prove, stated because the difference matters
// here: they hold the PERMISSION half shut. They cannot hold the
// missing-argument half shut. Calling a command function from Rust never asks
// Tauri to resolve arguments, and `git grep -ln 'mock_ipc\|MockInvoke\|
// handle_invoke\|ipc::Command' -- apps/tablet-client apps/desktop-client
// ui/src` returns NO files: not one test in this repository crosses the IPC
// boundary. So the `user_id: String` that made five of these commands
// unreachable on a real tablet — rejected by `command.rs:100` before their
// bodies ran, twice in this programme now, settings then terminals — is
// undetectable by any test that exists, and no test in this file will ever
// detect its return. See the argument-shape gate proposed in the plan file.

use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Seed the GLOBAL identity DB with the default roles, an owner, and a cashier
/// on `role-staff` — a role that holds no `terminals:*` grant.
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

/// A Tauri test app with the given (token, user id) sessions, all bound to
/// store `store-terminals`. The tempdir travels with the app because it holds
/// the per-store databases the `StoreDatabaseManager` opens on demand.
fn terminals_app(
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
                "store-terminals".into(),
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

/// The four reads that were the F-017 gap: each must now refuse a cashier.
#[tokio::test]
async fn scoped_terminal_reads_deny_a_session_without_terminals_read() {
    let (app, _temp) = terminals_app(&[("cashier-token", "user-cashier")]);

    let listed = list_terminals_scoped("cashier-token".into(), app.state()).await;
    assert!(
        matches!(listed, Err(AppError::PermissionDenied(_))),
        "the terminal enumeration — device ids and metadata for every \
         terminal in the store — was readable without terminals:read"
    );
    assert!(matches!(
        get_terminal_scoped("cashier-token".into(), "t1".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        ping_terminal_scoped("cashier-token".into(), "t1".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        list_terminal_overrides_scoped("cashier-token".into(), "t1".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
}

/// The writes, whose gates sit on two different permissions. The shapes of the
/// calls are the shapes `ui/src/api/terminals.ts` sends: no `user_id` anywhere,
/// because the session supplies the actor now.
#[tokio::test]
async fn scoped_terminal_writes_deny_a_session_without_their_permission() {
    let (app, _temp) = terminals_app(&[("cashier-token", "user-cashier")]);

    assert!(matches!(
        delete_terminal_scoped("cashier-token".into(), "t1".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        set_terminal_override_scoped(
            "cashier-token".into(),
            "t1".into(),
            "kds".into(),
            true,
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        delete_terminal_override_scoped(
            "cashier-token".into(),
            "t1".into(),
            "kds".into(),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(matches!(
        update_terminal_scoped(
            "cashier-token".into(),
            UpdateTerminalArgs {
                id: "t1".into(),
                name: Some("Renamed".into()),
                device_id: None,
                terminal_secret: None,
                is_active: None,
                metadata: None,
            },
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    // `register_terminal_scoped` is not asserted either way. It calls
    // `sub.verify_signature()?` on the tenant subscription before its gate, and
    // a test-only DB has no signed default tenant, so a refusal here would prove
    // nothing about the gate. What it lost — the required `user_id: String` — is
    // held by the signature itself: this file would not compile against the old
    // parameter list.
}

/// The other half: an owner session gets every one of these past the gate.
///
/// The assertion is deliberately "not a permission refusal" rather than
/// `Ok(..)`. These commands run against a store with no terminals in it, so the
/// bodies are free to answer NotFound, an empty list, or a validation refusal —
/// what is being pinned is that the call reached the body at all, which is the
/// half that the removed `user_id` parameters and the added gates both change.
#[tokio::test]
async fn scoped_terminal_writes_accept_an_owner_session() {
    let (app, _temp) = terminals_app(&[("owner-token", "user-owner")]);

    let listed = list_terminals_scoped("owner-token".into(), app.state())
        .await
        .expect("an owner may enumerate the store's terminals");
    assert!(listed.is_empty(), "fresh store should hold no terminals");

    for label in ["t-missing", "t-other"] {
        let denied = get_terminal_scoped("owner-token".into(), label.into(), app.state()).await;
        assert!(
            !matches!(denied, Err(AppError::PermissionDenied(_))),
            "{label}: the owner was refused by the gate rather than by the store"
        );
    }
    assert!(!matches!(
        ping_terminal_scoped("owner-token".into(), "t-missing".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        list_terminal_overrides_scoped("owner-token".into(), "t-missing".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        set_terminal_override_scoped(
            "owner-token".into(),
            "t-missing".into(),
            "kds".into(),
            true,
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        delete_terminal_override_scoped(
            "owner-token".into(),
            "t-missing".into(),
            "kds".into(),
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        delete_terminal_scoped("owner-token".into(), "t-missing".into(), app.state()).await,
        Err(AppError::PermissionDenied(_))
    ));
    assert!(!matches!(
        update_terminal_scoped(
            "owner-token".into(),
            UpdateTerminalArgs {
                id: "t-missing".into(),
                name: Some("Renamed".into()),
                device_id: None,
                terminal_secret: None,
                is_active: None,
                metadata: None,
            },
            app.state()
        )
        .await,
        Err(AppError::PermissionDenied(_))
    ));
}
