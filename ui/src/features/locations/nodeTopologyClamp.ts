// View-relative node positioning clamp for the topology editor.
//
// Nodes live in canvas coordinates inside a viewport transformed with
// `translate(pan) scale(zoom)`; their screen position is `pan + pos * zoom`.
// clampNodeToViewport converts a "keep the node visible" constraint back
// into canvas space so dragging/nudging can never lose a node off-canvas.

// Estimated node card dimensions for wire endpoint positioning.
// Uniform card dimensions keep connector geometry deterministic. The card reserves
// a dedicated footer for left/right ports instead of letting labels overlap content.
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 240;
/** Height of the dedicated left/right connector rail (CSS `.node-port-sockets-group`). */
export const NODE_PORT_ROW_H = 32;
/** Diameter of the connector marker circles (CSS `.node-port-socket::before`). */
export const NODE_PORT_MARKER = 12;
/** Canvas-space centerline of the connector rail — the wire endpoints must
 *  coincide with the visible circle centers: row top + (row − marker)/2 + marker/2. */
export const NODE_PORT_Y = NODE_HEIGHT - NODE_PORT_ROW_H + NODE_PORT_ROW_H / 2;

/** Screen px of the node box that must remain visible at the canvas edge.
 *  The clamp keeps at least this much of a node on-screen so it can never
 *  be dragged into unreachable negative space (the old hard 20px floor). */
export const EDGE_MARGIN = 40;

export interface ViewportClampOptions {
  panX: number;
  panY: number;
  zoom: number;
  canvasW: number;
  canvasH: number;
  nodeW?: number;
  nodeH?: number;
  /** Screen px of the node box that must remain visible (default EDGE_MARGIN). */
  margin?: number;
}

/**
 * Clamp a node position (canvas coordinates) so the node's box always
 * intersects the visible canvas viewport, with `margin` screen px still
 * visible. Pan/zoom aware: the screen position of a node origin is
 * `pan + pos * zoom` under the viewport's translate(pan) scale(zoom), so
 * the bounds translate back into canvas space. At identity transform this
 * reduces to `x ∈ [-(NODE_WIDTH − margin), canvasW − margin]`. The node width is
 * intentionally 240px so connector labels and workspace names have room to breathe.
 *
 * When the canvas has no measured size (0 — jsdom, pre-layout), no
 * viewport constraint exists and the position is returned unchanged.
 */
export function clampNodeToViewport(
  x: number,
  y: number,
  opts: ViewportClampOptions,
): { x: number; y: number } {
  const { panX, panY, zoom, canvasW, canvasH } = opts;
  if (canvasW <= 0 || canvasH <= 0) return { x, y };
  const nodeW = opts.nodeW ?? NODE_WIDTH;
  const nodeH = opts.nodeH ?? NODE_HEIGHT;
  const margin = opts.margin ?? EDGE_MARGIN;
  // Node's right edge must stay `margin` inside the canvas left edge, and
  // its left edge `margin` inside the right edge. min/max are swapped-safe
  // so a degenerate tiny canvas still keeps the node visible, never lost.
  const minX = (margin - panX) / zoom - nodeW;
  const maxX = (canvasW - margin - panX) / zoom;
  const minY = (margin - panY) / zoom - nodeH;
  const maxY = (canvasH - margin - panY) / zoom;
  const loX = Math.min(minX, maxX);
  const hiX = Math.max(minX, maxX);
  const loY = Math.min(minY, maxY);
  const hiY = Math.max(minY, maxY);
  return {
    x: Math.min(Math.max(x, loX), hiX),
    y: Math.min(Math.max(y, loY), hiY),
  };
}

/** Screen-px band inside each canvas edge that triggers auto-pan while
 *  dragging, and the max pan delta (px) applied per move event at full
 *  band depth. Tuned so a drag at the edge scrolls fast enough to cross a
 *  large diagram without outrunning the pointer. */
export const EDGE_AUTO_PAN_MARGIN = 48;
export const EDGE_AUTO_PAN_MAX_DELTA = 20;

export interface EdgeAutoPanOptions {
  /** Screen-px band inside each edge that triggers a pan (default 48). */
  margin?: number;
  /** Max pan delta per move event at full band depth (default 20). */
  maxDelta?: number;
}

/** Pan delta for edge auto-pan during a drag: the closer the pointer sits
 *  to a canvas edge (inside the margin band), the more the viewport pans
 *  per move event — dragging toward an edge keeps revealing new content so
 *  the drag can continue across a large diagram instead of hitting the
 *  viewport clamp. Pointers OUTSIDE the canvas produce NO delta: a drag
 *  that leaves the canvas holds the node at the clamp edge (the "never lose
 *  a node off-canvas" invariant) rather than chasing the cursor. */
export function edgeAutoPanDelta(
  px: number,
  py: number,
  width: number,
  height: number,
  opts: EdgeAutoPanOptions = {},
): { dx: number; dy: number } {
  if (width <= 0 || height <= 0) return { dx: 0, dy: 0 };
  const margin = opts.margin ?? EDGE_AUTO_PAN_MARGIN;
  const maxDelta = opts.maxDelta ?? EDGE_AUTO_PAN_MAX_DELTA;
  const depth = (v: number, limit: number) => {
    if (v < 0 || v > limit) return 0;
    if (v < margin) return -((margin - v) / margin) * maxDelta;
    if (v > limit - margin) return ((v - (limit - margin)) / margin) * maxDelta;
    return 0;
  };
  return { dx: depth(px, width), dy: depth(py, height) };
}

export interface SpawnSpotOptions {
  /** Canvas-space gap kept between the spawned box and any occupied box
   *  (default 24 — one grid step). */
  gap?: number;
  /** Maximum spiral rings searched before giving up (default 64 → ±1536px). */
  maxSteps?: number;
}

