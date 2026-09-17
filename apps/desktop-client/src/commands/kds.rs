//! Kitchen Display System (KDS) commands.
//!
//! IPC surface for the kitchen order queue: list orders, update status,
//! create tickets from completed sales.
//!
//! All KDS commands require `kds:view` or `kds:update` permission.
//!
//! Bodies live in [`oz_bridge::kds`]; each shim borrows a [`BridgeCtx`] from
//! `AppState` and maps `BridgeError` back to `AppError` variant-for-variant so
//! the wire shape is untouched. The pure topology helpers and the chit printers
//! stay reachable from here (and from the sibling test mount) through `pub use`.
//!
//! kds-sync: the kitchen-transition shims are also the publish seam for the
//! [`kasirmu_lan`] `KdsSyncEvent` LAN protocol (bridge/core must not depend on
//! oz-lan, so the events are published here) and keep
//! [`AppState::kds_queue_cache`] fresh for reconnecting peers.

use std::sync::Arc;

use tauri::{Emitter, State};

use oz_core::KdsOrder;
use kasirmu_lan::{
    KdsLineItemBumped, KdsOrderPlaced, KdsOrderReady, KdsOrderRecalled, KdsQueueSnapshot,
    KdsQueueTicket, KdsSyncEvent,
};
use serde_json::Value;

use crate::error::AppError;
use crate::state::AppState;

#[allow(unused_imports)] // sibling kds_tests.rs depends on it
use crate::commands::topology::TOPOLOGY_RUNTIME_SETTING_KEY;
#[allow(unused_imports)] // sibling kds_tests.rs depends on it
use oz_core::db::Store;

use oz_bridge::ctx::{BridgeCtx, EventSink};
pub use oz_bridge::kds::{
    KdsChitJob, build_kds_chit_jobs, resolve_runtime_kds_plan, runtime_kds_hardware_targets,
    runtime_kds_target_instances, should_create_kds_tickets, try_auto_print_kds_chit_jobs,
};

/// Sink view of a shell `AppHandle`, for the two retained helpers below.
///
/// Mirrors the private `TauriEventSink` in `commands/authz.rs`: the extracted
/// bodies emit through [`EventSink`], while these helpers keep their original
/// `Option<&AppHandle>` parameter because it is part of the shell API.
struct HandleSink(tauri::AppHandle);

impl EventSink for HandleSink {
    fn emit(&self, event: &'static str, payload: Value) {
        let _ = self.0.emit(event, payload);
    }
}

fn sink_for(app: Option<&tauri::AppHandle>) -> Option<Arc<dyn EventSink>> {
    app.map(|app| Arc::new(HandleSink(app.clone())) as Arc<dyn EventSink>)
}

// ── kds-sync (LAN multi-terminal state sync) ───────────────────────
//
// `KdsSyncEvent` lives in `oz-lan`, not `oz-core::events`, and neither
// `oz-bridge` nor `oz-core` may depend on `oz-lan` (dependency
// inversion). These shims are the only place both worlds are in scope,
// so publishing is this module's job — this is what the
// `INTEGRATION(oz-lan kds-sync)` notes in `crates/kasirmu-lan/src/lib.rs`
// ask desktop-client to do.

/// Publish one KDS sync event on the kernel bus, best-effort.
///
/// The `kds.sync` subscriber registered in `lib.rs` (the LAN forwarder's
/// `kds_sync_handler`) serialises it and fans it out to connected KDS
/// peers with station filtering. A bus failure is logged and swallowed:
/// an already-committed kitchen transition must never turn into a failed
/// command response because the LAN side hiccuped.
async fn publish_kds_sync(state: &AppState, event: KdsSyncEvent) {
    let kernel = state.kernel.lock().await;
    let bus = kernel.event_bus();
    if let Err(e) = bus.publish(&event) {
        tracing::warn!(error = %e, "kds.sync publish failed");
    }
}

