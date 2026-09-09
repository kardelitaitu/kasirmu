/**
 * Hook-in-isolation coverage for the Phase 3.4b pointer-core seam
 * (useTopologyEditorPointer). NodeTopologyEditor.test.tsx owns the rendered
 * gestures through the DOM; this file owns the seam itself: that startPan
 * really detaches its document listeners (proved by RE-ARMING, never by
 * dispatching into a dead ref -- see the lifecycle note below), that the
 * marquee commits exactly once per release and nothing at all when it never
 * rendered, that the background gate refuses to arm on a node / wire / rack
 * descendant, that the wheel cannot escape 0.4..2.0 while keeping the canvas
 * point under the cursor fixed, and that the contextmenu consume-then-reset
 * rule is one-shot.
 *
 * Deps are passed by the exact names at the editor call site
 * (NodeTopologyEditor.tsx:2009) and wired to small in-memory stores, so the
 * setters behave like real state: a SetStateAction updater is applied against
 * the value the previous write produced, and the stored value can be read
 * back for an identity check (hoveredTarget) rather than a call-count proxy.
 * No vi.mock anywhere -- the only collaborators are the pure geometry helpers
 * the hook itself imports.
 *
 * Characterization, not TDD-red: every expectation was read off the behaviour
 * of the bodies at 7201d806f, which copied the inline originals byte-for-byte.
 * Types come through Parameters<typeof hook> so this file never imports the
 * component, not even for a name.
 *
 * The `deps` literal below is exhaustive-typed against PointerDeps, which makes it a
 * deliberate tripwire: any rename, addition or removal in TopologyPointerDeps fails
 * typecheck HERE. Slice 3.4c-2 fired it as designed — commitDuplicateDrag left the dep
 * surface (it became internal to the hook when the duplicate cluster moved in) and
 * cancelDrag / duplicateHistoryPushedRef / l10nRef / setLiveAnnouncement / setRedo
 * arrived with it. No assertion changed for that; the cluster's inert stubs simply
 * moved with the dep shape.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject,
  SetStateAction,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { useTopologyEditorPointer } from '../features/locations/nodeTopologyEditorPointer';
import type {
  ContextMenuPoint,
  MarqueeRect,
} from '../features/locations/nodeTopologyEditorPointer';
import { NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import { socketSemanticIds } from '../features/locations/topologyCard';
import { portRowCenterY } from '../features/locations/topologyMetrics';

type PointerDeps = Parameters<typeof useTopologyEditorPointer>[0];
type NodeData = PointerDeps['nodes'][number];
type Point = { x: number; y: number };
/** Restated structurally from the setter signature so nothing here needs a
 *  type name from the component (PortName) or from the state module. */
type HoveredTarget = {
  nodeId: string;
  port: 'top' | 'right' | 'bottom' | 'left';
  variantIndex: number;
};

// ── Duplicate-cluster harness extension (coder-35, additive) ────────────────
// The shared deps stubs below are inert on purpose: the 14 tests above never
// start a node drag. The duplicate-drag suite at the bottom of this file needs
// to OBSERVE the drag reducers and the graph/history setters, so it passes
// `duplicateStores: true` to swap in store-backed spies whose shapes are
// restated from the dep signatures themselves (no import from the state
// module, still zero vi.mock). Tests without the flag keep receiving the
// inert bundle and stay byte-identical in behaviour.
type StateOf<F> = F extends (value: infer V) => unknown
  ? V extends (prev: infer P) => unknown
    ? P
    : V
  : never;
type DupNodesList = StateOf<PointerDeps['setNodes']>;
type DupWiresList = StateOf<PointerDeps['setWires']>;
type DupHistoryList = StateOf<PointerDeps['setHistory']>;
type DupRedoList = StateOf<PointerDeps['setRedo']>;
type DupSnapshot = Parameters<PointerDeps['pushHistory']>[0];
type DupGuideValue = Parameters<PointerDeps['setAlignmentGuide']>[0];
type DupToastArg = Parameters<PointerDeps['addToast']>[0];

/** The duplicate cluster's reducer + setter deps, spy-typed for assertions. */
type DupHarness = {
  beginDrag: (ids: Set<string>) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  setLiveAnnouncement: (message: string) => void;
  setRedo: (value: SetStateAction<DupRedoList>) => void;
  pushHistory: (snapshot?: DupSnapshot) => void;
  setNodes: (value: SetStateAction<DupNodesList>) => void;
  setWires: (value: SetStateAction<DupWiresList>) => void;
  setHistory: (value: SetStateAction<DupHistoryList>) => void;
  setAlignmentGuide: (value: DupGuideValue) => void;
  addToast: (toast: DupToastArg) => unknown;
  getNodes: () => DupNodesList;
  getWires: () => DupWiresList;
  getHistory: () => DupHistoryList;
  getRedo: () => DupRedoList;
};

const dupInertHarness = (): DupHarness => ({
  beginDrag: vi.fn(),
  endDrag: vi.fn(),
  cancelDrag: vi.fn(),
  setLiveAnnouncement: vi.fn(),
  setRedo: vi.fn(),
  pushHistory: vi.fn(),
  setNodes: vi.fn(),
  setWires: vi.fn(),
  setHistory: vi.fn(),
  setAlignmentGuide: vi.fn(),
  addToast: vi.fn(),
  getNodes: () => [],
  getWires: () => [],
  getHistory: () => [],
  getRedo: () => [],
});

/** Store-backed reducers: an updater composes against the previous write (as
 *  React would), nodesRef mirrors the store synchronously (the parent's
 *  render mirror that the drag math and the commit's history filter read),
 *  and the reducer trio maintains its documented contract of writing
 *  draggingNodeIdsRef synchronously. */
