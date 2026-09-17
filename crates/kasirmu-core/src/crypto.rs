/*
last audited 25-07-26 by RSA-Agent (oz-core slice A)
crate: oz-core | status: SAFE | lint: CLEAN
findings: pure re-export shim of oz-crypto — inherits findings CRY-1..8 (static-key derivability HIGH, fails-open passthrough, unsalted KDF) until fixed at the source crate
next: none here | perf: N/A
*/
//! Cryptographic helpers for encrypting sensitive data at rest.
//!
//! This module re-exports the standalone [`oz_crypto`] crate for backward
//! compatibility. All functions and types live in `oz-crypto` which can be
//! depended on by `platform-core` without creating a cyclic dependency.

// Re-export the entire public API from oz-crypto.
pub use oz_crypto::*;
