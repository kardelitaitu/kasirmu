// ── compareBranchTopologies unit tests ────────────────────────────
//
// Pins the branch-to-branch topology comparison (round 154): given two
// saved diagrams, classify workspace nodes as only-in-current,
// only-in-other, shared-and-identical, or shared-but-differing (name,
// type, or wiring). The screen's Compare panel renders this summary so
// an operator can see how two locations' topologies differ before
// editing either one.

import { describe, expect, it } from 'vitest';
import { compareBranchTopologies, buildTopologyOverlay, layoutGhosts, buildGhostWireStubs, compareFocusDimIds } from '@/features/locations/topologyBranchCompare';
import type { TopologyDiagram, GhostBounds } from '@/features/locations/topologyBranchCompare';
import type { TopologyNodePayload, TopologyWirePayload } from '@/api/topology';

// ── Fixtures ──────────────────────────────────────────────────────

function wsNode(id: string, name: string, typeKey = 'store-pos'): TopologyNodePayload {
  return { id, type: 'workspace', name, x: 0, y: 0, metadata: { typeKey } };
}

function wire(from: string, to: string, rel: string, id = `w-${from}-${to}`): TopologyWirePayload {
  return {
    id,
    from_node_id: from,
    to_node_id: to,
    direction: 'one-way',
    relationship_type: rel,
  };
}

const current: TopologyDiagram = {
  nodes: [
    wsNode('ws-pos', 'Front Register'),
    wsNode('ws-kds', 'Kitchen Display', 'kds'),
  ],
  wires: [wire('ws-pos', 'ws-kds', 'generic')],
};

const other: TopologyDiagram = {
  nodes: [
    wsNode('ws-pos', 'Front Register'),
    wsNode('ws-wh', 'Stock Room'),
  ],
  wires: [wire('ws-pos', 'ws-wh', 'stock-routing')],
};

// ── Tests ─────────────────────────────────────────────────────────