const dupStoreHarness = (
  startNodes: NodeData[],
  nodesMirror: MutableRefObject<NodeData[]>,
  dragSetMirror: MutableRefObject<Set<string>>,
): DupHarness => {
  let nodesStore: DupNodesList = [...startNodes];
  let wiresStore: DupWiresList = [];
  let historyStore: DupHistoryList = [];
  let redoStore: DupRedoList = [];
  return {
    beginDrag: vi.fn((ids: Set<string>) => {
      dragSetMirror.current = new Set(ids);
    }),
    endDrag: vi.fn(() => {
      dragSetMirror.current = new Set();
    }),
    cancelDrag: vi.fn(() => {
      dragSetMirror.current = new Set();
    }),
    setLiveAnnouncement: vi.fn(() => {}),
    setRedo: vi.fn((value: SetStateAction<DupRedoList>) => {
      redoStore = typeof value === 'function' ? value(redoStore) : value;
    }),
    pushHistory: vi.fn((snapshot?: DupSnapshot) => {
      historyStore = [
        ...historyStore,
        snapshot ?? { nodes: nodesStore, wires: wiresStore },
      ];
    }),
    setNodes: vi.fn((value: SetStateAction<DupNodesList>) => {
      nodesStore = typeof value === 'function' ? value(nodesStore) : value;
      nodesMirror.current = nodesStore;
    }),
    setWires: vi.fn((value: SetStateAction<DupWiresList>) => {
      wiresStore = typeof value === 'function' ? value(wiresStore) : value;
    }),
    setHistory: vi.fn((value: SetStateAction<DupHistoryList>) => {
      historyStore = typeof value === 'function' ? value(historyStore) : value;
    }),
    setAlignmentGuide: vi.fn(() => {}),
    addToast: vi.fn(() => null),
    getNodes: () => nodesStore,
    getWires: () => wiresStore,
    getHistory: () => historyStore,
    getRedo: () => redoStore,
  };
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const storeOf = (id: string, x = 0, y = 0): NodeData => ({
  id,
  type: 'store',
  name: id,
  x,
  y,
});

/** A workspace card resolves to the workspace:store-pos registry row, which
 *  exposes one input and three output socket rows -- enough to drive the
 *  snap-to-port candidate loop without hand-authoring port geometry. */
const posOf = (id: string, x = 0, y = 0): NodeData => ({
  id,
  type: 'workspace',
  name: id,
  x,
  y,
  metadata: { typeKey: 'store-pos' },
});

/** A Stock Room card -- the only node type the tier-cap gate counts, so the
 *  refusal cases need one. `duplicateRefusal` filters the pending copies on
 *  `type === 'warehouse'` and refuses when the install would cross the cap
 *  (one warehouse below Pro): NodeTopologyEditor.tsx:1188-1204. */
const warehouseOf = (id: string, x = 0, y = 0): NodeData => ({
  id,
  type: 'warehouse',
  name: id,
  x,
  y,
});

/** One snap candidate exactly as the hook builds it: left column at the card
 *  edge, right column at NODE_WIDTH, each row at its own portRowCenterY. */
const portPoint = (
  n: NodeData,
  port: 'left' | 'right',
  variantIndex: number,
): Point => ({
  x: n.x + (port === 'right' ? NODE_WIDTH : 0),
  y: n.y + portRowCenterY(n, variantIndex),
});

const rowCountOf = (n: NodeData, port: 'left' | 'right'): number =>
  socketSemanticIds(n, port).length;

/** The canvas handlers read only these fields off the synthetic event, so a
 *  structural stand-in beats rendering an SVG just to fabricate one.
 *  target/currentTarget come from the harness so the gate sees real elements. */
const mouseEvent = (
  opts: {
    button?: number;
    clientX?: number;
    clientY?: number;
    shiftKey?: boolean;
    target?: Element | null;
    currentTarget?: Element | null;
  } = {},
) =>
  ({
    button: opts.button ?? 0,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    shiftKey: opts.shiftKey ?? false,
    target: opts.target ?? null,
    currentTarget: opts.currentTarget ?? null,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  }) as unknown as ReactMouseEvent;

const setup = (
  opts: {
    nodes?: NodeData[];
    pan?: Point;
    zoom?: number;
    rect?: { left: number; top: number };
    selectedNodeIds?: Set<string>;
    connectingFromNodeId?: string | null;
    panToolActive?: boolean;
    /** Drops the canvas element, to pin the handleWheel null-canvas guard. */
    noCanvas?: boolean;
    /** Swaps the duplicate cluster's reducer/setter stubs for store-backed spies. */
    duplicateStores?: boolean;
    /** Tier-cap override: the real editor passes a callback that returns the FTL
     *  toast id when the pending copies would cross the cap (NodeTopologyEditor
     *  .tsx:1197). Default null = every duplicate allowed, as before. */
    duplicateRefusal?: (copies: NodeData[]) => string | null;
  } = {},
) => {
  // A pan that outlives a test would leave body.style.cursor = 'grabbing' for
  // the next one, so every harness starts from a clean slate.
  document.body.style.cursor = '';

  const rect = opts.rect ?? { left: 0, top: 0 };
  const canvas = document.createElement('div');
  canvas.className = 'node-canvas-container';
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: rect.left,
    top: rect.top,
  } as DOMRect);
  const canvasRef: RefObject<HTMLDivElement> = opts.noCanvas
    ? { current: null }
    : { current: canvas };

  // -- in-memory stores behind the setters: an updater is applied against the
  //    value the previous write produced, exactly as React would ------------
  const pan0 = opts.pan ?? { x: 0, y: 0 };
  const zoom0 = opts.zoom ?? 1;
  let panState: Point = { ...pan0 };
  let zoomState = zoom0;
  let marqueeState: MarqueeRect | null = null;
  let hoveredState: HoveredTarget | null = null;
  let menuState: ContextMenuPoint | null = null;
  let cursorState: Point | null = null;
  let activeState = false;
  const zoomLog: number[] = [];

  const setPan = vi.fn((value: SetStateAction<Point>) => {
    panState = typeof value === 'function' ? value(panState) : value;
  });
  const setZoom = vi.fn((value: SetStateAction<number>) => {
    zoomState = typeof value === 'function' ? value(zoomState) : value;
    zoomLog.push(zoomState);
  });
  const setMarquee = vi.fn((value: SetStateAction<MarqueeRect | null>) => {
    marqueeState = typeof value === 'function' ? value(marqueeState) : value;
  });
  const setHoveredTarget = vi.fn((value: SetStateAction<HoveredTarget | null>) => {
    hoveredState = typeof value === 'function' ? value(hoveredState) : value;
  });
  const setContextMenu = vi.fn((value: SetStateAction<ContextMenuPoint | null>) => {
    menuState = typeof value === 'function' ? value(menuState) : value;
  });
  const setPreviewCursor = vi.fn((value: SetStateAction<Point | null>) => {
    cursorState = typeof value === 'function' ? value(cursorState) : value;
  });
  const setPanGestureActive = vi.fn((value: SetStateAction<boolean>) => {
    activeState = typeof value === 'function' ? value(activeState) : value;
  });

  // -- parent-owned refs (the hook leaves them where the editor has them) ---
  const mousePosRef: MutableRefObject<Point> = { current: { x: 0, y: 0 } };
  const marqueeRef: MutableRefObject<MarqueeRect | null> = { current: null };
  const marqueeStartRef: MutableRefObject<Point | null> = { current: null };
  const marqueeAdditiveRef: MutableRefObject<boolean> = { current: false };
  const marqueeCleanupRef: MutableRefObject<(() => void) | null> = { current: null };
  const panMovedRef: MutableRefObject<boolean> = { current: false };
  const panStartRef: MutableRefObject<Point> = { current: { x: 0, y: 0 } };
  const panCleanupRef: MutableRefObject<(() => void) | null> = { current: null };
  const isPanningRef: MutableRefObject<boolean> = { current: false };
  const spaceDownRef: MutableRefObject<boolean> = { current: false };
  const userInteractedRef: MutableRefObject<boolean> = { current: false };

  // -- node-drag surface (slice 3.4c-1 folded the trio into this hook, so it
  //    reads the gesture refs instead of receiving applyDragMove/finalizeNodeDrag
  //    as callbacks). Every one is left EMPTY here: these tests never start a
  //    node drag, and the empty drag set is what makes the move feed a no-op.
  const draggingNodeIdsRef: MutableRefObject<Set<string>> = { current: new Set<string>() };
  const selectedNodeIdsRef: MutableRefObject<Set<string>> = {
    current: opts.selectedNodeIds ?? new Set<string>(),
  };
  const nodesRef: MutableRefObject<NodeData[]> = { current: opts.nodes ?? [] };
  const wiresRef: MutableRefObject<never[]> = { current: [] };
  const panRef: MutableRefObject<Point> = { current: pan0 };
  const zoomRef: MutableRefObject<number> = { current: zoom0 };
  const dragOffsetsRef: MutableRefObject<Map<string, Point>> = { current: new Map() };
  const dragStartRef: MutableRefObject<Map<string, Point>> = { current: new Map() };
  const dragHasMovedRef: MutableRefObject<boolean> = { current: false };
  const duplicateDragRef: MutableRefObject<boolean> = { current: false };
  const duplicateCopyIdsRef: MutableRefObject<string[]> = { current: [] };
  const duplicateHistoryPushedRef: MutableRefObject<boolean> = { current: false };
  const lastDragMovePosRef: MutableRefObject<Point | null> = { current: null };
  const dragCleanupRef: MutableRefObject<(() => void) | null> = { current: null };
  /** Inert: only the Alt+drag refusal path reads getString/duplicateRefusal. */
  const l10n = { getString: (id: string) => id };

  const dup = opts.duplicateStores
    ? dupStoreHarness(opts.nodes ?? [], nodesRef, draggingNodeIdsRef)
    : dupInertHarness();

  const selectMany = vi.fn((_ids: string[], _primary: string | null) => {});
  const clearSelection = vi.fn(() => {});
  const clearWire = vi.fn(() => {});
  const dismissPicker = vi.fn(() => {});

  const deps: PointerDeps = {
    pan: pan0,
    zoom: zoom0,
    nodes: opts.nodes ?? [],
    connectingFromNodeId: opts.connectingFromNodeId ?? null,
    selectedNodeIds: opts.selectedNodeIds ?? new Set<string>(),
    panToolActive: opts.panToolActive ?? false,
    canvasRef,
    mousePosRef,
    marqueeRef,
    marqueeStartRef,
    marqueeAdditiveRef,
    marqueeCleanupRef,
    panMovedRef,
    panStartRef,
    panCleanupRef,
    isPanningRef,
    spaceDownRef,
    userInteractedRef,
    setMarquee,
    setPreviewCursor,
    setHoveredTarget,
    setContextMenu,
    setPan,
    setZoom,
    setPanGestureActive,
    draggingNodeIdsRef,
    selectedNodeIdsRef,
    nodesRef,
    wiresRef,
    panRef,
    zoomRef,
    dragOffsetsRef,
    dragStartRef,
    dragHasMovedRef,
    duplicateDragRef,
    duplicateCopyIdsRef,
    lastDragMovePosRef,
    dragCleanupRef,
    beginDrag: dup.beginDrag,
    endDrag: dup.endDrag,
    cancelDrag: dup.cancelDrag,
    duplicateHistoryPushedRef,
    l10nRef: { current: l10n },
    setLiveAnnouncement: dup.setLiveAnnouncement,
    setRedo: dup.setRedo,
    pushHistory: dup.pushHistory,
    setNodes: dup.setNodes,
    setWires: dup.setWires,
    setHistory: dup.setHistory,
    setAlignmentGuide: dup.setAlignmentGuide,
    selectOnly: () => {},
    addToSelection: () => {},
    duplicateRefusal: opts.duplicateRefusal ?? (() => null),
    addToast: dup.addToast,
    l10n,
    snapEnabled: false,
    snap: (value: number) => value,
    selectMany,
    clearSelection,
    clearWire,
    dismissPicker,
  };

  const view = renderHook(() => useTopologyEditorPointer(deps));
  const api = view.result.current;

  /** A press ON the canvas container -- the gate primary background case. */
  const press = (o: Parameters<typeof mouseEvent>[0] = {}) =>
    act(() =>
      api.handleCanvasMouseDown(
        mouseEvent({ target: canvas, currentTarget: canvas, ...o }),
      ),
    );
  /** A press that bubbled up from a real descendant element. */
  const pressOn = (target: Element, o: Parameters<typeof mouseEvent>[0] = {}) =>
    act(() =>
      api.handleCanvasMouseDown(
        mouseEvent({ target, currentTarget: canvas, ...o }),
      ),
    );
  /** The canvas onMouseMove prop (React event; the hook reads clientX/Y). */
  const move = (clientX: number, clientY: number) =>
    act(() => api.handleCanvasMouseMove(mouseEvent({ clientX, clientY })));
  /** document-level mousemove -- the pan listener own channel. */
  const docMove = (clientX: number, clientY: number) =>
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
    });
  const docUp = () =>
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    });
  const startPan = (o: Parameters<typeof mouseEvent>[0] = {}, clearFirst = false) =>
    act(() =>
      api.startPan(
        mouseEvent({ target: canvas, currentTarget: canvas, ...o }),
        clearFirst,
      ),
    );
  const wheel = (o: { deltaY: number; clientX?: number; clientY?: number }) => {
    const e = {
      deltaY: o.deltaY,
      clientX: o.clientX ?? 0,
      clientY: o.clientY ?? 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    act(() => api.handleWheel(e as unknown as ReactWheelEvent));
    return e;
  };
  const contextMenu = (o: Parameters<typeof mouseEvent>[0] = {}) => {
    const e = mouseEvent({ target: canvas, currentTarget: canvas, button: 2, ...o });
    act(() => api.handleContextMenu(e));
    return e;
  };
  const finalizeMarquee = () => act(() => api.finalizeMarquee());
  /** Detaches whichever document listeners are still armed, so a test that
   *  arms twice never leaks a handler into the next test. */
  const disposeAll = () =>
    act(() => {
      marqueeCleanupRef.current?.();
      panCleanupRef.current?.();
      dragCleanupRef.current?.();
    });

  return {
    deps,
    api,
    canvas,
    press,
    pressOn,
    move,
    docMove,
    docUp,
    startPan,
    wheel,
    contextMenu,
    finalizeMarquee,
    disposeAll,
    unmount: view.unmount,
    setPan,
    setZoom,
    setMarquee,
    setHoveredTarget,
    setContextMenu,
    setPreviewCursor,
    setPanGestureActive,
    selectMany,
    clearSelection,
    clearWire,
    dismissPicker,
    dup,
    dragRefs: { draggingNodeIdsRef, dragHasMovedRef, duplicateDragRef, dragCleanupRef },
    getPan: () => panState,
    getZoom: () => zoomState,
    getMarquee: () => marqueeState,
    getHovered: () => hoveredState,
    getMenu: () => menuState,
    getCursor: () => cursorState,
    getPanActive: () => activeState,
    zoomLog,
    refs: {
      marqueeRef,
      marqueeStartRef,
      marqueeAdditiveRef,
      marqueeCleanupRef,
      panMovedRef,
      panStartRef,
      panCleanupRef,
      isPanningRef,
      spaceDownRef,
      userInteractedRef,
      mousePosRef,
    },
  };
};

