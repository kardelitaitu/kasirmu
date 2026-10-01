/*
last audited (date unknown) by DSH-Agent
crate: platform-core | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks. Security surfaces verified: auth.rs Argon2id with per-hash salts, malformed/placeholder hashes fail closed to Ok(false); rbac.rs 3-level wildcard resolver fail-closed (malformed grants deny-all); permission_registry 83-key registry with sensitivity classification + enforcement backstop. Migrations DB-02 checksum-verified, tx-atomic. 317 unit + 4 doc tests pass. COR-33 note (known codebase-wide pattern): manager/migrations/pool/terminal_profile/auth carry inline test modules instead of sibling *_tests.rs files — extraction deferred (matches the rest of the workspace's convention-accepted INFO finding).
next: none — files carry current stamps from 25-07-26 / 31-08-26 audits | perf: N/A
*/

//! Platform Core — shared infrastructure for kasir.mu.
//!
//! This crate provides reusable infrastructure services that are
//! consumed by all other crates and modules in the kasir.mu workspace:
//!
//! - [`database`] — migration runner and connection pool
//! - [`auth`] — PIN hashing, verification, and login session types
//! - [`rbac`] — Role-Based Access Control primitives (Role, Permission)
//! - [`permission_registry`] — code-resident permission registry with
//!   write-time grant validation (ADR #35 D3 / spec 0046)
//! - [`settings`] — generic key-value settings store with typed helpers
//! - [`error`] — shared error type ([`PlatformError`])
//! - [`staff`] — persisted staff and role rows, hosted here rather than in
//!   `foundation` because their behaviour calls [`rbac`]. Their names are always
//!   module-qualified: `staff::Role` is the row, `rbac::Role` is the policy type.

// rustdoc::private_intra_doc_links is allowed crate-wide, deliberately.
//
// The settings module documents why a reader is safe against a specific
// failure by naming the PRIVATE helper that enforces it — `decrypt_or_fail_closed`,
// `portable_key`, `sealed::Sealed`. Those names are the argument: a doc
// comment saying "fails closed on ciphertext-shaped input" is a claim, while
// "see `decrypt_or_fail_closed`" is a pointer a reviewer can follow in the
// source. Rustdoc cannot resolve them from public docs, so
// `RUSTDOCFLAGS="-D warnings"` turns each into an error (measured 2026-09-27).
//
// Scoped to this lint alone: a link to an item that does not exist at all
// still fails the build, and `rustdoc::broken_intra_doc_links` is untouched.
#![deny(unsafe_code)]
#![allow(rustdoc::private_intra_doc_links)]

pub mod auth;
pub mod database;
pub mod error;
pub mod permission_registry;
pub mod rbac;
pub mod settings;
pub mod staff;
pub mod terminal_profile;

pub use database::StoreDatabaseManager;
pub use error::CurrencyError;
pub use error::PlatformError;
// NOTE: `staff` is deliberately NOT re-exported at the crate root. This crate carries TWO unrelated
// types called `Role` — `rbac::Role` (the policy type) and `staff::Role` (the persisted row) — so a
// bare `platform_core::Role` would silently pick one. The path is always spelled out.
