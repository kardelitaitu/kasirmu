//! Semantic validation engine for the topology graph (pure JSON/Value logic).
//!
//! Validates nodes/wires as serde_json values against the shared semantics
//! contract (topologySemantics.json) and the ADR #34 typed-connection gates.
//! Includes the apply-key/revision/fingerprint/ledger JSON helpers, which are
//! value-level and deliberately Tauri-free. Extracted from
//! commands/topology.rs.
//!
//! Wave E (E9c): the bodies moved to `oz_bridge::topology::semantics`; this
//! module is the re-export shim. Both `oz_core::topology` blocks stay here
//! because they are a re-export device, not an import: sibling desktop
//! modules call `value_string` and friends through this namespace, and the
//! topology root `cfg(test)` globs consume the test-only trio.

// The pure semantic-validation core lives in oz_core::topology (shared
// domain contract); this module re-exports the value-level helpers the
// desktop layers consume and adapts validate_semantic_json's CoreError
// onto the AppError::TopologyValidation wire shape.
// Wave E step d retired has_semantic_fields, semantic_node_type and value_string
// from this relay: their only desktop consumer was persistence, whose bodies now
// live in the bridge and import them from oz_core directly. Both builds were
// measured before deleting them, and the two names still needed -
// semantic_branch_profile_id by commands.rs, is_warehouse_operational_input_port
// by the test build - are kept, the second under cfg(test).
pub(crate) use oz_core::topology::semantic_branch_profile_id;
// Test-only consumers (the test modules glob semantics::* directly); kept
// out of the library re-export so the lib build has no unused imports.
#[cfg(test)]
pub(crate) use oz_core::topology::{
    is_warehouse_operational_input_port, is_warehouse_primary_input_port,
    shared_semantic_pairing_contains, shared_topology_semantics,
};

pub use oz_bridge::topology::semantics::*;
