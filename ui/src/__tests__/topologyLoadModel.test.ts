import { describe, expect, it } from 'vitest';
import { buildWorkspaceTopologyNodes } from '../features/locations/topologyLoadModel';
import type {
  BranchLocationSeed,
  TopologyNodeData,
  WorkspaceInstanceSeed,
} from '../features/locations/NodeTopologyEditor';

const snap = (value: number) => Math.round(value / 24) * 24;

const instance = (overrides: Partial<WorkspaceInstanceSeed> & Pick<WorkspaceInstanceSeed, 'instanceId'>): WorkspaceInstanceSeed => ({
  typeKey: 'store-pos',
  name: overrides.instanceId,
  ...overrides,
});

const node = (overrides: Partial<TopologyNodeData> & Pick<TopologyNodeData, 'id' | 'type'>): TopologyNodeData => ({
  name: overrides.id,
  x: 0,
  y: 0,
  ...overrides,
});

describe('buildWorkspaceTopologyNodes', () => {
  it('keeps saved workspace geometry and metadata while applying live instance fields', () => {
    const saved = node({
      id: 'workspace-1',
      type: 'workspace',
      name: 'Saved Name',
      x: 456,
      y: 192,
      subtitle: 'Saved subtitle',
      telemetryBadge: 'Paused',
      metadata: { persisted: false, custom: 'keep' },
    });

    expect(buildWorkspaceTopologyNodes(
      [saved],
      [instance({ instanceId: 'workspace-1', name: 'Live Name', purposeKey: 'checkout' })],
      undefined,
      snap,
    )).toEqual([{
      ...saved,
      name: 'Live Name',
      subtitle: 'Saved subtitle',
      telemetryBadge: 'Paused',
      telemetryStatus: 'online',
      metadata: { persisted: true, custom: 'keep', typeKey: 'store-pos', purposeKey: 'checkout' },
    }]);
  });

  it('adopts legacy branch identity, drops deleted branches, and seeds new branches', () => {
    const savedLegacy = node({ id: 'store-1', type: 'store', name: 'Old Branch', x: 192, y: 216 });
    const deleted = node({ id: 'store-deleted', type: 'store', name: 'Deleted', storeProfileId: 'store-deleted' });
    const warehouse = node({ id: 'warehouse-1', type: 'warehouse', name: 'Stock' });
    const locations: BranchLocationSeed[] = [
      { id: 'store-1', name: 'Renamed Branch' },
      { id: 'store-new', name: 'New Branch' },
    ];

    expect(buildWorkspaceTopologyNodes(
      [savedLegacy, deleted, warehouse],
      [instance({ instanceId: 'workspace-1' })],
      locations,
      snap,
    )).toEqual([
      { ...savedLegacy, name: 'Renamed Branch', storeProfileId: 'store-1' },
      warehouse,
      {
        id: 'store-new',
        type: 'store',
        name: 'New Branch',
        subtitle: 'Branch Location',
        x: 72,
        y: 144,
        storeProfileId: 'store-new',
      },
      expect.objectContaining({ id: 'workspace-1', type: 'workspace', x: 336, y: 72 }),
    ]);
  });
});
