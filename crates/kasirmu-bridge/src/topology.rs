//! Topology bridge module (Wave E).
//!
//! Mirrors `apps/desktop-tauri/src/commands/topology/` so every `super::`
//! path inside a moved file stays valid exactly as written: the children are
//! declared here, in this module root, and not in the crate's `lib.rs`.
//!
//! Landing order follows the dependency chain model <- semantics <- revisions
//! <- persistence <- commands. This step carries `model` only; the rest of the
//! chain arrives in its own commit.

pub mod commands;
pub mod model;
pub mod persistence;
pub mod revisions;
pub mod semantics;
