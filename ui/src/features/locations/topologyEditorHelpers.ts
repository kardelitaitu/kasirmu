/**
 * Pure, side-effect-free helpers extracted from `NodeTopologyEditor.tsx`
 * (Phase 1 of the 6803-line component split). Everything here has no React
 * dependency: port normalization, wire geometry, canvas-state equality,
 * alignment guides, overflow detection, error classification, motion
 * preference, and the Apply-gate validation wrapper.
 *
 * These were previously module-private in the editor (exported only for
 * unit tests); `NodeTopologyEditor.tsx` re-exports them so existing
 * importers and tests are unaffected.
 */

import { parseAppError } from '@/utils/app-error';
import { NODE_WIDTH, NODE_HEIGHT } from './nodeTopologyClamp';
import {
  normalizeTopologyGraph,
  validateTopologyGraph,
  type TopologyValidationError,
} from './topologyContract';
import type { TopologyNodeData, TopologyWireData, PortName } from './NodeTopologyEditor';

/** Convert legacy vertical anchors to the UX's canonical left/right sides.
 *  Exported for unit tests. */
export function normalizeVisualPort(port: string | null | undefined, fallback: PortName): PortName {
  if (port === 'top' || port === 'bottom') return fallback;
  if (port === 'left' || port === 'right') return port;
  return fallback;
}

/** Orthogonal elbow routing: from the source port, run horizontally to the
 *  midpoint, drop/rise to the target row, then run into the target port.
 *  When the target sits BEHIND the source (reverse flows), detour right
 *  past the source before dropping, so the elbow never folds back through
 *  the source card. Returns the polyline vertices in canvas coords.
 *  Exported for unit tests. */
export function elbowPoints(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
  if (x2 < x1) {
    const detour = x1 + 48;
    return [[x1, y1], [detour, y1], [detour, y2], [x2, y2]];
  }
  const mx = (x1 + x2) / 2;
  return [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
}

/** SVG path for a polyline of H/V segments. Exported for unit tests. */
export function polylineD(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  return `M ${pts[0]![0]} ${pts[0]![1]} ${pts.slice(1).map(([px, py]) => `L ${px} ${py}`).join(' ')}`;
}

/** Zero-allocation field-by-field canvas state equality. The original
 *  implementation projected every node/wire into a trimmed object, then
 *  compared via JSON.stringify — creating O(N+W) temporary arrays and
 *  strings per call. During a drag (~60 fps) that was the primary OOM
 *  vector. This compares without intermediate allocations. Exported for
 *  unit tests. */
export function canvasStateEqual(
  aNodes: TopologyNodeData[],
  aWires: TopologyWireData[],
  bNodes: TopologyNodeData[],
  bWires: TopologyWireData[],
): boolean {
  if (aNodes.length !== bNodes.length || aWires.length !== bWires.length) return false;
  for (let i = 0; i < aNodes.length; i++) {
    const a = aNodes[i]!;
    const b = bNodes[i]!;
    if (a.id !== b.id || a.type !== b.type || a.name !== b.name
      || (a.subtitle ?? '') !== (b.subtitle ?? '')
      || a.x !== b.x || a.y !== b.y) return false;
    if ((a.tierRequirement ?? null) !== (b.tierRequirement ?? null)) return false;
    // metadata is typed with an index signature — bracket access required.
    const am = a.metadata;
    const bm = b.metadata;
    if ((am?.['typeKey'] ?? null) !== (bm?.['typeKey'] ?? null)) return false;
    if ((am?.['purposeKey'] ?? null) !== (bm?.['purposeKey'] ?? null)) return false;
    if ((am?.['enabled'] ?? null) !== (bm?.['enabled'] ?? null)) return false;
    if ((am?.['capacity'] ?? null) !== (bm?.['capacity'] ?? null)) return false;
    if ((am?.['lowStockThreshold'] ?? null) !== (bm?.['lowStockThreshold'] ?? null)) return false;
    if ((am?.['stock'] ?? null) !== (bm?.['stock'] ?? null)) return false;
  }
  for (let i = 0; i < aWires.length; i++) {
    const a = aWires[i]!;
    const b = bWires[i]!;
    if (a.id !== b.id || a.fromNodeId !== b.fromNodeId || a.toNodeId !== b.toNodeId
      || a.direction !== b.direction) return false;
    if ((a.fromPort ?? null) !== (b.fromPort ?? null)) return false;
    if ((a.toPort ?? null) !== (b.toPort ?? null)) return false;
    if ((a.label ?? null) !== (b.label ?? null)) return false;
    const ab = a.bends;
    const bb = b.bends;
    const aLen = ab?.length ?? 0;
    const bLen = bb?.length ?? 0;
    if (aLen !== bLen) return false;
    if (aLen > 0 && ab && bb) {
      for (let j = 0; j < aLen; j++) {
        if (ab[j]!.x !== bb[j]!.x || ab[j]!.y !== bb[j]!.y) return false;
      }
    }
  }
  return true;
}

/** Canvas px the dragged node's edge/center may drift from a stationary
 *  node's before the alignment guide snaps it (Figma-style). */
const ALIGN_THRESHOLD = 6;

interface AlignmentResult {
  /** Guide line coordinate (canvas units) for a vertical (x) / horizontal
   *  (y) guide — present only while that axis is actively aligned. */
  x?: number;
  y?: number;
  /** Delta applied to every dragged node so the primary lands exactly on
   *  the aligned axis (keeps the group rigid). Zero when not aligned. */
  dx: number;
  dy: number;
  /** Whether each axis is under an active alignment — the aligned axis
   *  skips grid snapping (guides beat the grid). */
  alignedX: boolean;
  alignedY: boolean;
}

/** Figma-style COLLECTIVE alignment snap: match ANY edge/center of ANY
 *  dragged node against ANY edge/center of every STATIONARY node (all 9
 *  combos per node pair — left↔left, right↔left, centerX↔centerX, …).
 *  Within the threshold, the closest match across ALL dragged members wins
 *  per axis — so a group can snap on a non-grabbed member's edge, exactly
 *  like Figma. The resulting delta shifts the whole group rigidly. The
 *  dragged set is excluded from the reference pool so a group never aligns
 *  to itself. Exported for unit tests. */
export function computeAlignmentGuides(
  targets: Map<string, { x: number; y: number }>,
  draggedIds: Set<string>,
  nodes: TopologyNodeData[],
): AlignmentResult {
  let bestX: { target: number; dist: number } | null = null;
  let bestY: { target: number; dist: number } | null = null;
  for (const other of nodes) {
    if (draggedIds.has(other.id)) continue;
    const rAxesX = [other.x, other.x + NODE_WIDTH / 2, other.x + NODE_WIDTH];
    const rAxesY = [other.y, other.y + NODE_HEIGHT / 2, other.y + NODE_HEIGHT];
    for (const target of targets.values()) {
      const pAxesX = [target.x, target.x + NODE_WIDTH / 2, target.x + NODE_WIDTH];
      const pAxesY = [target.y, target.y + NODE_HEIGHT / 2, target.y + NODE_HEIGHT];
      for (const pAxis of pAxesX) {
        for (const rAxis of rAxesX) {
          const dx = pAxis - rAxis;
          if (Math.abs(dx) <= ALIGN_THRESHOLD && (!bestX || Math.abs(dx) < bestX.dist)) {
            bestX = { target: rAxis, dist: dx };
          }
        }
      }
      for (const pAxis of pAxesY) {
        for (const rAxis of rAxesY) {
          const dy = pAxis - rAxis;
          if (Math.abs(dy) <= ALIGN_THRESHOLD && (!bestY || Math.abs(dy) < bestY.dist)) {
            bestY = { target: rAxis, dist: dy };
          }
        }
      }
    }
  }
  return {
    ...(bestX ? { x: bestX.target } : {}),
    ...(bestY ? { y: bestY.target } : {}),
    dx: bestX?.dist ?? 0,
    dy: bestY?.dist ?? 0,
    alignedX: bestX !== null,
    alignedY: bestY !== null,
  };
}

/** True when the diagram's bounding box (plus zoomToFit's breathing room)
 *  exceeds the MEASURED canvas viewport — the trigger for the one-shot
 *  load auto-fit. A zero/negative measured size (jsdom, pre-layout) returns
 *  false so the identity view is never yanked by a phantom constraint.
 *  Exported for unit tests. */
export function diagramOverflowsCanvas(canvas: HTMLElement, nodes: TopologyNodeData[]): boolean {
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  if (viewW <= 0 || viewH <= 0 || nodes.length === 0) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_WIDTH);
    maxY = Math.max(maxY, n.y + NODE_HEIGHT);
  }
  const pad = 60;
  return maxX - minX + pad * 2 > viewW || maxY - minY + pad * 2 > viewH;
}

