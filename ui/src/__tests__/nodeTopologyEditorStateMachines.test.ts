/**
 * @vitest-environment jsdom
 */
// ── Topology editor: state reducers and hooks ───────────────────────────
//
// MERGED 2026-10-12. These were eight separate files (43-166 lines, 74 tests
// total). Vitest spawns a fresh jsdom per test FILE, measured at ~1.1-2.0s
// each REGARDLESS of test count, so eight tiny files paid ~16s of environment
// for 74 tests that a single file runs with one window.
//
// A merge is only safe where the files are MOCK-FREE: `vi.mock` is hoisted and
// file-scoped, so combining two files that mock the same module differently
// would silently change one of them. All eight carried zero vi.mock calls —
// checked before merging, not assumed — which is what makes this one file.
//
// The describes below are byte-identical to their originals; only the shared
// import block and the file boundary changed.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  TopologyEditorGraphState,
  topologyEditorGraphReducer,
} from '@/features/locations/nodeTopologyEditorState';
import {
  act,
  renderHook,
} from '@testing-library/react';
import {
  TopologyDragState,
  initialTopologyDragState,
  topologyDragReducer,
  useTopologyEditorDrag,
} from '@/features/locations/nodeTopologyEditorDragState';
import {
  TopologySaveState,
  initialTopologySaveState,
  topologySaveReducer,
  useTopologyEditorSaveLifecycle,
} from '@/features/locations/nodeTopologyEditorSaveState';
import {
  TopologyHoverState,
  initialTopologyHoverState,
  topologyHoverReducer,
  useTopologyEditorHover,
} from '@/features/locations/nodeTopologyEditorHoverState';
import type {
  ReactLocalization,
} from '@fluent/react';
import {
  SELECTION_ANNOUNCE_SETTLE_MS,
  useTopologyEditorAnnouncements,
} from '../features/locations/nodeTopologyEditorAnnouncements';
import {
  TopologySelectionState,
  initialTopologySelectionState,
  topologySelectionReducer,
  useTopologyEditorSelection,
} from '@/features/locations/nodeTopologyEditorSelectionState';
import {
  TopologyConnectionState,
  TopologyPickerState,
  initialTopologyConnectionState,
  topologyConnectionReducer,
  useTopologyEditorConnection,
} from '@/features/locations/nodeTopologyEditorConnectionState';
import {
  TopologyRestoreSeed,
  useTopologyEditorRestoreSeed,
} from '@/features/locations/nodeTopologyEditorRestoreState';

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


