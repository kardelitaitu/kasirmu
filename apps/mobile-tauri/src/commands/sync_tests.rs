use super::*;

#[test]
fn sync_settings_serialize() {
    let dto = SyncSettingsDto {
        server_url: Some("https://sync.example.com".into()),
        has_api_key: true,
        enabled: true,
    };
    let json = serde_json::to_value(&dto).unwrap();
    // The shared settings page reads camelCase (ui/src/api/offline.ts
    // `SyncSettingsDto`); snake_case here reads as `undefined` on the tablet
    // and the page then re-sends a null URL, which wipes the stored one.
    assert_eq!(json["serverUrl"], "https://sync.example.com");
    assert_eq!(json["hasApiKey"], true);
    assert_eq!(json["enabled"], true);
    assert!(
        json.get("server_url").is_none(),
        "snake_case key must not reach the UI"
    );
    assert!(
        json.get("has_api_key").is_none(),
        "snake_case key must not reach the UI"
    );
}

#[test]
fn sync_settings_no_url_disabled() {
    let dto = SyncSettingsDto {
        server_url: None,
        has_api_key: false,
        enabled: false,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert!(json["serverUrl"].is_null());
    assert!(!json["enabled"].as_bool().unwrap());
}

#[test]
fn update_sync_settings_deserialize() {
    // This is the payload the settings page really sends — camelCase, built at
    // ui/src/features/settings/hooks/saveDiff.ts and forwarded unconverted by
    // ui/src/api/offline.ts. The snake_case version of this line used to pass
    // green while certifying the bug: serde filled both Option fields with
    // None and `update_sync_settings_data` wrote "" over the saved URL.
    let json = r#"{"serverUrl":"https://sync.example.com","apiKey":"sk-123","enabled":true}"#;
    let args: UpdateSyncSettingsArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.server_url.unwrap(), "https://sync.example.com");
    assert_eq!(args.api_key.unwrap(), "sk-123");
    assert!(args.enabled);
}

#[test]
fn update_sync_settings_deserialize_no_key() {
    // The masked key field is only sent when the user typed one, so the
    // omitted-`apiKey` shape is the common case.
    let json = r#"{"serverUrl":null,"enabled":false}"#;
    let args: UpdateSyncSettingsArgs = serde_json::from_str(json).unwrap();
    assert!(args.server_url.is_none());
    assert!(args.api_key.is_none());
    assert!(!args.enabled);
}

#[test]
fn update_sync_settings_wire_keys_match_bridge_twin() {
    // The drift guard. One JSON object — the bytes the UI sends — must land in
    // the tablet struct AND in `kasirmu_bridge::sync::UpdateSyncSettingsArgs` (the
    // type the desktop shell re-exports at
    // apps/desktop-tauri/src/commands/sync.rs) with equal effective values.
    // Both divergent fields are Option, so a casing mismatch on ONE side used
    // to be invisible to every other test: it deserialises fine and silently
    // carries None into the unwrap_or("") that wipes the stored URL. Equalising
    // the two structs is what makes that read red.
    //
    // Payload 2 is the snake_case shape, included so the assertion bites in
    // BOTH directions: if the tablet struct ever reverts to snake_case it
    // fills Some where the bridge fills None and the pair fails, while
    // payload 1 pins that camelCase — not the empty pair of Nones — is what
    // the tablet actually accepts.
    const PAYLOADS: [&str; 3] = [
        r#"{"serverUrl":"https://sync.example.com","apiKey":"sk-123","enabled":true}"#,
        r#"{"server_url":"https://sync.example.com","api_key":"sk-123","enabled":true}"#,
        r#"{"serverUrl":null,"enabled":false}"#,
    ];
    for json in PAYLOADS {
        let tablet: UpdateSyncSettingsArgs =
            serde_json::from_str(json).unwrap_or_else(|e| panic!("tablet must accept {json}: {e}"));
        let bridge: kasirmu_bridge::sync::UpdateSyncSettingsArgs =
            serde_json::from_str(json).unwrap_or_else(|e| panic!("bridge must accept {json}: {e}"));
        assert_eq!(
            tablet.server_url, bridge.server_url,
            "server_url casing drift on {json}"
        );
        assert_eq!(
            tablet.api_key, bridge.api_key,
            "api_key casing drift on {json}"
        );
        assert_eq!(
            tablet.enabled, bridge.enabled,
            "enabled casing drift on {json}"
        );
    }

    // And the UI's own shape must resolve to values, not to two matching Nones.
    let tablet: UpdateSyncSettingsArgs = serde_json::from_str(PAYLOADS[0]).unwrap();
    assert_eq!(
        tablet.server_url.as_deref(),
        Some("https://sync.example.com")
    );
    assert_eq!(tablet.api_key.as_deref(), Some("sk-123"));
    assert!(tablet.enabled);
}

