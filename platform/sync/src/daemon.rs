//! Sync Daemon — background task that periodically pushes pending offline
//! mutations to the remote sync server and pulls remote updates.
/*
last audited 25-07-26 by RSA-Agent (platform-sync slice E: daemon deep read)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — SYNC-01 durable pull anchor advanced only after the whole page plus the ADR #6 stock_summary rebuild succeed; SYNC-09 mid-pull operator-rewind detection (full-state comparison under the same blocking_lock hold, never clobbers a rewind); exponential backoff capped 60s with random 60-120s jitter rhythm; RUST-05 fail-closed transport for both phases; P1/P4 refresh-once for push (in-tick retry) and pull (documented next-cycle recovery, avoids duplicating apply logic); ADR #11 migration redirects update the local URL on push, pull, and snapshot paths; AnchorExpired triggers snapshot recovery with anchor advance; per-phase join-panic capture into daemon status; prune task archives movements 90d+ and breaks on panic; token refresh keeps the stored key on failure
next: none | perf: blocking DB phases in spawn_blocking
*/
//!
//! The daemon splits each sync cycle into three phases to avoid holding
//! the `Store` (which is `!Send`) across `.await` points:
//!
//! 1. **Read** — lock the DB (via `spawn_blocking`), read config + pending items
//! 2. **Send** — push items to the remote server (async, no DB needed)
//! 3. **Apply** — lock the DB again, mark items synced/failed

use std::sync::Arc;
use std::time::Duration;

use rand::Rng;
use tokio::sync::{Mutex, Notify, RwLock, watch};

use kasirmu_core::db::Store;
use kasirmu_core::events::SettingsUpdated;
use kasirmu_core::offline::order_for_push;
use kasirmu_core::settings::Settings;
use kasirmu_core::sync_client::SyncConfig;

use crate::queue::SyncQueue;
use crate::transport::PushOutcome;

#[path = "daemon_tick.rs"]
mod daemon_tick;

/// Base interval; actual per-cycle sleep is randomized 60–120s.
const DEFAULT_SYNC_INTERVAL: Duration = Duration::from_secs(30);

/// Maximum backoff cap in milliseconds (60 s).
const MAX_BACKOFF_MS: u64 = 60_000;

/// Debounce window applied after a [`SyncDaemon::nudge`] wakeup (SYNC-EW).
///
/// After the notifier fires we sleep this long before running a tick.  This
/// coalesces a burst of rapid sale-completion signals (e.g. batch scan) into
/// a single sync cycle instead of hammering the remote endpoint.
const WAKEUP_DEBOUNCE: Duration = Duration::from_millis(1_500);

/// Grace period [`SyncDaemon::stop`] allows the run loop to finish an
/// in-flight sync cycle before giving up and reporting a timeout. A tick
/// performs real HTTP round trips (each bounded by the transport's 30s
/// request ceiling), so a grace shorter than one request cycle — the old
/// fixed 100ms sleep — could never cover an in-flight cycle.
const DAEMON_STOP_GRACE: Duration = Duration::from_secs(30);

/// Compute exponential backoff with full jitter (P-1 spec §Backoff).
///
/// Formula: `rand(0, min(MAX_BACKOFF_MS, 2_000 * 2^failures))` ms.
/// Reset to 0 after a successful sync cycle.
fn compute_backoff(consecutive_failures: u32) -> Duration {
    let base = 2_000u64.saturating_mul(2u64.saturating_pow(consecutive_failures));
    let backoff_ms = std::cmp::min(MAX_BACKOFF_MS, base);
    let jittered = rand::thread_rng().gen_range(0..=backoff_ms);
    Duration::from_millis(jittered)
}

/// Snapshot of the daemon's current state, observable via [`SyncDaemon::status`].
#[derive(Debug, Clone, Default)]
pub struct DaemonStatus {
    /// Whether the daemon is currently running.
    pub running: bool,
    /// ISO-8601 timestamp of the last completed sync cycle (or error).
    pub last_sync_at: Option<String>,
    /// Number of items pushed in the last cycle.
    pub last_pushed: usize,
    /// Number of items pulled in the last cycle.
    pub last_pulled: usize,
    /// Error message from the last cycle, if any.
    pub last_error: Option<String>,
    /// Number of consecutive failed sync cycles (drives backoff).
    pub consecutive_failures: u32,
    /// Backoff delay applied before the current cycle, if any.
    pub backoff_ms: Option<u64>,
    /// Number of items currently pending in the offline queue.
    pub pending_count: i64,
}

