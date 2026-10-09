//! Sales history and report commands: list, get, export summaries.
//!
//! These commands provide read-only access to completed sales and
//! aggregate report data for the dashboard, history screens, and
//! end-of-day reporting.

use serde::Serialize;
use tauri::{State, command};

use kasirmu_core::Money;
use kasirmu_core::db::faktur_pajak::FakturPajakInfo;
use kasirmu_core::db::{DailySummaryRow, SalesByHourRow, Store};
use kasirmu_core::permissions;
use kasirmu_core::subscription::TenantSubscription;

pub use kasirmu_bridge::history::StampFakturPajakArgs;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// ── Sale list / detail ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[command]
/// List sales.
///
/// C1.2: the list is capped to the tier's sales-history window
/// (`sales_history_days()` — Free = 3 months, Plus = 1 year, Pro = 5 years,
/// Premium/Enterprise = unlimited).
pub async fn list_sales(state: State<'_, AppState>) -> Result<SaleListResponse, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let sub = TenantSubscription::load(&db, "default")?
        .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
    sub.verify_signature()?;
    let days = sub.effective_tier().sales_history_days();
    let (sales, capped) = store.list_sales_with_history_cap(days)?;
    drop(db);
    Ok(SaleListResponse {
        sales: sales
            .into_iter()
            .map(|s| SaleListItem {
                id: s.id,
                total: s.total,
                line_count: s.line_count,
                status: format!("{:?}", s.status),
                payment_method: s.payment_method,
                user_id: s.user_id,
                created_at: s.created_at,
            })
            .collect(),
        sales_history_capped: capped,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
/// Saledetail.
pub struct SaleDetail {
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
    /// Tendered Minor.
    pub tendered_minor: Option<i64>,
    /// ID of the associated user.
    pub user_id: Option<String>,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Lines.
    pub lines: Vec<kasirmu_core::SaleLine>,
    /// F2-7: the core-authored tax-estimate stamp (F2-5) when the checkout
    /// claimed an estimate; `None` = unstamped (absence is never a claim).
    /// Wire-verified: struct-wide `rename_all` is the drift fix (desktop twin).
    pub tax_estimate_note: Option<String>,
}

#[command]
/// Get sale.
pub async fn get_sale(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SaleDetail>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let sale = store.get_sale(&id)?;
    // F2-7: single-row getter on the detail door only (no list N+1).
    let tax_estimate_note = match &sale {
        Some(s) => store.sale_tax_estimate_note(&s.id)?,
        None => None,
    };
    drop(db);
    Ok(sale.map(|s| SaleDetail {
        id: s.id,
        total: s.total,
        line_count: s.line_count,
        status: format!("{:?}", s.status),
        payment_method: s.payment_method,
        tendered_minor: s.tendered_minor,
        user_id: s.user_id,
        created_at: s.created_at,
        lines: s.lines,
        tax_estimate_note,
    }))
}

// ── Dashboard / Export ───────────────────────────────────────────────

#[command]
/// Export daily summary.
pub async fn export_daily_summary(
    state: State<'_, AppState>,
) -> Result<Vec<DailySummaryRow>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let rows = store.export_daily_summary()?;
    drop(db);
    Ok(rows)
}

#[command]
/// Export sales by hour.
pub async fn export_sales_by_hour(
    state: State<'_, AppState>,
) -> Result<Vec<SalesByHourRow>, AppError> {
    let db = state.db.lock().await;
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

/// Fetch the full EOD (End-of-Day) report for today.
#[command]
pub async fn export_eod_report(state: State<'_, AppState>) -> Result<EodReport, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);

    let daily = store.export_daily_summary()?;
    let hourly = store.export_sales_by_hour()?;

    // C5b: every money figure below comes from a Store query that shares ONE
    // day definition with export_daily_summary above - the store-local business
    // date (REP-03), completed sales only. They used to be built here from bare
    // date(created_at) = date('now') clauses, which is the UTC day even for a
    // +07:00 store, so the header and the body of one sheet could describe two
    // different days. Mirrors the desktop bridge (C5).
    let breakdown = store.export_eod_breakdown()?;
    let voids = store.export_eod_voids()?;

    // Payment breakdown - the same rows the totals are summed from.
    let payment_rows: Vec<PaymentBreakdown> = breakdown
        .iter()
        .map(|r| PaymentBreakdown {
            method: r.payment_method.clone(),
            count: r.sale_count,
            total: r.total_minor,
        })
        .collect();

    // Discount stats - a slice of the same completed sales, so discount_total
    // is bounded by total_revenue by construction.
    let discount_count: i64 = breakdown.iter().map(|r| r.discount_count).sum();
    let discount_total: i64 = breakdown.iter().map(|r| r.discount_total_minor).sum();

    let total_sales = daily.len() as i64;
    let total_revenue: i64 = daily.iter().map(|r| r.total_minor).sum();
    let currency = daily
        .first()
        .map(|r| r.currency.clone())
        .unwrap_or_else(|| "USD".into());

    drop(db);

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

// ── Tests ──────────────────────────────────────────────────────────────

/// Session-scoped variant of `list_sales`.
///
/// R3: `limit` and `offset` are **optional and additive**, mirroring
/// `list_products_scoped`. A caller that passes neither gets every sale in
/// the tier window, exactly as before. The return type stays
/// `SaleListResponse` — the shape `ui/src/api/sales.ts` declares and the
/// desktop shell shares — and only the `sales` array is windowed, so no
/// existing consumer's contract moves.
///
/// `sales_history_capped` is reported for the TIER window, not the page, so
/// a paged caller still sees the upgrade teaser.
///
/// # KNOWN LIMITATION — the DB read is unbounded (DEFERRED)
///
/// The window is applied in Rust, AFTER `Store::list_sales_with_history_cap`
/// has read and materialised every sale in the tier window. **The IPC payload
/// and the renderer are bounded; the query is not.** Deferred because the
/// bound does not exist in `kasirmu-core`:
///
/// * `Store::list_sales_with_history_cap(&self, days: Option<i64>)
///   -> Result<(Vec<Sale>, bool), CoreError>` (`crates/kasirmu-core/src/db/sales_crud.rs:288`)
///   builds its clause from a `FROM …` fragment and forwards to the private
///   `list_sales_sql` (`:302`), which appends no LIMIT. Its callers are
///   `crates/kasirmu-bridge/src/history.rs:87` (the DESKTOP path), this file
///   at `:68` and `:302`, and `crates/kasirmu-core/src/db/sales_tests.rs:149,158`.
///   Five call sites, so adding `Option<u64>` bounds is feasible here — but it
///   is still a signature change on a shared bridge path, so the safe form is
///   the same sibling method (`…_paged`) rather than a param change.
/// * The precedent to mirror already exists: `Store::list_sales_for_customer`
///   runs a real `ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`
///   (`crates/kasirmu-core/src/db/sales_crud.rs:432`).
///
/// What bounds the read TODAY is the tier's history window
/// (`sales_history_days()`: Free 3 months, Plus 1 year, Pro 5 years), which
/// caps the row set by DATE, not by count — on an unlimited-history tier the
/// materialised list is the whole history, and that is the case this deferral
/// does not cover.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_sales_scoped(
    session_token: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<SaleListResponse, AppError> {
    let session = state.resolve_session(&session_token)?;
    // R10 gate-KIND + gate-ORDER, 2026-09-25: adopt the scope-aware form the bridge
    // twin uses, and run it BEFORE the store is opened. This door used to open the
    // store first and then ask `require_permission_for_user` of the STORE db -- a db
    // that carries no `users` rows (identity lives only in the global db), so the
    // check could only ever deny, and it denied after `open_store` had already done
    // filesystem work. `require_permission_for_session` asks the same permission of
    // the global db and adds the branch/workspace scope, exactly as
    // `kasirmu_bridge::history::list_sales_scoped` does.
    require_permission_for_session(&state, &session, permissions::SALES_VIEW).await?;
    // C1.2: the tier's history window lives on the tenant subscription in the
    // global identity DB; the sales themselves come from the store DB.
    let days = {
        let global_db = state.db.lock().await;
        let sub = TenantSubscription::load(&global_db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.effective_tier().sales_history_days()
    };
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let (sales, capped) = store.list_sales_with_history_cap_bounded(days, limit, offset)?;
    drop(db_guard);
    Ok(SaleListResponse {
        sales: sales
            .into_iter()
            .map(|s| SaleListItem {
                id: s.id,
                total: s.total,
                line_count: s.line_count,
                status: format!("{:?}", s.status),
                payment_method: s.payment_method,
                user_id: s.user_id,
                created_at: s.created_at,
            })
            .collect(),
        sales_history_capped: capped,
    })
}

/// Session-scoped variant of `get_sale`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_sale_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SaleDetail>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_VIEW).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let sale = store.get_sale(&id)?;
    // F2-7: single-row getter on the detail door only (no list N+1).
    let tax_estimate_note = match &sale {
        Some(s) => store.sale_tax_estimate_note(&s.id)?,
        None => None,
    };
    drop(db);
    Ok(sale.map(|s| SaleDetail {
        id: s.id,
        total: s.total,
        line_count: s.line_count,
        status: format!("{:?}", s.status),
        payment_method: s.payment_method,
        tendered_minor: s.tendered_minor,
        user_id: s.user_id,
        created_at: s.created_at,
        lines: s.lines,
        tax_estimate_note,
    }))
}

/// Session-scoped variant of `export_daily_summary`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn export_daily_summary_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<DailySummaryRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::REPORTS_EXPORT).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let rows = store.export_daily_summary()?;
    drop(db);
    Ok(rows)
}

/// Session-scoped variant of `export_sales_by_hour`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn export_sales_by_hour_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<SalesByHourRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::REPORTS_EXPORT).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let rows = store.export_sales_by_hour()?;
    drop(db);
    Ok(rows)
}

/// Session-scoped variant of `export_eod_report`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn export_eod_report_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<EodReport, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::REPORTS_EXPORT).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);

    let daily = store.export_daily_summary()?;
    let hourly = store.export_sales_by_hour()?;

    // C5b: every money figure below comes from a Store query that shares ONE
    // day definition with export_daily_summary above - the store-local business
    // date (REP-03), completed sales only. They used to be built here from bare
    // date(created_at) = date('now') clauses, which is the UTC day even for a
    // +07:00 store, so the header and the body of one sheet could describe two
    // different days. Mirrors the desktop bridge (C5).
    let breakdown = store.export_eod_breakdown()?;
    let voids = store.export_eod_voids()?;

    // Payment breakdown - the same rows the totals are summed from.
    let payment_rows: Vec<PaymentBreakdown> = breakdown
        .iter()
        .map(|r| PaymentBreakdown {
            method: r.payment_method.clone(),
            count: r.sale_count,
            total: r.total_minor,
        })
        .collect();

    // Discount stats - a slice of the same completed sales, so discount_total
    // is bounded by total_revenue by construction.
    let discount_count: i64 = breakdown.iter().map(|r| r.discount_count).sum();
    let discount_total: i64 = breakdown.iter().map(|r| r.discount_total_minor).sum();

    let total_sales = daily.len() as i64;
    let total_revenue: i64 = daily.iter().map(|r| r.total_minor).sum();
    let currency = daily
        .first()
        .map(|r| r.currency.clone())
        .unwrap_or_else(|| "USD".into());

    drop(db);

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

/// Stamp a DJP-approved NSFP onto a completed sale.
///
/// `needless_borrow` is allowed to match the five other `*_scoped` bodies above,
/// which all pass `&db` where `db` is already `&Connection` (`let db = &*db_guard`).
/// The non-scoped twins are NOT allowed the same lint: they hold a `MutexGuard`, so
/// `&db` there is a genuine deref. `dropping_references` accompanies it because the
/// guard is dropped explicitly on the scoped paths.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn stamp_faktur_pajak_scoped(
    session_token: String,
    args: StampFakturPajakArgs,
    state: State<'_, AppState>,
) -> Result<FakturPajakInfo, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let info =
        store.stamp_faktur_pajak(&args.sale_id, &args.nsfp, args.kode_transaksi.as_deref())?;
    Ok(info)
}

/// Create a Faktur Pengganti for an existing e-Faktur on a completed sale.
///
/// Same `allow` as the sibling scoped bodies — see `stamp_faktur_pajak_scoped`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_faktur_pengganti_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<FakturPajakInfo, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::SALES_PROCESS).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let info = store.create_faktur_pengganti(&sale_id)?;
    Ok(info)
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
