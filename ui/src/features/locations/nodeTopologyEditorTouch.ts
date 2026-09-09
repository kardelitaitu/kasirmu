//! Touch-gesture loop for the topology editor (Phase 3.4e).
//!
//! Owns the pointer-event parity path for tablets: the first touch arms a
//! node-drag (card hit) or pan (background hit) candidate, a sub-threshold
//! release resolves to a tap, a second finger commits any in-flight drag and
//! switches to a pinch-zoom about the two fingers' midpoint, and the whole loop
//! runs in DOCUMENT-level listeners armed at that first pointerdown (touch
//! pointers have implicit capture, so moves and ups keep firing after the
//! finger leaves the canvas). handleTouchPointerCancel ends the gesture by
//! calling handleTouchPointerUp — a stolen touch is treated exactly like a
//! release, byte-for-byte, because the finger is already gone.
//!
//! Every body, comment and closing brace is a verbatim line-slice of the inline
//! originals in NodeTopologyEditor.tsx. The originals were plain per-render
//! functions, so they stay plain here — no useCallback is introduced (wrapping
//! them would change identity churn for the props the canvas element receives),
//! and the hook registers no effect of its own.
//!
//! Ownership of the gesture state: touchPointersRef and touchGestureRef have no
//! reader outside this loop, so they moved with it. touchCleanupRef did NOT —
//! the editor's unmount listener sweep fires it (a branch switch mid-pinch
//! otherwise leaves three document listeners attached), so it stays
//! parent-declared beside its pan/drag/marquee siblings and arrives through
//! deps. The call site sits at the exact position of the original block, so the
//! component's hook order is unchanged.

import { useRef, type MutableRefObject, type SetStateAction } from 'react';
import type { ContextMenuPoint } from './nodeTopologyEditorPointer';
import { pinchTransform, TOUCH_DRAG_THRESHOLD } from './nodeTopologyTouch';

export interface TopologyTouchDeps {
  /** Live viewport pan — the pan baseline is captured as clientX minus pan.x. */
  pan: { x: number; y: number };
  /** Live viewport zoom divisor, the pinch baseline. */
  zoom: number;
  /** Viewport pan setter, written by both the pan branch and the pinch. */
  setPan: (value: SetStateAction<{ x: number; y: number }>) => void;
  /** Viewport zoom setter, written by the pinch through pinchTransform. */
  setZoom: (value: SetStateAction<number>) => void;
  /** Live-pan flag: the pan branch sets it, the release clears it and resets the grab cursor. */
  isPanningRef: MutableRefObject<boolean>;
  /** Sticky "user touched the canvas" flag: suppresses the auto-fit-viewport pass. */
  userInteractedRef: MutableRefObject<boolean>;
  /** Parent-owned document-listener teardown: also fired by the editor unmount sweep. */
  touchCleanupRef: MutableRefObject<(() => void) | null>;
  /** Selection captured at pointerdown; a group-member tap keeps it so the group drags as a whole. */
  selectedNodeIds: Set<string>;
  /** Selection reducer: a tap on an unselected node collapses the selection to it. */
  selectOnly: (id: string) => void;
  /** Connection reducer: tapping a node drops a staged wire, mirroring the mouse path. */
  clearWire: () => void;
  /** Selection reducer: an empty-canvas tap is the touch equivalent of a plain click. */
  clearAll: () => void;
  /** Relationship-picker dismissal, fired on every touch pointerdown with the context menu. */
  dismissPicker: () => void;
  /** Inline context-menu payload; a touch pointerdown closes any open menu. */
  setContextMenu: (value: SetStateAction<ContextMenuPoint | null>) => void;
  /** Pointer-hook drag arm: called once the touch crosses TOUCH_DRAG_THRESHOLD on a node. */
  beginNodeDrag: (
    clientX: number,
    clientY: number,
    selection: Set<string>,
    isDuplicateDrag: boolean,
    gesture: 'mouse' | 'touch',
  ) => void;
  /** Pointer-hook drag feed. */
  applyDragMove: (clientX: number, clientY: number) => void;
  /** Pointer-hook drag commit: a touch release finalizes the drag like a mouse release. */
  finalizeNodeDrag: () => void;
}

/**
 * The touch gesture loop, with the same per-render identities the inline originals had.
 */
