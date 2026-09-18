use super::*;
use crate::migrations;
use crate::settings::Settings;
use rusqlite::Connection;

fn setup() -> Store<'static> {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    let conn: &'static Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

#[test]
fn sync_pending_empty_queue() {
    let store = setup();
    let config = SyncConfig {
        server_url: "http://localhost:3099".into(),
        api_key: None,
    };
    let result = sync_pending(&store, &config).unwrap();
    assert_eq!(result.synced, 0);
    assert_eq!(result.failed, 0);
    assert!(result.error.is_none());
}

#[test]
fn sync_config_from_settings_disabled() {
    let store = setup();
    let config = SyncConfig::from_settings(&store).unwrap();
    assert!(config.is_none());
}

#[test]
fn sync_pending_marks_items_synced() {
    let store = setup();
    let _item = store
        .enqueue_offline("complete_sale", r#"{"test": true}"#)
        .unwrap();

    let config = SyncConfig {
        server_url: "http://localhost:3099".into(),
        api_key: None,
    };
    // No server running locally — sync should fail with a transport error.
    let result = sync_pending(&store, &config).unwrap();
    assert_eq!(result.synced, 0);
    assert_eq!(result.failed, 1);
    assert!(result.error.is_some(), "should report a network error");

    // Item should be marked as failed (no longer pending).
    let pending = store.list_pending_offline().unwrap();
    assert!(pending.is_empty(), "failed item is no longer pending");
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1, "item still in queue with failed status");
    assert_eq!(all[0].status, crate::offline::OfflineQueueStatus::Failed);
}

/// ADR sync-plan-gating: the legacy blocking path must ALSO treat a
/// 403 plan_required as a gated state — items stay `pending` (never
/// marked failed) so they sync automatically after an upgrade.
#[cfg(feature = "sync-http")]
#[test]
fn sync_pending_plan_required_keeps_items_pending() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 8192];
        let _ = stream.read(&mut buffer).unwrap();
        let body = r#"{"error":"plan_required"}"#;
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });

    let store = setup();
    store
        .enqueue_offline("complete_sale", r#"{"id":"blocking-plan-gate"}"#)
        .unwrap();
    let config = SyncConfig {
        server_url: format!("http://127.0.0.1:{port}"),
        api_key: Some("test-jwt".into()),
    };

    let result = sync_pending(&store, &config).unwrap();
    server.join().unwrap();

    assert!(result.plan_required, "must flag plan_required");
    assert_eq!(result.synced, 0);
    assert_eq!(result.failed, 0, "a plan gate is not a failure");

    // The item stays pending — no mark_all_failed.
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "plan-gated item must stay pending");
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(
        all[0].status,
        crate::offline::OfflineQueueStatus::Pending,
        "never marked failed on a plan gate"
    );
}

/// ADR sync-plan-gating: fetch_tenant_plan reads the caller's own plan
/// (free/pro) from the non-gated self-serve endpoint.
#[cfg(feature = "sync-http")]
#[test]
fn fetch_tenant_plan_returns_plan_from_server() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 8192];
        let _ = stream.read(&mut buffer).unwrap();
        let body = r#"{"tenant_id":"tenant-a","plan":"pro"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = rt.block_on(fetch_tenant_plan(
        &format!("http://127.0.0.1:{port}"),
        "test-jwt",
    ));
    server.join().unwrap();

    assert!(result.ok);
    assert_eq!(result.plan.as_deref(), Some("pro"));
}

#[cfg(feature = "sync-http")]
#[test]
fn fetch_tenant_plan_reports_server_error() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 8192];
        let _ = stream.read(&mut buffer).unwrap();
        let body = r#"{"error":"invalid_token"}"#;
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = rt.block_on(fetch_tenant_plan(
        &format!("http://127.0.0.1:{port}"),
        "bad-jwt",
    ));
    server.join().unwrap();

    assert!(!result.ok);
    assert_eq!(result.plan, None);
}

