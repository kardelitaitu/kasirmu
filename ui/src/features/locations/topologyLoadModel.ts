import type { TopologyWirePayload } from '@/api/topology';
import { diagramWireToCanvas } from './topologyEditorHelpers';
import type {
  BranchLocationSeed,
  TopologyNodeData,
  TopologyWireData,
  WorkspaceInstanceSeed,
} from './NodeTopologyEditor';

/**
 * Build the live workspace/branch canvas model from persisted nodes and the
 * current seed lists. This is pure so authoritative loading can keep data
 * reconciliation separate from effects, transient cleanup, and React state.
 */
/**
 * Keep only persisted wires whose endpoints survived live-node reconciliation,
 * then map them through the canonical payload-to-canvas converter.
 */
export function buildLoadedTopologyWires(
  persistedWires: TopologyWirePayload[],
  validNodeIds: ReadonlySet<string>,
): TopologyWireData[] {
  return persistedWires
    .filter((wire) => validNodeIds.has(wire.from_node_id) && validNodeIds.has(wire.to_node_id))
    .map(diagramWireToCanvas);
}

export function buildWorkspaceTopologyNodes(
  savedNodes: TopologyNodeData[],
  workspaceInstances: WorkspaceInstanceSeed[],
  branchLocations: BranchLocationSeed[] | undefined,
  snapPosition: (value: number) => number,
): TopologyNodeData[] {
  const savedById = new Map(savedNodes.map((node) => [node.id, node]));
  const workspaceNodes: TopologyNodeData[] = workspaceInstances.map((instance, index) => {
    const saved = savedById.get(instance.instanceId);
    return {
      id: instance.instanceId,
      type: 'workspace',
      name: instance.name,
      subtitle: instance.subtitle ?? saved?.subtitle ?? '',
      x: saved?.x ?? snapPosition(340),
      y: saved?.y ?? snapPosition(80 + index * 140),
      telemetryBadge: saved?.telemetryBadge ?? 'Active',
      telemetryStatus: saved?.telemetryStatus ?? 'online',
      metadata: {
        ...(saved?.metadata ?? {}),
        typeKey: instance.typeKey,
        purposeKey: instance.purposeKey ?? 'general',
        persisted: true,
      },
    };
  });

  const otherNodes = savedNodes
    .filter((node) => node.type !== 'workspace')
    .map((node) => {
      if (node.type !== 'store' || node.storeProfileId) return node;
      const location = (branchLocations ?? []).find((candidate) => candidate.id === node.id);
      return location ? { ...node, storeProfileId: location.id } : node;
    })
    .filter((node) => {
      if (branchLocations === undefined) return true;
      if (node.type === 'store') {
        return (branchLocations ?? []).some((location) => location.id === (node.storeProfileId ?? node.id));
      }
      return true;
    })
    .map((node) => {
      if (node.type !== 'store' || !node.storeProfileId) return node;
      const location = (branchLocations ?? []).find((candidate) => candidate.id === node.storeProfileId);
      return location ? { ...node, name: location.name } : node;
    });

  const seededStoreIds = new Set(
    otherNodes.flatMap((node) => node.type === 'store' && node.storeProfileId ? [node.storeProfileId] : []),
  );
  for (const location of branchLocations ?? []) {
    if (seededStoreIds.has(location.id)) continue;
    seededStoreIds.add(location.id);
    otherNodes.push({
      id: location.id,
      type: 'store',
      name: location.name,
      subtitle: 'Branch Location',
      x: snapPosition(80),
      y: snapPosition(140),
      storeProfileId: location.id,
    });
  }

  return [...otherNodes, ...workspaceNodes];
}
