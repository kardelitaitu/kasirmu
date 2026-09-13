import { describe, expect, it } from 'vitest';
import {
  topologyEditorGraphReducer,
  type TopologyEditorGraphState,
} from '@/features/locations/nodeTopologyEditorState';

type Node = { id: string };
type Wire = { id: string };

const initial: TopologyEditorGraphState<Node, Wire> = {
  nodes: [{ id: 'n1' }],
  wires: [],
  history: [],
  redo: [],
};

describe('topologyEditorGraphReducer', () => {
  it('applies functional node, wire, and history updates in dispatch order', () => {
    const withNode = topologyEditorGraphReducer(initial, {
      type: 'set-nodes',
      value: (nodes) => [...nodes, { id: 'n2' }],
    });
    const withWire = topologyEditorGraphReducer(withNode, {
      type: 'set-wires',
      value: [{ id: 'w1' }],
    });
    const withHistory = topologyEditorGraphReducer(withWire, {
      type: 'set-history',
      value: (history) => [...history, { nodes: initial.nodes, wires: initial.wires }],
    });

    expect(withHistory.nodes).toEqual([{ id: 'n1' }, { id: 'n2' }]);
    expect(withHistory.wires).toEqual([{ id: 'w1' }]);
    expect(withHistory.history).toHaveLength(1);
    expect(withHistory.redo).toEqual([]);
  });

  it('keeps unrelated graph state intact for each transition', () => {
    const entry = { nodes: [{ id: 'before' }], wires: [{ id: 'old-wire' }] };
    const state = { ...initial, history: [entry] };
    const next = topologyEditorGraphReducer(state, {
      type: 'set-redo',
      value: [{ nodes: [{ id: 'redo-node' }], wires: [] }],
    });

    expect(next.nodes).toBe(state.nodes);
    expect(next.wires).toBe(state.wires);
    expect(next.history).toBe(state.history);
    expect(next.redo[0]?.nodes).toEqual([{ id: 'redo-node' }]);
  });
});
