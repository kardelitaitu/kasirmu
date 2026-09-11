//! Typed topology model: node/wire payloads, enums, and resilient serde.
//!
//! Ported verbatim from `apps/desktop-client/src/commands/topology/model.rs`
//! (Wave E step E9a-a) as the first leaf of the `oz_bridge::topology` mirror
//! of that group; the desktop module re-exports this surface so every path it
//! already answers stays reachable. `pub` marks items that sibling bridge
//! modules, the desktop re-export chain, or the desktop's mounted tests reach.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Serialised topology persisted in the settings table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyData {
    /// Nodes in the topology graph (stores, workspaces, warehouses, hardware).
    pub nodes: Vec<TopologyNodePayload>,
    /// Wires (edges) connecting nodes in the topology graph.
    pub wires: Vec<TopologyWirePayload>,
}

// ── Serde helpers for resilience ─────────────────────────────────

/// Serialise an f64, replacing NaN/Infinity with `0.0`.
///
/// serde_json (default) serialises non-finite floats as JSON `null`,
/// which cannot roundtrip back to `f64`.  This guard prevents the
/// entire topology from being poisoned by a single bad coordinate.
pub fn ser_f64_finite<S>(val: &f64, s: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    s.serialize_f64(if val.is_finite() { *val } else { 0.0 })
}

/// Deserialise an f64, mapping JSON `null` to `0.0`.
pub fn de_f64_or_null<'de, D>(d: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum F64ish {
        Num(f64),
        Null,
    }
    match F64ish::deserialize(d)? {
        F64ish::Num(n) => Ok(n),
        F64ish::Null => Ok(0.0),
    }
}

/// Deserialise a `String`, mapping JSON `null` to the default direction.
///
/// `#[serde(default)]` only kicks in when the field is *absent*, not
/// when it is explicitly `null`.  This helper covers the `null` case.
pub fn de_direction_or_null<'de, D>(d: D) -> Result<WireDirection, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Dir {
        Some(WireDirection),
        Null,
    }
    match Dir::deserialize(d)? {
        Dir::Some(s) => Ok(s),
        Dir::Null => Ok(default_direction()),
    }
}

// ── Data types ───────────────────────────────────────────────────

/// Valid node types in the topology graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeType {
    /// Retail store branch.
    Store,
    /// POS / register workspace.
    Workspace,
    /// Warehouse / storage location.
    Warehouse,
    /// Printer or peripheral hardware.
    Hardware,
    /// Catch-all for unknown/corrupt node types — rejected on save.
    #[serde(other)]
    Unknown,
}

impl PartialEq<&str> for NodeType {
    fn eq(&self, other: &&str) -> bool {
        match self {
            NodeType::Store => *other == "store",
            NodeType::Workspace => *other == "workspace",
            NodeType::Warehouse => *other == "warehouse",
            NodeType::Hardware => *other == "hardware",
            NodeType::Unknown => false,
        }
    }
}

impl From<&str> for NodeType {
    fn from(s: &str) -> Self {
        match s {
            "store" => NodeType::Store,
            "workspace" => NodeType::Workspace,
            "warehouse" => NodeType::Warehouse,
            "hardware" => NodeType::Hardware,
            _ => NodeType::Unknown,
        }
    }
}

/// Valid wire directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WireDirection {
    /// One-directional flow (single arrow).
    OneWay,
    /// Bidirectional flow (arrows on both ends).
    TwoWay,
    /// Right-to-left flow (arrow on the from end).
    Reverse,
    /// Catch-all for unknown/corrupt directions — rejected on save.
    #[serde(other)]
    Unknown,
}

impl PartialEq<&str> for WireDirection {
    fn eq(&self, other: &&str) -> bool {
        match self {
            WireDirection::OneWay => *other == "one-way",
            WireDirection::TwoWay => *other == "two-way",
            WireDirection::Reverse => *other == "reverse",
            WireDirection::Unknown => false,
        }
    }
}

impl From<&str> for WireDirection {
    fn from(s: &str) -> Self {
        match s {
            "one-way" => WireDirection::OneWay,
            "two-way" => WireDirection::TwoWay,
            "reverse" => WireDirection::Reverse,
            _ => WireDirection::Unknown,
        }
    }
}

/// Valid port names on a topology node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PortName {
    /// Top edge of the node card.
    Top,
    /// Right edge of the node card.
    Right,
    /// Bottom edge of the node card.
    Bottom,
    /// Left edge of the node card.
    Left,
    /// Catch-all for unknown/corrupt port names — rejected on save.
    #[serde(other)]
    Unknown,
}

impl PartialEq<&str> for PortName {
    fn eq(&self, other: &&str) -> bool {
        match self {
            PortName::Top => *other == "top",
            PortName::Right => *other == "right",
            PortName::Bottom => *other == "bottom",
            PortName::Left => *other == "left",
            PortName::Unknown => false,
        }
    }
}

impl From<&str> for PortName {
    fn from(s: &str) -> Self {
        match s {
            "top" => PortName::Top,
            "right" => PortName::Right,
            "bottom" => PortName::Bottom,
            "left" => PortName::Left,
            _ => PortName::Unknown,
        }
    }
}

