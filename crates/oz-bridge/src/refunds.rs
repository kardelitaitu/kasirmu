//! Refund command bodies (Wave D / D4a) — the tauri-free half of
//! `apps/desktop-client/src/commands/refunds.rs`.
//!
//! Process refunds against completed sales, receipt-barcode lookup, and
//! per-sale refund listings, each consuming a [`BridgeCtx`]. The shell's
//! `run_process_refund_unchecked` business path moved here as
//! [`process_refund_unchecked`] (the desktop file keeps an `AppError`
//! adapter of the same name for its test mount); the scoped commands
//! resolve + authorize then delegate to it.
//!
//! Gate order, validation, and error paths are verbatim ports of the
//! command bodies: a shim builds the context, calls one function here, and
//! maps [`BridgeError`] back to `AppError` so the wire shape never moves.
//! Refund total arithmetic still refuses to silently fall back to the sale
//! currency (`collect::<Result>` for currency parsing, `checked_add` for
//! the total).

use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::{Money, Refund, RefundLine, Sale};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Refundlinearg.
pub struct RefundLineArg {
    /// ID of the associated sale line.
    pub sale_line_id: String,
    /// Stock-keeping unit identifier.
    pub sku: String,
    /// Quantity.
    pub qty: i64,
    /// Unit Price Minor.
    pub unit_price_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Total amount in minor currency units.
    pub line_total_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Processrefundargs.
pub struct ProcessRefundArgs {
    /// ID of the original completed sale.
    pub sale_id: String,
    /// Reason for the refund.
    pub reason: String,
    /// Optional internal note.
    pub note: Option<String>,
    /// User ID of the staff processing the refund.
    pub user_id: String,
    /// Lines being refunded.
    pub lines: Vec<RefundLineArg>,
}

/// Args for `process_refund_scoped` — identical to `ProcessRefundArgs`
/// but without `user_id` (read from the session token instead).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRefundScopedArgs {
    /// ID of the associated sale.
    pub sale_id: String,
    /// Reason.
    pub reason: String,
    /// Note.
    pub note: Option<String>,
    /// Lines.
    pub lines: Vec<RefundLineArg>,
}

#[derive(Debug, Serialize)]
/// Processrefundresult.
pub struct ProcessRefundResult {
    /// ID of the associated refund.
    pub refund_id: String,
    /// Total amount in minor currency units.
    pub total_minor: i64,
}

/// Process an already-authorized refund against a store-scoped database.
/// Scoped commands authorize the session against the global identity DB
/// before opening the store connection, then call this business path.
///
/// # Errors
///
/// [`BridgeError::Invalid`] for a missing/uncompleted sale, an invalid
/// currency code, or a refund-total overflow / currency mismatch, and
/// [`BridgeError::Core`] on store errors.
pub fn process_refund_unchecked(
    db: &rusqlite::Connection,
    sale_id: &str,
    reason: &str,
    note: Option<&str>,
    user_id: &str,
    lines: &[RefundLineArg],
) -> Result<ProcessRefundResult, BridgeError> {
    let store = Store::new(db);

    // Verify the sale exists and is completed.
    let sale = store
        .get_sale(sale_id)?
        .ok_or_else(|| BridgeError::Invalid(format!("sale {} not found", sale_id)))?;
    if sale.status != oz_core::SaleStatus::Completed {
        return Err(BridgeError::Invalid(format!(
            "cannot refund a sale with status {:?}; only completed sales can be refunded",
            sale.status
        )));
    }

    // Build refund domain objects.
    // Use collect::<Result> so invalid currency codes surface as errors
    // instead of silently falling back to the sale currency via .unwrap_or().
    let refund_lines: Vec<RefundLine> = lines
        .iter()
        .map(|l| {
            let currency: oz_core::Currency = l.currency.parse().map_err(|_| {
                BridgeError::Invalid(format!("invalid currency code: {}", l.currency))
            })?;
            let unit_price = Money {
                minor_units: l.unit_price_minor,
                currency,
            };
            let line_total = Money {
                minor_units: l.line_total_minor,
                currency,
            };
            Ok(RefundLine::new(
                &l.sale_line_id,
                &l.sku,
                l.qty,
                unit_price,
                line_total,
            ))
        })
        .collect::<Result<Vec<_>, BridgeError>>()?;

    let total = refund_lines.iter().try_fold(
        Money::zero(sale.currency),
        |acc, line| {
            acc.checked_add(line.line_total).ok_or_else(|| {
                BridgeError::Invalid(format!(
                    "refund total overflow or line/sale currency mismatch (line {} in {}, sale in {})",
                    line.sku, line.line_total.currency, sale.currency
                ))
            })
        },
    )?;
    let total_minor = total.minor_units;

    let refund = Refund::new(
        sale_id,
        total,
        reason,
        note.unwrap_or(""),
        user_id,
        refund_lines,
    );

    store.create_refund(&refund)?;

    tracing::info!(
        refund_id = %refund.id,
        sale_id,
        total_minor,
        reason,
        "refund processed"
    );

    Ok(ProcessRefundResult {
        refund_id: refund.id,
        total_minor,
    })
}

/// Process a refund within the store resolved from a session token.
///
/// ADR #7: Scoped variant of `process_refund`. The `user_id` for
/// permission checks and the refund record is read from the resolved
/// `SessionContext`.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `sales:refund`, and the
/// [`process_refund_unchecked`] error surface on store errors.
pub async fn process_refund_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &ProcessRefundScopedArgs,
) -> Result<ProcessRefundResult, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_REFUND)
        .await?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    process_refund_unchecked(
        &db,
        &args.sale_id,
        &args.reason,
        args.note.as_deref(),
        &session.user_id,
        &args.lines,
    )
}

/// Look up a sale by receipt barcode from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `lookup_sale_by_receipt_barcode`.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `sales:process`, and
/// [`BridgeError::Core`] on store errors.
pub async fn lookup_sale_by_receipt_barcode_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    barcode: &str,
) -> Result<Option<Sale>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_PROCESS)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let sale = store.lookup_sale_by_receipt_barcode(barcode)?;
    drop(db);
    Ok(sale)
}

/// List all refunds for a sale from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `list_refunds`.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `sales:process`, and
/// [`BridgeError::Core`] on store errors.
pub async fn list_refunds_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
) -> Result<Vec<Refund>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_PROCESS)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let refunds = store.list_refunds_for_sale(sale_id)?;
    drop(db);
    Ok(refunds)
}

#[cfg(test)]
#[path = "refunds_tests.rs"]
mod refunds_tests;
