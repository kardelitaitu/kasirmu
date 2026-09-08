import { describe, expect, it } from 'vitest';
import { syncBranchLocations } from '../features/locations/topologyBranchSync';
import type { BranchLocationSeed, TopologyNodeData, TopologyWireData } from '../features/locations/NodeTopologyEditor';

const snap = (value: number) => Math.round(value / 24) * 24;

const locations = (...items: Array<[string, string]>): BranchLocationSeed[] =>
  items.map(([id, name]) => ({ id, name }));

const node = (overrides: Partial<TopologyNodeData> & Pick<TopologyNodeData, 'id' | 'type'>): TopologyNodeData => ({
  name: overrides.id,
  x: 0,
  y: 0,
  ...overrides,
});

const wire = (id: string, fromNodeId: string, toNodeId: string): TopologyWireData => ({
  id,
  fromNodeId,
  toNodeId,
  direction: 'one-way',
});

describe('syncBranchLocations', () => {
  it('renames live branch nodes, adds new locations, and removes deleted branch wires', () => {
    const result = syncBranchLocations(
      [
        node({ id: 'store-1', type: 'store', name: 'Old Name', storeProfileId: 'store-1' }),
        node({ id: 'store-2', type: 'store', name: 'Deleted', storeProfileId: 'store-2' }),
        node({ id: 'workspace-1', type: 'workspace' }),
      ],
      [
        wire('wire-removed', 'store-2', 'workspace-1'),
        wire('wire-kept', 'store-1', 'workspace-1'),
      ],
      locations(['store-1', 'Renamed'], ['store-3', 'New Branch']),
      locations(['store-1', 'Old Name'], ['store-2', 'Deleted']),
      snap,
    );

    expect(result.removedLocationIds).toEqual(new Set(['store-2']));
    expect(result.nodes).toEqual([
      node({ id: 'store-1', type: 'store', name: 'Renamed', storeProfileId: 'store-1' }),
      node({ id: 'workspace-1', type: 'workspace' }),
      node({
        id: 'store-3',
        type: 'store',
        name: 'New Branch',
        subtitle: 'Branch Location',
        x: 72,
        y: 144,
        storeProfileId: 'store-3',
      }),
    ]);
    expect(result.wires).toEqual([wire('wire-kept', 'store-1', 'workspace-1')]);
  });

  it('does not remove legacy store nodes without a canonical profile id', () => {
    const legacy = node({ id: 'legacy-store', type: 'store', name: 'Legacy' });
    const result = syncBranchLocations(
      [legacy],
      [],
      locations(['store-1', 'Current']),
      locations(['legacy-store', 'Legacy']),
      snap,
    );

    expect(result.nodes).toContainEqual(legacy);
  });
});
