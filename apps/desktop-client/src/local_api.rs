//! Desktop re-export shim for the `oz-local-api` loopback REST API server.
//!
//! The implementation moved verbatim to `crates/kasirmu-local-api` (Agent 1,
//! Phase 1.2) so the server can be started from a headless binary without
//! pulling in the Tauri shell. This module exists only so the pre-existing
//! `crate::local_api::…` call sites in `lib.rs` and
//! `commands/local_api.rs` keep resolving unchanged; new code should
//! depend on `oz_local_api` directly.

pub use oz_local_api::*;
