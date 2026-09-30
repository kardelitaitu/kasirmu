/*
last audited 25-07-26 by RSA-Agent (modules-reporting slice A: lib re-verify)
crate: modules-reporting | status: SAFE | lint: CLEAN
findings: clean Module registration layer; unwraps test-only; previous 19-07 stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Reporting Module — generates and exports sales, inventory, and financial reports.
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
//! What remains here is the read-only surface: the report DTOs and
//! [`ReportingRepository`], a thin query layer over the live tables.
//!
//! # Wiring status: the shell is registered, the domain surface is redundant
//!
//! [`ReportingModule`] is registered with the kernel at startup
//! (`platform/startup/src/lib.rs:107`) and its lifecycle hooks run — but they
//! only log, so the registration proves the vertical is wired, not that its
//! domain code is used.
//!
//! **The domain surface below is unwired and redundant, and that is recorded
//! rather than fixed.** [`ReportingService`], [`ReportingRepository`] and
//! [`DailyReport`] have **zero non-test callers**, and the capability they
//! implement is already shipped by `kasirmu_core::db::reports`, which is the
//! live aggregate surface used by `kasirmu-bridge` and both shells. The
//! duplication was narrowed on 2026-09-30 (checklist C29) when
//! `kasirmu-reporting::daily_summary` — a third implementation of the same
//! daily-summary job — was deleted from the sibling crate.
//!
//! It is **not** deleted here because this module shell is a registered
//! vertical, and this repo deliberately keeps stub verticals (`purchasing`,
//! `promotions`, `giftcards`, `kitchen`) that own a manifest, an id and
//! dependency edges with no domain logic yet. Removing it means unregistering
//! the module and editing the parity test that pins the registration block
//! against the `modules/*/manifest.json` set — a convention change, not a
//! cleanup. **If the vertical is ever dropped, this file's domain modules go
//! with it**; until then the honest label is this paragraph.
//!
//! ## Module manifest
//!
//! See `modules/reporting/manifest.json` for the module metadata.

#![deny(unsafe_code)]

pub mod error;
pub mod handlers;
pub mod models;
pub mod repository;
pub mod service;

pub use error::ReportingError;

pub use models::DailyReport;
pub use repository::ReportingRepository;
pub use service::ReportingService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Reporting module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. It owns no event handlers: the `report_sales` projection was
/// removed with MSL-11 because nothing read it (see the module docs).
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
        info!("reporting module: on_start — ready for reporting");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("reporting module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
