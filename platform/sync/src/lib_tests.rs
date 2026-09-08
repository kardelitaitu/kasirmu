//! Unit tests for the platform-sync crate root (`lib.rs`): batch
//! building (P-1/P-2), the SyncError taxonomy display impls, engine
//! construction, ADR #11 server-migration propagation through the pull
//! and snapshot paths, SYNC-01 engine replay safety + durable anchor
//! advancement, dead-letter anchor retention, AnchorExpired snapshot
//! recovery + anchor reset, and RUST-04 import_snapshot validation,
//! idempotency, and rollback semantics. Extracted from the inline
//! `mod tests` in `lib.rs` (F-018).

use super::*;
use oz_core::offline::OfflineQueueItem;
use oz_core::sync_client::SyncConfig;

// ── build_batches ────────────────────────────────────────────

#[test]
fn build_batches_empty() {
    let batches = build_batches(&[], MAX_BATCH_BYTES);
    assert!(batches.is_empty());
}

#[test]
fn build_batches_single_item() {
    let items = vec![OfflineQueueItem::new("test", "{}")];
    let batches = build_batches(&items, MAX_BATCH_BYTES);
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].len(), 1);
}

#[test]
fn build_batches_multiple_items_one_batch() {
    let items: Vec<_> = (0..5)
        .map(|i| OfflineQueueItem::new("test", format!("{{\"n\":{i}}}")))
        .collect();
    // 5 tiny items should fit in one 64 KB batch.
    let batches = build_batches(&items, MAX_BATCH_BYTES);
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].len(), 5);
}

#[test]
fn build_batches_respects_byte_limit() {
    // Create payloads that force splitting: each item serialises to
    // ~33 KB (payload + JSON envelope overhead). Two items exceed the
    // 64 KB budget, forcing a split after the first item.
    let big_payload = "x".repeat(33 * 1024);
    let small = "{}";
    let items = vec![
        OfflineQueueItem::new("a", &big_payload),
        OfflineQueueItem::new("b", &big_payload),
        OfflineQueueItem::new("c", small),
    ];
    let batches = build_batches(&items, MAX_BATCH_BYTES);
    assert!(
        batches.len() >= 2,
        "large items should cause splitting, got {} batches",
        batches.len()
    );
    // Each batch should have at least 1 item.
    for batch in &batches {
        assert!(!batch.is_empty(), "no empty batches allowed");
    }
}

#[test]
fn build_batches_sorts_by_priority() {
    use oz_core::offline::SyncPriority;

    let critical = OfflineQueueItem::with_priority("a", "{}", SyncPriority::Critical);
    let normal = OfflineQueueItem::with_priority("b", "{}", SyncPriority::Normal);
    let low = OfflineQueueItem::with_priority("c", "{}", SyncPriority::Low);
    // Put them in reverse priority order to verify sorting.
    let items = vec![low.clone(), normal.clone(), critical.clone()];
    let batches = build_batches(&items, MAX_BATCH_BYTES);
    // All 3 small items should fit in one batch, but Critical must be first.
    assert_eq!(batches.len(), 1);
    let batch = &batches[0];
    assert_eq!(batch[0].priority, SyncPriority::Critical);
    assert_eq!(batch[1].priority, SyncPriority::Normal);
    assert_eq!(batch[2].priority, SyncPriority::Low);
}

#[test]
fn build_batches_minimum_one_item_per_batch() {
    // An item larger than the byte limit still gets its own batch
    // (minimum 1 item per batch, no empty requests).
    let huge = "x".repeat(128 * 1024); // 128 KB payload
    let items = vec![OfflineQueueItem::new("huge", &huge)];
    let batches = build_batches(&items, MAX_BATCH_BYTES);
    assert_eq!(batches.len(), 1, "single huge item still gets a batch");
    assert_eq!(batches[0].len(), 1);
}

// ── SyncError ────────────────────────────────────────────────

#[test]
fn sync_error_transport_display() {
    let err = SyncError::Transport("connection timeout".into());
    assert_eq!(err.to_string(), "transport error: connection timeout");
}

#[test]
fn sync_error_queue_display() {
    let err = SyncError::Queue("item not found".into());
    assert_eq!(err.to_string(), "queue error: item not found");
}

#[test]
fn sync_error_replication_display() {
    let err = SyncError::Replication("push failed".into());
    assert_eq!(err.to_string(), "replication error: push failed");
}

#[test]
fn sync_error_conflict_display() {
    let err = SyncError::Conflict("version mismatch".into());
    assert_eq!(err.to_string(), "conflict error: version mismatch");
}

#[test]
fn sync_error_config_display() {
    let err = SyncError::Config("missing server URL".into());
    assert_eq!(err.to_string(), "configuration error: missing server URL");
}

#[test]
fn sync_error_database_display() {
    let err = SyncError::Database(oz_core::CoreError::NotFound {
        entity: "item",
        id: "x".into(),
    });
    let msg = err.to_string();
    assert!(
        msg.contains("database error"),
        "expected database error, got: {msg}"
    );
    assert!(
        msg.contains("not found"),
        "expected 'not found' in message, got: {msg}"
    );
}

