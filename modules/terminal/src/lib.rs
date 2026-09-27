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
//! - Commands: `apps/desktop-tauri/src/commands/terminals.rs`
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
#[path = "lib_tests.rs"]
mod tests;
