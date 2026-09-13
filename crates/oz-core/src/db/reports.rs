//! Reporting queries: revenue summaries, top products, heatmap, low-stock alerts.
//!
//! # Decomposition (13-09-26)
//!
//! The 1,314-line monolith split along its real seams into submodules:
//! [`datetime`] (the REP-03 timezone/date-bound contract), [`revenue`]
//! (daily/weekly/monthly aggregation), [`sales_summary`] (operational
//! rollups: heatmap, tender split, voids, baskets, customers, discounts,
//! table activity) and [`product_sales`] (top products, category
//! breakdown, low-stock alerts and events, inventory turnover/trend).
//! This file keeps only the module wiring and the re-exports callers
//! resolve through it — `oz_core::db::reports::<Name>` paths did not
//! move. Behaviour unchanged.
/*
last audited 25-07-26 by RSA-Agent (oz-core slice B5 part 2: reports deep read)
crate: oz-core | status: SAFE | lint: CLEAN
findings: COR-21 MEDIUM RESOLVED (REP-03, 2026-08-31): all date/hour bucketing now applies the primary store's fixed UTC offset — locations.timezone holds '+HH:MM'/'-HH:MM'/'UTC' (IANA names fall back to UTC; no tzdata dep), threaded through reports/analytics/popularity-trend/sales-today/shift-hours, and date boundaries are validated as strict YYYY-MM-DD. Remaining from the original finding: top_products limit still unclamped (voided_items clamps — inconsistent, low impact); COGS uses current product cost by documented reporting-layer semantics
next: none for COR-21 (cloud email parity for tz recorded as follow-up in audit-open-findings) | perf: correlated COGS subqueries are deliberate anti-multiplication design, documented
*/

mod datetime;
mod product_sales;
mod revenue;
mod sales_summary;

pub(crate) use datetime::{check_date_bound, parse_utc_offset};
pub use product_sales::{
    CategoryBreakdownRow, InventoryTrendRow, InventoryTurnoverRow, LowStockAlert, StockAlertEvent,
    TopProductRow,
};
pub use revenue::{DailyRevenueRow, MonthlyRevenueRow, WeeklyRevenueRow};
pub use sales_summary::{
    BasketSizeRow, BasketTrendRow, CustomerSplitRow, DiscountCodeRow, DiscountsSummaryRow,
    HourlyHeatmapRow, HourlyOccupancyRow, PaymentMethodRow, TableTurnoverRow, VoidedItemRow,
    VoidedSummaryRow,
};

#[cfg(test)]
#[path = "reports_tests.rs"]
mod tests;
