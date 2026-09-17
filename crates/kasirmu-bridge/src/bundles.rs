//! Product-bundle command bodies (Wave F) — the tauri-free half of
//! `apps/desktop-client/src/commands/bundles.rs`.
//!
//! All six operations are store-scoped (ADR #7): resolve the scope, enforce
//! the per-domain permission (F-017), then lock the session's own store
//! connection and read or write — the same order and the same number of locks
//! as the shell.

use kasirmu_core::Store;
use kasirmu_core::permissions;
use kasirmu_core::product_bundle::{BundleItem, BundleWithItems, ProductBundle};
use serde::Deserialize;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Arguments for creating a bundle.
#[derive(Debug, Deserialize)]
pub struct CreateBundleArgs {
    /// Bundle Sku.
    pub bundle_sku: String,
    /// Display name.
    pub name: String,
    /// Human-readable description.
    pub description: Option<String>,
    /// Bundle Price Minor.
    pub bundle_price_minor: Option<i64>,
    /// ISO-4217 currency code.
    pub currency: Option<String>,
    /// Items.
    pub items: Vec<CreateBundleItemArg>,
}

#[derive(Debug, Deserialize)]
/// Createbundleitemarg.
pub struct CreateBundleItemArg {
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Quantity.
    pub qty: i64,
    /// Unit Price Minor.
    pub unit_price_minor: Option<i64>,
}

/// Scoped variant of `list_bundles` (ADR #7).
pub async fn list_bundles_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<BundleWithItems>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_bundles()?)
}

/// Scoped variant of `get_bundle` (ADR #7).
pub async fn get_bundle_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<BundleWithItems>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.get_bundle(id)?)
}

/// Scoped variant of `update_bundle` (ADR #7).
pub async fn update_bundle_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    bundle: BundleWithItems,
) -> Result<BundleWithItems, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_UPDATE)
        .await?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let mut updated = bundle.bundle;
    updated.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    Ok(store.update_bundle(&updated, &bundle.items)?)
}

/// Scoped variant of `delete_bundle` (ADR #7).
pub async fn delete_bundle_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_DELETE)
        .await?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_bundle(id)?;
    Ok(())
}

/// Scoped variant of `lookup_bundle_by_sku` (ADR #7).
pub async fn lookup_bundle_by_sku_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sku: &str,
) -> Result<Option<BundleWithItems>, BridgeError> {
    let (session, _conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_READ)
        .await?;
    let db = _conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.get_bundle_by_sku(sku)?)
}

/// Create a new bundle (scoped).
pub async fn create_bundle_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: CreateBundleArgs,
) -> Result<BundleWithItems, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: enforce per-domain permission on this scoped command.
    ctx.require_session_permission(&session, permissions::PRODUCTS_CREATE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let bundle = ProductBundle {
        id: id.clone(),
        bundle_sku: args.bundle_sku,
        name: args.name,
        description: args.description.unwrap_or_default(),
        bundle_price_minor: args.bundle_price_minor,
        currency: args.currency.unwrap_or_else(|| "USD".into()),
        active: true,
        created_at: now.clone(),
        updated_at: now,
    };

    let items: Vec<BundleItem> = args
        .items
        .into_iter()
        .map(|i| BundleItem {
            id: uuid::Uuid::now_v7().to_string(),
            bundle_id: id.clone(),
            sku: i.sku,
            qty: i.qty,
            unit_price_minor: i.unit_price_minor,
        })
        .collect();

    Ok(store.create_bundle(&bundle, &items)?)
}

#[cfg(test)]
#[path = "bundles_tests.rs"]
mod tests;
