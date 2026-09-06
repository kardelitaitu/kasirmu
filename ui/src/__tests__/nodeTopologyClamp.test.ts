/**
 * Unit tests for `nodeTopologyClamp.ts` — viewport clamping, edge auto-pan,
 * free-spawn-spot spiral scan, and overlap resolution for the topology editor.
 *
 * All functions are pure geometry; no DOM, hooks, or Tauri dependencies.
 */

import { describe, expect, it } from 'vitest';
import {
  clampNodeToViewport,
  edgeAutoPanDelta,
  findFreeSpawnSpot,
  findOverlappingNodeIds,
  nodeBoxesOverlap,
  resolveDropOverlaps,
} from '../features/locations/nodeTopologyClamp';

/* ── clampNodeToViewport ─────────────────────────────────────────── */

describe('clampNodeToViewport', () => {
  const opts = (canvasW: number, canvasH: number, panX = 0, panY = 0, zoom = 1) =>
    ({ canvasW, canvasH, panX, panY, zoom });

  it('returns the position unchanged when the canvas has no measured size', () => {
    expect(clampNodeToViewport(100, 200, opts(0, 800))).toEqual({ x: 100, y: 200 });
    expect(clampNodeToViewport(100, 200, opts(1200, 0))).toEqual({ x: 100, y: 200 });
  });

  it('keeps an already-visible node in place', () => {
    // At identity: node origin (100, 100) is inside [−200, 1200-40] × [−200, 800-40].
    expect(clampNodeToViewport(100, 100, opts(1200, 800))).toEqual({ x: 100, y: 100 });
  });

  it('clamps a node that would be pushed off the left edge', () => {
    // x = −300 < minX = (40 − 0)/1 − 240 = −200 → clamped to −200
    const result = clampNodeToViewport(-300, 100, opts(1200, 800));
    expect(result.x).toBe(-200);
    expect(result.y).toBe(100);
  });

  it('clamps a node that would be pushed off the right edge', () => {
    // x = 1300 > maxX = (1200 − 40 − 0)/1 = 1160 → clamped to 1160
    const result = clampNodeToViewport(1300, 100, opts(1200, 800));
    expect(result.x).toBe(1160);
    expect(result.y).toBe(100);
  });

  it('clamps a node that would be pushed off the top edge', () => {
    // y = −300 < minY = (40 − 0)/1 − 240 = −200 → clamped to −200
    const result = clampNodeToViewport(100, -300, opts(1200, 800));
    expect(result.y).toBe(-200);
    expect(result.x).toBe(100);
  });

  it('clamps a node that would be pushed off the bottom edge', () => {
    // y = 900 > maxY = (800 − 40 − 0)/1 = 760 → clamped to 760
    const result = clampNodeToViewport(100, 900, opts(1200, 800));
    expect(result.y).toBe(760);
    expect(result.x).toBe(100);
  });

  it('respects the pan offset when computing bounds', () => {
    // Pan 200px right: node's screen pos = pan + pos × zoom = 200 + pos.
    // minX = (40 − 200)/1 − 240 = −400; maxX = (1200 − 40 − 200)/1 = 960.
    // x = 1000 > 960 → clamped to 960.
    const result = clampNodeToViewport(1000, 100, opts(1200, 800, 200, 0));
    expect(result.x).toBe(960);
  });

  it('respects zoom when computing bounds', () => {
    // Zoom 2×: node's screen pos = 0 + pos × 2.
    // minX = (40 − 0)/2 − 240 = −220; maxX = (1200 − 40 − 0)/2 = 580.
    // x = 600 > 580 → clamped to 580.
    const result = clampNodeToViewport(600, 100, opts(1200, 800, 0, 0, 2));
    expect(result.x).toBe(580);
  });

  it('handles degenerate tiny canvas without NaNs', () => {
    const result = clampNodeToViewport(100, 100, opts(50, 50));
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

/* ── edgeAutoPanDelta ────────────────────────────────────────────── */

describe('edgeAutoPanDelta', () => {
  it('returns zero when the canvas has no measured size', () => {
    expect(edgeAutoPanDelta(10, 10, 0, 800)).toEqual({ dx: 0, dy: 0 });
    expect(edgeAutoPanDelta(10, 10, 1200, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('returns zero when the pointer is outside the canvas', () => {
    expect(edgeAutoPanDelta(-10, 100, 1200, 800)).toEqual({ dx: 0, dy: 0 });
    expect(edgeAutoPanDelta(100, -10, 1200, 800)).toEqual({ dx: 0, dy: 0 });
    expect(edgeAutoPanDelta(1300, 100, 1200, 800)).toEqual({ dx: 0, dy: 0 });
  });

  it('returns zero when the pointer is well inside the margin', () => {
    // Default margin 48, maxDelta 20. Pointer at (100, 100) on a 1200×800
    // canvas is well inside the inner zone: no auto-pan.
    expect(edgeAutoPanDelta(100, 100, 1200, 800)).toEqual({ dx: 0, dy: 0 });
  });

  it('pans left when the pointer is near the left edge', () => {
    // px = 10, margin = 48, maxDelta = 20. depth = −((48−10)/48) × 20 ≈ −15.8.
    // Exact: (48-10)/48 = 38/48 = 0.791666..., × 20 = 15.8333..., negated = −15.8333...
    const result = edgeAutoPanDelta(10, 400, 1200, 800);
    expect(result.dx).toBeCloseTo(-15.8333, 3);
    expect(result.dy).toBe(0);
  });

  it('pans right when the pointer is near the right edge', () => {
    // px = 1170, limit = 1200, margin = 48 → (1170 − (1200−48)) / 48 × 20 = 18/48×20 = 7.5
    const result = edgeAutoPanDelta(1170, 400, 1200, 800);
    expect(result.dx).toBeCloseTo(7.5, 3);
    expect(result.dy).toBe(0);
  });

  it('pans up when the pointer is near the top edge', () => {
    const result = edgeAutoPanDelta(400, 10, 1200, 800);
    expect(result.dy).toBeCloseTo(-15.8333, 3);
    expect(result.dx).toBe(0);
  });

  it('pans down when the pointer is near the bottom edge', () => {
    const result = edgeAutoPanDelta(400, 770, 1200, 800);
    expect(result.dy).toBeCloseTo(7.5, 3);
    expect(result.dx).toBe(0);
  });

  it('reaches the max delta at the very edge', () => {
    // px = 0 → depth = −((48−0)/48) × 20 = −20
    expect(edgeAutoPanDelta(0, 400, 1200, 800)).toEqual({ dx: -20, dy: 0 });
    // px = 1199 → depth = ((1199 − 1152) / 48) × 20 = 47/48 × 20 ≈ 19.58
    const result = edgeAutoPanDelta(1199, 400, 1200, 800);
    expect(result.dx).toBeCloseTo(19.5833, 3);
    expect(result.dy).toBe(0);
  });

  it('accepts custom margin and maxDelta', () => {
    // margin = 20, maxDelta = 10. px = 5 → depth = −((20−5)/20) × 10 = −7.5
    const result = edgeAutoPanDelta(5, 400, 1200, 800, { margin: 20, maxDelta: 10 });
    expect(result.dx).toBeCloseTo(-7.5, 3);
    expect(result.dy).toBe(0);
  });
});

/* ── nodeBoxesOverlap ────────────────────────────────────────────── */

describe('nodeBoxesOverlap', () => {
  it('returns true when two boxes overlap', () => {
    expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 200, y: 200 })).toBe(true);
  });

  it('returns false when boxes are separated', () => {
    expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 500, y: 500 })).toBe(false);
  });

  it('returns false when boxes are flush (zero gap — alignment landing)', () => {
    // Right edge of a (100, 100) = 340, left edge of b (340, 100) = 340.
    // Strict: a.x < b.x + NODE_WIDTH → 100 < 340 + 240 (true), AND
    // a.x + NODE_WIDTH > b.x → 340 > 340 (false, flush) → no overlap.
    expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 340, y: 100 })).toBe(false);
  });

  it('returns false when boxes are flush vertically', () => {
    // Bottom edge of a (100, 100) = 340, top edge of b (100, 340) = 340.
    expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 100, y: 340 })).toBe(false);
  });
});

