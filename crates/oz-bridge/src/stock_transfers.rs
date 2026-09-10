//! Stock-transfer command bodies (Wave C / C3) — the tauri-free half of
//! `apps/desktop-client/src/commands/stock_transfers.rs`.
//!
//! Key functions: the session-scoped [`create_stock_transfer_scoped`],
//! [`get_stock_transfer_scoped`], [`list_stock_transfers_scoped`],
//! [`list_in_transit_transfers_scoped`],
//! [`get_stock_transfer_lines_scoped`], [`add_stock_transfer_line_scoped`],
//! [`remove_stock_transfer_line_scoped`], [`send_stock_transfer_scoped`],
//! [`receive_stock_transfer_scoped`] and [`cancel_stock_transfer_scoped`]
//! operations, each consuming a [`BridgeCtx`]. There is no `run_*`
//! `&Connection` helper here: the transfer bodies were logic-inline in the
//! shell, so the store work stays inside the scoped functions.
//!
//! Gate order, store construction (`Store::new`, cache-free — as the shell
//! used) and error paths are verbatim ports of the command bodies: a shim
//! builds the context, calls one function here, and maps [`BridgeError`]
//! back to `AppError` so the wire shape never moves.

use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::stock_transfer::{StockTransfer, StockTransferLine};
use rusqlite::Connection;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// A received quantity for a single transfer line.
#[derive(Debug, Deserialize)]
pub struct ReceivedLineInput {
    /// ID of the associated line.
    pub line_id: String,
    /// Received Qty.
    pub received_qty: i64,
}

#[derive(Debug, Serialize)]
/// Transferwithlines.
pub struct TransferWithLines {
    /// Transfer.
    pub transfer: StockTransfer,
    /// Lines.
    pub lines: Vec<StockTransferLine>,
}

/// Local mirror of the private helper in [`crate::ctx`]: the transfer gate
/// uses `Store::require_permission` (not the scope-aware form), so it needs
/// the same `PermissionDenied` → [`BridgeError::PermissionDenied`]
/// translation the authz seam applies.
fn map_gate_error(e: oz_core::CoreError) -> BridgeError {
    match e {
        oz_core::CoreError::PermissionDenied(message) => BridgeError::PermissionDenied(message),
        other => BridgeError::from(other),
    }
}

/// Verify an inventory-transfer permission against the global identity
/// database.
///
/// Users and roles are global authentication records (ADR #4 / ADR #7);
/// transfer business data is read from the store-scoped connection after this
/// check succeeds. Verbatim port of `require_inventory_permission` in the
/// desktop command module: same global-DB `Store::new`, same non-scope-aware
/// `require_permission`, so a legacy user without an assignment row keeps
/// behaving exactly as before.
///
/// # Errors
///
/// Returns [`BridgeError::PermissionDenied`] when the user is missing,
/// inactive, or the role does not grant `inventory:transfer`;
/// [`BridgeError::Core`] on DB errors.
pub async fn require_inventory_permission(
    ctx: &BridgeCtx<'_>,
    user_id: &str,
) -> Result<(), BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    store
        .require_permission(user_id, permissions::INVENTORY_TRANSFER)
        .map_err(map_gate_error)
}

/// Validate that a client-supplied location belongs to this store database.
fn validate_location(
    db: &Connection,
    location_id: Option<&str>,
    field: &'static str,
) -> Result<(), BridgeError> {
    let Some(location_id) = location_id else {
        return Ok(());
    };
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM inventory_locations WHERE id = ?1 AND is_active = 1)",
        [location_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(BridgeError::Invalid(format!(
            "{field} location '{location_id}' is not active in the current store"
        )))
    }
}

/// Validate an optional terminal identifier against the active terminals in
/// the resolved store database. Transfer terminal foreign keys are
/// store-local.
fn validate_terminal(
    db: &Connection,
    terminal_id: Option<&str>,
    field: &'static str,
) -> Result<(), BridgeError> {
    let Some(terminal_id) = terminal_id else {
        return Ok(());
    };
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM terminals WHERE id = ?1 AND is_active = 1)",
        [terminal_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(BridgeError::Invalid(format!(
            "{field} terminal '{terminal_id}' is not active in the current store"
        )))
    }
}