/// A reference to a shared DB connection, used by the daemon to create
/// temporary [`Store`] instances inside `spawn_blocking` closures.
pub type DbConnection = Arc<Mutex<rusqlite::Connection>>;

/// Callback invoked after the daemon applies a remote `settings.update`
/// (SYNC-10) so the app can re-emit `SettingsUpdated` for UI reactivity.
///
/// The desktop client wires this to emit the `settings_updated` Tauri event
/// (the same wire shape the frontend `SettingsContext` listens for).
///
/// **Contract:** the callback runs on the daemon's blocking apply thread
/// WHILE the database connection lock is held, so it must NOT acquire the
/// database lock itself (that would deadlock against the mutex it already
/// owns). Keep it to side effects without DB access — a Tauri emit, a bus
/// publish, a channel send.
pub type SettingsChangedSink = Arc<dyn Fn(&SettingsUpdated) + Send + Sync>;

/// A background task that periodically syncs the local offline queue with a
/// remote server.
///
/// The daemon reads `SyncConfig` from the database settings on every tick,
/// so configuration changes take effect on the next cycle without restarting.
pub struct SyncDaemon {
    interval: Duration,
    status: Arc<RwLock<DaemonStatus>>,
    shutdown_tx: Arc<Mutex<Option<watch::Sender<bool>>>>,
    /// Join handle of the spawned run-loop task. [`SyncDaemon::stop`]
    /// awaits it (bounded by [`DAEMON_STOP_GRACE`]) so a stop observes
    /// the actual loop exit — and the `running` flag being cleared —
    /// instead of guessing with a sleep.
    worker: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    settings_sink: SettingsChangedSink,
    /// Notifier for event-triggered wakeups (SYNC-EW). Call
    /// [`SyncDaemon::nudge`] to wake the run loop early. The loop
    /// debounces rapid taps with a short `WAKEUP_DEBOUNCE` pause before
    /// running a tick.
    wakeup: Arc<Notify>,
}

/// Read sync configuration and pending offline items from a database
/// connection. Extracted from [`SyncDaemon::run_tick`] so the read phase
/// is independently testable.
///
/// Returns `(config, pending)` where `config` is `None` if sync is not
/// configured or disabled.
pub(crate) fn read_config_and_pending(
    conn: &rusqlite::Connection,
) -> (
    Option<SyncConfig>,
    Vec<kasirmu_core::offline::OfflineQueueItem>,
) {
    let store = Store::new(conn);
    let config = SyncConfig::from_settings(&store).ok().flatten();
    let mut pending = store.list_pending_offline().unwrap_or_default();
    // C49: the ONE ordering rule, shared by every push path. `list_pending_offline`
    // orders by `created_at ASC` alone, so without this a Critical item queued
    // behind a bulk one waits a full cycle and the priority column means nothing.
    // Applied at the READ point so the same vector is pushed and applied by index.
    order_for_push(&mut pending);
    (config, pending)
}

/// ADR sync-auth-hardening P1: request a fresh token and persist it as the
/// API key. Returns `true` when a new key was stored. Callers invoke this
/// once after an `AuthExpired` and never loop on it.
async fn refresh_persisted_api_key(db: &DbConnection, server_url: &str) -> bool {
    // ADR sync-auth-hardening P3: prefer terminal client credentials when
    // the device is paired; fall back to the admin key / open mint.
    let (terminal_id, terminal_secret) = {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            (
                Settings::get_sync_terminal_id(store.conn()).unwrap_or(None),
                Settings::get_sync_terminal_secret(store.conn()).unwrap_or(None),
            )
        })
        .await
        .unwrap_or((None, None))
    };
    let token = match (terminal_id, terminal_secret) {
        (Some(id), Some(secret)) => {
            kasirmu_core::sync_client::request_token_client_credentials(server_url, &id, &secret)
                .await
        }
        _ => {
            kasirmu_core::sync_client::request_token(
                server_url,
                kasirmu_core::sync_client::admin_key_from_env().as_deref(),
            )
            .await
        }
    };
    let Some(key) = token.token.filter(|_| token.ok) else {
        tracing::warn!(
            status = %token.status,
            "sync token refresh failed — sync stays on the stored key"
        );
        return false;
    };
    let db_clone = db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let store = Store::new(&conn);
        match Settings::set_sync_api_key(store.conn(), &key) {
            Ok(()) => true,
            Err(e) => {
                tracing::error!(error = %e, "persisting refreshed sync API key failed");
                false
            }
        }
    })
    .await
    .unwrap_or(false)
}

