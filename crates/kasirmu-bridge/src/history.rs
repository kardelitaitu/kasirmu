//! Sales-history command bodies (list, get and export summaries).
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-tauri/src/commands/history.rs`. The only rewrites are the
//! mechanical `state.*` → `ctx.*` receiver swaps and `AppError::` →
//! `BridgeError::`; SQL, gate kind and order, lock order and count and all
//! error strings are unchanged.

use serde::Serialize;

use kasirmu_core::Money;
use kasirmu_core::db::{DailySummaryRow, SalesByHourRow, Store};
use kasirmu_core::permissions;
use kasirmu_core::subscription::TenantSubscription;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── Sale list / detail ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
/// Salelistitem.
pub struct SaleListItem {
    /// Unique identifier.
    pub id: String,
    /// Total amount in minor currency units.
    pub total: Money,
    /// Line Count.
    pub line_count: i64,
    /// Current status.
    pub status: String,
    /// Payment Method.
    pub payment_method: Option<String>,
    /// ID of the associated user.
    pub user_id: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Frozen 22-char receipt hierarchy code (`location-terminal-YYMMDD-staff-seq`),
    /// or `None` for sales predating the code / sales with no known terminal.
    /// Surfaced read-only; the code is immutable once issued (plan §4.5).
    #[serde(default)]
    pub display_code: Option<String>,
}

/// Response for the sale-list commands (C1.2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// The sales plus whether the tier's history window was applied.
pub struct SaleListResponse {
    /// The sales — already capped to the tier's history window.
    pub sales: Vec<SaleListItem>,
    /// C1.2: true when the tier's history window (Free = 3 months, Plus = 1
    /// year, Pro = 5 years) was applied, so the UI can show the upgrade teaser.
    pub sales_history_capped: bool,
}

/// List all sales for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `list_sales`. The backend resolves the
/// opaque `session_token` to a `SessionContext`, opens the store-scoped
/// database, and returns only that store's completed sales.
pub async fn list_sales_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<SaleListResponse, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_VIEW)
        .await?;
    // C1.2: the tier's history window lives on the tenant subscription in the
    // global identity DB; the sales themselves come from the store DB.
    let days = {
        let db = ctx.lock_global().await;
        let sub = TenantSubscription::load(&db, "default")?
            .ok_or_else(|| BridgeError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.effective_tier().sales_history_days()
    };
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let (sales, capped) = store.list_sales_with_history_cap(days)?;
    // Phase 4: attach the frozen receipt hierarchy code to each list row in a
    // single batch read (no per-row N+1). The list is capped to the tier's
    // history window, so the IN-set is small.
    let code_map: std::collections::HashMap<String, Option<String>> = store
        .sale_display_codes(&sales.iter().map(|s| s.id.clone()).collect::<Vec<_>>())?
        .into_iter()
        .collect();
    drop(db);
    Ok(SaleListResponse {
        sales: sales
            .into_iter()
            .map(|s| {
                let code = code_map.get(&s.id).cloned().flatten();
                map_sale_to_item(s, code)
            })
            .collect(),
        sales_history_capped: capped,
    })
}

/// Shared mapping from `kasirmu_core::Sale` to `SaleListItem`.
fn map_sale_to_item(s: kasirmu_core::Sale, display_code: Option<String>) -> SaleListItem {
    SaleListItem {
        id: s.id,
        total: s.total,
        line_count: s.line_count,
        status: format!("{:?}", s.status),
        payment_method: s.payment_method,
        user_id: s.user_id,
        created_at: s.created_at,
        display_code,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Saledetail.
pub struct SaleDetail {
    /// Unique identifier.
    pub id: String,
    /// Total amount in minor currency units.
    pub total: Money,
    /// Subtotal.
    pub subtotal: Money,
    /// Tax Total.
    pub tax_total: Money,
    /// Line Count.
    pub line_count: i64,
    /// Current status.
    pub status: String,
    /// Payment Method.
    pub payment_method: Option<String>,
    /// Tendered Minor.
    pub tendered_minor: Option<i64>,
    /// ID of the associated user.
    pub user_id: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Lines.
    pub lines: Vec<kasirmu_core::SaleLine>,
    /// Frozen 22-char receipt hierarchy code (`location-terminal-YYMMDD-staff-seq`),
    /// or `None` for sales predating the code / sales with no known terminal.
    /// Surfaced read-only; the code is immutable once issued (plan §4.5).
    #[serde(default)]
    pub display_code: Option<String>,
    /// F2-7: the core-authored tax-estimate stamp (F2-5) when the checkout
    /// claimed an estimate; `None` = unstamped (absence is never a claim).
    /// Wire-verified: the struct-wide `rename_all` above IS the drift fix —
    /// ui + dev-mock both read camelCase; the backend was the wrong side.
    pub tax_estimate_note: Option<String>,
}

/// Fetch a single sale by ID from the store resolved from a session token.
///
/// ADR #7: Scoped variant of `get_sale`. The backend resolves the
/// session token to open the store-scoped database and looks up the
/// sale within that store only.
pub async fn get_sale_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<SaleDetail>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::SALES_VIEW)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let sale = store.get_sale(id)?;
    // F2-7: the note is a single-row getter on the detail door only — the
    // list deliberately stays unpopulated (no per-row N+1).
    let tax_estimate_note = match &sale {
        Some(s) => store.sale_tax_estimate_note(&s.id)?,
        None => None,
    };
    // Phase 4: the frozen receipt hierarchy code rides the detail door (one
    // extra row read, same as the tax-estimate note).
    let display_code = match &sale {
        Some(s) => store.sale_display_code(&s.id)?,
        None => None,
    };
    drop(db);
    Ok(sale.map(|s| map_sale_to_detail(s, tax_estimate_note, display_code)))
}

/// Shared mapping from `kasirmu_core::Sale` to `SaleDetail`.
fn map_sale_to_detail(
    s: kasirmu_core::Sale,
    tax_estimate_note: Option<String>,
    display_code: Option<String>,
) -> SaleDetail {
    SaleDetail {
        id: s.id,
        total: s.total,
        subtotal: s.subtotal,
        tax_total: s.tax_total,
        line_count: s.line_count,
        status: format!("{:?}", s.status),
        payment_method: s.payment_method,
        tendered_minor: s.tendered_minor,
        user_id: s.user_id,
        created_at: s.created_at,
        lines: s.lines,
        tax_estimate_note,
        display_code,
    }
}

// ── Dashboard / Export ───────────────────────────────────────────────

/// Fetch the daily sales summary for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_daily_summary`.
pub async fn export_daily_summary_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<DailySummaryRow>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::REPORTS_EXPORT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.export_daily_summary()?;
    drop(db);
    Ok(rows)
}

