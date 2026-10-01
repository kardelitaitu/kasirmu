//! Unit tests for `lib`.
//!
//! Moved out of `lib.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `lib.rs` with:
//!   `#[cfg(test)] #[path = "lib_tests.rs"] mod tests;`

use super::*;

use platform_kernel::Kernel;

/// Minimal stand-in for a module `reporting` depends on.
///
/// `ReportingModule::dependencies()` declares `inventory` and `sales`,
/// so any test that drives `load_all`/`start_all` must register both ids
/// or dependency resolution fails with `MissingDependency`.
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
        .register(Box::new(StubModule("inventory")))
        .expect("register inventory stub");
    kernel
        .register(Box::new(StubModule("sales")))
        .expect("register sales stub");
    kernel
}

#[test]
fn reporting_module_id() {
    let module = ReportingModule::new();
    assert_eq!(module.id(), "reporting");
}

#[test]
fn reporting_module_declares_its_dependencies() {
    assert_eq!(
        ReportingModule::new().dependencies(),
        &["inventory", "sales"][..]
    );
}

#[test]
fn reporting_module_manifest_matches_declaration() {
    let parsed: serde_json::Value = serde_json::from_str(include_str!("../manifest.json"))
        .expect("manifest.json must be valid JSON");
    let declared: Vec<&str> = parsed["dependencies"]
        .as_array()
        .expect("dependencies must be an array")
        .iter()
        .map(|v| v.as_str().expect("dependency must be a string"))
        .collect();
    assert_eq!(declared, ReportingModule::new().dependencies().to_vec());
}

#[test]
fn reporting_module_load_fails_without_dependencies() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(ReportingModule::new())).unwrap();
    assert!(kernel.load_all().is_err());
}

#[test]
fn reporting_module_lifecycle() {
    let mut kernel = kernel_with_deps();
    kernel.register(Box::new(ReportingModule::new())).unwrap();
    assert!(kernel.is_registered("reporting"));
    assert_eq!(kernel.module_count(), 3);

    kernel.load_all().unwrap();
    assert!(kernel.is_loaded());

    kernel.start_all().unwrap();
    assert!(kernel.is_started());

    kernel.stop_all().unwrap();
    assert!(!kernel.is_loaded());
    assert!(!kernel.is_started());
}

#[test]
fn reporting_module_duplicate_registration_fails() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(ReportingModule::new())).unwrap();
    let err = kernel.register(Box::new(ReportingModule::new()));
    assert!(err.is_err());
}

#[test]
fn reporting_module_on_load_succeeds() {
    let mut module = ReportingModule::new();
    assert!(module.on_load().is_ok());
}

#[test]
fn reporting_module_on_start_succeeds() {
    let mut module = ReportingModule::new();
    assert!(module.on_start().is_ok());
}

#[test]
fn reporting_module_on_stop_succeeds() {
    let mut module = ReportingModule::new();
    assert!(module.on_stop().is_ok());
}

#[test]
fn reporting_module_full_lifecycle_with_kernel() {
    let mut kernel = kernel_with_deps();
    kernel.register(Box::new(ReportingModule::new())).unwrap();

    // load → start → stop
    kernel.load_all().unwrap();
    kernel.start_all().unwrap();
    kernel.stop_all().unwrap();

    // Module is still registered after stop
    assert!(kernel.is_registered("reporting"));
}

#[test]
fn multiple_modules_can_coexist() {
    let mut kernel = Kernel::new();
    kernel.register(Box::new(ReportingModule::new())).unwrap();
    kernel.register(Box::new(OtherModule)).unwrap();

    // Verify both are registered
    assert!(kernel.is_registered("reporting"));
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
