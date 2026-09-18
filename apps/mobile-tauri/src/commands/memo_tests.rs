use super::*;
use kasirmu_core::memo::{ActiveMemo, Memo};
use kasirmu_core::session::SessionContext;
use tauri::Manager as _;

#[test]
fn active_memo_dto_nests_memo_and_delivery_status() {
    let memo = Memo {
        id: "m-1".into(),
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
    assert_eq!(json["memo"]["authorRole"], "role-owner");
    assert!(json["memo"].get("author_role").is_none());
}

#[test]
fn memo_display_dto_carries_server_issued_cadence() {
    // The display read serves the cadence alongside the memos so the UI never
    // hardcodes the intervals: the KDS value is derived as 2 × the base in
    // `kasirmu_core::memo`, and this test pins both the envelope shape and the 2×
    // relationship across the wire.
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
fn memo_dto_org_scope_serializes_location_id_null() {
    let memo = Memo {
        id: "m-2".into(),
        tenant_id: "default".into(),
        location_ids: vec![],
        author_user_id: "user-1".into(),
        author_role: "role-manager".into(),
        title: "Org".into(),
        body: "All terminals".into(),
        status: kasirmu_core::memo::MemoStatus::Published,
        duration: kasirmu_core::memo::MemoDuration::Days3,
        revision: 2,
        published_at: Some("2026-09-06T00:00:00.000Z".into()),
        expires_at: Some("2026-09-09T00:00:00.000Z".into()),
        stopped_at: None,
        stopped_by: None,
        archived_at: None,
        created_at: "2026-09-06T00:00:00.000Z".into(),
        updated_at: "2026-09-06T00:00:00.000Z".into(),
    };
    let json = serde_json::to_value(MemoDto::from(memo)).unwrap();
    assert_eq!(
        json["locationIds"],
        serde_json::json!([]),
        "the Organization audience serializes as an empty targeting array"
    );
    assert_eq!(json["duration"], "3d");
    assert_eq!(json["revision"], 2);
    assert_eq!(json["expiresAt"], "2026-09-09T00:00:00.000Z");
}

// ── Cloud-first read (2026-09-07 cloud-read ruling) ────────────────

/// A cloud `ActiveMemoPg` body as the wire actually carries it —
/// snake_case, because `kasirmu_api::pg::ActiveMemoPg` carries no serde
/// rename. Decoding this shape is the tablet's entire mapping contract.
fn cloud_wire_json() -> serde_json::Value {
    serde_json::json!({
        "memos": [{
            "id": "m-cloud-1",
            "location_ids": ["loc-9"],
            "author_user_id": "user-manager",
            "author_role": "role-manager",
            "title": "Heads up",
            "body": "Close early",
            "duration": "24h",
            "revision": 1,
            "published_at": "2026-09-07T08:00:00.000Z",
            "expires_at": "2026-09-08T08:00:00.000Z",
            "created_at": "2026-09-07T07:00:00.000Z",
            "delivery_status": "pending"
        }],
        "cadence": { "base_interval_secs": 900, "kds_interval_secs": 1800 }
    })
}

#[test]
fn cloud_wire_shape_decodes_into_display_dto() {
    let response: kasirmu_core::sync_client::ActiveMemosCloudResponse =
        serde_json::from_value(cloud_wire_json()).unwrap();
    let dto = MemoDisplayDto {
        memos: response
            .memos
            .into_iter()
            .map(ActiveMemoDto::from)
            .collect(),
        cadence: MemoCadenceDto {
            base_interval_secs: response.cadence.base_interval_secs,
            kds_interval_secs: response.cadence.kds_interval_secs,
        },
    };
    let json = serde_json::to_value(&dto).unwrap();

    // The banner consumes one DTO shape on every surface, so the mapped
    // cloud read must be indistinguishable from a local read: camelCase
    // out, invariants filled (status `published`, tenant `default`), and
    // the server-issued cadence passed through untouched.
    let memo = &json["memos"][0]["memo"];
    assert_eq!(memo["id"], "m-cloud-1");
    assert_eq!(memo["locationIds"], serde_json::json!(["loc-9"]));
    assert_eq!(memo["authorUserId"], "user-manager");
    assert_eq!(memo["status"], "published");
    assert_eq!(memo["tenantId"], "default");
    assert_eq!(memo["createdAt"], "2026-09-07T07:00:00.000Z");
    assert_eq!(json["memos"][0]["deliveryStatus"], "pending");
    assert_eq!(json["cadence"]["baseIntervalSecs"], 900);
    assert_eq!(json["cadence"]["kdsIntervalSecs"], 1_800);
}

/// A terminal row for the fan-out (tenant defaults to `default`).
///
/// Idempotent, because `seed_published_memo` seeds one too.
fn seed_terminal(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES (?1, ?1, ?2)
         ON CONFLICT (id) DO NOTHING",
        rusqlite::params![id, format!("dev-{id}")],
    )
    .unwrap();
}

/// One published Organization Memo authored on the (seeded) desktop side.
///
/// Seeds a terminal first: publishing refuses a fan-out that resolves zero
/// recipients, and the terminal-less identity DB is the case that refusal
/// exists for. The seeded device is not the one any case logs in as.
fn seed_published_memo(conn: &rusqlite::Connection) -> String {
    seed_terminal(conn, "term-seed-1");
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

fn tablet_session(terminal_id: &str) -> SessionContext {
    SessionContext::new(
        "user-staff".into(),
        "role-staff".into(),
        terminal_id.into(),
        "store-a".into(),
        "inst-1".into(),
        "store-pos".into(),
        None,
        0,
    )
}

#[tokio::test]
async fn local_read_serves_seeded_memo_when_sync_unconfigured() {
    // Sync is unconfigured (`SyncConfig::from_settings` → None), so the
    // command skips the cloud entirely and the local read applies — the
    // pre-cloud behaviour, preserved as the fallback.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    let memo_id = seed_published_memo(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("terminal-1"));

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(dto.memos.len(), 1);
    assert_eq!(dto.memos[0].memo.id, memo_id);
    assert_eq!(dto.memos[0].delivery_status, "pending");
    assert_eq!(dto.cadence.base_interval_secs, 900);
}

#[tokio::test]
async fn falls_back_to_local_read_when_cloud_unreachable() {
    // Sync is configured but the server refuses connections (port 1 — the
    // repo's standard unreachable endpoint), so the cloud fetch fails and
    // the command must degrade to the local read rather than error out:
    // a network outage must never break memo display entirely.
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    seed_published_memo(&conn);
    {
        kasirmu_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&conn, "http://127.0.0.1:1").unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
    }
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("terminal-1"));

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(dto.memos.len(), 1, "the local memo is still served");
    assert_eq!(dto.memos[0].delivery_status, "pending");
}