/// Fetch sales-by-hour breakdown for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_sales_by_hour`.
pub async fn export_sales_by_hour_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<SalesByHourRow>, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::REPORTS_EXPORT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.export_sales_by_hour()?;
    drop(db);
    Ok(rows)
}

// ── EOD (End-of-Day) Report ──────────────────────────────────────

#[derive(Debug, Serialize)]
/// Eodreport.
pub struct EodReport {
    /// Total Sales.
    pub total_sales: i64,
    /// Total Revenue.
    pub total_revenue: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Payment Breakdown.
    pub payment_breakdown: Vec<PaymentBreakdown>,
    /// Void Count.
    pub void_count: i64,
    /// Void Total.
    pub void_total: i64,
    /// Discount Count.
    pub discount_count: i64,
    /// Discount Total.
    pub discount_total: i64,
    /// Hourly Breakdown.
    pub hourly_breakdown: Vec<SalesByHourRow>,
}

#[derive(Debug, Serialize)]
/// Paymentbreakdown.
pub struct PaymentBreakdown {
    /// Method.
    pub method: String,
    /// Count.
    pub count: i64,
    /// Total amount in minor currency units.
    pub total: i64,
}

/// Fetch the full EOD report for the store resolved from a session token.
///
/// ADR #7: Scoped variant of `export_eod_report`. Opens the store-scoped
/// database and builds the report from that store's data only.
pub async fn export_eod_report_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<EodReport, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::REPORTS_EXPORT)
        .await?;
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    build_eod_report(&db)
}

/// Shared business logic for building an EOD report from a connection.
fn build_eod_report(db: &rusqlite::Connection) -> Result<EodReport, BridgeError> {
    let store = Store::new(db);

    let daily = store.export_daily_summary()?;
    let hourly = store.export_sales_by_hour()?;

    // C5: every money figure below comes from a `Store` query that shares ONE
    // day definition with `export_daily_summary` above — the store-local
    // business date (REP-03), completed sales only. They used to be built here
    // from bare `date(created_at) = date('now')` clauses, which is the UTC day
    // even for a +07:00 store, so the header and the body of one sheet could
    // describe two different days.
    let breakdown = store.export_eod_breakdown()?;
    let voids = store.export_eod_voids()?;

    // Payment breakdown — the same rows the totals are summed from.
    let payment_rows: Vec<PaymentBreakdown> = breakdown
        .iter()
        .map(|r| PaymentBreakdown {
            method: r.payment_method.clone(),
            count: r.sale_count,
            total: r.total_minor,
        })
        .collect();

    // Discount stats — a slice of the same completed sales, so
    // `discount_total` is bounded by `total_revenue` by construction.
    let discount_count: i64 = breakdown.iter().map(|r| r.discount_count).sum();
    let discount_total: i64 = breakdown.iter().map(|r| r.discount_total_minor).sum();

    let total_sales = daily.len() as i64;
    let total_revenue: i64 = daily.iter().map(|r| r.total_minor).sum();
    let currency = daily
        .first()
        .map(|r| r.currency.clone())
        .unwrap_or_else(|| "USD".into());

    Ok(EodReport {
        total_sales,
        total_revenue,
        currency,
        payment_breakdown: payment_rows,
        void_count: voids.void_count,
        void_total: voids.void_total_minor,
        discount_count,
        discount_total,
        hourly_breakdown: hourly,
    })
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod history_tests;
