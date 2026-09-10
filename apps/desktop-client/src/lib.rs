/*
last audited 25-07-26 by RSA-Agent (desktop-client slice C: lib verified)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: clean — Tauri builder with plugin registrations, documented invoke_handler ordering convention, test-only Windows manifest link_section with full documentation; no unsafe in production paths
next: none | perf: N/A
*/
//! Tauri v2 application entry point.
//!
//! Wires the [`AppState`] (DB connection, driver registry, config) into the
//! Tauri builder, registers all `#[tauri::command]` handlers, and starts the
//! runtime. Mobile builds use the same code via `#[cfg_attr(mobile,
//! tauri::mobile_entry_point)]`.
//!
//! Adding a new command:
//! 1. Define `pub async fn` with `#[tauri::command]` in `commands/<feature>.rs`.
//! 2. Add it to the `invoke_handler!` macro below in the same order as the
//!    `commands` module re-exports.
//! 3. Document the command in the `tauri-ipc` skill.

/// All `#[tauri::command]` handlers, organised by domain.
pub mod commands;
/// Background email report scheduler.
pub mod email_scheduler;
/// Single error type for every Tauri command.
pub mod error;
/// Image push scheduler daemon (spec 0046b §3.6) — drains the local
/// `image_push_queue` to the cloud batch endpoint on a jittered cadence.
mod image_push;
/// LAN event forwarding for multi-terminal setups.
///
/// Multi-terminal: each POS terminal runs its own process with its own
/// AppState. The LAN server broadcasts events (KDS orders, stock changes)
/// to all connected terminals in the same store. Terminal identification
/// happens at startup via device_id lookup (see state.rs).
pub mod lan_server;
/// Loopback local REST API server (embedded `oz-api` router) — lets
/// merchants run their own scripts against this register. Off by
/// default; enabled via Settings → Local API.
pub mod local_api;
/// Global application state (DB, kernel, sync daemon, registry).
pub mod state;

/// Debug-only bootstrap that connects the desktop client to the local
/// dev sync server (`scripts/start-local-sync.bat` → `:3099`) without
/// manual Settings configuration. Excluded from release builds.
///
/// TEMPORARILY DISABLED (2026-08-16): the auto-provision call site in
/// `setup` is commented out while testing against the deployed cloud
/// server, so this module's entry points are dead in non-test builds. The
/// module stays compiled (with `#[allow(dead_code)]`) so its unit tests
/// keep running; remove this attribute when the call site is restored.
#[cfg(debug_assertions)]
#[allow(dead_code)]
mod sync_bootstrap;

/// Embed `Microsoft.Windows.Common-Controls` v6 dependency into the
/// test binary's manifest via an MSVC `.drectve` linker directive
/// section.  Required by `WebView2Loader.dll` at startup, which the
/// test binary otherwise lacks (it bypasses `tauri-bundler`).
///
/// `/MANIFESTINPUT` causes `CVT1100: duplicate resource` on `[[bin]]`
/// test targets; `/MANIFESTDEPENDENCY` in `build.rs` fails with
/// `LNK1181` because Cargo splits the argument on spaces.  The
/// `.drectve` section injects the directives directly into the object
/// file, bypassing Cargo's argument parsing entirely.
///
/// See: https://github.com/orgs/tauri-apps/discussions/11179
///
/// **NOTE:** If you modify the byte string below, update the array size
/// (currently 168).  The compiler error message will report the exact
/// expected size if there's a mismatch.
#[cfg(all(test, windows, target_env = "msvc"))]
#[used]
#[unsafe(link_section = ".drectve")]
#[rustfmt::skip]
static TEST_MANIFEST_DIRECTIVES: [u8; 168] = *b" /MANIFESTDEPENDENCY:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"\x00";

use crate::error::AppError;
use crate::state::AppState;
use oz_security::mask::mask_token;
use tauri::{Emitter, Manager};

