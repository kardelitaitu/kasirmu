import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import topologySemantics from './topologySemantics.json';
import { isSemanticWireCompatible, nodeKindToken, pairingAdmitsKinds } from './topologyCard';
import type { SemanticPortId } from './topologyCard';

type TopologyNodeInput = TopologyNodeData & { storeProfileId?: string };
type TopologyWireInput = TopologyWireData & {
  fromPortId?: string;
  toPortId?: string;
  relationshipType?: SemanticRelationshipType;
};


/** Version of the semantic topology contract understood by this client. */
export const TOPOLOGY_SCHEMA_VERSION = topologySemantics.schemaVersion;

/** Warehouse inputs are deliberately split into primary ownership scope and
 * operational routing. Stock/transfer feeds never satisfy the one-of primary
 * ownership rule, even though all four inputs share the visual left rail. */
export const WAREHOUSE_PRIMARY_INPUT_PORTS = topologySemantics.warehouse.primaryInputs as unknown as readonly ['location-in', 'operation-in'];
export const WAREHOUSE_OPERATIONAL_INPUT_PORTS = topologySemantics.warehouse.operationalInputs as unknown as readonly ['stock-in', 'transfer-in'];
export type WarehousePrimaryInputPort = (typeof WAREHOUSE_PRIMARY_INPUT_PORTS)[number];
export type WarehouseOperationalInputPort = (typeof WAREHOUSE_OPERATIONAL_INPUT_PORTS)[number];
export const isWarehousePrimaryInputPort = (portId?: string): portId is WarehousePrimaryInputPort =>
  WAREHOUSE_PRIMARY_INPUT_PORTS.includes(portId as WarehousePrimaryInputPort);
export const isWarehouseOperationalInputPort = (portId?: string): portId is WarehouseOperationalInputPort =>
  WAREHOUSE_OPERATIONAL_INPUT_PORTS.includes(portId as WarehouseOperationalInputPort);

/** Stable occurrence key for a per-node validation issue. Shared by the
 *  editor (mark-issue-resolved) and the screen's Apply gate so a dismissed
 *  issue is identified identically in both — the round-81 "intentionally
 *  empty" bypass reads the same store both sides write. */
export const topologyIssueKey = (nodeId: string, messageId: string) => `node:${nodeId}:${messageId}`;

/** Whether a workspace instance participates in the store topology canvas.
 *  The 'admin' instance is a system workspace surfaced automatically for
 *  owner/manager roles — it is app management, not a routing endpoint, so it
 *  must never seed the canvas (nor reach the save sweep's archive, or it
 *  would be archived on every Apply). Inventory Management workspaces are
 *  likewise excluded: the topology's storage concept is the Warehouse node,
 *  and two storage-flavored cards on one canvas confused users.
 *
 *  Single source of truth for BOTH the screen's load path and the Apply
 *  refresh — the two previously drifted (one exclusion-based, one allowlist
 *  that leaked 'admin' back onto the canvas after a save). */
export const isTopologyInstance = (w: { type_key: string }): boolean =>
  w.type_key !== 'admin' && w.type_key !== 'inventory';

/** Closed node kinds used by the first ownership slice. */
export type SemanticNodeKind = 'branch-location' | 'workspace' | 'warehouse' | 'hardware';

/** Closed relationship types introduced by the topology ADR. */
export type SemanticRelationshipType =
  | 'location'
  | 'stock-routing'
  | 'ticket-routing'
  | 'hardware-connection'
  | 'inventory-transfer'
  | 'generic';

/** Direction of a semantic port. */
export type SemanticPortDirection = 'input' | 'output';

/** A semantic port definition, independent of canvas geometry. */
export interface SemanticPortDefinition {
  id: string;
  labelId: string;
  direction: SemanticPortDirection;
  relationshipType: SemanticRelationshipType;
  required: boolean;
  cardinality: 'one' | 'many';
  /** Distinguishes ownership scope from operational routing on warehouses. */
  role?: 'primary-scope' | 'operational-routing';
}

/** Node definition for the first semantic ownership graph. */
export interface SemanticNodeDefinition {
  kind: SemanticNodeKind;
  ports: readonly SemanticPortDefinition[];
}

/** Stable semantic node in a normalized graph. */
export interface SemanticTopologyNode {
  id: string;
  kind: SemanticNodeKind;
  /** Canonical store_profiles.id for a Branch Location when known. */
  storeProfileId?: string;
  /** Technical workspace template key, when the node is a workspace. */
  typeKey?: string;
  /** Controlled business purpose, independent from type and instance label. */
  purposeKey?: string;
  /** Design-time warehouse stock state (diagram metadata, rounds 70-71). */
  stock?: number;
  /** Design-time warehouse capacity — stock may not exceed it. */
  capacity?: number;
  /** Design-time warehouse low-stock threshold. */
  lowStockThreshold?: number;
}

/** Stable semantic wire in a normalized graph. */
export interface SemanticTopologyWire {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  relationshipType: SemanticRelationshipType;
  direction: 'one-way' | 'reverse' | 'two-way';
  /** True when semantic fields were inferred from the legacy geometric graph. */
  legacyInferred: boolean;
}

/** Versioned graph envelope used by client validation and Apply preparation. */
export interface SemanticTopologyGraph {
  schemaVersion: number;
  nodes: SemanticTopologyNode[];
  wires: SemanticTopologyWire[];
}

