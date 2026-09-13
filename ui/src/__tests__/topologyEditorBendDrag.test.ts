/**
 * Hook-in-isolation coverage for the Phase 3.4a bend-drag seam
 * (useTopologyEditorBendDrag). NodeTopologyEditor.test.tsx owns the rendered
 * gesture (14 component tests through the DOM); topologyCommands.test.ts owns
 * the pure cancel/no-op decisions. What lived nowhere until here is the seam
 * itself: that the hook installs and tears down its OWN document listeners,
 * that the parent-owned cleanup ref really receives a working disposer, that
 * the deferred ghost splice and the no-op landing pop are wired to the right
 * setters, and that a second mousedown cannot leave a stale listener behind.
 *
 * The harness passes the deps object exactly as the editor's call site does
 * (NodeTopologyEditor.tsx: useTopologyEditorBendDrag({ pan, zoom, selectWire,
 * canvasRef, setWires, setHistory, nodesRef, wiresRef, bendDragRef,
 * bendDragCleanupRef, pushHistoryRef })) and wires those deps to a tiny
 * in-memory graph store: setWires/setHistory apply their updater against the
 * same state pushHistory writes to, so a history entry the hook pops is
 * really gone rather than merely "an updater was called".
 *
 * Characterization, not TDD-red: every expectation was read off the behaviour
 * at the extraction commit, and the component suite pins the same rules end to
 * end. Types come through Parameters<typeof hook> so this file never imports
 * the 5.5k-line component even for a name.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from 'react';
import { useTopologyEditorBendDrag } from '../features/locations/topologyEditorBendDrag';
import type { BendGestureState } from '../features/locations/topologyCommands';

type BendDeps = Parameters<typeof useTopologyEditorBendDrag>[0];
type WireGraph = BendDeps['wiresRef']['current'];
type NodeGraph = BendDeps['nodesRef']['current'];
type Wire = WireGraph extends (infer W)[] ? W : never;
type NodeData = NodeGraph extends (infer N)[] ? N : never;
/** TopologyHistoryEntry<node, wire> — restated structurally to keep the
 *  state module out of this file's import list. */
type HistoryEntry = { nodes: NodeGraph; wires: WireGraph };

const nodeOf = (id: string): NodeData => ({ id, type: 'store', name: id, x: 0, y: 0 });

/** A wire with optional authored bends. With no bends the option is omitted
 *  outright (exactOptionalPropertyTypes), which is also the honest shape: the
 *  editor never writes bends: undefined onto a wire. */
const wireOf = (id: string, bends?: Array<{ x: number; y: number }>): Wire =>
  bends
    ? { id, fromNodeId: 'a', toNodeId: 'b', direction: 'one-way', bends }
    : { id, fromNodeId: 'a', toNodeId: 'b', direction: 'one-way' };

/** The pointer-down the memoized wire group hands the hook. Only button /
 *  stopPropagation / preventDefault are read off it, so a structural stand-in
 *  beats rendering an SVG just to fabricate one. */
const mouseEvent = (button = 0) =>
  ({
    button,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  }) as unknown as ReactMouseEvent;

