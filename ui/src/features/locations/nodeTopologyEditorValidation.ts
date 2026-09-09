//! Validation cluster for the topology editor (Phase 5 slice P5-B/S4).
//!
//! Owns everything derived FROM the live validation result, not the result
//! itself: the tier-downgrade capacity readout, the panel state and its toggle,
//! the aggregated issue list, mark-issue-resolved dismissal (node and
//! graph-level key variants) with its forget effect, the panel's select /
//! jump-to-wire / add-stock-wire handlers, the visible-vs-dismissed filters
//! that the button count, the banner and the card notes all read from one
//! source, the per-card stable error map, the excess-count badges, the
//! pre-existing overlap set and the branch-overlay marker map.
//!
//! Bodies, comments and effects are BYTE-IDENTICAL to the inline originals.
//! TWO sanctioned dep-array additions, both the same stable identity:
//! setResolvedIssues, listed on the dismissal callback and on the forget
//! effect. Measured, not assumed: a setState produced by useState in the
//! PARENT is treated as reactive once it arrives as a prop, so the exemption
//! the inline code enjoyed (a same-scope state setter needs no listing) does
//! not survive the move. That identity never changes, so neither memo boundary
//! nor effect re-run cadence moves; the precedent is the clipboard's
//! canvasRef, the io hook's l10nRef and slice P5-B/S3's wiresRef and
//! pushHistoryRef. Every other name the moved code reads is either a deps
//! field its own array already names, hook-local state, or - for issueKey and
//! graphIssueKey - a MODULE-scope const that moved here with them, so
//! react-hooks 7.1.1 still sees a non-reactive binding and demands nothing.
//! No suppressions.
//!
//! liveValidation deliberately STAYS in the component: the migration hook
//! derives from it, so hoisting it here would either cross that call or drag
//! the whole migration slice with it. It arrives back here as a dep.
//!
//! The two key formats the dismissal store is written under are re-declared
//! here exactly as nodeTopologyEditorApplyPanel.ts already re-declares the node
//! one (a module-local alias of the contract's topologyIssueKey), rather than
//! imported from the component - which keeps this module free of any value
//! export crossing back into the editor.
//!
//! The call site is the slot the cluster occupied, directly below the
//! migration call and above every consumer, and the block moved in its own
//! original internal order, so hook order - and therefore effect order - is
//! unchanged.

import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import { topologyIssueKey, type TopologyValidationError } from './topologyContract';
import { findOverlappingNodeIds, NODE_WIDTH, NODE_HEIGHT } from './nodeTopologyClamp';
import type { TopologyNodeData, TopologyWireData } from './nodeTopologyEditorTypes';

/** Stable keys identifying a validation issue for mark-issue-resolved
 *  persistence: a node issue is scoped by its card + message, a graph-level
 *  issue by its message alone. Module-scope so every surface (panel, banner,
 *  card notes) derives the same key from the same error. The node key format
 *  lives in the contract so the screen's Apply gate reads the same store. */
const issueKey = topologyIssueKey;
const graphIssueKey = (messageId: string) => `graph:${messageId}`;

export interface TopologyValidationDeps {
  /** Parent-owned: the migration hook derives from it, so it cannot move here. */
  liveValidation: {
    byNode: Map<string, TopologyValidationError[]>;
    byWire: Map<string, TopologyValidationError[]>;
    graphLevel: TopologyValidationError[];
  };
  nodes: TopologyNodeData[];
  /** Read by the wire-jump handler to resolve a wire's endpoints. */
  wires: TopologyWireData[];
  /** id -> node, for panel row names and the jump handlers. */
  nodeMap: Map<string, TopologyNodeData>;
  /** Dismissed-issue key set: read by the visible filters, written by the
   *  dismissal callbacks, pruned by the forget effect. Parent-owned because
   *  the canvas-replacement path restores it from the branch document. */
  resolvedIssues: Set<string>;
  setResolvedIssues: (value: SetStateAction<Set<string>>) => void;
  /** Rendered-wire geometry, for the banner decluttering rule. */
  wireGeometries: { has(id: string): boolean };
  /** Branch-compare classification, or null while no comparison is active. */
  /** The parent's compare prop is optional, so undefined is legal input here
   *  exactly as it was inside the component. */
  compareOverlay: { onlyHere?: string[]; differing?: string[] } | null | undefined;
  /** Gates the forget effect until the real diagram has landed. */
  topologyLoaded: boolean;
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Selection reducers used by the panel's jump affordances. */
  selectOnly: (id: string) => void;
  selectWire: (id: string) => void;
  centerViewportOn: (x: number, y: number) => void;
}

