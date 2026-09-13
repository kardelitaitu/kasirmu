import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTopologyEditorDrag,
  topologyDragReducer,
  initialTopologyDragState,
  type TopologyDragState,
} from '@/features/locations/nodeTopologyEditorDragState';

describe('useTopologyEditorDrag', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorDrag> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorDrag());
  });

  it('initializes with empty drag state', () => {
    expect(hook.result.current.draggingNodeIds).toEqual(new Set());
    expect(hook.result.current.isDragging).toBe(false);
    expect(hook.result.current.draggingNodeIdsRef.current).toEqual(new Set());
  });

  it('beginDrag sets drag state and updates ref', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1', 'n2']));
    });

    expect(hook.result.current.draggingNodeIds).toEqual(new Set(['n1', 'n2']));
    expect(hook.result.current.isDragging).toBe(true);
    expect(hook.result.current.draggingNodeIdsRef.current).toEqual(new Set(['n1', 'n2']));
  });

  it('endDrag clears drag state and updates ref', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1']));
    });
    expect(hook.result.current.isDragging).toBe(true);

    act(() => {
      hook.result.current.endDrag();
    });

    expect(hook.result.current.draggingNodeIds).toEqual(new Set());
    expect(hook.result.current.isDragging).toBe(false);
    expect(hook.result.current.draggingNodeIdsRef.current).toEqual(new Set());
  });

  it('cancelDrag clears drag state and updates ref', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1', 'n2']));
    });

    act(() => {
      hook.result.current.cancelDrag();
    });

    expect(hook.result.current.draggingNodeIds).toEqual(new Set());
    expect(hook.result.current.isDragging).toBe(false);
    expect(hook.result.current.draggingNodeIdsRef.current).toEqual(new Set());
  });

  it('ref mirror is updated by beginDrag', () => {
    let refAfterBegin: Set<string> | undefined;

    const customHook = renderHook(() => {
      const result = useTopologyEditorDrag();
      return {
        ...result,
        beginDragWrapper: (ids: Set<string>) => {
          result.beginDrag(ids);
          refAfterBegin = result.draggingNodeIdsRef.current;
        },
      };
    });

    act(() => {
      customHook.result.current.beginDragWrapper(new Set(['n1']));
    });

    // Ref should be updated after beginDrag
    expect(refAfterBegin).toEqual(new Set(['n1']));
  });

  it('beginDrag with empty set sets isDragging to false', () => {
    act(() => {
      hook.result.current.beginDrag(new Set());
    });

    expect(hook.result.current.isDragging).toBe(false);
  });

  it('multiple beginDrag calls replace the drag set', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1']));
    });
    expect(hook.result.current.draggingNodeIds).toEqual(new Set(['n1']));

    act(() => {
      hook.result.current.beginDrag(new Set(['n2', 'n3']));
    });
    expect(hook.result.current.draggingNodeIds).toEqual(new Set(['n2', 'n3']));
  });

  it('endDrag after cancelDrag is idempotent', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1']));
      hook.result.current.cancelDrag();
      hook.result.current.endDrag();
    });

    expect(hook.result.current.isDragging).toBe(false);
    expect(hook.result.current.draggingNodeIds).toEqual(new Set());
  });

  it('cancelDrag after endDrag is idempotent', () => {
    act(() => {
      hook.result.current.beginDrag(new Set(['n1']));
      hook.result.current.endDrag();
      hook.result.current.cancelDrag();
    });

    expect(hook.result.current.isDragging).toBe(false);
  });
});

describe('topologyDragReducer (unit)', () => {
  it('begin sets drag ids', () => {
    const state = topologyDragReducer(initialTopologyDragState, { type: 'begin', ids: new Set(['n1', 'n2']) });
    expect(state).toEqual({ draggingNodeIds: new Set(['n1', 'n2']) });
  });

  it('end clears drag ids', () => {
    const withDrag: TopologyDragState = { draggingNodeIds: new Set(['n1', 'n2']) };
    const state = topologyDragReducer(withDrag, { type: 'end' });
    expect(state).toEqual({ draggingNodeIds: new Set() });
  });

  it('cancel clears drag ids', () => {
    const withDrag: TopologyDragState = { draggingNodeIds: new Set(['n1', 'n2']) };
    const state = topologyDragReducer(withDrag, { type: 'cancel' });
    expect(state).toEqual({ draggingNodeIds: new Set() });
  });

  it('begin replaces previous drag ids', () => {
    const withDrag: TopologyDragState = { draggingNodeIds: new Set(['n1']) };
    const state = topologyDragReducer(withDrag, { type: 'begin', ids: new Set(['n2', 'n3']) });
    expect(state).toEqual({ draggingNodeIds: new Set(['n2', 'n3']) });
  });

  it('begin with empty set clears drag', () => {
    const withDrag: TopologyDragState = { draggingNodeIds: new Set(['n1']) };
    const state = topologyDragReducer(withDrag, { type: 'begin', ids: new Set() });
    expect(state).toEqual({ draggingNodeIds: new Set() });
  });
});