//! Shared traits for the kasir.mu module system.
/*
last audited 25-07-26 by RSA-Agent (foundation slice E: contracts deep read)
crate: foundation | status: SAFE | lint: CLEAN
findings: clean module contracts — Module/Service/EventHandler/DomainEvent traits, anyhow-based ModuleResult, documented topological-sort dependency semantics; inline tests (COR-33 pattern)
next: none | perf: N/A
*/
//!
//! These traits define the lifecycle and inter-module communication
//! contracts that all modules must implement.

use std::fmt::Debug;

/// A unique identifier for a module.
pub type ModuleId = &'static str;

/// The result type used by module lifecycle operations.
///
/// Uses [`anyhow::Error`] so that callers can chain errors with
/// [`.context()`](anyhow::Context) and downcast when needed.
pub type ModuleResult<T = ()> = Result<T, anyhow::Error>;

/// A deployable feature module.
///
/// Each module in kasir.mu implements this trait to participate in the
/// module lifecycle managed by the Kernel (see `platform/kernel`).
pub trait Module: Debug + Send + Sync {
    /// Stable identifier for this module (e.g. `"sales"`, `"inventory"`).
    fn id(&self) -> ModuleId;

    /// Module IDs this module depends on, mirroring the `dependencies`
    /// array in the module's `manifest.json`.
    ///
    /// The kernel topologically sorts registered modules by this list, so
    /// a dependency's `on_load`/`on_start` always runs first and its
    /// `on_stop` always runs last. Every declared id must belong to a
    /// registered module or `load_all` fails with
    /// `KernelError::MissingDependency`.
    ///
    /// Defaults to no dependencies, so a leaf module need not implement it.
    fn dependencies(&self) -> &'static [ModuleId] {
        &[]
    }

    /// Called after the module is registered but before it is started.
    /// Use this to validate configuration and register event handlers.
    fn on_load(&mut self) -> ModuleResult {
        Ok(())
    }

    /// Start the module. This is called once all modules are loaded.
    /// Use this to spawn background tasks, open connections, etc.
    fn on_start(&mut self) -> ModuleResult {
        Ok(())
    }

    /// Stop the module gracefully. Called during application shutdown.
    fn on_stop(&mut self) -> ModuleResult {
        Ok(())
    }
}

/// A service that can be started and stopped.
///
/// Services are long-running components (e.g., a sync engine, a
/// background task) managed by the module system.
pub trait Service: Debug + Send + Sync {
    /// Stable identifier for this service.
    fn id(&self) -> &'static str;

    /// Start the service. This should spawn any background tasks.
    fn start(&mut self) -> ModuleResult;

    /// Stop the service gracefully.
    fn stop(&mut self) -> ModuleResult;
}

/// An event handler that reacts to domain events.
///
/// Event handlers are registered with the event bus and called when
/// matching events are published.
pub trait EventHandler<E>: Send + Sync
where
    E: Send + Sync + 'static,
{
    /// Handle an event of type `E`.
    fn handle(&self, event: &E) -> ModuleResult;
}

/// A domain event that can be published on the event bus.
pub trait DomainEvent: Send + Sync + 'static {
    /// A human-readable name for the event (e.g. "sale.completed").
    fn event_name(&self) -> &'static str;
}

#[cfg(test)]
mod tests {
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
        let debug = format!("{:?}", m);
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
        let debug = format!("{:?}", s);
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
}
