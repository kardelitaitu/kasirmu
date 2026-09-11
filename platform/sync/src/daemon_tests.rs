//! Unit tests for the sync daemon: lifecycle/backoff basics, ADR #11
//! server-migration redirects, SYNC-01 durable anchor + idempotent replay,
//! SYNC-08 quarantine vs retryable ordering, SYNC-09 operator-rewind race,
//! SYNC-02/05 conflict resolution via the shared ADR #21 service, and
//! SYNC-10 remote settings-change sink. Extracted from the inline
//! `mod tests` in `daemon.rs` (F-018).

use super::*;
use crate::transport::{PullResponse, PushOutcome, PushResponse};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use oz_core::migrations;
use oz_core::settings::Settings;
use tokio::sync::Notify;

fn setup_db() -> DbConnection {
    Arc::new(Mutex::new(migrations::fresh_db()))
}

/// Spawn a minimal mock sync server on port 0 and return its URL.
/// Handles POST /api/sync/push (returns all accepted) and
/// POST /api/sync/pull (returns empty items list).
async fn spawn_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

#[tokio::test]
async fn daemon_starts_stopped() {
    let daemon = SyncDaemon::new();
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_start_and_stop() {
    let db = setup_db();
    let daemon = SyncDaemon::new();
    assert!(daemon.start(db).await);
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await, "stop must confirm the run loop exited");
    assert!(!daemon.is_running().await);
}

#[tokio::test]
async fn daemon_status_defaults() {
    let daemon = SyncDaemon::new();
    let status = daemon.status().await;
    assert!(!status.running);
    assert!(status.last_sync_at.is_none());
    assert_eq!(status.last_pushed, 0);
    assert_eq!(status.last_pulled, 0);
    assert!(status.last_error.is_none());
}

#[tokio::test]
async fn daemon_stop_when_not_running_is_noop() {
    let daemon = SyncDaemon::new();
    assert!(
        daemon.stop().await,
        "stop with nothing running reports stopped"
    );
    assert!(!daemon.is_running().await);
}

/// Regression (silent-success start): a start on a live daemon used to log
/// a warning and return `()`, which the IPC command surfaced as `Ok(())` —
/// the caller could not tell that no new daemon was spawned. The second
/// start now reports `false` explicitly.
#[tokio::test]
async fn daemon_double_start_reports_already_running() {
    let db = setup_db();
    let daemon = SyncDaemon::new();
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);
    assert!(
        !daemon.start(db).await,
        "a start on a live daemon must report that it did NOT spawn"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);
    assert!(!daemon.is_running().await);
}

/// Regression (stop/start race): `stop()` used to sleep a fixed 100ms and
/// return while the run loop could still be mid-cycle — the `running` flag
/// survived, the next `start()` was silently swallowed by the
/// already-running guard, and the daemon stayed dead until app restart.
/// Hold the DB lock to pin a tick mid-flight (the same window a slow
/// remote round trip produces), prove `stop()` waits for the loop to
/// exit, and prove an immediate `start()` brings the daemon back up.
#[tokio::test]
async fn daemon_stop_then_immediate_start_yields_running_daemon() {
    let db = setup_db();
    let daemon = SyncDaemon::with_interval(Duration::from_millis(10));
    assert!(daemon.start(db.clone()).await);
    assert!(daemon.is_running().await);

    // Hold the DB lock so a tick's spawn_blocking phase blocks
    // mid-cycle; released ~300ms in so the tick can finish after
    // stop() has committed to waiting for it.
    let blocker_db = db.clone();
    let blocker = tokio::spawn(async move {
        let _guard = blocker_db.lock().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    });
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert!(
        daemon.stop().await,
        "stop must wait for the in-flight cycle and confirm the loop exited"
    );
    assert!(
        !daemon.is_running().await,
        "running must be cleared by the time stop() returns"
    );

    // The race this pins: start immediately after stop.
    assert!(
        daemon.start(db).await,
        "start immediately after stop must spawn a new daemon"
    );
    assert!(daemon.is_running().await);
    assert!(daemon.stop().await);

    blocker.await.unwrap();
}

