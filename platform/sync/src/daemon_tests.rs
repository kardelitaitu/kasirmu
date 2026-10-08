//! Unit tests for the sync daemon: lifecycle/backoff basics, ADR #11
//! server-migration redirects, SYNC-01 durable anchor + idempotent replay,
//! SYNC-08 quarantine vs retryable ordering, SYNC-09 operator-rewind race,
//! SYNC-02/05 conflict resolution via the shared ADR #21 service,
//! SYNC-10 remote settings-change sink, and the two SYNC-EW wakeup
//! promises (`nudge` stores while stopped; a burst coalesces to one
//! permit). Extracted from the inline `mod tests` in `daemon.rs` (F-018).

use super::*;
use crate::transport::{PullResponse, PushOutcome, PushResponse};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use kasirmu_core::migrations;
use kasirmu_core::settings::Settings;
use tokio::sync::Notify;

fn setup_db() -> DbConnection {
    Arc::new(Mutex::new(migrations::fresh_db()))
}

/// Wait for a daemon condition by polling `status()`, not by sleeping a
/// multiple of the tick.
///
/// O-T05 (`todo-optimize-crates.md:1158`). Every daemon test slept a fixed
/// 500 ms after `start()` and 200 ms after `stop()` against a daemon whose
/// tick is 100 ms — a 5x floor paid on each of the seven start/stop pairs,
/// ~5.0 s of the 16.6 s stated sleep floor `platform/sync` contributes to the
/// workspace's 28.6 s (§10B). It was also the wrong shape: a fixed sleep buys
/// the same margin on a fast machine and a loaded one, so it is either wasteful
/// or flaky and never tells you which.
///
/// This polls every 10 ms with a 1 s ceiling. A healthy daemon finishes in one
/// tick (100 ms or better), so the typical case gets faster, and the ceiling is
/// still 2x the old start allowance. `what` is named in the panic because a
/// timeout that only says "timed out" is the least useful failure a test can
/// produce — the status snapshot is printed so the condition is visible.
async fn wait_for_daemon<F>(daemon: &SyncDaemon, what: &str, mut ok: F)
where
    F: FnMut(&DaemonStatus) -> bool,
{
    for _ in 0..100 {
        if ok(&daemon.status().await) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let status = daemon.status().await;
    panic!(
        "daemon never reached `{what}` within 1s — running={}, last_sync_at={:?}, last_error={:?}",
        status.running, status.last_sync_at, status.last_error
    );
}

/// Wait for the daemon to have completed at least one cycle.
async fn wait_for_first_cycle(daemon: &SyncDaemon) {
    wait_for_daemon(daemon, "a completed first cycle", |s| {
        s.last_sync_at.is_some()
    })
    .await;
}

/// Wait for the daemon to be fully stopped, rather than assuming `stop()`
/// returning means the run loop has exited.
async fn wait_for_stopped(daemon: &SyncDaemon) {
    wait_for_daemon(daemon, "stopped", |s| !s.running).await;
}

/// Spawn a mock sync server whose push endpoint always answers 500.
///
/// Used to pin the outbound logical-clock contract: a push that FAILS must
/// still advance the PERSISTED counter, because \`SyncTransport::push_items\`
/// burns one counter per queued item before the HTTP call is even made.
/// Leaving the persisted value behind lets the next cycle (or a restart)
/// re-emit a counter range the server may already have recorded.
async fn spawn_rejecting_mock_sync_server() -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    async fn handle_push() -> impl IntoResponse {
        (StatusCode::INTERNAL_SERVER_ERROR, "boom")
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

/// Spawn a mock server that COUNTS pull hits and returns an empty page.
///
/// Used by the pull-anchor pins: a daemon that replays history must show up as
/// a hit, so 'the pull was skipped' is observable rather than assumed.
async fn spawn_counting_pull_server() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let state = hits.clone();

    async fn handle_push(Json(items): Json<Vec<serde_json::Value>>) -> Json<PushResponse> {
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; items.len()],
        })
    }
    async fn handle_pull(
        State(hits): State<Arc<AtomicUsize>>,
        Json(_req): Json<serde_json::Value>,
    ) -> Json<PullResponse> {
        hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .with_state(state);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    (format!("http://localhost:{port}"), hits)
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
    wait_for_first_cycle(&daemon).await;
    let status = daemon.status().await;
    assert!(status.last_sync_at.is_some());
    daemon.stop().await;
    wait_for_stopped(&daemon).await;
}

