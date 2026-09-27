//! Unit tests for `lib`.
//!
//! Moved out of `lib.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `lib.rs` with:
//!   `#[cfg(test)] #[path = "lib_tests.rs"] mod tests;`

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
