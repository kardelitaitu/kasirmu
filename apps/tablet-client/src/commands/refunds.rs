//! Refund commands — process refund against a completed sale.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use oz_core::db::Store;
use oz_core::permissions;
use oz_core::{Money, Refund, RefundLine, Sale};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Processrefundresult.
pub struct ProcessRefundResult {
    /// ID of the associated refund.
    pub refund_id: String,
    /// Total amount in minor currency units.
    pub total_minor: i64,
}

/// Process a refund against a completed sale.
///
/// Requires `sales:refund` permission.
#[command]
pub async fn process_refund(
    args: ProcessRefundArgs,
    state: State<'_, AppState>,
) -> Result<ProcessRefundResult, AppError> {
    let db = state.db.lock().await;
    let result = run_process_refund(
        &db,
        &args.user_id,
        &args.sale_id,
        &args.reason,
        args.note.as_deref(),
        &args.lines,
    );
    drop(db);
    result
}

/// Args for `process_refund_scoped` — without `user_id`.
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

/// Process a refund within the session scope. ADR #7.
///
/// The `user_id` for permission checks and the refund record is read
/// from the resolved session context.
#[command]
pub async fn process_refund_scoped(
    session_token: String,
    args: ProcessRefundScopedArgs,
    state: State<'_, AppState>,
) -> Result<ProcessRefundResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_process_refund(
        &db,
        &session.user_id,
        &args.sale_id,
        &args.reason,
        args.note.as_deref(),
        &args.lines,
    )
}

/// Shared business logic for processing a refund.
fn run_process_refund(
    db: &rusqlite::Connection,
    user_id: &str,
    sale_id: &str,
    reason: &str,
    note: Option<&str>,
    lines: &[RefundLineArg],
) -> Result<ProcessRefundResult, AppError> {
    let store = Store::new(db);

    require_permission_for_user(&store, user_id, permissions::SALES_REFUND)?;

    let sale = store
        .get_sale(sale_id)?
        .ok_or_else(|| AppError::Invalid(format!("sale {} not found", sale_id)))?;
    if sale.status != oz_core::SaleStatus::Completed {
        return Err(AppError::Invalid(format!(
            "cannot refund a sale with status {:?}",
            sale.status
        )));
    }

    let refund_lines: Vec<RefundLine> = lines
        .iter()
        .map(|l| {
            let currency: oz_core::Currency = l
                .currency
                .parse()
                .map_err(|_| AppError::Invalid(format!("invalid currency code: {}", l.currency)))?;
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
        .collect::<Result<Vec<_>, AppError>>()?;

    let total = refund_lines.iter().try_fold(
        Money::zero(sale.currency),
        |acc, line| {
            acc.checked_add(line.line_total).ok_or_else(|| {
                AppError::Invalid(format!(
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

    tracing::info!(refund_id = %refund.id, sale_id, total_minor, reason, "refund processed");

    Ok(ProcessRefundResult {
        refund_id: refund.id,
        total_minor,
    })
}

/// Look up a sale by its receipt barcode for quick return.
#[command]
pub async fn lookup_sale_by_receipt_barcode(
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<Sale>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let sale = store.lookup_sale_by_receipt_barcode(&barcode)?;
    drop(db);
    Ok(sale)
}

/// Look up a sale by receipt barcode in the session scope. ADR #7.
#[command]
pub async fn lookup_sale_by_receipt_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<Sale>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let sale = store.lookup_sale_by_receipt_barcode(&barcode)?;
    drop(db);
    Ok(sale)
}

/// List all refunds for a sale.
#[command]
pub async fn list_refunds(
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Refund>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let refunds = store.list_refunds_for_sale(&sale_id)?;
    drop(db);
    Ok(refunds)
}

/// List refunds in the session scope. ADR #7.
#[command]
pub async fn list_refunds_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Refund>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let refunds = store.list_refunds_for_sale(&sale_id)?;
    drop(db);
    Ok(refunds)
}

#[cfg(test)]
#[path = "refunds_tests.rs"]
mod tests;
