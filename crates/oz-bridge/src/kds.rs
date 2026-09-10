//! Kitchen Display System (KDS) command bodies.
//!
//! Extracted verbatim from `apps/desktop-client/src/commands/kds.rs` (Wave D / D2a).
//! Every KDS command requires `kds:view` or `kds:update`, authorized against the
//! global identity DB through [`BridgeCtx::require_session_permission`] (ADR #7).
//!
//! The only shell coupling here was the `kds:orders-changed` / `kds:chit-printed`
//! UI pushes and the HAL printer lookup. Events now go through [`BridgeCtx::emitter`]
//! (`None` = silent no-op, exactly the old `if let Some(app) = state.app.as_ref()`);
//! printers through [`BridgeCtx::registry`].

use std::sync::Arc;

use oz_core::KdsOrder;
use oz_core::db::Store;
use oz_core::permissions;
use serde_json::Value;

use crate::ctx::{BridgeCtx, EventSink};
use crate::error::BridgeError;

/// Settings key under which the compiled POS runtime topology plan is stored.
///
/// Mirror of the shell constant `commands::topology::TOPOLOGY_RUNTIME_SETTING_KEY`
/// (private to that module; extracting it belongs to the topology slice). The
/// literal MUST stay byte-identical to it - KDS reads the plan the compiler wrote.
const TOPOLOGY_RUNTIME_SETTING_KEY: &str = "oz-pos/topology-runtime";

/// Select every KDS workspace instance targeted by POS runtime routes.
///
/// The topology compiler has already validated the semantic relationship;
/// this consumer only matches the stable route fields needed at checkout.
pub fn runtime_kds_target_instances(plan: &Value, source_instance_id: &str) -> Vec<String> {
    let mut targets = Vec::new();
    if let Some(routes) = plan.get("routes").and_then(Value::as_array) {
        for route in routes {
            let is_operation_route = route.get("source_instance_id").and_then(Value::as_str)
                == Some(source_instance_id)
                && route.get("from_port_id").and_then(Value::as_str) == Some("operation-out")
                && route.get("to_port_id").and_then(Value::as_str) == Some("operation-in")
                && route.get("relationship_type").and_then(Value::as_str) == Some("generic");
            if !is_operation_route {
                continue;
            }
            if let Some(target) = route.get("target_instance_id").and_then(Value::as_str)
                && !targets.iter().any(|existing| existing == target)
            {
                targets.push(target.to_owned());
            }
        }
    }
    targets
}

/// Read the compiled runtime topology plan for a store from the global DB.
///
/// Returns `Ok(None)` when the store has no runtime plan (legacy path).
///
/// # Errors
///
/// Returns [`BridgeError::Core`] on DB errors and [`BridgeError::Internal`] when
/// the stored JSON cannot be parsed.
pub fn resolve_runtime_kds_plan(
    conn: &rusqlite::Connection,
    store_id: &str,
) -> Result<Option<Value>, BridgeError> {
    let key = format!("{TOPOLOGY_RUNTIME_SETTING_KEY}/{store_id}");
    let Some(json) = oz_core::Settings::get(conn, &key)? else {
        return Ok(None);
    };
    let plan: Value = serde_json::from_str(&json)
        .map_err(|e| BridgeError::Internal(format!("parse topology runtime plan: {e}")))?;
    Ok(Some(plan))
}

/// Return whether a scoped runtime plan should create KDS tickets.
///
/// A missing runtime plan is the legacy compatibility path. Once a runtime
/// plan exists, an empty POS -> KDS target list means routing is intentionally
/// disabled and must not create an untargeted ticket.
pub fn should_create_kds_tickets(runtime_targets: Option<&[String]>) -> bool {
    runtime_targets.is_none_or(|targets| !targets.is_empty())
}

/// One kitchen chit to print: an order routed at a KDS endpoint through a
/// specific hardware printer node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KdsChitJob {
    /// KDS order the chit belongs to.
    pub order_id: String,
    /// KDS workspace instance that received the ticket.
    pub kds_instance_id: String,
    /// Hardware instance (registry printer id) to print it on.
    pub hardware_instance_id: String,
}

