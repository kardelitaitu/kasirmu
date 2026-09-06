use super::*;

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
        status: oz_core::memo::MemoStatus::Published,
        duration: oz_core::memo::MemoDuration::Hours24,
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
        delivery_status: oz_core::memo::DeliveryStatus::Pending,
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
    // in `oz_core::memo`, and this test pins both the envelope shape and the
    // 2× relationship across the wire.
    let dto = MemoDisplayDto {
        memos: vec![],
        cadence: MemoCadenceDto {
            base_interval_secs: oz_core::memo::NOTIFICATION_BASE_INTERVAL_SECS,
            kds_interval_secs: oz_core::memo::kds_notification_interval_secs(),
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
        oz_core::memo::DEFAULT_MEMO_DURATION,
        oz_core::memo::MemoDuration::Hours24
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
// exactly the DB `AppState::for_test_with_conn` hands the command — no
// store-DB isolation is needed (unlike the store-scoped customer
// commands). `SessionContext::new(user_id, role_id, terminal, store,
// instance, type_key, token?, expiry)`; the role_id on the session is
// cosmetic, the gate resolves the user's role row.

use oz_core::session::SessionContext;
use tauri::Manager as _;

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
fn seed_published_memo(conn: &rusqlite::Connection) -> String {
    let store = Store::new(conn);
    let draft = store
        .create_memo_draft(&oz_core::memo::NewMemo {
            tenant_id: "default".into(),
            location_ids: vec![],
            author_user_id: "user-manager".into(),
            author_role: "role-manager".into(),
            title: "Heads up".into(),
            body: "Close early".into(),
            duration: oz_core::memo::MemoDuration::Hours24,
        })
        .unwrap();
    store.publish_memo("default", &draft.id).unwrap().id
}

fn test_state(conn: rusqlite::Connection) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap()
}

#[tokio::test]
async fn author_can_stop_their_own_memo_without_memo_stop() {
    // A manager author holds only `memo:write` — the author short-circuit
    // must let them stop their own memo (the ruling preserves that right).
    let conn = oz_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    let memo_id = seed_published_memo(&conn);
    let app = test_state(conn);
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-manager", "role-manager"));
    let dto = stop_memo_scoped(memo_id, "tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(dto.status, "stopped");
    assert_eq!(dto.author_user_id, "user-manager");
}

#[tokio::test]
async fn admin_can_stop_another_authors_memo() {
    // `memo:stop` covers stopping anyone's memo (Owner/Admin presets).
    let conn = oz_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-admin", "role-admin");
    let memo_id = seed_published_memo(&conn);
    let app = test_state(conn);
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-admin", "role-admin"));
    let dto = stop_memo_scoped(memo_id, "tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(dto.status, "stopped");
}

#[tokio::test]
async fn peer_manager_cannot_stop_another_managers_memo() {
    // The property the old strict-> rank rule pinned, now enforced by the
    // grant: a manager holds `memo:write` but NOT `memo:stop`, so stopping
    // another manager's memo denies even though the caller could author.
    let conn = oz_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-peer", "role-manager");
    let memo_id = seed_published_memo(&conn);
    let app = test_state(conn);
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-peer", "role-manager"));
    let result = stop_memo_scoped(memo_id, "tok".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn staff_cannot_stop_any_memo_even_their_own_claim_is_checked() {
    // Staff holds neither memo key. Stopping a memo they did not author
    // must deny — and because the denial comes from the permission gate,
    // not the author check, this also proves an unknown/unrelated user
    // cannot ride the author short-circuit.
    let conn = oz_core::migrations::fresh_db();
    seed_user(&conn, "user-manager", "role-manager");
    seed_user(&conn, "user-staff", "role-staff");
    let memo_id = seed_published_memo(&conn);
    let app = test_state(conn);
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), session_for("user-staff", "role-staff"));
    let result = stop_memo_scoped(memo_id, "tok".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[tokio::test]
async fn stop_rejects_invalid_session() {
    let app = test_state(oz_core::migrations::fresh_db());
    let result = stop_memo_scoped("memo-1".into(), "missing-token".into(), app.state()).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}
