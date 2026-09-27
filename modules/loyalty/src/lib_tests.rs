//! Unit tests for `lib`.
//!
//! Moved out of `lib.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `lib.rs` with:
//!   `#[cfg(test)] #[path = "lib_tests.rs"] mod tests;`

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