/// Find the hardware endpoints attached to each selected KDS instance.
pub fn runtime_kds_hardware_targets(
    plan: &Value,
    kds_instance_ids: &[String],
) -> Vec<(String, String)> {
    let mut targets = Vec::new();
    let Some(routes) = plan.get("routes").and_then(Value::as_array) else {
        return targets;
    };
    for route in routes {
        let Some(source) = route.get("source_instance_id").and_then(Value::as_str) else {
            continue;
        };
        let is_ticket_route = kds_instance_ids.iter().any(|id| id == source)
            && route.get("from_port_id").and_then(Value::as_str) == Some("ticket-out")
            && route.get("to_port_id").and_then(Value::as_str) == Some("ticket-in")
            && route.get("relationship_type").and_then(Value::as_str) == Some("ticket-routing");
        if !is_ticket_route {
            continue;
        }
        let Some(hardware) = route.get("target_instance_id").and_then(Value::as_str) else {
            continue;
        };
        let pair = (source.to_owned(), hardware.to_owned());
        if !targets.iter().any(|existing| existing == &pair) {
            targets.push(pair);
        }
    }
    targets
}

/// Cross every order with every KDS-to-hardware route, deduplicated.
pub fn build_kds_chit_jobs(
    orders: &[KdsOrder],
    kds_instance_ids: &[String],
    plan: &Value,
) -> Vec<KdsChitJob> {
    let hardware_targets = runtime_kds_hardware_targets(plan, kds_instance_ids);
    let mut jobs = Vec::new();
    for order in orders {
        for (kds_instance_id, hardware_instance_id) in &hardware_targets {
            let job = KdsChitJob {
                order_id: order.id.clone(),
                kds_instance_id: kds_instance_id.clone(),
                hardware_instance_id: hardware_instance_id.clone(),
            };
            if !jobs.iter().any(|existing| existing == &job) {
                jobs.push(job);
            }
        }
    }
    jobs
}

/// Print one chit on a resolved printer and push the `kds:chit-printed` event.
///
/// Returns `true` when the raw chit reached the printer. The event is dropped
/// silently when no sink is injected (headless), mirroring the old `if let
/// Some(app)` guard around `app.emit(...)`.
async fn print_kds_chit_with_printer(
    order: &KdsOrder,
    printer: Arc<dyn oz_hal::ReceiptPrinter>,
    emitter: Option<&Arc<dyn EventSink>>,
    target_instance_id: Option<&str>,
) -> bool {
    let chit = oz_hal::drivers::kds_chit::format_kds_chit(
        order.display_number,
        order.table_number.as_deref(),
        &order.items_summary,
        order.item_count,
        &order.notes,
        &order.received_at,
        &order.ticket_prefix,
    );

    match printer.print_raw(&chit.data).await {
        Ok(_) => {
            tracing::info!(
                order_id = %order.id,
                display_number = ?order.display_number,
                target_instance_id,
                "kitchen chit printed"
            );
            if let Some(sink) = emitter {
                sink.emit(
                    "kds:chit-printed",
                    serde_json::json!({
                        "orderId": order.id,
                        "displayNumber": order.display_number,
                        "targetInstanceId": target_instance_id,
                    }),
                );
            }
            true
        }
        Err(e) => {
            tracing::warn!(
                order_id = %order.id,
                target_instance_id,
                error = %e,
                "kitchen chit print failed"
            );
            false
        }
    }
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
    registry: &oz_hal::DriverRegistry,
    emitter: Option<&Arc<dyn EventSink>>,
) -> bool {
    // Find the best available printer - try "kitchen" first, then "default".
    let printer = match registry.printer("kitchen").await {
        Some(p) => Some(p),
        None => registry.printer("default").await,
    };
    let Some(printer) = printer else {
        tracing::trace!(
            order_id = %order.id,
            "kitchen chit: no printer available, skipping"
        );
        return false;
    };
    print_kds_chit_with_printer(order, printer, emitter, None).await
}

