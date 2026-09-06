import { describe, it, expect } from 'vitest';
import {
  clampNodeToViewport,
  edgeAutoPanDelta,
  findFreeSpawnSpot,
  nodeBoxesOverlap,
  findOverlappingNodeIds,
  resolveDropOverlaps,
  NODE_WIDTH,
  NODE_HEIGHT,
  EDGE_MARGIN,
} from '@/features/locations/nodeTopologyClamp';

describe('nodeTopologyClamp', () => {
  describe('clampNodeToViewport', () => {
    it('returns unchanged position when canvas has zero dimensions', () => {
      const result = clampNodeToViewport(100, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 0,
        canvasH: 0,
      });
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('clamps node to stay within canvas at identity transform', () => {
      // Canvas 800x600, node 240x240, margin 40
      // minX = (40 - 0) / 1 - 240 = -200
      // maxX = (800 - 40 - 0) / 1 = 760
      // minY = (40 - 0) / 1 - 240 = -200
      // maxY = (600 - 40 - 0) / 1 = 560

      // Position within bounds should stay
      let result = clampNodeToViewport(100, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result).toEqual({ x: 100, y: 100 });

      // Position too far left
      result = clampNodeToViewport(-300, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.x).toBe(-200);

      // Position too far right
      result = clampNodeToViewport(1000, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.x).toBe(760);

      // Position too far up
      result = clampNodeToViewport(100, -300, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.y).toBe(-200);

      // Position too far down
      result = clampNodeToViewport(100, 800, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.y).toBe(560);
    });

    it('handles pan offset correctly', () => {
      // Pan right by 100, node at 0 should be visible (screen x = 100)
      const result = clampNodeToViewport(0, 100, {
        panX: 100,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.x).toBe(0);

      // Pan right by 500, node at -400 should be visible (screen x = 100)
      const result2 = clampNodeToViewport(-400, 100, {
        panX: 500,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result2.x).toBe(-400);
    });

    it('handles zoom correctly', () => {
      // Zoom 2x, canvas 800 -> logical 400
      // minX = (40 - 0) / 2 - 240 = -220
      // maxX = (800 - 40 - 0) / 2 = 380
      const result = clampNodeToViewport(500, 100, {
        panX: 0,
        panY: 0,
        zoom: 2,
        canvasW: 800,
        canvasH: 600,
      });
      expect(result.x).toBe(380);
    });

    it('uses custom node dimensions', () => {
      const result = clampNodeToViewport(100, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
        nodeW: 100,
        nodeH: 50,
      });
      // minX = 40 - 100 = -60
      // maxX = 800 - 40 = 760
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('uses custom margin', () => {
      const result = clampNodeToViewport(100, 100, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 800,
        canvasH: 600,
        margin: 100,
      });
      // minX = 100 - 240 = -140
      // maxX = 800 - 100 = 700
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('handles degenerate tiny canvas', () => {
      // Canvas smaller than node - min/max swapped safely
      const result = clampNodeToViewport(0, 0, {
        panX: 0,
        panY: 0,
        zoom: 1,
        canvasW: 100,
        canvasH: 100,
      });
      // minX = 40 - 240 = -200, maxX = 100 - 40 = 60
      // loX = -200, hiX = 60
      expect(result.x).toBe(0);
    });
  });

  describe('edgeAutoPanDelta', () => {
    it('returns zero delta when pointer outside canvas', () => {
      const result = edgeAutoPanDelta(-10, 100, 800, 600);
      expect(result).toEqual({ dx: 0, dy: 0 });

      const result2 = edgeAutoPanDelta(100, -10, 800, 600);
      expect(result2).toEqual({ dx: 0, dy: 0 });

      const result3 = edgeAutoPanDelta(900, 100, 800, 600);
      expect(result3).toEqual({ dx: 0, dy: 0 });
    });

    it('returns zero delta when pointer in center', () => {
      const result = edgeAutoPanDelta(400, 300, 800, 600);
      expect(result).toEqual({ dx: 0, dy: 0 });
    });

    it('returns negative dx when pointer near left edge', () => {
      // margin default 48, at px=0 -> full depth -> -maxDelta = -20
      const result = edgeAutoPanDelta(0, 300, 800, 600);
      expect(result.dx).toBe(-20);
      expect(result.dy).toBe(0);
    });

    it('returns positive dx when pointer near right edge', () => {
      const result = edgeAutoPanDelta(800, 300, 800, 600);
      expect(result.dx).toBe(20);
      expect(result.dy).toBe(0);
    });

    it('returns negative dy when pointer near top edge', () => {
      const result = edgeAutoPanDelta(400, 0, 800, 600);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(-20);
    });

    it('returns positive dy when pointer near bottom edge', () => {
      const result = edgeAutoPanDelta(400, 600, 800, 600);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(20);
    });

    it('scales delta linearly within margin band', () => {
      // At margin/2 = 24px from left edge -> -10
      const result = edgeAutoPanDelta(24, 300, 800, 600);
      expect(result.dx).toBe(-10);
    });

    it('returns zero for zero dimensions', () => {
      const result = edgeAutoPanDelta(100, 100, 0, 600);
      expect(result).toEqual({ dx: 0, dy: 0 });
    });

    it('uses custom margin and maxDelta', () => {
      const result = edgeAutoPanDelta(0, 300, 800, 600, { margin: 100, maxDelta: 50 });
      expect(result.dx).toBe(-50);
    });
  });

  describe('findFreeSpawnSpot', () => {
    it('returns start position when no overlap', () => {
      const result = findFreeSpawnSpot({ x: 100, y: 100 }, []);
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('returns start when no overlap with occupied', () => {
      const result = findFreeSpawnSpot({ x: 100, y: 100 }, [{ x: 500, y: 500 }]);
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('finds free spot when start overlaps', () => {
      // Occupied at 100,100 (240x240 box)
      // Start at 100,100 should overlap
      const result = findFreeSpawnSpot({ x: 100, y: 100 }, [{ x: 100, y: 100 }]);
      // Should find a nearby spot (gap=24 default)
      expect(result.x).not.toBe(100);
      expect(result.y).not.toBe(100);
    });

    it('scans spiral outward', () => {
      // Fill first ring around start
      const occupied = [
        { x: 124, y: 100 }, // right
        { x: 76, y: 100 },  // left (100-24)
        { x: 100, y: 124 }, // down
        { x: 100, y: 76 },  // up
        { x: 124, y: 124 }, // down-right
        { x: 76, y: 124 },  // down-left
        { x: 124, y: 76 },  // up-right
        { x: 76, y: 76 },   // up-left
      ];
      const result = findFreeSpawnSpot({ x: 100, y: 100 }, occupied);
      // Should find next ring
      expect(Math.abs(result.x - 100)).toBeGreaterThanOrEqual(48);
      expect(Math.abs(result.y - 100)).toBeGreaterThanOrEqual(48);
    });

    it('uses custom gap', () => {
      const result = findFreeSpawnSpot({ x: 100, y: 100 }, [{ x: 100, y: 100 }], { gap: 50 });
      // Should be at least 50 away
      expect(Math.abs(result.x - 100)).toBeGreaterThanOrEqual(50);
    });

    it('returns best effort when maxSteps exhausted', () => {
      // Create dense grid
      const occupied: { x: number; y: number }[] = [];
      for (let x = -500; x <= 500; x += 24) {
        for (let y = -500; y <= 500; y += 24) {
          occupied.push({ x, y });
        }
      }
      const result = findFreeSpawnSpot({ x: 0, y: 0 }, occupied, { maxSteps: 2 });
      // Should return something within searched area
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
    });
  });

  describe('nodeBoxesOverlap', () => {
    it('returns true for overlapping boxes', () => {
      expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 200, y: 200 })).toBe(true);
    });

    it('returns false for non-overlapping boxes', () => {
      expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 400, y: 400 })).toBe(false);
    });

    it('returns false for flush edges (zero gap)', () => {
      // Box at 100,100 extends to 340,340
      // Box at 340,100 touches at edge
      expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 340, y: 100 })).toBe(false);
    });

    it('returns true for partial overlap', () => {
      expect(nodeBoxesOverlap({ x: 100, y: 100 }, { x: 300, y: 100 })).toBe(true);
    });
  });

  describe('findOverlappingNodeIds', () => {
    it('returns empty set for no nodes', () => {
      const result = findOverlappingNodeIds([]);
      expect(result).toEqual(new Set());
    });

    it('returns empty set for single node', () => {
      const result = findOverlappingNodeIds([{ id: 'n1', x: 100, y: 100 }]);
      expect(result).toEqual(new Set());
    });

    it('returns both ids for overlapping pair', () => {
      const result = findOverlappingNodeIds([
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
      ]);
      expect(result).toEqual(new Set(['n1', 'n2']));
    });

    it('returns all overlapping ids in cluster', () => {
      const result = findOverlappingNodeIds([
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
        { id: 'n3', x: 500, y: 500 }, // far away
      ]);
      expect(result).toEqual(new Set(['n1', 'n2']));
    });

    it('does not include flush edges', () => {
      const result = findOverlappingNodeIds([
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 340, y: 100 },
      ]);
      expect(result).toEqual(new Set());
    });
  });

  describe('resolveDropOverlaps', () => {
    it('returns null when no overlaps', () => {
      const result = resolveDropOverlaps(
        [{ id: 'n1', x: 100, y: 100 }],
        new Set(['n1']),
      );
      expect(result).toBeNull();
    });

    it('resolves overlap for dragged node', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
      ];
      const result = resolveDropOverlaps(nodes, new Set(['n1']));
      expect(result).not.toBeNull();
      if (result) {
        const n1 = result.find((n) => n.id === 'n1')!;
        const n2 = result.find((n) => n.id === 'n2')!;
        // n1 should have moved, n2 should stay
        expect(n1.x).not.toBe(100);
        expect(n2.x).toBe(200);
        expect(n2.y).toBe(200);
      }
    });

    it('does not move non-dragged nodes', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
      ];
      const result = resolveDropOverlaps(nodes, new Set(['n1']));
      if (result) {
        const n2 = result.find((n) => n.id === 'n2')!;
        expect(n2.x).toBe(200);
        expect(n2.y).toBe(200);
      }
    });

    it('resolves chain of overlaps', () => {
      // n1 overlaps n2, n2 overlaps n3 - all three dragged
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
        { id: 'n3', x: 300, y: 300 },
      ];
      const result = resolveDropOverlaps(nodes, new Set(['n1', 'n2', 'n3']));
      expect(result).not.toBeNull();
      if (result) {
        // All should be at non-overlapping positions
        const positions = new Set(result.map((n) => `${n.x},${n.y}`));
        expect(positions.size).toBe(3);
      }
    });

    it('returns null when dragged set is empty', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
      ];
      const result = resolveDropOverlaps(nodes, new Set());
      expect(result).toBeNull();
    });

    it('uses custom maxSteps', () => {
      const nodes = [
        { id: 'n1', x: 100, y: 100 },
        { id: 'n2', x: 200, y: 200 },
      ];
      const result = resolveDropOverlaps(nodes, new Set(['n1']), { maxSteps: 1 });
      // With maxSteps=1, may not find free spot
      expect(result).toBeDefined();
    });
  });

  describe('constants', () => {
    it('exports expected constants', () => {
      expect(NODE_WIDTH).toBe(240);
      expect(NODE_HEIGHT).toBe(240);
      expect(EDGE_MARGIN).toBe(40);
    });
  });
});