#[test]
fn sync_error_server_migrated_display() {
    let err = SyncError::ServerMigrated {
        new_url: "https://new.example.com".into(),
    };
    assert_eq!(
        err.to_string(),
        "server migrated to https://new.example.com"
    );
}

#[test]
fn sync_error_server_migrated_debug() {
    let err = SyncError::ServerMigrated {
        new_url: "https://new.example.com".into(),
    };
    let debug = format!("{err:?}");
    assert!(debug.contains("ServerMigrated"));
    assert!(debug.contains("https://new.example.com"));
}

#[test]
fn sync_error_debug() {
    let err = SyncError::Transport("e".into());
    assert!(!format!("{err:?}").is_empty());
}

#[test]
fn sync_error_from_requwest_error() {
    // Verify the From<reqwest::Error> impl compiles by checking the
    // conversion function signature at compile time.
    fn assert_convert(_e: reqwest::Error) -> SyncError {
        SyncError::from(_e)
    }
    let _ = assert_convert;
}

// ── SyncEngine ───────────────────────────────────────────────

#[test]
fn sync_engine_new_creates_transport() {
    let config = SyncConfig {
        server_url: "http://localhost:3099".into(),
        api_key: None,
    };
    let engine = SyncEngine::new(config);
    assert_eq!(engine.config.server_url, "http://localhost:3099");
}

#[test]
fn sync_engine_new_with_api_key() {
    let config = SyncConfig {
        server_url: "http://localhost:3099".into(),
        api_key: Some("sk-key".into()),
    };
    let engine = SyncEngine::new(config);
    assert_eq!(engine.config.api_key, Some("sk-key".into()));
}

// ── SyncResult ───────────────────────────────────────────────

#[test]
fn sync_result_ok() {
    let result: SyncResult<i32> = Ok(42);
    assert_eq!(result.unwrap(), 42);
}

#[test]
fn sync_result_err() {
    let result: SyncResult<i32> = Err(SyncError::Config("bad config".into()));
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "configuration error: bad config"
    );
}

// ── ADR #11: run_sync_cycle snapshot redirect propagation ─

#[tokio::test]
async fn run_sync_cycle_propagates_snapshot_server_migrated() {
    use oz_core::db::Store;
    use oz_core::migrations;

    let new_url = "https://snapshot-propagated.example.com";
    // Server returns 410 on pull → triggers AnchorExpired → snapshot
    // path. Snapshot returns 421 → ServerMigrated should propagate.
    let server_url = crate::test_helpers::spawn_anchor_then_redirect_server(new_url).await;

    let db = migrations::fresh_db();
    let store = Store::new(&db);
    // Enqueue one item so push succeeds (server accepts everything),
    // then pull gets 410 → snapshot gets 421.
    store
        .enqueue_offline("test_action", r#"{"val":1}"#)
        .unwrap();

    let config = SyncConfig {
        server_url: server_url.clone(),
        api_key: None,
    };
    let engine = SyncEngine::new(config);

    let result = engine.run_sync_cycle(&store).await;

    match result {
        Err(SyncError::ServerMigrated { new_url: url }) => {
            assert_eq!(url, new_url, "ServerMigrated should carry the new_url");
        }
        other => panic!(
            "expected SyncError::ServerMigrated from snapshot path, got {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn run_sync_cycle_propagates_pull_server_migrated() {
    use oz_core::db::Store;
    use oz_core::migrations;

    let new_url = "https://pull-propagated.example.com";
    // Server returns 421 on all endpoints — pull gets it directly.
    let server_url = crate::test_helpers::spawn_redirect_server(new_url).await;

    let db = migrations::fresh_db();
    let store = Store::new(&db);

    let config = SyncConfig {
        server_url: server_url.clone(),
        api_key: None,
    };
    let engine = SyncEngine::new(config);

    let result = engine.run_sync_cycle(&store).await;

    match result {
        Err(SyncError::ServerMigrated { new_url: url }) => {
            assert_eq!(url, new_url, "ServerMigrated should carry the new_url");
        }
        other => panic!(
            "expected SyncError::ServerMigrated from pull path, got {:?}",
            other
        ),
    }
}

// ── SYNC-01 parity: engine pull is replay-safe + anchor-advanced ─

/// Spawn a mock server whose pull endpoint ALWAYS returns the same
/// remote `stock.adjusted` item regardless of the `since`/`cursor`
/// request params — simulates a server that replays history or a
/// client whose anchor was lost. `/api/health` is served so the
/// engine's pre-sync health check passes.
async fn spawn_replaying_engine_server() -> String {
    use crate::transport::{PullResponse, PushOutcome, PushResponse};
    use axum::{
        Json, Router,
        routing::{get, post},
    };

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "stock.adjusted",
            r#"{"sku":"COFFEE","delta":10}"#,
        );
        // Fixed id + timestamp so the SAME remote item is returned on
        // every pull — exactly the replay scenario SYNC-01 targets.
        // Deliberately ignores the since/cursor params, like a server
        // that no longer retains history past its anchor.
        item.id = "remote-engine-replay-1".into();
        item.created_at = "2026-01-01T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/health", get(|| async { axum::http::StatusCode::OK }))
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-01 regression at the ENGINE level: the immediate/manual sync
/// path must apply a replayed remote item exactly once and persist the
/// durable pull anchor, matching the daemon. Previously the engine
/// derived `since` from the local queue's synced timestamps — which
/// pulled remote items never move — so every cycle re-fetched and
/// re-applied the same remote mutations (silent inventory corruption).
#[tokio::test]
async fn engine_applies_replayed_remote_item_only_once() {
    use oz_core::db::Store;
    use oz_core::migrations;

    let server_url = spawn_replaying_engine_server().await;
    let db = migrations::fresh_db();
    let store = Store::new(&db);

    // Seed product + inventory so the remote +10 adjustment has a target.
    db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
             VALUES ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at)
             VALUES ('prod-coffee', 50, '2026-01-01T00:00:00.000Z');",
        )
        .unwrap();

    let engine = SyncEngine::new(SyncConfig {
        server_url: server_url.clone(),
        api_key: None,
    });

    // Cycle 1: applies the +10 delta (50 → 60) and advances the anchor.
    let result_1 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_1.pulled, 1, "first cycle must pull the remote item");
    assert_eq!(store.get_stock("prod-coffee").unwrap(), 60);

    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(
        pull_state.since.as_deref(),
        Some("2026-01-01T00:00:00.000Z"),
        "durable pull anchor must be persisted after the first cycle"
    );

    // Cycle 2: the server replays the SAME item. The idempotency
    // ledger must skip it — stock stays 60, not 70.
    let result_2 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(
        result_2.pulled, 1,
        "second cycle re-pulls the replayed item"
    );
    assert_eq!(
        store.get_stock("prod-coffee").unwrap(),
        60,
        "replayed remote item must NOT be applied a second time (SYNC-01)"
    );

    let ledger_rows: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM sync_applied_items WHERE item_id = 'remote-engine-replay-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ledger_rows, 1, "ledger must hold exactly one receipt");
}

