/*
last audited 25-07-26 by RSA-Agent (kasirmu-logging slice A: verified)
crate: kasirmu-logging | status: SAFE | lint: CLEAN
findings: clean — sibling tests per convention
next: none | perf: N/A
*/
//! Error type for `kasirmu-logging`.

use thiserror::Error;

/// Errors that can originate in the logging subsystem.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum LoggingError {
    /// The log file could not be opened for writing.
    #[error("could not open log file: {0}")]
    OpenFile(#[from] std::io::Error),

    /// The configured log level is invalid.
    #[error("invalid log level: {0}")]
    InvalidLevel(String),

    /// The global tracing subscriber has already been set.
    #[error("logging already initialised: {0}")]
    InitFailed(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
