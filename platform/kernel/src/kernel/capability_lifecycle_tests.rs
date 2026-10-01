//! Kernel-level acceptance tests for the Phase 2 capability registry: boot
//! fails fast when a module requires an ungranted capability, and a granted
//! capability reaches the module through its context.

use crate::Kernel;
use crate::capability::{Capability, ModuleCapabilities};
use crate::error::KernelError;
use foundation::contracts::{Module, ModuleContext, ModuleResult};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

fn cap(s: &str) -> Capability {
    Capability::parse(s).expect("valid capability")
}

/// A module that records the capabilities it observed in `on_context`.
#[derive(Debug)]
struct ProbingModule {
    id: &'static str,
    on_load_calls: Arc<AtomicUsize>,
    observed: Arc<std::sync::Mutex<Vec<String>>>,
}

impl ProbingModule {
    fn new(id: &'static str) -> Self {
        Self {
            id,
            on_load_calls: Arc::new(AtomicUsize::new(0)),
            observed: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }
}

impl Module for ProbingModule {
    fn id(&self) -> &'static str {
        self.id
    }

    fn on_load(&mut self) -> ModuleResult {
        self.on_load_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn on_context(&mut self, ctx: &dyn ModuleContext) {
        *self.observed.lock().unwrap() = ctx.granted_capabilities();
        assert!(ctx.has_capability("read:inventory") == ctx.has_capability("read:inventory"));
    }
}

#[test]
fn load_fails_when_a_required_capability_is_ungranted() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(ProbingModule::new("inventory")))
        .unwrap();
    // Required but NOT granted.
    kernel.declare_capabilities(
        "inventory",
        ModuleCapabilities::none().require(cap("read:sales")),
    );
    let err = kernel.load_all().expect_err("load must fail");
    match err {
        KernelError::MissingCapability { module, missing } => {
            assert_eq!(module, "inventory");
            assert_eq!(missing, "read:sales");
        }
        other => panic!("expected MissingCapability, got {other:?}"),
    }
}

#[test]
fn load_succeeds_when_every_requirement_is_granted() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(ProbingModule::new("inventory")))
        .unwrap();
    kernel.declare_capabilities(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("read:inventory"))
            .grant(cap("read:inventory")),
    );
    kernel.load_all().expect("load must succeed");
}

#[test]
fn load_with_no_declared_capability_is_unaffected() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(ProbingModule::new("plain")))
        .unwrap();
    kernel
        .load_all()
        .expect("a module declaring nothing must load");
}

#[test]
fn a_failed_capability_check_prevents_any_on_load() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(ProbingModule {
            id: "inventory",
            on_load_calls: Arc::clone(&calls),
            observed: Arc::new(std::sync::Mutex::new(Vec::new())),
        }))
        .unwrap();
    kernel.declare_capabilities(
        "inventory",
        ModuleCapabilities::none().require(cap("read:sales")),
    );
    assert!(kernel.load_all().is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 0, "on_load must not run");
}

#[test]
fn on_context_delivers_the_granted_capabilities() {
    let observed = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(ProbingModule {
            id: "inventory",
            on_load_calls: Arc::new(AtomicUsize::new(0)),
            observed: Arc::clone(&observed),
        }))
        .unwrap();
    kernel.declare_capabilities(
        "inventory",
        ModuleCapabilities::none()
            .require(cap("read:inventory"))
            .grant(cap("read:inventory")),
    );
    kernel.load_all().unwrap();
    assert_eq!(
        *observed.lock().unwrap(),
        vec!["read:inventory".to_string()]
    );
}

#[test]
fn declare_from_manifest_requires_and_grants_each_entry() {
    let mut kernel = Kernel::new();
    kernel
        .declare_from_manifest("crm", &["read:sales".to_string()])
        .unwrap();
    assert!(kernel.verify_capabilities().is_ok());
    assert!(kernel.capabilities().is_granted("crm", &cap("read:sales")));
}

