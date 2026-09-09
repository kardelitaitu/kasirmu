/**
 * Hook-in-isolation coverage for the Phase 3.4e touch-gesture seam
 * (useTopologyEditorTouch). NodeTopologyEditor.test.tsx owns the rendered
 * gestures through the DOM (tap-select, pinch-zoom, cancel-commit); this file
 * owns the seam itself: that the first pointerdown really arms DOCUMENT-level
 * listeners and hands the parent a working disposer through touchCleanupRef,
 * that a sub-threshold touch stays a tap, that a past-threshold touch arms the
 * pointer hook's node drag through the injected beginNodeDrag/applyDragMove/
 * finalizeNodeDrag trio, that the pinch is a pure pinchTransform feed about
 * the two fingers' midpoint, and that pointercancel is byte-for-byte the
 * release path (handleTouchPointerCancel delegates to handleTouchPointerUp --
 * the cancel==release invariant, pinned here at hook level).
 *
 * The harness passes the deps exactly as the editor call site does and wires
 * them to spies; pan/zoom are plain values because the hook only READS them
 * (as the pinch baseline and pan origin) and never composes against them.
 * Pointer events reach the document through fireEvent with the PointerEvent
 * polyfill from test-setup.ts (jsdom has no PointerEvent constructor), the
 * same channel the component suite drives.
 *
 * No vi.mock anywhere -- the only collaborator is the pure pinchTransform
 * helper the hook itself imports. Types come through Parameters<typeof hook>
 * so this file never imports the component, not even for a name. The deps
 * literal is exhaustively typed against TopologyTouchDeps, which makes it a
 * deliberate tripwire: any rename, addition or removal in the hook's dep
 * surface fails typecheck HERE first, mirroring the pointer-hook test.
 *
 * Leak-proofing follows the bend-drag test's guidance: a parent-invoked
 * disposer cannot be proven detached by dispatching into dead state (the old
 * handlers share the hook's refs and are inert after a dispose), so the proof
 * is the RE-ARM pattern -- dispose, dispatch the next pointerdown, then count
 * writes on a shared gesture: a leaked first listener would double-fire.
 */
