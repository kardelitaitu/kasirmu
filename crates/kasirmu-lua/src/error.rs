/*
last audited 25-07-26 by RSA-Agent (oz-lua slice A: error verified)
crate: oz-lua | status: SAFE | lint: CLEAN
findings: clean thiserror Lua error taxonomy
next: none | perf: N/A
*/
//! Error type for the `oz-lua` runtime.

use thiserror::Error;

/// Errors that can originate in the Lua runtime or script evaluation.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum LuaError {
    /// The Lua VM failed to start.
    #[error("lua runtime init failed: {0}")]
    Init(String),

    /// A script raised a Lua-level error.
    #[error("lua script error: {0}")]
    Script(String),

    /// A script tried to call a binding that is not exposed.
    #[error("unknown binding: {0}")]
    UnknownBinding(String),

    /// Failed to load a script from disk.
    #[error("lua script load failed: {0}")]
    Load(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