#[tokio::test]
async fn daemon_skips_when_sync_not_configured() {
    let db = setup_db();
    let daemon = SyncDaemon::with_interval(Duration::from_millis(100));
    daemon.start(db).await;
    wait_for_first_cycle(&daemon).await;
    let status = daemon.status().await;
    assert!(status.last_error.is_none());
    assert!(status.last_sync_at.is_some());
    daemon.stop().await;
    wait_for_stopped(&daemon).await;
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
    wait_for_first_cycle(&daemon).await;

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
    wait_for_stopped(&daemon).await;
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
    wait_for_first_cycle(&daemon).await;

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
    wait_for_stopped(&daemon).await;
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
    .unwrap()
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

// ── C20: priority ordering on the push path ──────────────────────
//
// The F-018 split extracted the read phase into `read_config_and_pending`,
// which takes a `&Connection` directly. That REMOVED the case the "TDD Bug
// #1" section used to document — the read no longer runs inside the
// `spawn_blocking` closure, so it holds no `Mutex` guard and cannot panic on
// a poisoned lock. The old doc comment was left attached to nothing and the
// test it described no longer had a subject, which is why clippy reported
// "empty line after doc comment" (C25).
//
// The panic path itself still exists and is still handled: every closure that
// DOES take the lock joins through `spawn_blocking` and surfaces a
// `JoinError` (daemon.rs:157, :189, :214; the prune path logs it at :507), so
// the behaviour is covered where it actually lives. Nothing is owed here.

/// The acceptance case: a LOW-priority item is enqueued FIRST, so the
/// un-sorted read (`ORDER BY created_at ASC`) puts it at the head of the batch
/// and it would be pushed before the Critical one. The daemon must send
/// Critical first.
#[test]
fn read_config_and_pending_orders_critical_before_an_earlier_low_item() {
    use kasirmu_core::offline::SyncPriority;

    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    // Enqueued in the WRONG order on purpose: Low arrives first, so
    // created_at ASC alone would keep it ahead of Critical.
    store
        .enqueue_offline_priority("bulk", r#"{}"#, SyncPriority::Low)
        .unwrap();
    store
        .enqueue_offline_priority("money", r#"{}"#, SyncPriority::Critical)
        .unwrap();
    store
        .enqueue_offline_priority("catalog", r#"{}"#, SyncPriority::Normal)
        .unwrap();

    let (_config, pending) = read_config_and_pending(&conn).unwrap();

    let order: Vec<&str> = pending.iter().map(|i| i.action.as_str()).collect();
    assert_eq!(
        order,
        vec!["money", "catalog", "bulk"],
        "Critical must transmit before Normal, which before Low — the priority column is what the push order is FOR"
    );
}

/// The tie-break, stated as a test rather than left to the sort's mercy.
/// Same priority and the same millisecond `created_at`: the order must still be
/// deterministic (UUID v7 `id`), so two reads agree.
#[test]
fn equal_priority_items_are_ordered_deterministically_by_id() {
    use kasirmu_core::offline::SyncPriority;

    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    for action in ["c", "a", "b"] {
        store
            .enqueue_offline_priority(action, r#"{}"#, SyncPriority::Critical)
            .unwrap();
    }
    // Force identical timestamps: with millisecond precision three enqueues in
    // a loop can already collide, and this makes the collision the fixture
    // rather than an accident of timing.
    conn.execute(
        "UPDATE offline_queue SET created_at = '2026-01-01T00:00:00.000Z'",
        [],
    )
    .unwrap();

    let first = read_config_and_pending(&conn).unwrap().1;
    let second = read_config_and_pending(&conn).unwrap().1;
    let ids = |v: &[kasirmu_core::offline::OfflineQueueItem]| {
        v.iter().map(|i| i.id.clone()).collect::<Vec<_>>()
    };
    assert_eq!(
        ids(&first),
        ids(&second),
        "equal-priority, equal-timestamp items must not reorder between reads"
    );
    // And the tie-break is the id, ascending — provable because ids are unique.
    let mut sorted_ids = ids(&first);
    sorted_ids.sort();
    assert_eq!(
        ids(&first),
        sorted_ids,
        "ties break on the unique id, ascending"
    );
}

/// Within one tier the arrival order is preserved, which is what keeps a batch
/// of same-priority sales in the order the till took them.
#[test]
fn same_priority_items_keep_their_arrival_order() {
    use kasirmu_core::offline::SyncPriority;

    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    for (action, at) in [
        ("first", "2026-01-01T00:00:00.000Z"),
        ("second", "2026-01-01T00:00:01.000Z"),
        ("third", "2026-01-01T00:00:02.000Z"),
    ] {
        store
            .enqueue_offline_priority(action, r#"{}"#, SyncPriority::Critical)
            .unwrap();
        conn.execute(
            "UPDATE offline_queue SET created_at = ?1 WHERE action = ?2",
            rusqlite::params![at, action],
        )
        .unwrap();
    }

    let order: Vec<String> = read_config_and_pending(&conn)
        .unwrap()
        .1
        .iter()
        .map(|i| i.action.clone())
        .collect();
    assert_eq!(order, vec!["first", "second", "third"]);
}

#[test]
fn read_config_and_pending_returns_pending_count() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.enqueue_offline("test", r#"{}"#).unwrap();

    let (config, pending) = read_config_and_pending(&conn).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action, "test");
    // Config is None because sync is not enabled in fresh DB.
    assert!(config.is_none());
}

#[test]
fn read_config_and_pending_bounds_batch_size_to_max_outbox_items() {
    use kasirmu_core::offline::SyncPriority;

    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);

    // Enqueue 150 items: 140 Low items, then 10 Critical items.
    for i in 0..140 {
        store
            .enqueue_offline_priority(&format!("bulk_{i}"), r#"{}"#, SyncPriority::Low)
            .unwrap();
    }
    for i in 0..10 {
        store
            .enqueue_offline_priority(&format!("critical_{i}"), r#"{}"#, SyncPriority::Critical)
            .unwrap();
    }

    let (_config, pending) = read_config_and_pending(&conn).unwrap();

    assert_eq!(
        pending.len(),
        DEFAULT_MAX_OUTBOX_BATCH_ITEMS,
        "read_config_and_pending must bound outbox items to DEFAULT_MAX_OUTBOX_BATCH_ITEMS"
    );

    // All 10 critical items must be present in the truncated batch
    let critical_count = pending
        .iter()
        .filter(|item| item.priority == SyncPriority::Critical)
        .count();
    assert_eq!(
        critical_count, 10,
        "Critical priority items must be ordered first and retained in the bounded batch"
    );
}

/// A queue that cannot be read must NOT look like an empty queue.
///
/// An empty `pending` is indistinguishable from a healthy idle terminal: the
/// daemon pushes nothing, reports `pushed = 0`, and (before this fix) left
/// `last_error` clean — so an operator sees a draining backlog that has in
/// fact stopped. `read_config_and_pending` now propagates the read error so it
/// reaches the cycle's `read_error` instead of being flattened to `[]`. RED
/// before the fix: `list_pending_offline().unwrap_or_default()` returned
/// `Ok((None, vec![]))` here and the test could not even observe the failure.
#[test]
fn read_config_and_pending_errors_when_the_offline_queue_cannot_be_read() {
    let conn = kasirmu_core::migrations::fresh_db();
    // Drop the table the read needs, so the query fails for a reason other
    // than 'no rows' (the healthy empty case).
    conn.execute("DROP TABLE offline_queue", []).unwrap();

    let result = read_config_and_pending(&conn);
    assert!(
        result.is_err(),
        "an unreadable queue must surface as an error, not as an empty push list"
    );
}

/// An unreadable pull anchor must surface on `last_error`, not silently force a
/// full re-pull.
///
/// `(None, None)` is the SAME state an operator rewind requests, so collapsing
/// a read failure into it would replay all history every cycle with no error
/// shown — the fail-blind shape, and the exact replay the SYNC-01 anchor exists
/// to prevent. The daemon now propagates the read error and skips the pull.
///
/// RED before the fix: `.unwrap_or_default()` produced `(None, None)`, the pull
/// ran, and `last_error` stayed `None`.
#[tokio::test]
async fn run_tick_surfaces_an_unreadable_pull_anchor_instead_of_replaying() {
    let (server_url, pull_hits) = spawn_counting_pull_server().await;
    let db = setup_db();
    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        // Sync is ENABLED and pointed at the mock server, so the pull phase
        // is reachable — otherwise the anchor is never read and the pin would
        // pass for the wrong reason.
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        // Drop the anchor table AFTER the settings are written.
        conn.execute("DROP TABLE sync_pull_state", []).unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let s = status.read().await;
    assert!(
        s.last_error.is_some(),
        "an unreadable pull anchor must surface on last_error, not read as (None, None)"
    );
    assert_eq!(
        pull_hits.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "the daemon must SKIP the pull when the anchor is unreadable, not replay history"
    );
}

/// The HTTP daemon's `pending_count` must distinguish "the queue is empty"
/// from "the count could not be read". It feeds `sync_status`, the operator's
/// backlog-draining indicator, so a failure reported as `0` would tell a broken
/// terminal everything has synced. Same sentinel as the PG daemon and the cloud
/// server's `SyncStatusResponse::pending_count`.
#[test]
fn daemon_pending_count_unknown_sentinel_is_shared_and_distinct_from_zero() {
    // One value, defined on the base daemon module, re-exported by the PG one.
    assert_eq!(PENDING_COUNT_UNKNOWN, -1);
    assert_eq!(
        PENDING_COUNT_UNKNOWN,
        crate::pg_daemon::PENDING_COUNT_UNKNOWN
    );
    assert_ne!(PENDING_COUNT_UNKNOWN, 0);
}

/// The read path `update_daemon_status` calls fails when the table is gone —
/// which is what makes the `-1` arm reachable rather than decorative. Before
/// this, `update_daemon_status` collapsed exactly this error into `0`.
#[test]
fn daemon_pending_offline_count_errors_when_the_table_is_missing() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch("DROP TABLE offline_queue;").unwrap();
    let store = Store::new(&conn);
    assert!(store.pending_offline_count().is_err());
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
        let mut item = kasirmu_core::offline::OfflineQueueItem::new(
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
        // A malformed payload is CoreError::Internal (TRANSIENT): the item
        // stays retryable until the three-attempt budget is spent.
        let mut item = kasirmu_core::offline::OfflineQueueItem::new("complete_sale", "{not json");
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
        let mut item = kasirmu_core::offline::OfflineQueueItem::new(
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
        let mut dead = kasirmu_core::offline::OfflineQueueItem::new(
            "complete_sale",
            r#"{"line_items":[{"sku":"MISSING-DEAD","qty":1}]}"#,
        );
        dead.id = "remote-poison-dead".into();
        dead.created_at = "2026-01-03T00:00:00.000Z".into();
        // The retry item must fail TRANSIENTLY, or it would be
        // quarantined on its first failure like the dead one below.
        let mut retry = kasirmu_core::offline::OfflineQueueItem::new("complete_sale", "{not json");
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
                PushOutcome::Conflict(kasirmu_core::offline::OfflineQueueItem::new(
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
    assert_eq!(
        all[0].status,
        kasirmu_core::offline::OfflineQueueStatus::Synced
    );
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
        kasirmu_core::offline::OfflineQueueStatus::Synced,
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
                PushOutcome::Conflict(kasirmu_core::offline::OfflineQueueItem::new(
                    "stock.adjusted",
                    r#"{"sku":"COFFEE","delta":-3}"#,
                ))
            })
            .collect();
        Json(PushResponse { results })
    }
    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        let mut winner = kasirmu_core::offline::OfflineQueueItem::new(
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
        let mut item = kasirmu_core::offline::OfflineQueueItem::new(
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

// ── ADR #11 redirect: status-blindness and unvalidated new_url — KNOWN HAZARD PINS ──
//
// THESE THREE TESTS PIN AUTO-UPDATE BEHAVIOUR, NOT A DESIGN GUARANTEE. A green run
// below is evidence of what the daemon DOES, not of what it was meant to do: nothing
// in transport.rs or daemon_tick.rs says "redirect on any non-2xx" or "accept any
// string as a host". Both are consequences of an ABSENT check, and an absent check is
// not a contract. Each test is written to go RED when the guard lands, and that red is
// the deliverable.
//
// The emitter side is narrow, which is what makes the fix cheap:
// redirect_middleware (apps/cloud-server/src/redirect.rs) answers a migration with
// StatusCode::MISDIRECTED_REQUEST (421) and nothing else, so a client-side 421 gate
// costs a real deployment nothing. And 421 appears nowhere in this crate — measured at
// HEAD: grep -c '421' platform/sync/src/transport.rs -> 1, and that single hit is the
// "ISO-4217 currency code." doc comment at :86.

/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT. FLIP THIS ASSERTION, DO NOT DELETE IT.
///
/// The three migration arms — push (transport.rs:355), pull (:428) and snapshot
/// (:512) — sit inside `if !resp.status().is_success()`. That is the whole finding: ANY
/// non-2xx whose body parses as {"error":"server_migrated","new_url":...} redirects, so
/// a 500 from a crashing proxy, a 502 from an intermediary or a 503 maintenance page all
/// repoint the sync target of a running install. `parse_server_migrated` (:563-:570)
/// reads exactly two JSON fields and never looks at the status. The 421 test above
/// (`daemon_auto_updates_url_on_server_migration`) is this test's positive control — it
/// varies nothing but the status code.
///
/// Two properties this CANNOT pin, named so nobody reads the set as complete:
///
/// * The write is UNTRACKED. `persist_migration_url` (daemon_tick.rs:77-:87) calls
///   `Settings::set_sync_server_url`, which is the bare `Self::set`
///   (platform/core/src/settings/typed.rs:327 -> raw.rs:37), NOT `set_with_policy`
///   (raw.rs:98). The row therefore changes with no delta-ledger entry and no audit
///   row — and no assertion can read a missing record, which is why this is a
///   comment and not a fourth test.
/// * The escalation is worse than the write. The next tick rebuilds the transport with
///   `Authorization: Bearer <api key>` installed as a DEFAULT header
///   (transport.rs:299-:305); if that new host answers 401,
///   `push_retry_after_auth_refresh` (daemon_tick.rs:30) calls
///   `refresh_persisted_api_key(db, &cfg.server_url)`, which POSTS
///   `request_token_client_credentials(server_url, terminal_id, terminal_secret)`
///   (daemon.rs:149) — the device identity plus the whole pending batch, to the host
///   the response named. Not pinned: that needs a listener answering 421 once and
///   401 after, which is a fixture, not a test.
#[tokio::test]
async fn daemon_migration_redirect_is_obeyed_on_server_error_pin() {
    use crate::test_helpers::spawn_status_migration_server;

    let new_url = "https://status-blind.example.com";
    let old_url = spawn_status_migration_server(new_url, 500).await;
    let db = setup_db();

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
    wait_for_first_cycle(&daemon).await;

    let updated_url = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        Settings::get_sync_server_url(&conn).unwrap()
    })
    .await
    .unwrap();

    assert_eq!(
        updated_url.as_deref(),
        Some(new_url),
        "GREEN TODAY AND THAT IS THE FINDING: a plain 500 rewrote the sync target. Flip the expected value to Some(old_url) when the 421 gate lands; do not delete this test."
    );

    daemon.stop().await;
    wait_for_stopped(&daemon).await;
}

/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT. FLIP THIS ASSERTION, DO NOT DELETE IT.
///
/// No TLS floor. A 421 naming an `http://` host is obeyed exactly like one naming an
/// `https://` host, so after one cycle the api key and every queued item go in
/// cleartext to whatever answers that port. Nothing between `parse_server_migrated`
/// (transport.rs:563-:570) and `persist_migration_url` (daemon_tick.rs:77-:87) inspects
/// the scheme, and the setter is the bare `Self::set`, so no policy door sees it either.
///
/// Status is deliberately left at the real 421 here, using the existing
/// `spawn_redirect_server`: the server in this test is telling the truth about the
/// migration, and the client is STILL downgraded. That separates this finding from the
/// status-blindness one above — a 421 gate alone would not close it.
#[tokio::test]
async fn daemon_migration_redirect_accepts_plain_http_target_pin() {
    let new_url = "http://downgraded.example.com:8080";
    let old_url = spawn_redirect_server(new_url).await;
    let db = setup_db();

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
    wait_for_first_cycle(&daemon).await;

    let updated_url = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        Settings::get_sync_server_url(&conn).unwrap()
    })
    .await
    .unwrap();

    assert_eq!(
        updated_url.as_deref(),
        Some(new_url),
        "GREEN TODAY AND THAT IS THE FINDING: a correct 421 still moved this install onto plain http. Flip to Some(old_url) when new_url is required to be https; do not delete this test."
    );

    daemon.stop().await;
    wait_for_stopped(&daemon).await;
}

/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT. FLIP THIS ASSERTION, DO NOT DELETE IT.
///
/// No shape check at all. `new_url` is stored verbatim whatever it is — here a relative
/// path, which is not a server address in any reading, and which is persisted because
/// `parse_server_migrated` returns `Some(String::from)` for any JSON string under the
/// `new_url` key with no validation of scheme, host, or length.
///
/// The persistence happens BEFORE anything tries to use the value, so the visible damage
/// is not a failed request: the sync target now holds a string no config screen could
/// have produced, with no delta row and no audit row (pin one, second bullet). The
/// control below proves the row was reachable and the daemon was running, so the change
/// cannot be explained by an unrelated setup failure.
#[tokio::test]
async fn daemon_migration_redirect_persists_an_unshaped_target_pin() {
    let new_url = "/not-a-server";
    let old_url = spawn_redirect_server(new_url).await;
    let db = setup_db();

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
    wait_for_first_cycle(&daemon).await;

    let (updated_url, still_enabled) = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        (
            Settings::get_sync_server_url(&conn).unwrap(),
            Settings::get(&conn, "sync_enabled")
                .unwrap()
                .map(|v| v != "false")
                .unwrap_or(false),
        )
    })
    .await
    .unwrap();

    assert_eq!(
        updated_url.as_deref(),
        Some(new_url),
        "GREEN TODAY AND THAT IS THE FINDING: the literal string /not-a-server is now this install's sync server. Flip to Some(old_url) when new_url is validated; do not delete this test."
    );
    assert!(
        still_enabled,
        "control: sync must still be enabled for this row to prove the redirect wrote it"
    );

    daemon.stop().await;
    wait_for_stopped(&daemon).await;
}

// ── SYNC-EW: the two promises `nudge` makes ───────────────────────
//
// `nudge`'s doc comment commits to two observable properties, and neither had a
// test: a wakeup issued while the daemon is stopped is *stored*, and a burst
// coalesces into a *single* permit. `wakeup_handle` exists to make both
// observable — it was added with the feature and had no caller, so rustc
// reported it as dead code in both daemons. These two tests are its callers.

/// A `nudge()` before the daemon is listening must be STORED, not dropped — the
/// documented "if the daemon is not running the notification is stored and
/// consumed on the next `start`". A listener attached afterwards therefore finds
/// the permit already set and completes without waiting.
#[tokio::test]
async fn nudge_while_stopped_stores_one_permit() {
    let daemon = SyncDaemon::new();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), daemon.wakeup_handle().notified())
        .await
        .expect("a nudge issued while stopped must be stored, not dropped");
}

/// Three nudges must leave exactly ONE pending permit, because `Notify` does not
/// queue. The second `notified()` is the discriminator: if the burst had queued,
/// it would complete immediately instead of waiting out the timeout.
#[tokio::test]
async fn nudge_coalesces_a_burst_into_one_permit() {
    let daemon = SyncDaemon::new();
    let handle = daemon.wakeup_handle();

    daemon.nudge();
    daemon.nudge();
    daemon.nudge();

    tokio::time::timeout(Duration::from_secs(2), handle.notified())
        .await
        .expect("the first permit of the burst must be observable");

    assert!(
        tokio::time::timeout(Duration::from_millis(50), handle.notified())
            .await
            .is_err(),
        "three nudges must coalesce into one permit; a second permit means Notify queued"
    );
}

// ── C23: the running flag must not outlive the task that owns it ─────
//
// The daemon owns `running` for as long as its run-loop task lives. The
// pre-C23 code cleared the flag with a statement placed AFTER the loop, so a
// panic unwinding out of a tick skipped it: `running` stayed true and
// `start` then refused with "already running" until the process restarted.
//
// The guard that replaces it decides supersession by comparing the sender in
// the shutdown slot against this run's OWN sender. "The slot is Some" is not
// that test -- a healthy run holds its own sender there for its whole life --
// and these tests pin the difference in both directions.

/// What a run owns at spawn: its shared status, the shutdown slot, and the
/// guard that releases the flag when the task ends.
type ArmedGuard = (
    Arc<RwLock<DaemonStatus>>,
    Arc<Mutex<Option<watch::Sender<bool>>>>,
    RunningFlagGuard<DaemonStatus>,
);

/// Build the triple above.
fn armed_guard(running: bool) -> ArmedGuard {
    let status = Arc::new(RwLock::new(DaemonStatus {
        running,
        ..Default::default()
    }));
    let (tx, _rx) = watch::channel(false);
    let own = tx.clone();
    let slot = Arc::new(Mutex::new(Some(tx)));
    let guard = RunningFlagGuard::arm(Arc::clone(&status), Arc::clone(&slot), own);
    (status, slot, guard)
}

/// THE DEFECT. A panic inside a tick must still release the flag.
#[tokio::test]
async fn the_running_flag_is_cleared_when_the_owning_task_panics() {
    let status = Arc::new(RwLock::new(DaemonStatus {
        running: true,
        ..Default::default()
    }));
    let (tx, _rx) = watch::channel(false);
    let own = tx.clone();
    let slot = Arc::new(Mutex::new(Some(tx)));

    let task = tokio::spawn({
        let status = Arc::clone(&status);
        let slot = Arc::clone(&slot);
        async move {
            let _guard = RunningFlagGuard::arm(status, slot, own);
            panic!("tick panicked");
        }
    });

    assert!(
        task.await.is_err(),
        "the spawned task must actually panic for this test to mean anything"
    );

    for _ in 0..100 {
        if !status.read().await.running {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!(
        "running is still true after the owning task panicked -- the daemon is wedged          and start() will refuse with 'already running' until restart (C23)"
    );
}

/// The orderly path clears synchronously, so `stop()` -- which awaits the
/// run-loop task -- observes the flag already cleared.
#[tokio::test]
async fn the_orderly_path_clears_the_flag() {
    let (status, _slot, guard) = armed_guard(true);
    guard.clear().await;
    assert!(
        !status.read().await.running,
        "clear() must clear the flag before returning"
    );
}

/// A run that still owns the slot clears on drop: the normal exit and every
/// early return, neither of which goes through `clear()`.
#[tokio::test]
async fn a_run_that_still_owns_the_slot_clears_on_drop() {
    let (status, _slot, guard) = armed_guard(true);
    drop(guard);
    assert!(
        !status.read().await.running,
        "dropping the guard with the slot still ours must clear the flag"
    );
}

/// Supersession: a newer run has installed ITS OWN sender, so the old run must
/// leave the status alone. This is the rule the manual code carried.
#[tokio::test]
async fn a_superseded_run_does_not_clear_the_new_runs_flag() {
    let status = Arc::new(RwLock::new(DaemonStatus {
        running: true,
        ..Default::default()
    }));
    let (old_tx, _old_rx) = watch::channel(false);
    let (new_tx, _new_rx) = watch::channel(false);
    let slot = Arc::new(Mutex::new(Some(new_tx)));

    // Orderly path: clear() must honour the ownership rule.
    RunningFlagGuard::arm(Arc::clone(&status), Arc::clone(&slot), old_tx.clone())
        .clear()
        .await;
    assert!(
        status.read().await.running,
        "a superseded run cleared the flag a newer run owns (orderly path)"
    );

    // Drop path: the panic/early-return route must apply the same rule.
    drop(RunningFlagGuard::arm(Arc::clone(&status), slot, old_tx));
    assert!(
        status.read().await.running,
        "a superseded run cleared the flag a newer run owns (drop path)"
    );
}

/// An EMPTY slot is NOT supersession. `stop()` takes this run's sender
/// before awaiting the loop, so the slot is `None` on the ordinary shutdown
/// path — and the flag must still clear. An earlier revision read `None` as
/// "not ours" and left `running` true after every stop, which the lifecycle
/// tests caught; this pins the case directly so it cannot regress again.
#[tokio::test]
async fn an_empty_slot_still_clears_the_flag() {
    let (status, slot, guard) = armed_guard(true);
    // Simulate stop(): consume the slot's sender.
    *slot.lock().await = None;

    guard.clear().await;
    assert!(
        !status.read().await.running,
        "an empty slot means stop() took our sender -- the normal path -- and \
         must clear the flag, not be mistaken for supersession"
    );
}

/// The same case on the drop path.
#[tokio::test]
async fn an_empty_slot_clears_the_flag_on_drop() {
    let (status, slot, guard) = armed_guard(true);
    *slot.lock().await = None;
    drop(guard);
    assert!(
        !status.read().await.running,
        "an empty slot must clear the flag on the drop path too"
    );
}

/// Presence of a sender is NOT ownership: the run's own sender is absent from
/// the slot, so the flag must stand even though the slot is `Some`.
#[tokio::test]
async fn presence_of_a_sender_is_not_ownership() {
    let status = Arc::new(RwLock::new(DaemonStatus {
        running: true,
        ..Default::default()
    }));
    let (own_tx, _own_rx) = watch::channel(false);
    let (other_tx, _other_rx) = watch::channel(false);
    let slot = Arc::new(Mutex::new(Some(other_tx)));

    drop(RunningFlagGuard::arm(Arc::clone(&status), slot, own_tx));

    assert!(
        status.read().await.running,
        "the slot holds a sender, but not this run's -- the flag must stand"
    );
}

/// A push that FAILS must still persist the advanced logical clock.
///
/// \`SyncTransport::push_items\` burns one counter per queued item BEFORE the
/// HTTP call, so by the time the server answers 500 the in-memory counter has
/// already moved past whatever the previous cycle persisted. If the tick only
/// writes the clock back on success, the persisted value rewinds relative to
/// the counters that were actually emitted — the surviving counter range can
/// then be re-emitted, and a restart starts from a value the server has seen.
///
/// RED TODAY, and that is the finding: the persisted clock stays at the seed.
#[tokio::test]
async fn run_tick_persists_the_clock_even_when_the_push_fails() {
    let server_url = spawn_rejecting_mock_sync_server().await;
    let db = setup_db();

    let db_setup = db.clone();
    let url = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url).unwrap();
        Settings::set_sync_terminal_id(&conn, "term-clock").unwrap();
        // Seed the persisted clock at 40 so the assertion is not 0-vs-0.
        store.set_setting(crate::crdt::CLOCK_KEY, "40").unwrap();
        store
            .enqueue_offline("stock.adjusted", r#"{"sku":"X","delta":1}"#)
            .unwrap();
        store
            .enqueue_offline("stock.adjusted", r#"{"sku":"X","delta":1}"#)
            .unwrap();
    })
    .await
    .unwrap();

    let status = Arc::new(RwLock::new(DaemonStatus::default()));
    daemon_tick::run_tick(&db, &status, &noop_settings_sink()).await;

    let persisted = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.blocking_lock();
            Store::new(&conn)
                .get_setting(crate::crdt::CLOCK_KEY)
                .unwrap()
        }
    })
    .await
    .unwrap();

    let persisted: u64 = persisted
        .as_deref()
        .and_then(|raw| crate::crdt::parse_counter(raw).ok())
        .unwrap_or(0);

    assert!(
        persisted > 40,
        "a FAILED push still burnt 2 counters (one per queued item), so the \
persisted clock must advance past the seed; got {persisted}"
    );
}