// ── Acknowledgement upstream (2026-09-07 cloud-read ruling) ────────

#[tokio::test]
async fn ack_goes_to_the_cloud_and_carries_the_wire_contract() {
    // Sync is configured and the "cloud" is a local TCP listener that
    // captures the request and answers the ack contract — pinning the
    // wire: POST /api/v1/memos/{id}/ack, Bearer token, acknowledged_by
    // body, MemoAckCloud JSON response.
    use std::sync::Arc as StdArc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let captured: StdArc<tokio::sync::Mutex<Option<String>>> =
        StdArc::new(tokio::sync::Mutex::new(None));
    let captured_server = captured.clone();
    let task = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let n = socket.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
        *captured_server.lock().await = Some(request);
        // Snake_case: the server's MemoAckResult has no serde rename, so
        // its wire body is snake_case — the same shape MemoAckCloud parses.
        let body = r#"{"memo_id":"m-1","terminal_id":"terminal-1","delivery_status":"acknowledged","acknowledged_at":"2026-09-07T09:00:00.000Z","changed":true}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });

    let conn = kasirmu_core::migrations::fresh_db();
    kasirmu_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
    kasirmu_core::settings::Settings::set_sync_server_url(&conn, &server_url).unwrap();
    kasirmu_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("terminal-1"));

    acknowledge_memo_scoped("m-1".into(), "tok".into(), app.state())
        .await
        .expect("cloud ack must succeed");
    task.await.unwrap();

    let request = captured.lock().await.clone().unwrap();
    assert!(request.starts_with("POST /api/v1/memos/m-1/ack "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer jwt-test"),
        "ack request did not carry the bearer token: {request}"
    );
    assert!(
        request.contains("acknowledged_by"),
        "ack request did not carry the acking user: {request}"
    );
}

// ── Device identity → `terminals.id` (the login-shaped session) ─────
//
// `seed_terminal` writes a UUID row id and a `dev-<id>` device id, and
// `tablet_session` above takes whichever value it is handed. A real login
// session carries the DEVICE identity (`WorkspaceContext` persists what
// `get_device_id()` returned), so these cases drive the commands with the
// device id and assert the local read/ack still reach the recipient row.