#[tokio::test]
async fn daemon_runs_when_sync_configured() {
    let server_url = spawn_mock_sync_server().await;
    let db = setup_db();
    // Wrap DB setup in spawn_blocking to avoid blocking a tokio
    // worker thread (the multi-thread runtime panics on blocking_lock).
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        store.enqueue_offline("test", r#"{}"#).unwrap();
    })
    .await
    .unwrap();
    let daemon = SyncDaemon::with_interval(Duration::from_millis(100));
    daemon.start(db).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let status = daemon.status().await;
    assert!(status.last_sync_at.is_some());
    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
}

#[tokio::test]
async fn daemon_skips_when_sync_not_configured() {
    let db = setup_db();
    let daemon = SyncDaemon::with_interval(Duration::from_millis(100));
    daemon.start(db).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let status = daemon.status().await;
    assert!(status.last_error.is_none());
    assert!(status.last_sync_at.is_some());
    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
}

#[tokio::test]
async fn daemon_custom_interval() {
    let daemon = SyncDaemon::with_interval(Duration::from_millis(50));
    assert_eq!(daemon.interval(), Duration::from_millis(50));
}

#[tokio::test]
async fn daemon_set_interval() {
    let mut daemon = SyncDaemon::new();
    daemon.set_interval(Duration::from_secs(10));
    assert_eq!(daemon.interval(), Duration::from_secs(10));
}

// ── Backoff tests ────────────────────────────────────────────

#[test]
fn compute_backoff_produces_finite_duration() {
    // Jitter is random; just verify the function never panics
    // and always returns a valid (finite, non-negative) duration.
    for failures in 0..=10 {
        let backoff = compute_backoff(failures);
        assert!(
            backoff.as_millis() as u64 <= MAX_BACKOFF_MS,
            "backoff for {failures} failures exceeds cap"
        );
    }
}

#[test]
fn compute_backoff_capped_at_60_seconds() {
    // After many failures, the backoff should be capped at 60s.
    let backoff = compute_backoff(100);
    assert!(
        backoff.as_millis() as u64 <= MAX_BACKOFF_MS,
        "backoff {} ms exceeds cap {MAX_BACKOFF_MS} ms",
        backoff.as_millis()
    );
}

#[test]
fn compute_backoff_zero_failures_is_instant() {
    // 2_000 * 2^0 = 2_000, jittered in [0, 2000]
    let backoff = compute_backoff(0);
    assert!(
        backoff.as_millis() <= 2_000,
        "zero failures should cap at 2000ms, got {}ms",
        backoff.as_millis()
    );
}

// ── ADR #11: Server migration integration tests ──────────

use crate::test_helpers::spawn_redirect_server;

#[tokio::test]
async fn daemon_auto_updates_url_on_server_migration() {
    let new_url = "https://new-server.example.com";
    let old_url = spawn_redirect_server(new_url).await;
    let db = setup_db();

    // Configure sync to point at the redirect server.
    let db_clone = db.clone();
    let old = old_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &old).unwrap();
        store.enqueue_offline("test", r#"{}"#).unwrap();
    })
    .await
    .unwrap();

    let daemon = SyncDaemon::with_interval(Duration::from_millis(100));
    daemon.start(db.clone()).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    // The daemon should have detected the redirect and updated the URL.
    let updated_url = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        Settings::get_sync_server_url(&conn).unwrap()
    })
    .await
    .unwrap();

    assert_eq!(
        updated_url.as_deref(),
        Some(new_url),
        "daemon should auto-update sync_server_url after server_migrated redirect"
    );

    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
}

#[tokio::test]
async fn daemon_pull_phase_detects_server_migration() {
    // No pending items — push is skipped, only pull runs.
    // The pull hits the redirect server and should still auto-update
    // the URL. This exercises the pull-phase ServerMigrated handler.
    let new_url = "https://pull-migrated.example.com";
    let old_url = spawn_redirect_server(new_url).await;
    let db = setup_db();

    let db_clone = db.clone();
    let old = old_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &old).unwrap();
        // No enqueue_offline — push phase is skipped.
    })
    .await
    .unwrap();

    let daemon = SyncDaemon::with_interval(Duration::from_millis(100));
    daemon.start(db.clone()).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let updated_url = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        Settings::get_sync_server_url(&conn).unwrap()
    })
    .await
    .unwrap();

    assert_eq!(
        updated_url.as_deref(),
        Some(new_url),
        "pull-phase only: daemon should still auto-update sync_server_url"
    );

    daemon.stop().await;
    tokio::time::sleep(Duration::from_millis(200)).await;
}