const setup = (
  opts: {
    wires?: WireGraph;
    nodes?: NodeGraph;
    pan?: { x: number; y: number };
    zoom?: number;
    rect?: { left: number; top: number };
  } = {},
) => {
  const seedWires = opts.wires ?? [wireOf('w-1', [{ x: 200, y: 200 }])];
  const seedNodes = opts.nodes ?? [nodeOf('a'), nodeOf('b')];
  const rect = opts.rect ?? { left: 0, top: 0 };

  const canvas = document.createElement('div');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: rect.left,
    top: rect.top,
  } as DOMRect);
  const canvasRef: RefObject<HTMLDivElement> = { current: canvas };

  const nodesRef: MutableRefObject<NodeGraph> = { current: seedNodes };
  const wiresRef: MutableRefObject<WireGraph> = { current: seedWires };
  const history: HistoryEntry[] = [];

  /** Writes through to wiresRef so a later mouseup sees the flushed graph —
   *  the state the real editor's ref holds once React has rendered, which is
   *  what the no-op landing check is specified against. */
  const setWires = vi.fn((value: SetStateAction<WireGraph>) => {
    wiresRef.current =
      typeof value === 'function' ? value(wiresRef.current) : value;
  });
  const setHistory = vi.fn((value: SetStateAction<HistoryEntry[]>) => {
    const next =
      typeof value === 'function'
        ? (value as (prev: HistoryEntry[]) => HistoryEntry[])(history.slice())
        : value;
    history.length = 0;
    history.push(...next);
  });
  const selectWire = vi.fn((_id: string) => {});
  /** Mirrors the editor's pushHistory for everything the bend gesture uses:
   *  an explicit snapshot wins, otherwise the live refs. (Redo-clearing and
   *  the 50-entry cap are pushHistory's own business and already covered by
   *  the editor suite.) */
  const pushHistory = vi.fn((snapshot?: HistoryEntry) => {
    history.push(snapshot ?? { nodes: nodesRef.current, wires: wiresRef.current });
  });

  const bendDragRef: MutableRefObject<BendGestureState | null> = { current: null };
  const bendDragCleanupRef: MutableRefObject<(() => void) | null> = { current: null };

  const deps: BendDeps = {
    pan: opts.pan ?? { x: 0, y: 0 },
    zoom: opts.zoom ?? 1,
    selectWire,
    canvasRef,
    setWires,
    setHistory,
    nodesRef,
    wiresRef,
    bendDragRef,
    bendDragCleanupRef,
    pushHistoryRef: { current: pushHistory },
  };

  const view = renderHook(() => useTopologyEditorBendDrag(deps));

  const startBendDrag = (
    e: ReactMouseEvent,
    wireId: string,
    index: number,
    startX: number,
    startY: number,
    created?: boolean,
  ) => act(() => view.result.current.startBendDrag(e, wireId, index, startX, startY, created));
  const startGhostBendDrag = (
    e: ReactMouseEvent,
    wireId: string,
    segmentIndex: number,
    mx: number,
    my: number,
  ) => act(() => view.result.current.startGhostBendDrag(e, wireId, segmentIndex, mx, my));
  const removeBend = (wireId: string, index: number) =>
    act(() => view.result.current.removeBend(wireId, index));
  /** The gesture listens on `document`, exactly as the inline original did. */
  const move = (clientX: number, clientY: number) =>
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
    });
  const release = () =>
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    });
  const bendsOf = (wireId: string) => wiresRef.current.find((w) => w.id === wireId)?.bends;
  const findWire = (wireId: string) => wiresRef.current.find((w) => w.id === wireId);

  return {
    deps,
    result: view.result,
    unmount: view.unmount,
    history,
    seedWires,
    seedNodes,
    setWires,
    setHistory,
    selectWire,
    pushHistory,
    wiresRef,
    startBendDrag,
    startGhostBendDrag,
    removeBend,
    move,
    release,
    bendsOf,
    findWire,
  };
};

