//! Reporting queries: revenue summaries, top products, heatmap, low-stock alerts.
//!
//! # Decomposition (13-09-26)
//!
//! The 1,314-line monolith split along its real seams into submodules:
//! `datetime` (the REP-03 timezone/date-bound contract), `revenue`
//! (daily/weekly/monthly aggregation), `sales_summary` (operational
//! rollups: heatmap, tender split, voids, baskets, customers, discounts,
//! table activity) and `product_sales` (top products, category
//! breakdown, low-stock alerts and events, inventory turnover/trend).
//! This file keeps only the module wiring and the re-exports callers
//! resolve through it — `kasirmu_core::db::reports::<Name>` paths did not
//! move. Behaviour unchanged.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B5 part 2: reports deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: COR-21 MEDIUM RESOLVED (REP-03, 2026-08-31): all date/hour bucketing now applies the primary store's fixed UTC offset — locations.timezone holds '+HH:MM'/'-HH:MM'/'UTC' (IANA names fall back to UTC; no tzdata dep), threaded through reports/analytics/popularity-trend/sales-today/shift-hours, and date boundaries are validated as strict YYYY-MM-DD. Remaining from the original finding: top_products limit clamped to 1..=1000 matching voided_items; COGS uses current product cost by documented reporting-layer semantics
next: none for COR-21 (cloud email parity for tz recorded as follow-up in audit-open-findings) | perf: correlated COGS subqueries are deliberate anti-multiplication design, documented
*/

mod datetime;
mod product_sales;
// pub(crate) so the plan test in migrations_tests.rs can plan the SAME SQL text
// the product runs (the MENU_ENGINEERING_SQL precedent).
pub(crate) mod revenue;
mod sales_summary;

pub(crate) use datetime::{check_date_bound, parse_utc_offset};
// Re-exported for the integration plan probe
// (`crates/kasirmu-core/tests/integration/query_plan_probe.rs`), which needs
// the SAME text the product prepares. The constants are `pub` inside the
// `pub(crate)` `revenue` module for exactly this reason: an integration test
// is a separate crate and can only see `pub` items, and a probe holding its
// own copy stays green when the real query is reshaped back into the scanning
// form. The module itself stays crate-private.
pub use product_sales::{
    CATEGORY_BREAKDOWN_SQL, CategoryBreakdownRow, INVENTORY_TREND_SQL, InventoryTrendRow,
    InventoryTurnoverRow, LowStockAlert, StockAlertEvent, TOP_PRODUCTS_SQL, TopProductRow,
};
pub use revenue::{DAILY_REVENUE_SQL, MONTHLY_REVENUE_SQL, WEEKLY_REVENUE_SQL};
pub use revenue::{DailyRevenueRow, MonthlyRevenueRow, WeeklyRevenueRow};
pub use sales_summary::{
    BasketSizeRow, BasketTrendRow, CustomerSplitRow, DiscountCodeRow, DiscountsSummaryRow,
    HOURLY_HEATMAP_SQL, HourlyHeatmapRow, HourlyOccupancyRow, PAYMENT_METHOD_BREAKDOWN_SQL,
    PIUTANG_COLLECTIONS_SQL, PaymentMethodRow, PiutangCollectionRow, TableTurnoverRow,
    VOIDED_ITEMS_SQL, VoidedItemRow, VoidedSummaryRow,
};

#[cfg(test)]
#[path = "reports_tests.rs"]
mod tests;
