import { describe, expect, it } from 'vitest';
import { computeAutoLayout, LAYOUT_GRID, type NodePlacement } from '@/features/locations/nodeTopologyLayout';
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/locations/nodeTopologyClamp';

// The topology editor's one-click Auto-layout: a layered wire-direction
// engine. Sources rank 0, each wire target ranks one deeper (BFS), every
// rank becomes a column with rows stacked in prior-y order, and the whole
// result is translated so the placed bounding-box midpoint matches the
// original diagram's — reorganize in place, never jump.
describe('computeAutoLayout (layered wire-direction layout engine)', () => {
  it('ranks a multi-source DAG into direction columns and stacks rows in prior-y order', () => {
    // A deliberately tangled diagram: store at the bottom, workspaces
    // straddling each other, warehouse fed by the second workspace.
    const placed = computeAutoLayout(
      [
        { id: 'store', x: 0, y: 400 },
        { id: 'ws-a', x: 300, y: 100 },
        { id: 'ws-b', x: 700, y: 300 },
        { id: 'wh', x: 200, y: 500 },
      ],
      [
        { id: 'w1', fromNodeId: 'store', toNodeId: 'ws-a' },
        { id: 'w2', fromNodeId: 'store', toNodeId: 'ws-b' },
        { id: 'w3', fromNodeId: 'ws-b', toNodeId: 'wh' },
      ],
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    // store (rank 0) left of both workspaces (rank 1)…
    expect(byId.get('store')!.x).toBeLessThan(byId.get('ws-a')!.x);
    // …the same-rank workspaces share a column, stacked in prior-y order…
    expect(byId.get('ws-a')!.x).toBe(byId.get('ws-b')!.x);
    expect(byId.get('ws-a')!.y).toBeLessThan(byId.get('ws-b')!.y);
    // …and the rank-2 warehouse (fed by ws-b) is rightmost.
    expect(byId.get('wh')!.x).toBeGreaterThan(byId.get('ws-a')!.x);
    // Column tops align across ranks.
    expect(byId.get('store')!.y).toBe(byId.get('ws-a')!.y);
  });

  it('keeps the diagram centered: the placed bounding-box midpoint equals the original', () => {
    const nodes = [
      { id: 'store', x: 0, y: 400 },
      { id: 'ws-a', x: 300, y: 100 },
      { id: 'ws-b', x: 700, y: 300 },
      { id: 'wh', x: 200, y: 500 },
    ];
    const placed = computeAutoLayout(nodes, [
      { id: 'w1', fromNodeId: 'store', toNodeId: 'ws-a' },
      { id: 'w2', fromNodeId: 'store', toNodeId: 'ws-b' },
      { id: 'w3', fromNodeId: 'ws-b', toNodeId: 'wh' },
    ]);
    const midOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
    expect(midOf(placed.map((p) => p.x))).toBe(midOf(nodes.map((n) => n.x)));
    expect(midOf(placed.map((p) => p.y))).toBe(midOf(nodes.map((n) => n.y)));
  });

  it('does not move a single unwired node (anchor uses consistent geometry)', () => {
    // The old inline anchor compared the ORIGINAL origin-midpoint against
    // the PLACED box-midpoint (which adds NODE_WIDTH/2), so a lone node
    // jumped half a node-width on every Auto-layout click.
    expect(computeAutoLayout([{ id: 'a', x: 100, y: 100 }], []))
      .toEqual([{ id: 'a', x: 100, y: 100 }]);
  });

  it('collapses pure cycles into the source column instead of looping forever', () => {
    const placed = computeAutoLayout(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 300, y: 0 },
      ],
      [
        { id: 'w1', fromNodeId: 'a', toNodeId: 'b' },
        { id: 'w2', fromNodeId: 'b', toNodeId: 'a' },
      ],
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    // Neither node is a source (each is pointed to), so both fall back to
    // rank 0 and land in the same column.
    expect(byId.get('a')!.x).toBe(byId.get('b')!.x);
  });

  it('returns an empty placement list for an empty diagram', () => {
    expect(computeAutoLayout([], [])).toEqual([]);
  });
});

