//! Tauri commands for Accounts Payable (Hutang / Beli Tempo — Phase 4 AP of
//! `docs/plans/payment-methods-plan.md`).
//!
//! Desktop-only authoring surface, following the memo / legal-entity
//! "desktop-first authoring IPC" precedent: raising a vendor debt, settling
//! it, and writing it off are back-office Owner actions, not register work,
//! so the tablet shell does not expose them (allowlisted in
//! `scripts/ipc-parity-allowlist.json`). Each command maps 1:1 to a
//! `payables:*` permission key and gates on it before touching data.
//!
//! The staged tenant sentinel is `default` (same as the memo commands); a
//! future tenant claim resolves through the session without changing DTOs.

use chrono::Utc;
use oz_core::money::Currency;
use oz_core::payable::{NewPayable, Payable, PayableStatus};
use oz_core::{Money, Store, permissions};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

const DEFAULT_TENANT_ID: &str = "default";

/// Flat serialisable money — snake_case keys matching the front-end `Money`
/// type (same shape as the products / hardware command DTOs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoneyDto {
    /// Amount in minor units.
    pub minor_units: i64,
    /// ISO-4217 code.
    pub currency: String,
}

impl MoneyDto {
    fn to_money(&self) -> Result<Money, AppError> {
        Ok(Money {
            minor_units: self.minor_units,
            currency: self
                .currency
                .parse::<Currency>()
                .map_err(|_| AppError::Invalid(format!("unknown currency '{}'", self.currency)))?,
        })
    }
}

impl From<Money> for MoneyDto {
    fn from(m: Money) -> Self {
        Self {
            minor_units: m.minor_units,
            currency: m.currency.to_string(),
        }
    }
}

/// JSON representation of a payable returned to the front-end.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayableDto {
    /// Stable payable identifier.
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// Supplier owed.
    pub supplier_id: String,
    /// Optional originating purchase order.
    pub po_id: Option<String>,
    /// Free-text origin ("manual", "po_receive", "stock_in", …).
    pub source: String,
    /// Vendor invoice / bill reference.
    pub reference: String,
    /// Original debt amount.
    pub amount: MoneyDto,
    /// Cumulative paid amount.
    pub paid: MoneyDto,
    /// Remaining balance (amount − paid), a convenience for the list view.
    pub balance: MoneyDto,
    /// ISO `YYYY-MM-DD` due date, if any.
    pub due_date: Option<String>,
    /// Lifecycle status (`open`/`partial`/`paid`/`written_off`).
    pub status: String,
    /// Whether the payable is past due and still owed (computed at read time).
    pub is_overdue: bool,
    /// Free-text note.
    pub note: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// ISO-8601 last-update timestamp.
    pub updated_at: String,
    /// ISO-8601 settlement instant, if fully paid.
    pub settled_at: Option<String>,
    /// ISO-8601 write-off instant, if forgiven.
    pub written_off_at: Option<String>,
}

impl PayableDto {
    fn from_payable(p: Payable) -> Self {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let balance = p.balance_minor();
        let is_overdue = p.is_overdue(&today);
        let currency = p.amount.currency.to_string();
        Self {
            id: p.id,
            tenant_id: p.tenant_id,
            supplier_id: p.supplier_id,
            po_id: p.po_id,
            source: p.source,
            reference: p.reference,
            amount: MoneyDto::from(p.amount),
            paid: MoneyDto::from(p.paid),
            balance: MoneyDto {
                minor_units: balance,
                currency,
            },
            due_date: p.due_date,
            status: p.status.as_str().to_string(),
            is_overdue,
            note: p.note,
            created_at: p.created_at,
            updated_at: p.updated_at,
            settled_at: p.settled_at,
            written_off_at: p.written_off_at,
        }
    }
}

