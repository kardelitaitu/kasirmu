//! Unit tests for the terminal command bodies (Wave-F test relocation:
//! moved out of `apps/desktop-tauri/src/commands/terminals_tests.rs`).
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
use crate::testing::{assert_refused_by_the_seeded_row, seeded_row_loads};

use kasirmu_core::session::SessionContext;
use kasirmu_security::Keyring;
use rusqlite::Connection;

fn fresh_conn() -> Connection {
    temp_conn()
}

// ── Device-binding HMAC: constant-time verification ──────────────────

/// A forged binding signature must be refused, and a genuine one accepted.
///
/// `verify_binding` used to re-sign and compare the two hex strings, which
/// short-circuits on the first differing byte. The verdict is not internal —
/// it surfaces to the operator as `DeviceBindingDto::signature_valid` — so a
/// caller who can read that flag gets a byte-at-a-time oracle for free. The
/// pair below is the behavioural contract: it fails if the comparison ever
/// becomes "sign and `==`" again in the direction that matters (a near-miss
/// forgery must NOT be accepted).
#[test]
fn verify_binding_accepts_the_real_signature_and_refuses_a_forgery() {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    let signature = sign_binding(&keyring, "term-1", "store-a", "ws-a-1").unwrap();

    assert!(
        verify_binding(&keyring, "term-1", "store-a", "ws-a-1", &signature).unwrap(),
        "the signature we just minted must verify"
    );

    // Every byte position of a near-miss forgery: the LAST character differs,
    // then the FIRST — the two ends the short-circuit treated most and least
    // cheaply. All must be refused.
    for pos in [0usize, 1, signature.len() / 2, signature.len() - 1] {
        let mut forged = signature.clone().into_bytes();
        forged[pos] = if forged[pos] == b'0' { b'1' } else { b'0' };
        let forged = String::from_utf8(forged).unwrap();
        assert_ne!(forged, signature);
        assert!(
            !verify_binding(&keyring, "term-1", "store-a", "ws-a-1", &forged).unwrap(),
            "a forgery differing at byte {pos} must be refused"
        );
    }

    // A signature for a DIFFERENT binding must not verify against this one.
    let other = sign_binding(&keyring, "term-1", "store-b", "ws-b-1").unwrap();
    assert!(
        !verify_binding(&keyring, "term-1", "store-a", "ws-a-1", &other).unwrap(),
        "a signature bound to another store/instance must be refused"
    );

    // Malformed input is a refusal, never an error and never an accept.
    assert!(!verify_binding(&keyring, "term-1", "store-a", "ws-a-1", "not-hex").unwrap());
    assert!(!verify_binding(&keyring, "term-1", "store-a", "ws-a-1", "").unwrap());
}

/// With no secret in the keyring, nothing can verify — and the check must not
/// CREATE one. `verify_binding` is called from the diagnostic DTO builder, so a
/// read that minted a secret would make a probe mutate the device.
#[test]
fn verify_binding_refuses_when_no_secret_exists_and_stores_nothing() {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    assert!(!verify_binding(&keyring, "term-1", "store-a", "ws-a-1", "00").unwrap());
    assert_eq!(
        keyring.get_secret(DEVICE_BINDING_KEYRING_NAME).unwrap(),
        None,
        "verification must not mint the secret it failed to find"
    );
}

/// The device-binding verifier must compare in CONSTANT TIME.
///
/// A SOURCE pin, not a behavioural one, and that is the whole point: the
/// naive `expected == signature` this replaced was not a *logic* bug — it
/// accepted and rejected exactly the same inputs, so no black-box test can
/// tell the two apart. What it leaked was TIME: string equality returns at
/// the first differing byte, so a forger learns how many leading characters
/// were already right. The pair in
/// `verify_binding_accepts_the_real_signature_and_refuses_a_forgery` passes
/// against BOTH implementations — verified by running it that way — so it
/// guards the contract while this guards the property.
///
/// `Mac::verify_slice` is the answer already carrying the sibling site
/// (`workspaces::verify_binding_hmac`, whose doc records the same repair).
/// Written as a source scan because a timing oracle is not observable from a
/// unit test.
#[test]
fn verify_binding_compares_in_constant_time() {
    let src = include_str!("terminals.rs");
    let start = src
        .find("fn verify_binding(")
        .expect("verify_binding must exist");
    let body = &src[start..];
    let end = body.find("\n}").expect("verify_binding must have a body");
    let body = &body[..end];

    // A FLOOR, load-bearing here rather than decorative: the two expects above
    // prove the MARKER was found, not that the extracted region is the function.
    // A body sliced short - an earlier `\n}` closing a nested block, a reordered
    // signature - satisfies both while containing none of the code under test, and
    // every assertion below would then pass by inspecting nothing. Same failure
    // mode the sibling scans in `pos_tests.rs` and `data_tests.rs` now guard too.
    assert!(
        body.len() > 200,
        "extracted only {} bytes for verify_binding, which cannot be the whole function - the scan is reading a region that no longer holds it",
        body.len()
    );
    assert!(
        body.contains("keyring"),
        "the extracted region does not look like the verifier body: {body}"
    );

    assert!(
        body.contains("verify_slice"),
        "verify_binding must use Mac::verify_slice (constant-time); a string
         comparison short-circuits and leaks the mismatch position: {body}"
    );
    for bad in ["== signature", "signature ==", "== hex::encode"] {
        assert!(
            !body.contains(bad),
            "verify_binding has a short-circuiting comparison ({bad}): {body}"
        );
    }
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
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the owner permission is what answers
    // below in both and the is_ok assert runs in both. This arm is reached only
    // when the row exists but does not verify - then the refusal is the
    // signature gate one step earlier, not a failure of the owner permission
    // this fixture is about, so the is_ok assert below is not the same answer.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, result, "free").await;
        return;
    }
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
    .await;
    // Broken-seed fallback, not a profile fork: since 19-09-26 the seeded Free
    // row verifies in BOTH profiles, so the terminal is registered below in both
    // and the get-by-id half runs in both. This arm is reached only when the row
    // exists but does not verify - then no terminal was ever registered and the
    // fetch below has no id to look up.
    if !seeded_row_loads() {
        assert_refused_by_the_seeded_row(&tb, registered, "free").await;
        return;
    }
    let registered = registered.unwrap();

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

