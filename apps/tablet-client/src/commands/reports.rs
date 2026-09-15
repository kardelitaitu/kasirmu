//! Intelligence / reporting commands: revenue, heatmap, top products, alerts.
//!
//! All registered reporting commands resolve the caller's session before
//! reading store data. The session supplies both the store database and the
//! authenticated user used for permission checks.
//!
//! Every body delegates to `oz_bridge::reports` (ADR #49). The gate stays
//! NON-scope-aware exactly where it was: the permission check runs against the
//! global identity DB through a plain `Store::new` (NOT a cache-attached
//! store), in the original order — resolve the session, take the global lock,
//! check the permission, release, then open the session's own store DB. The
//! bound-check validators stay ahead of the gate, `reports:export` is required
//! only by `build_custom_report_scoped`, and every error string is unchanged.

use tauri::{State, command};

use oz_core::db::popularity::{CategoryForecastRow, CategoryPopularityRow, CategoryTrendPoint};
use oz_core::db::reports::{
    BasketSizeRow, BasketTrendRow, CategoryBreakdownRow, CustomerSplitRow, DailyRevenueRow,
    DiscountsSummaryRow, HourlyHeatmapRow, HourlyOccupancyRow, InventoryTrendRow,
    InventoryTurnoverRow, LowStockAlert, MonthlyRevenueRow, PaymentMethodRow, TableTurnoverRow,
    TopProductRow, VoidedItemRow, VoidedSummaryRow, WeeklyRevenueRow,
};
use oz_core::export::{CustomReportRequest, CustomReportResponse};

use crate::error::AppError;
use crate::state::AppState;

#[command]
/// Get menu engineering for the session's store.
pub async fn get_menu_engineering_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<oz_reporting::menu_engineering::MenuEngineeringResult, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_menu_engineering_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get per-line cost and margin for a single sale (HPP exposure).
///
/// Enriches every line of the sale with the product's current cost, the
/// line margin, and the margin percentage (see `oz_reporting::margin`).
pub async fn get_sale_line_margins_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_reporting::margin::SaleLineMargin>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_sale_line_margins_scoped(&ctx, &session_token, &sale_id)
        .await
        .map_err(Into::into)
}

#[command]
/// Get daily revenue for the session's store.
pub async fn get_daily_revenue_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<DailyRevenueRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_daily_revenue_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get weekly revenue for the session's store.
pub async fn get_weekly_revenue_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<WeeklyRevenueRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_weekly_revenue_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get monthly revenue for the session's store.
pub async fn get_monthly_revenue_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<MonthlyRevenueRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_monthly_revenue_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get top products for the session's store with a bounded limit.
pub async fn get_top_products_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    limit: i64,
    order_by: String,
    state: State<'_, AppState>,
) -> Result<Vec<TopProductRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_top_products_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
        limit,
        &order_by,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
/// Get per-category popularity standings for the session's store: each
/// category's mean score, its ratio to the catalog average, and its
/// top products ranked by popularity (ADR #37 per-category evolution).
pub async fn get_category_popularity_scoped(
    session_token: String,
    top_per_category: i64,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryPopularityRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_category_popularity_scoped(&ctx, &session_token, top_per_category)
        .await
        .map_err(Into::into)
}

#[tauri::command]
/// Get the per-period popularity trend for the session's store: each of the
/// top categories' score over `start_date..=end_date`, bucketed by
/// `granularity` (`daily` | `weekly` | `monthly`) — the same ADR #37 blend
/// as the materialized scores, so the lines read against current standings.
pub async fn get_category_popularity_trend_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    granularity: String,
    top_categories: i64,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryTrendPoint>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_category_popularity_trend_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
        &granularity,
        top_categories,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
/// Get the next-period demand forecast per top category (simple linear fit
/// over the popularity trend series' recent units) for the session's store.
pub async fn get_category_forecast_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    granularity: String,
    top_categories: i64,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryForecastRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_category_forecast_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
        &granularity,
        top_categories,
    )
    .await
    .map_err(Into::into)
}