/// Apply push outcomes to the local queue (blocking DB work, spawned off the
/// async runtime). Returns an error message when the apply phase itself
/// failed (spawn panic); per-item failures are logged, mirroring the original
/// inline apply block exactly.
async fn apply_push_results(
    db: &DbConnection,
    pending: Vec<kasirmu_core::offline::OfflineQueueItem>,
    results: Vec<PushOutcome>,
) -> Option<String> {
    let db_clone = db.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let store = Store::new(&conn);
        let queue = SyncQueue::new();
        for (local, outcome) in pending.iter().zip(results.iter()) {
            match outcome {
                PushOutcome::Accepted => {
                    if let Err(e) = store.mark_offline_synced(&local.id) {
                        tracing::error!(
                            item_id = %local.id,
                            error = %e,
                            "sync daemon: failed to mark item synced"
                        );
                    }
                }
                PushOutcome::Rejected { reason }
                    if kasirmu_core::sync_client::is_duplicate_id_rejection(reason) =>
                {
                    // Idempotent replay — the server already holds this exact
                    // item (same client-generated id), so the mutation landed.
                    // Mark synced, not failed: push-side failed items are
                    // terminal (no requeue), so a crash-then-repush would
                    // otherwise strand a successfully-synced item forever.
                    // Shares the DUPLICATE_ID_REJECTION_PREFIX predicate with
                    // the immediate apply_sync_outcomes path.
                    tracing::info!(
                        item_id = %local.id,
                        "sync push duplicate-id replay: item already on server, marking synced"
                    );
                    if let Err(e) = store.mark_offline_synced(&local.id) {
                        tracing::error!(
                            item_id = %local.id,
                            error = %e,
                            "sync daemon: failed to mark duplicate-replay item synced"
                        );
                    }
                }
                PushOutcome::Rejected { reason } => {
                    if let Err(e) = store.mark_offline_failed(&local.id, reason) {
                        tracing::error!(
                            item_id = %local.id,
                            error = %e,
                            "sync daemon: failed to mark item failed"
                        );
                    }
                }
                PushOutcome::Conflict(server_item) => {
                    if let Err(e) = queue.apply_push_conflict(&store, local, server_item) {
                        tracing::error!(
                            item_id = %local.id,
                            error = %e,
                            "sync daemon: failed to apply conflict resolution"
                        );
                    }
                }
            }
        }
    })
    .await;

    match outcome {
        Ok(()) => None,
        Err(e) => Some(format!("apply push phase: {e}")),
    }
}