// ── TDD: daemon anchor-expiry recovery ─────────────────────────

async fn spawn_anchor_expired_daemon_server() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let snapshot_hits = Arc::new(AtomicUsize::new(0));

    async fn handle_pull(
        State(_snapshot_hits): State<Arc<AtomicUsize>>,
        Json(request): Json<crate::transport::PullRequest>,
    ) -> impl IntoResponse {
        const OLDEST_AVAILABLE: &str = "2026-02-01T00:00:00.000Z";
        if request.since.as_deref() == Some("2025-01-01T00:00:00.000Z") {
            return (
                StatusCode::GONE,
                Json(serde_json::json!({
                    "error": "anchor_expired",
                    "oldest_available": OLDEST_AVAILABLE,
                })),
            )
                .into_response();
        }
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
        .into_response()
    }

    async fn handle_snapshot(
        State(snapshot_hits): State<Arc<AtomicUsize>>,
    ) -> Json<crate::transport::SyncSnapshotResponse> {
        snapshot_hits.fetch_add(1, Ordering::SeqCst);
        Json(crate::transport::SyncSnapshotResponse {
            version: 1,
            products: vec![],
            tax_rates: vec![],
            users: vec![],
        })
    }

    let app = Router::new()
        .route("/api/sync/pull", post(handle_pull))
        .route("/api/sync/snapshot", get(handle_snapshot))
        .with_state(snapshot_hits.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), snapshot_hits)
}

/// A stale daemon anchor must recover through the snapshot endpoint and
/// advance to the server's oldest retained row. Without this path the
/// daemon logs `AnchorExpired` forever and never converges.
#[tokio::test]
async fn daemon_recovers_expired_anchor_with_snapshot() {
    use std::sync::atomic::Ordering;

    let (server_url, snapshot_hits) = spawn_anchor_expired_daemon_server().await;
    let db = setup_db();
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        store
            .set_sync_pull_state(Some("2025-01-01T00:00:00.000Z"), None)
            .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    assert_eq!(snapshot_hits.load(Ordering::SeqCst), 1);
    let state = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            Store::new(&conn).get_sync_pull_state().unwrap()
        }
    })
    .await
    .unwrap();
    assert_eq!(state.since.as_deref(), Some("2026-02-01T00:00:00.000Z"));
    assert!(state.cursor.is_none());
    assert!(status.read().await.last_error.is_none());
}

// ── ADR sync-plan-gating: PlanRequired is terminal ─────────────

/// Spawn a mock sync server whose push endpoint ALWAYS returns
/// `403 {"error":"plan_required"}` and counts how many times it was
/// hit. The daemon must treat this as terminal: surface the error,
/// keep queued items `pending` (no quarantine), and NOT retry within
/// the tick (the refresh path is auth-only).
async fn spawn_plan_required_mock_sync_server() -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let hits_for_server = hits.clone();

    async fn handle_push(
        State(hits): State<Arc<AtomicUsize>>,
        Json(_items): Json<Vec<serde_json::Value>>,
    ) -> impl IntoResponse {
        hits.fetch_add(1, Ordering::SeqCst);
        (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"error": "plan_required"})),
        )
    }
    async fn handle_pull(
        State(hits): State<Arc<AtomicUsize>>,
        Json(_req): Json<serde_json::Value>,
    ) -> impl IntoResponse {
        hits.fetch_add(1, Ordering::SeqCst);
        (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({"error": "plan_required"})),
        )
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .with_state(hits_for_server);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), hits)
}

/// A free tenant's push must surface `plan_required`, keep the queued
/// item `pending` (never quarantined), and hit the server exactly once
/// per endpoint per tick — no refresh-driven retry loop.
#[tokio::test]
async fn daemon_surfaces_plan_required_without_retry_or_quarantine() {
    let (server_url, hits) = spawn_plan_required_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        store
            .enqueue_offline("complete_sale", r#"{"id":"plan-gate-1"}"#)
            .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    // The error surfaced with the plan message.
    {
        let status_guard = status.read().await;
        let err = status_guard
            .last_error
            .as_deref()
            .expect("run_tick must surface the plan_required error");
        assert!(
            err.contains("paid plan") || err.contains("plan"),
            "last_error should mention the plan gate, got: {err}"
        );
    }

    // The item stays pending — no quarantine, no mark_all_failed.
    let (_, pending) = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            read_config_and_pending(&conn)
        }
    })
    .await
    .unwrap();
    assert_eq!(
        pending.len(),
        1,
        "a plan-gated push must keep the item pending (never quarantined)"
    );
    assert_eq!(
        pending[0].action, "complete_sale",
        "the queued item must be untouched"
    );

    // Each endpoint hit exactly once — no refresh-driven retry.
    assert_eq!(
        hits.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "push + pull should each be attempted exactly once (no retry loop)"
    );
}

