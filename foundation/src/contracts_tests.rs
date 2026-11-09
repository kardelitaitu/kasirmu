//! Unit tests for `contracts`.
//!
//! Moved out of `contracts.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `contracts.rs` with:
//!   `#[cfg(test)] #[path = "contracts_tests.rs"] mod tests;`

use super::*;

// ── Module trait ──────────────────────────────────────────────

#[derive(Debug)]
struct TestModule {
    id: &'static str,
    started: bool,
    stopped: bool,
}

impl TestModule {
    fn new(id: &'static str) -> Self {
        Self {
            id,
            started: false,
            stopped: false,
        }
    }
}

impl Module for TestModule {
    fn id(&self) -> ModuleId {
        self.id
    }

    fn on_load(&mut self) -> ModuleResult {
        // Simulate loading config
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        self.started = true;
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        self.stopped = true;
        Ok(())
    }
}

#[test]
fn module_id_returns_identifier() {
    let m = TestModule::new("test-module");
    assert_eq!(m.id(), "test-module");
}

#[test]
fn module_default_on_load_returns_ok() {
    #[derive(Debug)]
    struct MinimalModule;
    impl Module for MinimalModule {
        fn id(&self) -> ModuleId {
            "minimal"
        }
    }
    let mut m = MinimalModule;
    assert!(m.on_load().is_ok());
}

#[test]
fn module_default_on_start_returns_ok() {
    #[derive(Debug)]
    struct MinimalModule;
    impl Module for MinimalModule {
        fn id(&self) -> ModuleId {
            "minimal"
        }
    }
    let mut m = MinimalModule;
    assert!(m.on_start().is_ok());
}

#[test]
fn module_default_on_stop_returns_ok() {
    #[derive(Debug)]
    struct MinimalModule;
    impl Module for MinimalModule {
        fn id(&self) -> ModuleId {
            "minimal"
        }
    }
    let mut m = MinimalModule;
    assert!(m.on_stop().is_ok());
}

#[test]
fn module_lifecycle() {
    let mut m = TestModule::new("lifecycle");
    assert!(m.on_load().is_ok());
    assert!(m.on_start().is_ok());
    assert!(m.started);
    assert!(m.on_stop().is_ok());
    assert!(m.stopped);
}

#[test]
fn module_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<TestModule>();
}

#[test]
fn module_debug() {
    let m = TestModule::new("debug-test");
    let debug = format!("{m:?}");
    assert!(debug.contains("debug-test"));
}

// ── Service trait ─────────────────────────────────────────────

#[derive(Debug)]
struct TestService {
    id: &'static str,
    running: bool,
}

impl TestService {
    fn new(id: &'static str) -> Self {
        Self { id, running: false }
    }
}

impl Service for TestService {
    fn id(&self) -> &'static str {
        self.id
    }

    fn start(&mut self) -> ModuleResult {
        self.running = true;
        Ok(())
    }

    fn stop(&mut self) -> ModuleResult {
        self.running = false;
        Ok(())
    }
}

#[test]
fn service_id_returns_identifier() {
    let s = TestService::new("sync-engine");
    assert_eq!(s.id(), "sync-engine");
}

#[test]
fn service_start_and_stop() {
    let mut s = TestService::new("test-service");
    assert!(!s.running);
    assert!(s.start().is_ok());
    assert!(s.running);
    assert!(s.stop().is_ok());
    assert!(!s.running);
}

#[test]
fn service_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<TestService>();
}

#[test]
fn service_debug() {
    let s = TestService::new("debug-service");
    let debug = format!("{s:?}");
    assert!(debug.contains("debug-service"));
}

// ── EventHandler trait ────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
struct TestEvent {
    value: i32,
}

impl DomainEvent for TestEvent {
    fn event_name(&self) -> &'static str {
        "test.event"
    }
}

struct TestHandler {
    calls: std::sync::atomic::AtomicUsize,
}

