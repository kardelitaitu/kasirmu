//! The kernel's concrete [`ModuleContext`].
//!
//! Plan Phase 2 (`todo-modular-scaffolding.md` §7) has the kernel build a context and hand it
//! to each module before `on_load`. The context is deliberately narrow: this
//! slice carries the capability registry, because that is what boot must fail
//! fast on; the typed service handles (event bus, settings store, namespaced
//! store factory, reporting facade, clock) attach to the same type as the
//! verticals migrate.

use std::collections::BTreeSet;

use foundation::contracts::ModuleContext;

use crate::capability::{Capability, CapabilityRegistry};

/// The kernel-built context handed to a single module.
///
/// A context is constructed per module so that [`ModuleContext::has_capability`]
/// answers for *that* module only: there is no way to ask about, or reach, a
/// handle granted to a different module.
#[derive(Debug)]
pub struct KernelContext<'a> {
    module: &'static str,
    capabilities: &'a CapabilityRegistry,
}

impl<'a> KernelContext<'a> {
    /// Build a context for `module` over the kernel's capability registry.
    #[must_use]
    pub fn new(module: &'static str, capabilities: &'a CapabilityRegistry) -> Self {
        Self {
            module,
            capabilities,
        }
    }

    /// The module this context was built for.
    #[must_use]
    pub fn module(&self) -> &'static str {
        self.module
    }

    /// The capabilities this module was granted, as raw strings in sorted order.
    #[must_use]
    pub fn granted(&self) -> Vec<String> {
        self.capabilities
            .get(self.module)
            .map(|m| {
                m.granted()
                    .iter()
                    .map(Capability::as_str)
                    .map(str::to_string)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether this module was granted the capability named `capability`.
    ///
    /// A malformed string is simply not granted (the registry only holds
    /// parsed capabilities); callers that need the parse error should go
    /// through [`Capability::parse`] directly.
    #[must_use]
    pub fn has(&self, capability: &str) -> bool {
        Capability::parse(capability)
            .map(|c| self.capabilities.is_granted(self.module, &c))
            .unwrap_or(false)
    }
}

impl ModuleContext for KernelContext<'_> {
    fn has_capability(&self, capability: &str) -> bool {
        self.has(capability)
    }

    fn granted_capabilities(&self) -> Vec<String> {
        self.granted()
    }
}

#[cfg(test)]
#[path = "context_tests.rs"]
mod tests;
