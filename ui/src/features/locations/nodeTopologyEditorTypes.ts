/**
 * Domain types for the topology editor (slice P5-A / S2a): the node and wire
 * shapes, the port / direction / semantic-relationship unions, and the two
 * seed interfaces the load path builds from API rows. Types only — no runtime
 * code and no imports, so nothing here can pull React into an importer.
 *
 * NodeTopologyEditor.tsx re-exports every name below as the deliberate public
 * entry point; new importers should name this module directly.
 */

export type NodeType = 'store' | 'workspace' | 'warehouse' | 'hardware';
export type WorkspaceTypeKey = 'store-pos' | 'restaurant-pos' | 'kds';
/** Visual flow state of a wire, cycled by clicking it.
 *  'one-way' → left-to-right, 'reverse' → right-to-left,
 *  'two-way' → both. The from/to node ownership is unchanged — this is a
 *  presentation layer over the same semantic edge. */
export type WireDirection = 'one-way' | 'reverse' | 'two-way';

export type PortName = 'top' | 'right' | 'bottom' | 'left';

/** Restore-boundary integrity guard for Undo/Redo: drop any wire whose
 *  endpoint nodes are missing from the SAME entry before it lands on the
 *  canvas. Every history entry today is a full pre-mutation snapshot (or
 *  the filtered duplicate-commit entry), so no legitimate entry ever
 *  dangles — this is defense-in-depth so a future creation-path
 *  regression (a dangling wire slipped into state, then into an entry)
 *  can never make Undo/Redo resurrect a wire whose endpoints were since
 *  deleted. A dangling wire cannot render (geometry-gated) and would
 *  immediately surface the unknown-wire-endpoint gate, so dropping it is
 *  the only sane resolution; the canvas invariant stays "every wire's
 *  endpoints exist". */

/** Node types offered by the right-click canvas context menu. */

export type SemanticRelationshipType =
  | 'location'
  | 'stock-routing'
  | 'ticket-routing'
  | 'hardware-connection'
  | 'inventory-transfer'
  | 'generic';

export interface TopologyNodeData {
  id: string;
  type: NodeType;
  name: string;
  subtitle?: string;
  x: number;
  y: number;
  tierRequirement?: 'pro' | 'enterprise';
  telemetryBadge?: string;
  telemetryStatus?: 'online' | 'warning' | 'offline';
  metadata?: Record<string, unknown>;
  /** Stable Branch Location identity when this node is a store alias. */
  storeProfileId?: string;
}

export interface TopologyWireData {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  direction: WireDirection;
  label?: string;
  /** Which port on the source node the wire originates from (default: 'right'). */
  fromPort?: PortName;
  /** Which port on the target node the wire connects to (default: 'left'). */
  toPort?: PortName;
  /** Orthogonal bend points (absolute canvas coords) the wire routes
   *  through, in order from source to target. User-authored geometry that
   *  replaces the auto curve/elbow when present; persisted with the diagram. */
  bends?: Array<{ x: number; y: number }>;
  /** Semantic source port; geometry remains presentation-only. */
  fromPortId?: string;
  /** Semantic target port; geometry remains presentation-only. For nodes
   *  with stacked left inputs (inventory: 'location-in' | 'operation-in'),
   *  this doubles as the slot discriminator — the renderer resolves the
   *  vertical socket from it and the backend round-trips it as to_port_id. */
  toPortId?: string;
  /** Typed relationship represented by this wire. */
  relationshipType?: SemanticRelationshipType;
}

export interface BranchLocationSeed {
  /** Canonical store_profiles.id. */
  id: string;
  /** User-visible location name. */
  name: string;
}

export interface WorkspaceInstanceSeed {
  /** Instance id from workspace_instances — becomes the node id. */
  instanceId: string;
  /** Workspace type key (store-pos, restaurant-pos, kds, warehouse). */
  typeKey: string;
  /** Controlled business purpose, independent from type and instance label. */
  purposeKey?: string;
  /** Canonical Branch Location identity for ownership compilation. */
  storeId?: string;
  /** Branch Location display name used only for presentation. */
  storeName?: string;
  name: string;
  subtitle?: string;
  colour?: string;
}
