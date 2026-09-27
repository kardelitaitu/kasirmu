//! Stock adjustment: the scoped transaction plus its domain event.
//!
//! Split out of `products.rs` on 2026-09-27. The write and the
//! [`StockAdjusted`] event are emitted inside ONE transaction, so the two halves
//! are kept together here rather than either being reachable alone.
//!
//! Invariant: `INVENTORY_ADJUST` is required before any durable change, and the
//! event is published only after the transaction commits.

use serde::Deserialize;

use foundation::validate_not_empty;
use kasirmu_core::events::StockAdjusted;
use kasirmu_core::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use kasirmu_core::inventory_transaction::InventoryTransactionId;
use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Arguments for a stock adjustment.
#[derive(Debug, Deserialize)]
pub struct AdjustStockArgs {
    /// SKU of the product to adjust.
    pub sku: String,
    /// Quantity change (positive = restock, negative = removal).
    pub delta: i64,
    /// Reason for the adjustment (e.g. "stock-take", "damaged", "return").
    pub reason: String,
}

/// Adjust stock for the store resolved from a session token.
///
/// ADR #7: Scoped variant of the global `adjust_stock`. Resolves the
/// token to a `SessionContext`, opens the store-scoped database, and
/// adjusts stock within that store only. The write runs in a single
/// `unchecked_transaction` and the `StockAdjusted` domain event is
/// published only AFTER the transaction commits.
///
/// # Errors
///
/// Returns [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `inventory:adjust`,
/// [`BridgeError::Invalid`] for empty sku/reason or a zero delta, and
/// [`BridgeError::Internal`]/[`BridgeError::Core`] on DB failures.
pub async fn adjust_stock_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &AdjustStockArgs,
) -> Result<i64, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::INVENTORY_ADJUST)
        .await?;
    validate_not_empty("sku", &args.sku).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| BridgeError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(BridgeError::Invalid("delta must be non-zero".into()));
    }

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let new_qty = {
        let tid = ctx.terminal_id().await;
        let db = conn
            .lock()
            .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
        let store = ctx.store_with_tid(&db, tid);
        let tx = db
            .unchecked_transaction()
            .map_err(|e| BridgeError::Internal(format!("starting tx: {e}")))?;
        let loc = LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID);
        let new_qty = store.adjust_stock_at_location_with_reason(
            &tx,
            &args.sku,
            args.delta,
            &loc,
            Some(&args.reason),
            Some(&InventoryTransactionId::new()),
            Some(&kasirmu_core::terminal::TerminalId::from(
                session.terminal_id.as_str(),
            )),
            Some(&kasirmu_core::user::UserId::from(session.user_id.clone())),
        )?;
        tx.commit()
            .map_err(|e| BridgeError::Internal(format!("commit tx: {e}")))?;
        new_qty
    };

    // Publish the StockAdjusted domain event — AFTER the transaction has
    // committed, so a bus failure can never orphan or undo the write.
    ctx.publish_event(&StockAdjusted {
        sku: args.sku.clone(),
        delta: args.delta,
        new_qty,
        reason: args.reason.clone(),
    })
    .await;

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted (scoped)");
    Ok(new_qty)
}
