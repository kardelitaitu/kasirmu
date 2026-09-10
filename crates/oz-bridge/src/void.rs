//! Void sale command body (Wave D / D4a) — the tauri-free half of
//! `apps/desktop-client/src/commands/void.rs`.
//!
//! Delegates to `Store::void_sale` which handles the status transition,
//! stock restoration, and audit logging inside a single transaction. The
//! shim builds the context, calls [`void_sale_scoped`], and maps
//! [`BridgeError`] back to `AppError` so the wire shape never moves.

use serde::Deserialize;

use oz_core::db::Store;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Voidsaleargs.
pub struct VoidSaleArgs {
    /// ID of the associated sale.
    pub sale_id: String,
    /// ID of the associated user.
    pub user_id: String,
    /// Reason.
    pub reason: String,
}

/// Args for `void_sale_scoped` — identical to `VoidSaleArgs` but without
/// `user_id` (read from the session token instead).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoidSaleScopedArgs {
    /// ID of the associated sale.
    pub sale_id: String,
    /// Reason.
    pub reason: String,
}

/// Void a sale within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `void_sale`. The `user_id` for permission
/// checks and the void operation is read from the resolved `SessionContext`.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `sales:void`, and
/// [`BridgeError::Core`] on store errors.
pub async fn void_sale_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &VoidSaleScopedArgs,
) -> Result<oz_core::Sale, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_VOID)
        .await?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let sale = store.void_sale(&args.sale_id, &session.user_id, &args.reason)?;
    drop(db);

    tracing::info!(sale_id = %args.sale_id, reason = %args.reason, "sale voided (scoped)");
    Ok(sale)
}
