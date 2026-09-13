/**
 * Domain types for the topology editor (slice P5-A / S2a): the node and wire
 * shapes, the port / direction unions, and the two seed interfaces the load
 * path builds from API rows. Types only — no runtime code and no runtime
 * imports (the one type-only re-export edge to the contract is erasable under
 * isolatedModules), so nothing here can pull React into an importer.
 *
 * NodeTopologyEditor.tsx re-exports every name below as the deliberate public
 * entry point; new importers should name this module directly.
 */

/** Node types offered by the right-click canvas context menu. */
export type NodeType = 'store' | 'workspace' | 'warehouse' | 'hardware';
export type WorkspaceTypeKey = 'store-pos' | 'restaurant-pos' | 'kds';
/** Visual flow state of a wire, cycled by clicking it.
 *  'one-way' → left-to-right, 'reverse' → right-to-left,
 *  'two-way' → both. The from/to node ownership is unchanged — this is a
 *  presentation layer over the same semantic edge. */
export type WireDirection = 'one-way' | 'reverse' | 'two-way';

/** Connection points a node exposes for wire attachment, listed clockwise.
 *  The semantic contract's port vocabulary is keyed by these names. */
export type PortName = 'top' | 'right' | 'bottom' | 'left';

// Type-only contract edge: the canonical home of this ADR union is the
// semantic contract (topologyContract.ts). The import binds the name for the
// wire shape below; the re-export keeps the editor's import surface unchanged
// without duplicating the union.
import type { SemanticRelationshipType } from './topologyContract';

export type { SemanticRelationshipType };

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