// ── TDD Bug #1: spawn_blocking panic is not silently swallowed ─

/// Verify that `read_config_and_pending` propagates errors from a
/// poisoned connection. When the inner `unwrap()` on the mutex lock
/// panics, the `spawn_blocking` join handle returns an `Err`, and
/// `run_tick` must surface that in `last_error`.
///
/// We test this by creating a valid DB, then extract the config read
/// through the `read_config_and_pending` helper (which does the same
/// work the `spawn_blocking` closure does).
#[test]
fn read_config_and_pending_returns_pending_count() {
    let conn = oz_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.enqueue_offline("test", r#"{}"#).unwrap();

    let (config, pending) = read_config_and_pending(&conn);
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "test");
    // Config is None because sync is not enabled in fresh DB.
    assert!(config.is_none());
}

// ── SYNC-01: idempotent remote application ───────────────────────

/// Spawn a mock sync server whose pull endpoint ALWAYS returns the
/// same remote `stock.adjusted` item, regardless of the `since` anchor
/// or cursor. Simulates a server that replays history (or a client
/// whose anchor was lost) — the idempotency ledger must make replay
/// harmless.
async fn spawn_replaying_mock_sync_server() -> String {
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
        // NOTE: this mock deliberately IGNORES the since/cursor request
        // params. Do not "fix" it to filter by anchor, or the replay
        // guarantee the test asserts would silently break.
        item.id = "remote-item-replay-1".into();
        item.created_at = "2026-01-01T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-01 regression: two daemon ticks against the SAME remote item
/// must apply the local mutation exactly once (previously every cycle
/// re-pulled the whole queue and re-deducted stock → silent corruption).
#[tokio::test]
async fn daemon_applies_replayed_remote_item_only_once() {
    let server_url = spawn_replaying_mock_sync_server().await;
    let db = setup_db();

    // Seed a product + inventory so the remote stock adjustment has a
    // target, and configure sync (all inside spawn_blocking per the
    // daemon's DB-access pattern).
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
            let conn = db_setup.blocking_lock();
            Settings::set_sync_enabled(&conn, true).unwrap();
            Settings::set_sync_server_url(&conn, &url).unwrap();
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
                 VALUES ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at)
                 VALUES ('prod-coffee', 50, '2026-01-01T00:00:00.000Z');",
            )
            .unwrap();
        })
        .await
        .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));

    // Tick 1: pulls + applies the remote +10 (50 → 60), records ledger.
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;
    let after_tick_1 = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            let store = Store::new(&conn);
            store.get_stock("prod-coffee").unwrap()
        }
    })
    .await
    .unwrap();
    assert_eq!(after_tick_1, 60, "first tick must apply the +10 delta");

    // Tick 2: the server replays the SAME item. The idempotency ledger
    // must skip it — stock stays 60, not 70.
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;
    let after_tick_2 = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            let store = Store::new(&conn);
            store.get_stock("prod-coffee").unwrap()
        }
    })
    .await
    .unwrap();
    assert_eq!(
        after_tick_2, 60,
        "replayed remote item must NOT be applied a second time (SYNC-01)"
    );

    // Ledger contains exactly one entry for the replayed id.
    let ledger_rows = tokio::task::spawn_blocking({
            let db = db.clone();
            move || {
                let conn = db.blocking_lock();
                let count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM sync_applied_items WHERE item_id = 'remote-item-replay-1'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                count
            }
        })
        .await
        .unwrap();
    assert_eq!(ledger_rows, 1, "ledger must hold one receipt for the item");
}

/// Spawn a mock pull server that continually returns a malformed remote
/// sale. It is used to verify that transient failures retain the anchor
/// until the retry budget is exhausted, then quarantine the item.
async fn spawn_poison_remote_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "complete_sale",
            r#"{"line_items":[{"sku":"MISSING","qty":1}]}"#,
        );
        item.id = "remote-poison-1".into();
        item.created_at = "2026-01-03T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }
    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-08 regression: a page containing a quarantined item and a fresh