/// Spawn a mock server whose pull endpoint ALWAYS returns a malformed
/// remote sale (a line referencing a product that does not exist), so
/// `apply_remote_atomic` fails on every attempt.
async fn spawn_poison_engine_server() -> String {
    use crate::transport::{PullResponse, PushOutcome, PushResponse};
    use axum::{
        Json, Router,
        routing::{get, post},
    };

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "complete_sale",
            r#"{"line_items":[{"sku":"MISSING","qty":1}]}"#,
        );
        item.id = "remote-engine-poison-1".into();
        item.created_at = "2026-01-03T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/health", get(|| async { axum::http::StatusCode::OK }))
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// Engine-level dead-letter test (parity with the daemon's
/// `daemon_retains_anchor_until_remote_item_is_dead_lettered`): a poison
/// remote item must retain the durable anchor while it is retryable,
/// then allow the anchor to advance after the third failed attempt
/// dead-letters it.
#[tokio::test]
async fn engine_retains_anchor_until_remote_item_is_dead_lettered() {
    use oz_core::db::Store;
    use oz_core::migrations;

    let server_url = spawn_poison_engine_server().await;
    let db = migrations::fresh_db();
    let store = Store::new(&db);

    let engine = SyncEngine::new(SyncConfig {
        server_url: server_url.clone(),
        api_key: None,
    });

    for attempt in 1..=3 {
        let result = engine.run_sync_cycle(&store).await.unwrap();
        assert_eq!(
            result.pulled, 1,
            "cycle {attempt} must pull the poison item"
        );

        let pull_state = store.get_sync_pull_state().unwrap();
        let dead_lettered = store
            .is_remote_failure_dead_lettered("remote-engine-poison-1")
            .unwrap();

        if attempt < 3 {
            assert!(
                pull_state.since.is_none(),
                "retryable failure must retain the anchor (attempt {attempt})"
            );
            assert!(!dead_lettered);
        } else {
            assert!(
                pull_state.since.is_some(),
                "dead-lettered item may advance the anchor"
            );
            assert!(dead_lettered);
        }
    }

    let attempts: i64 = db
        .query_row(
            "SELECT attempts FROM sync_remote_failures WHERE item_id = 'remote-engine-poison-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempts, 3);
}

// ── AnchorExpired snapshot recovery: durable anchor reset ───────

/// Spawn a mock server whose pull endpoint mirrors the real cloud
/// server's P-1 retention check: it returns 410 `anchor_expired` ONLY
/// when the client's `since` predates the server's oldest retained row
/// (`2026-02-01`), and otherwise serves a remote `stock.adjusted` item.
/// The snapshot endpoint returns a valid reference-data snapshot and
/// counts every hit via the shared [`std::sync::atomic::AtomicUsize`].
async fn spawn_anchor_expired_then_healthy_server()
-> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use crate::transport::{PullResponse, PushOutcome, PushResponse};
    use axum::{
        Json, Router,
        extract::State,
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    const OLDEST_AVAILABLE: &str = "2026-02-01T00:00:00.000Z";

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let snapshot_hits = std::sync::Arc::new(AtomicUsize::new(0));

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }

    // 410 only when `since` predates the retention floor; a reset anchor
    // (== oldest_available) flows items normally.
    async fn handle_pull(Json(req): Json<crate::transport::PullRequest>) -> impl IntoResponse {
        if let Some(ref since) = req.since
            && since.as_str() < OLDEST_AVAILABLE
        {
            return (
                StatusCode::GONE,
                Json(serde_json::json!({
                    "error": "anchor_expired",
                    "oldest_available": OLDEST_AVAILABLE,
                })),
            )
                .into_response();
        }
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "stock.adjusted",
            r#"{"sku":"COFFEE","delta":5}"#,
        );
        item.id = "post-snapshot-item".into();
        item.created_at = "2026-03-01T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
        .into_response()
    }

    async fn handle_snapshot(
        State(hits): State<std::sync::Arc<AtomicUsize>>,
    ) -> Json<crate::transport::SyncSnapshotResponse> {
        hits.fetch_add(1, Ordering::SeqCst);
        Json(crate::transport::SyncSnapshotResponse {
            version: 1,
            products: vec![crate::transport::SnapshotProduct {
                id: "p-snap".into(),
                sku: "SNAPSHOT-COFFEE".into(),
                name: "Snapshot Coffee".into(),
                price_minor: 350,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: None,
                ..Default::default()
            }],
            tax_rates: vec![],
            users: vec![],
        })
    }

    async fn handle_health() -> impl IntoResponse {
        (StatusCode::OK, Json(serde_json::json!({"status": "ok"})))
    }

    let app = Router::new()
        .route("/api/health", get(handle_health))
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .route("/api/sync/snapshot", get(handle_snapshot))
        .with_state(snapshot_hits.clone());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), snapshot_hits)
}

