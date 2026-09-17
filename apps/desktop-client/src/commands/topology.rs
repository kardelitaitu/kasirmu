//! Tauri commands for persisting the node topology graph.
//!
//! Topology data (nodes + wires) is serialised as JSON and stored in the
//! `settings` table under the key `oz-pos/topology`. On first load, the
//! command returns `None` so the front-end falls back to the built-in
//! retail preset.
//!
//! Module layout (split from one 8.5k-line file to stay under the ~3k-line
//! guideline): `model` (types + serde), `semantics` (JSON validation
//! engine), `persistence` (keys, save/load, Apply recovery), `commands`
//! (the three #[tauri::command] entry points). The root re-exports the
//! public surface (the commands lib.rs registers) and, crate-internally,
//! the whole flat namespace so the split changes no name the tests use.

mod commands;
mod model;
mod persistence;
mod revisions;
mod semantics;

/// Apply a full topology diff atomically.
pub use commands::apply_topology_diff;
/// Capability probe for the topology save button.
pub use commands::can_save_topology;
/// Load the persisted topology graph.
pub use commands::load_topology;
/// Complete a previously interrupted cross-database Apply at startup.
pub use persistence::recover_pending_topology_apply_at_startup;
/// The retention sweep's entry point and its budget, re-exported explicitly
/// rather than through the `cfg(test)` globs below: the daemon in `lib.rs` is
/// the only production caller, and naming the two items keeps the module's
/// production surface legible at a glance.
pub(crate) use revisions::{TOPOLOGY_REVISION_RESTORABLE_KEEP, cleanup_old_topology_revisions};

// Typed model surface (kept pub as before the split).
pub use model::{
    NodeType, PortName, TopologyData, TopologyNodePayload, TopologyWirePayload, WireDirection,
};

// Shared settings key consumed by sibling command modules (pos, kds); the
// model module stays private, only the constant is re-exported so the
// "oz-pos/topology-runtime" string has exactly one definition.
pub(crate) use model::TOPOLOGY_RUNTIME_SETTING_KEY;

// Tauri's #[command] macro generates hidden `__cmd__*` wrapper macros in the
// defining module; the root must re-export them so lib.rs's
// generate_handler![commands::topology::load_topology] can resolve the
// wrapper at the same path as the function. A glob carries the wrappers
// along with the command fns and result types.
pub use commands::*;

// Internal re-exports: the tests resolve the flat namespace through the
// root, so the split preserves every name the test module uses. The
// `commands` glob above already covers the test build (its test-only
// `save_topology` re-exports at pub(crate) visibility), so only the three
// non-command modules need the cfg(test) globs — the library build would
// otherwise warn about unused imports.
#[cfg(test)]
pub(crate) use model::*;
/// The semantics-contract version is owned by `kasirmu_core`, where the evaluator
/// that understands it lives. Re-exported for the test that pins the two
/// version axes apart, so the assertion reads against one declaration rather
/// than a copy that can drift. Test-gated for the same reason as the globs
/// above: the library build would otherwise warn about an unused import.
#[cfg(test)]
pub(crate) use kasirmu_core::topology::TOPOLOGY_CONTRACT_SCHEMA_VERSION;
#[cfg(test)]
pub(crate) use persistence::*;
#[cfg(test)]
#[cfg(test)]
pub(crate) use semantics::*;

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod topology_command_tests;
#[cfg(test)]
mod topology_serde_tests;
#[cfg(test)]
mod topology_stress_tests;
#[cfg(test)]
mod topology_tests;
