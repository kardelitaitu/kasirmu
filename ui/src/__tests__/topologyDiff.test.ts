// ── computeTopologyDiff unit tests ─────────────────────────────────
//
// Pins the workspace-instance diff semantics TopologyScreen builds when
// the editor applies: create/update/archive vectors, store_id resolution
// (semantic Branch Location parent, KDS operation-source recursion, and
// the legacy store-node compatibility boundary), and the typeKey-change
// archive+recreate (Critical #1). TopologyScreen.test.tsx covers the same
// behavior end-to-end through the onSave callback; this suite pins the
// pure function the handler delegates to, so a change to the diff logic
// fails here first instead of only at the screen boundary.

import { describe, expect, it } from 'vitest';
import { computeTopologyDiff, planTopologyDiff, summarizeTopologyPlan } from '@/features/locations/topologyDiff';
import type { TopologyNodeData, TopologyWireData } from '@/features/locations/NodeTopologyEditor';
import type { WorkspaceDto } from '@/api/workspaces';

// ── Fixtures ──────────────────────────────────────────────────────

const loadedInstances: WorkspaceDto[] = [
  {
    instance_id: 'ws-existing',
    type_key: 'store-pos',
    store_id: 'store-1',
    store_name: 'Main Street',
    purpose_key: 'checkout',
    name: 'Front Register',
    description: 'Old desc',
    icon: 'pos',
    layout_mode: 'sidebar',
    colour: null,
    is_default: false,
  },
];

const stores = [
  { id: 'store-1', name: 'Main Street', is_primary: true, address: '', tax_id: '', currency: 'USD', timezone: 'UTC', created_at: '', updated_at: '' },
];

function wsNode(overrides: Partial<TopologyNodeData> = {}): TopologyNodeData {
  return {
    id: 'ws-1',
    type: 'workspace',
    name: 'POS #1',
    x: 0,
    y: 0,
    metadata: { typeKey: 'store-pos', purposeKey: 'general' },
    ...overrides,
  };
}

function storeNode(overrides: Partial<TopologyNodeData> = {}): TopologyNodeData {
  return {
    id: 'store-1',
    type: 'store',
    name: 'Main Street',
    storeProfileId: 'store-1',
    x: 0,
    y: 0,
    ...overrides,
  };
}

function locationWire(fromNodeId: string, toNodeId: string, id = 'location-wire'): TopologyWireData {
  return {
    id,
    fromNodeId,
    fromPort: 'right',
    fromPortId: 'location-out',
    toNodeId,
    toPort: 'left',
    toPortId: 'location-in',
    relationshipType: 'location',
    direction: 'one-way',
  };
}

