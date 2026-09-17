//! Shift command bodies (Wave D / D4a) — the tauri-free half of
//! `apps/desktop-client/src/commands/shifts.rs`.
//!
//! Open/close cashier shifts, active-shift lookup, shift listing, cash
//! payouts, and shift reports, each consuming a [`BridgeCtx`]. There is no
//! `run_*` `&Connection` helper in the shell file — the store work lives
//! inside the command functions, so the same shape is preserved here.
//!
//! Gate order, store resolution and error paths are verbatim ports of the
//! command bodies: a shim builds the context, calls one function here, and
//! maps [`BridgeError`] back to `AppError` so the wire shape never moves.
//! Note the deliberate asymmetry preserved from the shell: `open`/`close`
//! authorize through the scope-aware global-identity gate, but
//! [`get_active_shift_scoped`] does not gate at all (the session identity
//! itself scopes the row), and the `get_shift`/`list`/`payout`/`report`
//! family carries the shell's F-017 comments verbatim.

use serde::{Deserialize, Serialize};

use foundation::validate_not_empty;
use oz_core::db::{ShiftPaymentBreakdown, ShiftReport, ShiftSalesByHour};
use oz_core::permissions;
use oz_core::{CashPayout, Shift, Store};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── DTOs ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Shiftdto.
pub struct ShiftDto {
    /// Unique identifier.
    pub id: String,
    /// ID of the associated user.
    pub user_id: String,
    /// ID of the associated terminal.
    pub terminal_id: Option<String>,
    /// Opened At.
    pub opened_at: String,
    /// Closed At.
    pub closed_at: Option<String>,
    /// Opening Balance Minor.
    pub opening_balance_minor: i64,
    /// Closing Balance Minor.
    pub closing_balance_minor: Option<i64>,
    /// Expected Cash Minor.
    pub expected_cash_minor: Option<i64>,
    /// Cash Difference Minor.
    pub cash_difference_minor: Option<i64>,
    /// Total Sales Minor.
    pub total_sales_minor: i64,
    /// Total Cash Minor.
    pub total_cash_minor: i64,
    /// Total Card Minor.
    pub total_card_minor: i64,
    /// Total Other Minor.
    pub total_other_minor: i64,
    /// Total Voids Minor.
    pub total_voids_minor: i64,
    /// Total Refunds Minor.
    pub total_refunds_minor: i64,
    /// Total Payouts Minor.
    pub total_payouts_minor: i64,
    /// Notes.
    pub notes: String,
    /// Current status.
    pub status: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
}

impl From<Shift> for ShiftDto {
    fn from(s: Shift) -> Self {
        Self {
            id: s.id,
            user_id: s.user_id,
            terminal_id: s.terminal_id,
            opened_at: s.opened_at,
            closed_at: s.closed_at,
            opening_balance_minor: s.opening_balance_minor,
            closing_balance_minor: s.closing_balance_minor,
            expected_cash_minor: s.expected_cash_minor,
            cash_difference_minor: s.cash_difference_minor,
            total_sales_minor: s.total_sales_minor,
            total_cash_minor: s.total_cash_minor,
            total_card_minor: s.total_card_minor,
            total_other_minor: s.total_other_minor,
            total_voids_minor: s.total_voids_minor,
            total_refunds_minor: s.total_refunds_minor,
            total_payouts_minor: s.total_payouts_minor,
            notes: s.notes,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Openshiftargs.
pub struct OpenShiftArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// ID of the associated terminal.
    pub terminal_id: Option<String>,
    /// Opening Balance Minor.
    pub opening_balance_minor: i64,
}

/// Args for `open_shift_scoped` — without `user_id`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftScopedArgs {
    /// ID of the associated terminal.
    pub terminal_id: Option<String>,
    /// Opening Balance Minor.
    pub opening_balance_minor: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Closeshiftargs.
pub struct CloseShiftArgs {
    /// ID of the associated user.
    pub user_id: String,
    /// Unique identifier.
    pub id: String,
    /// Closing Balance Minor.
    pub closing_balance_minor: i64,
    /// Notes.
    pub notes: Option<String>,
}

/// Args for `close_shift_scoped` — without `user_id`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseShiftScopedArgs {
    /// Unique identifier.
    pub id: String,
    /// Closing Balance Minor.
    pub closing_balance_minor: i64,
    /// Notes.
    pub notes: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────────────

/// Open a shift in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `shifts:open`, and
/// [`BridgeError::Core`] on store errors.
pub async fn open_shift_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &OpenShiftScopedArgs,
) -> Result<ShiftDto, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SHIFTS_OPEN)
        .await?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shift = store.open_shift(
        &session.user_id,
        args.terminal_id.as_deref(),
        args.opening_balance_minor,
    )?;
    drop(db);

    tracing::info!(id = %shift.id, user_id = %shift.user_id, "shift opened (scoped)");
    Ok(ShiftDto::from(shift))
}

