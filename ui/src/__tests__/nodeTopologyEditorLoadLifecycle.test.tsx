import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useTopologyEditorLoadLifecycle } from '../features/locations/nodeTopologyEditorLoadLifecycle';
import { loadTopology, type TopologyData } from '@/api/topology';
import type {
  BranchLocationSeed,
  TopologyNodeData,
  TopologyWireData,
  WorkspaceInstanceSeed,
} from '../features/locations/NodeTopologyEditor';

vi.mock('@/api/topology', () => ({
  // Default: a promise that never settles, so light-merge tests can assert
  // rerender behavior without the mount load landing mid-assertion. Tests
  // that need a settled load queue mockResolvedValueOnce for the call they
  // care about (mount loads stay pending unless explicitly resolved).
  loadTopology: vi.fn(() => new Promise(() => {})),
}));

const mockLoadTopology = vi.mocked(loadTopology);

const snap = (value: number) => Math.round(value / 24) * 24;

const workspaceNode = (id: string, name: string): TopologyNodeData => ({
  id,
  type: 'workspace',
  name,
  x: 0,
  y: 0,
});

const instance = (id: string, name: string): WorkspaceInstanceSeed => ({
  instanceId: id,
  typeKey: 'store-pos',
  name,
});

const savedPayload = {
  revision: 7,
  nodes: [
    { id: 'loc-1', type: 'store', name: 'Saved Store', x: 24, y: 48 },
    { id: 'ws-1', type: 'workspace', name: 'Saved WS', x: 96, y: 120 },
  ],
  wires: [
    { id: 'w1', from_node_id: 'loc-1', to_node_id: 'ws-1', direction: 'one-way' },
    { id: 'w2', from_node_id: 'loc-1', to_node_id: 'ghost', direction: 'one-way' },
  ],
};

type LifecycleProps = {
  workspaceInstances?: WorkspaceInstanceSeed[];
  branchLocations?: BranchLocationSeed[];
  branchId?: string;
  skipNext?: boolean;
};

function renderLifecycle(initial: LifecycleProps = {}) {
  const deps = {
    skipNextLoadRef: { current: false } as MutableRefObject<boolean>,
    migrationDismissedRef: { current: true } as MutableRefObject<boolean>,
    nodesRef: {
      current: [
        workspaceNode('ws-1', 'WS One'),
        { id: 'loc-1', type: 'store', name: 'Store', x: 0, y: 0, storeProfileId: 'loc-1' } as TopologyNodeData,
      ],
    } as MutableRefObject<TopologyNodeData[]>,
    wiresRef: {
      current: [
        { id: 'w1', fromNodeId: 'loc-1', toNodeId: 'ws-1', direction: 'one-way', fromPort: 'right', toPort: 'left' },
        { id: 'w2', fromNodeId: 'loc-2', toNodeId: 'ws-1', direction: 'reverse', fromPort: 'right', toPort: 'left' },
      ] as TopologyWireData[],
    } as MutableRefObject<TopologyWireData[]>,
    setNodes: vi.fn(),
    setWires: vi.fn(),
    setHistory: vi.fn(),
    setRedo: vi.fn(),
    setResolvedIssues: vi.fn(),
    cancelConnection: vi.fn(),
    setHoveredTarget: vi.fn(),
    clearHover: vi.fn(),
    commitSnapshot: vi.fn(),
    resetTransientCanvasState: vi.fn(),
    loadSuccess: vi.fn(),
    loadFailure: vi.fn(),
    onLoadSuccess: vi.fn(),
    onLoadError: vi.fn(),
    addToast: vi.fn(),
    l10n: { getString: vi.fn((key: string) => `L10N:${key}`) },
  };

  const view = renderHook((props: LifecycleProps) => {
    // Mirror the editor: the skip ref is editor-owned and written before the
    // save-triggered reload lands; here it is synced from props each render.
    deps.skipNextLoadRef.current = props.skipNext ?? false;
    useTopologyEditorLoadLifecycle({
      workspaceInstances: props.workspaceInstances,
      branchLocations: props.branchLocations,
      branchId: props.branchId,
      reloadKey: 0,
      skipNextLoadRef: deps.skipNextLoadRef,
      migrationDismissedRef: deps.migrationDismissedRef,
      nodesRef: deps.nodesRef,
      wiresRef: deps.wiresRef,
      setNodes: deps.setNodes as Dispatch<SetStateAction<TopologyNodeData[]>>,
      setWires: deps.setWires as Dispatch<SetStateAction<TopologyWireData[]>>,
      setHistory: deps.setHistory,
      setRedo: deps.setRedo,
      setResolvedIssues: deps.setResolvedIssues,
      cancelConnection: deps.cancelConnection,
      setHoveredTarget: deps.setHoveredTarget,
      clearHover: deps.clearHover,
      commitSnapshot: deps.commitSnapshot,
      resetTransientCanvasState: deps.resetTransientCanvasState,
      loadSuccess: deps.loadSuccess,
      loadFailure: deps.loadFailure,
      onLoadSuccess: deps.onLoadSuccess,
      onLoadError: deps.onLoadError,
      addToast: deps.addToast,
      l10n: deps.l10n,
      snap,
    });
  }, { initialProps: initial });

  return { view, deps };
}

