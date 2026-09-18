//! Unit tests for the memo command surface (DTO wire shapes and the
//! 2026-09-07 stop-gate ruling).
//!
//! Relocated from `apps/desktop-tauri/src/commands/memo_tests.rs`
//! (Wave F); the tauri `test_state` mock becomes `TestBridge::with_conn`
//! over the seeded global identity DB.

use super::*;

use crate::testing::TestBridge;

fn memo_dto(location_ids: Vec<String>, published_at: Option<String>) -> MemoDto {
    MemoDto {
        id: "m-1".into(),
        tenant_id: "default".into(),
        location_ids,
        author_user_id: "user-1".into(),
        author_role: "role-manager".into(),
        title: "Heads up".into(),
        body: "Close early".into(),
        status: "published".into(),
        duration: "24h".into(),
        revision: 1,
        published_at: published_at.clone(),
        expires_at: published_at.map(|p| {
            // Not a real expiry computation — just a paired non-null value.
            p.replace("2026-09-06", "2026-09-07")
        }),
        created_at: "2026-09-06T00:00:00.000Z".into(),
    }
}

#[test]
fn memo_dto_uses_camel_case_wire_fields() {
    let dto = memo_dto(
        vec!["loc-1".into(), "loc-2".into()],
        Some("2026-09-06T00:00:00.000Z".into()),
    );
    let json = serde_json::to_value(dto).unwrap();
    assert_eq!(json["tenantId"], "default");
    assert_eq!(
        json["locationIds"],
        serde_json::json!(["loc-1", "loc-2"]),
        "the targeting set rides the wire as a locationIds array"
    );
    assert_eq!(json["authorUserId"], "user-1");
    assert_eq!(json["authorRole"], "role-manager");
    assert_eq!(json["publishedAt"], "2026-09-06T00:00:00.000Z");
    assert_eq!(json["expiresAt"], "2026-09-07T00:00:00.000Z");
    assert_eq!(json["createdAt"], "2026-09-06T00:00:00.000Z");
    assert!(json.get("tenant_id").is_none());
    assert!(json.get("location_id").is_none());
    assert!(json.get("location_ids").is_none());
}

#[test]
fn memo_dto_org_scope_serializes_an_empty_location_ids_array() {
    // The empty set IS the Organization audience — it serializes as an empty
    // array, not null, so the UI never has to distinguish null from [].
    let dto = memo_dto(vec![], None);
    let json = serde_json::to_value(dto).unwrap();
    assert_eq!(json["locationIds"], serde_json::json!([]));
    assert!(json["publishedAt"].is_null());
    assert!(json["expiresAt"].is_null());
}

