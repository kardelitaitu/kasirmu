import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTopologyEditorHover,
  topologyHoverReducer,
  initialTopologyHoverState,
  type TopologyHoverState,
} from '@/features/locations/nodeTopologyEditorHoverState';

describe('useTopologyEditorHover', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorHover> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorHover());
  });

  it('initializes with no hover', () => {
    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.wireId).toBeNull();
  });

  it('hoverNode with id sets node hover and clears wire hover', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
    });

    expect(hook.result.current.nodeId).toBe('n1');
    expect(hook.result.current.wireId).toBeNull();
  });

  it('hoverNode with null clears node hover but keeps wire hover', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.hoverNode(null);
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.wireId).toBe('w1');
  });

  it('hoverWire with id sets wire hover and clears node hover', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
    });

    expect(hook.result.current.wireId).toBe('w1');
    expect(hook.result.current.nodeId).toBeNull();
  });

  it('hoverWire with null clears wire hover but keeps node hover', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
    });

    act(() => {
      hook.result.current.hoverWire(null);
    });

    expect(hook.result.current.wireId).toBeNull();
    expect(hook.result.current.nodeId).toBe('n1');
  });

  it('clearHover clears both', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.clearHover();
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.wireId).toBeNull();
  });

  it('pruneHover removes invalid node id', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
    });

    act(() => {
      hook.result.current.pruneHover(new Set(['n2']), new Set());
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.wireId).toBeNull();
  });

  it('pruneHover keeps valid node id', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
    });

    act(() => {
      hook.result.current.pruneHover(new Set(['n1', 'n2']), new Set());
    });

    expect(hook.result.current.nodeId).toBe('n1');
  });

  it('pruneHover removes invalid wire id', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.pruneHover(new Set(), new Set(['w2']));
    });

    expect(hook.result.current.wireId).toBeNull();
  });

  it('pruneHover keeps valid wire id', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.pruneHover(new Set(), new Set(['w1', 'w2']));
    });

    expect(hook.result.current.wireId).toBe('w1');
  });

  it('pruneHover removes both when both invalid', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.pruneHover(new Set(['n2']), new Set(['w2']));
    });

    expect(hook.result.current.nodeId).toBeNull();
    expect(hook.result.current.wireId).toBeNull();
  });

  it('hoverNode replaces existing node hover', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
      hook.result.current.hoverNode('n2');
    });

    expect(hook.result.current.nodeId).toBe('n2');
    expect(hook.result.current.wireId).toBeNull();
  });

  it('hoverWire replaces existing wire hover', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
      hook.result.current.hoverWire('w2');
    });

    expect(hook.result.current.wireId).toBe('w2');
    expect(hook.result.current.nodeId).toBeNull();
  });

  it('functional updater for hoverNode receives current value', () => {
    act(() => {
      hook.result.current.hoverNode('n1');
    });

    act(() => {
      hook.result.current.hoverNode((prev: string | null) => (prev === 'n1' ? 'n2' : prev));
    });

    expect(hook.result.current.nodeId).toBe('n2');
  });

  it('functional updater for hoverWire receives current value', () => {
    act(() => {
      hook.result.current.hoverWire('w1');
    });

    act(() => {
      hook.result.current.hoverWire((prev: string | null) => (prev === 'w1' ? 'w2' : prev));
    });

    expect(hook.result.current.wireId).toBe('w2');
  });
});

describe('topologyHoverReducer (unit)', () => {
  it('hover-node with id sets node and clears wire', () => {
    const state = topologyHoverReducer(initialTopologyHoverState, { type: 'hover-node', id: 'n1' });
    expect(state).toEqual({ nodeId: 'n1', wireId: null });
  });

  it('hover-node with null clears node and keeps wire', () => {
    const withWire: TopologyHoverState = { nodeId: null, wireId: 'w1' };
    const state = topologyHoverReducer(withWire, { type: 'hover-node', id: null });
    expect(state).toEqual({ nodeId: null, wireId: 'w1' });
  });

  it('hover-wire with id sets wire and clears node', () => {
    const state = topologyHoverReducer(initialTopologyHoverState, { type: 'hover-wire', id: 'w1' });
    expect(state).toEqual({ nodeId: null, wireId: 'w1' });
  });

  it('hover-wire with null clears wire and keeps node', () => {
    const withNode: TopologyHoverState = { nodeId: 'n1', wireId: null };
    const state = topologyHoverReducer(withNode, { type: 'hover-wire', id: null });
    expect(state).toEqual({ nodeId: 'n1', wireId: null });
  });

  it('clear-hover clears both', () => {
    const withBoth: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withBoth, { type: 'clear-hover' });
    expect(state).toEqual({ nodeId: null, wireId: null });
  });

  it('prune keeps valid node and wire', () => {
    const withBoth: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withBoth, {
      type: 'prune',
      validNodeIds: new Set(['n1', 'n2']),
      validWireIds: new Set(['w1', 'w2']),
    });
    expect(state).toEqual({ nodeId: 'n1', wireId: 'w1' });
  });

  it('prune removes invalid node', () => {
    const withNode: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withNode, {
      type: 'prune',
      validNodeIds: new Set(['n2']),
      validWireIds: new Set(['w1']),
    });
    expect(state).toEqual({ nodeId: null, wireId: 'w1' });
  });

  it('prune removes invalid wire', () => {
    const withBoth: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withBoth, {
      type: 'prune',
      validNodeIds: new Set(['n1']),
      validWireIds: new Set(['w2']),
    });
    expect(state).toEqual({ nodeId: 'n1', wireId: null });
  });

  it('prune removes both when both invalid', () => {
    const withBoth: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withBoth, {
      type: 'prune',
      validNodeIds: new Set(['n2']),
      validWireIds: new Set(['w2']),
    });
    expect(state).toEqual({ nodeId: null, wireId: null });
  });

  it('prune returns same state if nothing changed', () => {
    const withBoth: TopologyHoverState = { nodeId: 'n1', wireId: 'w1' };
    const state = topologyHoverReducer(withBoth, {
      type: 'prune',
      validNodeIds: new Set(['n1']),
      validWireIds: new Set(['w1']),
    });
    expect(state).toEqual(withBoth);
  });
});