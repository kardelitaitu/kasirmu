//! KDS order-routing command bodies (Wave D / D2b) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/kds_routing.rs`.

//! Resolution is read-only over the store DB and emits nothing: the caller (the
//! Restaurant POS) pushes to the returned device ids itself, so this module has
//! no event-sink use. The pure 3-phase router stays in `kasirmu_core::kds`.
//! Routing rules (`kds_routing_rules`, todo-kds-agents-1) compose ON TOP of the
//! zone router per line; `get`/`save` manage the per-restaurant rule sets.

use std::collections::HashMap;

use kasirmu_core::db::Store;
use kasirmu_core::kds::{KdsDevice, KdsRoutingRule, KdsRoutingRuleInput, KdsRuleMatcher};
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The Restaurant POS scope of a session: KDS device sessions carry
/// `restaurant_pos_id` directly; Restaurant POS sessions fall back to
/// their `terminal_id` (same resolution as device listing).
fn session_restaurant_pos_id(session: &SessionContext) -> &str {
    session
        .restaurant_pos_id
        .as_deref()
        .unwrap_or(&session.terminal_id)
}

/// Resolve which KDS device IDs should receive an order based on its
/// line items, the restaurant's active routing rules, and the registered
/// device station bindings.
///
/// Returns a list of device IDs. The caller is responsible for
/// filtering or pushing events to those devices.
///
/// Rules (the `kds_routing_rules` set for this restaurant) supply the
/// station for the lines they match — highest-ranked active rule wins per
/// line — and everything else falls back to the product `kitchen_zone`.
/// An empty rule set leaves routing identical to the frozen 3-phase
/// algorithm of `kasirmu_core::kds::resolve_kds_targets`:
/// 1. Station-based targeting — match line item → (rule station | zone) -> device
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
    let resto_id = session_restaurant_pos_id(&session);
    let devices = store.list_kds_devices_for_restaurant(resto_id)?;

    // Filter to active only.
    let active_devices: Vec<KdsDevice> = devices.into_iter().filter(|d| d.is_active).collect();

    // Explicit per-line station assignment composed over the zone default.
    // Empty rule set (the common case, and every deployment before the
    // rules table had data) keeps the outcome identical to the frozen
    // zone-only routing — pinned by resolve_without_rules_is_zone_only.
    let rules = store.list_kds_routing_rules(resto_id)?;

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

    // The category-matcher's fact source, built only when a live category
    // rule exists — `Tag` rules never match while tags are unmodeled, and
    // `Sku` rules need no catalog lookup at all.
    let needs_categories = rules
        .iter()
        .any(|r| r.is_active && matches!(r.matcher, KdsRuleMatcher::Category));
    let mut sku_to_category: HashMap<String, Option<String>> = HashMap::new();
    if needs_categories {
        for item in &line_items {
            if !sku_to_category.contains_key(&item.sku) {
                let category = store.product_category_id_by_sku(&item.sku)?;
                sku_to_category.insert(item.sku.clone(), category);
            }
        }
    }

    // Use the pure routing function with the real lookups.
    let targets = kasirmu_core::kds::resolve_kds_targets_with_rules(
        &line_items,
        &active_devices,
        &rules,
        |sku| sku_to_station.get(sku).cloned().flatten(),
        |sku| sku_to_category.get(sku).cloned().flatten(),
    );

    Ok(targets)
}

/// List the KDS routing rules of the session's restaurant, highest
/// priority first (lower number = higher priority).
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:view`, and
/// [`BridgeError::Internal`] for the store access.
pub async fn get_kds_routing_rules(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<KdsRoutingRule>, BridgeError> {
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
    let resto_id = session_restaurant_pos_id(&session);

    let rules = store.list_kds_routing_rules(resto_id)?;
    Ok(rules)
}

/// Replace the complete KDS routing rule set of the session's restaurant.
///
/// The submitted list is the new truth (saving `[]` clears the scope);
/// ids and timestamps are server-assigned and the whole replace runs in
/// one store transaction (`Store::save_kds_routing_rules`). Returns the
/// persisted rules as listed afterwards.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`] for a dead token,
/// [`BridgeError::PermissionDenied`] without `kds:update`,
/// [`BridgeError::Core`] for a rejected rule (blank matcher value /
/// target station), and [`BridgeError::Internal`] for the store access.
pub async fn save_kds_routing_rules(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    rules: Vec<KdsRoutingRuleInput>,
) -> Result<Vec<KdsRoutingRule>, BridgeError> {
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
    let resto_id = session_restaurant_pos_id(&session);

    let saved = store.save_kds_routing_rules(resto_id, &rules)?;
    Ok(saved)
}

#[cfg(test)]
#[path = "kds_routing_tests.rs"]
mod kds_routing_tests;
