//! Canvas pointer-core callbacks for the topology editor (Phase 3.4b + 3.4c).
//!
//! Slice 3.4c-1 folded in the node-drag trio — beginNodeDrag, applyDragMove,
//! finalizeNodeDrag and handleNodeMouseDown — because the canvas mousemove/mouseup
//! already fed the first two, and leaving them parent-side forced the parent to
//! forward them back in as deps. Their bodies and comments are byte-identical to
//! the inline originals; every gesture ref they read or write stays PARENT-declared
//! (the touch loop still shares them; the drag/pan teardown refs became hook-local
//! in stage 4A). The useCallback dep
//! arrays LIST those parent-owned refs/setters — stable identities, so identity
//! churn is unchanged (precedent 68a29a1e7) — instead of suppressing the rule.
//! Slice 3.4c-2 folded the duplicate cluster in as well — commitDuplicateDrag,
//! cancelDuplicateDrag, convertDragToDuplicate and cancelNodeMove — which is what
//! finally let the call site move: `commitDuplicateDrag` is now INTERNAL (the trio
//! call it) instead of a dep the parent had to forward back in.
//!
//! The trio are returned: `handleNodeMouseDown` is the memoized card's
//! `onCardMouseDown` prop and the touch loop drives `beginNodeDrag` /
//! `applyDragMove` / `finalizeNodeDrag` directly. The trio were the ONLY hooks
//! between the parent's `executeDelete` and the original canvas-handler block, so
//! calling them first inside this hook at that same call site keeps the component's
//! hook order — and therefore its effect order — exactly as it was. 3.4c-2 then
//! relocated the call site UP to the duplicate cluster's vacated position, so the
//! parent keydown effect (which sits below it) can name the three returned cancels.
//! The cluster were the ONLY hooks in that span, so the move re-slotted useCallbacks
//! only — every pre-existing parent effect kept the relative order it had before.
//! The hook now registers effects of its own: one per cleanup ref it
//! writes (drag/pan — hook-local since stage 4A — and marquee, still parent-owned),
//! each firing that ref's disposer at unmount. Since stage 4A these are the sole
//! unmount disposers — the editor's sweep is retired and clears only the
//! add-node timers (every disposer is a functional no-op on second invocation).
//! Owns the seven gestures the canvas element itself receives: handleCanvasMouseMove
//! (node-drag feed + marquee rect tracking + connection snap-to-port, including the
//! hoveredTarget identity-preserve rule that keeps memoized cards from re-rendering),
//! handleCanvasMouseUp, finalizeMarquee (direction-aware contain/touch hit-testing
//! committed at release), startPan (installs its own document-level listeners and
//! records their teardown in panCleanupRef), handleCanvasMouseDown (background gate +
//! Space/Pan-tool branch + marquee arm + middle/right pan), handleWheel
//! (zoom-to-cursor) and handleContextMenu — the consume-then-reset gate that swallows
//! the native contextmenu ending a right-button pan, lifted verbatim out of the JSX.
//!
//! Every body is copied byte-for-byte from the inline originals and each stays a
//! PLAIN function, not a useCallback: the originals were recreated on every render,
//! so wrapping them would change identity churn for the memoized TopologyNodeCard /
//! TopologyWireGroup props.
//!
//! The hook owns these callbacks plus the duplicate cluster. Every ref, state setter
//! and drag reducer they read stays parent-owned and arrives through deps: the editor
//! cancelMarquee, cancelBendDrag, resetTransientCanvasState and the load-lifecycle
//! call all consume those refs, so hoisting any of them here would split one gesture
//! across two owners. (Stage-4A exceptions: the drag/pan teardown refs are hook-owned
//! now.) The one parent declaration that DID move
//! is `userInteractedRef` — hoisted above the relocated call in the editor because a
//! hook call evaluates its args at render time; it stays parent-owned, only its
//! declaration site changed.