#[tokio::test]
async fn local_read_resolves_the_session_device_to_its_terminal_row() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    let memo_id = seed_published_memo(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("dev-terminal-1"));

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();

    assert_eq!(
        dto.memos.len(),
        1,
        "the session's device id must resolve to the terminal row the fan-out wrote"
    );
    assert_eq!(dto.memos[0].memo.id, memo_id);
}

#[tokio::test]
async fn local_read_is_empty_not_an_error_for_a_device_without_a_terminal_row() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_published_memo(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("UNREGISTERED-DEVICE"));

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();

    assert!(dto.memos.is_empty());
    assert_eq!(
        dto.cadence.kds_interval_secs,
        kasirmu_core::memo::kds_notification_interval_secs()
    );
}

#[tokio::test]
async fn fallback_ack_resolves_the_session_device_to_its_terminal_row() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    let memo_id = seed_published_memo(&conn);
    // Sync configured but unreachable (port 1 is the repo's standard dead
    // endpoint), so the cloud attempt fails and the local write applies.
    kasirmu_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
    kasirmu_core::settings::Settings::set_sync_server_url(&conn, "http://127.0.0.1:1").unwrap();
    kasirmu_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("dev-terminal-1"));

    acknowledge_memo_scoped(memo_id.clone(), "tok".into(), app.state())
        .await
        .expect("fallback ack must succeed via the local write");

    let app_state = app.state::<AppState>();
    let db = app_state.db.lock().await;
    let (terminal_id, status): (String, String) = {
        use rusqlite::params;
        let store = Store::new(&db);
        store
            .conn()
            .query_row(
                "SELECT terminal_id, delivery_status FROM memo_recipients
                 WHERE memo_id = ?1 AND terminal_id = 'terminal-1'",
                params![memo_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
    };
    assert_eq!(
        terminal_id, "terminal-1",
        "the ack must key the row id, not the device id"
    );
    assert_eq!(status, "acknowledged");
}

#[tokio::test]
async fn ack_for_a_device_without_a_terminal_row_is_a_typed_failure() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_published_memo(&conn);
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("UNREGISTERED-DEVICE"));

    let result = acknowledge_memo_scoped("m-1".into(), "tok".into(), app.state()).await;

    assert!(
        matches!(
            result,
            Err(AppError::Core {
                sub_kind: kasirmu_core::CoreErrorKind::NotFound,
                ..
            })
        ),
        "expected an unknown-recipient NotFound, got {result:?}"
    );
}

#[tokio::test]
async fn ack_falls_back_to_local_write_with_seeded_recipient() {
    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    let memo_id = seed_published_memo(&conn);
    {
        kasirmu_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
        kasirmu_core::settings::Settings::set_sync_server_url(&conn, "http://127.0.0.1:1").unwrap();
        kasirmu_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
    }
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session("terminal-1"));

    acknowledge_memo_scoped(memo_id.clone(), "tok".into(), app.state())
        .await
        .expect("fallback ack must succeed via the local write");

    // The local recipient row must now be acknowledged.
    let app_state = app.state::<AppState>();
    let db = app_state.db.lock().await;
    let (status, acked_by): (String, Option<String>) = {
        use rusqlite::params;
        let store = Store::new(&db);
        store
            .conn()
            .query_row(
                "SELECT delivery_status, acknowledged_by FROM memo_recipients
                 WHERE memo_id = ?1 AND terminal_id = 'terminal-1'",
                params![memo_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
    };
    assert_eq!(status, "acknowledged");
    assert_eq!(acked_by.as_deref(), Some("user-staff"));
    drop(db);
}

// ── Cloud-read identity (one terminal identity across the leg) ──────
//
// `GET /api/v1/memos/active` is answered for the terminal ROW id the recipient
// rows key on, so the tablet must ask under that id — the very same
// device→row translation its local read and ack perform — and must not ask at
// all for a device that resolves to no row.

/// A one-shot fake cloud: captures the request it receives, then answers the
/// memo-display contract with `body`.
///
/// The capture is written before the response, so a caller that returns from a
/// query is guaranteed to find it recorded — and a caller that finds it empty
/// provably never connected.
async fn fake_cloud(
    body: &'static str,
) -> (
    String,
    std::sync::Arc<tokio::sync::Mutex<Option<String>>>,
) {
    use std::sync::Arc as StdArc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let captured: StdArc<tokio::sync::Mutex<Option<String>>> =
        StdArc::new(tokio::sync::Mutex::new(None));
    let sink = captured.clone();
    tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let n = socket.read(&mut buffer).await.unwrap_or(0);
        *sink.lock().await = Some(String::from_utf8_lossy(&buffer[..n]).into_owned());
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });
    (server_url, captured)
}

