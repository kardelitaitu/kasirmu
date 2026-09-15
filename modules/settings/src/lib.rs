/*
last audited 25-07-26 by RSA-Agent (modules-settings slice A: lib re-verify)
crate: modules-settings | status: SAFE | lint: CLEAN
findings: clean Module registration layer; unwraps test-only; previous 19-07 stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Settings Module — store configuration and feature flag management.
//!
//! This module owns the settings vertical: store name, address, tax ID,
//! receipt formatting, default currency, feature flags, sync configuration,
//! and setup wizard state.
//!
//! ## Current state
//!
//! The SettingsModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (Settings struct, Tauri commands) and frontend (screens, API calls,
//! Fluent locale) still live in their original locations:
//!
//! - Backend: `crates/oz-core/src/settings.rs` + `crates/oz-core/src/db/settings.rs`
//! - Commands: `apps/desktop-client/src/commands/settings.rs`, `setup.rs`, `sync.rs`
//! - Frontend: `ui/src/features/settings/` + `ui/src/features/setup/`
//! - API: `ui/src/api/settings.ts`
//! - Locale: `ui/src/locales/{en,fr,es,de,zh,ja}/settings.ftl`
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/settings/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/settings/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports key settings domain types from `oz-core` so that
//! consumers can access all settings-related types through a single crate:
//!
//! ```
//! # use modules_settings::{SettingsModule, SettingsService, SettingItem};
//! ```

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::SettingsError;

pub use models::SettingItem;
pub use repository::SettingsRepository;
pub use service::SettingsService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Settings module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual settings logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct SettingsModule;

impl SettingsModule {
    /// Create a new SettingsModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for SettingsModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for SettingsModule {
    fn id(&self) -> &'static str {
        "settings"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("settings module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Validate that required settings exist in the DB
        // 2. Register event handlers (e.g., react to setting changes)
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("settings module: on_start — ready to manage configuration");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("settings module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    #[test]
    fn settings_module_id() {
        let module = SettingsModule::new();
        assert_eq!(module.id(), "settings");
    }

    #[test]
    fn settings_module_lifecycle() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(SettingsModule::new())).unwrap();
        assert!(kernel.is_registered("settings"));
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
    fn settings_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(SettingsModule::new())).unwrap();
        let err = kernel.register(Box::new(SettingsModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn settings_module_on_load_succeeds() {
        let mut module = SettingsModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn settings_module_on_start_succeeds() {
        let mut module = SettingsModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn settings_module_on_stop_succeeds() {
        let mut module = SettingsModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn settings_module_full_lifecycle_with_kernel() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(SettingsModule::new())).unwrap();

        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        assert!(kernel.is_registered("settings"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(SettingsModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        assert!(kernel.is_registered("settings"));
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
