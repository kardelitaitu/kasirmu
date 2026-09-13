import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  topologySelectionReducer,
  useTopologyEditorSelection,
  initialTopologySelectionState,
  type TopologySelectionState,
} from '@/features/locations/nodeTopologyEditorSelectionState';

describe('topologySelectionReducer', () => {
  it('starts with no node or wire selection', () => {
    expect(initialTopologySelectionState).toEqual({
      nodeId: null,
      nodeIds: new Set<string>(),
      wireId: null,
    });
  });

  it('select-only selects one node and atomically clears any wire selection', () => {
    // Regression: previously selectOnly() never cleared selectedWireId, so a
    // wire could stay selected alongside a node — the toolbar Delete handler
    // checks nodes before wires and the wire-delete path became unreachable.
    const withWire: TopologySelectionState = {
      nodeId: null,
      nodeIds: new Set<string>(),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(withWire, { type: 'select-only', id: 'n-1' });
    expect(next).toEqual({ nodeId: 'n-1', nodeIds: new Set(['n-1']), wireId: null });
  });

  it('select-many replaces the set and clears the wire selection', () => {
    const next = topologySelectionReducer(initialTopologySelectionState, {
      type: 'select-many',
      ids: ['n-1', 'n-2'],
      primary: 'n-2',
    });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBe('n-2');
    expect(next.wireId).toBeNull();
  });

  it('select-many allows a null primary (select-all with no inspector target)', () => {
    const next = topologySelectionReducer(initialTopologySelectionState, {
      type: 'select-many',
      ids: ['n-1', 'n-2'],
      primary: null,
    });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBeNull();
    expect(next.wireId).toBeNull();
  });

  it('clear-all empties both node and wire selection atomically', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(base, { type: 'clear-all' });
    expect(next).toEqual({ nodeId: null, nodeIds: new Set<string>(), wireId: null });
  });

  it('clear-wire clears only the wire selection', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(base, { type: 'clear-wire' });
    expect(next.wireId).toBeNull();
    expect(next.nodeId).toBe('n-1');
    expect(next.nodeIds).toEqual(new Set(['n-1']));
  });

  it('add unions a node into the set, makes it primary, and clears the wire', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-9',
    };
    const next = topologySelectionReducer(base, { type: 'add', id: 'n-2' });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBe('n-2');
    expect(next.wireId).toBeNull();
  });

  it('select-wire selects a wire and atomically clears the node selection', () => {
    const withNode: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: null,
    };
    const next = topologySelectionReducer(withNode, { type: 'select-wire', id: 'w-2' });
    expect(next.wireId).toBe('w-2');
    expect(next.nodeId).toBeNull();
    expect(next.nodeIds.size).toBe(0);
  });

  it('clear-nodes clears the node selection but leaves the wire selection intact', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-3',
    };
    const next = topologySelectionReducer(base, { type: 'clear-nodes' });
    expect(next.nodeId).toBeNull();
    expect(next.nodeIds.size).toBe(0);
    expect(next.wireId).toBe('w-3');
  });

  it('prune drops missing nodes and the dangling primary, and clears a gone wire', () => {
    const base: TopologySelectionState = {
      nodeId: 'gone',
      nodeIds: new Set(['alive', 'gone']),
      wireId: 'dead-wire',
    };
    const next = topologySelectionReducer(base, {
      type: 'prune',
      validNodeIds: new Set(['alive']),
      validWireId: null,
    });
    expect(next.nodeIds).toEqual(new Set(['alive']));
    expect(next.nodeId).toBeNull();
    expect(next.wireId).toBeNull();
  });

  it('prune keeps a valid primary and valid wire untouched', () => {
    const base: TopologySelectionState = {
      nodeId: 'alive',
      nodeIds: new Set(['alive', 'gone']),
      wireId: 'ok-wire',
    };
    const next = topologySelectionReducer(base, {
      type: 'prune',
      validNodeIds: new Set(['alive']),
      validWireId: 'ok-wire',
    });
    expect(next.nodeIds).toEqual(new Set(['alive']));
    expect(next.nodeId).toBe('alive');
    expect(next.wireId).toBe('ok-wire');
  });
});

describe('useTopologyEditorSelection', () => {
  it('exposes the selection plus atomic helpers backed by the reducer', () => {
    const { result } = renderHook(() => useTopologyEditorSelection());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.nodeIds.size).toBe(0);
    expect(result.current.wireId).toBeNull();

    act(() => result.current.selectWire('w-1'));
    expect(result.current.wireId).toBe('w-1');
    expect(result.current.nodeIds.size).toBe(0);

    act(() => result.current.selectOnly('n-1'));
    expect(result.current.nodeId).toBe('n-1');
    // The invariant: picking a node clears the wire.
    expect(result.current.wireId).toBeNull();
  });
});
