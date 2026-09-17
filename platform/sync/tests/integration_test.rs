//! Integration test: offline sale → sync → verify on server.
//!
//! Spins up a lightweight axum test server, seeds the local offline queue,
//! runs a sync cycle, and verifies the server received the data and the
//! local items were marked as synced.

use std::sync::{Arc, Mutex};

use axum::{Json, Router, extract::State, routing::post};
use kasirmu_core::{
    Store,
    inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId},
    migrations,
    offline::{OfflineQueueItem, OfflineQueueStatus},
    sync_client::SyncConfig,
};
use platform_sync::{
    SyncEngine,
    transport::{PullRequest, PullResponse, PushOutcome, PushResponse},
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
fn setup_store() -> Store<'static> {
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(migrations::fresh_db()));
    Store::new(conn)
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
    let store = setup_store();

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
    let store = setup_store();

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
    let store = setup_store();
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
    let store = setup_store();
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
    let store = setup_store();
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
                async { Json(PushResponse { results: vec![] }) }
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
    let store = setup_store();
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
    let store = setup_store();
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
    let store = setup_store();

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
    let store = setup_store();

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
    let store = setup_store();
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
    assert_eq!(
        store_a.pending_offline_count().unwrap(),
        0,
        "Terminal A's pending queue should be empty"
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
    let store = setup_store();
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

    let store = setup_store();
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
    let store = setup_store();
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
    let store = setup_store();
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
    let store = setup_store();
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