/// A clock row that cannot be read or parsed must NOT seed stamping with `0`.
///
/// `parse_counter` (and `SettingsClockStore::load_counter`, which uses it) treat
/// 'present but unparseable' as an ERROR, not as a fresh clock. The daemon must
/// agree: seeding a rewound `0` orders this terminal's next push in the past, the
/// server classifies it `Stale`, and conflict detection silently stops for the
/// terminal. The only safe degradation is to push WITHOUT vector stamps this
/// cycle — a defined state the server handles (transport.rs:292-295) — which is
/// what `read_stamping_seed` returning `None` means. RED before the fix: the old
/// `.ok().flatten().and_then(parse.ok()).unwrap_or(0)` returned `Some((.., 0))`
/// here and the daemon stamped with a rewound counter.
#[tokio::test]
async fn read_stamping_seed_refuses_to_reuse_zero_when_the_clock_is_corrupt() {
    let db = setup_db();

    let db_setup = db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_terminal_id(&conn, "term-corrupt").unwrap();
        // A value `parse_counter` documents as corrupt (clock_store_tests.rs:39
        // asserts it errors): not an integer, no leading-zero/padding excuse.
        store
            .set_setting(crate::crdt::CLOCK_KEY, "not-a-number")
            .unwrap();
    })
    .await
    .unwrap();

    let seed = super::daemon_tick::read_stamping_seed(&db).await;
    assert!(
        seed.is_none(),
        "a corrupt clock must not resolve to a stamping seed; got {seed:?}"
    );
}