/**
 * First collision-free spot near `start` for a new uniform node card.
 *
 * Palette spawns jitter around the diagram origin, which historically
 * stacked them invisibly on top of the preset cards (the jitter box sits
 * inside the branch card's bounds). This scans a square spiral outward in
 * `gap`-sized steps and returns the first position whose box (plus the
 * gap) intersects no occupied box — so a fresh node always lands visibly
 * clear of the existing diagram. When every ring is exhausted it returns
 * the farthest corner reached as a best-effort spot rather than failing.
 */
export function findFreeSpawnSpot(
  start: { x: number; y: number },
  occupied: { x: number; y: number }[],
  opts: SpawnSpotOptions = {},
): { x: number; y: number } {
  const gap = opts.gap ?? 24;
  const maxSteps = opts.maxSteps ?? 64;
  const boxW = NODE_WIDTH + gap;
  const boxH = NODE_HEIGHT + gap;
  const overlaps = (p: { x: number; y: number }) =>
    occupied.some((o) =>
      p.x < o.x + boxW && p.x + boxW > o.x
      && p.y < o.y + boxH && p.y + boxH > o.y);
  if (!overlaps(start)) return start;
  let best = start;
  for (let ring = 1; ring <= maxSteps; ring += 1) {
    const d = ring * gap;
    // Perimeter of the square ring: cells where |dx| or |dy| equals the ring.
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const p = { x: start.x + dx * gap, y: start.y + dy * gap };
        if (!overlaps(p)) return p;
      }
    }
    best = { x: start.x + d, y: start.y + d };
  }
  return best;
}

/**
 * True when two uniform node-card boxes (NODE_WIDTH × NODE_HEIGHT) at the
 * given origins intersect. Flush edges (zero gap) are NOT an overlap — that
 * is the exact landing the alignment guides produce deliberately, so a drop
 * resolution must never nudge a guide-aligned node apart.
 */
export function nodeBoxesOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return a.x < b.x + NODE_WIDTH && a.x + NODE_WIDTH > b.x
    && a.y < b.y + NODE_HEIGHT && a.y + NODE_HEIGHT > b.y;
}

/**
 * The ids of every node whose card box intersects another node's box
 * (round 143). Used for the non-destructive overlap badge on cards that
 * loaded stacked — movement paths can no longer CREATE overlaps (rounds
 * 140-142), but saved diagrams may still carry them, and the indicator is
 * the honest surface (auto-moving on load would be a silent jump).
 * Derived from live geometry, so dragging a card clear drops it from the
 * set automatically.
 */
export function findOverlappingNodeIds(
  nodes: Array<{ id: string; x: number; y: number }>,
): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (nodeBoxesOverlap(nodes[i]!, nodes[j]!)) {
        result.add(nodes[i]!.id);
        result.add(nodes[j]!.id);
      }
    }
  }
  return result;
}

/**
 * Resolve overlaps introduced by a node drag drop (round 140).
 *
 * The editor's invariant is that node cards never overlap — palette spawns
 * settle via findFreeSpawnSpot and loads spread on a grid — but a drag can
 * drop a node on top of another card, stacking it invisibly. Each dragged
 * node whose box intersects ANY other node settles into the nearest
 * collision-free spot, scanning a square spiral outward in 24px (grid)
 * steps from its drop position — the same settle semantics as spawns, but
 * with a STRICT zero-gap intersection test so flush alignment (the guide
 * landing) is preserved. Iterates to convergence (a settled node can never
 * land on a fellow dragged node's resolved spot) and returns `null` when
 * nothing moved so callers can skip the state write entirely. When the
 * spiral is exhausted (pathological diagrams) the drop position is kept
 * rather than jumping the node arbitrarily far.
 */
export function resolveDropOverlaps(
  nodes: Array<{ id: string; x: number; y: number }>,
  draggedIds: ReadonlySet<string>,
  opts: { maxSteps?: number } = {},
): Array<{ id: string; x: number; y: number }> | null {
  const step = 24;
  const maxSteps = opts.maxSteps ?? 64;
  const positions = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const others = (id: string) =>
    [...positions.entries()].filter(([oid]) => oid !== id).map(([, p]) => p);
  let changed = false;
  // Bounded passes: each pass resolves every currently-overlapping dragged
  // node; a settled node may create a NEW overlap with another dragged
  // node's resolved spot, so re-scan until stable (maxSteps rings bound the
  // distance, this bounds the chain length).
  for (let pass = 0; pass < 4; pass += 1) {
    let anyMoved = false;
    for (const id of draggedIds) {
      const pos = positions.get(id);
      if (!pos) continue;
      const rest = others(id);
      if (!rest.some((o) => nodeBoxesOverlap(pos, o))) continue;
      let free = pos;
      for (let ring = 1; ring <= maxSteps; ring += 1) {
        let found: { x: number; y: number } | null = null;
        for (let dy = -ring; dy <= ring; dy += 1) {
          for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const p = { x: pos.x + dx * step, y: pos.y + dy * step };
            if (!rest.some((o) => nodeBoxesOverlap(p, o))) {
              found = p;
              break;
            }
          }
          if (found) break;
        }
        if (found) {
          free = found;
          break;
        }
      }
      if (free.x !== pos.x || free.y !== pos.y) {
        positions.set(id, free);
        changed = true;
        anyMoved = true;
      }
    }
    if (!anyMoved) break;
  }
  if (!changed) return null;
  return nodes.map((n) => ({
    id: n.id,
    x: positions.get(n.id)!.x,
    y: positions.get(n.id)!.y,
  }));
}