function kdsOperationWire(fromNodeId: string, toNodeId: string, id: string): TopologyWireData {
  return {
    id,
    fromNodeId,
    fromPort: 'right',
    fromPortId: 'operation-out',
    toNodeId,
    toPort: 'left',
    toPortId: 'operation-in',
    relationshipType: 'generic',
    direction: 'one-way',
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('computeTopologyDiff', () => {
  it('creates a new workspace node with store_id resolved from its location wire', () => {
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
        wsNode({ id: 'ws-new', name: 'New Register', metadata: { typeKey: 'store-pos', persisted: false } }),
      ],
      wires: [locationWire('store-1', 'ws-existing', 'w-existing'), locationWire('store-1', 'ws-new', 'w-new')],
      workspaceInstances: loadedInstances,
      stores,
    });

    expect(diff.creations).toHaveLength(1);
    expect(diff.creations[0]).toEqual({
      id: 'ws-new',
      type_key: 'store-pos',
      purpose_key: 'general',
      store_id: 'store-1',
      name: 'New Register',
    });
    expect(diff.updates).toHaveLength(0);
    expect(diff.archives).toHaveLength(0);
    expect(diff.typeChanges.size).toBe(0);
    expect(diff.idMap).toEqual({});
  });

  it('updates a renamed workspace, merging purpose_key from the backend instance', () => {
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Renamed Register', metadata: { typeKey: 'store-pos', persisted: true } }),
      ],
      wires: [locationWire('store-1', 'ws-existing')],
      workspaceInstances: loadedInstances,
      stores,
    });

    expect(diff.updates).toEqual([{ id: 'ws-existing', name: 'Renamed Register', purpose_key: 'checkout' }]);
    expect(diff.creations).toHaveLength(0);
    expect(diff.archives).toHaveLength(0);
  });

  it('prefers the inspector purposeKey over the backend purpose_key on update', () => {
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', purposeKey: 'kitchen', persisted: true } }),
      ],
      wires: [locationWire('store-1', 'ws-existing')],
      workspaceInstances: loadedInstances,
      stores,
    });

    expect(diff.updates).toEqual([{ id: 'ws-existing', name: 'Front Register', purpose_key: 'kitchen' }]);
  });

  it('archives instances that were removed from the canvas', () => {
    const diff = computeTopologyDiff({
      nodes: [storeNode()],
      wires: [],
      workspaceInstances: loadedInstances,
      stores,
    });

    expect(diff.archives).toEqual(['ws-existing']);
    expect(diff.creations).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
  });

  it('produces an empty diff when the canvas matches the loaded instances', () => {
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } }),
      ],
      wires: [locationWire('store-1', 'ws-existing')],
      workspaceInstances: loadedInstances,
      stores,
    });

    expect(diff.creations).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
    expect(diff.archives).toHaveLength(0);
  });

  it('archives and recreates a workspace whose typeKey changed (Critical #1)', () => {
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
      ],
      wires: [locationWire('store-1', 'ws-existing')],
      workspaceInstances: loadedInstances,
      stores,
      makeId: () => 'ws-fresh',
    });

    expect(diff.archives).toEqual(['ws-existing']);
    expect(diff.creations).toEqual([
      { id: 'ws-fresh', type_key: 'restaurant-pos', purpose_key: 'general', store_id: 'store-1', name: 'Front Register' },
    ]);
    expect(diff.updates).toHaveLength(0);
    expect(diff.idMap).toEqual({ 'ws-existing': 'ws-fresh' });
    expect(diff.typeChanges.get('ws-existing')).toEqual({ newId: 'ws-fresh', newTypeKey: 'restaurant-pos' });
  });

  it('archives and recreates on type change even when the name also changed', () => {
    // A type change is a full archive+recreate — the new name rides the
    // creation and no separate update may be emitted (double mutation).
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'ws-existing', name: 'Bar POS', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
      ],
      wires: [locationWire('store-1', 'ws-existing')],
      workspaceInstances: loadedInstances,
      stores,
      makeId: () => 'ws-fresh',
    });

    expect(diff.archives).toEqual(['ws-existing']);
    expect(diff.creations).toHaveLength(1);
    expect(diff.creations[0]!.name).toBe('Bar POS');
    expect(diff.updates).toHaveLength(0);
  });

  it('resolves a KDS workspace scope through its POS operation source', () => {
    // The POS is an existing backend instance (restaurant-pos); the KDS is
    // new. The KDS has no Branch Location parent — its store scope must
    // be inherited by following the operation feed back to the POS.
    const posInstance: WorkspaceDto = {
      ...loadedInstances[0]!,
      instance_id: 'pos',
      type_key: 'restaurant-pos',
      name: 'Resto POS',
    };
    const diff = computeTopologyDiff({
      nodes: [
        storeNode(),
        wsNode({ id: 'pos', name: 'Resto POS', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
        wsNode({ id: 'kds', name: 'Kitchen Display', metadata: { typeKey: 'kds', persisted: false } }),
      ],
      wires: [locationWire('store-1', 'pos', 'w-loc'), kdsOperationWire('pos', 'kds', 'w-op')],
      workspaceInstances: [...loadedInstances, posInstance],
      stores,
    });

    expect(diff.creations).toHaveLength(1);
    expect(diff.creations[0]!.id).toBe('kds');
    expect(diff.creations[0]!.type_key).toBe('kds');
    expect(diff.creations[0]!.store_id).toBe('store-1');
  });

  it('resolves store_id from a legacy store node when the store profile is known', () => {
    // The compatibility boundary: a store node with no storeProfileId and
    // no semantic identity still resolves through the connected store node
    // id — but only when that id is a real store profile (never a name).
    const legacyStore: TopologyNodeData = {
      id: 'store-1',
      type: 'store',
      name: 'Main Street',
      x: 0,
      y: 0,
    };
    const diff = computeTopologyDiff({
      nodes: [
        legacyStore,
        wsNode({ id: 'ws-new', name: 'New Register', metadata: { typeKey: 'store-pos', persisted: false } }),
      ],
      wires: [locationWire('store-1', 'ws-new')],
      workspaceInstances: loadedInstances,
      stores,
    });

    const creation = diff.creations.find((c) => c.id === 'ws-new');
    expect(creation).toBeDefined();
    expect(creation!.store_id).toBe('store-1');
  });

  it('throws when a workspace node has no resolvable store ownership', () => {
    expect(() =>
      computeTopologyDiff({
        nodes: [wsNode({ id: 'ws-orphan', name: 'Orphan', metadata: { typeKey: 'store-pos', persisted: false } })],
        wires: [],
        workspaceInstances: loadedInstances,
        stores,
      }),
    ).toThrow('workspace has no semantic Branch Location ownership');
  });
});

