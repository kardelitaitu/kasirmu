/*
last audited (date unknown) by DSH-Agent
crate: kasirmu-reporting | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks. 12 production .expect() calls in metrics.rs — all prometheus metric registration with literal static opts (documented-invariant: fresh construction + registration cannot fail at runtime; standard prometheus pattern). Parameterized SQL queries, integer minor units throughout. No defects found.
NOTE 2026-09-30: the `metrics.rs` half of that finding is now HISTORICAL — the module was retired on
2026-09-30 (checklist C29, decision D13). `default = []` and `metrics = ["dep:prometheus"]` were
declared here and enabled by NO dependent, so it compiled in no production build; `platform/startup`
had already retired an identical feature-gated module on 2026-09-12 for the same reason. `daily_summary`
went with it: zero external Rust callers, duplicating `kasirmu_core::db::reports`, which is the LIVE
aggregate surface. `margin` and `menu_engineering` are live and unchanged.
next: none | perf: N/A
*/
//! Analytics and CSV export engine for kasir.mu.
//!
//! `kasirmu-reporting` aggregates data from the local SQLite store and
//! produces menu-engineering and margin reports plus CSV exports. Reports are
//! computed on the device to keep the offline-first guarantee; cloud sync of
//! pre-aggregated reports is planned as a separate service.
//!
//! The implemented query surfaces are [`menu_engineering::query_menu_engineering`]
//! and [`margin::query_sale_lines_with_margin`].
//!
//! # Wiring status: two modules live, two retired on 2026-09-30
//!
//! **Live.** `margin` and `menu_engineering`, reached through
//! `crates/kasirmu-bridge/src/reports.rs` and both shells' `commands/reports.rs`.
//!
//! **Retired.** `daily_summary` and `metrics`, under checklist item C29.
//! `metrics` was gated on `default = []` / `metrics = ["dep:prometheus"]` and **no
//! dependent enabled it**, so it compiled in no production build — and
//! `platform/startup` had already retired an identical feature-gated module on
//! 2026-09-12 for exactly that reason, which is the precedent this followed.
//! `daily_summary` had zero external Rust callers and duplicated a capability the
//! tree already ships: `kasirmu_core::db::reports` is the live aggregate surface
//! and provides `top_products`, `daily_revenue`, `hourly_heatmap` and ~15 further
//! queries, at least as capable (it groups by currency, honours the store's UTC
//! offset and joins refunds).
//!
//! **The daily-summary capability did not leave with them.** `modules/reporting`
//! carries its own read-only `ReportingRepository` / `ReportingService`, which are
//! *also* unwired. Those are documented as redundant inside that module rather
//! than deleted, because its module shell is a registered vertical.

#![deny(unsafe_code)]

pub mod error;
pub mod margin;
pub mod menu_engineering;

pub use error::ReportingError;

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
