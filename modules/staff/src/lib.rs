/*
last audited 31-08-26 by RSA-Agent (user-role campaign, Section E)
crate: modules-staff | status: SAFE | lint: CLEAN
findings: clean transitional Module registration layer — kernel-wired (platform/startup/src/lib.rs:87), types re-exported through oz-core/src/user.rs; business logic intentionally remains in oz-core db/staff.rs + session-scoped IPC (documented boundary); inline unit tests in this file predate the sibling *_tests.rs convention (low-priority convention note)
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
//! - Backend: `crates/oz-core/src/user.rs` + `crates/oz-core/src/db/staff.rs`
//! - Commands: `apps/desktop-client/src/commands/staff.rs` + `apps/desktop-client/src/commands/auth.rs`
//! - Frontend: `ui/src/features/staff/` + `ui/src/features/auth/`
//! - API: `ui/src/api/staff.ts`
//! - Locale: `ui/src/locales/*/staff.ftl`
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
//! This module re-exports key staff domain types from `oz-core` so that
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
mod tests {
    use super::*;
    use platform_kernel::Kernel;

    #[test]
    fn staff_module_id() {
        let module = StaffModule::new();
        assert_eq!(module.id(), "staff");
    }

    #[test]
    fn staff_module_lifecycle() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(StaffModule::new())).unwrap();
        assert!(kernel.is_registered("staff"));
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
    fn staff_module_duplicate_registration_fails() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(StaffModule::new())).unwrap();
        let err = kernel.register(Box::new(StaffModule::new()));
        assert!(err.is_err());
    }

    #[test]
    fn staff_module_on_load_succeeds() {
        let mut module = StaffModule::new();
        assert!(module.on_load().is_ok());
    }

    #[test]
    fn staff_module_on_start_succeeds() {
        let mut module = StaffModule::new();
        assert!(module.on_start().is_ok());
    }

    #[test]
    fn staff_module_on_stop_succeeds() {
        let mut module = StaffModule::new();
        assert!(module.on_stop().is_ok());
    }

    #[test]
    fn staff_module_full_lifecycle_with_kernel() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(StaffModule::new())).unwrap();

        // load → start → stop
        kernel.load_all().unwrap();
        kernel.start_all().unwrap();
        kernel.stop_all().unwrap();

        // Module is still registered after stop
        assert!(kernel.is_registered("staff"));
    }

    #[test]
    fn multiple_modules_can_coexist() {
        let mut kernel = Kernel::new();
        kernel.register(Box::new(StaffModule::new())).unwrap();
        kernel.register(Box::new(OtherModule)).unwrap();

        assert!(kernel.is_registered("staff"));
        assert!(kernel.is_registered("other"));
        assert_eq!(kernel.module_count(), 2);
    }

    #[test]
    fn re_exports_are_accessible() {
        // Verify that re-exported types compile and are accessible.
        let role = Role::new("role-staff", "Staff");
        assert_eq!(role.name, "Staff");

        let _ = builtin_roles::OWNER;
        let _ = seed_users::ADMIN;
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
