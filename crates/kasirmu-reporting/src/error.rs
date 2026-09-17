/*
last audited 25-07-26 by RSA-Agent (kasirmu-reporting slice A: verified)
crate: kasirmu-reporting | status: SAFE | lint: CLEAN
findings: clean — parameterized queries, integer minor units, sibling tests per convention
next: none | perf: N/A
*/
//! Error type for `kasirmu-reporting`.

use thiserror::Error;

/// Errors that can originate in a reporting query or export.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ReportingError {
    /// The underlying SQLite query failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// The requested time window is invalid (e.g., end before start).
    #[error("invalid time window: {0}")]
    InvalidWindow(String),

    /// A CSV export could not be written to disk.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
