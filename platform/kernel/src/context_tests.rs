use super::KernelContext;
use crate::capability::{Capability, CapabilityRegistry, ModuleCapabilities};
use foundation::contracts::ModuleContext;

fn cap(s: &str) -> Capability {
    Capability::parse(s).expect("valid capability")
}

fn registry() -> CapabilityRegistry {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("read:sales"))
            .grant(cap("read:sales")),
    );
    reg.register("crm", ModuleCapabilities::none().require(cap("read:sales")));
    reg
}

#[test]
fn context_reports_a_granted_capability() {
    let reg = registry();
    let ctx = KernelContext::new("inventory", &reg);
    assert!(ctx.has("read:sales"));
    assert!(ctx.has_capability("read:sales"));
}

#[test]
fn context_reports_an_ungranted_capability_as_absent() {
    let reg = registry();
    let ctx = KernelContext::new("crm", &reg);
    assert!(!ctx.has("read:sales"));
    assert!(!ctx.has_capability("read:sales"));
}

#[test]
fn context_is_scoped_to_its_module() {
    // crm requires read:sales but was NOT granted it; inventory was granted it.
    let reg = registry();
    let inv = KernelContext::new("inventory", &reg);
    let crm = KernelContext::new("crm", &reg);
    assert!(inv.has("read:sales"));
    assert!(!crm.has("read:sales"));
}

#[test]
fn context_on_an_unregistered_module_has_nothing() {
    let reg = registry();
    let ctx = KernelContext::new("ghost", &reg);
    assert!(!ctx.has("read:sales"));
    assert!(ctx.granted().is_empty());
}

#[test]
fn context_rejects_a_malformed_capability_string() {
    let reg = registry();
    let ctx = KernelContext::new("inventory", &reg);
    assert!(!ctx.has("not-a-capability"));
}

#[test]
fn granted_capabilities_are_sorted_and_deduplicated() {
    let mut reg = CapabilityRegistry::new();
    reg.register(
        "inventory",
        ModuleCapabilities::none()
            .grant(cap("write:sales"))
            .grant(cap("read:sales")),
    );
    let ctx = KernelContext::new("inventory", &reg);
    assert_eq!(ctx.granted(), vec!["read:sales", "write:sales"]);
    assert_eq!(ctx.granted_capabilities(), ctx.granted());
}

#[test]
fn context_exposes_the_module_id() {
    let reg = registry();
    let ctx = KernelContext::new("inventory", &reg);
    assert_eq!(ctx.module(), "inventory");
}

#[test]
fn a_granted_capability_is_a_typed_bool_not_a_generic_bag() {
    // The registry hands back a typed decision for a named capability; there is
    // deliberately no `get("anything") -> Any` escape hatch on the context.
    let reg = registry();
    let ctx = KernelContext::new("inventory", &reg);
    assert!(ctx.has("read:sales"));
    assert!(!ctx.has("read:inventory"));
}