#[test]
fn active_memo_dto_nests_memo_and_delivery_status() {
    let memo = Memo {
        id: "m-3".into(),
        tenant_id: "default".into(),
        location_ids: vec![],
        author_user_id: "user-1".into(),
        author_role: "role-owner".into(),
        title: "T".into(),
        body: "B".into(),
        status: kasirmu_core::memo::MemoStatus::Published,
        duration: kasirmu_core::memo::MemoDuration::Hours24,
        revision: 1,
        published_at: None,
        expires_at: None,
        stopped_at: None,
        stopped_by: None,
        archived_at: None,
        created_at: "2026-09-06T00:00:00.000Z".into(),
        updated_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let active = ActiveMemo {
        memo,
        delivery_status: kasirmu_core::memo::DeliveryStatus::Pending,
    };
    let json = serde_json::to_value(ActiveMemoDto::from(active)).unwrap();
    assert_eq!(json["deliveryStatus"], "pending");
    assert_eq!(json["memo"]["status"], "published");
    assert_eq!(json["memo"]["duration"], "24h");
}

#[test]
fn memo_display_dto_carries_server_issued_cadence() {
    // The display read must serve the cadence alongside the memos so the UI
    // never hardcodes the intervals: the KDS value is derived as 2 × the base
    // in `kasirmu_core::memo`, and this test pins both the envelope shape and the
    // 2× relationship across the wire.
    let dto = MemoDisplayDto {
        memos: vec![],
        cadence: MemoCadenceDto {
            base_interval_secs: kasirmu_core::memo::NOTIFICATION_BASE_INTERVAL_SECS,
            kds_interval_secs: kasirmu_core::memo::kds_notification_interval_secs(),
        },
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["cadence"]["baseIntervalSecs"], 900);
    assert_eq!(json["cadence"]["kdsIntervalSecs"], 1_800);
    assert_eq!(
        json["cadence"]["kdsIntervalSecs"].as_i64().unwrap(),
        2 * json["cadence"]["baseIntervalSecs"].as_i64().unwrap()
    );
    assert!(json["memos"].is_array());
}

#[test]
fn create_args_deserialize_camel_case_and_optional_fields() {
    // Omitted locationIds ⇒ empty targeting set ⇒ Organization Memo.
    let args: CreateMemoArgs = serde_json::from_value(serde_json::json!({
        "title": "Heads up",
        "body": "Close early tonight",
        "duration": "3d"
    }))
    .unwrap();
    assert_eq!(args.title, "Heads up");
    assert_eq!(args.duration.as_deref(), Some("3d"));
    assert!(args.location_ids.is_empty());

    // One or more locationIds ⇒ a Location memo targeting those locations.
    let located: CreateMemoArgs = serde_json::from_value(serde_json::json!({
        "title": "Heads up",
        "body": "Close early tonight",
        "locationIds": ["loc-1", "loc-2"]
    }))
    .unwrap();
    assert_eq!(
        located.location_ids,
        vec!["loc-1".to_string(), "loc-2".to_string()]
    );
}

#[test]
fn create_args_duration_defaults_to_none_when_absent() {
    // Omitted duration ⇒ None ⇒ the command applies DEFAULT_MEMO_DURATION.
    let args: CreateMemoArgs = serde_json::from_value(serde_json::json!({
        "title": "T",
        "body": "B"
    }))
    .unwrap();
    assert_eq!(args.duration, None);
    assert_eq!(
        kasirmu_core::memo::DEFAULT_MEMO_DURATION,
        kasirmu_core::memo::MemoDuration::Hours24
    );
}

#[test]
fn create_args_rejects_missing_required_fields() {
    // title and body are required (no serde default).
    let missing_body: Result<CreateMemoArgs, _> = serde_json::from_value(serde_json::json!({
        "title": "T"
    }));
    assert!(missing_body.is_err());
}

// ── stop_memo_scoped: the A2 author-or-`memo:stop` gate ────────────
//
// The 2026-09-07 ruling: the AUTHOR may always stop their own memo;
// anyone else must hold `memo:stop` (Owner/Admin presets). These tests
// drive the real command through the global identity DB, so the gate
// evaluated is the same one production uses (roles resolved server-side).
//
// Harness notes: the memo tables live in the GLOBAL identity DB, which is
// exactly the DB `TestBridge::with_conn` hands the command — no
// store-DB isolation is needed (unlike the store-scoped customer
// commands). `SessionContext::new(user_id, role_id, terminal, store,
// instance, type_key, token?, expiry)`; the role_id on the session is
// cosmetic, the gate resolves the user's role row.

use kasirmu_core::session::SessionContext;

/// Seed roles + a fixed-id user with the given role on the identity DB.
fn seed_user(conn: &rusqlite::Connection, user_id: &str, role_id: &str) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES (?1, ?1, 'hash', ?1, ?2, 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        rusqlite::params![user_id, role_id],
    )
    .unwrap();
}

fn session_for(user_id: &str, role_id: &str) -> SessionContext {
    SessionContext::new(
        user_id.into(),
        role_id.into(),
        "term-1".into(),
        "store-a".into(),
        "inst-1".into(),
        "store-pos".into(),
        None,
        0,
    )
}

/// Published memo authored by `user-manager` (the fixed author all stop
/// cases act on).
///
/// Seeds one registered terminal first: publishing refuses a fan-out that
/// resolves zero recipients, and a terminal-less identity DB is exactly the
/// case that refusal exists for. The seeded device is deliberately NOT the
/// device any case logs in as, so a read still has to resolve its own.
fn seed_published_memo(conn: &rusqlite::Connection) -> String {
    seed_terminal(conn, "term-seed-1", "SEEDED-DEVICE");
    let store = Store::new(conn);
    let draft = store
        .create_memo_draft(&kasirmu_core::memo::NewMemo {
            tenant_id: "default".into(),
            location_ids: vec![],
            author_user_id: "user-manager".into(),
            author_role: "role-manager".into(),
            title: "Heads up".into(),
            body: "Close early".into(),
            duration: kasirmu_core::memo::MemoDuration::Hours24,
        })
        .unwrap();
    store.publish_memo("default", &draft.id).unwrap().id
}

