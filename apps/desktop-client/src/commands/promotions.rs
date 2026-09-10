//! Promotion management commands.
//!
//! CRUD for promotion rules and recording promotion applications against sales.
//!
//! Wave D / D4b: the bodies now live in the headless
//! `oz_bridge::promotions` module. Each `#[tauri::command]` below keeps
//! its exact name, parameter list, attributes and `Result<_, AppError>`
//! wire contract; it builds a `BridgeCtx` from `AppState` and
//! delegates, preserving the shell's deliberate gate asymmetry
//! (list/get/get_sale_promotions ungated; create/update/delete/apply
//! gated + open-store path) and the PROMO-3/4 atomic apply comment. The
//! args DTO moved with the bodies and is re-exported so `use super::*`
//! in `promotions_tests.rs` still resolves it.

use tauri::State;

use oz_core::{Promotion, PromotionApplication};

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::promotions::CreatePromotionArgs;

/// List promotions for the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn list_promotions_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<Promotion>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::list_promotions_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a promotion from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_promotion_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Promotion>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::get_promotion_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Create a promotion in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn create_promotion_scoped(
    session_token: String,
    args: CreatePromotionArgs,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::create_promotion_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update a promotion in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_promotion_scoped(
    session_token: String,
    promotion: Promotion,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::update_promotion_scoped(&ctx, &session_token, promotion)
        .await
        .map_err(Into::into)
}

/// Delete a promotion in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_promotion_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::delete_promotion_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

/// Apply a promotion in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn apply_promotion_scoped(
    session_token: String,
    sale_id: String,
    promotion_id: String,
    state: State<'_, AppState>,
) -> Result<PromotionApplication, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::apply_promotion_scoped(&ctx, &session_token, &sale_id, &promotion_id)
        .await
        .map_err(Into::into)
}

/// Apply a promotion against a store-scoped database connection.
/// Scoped commands authorize the session against the global identity DB
/// before opening the store connection, then call this business path.
#[allow(dead_code)]
fn run_apply_promotion_unchecked(
    db: &rusqlite::Connection,
    sale_id: &str,
    promotion_id: &str,
) -> Result<PromotionApplication, AppError> {
    oz_bridge::promotions::apply_promotion_unchecked(db, sale_id, promotion_id)
        .map_err(AppError::from)
}

/// Get sale promotions from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn get_sale_promotions_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PromotionApplication>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::promotions::get_sale_promotions_scoped(&ctx, &session_token, &sale_id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "promotions_tests.rs"]
mod tests;
