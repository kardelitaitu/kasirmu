/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: lib re-verify)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: clean — Module trait registration layer; unwraps test-only; previous 19-07 stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Inventory Module — product catalog and stock management.
//!
//! This module owns the entire inventory vertical: product CRUD,
//! stock tracking, product variants, categories, barcode lookup,
//! and inventory adjustments.
//!
//! ## Current state
//!
//! The InventoryModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (DB CRUD, Tauri commands) and frontend (screens, API calls,
//! Fluent locale) still live in their original locations:
//!
//! - Backend: `crates/kasirmu-core/src/db/products.rs` + `apps/desktop-client/src/commands/products.rs`
//! - Frontend: `ui/src/features/products/` + `ui/src/features/inventory/`
//! - API: `ui/src/api/products.ts`
//! - Locale: `ui/src/locales/{en,fr,es,de,zh,ja}/products.ftl` + `inventory.ftl`
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/inventory/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/inventory/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports key inventory domain types from `kasirmu-core` so that
//! consumers can access all inventory-related types through a single crate:
//!
//! ```
//! # use modules_inventory::{InventoryModule, Product, Category, Inventory};
//! ```

pub mod error;
pub mod handlers;
pub mod models;
pub mod repository;
pub mod service;

pub use error::InventoryError;

pub use foundation::{Money, Sku};
pub use models::{
    CANONICAL_DEFAULT_LOCATION_UUID, Category, Inventory, InventoryLocation, InventoryShift,
    LocationId, Product, ProductType, ProductWithDetails, StockThreshold,
    WorkspaceInventoryLocation,
};
pub use repository::InventoryRepository;
pub use service::InventoryService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Inventory module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual inventory logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct InventoryModule;

impl InventoryModule {
    /// Create a new InventoryModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for InventoryModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for InventoryModule {
    fn id(&self) -> &'static str {
        "inventory"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("inventory module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers with the event bus (e.g., handle sale.completed to decrement stock)
        // 2. Validate that the database has the required tables
        // 3. Pre-load any in-memory caches (e.g., category list, barcode index)
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("inventory module: on_start — ready to manage products");
        // In future phases, this will:
        // 1. Warm up any in-memory caches
        // 2. Verify stock integrity
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("inventory module: on_stop — cleaning up");
        // In future phases, this will:
        // 1. Flush any pending writes
        // 2. Persist in-memory state
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    #[test]
    fn inventory_module_id() {
        let module = InventoryModule::new();
        assert_eq!(module.id(), "inventory");
    }

    #[test]
    fn inventory_module_lifecycle() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(InventoryModule::new())).unwrap();
        assert!(kernel.is_registered("inventory"));
        assert_eq!(kernel.module_count(), 1);

        kernel.load_all().unwrap();
        assert!(kernel.is_loaded());

        kernel.start_all().unwrap();
        assert!(kernel.is_started());

        kernel.stop_all().unwrap();
        assert!(!kernel.is_loaded());
        assert!(!kernel.is_started());
    }

    #[test]
    fn inventory_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(InventoryModule::new())).unwrap();
        let err = kernel.register(Box::new(InventoryModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn inventory_module_on_load_succeeds() {
        let mut module = InventoryModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn inventory_module_on_start_succeeds() {
        let mut module = InventoryModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn inventory_module_on_stop_succeeds() {
        let mut module = InventoryModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn inventory_module_full_lifecycle_with_kernel() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(InventoryModule::new())).unwrap();

        // load → start → stop
        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        // Module is still registered after stop
        assert!(kernel.is_registered("inventory"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(InventoryModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        // Verify both are registered
        assert!(kernel.is_registered("inventory"));
        assert!(kernel.is_registered("other"));
        assert_eq!(kernel.module_count(), 2);
    }

    /// Minimal module for coexistence test.
    #[derive(Debug)]
    struct OtherModule;

    impl Module for OtherModule {
        fn id(&self) -> &'static str {
            "other"
        }

        fn on_load(&mut self) -> ModuleResult {
            Ok(())
        }

        fn on_start(&mut self) -> ModuleResult {
            Ok(())
        }

        fn on_stop(&mut self) -> ModuleResult {
            Ok(())
        }
    }
}
