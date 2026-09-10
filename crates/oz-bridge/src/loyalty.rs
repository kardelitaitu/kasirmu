//! Loyalty command bodies (Wave B / B2) — the tauri-free half of
//! `apps/desktop-client/src/commands/loyalty.rs`.
//!
//! Key functions: the session-scoped [`get_loyalty_account_scoped`],
//! [`list_loyalty_accounts_scoped`], [`earn_loyalty_points_scoped`],
//! [`redeem_loyalty_points_scoped`], [`list_loyalty_tiers_scoped`],
//! [`update_loyalty_tier_scoped`], [`get_points_value_scoped`] and
//! [`get_or_create_loyalty_account_scoped`] operations, each consuming a
//! [`BridgeCtx`]. There is no `run_*` `&Connection` helper here: the loyalty
//! bodies were logic-inline in the shell, so the store work stays inside the
//! scoped functions.
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use serde::Serialize;

use oz_core::db::Store;
use oz_core::loyalty::{
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
};
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The result of a successful loyalty points redemption.
#[derive(Debug, Serialize)]
pub struct RedeemResult {
    /// The ledger transaction recording the points deduction.
    pub transaction: LoyaltyTransaction,
    /// The calculated discount amount in minor currency units.
    pub discount_minor: i64,
}

/// Local mirror of the private helper in [`crate::ctx`]: the loyalty gates use
/// `Store::require_permission` (not the scope-aware form), so they need the
/// same `PermissionDenied` → [`BridgeError::PermissionDenied`] translation
/// the authz seam applies.
fn map_gate_error(e: oz_core::CoreError) -> BridgeError {
    match e {
        oz_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

/// Verify a loyalty permission against the global identity database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7); loyalty
/// business data is read from the store-scoped connection after this check
/// succeeds. Verbatim port of `require_loyalty_permission` in the desktop
/// command module: same global-DB `Store::new`, same non-scope-aware
/// `require_permission`, so a legacy user without an assignment row keeps
/// behaving exactly as before.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the user is missing,
/// inactive, or the role does not grant `permission`; [`BridgeError::Core`]
/// on DB errors.
pub async fn require_loyalty_permission(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
    permission: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store
        .require_permission(user_id, permission)
        .map_err(map_gate_error)
}

/// Reads one customer loyalty account with tier and balance detail.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:view`; [`BridgeError::Core`]
/// on store errors.
pub async fn get_loyalty_account_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    customer_id: &str,
) -> Result<Option<LoyaltyAccountWithDetails>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.get_loyalty_account(customer_id)?)
}

/// Lists every loyalty account in the session store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:view`; [`BridgeError::Core`]
/// on store errors.
pub async fn list_loyalty_accounts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<LoyaltyAccountWithDetails>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_loyalty_accounts()?)
}

/// Awards points for a completed sale in the session store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:earn`; [`BridgeError::Core`]
/// on store errors.
pub async fn earn_loyalty_points_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    customer_id: &str,
    sale_id: &str,
    total_minor: i64,
) -> Result<LoyaltyTransaction, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_EARN).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.earn_points(customer_id, sale_id, total_minor)?)
}

/// Redeems points against a sale in the session store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:redeem`; [`BridgeError::Core`]
/// on store errors (including an insufficient balance).
pub async fn redeem_loyalty_points_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    customer_id: &str,
    points: i64,
    sale_id: &str,
) -> Result<RedeemResult, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_REDEEM).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let (transaction, discount_minor) = store.redeem_points(customer_id, points, sale_id)?;
    Ok(RedeemResult {
        transaction,
        discount_minor,
    })
}

/// Lists the loyalty tier ladder for the session store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:view`; [`BridgeError::Core`]
/// on store errors.
pub async fn list_loyalty_tiers_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<LoyaltyTier>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.list_tiers()?)
}

/// Updates one loyalty tier in the session store.
///
/// Carries the tier fields through to `Store::update_tier` exactly as the shell
/// did: the tier id stays immutable, the rest is rewritten.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:manage`; [`BridgeError::Core`]
/// on store errors.
pub async fn update_loyalty_tier_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    tier: &LoyaltyTier,
) -> Result<LoyaltyTier, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_MANAGE).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.update_tier(
        &tier.id,
        &tier.name,
        tier.min_points,
        tier.points_per_unit,
        tier.earn_multiplier_millionths,
        &tier.colour,
    )?)
}

/// Converts points into minor currency units for the session store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:view`; [`BridgeError::Core`]
/// on store errors.
pub async fn get_points_value_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    points: i64,
) -> Result<i64, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.get_points_value(points)?)
}

/// Retrieves — creating on first touch — a customer loyalty account.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `loyalty:view`; [`BridgeError::Core`]
/// on store errors.
pub async fn get_or_create_loyalty_account_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    customer_id: &str,
) -> Result<LoyaltyAccount, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_loyalty_permission(ctx, &session.user_id, permissions::LOYALTY_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    Ok(store.get_or_create_loyalty_account(customer_id)?)
}
