//! Central canvas keyboard controller for the topology editor (Phase 3.4d).
//!
//! Owns the one window-level keydown listener the editor used to install inline:
//! the typing / non-canvas-focus / open-dialog guards, the 1-4 tool-slot spawn
//! branch, the Alt-mid-move duplicate conversion, the Escape ladder (finder ->
//! duplicate drag -> bend drag -> node move -> marquee -> connection+selection),
//! keyboard Delete/Backspace with its Branch-Location filter and wired/unwired
//! dialog split, the undo/redo + select-all/duplicate/copy/paste + zoom + Ctrl+F
//! + F2 cluster, and the arrow-nudge block (grid vs fine step, the shared
//! viewport clamp, the no-overlap wall, burst coalescing, entry-only alignment
//! snap).
//!
//! Nothing about that behavior changed. The effect is a VERBATIM line-slice of
//! the inline original — same body, same comments — and its dependency array
//! lists every identity the rule demands: the original 34 plus the stable
//! refs/setters, the isBranchLocation primitive and the module constants, so
//! re-arm parity is preserved (the primitive flag adds a re-arm only when it
//! itself flips), and the preserved guards stay preserved: the
//! `.topology-apply-confirm-overlay` closest() shield (an open Apply dialog must
//! never be shortcut from the canvas) and the F2 form
//! `startNodeRename([...selectedNodeIds][0]!)`, which is the slice R2 dedupe
//! (the renameable gate and node lookup live in startNodeRename now).
//!
//! The hook returns NOTHING: it owns no state and exposes no callback, so the
//! parent keeps every consumer it already had.
//!
//! What deliberately stayed parent-side and arrives through deps:
//! - Every gesture ref (dragStartRef, duplicateDragRef, bendDragRef,
//!   dragHasMovedRef, marqueeStartRef) plus userInteractedRef — the pointer and
//!   touch hooks and resetTransientCanvasState all read or write them (the
//!   editor's unmount sweep is retired and touches no listener refs any more),
//!   so hoisting any of them here would split one gesture across two owners.
//! - migrationDismissedRef — "Later" and Escape set it, the load effect reads it.
//! - handleAddNodeRef — it is WRITTEN below this call (it mirrors handleAddNode,
//!   declared after the original effect), so it stays a parent-declared ref
//!   passed by reference; the handler it carries is still the current render's.
//! - nudgeSessionRef — the burst session is ended by other edit paths too, so it
//!   is not this controller's to own.
//! - canvasRef — the same element the pointer, touch and viewport hooks measure.
//! - The setters the guards and branches call (finder, migration, both delete
//!   confirmations, the alignment guide, setNodes) and isBranchLocation, whose
//!   node lookup is parent state.
//! - GRID_SIZE / NUDGE_COALESCE_MS / snap — editor module consts, forwarded
//!   rather than re-minted (the pointer hook's `snap` field is the precedent), so
//!   this file never grows a second copy of the grid truth.
//!
//! The call site sits at the exact position of the original effect, so the
//! component's hook order — and therefore its effect order — is unchanged.

