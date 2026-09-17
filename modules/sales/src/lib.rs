/*
last audited 25-07-26 by RSA-Agent (modules-sales slice B: lib+module re-verify)
crate: modules-sales | status: SAFE | lint: CLEAN
findings: clean — Module trait registration layer with documented backend/frontend migration state; re-exports foundation cart/money types and module models; previous 19-07 stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Sales Module — core point-of-sale functionality.
//!
//! This is the first real module in the OZ-POS module system. It owns
//! the entire sales vertical: cart management, checkout, payment
//! processing, sales history, void/refund, held orders, and
//! end-of-day reports.
//!
//! ## Current state
//!
//! The SalesModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (DB CRUD, Tauri commands) and frontend (screens, API calls,
//! Fluent locale) still live in their original locations:
//!
//! - Backend: `crates/kasirmu-core/src/db/sales.rs` + `apps/desktop-client/src/commands/pos.rs`
//! - Frontend: `ui/src/features/sales/` + `ui/src/api/sales.ts`
//! - Locale: `ui/src/locales/sales.ftl`
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/sales/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/sales/manifest.json` for the module metadata.

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::SalesError;

pub use foundation::{Cart, CartError, CartId, CartLine, LineId, Money, SaleStatus, Sku};
pub use models::{
    DailySummaryRow, HeldCartFull, HeldCartRow, Refund, RefundLine, Sale, SaleLine, SalesByHourRow,
};
pub use repository::SalesRepository;
pub use service::SalesService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Sales module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual sales logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct SalesModule;

impl SalesModule {
    /// Create a new SalesModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for SalesModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for SalesModule {
    fn id(&self) -> &'static str {
        "sales"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        // Mirrors `dependencies` in modules/sales/manifest.json: a
        // checkout decrements stock, so inventory loads and starts first.
        &["inventory"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("sales module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers with the event bus
        // 2. Validate that the database has the required tables
        // 3. Check that the inventory module is available
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("sales module: on_start — ready to process sales");
        // In future phases, this will:
        // 1. Spawn any background tasks (e.g., sync watcher)
        // 2. Initialize in-memory state
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("sales module: on_stop — cleaning up");
        // In future phases, this will:
        // 1. Flush any pending writes
        // 2. Cancel background tasks
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