/// One node in the topology graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyNodePayload {
    /// Unique identifier for the node (e.g. "store-1", "ws-main").
    pub id: String,
    /// Node kind: store, workspace, warehouse, or hardware.
    #[serde(rename = "type")]
    pub node_type: NodeType,
    /// Display name shown on the topology card.
    pub name: String,
    /// Optional subtitle shown below the name.
    #[serde(default)]
    pub subtitle: Option<String>,
    /// X-coordinate of the node on the canvas.
    #[serde(serialize_with = "ser_f64_finite", deserialize_with = "de_f64_or_null")]
    pub x: f64,
    /// Y-coordinate of the node on the canvas.
    #[serde(serialize_with = "ser_f64_finite", deserialize_with = "de_f64_or_null")]
    pub y: f64,
    /// Minimum license tier required to use this node (e.g. "pro").
    #[serde(default)]
    pub tier_requirement: Option<String>,
    /// Badge text shown on the node card (e.g. "Online", "2 POS").
    #[serde(default)]
    pub telemetry_badge: Option<String>,
    /// Status indicator: "online", "offline", or "warning".
    #[serde(default)]
    pub telemetry_status: Option<String>,
    /// Arbitrary JSON metadata (address, region, model, capacity, etc.).
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// One wire connecting two ports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyWirePayload {
    /// Unique identifier for this wire.
    pub id: String,
    /// Node ID that the wire originates from.
    pub from_node_id: String,
    /// Node ID that the wire connects to.
    pub to_node_id: String,
    /// Direction: one-way (default), two-way, or reverse.
    #[serde(default = "default_direction")]
    #[serde(deserialize_with = "de_direction_or_null")]
    pub direction: WireDirection,
    /// Optional label displayed along the wire.
    #[serde(default)]
    pub label: Option<String>,
    /// Source port anchor point (e.g. left, right, top, bottom).
    #[serde(default)]
    pub from_port: Option<PortName>,
    /// Target port anchor point (e.g. left, right, top, bottom).
    #[serde(default)]
    pub to_port: Option<PortName>,
}

/// Default wire direction when the field is absent or explicitly null.
pub fn default_direction() -> WireDirection {
    WireDirection::OneWay
}

// ── Module constants ────────────────────────────────────────────────

/// Settings key for the unscoped (legacy) topology diagram.
pub const TOPOLOGY_SETTING_KEY: &str = "oz-pos/topology";
/// Settings key for the branch-scoped runtime routing plan.
pub const TOPOLOGY_RUNTIME_SETTING_KEY: &str = "oz-pos/topology-runtime";
/// Settings key for the cross-database Apply recovery journal.
pub const TOPOLOGY_APPLY_RECOVERY_KEY: &str = "oz-pos/topology/apply-recovery";
/// Settings-key prefix for one Apply request's revision ledger.
pub const TOPOLOGY_APPLY_REQUEST_PREFIX: &str = "oz-pos/topology/apply-request/";
/// Schema version stamped into every saved topology envelope.
///
/// This is the shape of the **diagram blob** — `{schema_version, nodes, wires}`
/// — and it is enforced on read: `validate_topology_envelope` rejects any stored
/// envelope whose version is not exactly this value. Raising it therefore makes
/// every diagram on disk unreadable, which is a data-availability event, not a
/// version bump. It changes only when the envelope's own structure changes.
pub const TOPOLOGY_SCHEMA_VERSION: u64 = 1;

// Schema version of the vendored **semantics contract** (`topologySemantics.json`).
//
// A different axis from [`TOPOLOGY_SCHEMA_VERSION`], and the two must never be
// conflated: this one describes the pairing table the editor and the backend
// both read (ADR #45 §1 moved it to 2 by giving every row explicit `endpoints`),
// while the envelope version describes the shape of a saved diagram. A
// merchant's existing graph is unaffected by a contract change, so a contract
// bump must not touch the envelope constant, and vice versa. The number itself
// is owned by `oz_core` — re-exported in `topology.rs`, which exists so callers
// assert against one declaration rather than a copy that can drift.
//
// A plain comment rather than `///`: the constant lives in `topology.rs`, so a
// doc comment here attached to nothing. `cargo check` accepts that silently;
// `clippy -D warnings` fails it as "empty line after doc comment", which is how
// this was found.

/// Path segment under a branch's topology key holding its saved diagram
/// templates (ADR #45 §4.2).
///
/// Templates are business configuration: they seed a graph a merchant then
/// edits and Applies. They used to live in `localStorage` under
/// `ozpos.topology.templates.v1`, which loses them on a device change, a
/// profile switch, or a reinstall — and silently, since the list simply comes
/// back empty. They belong in the same settings namespace as the diagram they
/// seed, scoped to the same branch.
pub const TOPOLOGY_TEMPLATE_SEGMENT: &str = "template";

/// Longest accepted template name, in characters. The name is stored inside
/// the settings key, so it is bounded like a key rather than like a label.
pub const MAX_TEMPLATE_NAME_CHARS: usize = 64;

/// Request body for updating a workspace instance within a topology diff.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct UpdateInstanceRequest {
    /// Instance ID to update.
    pub id: String,
    /// New display name.
    pub name: String,
    /// New controlled business purpose, when changed.
    #[serde(default)]
    pub purpose_key: Option<String>,
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod model_tests;

#[cfg(test)]
#[path = "topology_field_tests.rs"]
mod topology_field_tests;

#[cfg(test)]
#[path = "topology_serde_tests.rs"]
mod topology_serde_tests;

#[cfg(test)]
#[path = "topology_stress_tests.rs"]
mod topology_stress_tests;
