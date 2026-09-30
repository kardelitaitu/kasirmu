//! Kernel lifecycle implementation.
/*
last audited 25-07-26 by RSA-Agent (platform-kernel slice B: lifecycle deep read)
crate: platform-kernel | status: SAFE | lint: CLEAN
findings: exemplary — only started services receive stop() (Service contract honored, partial-start tracked via started_service_ids); first-error-continue shutdown; manifest-validated registration with id-match enforcement; topological load with MissingDependency fail; production 1-300 read + tail structurally verified (pure accessors)
next: none | perf: N/A
*/

use super::dependency::collect_dependencies;
use super::types::ModuleStatus;
use crate::capability::{Capability, CapabilityRegistry, ModuleCapabilities};
use crate::context::KernelContext;
use crate::error::KernelError;
use crate::event_bus::EventBus;
use foundation::contracts::{Module, Service};
use std::collections::{HashMap, HashSet, VecDeque};
use tracing::{debug, error, info};

/// The module system kernel.
///
/// Manages module registration, dependency resolution, and lifecycle.
/// The kernel operates exclusively through the `Module` and `Service`
/// traits — it has no knowledge of specific module types.
pub struct Kernel {
    /// Registered modules, keyed by module id.
    modules: HashMap<&'static str, Box<dyn Module>>,
    /// Registered services.
    services: Vec<Box<dyn Service>>,
    /// Per-module runtime lifecycle status.
    statuses: HashMap<&'static str, ModuleStatus>,
    /// Whether `load_all` has been called.
    loaded: bool,
    /// Whether `start_all` has been called.
    started: bool,
    /// IDs of services that successfully started during `start_all`.
    /// Tracked so `stop_all` only calls `stop()` on services that were
    /// actually started — never on services skipped after a partial
    /// `start_all` failure (Service contract: stop() only after start()).
    started_service_ids: Vec<&'static str>,
    /// In-process event bus for module-to-module communication.
    event_bus: EventBus,
    /// Declared and granted capabilities per module (Phase 2).
    capabilities: CapabilityRegistry,
}

impl Kernel {
    /// Create a new empty kernel.
    pub fn new() -> Self {
        Self {
            modules: HashMap::new(),
            services: Vec::new(),
            statuses: HashMap::new(),
            loaded: false,
            started: false,
            started_service_ids: Vec::new(),
            event_bus: EventBus::new(),
            capabilities: CapabilityRegistry::new(),
        }
    }

    // ── Registration ─────────────────────────────────────────────