/// Close a shift in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty id,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `shifts:close`, and
/// [`BridgeError::Core`] on store errors.
pub async fn close_shift_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CloseShiftScopedArgs,
) -> Result<ShiftDto, BridgeError> {
    validate_not_empty("id", &args.id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SHIFTS_CLOSE)
        .await?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let shift = store.close_shift(&args.id, args.closing_balance_minor, args.notes.as_deref())?;
    drop(db);

    tracing::info!(id = %shift.id, "shift closed (scoped)");
    Ok(ShiftDto::from(shift))
}

// ── Shift Report DTOs ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Cashpayoutdto.
pub struct CashPayoutDto {
    /// Unique identifier.
    pub id: String,
    /// ID of the associated shift.
    pub shift_id: String,
    /// Amount Minor.
    pub amount_minor: i64,
    /// Reason.
    pub reason: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
}

impl From<CashPayout> for CashPayoutDto {
    fn from(p: CashPayout) -> Self {
        Self {
            id: p.id,
            shift_id: p.shift_id,
            amount_minor: p.amount_minor,
            reason: p.reason,
            created_at: p.created_at,
        }
    }
}

/// Shift report DTO for the front-end.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftReportDto {
    /// Shift.
    pub shift: ShiftDto,
    /// Payment Breakdown.
    pub payment_breakdown: Vec<ShiftPaymentBreakdownDto>,
    /// Hourly Breakdown.
    pub hourly_breakdown: Vec<ShiftSalesByHourDto>,
    /// Cash Payouts.
    pub cash_payouts: Vec<CashPayoutDto>,
    /// Sale Count.
    pub sale_count: i64,
    /// Void Count.
    pub void_count: i64,
    /// Refund Count.
    pub refund_count: i64,
}