import { act, renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import { useTopologyEditorTouch } from '../features/locations/nodeTopologyEditorTouch';
import { TOUCH_DRAG_THRESHOLD } from '../features/locations/nodeTopologyTouch';

type TouchDeps = Parameters<typeof useTopologyEditorTouch>[0];
type Point = { x: number; y: number };

/** The React pointerdown the canvas element hands the hook. Only pointerType/
 *  pointerId/clientX/clientY/target/preventDefault are read, so a structural
 *  stand-in beats rendering an SVG just to fabricate one. */
const pointerDownEvent = (
  opts: { pointerId?: number; clientX?: number; clientY?: number; target?: Element | null } = {},
) =>
  ({
    pointerType: 'touch',
    pointerId: opts.pointerId ?? 1,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    target: opts.target ?? document.body,
    preventDefault: vi.fn(),
  }) as unknown as ReactPointerEvent;

/** A node-card descendant: closest('.topology-node') resolves to the card and
 *  its dataset nodeId feeds the selection rules; the inner div clears the
 *  input/button/[data-no-node-drag] drag veto. */
const nodeCardTarget = (id: string) => {
  const card = document.createElement('div');
  card.className = 'topology-node';
  card.dataset['nodeId'] = id;
  const inner = document.createElement('div');
  card.appendChild(inner);
  return inner;
};

const setup = (opts: { pan?: Point; zoom?: number; selectedNodeIds?: Set<string> } = {}) => {
  // A pan that outlives a test would leave body.style.cursor = 'grabbing' for
  // the next one, so every harness starts from a clean slate.
  document.body.style.cursor = '';

  const setPan = vi.fn();
  const setZoom = vi.fn();
  const isPanningRef: MutableRefObject<boolean> = { current: false };
  const userInteractedRef: MutableRefObject<boolean> = { current: false };
  const touchCleanupRef: MutableRefObject<(() => void) | null> = { current: null };
  const selectOnly = vi.fn();
  const clearWire = vi.fn();
  const clearAll = vi.fn();
  const dismissPicker = vi.fn();
  const setContextMenu = vi.fn();
  const beginNodeDrag = vi.fn();
  const applyDragMove = vi.fn();
  const finalizeNodeDrag = vi.fn();

  const deps: TouchDeps = {
    pan: opts.pan ?? { x: 0, y: 0 },
    zoom: opts.zoom ?? 1,
    setPan,
    setZoom,
    isPanningRef,
    userInteractedRef,
    touchCleanupRef,
    selectedNodeIds: opts.selectedNodeIds ?? new Set<string>(),
    selectOnly,
    clearWire,
    clearAll,
    dismissPicker,
    setContextMenu,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
  };

  const view = renderHook(() => useTopologyEditorTouch(deps));
  const down = (o: Parameters<typeof pointerDownEvent>[0] = {}) =>
    act(() => view.result.current.handleCanvasPointerDown(pointerDownEvent(o)));
  /** document-level touch channels -- the loop's own listeners. */
  const move = (pointerId: number, clientX: number, clientY: number) =>
    act(() => {
      fireEvent.pointerMove(document, { pointerId, pointerType: 'touch', clientX, clientY });
    });
  const up = (pointerId: number) =>
    act(() => {
      fireEvent.pointerUp(document, { pointerId, pointerType: 'touch' });
    });
  const cancel = (pointerId: number) =>
    act(() => {
      fireEvent.pointerCancel(document, { pointerId, pointerType: 'touch' });
    });

  return {
    deps,
    setPan,
    setZoom,
    isPanningRef,
    userInteractedRef,
    touchCleanupRef,
    selectOnly,
    clearWire,
    clearAll,
    dismissPicker,
    setContextMenu,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
    down,
    move,
    up,
    cancel,
  };
};

describe('useTopologyEditorTouch — arming and the parent-owned disposer', () => {
  it('a two-finger pointerdown arms the loop, hands the parent a disposer, and re-arms without leaking', () => {
    const h = setup();

    h.down({ pointerId: 1, clientX: 100, clientY: 100 });
    h.down({ pointerId: 2, clientX: 140, clientY: 100 });

    // Every touch pointerdown runs the shared down rules.
    expect(h.userInteractedRef.current).toBe(true);
    expect(h.dismissPicker).toHaveBeenCalledTimes(2);
    expect(h.setContextMenu).toHaveBeenCalledWith(null);

    const dispose = h.touchCleanupRef.current;
    expect(typeof dispose).toBe('function');

    // The parent (unmount sweep) runs the disposer: the cleanup slot clears.
    act(() => dispose?.());
    expect(h.touchCleanupRef.current).toBeNull();

    // A stray move after dispose is inert either way (the handlers share the
    // hook's refs), so detachment is proven by the re-arm count below.
    h.move(2, 180, 100);
    expect(h.setZoom).not.toHaveBeenCalled();
    expect(h.setPan).not.toHaveBeenCalled();

    // The next gesture re-arms: the cleanup slot is refilled with a fresh
    // disposer, and exactly ONE handler answers the new gesture's move. The
    // same pointer ids are reused on purpose (they REPLACE the entries a
    // disposed gesture left behind); a leaked FIRST listener would run the
    // same gesture computation on the shared refs and write the setters
    // TWICE, so the single-call counts are the leak proof. Exact pinch values
    // live in the dedicated pinch test -- here the re-arm needs only counts.
    h.down({ pointerId: 1, clientX: 100, clientY: 100 });
    h.down({ pointerId: 2, clientX: 140, clientY: 100 });
    expect(typeof h.touchCleanupRef.current).toBe('function');
    h.move(2, 200, 100);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    expect(h.setZoom).toHaveBeenCalledTimes(1);
  });

  it('a pinch move feeds setZoom/setPan through pinchTransform about the midpoint, exactly', () => {
    // Dyadic geometry, zero float drift: fingers 40px apart, moved to 80px
    // (zoom 1 -> 2, ratio 2), then back to 40px (ratio 1) about the moving
    // midpoint. Expected values hand-computed from pinchTransform.
    const h = setup({ pan: { x: 20, y: 10 }, zoom: 1 });

    h.down({ pointerId: 1, clientX: 100, clientY: 100 });
    h.down({ pointerId: 2, clientX: 140, clientY: 100 });
    // mid0 = (120,100), dist0 = 40, baseline = deps pan/zoom.
    h.move(2, 180, 100);
    // mid1 = (140,100), dist1 = 80: zoom = 2, pan = mid1 - (mid0 - pan0) * 2.
    expect(h.setZoom).toHaveBeenCalledTimes(1);
    expect(h.setZoom).toHaveBeenCalledWith(2);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    expect(h.setPan).toHaveBeenCalledWith({ x: -60, y: -80 });

    h.move(2, 60, 100);
    // mid1 = (80,100), dist1 = 40: every move recomputes from the PINCH-ARM
    // baseline (not incrementally), so the ratio 1 move restores zoom 1 and
    // pan = mid1 - (mid0 - pan0) * 1 = (-20, 10).
    expect(h.setZoom).toHaveBeenCalledTimes(2);
    expect(h.setZoom).toHaveBeenLastCalledWith(1);
    expect(h.setPan).toHaveBeenLastCalledWith({ x: -20, y: 10 });

    // The pinch never touches the drag/pan surface.
    expect(h.beginNodeDrag).not.toHaveBeenCalled();
    expect(h.applyDragMove).not.toHaveBeenCalled();
    expect(h.finalizeNodeDrag).not.toHaveBeenCalled();
    expect(h.isPanningRef.current).toBe(false);
  });

  it('a second finger during an in-flight node drag commits the drag and switches to pinch', () => {
    const h = setup();

    h.down({ pointerId: 1, clientX: 100, clientY: 100, target: nodeCardTarget('a') });
    h.move(1, 148, 148);
    expect(h.beginNodeDrag).toHaveBeenCalledTimes(1);

    // The drag move ALSO updated finger 1's map entry, so the pinch arms
    // about p1 (148,148), not the down point: finger 2 lands at (100,148)
    // -> mid0 (124,148), dist0 48.
    h.down({ pointerId: 2, clientX: 100, clientY: 148 });
    // The in-flight drag is committed exactly once by the pinch arm...
    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);

    h.move(2, 244, 148);
    // ...and the loop is a pinch from here: the drag feed is dead, the
    // setters drive. Only finger 2 moves: dist1 = |244 - 148| = 96 -> ratio
    // 2, zoom 2, mid1 (196,148), pan = mid1 - (mid0 - pan0) * 2 = (-52,-148).
    expect(h.applyDragMove).toHaveBeenCalledTimes(1);
    expect(h.setZoom).toHaveBeenCalledWith(2);
    expect(h.setPan).toHaveBeenCalledWith({ x: -52, y: -148 });
  });
});

