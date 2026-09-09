//! Canvas pointer-core callbacks for the topology editor (Phase 3.4b).
//!
//! Owns the seven gestures the canvas element itself receives: handleCanvasMouseMove
//! (node-drag feed + marquee rect tracking + connection snap-to-port, including the
//! hoveredTarget identity-preserve rule that keeps memoized cards from re-rendering),
//! handleCanvasMouseUp, finalizeMarquee (direction-aware contain/touch hit-testing
//! committed at release), startPan (installs its own document-level listeners and
//! records their teardown in panCleanupRef), handleCanvasMouseDown (background gate +
//! Space/Pan-tool branch + marquee arm + middle/right pan), handleWheel
//! (zoom-to-cursor) and handleContextMenu — the consume-then-reset gate that swallows
//! the native contextmenu ending a right-button pan, lifted verbatim out of the JSX.
//!
//! Every body is copied byte-for-byte from the inline originals and each stays a
//! PLAIN function, not a useCallback: the originals were recreated on every render,
//! so wrapping them would change identity churn for the memoized TopologyNodeCard /
//! TopologyWireGroup props.
//!
//! The hook owns only these callbacks. Every ref, state setter and node-drag callback
//! they read stays parent-owned and arrives through deps: the editor cancelMarquee,
//! cancelBendDrag, resetTransientCanvasState, the load-lifecycle call and the unmount
//! listener sweep all consume those refs, so hoisting any of them here would split one
//! gesture across two owners. The call site sits at the exact position of the original
//! block, so hook order — and therefore effect order — is unchanged.

import type { MutableRefObject, SetStateAction } from 'react';
import type { PortName, TopologyNodeData } from './NodeTopologyEditor';
import { NODE_HEIGHT, NODE_WIDTH } from './nodeTopologyClamp';
import { socketSemanticIds } from './topologyCard';
import { portRowCenterY } from './topologyMetrics';

/** Selection box in container-relative screen px (identity pan/zoom space). */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Inline context-menu anchor, part of the parent's shared contextMenu payload. */
export interface ContextMenuPoint {
  x: number;
  y: number;
  nodeId?: string;
  wireId?: string;
}