import { useCallback, useEffect, useRef, type MutableRefObject, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/frontend/shared/Toast';
import type { PortName, TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import {
  clampNodeToViewport,
  edgeAutoPanDelta,
  NODE_HEIGHT,
  NODE_WIDTH,
  resolveDropOverlaps,
} from './nodeTopologyClamp';
import type { TopologyHistoryEntry } from './nodeTopologyEditorState';
import { historyEntry } from './topologyHistoryIntegrity';
import { socketSemanticIds, sanitizeCopiedNode } from './topologyCard';
import { portRowCenterY } from './topologyMetrics';
import { moveLandedAtStart, restoreNodesToStart } from './topologyCommands';
import { computeAlignmentGuides } from './topologyEditorHelpers';

/** Mirrors the editor-local alias of the same name so the moved duplicate-commit
 *  body keeps its type annotation byte-for-byte.
 *  (NodeTopologyEditor.tsx declares the identical alias.) */
type HistoryEntry = TopologyHistoryEntry<TopologyNodeData, TopologyWireData>;

/** Selection box in container-relative screen px (identity pan/zoom space). */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Inline context-menu anchor, part of the parent's shared contextMenu payload. */
export interface ContextMenuPoint {
  x: number;
  y: number;
  nodeId?: string;
  wireId?: string;
}

export interface TopologyPointerDeps {
  /** Live viewport pan — screen-to-canvas coords use the same transform as every other gesture. */
  pan: { x: number; y: number };
  /** Live viewport zoom divisor, paired with pan. */
  zoom: number;
  /** Current node list: marquee hit-testing and connection snap candidates. */
  nodes: TopologyNodeData[];
  /** Source node of an in-flight connection drag; gates the snap-to-port branch. */
  connectingFromNodeId: string | null;
  /** Selection captured at mousedown, which an additive (Shift) marquee unions into. */
  selectedNodeIds: Set<string>;
  /** Whether the Pan tool is active — Space+drag parity without the modifier. */
  panToolActive: boolean;
  /** Canvas element providing the getBoundingClientRect origin for container-relative coords. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Raw cursor mirror, read by the drag feed and the connection preview. */
  mousePosRef: MutableRefObject<{ x: number; y: number }>;
  /** Marquee render-state mirror: a document-armed finalizer must never read a stale rect. */
  marqueeRef: MutableRefObject<MarqueeRect | null>;
  /** Marquee anchor in container-relative px, written at mousedown and read at release. */
  marqueeStartRef: MutableRefObject<{ x: number; y: number } | null>;
  /** True when the marquee began with Shift, so release unions instead of replaces. */
  marqueeAdditiveRef: MutableRefObject<boolean>;
  /** Document marquee-mouseup teardown, also fired by the parent cancelMarquee; the hook owns its unmount disposal. */
  marqueeCleanupRef: MutableRefObject<(() => void) | null>;
  /** Set by a real pan movement; the context-menu gate consumes then resets it once. */
  panMovedRef: MutableRefObject<boolean>;
  /** Pan origin in canvas space (client minus the pan at gesture start). */
  panStartRef: MutableRefObject<{ x: number; y: number }>;
  /** Live-pan flag guarding the document mousemove until the gesture ends. */
  isPanningRef: MutableRefObject<boolean>;
  /** Space modifier mirror, written by the parent keyboard effect (slice 3.4d). */
  spaceDownRef: MutableRefObject<boolean>;
  /** Sticky "user touched the canvas" flag: suppresses the auto-fit-viewport pass. */
  userInteractedRef: MutableRefObject<boolean>;
  /** Marquee rect state (null hides the box). */
  setMarquee: (value: SetStateAction<MarqueeRect | null>) => void;
  /** Connection-drag cursor in canvas space. */
  setPreviewCursor: (value: SetStateAction<{ x: number; y: number } | null>) => void;
  /** Snap-to-port target; rewritten only when its identity actually changes. */
  setHoveredTarget: (value: SetStateAction<{ nodeId: string; port: PortName; variantIndex: number } | null>) => void;
  /** Inline context-menu payload; a canvas mousedown closes any open menu. */
  setContextMenu: (value: SetStateAction<ContextMenuPoint | null>) => void;
  /** Viewport pan setter — used by the pan move listener and by zoom-to-cursor. */
  setPan: (value: SetStateAction<{ x: number; y: number }>) => void;
  /** Viewport zoom setter — wheel clamps to the same 0.4..2.0 range as the HUD. */
  setZoom: (value: SetStateAction<number>) => void;
  /** Mirrors an active pan into state so the cursor class and HUD follow it. */
  setPanGestureActive: (value: SetStateAction<boolean>) => void;
  // ── Node-drag trio (slice 3.4c-1): beginNodeDrag / applyDragMove /
  // finalizeNodeDrag / handleNodeMouseDown now live in this hook, so their
  // gesture refs and the parent callbacks they call arrive here instead of
  // being forwarded as `applyDragMove` / `finalizeNodeDrag` function deps
  // (those two fields are gone — the hook produces them and returns them).
  // Every ref stays parent-declared: the duplicate cluster (3.4c-2),
  // cancelNodeMove and the touch loop all read/write them.
  /** Live drag set — reducer mirror, read by the move feed and the commit. */
  draggingNodeIdsRef: MutableRefObject<Set<string>>;
  /** Selection mirror read at card mousedown so the handler stays stable. */
  selectedNodeIdsRef: MutableRefObject<Set<string>>;
  /** Live node mirror: drag offsets, alignment candidates, drop-overlap pass. */
  nodesRef: MutableRefObject<TopologyNodeData[]>;
  /** Live wire mirror — the Alt+drag copy set is built from it. */
  wiresRef: MutableRefObject<TopologyWireData[]>;
  /** Pan mirror: the drag math must read the CURRENT pan mid-auto-pan. */
  panRef: MutableRefObject<{ x: number; y: number }>;
  /** Zoom mirror, paired with panRef for the same reason. */
  zoomRef: MutableRefObject<number>;
  /** Per-node grip offset (canvas units) for every id in the drag set. */
  dragOffsetsRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  /** Pre-drag positions, keyed by dragged id: the no-op landing check. */
  dragStartRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  /** First-movement latch: history pushes once, and the no-op pop is gated. */
  dragHasMovedRef: MutableRefObject<boolean>;
  /** True while an in-flight drag is an Alt+drag duplicate. */
  duplicateDragRef: MutableRefObject<boolean>;
  /** Ids of the live duplicate copies (the drag set on the duplicate path). */
  duplicateCopyIdsRef: MutableRefObject<string[]>;
  /** Last pointer fed to applyDragMove — edge auto-pan's direction gate. */
  lastDragMovePosRef: MutableRefObject<{ x: number; y: number } | null>;
  /** Drag reducer: arm the set (writes the mirror synchronously). */
  beginDrag: (ids: Set<string>) => void;
  /** Drag reducer: end the drag at release/cancel. */
  endDrag: () => void;
  /** Drag reducer: drop the drag set without the end-of-gesture bookkeeping —
   *  both Escape cancels route through it. */
  cancelDrag: () => void;
  /** True when the mid-drag conversion already pushed the history entry that the
   *  commit reuses and the cancel pops. */
  duplicateHistoryPushedRef: MutableRefObject<boolean>;
  /** History push — once on the first real movement of a drag. */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Node graph setter — every drag write goes through it. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  /** Wire graph setter: the Alt+drag path inserts its wire copies. */
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** History setter — used only to pop a no-op drag's identical entry. */
  setHistory: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  /** Live alignment guide state (null hides the guides); cleared on finalize. */
  setAlignmentGuide: (value: SetStateAction<{ x?: number; y?: number } | null>) => void;
  /** Selection reducers the card mousedown routes through. */
  selectOnly: (id: string) => void;
  addToSelection: (id: string) => void;
  /** Tier-cap gate shared by every duplicate path ( refuses over-cap). */
  duplicateRefusal: (copies: TopologyNodeData[]) => string | null;
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Only `getString` is needed — for the refusal toast copy. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Grid-snap toggle state, read per move by the drag feed. */
  snapEnabled: boolean;
  /** 24px grid snap, shared with the seed/merge builders. */
  snap: (value: number) => number;
  /** Latest l10n, read at announce time by the duplicate commit/cancel. */
  l10nRef: { current: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] } };
  /** Live-region writer: the duplicate commit/cancel announce through it. */
  setLiveAnnouncement: (message: string) => void;
  /** Redo-stack setter — a duplicate commit invalidates the redo branch. */
  setRedo: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  /** Selection reducer: the marquee commits its hit set through it. */
  selectMany: (ids: string[], primary: string | null) => void;
  /** Selection reducer: a background press and a hitless marquee clear it. */
  clearSelection: () => void;
  /** Connection reducer: a background press drops a staged wire. */
  clearWire: () => void;
  /** Relationship-picker close: a background click fully cancels an open picker. */
  dismissPicker: () => void;
}

/**
 * The canvas pointer core, with the same per-render identities the inline originals had.
 */
