//! Canvas minimap overview widget for the topology editor.
//!
//! A scaled overview of the whole diagram, rendered bottom-left of the
//! canvas. Click or drag recenters the viewport on that canvas point; arrow
//! keys nudge the view; Enter centers on the content box. The parent keeps
//! the per-diagram show/hide state (its toolbar button owns it) and the
//! viewport transforms; this component owns the projection math, its drag
//! document listeners, and its own cleanup.

import { useEffect, useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useLocalization } from '@fluent/react';
import { NODE_WIDTH, NODE_HEIGHT } from './nodeTopologyClamp';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

/** Minimap overview widget geometry (bottom-left of the canvas). */
const MINIMAP_W = 176;
const MINIMAP_H = 120;
const MINIMAP_PAD = 8;
const MINIMAP_VIEWPORT_MIN = 8;
/** Drawable area inside the padding — the viewport box clamps to this. */
const PADDED_W = MINIMAP_W - MINIMAP_PAD * 2;
const PADDED_H = MINIMAP_H - MINIMAP_PAD * 2;

/** Bounding box of the diagram in canvas coords — the minimap's frame. */
interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TopologyMinimapProps {
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  nodeMap: Map<string, TopologyNodeData>;
  /** Viewport pan (canvas coords) for the visible-area overlay box. */
  pan: { x: number; y: number };
  /** Viewport zoom for the visible-area overlay box. */
  zoom: number;
  /** Live canvas size (viewport width in CSS px). */
  canvasWidth: number;
  /** Live canvas size (viewport height in CSS px). */
  canvasHeight: number;
  /** Center the viewport on a canvas point (parent-owned setPan). */
  onCenter: (cx: number, cy: number) => void;
  /** Nudge the viewport by a canvas-space delta (parent-owned setPan). */
  onNudge: (dx: number, dy: number) => void;
}

/**
 * The canvas minimap. Renders nothing when the diagram has no nodes (there is
 * no content box to project); otherwise draws wires, nodes, and the current
 * viewport box, and recenters/nudges the viewport on mouse/keyboard input.
 */
