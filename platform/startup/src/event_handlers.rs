//! Shared application-level event handlers.
/*
last audited DD-MM-YY by DSH-Agent
crate: platform-startup (event_handlers) | status: SAFE | lint: CLEAN
findings: six handlers share a uniform lock/Store/enqueue-or-audit pattern with poison-safe mapping and structured error logs; sale completions enqueued at SyncPriority::Critical (P-2, documented); audit entries system-initiated; no unsafe/no SQL interpolation. COR-33 already resolved: inline tests were extracted to sibling event_handlers_tests.rs (file is now 479 lines, not 1,219).
next: none | perf: handlers hold the shared DB mutex briefly
*/
//!
//! These handlers are cross-cutting concerns that don't belong to a
//! single business module. They are registered on the kernel's event
//! bus by [`crate::init_module_system`].

use std::sync::{Arc, Mutex};

use foundation::contracts::{EventHandler, ModuleResult};
use oz_core::audit::AuditEntry;
use oz_core::db::Store;
use oz_core::events::{ProductCreated, SaleCompleted, SettingsUpdated, StockAdjusted};
use oz_core::offline::SyncPriority;
use rusqlite::Connection;
use tracing::{error, info};

/// Handler that enqueues completed sales to the offline sync queue.
///
/// Listens for `sale.completed` events and writes a "complete_sale"
/// entry to the offline queue. The sync engine picks it up on the
/// next sync cycle and pushes it to the remote server.
///
/// This is the core of the offline-first architecture: every completed
/// sale goes through the queue, regardless of connectivity. The sync
/// engine handles delivery when the network is available.
#[derive(Debug)]
pub struct SaleSyncEnqueuer {
    db: Arc<Mutex<Connection>>,
}

impl SaleSyncEnqueuer {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }
}

impl EventHandler<SaleCompleted> for SaleSyncEnqueuer {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("sync enqueuer: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        let payload = serde_json::json!({
            "sale_id": event.sale_id,
            "total_minor": event.total_minor,
            "currency": event.currency,
            "customer_id": event.customer_id,
            "line_items": event.line_items,
        })
        .to_string();

        // OUTBOX GUARD: the two wired settlement doors (sales_checkout.rs
        // :527 and sales_lifecycle.rs :470) now write this row INSIDE the
        // sale transaction, so by the time this handler runs the row already
        // exists and is committed, and enqueueing again would push the sale
        // twice. The probe keys on the sale id inside the payload, not on the
        // payload bytes: the two writers build the JSON from different sources
        // (the Sale struct vs the event), and a shape drift must not turn
        // "skip" into "duplicate". Lane one - the legacy complete_sale
        // command (create_sale + two update_sale_status calls, no transaction
        // spanning completion) - is deliberately NOT wired and has no
        // in-transaction row, so it still lands here. This handler is that
        // lane's only writer, not a stale second writer.
        if store
            .has_pending_outbox_row_for_sale("complete_sale", &event.sale_id)
            .map_err(|e| anyhow::anyhow!("sync enqueuer: outbox probe failed: {e}"))?
        {
            info!(
                sale_id = %event.sale_id,
                "sync enqueuer: outbox row already committed with the sale; not enqueuing"
            );
            return Ok(());
        }

        // P-2: Sale completions are Critical priority — they must
        // propagate before inventory or settings changes.
        store
            .enqueue_offline_priority("complete_sale", &payload, SyncPriority::Critical)
            .map_err(|e| {
                error!(
                    sale_id = %event.sale_id,
                    error = %e,
                    "sync enqueuer: failed to enqueue completed sale"
                );
                anyhow::anyhow!("sync enqueuer: enqueue_offline_priority failed: {e}")
            })?;

        info!(
            sale_id = %event.sale_id,
            "sync enqueuer: sale queued for sync (priority=Critical)"
        );

        Ok(())
    }
}

/// Handler that enqueues inventory changes to the offline sync queue.
///
/// Listens for `product.created` and `stock.adjusted` events and writes
/// them to the offline queue. The sync engine pushes them to the remote
/// server on the next sync cycle.
///
/// Together with [`SaleSyncEnqueuer`], this ensures all inventory mutations
/// are tracked for cloud replication.
#[derive(Debug)]
pub struct InventorySyncEnqueuer {
    db: Arc<Mutex<Connection>>,
}

impl InventorySyncEnqueuer {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }
}

impl EventHandler<ProductCreated> for InventorySyncEnqueuer {
    fn handle(&self, event: &ProductCreated) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("inv sync enqueuer: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        let payload = serde_json::json!({
            "sku": event.sku,
            "name": event.name,
            "price_minor": event.price_minor,
            "currency": event.currency,
            "category_id": event.category_id,
            "barcode": event.barcode,
            "initial_stock": event.initial_stock,
        })
        .to_string();

        store
            .enqueue_offline("product.created", &payload)
            .map_err(|e| {
                error!(
                    sku = %event.sku,
                    error = %e,
                    "inv sync enqueuer: failed to enqueue product.created"
                );
                anyhow::anyhow!("inv sync enqueuer: enqueue_offline failed: {e}")
            })?;

        info!(
            sku = %event.sku,
            "inv sync enqueuer: product creation queued for sync"
        );

        Ok(())
    }
}