describe('useTopologyEditorPointer -- startPan listener lifecycle', () => {
  it('detaches both document listeners in the cleanup ref, proven by re-arming', () => {
    const h = setup({ pan: { x: 100, y: 50 } });

    h.startPan({ clientX: 500, clientY: 300 });

    // Arming state, read off the parent-owned refs the editor also inspects.
    // The pan origin is client MINUS the pan, so the move handler recovers
    // pan = client - origin without a stale closure over the pan prop.
    expect(h.refs.isPanningRef.current).toBe(true);
    expect(h.refs.panMovedRef.current).toBe(false);
    expect(h.refs.panStartRef.current).toEqual({ x: 400, y: 250 });
    expect(h.getPanActive()).toBe(true);
    expect(document.body.style.cursor).toBe('grabbing');
    const dispose = h.refs.panCleanupRef.current;
    expect(typeof dispose).toBe('function');

    h.docMove(460, 300);
    expect(h.refs.panMovedRef.current).toBe(true);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    // pan = client - origin, in both axes: 460-400, 300-250.
    expect(h.setPan).toHaveBeenLastCalledWith({ x: 60, y: 50 });

    // The parent owns the disposer (the unmount sweep and the editor cancel
    // paths call it); running it detaches both listeners and resets the flag.
    act(() => dispose?.());
    expect(h.refs.panCleanupRef.current).toBeNull();
    expect(h.refs.isPanningRef.current).toBe(false);
    expect(h.getPanActive()).toBe(false);
    expect(document.body.style.cursor).toBe('');

    // Dispatching into a dead gesture proves nothing on its own: the move
    // handler early-returns while isPanningRef is false, so even a LEAKED
    // listener would stay quiet here. The proof is the second cycle below.
    h.docMove(999, 999);
    expect(h.setPan).toHaveBeenCalledTimes(1);

    // Cycle 2: one live handler means exactly ONE write for this mousemove. A
    // leaked cycle-1 listener would see isPanningRef true again and write too
    // -- and, reading the shared panStartRef, with the very same value, so a
    // value assertion alone could not catch it. Hence the call count.
    h.startPan({ clientX: 600, clientY: 400 });
    expect(h.refs.panStartRef.current).toEqual({ x: 500, y: 350 });
    h.docMove(620, 430);
    expect(h.setPan).toHaveBeenCalledTimes(2);
    expect(h.setPan).toHaveBeenLastCalledWith({ x: 120, y: 80 });
    // Pinned across BOTH cycles: true / false / true. A listener armed twice,
    // or a disposer that ran twice, would append a fourth call.
    expect(h.setPanGestureActive.mock.calls).toEqual([[true], [false], [true]]);

    // Tidy up, and pin that the second cycle's disposer completes the pair:
    // arm / dispose / arm / dispose — two gestures, two releases, no extra.
    h.disposeAll();
    expect(h.setPanGestureActive.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ]);
    expect(h.refs.isPanningRef.current).toBe(false);
    expect(document.body.style.cursor).toBe('');
    h.unmount();
  });

  it('ends on a document mouseup, and the next pan starts from its own origin', () => {
    const h = setup();

    // clearSelectionFirst is how the middle/right-button branch drops the
    // selection at press time; Space+drag passes false instead (pinned below).
    h.startPan({ clientX: 200, clientY: 200 }, true);
    expect(h.clearSelection).toHaveBeenCalledTimes(1);
    h.docMove(240, 210);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    expect(h.getPan()).toEqual({ x: 40, y: 10 });

    // The installed mouseup listener runs the SAME disposer the ref exposes,
    // so the release path and the parent path can never diverge.
    h.docUp();
    expect(h.refs.isPanningRef.current).toBe(false);
    expect(h.refs.panCleanupRef.current).toBeNull();
    expect(h.getPanActive()).toBe(false);
    expect(document.body.style.cursor).toBe('');

    // Cycle 2 with a different origin: had the first mousemove handler leaked,
    // this single move would write twice -- once computed from the stale value.
    h.startPan({ clientX: 100, clientY: 100 });
    h.docMove(150, 120);
    expect(h.setPan).toHaveBeenCalledTimes(2);
    expect(h.getPan()).toEqual({ x: 50, y: 20 });
    expect(h.clearSelection).toHaveBeenCalledTimes(1);
    expect(h.setPanGestureActive.mock.calls).toEqual([
      [true],
      [false],
      [true],
    ]);

    h.disposeAll();
    h.unmount();
  });
});

