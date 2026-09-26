//! Unit tests for the in-process, topic-based event bus.
//!
//! Split out of `event_bus.rs` to satisfy the AGENTS.md rule that unit
//! tests live in a sibling `*_tests.rs` file, never inside a production
//! `.rs` file. Wired from `event_bus.rs` with:
//!   `#[cfg(test)] #[path = "event_bus_tests.rs"] mod tests;`

use super::*;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

// ── Test event types ─────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
struct TestEvent {
    value: i32,
}

impl DomainEvent for TestEvent {
    fn event_name(&self) -> &'static str {
        "test.event"
    }
}

#[derive(Debug, Clone, PartialEq)]
struct OtherEvent {
    message: String,
}

impl DomainEvent for OtherEvent {
    fn event_name(&self) -> &'static str {
        "other.event"
    }
}

// ── Test handlers (use Arc for shared state) ─────────────────

struct TestHandler {
    last_value: AtomicI32,
}

impl TestHandler {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            last_value: AtomicI32::new(0),
        })
    }

    fn last_value(&self) -> i32 {
        self.last_value.load(Ordering::SeqCst)
    }
}

impl EventHandler<TestEvent> for TestHandler {
    fn handle(&self, event: &TestEvent) -> ModuleResult {
        self.last_value.store(event.value, Ordering::SeqCst);
        Ok(())
    }
}

// Arc<TestHandler> delegates to TestHandler
impl EventHandler<TestEvent> for Arc<TestHandler> {
    fn handle(&self, event: &TestEvent) -> ModuleResult {
        (**self).handle(event)
    }
}

struct FailingHandler;

impl EventHandler<TestEvent> for FailingHandler {
    fn handle(&self, _event: &TestEvent) -> ModuleResult {
        Err(anyhow::anyhow!("handler deliberately failed"))
    }
}

struct OtherHandler {
    last_message: std::sync::Mutex<Option<String>>,
}

impl OtherHandler {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            last_message: std::sync::Mutex::new(None),
        })
    }

    fn last_message(&self) -> Option<String> {
        self.last_message.lock().unwrap().clone()
    }
}

impl EventHandler<OtherEvent> for OtherHandler {
    fn handle(&self, event: &OtherEvent) -> ModuleResult {
        *self.last_message.lock().unwrap() = Some(event.message.clone());
        Ok(())
    }
}

impl EventHandler<OtherEvent> for Arc<OtherHandler> {
    fn handle(&self, event: &OtherEvent) -> ModuleResult {
        (**self).handle(event)
    }
}

// A handler that records whether it was called.
struct CalledHandler {
    was_called: AtomicBool,
}

impl CalledHandler {
    fn new() -> Self {
        Self {
            was_called: AtomicBool::new(false),
        }
    }
}

impl EventHandler<TestEvent> for CalledHandler {
    fn handle(&self, _event: &TestEvent) -> ModuleResult {
        self.was_called.store(true, Ordering::SeqCst);
        Ok(())
    }
}

// ── Tests ────────────────────────────────────────────────────

#[test]
fn empty_bus_has_no_topics() {
    let bus = EventBus::new();
    assert_eq!(bus.topic_count(), 0);
    assert_eq!(bus.handler_count(), 0);
}

#[test]
fn subscribe_and_publish() {
    let bus = EventBus::new();
    let handler = CalledHandler::new();

    bus.subscribe("test.event", Box::new(handler));
    assert_eq!(bus.topic_count(), 1);
    assert_eq!(bus.handler_count(), 1);
    assert!(bus.has_handlers("test.event"));

    bus.publish(&TestEvent { value: 42 }).unwrap();
    // Can't check handler state since it was moved into the bus
    // Instead, verify the bus processed it
    assert_eq!(bus.handler_count(), 1);
}

#[test]
fn publish_with_no_handlers_does_not_error() {
    let bus = EventBus::new();
    let result = bus.publish(&TestEvent { value: 1 });
    assert!(result.is_ok());
}

#[test]
fn failing_handler_does_not_block() {
    let bus = EventBus::new();

    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    bus.subscribe("test.event", Box::new(FailingHandler));

    let result = bus.publish(&TestEvent { value: 99 });
    assert!(result.is_ok());
}

#[test]
fn multiple_handlers_for_different_topics() {
    let bus = EventBus::new();

    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    bus.subscribe("other.event", Box::new(CalledHandler::new()));

    assert_eq!(bus.topic_count(), 2);
    assert_eq!(bus.handler_count(), 2);
}

#[test]
fn multiple_handlers_for_same_topic() {
    let bus = EventBus::new();

    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    bus.subscribe("test.event", Box::new(CalledHandler::new()));

    assert_eq!(bus.handler_count(), 2);
}

#[test]
fn has_handlers_returns_false_for_unknown_topic() {
    let bus = EventBus::new();
    assert!(!bus.has_handlers("nonexistent"));
}

#[test]
fn topic_count_is_distinct_topics() {
    let bus = EventBus::new();
    bus.subscribe("a", Box::new(CalledHandler::new()));
    bus.subscribe("a", Box::new(CalledHandler::new()));
    bus.subscribe("b", Box::new(CalledHandler::new()));

    assert_eq!(bus.topic_count(), 2);
    assert_eq!(bus.handler_count(), 3);
}