#[tokio::test]
async fn author_can_stop_their_own_memo_without_memo_stop() {
    // A manager author holds only `memo:write` — the author short-circuit
    // must let them stop their own memo (the ruling preserves that right).
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions()
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-manager", "role-manager"));
    let dto = stop_memo_scoped(&tb.ctx(), "tok", &memo_id).await.unwrap();
    assert_eq!(dto.status, "stopped");
    assert_eq!(dto.author_user_id, "user-manager");
}

#[tokio::test]
async fn admin_can_stop_another_authors_memo() {
    // `memo:stop` covers stopping anyone's memo (Owner/Admin presets).
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-admin", "role-admin");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions()
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-admin", "role-admin"));
    let dto = stop_memo_scoped(&tb.ctx(), "tok", &memo_id).await.unwrap();
    assert_eq!(dto.status, "stopped");
}

#[tokio::test]
async fn peer_manager_cannot_stop_another_managers_memo() {
    // The property the old strict-> rank rule pinned, now enforced by the
    // grant: a manager holds `memo:write` but NOT `memo:stop`, so stopping
    // another manager's memo denies even though the caller could author.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-peer", "role-manager");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions()
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-peer", "role-manager"));
    let result = stop_memo_scoped(&tb.ctx(), "tok", &memo_id).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_cannot_stop_any_memo_even_their_own_claim_is_checked() {
    // Staff holds neither memo key. Stopping a memo they did not author
    // must deny — and because the denial comes from the permission gate,
    // not the author check, this also proves an unknown/unrelated user
    // cannot ride the author short-circuit.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-staff", "role-staff");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions()
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-staff", "role-staff"));
    let result = stop_memo_scoped(&tb.ctx(), "tok", &memo_id).await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn stop_rejects_invalid_session() {
    let tb = TestBridge::new().with_conn(kasirmu_core::migrations::fresh_db());
    let result = stop_memo_scoped(&tb.ctx(), "missing-token", "memo-1").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

// ── Consumption path: device identity → `terminals.id` ──────────────
//
// A real login session carries the DEVICE identity (`create_session` persists
// whatever `get_device_id()` returned — the hostname), while `terminals.id` is
// a UUID and `memo_recipients.terminal_id` is an enforced foreign key to it.
// `session_for` above hardcodes "term-1" for both roles, which is exactly the
// coincidence that hid the mismatch, so these cases build the session the way
// the login flow does and assert the read and the ack reach the right row.

/// A registered terminal in the shape every real registration produces:
/// UUID row id, hostname device id (`Terminal::new`).
///
/// Idempotent, because `seed_published_memo` seeds one too.
fn seed_terminal(conn: &rusqlite::Connection, id: &str, device: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES (?1, ?1, ?2)
         ON CONFLICT (id) DO NOTHING",
        rusqlite::params![id, device],
    )
    .unwrap();
}

/// A login-shaped session: `terminal_id` is the device identity, not a row id.
fn session_for_device(user_id: &str, role_id: &str, device: &str) -> SessionContext {
    SessionContext::new(
        user_id.into(),
        role_id.into(),
        device.into(),
        "store-a".into(),
        "inst-1".into(),
        "restaurant-pos".into(),
        None,
        0,
    )
}

#[tokio::test]
async fn read_reaches_the_recipient_row_behind_the_session_device() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "term-uuid-1", "RESTAURANT-POS");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", "RESTAURANT-POS"),
    );

    let dto = list_active_memos_scoped(&tb.ctx(), "tok").await.unwrap();

    assert_eq!(
        dto.memos.len(),
        1,
        "the session's hostname must resolve to the terminal row the fan-out wrote"
    );
    assert_eq!(dto.memos[0].memo.id, memo_id);
    assert_eq!(dto.memos[0].delivery_status, "pending");
    assert_eq!(
        dto.cadence.base_interval_secs,
        NOTIFICATION_BASE_INTERVAL_SECS
    );
}

