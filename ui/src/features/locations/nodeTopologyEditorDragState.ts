import { useCallback, useReducer, useRef } from 'react';

/**
 * Typed state machine for the topology editor's node drag lifecycle.
 *
 * The drag has two faces that must never disagree:
 *  - the render state `draggingNodeIds` (drives the dragging class), and
 *  - a synchronous ref mirror `draggingNodeIdsRef` read by the touch
 *    gesture loop and the document move handler inside stale down-time
 *    closures — before React has re-rendered.
 *
 * Before this module the two were separate `useState` + `useRef` with the
 * mirror updated by hand at some sites only: `beginNodeDrag` and
 * `finalizeNodeDrag` synced the mirror, but `cancelNodeMove` and
 * `cancelDuplicateDrag` cleared only the render state — leaving the mirror
 * holding a stale non-empty set until the next render. A touch move fired
 * in that window could keep moving a "cancelled" drag.
 *
 * The hook makes the invariant structural: every transition (begin, end,
 * cancel) writes both the reducer state and the mirror in the same call.
 */
export type TopologyDragState = {
  /** Ids of the nodes being dragged together; empty = no drag in flight. */
  draggingNodeIds: Set<string>;
};

export type TopologyDragAction =
  | { type: 'begin'; ids: Set<string> }
  | { type: 'end' }
  | { type: 'cancel' };

export const initialTopologyDragState: TopologyDragState = {
  draggingNodeIds: new Set<string>(),
};

export function topologyDragReducer(
  _state: TopologyDragState,
  action: TopologyDragAction,
): TopologyDragState {
  // Every action replaces the whole drag set — there is no partial update,
  // so the previous state is not consulted.
  switch (action.type) {
    case 'begin':
      return { draggingNodeIds: action.ids };
    case 'end':
      return { draggingNodeIds: new Set<string>() };
    case 'cancel':
      return { draggingNodeIds: new Set<string>() };
  }
}

/**
 * Drag state boundary for the editor. `beginDrag` / `endDrag` / `cancelDrag`
 * each update the reducer state AND the synchronous ref mirror in one call,
 * so the touch loop and move handler can never observe a stale drag set.
 */
export function useTopologyEditorDrag() {
  const [state, dispatch] = useReducer(topologyDragReducer, initialTopologyDragState);
  /** Render-time mirror (kept current every render). */
  const draggingNodeIdsRef = useRef<Set<string>>(state.draggingNodeIds);
  draggingNodeIdsRef.current = state.draggingNodeIds;

  const beginDrag = useCallback((ids: Set<string>) => {
    draggingNodeIdsRef.current = ids;
    dispatch({ type: 'begin', ids });
  }, []);
  const endDrag = useCallback(() => {
    const empty = new Set<string>();
    draggingNodeIdsRef.current = empty;
    dispatch({ type: 'end' });
  }, []);
  const cancelDrag = useCallback(() => {
    const empty = new Set<string>();
    draggingNodeIdsRef.current = empty;
    dispatch({ type: 'cancel' });
  }, []);

  return {
    draggingNodeIds: state.draggingNodeIds,
    isDragging: state.draggingNodeIds.size > 0,
    draggingNodeIdsRef,
    beginDrag,
    endDrag,
    cancelDrag,
  };
}
