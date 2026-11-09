//! Integration test: offline sale → sync → verify on server.
//!
//! Spins up a lightweight axum test server, seeds the local offline queue,
//! runs a sync cycle, and verifies the server received the data and the
//! local items were marked as synced.

use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use kasirmu_core::{
    Store,
    inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId},
    migrations,
    offline::{OfflineQueueItem, OfflineQueueStatus},
    sync_client::SyncConfig,
};
use platform_sync::{
    SyncEngine,
    transport::{
        PullRequest, PullResponse, PushOutcome, PushResponse, SnapshotProduct, SnapshotTaxRate,
        SnapshotUser, SyncSnapshotResponse,
    },
};

// ── Test HTTP server ─────────────────────────────────────────────────

/// Shared state capturing what the test server receives.
#[derive(Clone, Default)]
struct TestServerState {
    received_pushes: Arc<Mutex<Vec<OfflineQueueItem>>>,
}

/// Test server bundle returned by [`spawn_test_server`].
struct TestServer {
    port: u16,
    state: TestServerState,
    handle: tokio::task::JoinHandle<()>,
}

/// Handler: POST /api/sync/push
async fn handle_push(
    State(state): State<TestServerState>,
    Json(items): Json<Vec<OfflineQueueItem>>,
) -> Json<PushResponse> {
    let mut pushes = state.received_pushes.lock().unwrap();
    let results: Vec<PushOutcome> = items.iter().map(|_| PushOutcome::Accepted).collect();
    pushes.extend(items);
    Json(PushResponse { results })
}

/// Handler: POST /api/sync/pull
async fn handle_pull(Json(_request): Json<PullRequest>) -> Json<PullResponse> {
    Json(PullResponse {
        items: vec![],
        next_cursor: None,
    })
}

/// Health check handler — the sync engine calls `GET /api/health` before every
/// cycle (P271 pre-sync health check). All test servers must include this route
/// or `run_sync_cycle()` will abort before attempting push/pull.
async fn handle_health() -> axum::http::StatusCode {
    axum::http::StatusCode::OK
}

/// Return a Router with `/api/health` merged in, so that `run_sync_cycle()`'s
/// pre-sync health check (P271) passes before push/pull.
fn with_health_route(app: Router) -> Router {
    app.route("/api/health", axum::routing::get(handle_health))
}

/// Start a test server on a random port and return a [`TestServer`] bundle.
async fn spawn_test_server() -> TestServer {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = TestServerState::default();
    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .route("/api/health", axum::routing::get(handle_health))
        .with_state(state.clone());

    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Brief delay so the server is ready before tests send requests.
    // Reduced from 50ms to 10ms — test setup (store + enqueue) provides
    // enough gap for the server to start accepting.
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    TestServer {
        port,
        state,
        handle,
    }
}

/// Create a test server with custom route handlers, returning both the port
/// and a join handle. Handlers are passed as an axum Router.
///
/// This avoids per-test TcpListener binding which can trigger Windows
/// firewall 403 errors with 127.0.0.1.
///
/// The `/api/health` route is automatically added so that `run_sync_cycle()`'s
/// pre-sync health check (P271) passes before the custom push/pull handlers run.
async fn spawn_custom_server(app: Router) -> (u16, tokio::task::JoinHandle<()>) {
    let app = with_health_route(app);
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (port, handle)
}

// ── Test helpers ─────────────────────────────────────────────────────

/// Create an in-memory SQLite database with migrations.
/// The caller owns the connection: `Store::new` only needs a borrow, so
/// this takes one instead of `Box::leak`ing a database per test to
/// manufacture a `'static` (O-T03).
fn setup_store(db: &rusqlite::Connection) -> Store<'_> {
    Store::new(db)
}