describe('planTopologyDiff', () => {
  it('classifies a new workspace as a creation and a rename as an update', () => {
    const plan = planTopologyDiff(
      [
        wsNode({ id: 'ws-existing', name: 'Renamed Register', metadata: { typeKey: 'store-pos', persisted: true } }),
        wsNode({ id: 'ws-new', name: 'New Register', metadata: { typeKey: 'store-pos', persisted: false } }),
      ],
      loadedInstances,
    );

    expect(plan.createNodeIds).toEqual(['ws-new']);
    expect(plan.updateNodeIds).toEqual(['ws-existing']);
    expect(plan.archiveIds).toEqual([]);
    expect(plan.typeChanges.size).toBe(0);
  });

  it('is total — an orphan workspace with no store ownership still counts as a creation', () => {
    // computeTopologyDiff throws on this input (no resolvable store_id);
    // the plan needs no store_id and must never throw — the editor chip
    // previews pending creations even while the canvas is mid-wiring.
    const plan = planTopologyDiff(
      [wsNode({ id: 'ws-orphan', name: 'Orphan', metadata: { typeKey: 'store-pos', persisted: false } })],
      [],
    );

    expect(plan.createNodeIds).toEqual(['ws-orphan']);
    expect(plan.updateNodeIds).toEqual([]);
    expect(plan.archiveIds).toEqual([]);
    expect(plan.typeChanges.size).toBe(0);
  });

  it('counts a type change as one create and one archive with the replacement id', () => {
    const plan = planTopologyDiff(
      [wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } })],
      loadedInstances,
      () => 'ws-fresh',
    );

    // The create rides the node's slot; the payload id comes from the
    // typeChanges remap (ws-fresh), so the plan's count is 1 create + 1
    // archive for a single type change.
    expect(plan.createNodeIds).toEqual(['ws-existing']);
    expect(plan.archiveIds).toEqual(['ws-existing']);
    expect(plan.updateNodeIds).toEqual([]);
    expect(plan.typeChanges.get('ws-existing')).toEqual({ newId: 'ws-fresh', newTypeKey: 'restaurant-pos' });
  });

  it('archives instances missing from the canvas', () => {
    const plan = planTopologyDiff([], loadedInstances);

    expect(plan.createNodeIds).toEqual([]);
    expect(plan.updateNodeIds).toEqual([]);
    expect(plan.archiveIds).toEqual(['ws-existing']);
  });
});

describe('summarizeTopologyPlan', () => {
  it('counts a type change as a recreate — not a plain create plus archive', () => {
    // A type change archives the old instance and creates a NEW one with a
    // fresh id. The summary must surface it as typeChanged so the chip does
    // not read a destructive recreate as a routine add+remove.
    const plan = planTopologyDiff(
      [wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } })],
      loadedInstances,
      () => 'ws-fresh',
    );

    expect(summarizeTopologyPlan(plan)).toEqual({ created: 0, updated: 0, archived: 0, typeChanged: 1 });
  });

  it('separates plain creates from type-change recreates', () => {
    const plan = planTopologyDiff(
      [
        wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'restaurant-pos', persisted: true } }),
        wsNode({ id: 'ws-new', name: 'New Register', metadata: { typeKey: 'store-pos', persisted: false } }),
      ],
      loadedInstances,
      () => 'ws-fresh',
    );

    expect(summarizeTopologyPlan(plan)).toEqual({ created: 1, updated: 0, archived: 0, typeChanged: 1 });
  });

  it('separates sweep archives from type-change recreates', () => {
    const plan = planTopologyDiff([], loadedInstances, () => 'ws-fresh');

    expect(summarizeTopologyPlan(plan)).toEqual({ created: 0, updated: 0, archived: 1, typeChanged: 0 });
  });

  it('classifies a rename as an update with no recreate', () => {
    const plan = planTopologyDiff(
      [wsNode({ id: 'ws-existing', name: 'Renamed', metadata: { typeKey: 'store-pos', persisted: true } })],
      loadedInstances,
    );

    expect(summarizeTopologyPlan(plan)).toEqual({ created: 0, updated: 1, archived: 0, typeChanged: 0 });
  });

  it('is all zeros for an identical canvas', () => {
    const plan = planTopologyDiff(
      [wsNode({ id: 'ws-existing', name: 'Front Register', metadata: { typeKey: 'store-pos', persisted: true } })],
      loadedInstances,
    );

    expect(summarizeTopologyPlan(plan)).toEqual({ created: 0, updated: 0, archived: 0, typeChanged: 0 });
  });
});
