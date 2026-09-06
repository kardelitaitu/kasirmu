import { useCallback, useReducer, type SetStateAction } from 'react';

export type TopologyHistoryEntry<TNode, TWire> = {
  nodes: TNode[];
  wires: TWire[];
};

export type TopologyEditorGraphState<TNode, TWire> = {
  nodes: TNode[];
  wires: TWire[];
  history: TopologyHistoryEntry<TNode, TWire>[];
  redo: TopologyHistoryEntry<TNode, TWire>[];
};

export type TopologyEditorGraphAction<TNode, TWire> =
  | { type: 'set-nodes'; value: SetStateAction<TNode[]> }
  | { type: 'set-wires'; value: SetStateAction<TWire[]> }
  | { type: 'set-history'; value: SetStateAction<TopologyHistoryEntry<TNode, TWire>[]> }
  | { type: 'set-redo'; value: SetStateAction<TopologyHistoryEntry<TNode, TWire>[]> };

function resolve<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function'
    ? (value as (previous: T) => T)(previous)
    : value;
}

export function topologyEditorGraphReducer<TNode, TWire>(
  state: TopologyEditorGraphState<TNode, TWire>,
  action: TopologyEditorGraphAction<TNode, TWire>,
): TopologyEditorGraphState<TNode, TWire> {
  switch (action.type) {
    case 'set-nodes':
      return { ...state, nodes: resolve(action.value, state.nodes) };
    case 'set-wires':
      return { ...state, wires: resolve(action.value, state.wires) };
    case 'set-history':
      return { ...state, history: resolve(action.value, state.history) };
    case 'set-redo':
      return { ...state, redo: resolve(action.value, state.redo) };
  }
}

/**
 * State boundary for the editor's mutable graph and undo/redo stacks.
 * Callers keep the familiar React setter API, but every transition now passes
 * through one reducer, so batched node/wire/history updates are ordered and
 * testable instead of being spread across a 8k-line component.
 */
export function useTopologyEditorGraph<TNode, TWire>(
  initialNodes: TNode[],
  initialWires: TWire[],
) {
  const [state, dispatch] = useReducer(topologyEditorGraphReducer<TNode, TWire>, {
    nodes: initialNodes,
    wires: initialWires,
    history: [],
    redo: [],
  });

  const setNodes = useCallback((value: SetStateAction<TNode[]>) => {
    dispatch({ type: 'set-nodes', value });
  }, []);
  const setWires = useCallback((value: SetStateAction<TWire[]>) => {
    dispatch({ type: 'set-wires', value });
  }, []);
  const setHistory = useCallback((value: SetStateAction<TopologyHistoryEntry<TNode, TWire>[]>) => {
    dispatch({ type: 'set-history', value });
  }, []);
  const setRedo = useCallback((value: SetStateAction<TopologyHistoryEntry<TNode, TWire>[]>) => {
    dispatch({ type: 'set-redo', value });
  }, []);

  return { ...state, setNodes, setWires, setHistory, setRedo };
}