#[command]
/// Get hourly heatmap data for the session's store.
pub async fn get_hourly_heatmap_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<HourlyHeatmapRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_hourly_heatmap_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get low-stock alerts for the session's store default location.
pub async fn get_low_stock_alerts_scoped(
    session_token: String,
    threshold: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LowStockAlert>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_low_stock_alerts_scoped(&ctx, &session_token, threshold)
        .await
        .map_err(Into::into)
}

#[command]
/// Get category breakdown for the session's store.
pub async fn get_category_breakdown_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<CategoryBreakdownRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_category_breakdown_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get revenue split by payment method for the session's store.
pub async fn get_payment_method_breakdown_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentMethodRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_payment_method_breakdown_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
    )
    .await
    .map_err(Into::into)
}

#[command]
/// Get voided-sale totals for the session's store.
pub async fn get_voided_sales_summary_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<VoidedSummaryRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_voided_sales_summary_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
    )
    .await
    .map_err(Into::into)
}

#[command]
/// Get the top voided product lines for the session's store.
pub async fn get_voided_items_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<VoidedItemRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_voided_items_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
        limit,
    )
    .await
    .map_err(Into::into)
}

#[command]
/// Get average basket size for the session's store.
pub async fn get_basket_size_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<BasketSizeRow, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_basket_size_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get per-day basket size (mean line count) for the session's store.
pub async fn get_basket_size_trend_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<BasketTrendRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_basket_size_trend_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get new vs returning customer counts for the session's store.
pub async fn get_customer_split_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<CustomerSplitRow, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_customer_split_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get discount usage summary for the session's store.
pub async fn get_discounts_summary_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<DiscountsSummaryRow, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_discounts_summary_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Get a stock-turnover snapshot for the session's store at one location.
pub async fn get_inventory_turnover_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    location_id: String,
    state: State<'_, AppState>,
) -> Result<InventoryTurnoverRow, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_inventory_turnover_scoped(
        &ctx,
        &session_token,
        &start_date,
        &end_date,
        &location_id,
    )
    .await
    .map_err(Into::into)
}

#[command]
/// Get daily units sold (the inventory trend line) for the session's store.
pub async fn get_inventory_trend_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<InventoryTrendRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_inventory_trend_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Completed table-bound orders per day for the session's store.
pub async fn get_table_turnover_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableTurnoverRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_table_turnover_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Completed table-bound orders per hour of day for the session's store.
pub async fn get_hourly_occupancy_scoped(
    session_token: String,
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<HourlyOccupancyRow>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::get_hourly_occupancy_scoped(&ctx, &session_token, &start_date, &end_date)
        .await
        .map_err(Into::into)
}

#[command]
/// Build a custom report for the session's store.
///
/// Custom reports can expose customer and staff data, so exporting them
/// requires the stronger `reports:export` permission.
pub async fn build_custom_report_scoped(
    session_token: String,
    request: CustomReportRequest,
    state: State<'_, AppState>,
) -> Result<CustomReportResponse, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::build_custom_report_scoped(&ctx, &session_token, request)
        .await
        .map_err(Into::into)
}

// ── Test seam ─────────────────────────────────────────────────────────────
//
// The bodies now live in `oz_bridge::reports`; `reports_tests.rs` drives the
// scope helper and the top-products bound directly. These forwarders keep that
// coverage pointed at the production implementation — including the
// `From<BridgeError> for AppError` seam, which is what the two error
// assertions actually observe — rather than at a private copy that could drift
// from it. `#[cfg(test)]` because nothing in a release build calls them: the
// doors above reach the bridge directly.

#[cfg(test)]
async fn resolve_report_scope(
    state: &AppState,
    session_token: &str,
    permission: &str,
) -> Result<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::reports::resolve_report_scope(&ctx, session_token, permission)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
fn validate_top_product_limit(limit: i64) -> Result<(), AppError> {
    Ok(oz_bridge::reports::validate_top_product_limit(limit)?)
}

#[cfg(test)]
#[path = "reports_tests.rs"]
mod tests;