describe('compareBranchTopologies', () => {
  it('reports workspaces present in only one of the two diagrams', () => {
    const result = compareBranchTopologies(current, other);

    expect(result.onlyInCurrent).toEqual([{ id: 'ws-kds', name: 'Kitchen Display' }]);
    expect(result.onlyInOther).toEqual([{ id: 'ws-wh', name: 'Stock Room' }]);
  });

  it('counts shared workspaces and flags wiring differences on the shared id', () => {
    const result = compareBranchTopologies(current, other);

    expect(result.shared).toBe(1);
    expect(result.differing).toHaveLength(1);
    expect(result.differing[0]).toMatchObject({
      id: 'ws-pos',
      name: 'Front Register',
      reasons: ['wiring'],
    });
  });

  it('flags a name difference and a type difference on a shared workspace', () => {
    const renamed: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Back Register')],
      wires: [],
    };
    const retyped: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register', 'restaurant-pos')],
      wires: [],
    };
    const base: TopologyDiagram = { nodes: [wsNode('ws-pos', 'Front Register')], wires: [] };

    expect(compareBranchTopologies(base, renamed).differing[0]!.reasons).toEqual(['name']);
    expect(compareBranchTopologies(base, retyped).differing[0]!.reasons).toEqual(['type']);
  });

  it('does not flag a shared workspace that is identical in both diagrams', () => {
    const result = compareBranchTopologies(current, current);

    expect(result.shared).toBe(2);
    expect(result.onlyInCurrent).toEqual([]);
    expect(result.onlyInOther).toEqual([]);
    expect(result.differing).toEqual([]);
  });

  it('treats a missing diagram as an empty one (everything in the other side)', () => {
    const result = compareBranchTopologies(null, other);

    expect(result.onlyInOther).toEqual([
      { id: 'ws-pos', name: 'Front Register' },
      { id: 'ws-wh', name: 'Stock Room' },
    ]);
    expect(result.onlyInCurrent).toEqual([]);
    expect(result.shared).toBe(0);
    expect(result.differing).toEqual([]);
  });

  it('ignores direction flips — direction is presentation, not a wiring difference', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos', 'ws-kds', 'generic')],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [{ ...wire('ws-pos', 'ws-kds', 'generic'), direction: 'reverse' }],
    };

    expect(compareBranchTopologies(a, b).differing).toEqual([]);
  });

  it('returns empty for two null diagrams', () => {
    const result = compareBranchTopologies(null, null);

    expect(result.onlyInCurrent).toEqual([]);
    expect(result.onlyInOther).toEqual([]);
    expect(result.shared).toBe(0);
    expect(result.differing).toEqual([]);
  });

  // ── Id-drift tolerance (round 155) ─────────────────────────────
  //
  // A saved diagram can predate the instance-id conventions, or a
  // workspace can be archived-and-recreated under a new UUID (the
  // destructive type change from round 152). The same logical
  // workspace then has different ids across the two branches. Today
  // that reports phantom only-in-current + only-in-other entries and
  // hides wiring differences — the comparison must pair by semantic
  // identity (name + typeKey) when ids disagree.

  it('pairs a same-name same-type workspace across branches with a drifted id', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos', 'ws-kds', 'generic')],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-pos-v2', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos-v2', 'ws-kds', 'generic')],
    };

    const result = compareBranchTopologies(a, b);
    expect(result.onlyInCurrent).toEqual([]);
    expect(result.onlyInOther).toEqual([]);
    expect(result.shared).toBe(2);
    expect(result.differing).toEqual([]);
  });

  it('flags a wiring difference on a drifted-id workspace instead of phantom entries', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos', 'ws-kds', 'generic')],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-pos-v2', 'Front Register'), wsNode('ws-wh', 'Stock Room')],
      wires: [wire('ws-pos-v2', 'ws-wh', 'stock-routing')],
    };

    const result = compareBranchTopologies(a, b);
    expect(result.onlyInCurrent).toEqual([{ id: 'ws-kds', name: 'KDS' }]);
    expect(result.onlyInOther).toEqual([{ id: 'ws-wh', name: 'Stock Room' }]);
    expect(result.shared).toBe(1);
    expect(result.differing).toEqual([
      { id: 'ws-pos', name: 'Front Register', reasons: ['wiring'] },
    ]);
  });

  it('does not guess when a drifted id is ambiguous (two same-key candidates)', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register')],
      wires: [],
    };
    const b: TopologyDiagram = {
      nodes: [
        wsNode('ws-pos-a', 'Front Register'),
        wsNode('ws-pos-b', 'Front Register'),
      ],
      wires: [],
    };

    const result = compareBranchTopologies(a, b);
    expect(result.onlyInCurrent).toEqual([{ id: 'ws-pos', name: 'Front Register' }]);
    expect(result.onlyInOther).toEqual([
      { id: 'ws-pos-a', name: 'Front Register' },
      { id: 'ws-pos-b', name: 'Front Register' },
    ]);
    expect(result.shared).toBe(0);
  });

  it('remaps a wire between two drifted workspaces when comparing', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-a', 'A', 't1'), wsNode('ws-b', 'B', 't2')],
      wires: [wire('ws-a', 'ws-b', 'generic')],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-a2', 'A', 't1'), wsNode('ws-b2', 'B', 't2')],
      wires: [wire('ws-a2', 'ws-b2', 'generic')],
    };

    const result = compareBranchTopologies(a, b);
    expect(result.onlyInCurrent).toEqual([]);
    expect(result.onlyInOther).toEqual([]);
    expect(result.shared).toBe(2);
    expect(result.differing).toEqual([]);
  });

  it('does not pair when the type differs — a type change is a different instance', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register', 'store-pos')],
      wires: [],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-pos-v2', 'Front Register', 'restaurant-pos')],
      wires: [],
    };

    const result = compareBranchTopologies(a, b);
    expect(result.onlyInCurrent).toEqual([{ id: 'ws-pos', name: 'Front Register' }]);
    expect(result.onlyInOther).toEqual([{ id: 'ws-pos-v2', name: 'Front Register' }]);
    expect(result.shared).toBe(0);
  });

  // ── Canvas overlay descriptors (round 158) ─────────────────────
  //
  // The Compare panel gains a spatial diff: other-only workspaces render
  // as ghost cards at their saved positions, current-only workspaces get a
  // red marker, and shared-but-differing ones an amber marker — so an
  // operator sees WHERE locations differ, not just the name lists.

  it('turns other-only workspaces into ghosts at their saved positions', () => {
    const current: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register')],
      wires: [],
    };
    const other: TopologyDiagram = {
      nodes: [wsNode('ws-wh', 'Stock Room')],
      wires: [],
    };

    const overlay = buildTopologyOverlay(current, other);
    expect(overlay.ghosts).toEqual([{ id: 'ws-wh', name: 'Stock Room', x: 0, y: 0 }]);
    // ws-pos exists only in the current diagram — it is not ghosted, it is
    // marked as only-here instead.
    expect(overlay.onlyHere).toEqual(['ws-pos']);
    expect(overlay.differing).toEqual([]);
  });

  it('keeps the ghost position from the OTHER diagram, not the current one', () => {
    const current: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [],
    };
    const other: TopologyDiagram = {
      nodes: [
        { ...wsNode('ws-pos', 'Front Register'), x: 10, y: 20 },
        { ...wsNode('ws-wh', 'Stock Room'), x: 480, y: 360 },
      ],
      wires: [],
    };

    const overlay = buildTopologyOverlay(current, other);
    expect(overlay.ghosts).toEqual([{ id: 'ws-wh', name: 'Stock Room', x: 480, y: 360 }]);
  });

  it('marks current-only workspaces as only-here and shared-differing ones as differing', () => {
    const current: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'Kitchen Display', 'kds')],
      wires: [],
    };
    const other: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Back Register'), wsNode('ws-wh', 'Stock Room')],
      wires: [],
    };

    const overlay = buildTopologyOverlay(current, other);
    expect(overlay.ghosts).toEqual([{ id: 'ws-wh', name: 'Stock Room', x: 0, y: 0 }]);
    expect(overlay.onlyHere).toEqual(['ws-kds']);
    expect(overlay.differing).toEqual(['ws-pos']);
  });

  it('returns an empty overlay for identical diagrams and null inputs', () => {
    const diagram: TopologyDiagram = { nodes: [wsNode('ws-pos', 'Front Register')], wires: [] };

    // Identical diagrams SHARE every workspace (exact id matches); null
    // inputs share nothing.
    expect(buildTopologyOverlay(diagram, diagram)).toEqual({
      ghosts: [],
      onlyHere: [],
      differing: [],
      otherWires: [],
      sharedByOtherId: [{ otherId: 'ws-pos', currentId: 'ws-pos' }],
    });
    expect(buildTopologyOverlay(null, null)).toEqual({ ghosts: [], onlyHere: [], differing: [], otherWires: [], sharedByOtherId: [] });
  });

  it('treats a drifted-id pair as shared — differing only when wiring differs', () => {
    const a: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos', 'ws-kds', 'generic')],
    };
    const b: TopologyDiagram = {
      nodes: [wsNode('ws-pos-v2', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [wire('ws-pos-v2', 'ws-kds', 'generic')],
    };
    const bWiredDifferently: TopologyDiagram = {
      ...b,
      wires: [wire('ws-pos-v2', 'ws-kds', 'generic', 'w-different'), wire('ws-pos-v2', 'ws-wh', 'stock-routing', 'w-x')],
      nodes: [...b.nodes, wsNode('ws-wh', 'Stock Room')],
    };

    expect(buildTopologyOverlay(a, b)).toEqual({ ghosts: [], onlyHere: [], differing: [], otherWires: b.wires, sharedByOtherId: [{ otherId: 'ws-pos-v2', currentId: 'ws-pos' }, { otherId: 'ws-kds', currentId: 'ws-kds' }] });
    const overlay = buildTopologyOverlay(a, bWiredDifferently);
    expect(overlay.ghosts).toEqual([{ id: 'ws-wh', name: 'Stock Room', x: 0, y: 0 }]);
    expect(overlay.onlyHere).toEqual([]);
    expect(overlay.differing).toEqual(['ws-pos']);
    expect(overlay.otherWires).toEqual(bWiredDifferently.wires);
  });

  it('carries the shared-workspace id pairing for exact matches and drift pairs', () => {
    const current: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds')],
      wires: [],
    };
    const other: TopologyDiagram = {
      // ws-pos-v2 is a drifted twin of ws-pos (same name + type); ws-kds is
      // an exact id match; ws-wh is only in the other branch (a ghost).
      nodes: [
        wsNode('ws-pos-v2', 'Front Register'),
        wsNode('ws-kds', 'KDS', 'kds'),
        wsNode('ws-wh', 'Stock Room'),
      ],
      wires: [],
    };
    const overlay = buildTopologyOverlay(current, other);
    expect(overlay.sharedByOtherId).toEqual([
      { otherId: 'ws-pos-v2', currentId: 'ws-pos' },
      { otherId: 'ws-kds', currentId: 'ws-kds' },
    ]);
  });

  it('leaves sharedByOtherId empty when nothing is shared', () => {
    const current: TopologyDiagram = { nodes: [wsNode('ws-a', 'A')], wires: [] };
    const other: TopologyDiagram = { nodes: [wsNode('ws-b', 'B')], wires: [] };
    expect(buildTopologyOverlay(current, other).sharedByOtherId).toEqual([]);
  });

  it('focus dims only the shared-identical workspaces', () => {
    // ws-pos: shared and identical → dim. ws-kds: shared but its wiring
    // differs (the ghost attaches to it) → keep bright. ws-wh: only in
    // the other branch (a ghost) → keep bright. ws-extra: only in the
    // current branch → keep bright.
    const current: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds'), wsNode('ws-extra', 'Extra')],
      wires: [wire('ws-pos', 'ws-kds', 'generic')],
    };
    const other: TopologyDiagram = {
      nodes: [wsNode('ws-pos', 'Front Register'), wsNode('ws-kds', 'KDS', 'kds'), wsNode('ws-wh', 'Stock Room')],
      wires: [wire('ws-pos', 'ws-kds', 'generic'), wire('ws-kds', 'ws-wh', 'stock-routing')],
    };
    const overlay = buildTopologyOverlay(current, other);
    expect(compareFocusDimIds(overlay)).toEqual(['ws-pos']);
  });

  it('focus dims nothing for a null/empty overlay', () => {
    expect(compareFocusDimIds({ ghosts: [], onlyHere: [], differing: [], otherWires: [], sharedByOtherId: [] }))
      .toEqual([]);
  });
});