describe('topologySaveReducer', () => {
  it('starts in the loading phase with revision 0', () => {
    expect(initialTopologySaveState).toEqual({ phase: 'loading', revision: 0 });
  });

  it('moves loading → ready with the loaded revision on load-success', () => {
    const next = topologySaveReducer(initialTopologySaveState, { type: 'load-success', revision: 7 });
    expect(next).toEqual({ phase: 'ready', revision: 7 });
  });

  it('moves loading → load-error on load-failure (Apply disabled)', () => {
    const next = topologySaveReducer(initialTopologySaveState, { type: 'load-failure' });
    expect(next.phase).toBe('load-error');
  });

  it('moves load-error → ready when a later load succeeds', () => {
    const afterFailure = topologySaveReducer(initialTopologySaveState, { type: 'load-failure' });
    const next = topologySaveReducer(afterFailure, { type: 'load-success', revision: 3 });
    expect(next).toEqual({ phase: 'ready', revision: 3 });
  });

  it('refuses apply-start while applying (idempotent re-entrancy)', () => {
    const ready: TopologySaveState = { phase: 'ready', revision: 1 };
    const applying = topologySaveReducer(ready, { type: 'apply-start' });
    expect(applying.phase).toBe('applying');
    const again = topologySaveReducer(applying, { type: 'apply-start' });
    expect(again).toBe(applying);
  });

  it('returns to ready with the NEW revision on apply-success', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'apply-success', revision: 2 });
    expect(next).toEqual({ phase: 'ready', revision: 2 });
  });

  it('returns to ready with the SAME revision on apply-failure (stays dirty, retryable)', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 5 };
    const next = topologySaveReducer(applying, { type: 'apply-failure' });
    expect(next).toEqual({ phase: 'ready', revision: 5 });
  });

  it('keeps an in-flight Apply busy when a post-save reload lands (load-success)', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'load-success', revision: 2 });
    expect(next.phase).toBe('applying');
    expect(next.revision).toBe(2);
  });

  it('does not interrupt an in-flight Apply on load-failure', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const next = topologySaveReducer(applying, { type: 'load-failure' });
    expect(next.phase).toBe('applying');
  });
  // -- `applying` has exactly TWO exits, and a caller can outrun one (2026-10-14) --
  //
  // CI failed NodeTopologyEditorDevMock with the Apply button still aria-disabled at
  // assertion time. The reducer is NOT at fault: the case above shows a reload landing
  // during `applying` is preserved BY DESIGN, which is right for the post-save reload.
  // What these two cases pin is the consequence that design implies -- `applying` leaves
  // only via apply-success or apply-failure, so a caller that dispatches a reload before
  // the failure commits can leave the phase stuck. The conflict path did exactly that:
  // failApply() and setReloadKey() in one tick, against a dev-mock whose load promise
  // settles with no network at all.
  it('a reload arriving BEFORE the failure keeps the phase applying, so the failure must still be delivered', () => {
    const applying: TopologySaveState = { phase: 'applying', revision: 1 };
    const afterReload = topologySaveReducer(applying, { type: 'load-success', revision: 2 });
    expect(afterReload.phase).toBe('applying');
    // The failure is the exit and it does recover the phase -- which is what makes the
    // defect a RACE rather than a deadlock: it is terminal only if that dispatch is lost.
    expect(topologySaveReducer(afterReload, { type: 'apply-failure' }).phase).toBe('ready');
  });

  it('apply-failure on a non-applying phase is a no-op -- the other half of the trap', () => {
    const ready: TopologySaveState = { phase: 'ready', revision: 3 };
    expect(topologySaveReducer(ready, { type: 'apply-failure' })).toBe(ready);
  });
});

describe('useTopologyEditorSaveLifecycle', () => {
  it('exposes busy/settled/canApply derived from the phase', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    expect(result.current.phase).toBe('loading');
    expect(result.current.busy).toBe(false);
    expect(result.current.settled).toBe(false);
    expect(result.current.canApply).toBe(false);
    expect(result.current.revision).toBe(0);
  });

  it('guards concurrent Apply requests synchronously', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadSuccess(1));
    expect(result.current.canApply).toBe(true);

    let first = false;
    let second = false;
    act(() => {
      first = result.current.beginApply();
      second = result.current.beginApply();
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.busy).toBe(true);

    act(() => result.current.finishApply(2));
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(result.current.revision).toBe(2);
  });

  it('releases the guard and stays retryable after apply-failure', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadSuccess(3));
    act(() => {
      result.current.beginApply();
      result.current.failApply();
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.phase).toBe('ready');
    expect(result.current.revision).toBe(3);
    expect(result.current.canApply).toBe(true);
  });

  it('moves to load-error and stays settled (Apply disabled) after a load failure', () => {
    const { result } = renderHook(() => useTopologyEditorSaveLifecycle());
    act(() => result.current.loadFailure());
    expect(result.current.phase).toBe('load-error');
    expect(result.current.settled).toBe(true);
    expect(result.current.canApply).toBe(false);
  });
});


