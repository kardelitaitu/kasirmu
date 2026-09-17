//! Reporting / intelligence command bodies (Wave E / E6) — the tauri-free half
//! of apps/desktop-client/src/commands/reports.rs.
//!
//! Key items: resolve_report_scope, the ONE session gate 24 of the 32 report
//! commands route through, plus the command bodies themselves — revenue
//! series, menu engineering, per-line margins, top products, category
//! popularity / trend / forecast, hourly heatmap, low-stock alerts, category
//! and payment breakdowns, voided totals, basket size, customer split,
//! discounts, inventory turnover and trend, table turnover / hourly occupancy,
//! and the custom-report builder.
//!
//! Every body is a verbatim port. The gate stays NON-scope-aware on purpose:
//! the permission check runs against the global identity DB through a plain
//! Store::new (NOT BridgeCtx::store, which would attach the cache and change
//! behaviour), in the original order — resolve session, take the global lock,
//! check the permission, release, then open the session's own store DB. The
//! bound-check validators stay ahead of the gate exactly where they were, the
//! global-DB variants keep their drop(db), reports:export is required only by
//! build_custom_report_scoped, and every error string is unchanged.

use std::sync::Arc;

use kasirmu_core::db::Store;
use kasirmu_core::db::popularity::{
    CategoryForecastRow, CategoryPopularityRow, CategoryTrendPoint,
};
use kasirmu_core::db::reports::{
    BasketSizeRow, BasketTrendRow, CategoryBreakdownRow, CustomerSplitRow, DailyRevenueRow,
    DiscountsSummaryRow, HourlyHeatmapRow, HourlyOccupancyRow, InventoryTrendRow,
    InventoryTurnoverRow, LowStockAlert, MonthlyRevenueRow, PaymentMethodRow, TableTurnoverRow,
    TopProductRow, VoidedItemRow, VoidedSummaryRow, WeeklyRevenueRow,
};
use kasirmu_core::export::{CustomReportRequest, CustomReportResponse};
use kasirmu_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Upper bound accepted by the top-products limit argument.
pub const MAX_TOP_PRODUCTS: i64 = 100;

/// Per-category popularity limits: a category's leaderboard needs only a
/// handful of entries (the UI shows the top 3).
pub const MAX_CATEGORY_TOP: i64 = 20;

/// Trend series limit: the chart shows one line per category, so more than
/// a handful of series becomes unreadable.
pub const MAX_TREND_CATEGORIES: i64 = 10;

/// Resolve the session's store database for a report command.
///
/// Port of the shell helper: resolve the session token, check the permission
/// for session.user_id against the GLOBAL identity store (non-scope-aware, as
/// the original was), then open the session's own store database.
///
/// # Errors
///
/// Returns BridgeError::InvalidSession for an unknown or expired token,
/// BridgeError::PermissionDenied when the role lacks the permission,
/// BridgeError::Internal when the store database cannot be opened, and
/// BridgeError::Core for identity-store read failures.
pub async fn resolve_report_scope(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    permission: &str,
) -> Result<Arc<std::sync::Mutex<rusqlite::Connection>>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    {
        let db = ctx.db.lock().await;
        let identity_store = Store::new(&db);
        ctx.require_permission_for_user(&identity_store, &session.user_id, permission)?;
    }
    ctx.db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))
}

/// Reject a top-products limit outside 1..=MAX_TOP_PRODUCTS.
///
/// # Errors
///
/// Returns BridgeError::Invalid with the bounded-range message.
pub fn validate_top_product_limit(limit: i64) -> Result<(), BridgeError> {
    if !(1..=MAX_TOP_PRODUCTS).contains(&limit) {
        return Err(BridgeError::Invalid(format!(
            "top product limit must be between 1 and {MAX_TOP_PRODUCTS}"
        )));
    }
    Ok(())
}

/// Reject a per-category leaderboard size outside 1..=MAX_CATEGORY_TOP.
///
/// # Errors
///
/// Returns BridgeError::Invalid with the bounded-range message.
pub fn validate_category_top(top_per_category: i64) -> Result<(), BridgeError> {
    if !(1..=MAX_CATEGORY_TOP).contains(&top_per_category) {
        return Err(BridgeError::Invalid(format!(
            "top per category must be between 1 and {MAX_CATEGORY_TOP}"
        )));
    }
    Ok(())
}