/// Application entry point, called by `main.rs`.
///
/// Initialises logging, loads the database, starts the sync daemon,
/// registers all Tauri commands, and starts the event loop. Mobile
/// builds use the same code via `#[cfg_attr(mobile, tauri::mobile_entry_point)]`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(deprecated)]
pub fn run() {
    // Initialise tokio-console before any other tracing setup.
    platform_startup::console::init_console_subscriber();

    // Initialise structured logging early so the very first line of Tauri
    // output is captured. Uses try_init so a second invocation (e.g.
    // by a plugin or test harness) does not panic.
    let _ = oz_logging::try_init();

    let result: Result<(), AppError> = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::new(app.handle())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            // ── Module system lifecycle (shared startup) ──────────────
            platform_startup::init_module_system(&state.kernel, &state.db_path)?;

            // ── settings_updated → Tauri event bridge (ADR #22 Phase 0e) ─
            // The frontend SettingsContext subscribes to `settings_updated`
            // and triggers a debounced scoped refetch. Without this the
            // SettingsUpdated handler only logs "settings_updated Tauri
            // bridge not yet wired" and settings changes never reach the
            // UI via the event bus (the save-handler markSettingsUpdated
            // path covers same-terminal saves; this closes the loop for
            // the EventBus-published events).
            let app_handle = app.handle().clone();
            platform_startup::event_handlers::set_settings_emit_fn(Box::new(
                move |event_name, payload| {
                    let _ = app_handle.emit(event_name, payload);
                },
            ));

            app.manage(state);

            // Recover a journaled cross-database topology Apply at startup,
            // before the user can issue another mutation. The Apply mutex
            // also serializes this recovery with any early UI request.
            let recovery_app_handle = app.handle().clone();
            platform_startup::spawn_daemon("topology recovery", async move {
                let state = recovery_app_handle.state::<AppState>();
                if let Err(error) = commands::topology::recover_pending_topology_apply_at_startup(&state).await {
                    tracing::error!(error = %error, "topology recovery failed; Apply remains blocked until recovery succeeds");
                }
            });

            // ── Hardware registry bootstrap ───────────────────────────
            // AppState builds an empty DriverRegistry; until this ran,
            // nothing ever registered into it, so receipt printing, KDS,
            // drawer and display commands all resolved None at runtime
            // while the setup wizard could still list devices.
            //
            // Config-driven only, on purpose. DriverRegistry::discover() is
            // deliberately not called here: it binds whatever is attached
            // under hardware-derived ids and opens serial and Bluetooth
            // ports nobody named, which is the same reason card terminals
            // stay out of discovery. An operator configures hardware on the
            // settings screen; this turns that into drivers.
            let hardware_app_handle = app.handle().clone();
            platform_startup::spawn_daemon("hardware bootstrap", async move {
                let state = hardware_app_handle.state::<AppState>();
                let registry = state.registry.clone();
                let base_dir = state
                    .db_path
                    .parent()
                    .unwrap_or(std::path::Path::new("."))
                    .to_path_buf();
                // Same resolution the settings screen uses, so the profile
                // this reads is the one the operator edits.
                let terminal_id = state
                    .terminal_id
                    .lock()
                    .await
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());
                let (profile, terminals) = {
                    let conn = state.db.lock().await;
                    let store = oz_core::db::Store::new(&conn);
                    (
                        platform_startup::hardware::load_profile(&conn, &terminal_id, &base_dir),
                        store.list_active_edc_terminals().unwrap_or_else(|e| {
                            tracing::warn!(
                                error = %e,
                                "could not read configured card terminals; \
                                 the card tender will fail closed"
                            );
                            Vec::new()
                        }),
                    )
                }; // Connection is !Send; the guard is dropped before any await.

                let mut report = match profile {
                    Some(profile) => {
                        platform_startup::hardware::register_hardware(&registry, &profile).await
                    }
                    None => {
                        tracing::info!(
                            terminal_id = %terminal_id,
                            "no hardware profile saved yet; nothing to register"
                        );
                        oz_hal::BootstrapReport::default()
                    }
                };
                let terminals =
                    platform_startup::hardware::register_card_terminals(&registry, &terminals).await;
                report.registered.extend(terminals.registered);
                report.skipped.extend(terminals.skipped);
                report.rejected.extend(terminals.rejected);

                tracing::info!(%report, "hardware registry bootstrap complete");
                for (id, reason) in &report.rejected {
                    tracing::warn!(
                        device = %id,
                        reason = %reason,
                        "configured device could not be registered"
                    );
                }
            });

            // ── Show the main window after state restore ────────────
            // The window starts with visible:false to prevent initial
            // position flash while window-state restores its position/size.
            // After setup completes we explicitly show it. If the window
            // is not found (e.g. headless/CI), this is a no-op.
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
            }

            // ── Auto-provision cloud sync (debug builds only) ────────
            // A fresh dev DB ships with an empty `sync_server_url` and sync
            // disabled, so the background daemon silently no-ops until the
            // user manually configures Settings → Sync. If the cloud server
            // (`https://license.ozpos.my.id`) is up, request a JWT and
            // persist the connection. Spawned BEFORE the sync daemon so the
            // daemon's first tick (60–120s out) sees the fresh config. Never
            // runs in release builds — an existing configuration is never
            // touched.
            #[cfg(debug_assertions)]
            {
                let bootstrap_db = app.state::<AppState>().db.clone();
                platform_startup::spawn_daemon("sync auto-provision", async move {
                    crate::sync_bootstrap::auto_provision_local_sync(bootstrap_db).await;
                });
            }

            // ── Background sync daemon ────────────────────────────────
            let db = app.state::<AppState>().db.clone();
            let app_handle = app.handle().clone();
            // SYNC-10: a settings change made on ANOTHER terminal and pulled
            // by either daemon is re-emitted as the `settings_updated` Tauri
            // event — the same wire shape the frontend SettingsContext
            // listens for — so the UI refetches the changed scope. Local
            // saves already publish the domain event; this closes the loop
            // for the sync-applied path. The sink is shared by the SQLite
            // and PostgreSQL daemons.
            let settings_sink = commands::sync::settings_changed_sink(&app_handle);
            let sqlite_sink = settings_sink.clone();
            let pg_sink = settings_sink.clone();
            platform_startup::spawn_daemon("sync daemon", async move {
                let state = app_handle.state::<AppState>();
                state
                    .sync_daemon
                    .start_with_sink(db, sqlite_sink)
                    .await;
            });

            // ── Background PostgreSQL sync daemon ─────────────────────
            // The optional PG transport. The daemon no-ops on every tick
            // while `pg_sync.enabled` is off and re-reads the connection
            // settings each cycle, so this unconditional spawn mirrors the
            // SQLite daemon's — the pg_sync_start / pg_sync_stop commands
            // control the same instance.
            let pg_db = app.state::<AppState>().db.clone();
            let pg_app_handle = app.handle().clone();
            platform_startup::spawn_daemon("pg sync daemon", async move {
                let state = pg_app_handle.state::<AppState>();
                state
                    .pg_sync_daemon
                    .start_with_sink(pg_db, pg_sink)
                    .await;
            });

            // ── Background prune daemon (ADR #6 Q4 / P-1 Ledger Retention) ─
            let prune_db = app.state::<AppState>().db.clone();
            platform_startup::spawn_daemon("prune daemon", async move {
                platform_sync::daemon::SyncDaemon::start_prune_task(prune_db);
            });

            // ── Background image push daemon (spec 0046b §3.6) ───────
            // Drains the local `image_push_queue` to the cloud batch
            // endpoint on a jittered cadence (60–300 s). No-ops until sync
            // is configured (SyncConfig::from_settings returns None) and
            // while the queue is empty.
            {
                let push_db = app.state::<AppState>().db.clone();
                let push_app_handle = app.handle().clone();
                platform_startup::spawn_daemon("image push", async move {
                    let cache_dir = push_app_handle
                        .path()
                        .app_cache_dir()
                        .unwrap_or_else(|e| {
                            tracing::warn!(error = %e, "image push: no app cache dir");
                            std::path::PathBuf::from(".")
                        });
                    let scheduler = crate::image_push::ImagePushScheduler::new(push_db, cache_dir);
                    scheduler.run().await;
                });
            }

            // ── Background email report scheduler ──────────────────
            let email_db = app.state::<AppState>().db.clone();
            platform_startup::spawn_daemon("email report scheduler", async move {
                crate::email_scheduler::run_scheduler_loop(email_db).await;
            });

            // ── Background session cleanup daemon (TTL expiry) ──────
            // Runs every 5 minutes to sweep expired sessions from the
            // in-memory store. Expired sessions are also caught during
            // resolve_session, so this is a safety net + memory reclaimer.
            {
                let session_store = app.state::<AppState>().session_store.clone();
                platform_startup::spawn_daemon("session cleanup", async move {
                    let mut interval = tokio::time::interval(
                        std::time::Duration::from_secs(300),
                    );
                    // Skip the first tick so startup isn't delayed.
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        let Ok(mut store) = session_store.write() else {
                            tracing::warn!(
                                "session store lock poisoned — skipping cleanup cycle"
                            );
                            continue;
                        };
                        let before = store.len();
                        store.retain(|token, ctx| {
                            if ctx.is_expired() {
                                tracing::trace!(
                                    token = %mask_token(token),
                                    "session cleanup: removing expired session"
                                );
                                false
                            } else {
                                true
                            }
                        });
                        let pruned = before - store.len();
                        if pruned > 0 {
                            tracing::info!(
                                "session cleanup: pruned {pruned} expired session(s), \
                                 {remaining} remain",
                                remaining = store.len()
                            );
                        }
                    }
                });
            }

            // ── KDS device health monitoring daemon ──────────────────
            // Runs every 60 seconds, per store database, to:
            // 1. Mark connected devices as stale if they haven't pinged recently
            // 2. Deactivate devices that have been stale for too long (24h)
            // 3. Prune old KDS orders in terminal states (30-day retention)
            //
            // KDS orders and devices live in PER-STORE databases
            // (db_manager.open_store), not in the global identity DB
            // (`AppState.db`) — cycling only over the global DB made this
            // whole daemon a silent no-op (its target tables were always
            // empty there). Iterate the manager's open store IDs instead;
            // the connection map grows as stores are opened, so only
            // databases that actually exist are touched.
            {
                let db_manager = app.state::<AppState>().db_manager.clone();
                platform_startup::spawn_daemon("kds health monitoring", async move {
                    let mut interval = tokio::time::interval(
                        std::time::Duration::from_secs(60),
                    );
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        for store_id in db_manager.open_store_ids() {
                            let Ok(conn) = db_manager.open_store(&store_id) else {
                                tracing::warn!(store_id, "kds health: store db unavailable");
                                continue;
                            };
                            let Ok(db) = conn.lock() else {
                                tracing::warn!(store_id, "kds health: store db lock poisoned");
                                continue;
                            };
                            let store = oz_core::db::Store::new(&db);
                            // 1. Mark stale devices (no ping in 30s).
                            if let Err(e) = store.mark_stale_kds_devices(30) {
                                tracing::warn!(error = %e, store_id, "kds health: mark_stale failed");
                            }
                            // 2. Deactivate long-offline devices (stale for 24h).
                            if let Err(e) = store.deactivate_stale_kds_devices(86400) {
                                tracing::warn!(error = %e, store_id, "kds health: deactivate_stale failed");
                            }
                            // 3. Prune old terminal-state orders (30-day retention).
                            if let Err(e) = store.cleanup_old_kds_orders(30) {
                                tracing::warn!(error = %e, store_id, "kds health: cleanup failed");
                            }
                        }
                    }
                });
            }

            // ── Memo expiry sweep daemon ───────────────────────────────
            // Runs every 5 minutes to transition published Memos past their
            // `expires_at` to `expired` — the domain's Published → Expired
            // edge — and then runs the two retention stages on the same tick:
            // ended Memos (`stopped`/`expired`) → `archived` (stamping
            // `archived_at`), and deletion of archives past the fixed 30-day
            // window (ruled 2026-09-07). The display read path already filters
            // by `expires_at`/status, so this is record hygiene: it makes
            // `expired`/`archived` live statuses rather than values that only
            // exist in the enum, keeps the partial `idx_memos_expiry`
            // (status='published') from accumulating stale rows, and enforces
            // the retention promise. Mirrors the session-cleanup and
            // KDS-retention daemons; operates on the global identity DB where
            // Memos live.
            {
                let db = app.state::<AppState>().db.clone();
                platform_startup::spawn_daemon("memo expiry sweep", async move {
                    let mut interval = tokio::time::interval(
                        std::time::Duration::from_secs(300),
                    );
                    // Skip the first tick so startup isn't delayed.
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        let now = chrono::Utc::now()
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        // Phase 1 — local sweeps + snapshot, under one lock
                        // acquisition with NO awaits inside the block: the
                        // `Store` borrow of the guard is not `Send`, so the
                        // guard must die here, lexically, before the HTTP
                        // await below.
                        let push_state = {
                            let conn = db.lock().await;
                            let store = oz_core::db::Store::new(&conn);
                            match store.sweep_all_expired(&now) {
                                Ok(n) if n > 0 => {
                                    tracing::info!("memo expiry sweep: expired {n} memo(s)")
                                }
                                Ok(_) => {}
                                Err(e) => tracing::warn!(error = %e, "memo expiry sweep failed"),
                            }
                            match store.sweep_ended_to_archived(&now) {
                                Ok(n) if n > 0 => {
                                    tracing::info!("memo retention sweep: archived {n} memo(s)")
                                }
                                Ok(_) => {}
                                Err(e) => {
                                    tracing::warn!(error = %e, "memo retention sweep failed")
                                }
                            }
                            match store.sweep_expired_archives(
                                &now,
                                oz_core::memo::RETENTION_WINDOW_DAYS,
                            ) {
                                Ok(n) if n > 0 => tracing::info!(
                                    "memo retention sweep: deleted {n} archived memo(s)"
                                ),
                                Ok(_) => {}
                                Err(e) => {
                                    tracing::warn!(error = %e, "memo retention delete failed")
                                }
                            }
                            // Cloud reconciliation (2026-09-07 cloud-read
                            // ruling): push the tenant's COMPLETE memo
                            // state — the cloud upserts and deletes by
                            // omission, so a previously failed push
                            // self-corrects on this tick. Best-effort: a
                            // failure only logs; the next tick re-pushes.
                            match oz_core::sync_client::SyncConfig::from_settings(&store) {
                                Ok(Some(config)) => match store.collect_memo_sync_snapshot() {
                                    Ok(snapshot) => Some((config, snapshot)),
                                    Err(e) => {
                                        tracing::warn!(error = %e, "memo snapshot failed");
                                        None
                                    }
                                },
                                Ok(None) => None,
                                Err(e) => {
                                    tracing::warn!(error = %e, "memo sync config read failed");
                                    None
                                }
                            }
                        };
                        // Phase 2 — HTTP push, no lock or borrow held.
                        if let Some((config, snapshot)) = push_state {
                            let ack =
                                oz_core::sync_client::push_memos_to_server(&config, &snapshot)
                                    .await;
                            match ack {
                                Ok(ack) if ack.upserted > 0 || ack.deleted > 0 => {
                                    tracing::info!(
                                        "memo cloud push: {} upserted, {} deleted",
                                        ack.upserted,
                                        ack.deleted
                                    )
                                }
                                Ok(_) => {}
                                Err(e) => tracing::warn!(
                                    error = %e,
                                    "memo cloud push failed (retries next tick)"
                                ),
                            }
                        }
                    }
                });
            }

            // ── Topology revision retention (ADR #46 §4) ───────────────
            // Deflates restorable snapshots beyond the newest
            // TOPOLOGY_REVISION_RESTORABLE_KEEP per branch while keeping every
            // row's who/when/why. Shape copied from the memo expiry sweep
            // above, for two reasons that are not interchangeable:
            //
            // - `state.db` is the GLOBAL database, which is where
            //   topology_revisions lives, keyed by branch_id. The kds health
            //   loop walks per-store databases via open_store_ids() and is the
            //   wrong handle for this table.
            // - 300s is already generous for a configuration table pruned a few
            //   times a month; startup-only pruning would be worse still, since
            //   a desktop app may run for weeks without restarting.
            {
                let db = app.state::<AppState>().db.clone();
                platform_startup::spawn_daemon(
                    "topology revision retention",
                    async move {
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(300));
                        // Skip the first tick so startup isn't delayed.
                        interval.tick().await;
                        loop {
                            interval.tick().await;
                            let conn = db.lock().await;
                            match commands::topology::cleanup_old_topology_revisions(
                                &conn,
                                commands::topology::TOPOLOGY_REVISION_RESTORABLE_KEEP,
                            ) {
                                Ok(n) if n > 0 => tracing::info!(
                                    "topology revision retention: deflated {n} snapshot(s)"
                                ),
                                Ok(_) => {}
                                Err(e) => tracing::warn!(
                                    error = %e,
                                    "topology revision retention sweep failed"
                                ),
                            }
                        }
                    },
                );
            }

            // ── Audit retention sweep daemon (todo-global-saas-2.md P1) ─
            // Enforces the adopted tier schedule (Free purge-all, Plus 90d,
            // Pro 180d, Premium 1y, Enterprise 3y default) on every DB that
            // carries an audit_log table: the GLOBAL database (Memos-adjacent
            // system events, api.write entries, sale/stock/product events from
            // the module handlers) AND each open per-store database (the
            // store-scoped entries the audit screen reads). Every 15 minutes —
            // audit rows expire on day boundaries, so 5-minute sweeps would
            // buy nothing. Same std-sync Mutex discipline as the KDS health
            // daemon: the guard lives only inside a lexical block.
            //
            // Fail-closed asymmetry: an unreadable/tampered subscription row
            // SKIPS the tick (a purge triggered by corrupted data would be
            // irreversible; a skipped sweep just delays deletion to a later
            // tick), while a validly-signed Free row purges everything.
            {
                let db = app.state::<AppState>().db.clone();
                let db_manager = app.state::<AppState>().db_manager.clone();
                platform_startup::spawn_daemon("audit retention sweep", async move {
                    let mut interval =
                        tokio::time::interval(std::time::Duration::from_secs(900));
                    // Skip the first tick so startup isn't delayed.
                    interval.tick().await;
                    loop {
                        interval.tick().await;
                        let now = chrono::Utc::now()
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        // Resolve the tier ONCE per tick from the global DB,
                        // the same read model the caps command projects from.
                        // NOT fail-closed here, deliberately inverted: a
                        // missing/tampered/unreadable row (`loaded == false`)
                        // SKIPS the whole tick, because the fail-closed
                        // projection is Free and a purge triggered by
                        // corrupted data would be irreversible — a skipped
                        // sweep only delays deletion to a later tick. A
                        // validly-signed Free row purges, as the schedule
                        // demands. debug_upgrade is false: the dev Free→Premium
                        // promotion must never widen a purge.
                        let tier = {
                            let conn = db.lock().await;
                            let store = oz_core::db::Store::new(&conn);
                            let ent = oz_core::entitlements::build_entitlements(
                                &store,
                                oz_core::availability::UsageCounts::default(),
                                false,
                            );
                            if !ent.loaded {
                                None
                            } else {
                                Some(ent.tier)
                            }
                        };
                        let Some(tier) = tier else {
                            tracing::warn!(
                                "audit retention sweep: no valid subscription row — skipping tick (fail-closed)"
                            );
                            continue;
                        };
                        // Global DB first…
                        {
                            let conn = db.lock().await;
                            let store = oz_core::db::Store::new(&conn);
                            match store.sweep_audit_retention(&tier, &now) {
                                Ok(n) if n > 0 => tracing::info!(
                                    "audit retention sweep (global): deleted {n} expired audit row(s) (tier: {})",
                                    tier.name()
                                ),
                                Ok(_) => {}
                                Err(e) => tracing::warn!(
                                    error = %e,
                                    "audit retention sweep (global) failed"
                                ),
                            }
                        }
                        // …then every open per-store DB (the audit screen's
                        // rows live there; closed stores are swept on open by
                        // the next tick after re-open).
                        for store_id in db_manager.open_store_ids() {
                            let Ok(conn) = db_manager.open_store(&store_id) else {
                                tracing::warn!(store_id, "audit retention sweep: store db unavailable");
                                continue;
                            };
                            let Ok(db) = conn.lock() else {
                                tracing::warn!(store_id, "audit retention sweep: store db lock poisoned");
                                continue;
                            };
                            let store = oz_core::db::Store::new(&db);
                            match store.sweep_audit_retention(&tier, &now) {
                                Ok(n) if n > 0 => tracing::info!(
                                    store_id,
                                    "audit retention sweep: deleted {n} expired audit row(s) (tier: {})",
                                    tier.name()
                                ),
                                Ok(_) => {}
                                Err(e) => tracing::warn!(
                                    error = %e, store_id,
                                    "audit retention sweep failed"
                                ),
                            }
                        }
                    }
                });
            }

            // ── LAN event forwarder ────────────────────────────────────
            // Read LAN server config from the settings table (C-4).
            // Default: loopback-only, no PSK. External bind requires
            // both lan_server.bind="0.0.0.0" AND a non-empty lan_server.psk.
            let (lan_bind_addr, lan_psk) = {
                let state = app.state::<AppState>();
                let db = state.db.blocking_lock();
                let bind = oz_core::Settings::get(&db, "lan_server.bind")
                    .unwrap_or(None)
                    .unwrap_or_else(|| "127.0.0.1".to_string());
                let psk = oz_core::Settings::get(&db, "lan_server.psk")
                    .unwrap_or(None)
                    .filter(|s| !s.is_empty());
                // Reject external bind without a PSK.
                let bind = if bind == "0.0.0.0" && psk.is_none() {
                    tracing::warn!(
                        "lan_server.bind is 0.0.0.0 but lan_server.psk is empty — falling back to 127.0.0.1"
                    );
                    "127.0.0.1".to_string()
                } else {
                    bind
                };
                (format!("{bind}:9180"), psk)
            };
            let forwarder = crate::lan_server::LanEventForwarder::new(lan_bind_addr, lan_psk);
            let handle = forwarder.handle();
            platform_startup::spawn_daemon("LAN event forwarder", forwarder.run());

            // Subscribe event bus handlers for LAN forwarding.
            // .setup() is synchronous, so we can't use .await.
            // A single try_lock() could silently skip LAN handler
            // registration if the kernel lock is momentarily held
            // during startup. Use a bounded retry loop to give the
            // lock holder time to finish without risking a deadlock.
            const LAN_LOCK_RETRIES: usize = 10;
            {
                let state = app.state::<AppState>();
                let mut registered = false;
                for _ in 0..LAN_LOCK_RETRIES {
                    if let Ok(kernel) = state.kernel.try_lock() {
                        let bus = kernel.event_bus();
                        bus.subscribe(
                            "sale.completed",
                            Box::new(handle.sale_completed_handler()),
                        );
                        bus.subscribe(
                            "order.course_fired",
                            Box::new(handle.course_fired_handler()),
                        );
                        tracing::info!(
                            "LAN event forwarder handlers registered for sale.completed and order.course_fired"
                        );
                        registered = true;
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                if !registered {
                    tracing::warn!(
                        "kernel lock contended after 100ms, LAN handlers not registered — \
                         LAN event forwarding disabled for this session"
                    );
                }
            }

            // ── Local REST API server (loopback, default off) ─────────
            // Auto-start when the merchant enabled it in Settings
            // (`local_api.enabled = "1"`). A bind failure (port taken)
            // is logged and skipped — the Settings toggle retries on
            // demand. Loopback-only: LAN exposure is out of scope for
            // this surface (docs/guides/EXTENDING.md §10).
            {
                let enabled_at_boot = {
                    let state = app.state::<AppState>();
                    let db_guard = state.db.blocking_lock();
                    crate::local_api::is_enabled(&db_guard)
                };
                if enabled_at_boot {
                    let app_handle = app.handle().clone();
                    platform_startup::spawn_daemon("local API server", async move {
                        let state = app_handle.state::<AppState>();
                        // Serialize with the Settings toggles (review
                        // HIGH-2) and re-read the setting UNDER the op
                        // lock: a disable that landed while we queued
                        // must win, and a concurrent enable that already
                        // bound must not be raced.
                        let _op = state.local_api_op.lock().await;
                        if state.local_api.lock().await.is_some() {
                            return; // the toggle path won the race
                        }
                        let still_enabled = {
                            let db = state.db.lock().await;
                            crate::local_api::is_enabled(&db)
                        };
                        if !still_enabled {
                            return; // disabled while we queued for the lock
                        }
                        let image_dir = match app_handle.path().app_cache_dir() {
                            Ok(dir) => dir.join("images"),
                            Err(e) => {
                                tracing::warn!(
                                    error = %e,
                                    "local API auto-start: cannot resolve app cache dir"
                                );
                                return;
                            }
                        };
                        // Same code path as the Settings toggle (secret
                        // generation, store resolution, bind, slot
                        // store) — no parallel logic to drift apart.
                        if let Err(e) =
                            crate::commands::local_api::start_and_store(&state, image_dir, 0).await
                        {
                            tracing::warn!(
                                error = %e,
                                "local API auto-start failed — enable it again in Settings"
                            );
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::audit::list_audit_log_scoped,
            commands::audit::get_audit_review_status_scoped,
            commands::audit::mark_audit_reviewed_scoped,
            commands::audit::export_audit_log_scoped,
            // Security-event CSV export (owner ruling D61-7): AUD-09
            // narrowed to SECURITY_ACTIONS, reading the SAME global
            // identity DB as the trail read below.
            commands::audit::export_security_events_scoped,
            // Organization-level security trail from the global identity DB
            // (todo-global-saas-2.md P1). Reads a DIFFERENT file than the
            // store-scoped audit list above — see the command doc.
            commands::audit::list_security_events_scoped,
            commands::auth::staff_login,
            commands::auth::staff_check_username,
            commands::auth::has_users,
            commands::auth::create_session,
            commands::auth::destroy_session,
            commands::auth::session_keepalive,
            commands::auth::verify_pin,
            commands::auth::refresh_picker_ticket,
            commands::auth::impersonate_user_scoped,
            // SaaS-3 L194: multi-organization user switching.
            commands::auth::list_organizations,
            commands::auth::switch_organization,
            commands::branding::get_brand_settings_scoped,
            commands::branding::get_brand_settings,
            commands::branding::pick_logo_file,
            commands::branding::pick_logo_file_scoped,
            commands::customers::list_customers_scoped,
            commands::customers::search_customers_scoped,
            commands::customers::get_customer_history_scoped,
            commands::customers::create_customer_scoped,
            commands::customers::update_customer_scoped,
            commands::customers::delete_customer_scoped,
            commands::loyalty::get_loyalty_account_scoped,
            commands::loyalty::list_loyalty_accounts_scoped,
            commands::loyalty::earn_loyalty_points_scoped,
            commands::loyalty::redeem_loyalty_points_scoped,
            commands::loyalty::list_loyalty_tiers_scoped,
            commands::loyalty::update_loyalty_tier_scoped,
            commands::loyalty::get_points_value_scoped,
            commands::loyalty::get_or_create_loyalty_account_scoped,
            commands::local_api::local_api_status_scoped,
            commands::local_api::local_api_set_enabled_scoped,
            commands::local_api::local_api_set_port_scoped,
            commands::local_api::local_api_set_store_scoped,
            commands::local_api::local_api_rotate_secret_scoped,
            commands::local_api::local_api_mint_token_scoped,
            commands::data::get_backup_status,
            commands::data::get_backup_status_scoped,
            commands::data::create_backup,
            commands::data::create_backup_scoped,
            commands::data::export_data,
            commands::data::import_preview,
            commands::email::send_test_report,
            commands::email::get_report_schedule,
            commands::email::get_report_schedule_scoped,
            commands::email::save_report_schedule,
            commands::edc::edc_terminal_status,
            commands::edc::edc_terminal_status_scoped,
            commands::edc::edc_sale,
            commands::edc::edc_refund,
            commands::edc::edc_void,
            commands::data::import_data,
            commands::staff::list_staff_scoped,
            commands::staff::list_roles_scoped,
            commands::staff::list_permission_keys_scoped,
            commands::staff::create_role_scoped,
            commands::staff::update_role_scoped,
            commands::staff::delete_role_scoped,
            commands::staff::list_role_holders_scoped,
            commands::staff::create_staff_scoped,
            commands::staff::update_staff_scoped,
            commands::staff::get_staff_profile_scoped,
            commands::staff::bootstrap_owner,
            commands::categories::list_categories_scoped,
            commands::categories::create_category_scoped,
            commands::categories::update_category_scoped,
            commands::categories::delete_category_scoped,
            commands::currencies::currency_info,
            commands::currencies::currency_info_scoped,
            commands::currencies::list_currencies_scoped,
            // Bootstrap: get_default_currency/set_default_currency are
            // pre-session commands — CurrencyProvider sits above
            // AuthProvider/WorkspaceProvider and has no session token.
            commands::currencies::get_default_currency,
            commands::currencies::get_default_currency_scoped,
            commands::currencies::set_default_currency,
            commands::currencies::set_default_currency_scoped,
            commands::exchange_rates::list_exchange_rates_scoped,
            commands::exchange_rates::list_latest_exchange_rates_scoped,
            commands::exchange_rates::create_exchange_rate_scoped,
            commands::exchange_rates::delete_exchange_rate_scoped,
            commands::exchange_rates::get_latest_exchange_rate_scoped,
            commands::features::list_all_features,
            commands::features::list_all_features_scoped,
            commands::features::set_features_bulk,
            commands::features::set_feature,
            commands::inventory_counts::create_stock_count_scoped,
            commands::inventory_counts::get_stock_count_scoped,
            commands::inventory_counts::list_stock_counts_scoped,
            commands::inventory_counts::get_count_lines_scoped,
            commands::inventory_counts::add_count_line_scoped,
            commands::inventory_counts::update_count_line_scoped,
            commands::inventory_counts::remove_count_line_scoped,
            commands::inventory_counts::complete_stock_count_scoped,
            commands::inventory_counts::update_stock_count_status_scoped,
            commands::inventory_counts::list_stock_adjustments_scoped,
            commands::stock_transfers::create_stock_transfer_scoped,
            commands::stock_transfers::get_stock_transfer_scoped,
            commands::stock_transfers::list_stock_transfers_scoped,
            commands::stock_transfers::list_in_transit_transfers_scoped,
            commands::stock_transfers::get_stock_transfer_lines_scoped,
            commands::stock_transfers::add_stock_transfer_line_scoped,
            commands::stock_transfers::remove_stock_transfer_line_scoped,
            commands::stock_transfers::send_stock_transfer_scoped,
            commands::stock_transfers::receive_stock_transfer_scoped,
            commands::stock_transfers::cancel_stock_transfer_scoped,
            commands::health::ping,
            commands::health::ping_scoped,
            // `version` was the only health command registered without its ambient twin: every
            // pair above and below is `x` + `x_scoped`. The UI calls `version` from four sites
            // (useVersionStatus, UpdateBanner, LicenseActivationScreen, SessionLockScreen), so on
            // desktop it threw "command not found" -- useVersionStatus caught that and displayed
            // the app version as 0.0.0, while UpdateBanner's throw aborted the same try block that
            // decides whether to show the rollback-recovery banner, so that feature never fired.
            // tablet-client has registered `version` all along (lib.rs:409).
            commands::health::version,
            commands::health::version_scoped,
            commands::health::get_device_id,
            commands::health::get_device_id_scoped,
            commands::health::get_local_ip,
            commands::health::get_local_ip_scoped,
            commands::pos::start_sale_scoped,
            commands::pos::add_line_scoped,
            commands::pos::preview_promoted_total_scoped,
            commands::pos::preview_promoted_total_from_lines_scoped,
            commands::pos::complete_sale_scoped,
            commands::pos::complete_sale_with_resolved_shortfalls_scoped,
            commands::pos::set_cart_discount_scoped,
            commands::pos::override_line_price_scoped,
            commands::pos::override_cart_deduction_location_scoped,
            commands::pos::hold_cart_scoped,
            commands::pos::list_held_carts_scoped,
            commands::pos::list_open_bills_scoped,
            commands::pos::get_held_cart_scoped,
            commands::pos::compute_cart_tax_scoped,
            commands::pos::delete_held_cart_scoped,
            commands::inventory::create_inventory_location,
            commands::inventory::list_inventory_locations,
            commands::inventory::update_inventory_location,
            commands::inventory::deactivate_inventory_location,
            commands::inventory::set_workspace_inventory_locations,
            commands::inventory::get_workspace_inventory_locations,
            commands::inventory::start_inventory_shift,
            commands::inventory::end_inventory_shift,
            commands::inventory::get_active_inventory_shift,
            commands::inventory::list_inventory_shifts,
            commands::inventory::create_inventory_transaction,
            commands::inventory::list_inventory_transactions,
            commands::inventory::list_inventory_transactions_for_shift,
            commands::inventory::get_inventory_transaction,
            commands::inventory::set_stock_threshold,
            commands::inventory::get_stock_thresholds,
            commands::inventory::delete_stock_threshold,
            commands::inventory::active_stock_alerts_scoped,
            commands::inventory::acknowledge_stock_alert_scoped,
            commands::inventory::finalize_sale,
            commands::inventory::void_pending_sale,
            commands::inventory::get_low_stock_alerts_at_location_scoped,
            commands::inventory::get_workspace_locations_scoped,
            commands::inventory::invalidate_location_cache_scoped,
            commands::kds::list_kds_orders_scoped,
            commands::kds::get_kds_queue_scoped,
            commands::kds::update_kds_status_scoped,
            commands::kds::create_kds_order_from_sale_scoped,
            commands::kds::get_kds_order_scoped,
            commands::kds::get_kds_order_lines_scoped,
            commands::kds::update_kds_line_item_status_scoped,
            commands::kds::update_kds_order_items_scoped,
            commands::kds::print_kds_chit_scoped,
            commands::kds_device::register_kds_device_scoped,
            commands::kds_device::list_kds_devices_scoped,
            commands::kds_device::get_kds_device_scoped,
            commands::kds_device::update_kds_device_status_scoped,
            commands::kds_device::deactivate_kds_device_scoped,
            commands::kds_device::ack_kds_order_scoped,
            commands::kds_routing::resolve_kds_targets_scoped,
            commands::history::list_sales_scoped,
            commands::history::get_sale_scoped,
            commands::history::export_daily_summary_scoped,
            commands::history::export_sales_by_hour_scoped,
            commands::history::export_eod_report_scoped,
            commands::void::void_sale_scoped,
            commands::hardware::print_sales_receipt_scoped,
            commands::fiscal::get_document_number_sequence_scoped,
            commands::fiscal::upsert_document_number_sequence_scoped,
            commands::fiscal::list_document_number_sequences_scoped,
            commands::fiscal::list_document_number_sequences_for_entity_scoped,
            commands::fiscal::list_fiscal_schemes_scoped,
            commands::settings::get_receipt_settings_scoped,
            commands::settings::set_receipt_settings_scoped,
            commands::settings::get_store_settings_scoped,
            commands::settings::set_store_settings_scoped,
            commands::settings::set_credit_settings_scoped,
            commands::settings::list_credit_sales_scoped,
            commands::settings::settle_credit_scoped,
            commands::settings::set_hardware_settings_scoped,
            commands::settings::get_user_preferences_scoped,
            commands::settings::set_user_preferences_scoped,
            commands::settings::set_setting_scoped,
            commands::settings::set_settings_scoped,
            commands::settings::get_deployment_info,
            // Unscoped settings access for pre-login IPC callers (updater
            // banner, cloud-sync token, gateway status) — mirrors the tablet
            // registration; see review finding F-004.
            commands::settings::set_setting,
            commands::setup::get_enabled_features,
            commands::setup::complete_setup,
            commands::setup::dismiss_setup_wizard,
            commands::products::list_products_scoped,
            commands::products::list_warehouse_products_at_location,
            commands::products::create_product_scoped,
            commands::products::update_product_scoped,
            commands::products::delete_product_scoped,
            commands::products::lookup_by_barcode_scoped,
            commands::products::lookup_product_by_sku_scoped,
            commands::products::adjust_stock_scoped,
            commands::products::get_product_track_serial_scoped,
            commands::products::get_product_track_serial_batch_scoped,
            commands::products::record_product_search_scoped,
            commands::products_images::products_set_image_scoped,
            commands::products_images::products_clear_image_scoped,
            commands::products_images::products_list_images_scoped,
            commands::browser::open_product_images_scoped,
            commands::promotions::list_promotions_scoped,
            commands::promotions::get_promotion_scoped,
            commands::promotions::create_promotion_scoped,
            commands::promotions::update_promotion_scoped,
            commands::promotions::delete_promotion_scoped,
            commands::promotions::apply_promotion_scoped,
            commands::promotions::get_sale_promotions_scoped,
            commands::setup::seed_default_roles_scoped,
            commands::setup::get_setup_status,
            commands::tax::list_tax_rates_scoped,
            commands::tax::list_tax_rate_rounding_modes_scoped,
            commands::tax::create_tax_rate_scoped,
            commands::tax::update_tax_rate_scoped,
            commands::tax::delete_tax_rate_scoped,
            commands::tax::get_tax_rate_dependency_counts_scoped,
            commands::tax::list_category_tax_rates_scoped,
            commands::tax::set_category_tax_rates_scoped,
            // Legacy unscoped terminal commands (L-1): intentionally not
            // registered. All production calls use the authenticated
            // session-token-scoped variants below (ADR #7).
            commands::terminals::list_terminals_scoped,
            commands::terminals::get_terminal_scoped,
            commands::terminals::register_terminal_scoped,
            commands::terminals::update_terminal_scoped,
            commands::terminals::ping_terminal_scoped,
            commands::terminals::delete_terminal_scoped,
            commands::terminals::list_terminal_overrides_scoped,
            commands::terminals::set_terminal_override_scoped,
            commands::terminals::delete_terminal_override_scoped,
            commands::terminals::set_device_binding_scoped,
            commands::terminals::get_device_binding_scoped,
            commands::terminals::clear_device_binding_scoped,
            commands::terminals::get_terminal_profile_scoped,
            commands::terminals::set_terminal_profile_scoped,
            commands::terminals::list_terminal_profiles_scoped,
            commands::terminals::delete_terminal_profile_scoped,
            commands::sync::get_sync_settings_scoped,
            commands::refunds::process_refund_scoped,
            commands::refunds::list_refunds_scoped,
            commands::refunds::lookup_sale_by_receipt_barcode_scoped,
            commands::reports::get_menu_engineering_scoped,
            commands::reports::get_sale_line_margins_scoped,
            commands::reports::get_daily_revenue_scoped,
            commands::reports::get_weekly_revenue_scoped,
            commands::reports::get_monthly_revenue_scoped,
            commands::reports::get_top_products_scoped,
            commands::reports::get_category_popularity_scoped,
            commands::reports::get_category_popularity_trend_scoped,
            commands::reports::get_category_forecast_scoped,
            commands::reports::get_hourly_heatmap_scoped,
            commands::reports::get_low_stock_alerts_scoped,
            commands::reports::get_category_breakdown_scoped,
            commands::reports::get_payment_method_breakdown_scoped,
            commands::reports::get_voided_sales_summary_scoped,
            commands::reports::get_voided_items_scoped,
            commands::reports::get_basket_size_scoped,
            commands::reports::get_basket_size_trend_scoped,
            commands::reports::get_customer_split_scoped,
            commands::reports::get_discounts_summary_scoped,
            commands::reports::get_inventory_turnover_scoped,
            commands::reports::get_inventory_trend_scoped,
            commands::reports::get_table_turnover_scoped,
            commands::reports::get_hourly_occupancy_scoped,
            commands::reports::build_custom_report_scoped,
            commands::analytics::get_staff_analytics_scoped,
            commands::analytics::get_staff_analytics_daily_scoped,
            commands::security::get_key_rotation_info,
            commands::security::get_key_rotation_info_scoped,
            commands::security::rotate_encryption_key,
            commands::security::rotate_encryption_key_scoped,
            commands::shifts::open_shift_scoped,
            commands::shifts::close_shift_scoped,
            commands::shifts::get_active_shift_scoped,
            commands::shifts::list_shifts_scoped,
            commands::tables::list_tables_scoped,
            commands::tables::get_table_scoped,
            commands::tables::create_table_scoped,
            commands::tables::update_table_scoped,
            commands::tables::delete_table_scoped,
            commands::tables::update_table_status_scoped,
            commands::tables::assign_table_order_scoped,
            commands::tables::release_table_scoped,
            commands::tables::list_sections_scoped,
            commands::workspaces::list_workspaces,
            commands::workspaces::list_workspace_screens,
            commands::workspaces::list_workspaces_scoped,
            commands::workspaces::list_workspaces_for_store_scoped,
            commands::workspaces::get_workspace_instance_scoped,
            commands::workspaces::create_workspace_instance_scoped,
            commands::workspaces::update_workspace_instance_scoped,
            commands::workspaces::archive_workspace_instance_scoped,
            commands::workspaces::recover_workspace_instances_scoped,
            commands::workspaces::suspend_surplus_workspace_instances_scoped,
            commands::workspaces::list_all_workspaces_scoped,
            commands::workspaces::set_user_workspace_instances_scoped,
            commands::workspaces::get_user_workspace_instances_scoped,
            commands::workspaces::resolve_boot_store,
            commands::workspaces::list_workspace_screens_scoped,
            commands::license::activate_license,
            commands::license::get_machine_id,
            commands::license::get_machine_id_scoped,
            commands::license::get_hardware_fingerprint,
            commands::license::get_hardware_fingerprint_scoped,
            commands::license::renew_license,
            commands::license::renew_license_scoped,
            commands::license::pause_subscription,
            commands::license::pause_subscription_scoped,
            commands::license::resume_subscription,
            commands::license::resume_subscription_scoped,
            commands::license::get_license_status,
            commands::license::get_license_status_scoped,
            commands::license::check_license_status,
            commands::license::check_license_status_scoped,
            commands::license::test_auth_connection,
            commands::license::test_auth_connection_scoped,
            commands::subscription::get_subscription_capabilities,
            commands::subscription::explain_feature_availability_scoped,
            commands::subscription::get_over_quota_report,
            commands::subscription::get_over_quota_report_scoped,
            // The legacy unscoped save_topology command is intentionally not
            // registered. All production writes use the authenticated,
            // revision-aware apply_topology_diff command.
            commands::topology::load_topology,
            commands::topology::can_save_topology,
            commands::topology::apply_topology_diff,
            // ADR #46 §1/§8 — read-only deploy history. Both gated on
            // `audit:view` (who changed this, when, and why — the audit
            // screen's own question), and both read the GLOBAL database,
            // where topology_revisions lives beside the graph it describes.
            commands::topology::list_topology_revisions,
            commands::topology::load_topology_revision,
            // ADR #46 §4: the pin that makes a revision a protected deploy.
            // Gated on topology:write, unlike the two readers above.
            commands::topology::pin_topology_revision,
            // ADR #45 §4.2 — diagram templates, persisted per branch in the
            // same settings namespace as the graph they seed.
            commands::topology::save_topology_template,
            commands::topology::load_topology_template,
            commands::topology::list_topology_templates,
            commands::topology::delete_topology_template,
            // ── Newly registered scoped variants (H-1/H-2 remediation) ──
            commands::branding::set_brand_primary_colour_scoped,
            commands::branding::set_brand_store_name_scoped,
            commands::bundles::list_bundles_scoped,
            commands::bundles::get_bundle_scoped,
            commands::bundles::update_bundle_scoped,
            commands::bundles::delete_bundle_scoped,
            commands::bundles::lookup_bundle_by_sku_scoped,
            commands::customers::get_customer_scoped,
            commands::gift_cards::issue_gift_card_scoped,
            commands::gift_cards::get_gift_card_scoped,
            commands::gift_cards::list_gift_cards_scoped,
            commands::gift_cards::get_gift_card_balance_scoped,
            commands::gift_cards::redeem_gift_card_scoped,
            commands::gift_cards::top_up_gift_card_scoped,
            commands::gift_cards::freeze_gift_card_scoped,
            commands::gift_cards::unfreeze_gift_card_scoped,
            commands::offline::enqueue_offline_scoped,
            commands::offline::list_pending_offline_scoped,
            commands::offline::list_all_offline_scoped,
            commands::offline::offline_queue_status_summary_scoped,
            commands::offline::pending_offline_count_scoped,
            commands::offline::retry_offline_sync_scoped,
            commands::offline::delete_offline_item_scoped,
            commands::offline::requeue_remote_failure_scoped,
            commands::offline::list_remote_failures_scoped,
            commands::pos::get_cart_deduction_location_scoped,
            commands::product_variants::list_product_variants_scoped,
            commands::product_variants::get_product_variant_scoped,
            commands::product_variants::delete_product_variant_scoped,
            commands::settings::get_credit_settings_scoped,
            commands::settings::get_setting_scoped,
            commands::settings::get_setting,
            commands::settings::gateway_status,
            commands::shifts::get_shift_scoped,
            commands::shifts::create_cash_payout_scoped,
            commands::shifts::get_shift_report_scoped,
            commands::legal_entities::list_legal_entities_scoped,
            commands::legal_entities::get_legal_entity_scoped,
            commands::legal_entities::create_legal_entity_scoped,
            commands::legal_entities::update_legal_entity_scoped,
            commands::memo::create_memo_scoped,
            commands::memo::publish_memo_scoped,
            commands::memo::stop_memo_scoped,
            commands::memo::revise_memo_scoped,
            commands::memo::list_active_memos_scoped,
            commands::memo::acknowledge_memo_scoped,
            commands::memo::list_authored_memos_scoped,
            commands::payables::list_payables_scoped,
            commands::payables::create_payable_scoped,
            commands::payables::record_payable_payment_scoped,
            commands::payables::write_off_payable_scoped,
            commands::locations::list_locations_scoped,
            commands::locations::get_location_profile_scoped,
            commands::locations::get_primary_location_scoped,
            commands::locations::create_location_profile_scoped,
            commands::locations::update_location_profile_scoped,
            commands::locations::set_primary_location_scoped,
            commands::locations::delete_location_profile_scoped,
            commands::locations::get_location_ticket_prefix_scoped,
            commands::locations::set_location_ticket_prefix_scoped,
            // Regional configuration read model (slice 2, saas-2 design).
            commands::regional::get_regional_config_scoped,
            // Regional configuration write path (slice 3, saas-2 design).
            commands::regional::set_regional_config_scoped,
            // Local payment methods (slice 6, saas-2 design).
            commands::local_payment::get_local_payment_methods_scoped,
            commands::local_payment::set_local_payment_methods_scoped,
            // Receipt format (receipt-format axis, saas-2 design).
            commands::receipt_format::get_receipt_format_scoped,
            commands::receipt_format::set_receipt_layout_scoped,
            commands::receipt_format::set_receipt_content_scoped,
            // ── Hardware, scale, branding, product variants, bundles (H-1) ──
            commands::hardware::open_cash_drawer_scoped,
            commands::hardware::print_receipt_scoped,
            commands::hardware::list_scanners_scoped,
            commands::hardware::start_scanner_scoped,
            commands::hardware::stop_scanner_scoped,
            commands::hardware::list_displays_scoped,
            commands::hardware::display_show_scoped,
            commands::hardware::discover_hardware_scoped,
            commands::hardware::display_clear_scoped,
            commands::scale::read_scale_weight_scoped,
            commands::scale::list_scale_devices_scoped,
            commands::branding::set_brand_logo_path_scoped,
            commands::product_variants::create_product_variant_scoped,
            commands::product_variants::update_product_variant_scoped,
            commands::bundles::create_bundle_scoped,
            // ── Sync scoped variants (H-1 full coverage) ──
            commands::sync::update_sync_settings_scoped,
            commands::sync::get_pg_sync_settings_scoped,
            commands::sync::update_pg_sync_settings_scoped,
            commands::sync::pg_sync_status_scoped,
            commands::sync::pg_sync_start_scoped,
            commands::sync::pg_sync_stop_scoped,
            commands::sync::pending_sync_count_scoped,
            commands::sync::request_sync_token_scoped,
            commands::sync::get_sync_plan_scoped,
            commands::sync::test_sync_connection,
            commands::sync::test_sync_connection_scoped,
            commands::sync::sync_run_scoped,
            commands::sync::sync_pull_scoped,
            commands::sync::settings_changed_sink_scoped,
            commands::settings::get_hardware_settings_scoped,
            commands::purchasing::list_suppliers_scoped,
            commands::purchasing::get_supplier_scoped,
            commands::purchasing::create_supplier_scoped,
            commands::purchasing::update_supplier_scoped,
            commands::purchasing::list_purchase_orders_scoped,
            commands::purchasing::get_purchase_order_scoped,
            commands::purchasing::create_purchase_order_scoped,
            commands::purchasing::update_po_status_scoped,
            commands::purchasing::receive_purchase_order_scoped,
            commands::purchasing::receive_purchase_order_with_lines_scoped,
        ])
        .run(tauri::generate_context!())
        .map_err(AppError::from);

    tracing::info!("application shutting down");
    // Kernel shutdown happens in AppState::drop() — see state.rs.

    if let Err(e) = result {
        tracing::error!(error = %e, "OZ-POS exited with error");
        std::process::exit(1);
    }
}