describe('topologyHoverReducer', () => {
  it('starts with no node or wire hover', () => {
    expect(initialTopologyHoverState).toEqual({
      nodeId: null,
      wireId: null,
    });
  });

  it('hover-node sets the node and atomically clears any wire hover', () => {
    const withWire: TopologyHoverState = { nodeId: null, wireId: 'w-1' };
    const next = topologyHoverReducer(withWire, { type: 'hover-node', id: 'n-1' });
    expect(next).toEqual({ nodeId: 'n-1', wireId: null });
  });

  it('hover-wire sets the wire and atomically clears any node hover', () => {
    const withNode: TopologyHoverState = { nodeId: 'n-1', wireId: null };
    const next = topologyHoverReducer(withNode, { type: 'hover-wire', id: 'w-2' });
    expect(next).toEqual({ nodeId: null, wireId: 'w-2' });
  });

  it('hover-node(null) and hover-wire(null) clear their own slot without touching the other', () => {
    const both: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-2' };
    const next = topologyHoverReducer(both, { type: 'hover-node', id: null });
    expect(next).toEqual({ nodeId: null, wireId: 'w-2' });
  });

  it('clear-hover empties both node and wire hover atomically', () => {
    const both: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-2' };
    const next = topologyHoverReducer(both, { type: 'clear-hover' });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune drops a hovered node that no longer exists', () => {
    // Regression: the prune effect clears selection and connection on node
    // removal but not hover. React does not fire mouseleave on unmount, so a
    // hovered id survives deletion; hoverConnections then stays non-null and
    // every remaining card/wire renders dimmed until the next hover.
    const stale: TopologyHoverState = { nodeId: 'n-deleted', wireId: null };
    const next = topologyHoverReducer(stale, {
      type: 'prune',
      validNodeIds: new Set(['n-1', 'n-2']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune drops a hovered wire that no longer exists', () => {
    const stale: TopologyHoverState = { nodeId: null, wireId: 'w-deleted' };
    const next = topologyHoverReducer(stale, {
      type: 'prune',
      validNodeIds: new Set(['n-1']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: null, wireId: null });
  });

  it('prune keeps a hovered node and wire that still exist', () => {
    const live: TopologyHoverState = { nodeId: 'n-1', wireId: 'w-1' };
    const next = topologyHoverReducer(live, {
      type: 'prune',
      validNodeIds: new Set(['n-1', 'n-2']),
      validWireIds: new Set(['w-1']),
    });
    expect(next).toEqual({ nodeId: 'n-1', wireId: 'w-1' });
  });
});

describe('useTopologyEditorHover', () => {
  it('exposes node/wire hover and the atomic transitions', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.wireId).toBeNull();

    act(() => result.current.hoverNode('n-1'));
    expect(result.current.nodeId).toBe('n-1');

    // Hovering a wire clears the node hover — the two are mutually exclusive
    // by construction (the wire ghost affordance and the node focus-mode
    // dimming cannot both be active).
    act(() => result.current.hoverWire('w-2'));
    expect(result.current.wireId).toBe('w-2');
    expect(result.current.nodeId).toBeNull();

    act(() => result.current.clearHover());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.wireId).toBeNull();
  });

  it('pruneHover drops dangling ids after a structural canvas replacement', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    act(() => result.current.hoverNode('n-deleted'));
    act(() =>
      result.current.pruneHover(new Set(['n-1']), new Set(['w-1'])),
    );
    expect(result.current.nodeId).toBeNull();
  });

  it('accepts the functional leave-updater the card/wire handlers pass', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    // Card enter: onHoverNode(node.id)
    act(() => result.current.hoverNode('n-1'));
    // Card leave: onHoverNode((prev) => (prev === node.id ? null : prev))
    act(() => result.current.hoverNode((prev) => (prev === 'n-1' ? null : prev)));
    expect(result.current.nodeId).toBeNull();
    // A leave for a DIFFERENT node must not clear the current hover (the
    // guard the child's functional updater provides).
    act(() => result.current.hoverNode('n-2'));
    act(() => result.current.hoverNode((prev) => (prev === 'n-1' ? null : prev)));
    expect(result.current.nodeId).toBe('n-2');
  });

  it('wire leave-updater only clears its own slot', () => {
    const { result } = renderHook(() => useTopologyEditorHover());
    act(() => result.current.hoverWire('w-1'));
    act(() => result.current.hoverWire((prev) => (prev === 'w-1' ? null : prev)));
    expect(result.current.wireId).toBeNull();
    act(() => result.current.hoverWire('w-2'));
    act(() => result.current.hoverWire((prev) => (prev === 'w-1' ? null : prev)));
    expect(result.current.wireId).toBe('w-2');
  });
});


