//! Category management Tauri commands.
//!
//! Exposes `list_categories`, `create_category`, `update_category`, and
//! `delete_category` to the front-end so the Category Management UI can
//! display and manipulate product categories.
//!
//! Wave A / S3: the bodies now live in the headless `kasirmu_bridge::categories`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list and `Result<_, AppError>` return so the registered IPC surface and
//! the serialized error shape are unchanged; it borrows a `BridgeCtx` from
//! `AppState`, calls the bridge, and maps `BridgeError` back to `AppError`
//! variant-for-variant. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `categories_tests.rs` still resolves them.
//!
//! The permission gate (F-017) and store resolution run inside the bridge, in
//! the same order as before: resolve the session, authorize against the GLOBAL
//! identity DB, then open the store-scoped connection.

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use kasirmu_core::Store;
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
use tauri::State;

#[allow(unused_imports)]
// sibling categories_tests.rs reaches `permissions` via `use super::*`
use kasirmu_core::permissions;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::categories::{
    CategoryDto, CreateCategoryArgs, CreateCategoryResult, DeleteCategoryArgs,
    DeleteCategoryResult, UpdateCategoryArgs, UpdateCategoryResult,
};

/// Fetch all categories for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_categories_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryDto>, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let ctx = state.bridge_ctx();
    kasirmu_bridge::categories::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Business logic for listing categories (extracted for testing).
///
/// Thin adapter over `kasirmu_bridge::categories::run_list_categories`: the name,
/// parameter list and `Result<_, AppError>` type are unchanged so the sibling
/// test module keeps matching on `AppError::Core`.
#[allow(dead_code)] // retained by the Wave-A extraction contract for sibling tests
fn run_list_categories(conn: &rusqlite::Connection) -> Result<Vec<CategoryDto>, AppError> {
    kasirmu_bridge::categories::run_list_categories(conn).map_err(AppError::from)
}

// ── Create category ──────────────────────────────────────────────────

/// Create category in the store resolved from a session token (CAT-01).
///
/// Resolves the store from the opaque session token and enforces
/// `products:create` on the session user — mirroring the scoped product
/// commands. ADR #7.
#[tauri::command]
pub async fn create_category_scoped(
    session_token: String,
    args: CreateCategoryArgs,
    state: State<'_, AppState>,
) -> Result<CreateCategoryResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::categories::create_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

// ── Update category ──────────────────────────────────────────────────

/// Update a category in the store resolved from a session token (CAT-01).
///
/// Enforces `products:update` on the session user. ADR #7.
#[tauri::command]
pub async fn update_category_scoped(
    session_token: String,
    args: UpdateCategoryArgs,
    state: State<'_, AppState>,
) -> Result<UpdateCategoryResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::categories::update_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

// ── Delete category ──────────────────────────────────────────────────

/// Delete a category in the store resolved from a session token (CAT-01/02).
///
/// Enforces `products:delete` on the session user, then deletes the
/// category with the explicit unlink policy — products in the category are
/// set to `category_id = NULL` in the same transaction, and the number of
/// unlinked products is returned to the UI. ADR #7.
#[tauri::command]
pub async fn delete_category_scoped(
    session_token: String,
    args: DeleteCategoryArgs,
    state: State<'_, AppState>,
) -> Result<DeleteCategoryResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::categories::delete_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}