#[tokio::test]
async fn read_of_a_location_memo_resolves_the_same_way() {
    // Location targeting fans out through `memo_locations` → bound terminals,
    // and the read must resolve the device identity for that branch too.
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch("INSERT INTO locations (id, name) VALUES ('loc-1', 'Front')")
        .unwrap();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, bound_location_id)
         VALUES ('term-uuid-1', 'Front POS', 'RESTAURANT-POS', 'loc-1')",
        [],
    )
    .unwrap();
    let memo_id = {
        let store = Store::new(&conn);
        let draft = store
            .create_memo_draft(&NewMemo {
                tenant_id: "default".into(),
                location_ids: vec!["loc-1".into()],
                author_user_id: "user-manager".into(),
                author_role: "role-manager".into(),
                title: "Heads up".into(),
                body: "Close early".into(),
                duration: kasirmu_core::memo::MemoDuration::Hours24,
            })
            .unwrap();
        store.publish_memo("default", &draft.id).unwrap().id
    };
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", "RESTAURANT-POS"),
    );

    let dto = list_active_memos_scoped(&tb.ctx(), "tok").await.unwrap();

    assert_eq!(dto.memos.len(), 1);
    assert_eq!(dto.memos[0].memo.id, memo_id);
}

#[tokio::test]
async fn read_is_empty_not_an_error_for_a_device_without_a_terminal_row() {
    // The memo was delivered to the fixture's seeded terminal; THIS device has
    // no row at all, so nothing is addressed to it — an empty list, and the
    // cadence still served so the banner keeps polling instead of dying on a
    // missing identity.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", "UNREGISTERED-DEVICE"),
    );

    let dto = list_active_memos_scoped(&tb.ctx(), "tok").await.unwrap();

    assert!(dto.memos.is_empty());
    assert_eq!(
        dto.cadence.kds_interval_secs,
        kds_notification_interval_secs()
    );
}

#[tokio::test]
async fn read_is_empty_for_the_empty_device_identity_login_falls_back_to() {
    // `WorkspaceContext` sends `terminal_id: await getDeviceId().catch(() => "")`,
    // so "" is a live input. It must match nothing — never every memo.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "term-uuid-1", "RESTAURANT-POS");
    seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", ""),
    );

    let dto = list_active_memos_scoped(&tb.ctx(), "tok").await.unwrap();

    assert!(dto.memos.is_empty());
}

