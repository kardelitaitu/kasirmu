// ── Topology save diff ────────────────────────────────────────────
//
// Pure computation of the workspace-instance diff TopologyScreen builds
// when the editor applies: given the canvas model and the backend's
// loaded workspace instances, produce the create/update/archive vectors
// and the type-change remap (Critical #1). Kept free of React and screen
// state so the workspace-instance semantics are unit-testable directly
// (round 149) — TopologyScreen's handleTopologySave delegates here
// instead of embedding this block in the callback.
//
// The classification (which nodes create / update / archive) is split
// from the payload building (which needs store_id resolution) so the
// editor chip can preview the vectors through planTopologyDiff — total,
// never throwing — while the save path builds the full CreateInstance
// payloads through computeTopologyDiff on the SAME plan, so the preview
// can never drift from what Apply commits (round 150).

import { normalizeTopologyGraph } from './topologyContract';
import type { CreateInstanceRequest, UpdateInstanceRequest } from '@/api/topology';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

/** The workspace-instance fields a diff reads. WorkspaceDto satisfies it;
 *  the editor's seeded instances map onto it. */
export interface TopologyPlanInstance {
  instance_id: string;
  type_key: string;
  purpose_key?: string;
  name: string;
}

export interface TopologyDiffInput {
  /** Canvas nodes (the diff's "after" side). */
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  /** Loaded backend workspace instances (the diff's "before" side). */
  workspaceInstances: TopologyPlanInstance[];
  /** Known store profiles — needed for legacy store-node id resolution. */
  stores: Array<{ id: string }>;
  /** UUID generator for type-change recreates; injectable for tests. */
  makeId?: () => string;
}

export interface TopologyDiffResult {
  creations: CreateInstanceRequest[];
  updates: UpdateInstanceRequest[];
  archives: string[];
  /** Node id → replacement identity for type-changed workspaces. */
  typeChanges: Map<string, { newId: string; newTypeKey: string }>;
  /** oldId → newId remap the editor applies to its canvas state. */
  idMap: Record<string, string>;
}

export interface TopologyDiffPlan {
  /** Workspace node ids (canvas order) that must be created (new or type-changed). */
  createNodeIds: string[];
  /** Workspace node ids that must be updated (rename or purpose change). */
  updateNodeIds: string[];
  /** Instance ids to archive — type-changed originals, then instances removed from the canvas. */
  archiveIds: string[];
  /** Node id → replacement identity for type-changed workspaces. */
  typeChanges: Map<string, { newId: string; newTypeKey: string }>;
}

/** Counts a plan for the Apply chip (round 152). A type change archives
 *  the old instance and creates a NEW one with a fresh id (Critical #1) —
 *  a destructive recreate — so it is surfaced as `typeChanged` instead of
 *  inflating the plain created/archived counts. The split guarantees
 *  created + typeChanged + updated + archived never double-count a single
 *  node. */
export interface TopologyDiffSummary {
  created: number;
  updated: number;
  archived: number;
  typeChanged: number;
}

export function summarizeTopologyPlan(plan: TopologyDiffPlan): TopologyDiffSummary {
  const typeChanged = plan.typeChanges.size;
  return {
    created: plan.createNodeIds.length - typeChanged,
    updated: plan.updateNodeIds.length,
    archived: plan.archiveIds.length - typeChanged,
    typeChanged,
  };
}

/**
 * Classify the workspace-instance vectors without resolving store
 * ownership. Total: a workspace with no resolvable Branch Location (a
 * mid-wiring canvas) still counts as a creation — only the create
 * payload's store_id needs ownership, and that is computeTopologyDiff's
 * job. Never throws.
 */
export function planTopologyDiff(
  nodes: TopologyNodeData[],
  workspaceInstances: TopologyPlanInstance[],
  makeId: () => string = () => `ws-${crypto.randomUUID()}`,
): TopologyDiffPlan {
  const wsNodes = nodes.filter((n) => n.type === 'workspace');
  const loadedById = new Map(workspaceInstances.map((w) => [w.instance_id, w]));
  const canvasIds = new Set(wsNodes.map((n) => n.id));

  // ── Type-change detection (Critical #1) ──────────────────────────
  //
  // Walk persisted workspace nodes. For each one where the inspector's
  // typeKey differs from the backend's type_key, schedule an archive +
  // recreate. Generate new UUIDs so the recreated instance gets a fresh
  // primary key and the topology diagram stays consistent.
  const typeChanges = new Map<
    string,
    { newId: string; newTypeKey: string }
  >();
  for (const node of wsNodes) {
    const existing = loadedById.get(node.id);
    if (!existing) continue;
    const newTypeKey = (node.metadata?.['typeKey'] as string) ?? 'store-pos';
    if (existing.type_key !== newTypeKey) {
      typeChanges.set(node.id, { newId: makeId(), newTypeKey });
    }
  }

  const createNodeIds: string[] = [];
  const updateNodeIds: string[] = [];
  const archiveIds: string[] = [];

  for (const node of wsNodes) {
    const change = typeChanges.get(node.id);
    if (change) {
      // Archive old instance, create replacement with new typeKey.
      archiveIds.push(node.id);
      createNodeIds.push(node.id);
      continue;
    }

    const existing = loadedById.get(node.id);
    if (!existing) {
      createNodeIds.push(node.id);
    } else {
      const nextPurposeKey = (node.metadata?.['purposeKey'] as string) ?? existing.purpose_key ?? 'general';
      if (existing.name !== node.name || existing.purpose_key !== nextPurposeKey) {
        updateNodeIds.push(node.id);
      }
    }
  }

  // Archive instances removed from the canvas.
  for (const inst of workspaceInstances) {
    if (!canvasIds.has(inst.instance_id)) {
      archiveIds.push(inst.instance_id);
    }
  }

  return { createNodeIds, updateNodeIds, archiveIds, typeChanges };
}