import { useEffect, type MutableRefObject, type SetStateAction } from 'react';
import type { NodeType, TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import type { TopologyPickerState } from './nodeTopologyEditorConnectionState';
import { clampNodeToViewport, nodeBoxesOverlap } from './nodeTopologyClamp';
import { computeAlignmentGuides } from './topologyEditorHelpers';

/** In-flight bend-drag record, mirrored from the editor's `bendDragRef`. */
type BendDragState = {
  wireId: string;
  index: number;
  moved: boolean;
  startX: number;
  startY: number;
  created: boolean;
  pendingInsert: boolean;
};

export interface TopologyKeyboardDeps {
  // ── The 34 names the dependency array already spelled out (order preserved).
  /** Current multi-selection — Delete, Ctrl+A/I, F2 and the arrow nudge all key off it. */
  selectedNodeIds: Set<string>;
  /** Primary selected wire — keyboard Delete opens the wire dialog for it. */
  selectedWireId: string | null;
  /** Live wire list — the delete branch's wired/unwired split. */
  wires: TopologyWireData[];
  /** History push — the arrow burst's first press commits the origin. */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Ctrl+Z / Ctrl+Shift+Z. */
  popUndo: () => void;
  /** Ctrl+Y and the Shift form of Ctrl+Z. */
  popRedo: () => void;
  /** Open single-node / wire delete confirmation — the canvas is inert while set. */
  confirmDelete: string | null;
  /** Open batch delete confirmation (2+ nodes) — same shield. */
  confirmDeleteMany: string[] | null;
  /** Live viewport pan — the nudge clamp is expressed in the same space as dragging. */
  pan: { x: number; y: number };
  /** Live viewport zoom, paired with pan for the same clamp. */
  zoom: number;
  /** Delete command the Branch-Location-filtered keyboard targets go through. */
  deleteNodes: (ids: string[]) => void;
  /** Open relationship picker — owns the keyboard while it is up. */
  relationshipPicker: TopologyPickerState | null;
  /** Escape closes the picker (and so cancels the in-flight connection). */
  cancelRelationshipPicker: () => void;
  /** Ctrl+A. */
  selectAllNodes: () => void;
  /** Ctrl+D. */
  duplicateSelection: () => void;
  /** Ctrl+C. */
  copySelection: () => void;
  /** Ctrl+V. */
  pasteClipboard: () => void;
  /** Live node list — the nudge's move set, overlap wall and guide candidates. */
  nodes: TopologyNodeData[];
  /** F2 — the single selected renameable node, same flow as the card pencil. */
  startNodeRename: (nodeId: string) => void;
  /** Ctrl+0 (viewport hook). */
  zoomToFit: () => void;
  /** Ctrl+= / Ctrl+- (viewport hook). */
  zoomBy: (factor: number) => void;
  /** Ctrl+1 — 100% zoom on the Branch Location anchor (viewport hook). */
  resetView: () => void;
  /** Grid-snap toggle: decides the plain-arrow step and whether nudges round. */
  snapEnabled: boolean;
  /** Escape mid-Alt+drag (pointer hook). */
  cancelDuplicateDrag: () => void;
  /** Escape mid-move: restore start positions and pop the entry (pointer hook). */
  cancelNodeMove: () => void;
  /** Alt pressed mid-move converts the drag (pointer hook). */
  convertDragToDuplicate: () => void;
  /** Escape mid-bend-drag (parent command, reads the parent bend ref). */
  cancelBendDrag: () => void;
  /** Node finder overlay open state — Escape closes it before anything else. */
  finderOpen: boolean;
  /** Plain Escape after the ladder falls through. */
  clearSelection: () => void;
  /** Node graph setter — the nudge commits through it. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  /** Legacy-migration dialog — owns the keyboard while it is up. */
  migrationOpen: boolean;
  /** Escape's last resort: drop a staged connection. */
  cancelConnection: () => void;
  /** Escape mid-marquee: hide the box and disarm its document finalizer. */
  cancelMarquee: () => void;
  /** Escape's last resort: drop the whole selection. */
  clearAll: () => void;
  // ── Consumed by the body but NOT named by that array (refs and setters are
  // stable; the three module constants are static), so they still have to be
  // passed in — the body reads all of them.
  /** Sticky "user took the view" flag — any keystroke disarms the auto-fit pass. */
  userInteractedRef: MutableRefObject<boolean>;
  /** Escape on the migration dialog is the same contract as its "Later" button. */
  migrationDismissedRef: MutableRefObject<boolean>;
  /** Add-node palette handler by REF: written below this call, so the ref (not
   *  the function) is the dep the 1-4 spawn branch can safely read. */
  handleAddNodeRef: MutableRefObject<((type: NodeType) => void) | null>;
  /** Non-empty while a node drag is in flight — the Alt-conversion and Escape guards. */
  dragStartRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  /** True while an in-flight drag is an Alt+drag duplicate. */
  duplicateDragRef: MutableRefObject<boolean>;
  /** Set only by a real handle/ghost mousedown, so a stale value cannot swallow Escape. */
  bendDragRef: MutableRefObject<BendDragState | null>;
  /** First-movement latch: a bare mousedown is not a move to cancel. */
  dragHasMovedRef: MutableRefObject<boolean>;
  /** Marquee anchor — non-null while the box is being drawn. */
  marqueeStartRef: MutableRefObject<{ x: number; y: number } | null>;
  /** Arrow-burst coalescing session: {nodeIds, lastNudgeAt} or null. */
  nudgeSessionRef: MutableRefObject<{ nodeIds: Set<string>; lastNudgeAt: number } | null>;
  /** Live canvas element — clientWidth/clientHeight are the nudge clamp's viewport. */
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  /** Ctrl+F opens and Escape closes the finder overlay. */
  setFinderOpen: (value: SetStateAction<boolean>) => void;
  /** Escape closes the legacy-migration dialog. */
  setMigrationOpen: (value: SetStateAction<boolean>) => void;
  /** Single-node / wire delete confirmation opener (empty string = wire dialog). */
  setConfirmDelete: (value: SetStateAction<string | null>) => void;
  /** Batch delete confirmation opener for 2+ wired nodes. */
  setConfirmDeleteMany: (value: SetStateAction<string[] | null>) => void;
  /** Live alignment guide state — the fine-nudge branch shows or clears it. */
  setAlignmentGuide: (value: SetStateAction<{ x?: number; y?: number } | null>) => void;
  /** Grid pitch: the plain-arrow step when snapping is on. */
  GRID_SIZE: number;
  /** Burst window: presses this close together share ONE undo entry. */
  NUDGE_COALESCE_MS: number;
  /** 24px grid snap, shared with the seed/merge builders. */
  snap: (value: number) => number;
  /** Branch Location filter — those nodes are permanent anchors, never deleted. */
  isBranchLocation: (nodeId: string) => boolean;
}

/**
 * The central canvas keydown listener, armed and torn down exactly as the inline
 * effect was. Registers one effect and returns nothing.
 */
export function useTopologyEditorKeyboard(deps: TopologyKeyboardDeps): void {
  const {
    selectedNodeIds,
    selectedWireId,
    wires,
    pushHistory,
    popUndo,
    popRedo,
    confirmDelete,
    confirmDeleteMany,
    pan,
    zoom,
    deleteNodes,
    relationshipPicker,
    cancelRelationshipPicker,
    selectAllNodes,
    duplicateSelection,
    copySelection,
    pasteClipboard,
    nodes,
    startNodeRename,
    zoomToFit,
    zoomBy,
    resetView,
    snapEnabled,
    cancelDuplicateDrag,
    cancelNodeMove,
    convertDragToDuplicate,
    cancelBendDrag,
    finderOpen,
    clearSelection,
    setNodes,
    migrationOpen,
    cancelConnection,
    cancelMarquee,
    clearAll,
    userInteractedRef,
    migrationDismissedRef,
    handleAddNodeRef,
    dragStartRef,
    duplicateDragRef,
    bendDragRef,
    dragHasMovedRef,
    marqueeStartRef,
    nudgeSessionRef,
    canvasRef,
    setFinderOpen,
    setMigrationOpen,
    setConfirmDelete,
    setConfirmDeleteMany,
    setAlignmentGuide,
    GRID_SIZE,
    NUDGE_COALESCE_MS,
    snap,
    isBranchLocation,
  } = deps;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Any key press hands the view to the user — the one-shot load
      // auto-fit must never yank it afterwards (even Delete/Undo, which
      // change the content key, must not trigger a refit).
      userInteractedRef.current = true;
      // Guard: don't handle canvas shortcuts while the user is typing in a text field.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      // Guard: while a non-canvas control (tool rack, header, inspector)
      // owns keyboard focus, canvas shortcuts are inert — a stray
      // Delete/Backspace/arrow after clicking a tool-card or header button
      // would otherwise mutate (or instantly delete) the selected element
      // the user is not looking at. Canvas-internal elements (node cards,
      // port sockets, wire labels) are NOT covered and keep their
      // shortcuts, so keyboard Delete on a focused node still works.
      // `closest` only exists on Elements — keydown can target window/document
      // (tests, programmatic dispatch), which must never throw out of the guard.
      if (target && typeof target.closest === 'function'            && target.closest('.node-tool-rack, .node-topology-header, .node-inspector-drawer, .topology-apply-confirm-overlay')) {
        return;
      }
      // Guard: a confirm dialog owns the keyboard while it is open — Escape
      // (and any canvas shortcut) must not clear the selection or mutate the
      // canvas under an open delete/preset dialog. The Modal's focus trap
      // closes the dialog itself (bubble order: document listener first).
      // NOTE: every editor-owned confirm dialog must be added to this
      // condition, or its Escape/shortcut handling will leak into the canvas.
      if (relationshipPicker) {
        // The relationship picker owns the keyboard while open: Escape
        // closes it (cancelling the in-flight connection); everything
        // else must NOT leak into the canvas.
        if (e.key === 'Escape') cancelRelationshipPicker();
        return;
      }
      if (migrationOpen) {
        // The legacy-migration dialog owns the keyboard while open: Escape
        // dismisses it (same contract as Later); everything else must NOT
        // leak into the canvas — a stray Delete/arrow would otherwise edit
        // the canvas under the modal.
        if (e.key === 'Escape') {
          migrationDismissedRef.current = true;
          setMigrationOpen(false);
        }
        return;
      }
      if (confirmDelete || confirmDeleteMany) {
        return;
      }
      // Tool-slot shortcuts: 1-4 spawn nodes from the palette, matching the
      // rack's card order (Store, Workspace, Warehouse, Hardware). Bare keys
      // only — no modifier, no auto-repeat. The guards above already keep
      // these inert while typing or when a non-canvas control owns focus.
      // NEW: the spawn additionally requires the keydown target to be INSIDE
      // the canvas (or a canvas-internal element) — focus on the page body,
      // a floating dialog, or any chrome outside the canvas no longer
      // spawns a stray node from a careless keystroke.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        const inCanvas = target
          && typeof target.closest === 'function'
          && target.closest('.node-canvas-container');
        if (inCanvas) {
          const spawnBySlot: Record<string, NodeType> = {
            '1': 'store',
            '2': 'workspace',
            '3': 'warehouse',
            '4': 'hardware',
          };
          const spawnType = spawnBySlot[e.key];
          if (spawnType) {
            e.preventDefault();
            handleAddNodeRef.current?.(spawnType);
            return;
          }
        }
      }
      // Alt pressed MID-move converts the drag into a duplicate (Figma):
      // only while a node drag is in flight and not already duplicating.
      if (e.key === 'Alt' && !e.repeat && dragStartRef.current.size > 0 && !duplicateDragRef.current) {
        convertDragToDuplicate();
        return;
      }
      if (e.key === 'Escape') {
        // Escape closes the finder overlay first — it owns the canvas while
        // open, so a plain Escape must not clear the selection underneath.
        if (finderOpen) {
          setFinderOpen(false);
          return;
        }
        // Escape mid-Alt+drag cancels the duplication: the preview copies
        // are discarded and the originals keep the selection (no history
        // entry — nothing was committed).
        if (duplicateDragRef.current) {
          cancelDuplicateDrag();
          return;
        }
        // Escape mid-bend-drag restores the bend (or removes a ghost-created
        // one) and pops the drag's history entry — same Figma semantics as
        // the node-move cancel below. bendDragRef is set only by a real
        // handle/ghost mousedown, so a stale value cannot swallow the plain
        // Escape.
        if (bendDragRef.current) {
          cancelBendDrag();
          return;
        }
        // Escape mid-MOVE snaps the dragged nodes back to their start
        // positions (Figma semantics) and keeps the selection. Guarded on
        // the drag having actually MOVED: a bare mousedown (select-first,
        // port-click sequence) leaves dragStartRef populated but is not a
        // move to cancel — a stale cancel would swallow the normal Escape
        // (connection/selection clear) below.
        if (dragStartRef.current.size > 0 && dragHasMovedRef.current) {
          cancelNodeMove();
          return;
        }
        // Escape mid-marquee cancels the box and disarms its document
        // finalizer — a release after Escape must not commit a selection
        // from a cancelled marquee (the box would otherwise linger until
        // the next mousedown/mouseup cycle).
        if (marqueeStartRef.current) {
          cancelMarquee();
          return;
        }
        cancelConnection();
        clearAll();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeIds.size > 0 || selectedWireId)) {
        e.preventDefault();
        if (selectedNodeIds.size > 0) {
          // Filter out Branch Location nodes — they are permanent anchors.
          const targets = [...selectedNodeIds].filter((id) => !isBranchLocation(id));
          if (targets.length === 0) return; // Only Branch Location(s) selected
          const hasWires = wires.some((w) => targets.includes(w.fromNodeId) || targets.includes(w.toNodeId));
          if (hasWires) {
            // A single wired node keeps the established dialog; 2+ use the
            // count-aware batch dialog.
            if (targets.length === 1) setConfirmDelete(targets[0]!);
            else setConfirmDeleteMany(targets);
          } else {
            // No connected wires — delete immediately without dialog.
            deleteNodes(targets);
          }
        } else {
          setConfirmDelete('');
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          popRedo();
        } else {
          popUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        popRedo();
        return;
      }
      // Ctrl+I — jump focus to the first inspector input when a node is selected
      if ((e.ctrlKey || e.metaKey) && e.key === 'i' && selectedNodeIds.size > 0) {
        e.preventDefault();
        const firstInput = document.querySelector('.inspector-content input');
        if (firstInput instanceof HTMLElement) {
          firstInput.focus();
        }
        return;
      }
      // Clipboard & bulk selection: Ctrl+A select all, Ctrl+D duplicate the
      // selection, Ctrl+C copy, Ctrl+V paste. The typing guard at the top of
      // this handler already returns early inside INPUT/TEXTAREA/contentEditable,
      // so native field copy/paste/select-all is never hijacked.
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        selectAllNodes();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      // Zoom shortcuts: Ctrl+0 fit the whole diagram, Ctrl+1 100%, Ctrl+= in,
      // Ctrl+- out — the standard diagram-tool set. The typing guard above
      // keeps native browser zoom intact inside text fields.
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === '1' || e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        if (e.key === '0') zoomToFit();
        else if (e.key === '1') resetView();
        else if (e.key === '=' || e.key === '+') zoomBy(1.25);
        else zoomBy(1 / 1.25);
        return;
      }
      // Ctrl+F — open the node finder (typing guard above keeps native
      // browser find intact inside text fields).
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFinderOpen(true);
        return;
      }
      // F2 — inline rename of the single selected renameable node, same
      // flow as the card pencil (store/workspace with a rename callback).
      // The typing guard above already keeps F2 inert inside text fields.
      if (e.key === 'F2' && selectedNodeIds.size === 1) {
        e.preventDefault();
        // The renameable type gate and the node lookup now live in
        // startNodeRename, shared with the card and context-menu entry points
        // (slice R2). preventDefault keeps its old unconditional placement —
        // F2 is swallowed for a single selection even when the node is not
        // renameable, which is what the browser-inert behavior was before.
        startNodeRename([...selectedNodeIds][0]!);
        return;
      }
      if (selectedNodeIds.size > 0 && !e.repeat && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        // Shift = FINE nudge (1px, pixel-exact — never grid-rounded); plain
        // arrows move one full grid step when snap is on (deterministic,
        // no dead presses on-grid) or the raw 8px step when it is off.
        const step = e.shiftKey ? 1 : (snapEnabled ? GRID_SIZE : 8);
        const fine = e.shiftKey;
        // Arrow nudges share the SAME dynamic edge clamp as mouse dragging,
        // so keyboard and pointer movement agree on the reachable bounds.
        // The whole multi-selection nudges together. Positions are computed
        // UP FRONT (not inside the updater) so the alignment engine below
        // can run on the exact post-nudge geometry.
        const canvas = canvasRef.current;
        const next = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
          if (!selectedNodeIds.has(n.id)) continue;
          const rawX = n.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0);
          const rawY = n.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
          const clamped = clampNodeToViewport(rawX, rawY, {
            panX: pan.x,
            panY: pan.y,
            zoom,
            canvasW: canvas?.clientWidth ?? 0,
            canvasH: canvas?.clientHeight ?? 0,
          });
          next.set(n.id, {
            x: fine ? clamped.x : (snapEnabled ? snap(clamped.x) : clamped.x),
            y: fine ? clamped.y : (snapEnabled ? snap(clamped.y) : clamped.y),
          });
        }
        // Block a nudge that would step any selected node's box into a
        // STATIONARY node's box (round 141) — the keyboard path must respect
        // the same no-overlap invariant as drops. Selection members move
        // together (rigid), so they cannot newly overlap each other; only
        // stationary nodes matter. Flush alignment (zero gap, the guide
        // landing) is not an overlap and stays reachable. A blocked nudge is
        // NOT an edit: no history entry, no movement — the user hits a wall
        // and goes around instead of stepping a card under a neighbour.
        let blocked = false;
        for (const n of nodes) {
          if (selectedNodeIds.has(n.id)) continue;
          for (const pos of next.values()) {
            if (nodeBoxesOverlap(pos, n)) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) return;
        // Nudge-burst coalescing: discrete arrow presses within
        // NUDGE_COALESCE_MS on the same selection share ONE undo entry
        // (undo reverts the whole burst). The burst's FIRST press pushed
        // the entry (snapshotting the origin); continuation presses move
        // the nodes without pushing. A gap, selection change, other edit,
        // undo/redo, or fresh canvas ends the burst.
        const now = Date.now();
        const nudgeSession = nudgeSessionRef.current;
        const sameBurst =
          nudgeSession !== null &&
          now - nudgeSession.lastNudgeAt < NUDGE_COALESCE_MS &&
          nudgeSession.nodeIds.size === selectedNodeIds.size &&
          [...selectedNodeIds].every((id) => nudgeSession.nodeIds.has(id));
        if (sameBurst) {
          nudgeSession.lastNudgeAt = now;
        } else {
          pushHistory();
          nudgeSessionRef.current = { nodeIds: new Set(selectedNodeIds), lastNudgeAt: now };
        }
        // Figma-style alignment on FINE nudges only: the round-22 guide
        // engine runs on the nudged selection, so a Shift+arrow landing
        // flush against a neighbour shows the live guide. ENTRY-ONLY snap:
        // the correction applies only when the nudge itself crosses INTO the
        // 6px band (the pre-nudge position was outside it) — once inside,
        // raw 1px moves stand, so a snap can never eat every subsequent
        // nudge. The guide lingers while the band is held and clears when a
        // nudge (fine or grid) leaves it. Plain arrows skip the engine: they
        // are grid steps by design and clear any lingering guide.
        let dx = 0;
        let dy = 0;
        if (fine && next.size > 0) {
          const before = new Map<string, { x: number; y: number }>();
          for (const n of nodes) {
            if (selectedNodeIds.has(n.id)) before.set(n.id, { x: n.x, y: n.y });
          }
          const after = computeAlignmentGuides(next, selectedNodeIds, nodes);
          const pre = computeAlignmentGuides(before, selectedNodeIds, nodes);
          const inX = after.alignedX;
          const inY = after.alignedY;
          const enterX = after.alignedX && !pre.alignedX;
          const enterY = after.alignedY && !pre.alignedY;
          // Delta is the reference MINUS the dragged axis: a nudge must land
          // exactly flush on the line. Applied to the whole group, so it stays
          // rigid. (NOTE: the drag path applies the same delta with the
          // opposite sign — a known stick-lead discrepancy, journaled.)
          if (enterX) dx = -after.dx;
          if (enterY) dy = -after.dy;
          setAlignmentGuide(
            inX || inY
              ? { ...(inX ? { x: after.x } : {}), ...(inY ? { y: after.y } : {}) }
              : null,
          );
        } else {
          setAlignmentGuide(null);
        }
        setNodes((prev) =>
          prev.map((n) => {
            const p = next.get(n.id);
            if (!p) return n;
            return { ...n, x: p.x + dx, y: p.y + dy };
          }),
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The array below lists every identity the body reads, transcribed from the
    // rule's own report: the stable gesture/parent refs, the parent state setters,
    // isBranchLocation (a boolean, value-compared) and the GRID_SIZE /
    // NUDGE_COALESCE_MS / snap module constants (module-stable). All are stable or
    // primitive, so re-arm parity with the inline original is unchanged.
  }, [selectedNodeIds, selectedWireId, wires, pushHistory, popUndo, popRedo, confirmDelete, confirmDeleteMany, pan, zoom, deleteNodes, relationshipPicker, cancelRelationshipPicker, selectAllNodes, duplicateSelection, copySelection, pasteClipboard, nodes, startNodeRename, zoomToFit, zoomBy, resetView, snapEnabled, cancelDuplicateDrag, cancelNodeMove, convertDragToDuplicate, cancelBendDrag, finderOpen, clearSelection, setNodes, migrationOpen, cancelConnection, cancelMarquee, clearAll, GRID_SIZE, NUDGE_COALESCE_MS, bendDragRef, canvasRef, dragHasMovedRef, dragStartRef, duplicateDragRef, handleAddNodeRef, isBranchLocation, marqueeStartRef, migrationDismissedRef, nudgeSessionRef, setAlignmentGuide, setConfirmDelete, setConfirmDeleteMany, setFinderOpen, setMigrationOpen, snap, userInteractedRef]);
}