/// The absent-clock case is the ONE that legitimately seeds `0`.
///
/// `ClockStore::load_counter` documents '0 if never written', so a terminal that
/// has simply never ticked stamps from zero. This pins that the fix did not
/// over-correct: only 'present but unreadable/corrupt' degrades to unstamped.
#[tokio::test]
async fn read_stamping_seed_seeds_zero_only_when_the_clock_was_never_written() {
    let db = setup_db();

    let db_setup = db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        Settings::set_sync_terminal_id(&conn, "term-fresh").unwrap();
        // No CLOCK_KEY write at all.
    })
    .await
    .unwrap();

    let seed = super::daemon_tick::read_stamping_seed(&db).await;
    assert_eq!(
        seed,
        Some(("term-fresh".to_string(), 0)),
        "an unwritten clock is a documented zero, not a failure"
    );
}

/// A terminal with no identity never stamps — distinct from a clock failure.
#[tokio::test]
async fn read_stamping_seed_is_none_without_a_terminal_identity() {
    let db = setup_db();
    // Terminal id unset; even a perfectly good clock cannot be attributed.
    let seed = super::daemon_tick::read_stamping_seed(&db).await;
    assert!(
        seed.is_none(),
        "no terminal id means no stamping; got {seed:?}"
    );
}

// ── Phase 2.1: Fault tolerance, reconnection & network jitter resilience ──

