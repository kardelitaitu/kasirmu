/*
last audited DD-MM-YY by DSH-Agent
crate: oz-reporting | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks. 12 production .expect() calls in metrics.rs — all prometheus metric registration with literal static opts (documented-invariant: fresh construction + registration cannot fail at runtime; standard prometheus pattern). Parameterized SQL queries, integer minor units throughout. No defects found.
next: none | perf: N/A
*/
//! Analytics and CSV export engine for OZ-POS.
//!
//! `oz-reporting` aggregates data from the local SQLite store and
//! produces daily summaries, sales-by-hour, inventory movement, and
//! CSV exports. Reports are computed on the device to keep the
//! offline-first guarantee; cloud sync of pre-aggregated reports is
//! planned as a separate service.
//!
//! This crate is a scaffold — reports are added once the cart, sale,
//! payment, and inventory tables stabilize.

#![deny(unsafe_code)]

pub mod daily_summary;
pub mod error;
pub mod margin;
pub mod menu_engineering;
#[cfg(feature = "metrics")]
pub mod metrics;

pub use daily_summary::{
    DailySummaryResult, DailySummaryRow, HourlySalesRow, TopProductRow, query_daily_summary,
    query_sales_by_hour, query_top_products,
};
pub use error::ReportingError;
#[cfg(feature = "metrics")]
pub use metrics::*;

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
