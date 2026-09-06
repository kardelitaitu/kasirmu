/**
 * Unit tests for the module-scope pure helpers in `NodeTopologyEditor.tsx`.
 *
 * The editor component is a 6.5k-line surface; its pure, side-effect-free
 * helpers (port normalization, wire geometry, alignment guides, overflow
 * detection, error classification, motion preference, and the Apply-gate
 * validation wrapper) were previously module-private and untested. They are
 * exported solely for these tests (same precedent as `canvasStateEqual`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { TopologyNodeData, TopologyWireData } from '../features/locations/NodeTopologyEditor';
import {
  computeAlignmentGuides,
  diagramOverflowsCanvas,
  elbowPoints,
  isTopologyRevisionConflict,
  normalizeVisualPort,
  polylineD,
  prefersReducedMotion,
  validateEditorGraph,
} from '../features/locations/NodeTopologyEditor';

/* ── normalizeVisualPort ─────────────────────────────────────────── */

describe('normalizeVisualPort', () => {
  it('maps legacy top anchor to the fallback side', () => {
    expect(normalizeVisualPort('top', 'left')).toBe('left');
    expect(normalizeVisualPort('top', 'right')).toBe('right');
  });

  it('maps legacy bottom anchor to the fallback side', () => {
    expect(normalizeVisualPort('bottom', 'left')).toBe('left');
    expect(normalizeVisualPort('bottom', 'right')).toBe('right');
  });

  it('passes canonical left/right anchors through unchanged', () => {
    expect(normalizeVisualPort('left', 'right')).toBe('left');
    expect(normalizeVisualPort('right', 'left')).toBe('right');
  });

  it('falls back for null, undefined, and unknown values', () => {
    expect(normalizeVisualPort(null, 'left')).toBe('left');
    expect(normalizeVisualPort(undefined, 'right')).toBe('right');
    expect(normalizeVisualPort('diagonal', 'left')).toBe('left');
  });
});

/* ── elbowPoints ─────────────────────────────────────────────────── */

describe('elbowPoints', () => {
  it('routes forward flows through the horizontal midpoint', () => {
    // Target to the right: run to (x1+x2)/2, drop, then run into the target.
    expect(elbowPoints(0, 0, 100, 50)).toEqual([
      [0, 0],
      [50, 0],
      [50, 50],
      [100, 50],
    ]);
  });

  it('handles a target directly below/above (same x) as forward', () => {
    const pts = elbowPoints(40, 0, 40, 120);
    expect(pts[0]).toEqual([40, 0]);
    expect(pts[1]).toEqual([40, 0]);
    expect(pts[2]).toEqual([40, 120]);
    expect(pts[3]).toEqual([40, 120]);
  });

  it('detours past the source when the target sits behind it', () => {
    // Target behind: detour 48px right of the source before dropping, so
    // the elbow never folds back through the source card.
    expect(elbowPoints(100, 10, 20, 90)).toEqual([
      [100, 10],
      [148, 10],
      [148, 90],
      [20, 90],
    ]);
  });

  it('always returns exactly four vertices', () => {
    for (const [x1, y1, x2, y2] of [
      [0, 0, 10, 10],
      [10, 5, 0, 5],
      [-20, -20, 20, 20],
      [50, 50, 50, 50],
    ] as Array<[number, number, number, number]>) {
      expect(elbowPoints(x1, y1, x2, y2)).toHaveLength(4);
    }
  });
});

/* ── polylineD ───────────────────────────────────────────────────── */

describe('polylineD', () => {
  it('returns an empty path for no vertices', () => {
    expect(polylineD([])).toBe('');
  });

  it('emits an M command for a single vertex (trailing space pinned)', () => {
    // The implementation joins the (empty) L-segment array, leaving one
    // trailing space after the M command — harmless for SVG parsing, so the
    // test pins the exact current output to catch accidental changes.
    expect(polylineD([[10, 20]])).toBe('M 10 20 ');
  });

  it('emits M followed by L commands for a polyline', () => {
    expect(polylineD([[0, 0], [50, 0], [50, 50], [100, 50]])).toBe(
      'M 0 0 L 50 0 L 50 50 L 100 50',
    );
  });

  it('round-trips negative coordinates', () => {
    expect(polylineD([[-5, -5], [0, 10]])).toBe('M -5 -5 L 0 10');
  });
});

/* ── computeAlignmentGuides ──────────────────────────────────────── */

/** Node cards are NODE_WIDTH x NODE_HEIGHT = 240x240; edges/centers are
 *  computed from those constants (not passed in). */

const node = (id: string, x: number, y: number): TopologyNodeData =>
  ({ id, type: 'workspace' as const, name: id, x, y });