describe('useTopologyEditorTouch — node drag through the injected trio', () => {
  it('a single-finger drag past the threshold arms the pointer-hook drag with the captured selection', () => {
    const h = setup({ selectedNodeIds: new Set(['a']) });

    h.down({ pointerId: 1, clientX: 0, clientY: 0, target: nodeCardTarget('a') });
    // Down rules on a node: the already-selected id keeps its selection (no
    // selectOnly) and a staged wire is dropped, mirroring the mouse path.
    expect(h.selectOnly).not.toHaveBeenCalled();
    expect(h.clearWire).toHaveBeenCalledTimes(1);

    // Threshold move: begins AND feeds in the same event.
    h.move(1, TOUCH_DRAG_THRESHOLD * 6, TOUCH_DRAG_THRESHOLD * 6);
    expect(h.beginNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.beginNodeDrag.mock.calls[0]?.[0]).toBe(0);
    expect(h.beginNodeDrag.mock.calls[0]?.[1]).toBe(0);
    expect([...(h.beginNodeDrag.mock.calls[0]?.[2] as Set<string>)]).toEqual(['a']);
    expect(h.beginNodeDrag.mock.calls[0]?.[3]).toBe(false);
    expect(h.beginNodeDrag.mock.calls[0]?.[4]).toBe('touch');
    expect(h.applyDragMove).toHaveBeenCalledTimes(1);
    expect(h.applyDragMove).toHaveBeenCalledWith(TOUCH_DRAG_THRESHOLD * 6, TOUCH_DRAG_THRESHOLD * 6);

    // Later moves only feed.
    h.move(1, 60, 40);
    expect(h.beginNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.applyDragMove).toHaveBeenCalledTimes(2);
    expect(h.applyDragMove).toHaveBeenLastCalledWith(60, 40);
  });

  it('a pointerup past the threshold commits once and tears the listeners down', () => {
    const h = setup({ selectedNodeIds: new Set(['a']) });

    h.down({ pointerId: 1, clientX: 0, clientY: 0, target: nodeCardTarget('a') });
    h.move(1, 48, 48);
    h.up(1);

    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.touchCleanupRef.current).toBeNull();
    // The listeners are gone: a stray move cannot re-feed the drag.
    h.move(1, 999, 999);
    expect(h.applyDragMove).toHaveBeenCalledTimes(1);
    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);
  });

  it('a pointercancel past the threshold commits identically to the release (cancel == release)', () => {
    // Same script as the pointerup test, cancel channel only: handleTouch-
    // PointerCancel delegates to handleTouchPointerUp, so every count and
    // teardown must match byte-for-byte.
    const h = setup({ selectedNodeIds: new Set(['a']) });

    h.down({ pointerId: 1, clientX: 0, clientY: 0, target: nodeCardTarget('a') });
    h.move(1, 48, 48);
    h.move(1, 60, 40);
    h.cancel(1);

    expect(h.beginNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.applyDragMove).toHaveBeenCalledTimes(2);
    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.touchCleanupRef.current).toBeNull();
    expect(document.body.style.cursor).toBe('');

    h.move(1, 999, 999);
    expect(h.applyDragMove).toHaveBeenCalledTimes(2);
    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);
  });

  it('a sub-threshold touch on a node never arms the drag and resolves as a tap', () => {
    const h = setup();

    h.down({ pointerId: 1, clientX: 0, clientY: 0, target: nodeCardTarget('a') });
    // Down selects the unselected node (the tap-select contract lives here,
    // not at release).
    expect(h.selectOnly).toHaveBeenCalledTimes(1);
    expect(h.selectOnly).toHaveBeenCalledWith('a');

    h.move(1, 5, 3);
    expect(h.beginNodeDrag).not.toHaveBeenCalled();
    expect(h.applyDragMove).not.toHaveBeenCalled();

    h.up(1);
    // A node tap is NOT an empty-canvas tap: the selection stays.
    expect(h.finalizeNodeDrag).not.toHaveBeenCalled();
    expect(h.clearAll).not.toHaveBeenCalled();
    expect(h.touchCleanupRef.current).toBeNull();
  });
});

