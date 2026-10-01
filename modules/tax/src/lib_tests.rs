//! Unit tests for `lib`.
//!
//! Moved out of `lib.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `lib.rs` with:
//!   `#[cfg(test)] #[path = "lib_tests.rs"] mod tests;`

use super::*;

use platform_kernel::Kernel;

#[test]
fn tax_module_id() {
    let module = TaxModule::new();
    assert_eq!(module.id(), "tax");
}

#[test]
fn tax_module_lifecycle() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(TaxModule::new())).unwrap();
    assert!(kernel.is_registered("tax"));
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
fn tax_module_duplicate_registration_fails() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(TaxModule::new())).unwrap();
    let err = kernel.register(Box::new(TaxModule::new()));
    assert!(err.is_err());
}

#[test]
fn tax_module_on_load_succeeds() {
    let mut module = TaxModule::new();
    assert!(module.on_load().is_ok());
}

#[test]
fn tax_module_on_start_succeeds() {
    let mut module = TaxModule::new();
    assert!(module.on_start().is_ok());
}

#[test]
fn tax_module_on_stop_succeeds() {
    let mut module = TaxModule::new();
    assert!(module.on_stop().is_ok());
}

#[test]
fn tax_module_full_lifecycle_with_kernel() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(TaxModule::new())).unwrap();

    kernel.load_all().unwrap();
    kernel.start_all().unwrap();
    kernel.stop_all().unwrap();

    assert!(kernel.is_registered("tax"));
}

#[test]
fn multiple_modules_can_coexist() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(TaxModule::new())).unwrap();
    kernel.register(Box::new(OtherModule)).unwrap();

    assert!(kernel.is_registered("tax"));
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
