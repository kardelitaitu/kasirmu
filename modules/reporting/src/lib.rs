/*
last audited 25-07-26 by RSA-Agent (modules-reporting slice A: lib re-verify)
crate: modules-reporting | status: SAFE | lint: CLEAN
findings: clean Module registration layer; the redundant read-only domain surface (ReportingService / ReportingRepository / DailyReport / ReportingError) was retired 2026-10-03 under Phase 3 P3.1 — it had zero non-test callers and duplicated the live kasirmu_core::db::reports facade, and its one cross-vertical query was the last reporting facade-bypass edge
next: none | perf: N/A
*/

//! Reporting Module — the reporting vertical's module shell.
//!
//! ## Current state
//!
//! The ReportingModule implements the [`Module`] trait and is registered
//! with the kernel during application startup.
//!
//! This module no longer subscribes to `sale.completed`. It used to maintain a
//! `report_sales` projection, but that table had no reader anywhere in the tree
//! while the handler paid a lazy `CREATE TABLE` plus an unbounded append on
//! every completed sale (MSL-11). The daily/weekly/monthly aggregates are
//! computed directly from `sales` and `refunds` by
//! `kasirmu_core::db::reports`, which groups by currency, honours the store's
//! UTC offset, and joins refunds so a refund-only day still produces a row.
//!
//! # What was here before (retired 2026-10-03, Phase 3 P3.1)
//!
//! A read-only domain surface — `ReportingService`, `ReportingRepository`,
//! `DailyReport` and `ReportingError` — used to live here. It had **zero
//! non-test callers**, and the capability it implemented was already shipped by
//! `kasirmu_core::db::reports`, the live aggregate surface used by
//! `kasirmu-bridge` and both shells. Worse, its one query
//! (`generate_daily_report` reading `sales` directly) was the **last
//! reporting facade-bypass edge** in the tree: it bypassed the sanctioned
//! facade with its own SQL and carried a frozen baseline entry plus a T3 grant
//! marker for the privilege of doing so.
//!
//! The Phase 1 inventory (`docs/architecture/reporting-facade-inventory.md`)
//! recorded the disposition: route through the facade, then delete the method,
//! the marker and the baseline entry together. Because the method had no
//! callers, the migration is the deletion. The frozen cross-vertical edge count
//! drops from 2 to 1 (the loyalty gift-card read remains).
//!
//! # What remains
//!
//! The module **shell** stays: it is a registered vertical, and this repo
//! deliberately keeps stub verticals (`purchasing`, `promotions`,
//! `giftcards`, `kitchen`) that own a manifest, an id and dependency edges
//! with no domain logic yet. The lifecycle hooks only log, so the registration
//! proves the vertical is wired, not that it owns code.
//!
//! ## Module manifest
//!
//! See `modules/reporting/manifest.json` for the module metadata.

#![deny(unsafe_code)]

/// Whether the reporting vertical has any domain code left.
///
/// This is a documentation anchor, not a behaviour switch: the value is
/// `false` and exists so the retired-surface decision is testable rather than
/// living only in prose. It is replaced if the vertical is ever dropped.
pub const HAS_DOMAIN_SURFACE: bool = false;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Reporting module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. It owns no event handlers: the `report_sales` projection was
/// removed with MSL-11 because nothing read it, and the read-only repository
/// surface was retired under Phase 3 P3.1 because it duplicated the facade.
#[derive(Debug)]
pub struct ReportingModule;

impl ReportingModule {
    /// Create a new ReportingModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for ReportingModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for ReportingModule {
    fn id(&self) -> &'static str {
        "reporting"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        // Mirrors `dependencies` in modules/reporting/manifest.json: report
        // rows are derived from sales and inventory data.
        &["inventory", "sales"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("reporting module: on_load — validating configuration");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("reporting module: on_start — ready");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("reporting module: on_stop — shutting down");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
