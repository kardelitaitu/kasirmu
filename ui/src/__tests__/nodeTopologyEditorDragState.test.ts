import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  topologyDragReducer,
  useTopologyEditorDrag,
  initialTopologyDragState,
  type TopologyDragState,
} from '@/features/locations/nodeTopologyEditorDragState';

describe('topologyDragReducer', () => {
  it('starts with an empty drag set (no drag in flight)', () => {
    expect(initialTopologyDragState).toEqual({ draggingNodeIds: new Set<string>() });
  });

  it('begin arms the drag with the given ids', () => {
    const next = topologyDragReducer(initialTopologyDragState, {
      type: 'begin',
      ids: new Set(['n-1', 'n-2']),
    });
    expect(next.draggingNodeIds).toEqual(new Set(['n-1', 'n-2']));
  });

  it('end clears the drag set', () => {
    const armed: TopologyDragState = { draggingNodeIds: new Set(['n-1']) };
    const next = topologyDragReducer(armed, { type: 'end' });
    expect(next.draggingNodeIds.size).toBe(0);
  });

  it('cancel clears the drag set', () => {
    const armed: TopologyDragState = { draggingNodeIds: new Set(['n-1']) };
    const next = topologyDragReducer(armed, { type: 'cancel' });
    expect(next.draggingNodeIds.size).toBe(0);
  });

  it('begin replaces any prior drag set (re-key on a new drag)', () => {
    const armed: TopologyDragState = { draggingNodeIds: new Set(['n-1']) };
    const next = topologyDragReducer(armed, { type: 'begin', ids: new Set(['n-9']) });
    expect(next.draggingNodeIds).toEqual(new Set(['n-9']));
  });
});

describe('useTopologyEditorDrag', () => {
  it('exposes the drag set and an isDragging flag', () => {
    const { result } = renderHook(() => useTopologyEditorDrag());
    expect(result.current.draggingNodeIds.size).toBe(0);
    expect(result.current.isDragging).toBe(false);
  });

  it('beginDrag arms the drag synchronously — the ref mirror is fresh before any re-render', () => {
    const { result } = renderHook(() => useTopologyEditorDrag());
    const ids = new Set(['n-1', 'n-2']);
    act(() => result.current.beginDrag(ids));
    // The touch gesture loop reads the ref inside the stale down-time
    // closure, so the mirror must be current immediately — not after the
    // next React render.
    expect(result.current.draggingNodeIdsRef.current).toEqual(new Set(['n-1', 'n-2']));
    expect(result.current.isDragging).toBe(true);
  });

  it('cancelDrag clears the render state AND the ref mirror synchronously', () => {
    const { result } = renderHook(() => useTopologyEditorDrag());
    act(() => result.current.beginDrag(new Set(['n-1'])));
    act(() => result.current.cancelDrag());
    expect(result.current.draggingNodeIds.size).toBe(0);
    expect(result.current.isDragging).toBe(false);
    // Regression: cancelNodeMove / cancelDuplicateDrag previously cleared
    // only the render state, leaving the ref mirror stale until the next
    // render — the touch loop could keep moving a "cancelled" drag.
    expect(result.current.draggingNodeIdsRef.current.size).toBe(0);
  });

  it('endDrag clears both the render state and the ref mirror synchronously', () => {
    const { result } = renderHook(() => useTopologyEditorDrag());
    act(() => result.current.beginDrag(new Set(['n-1'])));
    act(() => result.current.endDrag());
    expect(result.current.draggingNodeIds.size).toBe(0);
    expect(result.current.draggingNodeIdsRef.current.size).toBe(0);
  });
});
