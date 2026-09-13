//! Product catalog commands.
//!
//! `list_products_scoped` fetches all products with category names and stock
//! quantities from the database and returns them as a JSON array.
//! The front-end uses this to populate the product grid.
//!
//! Wave A / S9a + S9b: the bodies now live in the headless
//! `oz_bridge::products` module (reads landed in S9a, the write bodies with
//! their transactions and `StockAdjusted`/`ProductCreated` domain events
//! in S9b). Each `#[tauri::command]` below keeps its exact name, parameter
//! list and `Result<_, AppError>` return so the registered IPC surface and
//! the serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `products_tests.rs` still resolves them.

use tauri::State;

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use oz_core::Store;
#[allow(unused_imports)]
// sibling products_tests.rs reaches `permissions` via `use super::*`
use oz_core::permissions;
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::products::{
    AdjustStockArgs, CreateProductArgs, CreateProductResult, CreateProductScopedArgs,
    DeleteProductArgs, DeleteProductScopedArgs, MoneyDto, ProductDto, SerialTrackRow,
    UpdateProductArgs, UpdateProductResult, UpdateProductScopedArgs,
};

// ── Adjust stock ────────────────────────────────────────────────────

/// Adjust stock for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `adjust_stock`. The write and the
/// `StockAdjusted` domain event (published only after the transaction
/// commits) run inside the bridge.
#[tauri::command]
pub async fn adjust_stock_scoped(
    session_token: String,
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::adjust_stock_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Fetch all products for the store resolved from a session token.
///
/// ADR #4 / ADR #7 canonical pattern: The frontend passes an opaque
/// `session_token` (obtained from `create_session`). The backend
/// resolves it to a `SessionContext` containing `store_id`, then
/// opens the store-scoped database and queries only that store's
/// products.
///
/// This is the reference implementation for all store-scoped domain
/// commands. New commands should follow this pattern.
#[tauri::command]
pub async fn list_products_scoped(
    state: State<'_, AppState>,
    session_token: String,
) -> Result<Vec<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Business logic for listing products (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_list_products`: the name,
/// parameter list and `Result<_, AppError>` type are unchanged so the
/// sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_list_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    oz_bridge::products::run_list_products(conn).map_err(AppError::from)
}

/// Fetch inventory-tracked products with stock at a specific location.
///
/// Used by the warehouse workspace to show per-location stock levels.
/// The `location_id` is the bound warehouse location from the topology
/// editor (workspace_instances → inventory_locations).
#[tauri::command]
pub async fn list_warehouse_products_at_location(
    state: State<'_, AppState>,
    session_token: String,
    location_id: String,
) -> Result<Vec<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::list_warehouse_products_at_location(&ctx, &session_token, &location_id)
        .await
        .map_err(Into::into)
}

// ── Lookup by barcode ────────────────────────────────────────────────

/// Look up a product by barcode for the store resolved from a
/// session token. ADR #7 scoped variant.
#[tauri::command]
pub async fn lookup_by_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::lookup_by_barcode(&ctx, &session_token, &barcode)
        .await
        .map_err(Into::into)
}

/// Business logic for barcode lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_lookup_by_barcode`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so
/// the sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_lookup_by_barcode(
    conn: &rusqlite::Connection,
    barcode: &str,
) -> Result<Option<ProductDto>, AppError> {
    oz_bridge::products::run_lookup_by_barcode(conn, barcode).map_err(AppError::from)
}

/// Look up a product by SKU for the store resolved from a
/// session token. ADR #7 scoped variant.
#[tauri::command]
pub async fn lookup_product_by_sku_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::lookup_product_by_sku(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

/// Business logic for SKU lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_lookup_product_by_sku`:
/// the name, parameter list and `Result<_, AppError>` type are unchanged
/// so the sibling test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_lookup_product_by_sku(
    conn: &rusqlite::Connection,
    sku: &str,
) -> Result<Option<ProductDto>, AppError> {
    oz_bridge::products::run_lookup_product_by_sku(conn, sku).map_err(AppError::from)
}

// ── Create product ──────────────────────────────────────────────────

/// Create a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `create_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`,
/// not passed as a frontend parameter. The product is created in
/// the store-scoped database for the session's `store_id`. The
/// `ProductCreated` domain event is published inside the bridge.
#[tauri::command]
pub async fn create_product_scoped(
    session_token: String,
    args: CreateProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::create_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

// ── Update product ──────────────────────────────────────────────────

/// Update a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `update_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
#[tauri::command]
pub async fn update_product_scoped(
    session_token: String,
    args: UpdateProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::update_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Check whether a product tracks serial numbers, store-scoped. ADR #7.
#[tauri::command]
pub async fn get_product_track_serial_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::get_product_track_serial(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

/// Store-scoped batch variant of `get_product_track_serial_batch`. ADR #7.
#[tauri::command]
pub async fn get_product_track_serial_batch_scoped(
    session_token: String,
    skus: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SerialTrackRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::get_product_track_serial_batch(&ctx, &session_token, &skus)
        .await
        .map_err(Into::into)
}

/// Business logic for the batch serial-tracking lookup (extracted for testing).
///
/// Thin adapter over `oz_bridge::products::run_get_product_track_serial_batch`:
/// the name, parameter list and `Vec<SerialTrackRow>` return are unchanged
/// so the sibling test module keeps its assertions.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_get_product_track_serial_batch(store: &Store<'_>, skus: &[String]) -> Vec<SerialTrackRow> {
    oz_bridge::products::run_get_product_track_serial_batch(store, skus)
}

// ── Popularity search signal (ADR #37) ──────────────────────────────

/// Record an acted-upon product search for the popularity index.
///
/// ADR #37 D2: only searches that end in an add-to-cart count — raw
/// search counts are polluted by typos and "do you have…" lookups, so
/// the UI fires this event when a search result is actually added.
///
/// Fire-and-forget from the frontend: the response is `()` and failures
/// are logged, never surfaced.
#[tauri::command]
pub async fn record_product_search_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::record_product_search(&ctx, &session_token, &sku)
        .await
        .map_err(Into::into)
}

// ── Delete product ──────────────────────────────────────────────────

/// Delete a product within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `delete_product`. The `user_id` for
/// permission checks is read from the resolved `SessionContext`.
#[tauri::command]
pub async fn delete_product_scoped(
    session_token: String,
    args: DeleteProductScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::products::delete_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}
