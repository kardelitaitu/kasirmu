//! PostgreSQL Sync Daemon — background task that periodically pushes pending
//! offline mutations directly to a remote PostgreSQL database.
/*
last audited 25-07-26 by RSA-Agent (platform-sync slice G: pg_daemon deep read)
crate: platform-sync | status: SAFE | lint: CLEAN
findings: exemplary — full SYNC-01/02/09/10 parity with the SQLite daemon: durable anchor advanced only after the page plus the ADR #6 stock_summary rebuild succeed, SYNC-09 mid-pull rewind detection under one lock hold, shared ADR #21 conflict service, SYNC-10 settings re-emit after commit; documented pull-every-cycle fix (pull was previously unreachable on push-idle cycles, starving relay terminals); anchor anchored on created_at never synced_at (documented NULL-stamp rationale); recover_pg_snapshot imports BEFORE resetting the anchor (test-pinned both orderings); tenant fallback chain (license setting, then queue tenant, then default); require_tls fail-closed; per-phase panic capture into status
next: none | perf: blocking DB phases in spawn_blocking
*/
//!
//! Operates similarly to [`crate::daemon::SyncDaemon`] but uses a
//! [`PgTransport`] instead of HTTP transport. Configuration is read from
//! the local settings table on every tick, so changes take effect without
//! restarting.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Mutex, Notify, RwLock, watch};

use kasirmu_core::db::Store;
use kasirmu_core::events::SettingsUpdated;
use kasirmu_core::offline::OfflineQueueItem;
use kasirmu_core::settings::Settings;

use crate::daemon::SettingsChangedSink;
use crate::pg_transport::PgTransport;
use crate::queue::SyncQueue;
use crate::{SyncError, SyncResult, import_snapshot};

/// Default interval between PG sync cycles (60 seconds — PG sync is
/// typically less time-sensitive than HTTP sync).
const DEFAULT_PG_SYNC_INTERVAL: Duration = Duration::from_secs(60);

/// Grace period [`PgSyncDaemon::stop`] allows the run loop to finish an
/// in-flight sync cycle before giving up and reporting a timeout. A tick
/// performs real remote round trips (each bounded by the transport's 30s
/// request ceiling), so a grace shorter than one request cycle — the old
/// fixed 100ms sleep — could never cover an in-flight cycle.
const PG_STOP_GRACE: Duration = Duration::from_secs(30);

/// Debounce window applied after a [`PgSyncDaemon::nudge`] wakeup (SYNC-EW).
///
/// Matches the HTTP daemon's debounce: absorbs rapid bursts from batch-scan
/// workflows before running a single PG round-trip.
const PG_WAKEUP_DEBOUNCE: Duration = Duration::from_millis(1_500);

/// Snapshot of the PG daemon's current state, observable via
/// [`PgSyncDaemon::status`]. Serialized camelCase for the Tauri command
/// boundary (the desktop client's `pg_sync_status` IPC returns this
/// directly, matching the app's DTO convention).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgDaemonStatus {
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
    /// Number of items currently pending in the offline queue.
    pub pending_count: i64,
}

/// A reference to a shared DB connection, used by the daemon to create
/// temporary [`Store`] instances inside `spawn_blocking` closures.
pub type DbConnection = Arc<Mutex<rusqlite::Connection>>;

/// A background task that periodically syncs the local offline queue with a
/// remote PostgreSQL database.
///
/// The daemon reads PG connection settings from the database settings table
/// on every tick, so configuration changes take effect on the next cycle
/// without restarting.
pub struct PgSyncDaemon {
    interval: Duration,
    status: Arc<RwLock<PgDaemonStatus>>,
    shutdown_tx: Arc<Mutex<Option<watch::Sender<bool>>>>,
    /// Join handle of the spawned run-loop task. [`PgSyncDaemon::stop`]
    /// awaits it (bounded by [`PG_STOP_GRACE`]) so a stop observes the
    /// actual loop exit — and the `running` flag being cleared — instead
    /// of guessing with a sleep.
    worker: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    settings_sink: SettingsChangedSink,
    /// Notifier for event-triggered wakeups (SYNC-EW). Call
    /// [`PgSyncDaemon::nudge`] to wake the run loop early.
    wakeup: Arc<Notify>,
}