/// retryable item must still retain its anchor for the retryable item.
#[tokio::test]
async fn daemon_does_not_skip_retryable_item_beside_dead_letter() {
    let server_url = spawn_poison_remote_mock_server_with_two_items().await;
    let db = setup_db();
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        conn.execute(
            "INSERT INTO sync_remote_failures
                    (item_id, action, payload, attempts, last_error, dead_lettered)
                 VALUES ('remote-poison-dead', 'complete_sale', '{}', 3, 'permanent', 1)",
            [],
        )
        .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let db_check = db.clone();
    let (anchor, retry_attempts) = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        let store = Store::new(&conn);
        (
            store.get_sync_pull_state().unwrap(),
            conn.query_row(
                "SELECT attempts FROM sync_remote_failures WHERE item_id = 'remote-poison-retry'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        )
    })
    .await
    .unwrap();

    assert!(
        anchor.since.is_none(),
        "retryable item must retain the anchor"
    );
    assert_eq!(retry_attempts, 1);
}

/// Spawn a slow mock sync server whose pull handler BLOCKS on a
/// [`tokio::sync::Notify`] until the test releases it, then returns one
/// remote `stock.adjusted` item.
///
/// The "pull arrived" notify fires as soon as the daemon's pull request
/// reaches the handler — by then the daemon has already captured the
/// durable anchor, so the test has a deterministic window to rewind it
/// mid-pull (the race this regression pins).
async fn spawn_slow_mock_sync_server() -> (String, Arc<Notify>, Arc<Notify>) {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let arrived = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(
        State((arrived, release)): State<(Arc<Notify>, Arc<Notify>)>,
        Json(_req): Json<serde_json::Value>,
    ) -> Json<PullResponse> {
        // Signal that the daemon's pull is in flight (anchor captured),
        // then block until the test rewinds the anchor and releases us.
        arrived.notify_one();
        release.notified().await;
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "stock.adjusted",
            r#"{"sku":"COFFEE","delta":10}"#,
        );
        item.id = "remote-rewind-race-1".into();
        item.created_at = "2026-01-02T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .with_state((arrived.clone(), release.clone()));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), arrived, release)
}

/// SYNC-09 regression: an operator rewind (`requeue_remote_failure`
/// sets `sync_pull_state.since = NULL`) landing while a pull page is in
/// flight must SURVIVE the daemon's apply phase. Previously the apply
/// closure wrote its computed `new_since` blindly, clobbering the
/// rewind — the next cycle then pulled from the advanced anchor and
/// never re-fetched the requeued dead-lettered item.
#[tokio::test]
async fn daemon_pull_does_not_clobber_operator_rewind() {
    let (server_url, pull_arrived, release_pull) = spawn_slow_mock_sync_server().await;
    let db = setup_db();

    // Seed a product + inventory (so the remote adjustment applies
    // cleanly), configure sync, and pre-set a DURABLE anchor so the
    // daemon captures `Some(since)` at tick start.
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
            let conn = db_setup.blocking_lock();
            let store = Store::new(&conn);
            Settings::set_sync_enabled(&conn, true).unwrap();
            Settings::set_sync_server_url(&conn, &url).unwrap();
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
                 VALUES ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at)
                 VALUES ('prod-coffee', 50, '2026-01-01T00:00:00.000Z');",
            )
            .unwrap();
            store
                .set_sync_pull_state(Some("2026-01-01T00:00:00.000Z"), None)
                .unwrap();
        })
        .await
        .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    // Run the tick in the background so the pull is genuinely in flight
    // when we rewind (the race is between the anchor capture and the
    // apply-phase write).
    let tick = {
        let db = db.clone();
        let status = status.clone();
        tokio::spawn(async move {
            daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;
        })
    };

    // Wait until the daemon's pull request reached the server — the
    // anchor is captured by now — then rewind it exactly as an operator
    // requeue would. Timeout so a daemon regression that never reaches
    // the pull phase FAILS this test instead of hanging the suite.
    tokio::time::timeout(Duration::from_secs(10), pull_arrived.notified())
        .await
        .expect("daemon never reached the pull phase");
    let db_rewind = db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_rewind.blocking_lock();
        let store = Store::new(&conn);
        store.set_sync_pull_state(None, None).unwrap();
    })
    .await
    .unwrap();
    release_pull.notify_one();

    tick.await.unwrap();

    // The page still applied (stock 50 → 60) — only the anchor advance
    // must be skipped so the rewind survives for a full re-pull.
    let (anchor, stock) = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            let store = Store::new(&conn);
            (
                store.get_sync_pull_state().unwrap(),
                store.get_stock("prod-coffee").unwrap(),
            )
        }
    })
    .await
    .unwrap();
    assert_eq!(stock, 60, "pull page must still apply despite the rewind");
    assert!(
        anchor.since.is_none(),
        "operator rewind must survive the apply phase (anchor.since = {:?})",
        anchor.since
    );
    assert!(
        anchor.cursor.is_none(),
        "rewound cursor must survive the apply phase (cursor = {:?})",
        anchor.cursor
    );
}