export function computeTopologyDiff(input: TopologyDiffInput): TopologyDiffResult {
  const { nodes, wires, workspaceInstances, stores, makeId } = input;

  const plan = planTopologyDiff(nodes, workspaceInstances, makeId);
  const idMap: Record<string, string> = {};
  for (const [nodeId, change] of plan.typeChanges) {
    idMap[nodeId] = change.newId;
  }

  const semanticGraph = normalizeTopologyGraph(nodes, wires);

  // ── Semantic store_id resolution ────────────────────────────────
  // The validator has already established one Branch Location parent
  // for ordinary workspaces, and a Restaurant POS operation source for
  // KDS. Resolve from the stable node reference or canonical
  // store_profile_id; never use names, primary, or default.
  const semanticNodes = new Map(semanticGraph.nodes.map((node) => [node.id, node]));
  const resolveStoreId = (node: TopologyNodeData): string => {
    const semanticWire = semanticGraph.wires.find(
      (wire) => wire.toNodeId === node.id
        && (wire.relationshipType === 'location' || wire.legacyInferred)
        && semanticNodes.get(wire.fromNodeId)?.kind === 'branch-location',
    );
    const branchNode = semanticWire ? semanticNodes.get(semanticWire.fromNodeId) : undefined;
    const storeId = branchNode?.storeProfileId
      ?? node.storeProfileId
      ?? (node.metadata?.['storeProfileId'] as string | undefined);
    if (storeId) return storeId;

    // KDS nodes are operational children of a POS node rather than
    // direct Branch Location children. Follow the Operation feed back
    // to its source so the KDS inherits the same store scope without
    // inventing a second Location wire on its single input socket.
    const operationSource = semanticGraph.wires
      .find((wire) => wire.toNodeId === node.id
        && wire.toPortId === 'operation-in'
        && wire.relationshipType === 'generic');
    if (operationSource && operationSource.fromNodeId !== node.id) {
      const sourceNode = nodes.find((candidate) => candidate.id === operationSource.fromNodeId);
      if (sourceNode) return resolveStoreId(sourceNode);
    }

    // Compatibility boundary for legacy CRUD-only calls. Resolve a
    // legacy Store node by its stable node ID when it is a real store
    // profile ID; never match by display name.
    const connectedLegacyStoreId = wires
      .map((wire) => {
        const otherId = wire.toNodeId === node.id
          ? wire.fromNodeId
          : wire.fromNodeId === node.id
            ? wire.toNodeId
            : undefined;
        return otherId && nodes.some((candidate) => candidate.id === otherId && candidate.type === 'store')
          ? otherId
          : undefined;
      })
      .find((storeId): storeId is string => storeId !== undefined);
    if (connectedLegacyStoreId && stores.some((store) => store.id === connectedLegacyStoreId)) {
      return connectedLegacyStoreId;
    }
    // Strict validation above guarantees this path is unreachable for
    // real topology saves. Keep an explicit error rather than silently
    // reintroducing primary/default ownership inference.
    throw new Error('workspace has no semantic Branch Location ownership');
  };

  // ── Build diff payloads from the plan ───────────────────────────
  // The plan's createNodeIds ride the node's canvas slot; the payload id
  // comes from the typeChanges remap for type-changed nodes.

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const creations: CreateInstanceRequest[] = plan.createNodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId)!;
    const change = plan.typeChanges.get(nodeId);
    return {
      id: change?.newId ?? nodeId,
      type_key: change?.newTypeKey ?? (node.metadata?.['typeKey'] as string) ?? 'store-pos',
      purpose_key: (node.metadata?.['purposeKey'] as string) ?? 'general',
      store_id: resolveStoreId(node),
      name: node.name,
    };
  });
  const updates: UpdateInstanceRequest[] = plan.updateNodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId)!;
    const existing = workspaceInstances.find((w) => w.instance_id === nodeId);
    const nextPurposeKey = (node.metadata?.['purposeKey'] as string) ?? existing?.purpose_key ?? 'general';
    return { id: nodeId, name: node.name, purpose_key: nextPurposeKey };
  });

  return {
    creations,
    updates,
    archives: plan.archiveIds,
    typeChanges: plan.typeChanges,
    idMap,
  };
}
