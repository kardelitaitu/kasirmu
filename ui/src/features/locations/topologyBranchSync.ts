import type {
  BranchLocationSeed,
  TopologyNodeData,
  TopologyWireData,
  WorkspaceInstanceSeed,
} from './NodeTopologyEditor';

/** Result of reconciling the live branch-location list with the canvas. */
export interface BranchLocationSyncResult {
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  removedLocationIds: Set<string>;
}

/**
 * Reconcile branch-location changes without touching React state or transient
 * interaction state. Existing branch cards keep their positions and metadata;
 * names follow the live location list, new locations receive the historical
 * default position, and wires attached to deleted canonical branches are
 * removed with their cards.
 */
export function syncBranchLocations(
  nodes: TopologyNodeData[],
  wires: TopologyWireData[],
  branchLocations: BranchLocationSeed[] | undefined,
  previousBranchLocations: BranchLocationSeed[] | undefined,
  snapPosition: (value: number) => number,
): BranchLocationSyncResult {
  const locationIds = new Set((branchLocations ?? []).map((location) => location.id));
  const removedLocationIds = new Set(
    (previousBranchLocations ?? [])
      .map((location) => location.id)
      .filter((id) => !locationIds.has(id)),
  );
  const nameById = new Map((branchLocations ?? []).map((location) => [location.id, location.name]));
  const nextNodes = nodes
    .filter((node) => !(node.type === 'store' && node.storeProfileId && !locationIds.has(node.storeProfileId)))
    .map((node) => {
      if (node.type !== 'store' || !node.storeProfileId) return node;
      const name = nameById.get(node.storeProfileId);
      return name !== undefined && name !== node.name ? { ...node, name } : node;
    });

  for (const location of branchLocations ?? []) {
    if (nextNodes.some((node) => node.type === 'store' && node.storeProfileId === location.id)) continue;
    nextNodes.push({
      id: location.id,
      type: 'store',
      name: location.name,
      subtitle: 'Branch Location',
      x: snapPosition(80),
      y: snapPosition(140),
      storeProfileId: location.id,
    });
  }

  return {
    nodes: nextNodes,
    wires: wires.filter(
      (wire) => !removedLocationIds.has(wire.fromNodeId) && !removedLocationIds.has(wire.toNodeId),
    ),
    removedLocationIds,
  };
}

/**
 * Merge live workspace-instance names into the canvas without rebuilding the
 * graph. Non-workspace nodes and unchanged workspace objects retain identity,
 * which keeps unsaved positions, metadata, and unrelated edits intact.
 */
export function syncWorkspaceInstanceNames(
  nodes: TopologyNodeData[],
  workspaceInstances: WorkspaceInstanceSeed[],
): TopologyNodeData[] {
  const nameById = new Map(workspaceInstances.map((instance) => [instance.instanceId, instance.name]));
  return nodes.map((node) => {
    if (node.type !== 'workspace') return node;
    const name = nameById.get(node.id);
    return name !== undefined && name !== node.name ? { ...node, name } : node;
  });
}