/// Reject an unknown granularity or a series count outside
/// 1..=MAX_TREND_CATEGORIES.
///
/// # Errors
///
/// Returns BridgeError::Invalid naming the accepted granularities, or the
/// bounded-range message for top_categories.
pub fn validate_trend_args(granularity: &str, top_categories: i64) -> Result<(), BridgeError> {
    if !kasirmu_core::db::popularity::TREND_GRANULARITIES.contains(&granularity) {
        return Err(BridgeError::Invalid(format!(
            "granularity must be one of {:?}",
            kasirmu_core::db::popularity::TREND_GRANULARITIES
        )));
    }
    if !(1..=MAX_TREND_CATEGORIES).contains(&top_categories) {
        return Err(BridgeError::Invalid(format!(
            "top categories must be between 1 and {MAX_TREND_CATEGORIES}"
        )));
    }
    Ok(())
}

/// The top-products ranking keys accepted by the command layer (whitelist
/// — the store query falls back to revenue for anything else).
///
/// # Errors
///
/// Returns BridgeError::Invalid naming the rejected order_by.
pub fn validate_top_product_order(order_by: &str) -> Result<(), BridgeError> {
    if !matches!(order_by, "revenue" | "profit") {
        return Err(BridgeError::Invalid(format!(
            "top product order must be 'revenue' or 'profit', got '{order_by}'"
        )));
    }
    Ok(())
}

/// Get menu engineering from the global database.
///
/// **Deprecated for multi-store (ADR #7):** Use get_menu_engineering_scoped.
pub async fn get_menu_engineering(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<kasirmu_reporting::menu_engineering::MenuEngineeringResult, BridgeError> {
    let db = ctx.db.lock().await;
    let result =
        kasirmu_reporting::menu_engineering::query_menu_engineering(&db, start_date, end_date)?;
    drop(db);
    Ok(result)
}

/// Get menu engineering for the session's store.
pub async fn get_menu_engineering_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<kasirmu_reporting::menu_engineering::MenuEngineeringResult, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(kasirmu_reporting::menu_engineering::query_menu_engineering(
        &db, start_date, end_date,
    )?)
}

/// Get per-line cost and margin for a single sale (HPP exposure).
///
/// Enriches every line of the sale with the product's current cost, the
/// line margin, and the margin percentage (see kasirmu_reporting::margin).
pub async fn get_sale_line_margins_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
) -> Result<Vec<kasirmu_reporting::margin::SaleLineMargin>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(kasirmu_reporting::margin::query_sale_lines_with_margin(
        &db, sale_id,
    )?)
}

/// Get daily revenue from the global database.
pub async fn get_daily_revenue(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailyRevenueRow>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.daily_revenue(start_date, end_date)?;
    drop(db);
    Ok(rows)
}

/// Get daily revenue for the session's store.
pub async fn get_daily_revenue_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DailyRevenueRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).daily_revenue(start_date, end_date)?)
}

/// Get weekly revenue from the global database.
pub async fn get_weekly_revenue(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<WeeklyRevenueRow>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.weekly_revenue(start_date, end_date)?;
    drop(db);
    Ok(rows)
}

/// Get weekly revenue for the session's store.
pub async fn get_weekly_revenue_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<WeeklyRevenueRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).weekly_revenue(start_date, end_date)?)
}

/// Get monthly revenue from the global database.
pub async fn get_monthly_revenue(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<MonthlyRevenueRow>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.monthly_revenue(start_date, end_date)?;
    drop(db);
    Ok(rows)
}

/// Get monthly revenue for the session's store.
pub async fn get_monthly_revenue_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<MonthlyRevenueRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).monthly_revenue(start_date, end_date)?)
}

/// Get top products from the global database.
pub async fn get_top_products(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
    limit: i64,
    order_by: &str,
) -> Result<Vec<TopProductRow>, BridgeError> {
    validate_top_product_order(order_by)?;
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.top_products(start_date, end_date, limit, order_by)?;
    drop(db);
    Ok(rows)
}

/// Get top products for the session's store with a bounded limit.
pub async fn get_top_products_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
    limit: i64,
    order_by: &str,
) -> Result<Vec<TopProductRow>, BridgeError> {
    validate_top_product_limit(limit)?;
    validate_top_product_order(order_by)?;
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).top_products(start_date, end_date, limit, order_by)?)
}

/// Get per-category popularity standings for the session's store: each
/// category's mean score, its ratio to the catalog average, and its
/// top products ranked by popularity (ADR #37 per-category evolution).
pub async fn get_category_popularity_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    top_per_category: i64,
) -> Result<Vec<CategoryPopularityRow>, BridgeError> {
    validate_category_top(top_per_category)?;
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).category_popularity(top_per_category)?)
}

/// Get the per-period popularity trend for the session's store: each of the
/// top categories' score over start_date..=end_date, bucketed by granularity
/// (daily | weekly | monthly) — the same ADR #37 blend as the materialized
/// scores, so the lines read against current standings.
pub async fn get_category_popularity_trend_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
    granularity: &str,
    top_categories: i64,
) -> Result<Vec<CategoryTrendPoint>, BridgeError> {
    validate_trend_args(granularity, top_categories)?;
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).category_popularity_trend(
        start_date,
        end_date,
        granularity,
        top_categories,
    )?)
}

