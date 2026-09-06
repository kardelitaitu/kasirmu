import { useCallback, useReducer } from 'react';

/**
 * Typed state machine for the topology editor's selection.
 *
 * Before this module, selection was three loose useState pairs in
 * NodeTopologyEditor: `selectedNodeId` (primary / inspector target),
 * `selectedNodeIds` (multi-selection set), and `selectedWireId`. The only
 * invariant was convention — most node-selection sites cleared the wire,
 * but `selectOnly` did not, so a wire could stay selected alongside a node.
 * The toolbar Delete handler checks nodes before wires, which made the
 * wire-delete path unreachable in that state.
 *
 * The reducer makes the mutual-exclusivity rule structural:
 *  - any node-selection action atomically clears the wire selection, and
 *  - `select-wire` atomically clears the node selection.
 * `clear-nodes` intentionally leaves the wire selection alone (it is the
 * "deselect nodes" primitive), and `prune` drops dangling ids after undo,
 * redo, preset loads, or topology reloads.
 */
export type TopologySelectionState = {
  /** Primary node id (inspector target / last-picked), or null. */
  nodeId: string | null;
  /** Full multi-selection set; the primary is always a member. */
  nodeIds: Set<string>;
  /** Selected wire id, or null. Mutually exclusive with the node selection. */
  wireId: string | null;
};

export type TopologySelectionAction =
  | { type: 'select-only'; id: string }
  | { type: 'select-many'; ids: string[]; primary: string | null }
  | { type: 'add'; id: string }
  | { type: 'select-wire'; id: string }
  | { type: 'clear-nodes' }
  | { type: 'clear-wire' }
  | { type: 'clear-all' }
  | { type: 'prune'; validNodeIds: Set<string>; validWireId: string | null };

export const initialTopologySelectionState: TopologySelectionState = {
  nodeId: null,
  nodeIds: new Set<string>(),
  wireId: null,
};

export function topologySelectionReducer(
  state: TopologySelectionState,
  action: TopologySelectionAction,
): TopologySelectionState {
  switch (action.type) {
    case 'select-only':
      return { nodeId: action.id, nodeIds: new Set([action.id]), wireId: null };
    case 'select-many':
      return { nodeId: action.primary, nodeIds: new Set(action.ids), wireId: null };
    case 'add': {
      const nodeIds = new Set(state.nodeIds);
      nodeIds.add(action.id);
      return { nodeId: action.id, nodeIds, wireId: null };
    }
    case 'select-wire':
      return { nodeId: null, nodeIds: new Set<string>(), wireId: action.id };
    case 'clear-nodes':
      return { ...state, nodeId: null, nodeIds: new Set<string>() };
    case 'clear-wire':
      return { ...state, wireId: null };
    case 'clear-all':
      return { nodeId: null, nodeIds: new Set<string>(), wireId: null };
    case 'prune': {
      const nodeIds = new Set([...state.nodeIds].filter((id) => action.validNodeIds.has(id)));
      const nodeId = state.nodeId !== null && action.validNodeIds.has(state.nodeId) ? state.nodeId : null;
      const wireId = state.wireId !== null && action.validWireId === state.wireId ? state.wireId : null;
      return { nodeId, nodeIds, wireId };
    }
  }
}

/**
 * Selection state boundary for the editor. Keeps the same shape the
 * component already consumes (`nodeId` / `nodeIds` / `wireId`) but every
 * transition flows through the reducer, so the node/wire mutual-exclusion
 * invariant can never drift again.
 */
export function useTopologyEditorSelection() {
  const [state, dispatch] = useReducer(topologySelectionReducer, initialTopologySelectionState);

  const selectOnly = useCallback((id: string) => {
    dispatch({ type: 'select-only', id });
  }, []);
  const selectMany = useCallback((ids: string[], primary: string | null) => {
    dispatch({ type: 'select-many', ids, primary });
  }, []);
  const addToSelection = useCallback((id: string) => {
    dispatch({ type: 'add', id });
  }, []);
  const selectWire = useCallback((id: string) => {
    dispatch({ type: 'select-wire', id });
  }, []);
  const clearSelection = useCallback(() => {
    dispatch({ type: 'clear-nodes' });
  }, []);
  const clearWire = useCallback(() => {
    dispatch({ type: 'clear-wire' });
  }, []);
  const clearAll = useCallback(() => {
    dispatch({ type: 'clear-all' });
  }, []);
  const pruneSelection = useCallback((validNodeIds: Set<string>, validWireId: string | null) => {
    dispatch({ type: 'prune', validNodeIds, validWireId });
  }, []);

  return {
    ...state,
    selectOnly,
    selectMany,
    addToSelection,
    selectWire,
    clearSelection,
    clearWire,
    clearAll,
    pruneSelection,
  };
}
