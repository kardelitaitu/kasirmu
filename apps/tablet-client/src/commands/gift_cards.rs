//! Gift-card commands (tablet), all session-scoped.
//!
//! ADR #49: all eight bodies are the bridge's. This is the scope-aware shape —
//! the gate is `require_permission_for_session` (ADR #35 D5), which is the same
//! check as the bridge's `BridgeCtx::require_session_permission`, and the bridge's
//! module reproduces the shell's order verbatim: `resolve_scope` → gate → lock →
//! store call. Note the store connection is opened **before** the gate in both, so
//! a denied request still opens the store db; that ordering is preserved rather
//! than tidied.
//!
//! The three permissions are the shell's own: `giftcards:issue` for issuing and
//! topping up (stored money being created), `giftcards:manage` for detail, list,
//! balance, freeze and unfreeze, and `giftcards:redeem` for redemption.

use tauri::{State, command};

use oz_core::gift_card::{
    GiftCard, GiftCardFilter, GiftCardWithTransactions, IssueGiftCardInput, RedeemGiftCardResult,
};

use crate::error::AppError;
use crate::state::AppState;

// ADR #49: the DTO is the bridge's, re-exported rather than restated. The two
// definitions differed only in doc-comment wording — same three fields, same
// `#[derive(Debug, Serialize)]`, and **no `rename_all` on either side** — so the
// wire stays snake_case and `gift_cards_tests.rs`, which reaches it through
// `use super::*`, sees no change.
pub use kasirmu_bridge::gift_cards::BalanceResult;

/// Issue a gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn issue_gift_card_scoped(
    session_token: String,
    input: IssueGiftCardInput,
    state: State<'_, AppState>,
) -> Result<GiftCardWithTransactions, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::issue_gift_card_scoped(&ctx, input, &session_token)
        .await
        .map_err(Into::into)
}

/// Get one gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn get_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<Option<GiftCardWithTransactions>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::get_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// List gift cards resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn list_gift_cards_scoped(
    session_token: String,
    filter: GiftCardFilter,
    state: State<'_, AppState>,
) -> Result<Vec<GiftCardWithTransactions>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::list_gift_cards_scoped(&ctx, filter, &session_token)
        .await
        .map_err(Into::into)
}

/// Read a gift card balance resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's, including the `(balance, currency, status)`
/// tuple unpacking into `BalanceResult`.
#[command]
pub async fn get_gift_card_balance_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<Option<BalanceResult>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::get_gift_card_balance_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Redeem a gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn redeem_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    amount_minor: i64,
    sale_id: String,
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

/// Top up a gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn top_up_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    amount_minor: i64,
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

/// Freeze a gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn freeze_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::freeze_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

/// Unfreeze a gift card resolved from a session token. ADR #7.
///
/// ADR #49: the body is the bridge's.
#[command]
pub async fn unfreeze_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::gift_cards::unfreeze_gift_card_scoped(&ctx, &card_number_or_id, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "gift_cards_tests.rs"]
mod tests;