/**
 * The validation surfaces, with the same per-render identities the inline
 * originals had.
 */
export function useTopologyEditorValidation(deps: TopologyValidationDeps): {
  hasCapacityMetadata: boolean;
  validationPanelOpen: boolean;
  /** Returned so the apply-panel call below keeps closing the panel after a
   *  successful apply; the setter identity is useState's, unchanged. */
  setValidationPanelOpen: (value: SetStateAction<boolean>) => void;
  toggleValidationPanel: () => void;
  visibleNodeIssues: Array<{ nodeId: string; nodeName: string; messageId: string; code: string }>;
  visibleGraphLevel: TopologyValidationError[];
  bannerGraphLevel: TopologyValidationError[];
  totalIssues: number;
  addStockWireHintId: string | null;
  handleAddStockWireHint: (nodeId: string) => void;
  handleJumpToWire: (wireId: string) => void;
  selectIssueNode: (nodeId: string) => void;
  handleDismissNodeIssue: (nodeId: string, messageId: string) => void;
  handleDismissGraphIssue: (messageId: string) => void;
  nodeErrorsByNode: Map<string, TopologyValidationError[]>;
  excessBadgeByNode: Map<string, string>;
  overlappingNodeIds: Set<string>;
  overlayMarkerById: Map<string, 'only-here' | 'differing'>;
} {
  const {
    liveValidation,
    nodes,
    wires,
    nodeMap,
    resolvedIssues,
    setResolvedIssues,
    wireGeometries,
    compareOverlay,
    topologyLoaded,
    l10n,
    selectOnly,
    selectWire,
    centerViewportOn,
  } = deps;

  /** True when any warehouse carries design-time capacity numbers — the
   *  tier-downgrade notice's trigger. The numbers were authored (Pro)
   *  but the capacity guards are suppressed on the current tier, so the
   *  user must be told the checks aren't running. */
  const hasCapacityMetadata = useMemo(
    () => nodes.some((n) => n.type === 'warehouse' && typeof n.metadata?.['capacity'] === 'number'),
    [nodes],
  );

  /** Aggregated issue list for the validation panel: per-node problems
   *  first (actionable — clicking jumps to the node), then graph-level. */
  const [validationPanelOpen, setValidationPanelOpen] = useState(false);
  const toggleValidationPanel = useCallback(() => setValidationPanelOpen((o) => !o), []);
  const nodeIssues = useMemo(() => {
    const out: Array<{ nodeId: string; nodeName: string; messageId: string; code: string }> = [];
    for (const [nodeId, errs] of liveValidation.byNode) {
      const nodeName = nodeMap.get(nodeId)?.name ?? nodeId;
      for (const e of errs) out.push({ nodeId, nodeName, messageId: e.messageId, code: e.code });
    }
    return out;
  }, [liveValidation, nodeMap]);

  /** Mark-issue-resolved: dismissals of validation issues live in the
   *  branch topology document, not browser-local storage. Dismissals are
   *  occurrence-scoped — the forget effect drops a key once the issue leaves
   *  the live set, so a genuinely new occurrence surfaces again. */
  // useCallback: the card consumes this via the memoized TopologyNodeCard
  // (round 66 boundary) — an unstable identity would re-render every card.
  const dismissIssue = useCallback(
    (key: string) =>
      setResolvedIssues((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      }),
    // setResolvedIssues listed: a parent useState setter arriving as a prop is
    // reactive to the rule. Stable identity, so nothing re-runs that didn't.
    [setResolvedIssues],
  );
  const handleDismissNodeIssue = useCallback(
    (nodeId: string, messageId: string) => dismissIssue(issueKey(nodeId, messageId)),
    [dismissIssue],
  );
  const handleDismissGraphIssue = useCallback(
    (messageId: string) => dismissIssue(graphIssueKey(messageId)),
    [dismissIssue],
  );
  /** Select a node from the validation panel: close the panel and select it. */
  const selectIssueNode = useCallback(
    (nodeId: string) => {
      setValidationPanelOpen(false);
      selectOnly(nodeId);
    },
    [selectOnly],
  );
  /** Visible (non-dismissed) issues drive the button count, the panel, the
   *  banner, and the card notes — every surface reads the same filtered
   *  lists so they can never disagree. */
  const visibleNodeIssues = useMemo(
    () => nodeIssues.filter((i) => !resolvedIssues.has(issueKey(i.nodeId, i.messageId))),
    [nodeIssues, resolvedIssues],
  );
  const visibleGraphLevel = useMemo(
    () => liveValidation.graphLevel.filter((e) => !resolvedIssues.has(graphIssueKey(e.messageId))),
    [liveValidation, resolvedIssues],
  );
  /** Banner-only graph-level issues (round 111): a wireId-only error whose
   *  wire RENDERS (has geometry) is carried by the canvas marker + the
   *  jumpable panel row, so the banner is decluttered for it. Errors
   *  without a canvas anchor stay: true graph-level errors, and wires that
   *  can't render (ghost endpoint → no geometry → no marker). */
  const bannerGraphLevel = useMemo(
    () => visibleGraphLevel.filter((err) => !err.wireId || !wireGeometries.has(err.wireId)),
    [visibleGraphLevel, wireGeometries],
  );
  const totalIssues = visibleNodeIssues.length + visibleGraphLevel.length;

  /** One-click "Add stock wire" guidance (round 80): the validation panel
   *  entry for a warehouse-missing-stock-routing issue jumps to the
   *  warehouse, centers it, and sets this id so the card shows a hint chip
   *  that tells the user exactly what to connect. The clear effect below
   *  drops the hint the moment the error resolves (a wire landed), so the
   *  chip can never outlive the problem it guides. */
  const [addStockWireHintId, setAddStockWireHintId] = useState<string | null>(null);
  useEffect(() => {
    if (!addStockWireHintId) return;
    const stillMissing = liveValidation.byNode
      .get(addStockWireHintId)
      ?.some((e) => e.code === 'warehouse-missing-stock-routing');
    if (!stillMissing) setAddStockWireHintId(null);
  }, [liveValidation, addStockWireHintId]);
  const handleAddStockWireHint = (nodeId: string) => {
    setValidationPanelOpen(false);
    const node = nodeMap.get(nodeId);
    if (node) centerViewportOn(node.x + NODE_WIDTH / 2, node.y + NODE_HEIGHT / 2);
    selectOnly(nodeId);
    setAddStockWireHintId(nodeId);
  };

  /** Wire-scoped jump (round 109 follow-up): a wireId-only validation item
   *  (invalid-semantic-connection, duplicate-wire, ambiguous-legacy-wire,
   *  invalid-location-connection, unknown-wire-endpoint) selects + centers
   *  the offending wire instead of leaving the user to hunt for it.
   *  Mirrors handleAddStockWireHint's close/center/select shape, but on
   *  the wire model — the midpoint of the two endpoint node centers. */
  const handleJumpToWire = (wireId: string) => {
    setValidationPanelOpen(false);
    const wire = wires.find((w) => w.id === wireId);
    if (!wire) return;
    const from = nodeMap.get(wire.fromNodeId);
    const to = nodeMap.get(wire.toNodeId);
    if (from && to) {
      centerViewportOn((from.x + to.x) / 2 + NODE_WIDTH / 2, (from.y + to.y) / 2 + NODE_HEIGHT / 2);
    }
    selectWire(wireId);
    // Keyboard parity (round 112): land focus on the wire's hitbox
    // (tabIndex=0) so the keyboard user can act immediately — cycle
    // direction, Delete, relabel — instead of hunting for the wire after
    // the jump. Best-effort: a ghost-endpoint wire renders no hitbox, so
    // the query misses and focus stays put.
    (document.querySelector(`.wire-hitbox[data-wire-id="${wireId}"]`) as HTMLElement | null)?.focus();
  };

  /** Per-card visible errors, memoized so the memoized node cards receive a
   *  STABLE nodeErrors prop (a per-render `.filter()` would defeat the memo
   *  for every card carrying an issue). */
  const nodeErrorsByNode = useMemo(() => {
    const m = new Map<string, TopologyValidationError[]>();
    for (const n of nodes) {
      const errs = liveValidation.byNode
        .get(n.id)
        ?.filter((e) => !resolvedIssues.has(issueKey(n.id, e.messageId)));
      if (errs && errs.length > 0) m.set(n.id, errs);
    }
    return m;
  }, [nodes, liveValidation, resolvedIssues]);

  /** Compact excess-count chip (round 113): a node carrying
   *  warehouse-tier-limit shows "N Stock Rooms — 1 allowed"; one carrying
   *  multiple-branch-locations shows "N Branch Locations — 1 allowed".
   *  The card note already says WHAT is wrong; the badge says HOW MANY are
   *  in play at a glance, without opening the panel. Only excess nodes
   *  (the ones the errors pin to) get the badge. */
  const excessBadgeByNode = useMemo(() => {
    const m = new Map<string, string>();
    const warehouseCount = nodes.filter((n) => n.type === 'warehouse').length;
    const branchCount = nodes.filter((n) => n.type === 'store').length;
    for (const [nodeId, errs] of liveValidation.byNode) {
      if (errs.some((e) => e.code === 'warehouse-tier-limit')) {
        m.set(nodeId, l10n.getString('topology-warehouse-excess-badge', { count: warehouseCount }));
      } else if (errs.some((e) => e.code === 'multiple-branch-locations')) {
        m.set(nodeId, l10n.getString('topology-branch-excess-badge', { count: branchCount }));
      }
    }
    return m;
  }, [liveValidation, nodes, l10n]);

  /** Pre-existing overlaps in the loaded diagram (round 143): the
   *  no-overlap invariant guards spawns, drops (140), nudges (141) and
   *  auto-layout (142), but old saved diagrams can still load stacked.
   *  Flag the offending cards non-destructively — a badge, never an
   *  auto-jump (a silent move on load would be a worse surprise). */
  const overlappingNodeIds = useMemo(
    () => findOverlappingNodeIds(nodes),
    [nodes],
  );

  /** Per-card overlay marker (round 158): current-only workspaces get the
   *  red 'only-here' marker, shared-but-differing ones the amber 'differing'
   *  marker. Derived from the compare panel's classification — the canvas
   *  and the name lists can never disagree. Null keeps the memo boundary
   *  clean when no comparison is active. */
  const overlayMarkerById = useMemo(() => {
    const map = new Map<string, 'only-here' | 'differing'>();
    for (const id of compareOverlay?.onlyHere ?? []) map.set(id, 'only-here');
    for (const id of compareOverlay?.differing ?? []) map.set(id, 'differing');
    return map;
  }, [compareOverlay]);

  /** Forget a dismissal once its issue is genuinely gone. Gated on
   *  topologyLoaded so the preset placeholder shown during the async load
   *  can never wipe restored dismissals (see the load effect's finally). */
  useEffect(() => {
    if (!topologyLoaded) return;
    const live = new Set<string>();
    for (const [nodeId, errs] of liveValidation.byNode) {
      for (const e of errs) live.add(issueKey(nodeId, e.messageId));
    }
    for (const e of liveValidation.graphLevel) live.add(graphIssueKey(e.messageId));
    setResolvedIssues((prev) => {
      const kept = new Set<string>();
      let changed = false;
      for (const k of prev) {
        if (live.has(k)) kept.add(k);
        else changed = true;
      }
      return changed ? kept : prev;
    });
  // setResolvedIssues listed for the same reason as above; stable identity.
  }, [liveValidation, topologyLoaded, setResolvedIssues]);

  return {
    hasCapacityMetadata,
    validationPanelOpen,
    setValidationPanelOpen,
    toggleValidationPanel,
    visibleNodeIssues,
    visibleGraphLevel,
    bannerGraphLevel,
    totalIssues,
    addStockWireHintId,
    handleAddStockWireHint,
    handleJumpToWire,
    selectIssueNode,
    handleDismissNodeIssue,
    handleDismissGraphIssue,
    nodeErrorsByNode,
    excessBadgeByNode,
    overlappingNodeIds,
    overlayMarkerById,
  };
}
