/*
last audited 25-07-26 by RSA-Agent (oz-plugin slice A: verified)
crate: oz-plugin | status: SAFE | lint: CLEAN
findings: clean — no unsafe code; sibling tests per convention
next: none | perf: N/A
*/
use thiserror::Error;

/// Plugin system error type.
#[derive(Error, Debug)]
pub enum PluginError {
    /// Invalid or unreadable plugin manifest.
    #[error("plugin manifest error: {0}")]
    Manifest(String),
    /// Underlying I/O failure.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// Lua runtime error.
    #[error("Lua error: {0}")]
    Lua(String),
    /// Plugin directory not found.
    #[error("plugin not found: {0}")]
    NotFound(String),
    /// Plugin action denied by sandbox policy.
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    /// Unexpected internal error.
    #[error("internal error: {0}")]
    Internal(String),
    /// Plugin archive (.ozp) read or extraction error.
    #[error("archive error: {0}")]
    Archive(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
