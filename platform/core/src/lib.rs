/*
last audited DD-MM-YY by DSH-Agent
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

pub mod auth;
pub mod database;
pub mod error;
pub mod permission_registry;
pub mod rbac;
pub mod settings;
pub mod terminal_profile;

pub use database::StoreDatabaseManager;
pub use error::PlatformError;
