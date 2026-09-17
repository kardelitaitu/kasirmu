//! Sales history and report commands: list, get, export summaries.
//!
//! These commands provide read-only access to completed sales and
//! aggregate report data for the dashboard, history screens, and
//! end-of-day reporting.

use serde::Serialize;
use tauri::{State, command};

use oz_core::Money;
use oz_core::db::{DailySummaryRow, SalesByHourRow, Store};
use oz_core::permissions;
use oz_core::subscription::TenantSubscription;

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

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
    pub lines: Vec<oz_core::SaleLine>,
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

    // Payment breakdown.
    let mut stmt = db.prepare(
        "SELECT payment_method, COUNT(*) AS cnt, SUM(total_minor) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'completed'
         GROUP BY payment_method
         ORDER BY tot DESC",
    )?;
    let payment_rows: Vec<PaymentBreakdown> = stmt
        .query_map([], |row| {
            Ok(PaymentBreakdown {
                method: row
                    .get::<_, Option<String>>("payment_method")?
                    .unwrap_or_else(|| "Unknown".into()),
                count: row.get("cnt")?,
                total: row.get("tot")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Void stats.
    let mut void_stmt = db.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor), 0) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'voided'",
    )?;
    let void_row: (i64, i64) = void_stmt.query_row([], |row| {
        Ok((row.get::<_, i64>("cnt")?, row.get::<_, i64>("tot")?))
    })?;
    drop(void_stmt);

    // Discount stats.
    let mut discount_stmt = db.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor), 0) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'completed' AND discount_percent > 0",
    )?;
    let discount_row: (i64, i64) = discount_stmt.query_row([], |row| {
        Ok((row.get::<_, i64>("cnt")?, row.get::<_, i64>("tot")?))
    })?;
    drop(discount_stmt);

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
        void_count: void_row.0,
        void_total: void_row.1,
        discount_count: discount_row.0,
        discount_total: discount_row.1,
        hourly_breakdown: hourly,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────

/// Session-scoped variant of `list_sales`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_sales_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<SaleListResponse, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    // F-017, mirrored from the desktop bridge (`crates/kasirmu-bridge/src/history.rs`):
    // a session-scoped twin must CHECK something, not just resolve a session.
    // Same permission constant the desktop path already uses for list_sales, asked
    // of the one gate helper this lane uses, so neither the permission name nor the
    // rule is copied into this crate.
    require_permission_for_user(&store, &session.user_id, permissions::SALES_VIEW)?;
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

/// Session-scoped variant of `get_sale`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_sale_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<SaleDetail>, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    // F-017, mirrored from the desktop bridge (`crates/kasirmu-bridge/src/history.rs`):
    // a session-scoped twin must CHECK something, not just resolve a session.
    // Same permission constant the desktop path already uses for get_sale, asked
    // of the one gate helper this lane uses, so neither the permission name nor the
    // rule is copied into this crate.
    require_permission_for_user(&store, &session.user_id, permissions::SALES_VIEW)?;
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
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    // F-017, mirrored from the desktop bridge (`crates/kasirmu-bridge/src/history.rs`):
    // a session-scoped twin must CHECK something, not just resolve a session.
    // Same permission constant the desktop path already uses for export_daily_summary, asked
    // of the one gate helper this lane uses, so neither the permission name nor the
    // rule is copied into this crate.
    require_permission_for_user(&store, &session.user_id, permissions::REPORTS_EXPORT)?;
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
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    // F-017, mirrored from the desktop bridge (`crates/kasirmu-bridge/src/history.rs`):
    // a session-scoped twin must CHECK something, not just resolve a session.
    // Same permission constant the desktop path already uses for export_sales_by_hour, asked
    // of the one gate helper this lane uses, so neither the permission name nor the
    // rule is copied into this crate.
    require_permission_for_user(&store, &session.user_id, permissions::REPORTS_EXPORT)?;
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
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    // F-017, mirrored from the desktop bridge (`crates/kasirmu-bridge/src/history.rs`):
    // a session-scoped twin must CHECK something, not just resolve a session.
    // Same permission constant the desktop path already uses for export_eod_report, asked
    // of the one gate helper this lane uses, so neither the permission name nor the
    // rule is copied into this crate.
    require_permission_for_user(&store, &session.user_id, permissions::REPORTS_EXPORT)?;

    let daily = store.export_daily_summary()?;
    let hourly = store.export_sales_by_hour()?;

    // Payment breakdown.
    let mut stmt = db.prepare(
        "SELECT payment_method, COUNT(*) AS cnt, SUM(total_minor) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'completed'
         GROUP BY payment_method
         ORDER BY tot DESC",
    )?;
    let payment_rows: Vec<PaymentBreakdown> = stmt
        .query_map([], |row| {
            Ok(PaymentBreakdown {
                method: row
                    .get::<_, Option<String>>("payment_method")?
                    .unwrap_or_else(|| "Unknown".into()),
                count: row.get("cnt")?,
                total: row.get("tot")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Void stats.
    let mut void_stmt = db.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor), 0) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'voided'",
    )?;
    let void_row: (i64, i64) = void_stmt.query_row([], |row| {
        Ok((row.get::<_, i64>("cnt")?, row.get::<_, i64>("tot")?))
    })?;
    drop(void_stmt);

    // Discount stats.
    let mut discount_stmt = db.prepare(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_minor), 0) AS tot
         FROM sales
         WHERE date(created_at) = date('now') AND status = 'completed' AND discount_percent > 0",
    )?;
    let discount_row: (i64, i64) = discount_stmt.query_row([], |row| {
        Ok((row.get::<_, i64>("cnt")?, row.get::<_, i64>("tot")?))
    })?;
    drop(discount_stmt);

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
        void_count: void_row.0,
        void_total: void_row.1,
        discount_count: discount_row.0,
        discount_total: discount_row.1,
        hourly_breakdown: hourly,
    })
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