/// Regression: after an `AnchorExpired` snapshot import succeeds, the
/// durable pull anchor must be reset (to the server's oldest retained
/// row, or cleared) so the next cycle is not expired again. Previously
/// the stale anchor was kept, so every cycle re-triggered AnchorExpired
/// and re-fetched the whole snapshot.
#[tokio::test]
async fn engine_resets_anchor_after_snapshot_import() {
    use oz_core::db::Store;
    use oz_core::migrations;
    use std::sync::atomic::Ordering;

    let (server_url, snapshot_hits) = spawn_anchor_expired_then_healthy_server().await;
    let db = migrations::fresh_db();
    let store = Store::new(&db);

    // Seed product + inventory so the post-reset +5 adjustment has a
    // target.
    db.execute_batch(
            "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
             VALUES ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
             INSERT INTO inventory (product_id, qty, updated_at)
             VALUES ('prod-coffee', 50, '2026-01-01T00:00:00.000Z');",
        )
        .unwrap();

    // A pre-existing stale anchor, older than the server's oldest
    // retained row — P-1 retention has pruned the gap.
    store
        .set_sync_pull_state(Some("2025-01-01T00:00:00.000Z"), None)
        .unwrap();

    let engine = SyncEngine::new(SyncConfig {
        server_url: server_url.clone(),
        api_key: None,
    });

    // Cycle 1: stale anchor → 410 → snapshot fetched + imported.
    let result_1 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_1.pulled, 0, "cycle 1 expires before pulling items");
    assert_eq!(
        snapshot_hits.load(Ordering::SeqCst),
        1,
        "snapshot fetched exactly once in cycle 1"
    );
    // The snapshot import must have actually landed — the anchor reset
    // is conditional on a successful import.
    assert!(
        store
            .product_id_by_sku("SNAPSHOT-COFFEE")
            .unwrap()
            .is_some(),
        "snapshot reference data must be imported before the anchor resets"
    );
    // The durable anchor must be reset to the server's oldest retained
    // row so the next pull is not expired again.
    let state = store.get_sync_pull_state().unwrap();
    assert_eq!(
        state.since.as_deref(),
        Some("2026-02-01T00:00:00.000Z"),
        "durable anchor must advance to oldest_available after snapshot import"
    );
    assert_eq!(
        state.cursor, None,
        "cursor must be cleared after snapshot import"
    );

    // Cycle 2: the reset anchor is no longer expired — items flow, and
    // the snapshot is NOT fetched again.
    let result_2 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_2.pulled, 1, "cycle 2 pulls the post-snapshot item");
    assert_eq!(
        store.get_stock("prod-coffee").unwrap(),
        55,
        "post-snapshot +5 adjustment must apply"
    );
    assert_eq!(
        snapshot_hits.load(Ordering::SeqCst),
        1,
        "snapshot must NOT be re-fetched after the anchor reset"
    );
}

// ── P1-4: import_snapshot tests ───────────────────────────────

/// Seed a role so user FK constraints are satisfied.
fn seed_role(conn: &rusqlite::Connection, id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name) VALUES (?1, ?2)",
        rusqlite::params![id, format!("Role {id}")],
    )
    .unwrap();
}

fn verify_product_sku_exists(sku: &str, store: &Store<'_>) -> bool {
    store.product_id_by_sku(sku).ok().flatten().is_some()
}

