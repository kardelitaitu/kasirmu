//! Sync daemon tick pipeline — one full sync cycle, split out of
//! `daemon.rs` to keep files small (F-018).
//!
//! Key functions:
//! - `run_tick` — read → push → apply → pull phases; never holds the
//!   `!Send` `Store` across `.await` points (each DB phase runs inside
//!   `spawn_blocking`).
//!
//! Invariants: RUST-05 fail-closed transport on both phases; SYNC-01
//! durable pull anchor advances only after the whole page and the
//! ADR #6 stock_summary rebuild succeed; SYNC-09 mid-pull operator-rewind
//! detection; ADR #11 migration redirects update the local URL; per-phase
//! join panics surface in daemon status.

use super::*;
use crate::transport::SyncTransport;
use crate::{SyncError, import_snapshot};
use kasirmu_core::offline::OfflineQueueItem;

/// Run a single sync tick: read → send → apply.
///
/// `settings_sink` is invoked after the pull phase applies a remote
/// `settings.update` (SYNC-10) so the change is reactive in this
/// terminal's UI even though it was made elsewhere.
/// ADR sync-auth-hardening P1/P4: refresh the persisted API key and retry
/// the push batch exactly once after an `AuthExpired` rejection. Returns
/// (pushed, error) where `error` is set when the entire retry path fails
/// (refresh failure, transport construction, or the retry push itself).
/// On success `error` carries the `apply_push_results` outcome (if any).
async fn push_retry_after_auth_refresh(
    db: &DbConnection,
    cfg: &SyncConfig,
    pending: Vec<OfflineQueueItem>,
) -> (usize, Option<String>) {
    tracing::warn!("push rejected (401) — refreshing API key and retrying once");
    if !refresh_persisted_api_key(db, &cfg.server_url).await {
        return (
            0,
            Some("push rejected (401) and token refresh failed".into()),
        );
    }
    let (retry_cfg, _) = {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            read_config_and_pending(&conn)
        })
        .await
        .unwrap_or((None, Vec::new()))
    };
    let Some(retry_cfg) = retry_cfg else {
        return (
            0,
            Some("push rejected (401) and refreshed key is not usable".into()),
        );
    };
    let Ok(transport) = SyncTransport::try_new(&retry_cfg.server_url, retry_cfg.api_key.as_deref())
    else {
        return (
            0,
            Some("push rejected (401) and refreshed key is not usable".into()),
        );
    };
    // Enable conflict-detection stamping when this terminal has an identity.
    // The counter is seeded from the persisted clock and written back after
    // the push, so a restart resumes where it left off instead of rewinding.
    let seeded = {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let terminal = kasirmu_core::settings::Settings::get_sync_terminal_id(&conn)
                .ok()
                .flatten();
            let counter = kasirmu_core::Store::new(&conn)
                .get_setting(crate::crdt::CLOCK_KEY)
                .ok()
                .flatten()
                .and_then(|raw| crate::crdt::parse_counter(&raw).ok())
                .unwrap_or(0);
            (terminal, counter)
        })
        .await
        .unwrap_or((None, 0))
    };
    let transport = match seeded.0 {
        Some(terminal_id) => transport.with_vector_stamping(&terminal_id, seeded.1),
        None => transport,
    };

    match transport.push_items(&pending).await {
        Ok(results) => {
            let pushed = results.len();
            if let Some(counter) = transport.last_stamped_counter() {
                let db_clone = db.clone();
                let value = counter.to_string();
                // Persisting is best-effort: a failed write costs one restart's
                // worth of detection, never the pushed data.
                let _ = tokio::task::spawn_blocking(move || {
                    let conn = db_clone.blocking_lock();
                    kasirmu_core::Store::new(&conn).set_setting(crate::crdt::CLOCK_KEY, &value)
                })
                .await;
            }
            let apply_err = apply_push_results(db, pending, results).await;
            (pushed, apply_err)
        }
        Err(retry_err) => (0, Some(retry_err.to_string())),
    }
}

