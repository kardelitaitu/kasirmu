//! Accounts-receivable command bodies (Phase 3 of `docs/plans/_done/done-payment-methods-plan.md`).
//!
//! Provides the session-scoped [`list_receivables_scoped`](crate::receivables::list_receivables_scoped),
//! [`list_customer_receivables_scoped`](crate::receivables::list_customer_receivables_scoped),
//! [`get_receivable_scoped`](crate::receivables::get_receivable_scoped),
//! [`get_customer_receivables_summary_scoped`](crate::receivables::get_customer_receivables_summary_scoped),
//! [`create_receivable_scoped`](crate::receivables::create_receivable_scoped),
//! [`record_receivable_payment_scoped`](crate::receivables::record_receivable_payment_scoped), and
//! [`write_off_receivable_scoped`](crate::receivables::write_off_receivable_scoped) operations.
//!
//! Gate order, global-DB access, and validation rules mirror the payables
//! command suite while adhering to the receivables permission family.

use chrono::Utc;
use kasirmu_core::money::Currency;
use kasirmu_core::receivable::{NewReceivable, Receivable, ReceivableStatus};
use kasirmu_core::{Money, Store, permissions};
use serde::{Deserialize, Serialize};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

const DEFAULT_TENANT_ID: &str = "default";

/// Flat serialisable money — snake_case keys matching the front-end `Money` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoneyDto {
    /// Amount in minor units.
    pub minor_units: i64,
    /// ISO-4217 code.
    pub currency: String,
}

impl MoneyDto {
    fn to_money(&self) -> Result<Money, BridgeError> {
        Ok(Money {
            minor_units: self.minor_units,
            currency: self.currency.parse::<Currency>().map_err(|_| {
                BridgeError::Invalid(format!("unknown currency '{}'", self.currency))
            })?,
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

/// JSON representation of a receivable returned to the front-end.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivableDto {
    /// Stable receivable identifier.
    pub id: String,
    /// Owning tenant.
    pub tenant_id: String,
    /// Customer who owes the debt.
    pub customer_id: String,
    /// Optional originating POS sale.
    pub sale_id: Option<String>,
    /// Free-text origin ("pos", "manual", …).
    pub source: String,
    /// Invoice / receipt reference.
    pub reference: String,
    /// Original debt amount.
    pub amount: MoneyDto,
    /// Cumulative paid amount.
    pub paid: MoneyDto,
    /// Remaining balance (amount − paid).
    pub balance: MoneyDto,
    /// ISO `YYYY-MM-DD` due date, if any.
    pub due_date: Option<String>,
    /// Lifecycle status (`open`/`partial`/`paid`/`written_off`).
    pub status: String,
    /// Whether the receivable is past due and still owed.
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

impl ReceivableDto {
    /// Builds the wire view of a domain receivable.
    pub fn from_receivable(r: Receivable) -> Self {
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let balance = r.balance_minor();
        let is_overdue = r.is_overdue(&today);
        let currency = r.amount.currency.to_string();
        Self {
            id: r.id,
            tenant_id: r.tenant_id,
            customer_id: r.customer_id,
            sale_id: r.sale_id,
            source: r.source,
            reference: r.reference,
            amount: MoneyDto::from(r.amount),
            paid: MoneyDto::from(r.paid),
            balance: MoneyDto {
                minor_units: balance,
                currency,
            },
            due_date: r.due_date,
            status: r.status.as_str().to_string(),
            is_overdue,
            note: r.note,
            created_at: r.created_at,
            updated_at: r.updated_at,
            settled_at: r.settled_at,
            written_off_at: r.written_off_at,
        }
    }
}

/// Arguments for creating a receivable.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReceivableArgs {
    /// Customer who owes the debt (must exist).
    pub customer_id: String,
    /// Optional originating POS sale.
    #[serde(default)]
    pub sale_id: Option<String>,
    /// Origin label; defaults to "pos" when blank/omitted.
    #[serde(default)]
    pub source: Option<String>,
    /// Receipt / invoice reference.
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

/// Arguments for recording a payment against a receivable.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReceivablePaymentArgs {
    /// The receivable being settled.
    pub receivable_id: String,
    /// Payment amount (minor units + currency; must match the receivable).
    pub amount: MoneyDto,
    /// Tender actually used ("cash", "bank_transfer", "qris", …).
    pub method: String,
    /// Free-text note.
    #[serde(default)]
    pub note: Option<String>,
}

/// Summary of a customer's total kasbon / receivable balance.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerReceivablesSummaryDto {
    /// Customer id.
    pub customer_id: String,
    /// Total outstanding debt in minor units.
    pub outstanding_total: MoneyDto,
    /// Number of open/partial receivables.
    pub open_count: usize,
    /// Whether any receivable is past its due date.
    pub has_overdue: bool,
}

/// Parse the optional status filter for `list_receivables_scoped`.
pub fn parse_status_filter(raw: Option<&str>) -> Result<Option<ReceivableStatus>, BridgeError> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let status = match s {
        "open" => ReceivableStatus::Open,
        "partial" => ReceivableStatus::Partial,
        "paid" => ReceivableStatus::Paid,
        "written_off" => ReceivableStatus::WrittenOff,
        other => {
            return Err(BridgeError::Invalid(format!(
                "unknown receivable status '{other}'"
            )));
        }
    };
    Ok(Some(status))
}

/// List receivables, newest first. `status` optionally filters to one lifecycle state.
/// Requires `receivables:view`.
pub async fn list_receivables_scoped(
    ctx: &BridgeCtx<'_>,
    status: Option<String>,
    session_token: &str,
) -> Result<Vec<ReceivableDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)
        .await?;
    let filter = parse_status_filter(status.as_deref())?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(store
        .list_receivables(DEFAULT_TENANT_ID, filter)?
        .into_iter()
        .map(ReceivableDto::from_receivable)
        .collect())
}