/** True when the thrown error is the backend's topology-revision-conflict
 *  (round 133). A stale base revision can never retry successfully, so the
 *  editor treats it differently from a generic save failure: it reloads the
 *  authoritative topology instead of keeping a canvas that can never apply.
 *  The backend serializes TopologyValidation as
 *  { kind: 'topologyValidation', code: 'topology-revision-conflict', ... }.
 *  Exported for unit tests. */
export function isTopologyRevisionConflict(err: unknown): boolean {
  const typed = parseAppError(err);
  return typed !== null
    && (typed as { kind?: string }).kind === 'topologyValidation'
    && (typed as { code?: string }).code === 'topology-revision-conflict';
}

/** True when the OS requests reduced motion (WCAG 2.3.3). The simulation
 *  pulse is JS-driven on a 30ms interval — CSS @media gates cannot stop
 *  the state churn — so the interval and the pulse position consult this
 *  directly. jsdom has no matchMedia: the safe default is false (animate),
 *  and the reduced-motion tests stub matchMedia to pin the gated path.
 *  Exported for unit tests. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Validate the editor's RAW canvas under the Apply gate. Legacy/demo
 *  canvases (no canonical branch identity) keep their non-blocking path
 *  unless the real topology screen opts into strict validation
 *  (allowLegacyApply=false). Shared by the live badge surface AND the
 *  Apply handler so the two can never drift apart. Exported for unit tests. */
export function validateEditorGraph(
  nodes: TopologyNodeData[],
  wires: TopologyWireData[],
  allowLegacyApply: boolean,
  tier: string,
): TopologyValidationError[] {
  const semanticGraph = normalizeTopologyGraph(nodes, wires);
  const hasCanonicalBranchIdentity = semanticGraph.nodes.some(
    (node) => node.kind === 'branch-location' && node.storeProfileId !== undefined,
  );
  // validateTopologyGraph owns the multi-warehouse tier cap (round 87) —
  // it pushes warehouse-tier-limit below Pro and the pure contract stays
  // strict by default. The creation paths still refuse a second warehouse
  // on the way in (tool-card/duplicate, wouldExceedWarehouseCap); this
  // gate catches the remaining routes (downgrade, loaded legacy, paste)
  // so Apply can never persist 2+ warehouses on a non-Pro install.
  return hasCanonicalBranchIdentity || !allowLegacyApply
    ? validateTopologyGraph(semanticGraph, tier)
    : [];
}