/// Spawn a mock pull server returning one already-quarantined item and
/// one fresh poison item. This pins page-level anchor ordering.
async fn spawn_poison_remote_mock_server_with_two_items() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut dead = oz_core::offline::OfflineQueueItem::new(
            "complete_sale",
            r#"{"line_items":[{"sku":"MISSING-DEAD","qty":1}]}"#,
        );
        dead.id = "remote-poison-dead".into();
        dead.created_at = "2026-01-03T00:00:00.000Z".into();
        let mut retry = oz_core::offline::OfflineQueueItem::new(
            "complete_sale",
            r#"{"line_items":[{"sku":"MISSING-RETRY","qty":1}]}"#,
        );
        retry.id = "remote-poison-retry".into();
        retry.created_at = "2026-01-03T00:00:01.000Z".into();
        Json(PullResponse {
            items: vec![dead, retry],
            next_cursor: None,
        })
    }
    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-08 regression: a failing remote item retains the previous anchor
/// while it is retryable, then becomes a visible dead letter and allows
/// the page anchor to advance after the third failed attempt.
#[tokio::test]
async fn daemon_retains_anchor_until_remote_item_is_dead_lettered() {
    let server_url = spawn_poison_remote_mock_sync_server().await;
    let db = setup_db();
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    for attempt in 1..=3 {
        daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;
        let db_check = db.clone();
        let (anchor, dead_lettered, failures) = tokio::task::spawn_blocking(move || {
            let conn = db_check.blocking_lock();
            let store = Store::new(&conn);
            (
                store.get_sync_pull_state().unwrap(),
                store
                    .is_remote_failure_dead_lettered("remote-poison-1")
                    .unwrap(),
                conn.query_row(
                    "SELECT attempts FROM sync_remote_failures WHERE item_id = 'remote-poison-1'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            )
        })
        .await
        .unwrap();

        if attempt < 3 {
            assert!(
                anchor.since.is_none(),
                "retryable failure must retain anchor"
            );
            assert!(!dead_lettered);
            assert_eq!(failures, attempt);
        } else {
            assert!(anchor.since.is_some(), "dead letter may advance anchor");
            assert!(dead_lettered);
            assert_eq!(failures, 3);
        }
    }

    assert!(
        status.read().await.last_error.is_some(),
        "dead-lettering must remain visible in daemon status"
    );
}

/// Spawn a mock sync server whose push endpoint ALWAYS returns a
/// `Conflict` with a LOWER-version server item. The daemon must route
/// the conflict through the shared ADR #21 service (SYNC-02): the local
/// higher version wins and is marked resolved — never discarded by the
/// old blanket "LWW: remote wins" path.
async fn spawn_conflict_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        let results = items
            .iter()
            .map(|_| {
                PushOutcome::Conflict(oz_core::offline::OfflineQueueItem::new(
                    "product.update",
                    r#"{"version":3,"name":"Server Stale"}"#,
                ))
            })
            .collect();
        Json(PushResponse { results })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-02 regression: when the server returns a Conflict for a pushed
/// item, the daemon must resolve it through the shared ADR #21 service
/// (version LWW here) rather than blanket-marking it synced and
/// re-enqueuing the remote winner.
#[tokio::test]
async fn daemon_resolves_push_conflict_via_shared_service() {
    let server_url = spawn_conflict_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        // Local product.update has version 5 — HIGHER than the server's 3.
        store
            .enqueue_offline("product.update", r#"{"version":5,"name":"Local New"}"#)
            .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let db_check = db.clone();
    let (all, pending) = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        let store = Store::new(&conn);
        (
            store.list_all_offline().unwrap(),
            store.list_pending_offline().unwrap(),
        )
    })
    .await
    .unwrap();

    // The local item must be marked resolved (synced) with the local-won
    // tag — the shared service decided local v5 > server v3. Nothing may
    // be re-enqueued (old behavior re-enqueued the server's stale v3).
    assert_eq!(all.len(), 1, "no remote winner may be re-enqueued");
    assert!(pending.is_empty(), "local winner must not stay pending");
    assert_eq!(all[0].status, oz_core::offline::OfflineQueueStatus::Synced);
    assert!(
        all[0]
            .last_error
            .as_deref()
            .unwrap_or("")
            .contains("resolved: conflict (local won)"),
        "daemon must record the ADR #21 resolution tag, got: {:?}",
        all[0].last_error
    );
}

/// Mock sync server whose push endpoint ALWAYS returns a `duplicate id:`
/// Rejected — the shape the real server produces when an item id already
/// exists (`sync_store.rs` `push_batch`). This is the crash-then-repush
/// recovery signal, not a genuine rejection.
async fn spawn_duplicate_id_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        let results = items
            .iter()
            .map(|it| PushOutcome::Rejected {
                reason: format!(
                    "duplicate id: {}",
                    it.get("id").and_then(|v| v.as_str()).unwrap_or("")
                ),
            })
            .collect();
        Json(PushResponse { results })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// Crash-recovery regression: when the server reports a pushed item as a
/// `duplicate id:` Rejected (it already holds the item), the daemon must mark
/// it SYNCED, not terminal-failed. Push-side failed items have no requeue
/// path, so a mislabeled replay would strand a successfully-synced item
/// forever and pollute `failed_count`.
#[tokio::test]
async fn daemon_marks_duplicate_id_replay_synced_not_failed() {
    let server_url = spawn_duplicate_id_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        store
            .enqueue_offline("complete_sale", r#"{"id":1}"#)
            .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let db_check = db.clone();
    let (all, pending, summary) = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        let store = Store::new(&conn);
        (
            store.list_all_offline().unwrap(),
            store.list_pending_offline().unwrap(),
            store.offline_queue_status_summary().unwrap(),
        )
    })
    .await
    .unwrap();

    assert_eq!(all.len(), 1);
    assert!(pending.is_empty(), "duplicate-id replay must leave pending");
    assert_eq!(
        all[0].status,
        oz_core::offline::OfflineQueueStatus::Synced,
        "a duplicate-id replay is an idempotent success, not a failure"
    );
    assert_eq!(summary.failed_count, 0, "failed_count must not be polluted");
    assert_eq!(summary.synced_count, 1);
}

