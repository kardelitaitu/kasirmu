use super::{Capability, CapabilityRegistry, ModuleCapabilities};
use crate::error::KernelError;

fn cap(s: &str) -> Capability {
    Capability::parse(s).expect("valid capability")
}

#[test]
fn parse_accepts_namespace_and_action() {
    let c = cap("read:inventory");
    assert_eq!(c.as_str(), "read:inventory");
    assert_eq!(c.namespace(), "read");
}

#[test]
fn parse_keeps_everything_after_the_first_colon_as_action() {
    let c = cap("subscribe:sale_completed");
    assert_eq!(c.namespace(), "subscribe");
    assert_eq!(c.as_str(), "subscribe:sale_completed");
}

#[test]
fn parse_rejects_a_missing_colon() {
    match Capability::parse("inventory") {
        Err(KernelError::InvalidCapability { message, .. }) => {
            assert!(message.contains("expected <namespace>:<action>"));
        }
        other => panic!("expected InvalidCapability, got {other:?}"),
    }
}

#[test]
fn parse_rejects_an_empty_namespace_or_action() {
    assert!(matches!(
        Capability::parse(":read"),
        Err(KernelError::InvalidCapability { .. })
    ));
    assert!(matches!(
        Capability::parse("read:"),
        Err(KernelError::InvalidCapability { .. })
    ));
}

#[test]
fn module_capabilities_default_is_none() {
    let none = ModuleCapabilities::none();
    assert!(none.required().is_empty());
    assert!(none.granted().is_empty());
    assert!(none.is_satisfied());
}

#[test]
fn a_requirement_without_a_grant_is_missing() {
    let m = ModuleCapabilities::none().require(cap("read:inventory"));
    assert_eq!(m.missing().len(), 1);
    assert!(!m.is_satisfied());
}

#[test]
fn a_granted_requirement_is_satisfied() {
    let m = ModuleCapabilities::none()
        .require(cap("read:inventory"))
        .grant(cap("read:inventory"));
    assert!(m.missing().is_empty());
    assert!(m.is_satisfied());
}

#[test]
fn an_extra_grant_beyond_the_requirement_is_harmless() {
    let m = ModuleCapabilities::none().grant(cap("write:sales"));
    assert!(m.is_satisfied());
}

#[test]
fn registry_reports_a_grant() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("read:sales"))
            .grant(cap("read:sales")),
    );
    assert!(reg.is_granted("inventory", &cap("read:sales")));
    assert!(!reg.is_granted("inventory", &cap("write:sales")));
    assert!(!reg.is_granted("missing", &cap("read:sales")));
}

#[test]
fn registry_get_returns_the_declaration() {
    let mut reg = CapabilityRegistry::new();
    reg.register("crm", ModuleCapabilities::none().require(cap("read:sales")));
    let got = reg.get("crm").expect("registered");
    assert_eq!(got.required().len(), 1);
    assert!(reg.get("nope").is_none());
}

#[test]
fn verify_all_passes_when_every_requirement_is_granted() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("read:sales"))
            .grant(cap("read:sales")),
    );
    assert!(reg.verify_all().is_ok());
    assert!(reg.unsatisfied().is_empty());
}

#[test]
fn verify_all_fails_naming_the_missing_capability() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none().require(cap("read:sales")),
    );
    let err = reg.verify_all().expect_err("must fail");
    match err {
        KernelError::MissingCapability { module, missing } => {
            assert_eq!(module, "inventory");
            assert_eq!(missing, "read:sales");
        }
        other => panic!("expected MissingCapability, got {other:?}"),
    }
}

#[test]
fn verify_all_is_deterministic_and_names_object_action_in_order() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "zeta",
        ModuleCapabilities::none().require(cap("read:sales")),
    );
    reg.register(
        "alpha",
        ModuleCapabilities::none().require(cap("read:inventory")),
    );
    let err = reg.verify_all().expect_err("must fail");
    match err {
        KernelError::MissingCapability { module, .. } => assert_eq!(module, "alpha"),
        other => panic!("expected MissingCapability, got {other:?}"),
    }
}

#[test]
fn verify_all_lists_multiple_missing_in_sorted_order() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("write:sales"))
            .require(cap("read:sales")),
    );
    let err = reg.verify_all().expect_err("must fail");
    match err {
        KernelError::MissingCapability { missing, .. } => {
            assert_eq!(missing, "read:sales, write:sales");
        }
        other => panic!("expected MissingCapability, got {other:?}"),
    }
}

#[test]
fn unsatisfied_lists_only_ungranted_modules() {
    let mut reg = CapabilityRegistry::new();
    reg.register("a", ModuleCapabilities::none().require(cap("read:x")));
    reg.register(
        "b",
        ModuleCapabilities::none()
            .require(cap("read:y"))
            .grant(cap("read:y")),
    );
    let bad = reg.unsatisfied();
    assert_eq!(bad.len(), 1);
    assert_eq!(bad[0].0, "a");
}

#[test]
fn display_of_capability_is_its_raw_string() {
    assert_eq!(
        cap("use:reporting_facade").to_string(),
        "use:reporting_facade"
    );
}