export function TopologyMinimap({
  nodes,
  wires,
  nodeMap,
  pan,
  zoom,
  canvasWidth,
  canvasHeight,
  onCenter,
  onNudge,
}: TopologyMinimapProps) {
  const { l10n } = useLocalization();
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapDragCleanupRef = useRef<(() => void) | null>(null);

  /** Content bounding box in canvas coords — the minimap's projection frame. */
  const contentBounds = useMemo<ContentBounds | null>(() => {
    if (nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.y + NODE_HEIGHT);
    }
    return { minX, minY, maxX, maxY };
  }, [nodes]);

  /** Uniform scale mapping canvas coords onto the fixed-size minimap. */
  const minimapScale = useMemo(() => {
    if (!contentBounds) return 1;
    const cw = contentBounds.maxX - contentBounds.minX;
    const ch = contentBounds.maxY - contentBounds.minY;
    if (cw <= 0 || ch <= 0) return 1;
    return Math.min(
      (MINIMAP_W - MINIMAP_PAD * 2) / cw,
      (MINIMAP_H - MINIMAP_PAD * 2) / ch,
    );
  }, [contentBounds]);

  /** The visible-content box. The projection frame is the diagram bounds,
   *  but the visible canvas area is canvasSize/zoom — as soon as that
   *  outgrows the diagram (a wide canvas at 100%, massively at the 40%
   *  floor) a raw viewport rect overflows the map and the SVG clips it
   *  mid-edge. Instead the box is the viewport rect INTERSECTED with the
   *  diagram bounds, mapped exactly: it always lands inside the padded map,
   *  fills the map when the view contains the whole diagram ("you are
   *  seeing everything"), tracks pan/zoom 1:1 while the view overlaps
   *  content, and collapses to a MINIMAP_VIEWPORT_MIN chip pinned toward
   *  the nearest edge when the view is entirely off-content (keeping the
   *  side cue). Span ≤ 0 folds into the min chip via the Math.max below. */
  const viewportBox = useMemo(() => {
    const cb = contentBounds;
    const availW = PADDED_W;
    const availH = PADDED_H;
    if (!cb) {
      return { x: MINIMAP_PAD, y: MINIMAP_PAD, w: MINIMAP_VIEWPORT_MIN, h: MINIMAP_VIEWPORT_MIN };
    }
    // Visible canvas range: screen(0) is the viewport's left/top edge, so
    // the origin is −pan/zoom (pan.x directly would put the box on the
    // wrong side of the map and ignore the zoom).
    const vx0 = -pan.x / zoom;
    const vy0 = -pan.y / zoom;
    const vx1 = (canvasWidth - pan.x) / zoom;
    const vy1 = (canvasHeight - pan.y) / zoom;
    const ix0 = Math.max(vx0, cb.minX);
    const ix1 = Math.min(vx1, cb.maxX);
    const iy0 = Math.max(vy0, cb.minY);
    const iy1 = Math.min(vy1, cb.maxY);
    const w = Math.max(MINIMAP_VIEWPORT_MIN, (ix1 - ix0) * minimapScale);
    const h = Math.max(MINIMAP_VIEWPORT_MIN, (iy1 - iy0) * minimapScale);
    const clampIntoMap = (raw: number, avail: number, size: number) =>
      Math.min(Math.max(raw, MINIMAP_PAD), MINIMAP_PAD + avail - size);
    return {
      x: clampIntoMap(MINIMAP_PAD + (ix0 - cb.minX) * minimapScale, availW, w),
      y: clampIntoMap(MINIMAP_PAD + (iy0 - cb.minY) * minimapScale, availH, h),
      w,
      h,
    };
  }, [pan.x, pan.y, zoom, canvasWidth, canvasHeight, contentBounds, minimapScale]);

  // Clean up any in-flight minimap drag when the widget unmounts (editor
  // teardown or the user hides the map mid-drag) — the drag arms document
  // listeners so the map keeps panning when the pointer leaves the widget.
  useEffect(() => () => { minimapDragCleanupRef.current?.(); }, []);

  if (!contentBounds) return null;

  const recenterViewOn = (px: number, py: number) => {
    const cx = contentBounds.minX + (px - MINIMAP_PAD) / minimapScale;
    const cy = contentBounds.minY + (py - MINIMAP_PAD) / minimapScale;
    onCenter(cx, cy);
  };

  const handleMinimapMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = minimapRef.current?.getBoundingClientRect();
    recenterViewOn(e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0));
    minimapDragCleanupRef.current?.();
    const handleMove = (ev: MouseEvent) => {
      const r = minimapRef.current?.getBoundingClientRect();
      recenterViewOn(ev.clientX - (r?.left ?? 0), ev.clientY - (r?.top ?? 0));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      minimapDragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    minimapDragCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      minimapDragCleanupRef.current = null;
    };
  };

  const handleMinimapKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      const cx = contentBounds.minX + (contentBounds.maxX - contentBounds.minX) / 2;
      const cy = contentBounds.minY + (contentBounds.maxY - contentBounds.minY) / 2;
      onCenter(cx, cy);
      return;
    }
    const STEP = 40;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -STEP;
    else if (e.key === 'ArrowRight') dx = STEP;
    else if (e.key === 'ArrowUp') dy = -STEP;
    else if (e.key === 'ArrowDown') dy = STEP;
    else return;
    e.preventDefault();
    onNudge(dx, dy);
  };

  return (
    <div
      ref={minimapRef}
      className="topology-minimap"
      role="button"
      tabIndex={0}
      aria-label={l10n.getString('topology-minimap-aria')}
      onMouseDown={handleMinimapMouseDown}
      onKeyDown={handleMinimapKeyDown}
    >
      <svg width={MINIMAP_W} height={MINIMAP_H} aria-hidden="true">
        {wires.map((w) => {
          const from = nodeMap.get(w.fromNodeId);
          const to = nodeMap.get(w.toNodeId);
          if (!from || !to) return null;
          return (
            <line
              key={w.id}
              className="topology-minimap-wire"
              x1={MINIMAP_PAD + (from.x + NODE_WIDTH / 2 - contentBounds.minX) * minimapScale}
              y1={MINIMAP_PAD + (from.y + NODE_HEIGHT / 2 - contentBounds.minY) * minimapScale}
              x2={MINIMAP_PAD + (to.x + NODE_WIDTH / 2 - contentBounds.minX) * minimapScale}
              y2={MINIMAP_PAD + (to.y + NODE_HEIGHT / 2 - contentBounds.minY) * minimapScale}
            />
          );
        })}
        {nodes.map((n) => (
          <rect
            key={n.id}
            className={`topology-minimap-node node-type-${n.type}`}
            x={MINIMAP_PAD + (n.x - contentBounds.minX) * minimapScale}
            y={MINIMAP_PAD + (n.y - contentBounds.minY) * minimapScale}
            width={Math.max(2, NODE_WIDTH * minimapScale)}
            height={Math.max(2, NODE_HEIGHT * minimapScale)}
            rx={2}
          />
        ))}
        <rect
          className="topology-minimap-viewport"
          // Screen(0) is the viewport's left/top edge, so the visible canvas
          // range is [−pan/zoom, (canvasW − pan)/zoom] — the raw box origin is
          // −pan/zoom (pan.x directly would put the box on the wrong side of
          // the map and ignore the zoom). viewportBox clamps that raw rect to
          // the padded map area, so the box can never spill past the map edge
          // however far the view outgrows the diagram.
          x={viewportBox.x}
          y={viewportBox.y}
          width={viewportBox.w}
          height={viewportBox.h}
        />
      </svg>
    </div>
  );
}
