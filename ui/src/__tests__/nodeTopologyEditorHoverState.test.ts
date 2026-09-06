import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  topologyHoverReducer,
  useTopologyEditorHover,
  initialTopologyHoverState,
  type TopologyHoverState,
} from '@/features/locations/nodeTopologyEditorHoverState';

describe('topologyHoverReducer', () => {
  it('starts with no node or wire hover', () => {
    expect(initialTopologyHoverState).toEqual({
      nodeId: null,
      wireId: null,
    });
  });

  it('hover-node sets the node and atomically clears any wire hover', () => {
    const withWire: TopologyHoverState = { nodeId: null, wireId: 'w-1' };
    const next = topologyHoverReducer(withWire, { type: 'hover-node', id: 'n-1' });
    expect(next).toEqual({ nodeId: 'n-1', wireId: null });
  });

  it('hover-wire sets the wire and atomically clears any node hover', () => {
    const withNode: TopologyHoverState = { nodeId: 'n-1', wireId: null };
    const next = topologyHoverReducer(withNode, { type: 'hover-wire', id: 'w-2' });
    expect(next).toEqual({ nodeId: null, wireId: 'w-2' });
  });

  it('hover-node(null) and hover-wire(null) clear their own slot without touching the other', () => {
    const both: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-2' };
    const next = topologyHoverReducer(both, { type: 'hover-node', id: null });
    expect(next).toEqual({ nodeId: null, wireId: 'w-2' });
  });

  it('clear-hover empties both node and wire hover atomically', () => {
    const both: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-2' };
    const next = topologyHoverReducer(both, { type: 'clear-hover' });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune drops a hovered node that no longer exists', () => {
    // Regression: the prune effect clears selection and connection on node
    // removal but not hover. React does not fire mouseleave on unmount, so a
    // hovered id survives deletion; hoverConnections then stays non-null and
    // every remaining card/wire renders dimmed until the next hover.
    const stale: TopologyHoverState = { nodeId: 'n-deleted', wireId: null };
    const next = topologyHoverReducer(stale, {
      type: 'prune',
      validNodeIds: new Set(['n-1', 'n-2']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune drops a hovered wire that no longer exists', () => {
    const stale: TopologyHoverState = { nodeId: null, wireId: 'w-deleted' };
    const next = topologyHoverReducer(stale, {
      type: 'prune',
      validNodeIds: new Set(['n-1']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune keeps a hovered node and wire that still exist', () => {
    const live: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-1' };
    const next = topologyHoverReducer(live, {
      type: 'prune',
      validNodeIds: new Set(['n-1', 'n-2']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: 'n-1', wireId: 'w-1' });
  });
});

describe('useTopologyEditorHover', () => {
  it('exposes node/wire hover and the atomic transitions', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.wireId).toBeNull();

    act(() => result.current.hoverNode('n-1'));
    expect(result.current.nodeId).toBe('n-1');

    // Hovering a wire clears the node hover — the two are mutually exclusive
    // by construction (the wire ghost affordance and the node focus-mode
    // dimming cannot both be active).
    act(() => result.current.hoverWire('w-2'));
    expect(result.current.wireId).toBe('w-2');
    expect(result.current.nodeId).toBeNull();

    act(() => result.current.clearHover());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.wireId).toBeNull();
  });

  it('pruneHover drops dangling ids after a structural canvas replacement', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    act(() => result.current.hoverNode('n-deleted'));
    act(() =>
      result.current.pruneHover(new Set(['n-1']), new Set(['w-1'])),
    );
    expect(result.current.nodeId).toBeNull();
  });

  it('accepts the functional leave-updater the card/wire handlers pass', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    // Card enter: onHoverNode(node.id)
    act(() => result.current.hoverNode('n-1'));
    // Card leave: onHoverNode((prev) => (prev === node.id ? null : prev))
    act(() => result.current.hoverNode((prev) => (prev === 'n-1' ? null : prev)));
    expect(result.current.nodeId).toBeNull();
    // A leave for a DIFFERENT node must not clear the current hover (the
    // guard the child's functional updater provides).
    act(() => result.current.hoverNode('n-2'));
    act(() => result.current.hoverNode((prev) => (prev === 'n-1' ? null : prev)));
    expect(result.current.nodeId).toBe('n-2');
  });

  it('wire leave-updater only clears its own slot', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    act(() => result.current.hoverWire('w-1'));
    act(() => result.current.hoverWire((prev) => (prev === 'w-1' ? null : prev)));
    expect(result.current.wireId).toBeNull();
    act(() => result.current.hoverWire('w-2'));
    act(() => result.current.hoverWire((prev) => (prev === 'w-1' ? null : prev)));
    expect(result.current.wireId).toBe('w-2');
  });
});