/** Structured, localizable validation failure. */
export interface TopologyValidationError {
  code:
    | 'unsupported-schema-version'
    | 'warehouse-tier-limit'
    | 'multiple-branch-locations'
    | 'missing-branch-location'
    | 'branch-location-missing-identity'
    | 'duplicate-node'
    | 'invalid-purpose'
    | 'missing-location-input'
    | 'multiple-location-inputs'
    | 'missing-operation-input'
    | 'multiple-operation-inputs'
    | 'invalid-operation-source'
    | 'missing-warehouse-input'
    | 'multiple-warehouse-inputs'
    | 'invalid-warehouse-operation-source'
    | 'multiple-ticket-inputs'
    | 'invalid-semantic-connection'
    | 'ambiguous-legacy-wire'
    | 'cycle-detected'
    | 'invalid-location-connection'
    | 'duplicate-wire'
    | 'unknown-wire-endpoint'
    | 'warehouse-at-capacity'
    | 'warehouse-missing-stock-routing';
  messageId: string;
  nodeId?: string;
  wireId?: string;
  portId?: string;
}

/** The canonical Branch Location definition. `store` is its legacy alias. */
export const BRANCH_LOCATION_DEFINITION: SemanticNodeDefinition = {
  kind: 'branch-location',
  ports: [
    {
      id: 'location-out',
      labelId: 'topology-port-location-out',
      direction: 'output',
      relationshipType: 'location',
      required: true,
      cardinality: 'many',
    },
  ],
};

/** Every workspace type shares this required ownership input. */
/** Controlled business purposes. Keys are persisted; labels are localized. */
export const WORKSPACE_PURPOSES = {
  // Inventory Management workspaces were removed from the topology (round
  // 67) — the warehouse node is the single storage concept — so 'inventory'
  // is no longer a legal typeKey for any purpose. A legacy inventory node
  // now fails the invalid-purpose check until it is dropped/cleaned.
  general: { typeKeys: ['store-pos', 'restaurant-pos', 'kds', 'warehouse'] as const, labelId: 'topology-purpose-general' },
  checkout: { typeKeys: ['store-pos'] as const, labelId: 'topology-purpose-checkout' },
  returns: { typeKeys: ['store-pos'] as const, labelId: 'topology-purpose-returns' },
  'dining-room': { typeKeys: ['restaurant-pos'] as const, labelId: 'topology-purpose-dining-room' },
  'kitchen-hot-line': { typeKeys: ['kds'] as const, labelId: 'topology-purpose-kitchen-hot-line' },
  'stock-control': { typeKeys: ['warehouse'] as const, labelId: 'topology-purpose-stock-control' },
  receiving: { typeKeys: ['warehouse'] as const, labelId: 'topology-purpose-receiving' },
} as const;

/** Every workspace type shares this required ownership input. */
export const WORKSPACE_DEFINITION: SemanticNodeDefinition = {
  kind: 'workspace',
  ports: [
    {
      id: 'location-in',
      labelId: 'topology-port-location-in',
      direction: 'input',
      relationshipType: 'location',
      required: true,
      cardinality: 'one',
    },
  ],
};

/** Operational storage node definition. A Stock Room has one primary
 *  inbound scope: Branch Location or Retail POS Operation. Stock/transfer
 *  routes remain operational compatibility ports and do not replace that
 *  primary relationship. */
export const WAREHOUSE_DEFINITION: SemanticNodeDefinition = {
  kind: 'warehouse',
  ports: [
    {
      id: 'location-in',
      labelId: 'topology-port-location-in',
      direction: 'input',
      relationshipType: 'location',
      required: false,
      cardinality: 'one',
      role: 'primary-scope',
    },
    {
      id: 'operation-in',
      labelId: 'topology-port-operation-in',
      direction: 'input',
      relationshipType: 'generic',
      required: false,
      cardinality: 'one',
      role: 'primary-scope',
    },
  ],
};

/** Operational hardware node definition; ownership is not implied. */
export const HARDWARE_DEFINITION: SemanticNodeDefinition = {
  kind: 'hardware',
  ports: [],
};

/** Closed first-slice registry. Unknown node kinds are not accepted: they
 *  fold to workspace in nodeKind so ownership validation surfaces them. */
export const SEMANTIC_NODE_DEFINITIONS: Readonly<Record<SemanticNodeKind, SemanticNodeDefinition>> = {
  'branch-location': BRANCH_LOCATION_DEFINITION,
  workspace: WORKSPACE_DEFINITION,
  warehouse: WAREHOUSE_DEFINITION,
  hardware: HARDWARE_DEFINITION,
};

function nodeKind(node: TopologyNodeInput): SemanticNodeKind {
  // `store` is deliberately accepted only as a serialized compatibility alias.
  if (node.type === 'store') return 'branch-location';
  // Closed registry: an unknown type (manual edit, stale JSON) must not
  // flow into the semantic graph as an opaque kind — validateTopologyGraph
  // only checks branch-location and workspace, so an unknown kind would
  // silently pass AND round-trip to Apply. Folding to the most common kind
  // makes the ownership checks surface it (missing-location-input) instead.
  // NOTE: the final return below is a runtime-only path — node.type is
  // typed as the closed NodeType union, so TypeScript narrows the three
  // legal kinds away; only corrupt runtime data reaches the fold.
  if (node.type === 'workspace' || node.type === 'warehouse' || node.type === 'hardware') {
    return node.type;
  }
  return 'workspace';
}

