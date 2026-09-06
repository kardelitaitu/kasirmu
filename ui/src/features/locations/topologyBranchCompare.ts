// ── Branch-to-branch topology comparison ──────────────────────────
//
// Pure engine behind the screen's Compare panel (round 154): given two
// saved diagrams (the current branch's and another branch's), classify
// the workspace nodes as only-in-current, only-in-other, or shared —
// and for shared ids, flag name / type / wiring differences. An
// operator with several locations can see how two branches' topologies
// differ before editing either one.
//
// Deliberately display-only: it never resolves store ownership or
// builds apply payloads — `planTopologyDiff` / `computeTopologyDiff`
// own the commit side. Wiring is compared as undirected connections
// (direction is presentation, not topology).

import type { TopologyNodePayload, TopologyWirePayload } from '@/api/topology';

/** The subset of a saved diagram the comparison reasons about. */
export interface TopologyDiagram {
  nodes: TopologyNodePayload[];
  wires: TopologyWirePayload[];
}

export interface BranchWorkspaceRef {
  id: string;
  name: string;
}

export interface DifferingWorkspace {
  id: string;
  name: string;
  reasons: Array<'name' | 'type' | 'wiring'>;
}

export interface BranchTopologyComparison {
  /** Workspace ids present in the current diagram only. */
  onlyInCurrent: BranchWorkspaceRef[];
  /** Workspace ids present in the other diagram only. */
  onlyInOther: BranchWorkspaceRef[];
  /** Number of workspace ids present in both diagrams. */
  shared: number;
  /** Shared workspaces whose name, type, or wiring differs. */
  differing: DifferingWorkspace[];
}

/** Undirected connection key — a wire's endpoints, order-normalised. */
function connectionKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Incident connection keys per node id (any wire touching the node). */
function wiringByNode(diagram: TopologyDiagram | null): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!diagram) return map;
  for (const wire of diagram.wires) {
    const key = connectionKey(wire.from_node_id, wire.to_node_id);
    for (const endpoint of [wire.from_node_id, wire.to_node_id]) {
      let set = map.get(endpoint);
      if (!set) {
        set = new Set();
        map.set(endpoint, set);
      }
      set.add(key);
    }
  }
  return map;
}

/**
 * Incident connection keys per node id, with wire endpoints remapped
 * through the drift pairing (other-side id → current-side id). A wire
 * whose endpoint is a drifted workspace is compared against the
 * current side's id so wiring can be judged on equal ground.
 */
function wiringByNodeRemapped(
  diagram: TopologyDiagram | null,
  drift: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!diagram) return map;
  for (const wire of diagram.wires) {
    const a = drift.get(wire.from_node_id) ?? wire.from_node_id;
    const b = drift.get(wire.to_node_id) ?? wire.to_node_id;
    const key = connectionKey(a, b);
    for (const endpoint of [a, b]) {
      let set = map.get(endpoint);
      if (!set) {
        set = new Set();
        map.set(endpoint, set);
      }
      set.add(key);
    }
  }
  return map;
}