export function useTopologyEditorTouch(deps: TopologyTouchDeps): {
  handleCanvasPointerDown: (e: React.PointerEvent) => void;
} {
  const {
    pan,
    zoom,
    setPan,
    setZoom,
    isPanningRef,
    userInteractedRef,
    touchCleanupRef,
    selectedNodeIds,
    selectOnly,
    clearWire,
    clearAll,
    dismissPicker,
    setContextMenu,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
  } = deps;

  // ── Touch gestures (pointer parity for tablets) ────────────────
  // Mouse input keeps the mouse handlers above (and all their tests); touch
  // input runs entirely through pointer events. One finger on a node card
  // drags it, one finger on empty canvas pans (a sub-threshold touch is a
  // tap that clears the selection), and two fingers pinch-zoom about the
  // midpoint. The gesture loop runs in DOCUMENT-level pointer listeners
  // armed at the first pointerdown: touch pointers have implicit capture,
  // so moves/ups keep firing even when the finger leaves the canvas, and
  // dispatching on the canvas (tests) still bubbles to the document. All
  // gesture state lives in refs so the stale down-time closure always sees
  // the latest drag/pan/zoom.
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  interface TouchGesture {
    mode: 'none' | 'node-drag' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    nodeId: string | null;
    selection: Set<string>;
    panStart: { x: number; y: number };
    pinchZoom0: number;
    pinchPan0: { x: number; y: number };
    pinchMid0: { x: number; y: number };
    pinchDist0: number;
  }
  const touchGestureRef = useRef<TouchGesture | null>(null);

  /** Finish a touch gesture with all fingers lifted: finalize any node drag
   *  (commits Alt-style copies — none on touch — and clears drag state),
   *  end a pan, or resolve a tap (empty-canvas taps clear the selection). */
  const endTouchGesture = (g: TouchGesture) => {
    if (g.mode === 'node-drag') {
      finalizeNodeDrag();
    } else if (g.mode === 'pan') {
      // Touch pans never emit the native contextmenu (no right button), so
      // the contextmenu-suppression ref is a mouse-only concern.
      isPanningRef.current = false;
      document.body.style.cursor = '';
    } else if (g.mode === 'none' && g.nodeId === null) {
      // A tap on empty canvas is the touch equivalent of a plain click
      // (the mouse path finalizes an empty marquee, which clears the
      // selection). Node taps already selected at pointerdown.
      clearAll();
    }
    touchPointersRef.current.clear();
    touchGestureRef.current = null;
    touchCleanupRef.current?.();
  };

  const handleTouchPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const prev = touchPointersRef.current.get(e.pointerId);
    if (prev) touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = touchGestureRef.current;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (touchPointersRef.current.size < 2) return;
      const pts = [...touchPointersRef.current.values()];
      const p1 = pts[0]!;
      const p2 = pts[1]!;
      const out = pinchTransform(
        { zoom: g.pinchZoom0, pan: g.pinchPan0 },
        g.pinchMid0,
        g.pinchDist0,
        { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        Math.hypot(p2.x - p1.x, p2.y - p1.y),
      );
      setZoom(out.zoom);
      setPan(out.pan);
      return;
    }
    if (g.mode === 'none') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD) return;
      if (g.nodeId !== null) {
        // The node was already selected at pointerdown; arm the drag with
        // the stored selection (the group, when the touch landed on an
        // already-selected member).
        beginNodeDrag(g.startX, g.startY, g.selection, false, 'touch');
        g.mode = 'node-drag';
      } else {
        isPanningRef.current = true;
        document.body.style.cursor = 'grabbing';
        // Pan baseline from the down-time view (same as startPan's
        // panStartRef: clientX − pan.x).
        g.panStart = { x: g.startX - pan.x, y: g.startY - pan.y };
        g.mode = 'pan';
      }
    }
    if (g.mode === 'node-drag') {
      applyDragMove(e.clientX, e.clientY);
    } else if (g.mode === 'pan') {
      setPan({ x: e.clientX - g.panStart.x, y: e.clientY - g.panStart.y });
    }
  };

  const handleTouchPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touchPointersRef.current.delete(e.pointerId);
    const g = touchGestureRef.current;
    if (!g) {
      // All fingers lifted outside a gesture (e.g. the inert finger left
      // after a pinch disarmed the gesture) — drop the listeners.
      if (touchPointersRef.current.size === 0) touchCleanupRef.current?.();
      return;
    }
    if (touchPointersRef.current.size > 0) {
      // A finger remains down. After a pinch (or an armed-but-unmoved
      // gesture) the remaining finger must not continue a pan or drag —
      // disarm until all fingers lift.
      if (g.mode === 'pinch' || g.mode === 'none') touchGestureRef.current = null;
      return;
    }
    endTouchGesture(g);
  };

  /** A system gesture stole the touch (scroll, notification) — end the
   *  gesture exactly like a release; the finger is already gone. */
  const handleTouchPointerCancel = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    handleTouchPointerUp(e);
  };

  /** Arm the document-level touch gesture listeners once, when the first
   *  touch pointer lands. Removed by endTouchGesture when all fingers lift. */
  const armTouchDocumentListeners = () => {
    if (touchCleanupRef.current) return;
    document.addEventListener('pointermove', handleTouchPointerMove);
    document.addEventListener('pointerup', handleTouchPointerUp);
    document.addEventListener('pointercancel', handleTouchPointerCancel);
    touchCleanupRef.current = () => {
      document.removeEventListener('pointermove', handleTouchPointerMove);
      document.removeEventListener('pointerup', handleTouchPointerUp);
      document.removeEventListener('pointercancel', handleTouchPointerCancel);
      touchCleanupRef.current = null;
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    // Suppress the compatibility mouse events (mousedown/mouseup) a real
    // browser dispatches after touch — without this, a touch pan would
    // spawn a ghost marquee and a touch node-tap would double-arm a drag.
    e.preventDefault();
    userInteractedRef.current = true;
    dismissPicker();
    setContextMenu(null);
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = touchGestureRef.current;
    if (touchPointersRef.current.size === 1) {
      // First finger: arm a drag (node card) or pan (background) candidate.
      const target = e.target as HTMLElement;
      const card = target.closest('.topology-node');
      const onNode = !!card && !target.closest('input, button, select, textarea, [data-no-node-drag]');
      if (onNode) {
        const nodeId = (card as HTMLElement).dataset['nodeId'] ?? null;
        if (nodeId) {
          // Selection mirrors the mouse mousedown rules: a tap on an
          // unselected node collapses to it; a tap on an already-selected
          // node keeps the group so it can be dragged as a whole.
          const wasSelected = selectedNodeIds.has(nodeId);
          if (!wasSelected) selectOnly(nodeId);
          clearWire();
          touchGestureRef.current = {
            mode: 'none',
            startX: e.clientX,
            startY: e.clientY,
            nodeId,
            selection: wasSelected ? new Set(selectedNodeIds) : new Set([nodeId]),
            panStart: { x: 0, y: 0 },
            pinchZoom0: 1,
            pinchPan0: { x: 0, y: 0 },
            pinchMid0: { x: 0, y: 0 },
            pinchDist0: 0,
          };
        }
      } else {
        touchGestureRef.current = {
          mode: 'none',
          startX: e.clientX,
          startY: e.clientY,
          nodeId: null,
          selection: new Set(),
          panStart: { x: 0, y: 0 },
          pinchZoom0: 1,
          pinchPan0: { x: 0, y: 0 },
          pinchMid0: { x: 0, y: 0 },
          pinchDist0: 0,
        };
      }
    } else if (touchPointersRef.current.size === 2) {
      // Second finger: commit any in-flight node drag (the node stays where
      // it is; its undo entry was already pushed on first movement), then
      // enter pinch about the two fingers' midpoint.
      if (g?.mode === 'node-drag') finalizeNodeDrag();
      const pts = [...touchPointersRef.current.values()];
      const p1 = pts[0]!;
      const p2 = pts[1]!;
      touchGestureRef.current = {
        mode: 'pinch',
        startX: 0,
        startY: 0,
        nodeId: null,
        selection: new Set(),
        panStart: { x: 0, y: 0 },
        pinchZoom0: zoom,
        pinchPan0: pan,
        pinchMid0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        pinchDist0: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      };
    }
    armTouchDocumentListeners();
  };

  return { handleCanvasPointerDown };
}