/// ADR #11: persist a server-migration redirect so the next cycle connects to
/// the new server. Best-effort (a failure just keeps the old URL for one more
/// cycle).
async fn persist_migration_url(db: &DbConnection, new_url: &str) {
    let db = db.clone();
    let url = new_url.to_owned();
    let _ = tokio::task::spawn_blocking(move || {
        let conn = db.blocking_lock();
        let store = Store::new(&conn);
        let _ = Settings::set_sync_server_url(store.conn(), &url);
    })
    .await;
    tracing::info!(new_url = %new_url, "server migrated — local config updated");
}

/// Recover from an expired pull anchor: fetch a full snapshot, import it, and
/// reset the pull state. Returns the error message to record in daemon status
/// (None when the snapshot was imported cleanly).
async fn recover_expired_anchor(
    db: &DbConnection,
    transport: &SyncTransport,
    oldest_available: Option<String>,
) -> Option<String> {
    tracing::warn!(
        oldest_available = ?oldest_available,
        "sync anchor expired — fetching snapshot to recover"
    );
    match transport.fetch_snapshot().await {
        Ok(snapshot) => {
            let db_clone = db.clone();
            let anchor = oldest_available.clone();
            let recovery = tokio::task::spawn_blocking(move || {
                let conn = db_clone.blocking_lock();
                let store = Store::new(&conn);
                let imported = import_snapshot(&store, &snapshot)?;
                store.set_sync_pull_state(anchor.as_deref(), None)?;
                Ok::<usize, SyncError>(imported)
            })
            .await;
            match recovery {
                Ok(Ok(imported)) => {
                    tracing::info!(imported, "snapshot imported after daemon anchor expiry");
                    None
                }
                Ok(Err(e)) => Some(format!("snapshot recovery failed: {e}")),
                Err(e) => Some(format!("snapshot recovery panicked: {e}")),
            }
        }
        Err(e) => {
            if let SyncError::ServerMigrated { new_url } = &e {
                persist_migration_url(db, new_url).await;
            }
            Some(format!("snapshot recovery fetch failed: {e}"))
        }
    }
}

/// Handle a non-anchor pull failure: persist a server-migration redirect and
/// refresh the API key on 401 so the next cycle pulls with fresh credentials.
/// No in-tick pull retry — the pull apply block is anchor/quarantine-sensitive,
/// so a retry would duplicate ~150 lines of application logic; recovery one
/// cycle later is automatic. Returns the error message to record in daemon
/// status.
async fn handle_pull_error(db: &DbConnection, cfg: &SyncConfig, e: SyncError) -> Option<String> {
    if let SyncError::ServerMigrated { new_url } = &e {
        persist_migration_url(db, new_url).await;
    }
    if let SyncError::AuthExpired = e {
        tracing::warn!("pull rejected (401) — refreshing API key for next cycle");
        if refresh_persisted_api_key(db, &cfg.server_url).await {
            Some("pull rejected (401); key refreshed — will retry next cycle".into())
        } else {
            Some("pull rejected (401) and token refresh failed".into())
        }
    } else {
        Some(format!("pull phase: {e}"))
    }
}