/** Stand-in ReactLocalization: announces the key plus any args so each
 *  test can pin exactly which key (and args) the hook requested. */
const l10nOf = () => ({
  getString: (key: string, args?: Record<string, unknown>) =>
    args?.['name'] !== undefined
      ? `${key}:${String(args['name'])}`
      : args?.['count'] !== undefined
        ? `${key}:${String(args['count'])}`
        : key,
}) as unknown as ReactLocalization;

type AnnounceDeps = Parameters<typeof useTopologyEditorAnnouncements>[0];

const defaultDeps: AnnounceDeps = {
  alignmentGuide: null,
  selectedNodeIds: new Set<string>(),
  selectedWireId: null,
  nodeMap: new Map<string, { name: string }>([['a', { name: 'Assembly' }]]),
  l10nRef: { current: l10nOf() },
};

/** Delta-merge harness: rerender props override only the fields they
 *  carry, so a test can change one dep without rebuilding the rest. */
const harness = () =>
  renderHook((delta: Partial<AnnounceDeps>) => useTopologyEditorAnnouncements({ ...defaultDeps, ...delta }), {
    initialProps: {},
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('snap-announcement entry latch', () => {
  it('announces once on null → guide entry', () => {
    const h = harness();
    expect(h.result.current.announcement).toBe('');
    h.rerender({ alignmentGuide: { x: 10 } });
    expect(h.result.current.announcement).toBe('topology-snap-announce');
  });

  it('does not re-announce while the guide stays visible (recreated object)', () => {
    const h = harness();
    h.rerender({ alignmentGuide: { x: 10 } });
    const afterEntry = h.result.current.announcement;
    h.rerender({ alignmentGuide: { x: 10 } });
    expect(h.result.current.announcement).toBe(afterEntry);
  });

  it('re-announces after the guide clears and a new approach enters', () => {
    const h = harness();
    h.rerender({ alignmentGuide: { x: 10 } });
    h.rerender({ alignmentGuide: null });
    h.rerender({ alignmentGuide: { y: 20 } });
    expect(h.result.current.announcement).toBe('topology-snap-announce');
  });
});

describe('selection settle debounce', () => {
  it('announces a single selection by node name after the settle window', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    expect(h.result.current.announcement).toBe('');
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-announce:Assembly');
  });

  it('announces a multi-selection as a count', () => {
    const h = harness();
    h.rerender({
      nodeMap: new Map([['a', { name: 'A' }], ['b', { name: 'B' }]]),
      selectedNodeIds: new Set(['a', 'b']),
    });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-status-selection:2');
  });

  it('announces wire selection and the empty selection (clear)', () => {
    const h = harness();
    h.rerender({ selectedWireId: 'w1' });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-wire-announce');

    h.rerender({ selectedWireId: null, selectedNodeIds: new Set() });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-clear-announce');
  });

  it('folds a marquee flicker 1→2→3 into one announcement with the final set', () => {
    const h = harness();
    const wide = new Map([['a', { name: 'A' }], ['b', { name: 'B' }], ['c', { name: 'C' }]]);
    h.rerender({ selectedNodeIds: new Set(['a']) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS - 1);
    h.rerender({ nodeMap: wide, selectedNodeIds: new Set(['a', 'b']) });
    vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS - 1);
    h.rerender({ selectedNodeIds: new Set(['a', 'b', 'c']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-status-selection:3');
  });

  it('does not re-announce when the selection content is unchanged (new Set, same ids)', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    const settled = h.result.current.announcement;
    h.rerender({ selectedNodeIds: new Set(['a']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe(settled);
  });

  it('never announces on the initial empty selection', () => {
    const h = harness();
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS * 2));
    expect(h.result.current.announcement).toBe('');
  });

  it('falls back to the raw id when a selected node is missing from the map', () => {
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['ghost']) });
    act(() => vi.advanceTimersByTime(SELECTION_ANNOUNCE_SETTLE_MS));
    expect(h.result.current.announcement).toBe('topology-selection-announce:ghost');
  });

  it('clears the pending settle timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const h = harness();
    h.rerender({ selectedNodeIds: new Set(['a']) });
    clearTimeoutSpy.mockClear();
    h.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('imperative one-shot announcements', () => {
  it('writes the message immediately (layout, duplicate, migration paths)', () => {
    const h = harness();
    act(() => h.result.current.announce('topology-layout-announce'));
    expect(h.result.current.announcement).toBe('topology-layout-announce');
    act(() => h.result.current.announce('topology-duplicate-cancel-announce'));
    expect(h.result.current.announcement).toBe('topology-duplicate-cancel-announce');
  });
});


describe('topologySelectionReducer', () => {
  it('starts with no node or wire selection', () => {
    expect(initialTopologySelectionState).toEqual({
      nodeId: null,
      nodeIds: new Set<string>(),
      wireId: null,
    });
  });

  it('select-only selects one node and atomically clears any wire selection', () => {
    // Regression: previously selectOnly() never cleared selectedWireId, so a
    // wire could stay selected alongside a node — the toolbar Delete handler
    // checks nodes before wires and the wire-delete path became unreachable.
    const withWire: TopologySelectionState = {
      nodeId: null,
      nodeIds: new Set<string>(),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(withWire, { type: 'select-only', id: 'n-1' });
    expect(next).toEqual({ nodeId: 'n-1', nodeIds: new Set(['n-1']), wireId: null });
  });

  it('select-many replaces the set and clears the wire selection', () => {
    const next = topologySelectionReducer(initialTopologySelectionState, {
      type: 'select-many',
      ids: ['n-1', 'n-2'],
      primary: 'n-2',
    });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBe('n-2');
    expect(next.wireId).toBeNull();
  });

  it('select-many allows a null primary (select-all with no inspector target)', () => {
    const next = topologySelectionReducer(initialTopologySelectionState, {
      type: 'select-many',
      ids: ['n-1', 'n-2'],
      primary: null,
    });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBeNull();
    expect(next.wireId).toBeNull();
  });

  it('clear-all empties both node and wire selection atomically', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(base, { type: 'clear-all' });
    expect(next).toEqual({ nodeId: null, nodeIds: new Set<string>(), wireId: null });
  });

  it('clear-wire clears only the wire selection', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-1',
    };
    const next = topologySelectionReducer(base, { type: 'clear-wire' });
    expect(next.wireId).toBeNull();
    expect(next.nodeId).toBe('n-1');
    expect(next.nodeIds).toEqual(new Set(['n-1']));
  });

  it('add unions a node into the set, makes it primary, and clears the wire', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-9',
    };
    const next = topologySelectionReducer(base, { type: 'add', id: 'n-2' });
    expect(next.nodeIds).toEqual(new Set(['n-1', 'n-2']));
    expect(next.nodeId).toBe('n-2');
    expect(next.wireId).toBeNull();
  });

  it('select-wire selects a wire and atomically clears the node selection', () => {
    const withNode: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: null,
    };
    const next = topologySelectionReducer(withNode, { type: 'select-wire', id: 'w-2' });
    expect(next.wireId).toBe('w-2');
    expect(next.nodeId).toBeNull();
    expect(next.nodeIds.size).toBe(0);
  });

  it('clear-nodes clears the node selection but leaves the wire selection intact', () => {
    const base: TopologySelectionState = {
      nodeId: 'n-1',
      nodeIds: new Set(['n-1']),
      wireId: 'w-3',
    };
    const next = topologySelectionReducer(base, { type: 'clear-nodes' });
    expect(next.nodeId).toBeNull();
    expect(next.nodeIds.size).toBe(0);
    expect(next.wireId).toBe('w-3');
  });

  it('prune drops missing nodes and the dangling primary, and clears a gone wire', () => {
    const base: TopologySelectionState = {
      nodeId: 'gone',
      nodeIds: new Set(['alive', 'gone']),
      wireId: 'dead-wire',
    };
    const next = topologySelectionReducer(base, {
      type: 'prune',
      validNodeIds: new Set(['alive']),
      validWireId: null,
    });
    expect(next.nodeIds).toEqual(new Set(['alive']));
    expect(next.nodeId).toBeNull();
    expect(next.wireId).toBeNull();
  });

  it('prune keeps a valid primary and valid wire untouched', () => {
    const base: TopologySelectionState = {
      nodeId: 'alive',
      nodeIds: new Set(['alive', 'gone']),
      wireId: 'ok-wire',
    };
    const next = topologySelectionReducer(base, {
      type: 'prune',
      validNodeIds: new Set(['alive']),
      validWireId: 'ok-wire',
    });
    expect(next.nodeIds).toEqual(new Set(['alive']));
    expect(next.nodeId).toBe('alive');
    expect(next.wireId).toBe('ok-wire');
  });
});