/// Arguments for raising a payable.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePayableArgs {
    /// Supplier owed (must exist).
    pub supplier_id: String,
    /// Optional originating purchase order.
    #[serde(default)]
    pub po_id: Option<String>,
    /// Origin label; defaults to "manual" when blank/omitted.
    #[serde(default)]
    pub source: Option<String>,
    /// Vendor invoice / bill reference.
    #[serde(default)]
    pub reference: Option<String>,
    /// Debt amount (minor units + currency).
    pub amount: MoneyDto,
    /// ISO `YYYY-MM-DD` due date.
    #[serde(default)]
    pub due_date: Option<String>,
    /// Free-text note.
    #[serde(default)]
    pub note: Option<String>,
}

/// Arguments for recording a payment against a payable.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPayablePaymentArgs {
    /// The payable being settled.
    pub payable_id: String,
    /// Payment amount (minor units + currency; must match the payable).
    pub amount: MoneyDto,
    /// Tender actually used ("cash", "bank_transfer", …).
    pub method: String,
    /// Free-text note.
    #[serde(default)]
    pub note: Option<String>,
}

/// Parse the optional status filter for `list_payables_scoped`. Unknown
/// values are rejected (unlike the store's lenient read-back) so a typo in a
/// filter never silently returns the wrong slice.
fn parse_status_filter(raw: Option<&str>) -> Result<Option<PayableStatus>, AppError> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let status = match s {
        "open" => PayableStatus::Open,
        "partial" => PayableStatus::Partial,
        "paid" => PayableStatus::Paid,
        "written_off" => PayableStatus::WrittenOff,
        other => {
            return Err(AppError::Invalid(format!(
                "unknown payable status '{other}'"
            )));
        }
    };
    Ok(Some(status))
}

/// List payables, newest first. `status` optionally filters to one lifecycle
/// state. Requires `payables:view`.
#[tauri::command]
pub async fn list_payables_scoped(
    status: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PayableDto>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PAYABLES_VIEW).await?;
    let filter = parse_status_filter(status.as_deref())?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(store
        .list_payables(DEFAULT_TENANT_ID, filter)?
        .into_iter()
        .map(PayableDto::from_payable)
        .collect())
}

/// Raise a payable (a supplier debt). Requires `payables:create`.
#[tauri::command]
pub async fn create_payable_scoped(
    args: CreatePayableArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PAYABLES_CREATE).await?;
    let input = NewPayable {
        tenant_id: DEFAULT_TENANT_ID.into(),
        supplier_id: args.supplier_id,
        po_id: args.po_id,
        source: args.source.unwrap_or_default(),
        reference: args.reference.unwrap_or_default(),
        amount: args.amount.to_money()?,
        due_date: args.due_date,
        note: args.note.unwrap_or_default(),
    };
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(PayableDto::from_payable(store.create_payable(&input)?))
}

/// Record a payment against a payable (partial or full settlement). Requires
/// `payables:settle`. Returns the updated payable; the payment history is a
/// separate read once the UI needs it.
#[tauri::command]
pub async fn record_payable_payment_scoped(
    args: RecordPayablePaymentArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PAYABLES_SETTLE).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    let (updated, _payment) = store.record_payable_payment(
        DEFAULT_TENANT_ID,
        &args.payable_id,
        args.amount.to_money()?,
        &args.method,
        Some(&session.user_id),
        args.note.as_deref().unwrap_or(""),
    )?;
    Ok(PayableDto::from_payable(updated))
}

/// Write off a payable (forgive the remaining balance). Requires
/// `payables:writeoff` — a money-destruction action, terminal and audited.
#[tauri::command]
pub async fn write_off_payable_scoped(
    payable_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PAYABLES_WRITEOFF).await?;
    let conn = state.db.lock().await;
    let store = Store::new(&conn);
    Ok(PayableDto::from_payable(
        store.write_off_payable(DEFAULT_TENANT_ID, &payable_id)?,
    ))
}

#[cfg(test)]
#[path = "payables_tests.rs"]
mod tests;
