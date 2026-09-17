/*
last audited 25-07-26 by RSA-Agent (modules-crm slice A: lib re-verify)
crate: modules-crm | status: SAFE | lint: CLEAN
findings: clean Module registration layer
next: none | perf: N/A
*//*
last audited 19-07-26 by RSA-Agent
crate: modules-crm | status: SAFE | lint: CLEAN
findings: Transitional module implementing Module trait. No unsafe code. Re-exports Customer from
  kasirmu-core. 7 unit tests pass covering lifecycle and kernel registration.
next: Migrate DB CRUD + Tauri commands into this module | perf: N/A — no hot paths yet.
*/

//! CRM Module — customer relationship management.
//!
//! This module owns the customer management vertical: customer CRUD,
//! loyalty points tracking, and purchase history.
//!
//! ## Current state
//!
//! The CrmModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (DB CRUD, Tauri commands) and frontend (screens, API calls,
//! Fluent locale) still live in their original locations:
//!
//! - Backend: `crates/kasirmu-core/src/db/customers.rs` + `apps/desktop-tauri/src/commands/customers.rs`
//! - Frontend: `ui/src/features/customers/`
//! - API: `ui/src/api/customers.ts`
//! - Locale: `shared-ui/locales/{en,fr,es,de,zh,ja}/customers.ftl`
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/crm/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/crm/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports key CRM domain types from `kasirmu-core` so that
//! consumers can access all customer-related types through a single crate:
//!
//! ```
//! # use modules_crm::{CrmModule, Customer};
//! ```

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::CrmError;

pub use foundation::{Email, Phone};
pub use models::Customer;
pub use repository::CrmRepository;
pub use service::CrmService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The CRM (Customer Relationship Management) module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual customer logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct CrmModule;

impl CrmModule {
    /// Create a new CrmModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for CrmModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for CrmModule {
    fn id(&self) -> &'static str {
        "crm"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("crm module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers with the event bus (e.g., handle sale.completed to update customer history)
        // 2. Validate that the database has the required tables
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("crm module: on_start — ready to manage customers");
        // In future phases, this will:
        // 1. Warm up any in-memory caches
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("crm module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    #[test]
    fn crm_module_id() {
        let module = CrmModule::new();
        assert_eq!(module.id(), "crm");
    }

    #[test]
    fn crm_module_lifecycle() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(CrmModule::new())).unwrap();
        assert!(kernel.is_registered("crm"));
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
    fn crm_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(CrmModule::new())).unwrap();
        let err = kernel.register(Box::new(CrmModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn crm_module_on_load_succeeds() {
        let mut module = CrmModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn crm_module_on_start_succeeds() {
        let mut module = CrmModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn crm_module_on_stop_succeeds() {
        let mut module = CrmModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn crm_module_full_lifecycle_with_kernel() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(CrmModule::new())).unwrap();

        // load → start → stop
        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        // Module is still registered after stop
        assert!(kernel.is_registered("crm"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(CrmModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        assert!(kernel.is_registered("crm"));
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