describe('useTopologyEditorSelection', () => {
  it('exposes the selection plus atomic helpers backed by the reducer', () => {
    const { result } = renderHook(() => useTopologyEditorSelection());
    expect(result.current.nodeId).toBeNull();
    expect(result.current.nodeIds.size).toBe(0);
    expect(result.current.wireId).toBeNull();

    act(() => result.current.selectWire('w-1'));
    expect(result.current.wireId).toBe('w-1');
    expect(result.current.nodeIds.size).toBe(0);

    act(() => result.current.selectOnly('n-1'));
    expect(result.current.nodeId).toBe('n-1');
    // The invariant: picking a node clears the wire.
    expect(result.current.wireId).toBeNull();
  });
});


const picker = (): TopologyPickerState => ({
  fromNodeId: 'ws-1',
  fromPort: 'right',
  fromVariantIndex: 0,
  toNodeId: 'wh-1',
  toPort: 'left',
  toVariantIndex: 0,
  options: [],
});

describe('topologyConnectionReducer', () => {
  it('starts with no connection and no picker', () => {
    expect(initialTopologyConnectionState).toEqual({
      fromNodeId: null,
      fromPort: null,
      fromVariantIndex: 0,
      picker: null,
    });
  });

  it('begin arms a connection from a node port', () => {
    const next = topologyConnectionReducer(initialTopologyConnectionState, {
      type: 'begin',
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
    });
    expect(next.fromNodeId).toBe('ws-1');
    expect(next.fromPort).toBe('right');
    expect(next.fromVariantIndex).toBe(0);
    expect(next.picker).toBeNull();
  });

  it('begin closes any open picker when re-arming from a fresh port', () => {
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, {
      type: 'begin',
      fromNodeId: 'ws-9',
      fromPort: 'bottom',
      fromVariantIndex: 0,
    });
    expect(next.fromNodeId).toBe('ws-9');
    expect(next.picker).toBeNull();
  });

  it('open-picker keeps the armed connection and records the pending choice', () => {
    const armed: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: null,
    };
    const next = topologyConnectionReducer(armed, { type: 'open-picker', picker: picker() });
    expect(next.picker).toEqual(picker());
    expect(next.fromNodeId).toBe('ws-1');
  });

  it('cancel clears BOTH the connection and the picker atomically', () => {
    // Regression: dismissing the picker (canvas click, drag start, touch)
    // must also clear the armed connection — a stale source port click must
    // not be able to complete a wire after the choice was abandoned.
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, { type: 'cancel' });
    expect(next).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('cancel is a no-op when nothing is in flight', () => {
    const next = topologyConnectionReducer(initialTopologyConnectionState, { type: 'cancel' });
    expect(next).toEqual(initialTopologyConnectionState);
  });

  it('dismiss-picker clears both when a picker is open (canvas click away)', () => {
    // Clicking away from an open picker must behave like Escape: the whole
    // gesture dies, so no stale source port click can complete a wire.
    const withPicker: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: picker(),
    };
    const next = topologyConnectionReducer(withPicker, { type: 'dismiss-picker' });
    expect(next).toEqual({ fromNodeId: null, fromPort: null, fromVariantIndex: 0, picker: null });
  });

  it('dismiss-picker leaves a plain armed connection alone (carry behavior)', () => {
    // A connection with NO picker open survives a canvas click — the user
    // may be panning to a distant target. Only an open picker makes the
    // dismissal a full cancel.
    const armed: TopologyConnectionState = {
      fromNodeId: 'ws-1',
      fromPort: 'right',
      fromVariantIndex: 0,
      picker: null,
    };
    const next = topologyConnectionReducer(armed, { type: 'dismiss-picker' });
    expect(next).toEqual(armed);
  });
});