// ── Device binding ownership: boot reads the GLOBAL identity DB ──────

/// An in-memory keyring pre-seeded with a fixed secret, so a signature minted
/// with one can be verified with another seeded the same way.
fn seeded_keyring() -> kasirmu_security::InMemoryKeyring {
    let keyring = kasirmu_security::InMemoryKeyring::new();
    keyring
        .set_secret(DEVICE_BINDING_KEYRING_NAME, "test-binding-secret")
        .unwrap();
    keyring
}

/// A saved device binding must land where `resolve_boot_store` reads it: the
/// GLOBAL identity DB row chosen by `get_terminal_by_device_id`. The bridge
/// binding commands used `ctx.resolve_store` (the per-store db), so a binding
/// the operator saved was written where the boot resolver never looks — it
/// silently booted into the primary store while Settings reported the binding
/// as set. Mobile already wrote the global db, and boot (which has no session)
/// can only read the global db, so the write side was the outlier.
#[tokio::test]
async fn device_binding_is_written_to_the_global_db_boot_reads() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");

    // A terminal as Settings → Terminals registers it: in the session's STORE db.
    // The store db carries its own `locations` row (the FK target for any
    // binding written there), matching a real store whose profile exists.
    let source = {
        let store_conn = tb.db_manager().open_store("s1").unwrap();
        let db = store_conn.lock().unwrap();
        db.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('default', 'Default', '', '', 'USD', 'UTC', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        let terminal = Terminal::new("POS-1", "dev-001");
        Store::new(&db).create_terminal(&terminal).unwrap();
        drop(db);
        terminal
    };

    set_test_binding_keyring(Box::new(seeded_keyring()));

    let ctx = tb.ctx();
    set_device_binding_scoped(
        &ctx,
        "tok",
        SetDeviceBindingArgs {
            terminal_id: source.id.clone(),
            bound_store_id: "default".into(),
            bound_instance_id: "inst-1".into(),
        },
    )
    .await
    .expect("owner may bind a terminal");

    // RED (pre-fix): the binding sat in the store db, so the global row the
    // boot resolver picks did not even exist. GREEN: it carries the binding.
    let global = ctx.lock_global().await;
    let store = Store::new(&global);
    let boot_row = store
        .get_terminal_by_device_id("dev-001")
        .unwrap()
        .expect("the device's global terminal row must exist after binding");
    let (bound_store, bound_instance, signature) = store
        .get_terminal_binding(&boot_row.id)
        .unwrap()
        .expect("the global row must carry the binding boot reads");
    assert_eq!(bound_store, "default");
    assert_eq!(bound_instance, "inst-1");
    assert!(
        verify_binding(
            &seeded_keyring(),
            &boot_row.id,
            "default",
            "inst-1",
            &signature
        )
        .unwrap(),
        "the signature must be minted over the GLOBAL row id the boot verifier hashes"
    );
}