function setsEqual(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  if (!a || !b) return (a?.size ?? 0) === (b?.size ?? 0);
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/**
 * Pair drifted ids by semantic identity: same name AND same typeKey.
 * A drifted pair is one other-side workspace whose id is absent on the
 * current side but whose name + typeKey match a current-side workspace
 * exactly. The match must be unambiguous — if two candidates share the
 * same semantic identity, neither is paired (no guessing). Type is part
 * of the key: a type change is a destructive recreate (round 152), i.e.
 * a different instance, not the same workspace with a drifted id.
 */
function findDriftPairs(
  currentNodes: Map<string, TopologyNodePayload>,
  otherNodes: Map<string, TopologyNodePayload>,
): Map<string, string> {
  const drift = new Map<string, string>(); // other id → current id
  for (const [currentId, currentNode] of currentNodes) {
    if (otherNodes.has(currentId)) continue; // exact id match already covers it
    const candidates = [...otherNodes].filter(([otherId, otherNode]) => {
      if (currentNodes.has(otherId)) return false; // exact-matched on the other side
      if (drift.has(otherId)) return false; // already claimed by a previous pair
      return (
        otherNode.name === currentNode.name &&
        otherNode.metadata?.['typeKey'] === currentNode.metadata?.['typeKey']
      );
    });
    if (candidates.length === 1) {
      drift.set(candidates[0]![0], currentId);
    }
  }
  return drift;
}

// ── Canvas overlay descriptors (round 158) ───────────────────────
//
// The Compare panel's spatial diff: the other branch's topology rendered
// over the canvas. Other-only workspaces become ghost cards at their
// SAVED positions in the other diagram; current-only workspaces get a red
// marker on their existing card; shared-but-differing workspaces an amber
// one. Pure and display-only — the editor consumes the descriptor list
// and never writes anything back.

export interface TopologyOverlay {
  /** Other-only workspaces: render as ghost cards at the other diagram's
   *  saved positions (its coordinates, not the current side's). */
  ghosts: Array<{ id: string; name: string; x: number; y: number }>;
  /** Current-only workspace ids: a red marker on the existing card. */
  onlyHere: string[];
  /** Shared-but-differing workspace ids: an amber marker on the existing
   *  card. A drifted-id pair (round 155) is shared — it lands here only
   *  when its wiring actually differs. */
  differing: string[];
  /** The other diagram's wires, carried for the ghost-wire stubs (round
   *  160): the editor draws dashed connectors between ghost workspaces
   *  that are wired together in the other branch. */
  otherWires: TopologyWirePayload[];
  /** Shared workspaces' other-side id → current-side id (round 161): both
   *  exact id matches and drift pairs (round 155). The editor resolves
   *  each current-side id to its LIVE card so a ghost's wire to a shared
   *  workspace can draw a stub to the real card. */
  sharedByOtherId: Array<{ otherId: string; currentId: string }>;
}

export function buildTopologyOverlay(
  current: TopologyDiagram | null,
  other: TopologyDiagram | null,
): TopologyOverlay {
  const comparison = compareBranchTopologies(current, other);

  const otherPos = new Map(
    (other?.nodes ?? [])
      .filter((n) => n.type === 'workspace')
      .map((n) => [n.id, n] as const),
  );
  const currentPos = new Map(
    (current?.nodes ?? [])
      .filter((n) => n.type === 'workspace')
      .map((n) => [n.id, n] as const),
  );

  const ghosts: TopologyOverlay['ghosts'] = [];
  for (const ref of comparison.onlyInOther) {
    const node = otherPos.get(ref.id);
    if (!node) continue;
    ghosts.push({ id: ref.id, name: ref.name, x: node.x, y: node.y });
  }

  const onlyHere = comparison.onlyInCurrent
    .map((ref) => ref.id)
    .filter((id) => currentPos.has(id));
  const differing = comparison.differing
    .map((ref) => ref.id)
    .filter((id) => currentPos.has(id));

  // Shared workspace pairing for the ghost→shared stubs: drift pairs first
  // (deterministic order), then exact id matches.
  const sharedByOtherId: TopologyOverlay['sharedByOtherId'] = [];
  const drift = findDriftPairs(currentPos, otherPos);
  for (const [otherId, currentId] of drift) {
    sharedByOtherId.push({ otherId, currentId });
  }
  for (const otherId of otherPos.keys()) {
    if (currentPos.has(otherId)) {
      sharedByOtherId.push({ otherId, currentId: otherId });
    }
  }

  return { ghosts, onlyHere, differing, otherWires: other?.wires ?? [], sharedByOtherId };
}

// ── Ghost-wire stubs (round 160) ─────────────────────────────────
//
// Ghost cards alone read as floating boxes. Stubs draw the other
// branch's ghost-to-ghost wiring as dashed connectors between the LAID-
// OUT ghost positions, so a missing satellite cluster (several
// workspaces wired together, none present here) reads as a recognizable
// mini-topology. Ghost→shared-workspace connections are deliberately
// NOT drawn: the far end lives on the live canvas and would need drift-
// resolved, position-aware endpoints — a separate slice. Pure,
// display-only, deterministic.

export interface GhostWireStub {
  /** The other diagram's wire id — the stable render key. */
  id: string;
  /** Ghost endpoint ids as authored in the other diagram. */
  fromId: string;
  toId: string;
  /** Card-edge midpoint endpoints, computed from the laid-out ghosts. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Edge midpoints of card A facing card B, and vice versa. Cards are the
 *  ghost/live-card bounds (all 240×240, so size is fixed by the constants). */
function stubEndpoints(
  a: GhostBounds,
  b: GhostBounds,
): { x1: number; y1: number; x2: number; y2: number } {
  const aCx = a.x + a.width / 2;
  const aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2;
  const bCy = b.y + b.height / 2;
  const dx = bCx - aCx;
  const dy = bCy - aCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Side-by-side: exit/enter on the facing left/right edge midpoints.
    if (dx >= 0) {
      return { x1: a.x + a.width, y1: aCy, x2: b.x, y2: bCy };
    }
    return { x1: a.x, y1: aCy, x2: b.x + b.width, y2: bCy };
  }
  // Above/below: exit/enter on the facing top/bottom edge midpoints.
  if (dy >= 0) {
    return { x1: aCx, y1: a.y + a.height, x2: bCx, y2: b.y };
  }
  return { x1: aCx, y1: a.y, x2: bCx, y2: b.y + b.height };
}

/** A ghost placement as a card bounds rect. */
function ghostBounds(g: GhostPlacement): GhostBounds {
  return { x: g.x, y: g.y, width: GHOST_WIDTH, height: GHOST_HEIGHT };
}

// ── Compare focus (round 162) ────────────────────────────────────
//
// The compare panel's "focus on differences" mode: every shared-
// identical workspace dims so only the differences — only-here cards,
// differing cards, ghosts, and their stubs — stay bright. Pure:
// current-side ids, derived from the overlay's own classification.

export function compareFocusDimIds(overlay: TopologyOverlay): string[] {
  const differing = new Set(overlay.differing);
  return overlay.sharedByOtherId
    .map((p) => p.currentId)
    .filter((id) => !differing.has(id));
}

export function buildGhostWireStubs(
  wires: TopologyWirePayload[],
  ghosts: GhostPlacement[],
  farByOtherId: ReadonlyMap<string, GhostBounds> = new Map(),
): GhostWireStub[] {
  if (ghosts.length === 0) return [];
  const ghostById = new Map(ghosts.map((g) => [g.id, g]));
  const stubs: GhostWireStub[] = [];
  for (const wire of wires) {
    const a = ghostById.get(wire.from_node_id);
    const b = ghostById.get(wire.to_node_id);
    if (a && b) {
      // Ghost↔ghost (round 160): both endpoints are laid-out ghosts.
      stubs.push({
        id: wire.id,
        fromId: a.id,
        toId: b.id,
        ...stubEndpoints(ghostBounds(a), ghostBounds(b)),
      });
      continue;
    }
    // Ghost→shared (round 161): exactly one endpoint is a ghost; the far
    // end is a shared workspace the caller resolved to a LIVE card. No far
    // position (card not on the canvas) → no stub.
    const ghost = a ?? b;
    if (!ghost) continue; // neither endpoint is a ghost
    const farOtherId = a ? wire.to_node_id : wire.from_node_id;
    const farBounds = farByOtherId.get(farOtherId);
    if (!farBounds) continue;
    stubs.push({
      id: wire.id,
      fromId: a ? a.id : farOtherId,
      toId: a ? farOtherId : (b as GhostPlacement).id,
      ...stubEndpoints(ghostBounds(ghost), farBounds),
    });
  }
  return stubs;
}

// ── Ghost layout (round 159) ──────────────────────────────────────
//
// Ghosts are placed at the OTHER diagram's saved world coordinates, so a
// branch authored on a different canvas size — or after a big pan/zoom —
// can leave ghosts off-screen or piled onto live cards. layoutGhosts
// clamps every ghost card into the VISIBLE world-rect (derived from the
// canvas size and the pan/zoom transform: world = (screen − pan) / zoom)
// and resolves collisions with a deterministic downward stack: the first
// ghost in input order keeps its clamped spot, each later ghost drops
// below the lowest rect it would overlap. Pure and deterministic — the
// same input always lays out the same way, so the overlay never flickers.

export interface GhostPlacement {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface GhostViewport {
  /** Canvas client size in screen px (falls back to 800×600 pre-layout). */
  width: number;
  height: number;
  pan: { x: number; y: number };
  zoom: number;
}

export interface GhostBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ghost card size in world units — matches the overlay CSS (240×240). */
export const GHOST_WIDTH = 240;
export const GHOST_HEIGHT = 240;
/** Vertical gap between stacked ghosts / below an occupied card. */
const GHOST_STACK_GAP = 8;

function rectsOverlap(a: GhostBounds, b: GhostBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Clamp `v` into [lo, hi] (order-agnostic: works when lo > hi). */
function clampInto(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
}

/** Clamp a card's top-left into [lo, hi]: anchor it inside the rect, and
 *  when the card fits, keep it fully inside (top-left within [lo, hi − size]). */
function clampCard(v: number, lo: number, hi: number, size: number): number {
  const anchored = clampInto(v, lo, hi);
  if (hi - lo >= size) return clampInto(anchored, lo, hi - size);
  return anchored;
}

export function layoutGhosts(
  ghosts: GhostPlacement[],
  viewport: GhostViewport,
  occupied: GhostBounds[] = [],
): GhostPlacement[] {
  // Visible world-rect: screen coords mapped back through the transform.
  // `0 - x` (not `-x`): a zero pan must stay +0, not -0 — a -0 position
  // renders fine but poisons deep-equality checks on the layout.
  const left = (0 - viewport.pan.x) / viewport.zoom;
  const top = (0 - viewport.pan.y) / viewport.zoom;
  const right = (viewport.width - viewport.pan.x) / viewport.zoom;
  const bottom = (viewport.height - viewport.pan.y) / viewport.zoom;

  const placed: GhostBounds[] = [...occupied];
  return ghosts.map((g) => {
    let x = clampCard(g.x, left, right, GHOST_WIDTH);
    let y = clampCard(g.y, top, bottom, GHOST_HEIGHT);

    // Resolve collisions deterministically (bounded so pathological inputs
    // terminate): first drop below the lowest blocker; when the stack runs
    // out of vertical room, wrap LEFT of the column — every move keeps the
    // card inside the visible rect, so a pile-up stays legible instead of
    // cascading off-screen.
    let guard = 0;
    while (guard < 64) {
      const self = { x, y, width: GHOST_WIDTH, height: GHOST_HEIGHT };
      const blockers = placed.filter((p) => rectsOverlap(self, p));
      if (blockers.length === 0) break;

      const lowest = blockers.reduce((acc, p) => Math.max(acc, p.y + p.height), -Infinity);
      const downY = lowest + GHOST_STACK_GAP;
      if (downY + GHOST_HEIGHT <= bottom) {
        y = downY;
      } else {
        const leftmost = blockers.reduce((acc, p) => Math.min(acc, p.x), Infinity);
        const leftX = leftmost - GHOST_WIDTH - GHOST_STACK_GAP;
        if (leftX < left) break; // no room anywhere — accept the overlap
        x = leftX;
      }
      guard += 1;
    }

    placed.push({ x, y, width: GHOST_WIDTH, height: GHOST_HEIGHT });
    return { id: g.id, name: g.name, x, y };
  });
}

export function compareBranchTopologies(
  current: TopologyDiagram | null,
  other: TopologyDiagram | null,
): BranchTopologyComparison {
  const currentNodes = new Map(
    (current?.nodes ?? [])
      .filter((n) => n.type === 'workspace')
      .map((n) => [n.id, n] as const),
  );
  const otherNodes = new Map(
    (other?.nodes ?? [])
      .filter((n) => n.type === 'workspace')
      .map((n) => [n.id, n] as const),
  );

  // Pair drifted ids first so shared counting and wiring comparison see
  // semantic identity, not raw ids.
  const drift = findDriftPairs(currentNodes, otherNodes);

  const onlyInCurrent: BranchWorkspaceRef[] = [];
  const onlyInOther: BranchWorkspaceRef[] = [];
  const differing: DifferingWorkspace[] = [];

  const matchedCurrent = new Set<string>(drift.values());
  const matchedOther = new Set<string>(drift.keys());

  let shared = 0;
  for (const [id, node] of currentNodes) {
    if (!otherNodes.has(id) && !matchedCurrent.has(id)) {
      onlyInCurrent.push({ id, name: node.name });
    }
  }
  for (const [id, node] of otherNodes) {
    if (!currentNodes.has(id) && !matchedOther.has(id)) {
      onlyInOther.push({ id, name: node.name });
    } else if (currentNodes.has(id)) {
      shared += 1;
    }
  }
  shared += drift.size;

  const currentWiring = wiringByNode(current);
  const otherWiring = wiringByNodeRemapped(other, drift);

  const otherIdByCurrentId = new Map<string, string>();
  for (const [otherId, currentId] of drift) {
    otherIdByCurrentId.set(currentId, otherId);
  }

  for (const [id, node] of currentNodes) {
    const otherNode = otherNodes.get(id) ?? otherNodes.get(otherIdByCurrentId.get(id) ?? '');
    if (!otherNode) continue;
    const reasons: DifferingWorkspace['reasons'] = [];
    if (node.name !== otherNode.name) reasons.push('name');
    if (node.metadata?.['typeKey'] !== otherNode.metadata?.['typeKey']) reasons.push('type');
    if (!setsEqual(currentWiring.get(id), otherWiring.get(id))) reasons.push('wiring');
    if (reasons.length > 0) {
      differing.push({ id, name: node.name, reasons });
    }
  }

  return { onlyInCurrent, onlyInOther, shared, differing };
}
