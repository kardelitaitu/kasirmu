/*
last audited 25-07-26 by RSA-Agent (platform-kernel slice B: error verified)
crate: platform-kernel | status: SAFE | lint: CLEAN
findings: clean thiserror kernel error taxonomy
next: none | perf: N/A
*/
//! Error type for `platform-kernel`.
//!
//! Uses `thiserror` so consumers can match on variants.

use thiserror::Error;

/// Errors that can originate in the module kernel.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum KernelError {
    /// A module with the given id is already registered.
    #[error("module '{0}' is already registered")]
    DuplicateModule(&'static str),

    /// A module's dependency could not be found.
    #[error("module '{module}' depends on '{dep}', but '{dep}' is not registered")]
    MissingDependency {
        /// The module that has the dependency.
        module: &'static str,
        /// The dependency that is missing.
        dep: &'static str,
    },

    /// A circular dependency was detected between modules.
    #[error("circular dependency detected: {0}")]
    CircularDependency(String),

    /// A module's manifest could not be parsed.
    #[error("failed to parse manifest for '{module}': {message}")]
    ManifestParseError {
        /// The module id.
        module: String,
        /// A human-readable description of the parse failure.
        message: String,
    },

    /// A module lifecycle operation (load/start/stop) failed.
    #[error("module '{module}' {operation} failed: {source}")]
    LifecycleError {
        /// The module id.
        module: &'static str,
        /// Which lifecycle step failed ("load", "start", "stop").
        operation: &'static str,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// A service lifecycle operation failed.
    #[error("service '{service}' {operation} failed: {source}")]
    ServiceError {
        /// The service id.
        service: &'static str,
        /// Which lifecycle step failed ("start", "stop").
        operation: &'static str,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// A module declared a capability that is not granted to it.
    #[error("module '{module}' is missing required capability: {missing}")]
    MissingCapability {
        /// The module id.
        module: &'static str,
        /// Comma-separated list of the ungranted capabilities.
        missing: String,
    },

    /// A capability string is malformed.
    #[error("invalid capability '{capability}': {message}")]
    InvalidCapability {
        /// The offending capability string.
        capability: String,
        /// Why it is invalid.
        message: String,
    },

    /// No modules are registered.
    #[error("no modules registered")]
    NoModulesRegistered,

    /// A module declared a namespace grant for a module it does not depend on.
    #[error(
        "module '{module}' declares a namespace grant for '{granted}', which is not in its dependencies"
    )]
    UndeclaredNamespaceGrant {
        /// The module that declared the grant.
        module: &'static str,
        /// The foreign module named by the grant.
        granted: &'static str,
    },

    /// An internal error occurred.
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
