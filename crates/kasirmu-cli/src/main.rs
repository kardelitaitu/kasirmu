/*
last audited 25-07-26 by RSA-Agent (oz-cli slice B: verified)
crate: oz-cli | status: SAFE | lint: CLEAN
findings: clean — clap definitions / error taxonomy / deny(unsafe_code) crate root
next: none | perf: N/A
*/
//! `oz` command-line binary entry point.
//!
//! Delegates to `kasirmu_cli::run`, which parses the clap command tree and
//! dispatches to the migration, backup, export, and smoke-test subcommands.
//! Errors propagate as `anyhow::Result` so the process exit code reflects
//! failure without a manual `std::process::exit`.

use anyhow::Result;

fn main() -> Result<()> {
    kasirmu_cli::run()
}
