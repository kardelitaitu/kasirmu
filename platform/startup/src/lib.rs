// No crate-level lint allow lives here any more. There used to be one: an
// allow for the undeclared-cfg lint, justified as making
// `cfg(feature = "metrics")` legal because `kasirmu-reporting` enabled it. That
// premise was false — a dependency's features do not enter this crate's cfg
// space — and the gate it excused was real but dead: `metrics` was never
// declared in this crate's Cargo.toml, so the `pub mod server` in
// `src/metrics.rs` compiled in no build (not even CI's `--all-features`) and
// `start_metrics_server` had no call site anywhere. Both were retired on
// 2026-09-12: the file is deleted, its declaration with it, and the feature was
// not declared to make the code live. The attribute went out the same way,
// because the one cfg this crate still uses without Cargo knowing about it —
// the bare `tokio_unstable` that `console.rs` gates on — is now declared in
// `build.rs` instead of being silenced wholesale.
/*
last audited 25-07-26 by RSA-Agent (platform-startup slice A: lib deep read)
crate: platform-startup | status: SAFE | lint: CLEAN
findings: clean shared startup — module set pinned by parity test against the modules manifest.json set, documented loyalty-registration fix, spawn_daemon panic-isolated harness (error-logged-not-crash), pending-sale reaper on a dedicated connection with 60s cadence and non-fatal failure handling
next: none | perf: N/A
*/

//! Shared application startup for OZ-POS desktop and tablet clients.
//!
//! Both `apps/desktop-client` and `apps/tablet-client` call this crate
//! to avoid duplicating module registration and event handler wiring.
//!
//! The background sync daemon remains in each client because it depends on
//! the client-specific `AppState` type.
//!
//! # Usage
//! ```no_run
//! # use platform_startup::init_module_system;
//! # use platform_kernel::Kernel;
//! # use tokio::sync::Mutex as AsyncMutex;
//! # fn example() -> Result<(), Box<dyn std::error::Error>> {
//! # let kernel = AsyncMutex::new(Kernel::new());
//! # let db_path = std::path::Path::new(":memory:");
//! // In your Tauri setup closure:
//! init_module_system(&kernel, db_path)?;
//! # Ok(())
//! # }
//! ```

pub mod console;
pub mod event_handlers;
/// Startup hardware registration from the saved terminal profile.
pub mod hardware;
pub mod rate_sync;

use std::sync::{Arc, Mutex};

use kasirmu_core::cache::Cache;
use platform_kernel::Kernel;
use rusqlite::Connection;
use tokio::sync::Mutex as AsyncMutex;
use tracing::info;

/// Open a WAL-mode SQLite connection for event handlers.
fn open_handler_connection(
    db_path: &std::path::Path,
) -> Result<Arc<Mutex<Connection>>, Box<dyn std::error::Error>> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(Arc::new(Mutex::new(conn)))
}

/// Initialise the caching layer.
///
/// Attempts a Redis connection using `redis_url` and `ttl_seconds`.
/// Falls back to a no-op cache when Redis is unavailable or the
/// `cache-redis` feature is disabled.
pub fn init_cache(redis_url: &str, ttl_seconds: u64) -> Arc<dyn Cache> {
    kasirmu_core::cache::create_cache(redis_url, ttl_seconds)
}

