//! In-process, topic-based, synchronous event bus.
/*
last audited 25-07-26 by RSA-Agent (platform-kernel slice A: event_bus deep read)
crate: platform-kernel | status: SAFE | lint: CLEAN
findings: exemplary — Bug #2 reentrant-deadlock prevention (handler list snapshotted under short-lived read lock, released before dispatch); handler panics isolated via catch_unwind with structured logging (publisher never dies); errors logged-not-propagated per documented fire-and-forget contract; poison recovery via into_inner (documented choice); module-scoped unsubscribe atomically removes handlers across topics
next: none | perf: snapshot avoids lock-held dispatch
*/
//!
//! The [`EventBus`] decouples modules by allowing them to publish and
//! subscribe to domain events without direct imports. Handlers are
//! dispatched synchronously — the publisher blocks until all handlers
//! have run. Errors are logged but do not propagate.
//!
//! # Thread safety
//!
//! `EventBus` is `Send + Sync`. Use `Arc<EventBus>` for shared
//! access between modules and the kernel.
//!
//! # Design
//!
//! See ADR #2 (`docs/decisions/2026-02-01-event-bus-design.md`) for
//! the full design rationale.

use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use foundation::contracts::{DomainEvent, EventHandler, ModuleResult};
use tracing::{debug, error};

/// A type-erased event handler stored in the bus.
/// Uses `Arc` so [`SubscriberEntry`] is `Clone`, enabling the
/// publish loop to clone the handler list under a read lock and
/// release it before dispatching (prevents reentrant deadlocks —
/// Bug #2).
type HandlerFn = Arc<dyn Fn(&dyn Any) -> ModuleResult + Send + Sync>;

/// Wrap an `EventHandler<E>` into a type-erased `HandlerFn`.
fn wrap_handler<E>(handler: Box<dyn EventHandler<E>>) -> HandlerFn
where
    E: DomainEvent + 'static,
{
    Arc::new(move |event: &dyn Any| -> ModuleResult {
        match event.downcast_ref::<E>() {
            Some(typed) => handler.handle(typed),
            None => Err(anyhow::anyhow!(
                "event bus type mismatch: expected {}, got unknown type",
                std::any::type_name::<E>(),
            )),
        }
    })
}

/// A registered subscriber entry, optionally owned by a module.
/// `Clone` is derived so the publish loop can snapshot handlers
/// under a read lock before releasing it for dispatch (Bug #2).
#[derive(Clone)]
struct SubscriberEntry {
    /// The module that registered this handler, or `""` for anonymous.
    module_id: &'static str,
    /// The type-erased handler function.
    handler: HandlerFn,
}

/// In-process event bus with synchronous dispatch and module-scoped
/// subscription tracking.
///
/// Handlers can be registered with an optional `module_id` via
/// [`subscribe_for_module`](EventBus::subscribe_for_module). When a
/// module is stopped, `unsubscribe_module`
/// atomically removes all handlers owned by that module.
///
/// # Example
///
/// ```no_run
/// # use platform_kernel::EventBus;
/// # use foundation::contracts::{DomainEvent, EventHandler, ModuleResult};
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// // Define an event
/// #[derive(Clone, Debug)]
/// struct SaleCompleted { sale_id: String }
/// impl DomainEvent for SaleCompleted {
///     fn event_name(&self) -> &'static str { "sale.completed" }
/// }
///
/// // Define a handler
/// struct InventoryHandler;
/// impl EventHandler<SaleCompleted> for InventoryHandler {
///     fn handle(&self, event: &SaleCompleted) -> ModuleResult {
///         println!("processing sale: {}", event.sale_id);
///         Ok(())
///     }
/// }
///
/// // Wire it up
/// let bus = EventBus::new();
/// bus.subscribe("sale.completed", Box::new(InventoryHandler));
/// bus.publish(&SaleCompleted { sale_id: "sale-1".into() })?;
/// # Ok(())
/// # }
pub struct EventBus {
    /// Map of topic name → subscriber entries (handler + ownership).
    subscribers: RwLock<HashMap<&'static str, Vec<SubscriberEntry>>>,
}

impl EventBus {
    /// Create a new empty event bus.
    pub fn new() -> Self {
        Self {
            subscribers: RwLock::new(HashMap::new()),
        }
    }