describe('useTopologyEditorPointer -- marquee commit semantics', () => {
  it('commits the contained set exactly once per release, across two arms', () => {
    // n-1 occupies (0..240, 0..240); n-2 occupies (250..490, 250..490). A box
    // 0..300 fully contains n-1 only; 0..500 contains both.
    const nodes = [storeOf('n-1', 0, 0), storeOf('n-2', 250, 250)];
    const h = setup({ nodes });

    h.press({ clientX: 0, clientY: 0 });
    expect(h.clearWire).toHaveBeenCalledTimes(1);
    expect(h.dismissPicker).toHaveBeenCalledTimes(1);
    expect(h.setContextMenu).toHaveBeenCalledWith(null);
    expect(h.refs.userInteractedRef.current).toBe(true);
    expect(h.refs.marqueeStartRef.current).toEqual({ x: 0, y: 0 });
    expect(h.refs.marqueeRef.current).toBeNull();
    expect(typeof h.refs.marqueeCleanupRef.current).toBe('function');
    // A plain left-drag is the marquee, not a pan.
    expect(h.refs.isPanningRef.current).toBe(false);
    expect(h.setPanGestureActive).not.toHaveBeenCalled();

    h.move(300, 300);
    // The move feed runs on every mousemove but is inert with an empty drag
    // set, so a marquee drag never writes the node graph.
    expect(h.refs.mousePosRef.current).toEqual({ x: 300, y: 300 });
    expect(h.getMarquee()).toEqual({ x0: 0, y0: 0, x1: 300, y1: 300 });
    // The ref mirror is what the document-armed finalizer reads, so a stale
    // render closure cannot cost a selection.
    expect(h.refs.marqueeRef.current).toEqual(h.getMarquee());
    expect(h.selectMany).not.toHaveBeenCalled();

    // Release lives on document, so lifting OUTSIDE the canvas still commits.
    h.docUp();
    expect(h.selectMany).toHaveBeenCalledTimes(1);
    expect(h.selectMany).toHaveBeenLastCalledWith(['n-1'], 'n-1');
    expect(h.getMarquee()).toBeNull();
    expect(h.refs.marqueeStartRef.current).toBeNull();
    expect(h.refs.marqueeCleanupRef.current).toBeNull();

    // Cycle 2 -- a leaked cycle-1 mouseup would finalize twice on this one
    // release (both closures share the refs), taking the count to 3.
    h.press({ clientX: 0, clientY: 0 });
    h.move(500, 500);
    h.docUp();
    expect(h.selectMany).toHaveBeenCalledTimes(2);
    expect(h.selectMany).toHaveBeenLastCalledWith(['n-1', 'n-2'], 'n-2');
    h.unmount();
  });

  it('commits nothing when the box never rendered or has no area', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0), storeOf('n-2', 250, 250)] });

    // Press + release without a single mousemove: a plain background click.
    // The selection was already cleared when it started, and nothing commits.
    h.press({ clientX: 5, clientY: 5 });
    h.docUp();
    expect(h.clearSelection).toHaveBeenCalledTimes(1);
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.getMarquee()).toBeNull();
    expect(h.refs.marqueeStartRef.current).toBeNull();

    // A purely vertical drag HAS rendered (marqueeRef is set) but is click-
    // sized horizontally, so the degenerate-box rule stops it before the hit
    // test: no commit, and no second clear either.
    h.press({ clientX: 40, clientY: 40 });
    h.move(40, 240);
    expect(h.getMarquee()).toEqual({ x0: 40, y0: 40, x1: 40, y1: 240 });
    h.finalizeMarquee();
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.clearSelection).toHaveBeenCalledTimes(2);
    expect(h.getMarquee()).toBeNull();
    expect(h.refs.marqueeRef.current).toBeNull();

    // A finalizer call with no start ref is inert -- the guard that makes a
    // double release (document listener + the parent cancelMarquee) idempotent.
    h.finalizeMarquee();
    expect(h.selectMany).not.toHaveBeenCalled();
    h.disposeAll();
    h.unmount();
  });

  it('selects touched nodes backward, and a Shift drag unions without clearing', () => {
    const nodes = [storeOf('n-1', 0, 0), storeOf('n-2', 250, 250)];

    // The 100..300 box read FORWARD demands full containment, so neither card
    // qualifies: 0..240 is not inside it and 250..490 is not inside it either.
    const fwd = setup({ nodes });
    fwd.press({ clientX: 100, clientY: 100 });
    fwd.move(300, 300);
    fwd.docUp();
    expect(fwd.selectMany).not.toHaveBeenCalled();
    expect(fwd.clearSelection).toHaveBeenCalledTimes(2);

    // Dragged BACKWARD over the identical box, the marquee takes everything it
    // touches instead -- the Figma/draw.io convention.
    const bwd = setup({ nodes });
    bwd.press({ clientX: 300, clientY: 300 });
    bwd.move(100, 100);
    bwd.docUp();
    expect(bwd.selectMany).toHaveBeenCalledTimes(1);
    expect(bwd.selectMany).toHaveBeenLastCalledWith(['n-1', 'n-2'], 'n-2');
    // The only clear is the non-additive press; the commit itself never clears.
    expect(bwd.clearSelection).toHaveBeenCalledTimes(1);

    // Shift+drag: the existing selection survives press time, and the
    // finalizer unions the hit set into it with primary = last captured node.
    const add = setup({ nodes, selectedNodeIds: new Set(['pre']) });
    add.press({ clientX: 0, clientY: 0, shiftKey: true });
    expect(add.refs.marqueeAdditiveRef.current).toBe(true);
    expect(add.clearSelection).not.toHaveBeenCalled();
    add.move(500, 500);
    add.docUp();
    expect(add.refs.marqueeAdditiveRef.current).toBe(false);
    expect(add.selectMany).toHaveBeenLastCalledWith(['pre', 'n-1', 'n-2'], 'n-2');

    // A hitless additive marquee clears nothing either -- the else-branch is
    // gated on not-additive, which is what keeps Shift+click on empty canvas
    // selection-preserving.
    const miss = setup({ nodes, selectedNodeIds: new Set(['pre']) });
    miss.press({ clientX: 900, clientY: 900, shiftKey: true });
    miss.move(980, 980);
    miss.docUp();
    expect(miss.selectMany).not.toHaveBeenCalled();
    expect(miss.clearSelection).not.toHaveBeenCalled();
    fwd.unmount();
    bwd.unmount();
    add.unmount();
    miss.unmount();
  });
});