describe('computeAlignmentGuides', () => {
  it('returns all-false when there is nothing to align against', () => {
    // One dragged node, no stationary reference nodes.
    const targets = new Map([['n-1', { x: 100, y: 100 }]]);
    const result = computeAlignmentGuides(targets, new Set(['n-1']), [node('n-1', 100, 100)]);
    expect(result.alignedX).toBe(false);
    expect(result.alignedY).toBe(false);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.x).toBeUndefined();
    expect(result.y).toBeUndefined();
  });

  it('aligns an exact left-edge match with zero delta', () => {
    const targets = new Map([['n-1', { x: 100, y: 500 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 100, 500), node('n-2', 100, 50)],
    );
    expect(result.alignedX).toBe(true);
    expect(result.x).toBe(100);
    expect(result.dx).toBe(0);
    // Different rows: no y alignment.
    expect(result.alignedY).toBe(false);
    expect(result.dy).toBe(0);
  });

  it('aligns a near miss within the 6px threshold and reports the delta', () => {
    // Dragged left edge at 103 vs stationary left edge at 100 → dx = 3.
    const targets = new Map([['n-1', { x: 103, y: 500 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 103, 500), node('n-2', 100, 50)],
    );
    expect(result.alignedX).toBe(true);
    expect(result.x).toBe(100);
    expect(result.dx).toBe(3);
  });

  it('ignores matches beyond the 6px threshold', () => {
    const targets = new Map([['n-1', { x: 107, y: 500 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 107, 500), node('n-2', 100, 50)],
    );
    expect(result.alignedX).toBe(false);
    expect(result.dx).toBe(0);
  });

  it('aligns a dragged center to a stationary edge (cross-edge combo)', () => {
    // Dragged center = 103 + 120 = 223; stationary LEFT edge at 220 → the
    // 9-combo matrix matches center↔left with dx = 3 (the left↔left
    // pairing, 103 vs 220, is far out of range — proving the match came
    // from a cross-edge combination).
    const targets = new Map([['n-1', { x: 103, y: 500 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 103, 500), node('n-2', 220, 50)],
    );
    expect(result.alignedX).toBe(true);
    expect(result.x).toBe(220);
    expect(result.dx).toBe(3);
  });

  it('picks the closest match when several stationary edges are within range', () => {
    // Left edge vs n-2 (dx 2) and vs n-3's right edge at 110-240+? — place
    // n-3 so its RIGHT edge (x+240) is 1px from the dragged left edge:
    // dragged 100 → n-3 right edge at 101 → dx = -1 beats dx = 2.
    const targets = new Map([['n-1', { x: 100, y: 500 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 100, 500), node('n-2', 98, 50), node('n-3', -139, 90)],
    );
    expect(result.alignedX).toBe(true);
    expect(result.x).toBe(101); // n-3's right edge (101), not n-2's left (98)
    expect(result.dx).toBe(-1);
  });

  it('aligns on the y axis independently', () => {
    // Vertical center match: dragged center = 500 + 120 = 620; stationary
    // center = 500 + 120 → dx0. Use stationary top edge at 500 vs dragged
    // top edge at 503 → dy = 3, no x alignment (different columns).
    const targets = new Map([['n-1', { x: 800, y: 503 }]]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1']),
      [node('n-1', 800, 503), node('n-2', 100, 500)],
    );
    expect(result.alignedY).toBe(true);
    expect(result.y).toBe(500);
    expect(result.dy).toBe(3);
    expect(result.alignedX).toBe(false);
    expect(result.dx).toBe(0);
  });

  it('excludes the dragged set from the reference pool (never self-aligns)', () => {
    // Two dragged nodes whose edges WOULD align with each other if dragged
    // nodes were reference candidates; with only dragged nodes present the
    // pool is empty, so nothing aligns.
    const targets = new Map([
      ['n-1', { x: 100, y: 100 }],
      ['n-2', { x: 100, y: 400 }],
    ]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1', 'n-2']),
      [node('n-1', 100, 100), node('n-2', 100, 400)],
    );
    expect(result.alignedX).toBe(false);
    expect(result.alignedY).toBe(false);
  });

  it('aligns a group on a non-grabbed member edge (collective snap)', () => {
    // Dragged group: n-1 (grabbed) at (100, 500) and n-2 (member) at
    // (500, 500). n-2's left edge (500) is 1px from n-3's right edge (499)
    // → the GROUP dx is -1 even though the grabbed member n-1 is far away.
    const targets = new Map([
      ['n-1', { x: 100, y: 500 }],
      ['n-2', { x: 500, y: 500 }],
    ]);
    const result = computeAlignmentGuides(
      targets,
      new Set(['n-1', 'n-2']),
      [node('n-1', 100, 500), node('n-2', 500, 500), node('n-3', 259, 90)],
    );
    expect(result.alignedX).toBe(true);
    expect(result.x).toBe(499);
    expect(result.dx).toBe(1);
  });

  it('handles zero targets like the drag path does (no alignment)', () => {
    const result = computeAlignmentGuides(new Map(), new Set(), [node('n-1', 0, 0)]);
    expect(result).toEqual({ dx: 0, dy: 0, alignedX: false, alignedY: false });
  });
});

/* ── diagramOverflowsCanvas ──────────────────────────────────────── */

describe('diagramOverflowsCanvas', () => {
  const canvas = (width: number, height: number) =>
    ({ clientWidth: width, clientHeight: height }) as HTMLElement;

  it('returns false when the canvas has no measured size (jsdom / pre-layout)', () => {
    expect(diagramOverflowsCanvas(canvas(0, 800), [node('n-1', 0, 0)])).toBe(false);
    expect(diagramOverflowsCanvas(canvas(1200, 0), [node('n-1', 0, 0)])).toBe(false);
  });

  it('returns false for an empty diagram', () => {
    expect(diagramOverflowsCanvas(canvas(1200, 800), [])).toBe(false);
  });

  it('returns false when the diagram fits the viewport', () => {
    // One card at (100, 100): box spans x 100..340, y 100..340; with the
    // 60px breathing room both axes fit a 1200x800 viewport.
    expect(diagramOverflowsCanvas(canvas(1200, 800), [node('n-1', 100, 100)])).toBe(false);
  });

  it('returns true when the diagram exceeds the viewport width', () => {
    // Two cards far apart horizontally: minX 0, maxX 1440 → span 1440 + 120
    // padding = 1560, which exceeds a 1000px viewport but fits a 1600px one.
    const twoWide = [node('n-1', 0, 100), node('n-2', 1200, 100)];
    expect(diagramOverflowsCanvas(canvas(1000, 800), twoWide)).toBe(true);
    expect(diagramOverflowsCanvas(canvas(1600, 800), twoWide)).toBe(false);
  });

  it('returns true when the diagram exceeds the viewport height', () => {
    // Card at y 1000: box ends 1240; span + padding 1240 - 1000 + 120 = 360
    // exceeds a 300px-tall viewport.
    expect(diagramOverflowsCanvas(canvas(1200, 300), [node('n-1', 100, 1000)])).toBe(true);
  });

  it('uses the node bounding box, not individual positions', () => {
    // Two cards far apart vertically: span 100..(240+2400) = 2540 with
    // padding → overflows an 800px-tall viewport.
    expect(
      diagramOverflowsCanvas(
        canvas(1200, 800),
        [node('n-1', 100, 100), node('n-2', 100, 2400)],
      ),
    ).toBe(true);
  });
});

/* ── isTopologyRevisionConflict ──────────────────────────────────── */

describe('isTopologyRevisionConflict', () => {
  it('recognizes a typed topology-revision-conflict AppError', () => {
    expect(
      isTopologyRevisionConflict({ kind: 'topologyValidation', code: 'topology-revision-conflict' }),
    ).toBe(true);
  });

  it('rejects a different topology validation code', () => {
    expect(
      isTopologyRevisionConflict({ kind: 'topologyValidation', code: 'cycle-detected' }),
    ).toBe(false);
  });

  it('rejects unrelated typed errors', () => {
    expect(isTopologyRevisionConflict({ kind: 'core', subKind: 'conflict', message: 'x' })).toBe(false);
    expect(isTopologyRevisionConflict({ kind: 'invalid', message: 'x' })).toBe(false);
  });

  it('parses the Tauri-wrapped serialized string form', () => {
    const message = `Error invoking remote method 'apply_topology_diff': ${JSON.stringify({
      kind: 'topologyValidation',
      code: 'topology-revision-conflict',
      message: 'stale base revision',
    })}`;
    expect(isTopologyRevisionConflict(new Error(message))).toBe(true);
  });

  it('rejects null, undefined, and non-error values', () => {
    expect(isTopologyRevisionConflict(null)).toBe(false);
    expect(isTopologyRevisionConflict(undefined)).toBe(false);
    expect(isTopologyRevisionConflict('plain string')).toBe(false);
    expect(isTopologyRevisionConflict(42)).toBe(false);
  });
});

/* ── prefersReducedMotion ────────────────────────────────────────── */

describe('prefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns false when matchMedia is unavailable (jsdom-safe default)', () => {
    // @ts-expect-error — simulating an environment without matchMedia.
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns true when the OS requests reduced motion', () => {
    window.matchMedia = ((query: string) =>
      ({ matches: query === '(prefers-reduced-motion: reduce)', media: query })) as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false when the OS does not request reduced motion', () => {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});

/* ── validateEditorGraph ─────────────────────────────────────────── */

/** Minimal CANONICAL graph: a Branch Location with identity, one Store POS
 *  workspace, and the required location ownership wire. Validates clean. */
const canonicalNodes: TopologyNodeData[] = [
  { id: 'store-1', type: 'store', name: 'Branch', storeProfileId: 'sp-1', x: 80, y: 140 },
  { id: 'ws-1', type: 'workspace', name: 'POS', metadata: { typeKey: 'store-pos' }, x: 380, y: 80 },
];

const canonicalWires: TopologyWireData[] = [
  {
    id: 'w-1',
    fromNodeId: 'store-1',
    toNodeId: 'ws-1',
    direction: 'one-way',
    fromPortId: 'location-out',
    toPortId: 'location-in',
    relationshipType: 'location',
  },
];

/** Same shape but the Branch Location carries NO canonical identity —
 *  the legacy/demo path `validateEditorGraph` exists to keep permissive. */
const legacyNodes: TopologyNodeData[] = [
  { id: 'store-1', type: 'store', name: 'Branch', x: 80, y: 140 },
  { id: 'ws-1', type: 'workspace', name: 'POS', metadata: { typeKey: 'store-pos' }, x: 380, y: 80 },
];

describe('validateEditorGraph', () => {
  it('skips validation for a legacy canvas when allowLegacyApply is true', () => {
    // No canonical identity + legacy apply allowed → non-blocking path.
    expect(validateEditorGraph(legacyNodes, canonicalWires, true, 'free')).toEqual([]);
  });

  it('validates a legacy canvas when strict mode is requested (allowLegacyApply=false)', () => {
    // The gate only skips when the legacy path is explicitly allowed; with
    // allowLegacyApply=false the same graph hits the strict contract.
    const errors = validateEditorGraph(legacyNodes, canonicalWires, false, 'free');
    expect(errors.map((e) => e.code)).toContain('branch-location-missing-identity');
  });

  it('passes a canonical graph with clean validation', () => {
    expect(validateEditorGraph(canonicalNodes, canonicalWires, true, 'free')).toEqual([]);
  });

  it('still validates a canonical graph even when allowLegacyApply is true', () => {
    // Canonical identity present → validation always runs.
    expect(validateEditorGraph(canonicalNodes, canonicalWires, true, 'free')).toEqual([]);
  });

  it('reports a duplicate node id through the contract', () => {
    const dupNodes: TopologyNodeData[] = [
      ...canonicalNodes,
      { ...canonicalNodes[1]!, id: 'store-1', name: 'Duplicate Store' },
    ];
    const errors = validateEditorGraph(dupNodes, canonicalWires, true, 'free');
    expect(errors.map((e) => e.code)).toContain('duplicate-node');
  });

  it('applies the multi-warehouse tier cap below Pro', () => {
    const nodes: TopologyNodeData[] = [
      ...canonicalNodes,
      { id: 'wh-1', type: 'warehouse', name: 'WH 1', metadata: { typeKey: 'warehouse' }, x: 700, y: 80 },
      { id: 'wh-2', type: 'warehouse', name: 'WH 2', metadata: { typeKey: 'warehouse' }, x: 700, y: 400 },
    ];
    const wires: TopologyWireData[] = [
      ...canonicalWires,
      { id: 'w-2', fromNodeId: 'ws-1', toNodeId: 'wh-1', direction: 'one-way', fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic' },
      { id: 'w-3', fromNodeId: 'ws-1', toNodeId: 'wh-2', direction: 'one-way', fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic' },
    ];
    const errors = validateEditorGraph(nodes, wires, true, 'free');
    expect(errors.map((e) => e.code)).toContain('warehouse-tier-limit');
  });

  it('lifts the warehouse cap on Pro (capacity checks replace it)', () => {
    const nodes: TopologyNodeData[] = [
      ...canonicalNodes,
      { id: 'wh-1', type: 'warehouse', name: 'WH 1', metadata: { typeKey: 'warehouse' }, x: 700, y: 80 },
      { id: 'wh-2', type: 'warehouse', name: 'WH 2', metadata: { typeKey: 'warehouse' }, x: 700, y: 400 },
    ];
    const wires: TopologyWireData[] = [
      ...canonicalWires,
      { id: 'w-2', fromNodeId: 'ws-1', toNodeId: 'wh-1', direction: 'one-way', fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic' },
      { id: 'w-3', fromNodeId: 'ws-1', toNodeId: 'wh-2', direction: 'one-way', fromPortId: 'operation-out', toPortId: 'operation-in', relationshipType: 'generic' },
    ];
    const errors = validateEditorGraph(nodes, wires, true, 'pro');
    expect(errors.map((e) => e.code)).not.toContain('warehouse-tier-limit');
  });
});
