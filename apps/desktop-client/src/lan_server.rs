//! Desktop re-export shim for the `oz-lan` LAN event forwarder.
//!
//! The implementation moved verbatim to `crates/oz-lan` (Agent 1,
//! Phase 1.1) so the forwarder can be driven from a headless binary
//! without pulling in the Tauri shell. This module exists only so the
//! pre-existing `crate::lan_server::…` call sites in `lib.rs` keep
//! resolving unchanged; new code should depend on `oz_lan` directly.

pub use oz_lan::*;