/// SYNC-05 daemon end-to-end: a stock conflict must be resolved via the
/// shared ADR #21 service into a CRDT merge, the merged winner must be
/// re-enqueued, AND a later pull of that same merged item must be
/// consumable by the daemon's apply_remote (both deltas land in stock).
///
/// Mock: push returns a Conflict with a lower server stock delta; pull
/// returns the merged crdt_delta envelope (fixed id so the SYNC-01
/// ledger absorbs replays).
async fn spawn_crdt_conflict_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        let results = items
            .iter()
            .map(|_| {
                PushOutcome::Conflict(oz_core::offline::OfflineQueueItem::new(
                    "stock.adjusted",
                    r#"{"sku":"COFFEE","delta":-3}"#,
                ))
            })
            .collect();
        Json(PushResponse { results })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut winner = oz_core::offline::OfflineQueueItem::new(
            "stock.adjusted",
            r#"{"local":{"sku":"COFFEE","delta":10},"remote":{"sku":"COFFEE","delta":-3},"merge_type":"crdt_delta"}"#,
        );
        winner.id = "remote-crdt-winner-1".into();
        winner.created_at = "2026-01-02T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![winner],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

#[tokio::test]
async fn daemon_crdt_conflict_merge_is_consumable_end_to_end() {
    let server_url = spawn_crdt_conflict_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
            let conn = db_setup.blocking_lock();
            let store = Store::new(&conn);
            Settings::set_sync_enabled(&conn, true).unwrap();
            Settings::set_sync_server_url(&conn, &url).unwrap();
            conn.execute_batch(
                "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at)
                 VALUES ('prod-coffee', 'COFFEE', 'Coffee', 350, 'USD', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
                 INSERT INTO inventory (product_id, qty, updated_at)
                 VALUES ('prod-coffee', 50, '2026-01-01T00:00:00.000Z');",
            )
            .unwrap();
            store
                .enqueue_offline(
                    "stock.adjusted",
                    r#"{"sku":"COFFEE","delta":10}"#,
                )
                .unwrap();
        })
        .await
        .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    // One tick: push → conflict → CRDT merge resolved locally; pull →
    // merged winner applied by apply_remote. Both deltas must land.
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let db_check = db.clone();
    let (stock, all) = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        let store = Store::new(&conn);
        (
            store.get_stock("prod-coffee").unwrap(),
            store.list_all_offline().unwrap(),
        )
    })
    .await
    .unwrap();

    // 50 + 10 (local) - 3 (remote) = 57 — the merge survives push→pull.
    assert_eq!(stock, 57, "both CRDT deltas must be applied by the daemon");

    // The local item carries the crdt-merge resolution tag. Match on
    // the tag itself (NOT on payload content): the re-enqueued merged
    // winner also embeds `"delta":10` inside its envelope, and
    // list_all_offline orders by created_at DESC (winner first), so a
    // payload-based lookup would grab the wrong row.
    let local = all.iter().find(|i| {
        i.last_error
            .as_deref()
            .unwrap_or("")
            .contains("resolved: conflict (crdt merge)")
    });
    assert!(
        local.is_some(),
        "local stock item must carry the crdt-merge tag, got: {:?}",
        all.iter().map(|i| &i.last_error).collect::<Vec<_>>()
    );
}