describe('useTopologyEditorPointer -- handleCanvasMouseDown background gate', () => {
  it('arms nothing when the press lands on a card, a wire or the rack', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0)] });
    // Space held would otherwise turn every left press below into a pan.
    h.refs.spaceDownRef.current = true;

    const card = document.createElement('div');
    card.className = 'node-card';
    const title = document.createElement('span');
    title.className = 'node-title';
    card.append(title);
    const wirePath = document.createElementNS(SVG_NS, 'path');
    wirePath.setAttribute('class', 'topology-wire-hit');
    const rack = document.createElement('div');
    rack.className = 'topology-toolrack';
    const rackButton = document.createElement('button');
    rackButton.className = 'topology-toolrack-item';
    rack.append(rackButton);
    // A path inside the wires SVG is not the SVG root, so the gate third arm
    // (tagName === 'svg') does not let it through either.
    const targets: Element[] = [card, title, wirePath, rack, rackButton];

    for (const el of targets) {
      for (const button of [0, 1, 2]) {
        h.pressOn(el, { button, clientX: 12, clientY: 12 });
        // Nothing armed: no marquee, no pan, no listener, no selection churn.
        expect(h.refs.marqueeStartRef.current).toBeNull();
        expect(h.refs.marqueeCleanupRef.current).toBeNull();
        expect(h.refs.isPanningRef.current).toBe(false);
        expect(h.refs.panCleanupRef.current).toBeNull();
        expect(h.setPanGestureActive).not.toHaveBeenCalled();
        expect(h.selectMany).not.toHaveBeenCalled();
        expect(h.clearSelection).not.toHaveBeenCalled();
        expect(h.clearWire).not.toHaveBeenCalled();
      }
    }
    // The pre-gate housekeeping still runs on every press: 5 targets x 3 buttons.
    expect(h.dismissPicker).toHaveBeenCalledTimes(15);
    expect(h.setContextMenu).toHaveBeenCalledTimes(15);
    expect(h.refs.userInteractedRef.current).toBe(true);
    // A stray release must not fabricate a selection.
    h.docUp();
    expect(h.selectMany).not.toHaveBeenCalled();
    h.unmount();
  });

  it('arms on the container, the viewport layer and the SVG root only', () => {
    const h = setup();

    const viewport = document.createElement('div');
    viewport.className = 'node-canvas-viewport';
    const svgRoot = document.createElementNS(SVG_NS, 'svg');

    h.press({ clientX: 1, clientY: 1 });
    expect(h.refs.marqueeStartRef.current).toEqual({ x: 1, y: 1 });
    h.refs.marqueeCleanupRef.current?.();

    h.pressOn(viewport, { clientX: 2, clientY: 3 });
    expect(h.refs.marqueeStartRef.current).toEqual({ x: 2, y: 3 });
    h.refs.marqueeCleanupRef.current?.();

    h.pressOn(svgRoot, { clientX: 4, clientY: 5 });
    expect(h.refs.marqueeStartRef.current).toEqual({ x: 4, y: 5 });
    h.refs.marqueeCleanupRef.current?.();
    // All three took the marquee branch, never the pan branch.
    expect(h.refs.isPanningRef.current).toBe(false);
    expect(h.setPanGestureActive).not.toHaveBeenCalled();
    expect(h.selectMany).not.toHaveBeenCalled();
    h.unmount();
  });

  it('pans without clearing for Space and the Pan tool, and clears for middle/right', () => {
    // Space + left button: Figma-style, the selection is preserved.
    const space = setup();
    space.refs.spaceDownRef.current = true;
    space.press({ clientX: 300, clientY: 200 });
    expect(space.refs.isPanningRef.current).toBe(true);
    expect(space.getPanActive()).toBe(true);
    expect(space.refs.panStartRef.current).toEqual({ x: 300, y: 200 });
    expect(space.clearSelection).not.toHaveBeenCalled();
    expect(space.refs.marqueeStartRef.current).toBeNull();
    space.disposeAll();

    // The Pan tool reaches the same branch without the modifier.
    const tool = setup({ panToolActive: true });
    tool.press({ clientX: 50, clientY: 60 });
    expect(tool.refs.isPanningRef.current).toBe(true);
    expect(tool.clearSelection).not.toHaveBeenCalled();
    tool.disposeAll();

    // Middle button pans and clears first.
    const mid = setup();
    mid.press({ clientX: 70, clientY: 80, button: 1 });
    expect(mid.refs.isPanningRef.current).toBe(true);
    expect(mid.clearSelection).toHaveBeenCalledTimes(1);
    expect(mid.refs.marqueeStartRef.current).toBeNull();
    mid.disposeAll();

    // Right button likewise, and it re-arms the contextmenu gate by clearing
    // panMovedRef -- the flag the consume-then-reset rule below reads.
    const right = setup();
    right.refs.panMovedRef.current = true;
    right.press({ clientX: 70, clientY: 80, button: 2 });
    expect(right.refs.isPanningRef.current).toBe(true);
    expect(right.refs.panMovedRef.current).toBe(false);
    expect(right.clearSelection).toHaveBeenCalledTimes(1);
    right.disposeAll();
    space.unmount();
    tool.unmount();
    mid.unmount();
    right.unmount();
  });
});

describe('useTopologyEditorPointer -- context menu and wheel', () => {
  it('consumes the post-pan contextmenu once, then lets a plain right-click open', () => {
    const h = setup({ rect: { left: 200, top: 50 } });

    // A right-button drag ends with a native contextmenu. That one event is
    // eaten -- and eating it RESETS the flag, so the next stationary click is
    // not punished for the gesture that just ended.
    h.refs.panMovedRef.current = true;
    const eaten = h.contextMenu({ clientX: 500, clientY: 300 });
    expect(eaten.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.refs.panMovedRef.current).toBe(false);
    expect(h.setContextMenu).not.toHaveBeenCalled();
    expect(h.getMenu()).toBeNull();

    // Same coordinates, flag now clear: the menu opens, anchored in container-
    // relative px (client minus the canvas rect origin).
    const opened = h.contextMenu({ clientX: 500, clientY: 300 });
    expect(opened.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.setContextMenu).toHaveBeenCalledTimes(1);
    expect(h.getMenu()).toEqual({ x: 300, y: 250 });
    h.unmount();
  });

  it('clamps wheel zoom to 0.4..2.0 however many notches arrive', () => {
    const h = setup({
      zoom: 1,
      pan: { x: 100, y: -40 },
      rect: { left: 200, top: 50 },
    });

    for (let i = 0; i < 60; i += 1) {
      h.wheel({ deltaY: -100, clientX: 500, clientY: 300 });
    }
    expect(h.getZoom()).toBe(2);
    expect(Math.max(...h.zoomLog)).toBeLessThanOrEqual(2);

    for (let i = 0; i < 120; i += 1) {
      h.wheel({ deltaY: 100, clientX: 500, clientY: 300 });
    }
    expect(h.getZoom()).toBe(0.4);
    expect(Math.min(...h.zoomLog)).toBeGreaterThanOrEqual(0.4);
    expect(h.setZoom).toHaveBeenCalledTimes(180);
    // One pan write per notch, always from inside the zoom updater -- the two
    // setters cannot drift apart, which is what keeps the cursor fixed.
    expect(h.setPan).toHaveBeenCalledTimes(180);

    // Characterization: the factor branch is deltaY < 0 ? 1.1 : 0.9, so a zero-
    // delta wheel event counts as a zoom-out notch.
    const flat = setup({ zoom: 1 });
    flat.wheel({ deltaY: 0 });
    expect(flat.getZoom()).toBeCloseTo(0.9, 10);

    // preventDefault runs BEFORE the canvas guard: the page must never scroll,
    // even on a wheel event whose zoom cannot be applied.
    const noCanvas = setup({ noCanvas: true });
    const e = noCanvas.wheel({ deltaY: -100 });
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(noCanvas.setZoom).not.toHaveBeenCalled();
    expect(noCanvas.setPan).not.toHaveBeenCalled();
    h.unmount();
    flat.unmount();
    noCanvas.unmount();
  });

  it('zooms toward the cursor: the canvas point under the pointer never moves', () => {
    const rect = { left: 200, top: 50 };
    const h = setup({ zoom: 1.25, pan: { x: 100, y: -40 }, rect });
    const cursor = { x: 500, y: 300 };
    const cursorX = cursor.x - rect.left;
    const cursorY = cursor.y - rect.top;
    const beforeX = (cursorX - h.getPan().x) / h.getZoom();
    const beforeY = (cursorY - h.getPan().y) / h.getZoom();

    // One step, asserted numerically before it is asserted as an invariant:
    // zoom 1.25 -> 1.375 and pan = cursor - (cursor - pan) * (newZoom / prev).
    h.wheel({ deltaY: -1, clientX: cursor.x, clientY: cursor.y });
    expect(h.getZoom()).toBeCloseTo(1.375, 10);
    expect(h.getPan().x).toBeCloseTo(300 - 200 * 1.1, 10);
    expect(h.getPan().y).toBeCloseTo(250 - 290 * 1.1, 10);
    expect((cursorX - h.getPan().x) / h.getZoom()).toBeCloseTo(beforeX, 10);
    expect((cursorY - h.getPan().y) / h.getZoom()).toBeCloseTo(beforeY, 10);

    // In and out, including the notches that sit on the clamp (where the ratio
    // is 1 and pan is deliberately left alone): the invariant has to hold on
    // every single step, not just on the first one.
    for (let i = 0; i < 12; i += 1) {
      h.wheel({ deltaY: -1, clientX: cursor.x, clientY: cursor.y });
      expect((cursorX - h.getPan().x) / h.getZoom()).toBeCloseTo(beforeX, 6);
      expect((cursorY - h.getPan().y) / h.getZoom()).toBeCloseTo(beforeY, 6);
      h.wheel({ deltaY: 1, clientX: cursor.x, clientY: cursor.y });
      expect((cursorX - h.getPan().x) / h.getZoom()).toBeCloseTo(beforeX, 6);
      expect((cursorY - h.getPan().y) / h.getZoom()).toBeCloseTo(beforeY, 6);
    }
    // Both setters are always called with updaters, never with a captured
    // value: zoom-to-cursor must compose with a queued pan write from a drag.
    expect(h.setZoom.mock.calls.every((c) => typeof c[0] === 'function')).toBe(true);
    expect(h.setPan.mock.calls.every((c) => typeof c[0] === 'function')).toBe(true);
    h.unmount();
  });
});