describe('useTopologyEditorTouch — pan, tap and full-state resets', () => {
  it('a sub-threshold background touch never pans and its release taps like a click', () => {
    const h = setup();

    h.down({ pointerId: 1, clientX: 0, clientY: 0 });
    h.move(1, 5, 3);
    expect(h.isPanningRef.current).toBe(false);
    expect(h.setPan).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');

    h.up(1);
    // Empty-canvas tap == plain click: the selection clears.
    expect(h.clearAll).toHaveBeenCalledTimes(1);
    expect(h.touchCleanupRef.current).toBeNull();
  });

  it('a cancelled pan gesture resets the pan surface and a fresh two-finger gesture re-arms', () => {
    const h = setup();

    // Gesture 1: a real background pan, then the system steals the touch.
    h.down({ pointerId: 1, clientX: 100, clientY: 100 });
    h.move(1, 200, 130);
    expect(h.isPanningRef.current).toBe(true);
    expect(document.body.style.cursor).toBe('grabbing');
    h.cancel(1);
    // Release semantics on the pan branch: flag + cursor reset, disposer ran.
    expect(h.isPanningRef.current).toBe(false);
    expect(document.body.style.cursor).toBe('');
    expect(h.touchCleanupRef.current).toBeNull();
    h.move(1, 300, 300);
    expect(h.setPan).toHaveBeenCalledTimes(1);

    // Gesture 2 re-arms (two-finger) and the pinch is live again.
    h.down({ pointerId: 5, clientX: 100, clientY: 100 });
    h.down({ pointerId: 6, clientX: 140, clientY: 100 });
    expect(typeof h.touchCleanupRef.current).toBe('function');
    h.move(6, 180, 100);
    // The pan count is still 1 (the cancelled gesture's listeners are gone)
    // and the new pinch wrote the setters: fingers (100,100)+(180,100) ->
    // mid1 (140,100), dist0 40 -> dist1 80, ratio 2 about pan0 (0,0).
    expect(h.setPan).toHaveBeenCalledTimes(2);
    expect(h.setZoom).toHaveBeenCalledWith(2);
    expect(h.setPan).toHaveBeenLastCalledWith({ x: -100, y: -100 });
  });

  it('after a completed pan release the gesture state is fully reset and a fresh drag runs clean', () => {
    const h = setup();

    h.down({ pointerId: 1, clientX: 100, clientY: 100 });
    h.move(1, 200, 130);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    h.up(1);
    expect(h.isPanningRef.current).toBe(false);
    expect(document.body.style.cursor).toBe('');
    expect(h.touchCleanupRef.current).toBeNull();

    // A subsequent single-finger node drag works fresh: arm, feed, commit,
    // each exactly once, and no pan state leaks into it.
    h.down({ pointerId: 2, clientX: 0, clientY: 0, target: nodeCardTarget('b') });
    h.move(2, 48, 48);
    h.up(2);
    expect(h.beginNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.applyDragMove).toHaveBeenCalledTimes(1);
    expect(h.finalizeNodeDrag).toHaveBeenCalledTimes(1);
    expect(h.setPan).toHaveBeenCalledTimes(1);
    expect(h.isPanningRef.current).toBe(false);
    expect(h.touchCleanupRef.current).toBeNull();
  });
});
