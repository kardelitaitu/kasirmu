import { useCallback, useReducer, useRef, type SetStateAction } from 'react';

/**
 * Typed state machine for the topology editor's hover focus state.
 *
 * Hover drives two affordances that must never disagree:
 *  - `nodeId`: focus-mode — the hovered card's neighbourhood stays lit and
 *    every other card/wire dims (Figma-style focus), and
 *  - `wireId`: the wire under the pointer — its midpoint bend ghosts show.
 *
 * Before this module the two were loose useState pairs in
 * NodeTopologyEditor. The structural rule was missing: when the canvas is
 * replaced (preset load, branch reload, unassigned branch) or a node/wire
 * is removed (batch delete, undo/redo), the load chain cleared the port-snap
 * `hoveredTarget` but never the node/wire hover. React does not fire
 * `mouseleave` on unmount, so the stale id survived — `hoverConnections`
 * stayed non-null and every remaining card and wire rendered dimmed until
 * the next hover.
 *
 * The reducer makes both rules structural:
 *  - node and wire hover are mutually exclusive (each hover action clears
 *    the other), and
 *  - `prune` drops a hovered id the moment its node/wire leaves the canvas,
 *    so a stale hover can never dim the whole diagram.
 */
export type TopologyHoverState = {
  /** Hovered node id (focus-mode dimming), or null. */
  nodeId: string | null;
  /** Hovered wire id (bend-ghost affordance), or null. */
  wireId: string | null;
};

export type TopologyHoverAction =
  | { type: 'hover-node'; id: string | null }
  | { type: 'hover-wire'; id: string | null }
  | { type: 'clear-hover' }
  | { type: 'prune'; validNodeIds: Set<string>; validWireIds: Set<string> };

export const initialTopologyHoverState: TopologyHoverState = {
  nodeId: null,
  wireId: null,
};

export function topologyHoverReducer(
  state: TopologyHoverState,
  action: TopologyHoverAction,
): TopologyHoverState {
  switch (action.type) {
    case 'hover-node':
      // A non-null node hover atomically clears the wire hover — the
      // focus-mode dimming and the bend-ghost affordance cannot both be
      // active. A null clear (mouseleave) touches only its own slot, so a
      // wire hover is never clobbered by a node's leave event.
      return action.id !== null
        ? { nodeId: action.id, wireId: null }
        : { nodeId: null, wireId: state.wireId };
    case 'hover-wire':
      return action.id !== null
        ? { nodeId: null, wireId: action.id }
        : { nodeId: state.nodeId, wireId: null };
    case 'clear-hover':
      return { nodeId: null, wireId: null };
    case 'prune': {
      const nodeId = state.nodeId !== null && action.validNodeIds.has(state.nodeId)
        ? state.nodeId
        : null;
      const wireId = state.wireId !== null && action.validWireIds.has(state.wireId)
        ? state.wireId
        : null;
      if (nodeId === state.nodeId && wireId === state.wireId) return state;
      return { nodeId, wireId };
    }
  }
}

/**
 * Hover state boundary for the editor. `hoverNode` / `hoverWire` /
 * `clearHover` / `pruneHover` are the only writers, so the node/wire
 * mutual-exclusion and the structural-clear rule hold by construction.
 */
export function useTopologyEditorHover() {
  const [state, dispatch] = useReducer(topologyHoverReducer, initialTopologyHoverState);
  /** Render-time mirror so a functional updater (the card/wire leave
   *  handlers pass `(prev) => prev === id ? null : prev`) evaluates against
   *  the CURRENT hover without stale-closure risk. */
  const stateRef = useRef(state);
  stateRef.current = state;

  const hoverNode = useCallback((value: SetStateAction<string | null>) => {
    const id = typeof value === 'function' ? value(stateRef.current.nodeId) : value;
    dispatch({ type: 'hover-node', id });
  }, []);
  const hoverWire = useCallback((value: SetStateAction<string | null>) => {
    const id = typeof value === 'function' ? value(stateRef.current.wireId) : value;
    dispatch({ type: 'hover-wire', id });
  }, []);
  const clearHover = useCallback(() => {
    dispatch({ type: 'clear-hover' });
  }, []);
  const pruneHover = useCallback((validNodeIds: Set<string>, validWireIds: Set<string>) => {
    dispatch({ type: 'prune', validNodeIds, validWireIds });
  }, []);

  return {
    nodeId: state.nodeId,
    wireId: state.wireId,
    hoverNode,
    hoverWire,
    clearHover,
    pruneHover,
  };
}