/// Rebuild [`AppState::kds_queue_cache`] from the live active queue.
///
/// The cache is what the LAN `KdsQueueProvider` serves (synchronously,
/// inside the per-peer accept task) to a reconnecting KDS peer as the
/// `active_queue` of its discovery response, so it must be refreshed
/// after every transition this terminal performs.
///
/// Borrow ordering is the point of the shape: every bridge call is
/// awaited into owned locals first (queue rows, per-order lines, per-
/// order stations from `resolve_kds_targets`), and only then is the
/// `std::sync::RwLock` write guard taken — held for the pointer swap
/// alone, never across an `.await`, and never touching the async DB
/// mutex the provider must not see.
///
/// Best-effort like the publish: any failure is logged and leaves the
/// previous snapshot in place.
async fn refresh_kds_queue_cache(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    cache: &Arc<std::sync::RwLock<KdsQueueSnapshot>>,
) {
    let orders = match oz_bridge::kds::get_kds_queue_scoped(ctx, session_token, None).await {
        Ok(orders) => orders,
        Err(e) => {
            tracing::warn!(error = %e, "kds-sync cache refresh: active-queue query failed");
            return;
        }
    };
    let mut tickets = Vec::with_capacity(orders.len());
    for order in orders {
        let line_items = oz_bridge::kds::get_kds_order_lines_scoped(ctx, session_token, &order.id)
            .await
            .unwrap_or_default();
        // Station routing comes from the frozen engine; an empty vec is
        // the broadcast fallback (Expo semantics), so a resolve failure
        // degrades to broadcast rather than hiding the ticket.
        let stations = oz_bridge::kds_routing::resolve_kds_targets(ctx, session_token, &order.id)
            .await
            .unwrap_or_default();
        tickets.push(KdsQueueTicket {
            order,
            line_items,
            stations,
        });
    }
    let snapshot = KdsQueueSnapshot {
        generated_at: chrono::Utc::now().to_rfc3339(),
        tickets,
    };
    match cache.write() {
        Ok(mut guard) => *guard = snapshot,
        Err(e) => tracing::warn!(error = %e, "kds-sync cache refresh: write lock failed"),
    }
}

/// List KDS orders for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_kds_orders_scoped(
    session_token: String,
    status: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::list_kds_orders_scoped(&ctx, &session_token, status)
        .await
        .map_err(Into::into)
}

/// Get the kitchen queue for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_kds_queue_scoped(
    session_token: String,
    kds_zone: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_queue_scoped(&ctx, &session_token, kds_zone)
        .await
        .map_err(Into::into)
}

/// Update the items on a KDS order in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_kds_order_items_scoped(
    session_token: String,
    args: oz_core::UpdateKdsOrderItemsInput,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::update_kds_order_items_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a KDS order's status in the store resolved from a session token. ADR #7.
///
/// kds-sync: a committed transition to `ready` publishes
/// [`KdsSyncEvent::OrderReady`]; a move back to `preparing`/`pending`
/// publishes [`KdsSyncEvent::Recalled`] (the recall-to status rides in
/// the event). Every other status change is silent but still refreshes
/// the queue cache, since served/cancelled tickets leave the snapshot.
#[tauri::command]
pub async fn update_kds_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<KdsOrder, AppError> {
    let cache = state.kds_queue_cache.clone();
    let ctx = state.bridge_ctx();
    let order =
        oz_bridge::kds::update_kds_status_scoped(&ctx, &session_token, &id, &status).await?;
    if matches!(order.status.as_str(), "ready" | "preparing" | "pending") {
        // All bridge awaits complete before the kernel lock is taken.
        let stations = oz_bridge::kds_routing::resolve_kds_targets(&ctx, &session_token, &order.id)
            .await
            .unwrap_or_default();
        let bumped_by = ctx.terminal_id().await;
        let occurred_at = chrono::Utc::now().to_rfc3339();
        let event = if order.status == "ready" {
            KdsSyncEvent::OrderReady(KdsOrderReady {
                kds_order_id: order.id.clone(),
                sale_id: order.sale_id.clone(),
                stations,
                display_number: order.display_number,
                ready_at: order.ready_at.clone(),
                bumped_by,
                occurred_at,
            })
        } else {
            KdsSyncEvent::Recalled(KdsOrderRecalled {
                kds_order_id: order.id.clone(),
                sale_id: order.sale_id.clone(),
                line_item_id: None,
                stations,
                recall_to: order.status.clone(),
                reason: None,
                occurred_at,
            })
        };
        publish_kds_sync(&state, event).await;
    }
    refresh_kds_queue_cache(&ctx, &session_token, &cache).await;
    Ok(order)
}

/// Create KDS orders in the store resolved from a session token. ADR #7.
///
/// Passes the session's `store_id` so the KDS order carries store identity
/// for defense-in-depth filtering on KDS tablets (ADR #8). Returns one
/// KDS order per kitchen zone; an empty vec when no restaurant items exist.
///
/// kds-sync: every ticket created by the fan-out publishes its own
/// [`KdsSyncEvent::OrderPlaced`] (stations from `resolve_kds_targets`,
/// line items re-read so peers get the structured rows), then the queue
/// cache is refreshed once for the whole batch.
#[tauri::command]
pub async fn create_kds_order_from_sale_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<KdsOrder>, AppError> {
    let cache = state.kds_queue_cache.clone();
    let ctx = state.bridge_ctx();
    let orders =
        oz_bridge::kds::create_kds_order_from_sale_scoped(&ctx, &session_token, &sale_id).await?;
    if !orders.is_empty() {
        for order in &orders {
            let stations =
                oz_bridge::kds_routing::resolve_kds_targets(&ctx, &session_token, &order.id)
                    .await
                    .unwrap_or_default();
            let items = oz_bridge::kds::get_kds_order_lines_scoped(&ctx, &session_token, &order.id)
                .await
                .unwrap_or_default();
            let event = KdsSyncEvent::OrderPlaced(KdsOrderPlaced {
                kds_order_id: order.id.clone(),
                sale_id: order.sale_id.clone(),
                store_id: order.store_id.clone(),
                stations,
                display_number: order.display_number,
                table_number: order.table_number.clone(),
                ticket_prefix: order.ticket_prefix.clone(),
                items,
                notes: order.notes.clone(),
                priority: order.priority,
                occurred_at: chrono::Utc::now().to_rfc3339(),
            });
            publish_kds_sync(&state, event).await;
        }
        refresh_kds_queue_cache(&ctx, &session_token, &cache).await;
    }
    Ok(orders)
}

