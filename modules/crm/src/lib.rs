/*
last audited 25-07-26 by RSA-Agent (modules-crm slice A: lib re-verify)
crate: modules-crm | status: SAFE | lint: CLEAN
findings: clean Module registration layer. NOTE 2026-09-30: the `#![deny(unsafe_code)]` below was INERT until that date — a malformed comment merge (a closing delimiter immediately followed by an opening one, on line 6) had swallowed the attribute into a block comment, so this crate compiled with no unsafe lint at all. Restored as a real inner attribute.
next: none | perf: N/A

last audited 19-07-26 by RSA-Agent
crate: modules-crm | status: SAFE | lint: CLEAN
findings: Transitional module implementing Module trait. No unsafe code. Re-exports Customer from
  kasirmu-core. 7 unit tests pass covering lifecycle and kernel registration.
next: Migrate DB CRUD + Tauri commands into this module | perf: N/A — no hot paths yet.
*/
#![deny(unsafe_code)]

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
#[path = "lib_tests.rs"]
mod tests;