export interface TopologyPointerDeps {
  /** Live viewport pan — screen-to-canvas coords use the same transform as every other gesture. */
  pan: { x: number; y: number };
  /** Live viewport zoom divisor, paired with pan. */
  zoom: number;
  /** Current node list: marquee hit-testing and connection snap candidates. */
  nodes: TopologyNodeData[];
  /** Source node of an in-flight connection drag; gates the snap-to-port branch. */
  connectingFromNodeId: string | null;
  /** Selection captured at mousedown, which an additive (Shift) marquee unions into. */
  selectedNodeIds: Set<string>;
  /** Whether the Pan tool is active — Space+drag parity without the modifier. */
  panToolActive: boolean;
  /** Canvas element providing the getBoundingClientRect origin for container-relative coords. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Raw cursor mirror, read by the drag feed and the connection preview. */
  mousePosRef: MutableRefObject<{ x: number; y: number }>;
  /** Marquee render-state mirror: a document-armed finalizer must never read a stale rect. */
  marqueeRef: MutableRefObject<MarqueeRect | null>;
  /** Marquee anchor in container-relative px, written at mousedown and read at release. */
  marqueeStartRef: MutableRefObject<{ x: number; y: number } | null>;
  /** True when the marquee began with Shift, so release unions instead of replaces. */
  marqueeAdditiveRef: MutableRefObject<boolean>;
  /** Document marquee-mouseup teardown, also fired by the parent cancelMarquee and unmount sweep. */
  marqueeCleanupRef: MutableRefObject<(() => void) | null>;
  /** Set by a real pan movement; the context-menu gate consumes then resets it once. */
  panMovedRef: MutableRefObject<boolean>;
  /** Pan origin in canvas space (client minus the pan at gesture start). */
  panStartRef: MutableRefObject<{ x: number; y: number }>;
  /** Document pan-listener teardown, also fired by the parent unmount sweep. */
  panCleanupRef: MutableRefObject<(() => void) | null>;
  /** Live-pan flag guarding the document mousemove until the gesture ends. */
  isPanningRef: MutableRefObject<boolean>;
  /** Space modifier mirror, written by the parent keyboard effect (slice 3.4d). */
  spaceDownRef: MutableRefObject<boolean>;
  /** Sticky "user touched the canvas" flag: suppresses the auto-fit-viewport pass. */
  userInteractedRef: MutableRefObject<boolean>;
  /** Marquee rect state (null hides the box). */
  setMarquee: (value: SetStateAction<MarqueeRect | null>) => void;
  /** Connection-drag cursor in canvas space. */
  setPreviewCursor: (value: SetStateAction<{ x: number; y: number } | null>) => void;
  /** Snap-to-port target; rewritten only when its identity actually changes. */
  setHoveredTarget: (value: SetStateAction<{ nodeId: string; port: PortName; variantIndex: number } | null>) => void;
  /** Inline context-menu payload; a canvas mousedown closes any open menu. */
  setContextMenu: (value: SetStateAction<ContextMenuPoint | null>) => void;
  /** Viewport pan setter — used by the pan move listener and by zoom-to-cursor. */
  setPan: (value: SetStateAction<{ x: number; y: number }>) => void;
  /** Viewport zoom setter — wheel clamps to the same 0.4..2.0 range as the HUD. */
  setZoom: (value: SetStateAction<number>) => void;
  /** Mirrors an active pan into state so the cursor class and HUD follow it. */
  setPanGestureActive: (value: SetStateAction<boolean>) => void;
  /** Parent node-drag move feed (slice 3.4c): every canvas mousemove drives it. */
  applyDragMove: (clientX: number, clientY: number) => void;
  /** Parent node-drag commit (slice 3.4c): canvas mouseup finalizes it. */
  finalizeNodeDrag: () => void;
  /** Selection reducer: the marquee commits its hit set through it. */
  selectMany: (ids: string[], primary: string | null) => void;
  /** Selection reducer: a background press and a hitless marquee clear it. */
  clearSelection: () => void;
  /** Connection reducer: a background press drops a staged wire. */
  clearWire: () => void;
  /** Relationship-picker close: a background click fully cancels an open picker. */
  dismissPicker: () => void;
}

/**
 * The canvas pointer core, with the same per-render identities the inline originals had.
 */