/// Get the next-period demand forecast per top category (simple linear fit
/// over the popularity trend series' recent units) for the session's store.
pub async fn get_category_forecast_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
    granularity: &str,
    top_categories: i64,
) -> Result<Vec<CategoryForecastRow>, BridgeError> {
    validate_trend_args(granularity, top_categories)?;
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).category_forecast(start_date, end_date, granularity, top_categories)?)
}

/// Get hourly heatmap from the global database.
pub async fn get_hourly_heatmap(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<HourlyHeatmapRow>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.hourly_heatmap(start_date, end_date)?;
    drop(db);
    Ok(rows)
}

/// Get hourly heatmap for the session's store.
pub async fn get_hourly_heatmap_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<HourlyHeatmapRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).hourly_heatmap(start_date, end_date)?)
}

/// Get low stock alerts from the global database.
#[allow(deprecated)]
pub async fn get_low_stock_alerts(
    ctx: &BridgeCtx<'_>,
    threshold: i64,
) -> Result<Vec<LowStockAlert>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.low_stock_alerts(threshold)?;
    drop(db);
    Ok(rows)
}

/// Get low stock alerts for the session's default store location.
pub async fn get_low_stock_alerts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    threshold: i64,
) -> Result<Vec<LowStockAlert>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).low_stock_alerts_at_location(
        kasirmu_core::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
        threshold,
    )?)
}

/// Get category breakdown from the global database.
pub async fn get_category_breakdown(
    ctx: &BridgeCtx<'_>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CategoryBreakdownRow>, BridgeError> {
    let db = ctx.db.lock().await;
    let store = Store::new(&db);
    let rows = store.category_breakdown(start_date, end_date)?;
    drop(db);
    Ok(rows)
}

/// Get category breakdown for the session's store.
pub async fn get_category_breakdown_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CategoryBreakdownRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).category_breakdown(start_date, end_date)?)
}

/// Get revenue split by payment method for the session's store.
pub async fn get_payment_method_breakdown_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<PaymentMethodRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).payment_method_breakdown(start_date, end_date)?)
}

/// Get voided-sale totals for the session's store.
pub async fn get_voided_sales_summary_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<VoidedSummaryRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).voided_sales_summary(start_date, end_date)?)
}

/// Get the top voided product lines for the session's store.
pub async fn get_voided_items_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
    limit: i64,
) -> Result<Vec<VoidedItemRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).voided_items(start_date, end_date, limit)?)
}

/// Get average basket size for the session's store.
pub async fn get_basket_size_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<BasketSizeRow, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).avg_basket_size(start_date, end_date)?)
}

/// Get per-day basket size (mean line count) for the session's store.
pub async fn get_basket_size_trend_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<BasketTrendRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).basket_size_trend(start_date, end_date)?)
}

/// Get new vs returning customer counts for the session's store.
pub async fn get_customer_split_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<CustomerSplitRow, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).customer_split(start_date, end_date)?)
}

/// Get discount usage summary for the session's store.
pub async fn get_discounts_summary_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<DiscountsSummaryRow, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).discounts_summary(start_date, end_date)?)
}

/// Get a stock-turnover snapshot for the session's store at one location.
pub async fn get_inventory_turnover_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
    location_id: &str,
) -> Result<InventoryTurnoverRow, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).inventory_turnover(start_date, end_date, location_id)?)
}

/// Get daily units sold (the inventory trend line) for the session's store.
pub async fn get_inventory_trend_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<InventoryTrendRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).inventory_trend(start_date, end_date)?)
}

/// Completed table-bound orders per day for the session's store.
pub async fn get_table_turnover_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<TableTurnoverRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).table_turnover(start_date, end_date)?)
}

/// Completed table-bound orders per hour of day for the session's store.
pub async fn get_hourly_occupancy_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<HourlyOccupancyRow>, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_VIEW).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).hourly_table_activity(start_date, end_date)?)
}

/// Build a custom report for the session's store.
///
/// Custom reports can expose customer and staff data, so exporting them
/// requires the stronger reports:export permission.
pub async fn build_custom_report_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    request: CustomReportRequest,
) -> Result<CustomReportResponse, BridgeError> {
    let conn = resolve_report_scope(ctx, session_token, permissions::REPORTS_EXPORT).await?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    Ok(Store::new(&db).build_custom_report(request)?)
}

#[cfg(test)]
#[path = "reports_tests.rs"]
mod reports_tests;