/// Create a `SyncConfig` pointing at the test server.
fn test_config(port: u16) -> SyncConfig {
    SyncConfig {
        server_url: format!("http://localhost:{port}"),
        api_key: None,
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn single_sale_enqueued_is_pushed_and_marked_synced() {
    let server = spawn_test_server().await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    // Enqueue a completed sale (simulating SaleSyncEnqueuer behaviour).
    let payload = serde_json::json!({
        "sale_id": "it-sale-1",
        "total_minor": 1500,
        "currency": "USD",
        "line_items": [{"sku": "COFFEE", "qty": 3, "unit_price_minor": 500}],
    })
    .to_string();

    let queued = store.enqueue_offline("complete_sale", &payload).unwrap();
    assert_eq!(queued.action, "complete_sale");
    assert_eq!(store.pending_offline_count().unwrap(), 1);

    // Run a sync cycle.
    let engine = SyncEngine::new(test_config(server.port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    // Server received the item.
    let pushes = server.state.received_pushes.lock().unwrap();
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].action, "complete_sale");
    assert!(pushes[0].payload.contains("it-sale-1"));
    drop(pushes); // release lock

    // Local item was marked as synced.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
    assert!(all[0].synced_at.is_some());
    assert_eq!(store.pending_offline_count().unwrap(), 0);

    // ReplicationResult is correct.
    assert_eq!(result.pushed, 1);
    assert_eq!(result.pulled, 0);

    server.handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn push_items_oldest_first() {
    let server = spawn_test_server().await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    // Enqueue items with a small delay between them so created_at differs.
    store.enqueue_offline("sale_1", r#"{"seq":1}"#).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    store.enqueue_offline("sale_2", r#"{"seq":2}"#).unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    store.enqueue_offline("sale_3", r#"{"seq":3}"#).unwrap();

    let engine = SyncEngine::new(test_config(server.port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    let pushes = server.state.received_pushes.lock().unwrap();
    assert_eq!(pushes.len(), 3);
    // Verify order: oldest first
    assert_eq!(pushes[0].action, "sale_1");
    assert_eq!(pushes[1].action, "sale_2");
    assert_eq!(pushes[2].action, "sale_3");
    drop(pushes);

    assert_eq!(result.pushed, 3);

    server.handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn conflict_response_marks_item_and_re_enqueues() {
    // Server that returns Conflict for the first item, then Accepted for retries.
    let conflict_count = Arc::new(Mutex::new(0i32));
    let conflict_state = conflict_count.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(move |Json(items): Json<Vec<OfflineQueueItem>>| async move {
                let mut count = conflict_state.lock().unwrap();
                if *count == 0 {
                    *count += 1;
                    let results: Vec<PushOutcome> = items
                        .iter()
                        .map(|item| PushOutcome::Conflict(item.clone()))
                        .collect();
                    Json(PushResponse { results })
                } else {
                    let results: Vec<PushOutcome> =
                        items.iter().map(|_| PushOutcome::Accepted).collect();
                    Json(PushResponse { results })
                }
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"conflict-1"}"#)
        .unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    // The first attempt gets Conflict, re-enqueues, but the engine doesn't
    // retry within the same cycle. So the item should be marked synced
    // (because conflict resolution calls mark_synced) and re-enqueued.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1, "conflict should mark original as synced");
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);

    assert_eq!(result.pushed, 1);

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn rejected_item_marked_failed() {
    let app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async {
                let results = vec![
                    PushOutcome::Accepted,
                    PushOutcome::Rejected {
                        reason: "invalid payload".into(),
                    },
                    PushOutcome::Accepted,
                ];
                Json(PushResponse { results })
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store.enqueue_offline("a", "{}").unwrap();
    store.enqueue_offline("b", "{}").unwrap();
    store.enqueue_offline("c", "{}").unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result.pushed, 3);

    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 3);

    // Items a and c should be synced; item b should be failed.
    let statuses: Vec<OfflineQueueStatus> = all.iter().map(|i| i.status).collect();
    assert!(statuses.contains(&OfflineQueueStatus::Synced));
    assert!(statuses.contains(&OfflineQueueStatus::Failed));

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn pull_returns_items() {
    let remote_item = OfflineQueueItem::new("remote_update", r#"{"data":"from_server"}"#);
    let pull_item = remote_item.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async {
                let results: Vec<PushOutcome> = vec![];
                Json(PushResponse { results })
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async move {
                Json(PullResponse {
                    items: vec![pull_item.clone()],
                    next_cursor: None,
                })
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    assert_eq!(result.pushed, 0);
    assert_eq!(result.pulled, 1, "should have pulled 1 item from server");

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn api_key_is_sent_in_headers() {
    // Start a server that captures the Authorization header.
    let auth_header = Arc::new(Mutex::new(None::<String>));
    let auth_state = auth_header.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(move |req: axum::http::Request<axum::body::Body>| {
                let auth = req
                    .headers()
                    .get("authorization")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_owned());
                *auth_state.lock().unwrap() = auth;
                async {
                    Json(PushResponse {
                        results: vec![PushOutcome::Accepted],
                    })
                }
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store.enqueue_offline("test", "{}").unwrap();

    let mut config = test_config(port);
    config.api_key = Some("sk-test-key".into());
    let engine = SyncEngine::new(config);
    let _result = engine.run_sync_cycle(&store).await.unwrap();

    let auth = auth_header.lock().unwrap();
    assert_eq!(auth.as_deref(), Some("Bearer sk-test-key"));

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn connection_refused_returns_ok_with_zero_counts() {
    // Use a port that nothing is listening on.
    let port = 28999;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store.enqueue_offline("test", "{}").unwrap();

    let config = SyncConfig {
        server_url: format!("http://localhost:{port}"),
        api_key: None,
    };
    let engine = SyncEngine::new(config);
    let result = engine.run_sync_cycle(&store).await;

    // P271: The pre-sync health check returns Ok with zero counts when
    // the server is unreachable (graceful skip, not an error).
    assert!(
        result.is_ok(),
        "sync should gracefully return Ok when server is unreachable (P271 health check)"
    );
    let rep_result = result.unwrap();
    assert_eq!(rep_result.pushed, 0, "no items should be pushed");
    assert_eq!(rep_result.pulled, 0, "no items should be pulled");
    // Item should remain pending (not synced, not failed).
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "item should remain pending");
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn empty_queue_produces_no_push() {
    let server = spawn_test_server().await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    let engine = SyncEngine::new(test_config(server.port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    assert_eq!(result.pushed, 0);
    assert_eq!(result.pulled, 0);

    let pushes = server.state.received_pushes.lock().unwrap();
    assert!(pushes.is_empty());

    server.handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn multiple_items_are_all_pushed_and_synced() {
    let server = spawn_test_server().await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"s1"}"#)
        .unwrap();
    store
        .enqueue_offline("product_created", r#"{"sku":"P1"}"#)
        .unwrap();
    store
        .enqueue_offline("stock_adjusted", r#"{"sku":"P1","delta":-1}"#)
        .unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 3);

    let engine = SyncEngine::new(test_config(server.port));
    let result = engine.run_sync_cycle(&store).await.unwrap();

    // Server received 3 pushes.
    let pushes = server.state.received_pushes.lock().unwrap();
    assert_eq!(pushes.len(), 3);
    drop(pushes);

    // All 3 items synced locally.
    let all = store.list_all_offline().unwrap();
    let synced = all
        .iter()
        .filter(|i| i.status == OfflineQueueStatus::Synced)
        .count();
    assert_eq!(synced, 3);

    assert_eq!(result.pushed, 3);
    assert_eq!(result.pulled, 0);

    server.handle.abort();
}

// ── Cross-terminal acceptance tests ─────────────────────────────────
//
// These tests simulate two terminals sharing inventory through a common
// cloud sync server. They verify the acceptance criterion:
// "Cloud sync: a product updated on terminal A appears on terminal B
//  within 5 seconds."

/// Smarter test server that stores pushed items and returns them on pull.
/// Uses axum's `State` extractor (same pattern as `spawn_test_server`)
/// for reliable shared state.
#[derive(Clone)]
struct RelayServerState {
    items: Arc<Mutex<Vec<OfflineQueueItem>>>,
}

impl RelayServerState {
    fn new() -> Self {
        Self {
            items: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

/// Handler: POST /api/sync/push (store items for later pull)
async fn relay_handle_push(
    State(state): State<RelayServerState>,
    Json(items): Json<Vec<OfflineQueueItem>>,
) -> Json<PushResponse> {
    let mut stored = state.items.lock().unwrap();
    let results: Vec<PushOutcome> = items.iter().map(|_| PushOutcome::Accepted).collect();
    stored.extend(items);
    Json(PushResponse { results })
}

/// Handler: POST /api/sync/pull (return all stored items)
async fn relay_handle_pull(
    State(state): State<RelayServerState>,
    Json(_request): Json<PullRequest>,
) -> Json<PullResponse> {
    let stored = state.items.lock().unwrap();
    Json(PullResponse {
        items: stored.clone(),
        next_cursor: None,
    })
}

/// Spawn a relay server and return (port, state, handle).
///
/// Includes `/api/health` for the P271 pre-sync health check.
async fn spawn_relay_server() -> (u16, RelayServerState, tokio::task::JoinHandle<()>) {
    let state = RelayServerState::new();
    let app = Router::new()
        .route("/api/sync/push", post(relay_handle_push))
        .route("/api/sync/pull", post(relay_handle_pull))
        .route("/api/health", axum::routing::get(handle_health))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (port, state, handle)
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn product_created_on_terminal_a_appears_on_terminal_b() {
    let (relay_port, relay_state, relay_handle) = spawn_relay_server().await;

    // ── Terminal A: create a product and enqueue it for sync ────────
    let conn_a = migrations::fresh_db();
    let store_a = Store::new(&conn_a);

    // Create a product on Terminal A
    store_a
        .create_product(
            "SYNC-COFFEE",
            "Sync Coffee",
            kasirmu_core::Money {
                minor_units: 500,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            100,
            None,
        )
        .unwrap();

    // Clear incidental audit.ship entries from local product creation
    conn_a
        .execute(
            "DELETE FROM offline_queue WHERE action = ?1",
            rusqlite::params![kasirmu_core::AUDIT_SHIP_ACTION],
        )
        .unwrap();

    // Enqueue the product creation for sync (as the event handler would)
    let product_payload = serde_json::json!({
        "sku": "SYNC-COFFEE",
        "name": "Sync Coffee",
        "price_minor": 500,
        "currency": "USD",
        "category_id": null,
        "barcode": null,
        "initial_stock": 100,
    })
    .to_string();
    store_a
        .enqueue_offline("product.created", &product_payload)
        .unwrap();
    assert_eq!(store_a.pending_offline_count().unwrap(), 1);

    // ── Push: Terminal A → server ───────────────────────────────────
    let engine_a = SyncEngine::new(test_config(relay_port));
    let result_a = engine_a.run_sync_cycle(&store_a).await.unwrap();
    assert_eq!(result_a.pushed, 1, "Terminal A should push 1 item");
    // A pushed 1 item, then the relay server returns all stored items on pull.
    assert_eq!(result_a.pulled, 1, "Terminal A should pull 1 item back");
    assert_eq!(
        store_a.pending_offline_count().unwrap(),
        0,
        "Terminal A's pending queue should be empty after sync"
    );

    // Verify server received the item
    {
        let stored = relay_state.items.lock().unwrap();
        assert_eq!(stored.len(), 1, "server should have 1 stored item");
        assert_eq!(stored[0].action, "product.created");
        assert!(stored[0].payload.contains("SYNC-COFFEE"));
    }

    // ── Terminal B: empty database, pull from server ────────────────
    let conn_b = migrations::fresh_db();
    let store_b = Store::new(&conn_b);

    // Verify Terminal B has no products yet
    let products_before = store_b.list_products().unwrap();
    assert!(
        products_before.is_empty(),
        "Terminal B should be empty initially"
    );

    // Run sync cycle on Terminal B (push nothing, pull the product)
    let engine_b = SyncEngine::new(test_config(relay_port));
    let result_b = engine_b.run_sync_cycle(&store_b).await.unwrap();
    assert_eq!(result_b.pushed, 0);
    assert_eq!(
        result_b.pulled, 1,
        "Terminal B should pull 1 item from server"
    );

    // ── Verify: the product now exists on Terminal B ────────────────
    let products_after = store_b.list_products().unwrap();
    assert_eq!(
        products_after.len(),
        1,
        "Terminal B should now have 1 product"
    );
    assert_eq!(
        products_after[0].product.sku.as_str(),
        "SYNC-COFFEE",
        "Product SKU should match"
    );
    assert_eq!(
        products_after[0].product.name, "Sync Coffee",
        "Product name should match"
    );
    assert_eq!(
        products_after[0].product.price.minor_units, 500,
        "Product price should match"
    );
    // Initial stock is set during product creation
    assert_eq!(
        products_after[0].stock_qty,
        Some(100),
        "Inventory should be replicated"
    );

    relay_handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn stock_adjustment_on_terminal_a_reflected_on_terminal_b() {
    let (relay_port, _relay_state, relay_handle) = spawn_relay_server().await;

    // ── Terminal A: create a product with stock, adjust it ──────────
    let conn_a = migrations::fresh_db();
    let store_a = Store::new(&conn_a);

    store_a
        .create_product(
            "STK-TEA",
            "Sync Tea",
            kasirmu_core::Money {
                minor_units: 300,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            50,
            None,
        )
        .unwrap();

    // Enqueue the initial product creation FIRST so that when Terminal B
    // pulls items (oldest first), the product is created before stock is adjusted.
    let product_payload = serde_json::json!({
        "sku": "STK-TEA",
        "name": "Sync Tea",
        "price_minor": 300,
        "currency": "USD",
        "category_id": null,
        "barcode": null,
        "initial_stock": 50,
    })
    .to_string();
    store_a
        .enqueue_offline("product.created", &product_payload)
        .unwrap();

    // Adjust stock on Terminal A (sell 5 units) at the canonical default location.
    let tx = conn_a.unchecked_transaction().unwrap();
    store_a
        .adjust_stock_at_location_with_reason(
            &tx,
            "STK-TEA",
            -5,
            &LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID),
            None,
            None::<&kasirmu_core::inventory_transaction::InventoryTransactionId>,
            None::<&kasirmu_core::terminal::TerminalId>,
            None::<&kasirmu_core::user::UserId>,
        )
        .unwrap();
    tx.commit().unwrap();

    // Enqueue the stock adjustment for sync
    let stock_payload = serde_json::json!({
        "sku": "STK-TEA",
        "delta": -5,
        "new_qty": 45,
        "reason": "sale",
    })
    .to_string();
    store_a
        .enqueue_offline("stock.adjusted", &stock_payload)
        .unwrap();

    // Clear incidental audit.ship entries from local product creation and stock adjustment
    conn_a
        .execute(
            "DELETE FROM offline_queue WHERE action = ?1",
            rusqlite::params![kasirmu_core::AUDIT_SHIP_ACTION],
        )
        .unwrap();

    // ── Push: Terminal A → server (both items) ──────────────────────
    assert_eq!(store_a.pending_offline_count().unwrap(), 2);
    let engine_a = SyncEngine::new(test_config(relay_port));
    let result_a = engine_a.run_sync_cycle(&store_a).await.unwrap();
    assert_eq!(result_a.pushed, 2);

    // ── Terminal B: pull both items ─────────────────────────────────
    let conn_b = migrations::fresh_db();
    let store_b = Store::new(&conn_b);

    let engine_b = SyncEngine::new(test_config(relay_port));
    let result_b = engine_b.run_sync_cycle(&store_b).await.unwrap();
    assert_eq!(result_b.pulled, 2, "Terminal B should pull 2 items");

    // ── Verify: product exists on Terminal B with ADJUSTED stock ────
    let products = store_b.list_products().unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].product.sku.as_str(), "STK-TEA");
    // The product is created first with 50 stock, then adjusted by -5
    // So Terminal B should see 50 - 5 = 45
    assert_eq!(
        products[0].stock_qty,
        Some(45),
        "Stock should reflect terminal A's adjustment (50 - 5 = 45)"
    );

    relay_handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn full_sync_cycle_completes_under_one_second() {
    // Verify that a full push+pull cycle completes in under 1 second,
    // well within the 5-second acceptance criterion.
    let (relay_port, _relay_state, relay_handle) = spawn_relay_server().await;

    // Setup Terminal A with data to sync (BEFORE the timed section)
    let conn_a = migrations::fresh_db();
    let store_a = Store::new(&conn_a);

    store_a
        .create_product(
            "PERF-SKU",
            "Perf Product",
            kasirmu_core::Money {
                minor_units: 1000,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            10,
            None,
        )
        .unwrap();

    let payload = serde_json::json!({
        "sku": "PERF-SKU",
        "name": "Perf Product",
        "price_minor": 1000,
        "currency": "USD",
    })
    .to_string();
    store_a
        .enqueue_offline("product.created", &payload)
        .unwrap();

    // Prepare Terminal B's database ahead of time too
    let conn_b = migrations::fresh_db();
    let store_b = Store::new(&conn_b);

    // Time the full Terminal A push + Terminal B pull cycle
    let start = std::time::Instant::now();

    // Push from A
    let engine_a = SyncEngine::new(test_config(relay_port));
    engine_a.run_sync_cycle(&store_a).await.unwrap();

    // Pull into B
    let engine_b = SyncEngine::new(test_config(relay_port));
    engine_b.run_sync_cycle(&store_b).await.unwrap();

    let elapsed = start.elapsed();

    // Verify the product arrived on Terminal B
    let products = store_b.list_products().unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].product.sku.as_str(), "PERF-SKU");

    // Assert the full cycle completes well within 5 seconds
    assert!(
        elapsed.as_secs() < 1,
        "cross-terminal sync should complete in < 1 second, took {elapsed:?}"
    );

    relay_handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn server_error_prevents_sync_item_stays_pending() {
    // Start a server that will reject the request by returning 500.
    let reject_app = Router::new().route(
        "/api/sync/push",
        post(|| async { axum::http::StatusCode::INTERNAL_SERVER_ERROR }),
    );
    let (port, handle) = spawn_custom_server(reject_app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"fail-1"}"#)
        .unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await;

    // The sync should fail because the server returned 500.
    assert!(result.is_err(), "sync should fail when server returns 500");

    // The item should remain pending (the error happens at the transport level,
    // so mark_synced is never called).
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(
        pending.len(),
        1,
        "item should remain pending after server error"
    );

    handle.abort();
}

// ── Large-scale throughput test ────────────────────────────────────
//
// Verifies that the sync engine can push 100+ items through the relay
// server and pull them all on the receiving terminal within the 5-second
// acceptance criterion.

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn large_scale_sync_throughput() {
    const ITEM_COUNT: usize = 100;

    let (relay_port, _relay_state, relay_handle) = spawn_relay_server().await;

    // ── Terminal A: create a product and enqueue 100 stock adjustments ─
    let conn_a = migrations::fresh_db();
    let store_a = Store::new(&conn_a);

    store_a
        .create_product(
            "THRUPUT",
            "Throughput Test Product",
            kasirmu_core::Money {
                minor_units: 1000,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            1000,
            None,
        )
        .unwrap();

    // Clear incidental audit.ship entries from local product creation
    conn_a
        .execute(
            "DELETE FROM offline_queue WHERE action = ?1",
            rusqlite::params![kasirmu_core::AUDIT_SHIP_ACTION],
        )
        .unwrap();

    // Enqueue a product.created FIRST so Terminal B can create the product.
    let product_payload = serde_json::json!({
        "sku": "THRUPUT",
        "name": "Throughput Test Product",
        "price_minor": 1000,
        "currency": "USD",
        "initial_stock": 1000,
    })
    .to_string();
    store_a
        .enqueue_offline("product.created", &product_payload)
        .unwrap();

    // Enqueue 100 stock adjustment events (each sells 1 unit).
    for i in 0..ITEM_COUNT {
        let stock_payload = serde_json::json!({
            "sku": "THRUPUT",
            "delta": -1,
            "new_qty": 1000 - (i as i64) - 1,
            "reason": "sale",
        })
        .to_string();
        store_a
            .enqueue_offline("stock.adjusted", &stock_payload)
            .unwrap();
    }

    assert_eq!(
        store_a.pending_offline_count().unwrap(),
        (ITEM_COUNT + 1) as i64
    );

    // ── Push: Terminal A → server (all 101 items) ────────────────────
    let engine_a = SyncEngine::new(test_config(relay_port));
    let start = std::time::Instant::now();
    let result_a = engine_a.run_sync_cycle(&store_a).await.unwrap();
    let push_elapsed = start.elapsed();

    assert_eq!(
        result_a.pushed,
        ITEM_COUNT + 1,
        "Terminal A should push all {} items",
        ITEM_COUNT + 1
    );
    let pending_items = store_a.list_pending_offline().unwrap();
    let pending_business_items = pending_items
        .iter()
        .filter(|item| item.action != kasirmu_core::AUDIT_SHIP_ACTION)
        .count();
    assert_eq!(
        pending_business_items, 0,
        "Terminal A's pending queue should have no unsynced business items"
    );

    // ── Terminal B: empty database, pull all items ───────────────────
    let conn_b = migrations::fresh_db();
    let store_b = Store::new(&conn_b);

    // No sleep needed — Terminal A's push is already committed in the relay.
    let engine_b = SyncEngine::new(test_config(relay_port));
    let start_pull = std::time::Instant::now();
    let result_b = engine_b.run_sync_cycle(&store_b).await.unwrap();
    let pull_elapsed = start_pull.elapsed();

    assert_eq!(
        result_b.pulled,
        ITEM_COUNT + 1,
        "Terminal B should pull all {} items",
        ITEM_COUNT + 1
    );

    // ── Verify: product exists with correct final stock ──────────────
    let products = store_b.list_products().unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].product.sku.as_str(), "THRUPUT");
    // Initial stock 1000, minus 100 sales (each -1) = 900.
    assert_eq!(
        products[0].stock_qty,
        Some(900),
        "Stock should be 1000 - 100 = 900 after all adjustments"
    );

    // Verify throughput meets a generous 2-second budget (in-memory db +
    // localhost HTTP for 101 items should complete in well under 1 second).
    let total_elapsed = push_elapsed + pull_elapsed;
    assert!(
        total_elapsed.as_secs() < 2,
        "{}+item sync should complete in < 2 seconds, took {total_elapsed:?} (push: {push_elapsed:?}, pull: {pull_elapsed:?})",
        ITEM_COUNT + 1,
    );

    tracing::info!(
        items = ITEM_COUNT + 1,
        push_ms = push_elapsed.as_millis(),
        pull_ms = pull_elapsed.as_millis(),
        total_ms = total_elapsed.as_millis(),
        "large-scale sync throughput"
    );

    relay_handle.abort();
}

// ── Retry tests ─────────────────────────────────────────────────────
//
// These tests verify that transient failures (server returns 500) leave
// items in pending state so they can be retried on the next sync cycle.

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn transient_failure_then_retry_succeeds() {
    // Server that fails the first push with 500, then accepts subsequent pushes.
    let attempt_count = Arc::new(Mutex::new(0u32));
    let attempt_state = attempt_count.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(move |Json(items): Json<Vec<OfflineQueueItem>>| async move {
                let mut count = attempt_state.lock().unwrap();
                *count += 1;
                if *count == 1 {
                    // First attempt: transient failure.
                    Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                } else {
                    // Subsequent attempts: accept.
                    let results: Vec<PushOutcome> =
                        items.iter().map(|_| PushOutcome::Accepted).collect();
                    Ok(Json(PushResponse { results }))
                }
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );
    let (port, handle) = spawn_custom_server(app).await;

    // ── Cycle 1: transient failure ───────────────────────────────────
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"retry-1"}"#)
        .unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 1);

    let engine = SyncEngine::new(test_config(port));
    let result_1 = engine.run_sync_cycle(&store).await;
    assert!(
        result_1.is_err(),
        "cycle 1 should fail (server returns 500)"
    );
    if let Err(e) = &result_1 {
        let msg = e.to_string();
        assert!(
            msg.contains("500"),
            "error message should contain status 500, got: {msg}"
        );
    }

    // Item should remain pending — not marked synced, not marked failed.
    let pending_after_fail = store.list_pending_offline().unwrap();
    assert_eq!(
        pending_after_fail.len(),
        1,
        "item should remain pending after transient failure"
    );
    assert_eq!(pending_after_fail[0].status, OfflineQueueStatus::Pending);
    assert_eq!(store.pending_offline_count().unwrap(), 1);

    // ── Cycle 2: retry succeeds ──────────────────────────────────────
    let result_2 = engine.run_sync_cycle(&store).await;
    assert!(
        result_2.is_ok(),
        "cycle 2 should succeed (server now accepts)"
    );

    let result_2 = result_2.unwrap();
    assert_eq!(result_2.pushed, 1, "should have pushed 1 item");

    // Item should now be synced.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
    assert!(all[0].synced_at.is_some());
    assert_eq!(store.pending_offline_count().unwrap(), 0);

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn transient_failure_on_pull_retry_succeeds() {
    // Server that accepts push but fails pull with 500 on first attempt.
    let pull_attempt_count = Arc::new(Mutex::new(0u32));
    let pull_attempt_state = pull_attempt_count.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async { Json(PushResponse { results: vec![] }) }),
        )
        .route(
            "/api/sync/pull",
            post(move || async move {
                let mut count = pull_attempt_state.lock().unwrap();
                *count += 1;
                if *count == 1 {
                    Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                } else {
                    Ok(Json(PullResponse {
                        items: vec![],
                        next_cursor: None,
                    }))
                }
            }),
        );
    let (port, handle) = spawn_custom_server(app).await;

    let store_db = migrations::fresh_db();

    let store = setup_store(&store_db);
    let engine = SyncEngine::new(test_config(port));

    // Note: no items enqueued — the push phase is skipped (empty queue).
    // This test specifically verifies pull-only retry after a 500 on pull.

    // ── Cycle 1: push succeeds, pull fails ───────────────────────────
    let result_1 = engine.run_sync_cycle(&store).await;
    assert!(result_1.is_err(), "cycle 1 should fail (pull returns 500)");

    // ── Cycle 2: pull succeeds ───────────────────────────────────────
    let result_2 = engine.run_sync_cycle(&store).await;
    assert!(
        result_2.is_ok(),
        "cycle 2 should succeed (pull now accepts)"
    );
    assert_eq!(result_2.unwrap().pulled, 0);

    handle.abort();
}

// ── Auth failure tests ────────────────────────────────────────────────
//
// These tests verify that the sync engine correctly handles authentication
// and authorisation failures (401 Unauthorized / 403 Forbidden) from the
// remote server. Items should remain pending so they can be retried after
// the credentials are updated.

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn push_unauthorized_401_returns_error() {
    // Server that returns 401 Unauthorized on push.
    let reject_app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async { axum::http::StatusCode::UNAUTHORIZED }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );
    let (port, handle) = spawn_custom_server(reject_app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"auth-401"}"#)
        .unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await;

    assert!(result.is_err(), "sync should fail when server returns 401");
    if let Err(e) = &result {
        let msg = e.to_string();
        assert!(
            msg.contains("401"),
            "error message should contain status 401, got: {msg}"
        );
    }

    // Item should remain pending.
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "item should remain pending after 401");
    assert_eq!(pending[0].status, OfflineQueueStatus::Pending);

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn push_forbidden_403_returns_error() {
    // Server that returns 403 Forbidden on push.
    let reject_app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async { axum::http::StatusCode::FORBIDDEN }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );
    let (port, handle) = spawn_custom_server(reject_app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"auth-403"}"#)
        .unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await;

    assert!(result.is_err(), "sync should fail when server returns 403");
    if let Err(e) = &result {
        let msg = e.to_string();
        assert!(
            msg.contains("403"),
            "error message should contain status 403, got: {msg}"
        );
    }

    // Item should remain pending.
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(pending.len(), 1, "item should remain pending after 403");
    assert_eq!(pending[0].status, OfflineQueueStatus::Pending);

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn pull_unauthorized_401_returns_error() {
    // Server that accepts push but returns 401 on pull.
    let reject_app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async {
                Json(PushResponse {
                    results: vec![PushOutcome::Accepted],
                })
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async { axum::http::StatusCode::UNAUTHORIZED }),
        );
    let (port, handle) = spawn_custom_server(reject_app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"pull-401"}"#)
        .unwrap();

    let engine = SyncEngine::new(test_config(port));
    let result = engine.run_sync_cycle(&store).await;

    assert!(result.is_err(), "sync should fail when pull returns 401");
    if let Err(e) = &result {
        let msg = e.to_string();
        assert!(
            msg.contains("401"),
            "error message should contain status 401, got: {msg}"
        );
    }

    // Push succeeded, so the item should be marked synced.
    // Only the pull phase failed with 401.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 1, "item should exist in offline queue");
    assert_eq!(
        all[0].status,
        OfflineQueueStatus::Synced,
        "push should have synced the item before pull failed"
    );
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(
        pending.len(),
        0,
        "no items should remain pending after push succeeded"
    );

    handle.abort();
}

// ── Network Drop, Conflict Storm & Anchor Expiration Modernization ───

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn network_drop_between_push_and_pull_preserves_pushed_sync_state() {
    // Shared state tracking whether network is dropped on pull.
    let pull_dropped = Arc::new(Mutex::new(true));
    let pull_dropped_state = pull_dropped.clone();
    let pushes_received = Arc::new(Mutex::new(0usize));
    let pushes_state = pushes_received.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(move |Json(items): Json<Vec<OfflineQueueItem>>| {
                let mut p = pushes_state.lock().unwrap();
                *p += items.len();
                let results: Vec<PushOutcome> =
                    items.iter().map(|_| PushOutcome::Accepted).collect();
                async move { Json(PushResponse { results }) }
            }),
        )
        .route(
            "/api/sync/pull",
            post(move || {
                let dropped = *pull_dropped_state.lock().unwrap();
                async move {
                    if dropped {
                        Err(StatusCode::SERVICE_UNAVAILABLE)
                    } else {
                        Ok(Json(PullResponse {
                            items: vec![],
                            next_cursor: None,
                        }))
                    }
                }
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    // Enqueue 2 offline sales.
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"drop-sale-1"}"#)
        .unwrap();
    store
        .enqueue_offline("complete_sale", r#"{"sale_id":"drop-sale-2"}"#)
        .unwrap();
    assert_eq!(store.pending_offline_count().unwrap(), 2);

    let engine = SyncEngine::new(test_config(port));

    // Cycle 1: Push succeeds, but pull fails with 503 (simulated network partition).
    let result_1 = engine.run_sync_cycle(&store).await;
    assert!(
        result_1.is_err(),
        "cycle 1 should fail because pull was dropped"
    );

    // Invariant: The pushed items MUST already be marked Synced locally.
    // They must not be rolled back to pending or left in limbo.
    let all = store.list_all_offline().unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].status, OfflineQueueStatus::Synced);
    assert_eq!(all[1].status, OfflineQueueStatus::Synced);
    assert!(all[0].synced_at.is_some());
    assert!(all[1].synced_at.is_some());
    assert_eq!(store.pending_offline_count().unwrap(), 0);
    assert_eq!(*pushes_received.lock().unwrap(), 2);

    // Cycle 2: Network is restored. Pull succeeds.
    *pull_dropped.lock().unwrap() = false;
    let result_2 = engine.run_sync_cycle(&store).await.unwrap();

    // No items re-pushed, 0 pulled.
    assert_eq!(
        result_2.pushed, 0,
        "already-synced items must not be re-pushed"
    );
    assert_eq!(result_2.pulled, 0);
    assert_eq!(
        *pushes_received.lock().unwrap(),
        2,
        "server received no duplicate pushes"
    );

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn conflict_storm_concurrent_batch_resolutions() {
    let second_push_count = Arc::new(Mutex::new(0usize));
    let second_push_state = second_push_count.clone();

    // Server that responds to cycle 1 push with a storm of 3 conflicts:
    // 1. product.updated -> remote version is higher (remote won)
    // 2. complete_sale -> local status is completed, remote is pending (local won)
    // 3. stock.adjusted -> CRDT delta merge
    let app = Router::new()
        .route(
            "/api/sync/push",
            post(move |Json(items): Json<Vec<OfflineQueueItem>>| {
                let mut sp = second_push_state.lock().unwrap();
                let is_second_cycle = *sp > 0;
                *sp += items.len();

                async move {
                    if is_second_cycle {
                        // In cycle 2, the re-enqueued CRDT merged item is accepted.
                        let results = items.iter().map(|_| PushOutcome::Accepted).collect();
                        Json(PushResponse { results })
                    } else {
                        // Storm: every item gets a Conflict outcome with server counterpart.
                        let mut results = Vec::new();
                        for item in &items {
                            let mut server_item = item.clone();
                            match item.action.as_str() {
                                "product.updated" => {
                                    // Remote has higher version (version 5 vs local version 1).
                                    server_item.id = "srv-prod-5".into();
                                    server_item.payload =
                                        r#"{"sku":"COFFEE","version":5,"price_minor":999}"#.into();
                                }
                                "complete_sale" => {
                                    // Remote is only pending (rank 1 vs local completed rank 2).
                                    server_item.id = "srv-sale-pending".into();
                                    server_item.payload =
                                        r#"{"sale_id":"sale-storm-1","status":"pending"}"#.into();
                                }
                                "stock.adjusted" => {
                                    // Remote has another delta.
                                    server_item.id = "srv-stock-delta".into();
                                    server_item.payload = r#"{"sku":"COFFEE","delta":15}"#.into();
                                }
                                _ => {}
                            }
                            results.push(PushOutcome::Conflict(server_item));
                        }
                        Json(PushResponse { results })
                    }
                }
            }),
        )
        .route(
            "/api/sync/pull",
            post(|| async {
                Json(PullResponse {
                    items: vec![],
                    next_cursor: None,
                })
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    let store = setup_store(&store_db);

    // Enqueue the 3 items:
    // 1. product with version 1
    store
        .enqueue_offline(
            "product.updated",
            r#"{"sku":"COFFEE","version":1,"price_minor":500}"#,
        )
        .unwrap();
    // 2. complete_sale with status completed
    store
        .enqueue_offline(
            "complete_sale",
            r#"{"sale_id":"sale-storm-1","status":"completed"}"#,
        )
        .unwrap();
    // 3. stock.adjusted with delta -5
    store
        .enqueue_offline("stock.adjusted", r#"{"sku":"COFFEE","delta":-5}"#)
        .unwrap();

    assert_eq!(store.pending_offline_count().unwrap(), 3);

    let engine = SyncEngine::new(test_config(port));

    // Cycle 1: Conflict storm processed by apply_push_outcomes.
    let result_1 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_1.pushed, 3);

    // Check resolutions on original items:
    let all = store.list_all_offline().unwrap();
    // All 3 original items should be marked Synced with conflict tags:
    let prod_item = all.iter().find(|i| i.action == "product.updated").unwrap();
    assert_eq!(prod_item.status, OfflineQueueStatus::Synced);
    assert!(
        prod_item
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("remote won")
    );

    let sale_item = all.iter().find(|i| i.action == "complete_sale").unwrap();
    assert_eq!(sale_item.status, OfflineQueueStatus::Synced);
    assert!(
        sale_item
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("local won")
    );

    let stock_item = all
        .iter()
        .find(|i| i.action == "stock.adjusted" && i.id != "srv-stock-delta")
        .unwrap();
    assert_eq!(stock_item.status, OfflineQueueStatus::Synced);
    assert!(
        stock_item
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("crdt merge")
    );

    // CRDT merge created a NEW pending winner queue entry for stock.adjusted:
    let pending = store.list_pending_offline().unwrap();
    assert_eq!(
        pending.len(),
        1,
        "CRDT merge winner must be re-enqueued as pending"
    );
    assert_eq!(pending[0].action, "stock.adjusted");
    assert!(pending[0].payload.contains("crdt_delta"));

    // Cycle 2: Push the re-enqueued CRDT merged winner to server.
    let result_2 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(
        result_2.pushed, 1,
        "merged CRDT item must be pushed in cycle 2"
    );
    assert_eq!(
        store.pending_offline_count().unwrap(),
        0,
        "queue must now be fully cleared"
    );

    handle.abort();
}

#[cfg_attr(not(feature = "slow-tests"), ignore)]
#[tokio::test]
async fn anchor_expired_410_triggers_snapshot_recovery_and_advances_pull_anchor() {
    const STALE_ANCHOR: &str = "2025-01-01T00:00:00.000Z";
    const RETENTION_FLOOR: &str = "2026-03-01T00:00:00.000Z";

    let snapshot_fetched = Arc::new(Mutex::new(false));
    let snapshot_state = snapshot_fetched.clone();
    let pull_since_received = Arc::new(Mutex::new(Vec::<Option<String>>::new()));
    let pull_since_state = pull_since_received.clone();

    let app = Router::new()
        .route(
            "/api/sync/push",
            post(|| async { Json(PushResponse { results: vec![] }) }),
        )
        .route(
            "/api/sync/pull",
            post(move |Json(req): Json<PullRequest>| {
                pull_since_state.lock().unwrap().push(req.since.clone());
                async move {
                    if let Some(ref since) = req.since
                        && since.as_str() < RETENTION_FLOOR
                    {
                        // 410 Gone: client's since anchor is older than the server retention floor.
                        return (
                            StatusCode::GONE,
                            Json(serde_json::json!({
                                "error": "anchor_expired",
                                "oldest_available": RETENTION_FLOOR,
                            })),
                        )
                            .into_response();
                    }
                    // Valid / recovered anchor: return normal empty page.
                    Json(PullResponse {
                        items: vec![],
                        next_cursor: None,
                    })
                    .into_response()
                }
            }),
        )
        .route(
            "/api/sync/snapshot",
            get(move || {
                *snapshot_state.lock().unwrap() = true;
                async move {
                    Json(SyncSnapshotResponse {
                        version: 1,
                        products: vec![SnapshotProduct {
                            id: "prod-snap-1".into(),
                            sku: "SNAP-LATTE".into(),
                            name: "Snapshot Latte".into(),
                            price_minor: 400,
                            currency: "USD".into(),
                            category_id: None,
                            barcode: None,
                            created_at: Some("2026-03-01T00:00:00.000Z".into()),
                            updated_at: Some("2026-03-01T00:00:00.000Z".into()),
                            price_updated_at: None,
                            track_serial: false,
                            store_id: None,
                            ..Default::default()
                        }],
                        tax_rates: vec![SnapshotTaxRate {
                            id: "tax-snap-1".into(),
                            name: "Snapshot VAT".into(),
                            rate_bps: 1000,
                            is_default: true,
                            is_inclusive: false,
                            created_at: Some("2026-03-01T00:00:00.000Z".into()),
                            updated_at: Some("2026-03-01T00:00:00.000Z".into()),
                            legal_entity_id: None,
                            location_id: None,
                            effective_from: None,
                            effective_to: None,
                            rounding_mode: String::new(),
                        }],
                        users: vec![SnapshotUser {
                            id: "user-snap-1".into(),
                            username: "snap-cashier".into(),
                            display_name: "Snap Cashier".into(),
                            role_id: "role-cashier".into(),
                            is_active: true,
                            created_at: Some("2026-03-01T00:00:00.000Z".into()),
                            updated_at: Some("2026-03-01T00:00:00.000Z".into()),
                        }],
                    })
                }
            }),
        );

    let (port, handle) = spawn_custom_server(app).await;
    let store_db = migrations::fresh_db();
    store_db
        .execute(
            "INSERT OR IGNORE INTO roles (id, name) VALUES (?1, ?2)",
            rusqlite::params!["role-cashier", "Cashier"],
        )
        .unwrap();
    let store = setup_store(&store_db);

    // Seed the store with an old durable pull anchor that predates the server's retention floor.
    store.set_sync_pull_state(Some(STALE_ANCHOR), None).unwrap();

    let engine = SyncEngine::new(test_config(port));

    // Cycle 1: Trigger sync. Server returns 410 -> engine catches AnchorExpired -> fetches snapshot -> imports.
    let result_1 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_1.pushed, 0);

    // Snapshot was fetched and imported:
    assert!(
        *snapshot_fetched.lock().unwrap(),
        "snapshot endpoint must have been called"
    );

    // Product was imported into local SQLite:
    let products = store.list_products().unwrap();
    assert_eq!(products.len(), 1);
    assert_eq!(products[0].product.sku.as_str(), "SNAP-LATTE");
    assert_eq!(products[0].product.name, "Snapshot Latte");
    assert_eq!(products[0].product.price.minor_units, 400);

    // Tax rate was imported:
    let taxes = store.list_tax_rates().unwrap();
    assert_eq!(taxes.len(), 1);
    assert_eq!(taxes[0].name, "Snapshot VAT");
    assert_eq!(taxes[0].rate_bps, 1000);

    // User was imported:
    let users = store.list_users().unwrap();
    assert!(users.iter().any(|u| u.username == "snap-cashier"));

    // Durable pull anchor advanced to RETENTION_FLOOR:
    let pull_state = store.get_sync_pull_state().unwrap();
    assert_eq!(
        pull_state.since.as_deref(),
        Some(RETENTION_FLOOR),
        "durable anchor must advance to oldest_available so subsequent cycles do not re-expire"
    );

    // Cycle 2: Subsequent sync cycle must send the advanced anchor, NOT the stale one.
    let result_2 = engine.run_sync_cycle(&store).await.unwrap();
    assert_eq!(result_2.pushed, 0);
    assert_eq!(result_2.pulled, 0);

    let pulls = pull_since_received.lock().unwrap();
    assert_eq!(pulls.len(), 2);
    assert_eq!(pulls[0].as_deref(), Some(STALE_ANCHOR));
    assert_eq!(
        pulls[1].as_deref(),
        Some(RETENTION_FLOOR),
        "second pull request must use the advanced anchor"
    );

    handle.abort();
}