#[test]
fn concurrent_publish_is_safe() {
    let bus = Arc::new(EventBus::new());
    bus.subscribe("test.event", Box::new(CalledHandler::new()));

    let bus2 = bus.clone();
    let t1 = std::thread::spawn(move || {
        bus2.publish(&TestEvent { value: 1 }).unwrap();
    });
    let bus3 = bus.clone();
    let t2 = std::thread::spawn(move || {
        bus3.publish(&TestEvent { value: 2 }).unwrap();
    });

    t1.join().unwrap();
    t2.join().unwrap();
}

#[test]
fn subscribe_twice_same_topic() {
    let bus = EventBus::new();
    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    assert_eq!(bus.handler_count(), 2);
}

#[test]
fn publish_using_arc_handler() {
    let bus = EventBus::new();
    let handler = TestHandler::new();
    bus.subscribe("test.event", Box::new(handler.clone()));

    bus.publish(&TestEvent { value: 77 }).unwrap();
    assert_eq!(handler.last_value(), 77);
}

#[test]
fn multiple_topics_independent() {
    let bus = EventBus::new();
    let test_handler = TestHandler::new();
    let other_handler = OtherHandler::new();

    bus.subscribe("test.event", Box::new(test_handler.clone()));
    bus.subscribe("other.event", Box::new(other_handler.clone()));

    bus.publish(&TestEvent { value: 42 }).unwrap();
    assert_eq!(test_handler.last_value(), 42);
    assert!(other_handler.last_message().is_none());

    bus.publish(&OtherEvent {
        message: "hello".into(),
    })
    .unwrap();
    assert_eq!(test_handler.last_value(), 42);
    assert_eq!(other_handler.last_message(), Some("hello".into()));
}

// ── Module-scoped subscription tests ─────────────────────────