/// Point sync at `server_url` and mint a session for `device`.
fn tablet_app_with_sync(
    conn: rusqlite::Connection,
    server_url: &str,
    device: &str,
) -> tauri::App<tauri::test::MockRuntime> {
    kasirmu_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
    kasirmu_core::settings::Settings::set_sync_server_url(&conn, server_url).unwrap();
    kasirmu_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
    let app = tauri::test::mock_builder()
        .manage(AppState::for_test_with_conn(conn))
        .build(tauri::generate_context!())
        .unwrap();
    app.state::<AppState>()
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), tablet_session(device));
    app
}

#[tokio::test]
async fn cloud_read_asks_under_the_resolved_terminal_row_id() {
    let (server_url, captured) =
        fake_cloud(r#"{"memos":[],"cadence":{"base_interval_secs":900,"kds_interval_secs":1800}}"#)
            .await;

    let conn = kasirmu_core::migrations::fresh_db();
    // Row id `terminal-1`, device id `dev-terminal-1` — the shapes a real
    // registration produces, and deliberately different.
    seed_terminal(&conn, "terminal-1");
    let app = tablet_app_with_sync(conn, &server_url, "dev-terminal-1");

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();

    assert_eq!(dto.cadence.kds_interval_secs, 1_800, "the cloud cadence wins");
    let request = captured
        .lock()
        .await
        .clone()
        .expect("a registered device must query the cloud");
    assert!(
        request.starts_with("GET /api/v1/memos/active?terminal_id=terminal-1 "),
        "the cloud query must name the recipient row id: {request}"
    );
    assert!(
        !request.contains("dev-terminal-1"),
        "the device identity must never be sent as a terminal id: {request}"
    );
}

#[tokio::test]
async fn cloud_read_is_not_attempted_for_a_device_without_a_terminal_row() {
    // The fake cloud DOES answer with a memo, so a query made under an
    // unresolvable identity would be visible twice: in the capture, and in the
    // list this command returns.
    let (server_url, captured) = fake_cloud(
        r#"{"memos":[{"id":"m-cloud-1","location_ids":[],"author_user_id":"user-manager","author_role":"role-manager","title":"Heads up","body":"Close early","duration":"24h","revision":1,"published_at":"2026-09-07T08:00:00.000Z","expires_at":"2026-09-08T08:00:00.000Z","created_at":"2026-09-07T07:00:00.000Z","delivery_status":"pending"}],"cadence":{"base_interval_secs":900,"kds_interval_secs":1800}}"#,
    )
    .await;

    let conn = kasirmu_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    let app = tablet_app_with_sync(conn, &server_url, "UNREGISTERED-DEVICE");

    let dto = list_active_memos_scoped("tok".into(), app.state())
        .await
        .unwrap();

    assert!(
        dto.memos.is_empty(),
        "a device with no terminal row has no memos, cloud or local"
    );
    assert_eq!(
        dto.cadence.base_interval_secs, 900,
        "the cadence is still served locally so the banner keeps polling"
    );
    assert!(
        captured.lock().await.is_none(),
        "no request may be sent under an identity that cannot match a recipient row"
    );
}

// ── Terminal-scoped ack credential (pairing with client_id = row id) ──
//
// `POST /api/v1/memos/{id}/ack` keys the caller's recipient row off the
// token's terminal_id CLAIM and refuses a token without one. That claim comes
// from the PAIRING's client_id on the client-credentials mint path, so the
// device must pair with its RESOLVED ROW id — the same identity the read and
// the local write use. These cases drive the whole three-request exchange
// (register → mint → ack) against one scripted fake cloud.

/// A fake cloud that answers a scripted sequence of requests, recording every
/// one: an echo of what a real server produces for POST /api/v1/terminals,
/// POST /api/v1/tokens (client-credentials) and POST /api/v1/memos/{id}/ack.
/// The register reply echoes back the `terminal_id` it was SENT — that is the
/// pairing's client_id as the server saw it, exactly what a real server does.
async fn scripted_cloud(
    token_reply: impl Fn() -> (u16, String) + Send + 'static,
    ack_reply: impl Fn() -> (u16, String) + Send + 'static,
) -> (
    String,
    std::sync::Arc<tokio::sync::Mutex<Vec<String>>>,
) {
    use std::sync::Arc as StdArc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let captured: StdArc<tokio::sync::Mutex<Vec<String>>> = StdArc::default();
    let sink = captured.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let mut buffer = vec![0_u8; 16 * 1024];
            let n = socket.read(&mut buffer).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
            let (status, body) = if request.starts_with("POST /api/v1/terminals ") {
                // Echo the pairing's terminal_id back, the way the real
                // registration endpoint does — and record the request whole.
                let id = request
                    .split("\r\n\r\n")
                    .nth(1)
                    .and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok())
                    .and_then(|v| v["terminal_id"].as_str().map(str::to_owned))
                    .unwrap_or_default();
                (
                    200,
                    serde_json::json!({"terminal_id": id, "device_secret": "devsec-1"})
                        .to_string(),
                )
            } else if request.starts_with("POST /api/v1/tokens ") {
                token_reply()
            } else {
                ack_reply()
            };
            let reply = format!(
                "HTTP/1.1 {} \r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                if status == 200 { "200 OK" } else { "403 Forbidden" },
                body.len(),
                body
            );
            let _ = socket.write_all(reply.as_bytes()).await;
            sink.lock().await.push(request);
        }
    });
    (server_url, captured)
}

