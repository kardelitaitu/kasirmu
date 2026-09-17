//! Refund commands — process refund against a completed sale.

use tauri::{State, command};

use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use kasirmu_core::{Money, Refund, RefundLine, Sale};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

/// The refund wire contracts are owned by `kasirmu-bridge`; the tablet re-exports
/// them instead of declaring a copy.
///
/// The tablet's own `ProcessRefundArgs` was one of the three structs the
/// 2026-09-15 tablet IPC wire audit named as declaring itself twice, and the
/// only one whose copy had ALSO lost the `#[serde(rename_all = "camelCase")]`
/// its bridge twin carries — same five fields (`sale_id`, `reason`, `note`,
/// `user_id`, `lines`), one accepted key set on each shell. Because
/// `sale_id` and `user_id` are required `String` and only `note` is an
/// `Option`, the tablet copy answered the front-end's camelCase with a hard
/// `missing field \`sale_id\`` error, not a silent `None`.
///
/// This is NOT a data-loss fix. `process_refund` was registered in neither
/// shell (`grep -rn refunds::process_refund apps/*/src/lib.rs` returns the two
/// `process_refund_scoped` lines only: tablet `lib.rs:609`, desktop
/// `lib.rs:1120`), and nothing sends this struct a payload at all
/// (`grep -rn process_refund ui/src/api` returns one hit, `sales.ts:657`, and
/// it invokes the scoped command; the unscoped name exists only as a dev-mock
/// handler and in `dev-mock-envelope-shapes.test.ts:63`, whose own comment
/// says it has no caller). So what was removed is a latent trap exactly one
/// `generate_handler!` line from live — the shape tonight's audit predicted.
///
/// The fn itself was retired from this shell on 2026-09-16 (T19), which is what turns
/// "a latent trap exactly one `generate_handler!` line from live" into a closed door.
/// The reasoning above stays, because it is why the DTO direction was chosen, and the
/// greps it cites answer the same way now: the scoped command is the only refund path,
/// and the unscoped name survives only in the dev-mock and in
/// `dev-mock-envelope-shapes.test.ts`, whose own comment already said it has no caller.
///
/// The direction is not a coin flip either: the bridge is the type that agrees
/// with the front-end, since `ui/src/api/sales.ts:606-613` declares
/// `ProcessRefundArgs` as `{ saleId, reason, note?, userId, lines }` over
/// camelCase line items. Re-exporting cannot break a working refund path —
/// there is no path to this struct — and if one is ever registered, the keys
/// that will arrive are the ones this type already accepts.
///
/// `RefundLineArg` comes along because the bridge's `ProcessRefundArgs.lines`
/// is a `Vec` of the bridge's own line type while one business path
/// ([`run_process_refund`]) serves both commands; the two copies were
/// field-for-field identical, so nothing on the wire moves. The scoped and
/// result structs WERE local copies too; they are re-exported on the same line now, so
/// the tablet shell has exactly one declaration of every refund wire contract it serves.
pub use kasirmu_bridge::refunds::{
    ProcessRefundArgs, ProcessRefundResult, ProcessRefundScopedArgs, RefundLineArg,
};

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
    if sale.status != kasirmu_core::SaleStatus::Completed {
        return Err(AppError::Invalid(format!(
            "cannot refund a sale with status {:?}",
            sale.status
        )));
    }

    let refund_lines: Vec<RefundLine> = lines
        .iter()
        .map(|l| {
            let currency: kasirmu_core::Currency = l
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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let sale = store.lookup_sale_by_receipt_barcode(&barcode)?;
    drop(db);
    Ok(sale)
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
        kasirmu_core::permissions::SALES_PROCESS,
    )?;
    let refunds = store.list_refunds_for_sale(&sale_id)?;
    drop(db);
    Ok(refunds)
}

#[cfg(test)]
#[path = "refunds_tests.rs"]
mod tests;