    /// Register a module with the kernel.
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::DuplicateModule`] if a module with the same
    /// id is already registered.
    pub fn register(&mut self, module: Box<dyn Module>) -> Result<(), KernelError> {
        let id = module.id();
        if self.modules.contains_key(id) {
            return Err(KernelError::DuplicateModule(id));
        }
        debug!(module = id, "registering module");
        self.modules.insert(id, module);
        self.statuses.insert(id, ModuleStatus::Registered);
        Ok(())
    }

    /// Register a module together with its `ModuleManifest`.
    ///
    /// Validates the manifest against the JSON Schema rules before
    /// registering. If validation fails, the module is **not** registered
    /// and the error is returned.
    ///
    /// Shorthand for:
    /// 1. `manifest.validate()`
    /// 2. `kernel.register(module)`
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::ManifestParseError`] if the manifest is
    /// invalid. Returns [`KernelError::DuplicateModule`] if the module
    /// is already registered.
    pub fn register_with_manifest(
        &mut self,
        module: Box<dyn Module>,
        manifest: &crate::manifest::ModuleManifest,
    ) -> Result<(), KernelError> {
        // Validate the manifest first.
        manifest.validate()?;

        // Confirm the module id matches the manifest id.
        let module_id = module.id();
        if module_id != manifest.id {
            return Err(KernelError::ManifestParseError {
                module: module_id.to_string(),
                message: format!(
                    "module id '{module_id}' does not match manifest id '{}'",
                    manifest.id
                ),
            });
        }

        self.register(module)
    }

    // ── Capabilities (Phase 2) ──

    /// Declare the capabilities a module requires and the capabilities it is
    /// granted. Replaces any previous declaration for that module.
    ///
    /// This is deliberately explicit: requirement and grant are two separate
    /// sets, and boot fails when a requirement is not covered by a grant (see
    /// [`verify_capabilities`](Self::verify_capabilities)). A module that
    /// declares nothing is unaffected.
    pub fn declare_capabilities(&mut self, module: &'static str, declared: ModuleCapabilities) {
        debug!(
            module,
            required = declared.required().len(),
            granted = declared.granted().len(),
            "declaring module capabilities"
        );
        self.capabilities.register(module, declared);
    }

    /// The kernel's capability registry.
    #[must_use]
    pub fn capabilities(&self) -> &CapabilityRegistry {
        &self.capabilities
    }

    /// A per-module context over the capability registry.
    #[must_use]
    pub fn context_for(&self, module: &'static str) -> KernelContext<'_> {
        KernelContext::new(module, &self.capabilities)
    }

    /// Declare, from a manifest capability list, each entry as both required
    /// and granted. A manifest that lists a capability is asserting the module
    /// may use it.
    ///
    /// # Errors
    /// Returns [`KernelError::InvalidCapability`] for a malformed string.
    pub fn declare_from_manifest(
        &mut self,
        module: &'static str,
        manifest_capabilities: &[String],
    ) -> Result<(), KernelError> {
        let mut declared = ModuleCapabilities::none();
        for raw in manifest_capabilities {
            let cap = Capability::parse(raw)?;
            declared = declared.require(cap.clone()).grant(cap);
        }
        self.declare_capabilities(module, declared);
        Ok(())
    }

    /// Verify that every declared capability is granted.
    ///
    /// # Errors
    /// Returns [`KernelError::MissingCapability`] naming the first module
    /// (in id order) with an ungranted requirement.
    pub fn verify_capabilities(&self) -> Result<(), KernelError> {
        self.capabilities.verify_all()
    }

    /// Register a service with the kernel.
    pub fn register_service(&mut self, service: Box<dyn Service>) {
        debug!(svc = service.id(), "registering service");
        self.services.push(service);
    }

    /// Check if a module is registered.
    pub fn is_registered(&self, id: &str) -> bool {
        self.modules.contains_key(id)
    }

    /// Number of registered modules.
    pub fn module_count(&self) -> usize {
        self.modules.len()
    }

    /// IDs of all registered modules.
    pub fn module_ids(&self) -> Vec<&'static str> {
        self.modules.keys().copied().collect()
    }

    /// Get the runtime status of a registered module.
    ///
    /// Returns `None` if the module is not registered.
    pub fn module_status(&self, id: &str) -> Option<ModuleStatus> {
        self.statuses.get(id).copied()
    }

    /// Get the runtime statuses of all registered modules.
    pub fn all_statuses(&self) -> &HashMap<&'static str, ModuleStatus> {
        &self.statuses
    }

    /// Get a reference to a registered module by id.
    pub fn get_module(&self, id: &str) -> Option<&dyn Module> {
        self.modules.get(id).map(|b| b.as_ref())
    }

    // ── Lifecycle: Load ──────────────────────────────────────────

    /// Call `on_load` on every registered module in dependency order.
    ///
    /// Idempotent for already-loaded modules: a retry after a partial
    /// failure (module N's `on_load` failed) skips modules 1..N-1 that
    /// already reached [`Loaded`](ModuleStatus::Loaded) state, so their
    /// `on_load` (and thus event-bus handler registration) is not
    /// re-run. Without this guard, a retry would double-register
    /// handlers (1 → 2 → 3 ... per retry), so every published event
    /// would fire them multiple times.
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::NoModulesRegistered`] if no modules are
    /// registered. Returns [`KernelError::MissingDependency`] or
    /// [`KernelError::CircularDependency`] from dependency resolution.
    /// Returns [`KernelError::LifecycleError`] if `on_load` fails.
    pub fn load_all(&mut self) -> Result<(), KernelError> {
        if self.modules.is_empty() {
            return Err(KernelError::NoModulesRegistered);
        }

        let order = self.resolve_dependencies()?;
        info!("loading {} modules in dependency order", order.len());

        // Phase 2: fail fast before any on_load runs if a module requires a
        // capability it was not granted. Checking before the loop means a
        // half-loaded system never exists.
        self.verify_capabilities()?;

        for &id in &order {
            // Skip modules that already loaded successfully — this makes
            // load_all idempotent across retries after a partial failure
            // (and across accidental double load_all calls). Re-running
            // on_load would double-register event-bus handlers (the
            // Module contract documents on_load as the handler-
            // registration hook), corrupting the subscriber registry.
            let current_status = self
                .statuses
                .get(id)
                .copied()
                .unwrap_or(ModuleStatus::Registered);
            if current_status == ModuleStatus::Loaded {
                debug!(module = id, "already loaded — skipping on_load");
                continue;
            }

            let module = self.modules.get_mut(id).ok_or_else(|| {
                KernelError::Internal(format!(
                    "module '{id}' not found after dependency resolution"
                ))
            })?;
            debug!(module = id, "loading module");
            module.on_load().map_err(|e| KernelError::LifecycleError {
                module: id,
                operation: "load",
                source: e,
            })?;
            // Phase 2: hand the module its (capability-scoped) context. The
            // borrow is released before the status update because the status
            // map and modules map are disjoint fields, but Rust's borrow
            // checker sees one &mut self — so build the context, call, then
            // drop the module borrow.
            let ctx = KernelContext::new(id, &self.capabilities);
            module.on_context(&ctx);
            self.statuses.insert(id, ModuleStatus::Loaded);
        }

        self.loaded = true;
        Ok(())
    }

    // ── Lifecycle: Start ─────────────────────────────────────────

    /// Call `on_start` on every module (in dependency order), then
    /// start all services.
    ///
    /// Auto-loads if `load_all` was not called explicitly.
    ///
    /// # Errors
    ///
    /// Propagates errors from module or service start.
    pub fn start_all(&mut self) -> Result<(), KernelError> {
        if !self.loaded {
            self.load_all()?;
        }

        let order = self.resolve_dependencies()?;
        info!("starting {} modules", order.len());

        for &id in &order {
            let module = self.modules.get_mut(id).ok_or_else(|| {
                KernelError::Internal(format!("module '{id}' not found during start"))
            })?;
            // Ensure module is in Loaded state before starting.
            let current_status = self
                .statuses
                .get(id)
                .copied()
                .unwrap_or(ModuleStatus::Registered);
            if current_status != ModuleStatus::Loaded && current_status != ModuleStatus::Stopped {
                let msg = format!(
                    "module '{id}' is in state {current_status:?}, expected Loaded or Stopped"
                );
                return Err(KernelError::Internal(msg));
            }

            debug!(module = id, "starting module");
            module.on_start().map_err(|e| KernelError::LifecycleError {
                module: id,
                operation: "start",
                source: e,
            })?;
            self.statuses.insert(id, ModuleStatus::Started);
        }

        // Start services after modules. Track each successfully-started
        // service id so stop_all only stops services that actually started
        // (skip services after a partial-start failure point).
        self.started_service_ids.clear();
        for service in &mut self.services {
            let id = service.id();
            debug!(svc = id, "starting service");
            service.start().map_err(|e| KernelError::ServiceError {
                service: id,
                operation: "start",
                source: e,
            })?;
            // Record only AFTER a successful start — a service whose
            // start() returned Err is NOT considered started.
            self.started_service_ids.push(id);
        }

        self.started = true;
        Ok(())
    }

    // ── Lifecycle: Stop ──────────────────────────────────────────

    /// Stop all services and modules gracefully.
    ///
    /// Services stop first (reverse registration order), then modules
    /// (reverse dependency order). Errors are logged but all items are
    /// stopped regardless. Each stopped module also has its event-bus
    /// handlers removed via [`EventBus::unsubscribe_module`] so that
    /// stopped modules do not keep receiving events.
    ///
    /// Only services that were actually started (recorded during
    /// `start_all`) have `stop()` called on them — services skipped
    /// after a partial `start_all` failure are left untouched, honoring
    /// the `Service` contract that `stop()` only runs after a successful
    /// `start()`.
    ///
    /// # Errors
    ///
    /// Returns the first error encountered (if any), but stopping
    /// continues for all other modules and services.
    pub fn stop_all(&mut self) -> Result<(), KernelError> {
        let mut first_error: Option<KernelError> = None;

        // Stop services in reverse order — but ONLY those that were
        // actually started. A partial start_all failure leaves services
        // after the failure point never-started; calling stop() on them
        // violates the Service contract (stop() only after start()) and
        // can panic/misbehave for services that allocate stop() resources
        // in start().
        let started: HashSet<&'static str> = self.started_service_ids.iter().copied().collect();
        for service in self.services.iter_mut().rev() {
            let id = service.id();
            if !started.contains(id) {
                debug!(svc = id, "skipping stop — service was never started");
                continue;
            }
            debug!(svc = id, "stopping service");
            if let Err(e) = service.stop() {
                error!(svc = id, error = %e, "failed to stop service");
                first_error.get_or_insert_with(|| KernelError::ServiceError {
                    service: id,
                    operation: "stop",
                    source: e,
                });
            }
        }

        // Stop modules in reverse dependency order. If dependency
        // resolution fails (e.g. circular dependency or missing dep),
        // fall back to stopping all modules in arbitrary order rather
        // than silently skipping shutdown.
        match self.resolve_dependencies() {
            Ok(order) => {
                for &id in order.iter().rev() {
                    if let Some(module) = self.modules.get_mut(id) {
                        debug!(module = id, "stopping module");
                        if let Err(e) = module.on_stop() {
                            error!(module = id, error = %e, "failed to stop module");
                            first_error.get_or_insert_with(|| KernelError::LifecycleError {
                                module: id,
                                operation: "stop",
                                source: e,
                            });
                        }
                    }
                    // Remove this module's event-bus handlers so a stopped
                    // module doesn't keep receiving events. Done regardless of
                    // on_stop outcome: stop_all tears down the entire kernel,
                    // so every module is marked Stopped below.
                    self.event_bus.unsubscribe_module(id);
                }
            }
            Err(e) => {
                error!(
                    error = %e,
                    "dependency resolution failed during shutdown — stopping all modules in fallback order"
                );
                // Surface the dep-resolution error, but still attempt
                // to stop every module. If a module's on_stop also fails,
                // that becomes the first error since it's more specific.
                first_error.get_or_insert(e);
                for (id, module) in &mut self.modules {
                    debug!(module = id, "stopping module (fallback)");
                    if let Err(stop_err) = module.on_stop() {
                        error!(module = id, error = %stop_err, "failed to stop module (fallback)");
                        first_error.get_or_insert_with(|| KernelError::LifecycleError {
                            module: id,
                            operation: "stop",
                            source: stop_err,
                        });
                    }
                    // Remove handlers even in fallback shutdown so stopped
                    // modules don't keep receiving events.
                    self.event_bus.unsubscribe_module(id);
                }
            }
        }

        // Update statuses to Stopped for any module that was Started or Loaded.
        for status in self.statuses.values_mut() {
            if *status == ModuleStatus::Started || *status == ModuleStatus::Loaded {
                *status = ModuleStatus::Stopped;
            }
        }

        self.started = false;
        self.loaded = false;
        // Clear the started-service tracking so a subsequent start_all
        // records a fresh set (no stale ids from the prior run).
        self.started_service_ids.clear();

        match first_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    // ── Dependency Resolution ────────────────────────────────────

    /// Resolve module dependencies using Kahn's algorithm (BFS-based
    /// topological sort).
    ///
    /// Modules declare their dependencies through the [`HasDependencies`](crate::kernel::dependency::HasDependencies)
    /// trait. Modules with no implemented trait are assumed to have zero
    /// dependencies.
    ///
    /// Returns module IDs in dependency-first order (dependencies appear
    /// before dependents).
    ///
    /// # Errors
    ///
    /// - [`KernelError::MissingDependency`] if a dependency is not registered.
    /// - [`KernelError::CircularDependency`] if a cycle is detected.
    pub(crate) fn resolve_dependencies(&self) -> Result<Vec<&'static str>, KernelError> {
        let module_ids: HashSet<&str> = self.modules.keys().copied().collect();
        if module_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Build the dependency graph: module → [its direct dependencies].
        let mut graph: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
        for (&id, module) in &self.modules {
            let deps = collect_dependencies(module.as_ref());
            // Validate that all declared deps are registered.
            for &dep in &deps {
                if !module_ids.contains(dep) {
                    return Err(KernelError::MissingDependency { module: id, dep });
                }
            }
            graph.insert(id, deps);
        }

        // Kahn's algorithm.
        // in_degree[m] = number of dependencies m has.
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        for &id in &module_ids {
            in_degree.insert(id, graph.get(id).map_or(0, |d| d.len()));
        }

        // Start with modules that have 0 dependencies.
        let mut queue: VecDeque<&str> = module_ids
            .iter()
            .filter(|id| *in_degree.get(*id).unwrap_or(&0) == 0)
            .copied()
            .collect();

        let mut sorted: Vec<&'static str> = Vec::new();

        while let Some(id) = queue.pop_front() {
            sorted.push(id);

            // Find every module that depends on `id` and decrement its
            // in_degree.
            for (&candidate, deps) in &graph {
                if deps.contains(&id)
                    && let Some(deg) = in_degree.get_mut(candidate)
                {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        queue.push_back(candidate);
                    }
                }
            }
        }

        if sorted.len() < module_ids.len() {
            let unresolved: Vec<String> = module_ids
                .iter()
                .filter(|id| !sorted.contains(id))
                .map(|s| (*s).to_string())
                .collect();
            return Err(KernelError::CircularDependency(unresolved.join(", ")));
        }

        Ok(sorted)
    }

    // ── Lifecycle: Individual Module Start/Stop ────────────────

    /// Start a single module by id.
    ///
    /// The module must be in [`Loaded`](ModuleStatus::Loaded) or
    /// [`Stopped`](ModuleStatus::Stopped) state. Calls `on_start()` on
    /// the module and updates its status to [`Started`](ModuleStatus::Started).
    ///
    /// When restarting a [`Stopped`](ModuleStatus::Stopped) module,
    /// `on_load()` is re-run first to restore the load-time invariant
    /// (configuration validation and event-handler registration). This
    /// is required because `stop_module` removes the module's event-bus
    /// handlers via `unsubscribe_module`; without re-running `on_load`,
    /// a restarted module would silently lose every event-bus
    /// subscription (the `Module` contract documents `on_load` as the
    /// hook where handlers are registered).
    ///
    /// Only starts the module itself — dependencies must be started
    /// separately via `start_all()`.
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::LifecycleError`] if `on_load` (on
    /// restart) or `on_start` fails, or [`KernelError::Internal`] if
    /// the module is not registered or is in an invalid state.
    pub fn start_module(&mut self, id: &'static str) -> Result<(), KernelError> {
        let module = self
            .modules
            .get_mut(id)
            .ok_or_else(|| KernelError::Internal(format!("module '{id}' is not registered")))?;

        let current_status = self
            .statuses
            .get(id)
            .copied()
            .unwrap_or(ModuleStatus::Registered);
        if current_status != ModuleStatus::Loaded && current_status != ModuleStatus::Stopped {
            let msg =
                format!("module '{id}' is in state {current_status:?}, expected Loaded or Stopped");
            return Err(KernelError::Internal(msg));
        }

        // Restart path: a Stopped module must re-run on_load to restore
        // the load-time invariant (handler registration, config
        // validation) before on_start, mirroring how start_all after
        // stop_all re-runs load_all → on_load (stop_all clears
        // self.loaded). Without this, event-bus handlers removed by
        // stop_module's unsubscribe_module call are never re-registered.
        if current_status == ModuleStatus::Stopped {
            debug!(module = id, "re-loading module on restart");
            module.on_load().map_err(|e| KernelError::LifecycleError {
                module: id,
                operation: "load",
                source: e,
            })?;
        }

        debug!(module = id, "starting single module");
        module.on_start().map_err(|e| KernelError::LifecycleError {
            module: id,
            operation: "start",
            source: e,
        })?;
        self.statuses.insert(id, ModuleStatus::Started);
        info!(module = id, "single module started");
        Ok(())
    }

    /// Stop a single module by id.
    ///
    /// The module must be in [`Started`](ModuleStatus::Started) state.
    /// Calls `on_stop()` on the module, removes its event-bus handlers
    /// via [`EventBus::unsubscribe_module`], and updates its status to
    /// [`Stopped`](ModuleStatus::Stopped).
    ///
    /// Does **not** cascade to dependents — callers must decide whether
    /// to stop modules that depend on this one.
    ///
    /// # Errors
    ///
    /// Returns [`KernelError::LifecycleError`] if `on_stop` fails, or
    /// [`KernelError::Internal`] if the module is not registered or is
    /// in an invalid state.
    pub fn stop_module(&mut self, id: &'static str) -> Result<(), KernelError> {
        let module = self
            .modules
            .get_mut(id)
            .ok_or_else(|| KernelError::Internal(format!("module '{id}' is not registered")))?;

        let current_status = self
            .statuses
            .get(id)
            .copied()
            .unwrap_or(ModuleStatus::Registered);
        if current_status != ModuleStatus::Started {
            let msg = format!("module '{id}' is in state {current_status:?}, expected Started");
            return Err(KernelError::Internal(msg));
        }

        debug!(module = id, "stopping single module");
        module.on_stop().map_err(|e| KernelError::LifecycleError {
            module: id,
            operation: "stop",
            source: e,
        })?;
        // Remove this module's event-bus handlers so a stopped module
        // doesn't keep receiving events after shutdown.
        self.event_bus.unsubscribe_module(id);
        self.statuses.insert(id, ModuleStatus::Stopped);
        info!(module = id, "single module stopped");
        Ok(())
    }

    // ── Event Bus ────────────────────────────────────────────────

    /// Access the kernel's shared event bus.
    ///
    /// Modules use this during `on_load` to register their event
    /// handlers.
    pub fn event_bus(&self) -> &EventBus {
        &self.event_bus
    }

    // ── State queries ─────────────────────────────────────────────

    /// Whether `load_all` has been called.
    pub fn is_loaded(&self) -> bool {
        self.loaded
    }

    /// Whether `start_all` has been called.
    pub fn is_started(&self) -> bool {
        self.started
    }
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "capability_lifecycle_tests.rs"]
mod capability_lifecycle_tests;