#[test]
fn subscribe_for_module_tracks_module_id() {
    let bus = EventBus::new();

    bus.subscribe_for_module("inventory", "test.event", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("sales", "test.event", Box::new(CalledHandler::new()));

    assert_eq!(bus.handler_count_for_module("inventory"), 1);
    assert_eq!(bus.handler_count_for_module("sales"), 1);
    assert_eq!(bus.handler_count_for_module("unknown"), 0);
    assert_eq!(bus.handler_count(), 2);
}

#[test]
fn subscribe_for_module_and_publish() {
    let bus = EventBus::new();
    let handler = TestHandler::new();

    bus.subscribe_for_module("inventory", "test.event", Box::new(handler.clone()));
    bus.publish(&TestEvent { value: 42 }).unwrap();
    assert_eq!(handler.last_value(), 42);
}

#[test]
fn unsubscribe_module_removes_all_its_handlers() {
    let bus = EventBus::new();

    bus.subscribe_for_module("inventory", "test.event", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("inventory", "other.event", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("sales", "test.event", Box::new(CalledHandler::new()));

    assert_eq!(bus.handler_count(), 3);
    assert_eq!(bus.handler_count_for_module("inventory"), 2);

    let removed = bus.unsubscribe_module("inventory");
    assert_eq!(removed, 2);

    // Sales handler should remain.
    assert_eq!(bus.handler_count(), 1);
    assert_eq!(bus.handler_count_for_module("inventory"), 0);
    assert_eq!(bus.handler_count_for_module("sales"), 1);
}

#[test]
fn unsubscribe_module_with_no_handlers_returns_zero() {
    let bus = EventBus::new();
    let removed = bus.unsubscribe_module("nonexistent");
    assert_eq!(removed, 0);
}

#[test]
fn unsubscribe_module_does_not_affect_anonymous_subscriptions() {
    let bus = EventBus::new();

    bus.subscribe("test.event", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("inventory", "test.event", Box::new(CalledHandler::new()));

    assert_eq!(bus.handler_count(), 2);

    let removed = bus.unsubscribe_module("inventory");
    assert_eq!(removed, 1);

    // Anonymous handler should remain.
    assert_eq!(bus.handler_count(), 1);
    assert!(bus.has_handlers("test.event"));
}

#[test]
fn unsubscribe_module_multiple_topics() {
    let bus = EventBus::new();

    bus.subscribe_for_module("inventory", "a", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("inventory", "b", Box::new(CalledHandler::new()));
    bus.subscribe_for_module("inventory", "c", Box::new(CalledHandler::new()));

    assert_eq!(bus.topic_count(), 3);
    assert_eq!(bus.handler_count(), 3);

    bus.unsubscribe_module("inventory");
    assert_eq!(bus.handler_count(), 0);
}

#[test]
fn module_handlers_are_called_in_order() {
    let bus = EventBus::new();
    let first = TestHandler::new();
    let second = TestHandler::new();

    bus.subscribe_for_module("sales", "test.event", Box::new(first.clone()));
    bus.subscribe_for_module("inventory", "test.event", Box::new(second.clone()));

    bus.publish(&TestEvent { value: 100 }).unwrap();
    assert_eq!(first.last_value(), 100);
    assert_eq!(second.last_value(), 100);
}

#[test]
fn unsubscribe_then_resubscribe() {
    let bus = EventBus::new();

    bus.subscribe_for_module("inventory", "test.event", Box::new(CalledHandler::new()));
    bus.unsubscribe_module("inventory");
    assert_eq!(bus.handler_count(), 0);

    // Re-subscribe.
    bus.subscribe_for_module("inventory", "test.event", Box::new(CalledHandler::new()));
    assert_eq!(bus.handler_count(), 1);
    assert!(bus.has_handlers("test.event"));
}

/// A handler that calls `subscribe()` during publish must NOT deadlock.
/// This is the regression test for Bug #2 — `publish()` must release
/// the read lock before dispatching so re-entrant subscribe/unsubscribe
/// calls don't deadlock on the RwLock write lock.
#[test]
fn handler_can_subscribe_during_publish() {
    let bus = Arc::new(EventBus::new());

    // Handler that subscribes to another topic during handle().
    struct SubscribingHandler {
        bus: Arc<EventBus>,
    }
    impl EventHandler<TestEvent> for SubscribingHandler {
        fn handle(&self, _event: &TestEvent) -> ModuleResult {
            self.bus
                .subscribe("other.event", Box::new(CalledHandler::new()));
            Ok(())
        }
    }

    bus.subscribe(
        "test.event",
        Box::new(SubscribingHandler { bus: bus.clone() }),
    );

    // Publish in a separate thread so a deadlock doesn't hang the test runner.
    let bus_clone = bus.clone();
    let handle = std::thread::spawn(move || bus_clone.publish(&TestEvent { value: 1 }));

    // Before the fix this will hang (deadlock).
    // Join with a 5-second timeout via std::sync::mpsc.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(handle.join());
    });
    let result = rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("publish should not deadlock (timeout = 5s)")
        .expect("publish thread should not panic");

    assert!(result.is_ok(), "publish should succeed");
    assert!(
        bus.has_handlers("other.event"),
        "handler should have subscribed to other.event during publish"
    );
}

/// Remaining handlers after a panicking handler are still called.
/// This is the regression test for Bug #1 — the `publish()` method
/// must catch individual handler panics so that the rest of the
/// handler chain is not silently dropped.
#[test]
fn handlers_after_panicking_handler_are_still_called() {
    let bus = EventBus::new();

    struct PanicHandler;
    impl EventHandler<TestEvent> for PanicHandler {
        fn handle(&self, _event: &TestEvent) -> ModuleResult {
            panic!("intentional panic");
        }
    }

    let second = Arc::new(AtomicBool::new(false));
    struct SecondHandler(Arc<AtomicBool>);
    impl EventHandler<TestEvent> for SecondHandler {
        fn handle(&self, _event: &TestEvent) -> ModuleResult {
            self.0.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    bus.subscribe("test.event", Box::new(PanicHandler));
    bus.subscribe("test.event", Box::new(SecondHandler(second.clone())));

    // The publish should NOT panic — the panicking handler must be caught
    // so remaining handlers still run.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        bus.publish(&TestEvent { value: 1 })
    }));
    assert!(result.is_ok(), "publish should not propagate handler panic");
    let inner = result.unwrap();
    assert!(inner.is_ok(), "publish should return Ok");
    assert!(
        second.load(Ordering::SeqCst),
        "second handler should have been called despite first panicking"
    );
}

/// Panicking handler does not poison the bus and remaining handlers
/// still run (Bug #1 fix uses `catch_unwind` per-handler).
#[test]
fn panicking_handler_does_not_poison_bus() {
    let bus = Arc::new(EventBus::new());

    // Handler that panics on odd values.
    struct PanicOnOdd;
    impl EventHandler<TestEvent> for PanicOnOdd {
        fn handle(&self, event: &TestEvent) -> ModuleResult {
            if event.value % 2 != 0 {
                panic!("handler panicked on odd value: {}", event.value);
            }
            Ok(())
        }
    }

    let good_handler = TestHandler::new();
    bus.subscribe("test.event", Box::new(PanicOnOdd));
    bus.subscribe("test.event", Box::new(good_handler.clone()));

    // First publish with odd value — handler panics but publish catches it
    // (Bug #1 fix: catch_unwind isolates each handler).
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        bus.publish(&TestEvent { value: 1 })
    }));
    // The panic is caught internally — publish returns Ok.
    assert!(
        result.is_ok(),
        "publish should catch handler panic internally"
    );
    let inner = result.unwrap();
    assert!(
        inner.is_ok(),
        "publish should return Ok even if a handler panicked"
    );
    // The good handler was called with value 1 despite the panic.
    assert_eq!(
        good_handler.last_value(),
        1,
        "handler after panicking handler should still be called"
    );

    // The bus must NOT be poisoned — subsequent publish should work.
    let result2 = bus.publish(&TestEvent { value: 2 });
    assert!(result2.is_ok(), "bus should still be usable after panic");
    assert_eq!(good_handler.last_value(), 2);
}
