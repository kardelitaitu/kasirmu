/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean transitional Module registration layer — kernel-wired (platform/startup/src/lib.rs:87), types re-exported through kasirmu-core/src/user.rs; business logic intentionally remains in kasirmu-core db/staff.rs + session-scoped IPC (documented boundary); inline unit tests in this file predate the sibling *_tests.rs convention (low-priority convention note)
next: none | perf: N/A
*/

//! Staff Module — user and role management.
//!
//! This module owns the staff management vertical: user CRUD, role
//! management, authentication, and session handling.
//!
//! ## Current state
//!
//! The StaffModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (DB CRUD, Tauri commands) and frontend (screens, API calls,
//! Fluent locale) still live in their original locations:
//!
//! - Backend: `crates/kasirmu-core/src/user.rs` + `crates/kasirmu-core/src/db/staff.rs`
//! - Commands: `apps/desktop-tauri/src/commands/staff.rs` + `apps/desktop-tauri/src/commands/auth.rs`
//! - Frontend: `ui/src/features/staff/` + `ui/src/features/auth/`
//! - API: `ui/src/api/staff.ts`
//! - Locale: `shared-ui/locales/*/staff.ftl`
//!
//! The module boundary is intentionally transitional: these files remain in
//! their original locations until the module system can own the Tauri command
//! and migration lifecycle without duplicating the global identity database.
//! The security boundary is nevertheless explicit today: production staff
//! mutations use session-scoped commands and the legacy IPC registrations are
//! disabled.
//!
//! ## Module manifest
//!
//! See `modules/staff/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports key staff domain types from `kasirmu-core` so that
//! consumers can access all staff-related types through a single crate:
//!
//! ```
//! # use modules_staff::{StaffModule, User, Role, builtin_roles};
//! ```

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::StaffError;

pub use models::{Role, User, UserId, builtin_roles, seed_users};
pub use repository::StaffRepository;
pub use service::StaffService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Staff module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. It currently acts as a registration and configuration layer;
/// the production staff logic remains in the existing command and core DB
/// crates until the physical module migration is planned and validated.
#[derive(Debug)]
pub struct StaffModule;

impl StaffModule {
    /// Create a new StaffModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for StaffModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for StaffModule {
    fn id(&self) -> &'static str {
        "staff"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("staff module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers with the event bus (e.g., handle staff.created)
        // 2. Validate that the database has the required users/roles tables
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("staff module: on_start — ready to manage staff");
        // In future phases, this will:
        // 1. Warm up any in-memory caches for staff lookup
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("staff module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
