use super::*;
use oz_core::session::SessionContext;
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
    assert_eq!(json["memo"]["authorRole"], "role-owner");
    assert!(json["memo"].get("author_role").is_none());
}

#[test]
fn memo_display_dto_carries_server_issued_cadence() {
    // The display read serves the cadence alongside the memos so the UI never
    // hardcodes the intervals: the KDS value is derived as 2 × the base in
    // `oz_core::memo`, and this test pins both the envelope shape and the 2×
    // relationship across the wire.
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
fn memo_dto_org_scope_serializes_location_id_null() {
    let memo = Memo {
        id: "m-2".into(),
        tenant_id: "default".into(),
        location_ids: vec![],
        author_user_id: "user-1".into(),
        author_role: "role-manager".into(),
        title: "Org".into(),
        body: "All terminals".into(),
        status: oz_core::memo::MemoStatus::Published,
        duration: oz_core::memo::MemoDuration::Days3,
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
/// snake_case, because `oz_api::pg::ActiveMemoPg` carries no serde
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
    let response: oz_core::sync_client::ActiveMemosCloudResponse =
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
fn seed_terminal(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES (?1, ?1, ?2)",
        rusqlite::params![id, format!("dev-{id}")],
    )
    .unwrap();
}

/// One published Organization Memo authored on the (seeded) desktop side.
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
    let conn = oz_core::migrations::fresh_db();
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
    let conn = oz_core::migrations::fresh_db();
    seed_terminal(&conn, "terminal-1");
    seed_published_memo(&conn);
    {
        oz_core::settings::Settings::set_sync_enabled(&conn, true).unwrap();
        oz_core::settings::Settings::set_sync_server_url(&conn, "http://127.0.0.1:1").unwrap();
        oz_core::settings::Settings::set_sync_api_key(&conn, "jwt-test").unwrap();
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
