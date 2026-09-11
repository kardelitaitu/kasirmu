//! Typed topology model: node/wire payloads, enums, and resilient serde.
//!
//! Extracted from commands/topology.rs so the command module stays under the
//! ~3k-line guideline. `pub(crate)` marks items that sibling modules or the
//! tests reach through the topology root's re-exports.
//!
//! Wave E (E9a-a): the items themselves moved to
//! `oz_bridge::topology::model`; this module is the re-export shim that keeps
//! `commands::topology::model::*` and the mounted test file resolving.

pub use oz_bridge::topology::model::*;
