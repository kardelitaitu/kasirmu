/*
last audited 25-07-26 by RSA-Agent (kasirmu-cli slice B: verified)
crate: kasirmu-cli | status: SAFE | lint: CLEAN
findings: clean — clap definitions / error taxonomy / deny(unsafe_code) crate root
next: none | perf: N/A
*/
//! Error type for the `kasirmu-cli` binary.

use thiserror::Error;

/// Errors that can originate in the `oz` command-line tool.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum CliError {
    /// A subcommand returned a non-zero status.
    #[error("subcommand `{0}` failed: {1}")]
    Subcommand(&'static str, String),

    /// The local database could not be opened.
    #[error("could not open database: {0}")]
    OpenDatabase(#[from] rusqlite::Error),

    /// Bad command-line arguments.
    #[error("invalid arguments: {0}")]
    Args(String),
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
