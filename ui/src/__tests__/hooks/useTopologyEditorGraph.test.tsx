import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTopologyEditorGraph, type TopologyHistoryEntry } from '@/features/locations/nodeTopologyEditorState';

interface TestNode { id: string; name: string; x: number; y: number; }
interface TestWire { id: string; fromNodeId: string; toNodeId: string; }

const initialNodes: TestNode[] = [
  { id: 'n1', name: 'Node 1', x: 100, y: 100 },
  { id: 'n2', name: 'Node 2', x: 300, y: 100 },
];

const initialWires: TestWire[] = [
  { id: 'w1', fromNodeId: 'n1', toNodeId: 'n2' },
];

describe('useTopologyEditorGraph', () => {
  let hook: { result: { current: ReturnType<typeof useTopologyEditorGraph<TestNode, TestWire>> } };

  beforeEach(() => {
    hook = renderHook(() => useTopologyEditorGraph(initialNodes, initialWires));
  });

  it('initializes with provided nodes and wires', () => {
    expect(hook.result.current.nodes).toEqual(initialNodes);
    expect(hook.result.current.wires).toEqual(initialWires);
    expect(hook.result.current.history).toEqual([]);
    expect(hook.result.current.redo).toEqual([]);
  });

  it('setNodes updates nodes and clears redo stack', () => {
    const newNodes: TestNode[] = [
      { id: 'n1', name: 'Node 1', x: 100, y: 100 },
      { id: 'n2', name: 'Node 2', x: 300, y: 100 },
      { id: 'n3', name: 'Node 3', x: 500, y: 100 },
    ];

    act(() => {
      hook.result.current.setNodes(newNodes);
    });

    expect(hook.result.current.nodes).toEqual(newNodes);
    expect(hook.result.current.redo).toEqual([]);
  });

  it('setNodes accepts functional updater', () => {
    act(() => {
      hook.result.current.setNodes((prev: TestNode[]) => [...prev, { id: 'n3', name: 'Node 3', x: 500, y: 100 }]);
    });

    expect(hook.result.current.nodes).toHaveLength(3);
    expect(hook.result.current.nodes[2]?.id).toBe('n3');
  });

  it('setWires updates wires and clears redo stack', () => {
    const newWires: TestWire[] = [
      { id: 'w1', fromNodeId: 'n1', toNodeId: 'n2' },
      { id: 'w2', fromNodeId: 'n2', toNodeId: 'n3' },
    ];

    act(() => {
      hook.result.current.setWires(newWires);
    });

    expect(hook.result.current.wires).toEqual(newWires);
    expect(hook.result.current.redo).toEqual([]);
  });

  it('setWires accepts functional updater', () => {
    act(() => {
      hook.result.current.setWires((prev: TestWire[]) => [...prev, { id: 'w2', fromNodeId: 'n2', toNodeId: 'n3' }]);
    });

    expect(hook.result.current.wires).toHaveLength(2);
  });

  it('setHistory replaces history stack', () => {
    const entry1: TopologyHistoryEntry<TestNode, TestWire> = {
      nodes: initialNodes,
      wires: initialWires,
    };
    const entry2: TopologyHistoryEntry<TestNode, TestWire> = {
      nodes: [{ id: 'n1', name: 'Node 1', x: 100, y: 100 }],
      wires: [],
    };

    act(() => {
      hook.result.current.setHistory([entry1, entry2]);
    });

    expect(hook.result.current.history).toEqual([entry1, entry2]);
  });

  it('setHistory accepts functional updater', () => {
    act(() => {
      hook.result.current.setHistory((prev: TopologyHistoryEntry<TestNode, TestWire>[]) => [
        ...prev,
        { nodes: [], wires: [] },
      ]);
    });

    expect(hook.result.current.history).toHaveLength(1);
  });

  it('setRedo replaces redo stack', () => {
    const entry: TopologyHistoryEntry<TestNode, TestWire> = {
      nodes: initialNodes,
      wires: initialWires,
    };

    act(() => {
      hook.result.current.setRedo([entry]);
    });

    expect(hook.result.current.redo).toEqual([entry]);
  });

  it('setRedo accepts functional updater', () => {
    act(() => {
      hook.result.current.setRedo((prev: TopologyHistoryEntry<TestNode, TestWire>[]) => [
        ...prev,
        { nodes: [], wires: [] },
      ]);
    });

    expect(hook.result.current.redo).toHaveLength(1);
  });

  it('batch updates via setNodes and setWires are atomic', () => {
    act(() => {
      hook.result.current.setNodes([{ id: 'n1', name: 'Node 1', x: 200, y: 200 }]);
      hook.result.current.setWires([]);
    });

    // Both updates should be reflected
    expect(hook.result.current.nodes).toHaveLength(1);
    expect(hook.result.current.nodes[0]?.x).toBe(200);
    expect(hook.result.current.wires).toEqual([]);
  });

  it('empty initial state works correctly', () => {
    const emptyHook = renderHook(() => useTopologyEditorGraph<TestNode, TestWire>([], []));

    expect(emptyHook.result.current.nodes).toEqual([]);
    expect(emptyHook.result.current.wires).toEqual([]);
    expect(emptyHook.result.current.history).toEqual([]);
    expect(emptyHook.result.current.redo).toEqual([]);
  });

  it('functional updater for setNodes receives current state', () => {
    let capturedPrev: TestNode[] | undefined;

    act(() => {
      hook.result.current.setNodes((prev: TestNode[]) => {
        capturedPrev = prev;
        return [...prev, { id: 'n3', name: 'Node 3', x: 500, y: 100 }];
      });
    });

    expect(capturedPrev).toEqual(initialNodes);
  });

  it('functional updater for setWires receives current state', () => {
    let capturedPrev: TestWire[] | undefined;

    act(() => {
      hook.result.current.setWires((prev: TestWire[]) => {
        capturedPrev = prev;
        return [...prev, { id: 'w2', fromNodeId: 'n2', toNodeId: 'n3' }];
      });
    });

    expect(capturedPrev).toEqual(initialWires);
  });

  it('functional updater for setHistory receives current state', () => {
    let capturedPrev: TopologyHistoryEntry<TestNode, TestWire>[] | undefined;

    act(() => {
      hook.result.current.setHistory((prev: TopologyHistoryEntry<TestNode, TestWire>[]) => {
        capturedPrev = prev;
        return [...prev, { nodes: [], wires: [] }];
      });
    });

    expect(capturedPrev).toEqual([]);
  });

  it('functional updater for setRedo receives current state', () => {
    let capturedPrev: TopologyHistoryEntry<TestNode, TestWire>[] | undefined;

    act(() => {
      hook.result.current.setRedo((prev: TopologyHistoryEntry<TestNode, TestWire>[]) => {
        capturedPrev = prev;
        return [...prev, { nodes: [], wires: [] }];
      });
    });

    expect(capturedPrev).toEqual([]);
  });

  it('multiple rapid updates are all applied', () => {
    act(() => {
      for (let i = 0; i < 10; i++) {
        hook.result.current.setNodes((prev: TestNode[]) => [
          ...prev,
          { id: `n${i + 3}`, name: `Node ${i + 3}`, x: 100 + i * 50, y: 100 + i * 50 },
        ]);
      }
    });

    expect(hook.result.current.nodes).toHaveLength(12); // 2 initial + 10 added
  });
});