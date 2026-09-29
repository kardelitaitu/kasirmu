/*
last audited (date unknown) by DSH-Agent
crate: kasirmu-plugin | status: SAFE | lint: CLEAN
findings: 0 actual unsafe blocks (risk sweep counted comment text — strict regex confirms none; no #[allow(unsafe_code)] anywhere). Only production expect is db.rs sql_regex — documented RUST-07 invariant (compile-time literals verified by sql_validation_regexes_compile at CI). PluginDb namespace-isolated SQL via compiled regexes; PluginManager sandboxes Lua via kasirmu-lua LuaRuntime (Send+Sync, mutex-guarded). All 258 unwrap/expect confined to tests.
next: none — crate stable | perf: SQL validation uses compiled regexes — negligible overhead
*/

//! Plugin discovery, loading, and sandboxing.
//!
//! Plugins are Lua scripts packaged with a `plugin.toml` manifest.
//! They are loaded from the `plugins/` directory at startup and
//! given access to a sandboxed Lua environment.

#![deny(unsafe_code)]

/// Database types for plugin persistence.
pub mod db;
/// Plugin error types.
pub mod error;
/// Operator grant store for plugin permissions (C2 / D7).
pub mod grants;
/// Plugin loading and scanning.
pub mod loader;
/// Runtime plugin manager with Lua sandbox.
pub mod manager;
/// Plugin manifest (`plugin.toml`) deserialization.
pub mod manifest;
/// Plugin package format (.ozp) handling.
pub mod package;
/// Plugin signature verification (C2 / D7).
pub mod signature;

pub use error::PluginError;
pub use grants::{PluginGrants, ungranted};
pub use loader::{LoadedPlugin, PluginRegistry, hash_plugin_set, load_plugins};
pub use manager::PluginManager;
pub use manifest::PluginManifest;