impl PgSyncDaemon {
    /// Create a new PostgreSQL sync daemon.
    pub fn new() -> Self {
        Self {
            interval: DEFAULT_PG_SYNC_INTERVAL,
            status: Arc::new(RwLock::new(PgDaemonStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
            worker: Arc::new(Mutex::new(None)),
            settings_sink: Arc::new(|_: &SettingsUpdated| {}),
            wakeup: Arc::new(Notify::new()),
        }
    }

    /// Create a new PostgreSQL sync daemon with a custom interval.
    pub fn with_interval(interval: Duration) -> Self {
        Self {
            interval,
            status: Arc::new(RwLock::new(PgDaemonStatus::default())),
            shutdown_tx: Arc::new(Mutex::new(None)),
            worker: Arc::new(Mutex::new(None)),
            settings_sink: Arc::new(|_: &SettingsUpdated| {}),
            wakeup: Arc::new(Notify::new()),
        }
    }

    /// Start the background PG sync daemon.
    ///
    /// Spawns a `tokio` task that periodically:
    /// 1. Reads PG connection settings + pending items from the local DB
    /// 2. Pushes pending items to the remote PostgreSQL database
    /// 3. Updates item statuses in the local DB
    ///
    /// Returns `true` when a new daemon task was spawned, `false` when the
    /// daemon was already running. The boolean is an explicit report — the
    /// historical silent no-op made an already-running start
    /// indistinguishable from a fresh one at the IPC boundary.
    pub async fn start(&self, db: DbConnection) -> bool {
        self.start_inner(db, self.settings_sink.clone()).await
    }

    /// Start the background PG sync daemon with a custom settings-change
    /// sink (SYNC-10 parity with the SQLite daemon).
    ///
    /// The sink is invoked after each remote `settings.update`/`settings.change`
    /// the pull phase applies, carrying the changed key and its originating
    /// terminal — the desktop client uses this to emit the `settings_updated`
    /// Tauri event so the UI refetches a setting changed on a remote
    /// PostgreSQL terminal.
    /// Returns `true` when a new daemon task was spawned, `false` when one
    /// was already running (same contract as [`PgSyncDaemon::start`]).
    pub async fn start_with_sink(
        &self,
        db: DbConnection,
        settings_sink: SettingsChangedSink,
    ) -> bool {
        self.start_inner(db, settings_sink).await
    }

    /// Shared start path used by [`PgSyncDaemon::start`] and
    /// [`PgSyncDaemon::start_with_sink`]. Returns `true` when a new daemon
    /// task was spawned, `false` when one was already running.
    async fn start_inner(&self, db: DbConnection, settings_sink: SettingsChangedSink) -> bool {
        if self.is_running().await {
            tracing::warn!("pg sync daemon is already running");
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
            let mut rx = rx;

            tracing::info!(interval_ms = interval.as_millis(), "pg sync daemon started");

            loop {
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {
                        Self::run_tick(&db, &daemon_status, &settings_sink).await;
                    }
                    result = rx.changed() => {
                        if result.is_err() || *rx.borrow() {
                            tracing::info!("pg sync daemon shutting down");
                            break;
                        }
                    }
                    // SYNC-EW: event-triggered wakeup path (mirrors SyncDaemon).
                    _ = wakeup_clone.notified() => {
                        tracing::debug!(
                            debounce_ms = PG_WAKEUP_DEBOUNCE.as_millis(),
                            "pg sync daemon woken by nudge — debouncing"
                        );
                        tokio::time::sleep(PG_WAKEUP_DEBOUNCE).await;
                        Self::run_tick(&db, &daemon_status, &settings_sink).await;
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

    /// Run a single PG sync tick: read -> send -> apply.
    async fn run_tick(
        db: &DbConnection,
        daemon_status: &Arc<RwLock<PgDaemonStatus>>,
        settings_sink: &SettingsChangedSink,
    ) {
        // Phase 1: Read PG settings + pending items from local DB (blocking)
        let db_clone = db.clone();
        let (pg_config, pending, pull_since, pull_cursor, read_error) =
            match tokio::task::spawn_blocking(move || {
                let conn = db_clone.blocking_lock();
                let store = Store::new(&conn);

                let enabled = Settings::is_pg_sync_enabled(&conn).unwrap_or(false);
                let pending = store.list_pending_offline().unwrap_or_default();
                // SYNC-01 parity: the durable pull anchor (since + composite
                // cursor) survives restarts and advances only after a page
                // applied — never re-derive it from the local queue's synced
                // timestamps (pulled remote items do not move those).
                let pull_state = store.get_sync_pull_state().ok();
                let pull_since = pull_state.as_ref().and_then(|s| s.since.clone());
                let pull_cursor = pull_state.as_ref().and_then(|s| s.cursor.clone());

                // Build the transport whenever PG sync is ENABLED — not only
                // when there are pending items — so a pull-only terminal (a
                // pure consumer of another terminal's rows on a shared remote
                // PG) still pulls every cycle. Previously the pull phase was
                // unreachable on push-idle cycles, which would have starved
                // relay terminals of remote updates.
                let pg_config = if enabled {
                    let host = Settings::get_pg_sync_host(&conn)
                        .unwrap_or_default()
                        .unwrap_or_default();
                    let port: String = Settings::get_pg_sync_port(&conn)
                        .ok()
                        .flatten()
                        .filter(|p| !p.is_empty())
                        .unwrap_or_else(|| "5432".into());
                    let dbname = Settings::get_pg_sync_dbname(&conn)
                        .unwrap_or_default()
                        .unwrap_or_default();
                    let user = Settings::get_pg_sync_user(&conn)
                        .unwrap_or_default()
                        .unwrap_or_default();
                    let password = Settings::get_pg_sync_password(&conn)
                        .unwrap_or_default()
                        .unwrap_or_default();
                    // TLS enforcement: when pg_sync.require_tls is set, the
                    // transport refuses plaintext connections (fail-closed
                    // for cloud PostgreSQL). Defaults to plaintext to match
                    // the historical NoTls transport.
                    let require_tls = Settings::get_pg_sync_require_tls(&conn).unwrap_or(false);
                    // The transport scopes every query to this tenant, so a
                    // shared multi-tenant database never leaks another
                    // tenant's rows to this terminal. Falls back to the
                    // local queue's tenant when the license setting is
                    // absent (pre-license installs).
                    let tenant_id: String = Settings::get(&conn, "license.tenant_id")
                        .unwrap_or_default()
                        .filter(|s| !s.is_empty())
                        .or_else(|| pending.first().map(|i| i.tenant_id.clone()))
                        .unwrap_or_else(|| "default".into());
                    // C3 S5: this install's own identity, read here in the
                    // existing blocking config phase (alongside the tenant
                    // read above) rather than as a query on the pull path.
                    // The pull then excludes rows this terminal pushed, so a
                    // terminal is never handed back its own work — the
                    // server-side half of the self-origin gate, which matters
                    // because the daemons apply against this global database
                    // while checkout wrote a per-store one.
                    //
                    // `None` is the UNPAIRED INSTALL: no filter, every tenant
                    // row returned, exactly today's behaviour. A lookup error
                    // also degrades to None here — the filter is defence in
                    // depth behind the per-effect receipt, so a failed read
                    // must not stop the daemon from syncing at all.
                    let sync_terminal_id = Settings::get_sync_terminal_id(&conn)
                        .ok()
                        .flatten()
                        .filter(|s| !s.is_empty());

                    if !host.is_empty() && !dbname.is_empty() {
                        Some((
                            host,
                            port,
                            dbname,
                            user,
                            password,
                            tenant_id,
                            require_tls,
                            sync_terminal_id,
                        ))
                    } else {
                        None
                    }
                } else {
                    None
                };

                (pg_config, pending, pull_since, pull_cursor)
            })
            .await
            {
                Ok((cfg, pending, since, cursor)) => (cfg, pending, since, cursor, None),
                Err(join_err) => {
                    let msg = format!("pg sync config read panicked: {join_err}");
                    tracing::error!(error = %msg, "pg sync daemon read phase failed");
                    (None, Vec::new(), None, None, Some(msg))
                }
            };

        // Phase 2: Do async PG sync if configured
        let mut pushed = 0usize;
        let mut pulled = 0usize;
        let mut sync_error: Option<String> = None;

        let pg_transport = pg_config.as_ref().and_then(
            |(host, port, dbname, user, password, tenant_id, require_tls, sync_terminal_id)| {
                let port_u16: u16 = port.parse().unwrap_or(5432);
                PgTransport::new_with_tls(
                    host,
                    port_u16,
                    dbname,
                    user,
                    password,
                    tenant_id,
                    *require_tls,
                )
                .ok()
                // An unpaired install carries None → the pull stays unfiltered.
                .map(|transport| transport.with_terminal_id(sync_terminal_id.clone()))
            },
        );

        if let Some(ref transport) = pg_transport {
            // Phase 3: push pending items (no-op when nothing is pending).
            if !pending.is_empty() {
                match transport.push_items(&pending).await {
                    Ok(results) => {
                        pushed = results.len(); // Phase 3: Apply push results to local DB (blocking)
                        let db_clone = db.clone();
                        let outcome = tokio::task::spawn_blocking(move || {
                            let conn = db_clone.blocking_lock();
                            let store = Store::new(&conn);
                            let queue = SyncQueue::new();
                            for (item, outcome) in pending.iter().zip(results.iter()) {
                                match outcome {
                                    crate::transport::PushOutcome::Accepted => {
                                        if let Err(e) = store.mark_offline_synced(&item.id) {
                                            tracing::error!(
                                                item_id = %item.id,
                                                error = %e,
                                                "pg sync daemon: failed to mark item synced"
                                            );
                                        }
                                    }
                                    crate::transport::PushOutcome::Rejected { reason } => {
                                        if let Err(e) = store.mark_offline_failed(&item.id, reason)
                                        {
                                            tracing::error!(
                                                item_id = %item.id,
                                                error = %e,
                                                "pg sync daemon: failed to mark item failed"
                                            );
                                        }
                                    }
                                    crate::transport::PushOutcome::Conflict(server_item) => {
                                        // SYNC-02 parity: route the conflict through the shared
                                        // ADR #21 service (version LWW / sale status DAG / stock
                                        // CRDT merge) instead of blanket mark-synced + re-enqueue,
                                        // which could resurrect stale remote state.
                                        if let Err(e) =
                                            queue.apply_push_conflict(&store, item, server_item)
                                        {
                                            tracing::error!(
                                                item_id = %item.id,
                                                action = %item.action,
                                                error = %e,
                                                "pg sync daemon: conflict resolution failed"
                                            );
                                        }
                                    }
                                }
                            }
                        })
                        .await;

                        if let Err(e) = outcome {
                            sync_error = Some(format!("apply push phase: {e}"));
                        }
                    }
                    Err(e) => {
                        sync_error = Some(e.to_string());
                    }
                }
            }

            // Phase 4: Pull remote updates and apply them locally.
            // SYNC-01 parity: the `since` anchor + composite `(created_at,
            // id)` cursor come from the durable `sync_pull_state` row, each
            // item applies atomically with the idempotency ledger, and the
            // anchor advances only after the page applied — so a replaying
            // remote queue can never re-apply a mutation, and a poison item
            // dead-letters instead of erroring forever. Pages loop while the
            // remote returns a next cursor (P-3 pagination). The pull runs on
            // every enabled cycle, independent of whether anything was
            // pending to push.
            let mut pull_since = pull_since;
            let mut pull_cursor = pull_cursor;
            loop {
                match transport
                    .pull_updates(pull_since.as_deref(), pull_cursor.as_deref())
                    .await
                {
                    Ok(pull_resp) => {
                        pulled += pull_resp.items.len();
                        let next_cursor = pull_resp.next_cursor;
                        if pull_resp.items.is_empty() {
                            break;
                        }
                        let db_clone = db.clone();
                        let items = pull_resp.items;
                        let prev_since = pull_since;
                        let prev_cursor = pull_cursor.clone();
                        // The closure needs the cursor to persist it with the
                        // anchor; the outer loop re-owns the original for the
                        // next pull iteration.
                        let next_cursor_for_persist = next_cursor.clone();
                        let settings_sink = settings_sink.clone();
                        let outcome = tokio::task::spawn_blocking(move || {
                            let conn = db_clone.blocking_lock();
                            let store = Store::new(&conn);
                            // None = retryable failure: the durable anchor is
                            // retained and pagination stops so the next cycle
                            // re-pulls the same page (`?` early-returns None
                            // from the closure).
                            let new_since = apply_pulled_page(
                                &store,
                                &items,
                                prev_since.as_deref(),
                                &settings_sink,
                            )?;
                            // SYNC-09: re-read the DURABLE pull state before
                            // advancing (parity with the SQLite daemon). An
                            // operator rewind (`requeue_remote_failure` sets
                            // since = NULL) can land while this page was in
                            // flight; writing new_since blindly would clobber
                            // it and the requeued item would never be
                            // re-fetched. Skip the write when the durable
                            // (since, cursor) no longer matches what this tick
                            // captured — full-state comparison, so a
                            // concurrent writer moving the anchor can never
                            // be overwritten with our now-stale value. Both
                            // the read and the (skipped) write hold the same
                            // `blocking_lock()`, so nothing can interleave.
                            let durable = store
                                .get_sync_pull_state()
                                .unwrap_or_default();
                            let rewound = durable.since.as_deref()
                                != prev_since.as_deref()
                                || durable.cursor.as_deref()
                                    != prev_cursor.as_deref();
                            if rewound {
                                tracing::warn!(
                                    "pg sync daemon: operator rewind detected mid-pull — retaining rewound anchor for full re-pull"
                                );
                                // Pagination may still continue in-memory: the
                                // retained NULL anchor makes the NEXT tick a
                                // full re-pull (ledger absorbs the replay).
                            } else if let Err(e) = store.set_sync_pull_state(
                                Some(&new_since),
                                next_cursor_for_persist.as_deref(),
                            ) {
                                tracing::error!(
                                    error = %e,
                                    "pg sync daemon: failed to persist pull anchor"
                                );
                            }
                            Some(new_since)
                        })
                        .await;
                        match outcome {
                            Ok(Some(new_since)) => {
                                pull_since = Some(new_since);
                                pull_cursor = next_cursor;
                                if pull_cursor.is_none() {
                                    break;
                                }
                            }
                            // Retryable failure — retain anchor, stop paginating.
                            Ok(None) => break,
                            Err(e) => {
                                if sync_error.is_none() {
                                    sync_error = Some(format!("apply pull phase: {e}"));
                                }
                                break;
                            }
                        }
                    }
                    Err(SyncError::AnchorExpired { oldest_available }) => {
                        tracing::warn!(
                            oldest_available = ?oldest_available,
                            "pg sync anchor expired — fetching snapshot to recover"
                        );
                        match transport.fetch_snapshot().await {
                            Ok(snapshot) => {
                                let db_clone = db.clone();
                                let anchor = oldest_available.clone();
                                let recovery = tokio::task::spawn_blocking(move || {
                                    let conn = db_clone.blocking_lock();
                                    let store = Store::new(&conn);
                                    recover_pg_snapshot(&store, &snapshot, anchor.as_deref())
                                })
                                .await;
                                match recovery {
                                    Ok(Ok(imported)) => {
                                        tracing::info!(
                                            imported,
                                            "pg snapshot imported after anchor expiry"
                                        );
                                    }
                                    Ok(Err(e)) => {
                                        if sync_error.is_none() {
                                            sync_error =
                                                Some(format!("snapshot recovery failed: {e}"));
                                        }
                                    }
                                    Err(e) => {
                                        if sync_error.is_none() {
                                            sync_error =
                                                Some(format!("snapshot recovery panicked: {e}"));
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                if sync_error.is_none() {
                                    sync_error =
                                        Some(format!("snapshot recovery fetch failed: {e}"));
                                }
                            }
                        }
                        break;
                    }
                    Err(e) => {
                        if sync_error.is_none() {
                            sync_error = Some(format!("pull phase: {e}"));
                        }
                        break;
                    }
                }
            }
        }

        // Get pending count
        let db_clone = db.clone();
        let pending_count = tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let store = Store::new(&conn);
            store.pending_offline_count().unwrap_or(0)
        })
        .await
        .unwrap_or(0);

        // Update daemon status
        let mut s = daemon_status.write().await;
        s.last_sync_at =
            Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
        s.pending_count = pending_count;
        s.last_pushed = pushed;
        s.last_pulled = pulled;
        // If the read phase panicked, surface that error in the status.
        s.last_error = sync_error.clone().or_else(|| read_error.clone());

        if sync_error.is_some() {
            tracing::error!(error = ?sync_error, "pg sync cycle failed");
        } else {
            tracing::info!(pushed, pulled, "pg sync cycle completed");
        }
    }

    /// Gracefully stop the background PG sync daemon.
    ///
    /// Signals the run loop and then WAITS for it to exit — including an
    /// in-flight sync cycle — for up to [`PG_STOP_GRACE`]. Returns `true`
    /// when the loop exit was observed (so `running` is cleared and an
    /// immediate [`PgSyncDaemon::start`] can take over); `false` means the
    /// grace expired with the loop still running — the timeout is reported
    /// to the caller and logged, never pretended away. The loop keeps
    /// exiting in the background and clears `running` when it finishes.
    pub async fn stop(&self) -> bool {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(true);
        }
        let Some(worker) = self.worker.lock().await.take() else {
            return true;
        };
        match tokio::time::timeout(PG_STOP_GRACE, worker).await {
            Ok(_) => true,
            Err(_) => {
                tracing::error!(
                    grace_ms = PG_STOP_GRACE.as_millis() as u64,
                    "pg sync daemon stop timed out — the run loop is still finishing its cycle in the background"
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
    pub async fn status(&self) -> PgDaemonStatus {
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

    /// Signal the run loop to wake up and run a PG sync tick immediately
    /// (SYNC-EW — event-triggered wakeup).
    ///
    /// Identical semantics to [`crate::daemon::SyncDaemon::nudge`]: safe from
    /// any thread, coalesces bursts, is a no-op when the daemon is stopped.
    pub fn nudge(&self) {
        self.wakeup.notify_one();
    }

    /// Return a clone of the underlying [`Arc<Notify>`] for test inspection.
    #[cfg(test)]
    pub(crate) fn wakeup_handle(&self) -> Arc<Notify> {
        Arc::clone(&self.wakeup)
    }
}

impl Default for PgSyncDaemon {
    fn default() -> Self {
        Self::new()
    }
}

/// Import a PostgreSQL snapshot, then move the durable pull anchor to the
/// server's oldest retained boundary.
///
/// The anchor is changed only after [`import_snapshot`] succeeds. A failed
/// import therefore leaves the stale anchor intact so the next cycle can
/// retry recovery rather than claiming that the gap was repaired.
fn recover_pg_snapshot(
    store: &Store<'_>,
    snapshot: &crate::transport::SyncSnapshotResponse,
    oldest_available: Option<&str>,
) -> SyncResult<usize> {
    let imported = import_snapshot(store, snapshot)?;
    store.set_sync_pull_state(oldest_available, None)?;
    Ok(imported)
}

/// Apply one page of pulled remote items atomically (SYNC-01 parity with the
/// SQLite daemon).
///
/// Each item is applied via [`SyncQueue::apply_remote_atomic`] — the domain
/// mutation and its idempotency receipt commit in one transaction, and a
/// poison item is dead-lettered after its retry budget. Returns the next
/// durable pull anchor to persist: `Some(max(prev_since, newest created_at))`
/// when the whole page applied (dead-lettered items count as applied), or
/// `None` when a retryable failure requires retaining the current anchor so
/// the next cycle re-pulls the same page. A replayed page never re-applies a
/// mutation (the ledger skips it), so a crash mid-pull is safe.
///
/// The anchor is the page's newest `created_at` — the composite cursor's
/// first key — never `synced_at`, which the remote may leave NULL forever
/// (rows pushed as `pending` are only stamped later). Anchoring on
/// `created_at` means a queue whose rows are never stamped still advances
/// and is never re-pulled in full.
///
/// ADR #6 parity with the SQLite daemon: when the page contains
/// `stock.movement` items (which write ONLY the raw delta ledger — the
/// apply path never touches `stock_summary`), the materialized summary is
/// rebuilt from the ledger before the anchor advances, and a rebuild
/// failure retains the anchor so the next cycle re-pulls the same page and
/// retries the derived-state rebuild.
///
/// SYNC-10 parity: a pulled `settings.update`/`settings.change` re-emits
/// `SettingsUpdated` through `settings_sink` after its transaction commits
/// (the same contract as the SQLite daemon), so the app can refetch a
/// setting changed on a remote PostgreSQL terminal.
fn apply_pulled_page(
    store: &Store<'_>,
    page: &[OfflineQueueItem],
    prev_since: Option<&str>,
    settings_sink: &SettingsChangedSink,
) -> Option<String> {
    let queue = SyncQueue::new();
    let mut page_all_applied = true;
    let mut has_stock_movements = false;

    for remote_item in page {
        if remote_item.action == "stock.movement" {
            has_stock_movements = true;
        }
        match queue.apply_remote_atomic_full(store, remote_item) {
            Ok(outcome) => {
                // SYNC-10 parity: a settings change applied from a remote
                // PostgreSQL terminal is re-emitted as `SettingsUpdated` so
                // the UI refetches. The tx committed inside
                // apply_remote_atomic_full before this runs.
                if let Some((key, terminal_id)) = outcome.settings_change {
                    let event = SettingsUpdated {
                        changed_keys: vec![key],
                        terminal_id,
                    };
                    settings_sink(&event);
                }
                if !outcome.applied
                    && store
                        .is_remote_failure_dead_lettered(&remote_item.id)
                        .unwrap_or(false)
                {
                    tracing::error!(
                        item_id = %remote_item.id,
                        action = %remote_item.action,
                        "remote item remains quarantined; advancing page anchor"
                    );
                }
            }
            Err(e) => {
                let dead_lettered = store
                    .is_remote_failure_dead_lettered(&remote_item.id)
                    .unwrap_or(false);
                if dead_lettered {
                    tracing::error!(
                        item_id = %remote_item.id,
                        action = %remote_item.action,
                        error = %e,
                        "remote item quarantined after repeated failures; advancing page anchor"
                    );
                } else {
                    page_all_applied = false;
                    tracing::error!(
                        item_id = %remote_item.id,
                        action = %remote_item.action,
                        error = %e,
                        "failed to atomically apply remote item; retaining pull anchor for retry"
                    );
                }
            }
        }
    }

    if !page_all_applied {
        return None;
    }

    // ADR #6: rebuild the materialized stock_summary from the delta ledger
    // before advancing the pull anchor. If the rebuild fails, the old anchor
    // is retained so the next cycle can restore the derived state as well
    // (replay is absorbed by the idempotency ledger).
    if has_stock_movements && let Err(e) = store.rebuild_stock_summary() {
        tracing::error!(
            error = %e,
            "failed to rebuild stock summary after pg sync pull"
        );
        return None;
    }

    // Monotonic anchor: take the later of the current anchor and the page's
    // newest `created_at` watermark — the composite cursor's first key, so
    // the durable anchor tracks exactly what the next pull filters on. The
    // remote may never stamp `synced_at` (rows pushed as `pending` stay
    // NULL), so anchoring on `synced_at` could stall the anchor forever and
    // re-pull the whole queue every cycle. `.or()` alone could regress the
    // anchor when the remote returns rows older than `since` (clock skew /
    // late delivery), which would re-fetch history on every cycle. ISO-8601
    // timestamps are fixed-format, so lexicographic ordering equals
    // chronological ordering here.
    let page_max = page.iter().map(|i| i.created_at.as_str()).max();
    std::cmp::max(prev_since, page_max).map(str::to_owned)
}

#[cfg(test)]
#[path = "pg_daemon_tests.rs"]
mod tests;