pub(super) async fn run_tick(
    db: &DbConnection,
    daemon_status: &Arc<RwLock<DaemonStatus>>,
    settings_sink: &SettingsChangedSink,
) {
    // Phase 1: Read config + pending items from DB (blocking)
    let db_clone = db.clone();
    let (config, pending, read_error) = match tokio::task::spawn_blocking(move || {
        let conn = db_clone.blocking_lock();
        let (cfg, pending) = read_config_and_pending(&conn);
        (cfg, pending)
    })
    .await
    {
        Ok((cfg, pending)) => (cfg, pending, None),
        Err(join_err) => {
            let msg = format!("sync config read panicked: {join_err}");
            tracing::error!(error = %msg, "sync daemon read phase failed");
            (None, Vec::new(), Some(msg))
        }
    };

    // Phase 2: Do async sync if configured and there are pending items.
    // `pushed`/`pulled` start at 0 so every code path (including the
    // RUST-05 fail-closed transport skip) yields a defined value for the
    // daemon status below.
    let mut pushed = 0;
    let mut pulled = 0;
    let mut sync_error: Option<String> = None;

    if let Some(cfg) = &config {
        if !cfg.server_url.is_empty() && !pending.is_empty() {
            // RUST-05: fail closed — never sync through an
            // unauthenticated, timeout-less client. A construction
            // failure records the error and skips the push phase.
            let transport = match SyncTransport::try_new(&cfg.server_url, cfg.api_key.as_deref()) {
                Ok(t) => Some(t),
                Err(e) => {
                    pushed = 0;
                    sync_error = Some(format!("transport construction failed: {e}"));
                    tracing::error!(
                        error = %e,
                        "sync transport construction failed — skipping push (RUST-05 fail-closed)"
                    );
                    None
                }
            };
            if let Some(transport) = transport {
                // Enable conflict-detection stamping when this terminal has an
                // identity. The counter is seeded from the persisted clock and
                // written back after the push: a counter that rewinds on
                // restart makes the server classify every push as stale, and
                // detection would quietly stop for this terminal.
                let seeded = {
                    let db_clone = db.clone();
                    tokio::task::spawn_blocking(move || {
                        let conn = db_clone.blocking_lock();
                        let terminal =
                            kasirmu_core::settings::Settings::get_sync_terminal_id(&conn)
                                .ok()
                                .flatten();
                        let counter = kasirmu_core::Store::new(&conn)
                            .get_setting(crate::crdt::CLOCK_KEY)
                            .ok()
                            .flatten()
                            .and_then(|raw| crate::crdt::parse_counter(&raw).ok())
                            .unwrap_or(0);
                        (terminal, counter)
                    })
                    .await
                    .unwrap_or((None, 0))
                };
                let transport = match seeded.0 {
                    Some(terminal_id) => transport.with_vector_stamping(&terminal_id, seeded.1),
                    None => transport,
                };

                match transport.push_items(&pending).await {
                    Ok(results) => {
                        pushed = results.len();
                        if let Some(counter) = transport.last_stamped_counter() {
                            let db_clone = db.clone();
                            let value = counter.to_string();
                            // Best-effort: a failed write costs one restart's
                            // worth of detection, never the pushed data.
                            let _ = tokio::task::spawn_blocking(move || {
                                let conn = db_clone.blocking_lock();
                                kasirmu_core::Store::new(&conn)
                                    .set_setting(crate::crdt::CLOCK_KEY, &value)
                            })
                            .await;
                        }
                        // Phase 3: Apply push results to DB (blocking).
                        // SYNC-02: carry the FULL local items (not just ids)
                        // so a conflict is resolved by the shared ADR #21
                        // conflict-application service — the same strategy the
                        // immediate SyncEngine uses, never a blanket LWW.
                        if let Some(apply_err) = apply_push_results(db, pending, results).await {
                            sync_error = Some(apply_err);
                        }
                    }
                    Err(e) => {
                        pushed = 0;
                        // ADR #11: If the server migrated, update the local
                        // URL so the next cycle connects to the new server.
                        if let SyncError::ServerMigrated { new_url } = &e {
                            persist_migration_url(db, new_url).await;
                        }
                        // ADR sync-auth-hardening P1/P4: stale auth — refresh
                        // the key once and retry the push batch exactly once.
                        // An explicit `invalid_token` is a config problem and
                        // must not be masked by a refresh.
                        if let SyncError::AuthExpired = e {
                            let (retry_pushed, retry_err) =
                                push_retry_after_auth_refresh(db, cfg, pending).await;
                            pushed = retry_pushed;
                            if sync_error.is_none() {
                                sync_error = retry_err;
                            }
                        } else if sync_error.is_none() {
                            sync_error = Some(e.to_string());
                        }
                    }
                }
            }
        } else {
            pushed = 0;
        }

        // Phase 4: Pull remote updates and apply them locally.
        if !cfg.server_url.is_empty() {
            // SYNC-01: read the durable pull anchor + cursor so we only
            // fetch updates newer than the last successfully-applied page
            // (previously every cycle pulled the ENTIRE queue and re-applied
            // stock/sale mutations, silently corrupting inventory).
            let (pull_since, pull_cursor) = {
                let db_clone = db.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db_clone.blocking_lock();
                    let store = Store::new(&conn);
                    let st = store.get_sync_pull_state().unwrap_or_default();
                    (st.since, st.cursor)
                })
                .await
                .unwrap_or((None, None))
            };

            // RUST-05: fail closed for the pull phase as well.
            let transport = match SyncTransport::try_new(&cfg.server_url, cfg.api_key.as_deref()) {
                Ok(t) => Some(t),
                Err(e) => {
                    pulled = 0;
                    if sync_error.is_none() {
                        sync_error = Some(format!("transport construction failed: {e}"));
                    }
                    tracing::error!(
                        error = %e,
                        "sync transport construction failed — skipping pull (RUST-05 fail-closed)"
                    );
                    None
                }
            };
            if let Some(transport) = transport {
                match transport
                    .pull_updates(pull_since.as_deref(), pull_cursor.as_deref())
                    .await
                {
                    Ok(pull_resp) => {
                        pulled = pull_resp.items.len();
                        if !pull_resp.items.is_empty() {
                            let db_clone = db.clone();
                            let items = pull_resp.items;
                            let next_cursor = pull_resp.next_cursor;
                            let prev_since = pull_since.clone();
                            let prev_cursor = pull_cursor.clone();
                            // SYNC-10: own the sink (an owned `Arc`) so the
                            // `'static` spawn_blocking closure can call it
                            // after each applied settings item.
                            let settings_sink = settings_sink.clone();
                            let outcome = tokio::task::spawn_blocking(move || {
                                let conn = db_clone.blocking_lock();
                                let store = Store::new(&conn);
                                apply_pulled_page(
                                    &store,
                                    &items,
                                    prev_since.as_deref(),
                                    prev_cursor.as_deref(),
                                    next_cursor.as_deref(),
                                    &settings_sink,
                                )
                            })
                            .await;
                            // SYNC-01: propagate both spawn_blocking panics AND
                            // anchor-persistence failures into sync_error so the
                            // daemon status/backoff reflect them.
                            match outcome {
                                Ok(Some(msg)) => {
                                    if sync_error.is_none() {
                                        sync_error = Some(msg);
                                    }
                                }
                                Ok(None) => {}
                                Err(e) => {
                                    if sync_error.is_none() {
                                        sync_error = Some(format!("apply pull phase: {e}"));
                                    }
                                }
                            }
                        }
                    }
                    Err(SyncError::AnchorExpired { oldest_available }) => {
                        pulled = 0;
                        if sync_error.is_none() {
                            sync_error =
                                recover_expired_anchor(db, &transport, oldest_available).await;
                        }
                    }
                    Err(e) => {
                        pulled = 0;
                        if sync_error.is_none() {
                            sync_error = handle_pull_error(db, cfg, e).await;
                        }
                    }
                }
            }
        } else {
            pulled = 0;
        }
    } else {
        pushed = 0;
        pulled = 0;
    }

    // Phase 5: licence ride-along (ADR #58 option C, "ride any authenticated
    // call"). Independent of the data sync above and deliberately so: it runs
    // whenever this terminal is *configured at all*, even when there is
    // nothing to push or pull, because a ban must reach an idle till too.
    //
    // Before this phase the only caller of `check_license_status` was the
    // Settings screen's poll (`LicenseSettings.tsx`, armed on mount and torn
    // down on unmount), so a device that never opened Settings never learned
    // it had been revoked. This is that notice, on the daemon's cadence.
    //
    // Never touches `sync_error`: a licence-server outage must not be
    // reported as a sync failure, or it would drive the sync daemon's backoff
    // and eventually stop data replication over an unrelated service.
    run_license_ride_along(db).await;

    update_daemon_status(db, daemon_status, pushed, pulled, &sync_error, &read_error).await;
}

