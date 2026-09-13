//! Sales-history command bodies (list, get and export summaries).
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-client/src/commands/history.rs`. The only rewrites are the
//! mechanical `state.*` → `ctx.*` receiver swaps and `AppError::` →
//! `BridgeError::`; SQL, gate kind and order, lock order and count and all
//! error strings are unchanged.

use serde::Serialize;

use oz_core::Money;
use oz_core::db::{DailySummaryRow, SalesByHourRow, Store};
use oz_core::permissions;
use oz_core::subscription::TenantSubscription;

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
    drop(db);
    Ok(SaleListResponse {
        sales: sales.into_iter().map(map_sale_to_item).collect(),
        sales_history_capped: capped,
    })
}

/// Shared mapping from `oz_core::Sale` to `SaleListItem`.
fn map_sale_to_item(s: oz_core::Sale) -> SaleListItem {
    SaleListItem {
        id: s.id,
        total: s.total,
        line_count: s.line_count,
        status: format!("{:?}", s.status),
        payment_method: s.payment_method,
        user_id: s.user_id,
        created_at: s.created_at,
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
    pub lines: Vec<oz_core::SaleLine>,
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
    drop(db);
    Ok(sale.map(|s| map_sale_to_detail(s, tax_estimate_note)))
}

/// Shared mapping from `oz_core::Sale` to `SaleDetail`.
fn map_sale_to_detail(s: oz_core::Sale, tax_estimate_note: Option<String>) -> SaleDetail {
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
mod history_tests;
