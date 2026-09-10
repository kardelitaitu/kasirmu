//! Product variant Tauri commands.
//!
//! CRUD operations for product variants (size, colour, flavour).
//! Each variant is linked to a parent product via `parent_sku` and has
//! its own SKU, optional price override, and barcode.
//!
//! Wave A / S7: the bodies now live in the headless
//! `oz_bridge::product_variants` module. Each `#[tauri::command]` below
//! keeps its exact name, parameter list and `Result<_, AppError>` return so
//! the registered IPC surface and the serialized error shape are unchanged;
//! it borrows a `BridgeCtx` from `AppState`, calls the bridge, and maps
//! `BridgeError` back to `AppError` variant-for-variant. The DTOs moved
//! with the bodies and are re-exported so `use super::*` in
//! `product_variants_tests.rs` still resolves them.
//!
//! The permission gate (F-017) and store resolution run inside the bridge, in
//! the same order as before: validate, resolve the session scope, authorize
//! against the GLOBAL identity DB, then open the store-scoped connection.

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::product_variants::{
    CreateProductVariantArgs, CreateProductVariantResult, MoneyDto, ProductVariantDto,
    UpdateProductVariantArgs, UpdateProductVariantResult,
};

/// Scoped variant of `list_product_variants` (ADR #7).
#[tauri::command]
pub async fn list_product_variants_scoped(
    parent_sku: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductVariantDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::list_scoped(&ctx, &parent_sku, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `get_product_variant` (ADR #7).
#[tauri::command]
pub async fn get_product_variant_scoped(
    sku: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductVariantDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::get_scoped(&ctx, &sku, &session_token)
        .await
        .map_err(Into::into)
}

/// Scoped variant of `delete_product_variant` (ADR #7).
#[tauri::command]
pub async fn delete_product_variant_scoped(
    sku: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::delete_scoped(&ctx, &sku, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a product variant (scoped).
#[tauri::command]
pub async fn create_product_variant_scoped(
    args: CreateProductVariantArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<CreateProductVariantResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::create_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update an existing product variant (scoped).
#[tauri::command]
pub async fn update_product_variant_scoped(
    args: UpdateProductVariantArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<UpdateProductVariantResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::update_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}