describe('useTopologyEditorPointer -- handleCanvasMouseMove branches', () => {
  it('keeps hoveredTarget referentially stable while the pointer stays on a port', () => {
    const b = posOf('b', 500, 0);
    const h = setup({ nodes: [posOf('a', 0, 0), b], connectingFromNodeId: 'a' });
    const port = portPoint(b, 'left', 0);
    expect(rowCountOf(b, 'left')).toBeGreaterThan(0);
    expect(rowCountOf(b, 'right')).toBeGreaterThan(1);

    h.move(port.x, port.y);
    expect(h.setHoveredTarget).toHaveBeenCalledTimes(1);
    const first = h.getHovered();
    expect(first).toEqual({ nodeId: 'b', port: 'left', variantIndex: 0 });

    // The identity-preserve rule: same node, same port, same row, so the
    // updater returns prev and no memoized node card re-renders per mousemove.
    h.move(port.x + 1, port.y + 1);
    expect(h.setHoveredTarget).toHaveBeenCalledTimes(2);
    expect(h.getHovered()).toBe(first);
    const updater = h.setHoveredTarget.mock.calls[1]?.[0];
    expect(
      (updater as (prev: HoveredTarget | null) => HoveredTarget | null)(first),
    ).toBe(first);

    // A different ROW on the same card is a different target -- the check is on
    // the whole triple, not on "is some port hovered".
    const otherRow = portPoint(b, 'right', 1);
    h.move(otherRow.x, otherRow.y);
    const second = h.getHovered();
    expect(second).not.toBe(first);
    expect(second).toEqual({ nodeId: 'b', port: 'right', variantIndex: 1 });

    // Off every port: back to null, and null stays null (no fresh object per
    // mousemove on the way out either).
    h.move(4000, 4000);
    expect(h.getHovered()).toBeNull();
    h.move(4100, 4100);
    expect(h.getHovered()).toBeNull();

    // The preview cursor is fed on the same branch: (client - rect - pan)/zoom,
    // and it keeps following the pointer even where nothing is hovered.
    expect(h.getCursor()).toEqual({ x: 4100, y: 4100 });

    // An armed marquee owns the mousemove instead -- the else-if keeps the two
    // branches mutually exclusive.
    h.press({ clientX: 10, clientY: 10 });
    const before = h.setHoveredTarget.mock.calls.length;
    h.move(port.x, port.y);
    expect(h.setHoveredTarget).toHaveBeenCalledTimes(before);
    expect(h.getMarquee()).toEqual({ x0: 10, y0: 10, x1: port.x, y1: port.y });
    h.refs.marqueeCleanupRef.current?.();
    h.unmount();
  });

  it('feeds the drag and the cursor mirror but skips snapping with no connection in flight', () => {
    const b = posOf('b', 500, 0);
    const h = setup({ nodes: [posOf('a', 0, 0), b] });
    const port = portPoint(b, 'left', 0);

    h.move(port.x, port.y);

    expect(h.refs.mousePosRef.current).toEqual({ x: port.x, y: port.y });
    expect(h.setHoveredTarget).not.toHaveBeenCalled();
    expect(h.setPreviewCursor).not.toHaveBeenCalled();
    h.unmount();
  });

  it('writes no selection and no marquee on the canvas mouseup', () => {
    const h = setup();
    // The canvas mouseup only ends the node drag (now internal to the hook,
    // inert with an empty drag set). The marquee is finalized by its OWN
    // document listener, so releasing here must not touch selection or box.
    act(() => h.api.handleCanvasMouseUp());
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.clearSelection).not.toHaveBeenCalled();
    expect(h.setMarquee).not.toHaveBeenCalled();
    expect(h.getMarquee()).toBeNull();
    h.unmount();
  });
});