describe('useTopologyEditorConnection', () => {
  it('exposes the connection and picker state', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.fromPort).toBeNull();
    expect(result.current.picker).toBeNull();
  });

  it('cancelConnection clears the connection AND an open picker together', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    expect(result.current.picker).not.toBeNull();

    act(() => result.current.cancelConnection());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.fromPort).toBeNull();
    expect(result.current.picker).toBeNull();
  });

  it('beginConnection closes any open picker when a fresh connection starts', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    act(() => result.current.beginConnection('store-1', 'right'));
    expect(result.current.fromNodeId).toBe('store-1');
    expect(result.current.picker).toBeNull();
  });

  it('dismissPicker clears an open picker and its connection, but not a plain armed connection', () => {
    const { result } = renderHook(() => useTopologyEditorConnection());

    // Open picker: dismissal is a full cancel.
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.openPicker(picker()));
    act(() => result.current.dismissPicker());
    expect(result.current.fromNodeId).toBeNull();
    expect(result.current.picker).toBeNull();

    // Plain armed connection (no picker): survives a canvas click.
    act(() => result.current.beginConnection('ws-1', 'right'));
    act(() => result.current.dismissPicker());
    expect(result.current.fromNodeId).toBe('ws-1');
    expect(result.current.picker).toBeNull();
  });
});


const seed = (id: string): TopologyRestoreSeed => ({
  nodes: [{ id, type: 'store', name: id, x: 0, y: 0 }],
  wires: [],
});

describe('useTopologyEditorRestoreSeed', () => {
  it('applies each non-null seed object once and ignores clearing the prop', () => {
    const apply = vi.fn();
    const first = seed('first');
    const second = seed('second');
    type RestoreProps = { restoreSeed: TopologyRestoreSeed | null };
    const { rerender } = renderHook(
      ({ restoreSeed }: RestoreProps) => useTopologyEditorRestoreSeed(restoreSeed, apply),
      { initialProps: { restoreSeed: null } as RestoreProps },
    );

    rerender({ restoreSeed: first });
    rerender({ restoreSeed: first });
    rerender({ restoreSeed: null });
    rerender({ restoreSeed: second });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, first);
    expect(apply).toHaveBeenNthCalledWith(2, second);
  });

  it('does not apply a seed before the effect flushes', () => {
    const apply = vi.fn();
    const first = seed('first');
    renderHook(() => useTopologyEditorRestoreSeed(first, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    act(() => undefined);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