/// When the DB read phase succeeds, `run_tick` must update status
/// without setting `last_error`. This is the regression guard for
/// Bug #1 — verifies the refactored match arms don't break the
/// happy path.
#[tokio::test]
async fn run_tick_happy_path_does_not_set_error() {
    let db = setup_db();
    let status = Arc::new(RwLock::new(DaemonStatus::default()));

    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let s = status.read().await;
    assert!(s.last_sync_at.is_some(), "status should be updated");
    assert!(s.last_error.is_none(), "no error expected for empty config");
    assert_eq!(s.last_pushed, 0);
    assert_eq!(s.last_pulled, 0);
}

/// A settings sink that records nothing — for run_tick call sites that
/// only care about the sync pipeline, not settings reactivity.
fn noop_settings_sink() -> SettingsChangedSink {
    Arc::new(|_: &SettingsUpdated| {})
}

/// Spawn a mock pull server returning one remote `settings.update` item
/// (fixed id + timestamp so the SYNC-01 ledger absorbs replays).
async fn spawn_settings_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut item = oz_core::offline::OfflineQueueItem::new(
            "settings.update",
            r#"{"key":"store.name","value":"Remote Acme","terminal_id":"term-remote","version":3}"#,
        );
        item.id = "remote-setting-sync-1".into();
        item.created_at = "2026-01-02T00:00:00.000Z".into();
        Json(PullResponse {
            items: vec![item],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull));

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

/// SYNC-10: when the pull applies a remote `settings.update`, the
/// daemon must invoke its settings sink with the changed key so the app
/// can re-emit `SettingsUpdated` — and the value row must actually land.
#[tokio::test]
async fn daemon_publishes_settings_updated_for_remote_settings_change() {
    let server_url = spawn_settings_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
    })
    .await
    .unwrap();

    let recorded: Arc<std::sync::Mutex<Vec<(String, String)>>> =
        Arc::new(std::sync::Mutex::new(vec![]));
    let sink: SettingsChangedSink = Arc::new({
        let recorded = recorded.clone();
        move |event: &SettingsUpdated| {
            for key in &event.changed_keys {
                recorded
                    .lock()
                    .unwrap()
                    .push((key.clone(), event.terminal_id.clone()));
            }
        }
    });

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &sink).await;

    assert_eq!(
        *recorded.lock().unwrap(),
        vec![("store.name".to_string(), "term-remote".to_string())],
        "the daemon must publish the remote settings change via the sink"
    );

    let value = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            Settings::get(&conn, "store.name").unwrap()
        }
    })
    .await
    .unwrap();
    assert_eq!(
        value.as_deref(),
        Some("Remote Acme"),
        "the settings row must be applied from the pull"
    );
}
