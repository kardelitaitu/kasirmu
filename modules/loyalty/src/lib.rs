/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: lib re-verify)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: clean Module registration layer; unwraps test-only; prior 2026-07-22 Buffy stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Loyalty Module — customer loyalty program and point management.
//!
//! This module owns the loyalty vertical: tier definitions, customer
//! loyalty accounts, point earn/redeem transactions, and tier-based
//! earning multipliers.
//!
//! ## Current state
//!
//! The LoyaltyModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (domain types, database access, Tauri commands) and frontend
//! (screens, API calls, Fluent locale) still live in their
//! original locations:
//!
//! - Domain: `crates/kasirmu-core/src/loyalty.rs`
//! - DB: `crates/kasirmu-core/src/db/loyalty.rs`
//! - Commands: `apps/desktop-client/src/commands/` (TBD)
//! - Frontend: `ui/src/features/loyalty/` (LoyaltyManagementScreen)
//! - API: `ui/src/api/` (TBD)
//! - Locale: `ui/src/locales/` (TBD)
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/loyalty/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/loyalty/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports loyalty domain types from `kasirmu-core` so that
//! consumers can access all loyalty-related types through a single crate:
//!
//! ```
//! # use modules_loyalty::{LoyaltyModule, LoyaltyTier, LoyaltyAccount, LoyaltyTransaction, LoyaltyAccountWithDetails};
//! ```

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::LoyaltyError;

pub use models::{
    GiftCard, GiftCardFilter, GiftCardTransaction, GiftCardWithTransactions, IssueGiftCardInput,
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
    RedeemGiftCardResult,
};
pub use repository::LoyaltyRepository;
pub use service::LoyaltyService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Loyalty module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual loyalty logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct LoyaltyModule;

impl LoyaltyModule {
    /// Create a new LoyaltyModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for LoyaltyModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for LoyaltyModule {
    fn id(&self) -> &'static str {
        "loyalty"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        // Mirrors `dependencies` in modules/loyalty/manifest.json: a loyalty
        // account belongs to a CRM customer.
        &["crm"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("loyalty module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers (e.g., sale.completed → earn_points)
        // 2. Validate that loyalty tiers seed data exists
        // 3. Check that the CRM module is available
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("loyalty module: on_start — ready to process loyalty operations");
        // In future phases, this will:
        // 1. Start background point-expiry checker
        // 2. Cache tier definitions for fast lookup
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("loyalty module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    /// Minimal stand-in for a module `loyalty` depends on.
    ///
    /// `LoyaltyModule::dependencies()` declares `crm`, so any test that
    /// drives `load_all`/`start_all` must register that id or dependency
    /// resolution fails with `MissingDependency`.
    #[derive(Debug)]
    struct StubModule(&'static str);

    impl Module for StubModule {
        fn id(&self) -> &'static str {
            self.0
        }
    }

    fn kernel_with_deps() -> Kernel {
        let mut kernel = Kernel::new();
        kernel
            .register(Box::new(StubModule("crm")))
            .expect("register crm stub");
        kernel
    }

    #[test]
    fn loyalty_module_id() {
        let module = LoyaltyModule::new();
        assert_eq!(module.id(), "loyalty");
    }

    #[test]
    fn loyalty_module_declares_crm_dependency() {
        assert_eq!(LoyaltyModule::new().dependencies(), &["crm"]);
    }

    #[test]
    fn loyalty_module_manifest_matches_declaration() {
        let parsed: serde_json::Value = serde_json::from_str(include_str!("../manifest.json"))
            .expect("manifest.json must be valid JSON");
        let declared: Vec<&str> = parsed["dependencies"]
            .as_array()
            .expect("dependencies must be an array")
            .iter()
            .map(|v| v.as_str().expect("dependency must be a string"))
            .collect();
        assert_eq!(declared, LoyaltyModule::new().dependencies().to_vec());
    }

    #[test]
    fn loyalty_module_load_fails_without_crm() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(LoyaltyModule::new())).unwrap();
        assert!(kernel.load_all().is_err());
    }

    #[test]
    fn loyalty_module_lifecycle() {
        let mut kernel = kernel_with_deps();
        kernel.register(Box::new(LoyaltyModule::new())).unwrap();
        assert!(kernel.is_registered("loyalty"));
        assert_eq!(kernel.module_count(), 2);

        kernel.load_all().unwrap();
        assert!(kernel.is_loaded());

        kernel.start_all().unwrap();
        assert!(kernel.is_started());

        kernel.stop_all().unwrap();
        assert!(!kernel.is_loaded());
        assert!(!kernel.is_started());
    }

    #[test]
    fn loyalty_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(LoyaltyModule::new())).unwrap();
        let err = kernel.register(Box::new(LoyaltyModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn loyalty_module_on_load_succeeds() {
        let mut module = LoyaltyModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn loyalty_module_on_start_succeeds() {
        let mut module = LoyaltyModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn loyalty_module_on_stop_succeeds() {
        let mut module = LoyaltyModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn loyalty_module_full_lifecycle_with_kernel() {
        let mut kernel = kernel_with_deps();
        kernel.register(Box::new(LoyaltyModule::new())).unwrap();

        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        assert!(kernel.is_registered("loyalty"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(LoyaltyModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        assert!(kernel.is_registered("loyalty"));
        assert!(kernel.is_registered("other"));
        assert_eq!(kernel.module_count(), 2);
    }

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
