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

/// What the kernel hands a module when it is loaded (Phase 2, plan §7).
///
/// Deliberately narrow: the trait is defined here, at the bottom of the
/// dependency graph, so `platform-kernel` can implement it without
/// `foundation` depending on the kernel. It is a `dyn`-compatible trait, not a
/// service-locator bag: each accessor returns a typed handle, and a module only
/// obtains a foreign handle through a capability it was granted.
///
/// The final surface (event bus, settings store, namespaced-store factory,
/// reporting facade, logger, clock, transaction coordinator) lands as the
/// Phase 2 verticals migrate; this trait carries the capability registry now,
/// because that is the part boot must fail fast on.
pub trait ModuleContext {
    /// Whether this module was granted `capability`.
    ///
    /// The module compares against the `namespace:action` strings it declared
    /// in its manifest `capabilities` list.
    fn has_capability(&self, capability: &str) -> bool;

    /// The capabilities this module was granted, for diagnostics.
    fn granted_capabilities(&self) -> Vec<String>;
}

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

    /// The foreign namespaces this module's stores intend to read (Phase 4 P4.1).
    ///
    /// This mirrors what the module's repositories put in a `Grants` value, as
    /// plain module ids. The kernel rejects a grant that names a module the
    /// module does not declare in [`dependencies`](Self::dependencies), so a
    /// code-level grant with no manifest/dependency basis fails boot instead of
    /// silently widening the namespace boundary.
    ///
    /// Defaults to no foreign reads, so a module that reads only its own
    /// namespace need not implement it.
    fn namespace_grants(&self) -> &'static [ModuleId] {
        &[]
    }

    /// Receive the platform context after the kernel loads the module
    /// (Phase 2, plan §7). Default no-op so existing modules compile
    /// unchanged; a module that needs a platform service overrides it.
    fn on_context(&mut self, _ctx: &dyn ModuleContext) {}
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

/// The seam classification a handler carries, per ADR-62 D4.
///
/// Every registered handler is exactly one of these. The classification is
/// data, not prose, so a future gate (plan §11.3) can check it mechanically
/// and a missing classification is a failure rather than a judgement call.
///
/// It describes what kind of seam the handler sits on:
/// - `CommandContributor` — runs inside the originating transaction and may
///   reject it (removing it could change whether the fact is valid);
/// - `ProjectionSubscriber` — runs after commit and must not reject;
/// - `QueryFacade` — the sanctioned cross-vertical read surface;
/// - `Lifecycle` — module lifecycle callback, log-only, no cross-module contract;
/// - `PluginBridge` — fan-out to a plugin/host integration (e.g. LAN);
/// - `InternalHelper` — internal machinery carrying no cross-module contract.
///
/// The variants mirror the ADR-62 D4 vocabulary exactly; do not rename them
/// without superseding that ADR.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HandlerType {
    /// In-transaction handler that may reject the originating operation.
    CommandContributor,
    /// Post-commit handler that projects a fact and must not reject.
    ProjectionSubscriber,
    /// The sanctioned cross-vertical read surface (ADR-62 D5).
    QueryFacade,
    /// Module lifecycle callback; no cross-module contract.
    Lifecycle,
    /// Fan-out bridge to a plugin or host integration.
    PluginBridge,
    /// Internal machinery; no cross-module contract.
    InternalHelper,
}

impl HandlerType {
    /// The stable snake_case name, matching `scripts/handler-classification.json`.
    ///
    /// This is the string a future generator (T2, §11.3) emits, so the spelling
    /// is a compatibility surface, not an internal detail.
    pub fn as_str(self) -> &'static str {
        match self {
            HandlerType::CommandContributor => "command_contributor",
            HandlerType::ProjectionSubscriber => "projection_subscriber",
            HandlerType::QueryFacade => "query_facade",
            HandlerType::Lifecycle => "lifecycle",
            HandlerType::PluginBridge => "plugin_bridge",
            HandlerType::InternalHelper => "internal_helper",
        }
    }
}

/// An event handler that reacts to domain events.
///
/// Event handlers are registered with the event bus and called when
/// matching events are published.
pub trait EventHandler<E>: Send + Sync
where
    E: Send + Sync + 'static,
{
    /// The handler's seam classification (ADR-62 D4).
    ///
    /// Defaults to `InternalHelper` so existing impls keep compiling; every
    /// *registered* handler overrides it with its census category. The default
    /// is deliberately the least contractual class: an unclassified handler
    /// claims nothing, which is the honest reading of "not yet declared".
    ///
    /// This is a `&self` method rather than an associated `const` because the
    /// trait is used as `Box<dyn EventHandler<E>>` in the kernel event bus, and
    /// an associated const would make the trait not dyn-compatible (E0038).
    /// Overrides carry no state; the value is fixed per type.
    fn handler_type(&self) -> HandlerType {
        HandlerType::InternalHelper
    }

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