/// Register all business modules and wire event handlers on the kernel.
///
/// Called from each client's `setup` closure after `AppState` is created.
pub fn init_module_system(
    kernel: &AsyncMutex<Kernel>,
    db_path: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // ── Module system lifecycle ───────────────────────────────────────
    //
    // Registration order is not load order: each module declares its own
    // dependencies via `Module::dependencies()`, and the kernel
    // topologically sorts them before calling `on_load`/`on_start`. Every
    // id a module declares must appear in this block, or `load_all` fails
    // with `KernelError::MissingDependency`. The parity test in
    // `startup_tests.rs` asserts that this block stays in sync with the
    // `modules/*/manifest.json` set.
    {
        let mut k = kernel.blocking_lock();
        k.register(Box::new(modules_inventory::InventoryModule::new()))?;
        k.register(Box::new(modules_crm::CrmModule::new()))?;
        k.register(Box::new(modules_tax::TaxModule::new()))?;
        k.register(Box::new(modules_settings::SettingsModule::new()))?;
        k.register(Box::new(modules_staff::StaffModule::new()))?;
        k.register(Box::new(modules_sales::SalesModule::new()))?;
        k.register(Box::new(modules_reporting::ReportingModule::new()))?;
        k.register(Box::new(modules_terminal::TerminalModule::new()))?;
        k.register(Box::new(modules_currency::CurrencyModule::new()))?;
        // Loyalty was previously defined but never registered, so its
        // lifecycle hooks never ran even though the LoyaltyEarnHandler below
        // was subscribed to `sale.completed`.
        k.register(Box::new(modules_loyalty::LoyaltyModule::new()))?;
        // ── Stub verticals ───────────────────────────────────────────
        // These own their manifest, id, and dependency edges but no domain
        // logic yet; their hooks only log. Registering them now means the
        // dependency graph, load order, and shutdown order are exercised
        // from the first commit rather than at migration time.
        k.register(Box::new(modules_purchasing::PurchasingModule::new()))?;
        k.register(Box::new(modules_promotions::PromotionsModule::new()))?;
        k.register(Box::new(modules_giftcards::GiftCardsModule::new()))?;
        k.register(Box::new(modules_kitchen::KitchenModule::new()))?;
        k.load_all()?;
        k.start_all()?;
        drop(k);

        // Open a second connection for event handlers (WAL allows concurrent readers).
        let handler_conn = open_handler_connection(db_path)?;

        // Wire event handlers on the bus.
        let k = kernel.blocking_lock();
        let bus = k.event_bus();

        bus.subscribe::<kasirmu_core::events::SaleCompleted>(
            "sale.completed",
            Box::new(crate::event_handlers::SaleSyncEnqueuer::new(
                handler_conn.clone(),
            )),
        );
        // CRM-06: the CrmHistoryHandler subscription was REMOVED. Its
        // projection (customers.total_spent_minor) moved into the
        // completion transaction itself (Store::finalize_sale →
        // apply_customer_stats_on_completion): base-currency,
        // replay-safe via the finalize CAS. The handler had no
        // idempotency guard (event re-delivery double-counted spend)
        // and no currency validation (foreign-currency sales were
        // added raw); leaving it subscribed alongside the transactional
        // hook would double-count every sale.
        bus.subscribe::<kasirmu_core::events::SaleCompleted>(
            "sale.completed",
            Box::new(crate::event_handlers::AuditLogHandler::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::ProductCreated>(
            "product.created",
            Box::new(crate::event_handlers::AuditLogHandler::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::ProductCreated>(
            "product.created",
            Box::new(crate::event_handlers::InventorySyncEnqueuer::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::StockAdjusted>(
            "stock.adjusted",
            Box::new(crate::event_handlers::AuditLogHandler::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::StockAdjusted>(
            "stock.adjusted",
            Box::new(crate::event_handlers::InventorySyncEnqueuer::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::SaleCompleted>(
            "sale.completed",
            Box::new(modules_reporting::handlers::SaleCompletedReporter::new(
                handler_conn.clone(),
            )),
        );
        bus.subscribe::<kasirmu_core::events::SaleCompleted>(
            "sale.completed",
            Box::new(crate::event_handlers::LoyaltyEarnHandler::new(handler_conn)),
        );

        // ── ADR #22 Phase 0e: SettingsUpdated handler (non-blocking) ──
        bus.subscribe::<kasirmu_core::events::SettingsUpdated>(
            "settings.updated",
            Box::new(crate::event_handlers::SettingsUpdatedHandler::new()),
        );

        // ── WhatsApp notification handlers (opt-in via feature flag + env vars) ─
        #[cfg(feature = "whatsapp-notifications")]
        {
            use kasirmu_notification::NotificationClient;

            match kasirmu_notification::whatsapp::WhatsAppClient::from_env() {
                Ok(whatsapp) => {
                    let client: std::sync::Arc<dyn NotificationClient> =
                        std::sync::Arc::new(whatsapp);

                    bus.subscribe::<kasirmu_core::events::SaleCompleted>(
                        "sale.completed",
                        Box::new(
                            kasirmu_notification::handlers::OrderConfirmationHandler::new(
                                client.clone(),
                                std::env::var("WHATSAPP_STORE_PHONE").ok(),
                            ),
                        ),
                    );
                    bus.subscribe::<kasirmu_core::events::SaleCompleted>(
                        "sale.completed",
                        Box::new(kasirmu_notification::handlers::PaymentReceiptHandler::new(
                            client.clone(),
                            std::env::var("WHATSAPP_RECEIPT_PHONE")
                                .unwrap_or_else(|_| "+15550000000".into()),
                        )),
                    );
                    // Default threshold: alert when ≤ 5 items remaining.
                    let threshold: i64 = std::env::var("WHATSAPP_STOCK_ALERT_THRESHOLD")
                        .ok()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(5);
                    let manager_phone = std::env::var("WHATSAPP_MANAGER_PHONE")
                        .unwrap_or_else(|_| "+15550000000".into());
                    bus.subscribe::<kasirmu_core::events::StockAdjusted>(
                        "stock.adjusted",
                        Box::new(kasirmu_notification::handlers::StockLowAlertHandler::new(
                            client,
                            threshold,
                            manager_phone,
                        )),
                    );

                    tracing::info!(
                        "WhatsApp notification handlers wired (3 handlers on sale.completed + stock.adjusted)"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        error = %e,
                        "WhatsApp notifications compiled in but env vars not set — handlers skipped"
                    );
                }
            }
        }
    }

    info!("module system initialised with event bus handlers");

    // Spawn the stale-pending-sale reaper as a background daemon.
    init_pending_sale_reaper(db_path);

    Ok(())
}

/// The runtime daemons are spawned on when no ambient runtime is reachable.
///
/// [`spawn_daemon`] is called from each shell's synchronous `setup` hook, where
/// no ambient runtime exists and a bare [`tokio::spawn`] would panic. The
/// shell's own runtime cannot be named from here without depending on that
/// shell's toolkit, which this crate must not do (ADR #49, ADR #53), so the
/// daemon runtime is owned here and built lazily on first use.
fn daemon_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("kasirmu-daemon")
            .build()
            .expect("failed to build the daemon runtime")
    })
}

/// Spawn a detached task on the ambient runtime when there is one, and on the
/// daemon runtime otherwise.
///
/// Preferring the ambient handle means a caller that already has a runtime —
/// including the watchdog spawned from inside [`spawn_daemon`] — keeps sharing
/// it, so the fallback runtime is built only for the synchronous `setup` path.
fn spawn_detached(fut: impl std::future::Future<Output = ()> + Send + 'static) {
    // Dropping the returned handle detaches the task, which is what a daemon
    // wants: nothing joins it and it lives until the process exits.
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => drop(handle.spawn(fut)),
        Err(_) => drop(daemon_runtime().spawn(fut)),
    }
}

/// Spawn a background daemon with a watchdog that logs on panic or
/// unexpected exit.
///
/// Runs on the ambient runtime when the caller has one and on this crate's own
/// daemon runtime otherwise, which is what makes the call safe from a
/// synchronous `setup` hook — unlike a bare [`tokio::spawn`].  Panic
/// detection is done via a `oneshot` channel: if the daemon future
/// panics, the channel sender is dropped during unwind and the
/// watchdog sees a `RecvError`.
pub fn spawn_daemon(
    name: &'static str,
    fut: impl std::future::Future<Output = ()> + Send + 'static,
) {
    spawn_detached(async move {
        let (tx, rx) = tokio::sync::oneshot::channel();

        // Watchdog: fired when the daemon future resolves or panics.
        spawn_detached(async move {
            match rx.await {
                Ok(()) => tracing::warn!("{name} exited unexpectedly"),
                Err(_) => tracing::error!("{name} panicked"),
            }
        });

        // Run the daemon.  If it panics, the `tx` drop during unwind
        // causes the watchdog to receive `Err(RecvError)`.
        fut.await;
        let _ = tx.send(());
    });
}

/// Open a dedicated WAL-mode connection for the pending-sale reaper.
///
/// The reaper runs on its own connection so it never blocks (or is blocked
/// by) the main application connection. Foreign-key enforcement and WAL
/// journal mode are configured exactly like [`open_handler_connection`];
/// pragma failures are surfaced as errors (a reaper running without WAL or
/// FK enforcement would silently misbehave).
fn open_reaper_connection(
    db_path: &std::path::Path,
) -> Result<rusqlite::Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}

/// Spawn the ADR-20 stale-pending-sale reaper as a periodic background task.
///
/// Every 60 seconds, queries for pending sales whose `pending_expires_at`
/// has passed and auto-voids them, crediting stock back to original
/// deduction locations. Uses a separate WAL-mode connection so the
/// background task doesn't block or get blocked by the main connection.
///
/// If the database at `db_path` cannot be opened, the reaper logs an error
/// and exits — it does not crash the application.
pub fn init_pending_sale_reaper(db_path: &std::path::Path) {
    use kasirmu_core::db::Store;
    use std::time::Duration;

    let path = db_path.to_owned();
    spawn_daemon("pending-sale-reaper", async move {
        // Create a dedicated connection for the reaper.
        let conn = match open_reaper_connection(&path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(?e, "pending sale reaper: failed to open DB — skipping");
                return;
            }
        };

        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;

            let store = Store::new(&conn);
            match store.reap_stale_pending_sales() {
                Ok(count) => {
                    if count > 0 {
                        tracing::info!("pending sale reaper: voided {count} stale sale(s)");
                    }
                }
                Err(e) => {
                    tracing::warn!("pending sale reaper: error: {e}");
                }
            }
        }
    });
}

/// Initialise and start the exchange rate auto-sync daemon.
///
/// Spawns a background task that periodically fetches exchange rates
/// from the public Frankfurter API and stores them in the database.
/// Returns the daemon handle so callers can inspect status or shut it
/// down.
pub async fn init_rate_sync(db: rate_sync::DbConnection) -> rate_sync::RateSyncDaemon {
    let daemon = rate_sync::RateSyncDaemon::new();
    daemon.start(db).await;
    daemon
}

#[cfg(test)]
#[path = "startup_tests.rs"]
mod tests;