// The duplicate cluster moved into this hook with 59d37d6c1 (slice 3.4c-2);
// the block above only proves the WIRING. This describe characterizes the
// cluster's own lifecycle semantics, read off the bodies at that SHA:
// beginNodeDrag's Alt arm (copies in at the originals' positions, offsets
// keyed to the copies), the commit's ONE-filtered-entry contract and its
// one-shot guard, convertDragToDuplicate's mid-move handoff (the move's own
// history entry is REUSED, never duplicated), both cancels, and the
// no-movement release. duplicateStores: true arms the store-backed bundle
// above; everything else is the identical harness.
describe('useTopologyEditorPointer -- duplicate-drag cluster lifecycle', () => {
  it('arms an Alt drag: copies in at the originals position, offsets keyed to the copies', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0)], duplicateStores: true });

    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), true, 'mouse'));

    expect(h.dragRefs.duplicateDragRef.current).toBe(true);
    const copyIds = h.deps.duplicateCopyIdsRef.current;
    expect(copyIds).toHaveLength(1);
    const copyId = copyIds[0] ?? '';
    expect(copyId).toMatch(/^store-/);
    // The drag set IS the copies (the reducer mirror was written at arm).
    expect([...h.dragRefs.draggingNodeIdsRef.current]).toEqual([copyId]);
    // The copy exists AT the original's position -- the in-place preview.
    const nodes = h.dup.getNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({ id: copyId, x: 0, y: 0 });
    // Grip offsets are computed from the ORIGINAL under the cursor, keyed by
    // the copy id the drag actually moves.
    expect(h.deps.dragOffsetsRef.current.get(copyId)).toEqual({ x: 10, y: 10 });
    expect(h.deps.dragStartRef.current.get(copyId)).toEqual({ x: 0, y: 0 });
    // The threshold is not latched, the auto-pan baseline is seeded, the copy
    // cursor is on, and nothing historical happened yet.
    expect(h.dragRefs.dragHasMovedRef.current).toBe(false);
    expect(h.deps.lastDragMovePosRef.current).toEqual({ x: 10, y: 10 });
    expect(document.body.style.cursor).toBe('copy');
    expect(h.dup.pushHistory).not.toHaveBeenCalled();
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    h.disposeAll();
    h.unmount();
  });

  it('a move past the threshold latches dragHasMovedRef and defers the history push to the drop', () => {
    const h = setup({
      nodes: [storeOf('n-1', 0, 0), storeOf('n-2', 600, 600)],
      duplicateStores: true,
    });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), true, 'mouse'));

    h.move(110, 110);

    expect(h.dragRefs.dragHasMovedRef.current).toBe(true);
    // A duplicate drag defers its undo entry to the drop: the first movement
    // latches the flag but pushes NOTHING (the plain-move path would have).
    expect(h.dup.pushHistory).not.toHaveBeenCalled();
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    // The copy followed the pointer (grip offset math keyed to the copy).
    expect(h.dup.getNodes()[2]).toMatchObject({ x: 100, y: 100 });
    // No alignment guide: the stationary n-2 sits far beyond the 6px snap.
    expect(h.dup.setAlignmentGuide).toHaveBeenCalledWith(null);
    h.disposeAll();
    h.unmount();
  });

  it('commits a moved Alt drag as ONE filtered history entry and is one-shot after the release', () => {
    const h = setup({
      nodes: [storeOf('n-1', 0, 0), storeOf('n-2', 600, 600)],
      duplicateStores: true,
    });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), true, 'mouse'));
    const copyId = h.deps.duplicateCopyIdsRef.current[0] ?? '';
    h.move(110, 110);

    h.docUp();

    // The whole duplicate-drop lands as ONE undo entry: the PRE-drag state,
    // i.e. the current graph minus the copy ids (originals never moved).
    expect(h.dup.getHistory()).toHaveLength(1);
    const entry = h.dup.getHistory()[0];
    expect(entry?.nodes.map((n) => n.id)).toEqual(['n-1', 'n-2']);
    expect(entry?.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(entry?.nodes[1]).toMatchObject({ x: 600, y: 600 });
    // The copies become the selection, redo is invalidated, live region fires.
    expect(h.selectMany).toHaveBeenCalledTimes(1);
    expect(h.selectMany).toHaveBeenLastCalledWith([copyId], copyId);
    expect(h.dup.setRedo).toHaveBeenCalledWith([]);
    expect(h.dup.setLiveAnnouncement).toHaveBeenCalledWith('topology-duplicate-announce');
    // Drop-overlap resolution is SKIPPED for duplicates: the landing spot IS
    // the intent, so the copy stays exactly where it was dropped.
    expect(h.dup.getNodes()[2]).toMatchObject({ x: 100, y: 100 });
    // Every gesture ref is reset...
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.deps.duplicateHistoryPushedRef.current).toBe(false);
    expect(h.dragRefs.dragHasMovedRef.current).toBe(false);
    expect(h.deps.dragOffsetsRef.current.size).toBe(0);
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.dragRefs.draggingNodeIdsRef.current.size).toBe(0);
    expect(document.body.style.cursor).toBe('');
    // ...and the internal commit is one-shot: the same release replayed (the
    // canvas mouseup can fire after the document one) commits nothing more.
    act(() => h.api.finalizeNodeDrag());
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.setHistory).toHaveBeenCalledTimes(1);
    expect(h.selectMany).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('convertDragToDuplicate hands the in-flight move over without a second history entry', () => {
    const h = setup({
      nodes: [storeOf('n-1', 0, 0), storeOf('n-2', 600, 600)],
      duplicateStores: true,
    });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1', 'n-2']), false, 'mouse'));
    h.move(110, 110);
    // A plain move pushed exactly one entry: the pre-drag state.
    expect(h.dup.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dragRefs.dragHasMovedRef.current).toBe(true);

    act(() => h.api.convertDragToDuplicate());

    const copyIds = h.deps.duplicateCopyIdsRef.current;
    const [c1, c2] = copyIds;
    expect(h.dragRefs.duplicateDragRef.current).toBe(true);
    // The originals snapped back to their pre-drag positions; the copies took
    // over the cursor from the mid-drag positions.
    const nodes = h.dup.getNodes();
    expect(nodes.find((n) => n.id === 'n-1')).toMatchObject({ x: 0, y: 0 });
    expect(nodes.find((n) => n.id === 'n-2')).toMatchObject({ x: 600, y: 600 });
    expect(nodes.find((n) => n.id === c1)).toMatchObject({ x: 100, y: 100 });
    expect(nodes.find((n) => n.id === c2)).toMatchObject({ x: 700, y: 700 });
    // The drag set and grip offsets are re-keyed to the copies (same offsets).
    expect([...h.dragRefs.draggingNodeIdsRef.current].sort()).toEqual(
      [c1 ?? '', c2 ?? ''].sort(),
    );
    expect(h.deps.dragOffsetsRef.current.get(c1 ?? '')).toEqual({ x: 10, y: 10 });
    expect(h.deps.dragOffsetsRef.current.get(c2 ?? '')).toEqual({ x: -590, y: -590 });
    expect(document.body.style.cursor).toBe('copy');
    // The move's own entry IS the pre-drag state: the conversion pushes
    // nothing and marks the flag the commit reuses / the cancel pops.
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    expect(h.deps.duplicateHistoryPushedRef.current).toBe(true);

    // The converted drag keeps moving (still no push) and the drop reuses the
    // entry -- one undo for the whole gesture, exactly like a born-Alt drag.
    h.move(510, 510);
    expect(h.dup.getHistory()).toHaveLength(1);
    h.docUp();
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    expect(h.selectMany).toHaveBeenLastCalledWith([c1 ?? '', c2 ?? ''], c1);
    const finalNodes = h.dup.getNodes();
    expect(finalNodes.find((n) => n.id === 'n-1')).toMatchObject({ x: 0, y: 0 });
    expect(finalNodes.find((n) => n.id === c1)).toMatchObject({ x: 500, y: 500 });
    expect(finalNodes.find((n) => n.id === c2)).toMatchObject({ x: 1100, y: 1100 });
    h.unmount();
  });

  it('cancelDuplicateDrag discards the copies, resets every ref, and leaves history untouched', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0)], duplicateStores: true });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), true, 'mouse'));
    h.move(110, 110);

    act(() => h.api.cancelDuplicateDrag());

    // The preview copies are gone; the original never moved.
    const nodes = h.dup.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'n-1', x: 0, y: 0 });
    // A born-Alt drag never pushed an entry, so cancel pops nothing either.
    expect(h.dup.getHistory()).toHaveLength(0);
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.deps.duplicateHistoryPushedRef.current).toBe(false);
    expect(h.dragRefs.dragHasMovedRef.current).toBe(false);
    expect(h.deps.dragOffsetsRef.current.size).toBe(0);
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.dragRefs.draggingNodeIdsRef.current.size).toBe(0);
    expect(h.dup.setAlignmentGuide).toHaveBeenLastCalledWith(null);
    expect(h.dup.setLiveAnnouncement).toHaveBeenCalledWith('topology-duplicate-cancel-announce');
    expect(document.body.style.cursor).toBe('');
    expect(h.dragRefs.dragCleanupRef.current).toBeNull();

    // The document mouseup listener is GONE: a leaked finalize would select
    // the discarded copies. Replaying the release changes nothing.
    h.docUp();
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.dup.getNodes()).toHaveLength(1);
    expect(h.dup.getHistory()).toHaveLength(0);
    // Escape twice: the guard makes the second cancel inert (no re-announce).
    act(() => h.api.cancelDuplicateDrag());
    expect(h.dup.setLiveAnnouncement).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('cancelNodeMove restores the pre-drag positions of a plain move and pops its entry', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0)], duplicateStores: true });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), false, 'mouse'));
    h.move(110, 110);
    expect(h.dup.getNodes()[0]).toMatchObject({ x: 100, y: 100 });
    expect(h.dup.getHistory()).toHaveLength(1);

    act(() => h.api.cancelNodeMove());

    expect(h.dup.getNodes()[0]).toMatchObject({ id: 'n-1', x: 0, y: 0 });
    expect(h.dup.getHistory()).toHaveLength(0);
    expect(h.dragRefs.dragHasMovedRef.current).toBe(false);
    expect(h.deps.dragOffsetsRef.current.size).toBe(0);
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.dragRefs.draggingNodeIdsRef.current.size).toBe(0);
    expect(h.dup.setAlignmentGuide).toHaveBeenLastCalledWith(null);
    // Plain moves never touch the duplicate surface or the selection.
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.dup.setLiveAnnouncement).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
    expect(h.dragRefs.dragCleanupRef.current).toBeNull();

    h.docUp();
    expect(h.dup.getNodes()[0]).toMatchObject({ x: 0, y: 0 });
    expect(h.dup.getHistory()).toHaveLength(0);
    h.unmount();
  });

  it('a release that never moved commits nothing on a plain drag', () => {
    const h = setup({ nodes: [storeOf('n-1', 0, 0)], duplicateStores: true });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), false, 'mouse'));
    expect(h.deps.dragStartRef.current.get('n-1')).toEqual({ x: 0, y: 0 });

    h.docUp();

    expect(h.dup.getHistory()).toHaveLength(0);
    expect(h.dup.pushHistory).not.toHaveBeenCalled();
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.dup.getNodes()).toHaveLength(1);
    expect(h.dup.getNodes()[0]).toMatchObject({ id: 'n-1', x: 0, y: 0 });
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.deps.lastDragMovePosRef.current).toBeNull();
    expect(h.dragRefs.dragCleanupRef.current).toBeNull();
    h.unmount();
  });

  // ── The tier-cap refusal (coder-38, closes coder-35's unpinned follow-up) ──
  // Both duplicate entry points consult ONE dep callback -- `duplicateRefusal`
  // (NodeTopologyEditor.tsx:1197, which filters the PENDING copies on
  // type === 'warehouse' and refuses when the install would cross the cap) --
  // and both bail out the same way: a warning toast, and NOTHING else. The
  // convert site (nodeTopologyEditorPointer.ts:405-413) says it plainly: "the
  // move simply stays a move"; the arm site (:585-601) says "refused up front
  // (no copies, no drag, no history entry)". Two call sites, two different
  // half-armed states to leave intact, so each is pinned on its own.
  const refusalSpy = () =>
    vi.fn((copies: NodeData[]) =>
      copies.some((n) => n.type === 'warehouse')
        ? 'topology-toast-multi-warehouse'
        : null,
    );

  it('convertDragToDuplicate refuses past the tier cap and the move stays a move', () => {
    const refusal = refusalSpy();
    const h = setup({
      nodes: [warehouseOf('w-1', 0, 0), storeOf('s-2', 600, 600)],
      duplicateStores: true,
      duplicateRefusal: refusal,
    });
    // A PLAIN move, already past the threshold: it owns one history entry and
    // the warehouse sits mid-drag at (100, 100).
    act(() => h.api.beginNodeDrag(10, 10, new Set(['w-1']), false, 'mouse'));
    h.move(110, 110);
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.getNodes()[0]).toMatchObject({ id: 'w-1', x: 100, y: 100 });
    expect(h.dup.addToast).not.toHaveBeenCalled();

    act(() => h.api.convertDragToDuplicate());

    // Consulted with the PENDING copies only -- the dragged set, not the graph.
    expect(refusal).toHaveBeenCalledTimes(1);
    expect(refusal.mock.calls[0]?.[0].map((n) => n.id)).toEqual(['w-1']);
    // The refusal is user-visible: the FTL id straight through getString (the
    // harness l10n is identity, so the toast message IS the key).
    expect(h.dup.addToast).toHaveBeenCalledTimes(1);
    expect(h.dup.addToast).toHaveBeenCalledWith({
      message: 'topology-toast-multi-warehouse',
      type: 'warning',
    });
    // Refused means NO copies inserted, and no wire copies either.
    expect(h.dup.getNodes().map((n) => n.id)).toEqual(['w-1', 's-2']);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.dup.setWires).not.toHaveBeenCalled();
    // ...and the drag refs stay DRAG-shaped: the conversion never ran, so the
    // set is still keyed to the original, the threshold is still latched, and
    // the duplicate surface was never armed.
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.deps.duplicateHistoryPushedRef.current).toBe(false);
    expect(h.dragRefs.dragHasMovedRef.current).toBe(true);
    expect([...h.dragRefs.draggingNodeIdsRef.current]).toEqual(['w-1']);
    expect(h.deps.dragOffsetsRef.current.get('w-1')).toEqual({ x: 10, y: 10 });
    expect(h.deps.dragStartRef.current.get('w-1')).toEqual({ x: 0, y: 0 });
    expect(h.deps.lastDragMovePosRef.current).toEqual({ x: 110, y: 110 });
    expect(document.body.style.cursor).not.toBe('copy');
    // No history churn: the refused conversion neither pushes nor pops.
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.pushHistory).toHaveBeenCalledTimes(1);
    expect(h.dup.setHistory).not.toHaveBeenCalled();

    // The user let go of Alt or not -- either way the gesture is still the SAME
    // move it was before: it continues, and the drop commits exactly ONE
    // ordinary move entry (the pre-drag positions, no copy ids).
    h.move(210, 210);
    expect(h.dup.getHistory()).toHaveLength(1);
    h.docUp();
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.dup.getNodes()).toHaveLength(2);
    expect(h.dup.getNodes()[0]).toMatchObject({ id: 'w-1', x: 200, y: 200 });
    const entry = h.dup.getHistory()[0];
    expect(entry?.nodes.map((n) => n.id)).toEqual(['w-1', 's-2']);
    expect(entry?.nodes[0]).toMatchObject({ x: 0, y: 0 });
    // A plain move never selects and never announces: that surface is the
    // duplicate commit's alone, and the commit never ran.
    expect(h.selectMany).not.toHaveBeenCalled();
    expect(h.dup.setLiveAnnouncement).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
    h.unmount();
  });

  it('an Alt press past the tier cap is refused up front: no drag is armed at all', () => {
    const refusal = refusalSpy();
    const h = setup({
      nodes: [warehouseOf('w-1', 0, 0), storeOf('s-2', 600, 600)],
      duplicateStores: true,
      duplicateRefusal: refusal,
    });

    act(() => h.api.beginNodeDrag(10, 10, new Set(['w-1']), true, 'mouse'));

    expect(refusal).toHaveBeenCalledTimes(1);
    expect(refusal.mock.calls[0]?.[0].map((n) => n.id)).toEqual(['w-1']);
    expect(h.dup.addToast).toHaveBeenCalledWith({
      message: 'topology-toast-multi-warehouse',
      type: 'warning',
    });
    // Nothing was created and nothing was armed -- the refusal happens BEFORE
    // the copy set is built, so there is no preview to clean up later.
    expect(h.dup.getNodes().map((n) => n.id)).toEqual(['w-1', 's-2']);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.dup.beginDrag).not.toHaveBeenCalled();
    expect(h.dragRefs.draggingNodeIdsRef.current.size).toBe(0);
    expect(h.deps.dragOffsetsRef.current.size).toBe(0);
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.deps.lastDragMovePosRef.current).toBeNull();
    expect(h.dup.pushHistory).not.toHaveBeenCalled();
    expect(h.dup.setHistory).not.toHaveBeenCalled();
    expect(h.dup.setNodes).not.toHaveBeenCalled();
    expect(document.body.style.cursor).not.toBe('copy');
    // The housekeeping that runs AHEAD of the gate is not undone by the
    // refusal: a refused grab still dismisses an open picker and drops a
    // staged wire, and it still counts as interaction (auto-fit stays off).
    expect(h.dismissPicker).toHaveBeenCalledTimes(1);
    expect(h.clearWire).toHaveBeenCalledTimes(1);
    expect(h.refs.userInteractedRef.current).toBe(true);
    // No document mouseup was armed, so a replayed release is inert.
    expect(h.dragRefs.dragCleanupRef.current).toBeNull();
    h.docUp();
    expect(h.dup.getHistory()).toHaveLength(0);
    expect(h.selectMany).not.toHaveBeenCalled();

    // The gate is about the DRAGGED SET, not a global latch: the same press on
    // a card that adds no warehouse is allowed, right after the refusal.
    act(() => h.api.beginNodeDrag(10, 10, new Set(['s-2']), true, 'mouse'));
    expect(refusal).toHaveBeenCalledTimes(2);
    expect(h.dragRefs.duplicateDragRef.current).toBe(true);
    expect(h.dup.getNodes()).toHaveLength(3);
    expect(document.body.style.cursor).toBe('copy');
    act(() => h.api.cancelDuplicateDrag());
    expect(h.dup.getNodes()).toHaveLength(2);
    expect(h.dup.getHistory()).toHaveLength(0);
    h.unmount();
  });

  it('a zero-movement Alt release duplicates in place', () => {
    const h = setup({
      nodes: [storeOf('n-1', 0, 0), storeOf('n-2', 600, 600)],
      duplicateStores: true,
    });
    act(() => h.api.beginNodeDrag(10, 10, new Set(['n-1']), true, 'mouse'));
    const copyId = h.deps.duplicateCopyIdsRef.current[0] ?? '';

    // No mousemove at all -- dragHasMovedRef never latches.
    expect(h.dragRefs.dragHasMovedRef.current).toBe(false);
    h.docUp();

    // commitDuplicateDrag has NO moved-gate (unlike finalizeNodeDrag's own
    // no-op pop, which does have one): a plain Alt+down+up is a CREATION
    // gesture, so the copy survives the release with zero movement.
    const nodes = h.dup.getNodes();
    expect(nodes).toHaveLength(3);
    expect(nodes[2]).toMatchObject({ id: copyId, x: 0, y: 0 });
    // ...EXACTLY at the original, overlap and all: drop-overlap resolution is
    // skipped for duplicates because the landing spot IS the intent, so the
    // copy is never settled away from the card it was copied from.
    expect(nodes[0]).toMatchObject({ id: 'n-1', x: 0, y: 0 });
    // One undo entry for the in-place creation, and it is the PRE-duplicate
    // graph -- undo removes the copy and nothing else moved.
    expect(h.dup.getHistory()).toHaveLength(1);
    const entry = h.dup.getHistory()[0];
    expect(entry?.nodes.map((n) => n.id)).toEqual(['n-1', 'n-2']);
    expect(entry?.nodes[0]).toMatchObject({ x: 0, y: 0 });
    // The entry came from the COMMIT path (setHistory), not the move path: a
    // zero-move gesture never reaches the first-movement push at all.
    expect(h.dup.pushHistory).not.toHaveBeenCalled();
    expect(h.dup.setHistory).toHaveBeenCalledTimes(1);
    // The copy is the selection, redo is invalidated, the live region fires.
    expect(h.selectMany).toHaveBeenCalledTimes(1);
    expect(h.selectMany).toHaveBeenLastCalledWith([copyId], copyId);
    expect(h.dup.setRedo).toHaveBeenCalledWith([]);
    expect(h.dup.setLiveAnnouncement).toHaveBeenCalledWith('topology-duplicate-announce');
    // Every ref is back to rest and the copy cursor is gone.
    expect(h.dragRefs.duplicateDragRef.current).toBe(false);
    expect(h.deps.duplicateCopyIdsRef.current).toEqual([]);
    expect(h.deps.duplicateHistoryPushedRef.current).toBe(false);
    expect(h.deps.dragOffsetsRef.current.size).toBe(0);
    expect(h.deps.dragStartRef.current.size).toBe(0);
    expect(h.dragRefs.draggingNodeIdsRef.current.size).toBe(0);
    expect(document.body.style.cursor).toBe('');
    // One-shot, exactly like the moved case: the second release of the same
    // gesture commits nothing.
    act(() => h.api.finalizeNodeDrag());
    expect(h.dup.getHistory()).toHaveLength(1);
    expect(h.selectMany).toHaveBeenCalledTimes(1);
    expect(h.dup.getNodes()).toHaveLength(3);
    h.unmount();
  });
});
