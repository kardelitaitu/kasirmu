/*
last audited 25-07-26 by RSA-Agent (modules-terminal slice A: lib re-verify)
crate: modules-terminal | status: SAFE | lint: CLEAN
findings: clean Module registration layer; unwraps test-only; previous 19-07 stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Terminal Module — registered POS device management.
//!
//! This module owns the terminal management vertical: device
//! registration, heartbeat/ping tracking, and terminal configuration.
//!
//! ## Current state
//!
//! The TerminalModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! and frontend still live in their original locations:
//!
//! - Backend: `crates/kasirmu-core/src/terminal.rs` + `crates/kasirmu-core/src/db/terminals.rs`
//! - Commands: `apps/desktop-client/src/commands/terminals.rs`
//! - Frontend: `ui/src/features/terminals/`
//! - API: `ui/src/api/terminals.ts`
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/terminal/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/terminal/manifest.json` for the module metadata.

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::TerminalError;

pub use models::{Terminal, TerminalId};
pub use repository::TerminalRepository;
pub use service::TerminalService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Terminal module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual terminal logic lives in the existing codebase.
#[derive(Debug)]
pub struct TerminalModule;

impl TerminalModule {
    /// Create a new TerminalModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for TerminalModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for TerminalModule {
    fn id(&self) -> &'static str {
        "terminal"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("terminal module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Validate terminal configuration
        // 2. Register event handlers (e.g., track terminal activity)
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("terminal module: on_start — ready for terminal operations");
        // In future phases, this will:
        // 1. Initialize terminal heartbeat monitoring
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("terminal module: on_stop — cleaning up");
        // In future phases, this will:
        // 1. Flush pending terminal state
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    #[test]
    fn terminal_module_id() {
        let module = TerminalModule::new();
        assert_eq!(module.id(), "terminal");
    }

    #[test]
    fn terminal_module_lifecycle() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(TerminalModule::new())).unwrap();
        assert!(kernel.is_registered("terminal"));
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
    fn terminal_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(TerminalModule::new())).unwrap();
        let err = kernel.register(Box::new(TerminalModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn terminal_module_on_load_succeeds() {
        let mut module = TerminalModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn terminal_module_on_start_succeeds() {
        let mut module = TerminalModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn terminal_module_on_stop_succeeds() {
        let mut module = TerminalModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn terminal_module_full_lifecycle_with_kernel() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(TerminalModule::new())).unwrap();

        // load → start → stop
        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        // Module is still registered after stop
        assert!(kernel.is_registered("terminal"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(TerminalModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        // Verify both are registered
        assert!(kernel.is_registered("terminal"));
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