/// Build a typed snapshot product (RUST-04) with valid defaults.
fn product(sku: &str, name: &str, price_minor: i64) -> transport::SnapshotProduct {
    transport::SnapshotProduct {
        id: format!("id-{sku}"),
        sku: sku.to_owned(),
        name: name.to_owned(),
        price_minor,
        currency: "USD".to_owned(),
        category_id: None,
        barcode: None,
        created_at: None,
        updated_at: None,
        price_updated_at: None,
        track_serial: false,
        store_id: None,
        brand: None,
        rack_location: None,
        notes: None,
        unit: None,
        is_active: true,
    }
}

/// Build a typed snapshot tax rate (RUST-04) with valid defaults.
///
/// Unscoped: every field of the scope/window block is `None`, which is the
/// tenant-global legacy shape — what a payload from a pre-20260921 server
/// deserializes to. Scoped tests set the fields explicitly.
fn tax_rate(id: &str, name: &str, rate_bps: i64) -> transport::SnapshotTaxRate {
    transport::SnapshotTaxRate {
        id: id.to_owned(),
        name: name.to_owned(),
        rate_bps,
        is_default: false,
        is_inclusive: false,
        created_at: None,
        updated_at: None,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
    }
}

/// Build a typed snapshot user (RUST-04) with valid defaults.
fn user(username: &str, display_name: &str, role_id: &str) -> transport::SnapshotUser {
    transport::SnapshotUser {
        id: format!("id-{username}"),
        username: username.to_owned(),
        display_name: display_name.to_owned(),
        role_id: role_id.to_owned(),
        is_active: true,
        created_at: None,
        updated_at: None,
    }
}

#[test]
fn import_snapshot_empty_returns_zero() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![],
        users: vec![],
    };
    let count = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(count, 0, "empty snapshot should import 0 rows");
}

#[test]
fn import_snapshot_single_product() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-1".into(),
            sku: "COFFEE-001".into(),
            name: "Coffee Beans".into(),
            price_minor: 15000,
            currency: "IDR".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    let count = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(count, 1, "one product should import 1 row");

    // Verify the product was created.
    assert!(store.product_id_by_sku("COFFEE-001").unwrap().is_some());
}

#[test]
fn import_snapshot_rejects_blank_sku() {
    // RUST-04: blank required fields must be rejected BEFORE the
    // transaction opens (previously they imported with defaults).
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-bad".into(),
            sku: "  ".into(),
            name: "No SKU Product".into(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "product with blank sku must be rejected (RUST-04)"
    );
    assert!(!verify_product_sku_exists("", &store));
}

#[test]
fn import_snapshot_rejects_blank_name() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-bad".into(),
            sku: "NO-NAME".into(),
            name: String::new(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "product with blank name must be rejected (RUST-04)"
    );
    assert!(!verify_product_sku_exists("NO-NAME", &store));
}

#[test]
fn import_snapshot_rejects_negative_price() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-bad".into(),
            sku: "NEG-PRICE".into(),
            name: "Negative Price".into(),
            price_minor: -100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "product with negative price_minor must be rejected (RUST-04)"
    );
}

#[test]
fn import_snapshot_rejects_blank_tax_rate() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![transport::SnapshotTaxRate {
            id: String::new(),
            name: "Blank Tax".into(),
            rate_bps: 1000,
            is_default: false,
            is_inclusive: false,
            created_at: None,
            updated_at: None,
            legal_entity_id: None,
            location_id: None,
            effective_from: None,
            effective_to: None,
        }],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "tax rate with blank id must be rejected (RUST-04)"
    );
}

#[test]
fn import_snapshot_rejects_blank_user_fields() {
    // RUST-04: users must carry username/display_name/role_id;
    // previously a missing role_id imported as the empty string
    // (masking a malformed snapshot).
    let conn = oz_core::migrations::fresh_db();
    seed_role(&conn, "role-real");
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![],
        users: vec![transport::SnapshotUser {
            id: "u-corrupt".into(),
            username: "corrupted-staff".into(),
            display_name: "Corrupted Staff".into(),
            role_id: String::new(),
            is_active: true,
            created_at: None,
            updated_at: None,
        }],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "user with blank role_id must be rejected (RUST-04)"
    );
    let users = store.list_users().unwrap();
    assert!(!users.iter().any(|u| u.username == "corrupted-staff"));
}

#[test]
fn import_snapshot_rejects_newer_schema_version() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 999,
        products: vec![product("V-TOO-NEW", "Too New", 100)],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "snapshot with unsupported schema version must be rejected (RUST-04)"
    );
    assert!(!verify_product_sku_exists("V-TOO-NEW", &store));
}

#[test]
fn import_snapshot_idempotent_second_call_same_count() {
    let conn = oz_core::migrations::fresh_db();
    seed_role(&conn, "role-1");
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![product("IDEMPOTENT-1", "Idempotent Product", 5000)],
        tax_rates: vec![tax_rate("tax-vat-10", "VAT 10%", 1000)],
        users: vec![user("admin", "Admin", "role-1")],
    };
    let first = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(first, 3, "first import: 3 rows");

    let second = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(
        second, 3,
        "second import should also return 3 (ON CONFLICT upserts)"
    );
}

