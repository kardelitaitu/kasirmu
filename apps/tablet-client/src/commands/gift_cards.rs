use serde::Serialize;
use tauri::{State, command};

use oz_core::db::Store;
use oz_core::gift_card::{
    GiftCard, GiftCardFilter, GiftCardWithTransactions, IssueGiftCardInput, RedeemGiftCardResult,
};
use oz_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
/// Balanceresult.
pub struct BalanceResult {
    /// Balance Minor.
    pub balance_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Current status.
    pub status: String,
}

/// Issue a gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn issue_gift_card_scoped(
    session_token: String,
    input: IssueGiftCardInput,
    state: State<'_, AppState>,
) -> Result<GiftCardWithTransactions, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_ISSUE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.issue_gift_card(input)?;
    drop(db);
    Ok(result)
}

/// Get one gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<Option<GiftCardWithTransactions>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.get_gift_card_detail(&card_number_or_id)?;
    drop(db);
    Ok(result)
}

/// List gift cards resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_gift_cards_scoped(
    session_token: String,
    filter: GiftCardFilter,
    state: State<'_, AppState>,
) -> Result<Vec<GiftCardWithTransactions>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.list_gift_cards(filter)?;
    drop(db);
    Ok(result)
}

/// Read a gift card balance resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_gift_card_balance_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<Option<BalanceResult>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.get_gift_card_balance(&card_number_or_id)?;
    drop(db);
    Ok(
        result.map(|(balance_minor, currency, status)| BalanceResult {
            balance_minor,
            currency,
            status,
        }),
    )
}

/// Redeem a gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn redeem_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    amount_minor: i64,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<RedeemGiftCardResult, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_REDEEM).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.redeem_gift_card(&card_number_or_id, amount_minor, &sale_id)?;
    drop(db);
    Ok(result)
}

/// Top up a gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn top_up_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    amount_minor: i64,
    state: State<'_, AppState>,
) -> Result<GiftCardWithTransactions, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_ISSUE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.top_up_gift_card(&card_number_or_id, amount_minor)?;
    drop(db);
    Ok(result)
}

/// Freeze a gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn freeze_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.freeze_gift_card(&card_number_or_id)?;
    drop(db);
    Ok(result)
}

/// Unfreeze a gift card resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn unfreeze_gift_card_scoped(
    session_token: String,
    card_number_or_id: String,
    state: State<'_, AppState>,
) -> Result<GiftCard, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::GIFTCARDS_MANAGE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.unfreeze_gift_card(&card_number_or_id)?;
    drop(db);
    Ok(result)
}

#[cfg(test)]
#[path = "gift_cards_tests.rs"]
mod tests;
