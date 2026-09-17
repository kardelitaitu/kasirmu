/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice A)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: pure re-export shim of kasirmu-crypto — inherits findings CRY-1..8 (static-key derivability HIGH, fails-open passthrough, unsalted KDF) until fixed at the source crate
next: none here | perf: N/A
*/
//! Cryptographic helpers for encrypting sensitive data at rest.
//!
//! This module re-exports the standalone [`kasirmu_crypto`] crate for backward
//! compatibility. All functions and types live in `kasirmu-crypto` which can be
//! depended on by `platform-core` without creating a cyclic dependency.

// Re-export the entire public API from kasirmu-crypto.
pub use kasirmu_crypto::*;