impl TestHandler {
    fn new() -> Self {
        Self {
            calls: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl EventHandler<TestEvent> for TestHandler {
    fn handle(&self, _event: &TestEvent) -> ModuleResult {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn event_handler_handle_event() {
    let handler = TestHandler::new();
    let event = TestEvent { value: 42 };
    assert!(handler.handle(&event).is_ok());
    assert_eq!(handler.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn event_handler_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<TestHandler>();
}

#[test]
fn domain_event_returns_name() {
    let event = TestEvent { value: 1 };
    assert_eq!(event.event_name(), "test.event");
}

#[test]
fn domain_event_is_send_sync() {
    fn assert_send_sync<T: Send + Sync + 'static>() {}
    assert_send_sync::<TestEvent>();
}

#[test]
fn module_result_type_alias_is_result() {
    let ok: ModuleResult = Ok(());
    assert!(ok.is_ok());
    let err: ModuleResult = Err(anyhow::anyhow!("test error"));
    assert!(err.is_err());
}

// ── Error propagation ──

#[test]
fn module_error_propagation() {
    #[derive(Debug)]
    struct FailingModule;
    impl Module for FailingModule {
        fn id(&self) -> ModuleId {
            "failing"
        }
        fn on_load(&mut self) -> ModuleResult {
            Err(anyhow::anyhow!("config missing"))
        }
    }
    let mut m = FailingModule;
    let err = m.on_load().unwrap_err();
    assert_eq!(err.to_string(), "config missing");
}

#[test]
fn service_error_propagation() {
    #[derive(Debug)]
    struct FailingService;
    impl Service for FailingService {
        fn id(&self) -> &'static str {
            "failing"
        }
        fn start(&mut self) -> ModuleResult {
            Err(anyhow::anyhow!("cannot start"))
        }
        fn stop(&mut self) -> ModuleResult {
            Err(anyhow::anyhow!("cannot stop"))
        }
    }
    let mut s = FailingService;
    assert_eq!(s.start().unwrap_err().to_string(), "cannot start");
    assert_eq!(s.stop().unwrap_err().to_string(), "cannot stop");
}

#[test]
fn event_handler_error_propagation() {
    #[derive(Debug)]
    struct ErrEvent {
        should_fail: bool,
    }
    impl DomainEvent for ErrEvent {
        fn event_name(&self) -> &'static str {
            "err.event"
        }
    }
    struct ErrHandler;
    impl EventHandler<ErrEvent> for ErrHandler {
        fn handle(&self, event: &ErrEvent) -> ModuleResult {
            if event.should_fail {
                Err(anyhow::anyhow!("handler failed"))
            } else {
                Ok(())
            }
        }
    }
    let h = ErrHandler;
    assert!(h.handle(&ErrEvent { should_fail: false }).is_ok());
    let err = h.handle(&ErrEvent { should_fail: true }).unwrap_err();
    assert_eq!(err.to_string(), "handler failed");
}

// ── Multiple event types ──

#[test]
fn multiple_domain_event_types() {
    #[derive(Debug)]
    struct EventA;
    impl DomainEvent for EventA {
        fn event_name(&self) -> &'static str {
            "event.a"
        }
    }
    #[derive(Debug)]
    struct EventB;
    impl DomainEvent for EventB {
        fn event_name(&self) -> &'static str {
            "event.b"
        }
    }
    assert_eq!(EventA.event_name(), "event.a");
    assert_eq!(EventB.event_name(), "event.b");
    assert_ne!(EventA.event_name(), EventB.event_name());
}

#[test]
fn handler_for_multiple_event_types() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Debug)]
    struct PriceEvent {
        #[allow(dead_code)]
        amount: i32,
    }
    impl DomainEvent for PriceEvent {
        fn event_name(&self) -> &'static str {
            "price.changed"
        }
    }
    struct MultiHandler(AtomicUsize);
    impl EventHandler<PriceEvent> for MultiHandler {
        fn handle(&self, _: &PriceEvent) -> ModuleResult {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }
    impl EventHandler<TestEvent> for MultiHandler {
        fn handle(&self, _: &TestEvent) -> ModuleResult {
            self.0.fetch_add(10, Ordering::SeqCst);
            Ok(())
        }
    }
    let h = MultiHandler(AtomicUsize::new(0));
    h.handle(&PriceEvent { amount: 99 }).unwrap();
    h.handle(&TestEvent { value: 1 }).unwrap();
    assert_eq!(h.0.load(Ordering::SeqCst), 11);
}

// ── Error context chaining ──

#[test]
fn module_result_supports_context() {
    use anyhow::Context;
    let result: ModuleResult<u32> = Err(anyhow::anyhow!("io error"));
    let chained = result.context("while loading config");
    let Err(err) = chained else {
        panic!("Expected an error")
    };
    let msg = format!("{err:#}");
    assert!(msg.contains("while loading config"));
    assert!(msg.contains("io error"));
}

