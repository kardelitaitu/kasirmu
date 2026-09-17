/*
last audited 25-07-26 by RSA-Agent (modules-purchasing slice A: lib deep read)
crate: modules-purchasing | status: SAFE | lint: CLEAN
findings: clean documented STUB — kernel registration + inventory dependency only; promotion path to repository/service documented; PurchaseOrders feature flag gates the capability separately from module start; sibling tests file per convention
next: none (migrate supplier/PO logic when built) | perf: N/A
*/

//! Purchasing Module — suppliers, purchase orders, and goods receipt.
//!
//! Owns the inbound side of stock: supplier records, purchase orders,
//! partial/full goods receipt, and the cost updates a receipt implies.
//!
//! Key types: [`PurchasingModule`] (kernel lifecycle), [`PurchasingError`].
//!
//! ## Stub status
//!
//! This is a **stub**: it registers with the kernel, declares its
//! dependency on `inventory`, and logs its lifecycle transitions. It owns
//! no tables and no commands yet. The `purchase-orders` feature flag
//! (`kasirmu_core::features::Feature::PurchaseOrders`) already gates the
//! capability, so enabling the flag and starting this module are separate,
//! independently reviewable steps.
//!
//! Promotion path — see `modules/README.md`:
//! 1. Move supplier/PO tables and queries into `repository.rs`.
//! 2. Move receipt orchestration into `service.rs` behind a transaction.
//! 3. Subscribe to `stock.adjusted` / emit `purchase.received` in `on_load`.

pub mod error;

pub use error::PurchasingError;

use foundation::contracts::{Module, ModuleId, ModuleResult};
use tracing::info;

/// Stable module id, matching the `id` field in `manifest.json`.
pub const MODULE_ID: ModuleId = "purchasing";

/// The Purchasing module.
///
/// Implements [`Module`] so the kernel can order it after `inventory`
/// during load/start and before it during shutdown.
#[derive(Debug, Default)]
pub struct PurchasingModule;

impl PurchasingModule {
    /// Create a new `PurchasingModule`.
    pub fn new() -> Self {
        Self
    }
}

impl Module for PurchasingModule {
    fn id(&self) -> ModuleId {
        MODULE_ID
    }

    fn dependencies(&self) -> &'static [ModuleId] {
        // Receiving stock writes inventory levels, so inventory must be
        // loaded and started first.
        &["inventory"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("purchasing module: on_load (stub — no handlers registered yet)");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("purchasing module: on_start (stub)");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("purchasing module: on_stop (stub)");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