impl SyncDaemon {
    /// Create a new sync daemon.
    pub fn new() -> Self {
        Self {
            interval: DEFAULT_SYNC_INTERVAL,
            status: Arc::new(RwLock::new(DaemonStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
            worker: Arc::new(Mutex::new(None)),
            settings_sink: Arc::new(|_: &SettingsUpdated| {}),
            wakeup: Arc::new(Notify::new()),
        }
    }

    /// Create a new sync daemon with a custom interval.
    pub fn with_interval(interval: Duration) -> Self {
        Self {
            interval,
            status: Arc::new(RwLock::new(DaemonStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
            worker: Arc::new(Mutex::new(None)),
            settings_sink: Arc::new(|_: &SettingsUpdated| {}),
            wakeup: Arc::new(Notify::new()),
        }
    }

    /// Start the background sync daemon.
    ///
    /// Spawns a `tokio` task that periodically:
    /// 1. Reads `SyncConfig` + pending items from the DB (blocking)
    /// 2. Pushes pending items to the remote server (async)
    /// 3. Updates item statuses in the DB (blocking)
    ///
    /// Config is read from the DB every tick, so setting changes take
    /// effect on the next cycle without restarting.
    ///
    /// Returns `true` when a new daemon task was spawned, `false` when the
    /// daemon was already running. The boolean is an explicit report — the
    /// historical silent no-op made an already-running start
    /// indistinguishable from a fresh one at the IPC boundary.
    pub async fn start(&self, db: DbConnection) -> bool {
        self.start_inner(db, self.settings_sink.clone()).await
    }

    /// Start the background sync daemon with a custom settings-change sink
    /// (SYNC-10).
    ///
    /// The sink is invoked after each remote `settings.update` the pull
    /// phase applies, carrying the changed key and its originating terminal
    /// — the desktop client uses this to emit the `settings_updated` Tauri
    /// event so the UI refetches a setting changed on another terminal.
    /// Returns `true` when a new daemon task was spawned, `false` when one
    /// was already running (same contract as [`SyncDaemon::start`]).
    pub async fn start_with_sink(
        &self,
        db: DbConnection,
        settings_sink: SettingsChangedSink,
    ) -> bool {
        self.start_inner(db, settings_sink).await
    }

    /// Shared start path used by [`SyncDaemon::start`] and
    /// [`SyncDaemon::start_with_sink`]. Returns `true` when a new daemon
    /// task was spawned, `false` when one was already running.
    async fn start_inner(&self, db: DbConnection, settings_sink: SettingsChangedSink) -> bool {
        if self.is_running().await {
            tracing::warn!("sync daemon is already running");
            return false;
        }

        let (tx, rx) = watch::channel(false);
        let shutdown_slot = Arc::clone(&self.shutdown_tx);
        *shutdown_slot.lock().await = Some(tx);

        let interval = self.interval;
        let daemon_status = Arc::clone(&self.status);
        let wakeup_clone = Arc::clone(&self.wakeup);

        {
            let mut s = daemon_status.write().await;
            s.running = true;
            s.last_error = None;
        }

        let worker = tokio::spawn(async move {
            // Re-shadow `rx` as `mut` so the `async move` block can borrow
            // it mutably through the `select!` macro below.
            let mut rx = rx;
            let mut consecutive_failures: u32 = 0;

            if interval == DEFAULT_SYNC_INTERVAL {
                tracing::info!("sync daemon started interval_range_secs=60..=120");
            } else {
                tracing::info!(interval_ms = interval.as_millis(), "sync daemon started");
            }

            loop {
                // Compute sleep duration: backoff for failures, normal
                // random interval for the standard daemon rhythm, or a
                // fixed custom interval (e.g. for tests — backoff is
                // bypassed to avoid stalling fast test loops).
                let sleep_dur = if consecutive_failures > 0 && interval == DEFAULT_SYNC_INTERVAL {
                    let backoff = compute_backoff(consecutive_failures);
                    {
                        let mut s = daemon_status.write().await;
                        s.backoff_ms = Some(backoff.as_millis() as u64);
                    }
                    tracing::warn!(
                        failures = consecutive_failures,
                        backoff_ms = backoff.as_millis(),
                        "backing off after sync failure"
                    );
                    backoff
                } else if interval == DEFAULT_SYNC_INTERVAL {
                    {
                        let mut s = daemon_status.write().await;
                        s.backoff_ms = None;
                    }
                    Duration::from_secs(rand::thread_rng().gen_range(60..=120))
                } else {
                    {
                        let mut s = daemon_status.write().await;
                        s.backoff_ms = None;
                    }
                    interval
                };

                tokio::select! {
                    _ = tokio::time::sleep(sleep_dur) => {
                        daemon_tick::run_tick(&db, &daemon_status, &settings_sink).await;

                        // Track consecutive failures for backoff on the
                        // next cycle. Reset to 0 on success.
                        let had_error = daemon_status.read().await.last_error.is_some();
                        if had_error {
                            consecutive_failures += 1;
                        } else {
                            consecutive_failures = 0;
                        }
                        {
                            let mut s = daemon_status.write().await;
                            s.consecutive_failures = consecutive_failures;
                        }
                    }
                    res = rx.changed() => {
                        if res.is_err() || *rx.borrow() {
                            tracing::info!("sync daemon shutting down");
                            break;
                        }
                    }
                    // SYNC-EW: event-triggered wakeup path.
                    //
                    // A call to `nudge()` (e.g. after a cashier completes a
                    // sale) fires this arm instead of waiting for the next
                    // periodic tick. We sleep WAKEUP_DEBOUNCE first to
                    // coalesce rapid bursts (batch scans, multi-tap) into a
                    // single network round-trip, then run a normal tick.
                    // Consecutive-failure tracking and backoff are updated
                    // identically to the periodic arm so the two paths are
                    // interchangeable from a reliability standpoint.
                    _ = wakeup_clone.notified() => {
                        tracing::debug!(
                            debounce_ms = WAKEUP_DEBOUNCE.as_millis(),
                            "sync daemon woken by nudge — debouncing"
                        );
                        tokio::time::sleep(WAKEUP_DEBOUNCE).await;
                        daemon_tick::run_tick(&db, &daemon_status, &settings_sink).await;

                        let had_error = daemon_status.read().await.last_error.is_some();
                        if had_error {
                            consecutive_failures += 1;
                        } else {
                            consecutive_failures = 0;
                        }
                        {
                            let mut s = daemon_status.write().await;
                            s.consecutive_failures = consecutive_failures;
                        }
                    }
                }
            }

            // Clear `running` only when this run still owns the shutdown
            // slot: `stop()` consumes the sender before awaiting exit, so a
            // slot that is `Some` again means a newer run took over and a
            // stale task must not clobber the new run's status.
            if shutdown_slot.lock().await.is_none() {
                let mut s = daemon_status.write().await;
                s.running = false;
            }
        });

        *self.worker.lock().await = Some(worker);
        true
    }

    /// Start a background pruning task that calls [`Store::archive_stock_movements`]
    /// on the local database (ADR #6 Q4 / P-1 Ledger Retention).
    ///
    /// Runs independently of the sync daemon with a random sleep interval of
    /// 60-120 seconds, matching the daemon's rhythm. The task is fire-and-
    /// forget — it runs until the process exits.
    pub fn start_prune_task(db: DbConnection) {
        tokio::spawn(async move {
            tracing::info!("prune daemon started interval_range_secs=60..=120");

            loop {
                let sleep_dur = Duration::from_secs(rand::thread_rng().gen_range(60..=120));
                tokio::time::sleep(sleep_dur).await;

                let db = db.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = db.blocking_lock();
                    let store = Store::new(&conn);
                    store.archive_stock_movements(90, 50)
                })
                .await;

                match result {
                    Ok(Ok(count)) => {
                        if count > 0 {
                            tracing::info!(count, "prune cycle: archived stock movements");
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::error!(error = %e, "prune cycle failed");
                    }
                    Err(join_err) => {
                        tracing::error!(error = %join_err, "prune spawn_blocking panicked");
                        break;
                    }
                }
            }
        });
    }

    /// Gracefully stop the background sync daemon.
    ///
    /// Signals the run loop and then WAITS for it to exit — including an
    /// in-flight sync cycle — for up to [`DAEMON_STOP_GRACE`]. Returns
    /// `true` when the loop exit was observed (so `running` is cleared and
    /// an immediate [`SyncDaemon::start`] can take over); `false` means
    /// the grace expired with the loop still running — the timeout is
    /// reported to the caller and logged, never pretended away. The loop
    /// keeps exiting in the background and clears `running` when done.
    pub async fn stop(&self) -> bool {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(true);
        }
        let Some(worker) = self.worker.lock().await.take() else {
            return true;
        };
        match tokio::time::timeout(DAEMON_STOP_GRACE, worker).await {
            Ok(_) => true,
            Err(_) => {
                tracing::error!(
                    grace_ms = DAEMON_STOP_GRACE.as_millis() as u64,
                    "sync daemon stop timed out — the run loop is still finishing its cycle in the background"
                );
                false
            }
        }
    }

    /// Check if the daemon is currently running.
    pub async fn is_running(&self) -> bool {
        self.status.read().await.running
    }

    /// Get a snapshot of the daemon's current status.
    pub async fn status(&self) -> DaemonStatus {
        self.status.read().await.clone()
    }

    /// Set the sync interval (applied on next cycle start).
    pub fn set_interval(&mut self, interval: Duration) {
        self.interval = interval;
    }

    /// Get the current sync interval.
    pub fn interval(&self) -> Duration {
        self.interval
    }

    /// Signal the run loop to wake up and run a sync tick immediately
    /// (SYNC-EW — event-triggered wakeup).
    ///
    /// Safe to call from any thread/task while the daemon is running or
    /// stopped: if the daemon is not running the notification is stored and
    /// consumed on the next [`SyncDaemon::start`]. Calling `nudge` multiple
    /// times before the debounce window expires coalesces into a single tick
    /// because [`tokio::sync::Notify`] does not queue — it sets at most one
    /// pending notification.
    pub fn nudge(&self) {
        self.wakeup.notify_one();
    }

    /// Return a clone of the underlying [`Arc<Notify>`] for test inspection.
    #[cfg(test)]
    pub(crate) fn wakeup_handle(&self) -> Arc<Notify> {
        Arc::clone(&self.wakeup)
    }
}

impl Default for SyncDaemon {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "daemon_tests.rs"]
mod tests;