/// List receivables for a specific customer. Requires `receivables:view`.
pub async fn list_customer_receivables_scoped(
    ctx: &BridgeCtx<'_>,
    customer_id: &str,
    status: Option<String>,
    session_token: &str,
) -> Result<Vec<ReceivableDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)
        .await?;
    let filter = parse_status_filter(status.as_deref())?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(store
        .list_receivables_by_customer(DEFAULT_TENANT_ID, customer_id, filter)?
        .into_iter()
        .map(ReceivableDto::from_receivable)
        .collect())
}

/// Fetch one receivable by ID. Requires `receivables:view`.
pub async fn get_receivable_scoped(
    ctx: &BridgeCtx<'_>,
    receivable_id: &str,
    session_token: &str,
) -> Result<Option<ReceivableDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(store
        .get_receivable(DEFAULT_TENANT_ID, receivable_id)?
        .map(ReceivableDto::from_receivable))
}

/// Get a customer's outstanding kasbon summary. Requires `receivables:view`.
pub async fn get_customer_receivables_summary_scoped(
    ctx: &BridgeCtx<'_>,
    customer_id: &str,
    session_token: &str,
) -> Result<CustomerReceivablesSummaryDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);

    let total_minor = store.customer_outstanding_total(DEFAULT_TENANT_ID, customer_id)?;
    let active = store.list_receivables_by_customer(DEFAULT_TENANT_ID, customer_id, None)?;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let has_overdue = active.iter().any(|r| r.is_overdue(&today));
    let open_count = active.iter().filter(|r| r.is_owed()).count();

    Ok(CustomerReceivablesSummaryDto {
        customer_id: customer_id.to_string(),
        outstanding_total: MoneyDto {
            minor_units: total_minor,
            currency: "IDR".to_string(),
        },
        open_count,
        has_overdue,
    })
}

/// Raise a receivable (a customer debt). Requires `receivables:create`.
pub async fn create_receivable_scoped(
    ctx: &BridgeCtx<'_>,
    args: CreateReceivableArgs,
    session_token: &str,
) -> Result<ReceivableDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_CREATE)
        .await?;
    let input = NewReceivable {
        tenant_id: DEFAULT_TENANT_ID.into(),
        customer_id: args.customer_id,
        sale_id: args.sale_id,
        source: args.source.unwrap_or_else(|| "pos".into()),
        reference: args.reference.unwrap_or_default(),
        amount: args.amount.to_money()?,
        due_date: args.due_date,
        note: args.note.unwrap_or_default(),
    };
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(ReceivableDto::from_receivable(
        store.create_receivable(&input)?,
    ))
}

/// Record a payment collected toward a receivable. Requires `receivables:collect`.
pub async fn record_receivable_payment_scoped(
    ctx: &BridgeCtx<'_>,
    args: RecordReceivablePaymentArgs,
    session_token: &str,
) -> Result<ReceivableDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_COLLECT)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    let (updated, _payment) = store.record_receivable_payment(
        DEFAULT_TENANT_ID,
        &args.receivable_id,
        args.amount.to_money()?,
        &args.method,
        Some(&session.user_id),
        args.note.as_deref().unwrap_or(""),
    )?;
    Ok(ReceivableDto::from_receivable(updated))
}

/// Write off a receivable (forgive the remaining balance). Requires
/// `receivables:writeoff` — a money-destruction action, terminal and audited.
pub async fn write_off_receivable_scoped(
    ctx: &BridgeCtx<'_>,
    receivable_id: &str,
    session_token: &str,
) -> Result<ReceivableDto, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_WRITEOFF)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(ReceivableDto::from_receivable(
        store.write_off_receivable(DEFAULT_TENANT_ID, receivable_id)?,
    ))
}

/// Generate the accounts receivable aging report. Requires `receivables:view`.
pub async fn get_ar_aging_report_scoped(
    ctx: &BridgeCtx<'_>,
    as_of_date: Option<String>,
    session_token: &str,
) -> Result<kasirmu_core::receivable::ReceivableAgingReport, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::RECEIVABLES_VIEW)
        .await?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    Ok(store.get_ar_aging_report(DEFAULT_TENANT_ID, as_of_date.as_deref())?)
}

#[cfg(test)]
#[path = "receivables_tests.rs"]
mod tests;
