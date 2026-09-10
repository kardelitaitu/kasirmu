//! Gift card management — headless command bodies (Wave D / D4b).
//!
//! CRUD operations for gift cards including:
//! - Issue new gift cards with an initial balance
//! - Look up cards by number or ID
//! - List cards with optional filtering
//! - Get current balance
//! - Redeem (spend) card balance at POS
//! - Top up (add value) to existing cards
//! - Freeze/unfreeze cards (e.g., for fraud prevention)
//!
//! Shims in `apps/desktop-client/src/commands/gift_cards.rs` keep the
//! exact `#[tauri::command]` names/signatures/`Result<_, AppError>`
//! wire contract and delegate here.

use serde::Serialize;

use oz_core::db::Store;
use oz_core::gift_card::{
    GiftCard, GiftCardFilter, GiftCardWithTransactions, IssueGiftCardInput, RedeemGiftCardResult,
};
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Result of a balance inquiry for a gift card.
///
/// Returned by `get_gift_card_balance` to show the card's
/// current balance, currency, and active status.
#[derive(Debug, Serialize)]
pub struct BalanceResult {
    /// Current balance in minor units (cents).
    pub balance_minor: i64,
    /// ISO-4217 currency code (e.g., "USD", "IDR").
    pub currency: String,
    /// Card status: "active", "frozen", or "redeemed".
    pub status: String,
}

// ── Scoped variants (ADR #7) ────────────────────────────────────────

/// Issue a new gift card (scoped — requires valid session).
pub async fn issue_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    input: IssueGiftCardInput,
    session_token: &str,
) -> Result<GiftCardWithTransactions, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: issuing/topping up creates stored money — sensitive key.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_ISSUE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.issue_gift_card(input)?;
    drop(db);
    Ok(result)
}

/// Get a gift card by its card number or internal ID (scoped).
pub async fn get_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    session_token: &str,
) -> Result<Option<GiftCardWithTransactions>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: card details are stored-value data — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.get_gift_card_detail(card_number_or_id)?;
    drop(db);
    Ok(result)
}

/// List all gift cards with optional filtering by status (scoped).
pub async fn list_gift_cards_scoped(
    ctx: &BridgeCtx<'_>,
    filter: GiftCardFilter,
    session_token: &str,
) -> Result<Vec<GiftCardWithTransactions>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: the card list exposes stored-value data — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.list_gift_cards(filter)?;
    drop(db);
    Ok(result)
}

/// Get the current balance of a gift card (scoped).
pub async fn get_gift_card_balance_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    session_token: &str,
) -> Result<Option<BalanceResult>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: balance is stored-value data — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.get_gift_card_balance(card_number_or_id)?;
    drop(db);
    Ok(
        result.map(|(balance_minor, currency, status)| BalanceResult {
            balance_minor,
            currency,
            status,
        }),
    )
}

/// Redeem (spend) a gift card balance against a sale (scoped).
pub async fn redeem_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    amount_minor: i64,
    sale_id: &str,
    session_token: &str,
) -> Result<RedeemGiftCardResult, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: redeeming spends stored value — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_REDEEM)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.redeem_gift_card(card_number_or_id, amount_minor, sale_id)?;
    drop(db);
    Ok(result)
}

/// Add value (top up) to an existing gift card (scoped).
pub async fn top_up_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    amount_minor: i64,
    session_token: &str,
) -> Result<GiftCardWithTransactions, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: issuing/topping up creates stored money — sensitive key.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_ISSUE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.top_up_gift_card(card_number_or_id, amount_minor)?;
    drop(db);
    Ok(result)
}

/// Freeze a gift card (scoped).
pub async fn freeze_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    session_token: &str,
) -> Result<GiftCard, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: freeze/unfreeze manage card availability — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.freeze_gift_card(card_number_or_id)?;
    drop(db);
    Ok(result)
}

/// Unfreeze a previously frozen gift card (scoped).
pub async fn unfreeze_gift_card_scoped(
    ctx: &BridgeCtx<'_>,
    card_number_or_id: &str,
    session_token: &str,
) -> Result<GiftCard, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    // F-017: freeze/unfreeze manage card availability — explicit permission.
    ctx.require_session_permission(&session, permissions::GIFTCARDS_MANAGE)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.unfreeze_gift_card(card_number_or_id)?;
    drop(db);
    Ok(result)
}