function metadataString(node: TopologyNodeInput, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metadataNumber(node: TopologyNodeInput, key: string): number | undefined {
  const value = node.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The closed set of legal relationship types (mirrors SemanticRelationshipType).
 *  Used to quarantine corrupt values at the contract boundary — a garbage
 *  string (manual edit, stale JSON) must never flow into the semantic graph. */
const RELATIONSHIP_TYPES = new Set<SemanticRelationshipType>([
  'location',
  'stock-routing',
  'ticket-routing',
  'hardware-connection',
  'inventory-transfer',
  'generic',
]);

/** The closed set of legal semantic port ids — the SemanticPortId union
 *  from topologyCard.ts (the single source of truth, imported as a type so
 *  the whitelist cannot drift) plus two contract-internal placeholders for
 *  fully-unknown legacy wires. Corrupt ids must never reach consumers — the
 *  renderer matches wires to sockets by port id, and validation switches on
 *  'location-out'/'location-in'. */
const SEMANTIC_PORT_IDS: ReadonlySet<string> = new Set<SemanticPortId | 'legacy-out' | 'legacy-in'>([
  'location-out',
  'location-in',
  'operation-out',
  'operation-in',
  'stock-out',
  'stock-in',
  'transfer-out',
  'transfer-in',
  'ticket-out',
  'ticket-in',
  'device-out',
  'generic-in',
  'generic-out',
  // Contract-internal placeholders for fully-unknown legacy wires.
  'legacy-out',
  'legacy-in',
]);

function isLegalPortId(value: string | undefined): value is string {
  return value !== undefined && SEMANTIC_PORT_IDS.has(value);
}

function inferredWire(
  wire: TopologyWireInput,
  fromNode: SemanticTopologyNode | undefined,
  toNode: SemanticTopologyNode | undefined,
): Pick<SemanticTopologyWire, 'fromPortId' | 'toPortId' | 'relationshipType' | 'legacyInferred'> {
  // The early-return only trusts well-formed semantic fields: port ids
  // must be members of the closed SemanticPortId union and the type a
  // member of SemanticRelationshipType. Corrupt values (manual edits,
  // stale JSON) are treated like missing ones: fall through to legacy
  // inference, which re-derives the legal fields from node identity
  // instead of letting a garbage string flow into the semantic graph.
  if (
    isLegalPortId(wire.fromPortId)
    && isLegalPortId(wire.toPortId)
    && RELATIONSHIP_TYPES.has(wire.relationshipType as SemanticRelationshipType)
  ) {
    return {
      fromPortId: wire.fromPortId,
      toPortId: wire.toPortId,
      relationshipType: wire.relationshipType!,
      legacyInferred: false,
    };
  }

  // Legacy geometric Store -> Workspace edges are migrated by node identity,
  // never by proximity or by the old right/left anchor names.
  if (fromNode?.kind === 'branch-location' && toNode?.kind === 'workspace') {
    return {
      fromPortId: 'location-out',
      toPortId: 'location-in',
      relationshipType: 'location',
      legacyInferred: true,
    };
  }

  // Older diagrams stored only geometry for workspace-to-workspace wires.
  // Preserve the Restaurant POS → KDS operational relationship from the
  // stable workspace type keys instead of folding it to legacy-out/legacy-in;
  // otherwise the KDS appears connected but still reports a missing
  // Operation In requirement after reload.
  if (
    fromNode?.kind === 'workspace'
    && fromNode.typeKey === 'restaurant-pos'
    && toNode?.kind === 'workspace'
    && toNode.typeKey === 'kds'
  ) {
    return {
      fromPortId: 'operation-out',
      toPortId: 'operation-in',
      relationshipType: 'generic',
      legacyInferred: true,
    };
  }

  if (fromNode?.kind === 'branch-location' && toNode?.kind === 'warehouse') {
    return {
      fromPortId: 'location-out',
      toPortId: 'location-in',
      relationshipType: 'location',
      legacyInferred: true,
    };
  }

  if (fromNode?.kind === 'workspace' && toNode?.kind === 'warehouse') {
    return {
      // Same closed-union discipline: a truthy-but-corrupt port or type
      // folds to the identity-derived default, never the garbage value.
      fromPortId: isLegalPortId(wire.fromPortId) ? wire.fromPortId : 'stock-out',
      toPortId: isLegalPortId(wire.toPortId) ? wire.toPortId : 'stock-in',
      relationshipType: RELATIONSHIP_TYPES.has(wire.relationshipType as SemanticRelationshipType)
        ? wire.relationshipType!
        : 'stock-routing',
      legacyInferred: true,
    };
  }

  return {
    fromPortId: isLegalPortId(wire.fromPortId) ? wire.fromPortId : 'legacy-out',
    toPortId: isLegalPortId(wire.toPortId) ? wire.toPortId : 'legacy-in',
    // Same closed-union discipline as the early return: a truthy but
    // corrupt type still folds to the last-resort default.
    relationshipType: RELATIONSHIP_TYPES.has(wire.relationshipType as SemanticRelationshipType)
      ? wire.relationshipType!
      : 'generic',
    legacyInferred: true,
  };
}

/**
 * Convert the current editor model into the versioned semantic graph.
 *
 * Missing semantic fields are treated as legacy data and normalized from node
 * identity. Geometric `top/right/bottom/left` values are intentionally not
 * consulted for ownership meaning.
 */
export function normalizeTopologyGraph(
  nodes: TopologyNodeInput[],
  wires: TopologyWireInput[],
  schemaVersion = TOPOLOGY_SCHEMA_VERSION,
): SemanticTopologyGraph {
  const semanticNodes = nodes.map((node): SemanticTopologyNode => {
    const kind = nodeKind(node);
    const semanticNode: SemanticTopologyNode = {
      id: node.id,
      kind,
    };
    const storeProfileId = node.storeProfileId ?? metadataString(node, 'storeProfileId');
    const typeKey = metadataString(node, 'typeKey');
    const purposeKey = metadataString(node, 'purposeKey') ?? (kind === 'workspace' ? 'general' : undefined);
    if (storeProfileId !== undefined) semanticNode.storeProfileId = storeProfileId;
    if (typeKey !== undefined) semanticNode.typeKey = typeKey;
    if (purposeKey !== undefined) semanticNode.purposeKey = purposeKey;
    const stock = metadataNumber(node, 'stock');
    const capacity = metadataNumber(node, 'capacity');
    const lowStockThreshold = metadataNumber(node, 'lowStockThreshold');
    if (stock !== undefined) semanticNode.stock = stock;
    if (capacity !== undefined) semanticNode.capacity = capacity;
    if (lowStockThreshold !== undefined) semanticNode.lowStockThreshold = lowStockThreshold;
    return semanticNode;
  });
  const nodeById = new Map(semanticNodes.map((node) => [node.id, node]));

  const semanticWires = wires.map((wire): SemanticTopologyWire => {
    const inferred = inferredWire(wire, nodeById.get(wire.fromNodeId), nodeById.get(wire.toNodeId));
    return {
      id: wire.id,
      fromNodeId: wire.fromNodeId,
      fromPortId: inferred.fromPortId,
      toNodeId: wire.toNodeId,
      toPortId: inferred.toPortId,
      relationshipType: inferred.relationshipType,
      // Direction is presentation-only, but the semantic graph is the
      // contract boundary: normalize corrupt/legacy values (undefined in
      // old persisted JSON, or garbage from manual edits) to a legal
      // value so consumers (renderer, validation) never see an unknown
      // state. one-way is the historical default.
      direction: normalizeWireDirection(wire.direction),
      legacyInferred: inferred.legacyInferred,
    };
  });

  return { schemaVersion, nodes: semanticNodes, wires: semanticWires };
}

/**
 * Fold a wire direction to a legal value. Direction is presentation-only,
 * but the closed union must hold everywhere the value crosses a boundary —
 * the semantic graph AND the editor load path (where a corrupt stored
 * value would otherwise render wrong markers and round-trip to the
 * backend on the next Apply). one-way is the historical default.
 */
export function normalizeWireDirection(value: string | undefined): 'one-way' | 'reverse' | 'two-way' {
  return value === 'two-way' || value === 'reverse' ? value : 'one-way';
}

/** Return only location-ownership wires for a normalized graph. */
function locationWires(graph: SemanticTopologyGraph): SemanticTopologyWire[] {
  return graph.wires.filter((wire) => wire.relationshipType === 'location');
}

/** Match the node kinds behind the semantic port matrix. Port ids alone are
 *  not enough at the Apply boundary: a forged ticket-out on a Store POS must
 *  not become a valid KDS ticket feed. Since ADR #45 this delegates to the
 *  contract's own `endpoints` lists instead of re-stating them here, so the
 *  gate that offered a wire and the gate that accepts it read one rule. */
function semanticNodesMatchWire(
  wire: SemanticTopologyWire,
  fromNode: SemanticTopologyNode,
  toNode: SemanticTopologyNode,
): boolean {
  return pairingAdmitsKinds(
    wire.fromPortId,
    wire.toPortId,
    nodeKindToken(fromNode.kind, fromNode.typeKey),
    nodeKindToken(toNode.kind, toNode.typeKey),
  );
}

/** Return one node in a directed cycle, if the graph contains one. */
function findDirectedCycleNode(graph: SemanticTopologyGraph): string | undefined {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const wire of graph.wires) {
    const targets = adjacency.get(wire.fromNodeId);
    if (targets && adjacency.has(wire.toNodeId)) targets.push(wire.toNodeId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): string | undefined => {
    if (visiting.has(nodeId)) return nodeId;
    if (visited.has(nodeId)) return undefined;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      const cycleNode = visit(target);
      if (cycleNode) return cycleNode;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return undefined;
  };

  for (const node of graph.nodes) {
    const cycleNode = visit(node.id);
    if (cycleNode) return cycleNode;
  }
  return undefined;
}

/**
 * Validate the first vertical slice: one Branch Location owns ordinary
 * workspaces, while a KDS inherits its store scope through exactly one
 * Restaurant POS operation feed.
 *
 * This is pure and deterministic so the same contract can be mirrored by the
 * Rust Apply boundary. It deliberately does not resolve display names,
 * primary stores, or a `default` store.
 */
export function validateTopologyGraph(
  graph: SemanticTopologyGraph,
  tier?: string,
): TopologyValidationError[] {
  const errors: TopologyValidationError[] = [];
  // The warehouse capacity guards AND the multi-warehouse cap are Pro-tier
  // business features. `tier` is optional so the pure contract stays strict
  // by default (no tier context => enforced); the UI gates pass their
  // license tier so standard/free/one_time installs skip the capacity
  // checks and hit the warehouse-tier-limit cap instead. One source of
  // truth for both, so the editor's live gate and the screen's Apply
  // boundary can never disagree (round 87).
  // Pro, Premium, and Enterprise are the capacity-aware tiers — the backend
  // treats Premium as Pro-equivalent (SubscriptionTier::max_warehouses /
  // validate_warehouse_capacity both include it), so the contract must too,
  // or a Premium install would flag its second Stock Room and skip the
  // capacity guards while the backend accepted the diagram.
  const capacityEnforced = tier === undefined || ['pro', 'premium', 'enterprise'].includes(tier);
  const tierLimitEnforced = tier === undefined || !['pro', 'premium', 'enterprise'].includes(tier);
  if (graph.schemaVersion !== TOPOLOGY_SCHEMA_VERSION) {
    errors.push({
      code: 'unsupported-schema-version',
      messageId: 'topology-validation-unsupported-schema',
    });
    return errors;
  }

  const seenNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenNodeIds.has(node.id)) {
      errors.push({
        code: 'duplicate-node',
        messageId: 'topology-validation-duplicate-node',
        nodeId: node.id,
      });
    }
    seenNodeIds.add(node.id);
  }

  // Wire ids must be unique across the WHOLE graph, not just the
  // location-ownership tuples the duplicate-wire 4-tuple check covers. Two
  // wires sharing an id (UUID collision, stale JSON merge) break the
  // editor's React keys, click-cycle-by-id, and delete-by-id even when
  // their endpoints differ — flag it here so it can never reach Apply.
  const seenWireIds = new Set<string>();
  for (const wire of graph.wires) {
    if (seenWireIds.has(wire.id)) {
      errors.push({
        code: 'duplicate-wire',
        messageId: 'topology-validation-duplicate-wire',
        wireId: wire.id,
      });
    }
    seenWireIds.add(wire.id);
  }

  // Every wire must reference nodes that exist in the graph. Location
  // wires are already guarded by invalid-location-connection, but a
  // NON-location wire (stock-routing, ticket-routing, generic) pointing
  // at a ghost id passed silently — inferredWire saw undefined nodes and
  // the wire round-tripped to Apply referencing nothing. Endpoint
  // resolution is structural integrity, independent of relationship type.
  // This guard deliberately runs BEFORE the ownership loop: a missing
  // node is more fundamental than a wrong connection, so a ghost-targeted
  // location wire surfaces unknown-wire-endpoint (the first error shown)
  // rather than invalid-location-connection.
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  for (const wire of graph.wires) {
    if (!nodeIds.has(wire.fromNodeId) || !nodeIds.has(wire.toNodeId)) {
      errors.push({
        code: 'unknown-wire-endpoint',
        messageId: 'topology-validation-unknown-wire-endpoint',
        wireId: wire.id,
      });
    }
  }

  const cycleNode = findDirectedCycleNode(graph);
  if (cycleNode) {
    errors.push({
      code: 'cycle-detected',
      messageId: 'topology-validation-cycle',
      nodeId: cycleNode,
    });
  }

  // Every non-location wire must match the same closed pairing matrix used
  // by the editor. Location wires have additional endpoint/cardinality rules
  // below, and KDS operation wires have a source-node rule in the workspace
  // loop, so those checks remain specialized rather than duplicated here.
  for (const wire of graph.wires) {
    if (wire.legacyInferred && wire.fromPortId === 'legacy-out' && wire.toPortId === 'legacy-in') {
      errors.push({
        code: 'ambiguous-legacy-wire',
        messageId: 'topology-validation-ambiguous-legacy-wire',
        wireId: wire.id,
      });
      continue;
    }
    if (wire.relationshipType === 'location') continue;
    const fromNode = graph.nodes.find((node) => node.id === wire.fromNodeId);
    const toNode = graph.nodes.find((node) => node.id === wire.toNodeId);
    // Let the dedicated KDS check report invalid-operation-source rather than
    // replacing it with the broader semantic-connection error — but only for a
    // feed whose SOURCE is a workspace. Skipping on the target alone meant any
    // node type could drop an operation-in wire past this gate (ADR #45).
    const isWorkspaceOperationFeed = wire.fromPortId === 'operation-out'
      && wire.toPortId === 'operation-in'
      && wire.relationshipType === 'generic'
      && fromNode?.kind === 'workspace'
      && toNode?.kind === 'workspace'
      && toNode.typeKey === 'kds';
    if (isWorkspaceOperationFeed || !fromNode || !toNode) continue;
    if (!isSemanticWireCompatible(wire.fromPortId, wire.toPortId, wire.relationshipType)
      || !semanticNodesMatchWire(wire, fromNode, toNode)) {
      errors.push({
        code: 'invalid-semantic-connection',
        messageId: 'topology-validation-invalid-semantic-connection',
        wireId: wire.id,
      });
    }
  }

  // Warehouse capacity guard: a stock-bearing wire into a Stock Room
  // (stock-routing, or inventory-transfer — round 83, hub-and-spoke) is
  // only routable while the target has room. Only wires landing on the
  // shared operational input ports (stock-in/transfer-in) count — the
  // backend capacity guard filters on the same set, and a stock-bearing
  // wire on the ownership port (location-in) is an invalid connection, not
  // a capacity event (round 135). The design-time metadata numbers
  // (rounds 70-71) drive it — no capacity metadata means no check, so
  // legacy graphs with no numbers stay unflagged.
  if (capacityEnforced) {
    // Round 89: the at-capacity error is a property of the TARGET warehouse,
    // not of each inbound wire — a full room fed by two stock-bearing wires
    // (stock-routing AND inventory-transfer) reports ONCE, keyed to the
    // first inbound wire so the marker renders on that wire only.
    const flaggedTargets = new Set<string>();
    for (const wire of graph.wires) {
      if (wire.relationshipType !== 'stock-routing'
        && wire.relationshipType !== 'inventory-transfer') continue;
      if (!isWarehouseOperationalInputPort(wire.toPortId)) continue;
      const target = graph.nodes.find((node) => node.id === wire.toNodeId);
      if (!target || target.kind !== 'warehouse') continue;
      if (target.capacity === undefined || target.stock === undefined) continue;
      if (target.stock >= target.capacity) {
        if (flaggedTargets.has(target.id)) continue;
        flaggedTargets.add(target.id);
        errors.push({
          code: 'warehouse-at-capacity',
          messageId: 'topology-validation-warehouse-at-capacity',
          nodeId: target.id,
          wireId: wire.id,
        });
      }
    }

    // Reverse guard: a warehouse configured with room but NO incoming
    // stock-bearing wire is an unserviced Stock Room — prompt the user to
    // route stock in. Only an inbound stock-bearing wire on an operational
    // input port (stock-in/transfer-in) services the prompt — a stock wire
    // on the ownership port is an invalid connection, not a route (round
    // 135, mirroring the backend servicing guard). Skipped when the
    // warehouse is full (stock >= capacity; nothing should route in then)
    // or has no capacity metadata (legacy graphs with no design-time
    // numbers stay unflagged).
    for (const node of graph.nodes) {
      if (node.kind !== 'warehouse') continue;
      if (node.capacity === undefined) continue;
      if (node.stock !== undefined && node.stock >= node.capacity) continue;
      const hasStockInbound = graph.wires.some(
        (wire) =>
          (wire.relationshipType === 'stock-routing' || wire.relationshipType === 'inventory-transfer')
          && wire.toNodeId === node.id
          && isWarehouseOperationalInputPort(wire.toPortId),
      );
      if (hasStockInbound) continue;
      errors.push({
        code: 'warehouse-missing-stock-routing',
        messageId: 'topology-validation-warehouse-missing-stock-routing',
        nodeId: node.id,
      });
    }
  }

  const branches = graph.nodes.filter((node) => node.kind === 'branch-location');
  if (branches.length === 0) {
    // No branch exists — there is nothing to jump to; the banner is the
    // only honest surface for this graph-level error.
    errors.push({ code: 'missing-branch-location', messageId: 'topology-validation-missing-branch' });
  } else if (branches.length > 1) {
    // Round 108: the extra-branch error is scoped to the SECOND branch —
    // the node that pushes the count past the required single root — so
    // the editor renders it as a node-scoped card note with a jump target
    // instead of a dead-end banner (same class as the round-103
    // tier-limit scoping). Deterministic by node order.
    errors.push({
      code: 'multiple-branch-locations',
      messageId: 'topology-validation-multiple-branches',
      nodeId: branches[1]!.id,
    });
  }

  const branchIds = new Set(branches.map((node) => node.id));
  for (const branch of branches) {
    if (!branch.storeProfileId) {
      errors.push({
        code: 'branch-location-missing-identity',
        messageId: 'topology-validation-branch-identity',
        nodeId: branch.id,
      });
    }
  }
  const workspaceNodes = graph.nodes.filter((node) => node.kind === 'workspace');
  const workspaceIds = new Set(workspaceNodes.map((node) => node.id));
  for (const workspace of workspaceNodes) {
    const typeKey = workspace.typeKey ?? 'store-pos';
    const purposeKey = workspace.purposeKey ?? 'general';
    const definition = WORKSPACE_PURPOSES[purposeKey as keyof typeof WORKSPACE_PURPOSES];
    if (!definition || !(definition.typeKeys as readonly string[]).includes(typeKey)) {
      errors.push({
        code: 'invalid-purpose',
        messageId: 'topology-validation-invalid-purpose',
        nodeId: workspace.id,
      });
    }
  }
  const ownership = locationWires(graph);
  const seenOwnership = new Set<string>();

  for (const wire of ownership) {
    const key = `${wire.fromNodeId}|${wire.fromPortId}|${wire.toNodeId}|${wire.toPortId}`;
    if (seenOwnership.has(key)) {
      errors.push({
        code: 'duplicate-wire',
        messageId: 'topology-validation-duplicate-wire',
        wireId: wire.id,
      });
    }
    seenOwnership.add(key);

    if (
      !branchIds.has(wire.fromNodeId)
      || wire.fromPortId !== 'location-out'
      || (!workspaceIds.has(wire.toNodeId)
        && !graph.nodes.some((node) => node.id === wire.toNodeId && node.kind === 'warehouse'))
      || !['location-in'].includes(wire.toPortId)
    ) {
      errors.push({
        code: 'invalid-location-connection',
        messageId: 'topology-validation-invalid-location',
        wireId: wire.id,
      });
    }
  }

  for (const workspaceId of workspaceIds) {
    const workspace = graph.nodes.find((node) => node.id === workspaceId);
    const isKds = workspace?.typeKey === 'kds';
    if (isKds) {
      // KDS is operationally owned by the Restaurant POS feed. Its single
      // left socket is operation-in, so a valid operation wire satisfies the
      // KDS requirement; it must not also require a second Location wire on
      // the same socket.
      const operationInputs = graph.wires.filter(
        (wire) => wire.toNodeId === workspaceId
          && wire.toPortId === 'operation-in'
          && wire.relationshipType === 'generic',
      );
      if (operationInputs.length === 0) {
        errors.push({
          code: 'missing-operation-input',
          messageId: 'topology-validation-missing-operation',
          nodeId: workspaceId,
          portId: 'operation-in',
        });
      } else if (operationInputs.length > 1) {
        errors.push({
          code: 'multiple-operation-inputs',
          messageId: 'topology-validation-multiple-operation',
          nodeId: workspaceId,
          portId: 'operation-in',
        });
      } else {
        const operationInput = operationInputs[0]!;
        const source = graph.nodes.find((node) => node.id === operationInput.fromNodeId);
        // ADR #45 follow-up #2: ask the contract which kinds may feed
        // `operation-in` rather than re-stating "restaurant-pos" here. The port
        // check stays, because this branch reports a wire-level problem with a
        // specific message; only the kind test moves to the shared rule. The
        // old predicate also looked at `source?.typeKey` alone, so a non-
        // workspace node carrying a `restaurant-pos` typeKey would have passed.
        const feedAdmitted = source !== undefined
          && workspace !== undefined
          && pairingAdmitsKinds(
            'operation-out',
            'operation-in',
            nodeKindToken(source.kind, source.typeKey),
            nodeKindToken(workspace.kind, workspace.typeKey),
          );
        if (operationInput.fromPortId !== 'operation-out' || !feedAdmitted) {
          errors.push({
            code: 'invalid-operation-source',
            messageId: 'topology-validation-invalid-operation-source',
            nodeId: workspaceId,
            wireId: operationInput.id,
            portId: 'operation-in',
          });
        }
      }
      continue;
    }

    const incoming = ownership.filter(
      (wire) => wire.toNodeId === workspaceId && wire.toPortId === 'location-in',
    );
    if (incoming.length === 0) {
      errors.push({
        code: 'missing-location-input',
        messageId: 'topology-validation-missing-location',
        nodeId: workspaceId,
        portId: 'location-in',
      });
    } else if (incoming.length > 1) {
      errors.push({
        code: 'multiple-location-inputs',
        messageId: 'topology-validation-multiple-location',
        nodeId: workspaceId,
        portId: 'location-in',
      });
    }
  }

  // A Stock Room has exactly one primary inbound scope. It may be attached
  // directly to the Branch Location, or receive an Operation feed from Retail
  // POS, but never both and never more than one of either kind. Operational
  // stock/transfer routes remain separate compatibility/runtime edges.
  const warehouseNodes = graph.nodes.filter((node) => node.kind === 'warehouse');
  for (const warehouse of warehouseNodes) {
    const locationInputs = ownership.filter(
      (wire) => wire.toNodeId === warehouse.id
        && isWarehousePrimaryInputPort(wire.toPortId)
        && wire.toPortId === 'location-in',
    );
    const operationInputs = graph.wires.filter(
      (wire) => wire.toNodeId === warehouse.id
        && isWarehousePrimaryInputPort(wire.toPortId)
        && wire.toPortId === 'operation-in'
        && wire.relationshipType === 'generic',
    );
    const primaryInputs = [...locationInputs, ...operationInputs];
    if (primaryInputs.length === 0) {
      errors.push({
        code: 'missing-warehouse-input',
        messageId: 'topology-validation-missing-warehouse-input',
        nodeId: warehouse.id,
        portId: 'location-in',
      });
    } else if (primaryInputs.length > 1) {
      errors.push({
        code: 'multiple-warehouse-inputs',
        messageId: 'topology-validation-multiple-warehouse-inputs',
        nodeId: warehouse.id,
        portId: primaryInputs[1]!.toPortId,
      });
    }
    for (const input of operationInputs) {
      const source = graph.nodes.find((node) => node.id === input.fromNodeId);
      // ADR #45 §3 follow-up #2, second half: ask the contract which kinds may
      // feed `operation-in` on a warehouse instead of re-stating "store-pos"
      // here. Unlike the KDS variant, this predicate already tested kind
      // alongside the type key, so it was never wrong — only duplicated, which
      // is what would eventually let it drift. The port test stays explicit
      // because `operationInputs` filters on the target port and relationship,
      // not the source port.
      const feedAdmitted = source !== undefined
        && input.fromPortId === 'operation-out'
        && pairingAdmitsKinds(
          'operation-out',
          'operation-in',
          nodeKindToken(source.kind, source.typeKey),
          nodeKindToken(warehouse.kind, warehouse.typeKey),
        );
      if (!feedAdmitted) {
        errors.push({
          code: 'invalid-warehouse-operation-source',
          messageId: 'topology-validation-invalid-warehouse-operation-source',
          nodeId: warehouse.id,
          wireId: input.id,
          portId: 'operation-in',
        });
      }
    }
  }

  // Ticket-routing input cardinality (ADR #34 decision): a ticket device
  // (hardware) accepts tickets from exactly ONE source — the same
  // exactly-one input rule the ownership ports enforce. Two KDS feeding one
  // printer interleave tickets with no source identity, the ambiguity class
  // this gate exists to eliminate. The KDS OUTPUT side stays 'many' (one
  // KDS may drive main + expo printers), so only the input side is capped.
  // Scope mirrors the multiple-* ownership errors: one error per offending
  // device, keyed to its node, deterministic on the second wire. The
  // pairing matrix already quarantines non-KDS sources, and ticket-routing
  // cannot participate in a cycle (hardware has no ticket-out), so no
  // further rules apply.
  const flaggedTicketTargets = new Set<string>();
  for (const wire of graph.wires) {
    if (wire.relationshipType !== 'ticket-routing' || wire.toPortId !== 'ticket-in') continue;
    const target = graph.nodes.find((node) => node.id === wire.toNodeId);
    if (!target || target.kind !== 'hardware') continue;
    if (flaggedTicketTargets.has(target.id)) continue;
    const otherSource = graph.wires.some(
      (w) => w.id !== wire.id
        && w.relationshipType === 'ticket-routing'
        && w.toPortId === 'ticket-in'
        && w.toNodeId === target.id,
    );
    if (otherSource) {
      flaggedTicketTargets.add(target.id);
      errors.push({
        code: 'multiple-ticket-inputs',
        messageId: 'topology-validation-multiple-ticket-inputs',
        nodeId: target.id,
        portId: 'ticket-in',
      });
    }
  }

  // Multi-warehouse tier cap (round 87): below Pro, a diagram may carry at
  // most one Stock Room. Appended LAST so semantic/integrity errors keep
  // their precedence — a broken diagram reports the break first, the
  // license cap only after the graph itself is sound. Round 87 follow-up:
  // the error is scoped per excess node — the FIRST Stock Room is the
  // allowed one, every warehouse after it (slice(1)) is flagged, one
  // jumpable error each — so a downgraded diagram with several Stock
  // Rooms reports each one in the panel instead of a single banner with
  // nowhere to go. Deterministic by node order.
  if (tierLimitEnforced) {
    const warehouses = graph.nodes.filter((node) => node.kind === 'warehouse');
    for (const excess of warehouses.slice(1)) {
      errors.push({
        code: 'warehouse-tier-limit',
        messageId: 'topology-toast-multi-warehouse',
        nodeId: excess.id,
      });
    }
  }

  return errors;
}

