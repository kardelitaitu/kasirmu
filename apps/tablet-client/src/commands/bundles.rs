//! Product-bundle commands (tablet), all session-scoped.
//!
//! ADR #49: all six bodies are the bridge's. This is the scope-aware shape — the
//! gate is `require_permission_for_session` (ADR #35 D5), the same check as the
//! bridge's `BridgeCtx::require_session_permission`, and the bridge's module
//! documents the same order and the same number of locks as the shell:
//! `resolve_scope` → gate → lock → store call. As in `gift_cards.rs`, the store
//! connection is opened **before** the gate on both sides, so a denied request
//! still opens the store db — preserved, not tidied.
//!
//! Four permissions cover the six doors: `products:read` for the list, get and
//! SKU lookup, `products:create` for creation, `products:update` for updates and
//! `products:delete` for deletion.

use tauri::{State, command};

use oz_core::product_bundle::BundleWithItems;

use crate::error::AppError;
use crate::state::AppState;

// ADR #49: both argument structs are the bridge's, re-exported rather than
// restated. The definitions were identical — same fields, same doc comments, no
// `rename_all` on either — so the wire is unchanged. `bundles_tests.rs` reaches
// `CreateBundleArgs` through `use super::*`, which is why it is re-exported here
// rather than dropped.
pub use kasirmu_bridge::bundles::{CreateBundleArgs, CreateBundleItemArg};

/// List bundles resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn list_bundles_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::list_bundles_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get one bundle resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn get_bundle_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::get_bundle_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Create a bundle resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's, including the two UUIDv7 ids, the RFC-3339
/// millisecond stamps and the `"USD"` default currency.
#[command]
pub async fn create_bundle_scoped(
    session_token: String,
    args: CreateBundleArgs,
    state: State<'_, AppState>,
) -> Result<BundleWithItems, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::create_bundle_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

/// Update a bundle resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's, including the `updated_at` restamp.
#[command]
pub async fn update_bundle_scoped(
    session_token: String,
    bundle: BundleWithItems,
    state: State<'_, AppState>,
) -> Result<BundleWithItems, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::update_bundle_scoped(&ctx, &session_token, bundle)
        .await
        .map_err(Into::into)
}

/// Delete a bundle resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn delete_bundle_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::delete_bundle_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Look a bundle up by SKU, resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn lookup_bundle_by_sku_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<BundleWithItems>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::bundles::lookup_bundle_by_sku_scoped(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "bundles_tests.rs"]
mod tests;
