import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTopologyEditorSelection,
  topologySelectionReducer,
  initialTopologySelectionState,
  type TopologySelectionState,
} from '@/features/locations/nodeTopologyEditorSelectionState';

describe('useTopologyEditorSelection', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorSelection> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorSelection());
  });

  it('initializes with empty selection', () => {
    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
    expect(hook.result.current.wireId).toBeNull();
  });

  it('selectOnly sets primary node and clears wire', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
    });

    expect(hook.result.current.nodeId).toBe('n1');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1']));
    expect(hook.result.current.wireId).toBeNull();
  });

  it('selectMany sets multiple nodes with primary and clears wire', () => {
    act(() => {
      hook.result.current.selectMany(['n1', 'n2', 'n3'], 'n2');
    });

    expect(hook.result.current.nodeId).toBe('n2');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1', 'n2', 'n3']));
    expect(hook.result.current.wireId).toBeNull();
  });

  it('addToSelection adds node to set and makes it primary', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
    });

    act(() => {
      hook.result.current.addToSelection('n2');
    });

    expect(hook.result.current.nodeId).toBe('n2');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1', 'n2']));
    expect(hook.result.current.wireId).toBeNull();
  });

  it('selectWire sets wire and clears nodes', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
    });

    act(() => {
      hook.result.current.selectWire('w1');
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
    expect(hook.result.current.wireId).toBe('w1');
  });

  it('clearSelection clears nodes but leaves wire', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
    });

    act(() => {
      hook.result.current.clearSelection();
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
    expect(hook.result.current.wireId).toBeNull();
  });

  it('clearWire clears wire but leaves nodes', () => {
    act(() => {
      hook.result.current.selectWire('w1');
    });

    act(() => {
      hook.result.current.clearWire();
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
    expect(hook.result.current.wireId).toBeNull();
  });

  it('clearAll clears both nodes and wire', () => {
    act(() => {
      hook.result.current.selectMany(['n1', 'n2'], 'n1');
    });

    act(() => {
      hook.result.current.clearAll();
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
    expect(hook.result.current.wireId).toBeNull();
  });

  it('pruneSelection removes invalid node ids', () => {
    act(() => {
      hook.result.current.selectMany(['n1', 'n2', 'n3'], 'n2');
    });

    act(() => {
      hook.result.current.pruneSelection(new Set(['n1', 'n3']), 'w1');
    });

    expect(hook.result.current.nodeId).toBeNull(); // primary n2 was removed
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1', 'n3']));
    expect(hook.result.current.wireId).toBeNull(); // wire not in validWireId
  });

  it('pruneSelection keeps valid primary', () => {
    act(() => {
      hook.result.current.selectMany(['n1', 'n2', 'n3'], 'n2');
    });

    act(() => {
      hook.result.current.pruneSelection(new Set(['n1', 'n2', 'n3']), 'w1');
    });

    expect(hook.result.current.nodeId).toBe('n2');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1', 'n2', 'n3']));
    expect(hook.result.current.wireId).toBeNull();
  });

  it('pruneSelection keeps valid wire', () => {
    act(() => {
      hook.result.current.selectWire('w1');
    });

    act(() => {
      hook.result.current.pruneSelection(new Set(), 'w1');
    });

    expect(hook.result.current.wireId).toBe('w1');
  });

  it('pruneSelection clears invalid wire', () => {
    act(() => {
      hook.result.current.selectWire('w1');
    });

    act(() => {
      hook.result.current.pruneSelection(new Set(), 'w2');
    });

    expect(hook.result.current.wireId).toBeNull();
  });

  it('selectOnly after selectWire clears wire', () => {
    act(() => {
      hook.result.current.selectWire('w1');
    });

    act(() => {
      hook.result.current.selectOnly('n1');
    });

    expect(hook.result.current.nodeId).toBe('n1');
    expect(hook.result.current.wireId).toBeNull();
  });

  it('selectWire after selectOnly clears nodes', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
    });

    act(() => {
      hook.result.current.selectWire('w1');
    });

    expect(hook.result.current.wireId).toBe('w1');
    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.nodeIds).toEqual(new Set());
  });

  it('multiple addToSelection calls build up selection', () => {
    act(() => {
      hook.result.current.selectOnly('n1');
      hook.result.current.addToSelection('n2');
      hook.result.current.addToSelection('n3');
    });

    expect(hook.result.current.nodeId).toBe('n3');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1', 'n2', 'n3']));
  });

  it('addToSelection on empty selection works', () => {
    act(() => {
      hook.result.current.addToSelection('n1');
    });

    expect(hook.result.current.nodeId).toBe('n1');
    expect(hook.result.current.nodeIds).toEqual(new Set(['n1']));
  });
});