/// Print one routed chit job on the hardware endpoint topology selected.
async fn print_kds_chit_job(
    job: &KdsChitJob,
    order: &KdsOrder,
    registry: &oz_hal::DriverRegistry,
    emitter: Option<&Arc<dyn EventSink>>,
) -> bool {
    // Hardware node IDs are the registry IDs. Accept the conventional
    // printer:<id> alias as well, but never fall back to another device:
    // topology explicitly selected this endpoint.
    let printer = match registry.printer(&job.hardware_instance_id).await {
        Some(printer) => Some(printer),
        None => {
            registry
                .printer(&format!("printer:{}", job.hardware_instance_id))
                .await
        }
    };
    let Some(printer) = printer else {
        tracing::warn!(
            order_id = %job.order_id,
            kds_instance_id = %job.kds_instance_id,
            hardware_instance_id = %job.hardware_instance_id,
            "targeted kitchen chit skipped: hardware printer is not registered"
        );
        return false;
    };
    print_kds_chit_with_printer(order, printer, emitter, Some(&job.hardware_instance_id)).await
}

/// Print every routed chit for a batch of orders (best effort, no errors).
pub async fn try_auto_print_kds_chit_jobs(
    orders: &[KdsOrder],
    kds_instance_ids: &[String],
    plan: &Value,
    registry: &oz_hal::DriverRegistry,
    emitter: Option<&Arc<dyn EventSink>>,
) {
    let jobs = build_kds_chit_jobs(orders, kds_instance_ids, plan);
    for job in &jobs {
        let Some(order) = orders.iter().find(|order| order.id == job.order_id) else {
            continue;
        };
        print_kds_chit_job(job, order, registry, emitter).await;
    }
}

/// Try to print kitchen chits for every order in the slice.
///
/// Best-effort: logs failures but does not return errors.
/// Called automatically after KDS order creation.
pub async fn try_auto_print_kds_chits(
    orders: &[KdsOrder],
    registry: &oz_hal::DriverRegistry,
    emitter: Option<&Arc<dyn EventSink>>,
) {
    if orders.is_empty() {
        return;
    }
    for order in orders {
        print_kds_chit_for_order(order, registry, emitter).await;
    }
}

// ── Scoped command bodies ─────────────────────────────────────────

/// List KDS orders for the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:view` gate,
/// store-DB opening and the store query.
pub async fn list_kds_orders_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    status: Option<String>,
) -> Result<Vec<KdsOrder>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let orders = store.list_kds_orders_for_instance(status.as_deref(), &session.instance_id)?;
    drop(db);
    Ok(orders)
}

/// Get the kitchen queue for the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:view` gate,
/// store-DB opening and the store query.
pub async fn get_kds_queue_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    kds_zone: Option<String>,
) -> Result<Vec<KdsOrder>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let orders = store.get_kds_queue_for_instance(kds_zone.as_deref(), &session.instance_id)?;
    drop(db);
    Ok(orders)
}

/// Update the items on a KDS order in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:update` gate,
/// store-DB opening and the store update.
pub async fn update_kds_order_items_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: oz_core::UpdateKdsOrderItemsInput,
) -> Result<KdsOrder, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let order = store.update_kds_order_items_for_instance(args, &session.instance_id)?;
    drop(db);

    // Push real-time update to all KDS displays.
    if let Some(sink) = &ctx.emitter {
        sink.emit("kds:orders-changed", Value::Null);
    }

    Ok(order)
}

/// Update a KDS order's status in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:update` gate,
/// store-DB opening and the store update.
pub async fn update_kds_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
    status: &str,
) -> Result<KdsOrder, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let order = store.update_kds_status_for_instance(id, status, &session.instance_id)?;
    drop(db);

    // Push real-time update to all KDS displays (1a: real-time push).
    if let Some(sink) = &ctx.emitter {
        sink.emit("kds:orders-changed", Value::Null);
    }

    Ok(order)
}