/** Return a concise localized message descriptor for the first failure. */
export function firstTopologyValidationError(
  errors: TopologyValidationError[],
): TopologyValidationError | undefined {
  return orderTopologyValidationErrors(errors)[0];
}

/**
 * ADR #45 §4.3 — the ordering the validation checklist needs.
 *
 * `firstTopologyValidationError` used to be `errors[0]`, i.e. whatever the
 * validator happened to push first. That is not a rule: the validator walks
 * `Set`s of node ids and object key order, and a saved diagram's node order is
 * whatever the merchant dragged last. Two merchants with the same problem could
 * be told to fix different things, and the same merchant reloading the same
 * graph could see the "next step" move.
 *
 * Priority is by what an error makes impossible, not by a guess at merchant
 * preference — each tier blocks the ones below it:
 *
 *  1. the graph cannot be read at all
 *  2. the graph's shape is structurally impossible
 *  3. a node or wire is not a legal member of the contract
 *  4. a node is missing or over-supplied an input
 *  5. a legal graph exceeds an operational limit
 *
 * Codes absent from the table sort last, stably, so adding a code never
 * silently reorders the ones that are listed.
 */
const TOPOLOGY_ERROR_TIER: Readonly<Record<string, number>> = {
  // 1 — unreadable
  'unsupported-schema-version': 1,
  'duplicate-node': 1,
  'duplicate-wire': 1,
  'unknown-wire-endpoint': 1,
  // 2 — structurally impossible
  'missing-branch-location': 2,
  'multiple-branch-locations': 2,
  'branch-location-missing-identity': 2,
  'cycle-detected': 2,
  // 3 — not a legal member of the contract
  'ambiguous-legacy-wire': 3,
  'invalid-semantic-connection': 3,
  'invalid-purpose': 3,
  'invalid-location-connection': 3,
  'invalid-operation-source': 3,
  'invalid-warehouse-operation-source': 3,
  // 4 — wrong number of inputs
  'missing-operation-input': 4,
  'multiple-operation-inputs': 4,
  'missing-location-input': 4,
  'multiple-location-inputs': 4,
  'missing-warehouse-input': 4,
  'multiple-warehouse-inputs': 4,
  'multiple-ticket-inputs': 4,
  'warehouse-missing-stock-routing': 4,
  // 5 — legal but over a limit
  'warehouse-at-capacity': 5,
  'warehouse-tier-limit': 5,
};

const UNRANKED_TIER = Number.MAX_SAFE_INTEGER;

/** Sort validation errors into the order a merchant should be told to fix them
 *  in. Stable, and never mutates the input. */
export function orderTopologyValidationErrors(
  errors: readonly TopologyValidationError[],
): TopologyValidationError[] {
  return errors
    .map((error, index) => ({ error, index, tier: TOPOLOGY_ERROR_TIER[error.code] ?? UNRANKED_TIER }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((ranked) => ranked.error);
}
