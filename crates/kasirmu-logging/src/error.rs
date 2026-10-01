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
    /// The configured log level is invalid.
    #[error("invalid log level: {0}")]
    InvalidLevel(String),

    /// The log directory could not be prepared for writing.
    ///
    /// LOG-1: this replaced an `OpenFile(#[from] io::Error)` variant that was
    /// never constructed — no init path opens a log file itself
    /// (`tracing_appender::rolling` does), so it advertised a guarantee the
    /// crate could not deliver. This variant is constructed by the
    /// directory pre-flight `try_init_with_file` now performs, which is the
    /// failure that IS reachable (LOG-2).
    #[error("could not prepare log directory: {0}")]
    LogDirUnusable(#[from] std::io::Error),

    /// The global tracing subscriber has already been set.
    #[error("logging already initialised: {0}")]
    InitFailed(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
