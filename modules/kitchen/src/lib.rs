/*
last audited 25-07-26 by RSA-Agent (modules-kitchen slice A: lib deep read)
crate: modules-kitchen | status: SAFE | lint: CLEAN
findings: clean documented STUB — kernel registration + sales/terminal dependencies; promotion path covers ticket tables, order.fired event subscription (tickets created by event, not direct call), and the SLA timer lifecycle (spawned in on_start, cancelled in on_stop so a stopped module leaves no live timer); documents existing runtime coupling (kasirmu_core features disable guard for kitchen-display while KDS tickets are open) that should consult this module on promotion; kitchen-display and table-management flags depend on restaurant; sibling tests per convention
next: none (promote KDS ticket state when built) | perf: N/A
*/

//! Kitchen Module — order firing, KDS tickets, and prep routing.
//!
//! Owns the restaurant back-of-house flow: firing an order to a station,
//! the KDS ticket queue and bump, course and table routing, and prep SLA
//! tracking for overdue escalation.
//!
//! Key types: [`KitchenModule`] (kernel lifecycle), [`KitchenError`].
//!
//! ## Stub status
//!
//! This is a **stub**: it registers with the kernel, declares its
//! dependencies, and logs its lifecycle transitions. The KDS today is
//! frontend-only (`KdsScreen` plus the LAN sync path in `platform/sync`)
//! with no Rust module owning ticket state. The `kitchen-display` and
//! `table-management` feature flags already gate the capability, and both
//! depend on `restaurant`.
//!
//! Note the existing runtime coupling: `kasirmu_core::features` enforces a
//! disable guard that refuses to turn `kitchen-display` off while KDS
//! tickets are open. When this stub is promoted, that guard should consult
//! this module rather than reaching into `kasirmu-core` tables directly.
//!
//! Promotion path — see `modules/README.md`:
//! 1. Move ticket tables and queries into `repository.rs`.
//! 2. Subscribe to `order.fired` in `on_load` so tickets are created by
//!    event rather than by a direct call from the POS screen.
//! 3. Move the overdue/SLA escalation timer into `on_start`, and cancel it
//!    in `on_stop` so a stopped module leaves no live timer behind.

pub mod error;

pub use error::KitchenError;

use foundation::contracts::{Module, ModuleId, ModuleResult};
use tracing::info;

/// Stable module id, matching the `id` field in `manifest.json`.
pub const MODULE_ID: ModuleId = "kitchen";

/// The Kitchen module.
///
/// Implements [`Module`] so the kernel can order it after `sales` and
/// `terminal` during load/start and before them during shutdown.
#[derive(Debug, Default)]
pub struct KitchenModule;

impl KitchenModule {
    /// Create a new `KitchenModule`.
    pub fn new() -> Self {
        Self
    }
}

impl Module for KitchenModule {
    fn id(&self) -> ModuleId {
        MODULE_ID
    }

    fn dependencies(&self) -> &'static [ModuleId] {
        // Tickets originate from fired sales orders, and station routing is
        // per-terminal.
        &["sales", "terminal"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("kitchen module: on_load (stub — no handlers registered yet)");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("kitchen module: on_start (stub — no SLA timer spawned yet)");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("kitchen module: on_stop (stub)");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
