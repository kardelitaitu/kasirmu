/*
last audited 25-07-26 by RSA-Agent (mobile-tauri slice A: verified)
crate: kasirmu-mobile | status: SAFE | lint: CLEAN
findings: clean — matches desktop-tauri guarded patterns. Coverage note: verified under the risk-ranked sampling protocol (global sweep clean), not line-by-line deep read
next: none | perf: N/A
*/
//! OZ-POS tablet shell (Tauri v2 mobile).
//!
//! Registers the same business modules as the desktop client but
//! with a mobile-optimised Tauri configuration (no window, touch
//! gestures, mobile plugins).
//!
//! The heavy lifting (DB, commands, event handlers) is delegated to
//! the shared crates (`kasirmu-core`, `platform-kernel`, `modules-*`).
//! This file wires them into a Tauri v2 mobile app.

/// All `#[tauri::command]` handlers.
pub mod commands;
/// Single error type for every Tauri command.
pub mod error;
/// Tablet image download manager daemon (spec 0046b §3.7) — keeps the
/// local image cache (`$APPCACHE/images/`) in sync with the catalog.
mod image_download;
/// Global application state (DB, kernel, sync daemon).
pub mod state;

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

#[cfg(not(test))]
use crate::error::AppError;
#[cfg(not(test))]
use crate::state::AppState;
#[cfg(not(test))]
use kasirmu_core::db::Store;
#[cfg(not(test))]
use kasirmu_core::sync_client::SyncConfig;
#[cfg(not(test))]
use tauri::Manager;