/// The legitimate round-trip survives the ownership fix: binding, reading it
/// back through `get_device_binding_scoped`, and clearing all agree on the one
/// global row — and the read-back signature still verifies.
#[tokio::test]
async fn device_binding_round_trips_and_clears_on_the_global_row() {
    let conn = temp_conn();
    seed_owner(&conn);
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let source = {
        let store_conn = tb.db_manager().open_store("s1").unwrap();
        let db = store_conn.lock().unwrap();
        db.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('default', 'Default', '', '', 'USD', 'UTC', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        let terminal = Terminal::new("POS-2", "dev-002");
        Store::new(&db).create_terminal(&terminal).unwrap();
        drop(db);
        terminal
    };
    let ctx = tb.ctx();

    set_test_binding_keyring(Box::new(seeded_keyring()));
    set_device_binding_scoped(
        &ctx,
        "tok",
        SetDeviceBindingArgs {
            terminal_id: source.id.clone(),
            bound_store_id: "default".into(),
            bound_instance_id: "inst-1".into(),
        },
    )
    .await
    .expect("owner may bind a terminal");

    set_test_binding_keyring(Box::new(seeded_keyring()));
    let bound = get_device_binding_scoped(&ctx, "tok", source.id.clone())
        .await
        .expect("binding read-back");
    assert!(bound.bounded);
    assert_eq!(bound.bound_store_id.as_deref(), Some("default"));
    assert_eq!(bound.bound_instance_id.as_deref(), Some("inst-1"));
    assert!(
        bound.signature_valid,
        "the round-tripped binding must still verify against the same secret"
    );

    clear_device_binding_scoped(&ctx, "tok", source.id.clone())
        .await
        .expect("owner may clear a binding");
    let cleared = get_device_binding_scoped(&ctx, "tok", source.id.clone())
        .await
        .expect("read-back after clear");
    assert!(!cleared.bounded, "a cleared binding must read as unbound");
}

// ── Bridge write → bridge boot round-trip ─────────────────────────────

use crate::workspaces::resolve_boot_store;

/// A bridge whose GLOBAL db has the owner plus the `s1` location the mirrored
/// terminal's FK needs, and whose store db `s1` holds a device terminal and the
/// workspace instance a binding points at. Returns the bridge and that terminal.
fn bindable_device() -> (TestBridge, Terminal) {
    let conn = temp_conn();
    seed_owner(&conn);
    conn.execute(
        "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
         VALUES ('s1', 'Store 1', '', '', 'USD', 'UTC', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let tb = scoped_bridge(conn, "tok", "user-owner", "role-owner", "s1");
    let terminal = {
        let store_conn = tb.db_manager().open_store("s1").unwrap();
        let db = store_conn.lock().unwrap();
        db.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('s1', 'Store 1', '', '', 'USD', 'UTC', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
        let store = Store::new(&db);
        let terminal = Terminal::new("POS-1", "dev-001");
        store.create_terminal(&terminal).unwrap();
        store
            .create_workspace_instance("ws-a-1", "store-pos", "s1", "POS", "", None)
            .unwrap();
        drop(db);
        terminal
    };
    (tb, terminal)
}

/// End to end on the desktop path: the row `set_device_binding_scoped` writes
/// is the row `resolve_boot_store` reads. The two ownership fixes (bridge
/// 9993d57c3, mobile 7533b58f7) each only proved one half; this drives BOTH real
/// bridge surfaces with one in-memory keyring and asserts the device actually
/// boots into the bound store/instance instead of falling back to primary.
#[tokio::test]
async fn bridge_device_binding_round_trips_through_boot_resolution() {
    let (tb, source) = bindable_device();
    let ctx = tb.ctx();

    set_test_binding_keyring(Box::new(seeded_keyring()));
    set_device_binding_scoped(
        &ctx,
        "tok",
        SetDeviceBindingArgs {
            terminal_id: source.id.clone(),
            bound_store_id: "s1".into(),
            bound_instance_id: "ws-a-1".into(),
        },
    )
    .await
    .expect("owner may bind a terminal");

    set_test_binding_keyring(Box::new(seeded_keyring()));
    let resolution = resolve_boot_store(&ctx, Some("dev-001".into()))
        .await
        .expect("a valid binding must resolve");
    assert!(
        resolution.is_bound,
        "the binding written must be the binding honored: {resolution:?}"
    );
    assert_eq!(resolution.store_id, "s1");
    assert_eq!(resolution.instance_id.as_deref(), Some("ws-a-1"));
}

/// A binding signed with one secret must NOT boot bound under another — the
/// tamper/wrong-key refusal is what makes the round-trip meaningful. It falls
/// back to the primary store instead.
#[tokio::test]
async fn bridge_device_binding_with_another_keyring_falls_back_to_primary() {
    let (tb, source) = bindable_device();
    let ctx = tb.ctx();

    set_test_binding_keyring(Box::new(seeded_keyring()));
    set_device_binding_scoped(
        &ctx,
        "tok",
        SetDeviceBindingArgs {
            terminal_id: source.id.clone(),
            bound_store_id: "s1".into(),
            bound_instance_id: "ws-a-1".into(),
        },
    )
    .await
    .expect("owner may bind a terminal");

    let other = kasirmu_security::InMemoryKeyring::new();
    other
        .set_secret(DEVICE_BINDING_KEYRING_NAME, "another-secret")
        .unwrap();
    set_test_binding_keyring(Box::new(other));

    let resolution = resolve_boot_store(&ctx, Some("dev-001".into()))
        .await
        .expect("resolution must not error on a wrong-key binding");
    assert!(
        !resolution.is_bound,
        "a wrong-key signature must not boot bound: {resolution:?}"
    );
    assert_eq!(resolution.store_id, "default");
}
