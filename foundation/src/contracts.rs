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
#[path = "contracts_tests.rs"]
mod tests;