impl EventHandler<StockAdjusted> for InventorySyncEnqueuer {
    fn handle(&self, event: &StockAdjusted) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("inv sync enqueuer: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        let payload = serde_json::json!({
            "sku": event.sku,
            "delta": event.delta,
            "new_qty": event.new_qty,
            "reason": event.reason,
        })
        .to_string();

        store
            .enqueue_offline("stock.adjusted", &payload)
            .map_err(|e| {
                error!(
                    sku = %event.sku,
                    error = %e,
                    "inv sync enqueuer: failed to enqueue stock.adjusted"
                );
                anyhow::anyhow!("inv sync enqueuer: enqueue_offline failed: {e}")
            })?;

        info!(
            sku = %event.sku,
            delta = event.delta,
            reason = %event.reason,
            "inv sync enqueuer: stock adjustment queued for sync"
        );

        Ok(())
    }
}

/// Handler that creates an audit log entry when a domain event fires.
///
/// Records the event details in the audit log for compliance
/// (PCI-DSS 10.2.1, 10.3.1).
#[derive(Debug)]
pub struct AuditLogHandler {
    db: Arc<Mutex<Connection>>,
}

impl AuditLogHandler {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }
}

impl EventHandler<SaleCompleted> for AuditLogHandler {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("audit handler: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        // AUDIT GUARD: the two wired settlement doors (sales_checkout.rs,
        // sales_lifecycle.rs - the seat right next to
        // enqueue_sale_outbox_in_tx) now write this row INSIDE the sale
        // transaction, so by the time this handler runs the row already
        // exists and is committed, and writing again would double it. The
        // probe keys on (action, target_id) regardless of outcome - the
        // audit-lane mirror of SaleSyncEnqueuer's outbox guard above. Lane
        // one - the legacy complete_sale command (create_sale + two
        // update_sale_status calls, no transaction spanning completion) -
        // is deliberately NOT wired and has no in-transaction row, so it
        // still lands here. This handler is that lane's only writer.
        //
        // ACTOR DIVERGENCE (deliberate, documented on both ends - see the
        // wired doors): rows that land here keep the empty-string user_id
        // below, because SaleCompleted carries no actor; the wired doors
        // stamp sale.user_id. Same action, two actor shapes in the table.
        if Store::has_audit_row_for(&conn, "sale.completed", &event.sale_id)
            .map_err(|e| anyhow::anyhow!("audit handler: audit probe failed: {e}"))?
        {
            info!(
                sale_id = %event.sale_id,
                "audit handler: sale.completed row already committed with the sale; not duplicating"
            );
            return Ok(());
        }

        let details = serde_json::json!({
            "sale_id": event.sale_id,
            "total_minor": event.total_minor,
            "currency": event.currency,
            "line_count": event.line_items.len(),
        })
        .to_string();

        let entry = AuditEntry::new(
            "", // system-initiated action
            "sale.completed",
            Some("sale"),
            Some(&event.sale_id),
            Some(details),
            "success",
        );

        store.log_audit(&entry).map_err(|e| {
            error!(
                sale_id = %event.sale_id,
                error = %e,
                "audit handler: failed to log sale.completed"
            );
            anyhow::anyhow!("audit handler: log_audit failed: {e}")
        })?;

        info!(
            sale_id = %event.sale_id,
            total_minor = event.total_minor,
            "audit handler: sale.completed logged"
        );

        Ok(())
    }
}

impl EventHandler<StockAdjusted> for AuditLogHandler {
    fn handle(&self, event: &StockAdjusted) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("audit handler: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        let details = serde_json::json!({
            "sku": event.sku,
            "delta": event.delta,
            "new_qty": event.new_qty,
            "reason": event.reason,
        })
        .to_string();

        let entry = AuditEntry::new(
            "", // system-initiated action
            "stock.adjusted",
            Some("stock"),
            Some(&event.sku),
            Some(details),
            "success",
        );

        store.log_audit(&entry).map_err(|e| {
            error!(
                sku = %event.sku,
                error = %e,
                "audit handler: failed to log stock.adjusted"
            );
            anyhow::anyhow!("audit handler: log_audit failed: {e}")
        })?;

        info!(
            sku = %event.sku,
            delta = event.delta,
            new_qty = event.new_qty,
            reason = %event.reason,
            "audit handler: stock.adjusted logged"
        );

        Ok(())
    }
}

impl EventHandler<ProductCreated> for AuditLogHandler {
    fn handle(&self, event: &ProductCreated) -> ModuleResult {
        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("audit handler: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        let details = serde_json::json!({
            "sku": event.sku,
            "name": event.name,
            "price_minor": event.price_minor,
            "currency": event.currency,
            "initial_stock": event.initial_stock,
        })
        .to_string();

        let entry = AuditEntry::new(
            "", // system-initiated action
            "product.created",
            Some("product"),
            Some(&event.sku),
            Some(details),
            "success",
        );