#[test]
fn sync_settings_dto_wire_keys_match_bridge_twin() {
    // Read-path half of the same guard: the page cannot show a URL the tablet
    // serialised as `server_url`, and the blank field it shows instead is what
    // the next save writes back.
    let tablet_dto = SyncSettingsDto {
        server_url: Some("https://sync.example.com".into()),
        has_api_key: true,
        enabled: true,
    };
    let tablet = serde_json::to_value(&tablet_dto).unwrap();
    let bridge = serde_json::to_value(kasirmu_bridge::sync::SyncSettingsDto {
        server_url: tablet_dto.server_url.clone(),
        has_api_key: tablet_dto.has_api_key,
        enabled: tablet_dto.enabled,
    })
    .unwrap();
    assert_eq!(
        tablet, bridge,
        "tablet/bridge SyncSettingsDto wire keys drifted"
    );

    // The equality above is a ONE-SIDED guard: it fires when the two derives
    // disagree and stays silent when they agree on nothing. Two serialised
    // empty objects are equal, and `Option<String>` fields deserialise to
    // `None` on both sides -- so a case whose only assertion is this pair
    // passes on the exact shape that wiped the stored URL tonight: the UI
    // reads `serverUrl`, gets nothing, shows a blank field, and the next save
    // writes the blank back. Every pin below reads a KEY THE UI ACTUALLY
    // NAMES and demands a VALUE behind it, on both twins, so an emptied
    // fixture fails here instead of agreeing with itself.
    for (side, obj) in [("tablet", &tablet), ("bridge", &bridge)] {
        assert_eq!(
            obj["serverUrl"], "https://sync.example.com",
            "{side} must serialise serverUrl with the URL in it, not a key holding null"
        );
        assert_eq!(
            obj["hasApiKey"], true,
            "{side} must serialise hasApiKey from a real key"
        );
        assert_eq!(obj["enabled"], true, "{side} must serialise enabled");
        // ...and must not ALSO carry the snake_case spellings: a camelCase key
        // present plus a snake_case key present is a casing leak, which is how
        // one side drifting reads as clean to a value pin alone.
        assert!(
            obj.get("server_url").is_none(),
            "{side}: snake_case server_url key must not reach the UI"
        );
        assert!(
            obj.get("has_api_key").is_none(),
            "{side}: snake_case has_api_key key must not reach the UI"
        );
    }

    // Non-emptiness of the fixture itself, named rather than implied: if the
    // DTO above is ever reduced to all-None/false to make another case pass,
    // this fails with a sentence about the fixture, not a null-vs-null diff.
    assert!(
        tablet_dto.server_url.is_some() && tablet_dto.has_api_key && tablet_dto.enabled,
        "this case grades a POPULATED DTO; an empty one makes the value pins vacuous"
    );
}

#[test]
fn sync_pull_args_deserialize() {
    let json = r#"{"confirmDestructive":true}"#;
    let args: SyncPullArgs = serde_json::from_str(json).unwrap();
    assert!(args.confirm_destructive);
}

