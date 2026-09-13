/** Pure wire-path geometry shared by the canvas wire layer and the
 *  in-flight preview/ghost math. Kept OUT of the component file so
 *  react-refresh only sees component exports there. */

import { NODE_HEIGHT, NODE_WIDTH } from './nodeTopologyClamp';

/**
 * True when a point lies strictly inside any of the given card boxes
 * (round 147). The strict-interior semantic mirrors the wire segments:
 * a point exactly on an edge is flush, never under. The wire's own
 * endpoint cards must be excluded by the caller (ports sit on the edge).
 */
export function pointUnderCards(
  pt: { x: number; y: number },
  boxes: Array<{ x: number; y: number }>,
): boolean {
  return boxes.some((b) => (
    pt.x > b.x
    && pt.x < b.x + NODE_WIDTH
    && pt.y > b.y
    && pt.y < b.y + NODE_HEIGHT
  ));
}

/**
 * SVG sub-paths of a wire that pass UNDER an unrelated node card (round 146).
 *
 * Wires render beneath the cards, so a wire crossing a card it does not
 * connect to disappears under the card and re-emerges as two visually
 * broken pieces. The editor draws these hidden segments in a second,
 * pointer-events-none layer ON TOP of the cards so the wire reads as one
 * continuous connection. `boxes` must be the OTHER cards' top-lefts (the
 * wire's own endpoint nodes are excluded by the caller — ports sit exactly
 * on the box edge, so an included endpoint box would false-positive).
 *
 * - Polyline wires (elbow routing / authored bends) are axis-aligned:
 *   each H/V segment is clipped exactly against each box (convex).
 * - Bezier wires are sampled at 24 points; maximal runs of consecutive
 *   in-box samples become polylines. Both endpoints of a chord lie inside
 *   the same convex box, so the chord stays in-box. Sampling is invisible
 *   at a 3px stroke. Returns '' when nothing crosses.
 */
export function wireUnderCardSegments(
  geo: {
    x1: number; y1: number; x2: number; y2: number; dx: number;
    polyline?: Array<[number, number]>;
  },
  boxes: Array<{ x: number; y: number; id?: string }>,
  /** When provided, boxes whose `id` is in this set are skipped — avoids
   *  the caller allocating a per-wire filtered array (OOM hot path). */
  excludeIds?: Set<string>,
): string {
  // Combined filter+map in one pass: avoids a per-wire O(N) filtered-array
  // allocation that was the primary OOM hot path during drag.
  const rects: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  for (const b of boxes) {
    if (excludeIds && b.id && excludeIds.has(b.id)) continue;
    rects.push({
      left: b.x,
      right: b.x + NODE_WIDTH,
      top: b.y,
      bottom: b.y + NODE_HEIGHT,
    });
  }
  const paths: string[] = [];
  if (geo.polyline) {
    for (const r of rects) {
      for (let i = 1; i < geo.polyline.length; i += 1) {
        const [ax, ay] = geo.polyline[i - 1]!;
        const [bx, by] = geo.polyline[i]!;
        // Axis-aligned segment: at most one contiguous inside sub-segment.
        let ix1: number | null = null;
        let iy1: number | null = null;
        let ix2: number | null = null;
        let iy2: number | null = null;
        // STRICT interior (round-140/141 semantics: flush is not an
        // overlap) — a wire running exactly along a card edge is visible
        // and must not be overlaid.
        if (ay === by) {
          if (ay > r.top && ay < r.bottom) {
            const lo = Math.max(Math.min(ax, bx), r.left);
            const hi = Math.min(Math.max(ax, bx), r.right);
            if (hi > lo) { ix1 = lo; ix2 = hi; iy1 = ay; iy2 = ay; }
          }
        } else if (ax === bx) {
          if (ax > r.left && ax < r.right) {
            const lo = Math.max(Math.min(ay, by), r.top);
            const hi = Math.min(Math.max(ay, by), r.bottom);
            if (hi > lo) { iy1 = lo; iy2 = hi; ix1 = ax; ix2 = ax; }
          }
        }
        if (ix1 !== null && ix2 !== null && iy1 !== null && iy2 !== null) {
          paths.push(`M ${ix1} ${iy1} L ${ix2} ${iy2}`);
        }
      }
    }
    return paths.join(' ');
  }
  const SAMPLES = 24;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const t = i / SAMPLES;
    pts.push([
      cubicBezier(t, geo.x1, geo.x1 + geo.dx, geo.x2 - geo.dx, geo.x2),
      cubicBezier(t, geo.y1, geo.y1, geo.y2, geo.y2),
    ]);
  }
  for (const r of rects) {
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= 2) {
        paths.push(
          `M ${run[0]![0]} ${run[0]![1]} ${run
            .slice(1)
            .map(([px, py]) => `L ${px} ${py}`)
            .join(' ')}`,
        );
      }
      run = [];
    };
    for (const [px, py] of pts) {
      // Strict interior: a sample exactly on the edge is a flush touch,
      // never an under-card segment.
      const inside = px > r.left && px < r.right && py > r.top && py < r.bottom;
      if (inside) run.push([px, py]);
      else flush();
    }
    flush();
  }
  return paths.join(' ');
}

/** Point at fraction `t` along a polyline, weighted by Manhattan segment
 *  length so a simulation pulse crosses each segment at constant speed
 *  (matching the authored-bend visuals, where bends are always drawn as
 *  straight L segments). */
export function polylinePoint(pts: Array<[number, number]>, t: number): { x: number; y: number } {
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.abs(pts[i]![0] - pts[i - 1]![0]) + Math.abs(pts[i]![1] - pts[i - 1]![1]);
  }
  if (total <= 0) return { x: pts[0]![0], y: pts[0]![1] };
  const target = t * total;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.abs(pts[i]![0] - pts[i - 1]![0]) + Math.abs(pts[i]![1] - pts[i - 1]![1]);
    if (acc + seg >= target || i === pts.length - 1) {
      const frac = seg === 0 ? 0 : (target - acc) / seg;
      return {
        x: pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * frac,
        y: pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * frac,
      };
    }
    acc += seg;
  }
  return { x: pts[pts.length - 1]![0], y: pts[pts.length - 1]![1] };
}

/** Cubic Bézier interpolation (unbent wires' default curve). */
export function cubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