/// Create a stock transfer in the store resolved from the session token.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] for an unknown or expired token;
/// [`BridgeError::PermissionDenied`] without `inventory:transfer`;
/// [`BridgeError::Invalid`] for an inactive source/destination location or
/// terminal; [`BridgeError::Core`] on store errors.
#[allow(clippy::too_many_arguments)]
pub async fn create_stock_transfer_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    source_location: Option<&str>,
    destination_location: Option<&str>,
    source_terminal_id: Option<&str>,
    destination_terminal_id: Option<&str>,
    notes: &str,
    lines: &[StockTransferLine],
) -> Result<StockTransfer, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    validate_location(&db, source_location, "source")?;
    validate_location(&db, destination_location, "destination")?;
    validate_terminal(&db, source_terminal_id, "source")?;
    validate_terminal(&db, destination_terminal_id, "destination")?;
    let store = Store::new(&db);
    Ok(store.create_transfer(
        source_location,
        destination_location,
        source_terminal_id,
        destination_terminal_id,
        notes,
        &session.user_id,
        lines,
    )?)
}

/// Get a stock transfer from the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn get_stock_transfer_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<TransferWithLines>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let transfer = store.get_transfer(id)?;
    let lines = if transfer.is_some() {
        store.get_transfer_lines(id)?
    } else {
        vec![]
    };
    Ok(transfer.map(|t| TransferWithLines { transfer: t, lines }))
}

/// List stock transfers from the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn list_stock_transfers_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<StockTransfer>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).list_transfers()?)
}

/// List in-transit transfers with their line items in one batch request.
///
/// The transit audit screen previously listed all transfers and then fetched
/// lines one transfer at a time (N+1). This command returns the lines in two
/// SQL queries so the whole audit view loads in a single IPC round-trip.
///
/// The status filter is intentionally `in_transit` only: this mirrors the
/// legacy screen's behavior, and partially-received transfers (`received_partial`)
/// continue to be received on the StockTransfersScreen, not the transit audit.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn list_in_transit_transfers_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<TransferWithLines>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db)
        .list_transfers_with_lines_by_status("in_transit")?
        .into_iter()
        .map(|(transfer, lines)| TransferWithLines { transfer, lines })
        .collect())
}

/// Get transfer lines from the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn get_stock_transfer_lines_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transfer_id: &str,
) -> Result<Vec<StockTransferLine>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).get_transfer_lines(transfer_id)?)
}

/// Add a transfer line in the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn add_stock_transfer_line_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    transfer_id: &str,
    sku: &str,
    product_name: &str,
    qty: i64,
) -> Result<StockTransferLine, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).add_transfer_line(transfer_id, sku, product_name, qty)?)
}

/// Remove a transfer line in the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn remove_stock_transfer_line_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    line_id: &str,
) -> Result<(), BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Store::new(&db).remove_transfer_line(line_id)?;
    Ok(())
}

/// Send a transfer in the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn send_stock_transfer_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<StockTransfer, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).send_transfer(id)?)
}

/// Receive a transfer, attributing the actor to the authenticated session.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn receive_stock_transfer_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
    received_lines: &[ReceivedLineInput],
) -> Result<StockTransfer, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let received_lines = received_lines
        .iter()
        .map(|line| oz_core::db::stock_transfers::ReceivedLine {
            line_id: line.line_id.clone(),
            received_qty: line.received_qty,
        })
        .collect::<Vec<_>>();
    Ok(Store::new(&db).receive_transfer(id, &session.user_id, &received_lines)?)
}

/// Cancel a transfer in the session-scoped store.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`], [`BridgeError::PermissionDenied`] or
/// [`BridgeError::Core`] on store errors.
pub async fn cancel_stock_transfer_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<StockTransfer, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    require_inventory_permission(ctx, &session.user_id).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).cancel_transfer(id)?)
}