#[test]
fn sync_pull_args_missing_consent_fails() {
    // SYNC-03: a payload with no consent key must not silently
    // default to true — serde errors on the missing field.
    let result = serde_json::from_str::<SyncPullArgs>(r#"{}"#);
    assert!(
        result.is_err(),
        "missing confirm_destructive must fail deserialization"
    );
}

#[test]
fn validate_pull_consent_accepts_true() {
    let args = SyncPullArgs {
        confirm_destructive: true,
    };
    assert!(validate_pull_consent(&args).is_ok());
}

#[test]
fn validate_pull_consent_rejects_false() {
    let args = SyncPullArgs {
        confirm_destructive: false,
    };
    let err = validate_pull_consent(&args).unwrap_err();
    assert!(err.to_string().contains("confirm_destructive"));
}

#[test]
fn update_sync_settings_debug() {
    let args = UpdateSyncSettingsArgs {
        server_url: Some("url".into()),
        api_key: None,
        enabled: true,
    };
    let debug = format!("{:?}", args);
    assert!(debug.contains("url"));
}

#[test]
fn pull_result_serialize_no_error() {
    let r = PullResult {
        products_pulled: 10,
        tax_rates_pulled: 2,
        users_pulled: 3,
        error: None,
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["products_pulled"], 10);
    assert_eq!(json["tax_rates_pulled"], 2);
    assert_eq!(json["users_pulled"], 3);
    assert!(json["error"].is_null());
}

#[test]
fn pull_result_serialize_with_error() {
    let r = PullResult {
        products_pulled: 0,
        tax_rates_pulled: 0,
        users_pulled: 0,
        error: Some("network unreachable".into()),
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["error"], "network unreachable");
}

// ── Sync conflict review DTOs (tablet port of 028056eaae) ─────────

#[test]
fn list_sync_conflicts_args_default_all_none() {
    let args = ListSyncConflictsArgs::default();
    assert!(args.status.is_none());
    assert!(args.severity.is_none());
}

#[test]
fn list_sync_conflicts_args_parse_filters() {
    let args: ListSyncConflictsArgs =
        serde_json::from_str(r#"{ "status": "open", "severity": "high" }"#).unwrap();
    assert_eq!(args.status.as_deref(), Some("open"));
    assert_eq!(args.severity.as_deref(), Some("high"));
}

#[test]
fn resolve_sync_conflict_args_parse() {
    let args: ResolveSyncConflictArgs =
        serde_json::from_str(r#"{ "id": "c-17", "resolution": "remote" }"#).unwrap();
    assert_eq!(args.id, "c-17");
    assert_eq!(args.resolution, "remote");
}

#[test]
fn resolve_sync_conflict_args_missing_resolution_rejected() {
    let bad = serde_json::from_str::<ResolveSyncConflictArgs>(r#"{ "id": "c-17" }"#);
    assert!(
        bad.is_err(),
        "resolution is required — it decides which side wins"
    );
}

#[test]
fn sync_conflict_dto_roundtrip_untouched_payloads() {
    // The contract: local/remote payload and vector blobs are transported
    // verbatim — never parsed, never reformatted client-side.
    let raw = r#"{
        "id": "c-42",
        "entity_type": "stock.adjusted",
        "entity_id": "sku-9",
        "local_terminal_id": "tab-1",
        "local_vector": "{\"tab-1\":3}",
        "remote_vector": "{\"tab-2\":5}",
        "local_payload": "{\"qty\":2}",
        "remote_payload": "{\"qty\":3}",
        "severity": "high",
        "status": "open",
        "resolution": null,
        "resolved_by": null,
        "resolved_at": null,
        "created_at": "2026-09-13T06:00:00Z"
    }"#;
    let dto: SyncConflictDto = serde_json::from_str(raw).unwrap();
    assert_eq!(dto.local_payload, "{\"qty\":2}");
    assert_eq!(dto.remote_vector, "{\"tab-2\":5}");
    assert!(dto.resolution.is_none());
    // Round-trip: serialize back and re-parse — blobs must be byte-stable.
    let back = serde_json::to_string(&dto).unwrap();
    let again: SyncConflictDto = serde_json::from_str(&back).unwrap();
    assert_eq!(again.remote_payload, "{\"qty\":3}");
    assert_eq!(again.local_vector, dto.local_vector);
}

#[test]
fn sync_conflict_dto_resolved_row_parses() {
    let raw = r#"{
        "id": "c-43",
        "entity_type": "stock.adjusted",
        "entity_id": "sku-10",
        "local_terminal_id": "tab-1",
        "local_vector": "{}",
        "remote_vector": "{}",
        "local_payload": "{}",
        "remote_payload": "{}",
        "severity": "low",
        "status": "resolved",
        "resolution": "local",
        "resolved_by": "manager-a",
        "resolved_at": "2026-09-13T07:30:00Z",
        "created_at": "2026-09-13T06:00:00Z"
    }"#;
    let dto: SyncConflictDto = serde_json::from_str(raw).unwrap();
    assert_eq!(dto.status, "resolved");
    assert_eq!(dto.resolution.as_deref(), Some("local"));
    assert_eq!(dto.resolved_by.as_deref(), Some("manager-a"));
}

// ── TDD Bug Hunt: non-atomic sync settings writes ────────────────
//
// update_sync_settings_data persists three settings (server_url,
// api_key, enabled). If the writes are NOT wrapped in a single
// transaction, a failure on the third write leaves the first two
// committed — a partially-updated, inconsistent state. This test
// forces the third write to fail and asserts that the prior writes
// were rolled back (i.e. the function is atomic).

use kasirmu_core::migrations;

fn fresh_sync_conn() -> Connection {
    let conn = migrations::fresh_db();
    // Install triggers that reject any write to the `sync_enabled`
    // key — on both INSERT (fresh row) and UPDATE (existing row).
    // This simulates a disk/IO failure on the THIRD write only,
    // letting the first two (server_url, api_key) succeed.
    conn.execute_batch(
        "CREATE TRIGGER reject_sync_enabled_ins
         BEFORE INSERT ON settings
         WHEN NEW.key = 'sync_enabled'
         BEGIN
             SELECT RAISE(ABORT, 'forced failure on sync_enabled insert');
         END;
         CREATE TRIGGER reject_sync_enabled_upd
         BEFORE UPDATE ON settings
         WHEN NEW.key = 'sync_enabled'
         BEGIN
             SELECT RAISE(ABORT, 'forced failure on sync_enabled update');
         END;",
    )
    .expect("install reject trigger");
    conn
}

#[test]
fn update_sync_settings_data_rolls_back_on_partial_failure() {
    let conn = fresh_sync_conn();
    let args = UpdateSyncSettingsArgs {
        server_url: Some("https://sync.example.com".into()),
        api_key: Some("sk-secret".into()),
        enabled: true,
    };

    // The third write (set_sync_enabled) hits the trigger and fails.
    let result = update_sync_settings_data(&conn, &args);
    assert!(
        result.is_err(),
        "update must surface the forced sync_enabled failure"
    );

    // Atomicity contract: because the function wraps all three writes
    // in one transaction, the failed third write must roll back the
    // first two. If they are NOT rolled back, the function is
    // non-atomic (the bug).
    let server_url = Settings::get_sync_server_url(&conn).unwrap();
    let api_key = Settings::get_sync_api_key(&conn).unwrap();

    // These assertions FAIL in the RED phase (no transaction → first
    // two writes persist) and PASS once a transaction wraps the batch.
    assert!(
        server_url.as_deref() != Some("https://sync.example.com"),
        "server_url must be rolled back, got: {server_url:?}"
    );
    assert!(
        api_key.as_deref() != Some("sk-secret"),
        "api_key must be rolled back, got: {api_key:?}"
    );
}

#[test]
fn update_sync_settings_data_commits_all_when_no_failure() {
    // Happy path: all three writes succeed and persist together.
    let conn = migrations::fresh_db();
    let args = UpdateSyncSettingsArgs {
        server_url: Some("https://sync.example.com".into()),
        api_key: Some("sk-secret".into()),
        enabled: true,
    };
    update_sync_settings_data(&conn, &args).unwrap();

    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap().as_deref(),
        Some("https://sync.example.com")
    );
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap().as_deref(),
        Some("sk-secret")
    );
    assert!(Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn update_sync_settings_data_preserves_api_key_when_none() {
    // When api_key is None, the existing key must be preserved.
    let conn = migrations::fresh_db();
    Settings::set_sync_api_key(&conn, "existing-key").unwrap();

    let args = UpdateSyncSettingsArgs {
        server_url: Some("https://x".into()),
        api_key: None,
        enabled: false,
    };
    update_sync_settings_data(&conn, &args).unwrap();

    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap().as_deref(),
        Some("existing-key")
    );
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn update_sync_settings_data_clear_url_writes_empty_row() {
    // The UI sends server_url: None when the user clears the field.
    // The command must write an empty row (Some("")) rather than
    // leaving the stale URL (which would keep auto-provision from ever
    // repairing a broken URL) or deleting the row (which would make a
    // cleared + disabled install look like a fresh one and re-trigger
    // provisioning on the next debug launch).
    let conn = migrations::fresh_db();
    Settings::set_sync_server_url(&conn, "https://sync.example.com").unwrap();
    Settings::set_sync_enabled(&conn, false).unwrap();

    let args = UpdateSyncSettingsArgs {
        server_url: None,
        api_key: None,
        enabled: false,
    };
    update_sync_settings_data(&conn, &args).unwrap();

    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("".into())
    );
}

#[tokio::test]
async fn sync_run_scoped_plan_required_keeps_store_items_pending() {
    // ADR sync-plan-gating, ported off this command's unscoped twin on 2026-09-16 (T27): a 403
    // plan_required from the server must keep queued items `pending` (never mark them failed)
    // and flag plan_required so the UI can show an upgrade prompt.
    //
    // It used to run against the unscoped sibling of this command, which was registered in
    // neither shell, so the invariant was graded through a door no real build can open while
    // the door the tablet actually calls -- this one, SYNC_MANAGE-gated -- had no plan-gate
    // case. The two bodies were separate copies of the same three-phase logic, so passing
    // here said something the old test could not: the shipped path gates the plan the same
    // way. That is why the dead copy could be retired rather than merely left uncalled.
    use crate::state::AppState;
    use kasirmu_core::Store;
    use kasirmu_core::auth;
    use kasirmu_core::migrations;
    use kasirmu_core::offline::OfflineQueueStatus;
    use kasirmu_core::session::SessionContext;
    use platform_core::StoreDatabaseManager;
    use tauri::Manager as _;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let _ = socket.read(&mut buffer).await;
        let body = r#"{"error":"plan_required"}"#;
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });

    let conn = migrations::fresh_db();
    let sync_user_id = {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        let hash = auth::hash_pin("1234").unwrap();
        store
            .create_user("sync-admin", &hash, "Sync Admin", "role-owner")
            .unwrap()
            .id
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    state.session_store.write().unwrap().insert(
        "plan-gate-token".into(),
        SessionContext::new(
            sync_user_id,
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Settings and the queued item go through the STORE db, which is the queue the scoped
    // push reads (see `sync_run_scoped_marks_store_queue_and_leaves_global_untouched`).
    {
        let state = app.state::<AppState>();
        let conn_arc = state.resolve_store("plan-gate-token").unwrap();
        let db_guard = conn_arc.lock().unwrap();
        update_sync_settings_data(
            &db_guard,
            &UpdateSyncSettingsArgs {
                server_url: Some(server_url),
                api_key: Some("test-jwt".into()),
                enabled: true,
            },
        )
        .unwrap();
        Store::new(&db_guard)
            .enqueue_offline("complete_sale", r#"{"id":"tablet-plan-gate-scoped"}"#)
            .unwrap();
    }

    let result = sync_run_scoped("plan-gate-token".into(), app.state())
        .await
        .unwrap();
    task.await.unwrap();

    assert!(result.plan_required, "must flag plan_required for the UI");
    assert_eq!(result.synced, 0, "a plan gate syncs nothing");
    assert_eq!(result.failed, 0, "a plan gate is not a failure");

    let state = app.state::<AppState>();
    let conn_arc = state.resolve_store("plan-gate-token").unwrap();
    let db_guard = conn_arc.lock().unwrap();
    let store = Store::new(&db_guard);
    let items = store.list_all_offline().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0].status,
        OfflineQueueStatus::Pending,
        "plan-gated items must stay pending so they sync after upgrade"
    );
    assert_eq!(
        store.pending_offline_count().unwrap(),
        1,
        "the queue must still be offered on the next cycle"
    );
}

// ── Scoped push marks the STORE queue, not the global one ───────
//
// sync_run_scoped reads pending items from the session's store database
// (resolve_scope → store-<id>.sqlite). Phase 3 used to lock `state.db`
// (the global connection) instead, so the outcomes were written to a
// different file's offline_queue: the store row stayed `pending` forever
// and untouched global rows got marked. Both assertions below pin the
// invariant — the second one is what catches the original bug.

#[tokio::test]
async fn sync_run_scoped_marks_store_queue_and_leaves_global_untouched() {
    use crate::state::AppState;
    use kasirmu_core::Store;
    use kasirmu_core::auth;
    use kasirmu_core::migrations;
    use kasirmu_core::offline::OfflineQueueStatus;
    use kasirmu_core::session::SessionContext;
    use platform_core::StoreDatabaseManager;
    use tauri::Manager as _;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Fake push server (pattern from sync_run_plan_required_...): one
    // batch push request, one accepted outcome.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let _ = socket.read(&mut buffer).await;
        let body = r#"{"results":[{"outcome":"accepted"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });

    // Global db carries identity only; the scoped store db is a separate
    // file the db manager creates below (seed_session pattern,
    // settings_tests.rs:716).
    let conn = migrations::fresh_db();
    let sync_user_id = {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        let hash = auth::hash_pin("1234").unwrap();
        store
            .create_user("sync-admin", &hash, "Sync Admin", "role-owner")
            .unwrap()
            .id
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    state.session_store.write().unwrap().insert(
        "scoped-sync-token".into(),
        SessionContext::new(
            sync_user_id,
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
            "instance-1".into(),
            "restaurant-pos".into(),
            None,
            0,
        ),
    );
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    // Configure sync + enqueue the pending item through the STORE db —
    // the queue the device actually writes to (SYNC_MANAGE gate resolves
    // role-owner's global assignment against the global db).
    {
        let state = app.state::<AppState>();
        let conn_arc = state.resolve_store("scoped-sync-token").unwrap();
        let db_guard = conn_arc.lock().unwrap();
        update_sync_settings_data(
            &db_guard,
            &UpdateSyncSettingsArgs {
                server_url: Some(server_url),
                api_key: Some("test-jwt".into()),
                enabled: true,
            },
        )
        .unwrap();
        Store::new(&db_guard)
            .enqueue_offline("complete_sale", r#"{"id":"scoped-sync-mark"}"#)
            .unwrap();
    }

    let result = sync_run_scoped("scoped-sync-token".into(), app.state())
        .await
        .unwrap();
    task.await.unwrap();

    assert_eq!(
        result.synced, 1,
        "the push must report the store item synced"
    );
    assert_eq!(result.failed, 0);
    assert!(!result.plan_required);

    // Assertion 1 — the STORE row the push read flips to synced.
    {
        let state = app.state::<AppState>();
        let conn_arc = state.resolve_store("scoped-sync-token").unwrap();
        let db_guard = conn_arc.lock().unwrap();
        let store = Store::new(&db_guard);
        let items = store.list_all_offline().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].status,
            OfflineQueueStatus::Synced,
            "the store row the scoped push read must be marked synced in the store db"
        );
        assert_eq!(
            store.pending_offline_count().unwrap(),
            0,
            "pending_sync_count_scoped must drop to zero after the push"
        );
    }

    // Assertion 2 — the GLOBAL database queue is untouched. This is the
    // assertion that would have caught the original bug: Phase 3 used to
    // write its marks here instead of the store db.
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().await;
        let items = Store::new(&db).list_all_offline().unwrap();
        assert!(
            items.is_empty(),
            "global offline_queue must not receive scoped marks, got {items:?}"
        );
    }
}