// ── layoutGhosts unit tests (round 159) ───────────────────────────
//
// The overlay renders ghosts at the OTHER diagram's SAVED world
// coordinates; the visible world-rect is derived from the canvas size
// and the pan/zoom transform. layoutGhosts clamps each ghost card into
// that rect and resolves collisions (ghost-vs-ghost and ghost-vs-live-
// card) by deterministic downward stacking, so the overlay never loses
// a difference to an off-screen or buried card.

describe('layoutGhosts', () => {
  const viewport = (over: Partial<{ width: number; height: number; panX: number; panY: number; zoom: number }> = {}) => ({
    width: over.width ?? 800,
    height: over.height ?? 600,
    pan: { x: over.panX ?? 0, y: over.panY ?? 0 },
    zoom: over.zoom ?? 1,
  });
  const ghost = (id: string, x: number, y: number) => ({ id, name: id, x, y });

  it('leaves an already-visible ghost exactly in place', () => {
    const out = layoutGhosts([ghost('g1', 120, 140)], viewport());
    expect(out).toEqual([{ id: 'g1', name: 'g1', x: 120, y: 140 }]);
  });

  it('clamps a ghost fully off to the right so its card fits the visible rect', () => {
    // Card is 240×240: at the 800×600 rect, the rightmost visible x is 560.
    const out = layoutGhosts([ghost('g1', 4000, 100)], viewport());
    expect(out[0]).toMatchObject({ id: 'g1', x: 560, y: 100 });
  });

  it('clamps a ghost fully off below the canvas so its card fits the visible rect', () => {
    const out = layoutGhosts([ghost('g1', 100, 9000)], viewport());
    expect(out[0]).toMatchObject({ id: 'g1', x: 100, y: 360 });
  });

  it('clamps a ghost off to the top-left into the visible corner', () => {
    const out = layoutGhosts([ghost('g1', -3000, -3000)], viewport());
    expect(out[0]).toMatchObject({ id: 'g1', x: 0, y: 0 });
  });

  it('derives the visible rect from zoom (world shrinks at 2×)', () => {
    // zoom 2 → visible world rect is [0, 400] × [0, 300]; rightmost x = 160.
    const out = layoutGhosts([ghost('g1', 1000, 1000)], viewport({ zoom: 2 }));
    expect(out[0]).toMatchObject({ id: 'g1', x: 160, y: 60 });
  });

  it('derives the visible rect from pan (the rect moves with the pan)', () => {
    // pan (300, 200) at zoom 1 → visible world rect is [-300, 500] × [-200, 400].
    const out = layoutGhosts([ghost('g1', 9000, 9000)], viewport({ panX: 300, panY: 200 }));
    expect(out[0]).toMatchObject({ id: 'g1', x: 260, y: 160 });
  });

  it('stacks ghosts that clamp onto the same corner side-by-side instead of overlapping', () => {
    const out = layoutGhosts(
      [ghost('g1', 9000, 9000), ghost('g2', 9000, 9000)],
      viewport(),
    );
    // No vertical room below the bottom-right corner, so the second wraps
    // LEFT of the first — both stay fully inside the visible rect.
    expect(out[0]).toMatchObject({ id: 'g1', x: 560, y: 360 });
    expect(out[1]).toMatchObject({ id: 'g2', x: 312, y: 360 });
  });

  it('moves a ghost off a live card it would land on', () => {
    // A live card occupies the bottom-right corner; the ghost clamps there
    // and must move aside (wraps left of the card) instead of hiding it.
    const liveCard = { x: 560, y: 360, width: 240, height: 240 };
    const out = layoutGhosts([ghost('g1', 9000, 9000)], viewport(), [liveCard]);
    expect(out[0]).toMatchObject({ id: 'g1', x: 312, y: 360 });
  });

  it('stacks deterministically in input order through a chain', () => {
    const out = layoutGhosts(
      [ghost('g1', 9000, 9000), ghost('g2', 9000, 9000), ghost('g3', 9000, 9000)],
      viewport(),
    );
    expect(out.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(out[2]).toMatchObject({ id: 'g3', x: 64, y: 360 });
  });

  it('returns an empty list for no ghosts', () => {
    expect(layoutGhosts([], viewport())).toEqual([]);
  });

  it('keeps the card anchored when the visible rect is smaller than the card', () => {
    // 100×100 rect, 240×240 card: full visibility is impossible — the
    // top-left corner is anchored into the rect (no NaN, no blow-up).
    const out = layoutGhosts([ghost('g1', -50, -50)], viewport({ width: 100, height: 100 }));
    expect(out[0]).toMatchObject({ id: 'g1', x: 0, y: 0 });
  });
});

// ── buildGhostWireStubs unit tests (round 160) ───────────────────
//
// Ghost cards alone read as floating boxes; stubs draw the other
// branch's ghost-to-ghost wiring as dashed connectors between the laid-
// out ghost positions, so a missing satellite cluster reads as a real
// (mini) topology. Ghost→shared-workspace connections are deliberately
// deferred — they need drift-resolved far-end positions on the live
// canvas (a separate slice). Edge-to-edge, display-only, deterministic.

describe('buildGhostWireStubs', () => {
  const wire = (id: string, from: string, to: string) =>
    ({ id, from_node_id: from, to_node_id: to, direction: 'one-way', relationship_type: 'generic' }) as const;
  const g = (id: string, x: number, y: number) => ({ id, name: id, x, y });

  it('emits a stub for every wire whose BOTH endpoints are ghosts', () => {
    const stubs = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'g-b'), wire('w-2', 'g-a', 'nope'), wire('w-3', 'nope', 'g-b')],
      [g('g-a', 0, 0), g('g-b', 500, 0)],
    );
    expect(stubs).toHaveLength(1);
    expect(stubs[0]).toMatchObject({ id: 'w-1', fromId: 'g-a', toId: 'g-b' });
  });

  it('connects a right-side ghost to a left-side ghost edge-to-edge', () => {
    // g-a at (0,0), g-b at (500,0): g-b is to the RIGHT, so the stub exits
    // g-a's right edge midpoint and enters g-b's left edge midpoint.
    const [s] = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'g-b')],
      [g('g-a', 0, 0), g('g-b', 500, 0)],
    );
    expect(s).toMatchObject({ x1: 240, y1: 120, x2: 500, y2: 120 });
  });

  it('mirrors the edges when the ghost order is flipped', () => {
    // g-b is to the LEFT of g-a: the stub exits g-a's LEFT edge and enters
    // g-b's RIGHT edge (the wire id and endpoints stay as authored).
    const [s] = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'g-b')],
      [g('g-a', 500, 0), g('g-b', 0, 0)],
    );
    expect(s).toMatchObject({ x1: 500, y1: 120, x2: 240, y2: 120 });
  });

  it('uses the top/bottom edges for vertical ghost pairs', () => {
    // g-b below g-a: the stub exits g-a's bottom edge midpoint and enters
    // g-b's top edge midpoint.
    const [s] = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'g-b')],
      [g('g-a', 0, 0), g('g-b', 0, 500)],
    );
    expect(s).toMatchObject({ x1: 120, y1: 240, x2: 120, y2: 500 });
  });

  it('returns no stubs when nothing is ghost-to-ghost', () => {
    expect(buildGhostWireStubs([wire('w-1', 'g-a', 'shared-1')], [g('g-a', 0, 0)])).toEqual([]);
    expect(buildGhostWireStubs([wire('w-1', 'a', 'b')], [g('g-a', 0, 0)])).toEqual([]);
    expect(buildGhostWireStubs([], [g('g-a', 0, 0)])).toEqual([]);
    expect(buildGhostWireStubs([wire('w-1', 'g-a', 'g-b')], [])).toEqual([]);
  });

  it('connects a ghost to a SHARED workspace when the far end resolves', () => {
    // The shared card is a live 240×240 card at (380, 80); the wire
    // references it by its OTHER-side id, which the caller resolved to a
    // live-card position in the far map.
    const far = new Map<string, GhostBounds>([
      ['ws-s', { x: 380, y: 80, width: 240, height: 240 }],
    ]);
    const [s] = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'ws-s')],
      [g('g-a', 0, 300)],
      far,
    );
    // g-a at (0,300)-(240,540); ws-s at (380,80)-(620,320): the shared card
    // is to the RIGHT, so the stub exits the ghost's right edge midpoint
    // (240, 300+120) and enters the shared card's left edge midpoint
    // (380, 80+120).
    expect(s).toMatchObject({ id: 'w-1', fromId: 'g-a', toId: 'ws-s', x1: 240, y1: 420, x2: 380, y2: 200 });
  });

  it('skips a ghost-to-shared wire when the shared card is not live', () => {
    const stubs = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'ws-s')],
      [g('g-a', 0, 300)],
      new Map(), // no far position for ws-s — its current card is missing
    );
    expect(stubs).toEqual([]);
  });

  it('keeps ghost-to-ghost stubs alongside ghost-to-shared ones', () => {
    const far = new Map<string, GhostBounds>([
      ['ws-s', { x: 380, y: 80, width: 240, height: 240 }],
    ]);
    const stubs = buildGhostWireStubs(
      [wire('w-1', 'g-a', 'g-b'), wire('w-2', 'g-b', 'ws-s')],
      [g('g-a', 0, 300), g('g-b', 500, 300)],
      far,
    );
    expect(stubs).toHaveLength(2);
    expect(stubs.map((s) => s.id)).toEqual(['w-1', 'w-2']);
  });
});