#[tokio::test]
async fn cloud_ack_pairs_with_the_resolved_row_id_and_mints_a_scoped_token() {
    let (server_url, captured) = scripted_cloud(
        || (
            200,
            serde_json::json!({
                "token": {"token": "jwt-scoped-1", "expires_at": "2026-09-19T00:00:00.000Z"}
            })
            .to_string(),
        ),
        || (
            200,
            serde_json::json!({
                "memo_id": "m-1", "terminal_id": "terminal-1",
                "delivery_status": "acknowledged",
                "acknowledged_at": "2026-09-07T09:00:00.000Z", "changed": true
            })
            .to_string(),
        ),
    )
    .await;

    let conn = kasirmu_core::migrations::fresh_db();
    // Row id `terminal-1`, device id `dev-terminal-1` — deliberately different,
    // so a test that sends the device identity fails loudly.
    seed_terminal(&conn, "terminal-1");
    let app = tablet_app_with_sync(conn, &server_url, "dev-terminal-1");

    acknowledge_memo_scoped("m-1".into(), "tok".into(), app.state())
        .await
        .expect("cloud ack must succeed through the paired credential");

    let requests = captured.lock().await.clone();
    let register = requests
        .iter()
        .find(|r| r.starts_with("POST /api/v1/terminals "))
        .expect("the device must register before it can mint a scoped token");
    let pairing_body = register
        .split("\r\n\r\n")
        .nth(1)
        .and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok())
        .expect("the registration request must carry a JSON body");
    assert_eq!(
        pairing_body["terminal_id"], "terminal-1",
        "the pairing's client_id must be the RESOLVED ROW id, not the device id"
    );
    let token_mint = requests
        .iter()
        .find(|r| r.starts_with("POST /api/v1/tokens "))
        .expect("a registered device must mint its scoped token");
    let mint_body = token_mint
        .split("\r\n\r\n")
        .nth(1)
        .and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok())
        .expect("the mint request must carry a JSON body");
    assert_eq!(mint_body["client_id"], "terminal-1");
    assert_eq!(mint_body["client_secret"], "devsec-1");
    let ack = requests
        .iter()
        .find(|r| r.starts_with("POST /api/v1/memos/m-1/ack "))
        .expect("the ack itself must reach the cloud");
    assert!(
        ack.to_ascii_lowercase()
            .contains("authorization: bearer jwt-scoped-1"),
        "the ack must travel on the SCOPED token, not the stored admin-minted key: {ack}"
    );
    // And the pairing must be durable: a second ack reuses it instead of
    // re-registering (which would rotate the secret server-side).
    acknowledge_memo_scoped("m-1".into(), "tok".into(), app.state())
        .await
        .expect("second cloud ack must reuse the stored pairing");
    let requests = captured.lock().await.clone();
    assert_eq!(
        requests
            .iter()
            .filter(|r| r.starts_with("POST /api/v1/terminals "))
            .count(),
        1,
        "a stored pairing must be reused, not re-registered (re-registration rotates the secret)"
    );
}