#[test]
fn import_snapshot_overwrites_existing_product() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot_v1 = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![product("UPDATABLE", "Old Name", 1000)],
        tax_rates: vec![],
        users: vec![],
    };
    import_snapshot(&store, &snapshot_v1).unwrap();

    let snapshot_v2 = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![product("UPDATABLE", "New Name", 2000)],
        tax_rates: vec![],
        users: vec![],
    };
    import_snapshot(&store, &snapshot_v2).unwrap();

    assert!(store.product_id_by_sku("UPDATABLE").unwrap().is_some());
}

#[test]
fn import_snapshot_overwrites_existing_user() {
    let conn = oz_core::migrations::fresh_db();
    seed_role(&conn, "role-admin");
    let store = Store::new(&conn);
    let snapshot_v1 = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![],
        users: vec![transport::SnapshotUser {
            id: "u-staff".into(),
            username: "staff-1".into(),
            display_name: "Old Display".into(),
            role_id: "role-admin".into(),
            is_active: true,
            created_at: None,
            updated_at: None,
        }],
    };
    import_snapshot(&store, &snapshot_v1).unwrap();

    let snapshot_v2 = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![],
        users: vec![transport::SnapshotUser {
            id: "u-staff".into(),
            username: "staff-1".into(),
            display_name: "New Display".into(),
            role_id: "role-admin".into(),
            is_active: false,
            created_at: None,
            updated_at: None,
        }],
    };
    import_snapshot(&store, &snapshot_v2).unwrap();

    let users = store.list_users().unwrap();
    let user = users.into_iter().find(|u| u.username == "staff-1").unwrap();
    // SYNC-06: pin_hash is NEVER read from the snapshot. The first
    // import writes the non-verifiable placeholder, and the second
    // import preserves it (the UPDATE clause omits pin_hash) — even
    // though the snapshot carried "new-hash", it must not land in DB.
    assert_eq!(user.pin_hash, "!snapshot-no-credential!");
    assert_ne!(user.pin_hash, "new-hash");
    assert_eq!(user.display_name, "New Display");
    assert!(!user.is_active);
}

#[test]
fn import_snapshot_rejects_corrupted_product() {
    // RUST-04: a corrupted row (missing required fields) is rejected at
    // deserialization; a blank name is rejected here before the
    // transaction opens — never imported with defaults.
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-corrupt".into(),
            sku: "CORRUPTED".into(),
            name: String::new(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "corrupted product must be rejected, not imported with defaults (RUST-04)"
    );
    assert!(!verify_product_sku_exists("CORRUPTED", &store));
}

#[test]
fn import_snapshot_out_of_schema_fields_ignored() {
    let conn = oz_core::migrations::fresh_db();
    seed_role(&conn, "role-1");
    let store = Store::new(&conn);
    // RUST-04: unknown/extra fields stay wire-compatible — serde drops
    // them during deserialization (no deny_unknown_fields), so a server
    // that adds forward-compatible fields does not break the client.
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-extra".into(),
            sku: "EXTRA-FIELDS".into(),
            name: "Has Extra".into(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![tax_rate("tax-extra", "Extra Tax", 500)],
        users: vec![user("extra-user", "Extra User", "role-1")],
    };
    // Also assert the wire shape tolerates unknown keys at the serde
    // boundary (unknown fields are ignored, matching the DTO derives).
    let wire = serde_json::json!({
        "version": 1,
        "products": [{"id":"p-extra","sku":"EXTRA-FIELDS","name":"Has Extra","price_minor":100,"currency":"USD","future_field":"kept"}],
        "tax_rates": [{"id":"tax-extra","name":"Extra Tax","rate_bps":500,"future_flag":true}],
        "users": [{"id":"u-extra","username":"extra-user","display_name":"Extra User","role_id":"role-1","metadata":"ignored"}]
    });
    let _rt: transport::SyncSnapshotResponse =
        serde_json::from_value(wire).expect("unknown fields are tolerated");
    let count = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(count, 3, "all 3 entities with extra fields should import");
}

#[test]
fn import_snapshot_all_types_multiple_entities() {
    let conn = oz_core::migrations::fresh_db();
    seed_role(&conn, "r1");
    seed_role(&conn, "r2");
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![
            product("A", "Product A", 100),
            product("B", "Product B", 200),
            product("C", "Product C", 300),
        ],
        tax_rates: vec![tax_rate("tax-ppn", "PPN", 1100)],
        users: vec![user("user-a", "A", "r1"), user("user-b", "B", "r2")],
    };
    let count = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(count, 6, "3 products + 1 tax rate + 2 users = 6 rows");

    // Verify all products exist.
    assert!(verify_product_sku_exists("A", &store));
    assert!(verify_product_sku_exists("B", &store));
    assert!(verify_product_sku_exists("C", &store));

    // Verify tax rate exists.
    let tax = store.get_tax_rate("tax-ppn").unwrap().unwrap();
    assert_eq!(tax.rate_bps, 1100);

    // Verify users exist.
    let users = store.list_users().unwrap();
    assert!(users.iter().any(|u| u.username == "user-a"));
    assert!(users.iter().any(|u| u.username == "user-b"));
}