// A forest is several independent wire-connected trees. Each tree gets its
// own column band laid out side-by-side, instead of every source being
// pushed into column 0 and the trees stacking vertically on top of each
// other. Converging roots (multiple sources feeding one target) still form
// ONE band, and the bands follow the diagram's left-to-right reading order.
describe('computeAutoLayout — forest layout (multiple independent roots)', () => {
  it('lays two independent trees side-by-side instead of stacking their sources', () => {
    // Tree 1: A→B (physically left). Tree 2: C→D (physically right).
    const placed = computeAutoLayout(
      [
        { id: 'a', x: 0, y: 100 },
        { id: 'b', x: 300, y: 100 },
        { id: 'c', x: 500, y: 300 },
        { id: 'd', x: 800, y: 300 },
      ],
      [
        { id: 'w1', fromNodeId: 'a', toNodeId: 'b' },
        { id: 'w2', fromNodeId: 'c', toNodeId: 'd' },
      ],
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    // Tree 1's deepest node sits LEFT of tree 2's root — the bands are
    // side-by-side, not interleaved or stacked.
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x);
    expect(byId.get('b')!.x).toBeLessThan(byId.get('c')!.x);
    expect(byId.get('c')!.x).toBeLessThan(byId.get('d')!.x);
    // Both roots land on the same row (side-by-side, not stacked).
    expect(byId.get('a')!.y).toBe(byId.get('c')!.y);
  });

  it('keeps converging roots in ONE band: sources feeding the same target still stack', () => {
    // A→C and B→C: two sources, one target — a single tree, so the sources
    // share a column instead of splitting into separate bands.
    const placed = computeAutoLayout(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 300 },
        { id: 'c', x: 300, y: 150 },
      ],
      [
        { id: 'w1', fromNodeId: 'a', toNodeId: 'c' },
        { id: 'w2', fromNodeId: 'b', toNodeId: 'c' },
      ],
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    expect(byId.get('a')!.x).toBe(byId.get('b')!.x);
    expect(byId.get('a')!.y).toBeLessThan(byId.get('b')!.y);
    expect(byId.get('c')!.x).toBeGreaterThan(byId.get('a')!.x);
  });

  it('orders the bands by the diagram left-to-right reading order', () => {
    // Tree 2 (C→D) is physically LEFT of tree 1 (A→B): the layout must
    // keep C's band left of A's band, following the original positions.
    const placed = computeAutoLayout(
      [
        { id: 'a', x: 500, y: 100 },
        { id: 'b', x: 800, y: 100 },
        { id: 'c', x: 0, y: 300 },
        { id: 'd', x: 300, y: 300 },
      ],
      [
        { id: 'w1', fromNodeId: 'a', toNodeId: 'b' },
        { id: 'w2', fromNodeId: 'c', toNodeId: 'd' },
      ],
    );
    const byId = new Map(placed.map((p) => [p.id, p]));
    expect(byId.get('c')!.x).toBeLessThan(byId.get('d')!.x);
    expect(byId.get('d')!.x).toBeLessThan(byId.get('a')!.x);
    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x);
  });
});

// Elbow-routed wires are orthogonal — they look clean only when the cards
// sit on the grid. With snap enabled the auto-layout anchor therefore
// snaps every placement to the 24px grid; the default (curved routing /
// snap off) keeps the free-floating positions the anchor math produces.
describe('computeAutoLayout — grid snapping (snapToGrid)', () => {
  const tangled = () => ({
    nodes: [
      { id: 'store', x: 0, y: 400 },
      { id: 'ws-a', x: 300, y: 100 },
      { id: 'ws-b', x: 700, y: 300 },
      { id: 'wh', x: 200, y: 500 },
    ],
    wires: [
      { id: 'w1', fromNodeId: 'store', toNodeId: 'ws-a' },
      { id: 'w2', fromNodeId: 'store', toNodeId: 'ws-b' },
      { id: 'w3', fromNodeId: 'ws-b', toNodeId: 'wh' },
    ],
  });

  it('snaps every placement to the grid when snapToGrid is set', () => {
    const { nodes, wires } = tangled();
    const placed = computeAutoLayout(nodes, wires, { snapToGrid: true });
    for (const p of placed) {
      expect(p.x % LAYOUT_GRID).toBe(0);
      expect(p.y % LAYOUT_GRID).toBe(0);
    }
  });

  it('keeps the free-floating anchor positions by default (no snap)', () => {
    const { nodes, wires } = tangled();
    const placed = computeAutoLayout(nodes, wires);
    // The natural layout lands off-grid (the anchor midpoint rarely aligns
    // with the 24px lattice) — that is the curved-routing behavior.
    expect(placed.some((p) => p.x % LAYOUT_GRID !== 0 || p.y % LAYOUT_GRID !== 0)).toBe(true);
  });

  it('never produces overlapping cards — with AND without grid snapping', () => {
    // Round-142 invariant guard. The engine's minimum origin gaps are
    // structural — rows 288px (NODE_HEIGHT + LAYOUT_GAP_Y), columns 304px
    // (NODE_WIDTH + LAYOUT_GAP_X), bands 400px — and every gap snaps to at
    // least NODE_WIDTH on the 24px lattice, so the layout is collision-free
    // by construction in both modes. This test pins that invariant so a
    // future engine change (smaller gaps, tighter bands, per-node snap)
    // cannot silently start stacking cards — Auto-layout must never hand
    // the canvas an overlap the movement paths (rounds 140-141) then refuse
    // to create or fix.
    //
    // Deliberately tangled: one 3-rank tree with a converging-roots column
    // (ranks 0/1/2 → exercises column AND row gaps) plus an independent
    // second tree (exercises the band gap), positions scattered so the
    // anchor translation lands mid-layout rather than on a lattice edge.
    const nodes = [
      { id: 'a', x: 0, y: 400 },
      { id: 'b', x: 300, y: 100 },
      { id: 'c', x: 700, y: 300 },
      { id: 'd', x: 200, y: 500 },
      { id: 'e', x: 1000, y: 150 },
      { id: 'f', x: 1300, y: 350 },
    ];
    const wires = [
      { id: 'w1', fromNodeId: 'a', toNodeId: 'b' },
      { id: 'w2', fromNodeId: 'a', toNodeId: 'c' },
      { id: 'w3', fromNodeId: 'c', toNodeId: 'd' },
      { id: 'w4', fromNodeId: 'e', toNodeId: 'f' },
    ];
    const boxesOverlap = (p: NodePlacement, q: NodePlacement) =>
      p.x < q.x + NODE_WIDTH && p.x + NODE_WIDTH > q.x
      && p.y < q.y + NODE_HEIGHT && p.y + NODE_HEIGHT > q.y;

    for (const snapToGrid of [false, true]) {
      const placed = computeAutoLayout(nodes, wires, { snapToGrid });
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          expect(
            boxesOverlap(placed[i]!, placed[j]!),
            `${placed[i]!.id}/${placed[j]!.id} overlap (snapToGrid=${snapToGrid})`,
          ).toBe(false);
        }
      }
    }
  });
});