/// Get a KDS order from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_kds_order_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<KdsOrder>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_order_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Print a kitchen chit for a single KDS order.
///
/// Tries the "kitchen" printer first; falls back to the "default"
/// receipt printer. Silently skips when no printer is registered
/// (the kitchen may not have a dedicated printer).
///
/// Returns `true` when the chit was printed, `false` when skipped.
pub async fn print_kds_chit_for_order(
    order: &KdsOrder,
    registry: &kasirmu_hal::DriverRegistry,
    app: Option<&tauri::AppHandle>,
) -> bool {
    let sink = sink_for(app);
    oz_bridge::kds::print_kds_chit_for_order(order, registry, sink.as_ref()).await
}

/// Print a kitchen chit for a specific KDS order by ID (scoped - ADR #7).
///
/// Useful for manual re-print from the KDS screen when a chit was lost
/// or damaged. Returns`true` if the chit was printed, `false` if the
/// order was not found or no printer was available.
#[tauri::command]
pub async fn print_kds_chit_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::print_kds_chit_scoped(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}

// ── KDS line items (TODO 2a) ────────────────────────────

/// Get all line items for a KDS order (scoped - ADR #7).
///
/// Returns structured line items with course and modifier data,
/// ordered by course priority then line position.
#[tauri::command]
pub async fn get_kds_order_lines_scoped(
    session_token: String,
    order_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::KdsLineItem>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::kds::get_kds_order_lines_scoped(&ctx, &session_token, &order_id)
        .await
        .map_err(Into::into)
}

/// Update the status of a single KDS line item in the store resolved
/// from a session token. ADR #7.
///
/// Returns the updated line item with the new status and timestamp.
///
/// kds-sync: publishes [`KdsSyncEvent::LineItemBumped`] for the committed
/// bump. The event carries the parent order's `sale_id`, so when the
/// parent order cannot be resolved the publish is skipped with a warning
/// (never emit a bump the peers cannot attribute) — the cache refresh
/// still runs, and the command itself always reports the update.
#[tauri::command]
pub async fn update_kds_line_item_status_scoped(
    session_token: String,
    item_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<oz_core::KdsLineItem, AppError> {
    let cache = state.kds_queue_cache.clone();
    let ctx = state.bridge_ctx();
    let item =
        oz_bridge::kds::update_kds_line_item_status_scoped(&ctx, &session_token, &item_id, &status)
            .await?;
    let stations =
        oz_bridge::kds_routing::resolve_kds_targets(&ctx, &session_token, &item.kds_order_id)
            .await
            .unwrap_or_default();
    match oz_bridge::kds::get_kds_order_scoped(&ctx, &session_token, &item.kds_order_id).await {
        Ok(Some(parent)) => {
            let event = KdsSyncEvent::LineItemBumped(KdsLineItemBumped {
                kds_order_id: item.kds_order_id.clone(),
                sale_id: parent.sale_id,
                line_item_id: item.id.clone(),
                stations,
                to_status: item.item_status.clone(),
                bumped_by: ctx.terminal_id().await,
                occurred_at: chrono::Utc::now().to_rfc3339(),
            });
            publish_kds_sync(&state, event).await;
        }
        Ok(None) => tracing::warn!(
            kds_order_id = %item.kds_order_id,
            "kds.sync line_item_bumped skipped: parent order not found"
        ),
        Err(e) => tracing::warn!(
            error = %e,
            kds_order_id = %item.kds_order_id,
            "kds.sync line_item_bumped skipped: parent order lookup failed"
        ),
    }
    refresh_kds_queue_cache(&ctx, &session_token, &cache).await;
    Ok(item)
}

/// Try to print kitchen chits for every order in the slice.
///
/// Best-effort: logs failures but does not return errors.
/// Called automatically after KDS order creation.
///
/// Takes owned clones of registry and app so the caller can drop any
/// Tauri state borrows before the first `.await`.
pub async fn try_auto_print_kds_chits(
    orders: &[KdsOrder],
    registry: &kasirmu_hal::DriverRegistry,
    app: Option<&tauri::AppHandle>,
) {
    let sink = sink_for(app);
    oz_bridge::kds::try_auto_print_kds_chits(orders, registry, sink.as_ref()).await;
}

#[cfg(test)]
#[path = "kds_lan_live_tests.rs"]
mod kds_lan_live_tests;