/// Spawn a recording mock sync server that logs all pushed items and returns Accepted.
async fn spawn_recording_mock_sync_server(
    received: std::sync::Arc<tokio::sync::Mutex<Vec<kasirmu_core::offline::OfflineQueueItem>>>,
) -> String {
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let state = received.clone();
    async fn handle_push(
        axum::extract::State(state): axum::extract::State<
            std::sync::Arc<tokio::sync::Mutex<Vec<kasirmu_core::offline::OfflineQueueItem>>>,
        >,
        Json(items): Json<Vec<kasirmu_core::offline::OfflineQueueItem>>,
    ) -> Json<PushResponse> {
        let count = items.len();
        let mut guard = state.lock().await;
        guard.extend(items);
        Json(PushResponse {
            results: vec![PushOutcome::Accepted; count],
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
        .route("/api/sync/pull", post(handle_pull))
        .with_state(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(10)).await;
    format!("http://localhost:{port}")
}

#[tokio::test]
async fn reconnection_and_deterministic_monotonic_delta_sync_after_offline_sales() {
    let db = setup_db();

    // 1. Configure terminal with a rejecting server initially (disconnected/offline error).
    let offline_url = spawn_rejecting_mock_sync_server().await;
    let db_setup = db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &offline_url).unwrap();
        Settings::set_sync_terminal_id(&conn, "term-delta-sync").unwrap();

        // Enqueue 3 sales and 2 stock adjustments while offline
        for i in 1..=3 {
            let sale_payload = serde_json::json!({
                "sale_id": format!("sale-offline-{i}"),
                "total_minor": 150_000 * i,
                "items_count": i,
            });
            store
                .enqueue_offline("sale.create", &sale_payload.to_string())
                .unwrap();
        }
        for i in 1..=2 {
            let adjust_payload = serde_json::json!({
                "product_id": format!("prod-{i}"),
                "delta": -(i * 5),
                "reason": "sale_deduction",
            });
            store
                .enqueue_offline("inventory.adjust", &adjust_payload.to_string())
                .unwrap();
        }
    })
    .await
    .unwrap();

    // Verify all 5 items are currently pending in offline queue
    let db_check = db.clone();
    let pending_before = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        Store::new(&conn).pending_offline_count().unwrap()
    })
    .await
    .unwrap();
    assert_eq!(pending_before, 5, "5 items must be queued offline");

    // 2. Start daemon while offline: tick fails without crashing, items remain pending
    let daemon = SyncDaemon::with_interval(Duration::from_millis(20));
    assert!(daemon.start(db.clone()).await);

    // Wait until daemon encounters the offline failure
    wait_for_daemon(&daemon, "offline transport failure recorded", |s| {
        s.last_error.is_some()
    })
    .await;

    // Verify all 5 items are still durable and pending despite failure
    let db_check = db.clone();
    let pending_mid = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        Store::new(&conn).pending_offline_count().unwrap()
    })
    .await
    .unwrap();
    assert_eq!(
        pending_mid, 5,
        "items must remain pending after failed sync cycle"
    );

    // 3. Re-establish network connection: start live recording sync server
    let received_items = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let server_url = spawn_recording_mock_sync_server(received_items.clone()).await;

    let db_update = db.clone();
    let url_clone = server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_update.blocking_lock();
        Settings::set_sync_server_url(&conn, &url_clone).unwrap();
    })
    .await
    .unwrap();

    // Wait until pending queue drops to 0 (daemon runs periodic tick every 20ms)
    let mut drained = false;
    for _ in 0..200 {
        let s = daemon.status().await;
        if s.pending_count == 0 && s.last_pushed > 0 {
            drained = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    assert!(
        drained,
        "all offline items must be synced after reconnection"
    );

    // 4. Invariant checks
    let recorded = received_items.lock().await.clone();
    assert_eq!(
        recorded.len(),
        5,
        "server must have received exactly 5 items"
    );

    // Verify deterministic order: priority tiers obeyed
    // sale.create has Critical priority; inventory.adjust has Normal priority
    assert_eq!(recorded[0].action, "sale.create");
    assert_eq!(recorded[1].action, "sale.create");
    assert_eq!(recorded[2].action, "sale.create");
    assert_eq!(recorded[3].action, "inventory.adjust");
    assert_eq!(recorded[4].action, "inventory.adjust");

    // Verify all items marked synced locally with zero pending
    let db_final = db.clone();
    let pending_final = tokio::task::spawn_blocking(move || {
        let conn = db_final.blocking_lock();
        Store::new(&conn).pending_offline_count().unwrap()
    })
    .await
    .unwrap();
    assert_eq!(pending_final, 0, "offline queue must be 100% drained");

    assert!(daemon.stop().await);
    wait_for_stopped(&daemon).await;
}

#[tokio::test]
async fn network_jitter_resilience_and_exponential_backoff_retry() {
    let db = setup_db();

    // Spawn a mock server that simulates 40% packet drops / initial intermittent network failures.
    // First 2 push requests fail with HTTP 500 (simulating spotty cellular signal drops).
    // Subsequent requests succeed.
    let listener = tokio::net::TcpListener::bind("localhost:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let attempt_counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let attempts_state = attempt_counter.clone();

    async fn handle_push(
        axum::extract::State(counter): axum::extract::State<
            std::sync::Arc<std::sync::atomic::AtomicUsize>,
        >,
        Json(items): Json<Vec<kasirmu_core::offline::OfflineQueueItem>>,
    ) -> impl IntoResponse {
        let attempt = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if attempt < 2 {
            // Simulate packet drop / connection drop / gateway failure
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "simulated_spotty_network_drop" })),
            )
                .into_response()
        } else {
            // Network succeeded: accept items
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "results": vec![serde_json::json!({"outcome": "accepted"}); items.len()]
                })),
            )
                .into_response()
        }
    }

    async fn handle_pull(Json(_req): Json<serde_json::Value>) -> Json<PullResponse> {
        Json(PullResponse {
            items: vec![],
            next_cursor: None,
        })
    }

    let app = Router::new()
        .route("/api/sync/push", post(handle_push))
        .route("/api/sync/pull", post(handle_pull))
        .with_state(attempts_state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(10)).await;
    let jitter_server_url = format!("http://localhost:{port}");

    // Configure database with 4 mutations
    let db_setup = db.clone();
    let url_clone = jitter_server_url.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_setup.blocking_lock();
        let store = Store::new(&conn);
        Settings::set_sync_enabled(&conn, true).unwrap();
        Settings::set_sync_server_url(&conn, &url_clone).unwrap();
        Settings::set_sync_terminal_id(&conn, "term-jitter-test").unwrap();

        for i in 1..=4 {
            store
                .enqueue_offline("sale.create", &format!(r#"{{"sale_id":"jitter-{i}"}}"#))
                .unwrap();
        }
    })
    .await
    .unwrap();

    // Verify backoff function produces non-zero bounded backoff for retry counts
    for failures in 1..=5 {
        let bo = compute_backoff(failures);
        assert!(bo.as_millis() <= MAX_BACKOFF_MS as u128);
    }

    // Start daemon with fast 20ms tick interval
    let daemon = SyncDaemon::with_interval(Duration::from_millis(20));
    assert!(daemon.start(db.clone()).await);

    // Daemon will hit the first 2 failures, back off, and then retry and succeed on attempt 3
    let mut synced = false;
    for _ in 0..200 {
        let s = daemon.status().await;
        if s.pending_count == 0 && s.last_pushed == 4 {
            synced = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
    assert!(synced, "resilient recovery after intermittent packet drops");

    let final_attempts = attempt_counter.load(std::sync::atomic::Ordering::SeqCst);
    assert!(
        final_attempts >= 3,
        "must have survived at least 2 dropped attempts and succeeded on 3rd; got {final_attempts}"
    );

    // All 4 items must be durably synced in DB
    let db_check = db.clone();
    let pending_remaining = tokio::task::spawn_blocking(move || {
        let conn = db_check.blocking_lock();
        Store::new(&conn).pending_offline_count().unwrap()
    })
    .await
    .unwrap();
    assert_eq!(
        pending_remaining, 0,
        "all items must be synced after jitter retry"
    );

    assert!(daemon.stop().await);
    wait_for_stopped(&daemon).await;
}

#[test]
fn crl_poll_ttl_caching_and_staleness_detection() {
    let now = chrono::Utc::now();
    let ttl = 900; // 15 mins

    // 1. None (never checked) -> must poll
    assert!(
        daemon_tick::should_poll_crl(None, now, ttl),
        "must poll CRL when never previously checked"
    );

    // 2. Checked 60 seconds ago -> within TTL window -> skip poll
    let recent = (now - chrono::Duration::seconds(60)).to_rfc3339();
    assert!(
        !daemon_tick::should_poll_crl(Some(&recent), now, ttl),
        "must skip CRL poll when cache is younger than TTL"
    );

    // 3. Checked exactly 900 seconds ago -> expired TTL -> must poll
    let at_ttl = (now - chrono::Duration::seconds(900)).to_rfc3339();
    assert!(
        daemon_tick::should_poll_crl(Some(&at_ttl), now, ttl),
        "must poll CRL when TTL window has elapsed"
    );

    // 4. Checked 2 hours ago -> expired -> must poll
    let stale = (now - chrono::Duration::hours(2)).to_rfc3339();
    assert!(
        daemon_tick::should_poll_crl(Some(&stale), now, ttl),
        "must poll CRL when cache is stale"
    );

    // 5. Unparseable garbage timestamp -> fails open -> must poll
    assert!(
        daemon_tick::should_poll_crl(Some("not-a-timestamp"), now, ttl),
        "must poll CRL when timestamp is corrupted/unparseable"
    );
}