#[test]
fn declare_from_manifest_rejects_a_malformed_capability() {
    let mut kernel = Kernel::new();
    let err = kernel
        .declare_from_manifest("crm", &["nonsense".to_string()])
        .expect_err("must reject");
    assert!(matches!(err, KernelError::InvalidCapability { .. }));
}

#[test]
fn context_for_is_scoped_to_the_named_module() {
    let mut kernel = Kernel::new();
    kernel.declare_capabilities(
        "inventory",
        ModuleCapabilities::none().grant(cap("read:sales")),
    );
    assert!(kernel.context_for("inventory").has("read:sales"));
    assert!(!kernel.context_for("crm").has("read:sales"));
}

// ── Phase 4 P4.1: namespace grants must name a declared dependency ──────

/// A module that declares foreign namespaces its stores intend to read.
#[derive(Debug)]
struct GrantingModule {
    id: &'static str,
    deps: &'static [&'static str],
    grants: &'static [&'static str],
}

impl Module for GrantingModule {
    fn id(&self) -> &'static str {
        self.id
    }

    fn dependencies(&self) -> &'static [foundation::contracts::ModuleId] {
        self.deps
    }

    fn namespace_grants(&self) -> &'static [foundation::contracts::ModuleId] {
        self.grants
    }
}

/// A no-op module used to satisfy a dependency edge in a boot test.
#[derive(Debug)]
struct LeafModule {
    id: &'static str,
}

impl Module for LeafModule {
    fn id(&self) -> &'static str {
        self.id
    }
}

#[test]
fn load_fails_when_a_namespace_grant_is_not_a_declared_dependency() {
    let mut kernel = Kernel::new();
    // Register the declared dependency so dependency resolution passes and the
    // grant check is what decides the outcome.
    kernel
        .register(Box::new(LeafModule { id: "sales" }))
        .unwrap();
    kernel
        .register(Box::new(GrantingModule {
            id: "reporting",
            deps: &["sales"],
            // `loyalty` is NOT a declared dependency, so the grant is illegal.
            grants: &["sales", "loyalty"],
        }))
        .unwrap();
    let err = kernel.load_all().expect_err("load must fail");
    match err {
        KernelError::UndeclaredNamespaceGrant { module, granted } => {
            assert_eq!(module, "reporting");
            assert_eq!(granted, "loyalty");
        }
        other => panic!("expected UndeclaredNamespaceGrant, got {other:?}"),
    }
}

#[test]
fn load_succeeds_when_every_namespace_grant_is_a_declared_dependency() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(LeafModule { id: "sales" }))
        .unwrap();
    kernel
        .register(Box::new(LeafModule { id: "inventory" }))
        .unwrap();
    kernel
        .register(Box::new(GrantingModule {
            id: "reporting",
            deps: &["sales", "inventory"],
            grants: &["sales", "inventory"],
        }))
        .unwrap();
    kernel.load_all().expect("declared grants must load");
}

#[test]
fn a_module_with_no_namespace_grants_is_unaffected() {
    let mut kernel = Kernel::new();
    kernel
        .register(Box::new(GrantingModule {
            id: "settings",
            deps: &[],
            grants: &[],
        }))
        .unwrap();
    kernel.load_all().expect("no grants is the default");
}

#[test]
fn the_grant_check_names_the_first_offender_in_id_order() {
    let mut kernel = Kernel::new();
    // `a-module` < `b-module` in byte order; both offend. The error must name
    // `a-module` (deterministic), not whichever was registered first.
    kernel
        .register(Box::new(GrantingModule {
            id: "b-module",
            deps: &[],
            grants: &["crm"],
        }))
        .unwrap();
    kernel
        .register(Box::new(GrantingModule {
            id: "a-module",
            deps: &[],
            grants: &["loyalty"],
        }))
        .unwrap();
    let err = kernel.load_all().expect_err("both offend");
    match err {
        KernelError::UndeclaredNamespaceGrant { module, .. } => assert_eq!(module, "a-module"),
        other => panic!("expected UndeclaredNamespaceGrant, got {other:?}"),
    }
}