        store.log_audit(&entry).map_err(|e| {
            error!(
                sku = %event.sku,
                error = %e,
                "audit handler: failed to log product.created"
            );
            anyhow::anyhow!("audit handler: log_audit failed: {e}")
        })?;

        info!(
            sku = %event.sku,
            name = %event.name,
            "audit handler: product.created logged"
        );

        Ok(())
    }
}

/// Handler that earns loyalty points into a customer's loyalty account
/// when a sale completes.
///
/// If the sale has a linked customer, this handler calls
/// `Store::earn_points()` to credit the loyalty_accounts table.
/// The earning rate is determined by the customer's tier multiplier.
#[derive(Debug)]
pub struct LoyaltyEarnHandler {
    db: Arc<Mutex<Connection>>,
}

impl LoyaltyEarnHandler {
    /// Create a new handler with a shared database connection.
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }
}

impl EventHandler<SaleCompleted> for LoyaltyEarnHandler {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        let Some(ref customer_id) = event.customer_id else {
            info!(
                sale_id = %event.sale_id,
                "loyalty earn handler: sale has no customer, skipping"
            );
            return Ok(());
        };

        let conn = self
            .db
            .lock()
            .map_err(|e| anyhow::anyhow!("loyalty earn handler: db lock failed: {e}"))?;
        let store = Store::new(&conn);

        // Get or create a loyalty account for this customer.
        let account = store
            .get_or_create_loyalty_account(customer_id)
            .map_err(|e| {
                anyhow::anyhow!(
                    "loyalty earn handler: failed to get/create account for {customer_id}: {e}"
                )
            })?;

        // Earn points based on the sale total.
        store
            .earn_points(customer_id, &event.sale_id, event.total_minor)
            .map_err(|e| {
                anyhow::anyhow!(
                    "loyalty earn handler: earn_points failed for customer {customer_id}: {e}"
                )
            })?;

        info!(
            customer_id = %customer_id,
            sale_id = %event.sale_id,
            account_id = %account.id,
            total_minor = event.total_minor,
            "loyalty earn handler: points credited"
        );

        Ok(())
    }
}

/// Handler that bridges `settings_updated` events to the Tauri frontend.
///
/// Wraps the handler body in `tokio::spawn` so the publisher (which runs
/// synchronously on the EventBus) returns immediately — non-blocking.
/// This prevents UI thread freezes when a settings save triggers a
/// settings refetch IPC round-trip.
///
/// The emit callback is set by the client app during setup via
/// [`set_settings_emit_fn`]. Until set, events are logged at debug level
/// (no-op bridge).
#[derive(Debug, Default)]
pub struct SettingsUpdatedHandler;

impl SettingsUpdatedHandler {
    /// Create a new handler.
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self
    }
}

impl EventHandler<SettingsUpdated> for SettingsUpdatedHandler {
    fn handle(&self, event: &SettingsUpdated) -> ModuleResult {
        let changed_keys = event.changed_keys.clone();
        let terminal_id = event.terminal_id.clone();

        // Spawn non-blocking — publish() returns immediately.
        tokio::spawn(async move {
            let payload = serde_json::json!({
                "changed_keys": changed_keys,
                "terminal_id": terminal_id,
            });
            let emit_guard = SETTINGS_EMIT_FN
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(emit) = emit_guard.as_ref() {
                emit("settings_updated", payload);
            } else {
                tracing::debug!(
                    keys = ?payload["changed_keys"],
                    "settings_updated Tauri bridge not yet wired"
                );
            }
        });
        Ok(())
    }
}

/// Global emit callback for bridging EventBus events to the Tauri frontend.
///
/// Set by the client app's setup closure via [`set_settings_emit_fn`].
/// Uses a type-erased callback (`String`, `serde_json::Value`) to avoid
/// coupling `platform-startup` to a concrete Tauri `AppHandle<R>` type.
///
/// Uses a `Mutex` (not `OnceLock`) so tests can replace the callback
/// between test cases — `OnceLock` can only be set once per process lifetime.
#[allow(clippy::type_complexity)]
static SETTINGS_EMIT_FN: std::sync::Mutex<
    Option<Box<dyn Fn(&str, serde_json::Value) + Send + Sync>>,
> = std::sync::Mutex::new(None);

/// Register the emit callback used by [`SettingsUpdatedHandler`].
#[allow(clippy::type_complexity)]
///
/// Called once from the client app's setup closure after the module system
/// is initialized. The callback typically calls `app_handle.emit(event, payload)`.
pub fn set_settings_emit_fn(f: Box<dyn Fn(&str, serde_json::Value) + Send + Sync>) {
    let mut guard = SETTINGS_EMIT_FN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *guard = Some(f);
}

/// Clear the emit callback (used in tests to reset state between cases).
#[doc(hidden)]
pub fn clear_settings_emit_fn() {
    let mut guard = SETTINGS_EMIT_FN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *guard = None;
}

#[cfg(test)]
#[path = "event_handlers_tests.rs"]
mod tests;