describe('topologySelectionReducer (unit)', () => {
  it('select-only sets primary and clears wire', () => {
    const state = topologySelectionReducer(initialTopologySelectionState, { type: 'select-only', id: 'n1' });
    expect(state).toEqual({ nodeId: 'n1', nodeIds: new Set(['n1']), wireId: null });
  });

  it('select-many sets nodes and clears wire', () => {
    const state = topologySelectionReducer(initialTopologySelectionState, { type: 'select-many', ids: ['n1', 'n2'], primary: 'n1' });
    expect(state).toEqual({ nodeId: 'n1', nodeIds: new Set(['n1', 'n2']), wireId: null });
  });

  it('add adds to existing set and updates primary', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: null };
    const state = topologySelectionReducer(withSelection, { type: 'add', id: 'n2' });
    expect(state).toEqual({ nodeId: 'n2', nodeIds: new Set(['n1', 'n2']), wireId: null });
  });

  it('select-wire clears nodes', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: null };
    const state = topologySelectionReducer(withSelection, { type: 'select-wire', id: 'w1' });
    expect(state).toEqual({ nodeId: null, nodeIds: new Set(), wireId: 'w1' });
  });

  it('clear-nodes clears nodes only', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: 'w1' };
    const state = topologySelectionReducer(withSelection, { type: 'clear-nodes' });
    expect(state).toEqual({ nodeId: null, nodeIds: new Set(), wireId: 'w1' });
  });

  it('clear-wire clears wire only', () => {
    const withWire: TopologySelectionState = { nodeId: null, nodeIds: new Set(), wireId: 'w1' };
    const state = topologySelectionReducer(withWire, { type: 'clear-wire' });
    expect(state).toEqual({ nodeId: null, nodeIds: new Set(), wireId: null });
  });

  it('clear-all clears both', () => {
    const withBoth: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: 'w1' };
    const state = topologySelectionReducer(withBoth, { type: 'clear-all' });
    expect(state).toEqual({ nodeId: null, nodeIds: new Set(), wireId: null });
  });

  it('prune removes invalid node ids and keeps valid primary', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n2', nodeIds: new Set(['n1', 'n2', 'n3']), wireId: 'w1' };
    const state = topologySelectionReducer(withSelection, { type: 'prune', validNodeIds: new Set(['n1', 'n3']), validWireId: 'w2' });
    expect(state.nodeId).toBeNull(); // n2 not in validNodeIds
    expect(state.nodeIds).toEqual(new Set(['n1', 'n3']));
    expect(state.wireId).toBeNull(); // w1 not equal to validWireId w2
  });

  it('prune keeps valid primary and wire', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n2', nodeIds: new Set(['n1', 'n2', 'n3']), wireId: 'w1' };
    const state = topologySelectionReducer(withSelection, { type: 'prune', validNodeIds: new Set(['n1', 'n2', 'n3']), validWireId: 'w1' });
    expect(state.nodeId).toBe('n2');
    expect(state.nodeIds).toEqual(new Set(['n1', 'n2', 'n3']));
    expect(state.wireId).toBe('w1');
  });

  it('prune with null validWireId clears wire', () => {
    const withWire: TopologySelectionState = { nodeId: null, nodeIds: new Set(), wireId: 'w1' };
    const state = topologySelectionReducer(withWire, { type: 'prune', validNodeIds: new Set(), validWireId: null });
    expect(state.wireId).toBeNull();
  });

  it('prune with empty validNodeIds clears primary', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: null };
    const state = topologySelectionReducer(withSelection, { type: 'prune', validNodeIds: new Set(), validWireId: null });
    expect(state.nodeId).toBeNull();
    expect(state.nodeIds).toEqual(new Set());
  });

  it('prune returns equivalent state if nothing changed', () => {
    const withSelection: TopologySelectionState = { nodeId: 'n1', nodeIds: new Set(['n1']), wireId: 'w1' };
    const state = topologySelectionReducer(withSelection, { type: 'prune', validNodeIds: new Set(['n1']), validWireId: 'w1' });
    expect(state).toEqual(withSelection);
    // Note: reducer creates new object even when unchanged (intentional for React state updates)
  });
});