/// Application entry point, called by `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(deprecated)]
pub fn run() {
    // Initialise tokio-console before any other tracing setup.
    platform_startup::console::init_console_subscriber();

    // Use try_init so test builds that lack WebView2Loader.dll don't
    // panic when logging is already initialised by the test harness.
    let _ = kasirmu_logging::try_init();
    #[cfg(not(test))]
    {
        let result: Result<(), AppError> = tauri::Builder::default()
            .plugin(tauri_plugin_clipboard_manager::init())
            .plugin(tauri_plugin_opener::init())
            // Tablet file pickers (todo-tablet-dialog-content-uri.md Phase 1).
            // Registered here and nowhere else on this shell: the desktop client
            // has had the dialog plugin since apps/desktop-tauri/src/lib.rs:106.
            .plugin(tauri_plugin_dialog::init())
            // `fs` is registered for the webview's benefit, not this crate's: the
            // Android picker returns a `content://` URI that no Rust consumer can
            // open as a path, so the UI reads the bytes through `plugin:fs|*`
            // (which resolves the URI via the content resolver) and writes them to
            // a real cache path first. See the module note in Cargo.toml.
            .plugin(tauri_plugin_fs::init())
            .setup(|app| {
                let state = AppState::new(app.handle())
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

                // ── Module system lifecycle (shared startup) ──────────────
                platform_startup::init_module_system(&state.kernel, &state.db_path)?;

                // ── Manage state BEFORE spawning background daemons ───────
                // Daemons access AppState via try_state(), which only works
                // after the state is managed. Managing first avoids the
                // daemon's first tick silently skipping because the state
                // isn't available yet.
                let app_handle = app.handle().clone();
                app.manage(state);

                // ── Hardware registry bootstrap ───────────────────────────
                // Same gap the desktop client had: AppState builds an empty
                // DriverRegistry and nothing registered into it, so every
                // printer, drawer and display command resolved None at
                // runtime. Config-driven only — DriverRegistry::discover()
                // is not called, because it binds whatever is attached under
                // hardware-derived ids and opens ports nobody named.
                {
                    let hardware_app_handle = app.handle().clone();
        // ── Attest the server origin (ADR #55) ──────────────────────
        // The cascade is what makes `main -> fallback` real: it asks each
        // compiled origin to prove it holds the license keypair and caches the
        // winner for the process, which `license_server_url()` then prefers.
        // Fire-and-forget on purpose: boot is never blocked on a probe, and an
        // unreachable MAIN degrades to the canonical default exactly as it does
        // today until the cascade resolves to the fallback.
        platform_startup::spawn_once("server origin attestation", async move {
            let nonce = kasirmu_core::attestation::generate_nonce();
            match kasirmu_core::attestation::resolve_attested_origin(&nonce).await {
                Some(resolved) => tracing::info!(
                    origin = %resolved.url,
                    source = resolved.source.as_str(),
                    "server origin attested"
                ),
                None => tracing::warn!(
                    "no server origin could be attested; staying on the compiled default"
                ),
            }
        });
                    platform_startup::spawn_once("hardware bootstrap", async move {
                        let state = hardware_app_handle.state::<AppState>();
                        let registry = state.registry.clone();
                        let base_dir = state
                            .db_path
                            .parent()
                            .unwrap_or(std::path::Path::new("."))
                            .to_path_buf();
                        let terminal_id = state
                            .terminal_id
                            .lock()
                            .await
                            .clone()
                            .unwrap_or_else(|| "unknown".to_string());
                        let (profile, terminals) = {
                            let conn = state.db.lock().await;
                            let store = kasirmu_core::db::Store::new(&conn);
                            (
                                platform_startup::hardware::load_profile(
                                    &conn,
                                    &terminal_id,
                                    &base_dir,
                                ),
                                store.list_active_edc_terminals().unwrap_or_else(|e| {
                                    tracing::warn!(
                                        error = %e,
                                        "could not read configured card terminals; \
                                         the card tender will fail closed"
                                    );
                                    Vec::new()
                                }),
                            )
                        }; // Connection is !Send; guard dropped before any await.

                        let mut report = match profile {
                            Some(profile) => {
                                platform_startup::hardware::register_hardware(&registry, &profile)
                                    .await
                            }
                            None => {
                                tracing::info!(
                                    terminal_id = %terminal_id,
                                    "no hardware profile saved yet; nothing to register"
                                );
                                kasirmu_hal::BootstrapReport::default()
                            }
                        };
                        let terminals = platform_startup::hardware::register_card_terminals(
                            &registry,
                            &terminals,
                        )
                        .await;
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
                }

                // ── Background session cleanup daemon (TTL expiry) ──────
                // Runs every 5 minutes to sweep expired sessions from the
                // in-memory session store.
                {
                    let session_store = app.state::<AppState>().session_store.clone();
                    platform_startup::spawn_daemon("tablet session cleanup", async move {
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(300));
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
                            store.retain(|_, ctx| !ctx.is_expired());
                            let pruned = before - store.len();
                            if pruned > 0 {
                                tracing::info!(
                                    "tablet session cleanup: pruned {pruned} expired session(s)"
                                );
                            }
                        }
                    });
                }

                // ── Memo expiry sweep daemon ───────────────────────────────
                // Mirrors the desktop sweep: every 5 minutes, transition
                // published Memos past their `expires_at` to `expired` on the
                // global identity DB, then run the two retention stages
                // (ended → `archived` with `archived_at` stamped; deletion of
                // archives past the fixed 30-day window — ruled 2026-09-07).
                // Needed here too so a tablet-only deployment still keeps the
                // Memo status column truthful and honors the retention window.
                {
                    let sweep_handle = app_handle.clone();
                    platform_startup::spawn_daemon("tablet memo expiry sweep", async move {
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(300));
                        interval.tick().await;
                        loop {
                            interval.tick().await;
                            let Some(state) = sweep_handle.try_state::<AppState>() else {
                                continue;
                            };
                            let now = chrono::Utc::now()
                                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                            let conn = state.db.lock().await;
                            let store = kasirmu_core::db::Store::new(&conn);
                            match store.sweep_all_expired(&now) {
                                Ok(n) if n > 0 => {
                                    tracing::info!("tablet memo sweep: expired {n} memo(s)")
                                }
                                Ok(_) => {}
                                Err(e) => tracing::warn!(error = %e, "tablet memo sweep failed"),
                            }
                            match store.sweep_ended_to_archived(&now) {
                                Ok(n) if n > 0 => {
                                    tracing::info!("tablet memo sweep: archived {n} memo(s)")
                                }
                                Ok(_) => {}
                                Err(e) => {
                                    tracing::warn!(error = %e, "tablet memo retention failed")
                                }
                            }
                            match store.sweep_expired_archives(
                                &now,
                                kasirmu_core::memo::RETENTION_WINDOW_DAYS,
                            ) {
                                Ok(n) if n > 0 => tracing::info!(
                                    "tablet memo sweep: deleted {n} archived memo(s)"
                                ),
                                Ok(_) => {}
                                Err(e) => {
                                    tracing::warn!(error = %e, "tablet memo retention delete failed")
                                }
                            }
                        }
                    });
                }

                // ── Audit retention sweep daemon (todo-global-saas-2.md P1) ─
                // Mirrors the desktop sweep: every 15 minutes, resolve the tier
                // from the global DB and enforce the adopted schedule (Free
                // purge-all, Plus 90d, Pro 180d, Premium 1y, Enterprise 3y) on
                // it. The tablet shares ONE database (AppState.db) — there is
                // no per-store split here. A missing/tampered subscription row
                // SKIPS the tick: the fail-closed projection is Free and a
                // purge triggered by corrupted data would be irreversible.
                {
                    let sweep_handle = app_handle.clone();
                    platform_startup::spawn_daemon("tablet audit retention sweep", async move {
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(900));
                        interval.tick().await;
                        loop {
                            interval.tick().await;
                            let Some(state) = sweep_handle.try_state::<AppState>() else {
                                continue;
                            };
                            let now = chrono::Utc::now()
                                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                            let conn = state.db.lock().await;
                            let store = kasirmu_core::db::Store::new(&conn);
                            let ent = kasirmu_core::entitlements::build_entitlements(
                                &store,
                                kasirmu_core::availability::UsageCounts::default(),
                                false,
                            );
                            if !ent.loaded {
                                tracing::warn!(
                                    "tablet audit sweep: no valid subscription row — skipping tick"
                                );
                                continue;
                            }
                            match store.sweep_audit_retention(&ent.tier, &now) {
                                Ok(n) if n > 0 => tracing::info!(
                                    "tablet audit sweep: deleted {n} expired audit row(s) (tier: {})",
                                    ent.tier.name()
                                ),
                                Ok(_) => {}
                                Err(e) => tracing::warn!(
                                    error = %e,
                                    "tablet audit retention sweep failed"
                                ),
                            }
                        }
                    });
                }

                // ── Background sync daemon ────────────────────────────────
                // Uses the same 3-phase split as the Tauri commands:
                // read DB → async HTTP → write DB, so the DB lock is never
                // held during the network round-trip.
                //
                // SYNC-EW: the daemon also wakes on `state.sync_wakeup` so
                // that `complete_sale_scoped` can trigger a near-immediate
                // sync instead of waiting up to 30 s for the next tick.
                let sync_app_handle = app_handle.clone();
                let sync_wakeup = app_handle
                    .state::<AppState>()
                    .sync_wakeup
                    .clone();
                platform_startup::spawn_daemon("tablet sync daemon", async move {
                    let periodic = std::time::Duration::from_secs(30);
                    const WAKEUP_DEBOUNCE: std::time::Duration =
                        std::time::Duration::from_millis(1_500);

                    loop {
                        // Wait for either the periodic interval or an
                        // event-triggered wakeup (SYNC-EW).
                        let woken_by_nudge = tokio::select! {
                            _ = tokio::time::sleep(periodic) => false,
                            _ = sync_wakeup.notified() => true,
                        };

                        if woken_by_nudge {
                            tracing::debug!(
                                debounce_ms = WAKEUP_DEBOUNCE.as_millis(),
                                "tablet sync daemon woken by nudge — debouncing"
                            );
                            tokio::time::sleep(WAKEUP_DEBOUNCE).await;
                        }

                        match sync_app_handle.try_state::<AppState>() {
                            Some(state) => {
                                // Phase 1: Read config + pending items (brief lock).
                                let (config_opt, pending_items) = {
                                    let db = state.db.lock().await;
                                    let store = Store::new(&db);
                                    let config = match SyncConfig::from_settings(&store) {
                                        Ok(c) => c,
                                        Err(e) => {
                                            tracing::error!(
                                                error = %e,
                                                "tablet sync daemon: failed to load sync config"
                                            );
                                            None
                                        }
                                    };
                                    let pending =
                                        store.list_pending_offline().unwrap_or_else(|e| {
                                            tracing::error!(
                                                error = %e,
                                                "tablet sync daemon: failed to list pending offline"
                                            );
                                            vec![]
                                        });
                                    (config, pending)
                                };

                                let Some(config) = config_opt else {
                                    continue;
                                };

                                if pending_items.is_empty() {
                                    continue;
                                }

                                // Phase 2: Async HTTP push (no DB lock).
                                let outcomes = kasirmu_core::sync_client::send_items_to_server(
                                    &config,
                                    &pending_items,
                                )
                                .await;

                                // Phase 3: Apply outcomes (brief lock).
                                {
                                    let db = state.db.lock().await;
                                    let store = Store::new(&db);
                                    match outcomes {
                                        Ok(outcomes) => {
                                            if let Err(e) =
                                                kasirmu_core::sync_client::apply_sync_outcomes(
                                                    &store,
                                                    &pending_items,
                                                    &outcomes,
                                                )
                                            {
                                                tracing::error!(
                                                    error = %e,
                                                    "tablet sync daemon: failed to apply outcomes"
                                                );
                                            }
                                        }
                                        // ADR sync-plan-gating: a free tenant
                                        // is gated, not broken — keep items
                                        // `pending` so they sync automatically
                                        // after an upgrade (no mark_all_failed).
                                        Err(kasirmu_core::sync_client::SyncHttpError::PlanRequired) => {
                                            tracing::error!(
                                                "tablet sync daemon: cloud sync requires a paid plan"
                                            );
                                        }
                                        Err(e) => {
                                            let _ = kasirmu_core::sync_client::mark_all_failed(
                                                &store,
                                                &pending_items,
                                                &e.to_string(),
                                            );
                                            tracing::error!(
                                                error = %e,
                                                "tablet sync daemon: HTTP push failed"
                                            );
                                        }
                                    }
                                }
                            }
                            None => {
                                tracing::warn!(
                                    "tablet sync daemon: AppState not available — \
                                     skipping sync cycle (shutting down?)"
                                );
                            }
                        }
                    }
                });


                // ── Background image download daemon (spec 0046b §3.7) ──
                // Computes the missing-hash set at each cycle (referenced
                // minus present on disk) and downloads primaries first,
                // up to 40 images per cycle with 2 GETs in flight; LRU
                // eviction keeps the cache within the 256 MB budget.
                // Wakes on jittered cadence (configurable via OZ_IMG_PULL_*).
                platform_startup::spawn_daemon("tablet image download", async move {
                    let mut manager = crate::image_download::ImageDownloadManager::new();
                    // Initial delay so the daemon doesn't hammer on boot.
                    tokio::time::sleep(std::time::Duration::from_secs(
                        crate::image_download::jitter_min(),
                    ))
                    .await;
                    loop {
                        match app_handle.try_state::<AppState>() {
                            Some(state) => {
                                let cache_dir = state
                                    .app
                                    .as_ref()
                                    .map(|h| {
                                        h.path()
                                            .app_cache_dir()
                                            .unwrap_or_else(|_| std::path::PathBuf::from("."))
                                    })
                                    .unwrap_or_else(|| std::path::PathBuf::from("."));
                                manager.run_cycle(&state.db, &cache_dir).await;
                            }
                            None => {
                                tracing::warn!(
                                    "tablet image download: AppState not available — skipping"
                                );
                            }
                        }
                        tokio::time::sleep(crate::image_download::rand_jitter(
                            crate::image_download::jitter_min(),
                            crate::image_download::jitter_max(),
                        ))
                        .await;
                    }
                });

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
                // Organization-level security trail from the global identity
                // DB (todo-global-saas-2.md P1). Reads a DIFFERENT file than
                // the store-scoped audit list above — see the command doc.
                commands::audit::list_security_events_scoped,
                commands::auth::staff_login,
                commands::auth::has_users,
                commands::auth::staff_check_username,
                commands::auth::create_session,
                commands::auth::destroy_session,
                commands::auth::refresh_picker_ticket,
                commands::auth::session_keepalive,
                commands::auth::impersonate_user_scoped,
                // SaaS-3 L194: multi-organization user switching.
                commands::auth::list_organizations,
                commands::auth::switch_organization,
                // Own-avatar read (parity gap closed 2026-09-19): the shared
                // PosScreen restaurant sidebar reads this on mount and this shell
                // renders that screen. The two writes join it in b-full Phase 3,
                // after the owner reversed the 2026-09-19 desktop-only ruling —
                // see commands/avatars.rs for what changed and why.
                commands::avatars::get_own_avatar_scoped,
                commands::avatars::set_avatar_scoped,
                commands::avatars::clear_avatar_scoped,
                commands::branding::get_brand_settings,
                commands::branding::set_brand_primary_colour,
                commands::branding::set_brand_logo_path,
                commands::branding::set_brand_store_name,
                commands::customers::list_customers_scoped,
                commands::customers::search_customers_scoped,
                commands::customers::get_customer_history_scoped,
                commands::customers::get_customer_scoped,
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
                commands::memo::list_active_memos_scoped,
                commands::memo::acknowledge_memo_scoped,
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
                commands::subscription::get_subscription_capabilities,
                commands::subscription::explain_feature_availability_scoped,
                commands::subscription::get_over_quota_report,
                commands::subscription::get_over_quota_report_scoped,
                commands::categories::list_categories,
                commands::categories::create_category_scoped,
                commands::categories::update_category_scoped,
                commands::categories::delete_category_scoped,
                commands::currencies::currency_info,
                commands::currencies::list_currencies_scoped,
                // Bootstrap: get_default_currency/set_default_currency are
                // pre-session commands — CurrencyProvider sits above
                // AuthProvider/WorkspaceProvider and has no session token.
                commands::currencies::get_default_currency,
                commands::currencies::get_default_currency_scoped,
                commands::currencies::set_default_currency,
                commands::currencies::set_default_currency_scoped,
                // Data Management (b-full Phase 3): the shared Settings screen
                // invokes all three, and the picked file reaches them as a path
                // in the app cache — commands/data.rs.
                commands::data::export_data,
                commands::data::import_preview,
                commands::data::import_data,
                // Backup-to-destination (b-full Phase 3 closeout, 2026-09-20):
                // tablet-only twin of create_backup that writes to the cache path
                // the UI bridged from the save dialog's content:// URI. The desktop
                // pair (create_backup / get_backup_status) is intentionally untouched.
                commands::data::create_backup_to,
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
                commands::health::ping,
                commands::health::version,
                commands::health::get_device_id,
                commands::health::get_local_ip,
                commands::pos::start_sale_scoped,
                commands::pos::add_line_scoped,
                commands::pos::set_line_course_scoped,
                commands::pos::publish_course_fired_scoped,
                commands::pos::preview_promoted_total_scoped,
                commands::pos::preview_promoted_total_from_lines_scoped,
                commands::pos::complete_sale_scoped,
                commands::pos::complete_sale_with_resolved_shortfalls_scoped,
                commands::pos::set_cart_discount_scoped,
                commands::pos::override_line_price_scoped,
                commands::pos::override_cart_deduction_location_scoped,
                commands::pos::get_cart_deduction_location,
                commands::pos::get_cart_deduction_location_scoped,
                commands::pos::list_active_carts_scoped,
                commands::pos::get_active_cart_scoped,
                commands::pos::hold_cart_scoped,
                commands::pos::list_held_carts_scoped,
                commands::pos::list_open_bills_scoped,
                commands::pos::get_held_cart_scoped,
                commands::pos::compute_cart_tax_scoped,
                commands::pos::delete_held_cart_scoped,
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
                commands::history::list_sales,
                commands::history::get_sale,
                commands::history::export_daily_summary,
                commands::history::export_sales_by_hour,
                commands::history::export_eod_report,
                commands::void::void_sale_scoped,
                commands::settings::get_receipt_settings,
                commands::settings::get_store_settings,
                commands::settings::get_credit_settings,
                commands::settings::get_hardware_settings,
                commands::settings::get_user_preferences_scoped,
                commands::settings::set_user_preferences_scoped,
                commands::settings::get_setting,
            commands::settings::gateway_status,
                commands::settings::get_deployment_info,
                commands::settings::set_setting,
                commands::setup::get_enabled_features,
                commands::setup::complete_setup,
                commands::setup::dismiss_setup_wizard,
                commands::desktop_link::link_device_google,
        commands::desktop_link::link_device_email_request,
        commands::desktop_link::link_device_email_consume,
                commands::browser::open_product_images,
                commands::setup::get_setup_status,
                commands::tax::list_tax_rates_scoped,
                commands::tax::list_tax_rate_rounding_modes_scoped,
                commands::tax::create_tax_rate_scoped,
                commands::tax::update_tax_rate_scoped,
                commands::tax::delete_tax_rate_scoped,
                commands::tax::get_tax_rate_dependency_counts_scoped,
                commands::tax::list_category_tax_rates_scoped,
                commands::tax::set_category_tax_rates_scoped,
                // TODO(L-1): these unscoped terminal commands are spoofable
                commands::terminals::set_device_binding_scoped,
                commands::workspaces::list_workspaces,
                commands::workspaces::list_workspace_screens,
                commands::workspaces::resolve_boot_store,
                commands::sync::test_sync_connection,
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
                commands::scale::read_scale_weight,
                // ── H-1: Auto-generated scoped variants ────────────────────────
                commands::branding::get_brand_settings_scoped,
                commands::branding::set_brand_logo_path_scoped,
                commands::branding::set_brand_primary_colour_scoped,
                commands::branding::set_brand_store_name_scoped,
                commands::bundles::create_bundle_scoped,
                commands::bundles::delete_bundle_scoped,
                commands::bundles::get_bundle_scoped,
                commands::bundles::list_bundles_scoped,
                commands::bundles::lookup_bundle_by_sku_scoped,
                commands::bundles::update_bundle_scoped,
                commands::categories::list_categories_scoped,
                commands::gift_cards::freeze_gift_card_scoped,
                commands::gift_cards::get_gift_card_balance_scoped,
                commands::gift_cards::get_gift_card_scoped,
                commands::gift_cards::issue_gift_card_scoped,
                commands::gift_cards::list_gift_cards_scoped,
                commands::gift_cards::redeem_gift_card_scoped,
                commands::gift_cards::top_up_gift_card_scoped,
                commands::gift_cards::unfreeze_gift_card_scoped,
                commands::hardware::list_scanners_scoped,
                commands::hardware::open_cash_drawer_scoped,
                commands::hardware::print_receipt_scoped,
                commands::hardware::print_sales_receipt_scoped,
                commands::hardware::start_scanner_scoped,
                commands::hardware::stop_scanner_scoped,
                commands::hardware::list_displays_scoped,
                commands::hardware::display_show_scoped,
                commands::hardware::display_clear_scoped,
                commands::hardware::discover_hardware_scoped,
                commands::history::export_daily_summary_scoped,
                commands::history::export_eod_report_scoped,
                commands::history::export_sales_by_hour_scoped,
                commands::history::get_sale_scoped,
                commands::history::list_sales_scoped,
                commands::kds::create_kds_order_from_sale_scoped,
                commands::kds::get_kds_order_scoped,
                commands::kds::get_kds_queue_scoped,
                commands::kds::list_kds_orders_scoped,
                commands::kds::update_kds_status_scoped,
                commands::legal_entities::list_legal_entities_scoped,
                commands::legal_entities::get_legal_entity_scoped,
                commands::legal_entities::create_legal_entity_scoped,
                commands::legal_entities::update_legal_entity_scoped,
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
                commands::offline::delete_offline_item_scoped,
                commands::offline::enqueue_offline_scoped,
                commands::offline::list_all_offline_scoped,
                commands::offline::list_pending_offline_scoped,
                commands::offline::list_remote_failures_scoped,
                commands::offline::pending_offline_count_scoped,
                commands::offline::requeue_remote_failure_scoped,
                commands::offline::retry_offline_sync_scoped,
                commands::product_variants::create_product_variant_scoped,
                commands::product_variants::delete_product_variant_scoped,
                commands::product_variants::get_product_variant_scoped,
                commands::product_variants::list_product_variants_scoped,
                commands::product_variants::update_product_variant_scoped,
                commands::products::adjust_stock_scoped,
                commands::products::create_product_scoped,
                commands::products::delete_product_scoped,
                commands::products::get_product_track_serial_batch_scoped,
                commands::products::get_product_track_serial_scoped,
                commands::products::list_products_scoped,
                commands::products::list_warehouse_products_scoped,
                commands::products::lookup_by_barcode_scoped,
                commands::products::lookup_product_by_sku_scoped,
                commands::products::record_product_search_scoped,
                commands::products::update_product_scoped,
                // Product image writes (b-full Phase 3): EditProductModal calls
                // both and the tablet mounts it. Without them the Phase-2 picker
                // succeeds and then the write fails as "command not found".
                commands::products_images::products_set_image_scoped,
                commands::products_images::products_clear_image_scoped,
                commands::promotions::apply_promotion_scoped,
                commands::promotions::create_promotion_scoped,
                commands::promotions::delete_promotion_scoped,
                commands::promotions::get_promotion_scoped,
                commands::promotions::get_sale_promotions_scoped,
                commands::promotions::list_promotions_scoped,
                commands::promotions::update_promotion_scoped,
                commands::purchasing::create_purchase_order_scoped,
                commands::purchasing::create_supplier_scoped,
                commands::purchasing::get_purchase_order_scoped,
                commands::purchasing::get_supplier_scoped,
                commands::purchasing::list_purchase_orders_scoped,
                commands::purchasing::list_suppliers_scoped,
                commands::purchasing::receive_purchase_order_scoped,
                commands::purchasing::receive_purchase_order_with_lines_scoped,
                commands::purchasing::update_po_status_scoped,
                commands::purchasing::update_supplier_scoped,
                commands::scale::list_scale_devices_scoped,
                commands::scale::read_scale_weight_scoped,
                commands::settings::get_credit_settings_scoped,
                commands::settings::get_hardware_settings_scoped,
                commands::fiscal::get_document_number_sequence_scoped,
                commands::fiscal::upsert_document_number_sequence_scoped,
                commands::fiscal::list_document_number_sequences_scoped,
                commands::fiscal::list_document_number_sequences_for_entity_scoped,
                commands::fiscal::list_fiscal_schemes_scoped,
                commands::settings::get_receipt_settings_scoped,
                commands::settings::get_setting_scoped,
                commands::settings::get_store_settings_scoped,
                commands::settings::list_credit_sales_scoped,
                commands::settings::set_credit_settings_scoped,
                commands::settings::set_hardware_settings_scoped,
                commands::settings::set_receipt_settings_scoped,
                commands::settings::set_setting_scoped,
                commands::settings::set_settings_scoped,
                commands::settings::set_store_settings_scoped,
                commands::settings::settle_credit_scoped,
                commands::sync::get_sync_plan_scoped,
                commands::sync::get_sync_settings_scoped,
                commands::sync::list_sync_conflicts_scoped,
                commands::sync::pending_sync_count_scoped,
                commands::sync::request_sync_token_scoped,
                commands::sync::resolve_sync_conflict_scoped,
                commands::sync::sync_pull_scoped,
                commands::sync::sync_run_scoped,
                commands::sync::test_sync_connection_scoped,
                commands::sync::update_sync_settings_scoped,
                commands::qris_auto::qris_auto_charge_scoped,
                commands::qris_auto::qris_auto_status_scoped,
                commands::tables::assign_table_order_scoped,
                commands::tables::create_table_scoped,
                commands::tables::delete_table_scoped,
                commands::tables::get_table_scoped,
                commands::tables::list_sections_scoped,
                commands::tables::list_tables_scoped,
                commands::tables::release_table_scoped,
                commands::tables::update_table_scoped,
                commands::tables::update_table_status_scoped,
                commands::terminals::delete_terminal_override_scoped,
                commands::terminals::delete_terminal_scoped,
                commands::terminals::get_terminal_scoped,
                commands::terminals::list_terminal_overrides_scoped,
                commands::terminals::list_terminals_scoped,
                commands::terminals::ping_terminal_scoped,
                commands::terminals::register_terminal_scoped,
                commands::terminals::set_terminal_override_scoped,
                commands::terminals::update_terminal_scoped,
            ])
            .run(tauri::generate_context!())
            .map_err(AppError::from);

        tracing::info!("tablet: shutting down");
        // Kernel shutdown happens in AppState::drop() — see state.rs.

        if let Err(e) = result {
            tracing::error!(error = %e, "OZ-POS tablet exited with error");
            std::process::exit(1);
        }
    }
}