describe('useTopologyEditorBendDrag — startBendDrag listener lifecycle', () => {
  it('arms the refs and installs the document listeners the cleanup ref disposes', () => {
    const h = setup();
    const e = mouseEvent();

    h.startBendDrag(e, 'w-1', 0, 200, 200);

    expect(h.selectWire).toHaveBeenCalledWith('w-1');
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    // Gesture state at mousedown: nothing moved, nothing pending, the bend
    // already exists — so this is the "existing bend" branch.
    expect(h.deps.bendDragRef.current).toEqual({
      wireId: 'w-1',
      index: 0,
      moved: false,
      startX: 200,
      startY: 200,
      created: false,
      pendingInsert: false,
    });
    const dispose = h.deps.bendDragCleanupRef.current;
    expect(typeof dispose).toBe('function');

    // Live listener: one move positions the bend and pushes exactly one entry
    // holding the PRE-gesture graph (identity, not a copy — immutable
    // discipline is what makes one Undo restore the old geometry).
    h.move(260, 260);
    expect(h.bendsOf('w-1')).toEqual([{ x: 260, y: 260 }]);
    expect(h.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.pushHistory.mock.calls[0]?.[0]?.wires).toBe(h.seedWires);
    expect(h.setWires).toHaveBeenCalledTimes(1);

    // The EDITOR owns the bendDragCleanupRef mailbox (cancelBendDrag fires
    // it mid-session; the bend hook's tail effect disposes it at unmount);
    // running it detaches both listeners and clears the gesture.
    act(() => dispose?.());
    expect(h.deps.bendDragCleanupRef.current).toBeNull();
    expect(h.deps.bendDragRef.current).toBeNull();
    h.move(999, 999);
    expect(h.bendsOf('w-1')).toEqual([{ x: 260, y: 260 }]);
    expect(h.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.setWires).toHaveBeenCalledTimes(1);
  });

  it('a second mousedown disposes the first gesture instead of leaking its listener', () => {
    const h = setup({ wires: [wireOf('w-1', [{ x: 10, y: 10 }]), wireOf('w-2', [{ x: 20, y: 20 }])] });

    h.startBendDrag(mouseEvent(), 'w-1', 0, 10, 10);
    // No release in between — the second handle is pressed while the first is
    // still armed, so startBendDrag must run bendDragCleanupRef first.
    h.startBendDrag(mouseEvent(), 'w-2', 0, 20, 20);

    h.move(50, 60);

    // Exactly one live handler: one write. A leaked first listener would fire
    // too, and — reading the shared bendDragRef — mark the gesture moved
    // before the real handler ran, making this two setWires calls.
    expect(h.setWires).toHaveBeenCalledTimes(1);
    expect(h.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.bendsOf('w-2')).toEqual([{ x: 50, y: 60 }]);
    expect(h.bendsOf('w-1')).toEqual([{ x: 10, y: 10 }]);
    expect(h.selectWire).toHaveBeenLastCalledWith('w-2');
  });

  it('ignores a non-primary button before it selects, arms or listens', () => {
    const h = setup();
    const e = mouseEvent(1);

    h.startBendDrag(e, 'w-1', 0, 200, 200);

    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(h.selectWire).not.toHaveBeenCalled();
    expect(h.deps.bendDragRef.current).toBeNull();
    expect(h.deps.bendDragCleanupRef.current).toBeNull();

    h.move(300, 300);
    expect(h.setWires).not.toHaveBeenCalled();
    expect(h.bendsOf('w-1')).toEqual([{ x: 200, y: 200 }]);
  });

  it('maps client coords through the canvas rect, pan and zoom', () => {
    // Same transform as node drags: canvas = (client - rect origin - pan) / zoom.
    const h = setup({
      wires: [wireOf('w-1', [{ x: 0, y: 0 }])],
      pan: { x: 100, y: 50 },
      zoom: 2,
      rect: { left: 20, top: 10 },
    });

    h.startBendDrag(mouseEvent(), 'w-1', 0, 0, 0);
    h.move(180, 140); // 20 + 100 + 2*30 , 10 + 50 + 2*40

    expect(h.bendsOf('w-1')).toEqual([{ x: 30, y: 40 }]);
  });
});

describe('useTopologyEditorBendDrag — release semantics', () => {
  it('a click without movement leaves no trace, while a real move keeps its entry', () => {
    const h = setup();

    // Press and release an existing bend WITHOUT moving: the gesture never
    // pushed, so there is nothing to pop and nothing to write.
    h.startBendDrag(mouseEvent(), 'w-1', 0, 200, 200);
    h.release();
    expect(h.deps.bendDragRef.current).toBeNull();
    expect(h.deps.bendDragCleanupRef.current).toBeNull();
    expect(h.pushHistory).not.toHaveBeenCalled();
    expect(h.setHistory).not.toHaveBeenCalled();
    expect(h.setWires).not.toHaveBeenCalled();
    expect(h.bendsOf('w-1')).toEqual([{ x: 200, y: 200 }]);
    expect(h.history).toHaveLength(0);

    // Control: the same gesture WITH movement is a real edit — one entry,
    // kept (the pop is only for a no-op landing, asserted next).
    h.startBendDrag(mouseEvent(), 'w-1', 0, 200, 200);
    h.move(240, 210);
    h.release();
    expect(h.bendsOf('w-1')).toEqual([{ x: 240, y: 210 }]);
    expect(h.history).toHaveLength(1);
    expect(h.setHistory).not.toHaveBeenCalled();
  });

  it('pops the entry it pushed when an existing bend lands back on its start', () => {
    const h = setup();

    h.startBendDrag(mouseEvent(), 'w-1', 0, 200, 200);
    h.move(260, 260);
    expect(h.history).toHaveLength(1);

    // Cursor returns to the exact start: the bend is where it began, so the
    // entry would restore identical state. bendLandedAtStart says pop.
    h.move(200, 200);
    h.release();

    expect(h.setHistory).toHaveBeenCalledTimes(1);
    expect(h.history).toHaveLength(0);
    expect(h.bendsOf('w-1')).toEqual([{ x: 200, y: 200 }]);
  });
});