#[test]
fn sync_pending_multiple_items() {
    let store = setup();
    store
        .enqueue_offline("complete_sale", r#"{"id":1}"#)
        .unwrap();
    store
        .enqueue_offline("complete_sale", r#"{"id":2}"#)
        .unwrap();

    let config = SyncConfig {
        server_url: "http://localhost:3099".into(),
        api_key: None,
    };
    let result = sync_pending(&store, &config).unwrap();
    // No server running — all items fail.
    assert_eq!(result.synced, 0);
    assert_eq!(result.failed, 2);
    assert!(result.error.is_some(), "should report a network error");
}

#[test]
fn sync_config_from_settings_enabled_with_url() {
    let store = setup();
    let conn = store.conn();
    Settings::set_sync_enabled(conn, true).unwrap();
    Settings::set_sync_server_url(conn, "http://sync.example.com").unwrap();

    let config = SyncConfig::from_settings(&store).unwrap();
    assert!(config.is_some());
    assert_eq!(config.unwrap().server_url, "http://sync.example.com");
}

#[test]
fn sync_config_from_settings_enabled_no_url() {
    let store = setup();
    let conn = store.conn();
    Settings::set_sync_enabled(conn, true).unwrap();
    // Don't set a URL
    let config = SyncConfig::from_settings(&store).unwrap();
    assert!(config.is_none(), "should be None when no URL is set");
}

#[test]
fn sync_config_from_settings_enabled_empty_url() {
    let store = setup();
    let conn = store.conn();
    Settings::set_sync_enabled(conn, true).unwrap();
    Settings::set_sync_server_url(conn, "").unwrap();

    let config = SyncConfig::from_settings(&store).unwrap();
    assert!(config.is_none(), "should be None when URL is empty");
}

#[test]
fn sync_config_from_settings_with_api_key() {
    let store = setup();
    let conn = store.conn();
    Settings::set_sync_enabled(conn, true).unwrap();
    Settings::set_sync_server_url(conn, "http://sync.example.com").unwrap();
    Settings::set_sync_api_key(conn, "sk-test-key").unwrap();

    let config = SyncConfig::from_settings(&store).unwrap().unwrap();
    assert_eq!(config.server_url, "http://sync.example.com");
    assert_eq!(config.api_key, Some("sk-test-key".into()));
}

// ── SYNC-04: per-outcome application contract ───────────────
//
// `retry_offline_sync` and `sync_run` both delegate here. These tests
// pin that an item is marked synced ONLY on an accepted outcome, and
// marked failed (never falsely synced) on rejection or conflict.

#[test]
fn apply_sync_outcomes_accepted_marks_synced() {
    let store = setup();
    let items = [
        store
            .enqueue_offline("complete_sale", r#"{"id":1}"#)
            .unwrap(),
        store.enqueue_offline("void_sale", r#"{"id":2}"#).unwrap(),
    ];

    let outcomes = vec![PushOutcome::Accepted, PushOutcome::Accepted];
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.synced, 2);
    assert_eq!(result.failed, 0);
    assert!(result.error.is_none());

    let all = store.list_all_offline().unwrap();
    assert!(
        all.iter()
            .all(|i| i.status == crate::offline::OfflineQueueStatus::Synced)
    );
}

#[test]
fn apply_sync_outcomes_rejected_marks_failed() {
    let store = setup();
    let items = [store
        .enqueue_offline("complete_sale", r#"{"id":1}"#)
        .unwrap()];

    let outcomes = vec![PushOutcome::Rejected {
        reason: "invalid action".into(),
    }];
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.synced, 0);
    assert_eq!(result.failed, 1);
    assert_eq!(result.error.as_deref(), Some("invalid action"));

    let all = store.list_all_offline().unwrap();
    assert_eq!(all[0].status, crate::offline::OfflineQueueStatus::Failed);
    assert_eq!(all[0].last_error.as_deref(), Some("invalid action"));
}

#[test]
fn apply_sync_outcomes_duplicate_id_rejection_marks_synced() {
    // A `duplicate id:` Rejected means the server already holds this exact
    // item (crash between server-insert and local mark-synced, then re-push).
    // The mutation is safe on the server, so the item must become `synced`,
    // NOT a terminal `failed` (push-side failed items have no requeue path).
    let store = setup();
    let items = [store
        .enqueue_offline("complete_sale", r#"{"id":1}"#)
        .unwrap()];

    let outcomes = vec![PushOutcome::Rejected {
        reason: "duplicate id: some-uuid".into(),
    }];
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.synced, 1, "duplicate-id replay counts as synced");
    assert_eq!(result.failed, 0);
    assert_eq!(result.error, None, "a replay is not an error");

    let all = store.list_all_offline().unwrap();
    assert_eq!(all[0].status, crate::offline::OfflineQueueStatus::Synced);
    // failed_count must stay 0 — the whole point is not polluting it.
    let summary = store.offline_queue_status_summary().unwrap();
    assert_eq!(summary.failed_count, 0);
    assert_eq!(summary.synced_count, 1);
}

#[test]
fn apply_sync_outcomes_genuine_rejection_still_marks_failed() {
    // Guard the boundary: a Rejected that merely CONTAINS "duplicate id" but
    // does not start with the exact prefix is still a genuine failure.
    let store = setup();
    let items = [store
        .enqueue_offline("complete_sale", r#"{"id":1}"#)
        .unwrap()];

    let outcomes = vec![PushOutcome::Rejected {
        reason: "server error: duplicate id collision detected downstream".into(),
    }];
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.failed, 1);
    assert_eq!(result.synced, 0);
    let all = store.list_all_offline().unwrap();
    assert_eq!(all[0].status, crate::offline::OfflineQueueStatus::Failed);
}

#[test]
fn apply_sync_outcomes_conflict_resolves_with_server_copy_wins() {
    let store = setup();
    let local = store
        .enqueue_offline("complete_sale", r#"{"id":1}"#)
        .unwrap();
    let items = [local.clone()];

    // A conflict outcome carries the server's copy of the item.
    let server_item = OfflineQueueItem {
        id: local.id.clone(),
        action: local.action.clone(),
        payload: r#"{"id":1,"remote":true}"#.into(),
        status: local.status,
        retry_count: local.retry_count,
        last_error: None,
        tenant_id: local.tenant_id.clone(),
        created_at: local.created_at.clone(),
        synced_at: None,
        priority: local.priority,
    };
    let outcomes = vec![PushOutcome::Conflict(server_item)];
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.synced, 1);
    assert_eq!(result.failed, 0);

    // The local item is marked *resolved* (server copy wins), not silently
    // dropped — OFF-11: the resolution marker is what the summary's
    // conflict_count query counts, so the UI sees real conflicts.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all[0].status, crate::offline::OfflineQueueStatus::Synced);
    assert!(
        all[0]
            .last_error
            .as_deref()
            .unwrap_or_default()
            .starts_with("resolved: conflict"),
        "conflict resolution marker must be recorded, got {:?}",
        all[0].last_error
    );

    // The summary's conflict_count must now reflect the real path.
    let summary = store.offline_queue_status_summary().unwrap();
    assert_eq!(summary.conflict_count, 1);
    assert_eq!(summary.synced_count, 1);
}

#[test]
fn apply_sync_outcomes_truncates_on_outcome_len_mismatch() {
    // Documented behaviour: if the server returns fewer outcomes than
    // pending items, `zip` silently truncates. The unpaired items are
    // neither marked synced nor failed (they stay pending) — the
    // retry caller must re-list them next cycle. This pins the
    // current contract so a future refactor can't silently mark them
    // synced without an outcome.
    let store = setup();
    let items = [
        store
            .enqueue_offline("complete_sale", r#"{"id":1}"#)
            .unwrap(),
        store
            .enqueue_offline("complete_sale", r#"{"id":2}"#)
            .unwrap(),
    ];
    let outcomes = vec![PushOutcome::Accepted]; // one outcome for two items
    let result = apply_sync_outcomes(&store, &items, &outcomes).unwrap();
    assert_eq!(result.synced, 1);
    assert_eq!(result.failed, 0);

    let all = store.list_all_offline().unwrap();
    // One synced, one still pending — never falsely synced.
    assert_eq!(
        all.iter()
            .filter(|i| i.status == crate::offline::OfflineQueueStatus::Synced)
            .count(),
        1
    );
    assert_eq!(
        all.iter()
            .filter(|i| i.status == crate::offline::OfflineQueueStatus::Pending)
            .count(),
        1
    );
}

// ── SYNC-06: snapshot credential-exposure contract ──────────
//
// The snapshot must NEVER carry `pin_hash`. These tests pin both
// directions: (1) the client rejects a snapshot that (incorrectly)
// includes the field, and (2) applying a valid snapshot writes a
// non-verifiable placeholder for new users while preserving any
// existing local credential hash on conflict.

#[test]
fn snapshot_user_without_pin_hash_deserializes() {
    // A snapshot user row with NO pin_hash field is the normal
    // contract and must deserialize cleanly.
    let json = r#"{
        "users": [{
            "id": "u1",
            "username": "alice",
            "display_name": "Alice",
            "role_id": "r-owner",
            "is_active": true
        }]
    }"#;
    let snap: Snapshot = serde_json::from_str(json).unwrap();
    assert_eq!(snap.users.len(), 1);
    assert_eq!(snap.users[0].username, "alice");
}

#[test]
fn snapshot_user_with_pin_hash_is_rejected() {
    // Defense in depth: a snapshot that (incorrectly) carries pin_hash
    // must fail loudly instead of silently importing credential
    // material into the local users table.
    let json = r#"{
        "users": [{
            "id": "u1",
            "username": "alice",
            "pin_hash": "SENSITIVE-HASH",
            "display_name": "Alice",
            "role_id": "r-owner",
            "is_active": true
        }]
    }"#;
    assert!(
        serde_json::from_str::<Snapshot>(json).is_err(),
        "snapshot with pin_hash must be rejected"
    );
}

#[test]
fn apply_snapshot_writes_placeholder_pin_hash_for_new_users() {
    let store = setup();
    // Seed a role so the users FK is satisfied.
    store
        .conn()
        .execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-owner', 'Owner', '[]')",
            [],
        )
        .unwrap();

    let snap = Snapshot {
        products: vec![],
        tax_rates: vec![],
        users: vec![SnapshotUser {
            id: Some("u1".into()),
            username: "alice".into(),
            display_name: "Alice".into(),
            role_id: "r-owner".into(),
            is_active: true,
            created_at: None,
            updated_at: None,
        }],
    };
    let result = apply_snapshot(&store, &snap).unwrap();
    assert_eq!(result.users_pulled, 1);

    let hash: String = store
        .conn()
        .query_row(
            "SELECT pin_hash FROM users WHERE username = 'alice'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hash, SNAPSHOT_PIN_HASH_PLACEHOLDER);
    assert_ne!(hash, "SENSITIVE-HASH", "never a real verifier");
}

#[test]
fn apply_snapshot_preserves_existing_local_pin_hash_on_conflict() {
    let store = setup();
    store
        .conn()
        .execute(
            "INSERT INTO roles (id, name, permissions) VALUES ('r-owner', 'Owner', '[]')",
            [],
        )
        .unwrap();
    // Pre-existing local user with a REAL credential hash.
    store
        .conn()
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id)
             VALUES ('u-local', 'bob', 'REAL-LOCAL-HASH', 'Bob', 'r-owner')",
            [],
        )
        .unwrap();

    // Snapshot upserts the same username with a fresh remote id.
    let snap = Snapshot {
        products: vec![],
        tax_rates: vec![],
        users: vec![SnapshotUser {
            id: Some("u-remote".into()),
            username: "bob".into(),
            display_name: "Bob Updated".into(),
            role_id: "r-owner".into(),
            is_active: true,
            created_at: None,
            updated_at: None,
        }],
    };
    apply_snapshot(&store, &snap).unwrap();

    // The conflict-update must NOT clobber the local credential hash.
    let hash: String = store
        .conn()
        .query_row(
            "SELECT pin_hash FROM users WHERE username = 'bob'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hash, "REAL-LOCAL-HASH");

    // ...but the non-secret metadata from the snapshot still lands.
    let name: String = store
        .conn()
        .query_row(
            "SELECT display_name FROM users WHERE username = 'bob'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(name, "Bob Updated");
}

#[test]
fn sync_attempt_result_debug() {
    let result = SyncAttemptResult {
        synced: 5,
        failed: 1,
        error: Some("network error".into()),
        plan_required: false,
    };
    let debug = format!("{:?}", result);
    assert!(debug.contains("synced: 5"));
    assert!(debug.contains("failed: 1"));
}

#[test]
fn sync_attempt_result_serde_roundtrip() {
    let result = SyncAttemptResult {
        synced: 10,
        failed: 2,
        error: Some("timeout".into()),
        plan_required: false,
    };
    let json = serde_json::to_string(&result).unwrap();
    let back: SyncAttemptResult = serde_json::from_str(&json).unwrap();
    assert_eq!(back.synced, 10);
    assert_eq!(back.failed, 2);
    assert_eq!(back.error, Some("timeout".into()));
}

#[test]
fn sync_attempt_result_no_error() {
    let result = SyncAttemptResult {
        synced: 0,
        failed: 0,
        error: None,
        plan_required: false,
    };
    assert!(result.error.is_none());
}

// ── classify_http_status (ADR sync-plan-gating) ───────────────

#[test]
fn classify_403_plan_required_is_plan_required() {
    let err = classify_http_status(403, r#"{"error":"plan_required"}"#);
    assert!(
        matches!(err, SyncHttpError::PlanRequired),
        "a 403 plan_required must classify as PlanRequired, got: {err:?}"
    );
}

#[test]
fn classify_bare_403_is_server_error_not_plan() {
    // A 403 without the plan_required body is a generic server error —
    // never invent a plan gate from the status alone.
    let err = classify_http_status(403, "Forbidden");
    assert!(matches!(err, SyncHttpError::Server { status: 403, .. }));
}

#[test]
fn classify_401_expired_and_invalid_unchanged() {
    assert!(matches!(
        classify_http_status(401, r#"{"error":"token_expired"}"#),
        SyncHttpError::AuthExpired
    ));
    assert!(matches!(
        classify_http_status(401, r#"{"error":"invalid_token"}"#),
        SyncHttpError::AuthInvalid
    ));
    assert!(matches!(
        classify_http_status(401, "bare 401"),
        SyncHttpError::AuthExpired
    ));
}

#[test]
fn classify_500_is_server_error() {
    let err = classify_http_status(500, "boom");
    assert!(matches!(err, SyncHttpError::Server { status: 500, .. }));
    if let SyncHttpError::Server { body, .. } = err {
        assert_eq!(body, "boom");
    }
}

// ── format_expiry tests ────────────────────────────────────

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_exactly_one_hour() {
    // Small buffer (+5s) accounts for sub-second drift between the
    // timestamp construction and format_expiry's internal now() call.
    let ts = (chrono::Utc::now() + chrono::Duration::hours(1) + chrono::Duration::seconds(5))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expires in 1 hour");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_exactly_one_day() {
    let ts = (chrono::Utc::now() + chrono::Duration::days(1) + chrono::Duration::seconds(5))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expires in 1 day");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_already_expired() {
    let ts = (chrono::Utc::now() - chrono::Duration::hours(1))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expired");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_less_than_a_minute() {
    let ts = (chrono::Utc::now() + chrono::Duration::seconds(30))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expires in less than a minute");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_ninety_minutes() {
    // Small buffer (+5s) prevents sub-second drift from pushing the
    // duration below 60 minutes (which would display as "59 minutes").
    let ts = (chrono::Utc::now() + chrono::Duration::minutes(90) + chrono::Duration::seconds(5))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expires in 1 hour");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_twenty_five_hours() {
    let ts = (chrono::Utc::now() + chrono::Duration::hours(25) + chrono::Duration::seconds(5))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    assert_eq!(format_expiry(&ts), "expires in 1 day");
}

#[cfg(feature = "sync-http")]
#[test]
fn format_expiry_unparseable_fallback() {
    assert_eq!(format_expiry("not-a-timestamp"), "expires not-a-timestamp");
}

// ── Scoped tax rates through the pull ────────────────────────────
//
// The wire shape is exercised by DESERIALIZING JSON rather than by building
// SnapshotTaxRate in Rust, because the contract under test is the payload:
// what an old server sends, what a new server sends, and what absence means.

fn seed_scope(store: &Store<'_>, entity: &str, location: &str) {
    store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO legal_entities (id, tenant_id, name) VALUES (?1, 'default', ?1)",
            rusqlite::params![entity],
        )
        .unwrap();
    store
        .conn()
        .execute(
            "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?1)",
            rusqlite::params![location],
        )
        .unwrap();
}

fn pull(store: &Store<'_>, json: &str) -> PullResult {
    let snap: Snapshot = serde_json::from_str(json).expect("snapshot payload must deserialize");
    apply_snapshot(store, &snap).unwrap()
}

fn stored_scope(
    store: &Store<'_>,
    id: &str,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    store
        .conn()
        .query_row(
            "SELECT legal_entity_id, location_id, effective_from, effective_to \
             FROM tax_rates WHERE id = ?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap()
}

#[test]
fn pull_lands_a_scoped_rate_and_the_branch_prices_only_its_location() {
    // THE test that closes the hazard: before the four columns travelled, this
    // payload arrived unscoped and the Jakarta rate answered for every
    // location. Now the scoped row applies where it belongs and nowhere else.
    let store = setup();
    seed_scope(&store, "ent-a", "loc-jkt");
    let result = pull(
        &store,
        r#"{"tax_rates": [
            {"id": "r-global", "name": "Global VAT", "rate_bps": 1000, "is_default": true},
            {"id": "r-jkt", "name": "Jakarta", "rate_bps": 1100,
             "location_id": "loc-jkt", "effective_from": "2026-01-01", "effective_to": "2027-01-01"}
        ]}"#,
    );
    assert_eq!(result.tax_rates_pulled, 2);
    assert_eq!(
        stored_scope(&store, "r-jkt"),
        (
            None,
            Some("loc-jkt".into()),
            Some("2026-01-01".into()),
            Some("2027-01-01".into())
        ),
        "scope and window survive the wire verbatim"
    );

    let at_jkt = store
        .resolve_tax_rate_for_location("loc-jkt", Some("ent-a"), "2026-09-08")
        .unwrap()
        .unwrap();
    assert_eq!((at_jkt.id.as_str(), at_jkt.rate_bps), ("r-jkt", 1100));
    let at_elsewhere = store
        .resolve_tax_rate_for_location("loc-bali", Some("ent-a"), "2026-09-08")
        .unwrap()
        .unwrap();
    assert_eq!(
        (at_elsewhere.id.as_str(), at_elsewhere.rate_bps),
        ("r-global", 1000),
        "another location must NOT be priced by the pulled Jakarta rate"
    );

    // Boundary day: the exclusive effective_to survived the round trip, so the
    // successor (here, the global row) takes over on 2027-01-01.
    let after = store
        .resolve_tax_rate_for_location("loc-jkt", Some("ent-a"), "2027-01-01")
        .unwrap()
        .unwrap();
    assert_eq!(
        after.id, "r-global",
        "window end is exclusive over the wire too"
    );
}

#[test]
fn pull_lands_a_legacy_payload_as_the_tenant_global_row() {
    // Back-compat direction, pinned: a payload with NO scope keys — every
    // server predating 20260921 — lands as the tenant-global legacy row, which
    // is what every such row already is. Absence is not an error and not
    // "unknown scope".
    let store = setup();
    seed_scope(&store, "ent-a", "loc-a");
    let result = pull(
        &store,
        r#"{"tax_rates": [{"id": "r-old", "name": "Old shape", "rate_bps": 825, "is_default": true}]}"#,
    );
    assert_eq!(result.tax_rates_pulled, 1);
    assert_eq!(stored_scope(&store, "r-old"), (None, None, None, None));
    assert_eq!(
        store
            .resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .map(|r| r.id),
        Some("r-old".to_string()),
        "the legacy row is the tenant-global answer"
    );
}

#[test]
fn pull_refuses_a_scoped_rate_whose_target_is_absent_locally() {
    // Skipping, not flattening: writing NULL here would promote a rate meant
    // for one location to the tenant-global answer. The FK would reject the
    // write anyway, and unlike the products path this does NOT roll back the
    // whole pull — the deviation is documented on the helper in sync_pull.rs.
    let store = setup();
    seed_scope(&store, "ent-a", "loc-a");
    let result = pull(
        &store,
        r#"{"tax_rates": [
            {"id": "r-ghost", "name": "Ghost scope", "rate_bps": 1500, "location_id": "loc-ghost"},
            {"id": "r-both", "name": "Ambiguous", "rate_bps": 1600,
             "legal_entity_id": "ent-a", "location_id": "loc-a"},
            {"id": "r-ok", "name": "Fine", "rate_bps": 1000, "is_default": true}
        ]}"#,
    );
    assert_eq!(
        result.tax_rates_pulled, 1,
        "the unresolvable and ambiguous rows are refused, the good one lands"
    );
    for id in ["r-ghost", "r-both"] {
        let present: i64 = store
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM tax_rates WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(present, 0, "{id} must not be stored at all");
    }
    assert_eq!(
        stored_scope(&store, "r-ok"),
        (None, None, None, None),
        "the surviving row is still the tenant-global answer"
    );
}

#[test]
fn pull_clears_a_stale_scope_when_the_server_row_is_unscoped() {
    // The ON CONFLICT assignments are unconditional, not COALESCE: a pull makes
    // the server authoritative, so a scope REMOVED at the hub must clear here.
    // COALESCE would keep a dead location scope alive forever.
    let store = setup();
    seed_scope(&store, "ent-a", "loc-a");
    store
        .conn()
        .execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, is_active, location_id) \
             VALUES ('r-x', 'Was scoped', 1100, 0, 0, 1, 'loc-a')",
            [],
        )
        .unwrap();
    assert_eq!(stored_scope(&store, "r-x").1, Some("loc-a".into()));

    pull(
        &store,
        r#"{"tax_rates": [{"id": "r-x", "name": "Now global", "rate_bps": 1100}]}"#,
    );
    assert_eq!(
        stored_scope(&store, "r-x"),
        (None, None, None, None),
        "the hub dropped the scope, so the branch must too"
    );
}
