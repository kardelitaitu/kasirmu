import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../features/locations/nodeTopologyClamp';
import {
  cubicBezier,
  pointUnderCards,
  polylinePoint,
  wireUnderCardSegments,
} from '../features/locations/topologyWireGeometry';

/** A horizontal store→warehouse wire at port height (NODE_PORT_Y = 224). */
function horizontalWire(y = 140) {
  const x1 = 80 + NODE_WIDTH;
  const y1 = y + 224;
  const x2 = 680;
  const y2 = y + 224;
  const dx = Math.abs(x2 - x1) * 0.5;
  return { x1, y1, x2, y2, dx };
}

describe('wireUnderCardSegments', () => {
  it('returns the clipped segment when a bezier passes under a card', () => {
    // Store (80,140) → warehouse (680,140): the wire runs along y=364.
    // A middle card at (380,260) spans x∈[380,620], y∈[260,500] — the
    // wire crosses straight through it, so the overlay path must cover
    // that x-range at y=364.
    const d = wireUnderCardSegments(horizontalWire(), [{ x: 380, y: 260 }]);
    expect(d).not.toBe('');
    expect(d).toContain('364');
  });

  it('returns an empty string when the wire crosses no card', () => {
    // Same wire, but the only other card sits BELOW the wire's y-band.
    const d = wireUnderCardSegments(horizontalWire(), [{ x: 380, y: 420 }]);
    expect(d).toBe('');
  });

  it('clips an elbow polyline segment exactly to the box', () => {
    // Elbow route with a vertical jog at x=500 from y=216 to y=116 —
    // the jog drops through a card box at (380,80).
    const polyline: Array<[number, number]> = [
      [320, 216],
      [500, 216],
      [500, 116],
      [680, 116],
    ];
    const d = wireUnderCardSegments(
      { x1: 320, y1: 216, x2: 680, y2: 116, dx: 180, polyline },
      [{ x: 380, y: 80 }],
    );
    expect(d).not.toBe('');
    // The vertical segment is clipped to the box's y-range [80, 320]:
    // the overlay starts at y=116 (inside) and ends at y=216 (inside).
    expect(d).toContain('M 500 116 L 500 216');
  });

  it('returns nothing for a wire that runs along the box edge (flush, not under)', () => {
    // The card sits exactly above the wire line — the wire is never
    // under it, so nothing is overlaid (flush is not a crossing).
    const d = wireUnderCardSegments(horizontalWire(), [{ x: 380, y: 124 }]);
    expect(d).toBe('');
  });

  it('handles multiple boxes and keeps endpoint boxes out of the caller contract', () => {
    // Two unrelated cards on the path: both must contribute segments.
    const d = wireUnderCardSegments(horizontalWire(), [
      { x: 380, y: 260 },
      { x: 470, y: 260 },
    ]);
    expect(d).not.toBe('');
    // NODE_WIDTH boxes at x=380 and x=470: [380,620] and [470,710] —
    // segments start at 396.67 (first sample inside 380) and are clipped
    // per-box, so the path contains two M commands.
    expect(d.match(/M /g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('respects the real card dimensions via the shared constants', () => {
    expect(NODE_WIDTH).toBe(240);
    expect(NODE_HEIGHT).toBe(240);
  });
});

  describe('excludeIds', () => {
    it('skips boxes whose id is in the excludeIds set', () => {
      // A horizontal wire at y=364 passes through a card at (380,260)
      // [380,620]×[260,500]. When that card's id is excluded, the wire
      // should NOT produce an under-card segment — the exclusion works.
      const d = wireUnderCardSegments(
        horizontalWire(),
        [{ x: 380, y: 260, id: 'target-card' }],
        new Set(['target-card']),
      );
      expect(d).toBe('');
    });

    it('still clips boxes NOT in the excludeIds set', () => {
      // Two cards on the path: one excluded, one not. Only the non-excluded
      // card should contribute a segment.
      const d = wireUnderCardSegments(
        horizontalWire(),
        [
          { x: 380, y: 260, id: 'excluded' },
          { x: 470, y: 260, id: 'included' },
        ],
        new Set(['excluded']),
      );
      expect(d).not.toBe('');
      // Only one M command (one card contributes).
      expect(d.match(/M /g)?.length).toBe(1);
    });

    it('produces the same result as manual filtering when excludeIds is empty', () => {
      const boxes = [
        { x: 380, y: 260, id: 'a' },
        { x: 470, y: 260, id: 'b' },
      ];
      const filtered = boxes.filter((b) => !new Set<string>().has(b.id));
      const d1 = wireUnderCardSegments(horizontalWire(), filtered);
      const d2 = wireUnderCardSegments(horizontalWire(), boxes, new Set<string>());
      expect(d2).toBe(d1);
    });

    it('skips boxes without an id field (undefined id is never in the set)', () => {
      const d = wireUnderCardSegments(
        horizontalWire(),
        [{ x: 380, y: 260 }],
        new Set(['some-other-id']),
      );
      // The box has no id, so it is NOT excluded — segment should appear.
      expect(d).not.toBe('');
    });
  });

describe('pointUnderCards', () => {
  it('is true for a point inside a card box (strict interior)', () => {
    expect(pointUnderCards({ x: 500, y: 364 }, [{ x: 380, y: 260 }])).toBe(true);
  });

  it('is false for a point outside all boxes', () => {
    expect(pointUnderCards({ x: 100, y: 100 }, [{ x: 380, y: 260 }])).toBe(false);
  });

  it('is false for a point exactly on a card edge (flush)', () => {
    // The card spans [380,620]×[260,500]; a point on the right edge or the
    // bottom edge is flush, not under — the same strict-interior semantic
    // as the wire segments.
    expect(pointUnderCards({ x: 620, y: 364 }, [{ x: 380, y: 260 }])).toBe(false);
    expect(pointUnderCards({ x: 500, y: 500 }, [{ x: 380, y: 260 }])).toBe(false);
  });

  it('handles multiple boxes', () => {
    expect(pointUnderCards({ x: 500, y: 364 }, [{ x: 80, y: 140 }, { x: 380, y: 260 }])).toBe(true);
  });
});

/* ── polylinePoint ───────────────────────────────────────────────── */

describe('polylinePoint', () => {
  it('returns the first point for fewer than 2 vertices', () => {
    expect(polylinePoint([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(polylinePoint([[10, 20]], 0.5)).toEqual({ x: 10, y: 20 });
  });

  it('returns the first vertex at t=0', () => {
    expect(polylinePoint([[10, 20], [50, 80]], 0)).toEqual({ x: 10, y: 20 });
  });

  it('returns the last vertex at t=1', () => {
    expect(polylinePoint([[10, 20], [50, 80]], 1)).toEqual({ x: 50, y: 80 });
  });

  it('interpolates along a single horizontal segment weighted by Manhattan distance', () => {
    // Horizontal segment 40px long. t=0.5 → halfway = 10 + 20 = 30.
    expect(polylinePoint([[10, 20], [50, 20]], 0.5)).toEqual({ x: 30, y: 20 });
  });

  it('interpolates along a single vertical segment', () => {
    // Vertical segment 60px long. t=0.5 → halfway = 20 + 30 = 50.
    expect(polylinePoint([[10, 20], [10, 80]], 0.5)).toEqual({ x: 10, y: 50 });
  });

  it('distributes t across unequal segments by Manhattan length', () => {
    // Two segments: (0,0)→(0, 100) = 100px, then (0,100)→(100,100) = 100px.
    // Total = 200. t=0.25 → 25% of 200 = 50px → halfway through first segment
    // (0, 50). t=0.75 → 75% of 200 = 150px → 100 + 50 = halfway through second
    // segment (50, 100).
    const pts: Array<[number, number]> = [[0, 0], [0, 100], [100, 100]];
    expect(polylinePoint(pts, 0.25)).toEqual({ x: 0, y: 50 });
    expect(polylinePoint(pts, 0.75)).toEqual({ x: 50, y: 100 });
  });

  it('handles a degenerate polyline (all points the same)', () => {
    const pts: Array<[number, number]> = [[10, 20], [10, 20], [10, 20]];
    expect(polylinePoint(pts, 0)).toEqual({ x: 10, y: 20 });
    expect(polylinePoint(pts, 0.5)).toEqual({ x: 10, y: 20 });
    expect(polylinePoint(pts, 1)).toEqual({ x: 10, y: 20 });
  });

  it('clamps the last segment boundary at the total length', () => {
    // Single segment: total = 100. t=0.99 → 99px → (0 + 99/100 * 100, 0) = (99, 0).
    expect(polylinePoint([[0, 0], [100, 0]], 0.99)).toEqual({ x: 99, y: 0 });
  });
});

/* ── cubicBezier ─────────────────────────────────────────────────── */

describe('cubicBezier', () => {
  it('returns p0 at t=0', () => {
    expect(cubicBezier(0, 10, 30, 50, 200)).toBe(10);
  });

  it('returns p3 at t=1', () => {
    expect(cubicBezier(1, 10, 30, 50, 200)).toBe(200);
  });

  it('evaluates the midpoint correctly', () => {
    // (p0 + 3p1 + 3p2 + p3) / 8 = (10 + 90 + 150 + 200) / 8 = 450/8 = 56.25
    expect(cubicBezier(0.5, 10, 30, 50, 200)).toBeCloseTo(56.25, 5);
  });

  it('is constant when all control points are equal', () => {
    expect(cubicBezier(0, 42, 42, 42, 42)).toBe(42);
    expect(cubicBezier(0.5, 42, 42, 42, 42)).toBe(42);
    expect(cubicBezier(1, 42, 42, 42, 42)).toBe(42);
  });

  it('interpolates at t=0.25', () => {
    // u = 0.75: u³·p0 + 3u²t·p1 + 3ut²·p2 + t³·p3
    // = 0.421875·0 + 3·0.5625·0.25·0 + 3·0.75·0.0625·0 + 0.015625·100
    // = 1.5625
    expect(cubicBezier(0.25, 0, 0, 0, 100)).toBeCloseTo(1.5625, 4);
  });

  it('interpolates at t=0.75', () => {
    // u = 0.25: u³·p0 + 3u²t·p1 + 3ut²·p2 + t³·p3
    // = 0.015625·0 + 3·0.0625·0.75·0 + 3·0.25·0.5625·100 + 0.421875·100
    // = 42.1875 + 42.1875 = 84.375. NOTE: (0, 0, 100, 100) is NOT a
    // straight line — a linear ramp needs p1 = 33⅓ and p2 = 66⅔.
    expect(cubicBezier(0.75, 0, 0, 100, 100)).toBeCloseTo(84.375, 5);
  });

  it('evaluates the linear-ramp control set exactly', () => {
    // p0 = 0, p1 = 33⅓, p2 = 66⅔, p3 = 100 → the curve IS the line y = 100t.
    expect(cubicBezier(0.25, 0, 100 / 3, 200 / 3, 100)).toBeCloseTo(25, 4);
    expect(cubicBezier(0.5, 0, 100 / 3, 200 / 3, 100)).toBeCloseTo(50, 4);
    expect(cubicBezier(0.75, 0, 100 / 3, 200 / 3, 100)).toBeCloseTo(75, 4);
  });
});
