//! Gift card management Tauri commands.
//!
//! Provides CRUD operations for gift cards including:
//! - Issue new gift cards with an initial balance
//! - Look up cards by number or ID
//! - List cards with optional filtering
//! - Get current balance
//! - Redeem (spend) card balance at POS
//! - Top up (add value) to existing cards
//! - Freeze/unfreeze cards (e.g., for fraud prevention)
//!
//! Wave D / D4b: the bodies now live in the headless
//! `kasirmu_bridge::gift_cards` module. Each `#[tauri::command]` below keeps
//! its exact name, parameter list, attributes and `Result<_, AppError>`
//! wire contract; it builds a `BridgeCtx` from `AppState` and
//! delegates, preserving the F-017 comments and gate constants. The
//! `BalanceResult` DTO moved with the bodies and is re-exported so
//! `use super::*` in `gift_cards_tests.rs` still resolves it.

use tauri::State;

use oz_core::gift_card::{
    GiftCard, GiftCardFilter, GiftCardWithTransactions, IssueGiftCardInput, RedeemGiftCardResult,
};

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::gift_cards::BalanceResult;

// ── Scoped variants (ADR #7) ────────────────────────────────────────

/// Issue a new gift card (scoped — requires valid session).
#[tauri::command]
pub async fn issue_gift_card_scoped(
    input: IssueGiftCardInput,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<GiftCardWithTransactions, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::issue_gift_card_scoped(&ctx, input, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a gift card by its card number or internal ID (scoped).
#[tauri::command]
pub async fn get_gift_card_scoped(
    card_number_or_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<GiftCardWithTransactions>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::get_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// List all gift cards with optional filtering by status (scoped).
#[tauri::command]
pub async fn list_gift_cards_scoped(
    filter: GiftCardFilter,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<GiftCardWithTransactions>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::list_gift_cards_scoped(&ctx, filter, &session_token)
        .await
        .map_err(Into::into)
}

/// Get the current balance of a gift card (scoped).
#[tauri::command]
pub async fn get_gift_card_balance_scoped(
    card_number_or_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<BalanceResult>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::get_gift_card_balance_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Redeem (spend) a gift card balance against a sale (scoped).
#[tauri::command]
pub async fn redeem_gift_card_scoped(
    card_number_or_id: String,
    amount_minor: i64,
    sale_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<RedeemGiftCardResult, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::redeem_gift_card_scoped(
        &ctx,
        &card_number_or_id,
        amount_minor,
        &sale_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Add value (top up) to an existing gift card (scoped).
#[tauri::command]
pub async fn top_up_gift_card_scoped(
    card_number_or_id: String,
    amount_minor: i64,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<GiftCardWithTransactions, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::top_up_gift_card_scoped(
        &ctx,
        &card_number_or_id,
        amount_minor,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Freeze a gift card (scoped).
#[tauri::command]
pub async fn freeze_gift_card_scoped(
    card_number_or_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::freeze_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Unfreeze a previously frozen gift card (scoped).
#[tauri::command]
pub async fn unfreeze_gift_card_scoped(
    card_number_or_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::unfreeze_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}