describe('useTopologyEditorBendDrag — ghost creation and removal', () => {
  it('startGhostBendDrag arms the created path and defers the splice to the first movement', () => {
    const unbent = [wireOf('w-1')];
    const h = setup({ wires: unbent });
    const e = mouseEvent();

    h.startGhostBendDrag(e, 'w-1', 0, 350, 289);

    // Characterization of the delegation: startGhostBendDrag guards the
    // button, stops the event itself and THEN calls startBendDrag, which does
    // both again on the same event object — two calls each. Harmless (both are
    // idempotent per event) but pinned, so a future "cleanup" is a decision
    // rather than an accident.
    expect(e.stopPropagation).toHaveBeenCalledTimes(2);
    expect(e.preventDefault).toHaveBeenCalledTimes(2);
    // No phantom bend at mousedown and no history entry: a ghost press that
    // never drags must leave the canvas byte-identical (the component test
    // 'a click without drag on a midpoint ghost creates nothing' pins this
    // through the rendered DOM; here it is the pendingInsert flag).
    expect(h.setWires).not.toHaveBeenCalled();
    expect(h.pushHistory).not.toHaveBeenCalled();
    expect(h.findWire('w-1')?.bends).toBeUndefined();
    expect(h.deps.bendDragRef.current).toEqual({
      wireId: 'w-1',
      index: 0,
      moved: false,
      startX: 350,
      startY: 289,
      created: true,
      pendingInsert: true,
    });
    // Characterization: the ghost entry point selects, then delegates to
    // startBendDrag, which selects again. Same id, and the editor's selection
    // reducer makes the repeat idempotent — recorded so a future reader does
    // not "fix" it into a behavior change.
    expect(h.selectWire).toHaveBeenCalledTimes(2);
    expect(h.selectWire).toHaveBeenNthCalledWith(1, 'w-1');

    // First movement: push the entry with the UNBENT graph, THEN splice the
    // bend in at the cursor — so one Undo removes the whole creation.
    h.move(400, 300);
    expect(h.bendsOf('w-1')).toEqual([{ x: 400, y: 300 }]);
    expect(h.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.pushHistory.mock.calls[0]?.[0]?.wires).toBe(unbent);

    // A created bend dragged back onto its own midpoint is NOT a no-op: the
    // bend's existence is the edit, so nothing pops and the entry survives.
    h.move(350, 289);
    h.release();
    expect(h.setHistory).not.toHaveBeenCalled();
    expect(h.history).toHaveLength(1);
    expect(h.bendsOf('w-1')).toEqual([{ x: 350, y: 289 }]);
    expect(h.deps.bendDragRef.current).toBeNull();
  });

  it('removeBend drops exactly the indexed bend and pushes exactly one entry', () => {
    const seed = [
      wireOf('w-1', [{ x: 10, y: 10 }, { x: 20, y: 20 }]),
      wireOf('w-2', [{ x: 30, y: 30 }]),
    ];
    const h = setup({ wires: seed });
    const untouchedBends = seed[1]?.bends;

    h.removeBend('w-1', 0);

    // One entry, taken from the live refs (no snapshot arg) — the double-click
    // removal is a plain command, not a gesture.
    expect(h.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.pushHistory).toHaveBeenCalledWith();
    expect(h.history).toHaveLength(1);
    expect(h.history[0]?.wires).toBe(seed);
    expect(h.setHistory).not.toHaveBeenCalled();
    expect(h.deps.bendDragRef.current).toBeNull();

    expect(h.bendsOf('w-1')).toEqual([{ x: 20, y: 20 }]);
    // Immutable discipline: the entry's wire array and its bend arrays are
    // untouched, and the sibling wire is not even rebuilt.
    expect(seed[0]?.bends).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }]);
    expect(h.findWire('w-2')).toBe(seed[1]);
    expect(h.bendsOf('w-2')).toBe(untouchedBends);
  });
});