#[tokio::test]
async fn ack_writes_the_recipient_row_behind_the_session_device() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "term-uuid-1", "RESTAURANT-POS");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", "RESTAURANT-POS"),
    );
    let ctx = tb.ctx();

    acknowledge_memo_scoped(&ctx, "tok", &memo_id)
        .await
        .unwrap();

    let db = ctx.lock_global().await;
    let (terminal_id, status, acknowledged_by): (String, String, Option<String>) = db
        .query_row(
            "SELECT terminal_id, delivery_status, acknowledged_by
             FROM memo_recipients WHERE memo_id = ?1 AND terminal_id = 'term-uuid-1'",
            rusqlite::params![&memo_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        terminal_id, "term-uuid-1",
        "the ack must key the row id, not the hostname"
    );
    assert_eq!(status, "acknowledged");
    assert_eq!(acknowledged_by.as_deref(), Some("user-staff"));
    // And only that recipient: the fan-out's other row is untouched, so an ack
    // can never clear a memo for a terminal that never read it.
    let other: String = db
        .query_row(
            "SELECT delivery_status FROM memo_recipients
             WHERE memo_id = ?1 AND terminal_id = 'term-seed-1'",
            rusqlite::params![&memo_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        other, "pending",
        "an ack is per recipient, never a broadcast"
    );
}

// ── End to end: a terminal registered in the STORE db ────────────────
//
// Registration has two homes and only one of them is addressable by the memo
// tables. `register_terminal_scoped` (Settings → Terminals per-store) writes the
// row into `store-<store_id>.sqlite`, while the memo tables live in the global
// identity DB, where `memo_recipients.terminal_id` carries an enforced FK to ITS
// `terminals(id)`. The published fan-out used to read only the global table, so
// on such an installation it resolved zero recipients and reported the success
// of a memo no terminal could receive. These cases drive the real commands on
// both sides of that split for every store whose terminals the publish touches.

use crate::terminals::{RegisterTerminalArgs, register_terminal_scoped};

#[tokio::test]
async fn publish_reaches_a_terminal_registered_through_the_store_db() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-staff", "role-staff");
    let tb = TestBridge::new().with_conn(conn);
    // Both sides log into `store-a` (the store `session_for_device` names), and
    // the reader carries the DEVICE identity the renderer sends, exactly as in
    // the resolution cases above.
    tb.sessions().write().unwrap().insert(
        "author-tok".into(),
        session_for_device("user-manager", "role-manager", "DESKTOP-AUTHOR"),
    );

    // The real registration command: writes into the STORE database.
    let registered = register_terminal_scoped(
        &tb.ctx(),
        "author-tok",
        RegisterTerminalArgs {
            name: "Front POS".into(),
            device_id: "RESTAURANT-POS".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await;
    // Release: the seeded subscription row this command validates does not
    // verify, so no terminal is registered and the delivery half below would
    // have nothing to test — assert the refusal rather than the outcome.
    if !crate::testing::seeded_row_loads() {
        crate::testing::assert_refused_by_the_seeded_row(&tb, registered, "free").await;
        return;
    }
    let registered = registered.expect("a manager holds `terminals:register`");

    // The premise of this case: the row is NOT in the global identity DB, so a
    // fan-out that reads only this table cannot see it.
    {
        let db = tb.ctx().lock_global().await;
        let global_terminals: i64 = db
            .query_row("SELECT COUNT(*) FROM terminals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            global_terminals, 0,
            "`register_terminal_scoped` must write the store db, or this case proves nothing"
        );
    }

    let memo_id = publish_org_memo(&tb, "author-tok").await;

    // The recipient row the fan-out had to be able to write: the STORE
    // terminal's row id, mirrored into the global table the FK points at.
    {
        let db = tb.ctx().lock_global().await;
        let recipient: String = db
            .query_row(
                "SELECT terminal_id FROM memo_recipients WHERE memo_id = ?1",
                rusqlite::params![&memo_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            recipient, registered.id,
            "the recipient must key the store-registered terminal's row id"
        );
    }

    // And the banner's read, on the recipient's own login.
    tb.sessions().write().unwrap().insert(
        "reader-tok".into(),
        session_for_device("user-staff", "role-staff", "RESTAURANT-POS"),
    );
    let dto = list_active_memos_scoped(&tb.ctx(), "reader-tok")
        .await
        .unwrap();
    assert_eq!(
        dto.memos.len(),
        1,
        "a memo published on this store must reach the terminal registered in it"
    );
    assert_eq!(dto.memos[0].memo.id, memo_id);
}

#[tokio::test]
async fn publish_reaches_terminals_from_both_registration_homes() {
    // The production shape: this device was auto-registered in the global
    // identity db by `set_features` (MultiTerminal), while the other POS was
    // registered through Settings → Terminals into the per-store db. A publish
    // must address both, each by its own row id.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-staff", "role-staff");
    let auto = Terminal::new("DESKTOP-AUTHOR (auto)", "DESKTOP-AUTHOR");
    Store::new(&conn).create_terminal(&auto).unwrap();
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "author-tok".into(),
        session_for_device("user-manager", "role-manager", "DESKTOP-AUTHOR"),
    );

    let registered = register_terminal_scoped(
        &tb.ctx(),
        "author-tok",
        RegisterTerminalArgs {
            name: "Front POS".into(),
            device_id: "RESTAURANT-POS".into(),
            terminal_secret: None,
            metadata: None,
        },
    )
    .await;
    // Release: the seeded subscription row does not verify, so the second
    // home is never registered (see the case above for the full reason).
    if !crate::testing::seeded_row_loads() {
        crate::testing::assert_refused_by_the_seeded_row(&tb, registered, "free").await;
        return;
    }
    let registered = registered.expect("a manager holds `terminals:register`");

    let memo_id = publish_org_memo(&tb, "author-tok").await;

    let recipients: Vec<String> = {
        let db = tb.ctx().lock_global().await;
        let mut stmt = db
            .prepare(
                "SELECT terminal_id FROM memo_recipients WHERE memo_id = ?1 ORDER BY terminal_id",
            )
            .unwrap();
        let rows = stmt
            .query_map(rusqlite::params![&memo_id], |r| r.get::<_, String>(0))
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    };
    let mut expected = vec![auto.id.clone(), registered.id.clone()];
    expected.sort();
    assert_eq!(
        recipients, expected,
        "one recipient per registered terminal, whichever home registered it"
    );

    // And each device's own read finds it, on the same two identities.
    for (token, device) in [
        ("auto-tok", "DESKTOP-AUTHOR"),
        ("reader-tok", "RESTAURANT-POS"),
    ] {
        tb.sessions().write().unwrap().insert(
            token.into(),
            session_for_device("user-staff", "role-staff", device),
        );
        let dto = list_active_memos_scoped(&tb.ctx(), token).await.unwrap();
        assert_eq!(
            dto.memos.len(),
            1,
            "{device} must see the memo it was made a recipient for"
        );
        assert_eq!(dto.memos[0].memo.id, memo_id);
    }
}

#[tokio::test]
async fn publish_refuses_when_no_terminal_can_receive() {
    // A terminal-less identity DB is not hypothetical: it is what a fresh
    // installation looks like before Settings → Terminals has registered
    // anything, and it is where the old silent success lived. The refusal must
    // be a failure the author can act on, and the draft must survive it.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "author-tok".into(),
        session_for_device("user-manager", "role-manager", "DESKTOP-AUTHOR"),
    );
    let draft = create_memo_scoped(
        &tb.ctx(),
        "author-tok",
        CreateMemoArgs {
            location_ids: vec![],
            title: "Heads up".into(),
            body: "Close early".into(),
            duration: None,
        },
    )
    .await
    .expect("a manager holds `memo:write`");

    let result = publish_memo_scoped(&tb.ctx(), "author-tok", &draft.id).await;

    match result {
        Err(BridgeError::Core {
            sub_kind: kasirmu_core::CoreErrorKind::Validation,
            message,
        }) => assert!(
            message.contains("terminal"),
            "the refusal must name what is missing, got: {message}"
        ),
        other => panic!("expected the zero-recipient refusal, got {other:?}"),
    }
    let db = tb.ctx().lock_global().await;
    let status: String = db
        .query_row(
            "SELECT status FROM memos WHERE id = ?1",
            rusqlite::params![&draft.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "draft",
        "a refused publish must roll back to the draft the author can fix"
    );
}

/// Create and publish an Organization Memo through the real commands,
/// returning the memo id.
async fn publish_org_memo(tb: &TestBridge, token: &str) -> String {
    let draft = create_memo_scoped(
        &tb.ctx(),
        token,
        CreateMemoArgs {
            location_ids: vec![],
            title: "Heads up".into(),
            body: "Close early".into(),
            duration: None,
        },
    )
    .await
    .expect("a manager holds `memo:write`");
    publish_memo_scoped(&tb.ctx(), token, &draft.id)
        .await
        .expect("a store with a registered terminal has a recipient")
        .id
}

#[tokio::test]
async fn ack_without_a_terminal_row_is_a_typed_failure_not_a_silent_ok() {
    // The caller drops the memo from view optimistically and swallows the
    // error, so a success here would hide an ack that never landed.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "term-uuid-1", "RESTAURANT-POS");
    let memo_id = seed_published_memo(&conn);
    let tb = TestBridge::new().with_conn(conn);
    tb.sessions().write().unwrap().insert(
        "tok".into(),
        session_for_device("user-staff", "role-staff", "UNREGISTERED-DEVICE"),
    );

    let result = acknowledge_memo_scoped(&tb.ctx(), "tok", &memo_id).await;

    assert!(
        matches!(
            result,
            Err(BridgeError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::NotFound,
                ..
            })
        ),
        "expected an unknown-recipient NotFound, got {result:?}"
    );
}