beforeEach(() => {
  mockLoadTopology.mockReset();
  mockLoadTopology.mockImplementation(() => new Promise(() => {}));
});

describe('useTopologyEditorLoadLifecycle', () => {
  it('light-merges a branch-location rename without an authoritative load', () => {
    const locations: BranchLocationSeed[] = [{ id: 'loc-1', name: 'Old Name' }];
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const { view, deps } = renderLifecycle({ branchLocations: locations, workspaceInstances: instances });

    view.rerender({ branchLocations: [{ id: 'loc-1', name: 'Renamed Branch' }], workspaceInstances: instances });

    // Only the mount load fired (pending); the rename must NOT reload.
    expect(mockLoadTopology).toHaveBeenCalledTimes(1);
    expect(deps.setNodes).toHaveBeenCalledWith([
      workspaceNode('ws-1', 'WS One'),
      { id: 'loc-1', type: 'store', name: 'Renamed Branch', x: 0, y: 0, storeProfileId: 'loc-1' },
    ]);
    // No removals: wires pass through untouched and no transient reset fires.
    expect(deps.setWires).toHaveBeenCalledWith(deps.wiresRef.current);
    expect(deps.cancelConnection).not.toHaveBeenCalled();
    expect(deps.clearHover).not.toHaveBeenCalled();
  });

  it('drops deleted branch cards, their wires, and in-flight transient state', () => {
    const locations: BranchLocationSeed[] = [{ id: 'loc-1', name: 'A' }, { id: 'loc-2', name: 'B' }];
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const { view, deps } = renderLifecycle({ branchLocations: locations, workspaceInstances: instances });

    view.rerender({ branchLocations: [{ id: 'loc-1', name: 'A' }], workspaceInstances: instances });

    expect(mockLoadTopology).toHaveBeenCalledTimes(1);
    expect(deps.setNodes).toHaveBeenCalledWith([
      workspaceNode('ws-1', 'WS One'),
      { id: 'loc-1', type: 'store', name: 'A', x: 0, y: 0, storeProfileId: 'loc-1' },
    ]);
    // The wire anchored to the removed branch card goes with it.
    expect(deps.setWires).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'w1' }),
    ]);
    expect(deps.cancelConnection).toHaveBeenCalledTimes(1);
    expect(deps.setHoveredTarget).toHaveBeenCalledWith(null);
    expect(deps.clearHover).toHaveBeenCalledTimes(1);
  });

  it('merges workspace names without reloading when the instance id set is identical', () => {
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const { view, deps } = renderLifecycle({ workspaceInstances: instances });

    view.rerender({ workspaceInstances: [instance('ws-1', 'Fresh Name')] });

    expect(mockLoadTopology).toHaveBeenCalledTimes(1);
    expect(deps.setNodes).toHaveBeenCalledWith([
      workspaceNode('ws-1', 'Fresh Name'),
      { id: 'loc-1', type: 'store', name: 'Store', x: 0, y: 0, storeProfileId: 'loc-1' },
    ]);
    expect(deps.commitSnapshot).not.toHaveBeenCalled();
  });

  it('rebuilds the canvas from the saved diagram on a structural instance change', async () => {
    // Mount load stays pending; the rerender load resolves.
    mockLoadTopology.mockImplementationOnce(() => new Promise(() => {}));
    mockLoadTopology.mockResolvedValueOnce(savedPayload);
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const locations: BranchLocationSeed[] = [{ id: 'loc-1', name: 'A' }];
    const { view, deps } = renderLifecycle({ workspaceInstances: instances, branchLocations: locations });

    view.rerender({ workspaceInstances: [instance('ws-1', 'WS One'), instance('ws-2', 'WS Two')], branchLocations: locations });

    await waitFor(() => expect(deps.commitSnapshot).toHaveBeenCalledTimes(1));
    expect(deps.onLoadSuccess).toHaveBeenCalledTimes(1);
    expect(deps.loadSuccess).toHaveBeenCalledWith(7);
    expect(deps.setHistory).toHaveBeenLastCalledWith([]);
    expect(deps.setRedo).toHaveBeenLastCalledWith([]);
    expect(deps.resetTransientCanvasState).toHaveBeenCalledTimes(1);
    // A fresh load re-arms the legacy-schema migration dialog.
    expect(deps.migrationDismissedRef.current).toBe(false);
    // Saved store keeps canonical identity and adopts the live name; the
    // archive-respecting rebuild adds ws-2 without resurrecting ghosts.
    expect(deps.setNodes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'loc-1', type: 'store', name: 'A' }),
      expect.objectContaining({ id: 'ws-1', name: 'WS One' }),
      expect.objectContaining({ id: 'ws-2', name: 'WS Two' }),
    ]);
    // The dangling persisted wire (ghost endpoint) is filtered; w1 survives.
    expect(deps.setWires).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'w1', fromNodeId: 'loc-1', toNodeId: 'ws-1' }),
    ]);
  });

  it('skips the rebuild after our own save and only marks persisted flags', async () => {
    mockLoadTopology.mockImplementationOnce(() => new Promise(() => {}));
    mockLoadTopology.mockResolvedValueOnce(savedPayload);
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const locations: BranchLocationSeed[] = [{ id: 'loc-1', name: 'A' }];
    const { view, deps } = renderLifecycle({ workspaceInstances: instances, branchLocations: locations });

    view.rerender({ workspaceInstances: [instance('ws-1', 'WS One'), instance('ws-2', 'WS Two')], branchLocations: locations, skipNext: true });

    await waitFor(() => expect(deps.setNodes).toHaveBeenCalledTimes(1));
    const updater = deps.setNodes.mock.calls[0]![0] as (prev: TopologyNodeData[]) => TopologyNodeData[];
    const result = updater([workspaceNode('ws-1', 'Live Edit')]);
    expect(result).toEqual([
      { id: 'ws-1', type: 'workspace', name: 'Live Edit', x: 0, y: 0, metadata: { persisted: true } },
    ]);
    // The skip path must not reset transient state or touch wires/history.
    expect(deps.resetTransientCanvasState).not.toHaveBeenCalled();
    expect(deps.commitSnapshot).not.toHaveBeenCalled();
  });

  it('clears the canvas for an explicitly unassigned branch', async () => {
    // The unassigned path needs the empty seed lists to hold across renders
    // (a fresh install with the last branch deleted), so the initial props
    // are already empty and the null load resolves on mount.
    mockLoadTopology.mockResolvedValueOnce(null);
    const { deps } = renderLifecycle({ branchId: 'unassigned', workspaceInstances: [], branchLocations: [] });

    await waitFor(() => expect(deps.setNodes).toHaveBeenLastCalledWith([]));
    expect(deps.setWires).toHaveBeenLastCalledWith([]);
    expect(deps.commitSnapshot).toHaveBeenLastCalledWith({ nodes: [], wires: [] });
    expect(deps.resetTransientCanvasState).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit empty canvas when seeds are supplied but nothing is saved', async () => {
    mockLoadTopology.mockResolvedValueOnce(null);
    const { deps } = renderLifecycle({ workspaceInstances: [], branchLocations: [] });

    await waitFor(() => expect(deps.setNodes).toHaveBeenCalledWith([]));
    expect(deps.setWires).toHaveBeenCalledWith([]);
    expect(deps.commitSnapshot).toHaveBeenCalledWith({ nodes: [], wires: [] });
  });

  it('keeps the standalone preset when seeds were never supplied and nothing is saved', async () => {
    mockLoadTopology.mockResolvedValueOnce(null);
    const { deps } = renderLifecycle({});

    await waitFor(() => expect(deps.onLoadSuccess).toHaveBeenCalledTimes(1));
    expect(deps.setNodes).not.toHaveBeenCalled();
    expect(deps.commitSnapshot).not.toHaveBeenCalled();
  });

  it('applies the legacy saved diagram verbatim when seeds were never supplied', async () => {
    mockLoadTopology.mockResolvedValueOnce(savedPayload);
    const { deps } = renderLifecycle({});

    await waitFor(() => expect(deps.commitSnapshot).toHaveBeenCalledTimes(1));
    expect(deps.setNodes).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'loc-1', name: 'Saved Store', x: 24, y: 48 }),
      expect.objectContaining({ id: 'ws-1', name: 'Saved WS' }),
    ]);
    // The legacy path has no valid-id filter: both persisted wires map.
    expect(deps.setWires).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'w1' }),
      expect.objectContaining({ id: 'w2' }),
    ]);
    expect(deps.resetTransientCanvasState).toHaveBeenCalledTimes(1);
  });

  it('toasts the localized load-error category, reports the raw error, and locks the lifecycle', async () => {
    const boom = new Error('corrupt topology');
    mockLoadTopology.mockRejectedValueOnce(boom);
    const { deps } = renderLifecycle({ workspaceInstances: [instance('ws-1', 'WS One')] });

    await waitFor(() => expect(deps.onLoadError).toHaveBeenCalledWith(boom));
    expect(deps.addToast).toHaveBeenCalledTimes(1);
    expect(deps.addToast.mock.calls[0]![0].message).toContain('L10N:topology-toast-load-error');
    // ERR-06: the raw backend message must never reach the toast copy.
    expect(deps.addToast.mock.calls[0]![0].message).not.toContain('corrupt topology');
    expect(deps.loadFailure).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale load that settles after a branch switch', async () => {
    let releaseFirst: ((value: TopologyData | null) => void) | undefined;
    mockLoadTopology.mockImplementationOnce(() => new Promise<TopologyData | null>((resolve) => { releaseFirst = resolve; }));
    mockLoadTopology.mockResolvedValueOnce(null);
    const instances: WorkspaceInstanceSeed[] = [instance('ws-1', 'WS One')];
    const { view, deps } = renderLifecycle({ branchId: 'branch-a', workspaceInstances: instances });

    // Branch switch re-runs the effect with fresh seeds; the second load
    // settles and replaces the canvas.
    view.rerender({ branchId: 'branch-b', workspaceInstances: instances });
    await waitFor(() => expect(deps.commitSnapshot).toHaveBeenCalledTimes(1));
    const setNodesCallsAfterSwitch = deps.setNodes.mock.calls.length;

    // The abandoned first load must not touch the canvas when it settles.
    releaseFirst?.(savedPayload);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.setNodes.mock.calls.length).toBe(setNodesCallsAfterSwitch);
    expect(deps.commitSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.onLoadSuccess).toHaveBeenCalledTimes(1);
  });
});
