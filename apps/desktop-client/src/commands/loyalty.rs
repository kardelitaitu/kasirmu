//! Loyalty commands: accounts, tiers, earning and redeeming points.
//!
//! Wave B / B2: the bodies now live in the headless `kasirmu_bridge::loyalty`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! [`crate::state::AppState::bridge_ctx`] and delegates. The global-identity
//! gate (`loyalty:view` / `loyalty:earn` / `loyalty:redeem` /
//! `loyalty:manage`) runs inside the bridge, in the same order as before.

use tauri::State;

// Retained for the sibling test module, which reaches these through its
// glob import of this module; the command bodies no longer name them.
#[allow(unused_imports)]
use oz_core::db::Store;
use oz_core::loyalty::{
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
};

use crate::error::AppError;
use crate::state::AppState;

// Retained for the sibling test module (gate keys);
// the shims no longer name the permission constants.
#[allow(unused_imports)]
use oz_core::permissions;

pub use kasirmu_bridge::loyalty::RedeemResult;

/// Verify a loyalty permission against the global identity database.
///
/// Thin adapter over `kasirmu_bridge::loyalty::require_loyalty_permission`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so the
/// sibling test module keeps exercising the global-identity-DB gate (ADR #4 /
/// ADR #7) through `AppState`.
#[allow(dead_code)] // retained by the Wave-B extraction contract for sibling tests
async fn require_loyalty_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::require_loyalty_permission(&ctx, user_id, permission)
        .await
        .map_err(AppError::from)
}

/// Retrieves a loyalty account from the store resolved by the active session.
#[tauri::command]
pub async fn get_loyalty_account_scoped(
    session_token: String,
    customer_id: String,
    state: State<'_, AppState>,
) -> Result<Option<LoyaltyAccountWithDetails>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::get_loyalty_account_scoped(&ctx, &session_token, &customer_id)
        .await
        .map_err(Into::into)
}

/// Lists loyalty accounts from the store resolved by the active session.
#[tauri::command]
pub async fn list_loyalty_accounts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LoyaltyAccountWithDetails>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::list_loyalty_accounts_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Awards loyalty points in the store resolved by the active session.
#[tauri::command]
pub async fn earn_loyalty_points_scoped(
    session_token: String,
    customer_id: String,
    sale_id: String,
    total_minor: i64,
    state: State<'_, AppState>,
) -> Result<LoyaltyTransaction, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::earn_loyalty_points_scoped(
        &ctx,
        &session_token,
        &customer_id,
        &sale_id,
        total_minor,
    )
    .await
    .map_err(Into::into)
}

/// Redeems loyalty points in the store resolved by the active session.
#[tauri::command]
pub async fn redeem_loyalty_points_scoped(
    session_token: String,
    customer_id: String,
    points: i64,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<RedeemResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::redeem_loyalty_points_scoped(
        &ctx,
        &session_token,
        &customer_id,
        points,
        &sale_id,
    )
    .await
    .map_err(Into::into)
}

/// Lists loyalty tiers from the store resolved by the active session.
#[tauri::command]
pub async fn list_loyalty_tiers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<LoyaltyTier>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::list_loyalty_tiers_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Updates a loyalty tier in the store resolved by the active session.
#[tauri::command]
pub async fn update_loyalty_tier_scoped(
    session_token: String,
    tier: LoyaltyTier,
    state: State<'_, AppState>,
) -> Result<LoyaltyTier, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::update_loyalty_tier_scoped(&ctx, &session_token, &tier)
        .await
        .map_err(Into::into)
}

/// Converts loyalty points into minor currency units in the active store.
#[tauri::command]
pub async fn get_points_value_scoped(
    session_token: String,
    points: i64,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::get_points_value_scoped(&ctx, &session_token, points)
        .await
        .map_err(Into::into)
}

/// Retrieves or creates a loyalty account in the active store.
#[tauri::command]
pub async fn get_or_create_loyalty_account_scoped(
    session_token: String,
    customer_id: String,
    state: State<'_, AppState>,
) -> Result<LoyaltyAccount, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::get_or_create_loyalty_account_scoped(&ctx, &session_token, &customer_id)
        .await
        .map_err(Into::into)
}