    /// Register a handler for events published under the given topic.
    ///
    /// The `topic` must match the value returned by `event.event_name()`
    /// on the published event.
    ///
    /// Multiple handlers can be registered for the same topic; they are
    /// called in registration order.
    ///
    /// This is an anonymous subscription (no module ownership tracking).
    /// Prefer [`subscribe_for_module`](EventBus::subscribe_for_module)
    /// when the handler belongs to a module that may be stopped at runtime.
    pub fn subscribe<E>(&self, topic: &'static str, handler: Box<dyn EventHandler<E>>)
    where
        E: DomainEvent + 'static,
    {
        let mut subs = self
            .subscribers
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        subs.entry(topic).or_default().push(SubscriberEntry {
            module_id: "",
            handler: wrap_handler::<E>(handler),
        });
        debug!(topic, "anonymous event handler registered");
    }

    /// Register a handler owned by a specific module.
    ///
    /// When the module is stopped, call `unsubscribe_module`
    /// to atomically remove all handlers registered under that
    /// `module_id` across all topics.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # use platform_kernel::EventBus;
    /// # use foundation::contracts::{DomainEvent, EventHandler, ModuleResult};
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// #[derive(Clone, Debug)] struct MyEvent;
    /// # impl DomainEvent for MyEvent { fn event_name(&self) -> &'static str { "my.event" } }
    /// struct MyHandler;
    /// # impl EventHandler<MyEvent> for MyHandler { fn handle(&self, _: &MyEvent) -> ModuleResult { Ok(()) } }
    /// let bus = EventBus::new();
    /// bus.subscribe_for_module("inventory", "sale.completed", Box::new(MyHandler));
    /// # Ok(())
    /// # }
    /// ```
    pub fn subscribe_for_module<E>(
        &self,
        module_id: &'static str,
        topic: &'static str,
        handler: Box<dyn EventHandler<E>>,
    ) where
        E: DomainEvent + 'static,
    {
        let wrapped = wrap_handler::<E>(handler);
        let mut subs = self
            .subscribers
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        subs.entry(topic).or_default().push(SubscriberEntry {
            module_id,
            handler: wrapped,
        });
        debug!(module = module_id, topic, "module event handler registered");
    }

    /// Remove all handlers owned by the given module across every topic.
    ///
    /// This is called by the kernel when a module is stopped, ensuring
    /// stopped modules do not continue to receive events.
    ///
    /// Returns the number of handlers removed.
    pub fn unsubscribe_module(&self, module_id: &'static str) -> usize {
        let mut subs = self
            .subscribers
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut total_removed = 0;

        // Retain only entries that do NOT belong to the given module,
        // dropping topic keys that become empty.
        subs.retain(|topic, entries| {
            let before = entries.len();
            entries.retain(|e| e.module_id != module_id);
            let removed = before - entries.len();
            total_removed += removed;
            if removed > 0 {
                debug!(
                    module = module_id,
                    topic, removed, "unsubscribed module handlers"
                );
            }
            // Drop the topic key entirely if no handlers remain.
            !entries.is_empty()
        });

        if total_removed > 0 {
            debug!(
                module = module_id,
                total_removed, "module fully unsubscribed"
            );
        }
        total_removed
    }

    /// Publish an event to all subscribed handlers.
    ///
    /// The topic is obtained from `event.event_name()`. All handlers
    /// registered for that topic are called synchronously. If a handler
    /// returns an error, it is logged but other handlers still run.
    ///
    /// Returns `Ok(())` regardless of individual handler errors (the
    /// error is fire-and-forget).
    pub fn publish<E>(&self, event: &E) -> ModuleResult
    where
        E: DomainEvent + 'static,
    {
        let topic = event.event_name();
        let any_ref: &dyn Any = event;

        // Snapshot the handler list under a short-lived read lock so the
        // lock can be released before dispatching. This prevents reentrant
        // deadlocks when a handler calls subscribe/unsubscribe during its
        // callback (Bug #2).
        let entries: Vec<SubscriberEntry> = {
            let subs = self
                .subscribers
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match subs.get(topic) {
                Some(h) => h.clone(),
                None => {
                    debug!(topic, "no handlers registered for this event");
                    return Ok(());
                }
            }
        }; // read lock released here

        let count = entries.len();
        for (i, entry) in entries.iter().enumerate() {
            let result =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (entry.handler)(any_ref)));
            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    error!(
                        topic,
                        handler_index = i,
                        module = entry.module_id,
                        error = %e,
                        "event handler failed (continuing)"
                    );
                }
                Err(panic_payload) => {
                    let panic_msg = panic_payload
                        .downcast_ref::<&str>()
                        .copied()
                        .or_else(|| panic_payload.downcast_ref::<String>().map(|s| s.as_str()))
                        .unwrap_or("unknown panic");
                    error!(
                        topic,
                        handler_index = i,
                        module = entry.module_id,
                        panic = %panic_msg,
                        "event handler panicked (continuing)"
                    );
                }
            }
        }

        debug!(topic, handler_count = count, "event published");
        Ok(())
    }

    /// Number of topics with registered handlers.
    pub fn topic_count(&self) -> usize {
        self.subscribers
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }

    /// Number of handlers registered for a specific module across all topics.
    pub fn handler_count_for_module(&self, module_id: &str) -> usize {
        self.subscribers
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .flat_map(|v| v.iter())
            .filter(|e| e.module_id == module_id)
            .count()
    }

    /// Total number of registered handlers across all topics.
    pub fn handler_count(&self) -> usize {
        self.subscribers
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .map(|v| v.len())
            .sum()
    }

    /// Check if any handlers are registered for a topic.
    pub fn has_handlers(&self, topic: &str) -> bool {
        self.subscribers
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(topic)
            .is_some_and(|v| !v.is_empty())
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "event_bus_tests.rs"]
mod tests;
