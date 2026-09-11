//! Settings store — typed access to a key-value settings table.
//!
//! The [`Settings`] struct provides read/write helpers for a generic
//! `settings` table (`key TEXT PRIMARY KEY, value TEXT`). All methods
//! take a `&rusqlite::Connection` so callers control transaction
//! boundaries.

/// Typed access to a key-value `settings` table.
pub struct Settings;

mod raw;
mod typed;

pub mod keys;

// The sealed ingest policy is declared in the private `raw` module because it
// belongs beside the accessors that enforce it, but it must be NAMEABLE from
// outside this crate or no lane can convert to the funnel. Re-exporting the
// three items is enough: `raw` itself stays private, so the delta-ledger and
// transaction internals do not become public surface.
pub use raw::{IngestPolicy, IngestPolicyKind, is_manager_owned_key};

#[cfg(test)]
mod split_tests;

/// Test-only helpers shared across `settings` test modules.
#[cfg(test)]
mod test_helpers;

#[cfg(test)]
mod tests;
