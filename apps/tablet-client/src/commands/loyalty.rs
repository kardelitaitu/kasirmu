//! Loyalty commands: accounts, points and tiers.
//!
//! Every body delegates to `kasirmu_bridge::loyalty` (ADR #49), and so does the
//! `RedeemResult` DTO: it is re-exported from the bridge rather than defined
//! twice, after checking both fields against the copy this shell used to own.
//!
//! The gate is this module's domain helper, `require_loyalty_permission`, which
//! the registration-gate classifier counts as a gate (it is in `GUARD_MARKERS`
//! at `registration_gate_tests.rs:326`) — so all eight doors were already
//! `Gated` and this port is ledger-neutral. The helper runs the **unscoped**
//! `Store::require_permission` against the GLOBAL identity DB, and it runs
//! *after* `resolve_scope` has already opened the session's store connection:
//! the bridge reproduces both, in that order.

use tauri::{State, command};

use oz_core::loyalty::{
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
};

pub use kasirmu_bridge::loyalty::RedeemResult;

use crate::error::AppError;
use crate::state::AppState;

/// Retrieves a loyalty account from the store resolved by the active session.
#[command]
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
#[command]
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
#[command]
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
#[command]
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
#[command]
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
#[command]
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
#[command]
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
#[command]
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

/// Verify a loyalty permission against the global identity database.
///
/// Users and roles are global authentication records; loyalty business data
/// is read from the store-scoped connection after this check succeeds.
///
/// Kept only as a test seam: the doors above reach the bridge directly, and
/// this forwards rather than re-implements so the assertions in
/// `loyalty_tests.rs` still observe the production gate — including the
/// `From<BridgeError> for AppError` translation that turns a
/// `CoreError::PermissionDenied` into the `AppError::PermissionDenied` they
/// match on.
#[cfg(test)]
async fn require_loyalty_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::loyalty::require_loyalty_permission(&ctx, user_id, permission)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "loyalty_tests.rs"]
mod tests;