export function useTopologyEditorPointer(deps: TopologyPointerDeps): {
  handleCanvasMouseMove: (e: React.MouseEvent) => void;
  handleCanvasMouseUp: () => void;
  handleCanvasMouseDown: (e: React.MouseEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;
  finalizeMarquee: () => void;
  startPan: (e: React.MouseEvent, clearSelectionFirst: boolean) => void;
  handleContextMenu: (e: React.MouseEvent) => void;
} {
  const {
    pan,
    zoom,
    nodes,
    connectingFromNodeId,
    selectedNodeIds,
    panToolActive,
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
    applyDragMove,
    finalizeNodeDrag,
    selectMany,
    clearSelection,
    clearWire,
    dismissPicker,
  } = deps;

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    // NOTE: the HUD cursor readout is NOT fed here — CanvasCursorReadout
    // owns its own document listener + rAF, so canvas mousemoves re-render
    // only that span, never the editor.
    applyDragMove(e.clientX, e.clientY);
    if (marqueeStartRef.current) {
      // Marquee: track the drag rect in container-relative screen px.
      const rect = canvasRef.current?.getBoundingClientRect();
      const next = {
        x0: marqueeStartRef.current.x,
        y0: marqueeStartRef.current.y,
        x1: e.clientX - (rect?.left ?? 0),
        y1: e.clientY - (rect?.top ?? 0),
      };
      setMarquee(next);
      marqueeRef.current = next;
    } else if (connectingFromNodeId) {
      // Find nearest target port when dragging a connection
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      setPreviewCursor({ x: mx, y: my });
      const SNAP_DIST = 30;
      let closest: { nodeId: string; port: PortName; variantIndex: number; dist: number } | null = null;
      for (const n of nodes) {
        if (n.id === connectingFromNodeId) continue;
    // Snap candidates mirror the stacked port rows (round 174): every
    // semantic row on the left (input) and right (output) column is a
    // candidate, positioned at its own portRowCenterY.
    const candidates: Array<{ port: PortName; variantIndex: number; off: { dx: number; dy: number } }> = [];
    for (let i = 0; i < socketSemanticIds(n, 'left').length; i += 1) {
      candidates.push({ port: 'left', variantIndex: i, off: { dx: 0, dy: portRowCenterY(n, i) } });
    }
    for (let i = 0; i < socketSemanticIds(n, 'right').length; i += 1) {
      candidates.push({ port: 'right', variantIndex: i, off: { dx: NODE_WIDTH, dy: portRowCenterY(n, i) } });
    }
        for (const c of candidates) {
          const px = n.x + c.off.dx;
          const py = n.y + c.off.dy;
          const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
          if (dist < SNAP_DIST && (!closest || dist < closest.dist)) {
            closest = { nodeId: n.id, port: c.port, variantIndex: c.variantIndex, dist };
          }
        }
      }
      setHoveredTarget((prev) => {
        if (!closest) return prev === null ? prev : null;
        // Only create a new object when values actually changed — prevents
        // all memoized node cards from re-rendering on every mousemove.
        if (prev && prev.nodeId === closest.nodeId && prev.port === closest.port && prev.variantIndex === closest.variantIndex) return prev;
        return { nodeId: closest.nodeId, port: closest.port, variantIndex: closest.variantIndex };
      });
    }
  };

  const handleCanvasMouseUp = () => {
    finalizeNodeDrag();
    // The marquee is finalized by its own document-level mouseup listener
    // (armed at marquee start), which also fires when the pointer is
    // released OUTSIDE the canvas — the canvas onMouseUp is unreachable
    // there, and without it the box would linger and re-open on the next
    // mousemove.
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (panMovedRef.current) {
      // A right-button pan ends with a native contextmenu event;
      // consume only that post-drag event. The next stationary
      // right-click is allowed to open the menu normally.
      panMovedRef.current = false;
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    setContextMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };

  /** Commit the marquee at its release point: a forward drag (left→right)
   *  selects only nodes FULLY contained in the box, a backward drag
   *  (right→left) selects every node the box touches (screen space at
   *  identity pan/zoom), or leave the selection cleared if the box captured
   *  nothing (a background click). The rect is derived from the START ref +
   *  release coords, so a document listener armed at mousedown never reads
   *  a stale rect. */
  const finalizeMarquee = () => {
    const start = marqueeStartRef.current;
    marqueeStartRef.current = null;
    if (!start) return;
    // Only a marquee that actually RENDERED (the pointer moved) commits — a
    // mousedown+mouseup without movement is a plain background click, and
    // the selection was already cleared when it started. The ref mirror
    // also keeps this document-armed listener free of stale-closure risk.
    const box = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!box) return;
    const mx0 = Math.min(box.x0, box.x1);
    const mx1 = Math.max(box.x0, box.x1);
    const my0 = Math.min(box.y0, box.y1);
    const my1 = Math.max(box.y0, box.y1);
    // A degenerate (click-sized) box selects nothing.
    if (mx1 - mx0 < 1 || my1 - my0 < 1) return;
    // Direction-aware marquee (Figma/draw.io convention): a FORWARD drag
    // (left→right) selects only nodes FULLY contained in the box; a
    // BACKWARD drag (right→left) selects every node the box touches.
    const forward = box.x1 >= box.x0;
    const hit = nodes.filter((n) => {
      const nx = n.x * zoom + pan.x;
      const ny = n.y * zoom + pan.y;
      const nx1 = nx + NODE_WIDTH * zoom;
      const ny1 = ny + NODE_HEIGHT * zoom;
      if (forward) {
        return nx >= mx0 && nx1 <= mx1 && ny >= my0 && ny1 <= my1;
      }
      return nx1 >= mx0 && nx <= mx1 && ny1 >= my0 && ny <= my1;
    });
    const additive = marqueeAdditiveRef.current;
    marqueeAdditiveRef.current = false;
    if (hit.length > 0) {
      if (additive) {
        // Union with the selection captured at mousedown (the finalizer's
        // closure is from that render, so it still holds the pre-drag set).
        const union = new Set(selectedNodeIds);
        for (const n of hit) union.add(n.id);
        selectMany([...union], hit[hit.length - 1]!.id);
      } else {
        selectMany(hit.map((n) => n.id), hit[hit.length - 1]!.id);
      }
    } else if (!additive) {
      clearSelection();
    }
  };

  /** Start a pan gesture from any button: middle/right drags and the
   *  Space+left-drag modifier. Document-level listeners keep the pan
   *  tracking even when the pointer leaves the canvas. */
  const startPan = (e: React.MouseEvent, clearSelectionFirst: boolean) => {
    if (clearSelectionFirst) clearSelection();
    panMovedRef.current = false;
    isPanningRef.current = true;
    setPanGestureActive(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isPanningRef.current) return;
      panMovedRef.current = true;
      setPan({
        x: ev.clientX - panStartRef.current.x,
        y: ev.clientY - panStartRef.current.y,
      });
    };

    const handleMouseUp = () => {
      panCleanupRef.current?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    panCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      isPanningRef.current = false;
      setPanGestureActive(false);
      document.body.style.cursor = '';
      panCleanupRef.current = null;
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    userInteractedRef.current = true;
    // A background click dismisses an open picker (full cancel, like
    // Escape); a plain armed connection with no picker survives so the
    // user can pan to a distant target.
    dismissPicker();
    setContextMenu(null);
    const targetEl = e.target as HTMLElement;
    if (targetEl === e.currentTarget || targetEl.classList.contains('node-canvas-viewport') || targetEl.tagName === 'svg') {
      clearWire();
      if (e.button === 0 && (spaceDownRef.current || panToolActive)) {
        // Space+drag (or the active Pan tool) pans like the middle/right
        // button, but Figma-style it preserves the current selection
        // instead of clearing it.
        startPan(e, false);
      } else if (e.button === 0) {
        // Left-drag on empty background is the marquee selector; a plain
        // click (no movement) clears the selection on mouseup. Shift+drag is
        // ADDITIVE: the current selection is kept so the marquee unions into
        // it at release (and a Shift+click on empty canvas clears nothing).
        // The marquee coords are container-relative screen px (the viewport
        // inside is panned/zoomed, so node boxes are compared in screen
        // space too). A document-level mouseup finalizes the box, so
        // releasing outside the canvas still commits the selection instead
        // of leaking a half-open marquee.
        const additive = e.shiftKey;
        marqueeAdditiveRef.current = additive;
        if (!additive) {
          clearSelection();
        }
        const rect = canvasRef.current?.getBoundingClientRect();
        marqueeStartRef.current = {
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        };
        marqueeRef.current = null;
        marqueeCleanupRef.current?.();
        const handleMarqueeMouseUp = () => {
          finalizeMarquee();
          marqueeCleanupRef.current?.();
        };
        document.addEventListener('mouseup', handleMarqueeMouseUp);
        marqueeCleanupRef.current = () => {
          document.removeEventListener('mouseup', handleMarqueeMouseUp);
          marqueeCleanupRef.current = null;
        };
      } else if (e.button === 1 || e.button === 2) {
        // Middle/right-button drag pans the canvas.
        startPan(e, true);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => {
      const newZoom = Math.min(2.0, Math.max(0.4, prev * zoomFactor));
      // Zoom towards cursor: adjust pan so cursor position stays fixed
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      setPan((p) => ({
        x: cursorX - (cursorX - p.x) * (newZoom / prev),
        y: cursorY - (cursorY - p.y) * (newZoom / prev),
      }));
      return newZoom;
    });
  };

  return {
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleCanvasMouseDown,
    handleWheel,
    finalizeMarquee,
    startPan,
    handleContextMenu,
  };
}