impl From<ShiftReport> for ShiftReportDto {
    fn from(r: ShiftReport) -> Self {
        Self {
            shift: ShiftDto::from(r.shift),
            payment_breakdown: r.payment_breakdown.into_iter().map(Into::into).collect(),
            hourly_breakdown: r.hourly_breakdown.into_iter().map(Into::into).collect(),
            cash_payouts: r.cash_payouts.into_iter().map(Into::into).collect(),
            sale_count: r.sale_count,
            void_count: r.void_count,
            refund_count: r.refund_count,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Shiftpaymentbreakdowndto.
pub struct ShiftPaymentBreakdownDto {
    /// Method.
    pub method: String,
    /// Count.
    pub count: i64,
    /// Total amount in minor currency units.
    pub total_minor: i64,
}

impl From<ShiftPaymentBreakdown> for ShiftPaymentBreakdownDto {
    fn from(b: ShiftPaymentBreakdown) -> Self {
        Self {
            method: b.method,
            count: b.count,
            total_minor: b.total_minor,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Shiftsalesbyhourdto.
pub struct ShiftSalesByHourDto {
    /// Hour.
    pub hour: i64,
    /// Total amount in minor currency units.
    pub total_minor: i64,
    /// Sale Count.
    pub sale_count: i64,
}

impl From<ShiftSalesByHour> for ShiftSalesByHourDto {
    fn from(h: ShiftSalesByHour) -> Self {
        Self {
            hour: h.hour,
            total_minor: h.total_minor,
            sale_count: h.sale_count,
        }
    }
}

/// Arguments for creating a cash payout.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCashPayoutArgs {
    /// ID of the associated shift.
    pub shift_id: String,
    /// Amount Minor.
    pub amount_minor: i64,
    /// Reason.
    pub reason: String,
}

/// Get the active shift for the session user from the store-scoped DB. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] and [`BridgeError::Core`] on store
/// errors. Deliberately NOT permission-gated — preserved verbatim from the
/// shell (the session identity scopes the row).
pub async fn get_active_shift_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Option<ShiftDto>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let shift = store.get_active_shift(&session.user_id)?;
    drop(db);

    Ok(shift.map(ShiftDto::from))
}

/// List shifts for the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `shifts:view_any`, and
/// [`BridgeError::Core`] on store errors.
pub async fn list_shifts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<ShiftDto>, BridgeError> {
    // F-017: cross-shift visibility is manager-tier data.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SHIFTS_VIEW_ANY)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let shifts = store.list_shifts()?;
    drop(db);

    Ok(shifts.into_iter().map(ShiftDto::from).collect())
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `get_shift` (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty id,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `shifts:view_any`, and
/// [`BridgeError::Core`] on store errors.
pub async fn get_shift_scoped(
    ctx: &BridgeCtx<'_>,
    id: &str,
    session_token: &str,
) -> Result<Option<ShiftDto>, BridgeError> {
    validate_not_empty("id", id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::SHIFTS_VIEW_ANY)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let shift = store.get_shift(id)?;
    drop(db);

    Ok(shift.map(ShiftDto::from))
}

/// Scoped variant of `create_cash_payout` (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty shift id or a non-positive
/// amount, [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `payments:cash`, and
/// [`BridgeError::Core`] on store errors.
pub async fn create_cash_payout_scoped(
    ctx: &BridgeCtx<'_>,
    args: &CreateCashPayoutArgs,
    session_token: &str,
) -> Result<CashPayoutDto, BridgeError> {
    validate_not_empty("shift_id", &args.shift_id)
        .map_err(|e| BridgeError::Invalid(e.to_string()))?;
    if args.amount_minor <= 0 {
        return Err(BridgeError::Invalid("amount_minor must be > 0".into()));
    }

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::PAYMENTS_CASH)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let payout = store.create_cash_payout(&args.shift_id, args.amount_minor, &args.reason)?;
    drop(db);

    tracing::info!(id = %payout.id, shift_id = %args.shift_id, amount = %args.amount_minor, "cash payout recorded");
    Ok(CashPayoutDto::from(payout))
}

/// Scoped variant of `get_shift_report` (ADR #7).
///
/// # Errors
///
/// [`BridgeError::Invalid`] for an empty shift id,
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `shifts:view_any`, and
/// [`BridgeError::Core`] on store errors.
pub async fn get_shift_report_scoped(
    ctx: &BridgeCtx<'_>,
    shift_id: &str,
    session_token: &str,
) -> Result<ShiftReportDto, BridgeError> {
    validate_not_empty("shift_id", shift_id).map_err(|e| BridgeError::Invalid(e.to_string()))?;

    let (session, conn) = ctx.resolve_scope(session_token)?;

    // F-017: enforce per-domain permission on this scoped command.

    ctx.require_session_permission(&session, permissions::SHIFTS_VIEW_ANY)
        .await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let report = store.get_shift_report(shift_id)?;
    drop(db);

    Ok(ShiftReportDto::from(report))
}

#[cfg(test)]
#[path = "shifts_tests.rs"]
mod shifts_tests;