/* ── findOverlappingNodeIds ──────────────────────────────────────── */

describe('findOverlappingNodeIds', () => {
  const n = (id: string, x: number, y: number) => ({ id, x, y });

  it('returns an empty set when no nodes overlap', () => {
    expect(findOverlappingNodeIds([n('a', 0, 0), n('b', 500, 500)])).toEqual(new Set());
  });

  it('returns both ids of an overlapping pair', () => {
    expect(findOverlappingNodeIds([n('a', 100, 100), n('b', 200, 200)])).toEqual(new Set(['a', 'b']));
  });

  it('returns all ids in a chain of overlaps', () => {
    // a overlaps b, b overlaps c, c overlaps d (a chain).
    const result = findOverlappingNodeIds([
      n('a', 0, 0),
      n('b', 200, 0),
      n('c', 400, 0),
      n('d', 600, 0),
      n('e', 1200, 1200),
    ]);
    // a, b, c, d overlap in a chain; e is isolated.
    expect(result).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('handles an empty node list', () => {
    expect(findOverlappingNodeIds([])).toEqual(new Set());
  });
});

/* ── findFreeSpawnSpot ───────────────────────────────────────────── */

describe('findFreeSpawnSpot', () => {
  const n = (x: number, y: number) => ({ x, y });
  const occupied = [n(0, 0), n(300, 300)];

  it('returns the start position when it is free', () => {
    expect(findFreeSpawnSpot({ x: 600, y: 600 }, occupied)).toEqual({ x: 600, y: 600 });
  });

  it('spirals outward until it finds a free spot', () => {
    // (0, 0) overlaps occupied[0] → spiral outward. The scan checks each
    // ring's perimeter in 24px steps and returns the first collision-free
    // cell; assert only the invariants (not the exact cell — the ring
    // ordering is an implementation detail).
    const spot = findFreeSpawnSpot({ x: 0, y: 0 }, occupied);
    expect(spot).not.toEqual({ x: 0, y: 0 });
    expect(nodeBoxesOverlap(spot, occupied[0]!)).toBe(false);
    expect(nodeBoxesOverlap(spot, occupied[1]!)).toBe(false);
  });

  it('returns a best-effort spot when no free position is found (ring limit)', () => {
    // Fill the entire searchable area — maxSteps 2 → only 2 rings (2×24=48px).
    // A single occupant at (0, 0) blocks the start and rings 1-2, so the
    // function falls back to the farthest corner reached: (48, 48).
    const spot = findFreeSpawnSpot({ x: 0, y: 0 }, [n(0, 0)], { maxSteps: 2 });
    expect(spot).toEqual({ x: 48, y: 48 });
  });
});

/* ── resolveDropOverlaps ─────────────────────────────────────────── */

describe('resolveDropOverlaps', () => {
  const n = (id: string, x: number, y: number) => ({ id, x, y });

  it('returns null when no dragged node overlaps any other node', () => {
    const nodes = [n('a', 0, 0), n('b', 500, 500)];
    expect(resolveDropOverlaps(nodes, new Set(['a']))).toBeNull();
  });

  it('resolves a single dragged node that overlaps a stationary node', () => {
    // a at (0, 0) overlaps b at (200, 200). a is dragged.
    const nodes = [n('a', 0, 0), n('b', 200, 200)];
    const result = resolveDropOverlaps(nodes, new Set(['a']));
    expect(result).not.toBeNull();
    // a should be settled somewhere that does not overlap b.
    const settled = result!.find((n) => n.id === 'a')!;
    expect(nodeBoxesOverlap(settled, nodes[1]!)).toBe(false);
    // b's position should be unchanged.
    const untouched = result!.find((n) => n.id === 'b')!;
    expect(untouched.x).toBe(200);
    expect(untouched.y).toBe(200);
  });

  it('resolves multiple dragged nodes that overlap each other', () => {
    // a and b both overlap — both are dragged.
    const nodes = [n('a', 0, 0), n('b', 100, 100)];
    const result = resolveDropOverlaps(nodes, new Set(['a', 'b']));
    expect(result).not.toBeNull();
    // Neither should overlap the other.
    const settledA = result!.find((n) => n.id === 'a')!;
    const settledB = result!.find((n) => n.id === 'b')!;
    expect(nodeBoxesOverlap(settledA, settledB)).toBe(false);
  });

  it('preserves flush-aligned nodes (zero-gap drag drop)', () => {
    // a at (0, 0) and b flush-right at (340, 0) — right edge of a = 340,
    // left edge of b = 340. NodeBoxesOverlap returns false for flush.
    const nodes = [n('a', 0, 0), n('b', 340, 0)];
    expect(resolveDropOverlaps(nodes, new Set(['a']))).toBeNull();
  });

  it('moves only the dragged node, not the stationary one', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0)]; // a and b stacked
    const result = resolveDropOverlaps(nodes, new Set(['a']))!;
    // b should stay at (0, 0).
    const settledB = result.find((n) => n.id === 'b')!;
    expect(settledB.x).toBe(0);
    expect(settledB.y).toBe(0);
  });

  it('handles an empty dragged set', () => {
    const nodes = [n('a', 0, 0), n('b', 100, 100)];
    expect(resolveDropOverlaps(nodes, new Set())).toBeNull();
  });

  it('converges within 4 passes for a chain of dragged nodes', () => {
    // Three nodes all near each other, all dragged. The iterative resolution
    // should converge without error.
    const nodes = [n('a', 0, 0), n('b', 50, 50), n('c', 100, 100)];
    const result = resolveDropOverlaps(nodes, new Set(['a', 'b', 'c']));
    expect(result).not.toBeNull();
    // Every pair should be non-overlapping.
    const settled = new Map(result!.map((n) => [n.id, n]));
    expect(nodeBoxesOverlap(settled.get('a')!, settled.get('b')!)).toBe(false);
    expect(nodeBoxesOverlap(settled.get('a')!, settled.get('c')!)).toBe(false);
    expect(nodeBoxesOverlap(settled.get('b')!, settled.get('c')!)).toBe(false);
  });
});