/*
last audited DD-MM-YY by DSH-Agent
crate: oz-cli | status: SAFE | lint: CLEAN
findings: #![deny(unsafe_code)] at crate root — 0 unsafe blocks. Pure CLI orchestration (migrations, backup, export, smoke). 4 production .unwrap() in seed_demo.rs are a dev-only demo-data generator (infallible from_hms_opt with valid ranges; hours/quantity bounds). No defects found.
next: None | perf: CLI runs are ephemeral; no long-lived allocations.
*/
#![deny(unsafe_code)]

//! Command-line tools for OZ-POS — migrations, backup, export, smoke tests.
//!
//! `oz-cli` exposes the maintenance operations a merchant or operator runs
//! from a terminal: `oz migrate`, `oz backup`, `oz export`, `oz smoke`.
//!
//! The library target holds all business logic so `cargo-llvm-cov` can
//! attribute coverage to the crate.

pub mod cli;
pub mod commands;
pub mod error;
pub mod seed_demo;

pub use cli::*;
pub use commands::run;
pub use error::CliError;