/// Create KDS orders in the store resolved from a session token. ADR #7.
///
/// Passes the session's `store_id` so the KDS order carries store identity
/// for defense-in-depth filtering on KDS tablets (ADR #8). Returns one
/// KDS order per kitchen zone; an empty vec when no restaurant items exist.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:update` gate,
/// the runtime-plan read, store-DB opening and the fan-out write.
pub async fn create_kds_order_from_sale_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
) -> Result<Vec<KdsOrder>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let runtime_plan = {
        let db = ctx.lock_global().await;
        resolve_runtime_kds_plan(&db, &session.store_id)?
    };
    let runtime_targets = runtime_plan
        .as_ref()
        .map(|plan| runtime_kds_target_instances(plan, &session.instance_id));
    // Scope-limit the DB access so Store is dropped before .await.
    let orders = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        if !should_create_kds_tickets(runtime_targets.as_deref()) {
            Vec::new()
        } else {
            let target_instance_ids = runtime_targets.as_deref().unwrap_or(&[]);
            store.complete_sale_to_kds_fanout(
                sale_id,
                Some(&session.store_id),
                target_instance_ids,
            )?
        }
    }; // conn, db, store dropped here

    // Push real-time update to all KDS displays - skip if no kitchen items.
    if !orders.is_empty()
        && let Some(sink) = &ctx.emitter
    {
        sink.emit("kds:orders-changed", Value::Null);
    }

    // Route fan-out chits to the hardware endpoints attached to each KDS
    // target. A missing runtime plan retains the legacy kitchen/default
    // printer fallback.
    if let Some(plan) = runtime_plan.as_ref() {
        try_auto_print_kds_chit_jobs(
            &orders,
            runtime_targets.as_deref().unwrap_or(&[]),
            plan,
            ctx.registry,
            ctx.emitter.as_ref(),
        )
        .await;
    } else {
        try_auto_print_kds_chits(&orders, ctx.registry, ctx.emitter.as_ref()).await;
    }

    Ok(orders)
}

/// Get a KDS order from the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:view` gate,
/// store-DB opening and the store query.
pub async fn get_kds_order_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<KdsOrder>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let order = store.get_kds_order_for_instance(id, &session.instance_id)?;
    drop(db);
    Ok(order)
}

/// Print a kitchen chit for a specific KDS order by ID (scoped - ADR #7).
///
/// Useful for manual re-print from the KDS screen when a chit was lost
/// or damaged. Returns `true` if the chit was printed, `false` if the
/// order was not found or no printer was available.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:update` gate,
/// the runtime-plan read, store-DB opening and the store query.
pub async fn print_kds_chit_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    order_id: &str,
) -> Result<bool, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    // Scope-limit the DB access so Store is dropped before .await.
    let order = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.get_kds_order_for_instance(order_id, &session.instance_id)?
    }; // conn, db, store dropped here

    let Some(order) = order else {
        return Ok(false);
    };

    let runtime_plan = {
        let db = ctx.lock_global().await;
        resolve_runtime_kds_plan(&db, &session.store_id)?
    };
    if let Some(plan) = runtime_plan {
        let kds_instance_ids = vec![session.instance_id.clone()];
        let jobs = build_kds_chit_jobs(std::slice::from_ref(&order), &kds_instance_ids, &plan);
        if !jobs.is_empty() {
            let mut printed = false;
            for job in &jobs {
                printed |=
                    print_kds_chit_job(job, &order, ctx.registry, ctx.emitter.as_ref()).await;
            }
            return Ok(printed);
        }
    }

    let printed = print_kds_chit_for_order(&order, ctx.registry, ctx.emitter.as_ref()).await;
    Ok(printed)
}

/// Get all line items for a KDS order (scoped - ADR #7).
///
/// Returns structured line items with course and modifier data,
/// ordered by course priority then line position.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:view` gate,
/// store-DB opening and the store query.
pub async fn get_kds_order_lines_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    order_id: &str,
) -> Result<Vec<oz_core::KdsLineItem>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_VIEW)
        .await?;
    let order = {
        let conn = ctx
            .db_manager
            .open_store(&session.store_id)
            .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.get_kds_order_lines_for_instance(order_id, &session.instance_id)?
    };
    Ok(order)
}

/// Update the status of a single KDS line item in the store resolved
/// from a session token. ADR #7.
///
/// Returns the updated line item with the new status and timestamp.
///
/// # Errors
///
/// Propagates [`BridgeError`] from session resolution, the `kds:update` gate,
/// store-DB opening and the store update.
pub async fn update_kds_line_item_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    item_id: &str,
    status: &str,
) -> Result<oz_core::KdsLineItem, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::KDS_UPDATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let item =
        store.update_kds_line_item_status_for_instance(item_id, status, &session.instance_id)?;
    drop(db);

    // Push real-time update to all KDS displays.
    if let Some(sink) = &ctx.emitter {
        sink.emit("kds:orders-changed", Value::Null);
    }

    Ok(item)
}