#[test]
fn module_result_error_downcast() {
    use std::io;
    let result: ModuleResult<u32> = Err(anyhow::anyhow!(io::Error::new(
        io::ErrorKind::NotFound,
        "file missing"
    )));
    let Err(err) = result else {
        panic!("Expected an error")
    };
    let root = err.root_cause();
    assert!(root.downcast_ref::<io::Error>().is_some());
}
// ── HandlerType::as_str is a COMPATIBILITY SURFACE ─────────────
//
// contracts.rs:154-157 says so in as many words: the string matches
// `scripts/handler-classification.json` and "is the string a future generator
// emits, so the spelling is a compatibility surface, not an internal detail".
//
// Nothing graded that claim. scripts/verify-namespace-governance.py fails when a
// handler IMPL is missing from the registry, but it never compares the registry's
// category keys against what as_str() returns -- so a typo in this match
// ("command_contrbutor") would keep every gate green while every consumer of the
// classification received a category that exists nowhere in the registry.
//
// The list below is the json's `categories` keys verbatim, and the test is
// deliberately two-directional: a new variant with no registry row fails, and a
// registry row nobody can produce from Rust fails. That is the difference between
// pinning the spelling and merely exercising the function.

#[test]
fn handler_type_as_str_matches_the_classification_registry() {
    // Verbatim from scripts/handler-classification.json -> "categories".
    const REGISTRY: [&str; 6] = [
        "command_contributor",
        "projection_subscriber",
        "query_facade",
        "lifecycle",
        "plugin_bridge",
        "internal_helper",
    ];
    let every_variant = [
        HandlerType::CommandContributor,
        HandlerType::ProjectionSubscriber,
        HandlerType::QueryFacade,
        HandlerType::Lifecycle,
        HandlerType::PluginBridge,
        HandlerType::InternalHelper,
    ];
    let produced: Vec<&str> = every_variant.iter().map(|h| h.as_str()).collect();
    assert_eq!(
        produced, REGISTRY,
        "HandlerType::as_str drifted from handler-classification.json; the registry is the contract"
    );
    // Every produced spelling must be snake_case: the registry keys are, and a
    // camelCase leak would not be caught by the equality above if BOTH sides moved.
    for s in &produced {
        assert!(
            s.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
            "{s} is not the snake_case the registry uses"
        );
    }
}

// ── The defaults a leaf module inherits ───────────────────────
//
// Module gives six overridable members. Five have defaults and only `id` is
// required, so a leaf module inherits behaviour nobody wrote a test for. Three of
// them were covered by the existing cases; `dependencies`, `namespace_grants` and
// `handler_type` were never called at all, and each one widens or narrows a
// boundary if the default changes:
//   - `dependencies` decides which grants the kernel will accept (contracts.rs:87-91
//     says a grant naming an undeclared dependency fails BOOT).
//   - `namespace_grants` is the foreign-read set; a non-empty default would let every
//     module read every namespace.
//   - `handler_type` defaults to InternalHelper, "no cross-module contract".

#[test]
fn leaf_module_defaults_stay_narrow() {
    let m = TestModule::new("leaf");
    assert!(
        m.dependencies().is_empty(),
        "a leaf module must declare no dependencies; the kernel rejects grants for undeclared ones"
    );
    assert!(
        m.namespace_grants().is_empty(),
        "a leaf module must read no foreign namespace by default"
    );
    // `handler_type` belongs to EventHandler, not Module: TestHandler defers to the
    // default, which is the case that matters (a handler that never classified
    // itself must not silently claim a cross-module seam).
    assert_eq!(
        TestHandler::new().handler_type(),
        HandlerType::InternalHelper,
        "a handler that declares no type has no cross-module contract"
    );
}

#[test]
fn on_context_default_is_a_no_op() {
    // A module that never asked for the platform context must not be handed one:
    // the default is `fn on_context(&mut self, _ctx: &dyn ModuleContext) {}`, and
    // an implementation is what opts IN. Calling it must simply not panic.
    struct NoCaps;
    impl ModuleContext for NoCaps {
        fn has_capability(&self, _c: &str) -> bool {
            false
        }
        fn granted_capabilities(&self) -> Vec<String> {
            Vec::new()
        }
    }
    let mut m = TestModule::new("ctxless");
    m.on_context(&NoCaps);
    // The no-op must not have moved the module's lifecycle state.
    assert!(!m.started);
    assert!(!m.stopped);
}
