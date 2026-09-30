//! The ReportingFacade trait (Phase 4 P4.2).
//!
//! Plan section 9.5 names the sanctioned cross-vertical read path and sketches a
//! four-method trait. The facade capability already SHIPS as inherent methods on
//! [`Store`](crate::db::Store) in `crate::db::reports` (24 public query methods,
//! inventoried in `docs/architecture/reporting-facade-inventory.md` section 2). This
//! module gives that surface a NAME a caller can depend on without depending on
//! the concrete submodule types, so "the facade is the only broad read path" is a
//! type-level fact rather than a convention.
//!
//! # Why four methods, not twenty-four
//!
//! The inventory (section 5) fixes the trait at the plan's four *aggregate
//! families* -- daily revenue, operational summary, product/category rollups, and
//! stock alerts -- each represented here by its canonical method. A trait that
//! mirrored every inherent method would add an indirection with no boundary, and
//! the facade's whole value is the boundary. A caller that needs a specific rollup
//! beyond these four should resolve the concrete method through
//! `kasirmu_core::db::reports`, not widen the sanctioned interface. If a fifth
//! family proves necessary, it is added here deliberately, with the inventory
//! amended -- the trait grows by decision, not by mechanical mirroring.

use crate::db::Store;
use crate::db::reports::{DailyRevenueRow, HourlyHeatmapRow, LowStockAlert, TopProductRow};
use crate::error::CoreError;

/// The sanctioned cross-vertical read path for reporting (ADR-62 D5, plan
/// section 9.5).
///
/// The four methods are the four aggregate families. Callers (bridge, UI, export)
/// depend on this trait rather than on the concrete `reports` submodule types.
///
/// The one sanctioned write (`acknowledge_stock_alert`) is deliberately NOT on
/// this trait: the trait is a READ contract, and the narrowed write exception
/// lives on the concrete surface per amended ADR-62 D5.
pub trait ReportingFacade {
    /// Daily revenue per currency, refunds netted (revenue family).
    ///
    /// # Errors
    ///
    /// Returns `CoreError` when a date bound is malformed or the query fails.
    fn daily_revenue(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyRevenueRow>, CoreError>;

    /// Sale counts and revenue per weekday/hour cell (operational summary family).
    ///
    /// # Errors
    ///
    /// Returns `CoreError` when a date bound is malformed or the query fails.
    fn hourly_heatmap(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<HourlyHeatmapRow>, CoreError>;

    /// Top products by revenue or profit over a date range (product rollup family).
    ///
    /// # Errors
    ///
    /// Returns `CoreError` when a date bound is malformed or the query fails.
    fn top_products(
        &self,
        start_date: &str,
        end_date: &str,
        limit: i64,
        order_by: &str,
    ) -> Result<Vec<TopProductRow>, CoreError>;

    /// Products at or below a stock threshold at a location (stock-alert family).
    ///
    /// The inventory section 5 names the plan's `low_stock_alerts` as the family
    /// representative, but that method is `#[deprecated]` in favour of
    /// `low_stock_alerts_at_location` (product_sales.rs:218). Reproducing a
    /// deprecated method on a NEW interface would freeze the deprecation, so the
    /// trait takes the successor; this deviation from the plan's literal method
    /// name is recorded here and in the inventory.
    ///
    /// # Errors
    ///
    /// Returns `CoreError` when the query fails.
    fn low_stock_alerts_at_location(
        &self,
        location_id: &str,
        default_threshold: i64,
    ) -> Result<Vec<LowStockAlert>, CoreError>;
}

impl ReportingFacade for Store<'_> {
    fn daily_revenue(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyRevenueRow>, CoreError> {
        Store::daily_revenue(self, start_date, end_date)
    }

    fn hourly_heatmap(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<HourlyHeatmapRow>, CoreError> {
        Store::hourly_heatmap(self, start_date, end_date)
    }

    fn top_products(
        &self,
        start_date: &str,
        end_date: &str,
        limit: i64,
        order_by: &str,
    ) -> Result<Vec<TopProductRow>, CoreError> {
        Store::top_products(self, start_date, end_date, limit, order_by)
    }

    fn low_stock_alerts_at_location(
        &self,
        location_id: &str,
        default_threshold: i64,
    ) -> Result<Vec<LowStockAlert>, CoreError> {
        Store::low_stock_alerts_at_location(self, location_id, default_threshold)
    }
}

#[cfg(test)]
#[path = "facade_tests.rs"]
mod tests;