#[test]
fn import_snapshot_partial_rollback_on_error() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);

    // First import valid product data.
    let valid = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![product("VALID", "Valid", 100)],
        tax_rates: vec![],
        users: vec![],
    };
    import_snapshot(&store, &valid).unwrap();
    assert!(verify_product_sku_exists("VALID", &store));

    // Now try to import a user with a non-existent role_id (FK violation).
    let invalid = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![],
        users: vec![user("broken-user", "Broken", "nonexistent-role")],
    };
    let result = import_snapshot(&store, &invalid);
    assert!(result.is_err(), "FK violation should cause error");

    // The invalid user should NOT be in the DB (transaction rolled back).
    let users = store.list_users().unwrap();
    assert!(
        !users.iter().any(|u| u.username == "broken-user"),
        "broken user should not exist after rollback"
    );

    // Previously valid product should still exist (separate transaction).
    assert!(
        verify_product_sku_exists("VALID", &store),
        "previously imported product should survive"
    );
}

#[test]
fn import_snapshot_null_barcode_stored_as_null() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![transport::SnapshotProduct {
            id: "p-nobc".into(),
            sku: "NO-BARCODE".into(),
            name: "No Barcode".into(),
            price_minor: 100,
            currency: "USD".into(),
            category_id: None,
            barcode: None,
            created_at: None,
            updated_at: None,
            price_updated_at: None,
            track_serial: false,
            store_id: None,
            ..Default::default()
        }],
        tax_rates: vec![],
        users: vec![],
    };
    import_snapshot(&store, &snapshot).unwrap();

    let exists = verify_product_sku_exists("NO-BARCODE", &store);
    assert!(exists, "product with null barcode should be created");
}

#[test]
fn import_snapshot_preserves_store_scoping() {
    // Phase B: the snapshot import must land store-tagged rows scoped.
    // A product tagged with store-a stays visible only to store-a (plus
    // the global catalog) — never store-b's — exercising the ?13
    // store_id write-through in the products upsert.
    let conn = oz_core::migrations::fresh_db();
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES \
             ('store-a', 'Store A'), ('store-b', 'Store B')",
    )
    .unwrap();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![
            transport::SnapshotProduct {
                id: "p-a".into(),
                sku: "SKU-A".into(),
                name: "Prod A".into(),
                price_minor: 100,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: Some("store-a".into()),
                ..Default::default()
            },
            transport::SnapshotProduct {
                id: "p-b".into(),
                sku: "SKU-B".into(),
                name: "Prod B".into(),
                price_minor: 200,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: Some("store-b".into()),
                ..Default::default()
            },
            transport::SnapshotProduct {
                id: "p-g".into(),
                sku: "SKU-G".into(),
                name: "Prod Global".into(),
                price_minor: 300,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: None,
                ..Default::default()
            },
        ],
        tax_rates: vec![],
        users: vec![],
    };
    import_snapshot(&store, &snapshot).unwrap();

    let a = store.list_products_for_store("store-a").unwrap();
    let mut a_ids: Vec<&str> = a.iter().map(|p| p.product.sku.as_str()).collect();
    a_ids.sort_unstable();
    assert_eq!(
        a_ids,
        vec!["SKU-A", "SKU-G"],
        "store-a must see its own imported row plus the global row"
    );

    let b = store.list_products_for_store("store-b").unwrap();
    let mut b_ids: Vec<&str> = b.iter().map(|p| p.product.sku.as_str()).collect();
    b_ids.sort_unstable();
    assert_eq!(
        b_ids,
        vec!["SKU-B", "SKU-G"],
        "store-b must see its own imported row plus the global row"
    );
}

#[test]
fn import_snapshot_unknown_store_id_fails_closed_and_rolls_back() {
    // Phase B: a snapshot row tagged with a store the local DB does not
    // know must fail the FK and roll back the WHOLE import (no partial
    // products) — the same fail-closed contract as the oz-core path.
    let conn = oz_core::migrations::fresh_db();
    conn.execute(
        "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A')",
        [],
    )
    .unwrap();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![
            transport::SnapshotProduct {
                id: "p-ok".into(),
                sku: "SKU-OK".into(),
                name: "Valid".into(),
                price_minor: 100,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: Some("store-a".into()),
                ..Default::default()
            },
            transport::SnapshotProduct {
                id: "p-ghost".into(),
                sku: "SKU-GHOST".into(),
                name: "Ghost".into(),
                price_minor: 200,
                currency: "USD".into(),
                category_id: None,
                barcode: None,
                created_at: None,
                updated_at: None,
                price_updated_at: None,
                track_serial: false,
                store_id: Some("ghost-store".into()),
                ..Default::default()
            },
        ],
        tax_rates: vec![],
        users: vec![],
    };
    let result = import_snapshot(&store, &snapshot);
    assert!(
        result.is_err(),
        "snapshot row for an unknown store must fail the FK"
    );

    // No partial import — the whole transaction rolled back.
    let count: i64 = store
        .conn()
        .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        count, 0,
        "failed import must leave no products behind (transaction rolled back)"
    );
}