/// The licence ride-along tick: ask the licence server for this tenant's
/// verdict and apply it locally (ADR #58 option C).
///
/// **Why "ride any authenticated call" is implemented here and not on the
/// sync snapshot.** The obvious carrier looks like the snapshot envelope, but
/// that response is built and cached by the CLOUD server
/// (`apps/cloud-server/src/sync_api.rs`), which serialises the bytes once and
/// serves them from a Redis-backed cache keyed by an ETag version. A licence
/// verdict placed there would be served stale for the cache's whole lifetime,
/// or would have to bust the ETag on every heartbeat and turn a bulk data
/// cache into a per-request recompute. The cloud server also holds no licence
/// knowledge at all — its only subscription references are Stripe *plan*
/// updates in `webhooks.rs` — so it cannot author the verdict regardless.
///
/// The licence server already answers exactly this question, and
/// `LicenseStatusResponse` already carries `status`, `device_revoked` and
/// `expires_at`. Nothing is added to the wire: this phase simply makes the
/// call the Settings screen was the only thing making.
///
/// **Fail-open, and silent on failure.** An unreachable licence server, a
/// missing api key, or an undecryptable one all return without touching any
/// local state — the cached verdict stands and the till keeps working (§2.4).
/// Failures are logged at debug/warn, never surfaced as sync errors, so an
/// outage on this endpoint cannot back off data replication.
///
/// **Sessions are swept when the tenant verdict is `revoked`.** The bridge
/// owns the session store, so this cannot call
/// `invalidate_all_sessions` directly; it records the verdict and lets the
/// session gate enforce it on the next `create_session` (§2.7's "enforcement
/// never depends on the local DB refusing to open"). §2.5's at-once sweep for
/// the already-open session happens on the paths that have the bridge in
/// scope — which is why the cache write is the load-bearing half here.
async fn run_license_ride_along(db: &DbConnection) {
    // Read the credentials this needs. The api key is stored encrypted
    // (machine-bound); a decrypt failure falls back to the legacy plaintext
    // form exactly as the bridge lane does, so a pre-encryption install is
    // not silently denied its revocation notice.
    let creds = {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            let api_key_enc = kasirmu_core::settings::Settings::get(&conn, "license.api_key")
                .ok()
                .flatten()
                .filter(|s| !s.is_empty())?;
            let machine_id = kasirmu_core::settings::Settings::get(
                &conn,
                kasirmu_core::settings::keys::MACHINE_ID,
            )
            .ok()
            .flatten()
            .unwrap_or_default();
            Some((api_key_enc, machine_id))
        })
        .await
        .unwrap_or(None)
    };

    let Some((api_key_enc, machine_id)) = creds else {
        // No licence activated on this terminal — nothing to ask about.
        // This is the common path for a free/local install, so it is debug.
        tracing::debug!("licence ride-along skipped: no stored api key");
        return;
    };

    let api_key = match kasirmu_core::crypto::decrypt_api_key(&api_key_enc, &machine_id) {
        Ok(k) => k,
        Err(e) => {
            tracing::debug!(
                "licence ride-along: api key decryption failed, treating as legacy plaintext: {e}"
            );
            api_key_enc
        }
    };

    let resp = match kasirmu_core::license_verification::check_license_status(&api_key, &machine_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // Fail open: keep the cached verdict and keep selling. Logged at
            // warn (not error) because an unreachable licence server is an
            // expected condition on an offline-first till, not a fault.
            tracing::warn!("licence ride-along: status check failed, keeping cached verdict: {e}");
            return;
        }
    };

    // Read the device verdict before the response is moved into the blocking
    // closure below — it is needed for the log line, not for the cache write.
    let device_revoked = resp.device_revoked;

    let tenant_revoked = {
        let db_clone = db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.blocking_lock();
            kasirmu_core::license_verification::apply_license_verdict_to_cache(&conn, &resp)
        })
        .await
        .unwrap_or(false)
    };

    if tenant_revoked || device_revoked {
        tracing::warn!(
            tenant_revoked,
            device_revoked,
            "licence ride-along recorded a revocation verdict (ADR #58 §2.4a.2/§2.5)"
        );
    }
}

