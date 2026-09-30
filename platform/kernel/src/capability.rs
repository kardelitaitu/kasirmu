//! Capability registry — modules declare what they need; the kernel grants
//! explicitly and fails fast when a required capability is missing.
//!
//! Plan Phase 2 (todo-modular-scaffolding.md:853) requires modules to declare
//! required capabilities (`read:inventory`, `write:sales`,
//! `subscribe:sale_completed`, `use:reporting_facade`, `use:lua_hook:...`) and
//! that undeclared usage fails boot. Phase 1 made handler classification data;
//! this makes *permission* data too.

use std::collections::{BTreeMap, BTreeSet};

use crate::error::KernelError;

/// A capability a module may require, in the plan's `namespace:action` shape.
///
/// Deliberately a plain string newtype: the vocabulary is open (new verbs will
/// be added as verticals land) and the registry's job is *agreement between
/// the manifest and the code*, not a closed enum that would need a code change
/// to name a new capability.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Capability(String);

impl Capability {
    /// Build a capability from a `namespace:action` string.
    ///
    /// # Errors
    /// Returns [`KernelError::InvalidCapability`] when the string is empty,
    /// has no colon, or has an empty namespace or action.
    pub fn parse(s: &str) -> Result<Self, KernelError> {
        let Some((ns, action)) = s.split_once(':') else {
            return Err(KernelError::InvalidCapability {
                capability: s.to_string(),
                message: "expected <namespace>:<action>".into(),
            });
        };
        if ns.is_empty() || action.is_empty() {
            return Err(KernelError::InvalidCapability {
                capability: s.to_string(),
                message: "namespace and action must both be non-empty".into(),
            });
        }
        Ok(Self(s.to_string()))
    }

    /// The raw capability string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The namespace half (before the first colon).
    #[must_use]
    pub fn namespace(&self) -> &str {
        self.0.split_once(':').map_or(self.0.as_str(), |(ns, _)| ns)
    }
}

impl core::fmt::Display for Capability {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a single module declares and is granted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModuleCapabilities {
    required: BTreeSet<Capability>,
    granted: BTreeSet<Capability>,
}

impl ModuleCapabilities {
    /// A module that declares and is granted nothing (the default).
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// Declare a required capability.
    #[must_use]
    pub fn require(mut self, cap: Capability) -> Self {
        self.required.insert(cap);
        self
    }

    /// Grant a capability.
    #[must_use]
    pub fn grant(mut self, cap: Capability) -> Self {
        self.granted.insert(cap);
        self
    }

    /// The declared requirements.
    #[must_use]
    pub fn required(&self) -> &BTreeSet<Capability> {
        &self.required
    }

    /// The granted capabilities.
    #[must_use]
    pub fn granted(&self) -> &BTreeSet<Capability> {
        &self.granted
    }

    /// Capabilities required but not granted.
    #[must_use]
    pub fn missing(&self) -> Vec<&Capability> {
        self.required.difference(&self.granted).collect()
    }

    /// Whether every requirement is granted.
    #[must_use]
    pub fn is_satisfied(&self) -> bool {
        self.required.is_subset(&self.granted)
    }
}

/// The kernel's capability registry: module id -> declared + granted.
#[derive(Debug, Default)]
pub struct CapabilityRegistry {
    modules: BTreeMap<&'static str, ModuleCapabilities>,
}

impl CapabilityRegistry {
    /// Create an empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Declare and grant capabilities for a module.
    pub fn register(&mut self, module: &'static str, caps: ModuleCapabilities) {
        self.modules.insert(module, caps);
    }

    /// A module's declaration, if registered.
    #[must_use]
    pub fn get(&self, module: &str) -> Option<&ModuleCapabilities> {
        self.modules.get(module)
    }

    /// Whether a module was granted a capability.
    #[must_use]
    pub fn is_granted(&self, module: &str, cap: &Capability) -> bool {
        self.modules
            .get(module)
            .is_some_and(|m| m.granted.contains(cap))
    }

    /// Every module whose requirements are not fully granted.
    #[must_use]
    pub fn unsatisfied(&self) -> Vec<(&'static str, Vec<&Capability>)> {
        self.modules
            .iter()
            .filter(|(_, m)| !m.is_satisfied())
            .map(|(id, m)| (*id, m.missing()))
            .collect()
    }

    /// Fail fast when any registered module has an ungranted requirement.
    ///
    /// # Errors
    /// Returns [`KernelError::MissingCapability`] for the first unsatisfied
    /// module (deterministic: modules are keyed in a `BTreeMap`).
    pub fn verify_all(&self) -> Result<(), KernelError> {
        if let Some((module, missing)) = self.unsatisfied().into_iter().next() {
            let names: Vec<String> = missing.iter().map(|c| c.to_string()).collect();
            return Err(KernelError::MissingCapability {
                module,
                missing: names.join(", "),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "capability_tests.rs"]
mod tests;