// ── Scoped tax rates over the sync channel ───────────────────────
//
// The four columns added by 20260921_tax_rate_scoping.sql must travel with the
// rate. A scoped row that arrives WITHOUT its scope lands as NULL, and NULL
// scope IS the tenant-global answer — one location's rate would then price
// every location that pulled it. Absence is not neutral in this table.

fn seed_scope(conn: &rusqlite::Connection, entity: &str, location: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO legal_entities (id, tenant_id, name) VALUES (?1, 'default', ?1)",
        rusqlite::params![entity],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?1)",
        rusqlite::params![location],
    )
    .unwrap();
}

/// Read back the scope + window of one stored rate.
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

fn scoped_rate(id: &str, bps: i64) -> transport::SnapshotTaxRate {
    transport::SnapshotTaxRate {
        location_id: Some("loc-a".into()),
        effective_from: Some("2026-01-01".into()),
        effective_to: Some("2027-01-01".into()),
        ..tax_rate(id, "Scoped", bps)
    }
}

#[test]
fn import_snapshot_lands_a_scoped_tax_rate_as_scoped() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    seed_scope(&conn, "ent-a", "loc-a");
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![scoped_rate("r-scoped", 1100)],
        users: vec![],
    };
    assert_eq!(import_snapshot(&store, &snapshot).unwrap(), 1);
    assert_eq!(
        stored_scope(&store, "r-scoped"),
        (
            None,
            Some("loc-a".into()),
            Some("2026-01-01".into()),
            Some("2027-01-01".into())
        ),
        "scope and window must survive the wire verbatim"
    );
}

#[test]
fn import_snapshot_lands_an_unscoped_tax_rate_as_tenant_global() {
    // The back-compat direction, pinned: a payload with NO scope keys — which
    // is every payload a pre-20260921 server sends — lands as the tenant-global
    // legacy row, exactly as it did before the columns existed.
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![tax_rate("r-legacy", "Legacy", 1000)],
        users: vec![],
    };
    import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(
        stored_scope(&store, "r-legacy"),
        (None, None, None, None),
        "no scope keys means tenant-global"
    );
}

#[test]
fn import_snapshot_refuses_a_scoped_rate_whose_target_is_absent_locally() {
    // The deliberate DEVIATION from the products convention above: an
    // unresolvable scope does NOT roll back the import. The two alternatives
    // were "fail every pull for this tenant" and "flatten the scope", and
    // flattening is the money bug this whole path exists to close. Refusing one
    // row degrades to "no scoped rate here", which is what the branch had.
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    seed_scope(&conn, "ent-a", "loc-a");
    let mut ghost = scoped_rate("r-ghost", 1500);
    ghost.location_id = Some("loc-ghost".into());
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![
            ghost,
            tax_rate("r-global", "Global", 1000),
            scoped_rate("r-scoped", 1100),
        ],
        users: vec![],
    };
    let written = import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(
        written, 2,
        "the unresolvable row is skipped, its two siblings still import"
    );
    let ghost_present: i64 = store
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM tax_rates WHERE id = 'r-ghost'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ghost_present, 0, "a refused row is not written at all");
    // And critically: it was NOT flattened into a tenant-global rate.
    assert_eq!(
        stored_scope(&store, "r-scoped").1,
        Some("loc-a".into()),
        "the sibling scoped row keeps its scope"
    );
}

#[test]
fn import_snapshot_refuses_a_rate_scoped_to_both_columns() {
    // Ambiguous, not narrower. The branch refuses rather than picking whichever
    // column it read first — the same rule TaxRateScope encodes.
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    seed_scope(&conn, "ent-a", "loc-a");
    let mut both = scoped_rate("r-both", 1500);
    both.legal_entity_id = Some("ent-a".into());
    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![both],
        users: vec![],
    };
    assert_eq!(
        import_snapshot(&store, &snapshot).unwrap(),
        0,
        "an ambiguous scope is never applied"
    );
}

#[test]
fn import_snapshot_clears_a_stale_scope_when_the_server_row_is_unscoped() {
    // The ON CONFLICT clause assigns the four columns UNCONDITIONALLY, not via
    // COALESCE. The server is the authoritative copy in a pull, so a scope
    // removed at the hub must clear at the branch — COALESCE would keep a dead
    // scope alive forever.
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    seed_scope(&conn, "ent-a", "loc-a");
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, is_active, location_id) \
         VALUES ('r-x', 'Was scoped', 1100, 0, 0, 1, 'loc-a')",
        [],
    )
    .unwrap();
    assert_eq!(stored_scope(&store, "r-x").1, Some("loc-a".into()));

    let snapshot = transport::SyncSnapshotResponse {
        version: 1,
        products: vec![],
        tax_rates: vec![tax_rate("r-x", "Now global", 1100)],
        users: vec![],
    };
    import_snapshot(&store, &snapshot).unwrap();
    assert_eq!(
        stored_scope(&store, "r-x"),
        (None, None, None, None),
        "the hub cleared the scope, so the branch must too"
    );
}
