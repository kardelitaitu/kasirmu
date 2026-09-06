// Layered wire-direction layout engine for the topology editor.
//
// Auto-layout reorganizes a tangled diagram into ranked columns: sources
// (nodes nothing points to) rank 0, each wire target ranks one deeper via
// BFS, and every rank occupies a column with rows stacked in prior-y
// order. The result is translated so its bounding-box midpoint matches the
// original diagram's — the diagram reorganizes in place instead of
// sliding across the canvas. Pure and unit-testable; the editor's
// autoLayout callback is a thin wrapper around this (history, bend
// clearing, the live announcement).
import { NODE_HEIGHT, NODE_WIDTH } from './nodeTopologyClamp';

/** Canvas-space gap between layout columns (2⅔ grid steps). */
export const LAYOUT_GAP_X = 64;
/** Canvas-space gap between layout rows (2 grid steps). */
export const LAYOUT_GAP_Y = 48;
/** Extra canvas-space gap between forest bands (4 grid steps) so
 *  independent trees read as separate diagrams, not one deep chain. */
export const LAYOUT_COMPONENT_GAP = 96;
/** The grid lattice the editor snaps interactive placement to. */
export const LAYOUT_GRID = 24;

/** Minimal node shape the engine needs (id + current position). */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

/** Minimal wire shape — direction is implicit: from ranks before to. */
export interface LayoutWire {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

/** A placed node position (final canvas coordinates, anchored in place). */
export interface NodePlacement {
  id: string;
  x: number;
  y: number;
}

export interface AutoLayoutOptions {
  /** Snap every placement to the 24px grid. Elbow-routed wires are
   *  orthogonal, so they only look clean when the cards sit on the
   *  lattice; the editor passes this when snap is enabled AND the routing
   *  toggle is elbow. Curved routing keeps the free-floating anchor math. */
  snapToGrid?: boolean;
}

export function computeAutoLayout(
  nodes: LayoutNode[],
  wires: LayoutWire[],
  options: AutoLayoutOptions = {},
): NodePlacement[] {
  if (nodes.length === 0) return [];

  // Rank by BFS along wire direction from the sources (nodes nothing
  // points to). Cycles keep their first-seen rank; a node never reached
  // (a pure cycle) falls back to rank 0.
  const rank = new Map<string, number>();
  const frontier = nodes.filter((n) => !wires.some((w) => w.toNodeId === n.id)).map((n) => n.id);
  for (const id of frontier) rank.set(id, 0);
  let depth = 0;
  let current = frontier;
  while (current.length > 0 && depth < nodes.length) {
    const next: string[] = [];
    for (const id of current) {
      for (const w of wires) {
        if (w.fromNodeId === id && !rank.has(w.toNodeId)) {
          rank.set(w.toNodeId, depth + 1);
          next.push(w.toNodeId);
        }
      }
    }
    current = next;
    depth += 1;
  }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

  // Anchor: keep the placed bounding-box midpoint on the ORIGINAL one so
  // the layout reorganizes in place. Both midpoints use node origins —
  // for uniform boxes that equals the box-center midpoint (the same W/2
  // term cancels on both sides), and a single node stays exactly put.
  const midOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
  const oldCx = midOf(nodes.map((n) => n.x));
  const oldCy = midOf(nodes.map((n) => n.y));

  // Forest bands: split the graph into undirected wire-connected
  // components, then lay each component out in its OWN column band
  // (side-by-side) instead of pushing every source into column 0 and
  // stacking independent trees on top of each other. Converging roots
  // (multiple sources feeding one target) share a component, so they stay
  // in one band. The bands follow the diagram's left-to-right reading
  // order (each component's current min-x), preserving where the user
  // drew each tree.
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const w of wires) {
    adjacency.get(w.fromNodeId)?.push(w.toNodeId);
    adjacency.get(w.toNodeId)?.push(w.fromNodeId);
  }
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const n of nodes) {
    if (componentOf.has(n.id)) continue;
    const stack = [n.id];
    componentOf.set(n.id, componentCount);
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const next of adjacency.get(id) ?? []) {
        if (!componentOf.has(next)) {
          componentOf.set(next, componentCount);
          stack.push(next);
        }
      }
    }
    componentCount += 1;
  }
  const nodesByComponent = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const c = componentOf.get(n.id)!;
    const list = nodesByComponent.get(c) ?? [];
    list.push(n);
    nodesByComponent.set(c, list);
  }
  const componentOrder = [...nodesByComponent.keys()].sort((a, b) => {
    const minX = (c: number) => Math.min(...nodesByComponent.get(c)!.map((n) => n.x));
    return minX(a) - minX(b);
  });

  // Place each component's ranks in columns; rows stack in prior-y order so
  // cards keep their relative reading order within a (component, rank).
  const placed: NodePlacement[] = [];
  let bandX = 0;
  for (const c of componentOrder) {
    const compNodes = nodesByComponent.get(c)!;
    const maxRank = Math.max(...compNodes.map((n) => rank.get(n.id)!));
    const byRank = new Map<number, LayoutNode[]>();
    for (const n of compNodes) {
      const r = rank.get(n.id)!;
      const col = byRank.get(r) ?? [];
      col.push(n);
      byRank.set(r, col);
    }
    for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
      const col = byRank.get(r)!;
      col.sort((a, b) => a.y - b.y);
      const colX = bandX + r * (NODE_WIDTH + LAYOUT_GAP_X);
      col.forEach((n, i) => placed.push({ id: n.id, x: colX, y: i * (NODE_HEIGHT + LAYOUT_GAP_Y) }));
    }
    bandX += (maxRank + 1) * (NODE_WIDTH + LAYOUT_GAP_X) + LAYOUT_COMPONENT_GAP;
  }
  const dx = oldCx - midOf(placed.map((p) => p.x));
  const dy = oldCy - midOf(placed.map((p) => p.y));
  const snapTo = (v: number) => Math.round(v / LAYOUT_GRID) * LAYOUT_GRID;
  return placed.map((p) => {
    const x = Math.round(p.x + dx);
    const y = Math.round(p.y + dy);
    return options.snapToGrid
      ? { id: p.id, x: snapTo(x), y: snapTo(y) }
      : { id: p.id, x, y };
  });
}