export function useTopologyEditorPointer(deps: TopologyPointerDeps): {
  handleCanvasMouseMove: (e: React.MouseEvent) => void;
  handleCanvasMouseUp: () => void;
  handleCanvasMouseDown: (e: React.MouseEvent) => void;
  handleWheel: (e: React.WheelEvent) => void;
  finalizeMarquee: () => void;
  startPan: (e: React.MouseEvent, clearSelectionFirst: boolean) => void;
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Node-drag trio (slice 3.4c-1) — returned because the parent's touch
   *  gesture loop and the memoized card prop still consume them. */
  handleNodeMouseDown: (e: React.MouseEvent, nodeId: string) => void;
  beginNodeDrag: (
    clientX: number,
    clientY: number,
    selection: Set<string>,
    isDuplicateDrag: boolean,
    gesture: 'mouse' | 'touch',
  ) => void;
  applyDragMove: (clientX: number, clientY: number) => void;
  finalizeNodeDrag: () => void;
  /** Duplicate cluster (slice 3.4c-2) — returned because the parent keydown
   *  effect's Escape ladder and its Alt mid-move branch consume them.
   *  commitDuplicateDrag deliberately is NOT returned: it is internal now. */
  cancelDuplicateDrag: () => void;
  convertDragToDuplicate: () => void;
  cancelNodeMove: () => void;
} {
  const {
    pan,
    zoom,
    nodes,
    connectingFromNodeId,
    selectedNodeIds,
    panToolActive,
    canvasRef,
    mousePosRef,
    marqueeRef,
    marqueeStartRef,
    marqueeAdditiveRef,
    marqueeCleanupRef,
    panMovedRef,
    panStartRef,
    isPanningRef,
    spaceDownRef,
    userInteractedRef,
    setMarquee,
    setPreviewCursor,
    setHoveredTarget,
    setContextMenu,
    setPan,
    setZoom,
    setPanGestureActive,
    draggingNodeIdsRef,
    selectedNodeIdsRef,
    nodesRef,
    wiresRef,
    panRef,
    zoomRef,
    dragOffsetsRef,
    dragStartRef,
    dragHasMovedRef,
    duplicateDragRef,
    duplicateCopyIdsRef,
    lastDragMovePosRef,
    beginDrag,
    endDrag,
    cancelDrag,
    duplicateHistoryPushedRef,
    l10nRef,
    setLiveAnnouncement,
    setRedo,
    pushHistory,
    setNodes,
    setWires,
    setHistory,
    setAlignmentGuide,
    selectOnly,
    addToSelection,
    duplicateRefusal,
    addToast,
    l10n,
    snapEnabled,
    snap,
    selectMany,
    clearSelection,
    clearWire,
    dismissPicker,
  } = deps;
  // Stage 4A: the drag/pan teardown refs are hook-owned — the editor neither
  // declares nor invokes them any more (its sweep keeps only add-node timers).
  const panCleanupRef = useRef<(() => void) | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  /** Commit an in-flight Alt+drag: the copies stay where they dropped,
   *  become the selection, and the whole duplicate-drop lands as ONE undo
   *  entry (undo removes the copies entirely). The entry is the PRE-drag
   *  state — exactly the current state minus the copy ids, since the
   *  originals never moved during an Alt+drag. When the drag was converted
   *  MID-move, the move's own entry already IS that pre-drag state — skip
   *  the push. Idempotent — both the document and canvas mouseup paths can
   *  fire for the same release. */
  const commitDuplicateDrag = useCallback(() => {
    if (!duplicateDragRef.current) return;
    duplicateDragRef.current = false;
    const copyIds = duplicateCopyIdsRef.current;
    duplicateCopyIdsRef.current = [];
    const entryAlreadyPushed = duplicateHistoryPushedRef.current;
    duplicateHistoryPushedRef.current = false;
    if (copyIds.length > 0) {
      if (!entryAlreadyPushed) {
        const copySet = new Set(copyIds);
        setRedo([]); // new edit invalidates the redo branch
        setHistory((prev) => {
          // The one FILTERED entry in the whole history (current state
          // minus the copy ids). historyEntry re-validates it at push time
          // so the entry stays endpoint-consistent even if the filter above
          // ever regresses.
          const entry: HistoryEntry = historyEntry(
            nodesRef.current.filter((n) => !copySet.has(n.id)),
            wiresRef.current.filter((w) => !copySet.has(w.fromNodeId) && !copySet.has(w.toNodeId)),
          );
          const next = [...prev, entry];
          if (next.length > 50) next.shift();
          return next;
        });
      }
      selectMany(copyIds, copyIds[0] ?? null);
      setLiveAnnouncement(l10nRef.current.getString('topology-duplicate-announce'));
    }
    document.body.style.cursor = '';
  // commitDuplicateDrag reads duplicateDragRef / duplicateCopyIdsRef /
  // duplicateHistoryPushedRef / nodesRef / wiresRef / l10nRef — all stable
  // parent-owned identities, listed in the array below (churn unchanged).
  }, [setHistory, setRedo, selectMany, setLiveAnnouncement, duplicateDragRef, duplicateCopyIdsRef, duplicateHistoryPushedRef, nodesRef, wiresRef, l10nRef]);

  /** Escape during an Alt+drag: discard the preview copies and the drag
   *  itself (originals stay selected, no history entry). When the drag was
   *  converted MID-move, the state after cancel equals the move's history
   *  entry (originals restored to start, no copies) — pop it so Undo is not
   *  a no-op. */
  const cancelDuplicateDrag = useCallback(() => {
    if (!duplicateDragRef.current) return;
    duplicateDragRef.current = false;
    const copyIds = new Set(duplicateCopyIdsRef.current);
    duplicateCopyIdsRef.current = [];
    const entryPushed = duplicateHistoryPushedRef.current;
    duplicateHistoryPushedRef.current = false;
    if (copyIds.size > 0) {
      setNodes((prev) => prev.filter((n) => !copyIds.has(n.id)));
      setWires((prev) => prev.filter((w) => !copyIds.has(w.fromNodeId) && !copyIds.has(w.toNodeId)));
    }
    if (entryPushed) {
      setHistory((prev) => prev.slice(0, -1));
    }
    document.body.style.cursor = '';
    cancelDrag();
    dragHasMovedRef.current = false;
    dragOffsetsRef.current.clear();
    dragStartRef.current.clear();
    setAlignmentGuide(null);
    setLiveAnnouncement(l10nRef.current.getString('topology-duplicate-cancel-announce'));
    dragCleanupRef.current?.();
  // cancelDuplicateDrag reads duplicateDragRef / duplicateCopyIdsRef /
  // duplicateHistoryPushedRef / dragHasMovedRef / dragOffsetsRef / dragStartRef /
  // dragCleanupRef (hook-local since stage 4A) / setAlignmentGuide / l10nRef —
  // all stable identities; the parent-owned ones are listed in the array below
  // (churn unchanged).
  }, [setHistory, setNodes, setWires, cancelDrag, setLiveAnnouncement, duplicateDragRef, duplicateCopyIdsRef, duplicateHistoryPushedRef, dragHasMovedRef, dragOffsetsRef, dragStartRef, setAlignmentGuide, l10nRef]);

  /** Alt pressed MID-move (Figma semantics): the drag becomes a duplicate
   *  drag. The originals snap back to their pre-drag positions, fresh copies
   *  take over the cursor from the current mid-drag positions, and the drag
   *  offsets re-key to the copies. If the move had already pushed its
   *  history entry, that entry IS the pre-drag state — the commit reuses it
   *  (no duplicate entry) and the cancel pops it. */
  const convertDragToDuplicate = useCallback(() => {
    if (duplicateDragRef.current) return;
    const start = dragStartRef.current;
    if (start.size === 0) return;
    const draggedIds = new Set(start.keys());
    // Refuse the mid-drag conversion when it would duplicate a warehouse past
    // the tier cap — the move simply stays a move. A Branch Location copy is
    // allowed but sanitized below into a diagram-only card (never a second
    // branch impersonating the original).
    const refusal = duplicateRefusal(nodesRef.current.filter((n) => draggedIds.has(n.id)));
    if (refusal) {
      addToast({ message: l10n.getString(refusal), type: 'warning' });
      return;
    }
    duplicateHistoryPushedRef.current = dragHasMovedRef.current;

    // Copies of the dragged set at their CURRENT (mid-drag) positions;
    // wires copy when BOTH endpoints are dragged.
    const originalToCopy = new Map<string, string>();
    const copies = nodesRef.current
      .filter((n) => draggedIds.has(n.id))
      .map((n) => {
        const newId = `${n.type}-${crypto.randomUUID()}`;
        originalToCopy.set(n.id, newId);
        // sanitizeCopiedNode strips a Branch Location copy's canonical
        // identity — the copy is a diagram-only card, never a second
        // branch impersonating the original.
        return { ...sanitizeCopiedNode(n), id: newId };
      });
    const wireCopies = wiresRef.current
      .filter((w) => draggedIds.has(w.fromNodeId) && draggedIds.has(w.toNodeId))
      .map((w) => ({
        ...w,
        id: `wire-${crypto.randomUUID()}`,
        fromNodeId: originalToCopy.get(w.fromNodeId)!,
        toNodeId: originalToCopy.get(w.toNodeId)!,
      }));
    duplicateCopyIdsRef.current = copies.map((c) => c.id);
    duplicateDragRef.current = true;

    // Originals back to start (coordinates only, via the command helper);
    // copies in at their current positions.
    if (copies.length > 0) {
      setNodes((prev) => restoreNodesToStart(prev, start));
      setNodes((prev) => [...prev, ...copies]);
      setWires((prev) => [...prev, ...wireCopies]);
    }

    // Re-key the drag offsets to the copies (same cursor-relative offsets).
    const offsets = new Map<string, { x: number; y: number }>();
    for (const [id, off] of dragOffsetsRef.current) {
      const copyId = originalToCopy.get(id);
      if (copyId) offsets.set(copyId, off);
    }
    dragOffsetsRef.current = offsets;
    beginDrag(new Set(duplicateCopyIdsRef.current));
    document.body.style.cursor = 'copy';
  // convertDragToDuplicate reads duplicateDragRef / duplicateCopyIdsRef /
  // duplicateHistoryPushedRef / dragStartRef / dragHasMovedRef / dragOffsetsRef /
  // nodesRef / wiresRef — all stable parent-owned identities, listed in the
  // array below (churn unchanged).
  }, [duplicateRefusal, addToast, l10n, setNodes, setWires, beginDrag, duplicateDragRef, duplicateCopyIdsRef, duplicateHistoryPushedRef, dragStartRef, dragHasMovedRef, dragOffsetsRef, nodesRef, wiresRef]);

  /** Escape mid-MOVE (Figma semantics): the dragged nodes snap back to
   *  their pre-drag positions, the move's single history entry is popped
   *  (undo would otherwise restore the same state — a no-op entry), and the
   *  selection survives. Idempotent. */
  const cancelNodeMove = useCallback(() => {
    if (dragStartRef.current.size === 0) return;
    const start = dragStartRef.current;
    dragStartRef.current = new Map();
    // Restore the captured COORDINATES only (command helper) — the snapshot
    // is { x, y }, so a wholesale replacement would strip type/name/id and
    // crash the render.
    setNodes((prev) => restoreNodesToStart(prev, start));
    if (dragHasMovedRef.current) {
      setHistory((prev) => prev.slice(0, -1));
    }
    dragHasMovedRef.current = false;
    cancelDrag();
    dragOffsetsRef.current.clear();
    setAlignmentGuide(null);
    dragCleanupRef.current?.();
  // cancelNodeMove reads dragStartRef / dragHasMovedRef / dragOffsetsRef /
  // dragCleanupRef (hook-local since stage 4A) / setAlignmentGuide — stable
  // identities; the parent-owned ones are listed in the array below
  // (churn unchanged).
  }, [setHistory, setNodes, cancelDrag, dragStartRef, dragHasMovedRef, dragOffsetsRef, setAlignmentGuide]);

  /** End an in-flight node drag (release / document mouseup / touch up):
   *  commit any Alt-drag copies, clear the drag set and offsets, and drop
   *  the alignment guide. Shared by the mouse document listener, the canvas
   *  onMouseUp, and the touch gesture loop. */
  const finalizeNodeDrag = useCallback(() => {
    // Capture the dragged set + duplicate flag BEFORE commit/end clear them.
    const dragged = new Set(draggingNodeIdsRef.current);
    const isDuplicate = duplicateDragRef.current;
    const moved = dragHasMovedRef.current;
    // The pre-drag positions, captured before the drag start map is cleared
    // below — the no-op-drag pop compares each dragged node's final resting
    // spot against these.
    const startPositions = new Map(dragStartRef.current);
    commitDuplicateDrag();
    endDrag();
    dragHasMovedRef.current = false;
    dragOffsetsRef.current.clear();
    dragStartRef.current.clear();
    setAlignmentGuide(null);
    lastDragMovePosRef.current = null;
    // Drop-overlap resolution (round 140): the editor's invariant is that
    // node cards never overlap (spawns settle, loads spread on a grid), but
    // a drag can stack a node on top of another card, hiding it. Settle
    // each MOVED node into the nearest collision-free spot. Gated on the
    // drag actually moving: a plain click (no move) must never yank a card
    // that merely overlaps a neighbour — pre-existing overlap from a loaded
    // diagram is data quality, not a gesture. Skipped for Alt+drag
    // duplicates — the copies start at the originals' positions and their
    // landing spot IS the intent (a deliberate creation gesture with its
    // own pinned contract). Flush alignment (0 gap, guide landing) is not
    // an overlap and survives. The resolution is part of the drag's own
    // undo entry (the drag already pushed history on first movement).
    // The drop-overlap resolution output, if it ran — used as the final
    // position source for the no-op check below (a settle that moved a
    // dragged node means the drop DID change the canvas).
    let settledPositions: Array<{ id: string; x: number; y: number }> | null = null;
    if (!isDuplicate && dragged.size > 0 && moved) {
      const resolved = resolveDropOverlaps(nodesRef.current, dragged);
      if (resolved) {
        settledPositions = resolved;
        // Merge only the resolved positions back onto the full nodes — the
        // helper is position-focused, and replacing the objects wholesale
        // would strip type/name/metadata off every card.
        const byId = new Map(resolved.map((p) => [p.id, p]));
        setNodes((prev) => prev.map((n) => {
          const p = byId.get(n.id);
          return p ? { ...n, x: p.x, y: p.y } : n;
        }));
      }
    }
    // No-op drag: a COMPLETED drag whose every dragged node landed exactly
    // at its pre-drag position (a grab-and-return, or a wiggle that snapped
    // back onto the same grid cell) pushed a history entry that restores
    // identical state — pop it so Undo never appears enabled but does
    // nothing. The cancel paths already pop their entries; this closes the
    // one path that commits.
    if (moved && !isDuplicate && dragged.size > 0) {
      const finalPositions = settledPositions ?? nodesRef.current;
      if (moveLandedAtStart(dragged, startPositions, finalPositions)) {
        setHistory((prev) => prev.slice(0, -1));
      }
    }
    // The gesture refs/setters above (duplicateDragRef, dragHasMovedRef, dragStartRef, dragOffsetsRef, lastDragMovePosRef,
    // nodesRef, setAlignmentGuide) are stable parent-owned identities; they are
    // listed in the array below, so the callback's identity churn is unchanged.
  }, [commitDuplicateDrag, endDrag, setNodes, setHistory, draggingNodeIdsRef, duplicateDragRef, dragHasMovedRef, dragStartRef, dragOffsetsRef, lastDragMovePosRef, nodesRef, setAlignmentGuide]);

  /** Arm a node drag (mouse mousedown or the touch gesture loop): set the
   *  dragging set, compute each node's grip offset from the pointer, and —
   *  for mouse — attach the document mouseup that finalizes the drag when
   *  the pointer releases outside the canvas. The duplicate (Alt+drag) setup
   *  lives here so every creation path shares one gate and one history
   *  contract. Touch passes gesture='touch': the touch loop owns its own
   *  pointermove/pointerup listeners, so only the drag STATE is armed. */
  const beginNodeDrag = useCallback((
    clientX: number,
    clientY: number,
    selection: Set<string>,
    isDuplicateDrag: boolean,
    gesture: 'mouse' | 'touch',
  ) => {
    userInteractedRef.current = true;
    // Dismissing an open picker by grabbing a node cancels the whole
    // gesture; a plain armed connection (no picker) survives the drag.
    dismissPicker();
    clearWire();
    // Alt+drag = Figma-style DUPLICATE drag: the dragged set is replaced by
    // fresh copies (new ids, starting at the originals' positions) that
    // follow the cursor while the originals stay put; the drop commits them
    // as ONE undo entry, Escape discards them. Wires copy only when BOTH
    // endpoints are in the selection (mirrors duplicateSelection).
    // The creation-path gate applies to the duplicate path too: an Alt+drag
    // that would duplicate a warehouse past the tier cap is refused up front
    // (no copies, no drag, no history entry). A Branch Location copy is
    // allowed but sanitized below into a diagram-only card.
    // All reads go through refs so this handler stays referentially stable
    // across nodes/wires/pan/zoom changes — the memoized cards receive it as
    // a prop, and a churn here would re-render every card on any edit or
    // viewport move. The refs mirror the latest committed state, which is
    // exactly what a mousedown needs.
    const currentNodes = nodesRef.current;
    const currentWires = wiresRef.current;
    if (isDuplicateDrag) {
      const refusal = duplicateRefusal(currentNodes.filter((n) => selection.has(n.id)));
      if (refusal) {
        addToast({ message: l10n.getString(refusal), type: 'warning' });
        return;
      }
    }
    duplicateDragRef.current = isDuplicateDrag;
    const originalToCopy = new Map<string, string>();
    let dragIds: string[];
    if (isDuplicateDrag) {
      const copies = currentNodes
        .filter((n) => selection.has(n.id))
        .map((n) => {
          const newId = `${n.type}-${crypto.randomUUID()}`;
          originalToCopy.set(n.id, newId);
          // sanitizeCopiedNode strips a Branch Location copy's canonical
          // identity — the copy is a diagram-only card, never a second
          // branch impersonating the original.
          return { ...sanitizeCopiedNode(n), id: newId };
        });
      const wireCopies = currentWires
        .filter((w) => selection.has(w.fromNodeId) && selection.has(w.toNodeId))
        .map((w) => ({
          ...w,
          id: `wire-${crypto.randomUUID()}`,
          fromNodeId: originalToCopy.get(w.fromNodeId)!,
          toNodeId: originalToCopy.get(w.toNodeId)!,
        }));
      duplicateCopyIdsRef.current = copies.map((c) => c.id);
      dragIds = duplicateCopyIdsRef.current;
      if (copies.length > 0) {
        setNodes((prev) => [...prev, ...copies]);
        setWires((prev) => [...prev, ...wireCopies]);
      }
      document.body.style.cursor = 'copy';
    } else {
      dragIds = [...selection];
    }
    // Copy: the drag set must never share identity with the live selection
    // state (a future mutation of one would corrupt the other). Mirror the
    // ref SYNCHRONOUSLY too — the touch path calls applyDragMove in the same
    // event handler, before React re-renders and the render-time mirror
    // (draggingNodeIdsRef.current = draggingNodeIds) would catch up.
    const nextDragSet = new Set(dragIds);
    beginDrag(nextDragSet);
    dragHasMovedRef.current = false;
    // Seed the edge auto-pan direction baseline at the grip point.
    lastDragMovePosRef.current = { x: clientX, y: clientY };

    if (gesture === 'mouse') {
      // Cancel any in-flight drag listener from a previous drag, then arm a
      // document-level mouseup so releasing the pointer outside the canvas
      // still ends the drag (the canvas onMouseUp is unreachable there).
      dragCleanupRef.current?.();
      const handleDocumentMouseUp = () => {
        finalizeNodeDrag();
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        dragCleanupRef.current = null;
      };
      document.addEventListener('mouseup', handleDocumentMouseUp);
      dragCleanupRef.current = () => {
        document.removeEventListener('mouseup', handleDocumentMouseUp);
        dragCleanupRef.current = null;
      };
    }
    // Touch: the touch gesture loop's document pointer listeners own the
    // moves and the finalize — nothing to arm here beyond the drag state.

    const rect = canvasRef.current?.getBoundingClientRect();
    const canvasX = (clientX - (rect?.left ?? 0) - panRef.current.x) / zoomRef.current;
    const canvasY = (clientY - (rect?.top ?? 0) - panRef.current.y) / zoomRef.current;
    dragOffsetsRef.current.clear();
    dragStartRef.current.clear();
    const copyToOriginal = new Map([...originalToCopy].map(([k, v]) => [v, k]));
    // Position lookup via a fresh map from the ref — `nodeMap`'s identity
    // tracks nodes, and taking it as a dep would re-key this handler (and
    // every card prop) on any node edit.
    const nodeMapNow = new Map(currentNodes.map((n) => [n.id, n]));
    for (const id of dragIds) {
      // Duplicate-drag offsets come from the ORIGINALS (the copies start at
      // their positions and aren't in the map until the state flush), but
      // are keyed by the copy ids the drag actually moves.
      const srcId = isDuplicateDrag ? copyToOriginal.get(id) : id;
      const n = srcId ? nodeMapNow.get(srcId) : null;
      if (n) {
        dragOffsetsRef.current.set(id, { x: canvasX - n.x, y: canvasY - n.y });
        dragStartRef.current.set(id, { x: n.x, y: n.y });
      }
    }
    // The gesture refs/setters above (userInteractedRef, nodesRef, wiresRef, duplicateDragRef, duplicateCopyIdsRef,
    // dragHasMovedRef, lastDragMovePosRef, canvasRef, panRef, zoomRef, dragOffsetsRef,
    // dragStartRef) are stable parent-owned identities; they are listed in the
    // array below, so the callback's identity churn is unchanged. dragCleanupRef
    // (hook-local since stage 4A) is read above too and needs no listing.
  }, [duplicateRefusal, addToast, l10n, finalizeNodeDrag, beginDrag, dismissPicker, setNodes, setWires, clearWire, userInteractedRef, nodesRef, wiresRef, duplicateDragRef, duplicateCopyIdsRef, dragHasMovedRef, lastDragMovePosRef, canvasRef, panRef, zoomRef, dragOffsetsRef, dragStartRef]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    dismissPicker();
    if (e.button !== 0) return;
    // Multi-select rules: shift+mousedown ADDS the node to the selection;
    // a plain mousedown on an unselected node collapses to just it; a
    // mousedown on a node already inside a multi-selection keeps the group
    // so it can be dragged as a whole. The selection is read via the ref so
    // this handler stays stable across selection changes (the memoized
    // cards all receive it as a prop).
    const currentSelection = selectedNodeIdsRef.current;
    const wasSelected = currentSelection.has(nodeId);
    let selection: Set<string>;
    if (e.shiftKey && !wasSelected) {
      selection = new Set(currentSelection);
      selection.add(nodeId);
      addToSelection(nodeId);
    } else if (!wasSelected) {
      selection = new Set([nodeId]);
      selectOnly(nodeId);
    } else {
      selection = new Set(currentSelection);
    }
    beginNodeDrag(e.clientX, e.clientY, selection, e.altKey, 'mouse');
    // The gesture refs/setters above (selectedNodeIdsRef) are stable parent-owned
    // identities; selectedNodeIdsRef is listed in the array below, so the
    // memoized-card prop pin (referential stability) is preserved.
  }, [selectOnly, beginNodeDrag, dismissPicker, addToSelection, selectedNodeIdsRef]);

  /** Apply one drag-move to the dragged group (mouse canvas mousemove and
   *  the touch gesture loop share this). Reads the dragging set and nodes
   *  via refs so the touch path — which runs in the document-listener
   *  closure armed at pointerdown — always sees the CURRENT drag state, not
   *  the stale render-time snapshot. */
  const applyDragMove = (clientX: number, clientY: number) => {
    if (draggingNodeIdsRef.current.size === 0) return;
    // Push history once, on the first real movement — a plain click that
    // never moves must not create a no-op undo entry. An Alt+drag defers
    // its entry to the drop (one undo for the whole duplicate).
    if (!dragHasMovedRef.current) {
      dragHasMovedRef.current = true;
      if (!duplicateDragRef.current) pushHistory();
    }
    // Edge auto-pan: a pointer inside an edge band pans the viewport so a
    // drag can keep moving across a large diagram instead of stalling at
    // the viewport clamp. Reads the CURRENT pan via panRef (the touch
    // gesture loop runs in a down-time closure; the mouse path is equally
    // fresh) and derives the drag math from the POST-pan view, so the
    // dragged node tracks the pointer through the scroll. Pointers OUTSIDE
    // the canvas produce no delta — the clamp below then holds the node at
    // the edge (the never-lose-a-node invariant).
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const curPan = panRef.current;
    const curZoom = zoomRef.current;
    let auto = edgeAutoPanDelta(
      clientX - (rect?.left ?? 0),
      clientY - (rect?.top ?? 0),
      canvas?.clientWidth ?? 0,
      canvas?.clientHeight ?? 0,
    );
    // Direction gate: only pan toward the edge the pointer is pushing
    // against. A drag drifting AWAY from the edge (or holding still) must
    // not scroll — proximity alone would pan while dragging toward the
    // diagram's interior near a corner.
    const lastPos = lastDragMovePosRef.current;
    if (lastPos) {
      const moveDx = clientX - lastPos.x;
      const moveDy = clientY - lastPos.y;
      if (auto.dx !== 0 && Math.sign(auto.dx) !== Math.sign(moveDx)) auto = { ...auto, dx: 0 };
      if (auto.dy !== 0 && Math.sign(auto.dy) !== Math.sign(moveDy)) auto = { ...auto, dy: 0 };
    }
    lastDragMovePosRef.current = { x: clientX, y: clientY };
    const nextPan = auto.dx === 0 && auto.dy === 0
      ? curPan
      : { x: curPan.x + auto.dx, y: curPan.y + auto.dy };
    if (nextPan !== curPan) setPan(nextPan);
    const rawX = (clientX - (rect?.left ?? 0) - nextPan.x) / curZoom;
    const rawY = (clientY - (rect?.top ?? 0) - nextPan.y) / curZoom;
    // Dynamic edge clamp: every node in the dragged group may travel
    // north/west until its box nearly leaves the visible canvas, but can
    // never be pushed off-screen and lost. Pan/zoom aware, so the reachable
    // edge follows the current view. Each node clamps independently; the
    // group delta is otherwise identical (same raw cursor → same per-node
    // offset).
    const targets = new Map<string, { x: number; y: number }>();
    for (const [id, off] of dragOffsetsRef.current) {
      if (!draggingNodeIdsRef.current.has(id)) continue;
      targets.set(id, clampNodeToViewport(rawX - off.x, rawY - off.y, {
        panX: nextPan.x,
        panY: nextPan.y,
        zoom: curZoom,
        canvasW: canvas?.clientWidth ?? 0,
        canvasH: canvas?.clientHeight ?? 0,
      }));
    }
    // Figma-style COLLECTIVE alignment: every dragged node's edges/centers
    // snap to stationary nodes' edges/centers within a small threshold; the
    // closest match across the whole group wins per axis and the delta
    // applies to the group so it stays rigid (a non-grabbed member's edge
    // can snap the group — Figma semantics). The aligned axis skips grid
    // snapping (guides beat the grid); the other axis still snaps as
    // configured.
    const align = targets.size > 0
      ? computeAlignmentGuides(targets, draggingNodeIdsRef.current, nodesRef.current)
      : { dx: 0, dy: 0, alignedX: false, alignedY: false };
    setAlignmentGuide(
      align.x !== undefined || align.y !== undefined
        ? { ...(align.x !== undefined ? { x: align.x } : {}), ...(align.y !== undefined ? { y: align.y } : {}) }
        : null,
    );
    setNodes((prev) =>
      prev.map((n) => {
        const off = dragOffsetsRef.current.get(n.id);
        if (!off) return n;
        const clamped = clampNodeToViewport(rawX - off.x, rawY - off.y, {
          panX: nextPan.x,
          panY: nextPan.y,
          zoom: curZoom,
          canvasW: canvas?.clientWidth ?? 0,
          canvasH: canvas?.clientHeight ?? 0,
        });
        // The delta is the dragged axis MINUS the reference (pAxis − rAxis),
        // so SUBTRACTING it lands the edge exactly on the line — a drag that
        // raw-lands 3px off snaps onto it, never parking 2× the miss away.
        let fx = clamped.x - align.dx;
        let fy = clamped.y - align.dy;
        if (snapEnabled) {
          if (!align.alignedX) fx = snap(fx);
          if (!align.alignedY) fy = snap(fy);
        }
        return { ...n, x: fx, y: fy };
      }),
    );
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    // NOTE: the HUD cursor readout is NOT fed here — CanvasCursorReadout
    // owns its own document listener + rAF, so canvas mousemoves re-render
    // only that span, never the editor.
    applyDragMove(e.clientX, e.clientY);
    if (marqueeStartRef.current) {
      // Marquee: track the drag rect in container-relative screen px.
      const rect = canvasRef.current?.getBoundingClientRect();
      const next = {
        x0: marqueeStartRef.current.x,
        y0: marqueeStartRef.current.y,
        x1: e.clientX - (rect?.left ?? 0),
        y1: e.clientY - (rect?.top ?? 0),
      };
      setMarquee(next);
      marqueeRef.current = next;
    } else if (connectingFromNodeId) {
      // Find nearest target port when dragging a connection
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = (e.clientX - rect.left - pan.x) / zoom;
      const my = (e.clientY - rect.top - pan.y) / zoom;
      setPreviewCursor({ x: mx, y: my });
      const SNAP_DIST = 30;
      let closest: { nodeId: string; port: PortName; variantIndex: number; dist: number } | null = null;
      for (const n of nodes) {
        if (n.id === connectingFromNodeId) continue;
    // Snap candidates mirror the stacked port rows (round 174): every
    // semantic row on the left (input) and right (output) column is a
    // candidate, positioned at its own portRowCenterY.
    const candidates: Array<{ port: PortName; variantIndex: number; off: { dx: number; dy: number } }> = [];
    for (let i = 0; i < socketSemanticIds(n, 'left').length; i += 1) {
      candidates.push({ port: 'left', variantIndex: i, off: { dx: 0, dy: portRowCenterY(n, i) } });
    }
    for (let i = 0; i < socketSemanticIds(n, 'right').length; i += 1) {
      candidates.push({ port: 'right', variantIndex: i, off: { dx: NODE_WIDTH, dy: portRowCenterY(n, i) } });
    }
        for (const c of candidates) {
          const px = n.x + c.off.dx;
          const py = n.y + c.off.dy;
          const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
          if (dist < SNAP_DIST && (!closest || dist < closest.dist)) {
            closest = { nodeId: n.id, port: c.port, variantIndex: c.variantIndex, dist };
          }
        }
      }
      setHoveredTarget((prev) => {
        if (!closest) return prev === null ? prev : null;
        // Only create a new object when values actually changed — prevents
        // all memoized node cards from re-rendering on every mousemove.
        if (prev && prev.nodeId === closest.nodeId && prev.port === closest.port && prev.variantIndex === closest.variantIndex) return prev;
        return { nodeId: closest.nodeId, port: closest.port, variantIndex: closest.variantIndex };
      });
    }
  };

  const handleCanvasMouseUp = () => {
    finalizeNodeDrag();
    // The marquee is finalized by its own document-level mouseup listener
    // (armed at marquee start), which also fires when the pointer is
    // released OUTSIDE the canvas — the canvas onMouseUp is unreachable
    // there, and without it the box would linger and re-open on the next
    // mousemove.
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (panMovedRef.current) {
      // A right-button pan ends with a native contextmenu event;
      // consume only that post-drag event. The next stationary
      // right-click is allowed to open the menu normally.
      panMovedRef.current = false;
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    setContextMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
  };

  /** Commit the marquee at its release point: a forward drag (left→right)
   *  selects only nodes FULLY contained in the box, a backward drag
   *  (right→left) selects every node the box touches (screen space at
   *  identity pan/zoom), or leave the selection cleared if the box captured
   *  nothing (a background click). The rect is derived from the START ref +
   *  release coords, so a document listener armed at mousedown never reads
   *  a stale rect. */
  const finalizeMarquee = () => {
    const start = marqueeStartRef.current;
    marqueeStartRef.current = null;
    if (!start) return;
    // Only a marquee that actually RENDERED (the pointer moved) commits — a
    // mousedown+mouseup without movement is a plain background click, and
    // the selection was already cleared when it started. The ref mirror
    // also keeps this document-armed listener free of stale-closure risk.
    const box = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!box) return;
    const mx0 = Math.min(box.x0, box.x1);
    const mx1 = Math.max(box.x0, box.x1);
    const my0 = Math.min(box.y0, box.y1);
    const my1 = Math.max(box.y0, box.y1);
    // A degenerate (click-sized) box selects nothing.
    if (mx1 - mx0 < 1 || my1 - my0 < 1) return;
    // Direction-aware marquee (Figma/draw.io convention): a FORWARD drag
    // (left→right) selects only nodes FULLY contained in the box; a
    // BACKWARD drag (right→left) selects every node the box touches.
    const forward = box.x1 >= box.x0;
    const hit = nodes.filter((n) => {
      const nx = n.x * zoom + pan.x;
      const ny = n.y * zoom + pan.y;
      const nx1 = nx + NODE_WIDTH * zoom;
      const ny1 = ny + NODE_HEIGHT * zoom;
      if (forward) {
        return nx >= mx0 && nx1 <= mx1 && ny >= my0 && ny1 <= my1;
      }
      return nx1 >= mx0 && nx <= mx1 && ny1 >= my0 && ny <= my1;
    });
    const additive = marqueeAdditiveRef.current;
    marqueeAdditiveRef.current = false;
    if (hit.length > 0) {
      if (additive) {
        // Union with the selection captured at mousedown (the finalizer's
        // closure is from that render, so it still holds the pre-drag set).
        const union = new Set(selectedNodeIds);
        for (const n of hit) union.add(n.id);
        selectMany([...union], hit[hit.length - 1]!.id);
      } else {
        selectMany(hit.map((n) => n.id), hit[hit.length - 1]!.id);
      }
    } else if (!additive) {
      clearSelection();
    }
  };

  /** Start a pan gesture from any button: middle/right drags and the
   *  Space+left-drag modifier. Document-level listeners keep the pan
   *  tracking even when the pointer leaves the canvas. */
  const startPan = (e: React.MouseEvent, clearSelectionFirst: boolean) => {
    if (clearSelectionFirst) clearSelection();
    panMovedRef.current = false;
    isPanningRef.current = true;
    setPanGestureActive(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isPanningRef.current) return;
      panMovedRef.current = true;
      setPan({
        x: ev.clientX - panStartRef.current.x,
        y: ev.clientY - panStartRef.current.y,
      });
    };

    const handleMouseUp = () => {
      panCleanupRef.current?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    panCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      isPanningRef.current = false;
      setPanGestureActive(false);
      document.body.style.cursor = '';
      panCleanupRef.current = null;
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    userInteractedRef.current = true;
    // A background click dismisses an open picker (full cancel, like
    // Escape); a plain armed connection with no picker survives so the
    // user can pan to a distant target.
    dismissPicker();
    setContextMenu(null);
    const targetEl = e.target as HTMLElement;
    if (targetEl === e.currentTarget || targetEl.classList.contains('node-canvas-viewport') || targetEl.tagName === 'svg') {
      clearWire();
      if (e.button === 0 && (spaceDownRef.current || panToolActive)) {
        // Space+drag (or the active Pan tool) pans like the middle/right
        // button, but Figma-style it preserves the current selection
        // instead of clearing it.
        startPan(e, false);
      } else if (e.button === 0) {
        // Left-drag on empty background is the marquee selector; a plain
        // click (no movement) clears the selection on mouseup. Shift+drag is
        // ADDITIVE: the current selection is kept so the marquee unions into
        // it at release (and a Shift+click on empty canvas clears nothing).
        // The marquee coords are container-relative screen px (the viewport
        // inside is panned/zoomed, so node boxes are compared in screen
        // space too). A document-level mouseup finalizes the box, so
        // releasing outside the canvas still commits the selection instead
        // of leaking a half-open marquee.
        const additive = e.shiftKey;
        marqueeAdditiveRef.current = additive;
        if (!additive) {
          clearSelection();
        }
        const rect = canvasRef.current?.getBoundingClientRect();
        marqueeStartRef.current = {
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        };
        marqueeRef.current = null;
        marqueeCleanupRef.current?.();
        const handleMarqueeMouseUp = () => {
          finalizeMarquee();
          marqueeCleanupRef.current?.();
        };
        document.addEventListener('mouseup', handleMarqueeMouseUp);
        marqueeCleanupRef.current = () => {
          document.removeEventListener('mouseup', handleMarqueeMouseUp);
          marqueeCleanupRef.current = null;
        };
      } else if (e.button === 1 || e.button === 2) {
        // Middle/right-button drag pans the canvas.
        startPan(e, true);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => {
      const newZoom = Math.min(2.0, Math.max(0.4, prev * zoomFactor));
      // Zoom towards cursor: adjust pan so cursor position stays fixed
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      setPan((p) => ({
        x: cursorX - (cursorX - p.x) * (newZoom / prev),
        y: cursorY - (cursorY - p.y) * (newZoom / prev),
      }));
      return newZoom;
    });
  };

  // The hook registers its own unmount cleanups: since stage 4A they are the
  // sole unmount disposers — the editor sweep no longer invokes these refs (it
  // clears only the add-node timers). Every disposer below is a functional
  // no-op on second invocation (removeEventListener + ref-nulling /
  // constant-reset writes; the pan disposer's setPanGestureActive(false) is a
  // constant-valued setState that React bails out via Object.is, and at unmount
  // the update is discarded anyway). dragCleanupRef/panCleanupRef are hook-local
  // and marqueeCleanupRef parent-owned — all stable identities, so each effect
  // arms once.
  useEffect(() => () => { dragCleanupRef.current?.(); }, []);
  useEffect(() => () => { panCleanupRef.current?.(); }, []);
  useEffect(() => () => { marqueeCleanupRef.current?.(); }, [marqueeCleanupRef]);

  return {
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleCanvasMouseDown,
    handleWheel,
    finalizeMarquee,
    startPan,
    handleContextMenu,
    handleNodeMouseDown,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
    cancelDuplicateDrag,
    convertDragToDuplicate,
    cancelNodeMove,
  };
}