/// Finalize a tick: read the pending count, write the daemon status, and log
/// the cycle outcome. Extracted from `run_tick` so the status bookkeeping is
/// independently testable.
async fn update_daemon_status(
    db: &DbConnection,
    daemon_status: &Arc<RwLock<DaemonStatus>>,
    pushed: usize,
    pulled: usize,
    sync_error: &Option<String>,
    read_error: &Option<String>,
) {
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
    s.last_sync_at = Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    s.pending_count = pending_count;
    s.last_pushed = pushed;
    s.last_pulled = pulled;
    // If the read phase panicked, surface that error in the status.
    s.last_error = sync_error.clone().or_else(|| read_error.clone());

    if let Some(err) = sync_error {
        tracing::error!(error = ?err, "sync cycle failed");
    } else {
        tracing::info!(pushed, "sync cycle completed");
    }
}

/// Apply a pulled page atomically, rebuild the stock summary, and advance the
/// durable pull anchor (SYNC-01 / ADR #6 / SYNC-09).
///
/// This is the SQLite daemon's analogue of `pg_daemon::apply_pulled_page` —
/// the same item-application loop (with the SYNC-10 settings sink), extended
/// with the responsibilities that live only on the SQLite path:
///   - ADR #6: rebuild `stock_summary` after any `stock.movement` item
///   - SYNC-09: re-read the durable pull state before advancing so an
///     operator rewind mid-pull is never clobbered
///   - SYNC-01: persist the new (since, cursor) anchor only when the whole
///     page applied cleanly and no rewind intervened
///
/// Returns `Some(message)` when the page must be surfaced as an anchor /
/// quarantine error in daemon status (persist failure, dead-lettered item, or
/// stock rebuild failure); `None` when the page applied cleanly. The caller
/// runs this inside `spawn_blocking` (blocking DB work).
fn apply_pulled_page(
    store: &Store<'_>,
    page: &[OfflineQueueItem],
    prev_since: Option<&str>,
    prev_cursor: Option<&str>,
    next_cursor: Option<&str>,
    settings_sink: &SettingsChangedSink,
) -> Option<String> {
    let queue = SyncQueue::new();
    let mut has_stock_movements = false;
    let mut all_applied = true;
    let mut quarantined_item = false;
    let mut retryable_failure = false;
    // SYNC-01: captured so anchor-persistence failures surface in the daemon
    // status (returned from this function) instead of being silently
    // swallowed by tracing only.
    let mut anchor_error: Option<String> = None;
    for item in page {
        if item.action == "stock.movement" {
            has_stock_movements = true;
        }
        // SYNC-01: the domain mutation and its idempotency receipt commit
        // together. A crash before commit rolls back both, so replay is safe
        // rather than duplicating a committed stock mutation with a missing
        // receipt.
        match queue.apply_remote_atomic_full(store, item) {
            Ok(outcome) => {
                // SYNC-10: a settings change applied from a remote terminal is
                // re-emitted as `SettingsUpdated` so the UI refetches. The tx
                // committed inside apply_remote_atomic_full before this runs.
                if let Some((key, terminal_id)) = outcome.settings_change {
                    let event = SettingsUpdated {
                        changed_keys: vec![key],
                        terminal_id,
                    };
                    settings_sink(&event);
                }
                if !outcome.applied
                    && store
                        .is_remote_failure_dead_lettered(&item.id)
                        .unwrap_or(false)
                {
                    quarantined_item = true;
                    tracing::error!(
                        item_id = %item.id,
                        action = %item.action,
                        "remote item remains quarantined; advancing page anchor"
                    );
                }
            }
            Err(e) => {
                let dead_lettered = store
                    .is_remote_failure_dead_lettered(&item.id)
                    .unwrap_or(false);
                if dead_lettered {
                    quarantined_item = true;
                    tracing::error!(
                        item_id = %item.id,
                        action = %item.action,
                        error = %e,
                        "remote item quarantined after repeated failures; advancing page anchor"
                    );
                } else {
                    all_applied = false;
                    retryable_failure = true;
                    tracing::error!(
                        item_id = %item.id,
                        action = %item.action,
                        error = %e,
                        "failed to atomically apply remote item; retaining page anchor for retry"
                    );
                }
            }
        }
    }
    // ADR #6: Rebuild the materialized stock_summary cache before advancing
    // the pull anchor. If the rebuild fails, the old anchor is retained so a
    // retry can restore the derived state as well.
    let summary_rebuilt = if has_stock_movements {
        match store.rebuild_stock_summary() {
            Ok(_) => true,
            Err(e) => {
                tracing::error!(
                    error = %e,
                    "failed to rebuild stock summary after sync pull"
                );
                anchor_error = Some(format!("rebuild stock summary after sync pull: {e}"));
                false
            }
        }
    } else {
        true
    };
    // SYNC-01: advance the pull anchor ONLY after the whole page and its
    // derived stock cache applied successfully. A crash mid-pull leaves the
    // old anchor so the ledger absorbs replay.
    if all_applied && !retryable_failure && summary_rebuilt {
        // SYNC-09: re-read the DURABLE pull state before advancing. An
        // operator rewind (`requeue_remote_failure` sets since = NULL to
        // force a full re-pull) can land while this page was in flight;
        // blindly writing new_since would clobber it and the requeued item
        // would never be re-fetched. Skip the advance when the durable
        // (since, cursor) no longer matches what this tick captured — a
        // full-state comparison, not just the Some→None rewind signature, so
        // a concurrent writer moving the anchor (forward or back) can never
        // be overwritten with our now-stale value. The re-read and the write
        // below share the same `blocking_lock()` hold, so no rewind can
        // interleave between them.
        let durable = store.get_sync_pull_state().unwrap_or_default();
        let rewound =
            durable.since.as_deref() != prev_since || durable.cursor.as_deref() != prev_cursor;
        if rewound {
            tracing::warn!(
                "operator rewind detected mid-pull — retaining rewound anchor for full re-pull"
            );
        } else {
            let new_since = page
                .iter()
                .map(|i| i.created_at.clone())
                .max()
                .or_else(|| prev_since.map(str::to_owned));
            if let Err(e) = store.set_sync_pull_state(new_since.as_deref(), next_cursor) {
                tracing::error!(
                    error = %e,
                    "failed to persist sync pull anchor"
                );
                anchor_error = Some(format!("persist sync pull anchor: {e}"));
            }
        }
    }
    // Keep quarantine visible in daemon status even though the page is
    // allowed to advance after the configured retry budget is exhausted.
    if quarantined_item && anchor_error.is_none() {
        anchor_error = Some("one or more remote items were dead-lettered".to_owned());
    }
    // Return the anchor-persistence/quarantine error so the caller surfaces
    // the recovery action in daemon status and logs.
    anchor_error
}
