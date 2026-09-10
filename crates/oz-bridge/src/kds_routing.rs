//! KDS order-routing command bodies (Wave D / D2b) — the tauri-free half of
//! `apps/desktop-client/src/commands/kds_routing.rs`.

//! Resolution is read-only over the store DB and emits nothing: the caller (the
//! Restaurant POS) pushes to the returned device ids itself, so this module has
//! no event-sink use. The pure 3-phase router stays in `oz_core::kds`.

use std::collections::HashMap;

use oz_core::db::Store;
use oz_core::kds::KdsDevice;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Resolve which KDS device IDs should receive an order based on its
/// line items and the registered device station bindings.
///
/// Returns a list of device IDs. The caller is responsible for
/// filtering or pushing events to those devices.
///
/// Uses the 3-phase algorithm from `oz_core::kds::resolve_kds_targets`:
/// 1. Station-based targeting — match line item SKU -> topology station -> device
/// 2. Broadcast fallback — devices with empty station_ids get everything
/// 3. Catch-all — if any station has no claiming device, broadcast to all
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:view`, [`BridgeError::Invalid`]
/// with the exact `KDS order not found: {order_id}` text, and
/// [`BridgeError::Core`] or [`BridgeError::Internal`] for the store access.
pub async fn resolve_kds_targets(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    order_id: &str,
) -> Result<Vec<String>, BridgeError> {
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

    // Validate the order exists and get its line items.
    store
        .get_kds_order(order_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("KDS order not found: {order_id}")))?;
    let line_items = store.get_kds_order_lines(order_id)?;

    // Get active devices for this restaurant.
    // Use session.restaurant_pos_id (set by KDS device sessions) or
    // fall back to the terminal_id (Restaurant POS sessions).
    let resto_id = session
        .restaurant_pos_id
        .as_deref()
        .unwrap_or(&session.terminal_id);
    let devices = store.list_kds_devices_for_restaurant(resto_id)?;

    // Filter to active only.
    let active_devices: Vec<KdsDevice> = devices.into_iter().filter(|d| d.is_active).collect();

    // Build a SKU -> kitchen_zone map from the product catalog.
    // The product `kitchen_zone` field serves as the "station" for routing.
    // Devices declare which zones they handle via `station_ids`.
    let mut sku_to_station: HashMap<String, Option<String>> = HashMap::new();
    for item in &line_items {
        if !sku_to_station.contains_key(&item.sku) {
            let zone = store.product_kitchen_zone_by_sku(&item.sku)?;
            sku_to_station.insert(item.sku.clone(), zone);
        }
    }

    // Use the pure routing function with the real zone lookup.
    let targets = oz_core::kds::resolve_kds_targets(&line_items, &active_devices, |sku| {
        sku_to_station.get(sku).cloned().flatten()
    });

    Ok(targets)
}
