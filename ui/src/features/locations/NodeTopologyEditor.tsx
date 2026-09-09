import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useLocalization } from '@fluent/react';
import { useToast } from '@/frontend/shared/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { TopologyDeleteDialogs } from './topologyDeleteDialogs';
import {
  type TopologyApplyResult,
  type TopologyNodePayload,
  type TopologyWirePayload,
} from '@/api/topology';
import { useSettings } from '@/contexts/SettingsContext';
import TopologyApplyConfirm from './TopologyApplyConfirm';
import { TopologyEmptyState } from './topologyEmptyState';
import { TopologyAlignBar } from './topologyAlignBar';
import { TopologyAlignmentGuides } from './topologyAlignmentGuides';
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  resolveDropOverlaps,
} from './nodeTopologyClamp';
import { computeAutoLayout } from './nodeTopologyLayout';
import { TopologyInspectorDrawer } from './topologyInspectorDrawer';
import { TopologyNodeCard } from './topologyNodeCard';
import { TopologyNodeFinder } from './topologyNodeFinder';
import { TopologyMinimap } from './topologyMinimap';
import { TopologyMigrationDialog } from './topologyMigrationDialog';
import { TopologyRelationshipPicker } from './topologyRelationshipPicker';
import { TopologyStatusStrip } from './topologyStatusStrip';
import { TopologyWireRenameOverlay } from './topologyWireRenameOverlay';
import { TopologyValidationWidget } from './topologyValidationWidget';
import type { TopologyOverlay } from './topologyBranchCompare';
import { layoutGhosts, buildGhostWireStubs, compareFocusDimIds, GHOST_WIDTH, GHOST_HEIGHT } from './topologyBranchCompare';
import { TopologyWireGroup } from './topologyWireGroup';
import { cubicBezier, polylinePoint, wireUnderCardSegments } from './topologyWireGeometry';
import { useTopologyEditorGraph, type TopologyHistoryEntry } from './nodeTopologyEditorState';
import { historyEntry, validWiresForNodes } from './topologyHistoryIntegrity';
import { useTopologyEditorSaveLifecycle } from './nodeTopologyEditorSaveState';
import { useTopologyEditorSelection } from './nodeTopologyEditorSelectionState';
import { useTopologyEditorDrag } from './nodeTopologyEditorDragState';
import { useTopologyEditorConnection } from './nodeTopologyEditorConnectionState';
import { useTopologyEditorHover } from './nodeTopologyEditorHoverState';
import {
  type TopologyValidationError,
} from './topologyContract';
import { nodeHeight, portRowCenterY, semanticRowIndex } from './topologyMetrics';
import { useTopologyEditorRestoreSeed } from './nodeTopologyEditorRestoreState';
import { useTopologyEditorLoadLifecycle } from './nodeTopologyEditorLoadLifecycle';
import { useTopologyEditorAnnouncements } from './nodeTopologyEditorAnnouncements';
import { useTopologyEditorBendDrag } from './topologyEditorBendDrag';
import { useTopologyEditorPointer } from './nodeTopologyEditorPointer';
import { useTopologyEditorTouch } from './nodeTopologyEditorTouch';
import { useTopologyEditorViewport, useTopologyEditorViewPrefs } from './nodeTopologyEditorViewport';
import { useTopologyEditorKeyboard } from './nodeTopologyEditorKeyboard';
import { useTopologyEditorNodeRename, useTopologyEditorWireRename } from './nodeTopologyEditorRename';
import { PIN_VERIFIED_SESSIONS, useTopologyEditorApplyPanel } from './nodeTopologyEditorApplyPanel';
import { useTopologyEditorMigration } from './nodeTopologyEditorMigration';
import { useTopologyEditorClipboard } from './nodeTopologyEditorClipboard';
import { useTopologyEditorIo } from './nodeTopologyEditorIo';
import { useTopologyEditorContextMenu } from './nodeTopologyEditorContextMenu';
import { useTopologyEditorWireCommit } from './nodeTopologyEditorWireCommit';
import { useTopologyEditorAddNode } from './nodeTopologyEditorAddNode';
import { useTopologyEditorDeleteConfirm } from './nodeTopologyEditorDeleteConfirm';
import { useTopologyEditorValidation } from './nodeTopologyEditorValidation';
import {
  cancelBendDecision,
  disconnectNode,
} from './topologyCommands';
import './NodeTopologyEditor.css';

// ── Extracted modules (Phase 1 split) ────────────────────────────────
// Pure helpers and presentational sub-components live in their own modules and
// are imported (and imported by tests/siblings) from THERE — this module keeps
// no compat re-export shim; only its own type surface is re-exported below.
import {
  elbowPoints,
  polylineD,
  canvasStateEqual,
  diagramNodeToCanvas,
  diagramWireToCanvas,
  diagramOverflowsCanvas,
  validateEditorGraph,
} from './topologyEditorHelpers';

import type {
  BranchLocationSeed,
  NodeType,
  PortName,
  SemanticRelationshipType,
  TopologyNodeData,
  TopologyWireData,
  WireDirection,
  WorkspaceInstanceSeed,
} from './nodeTopologyEditorTypes';
import type { AlignMode } from './topologyAlignGlyph';
import { CanvasCursorReadout } from './topologyCanvasCursorReadout';
import { TopologyHeader } from './topologyHeader';
import { TopologyToolRack } from './topologyToolRack';
import { TopologyContextMenu } from './topologyContextMenu';
import { TopologyCanvasZoomControls } from './topologyCanvasZoomControls';

// ── Types ──────────────────────────────────────────────────────────

/** Shared stable empty array for cards with no visible validation errors
 *  (a fresh [] per card per render would defeat the card memo). */
const EMPTY_ERRORS: TopologyValidationError[] = [];

// The domain types above live in ./nodeTopologyEditorTypes (slice P5-A/S2a).
// Re-exported here because this module is the topology editor's deliberate
// public entry point — sibling modules and tests keep importing these type
// names from `./NodeTopologyEditor` unchanged. Type-only, so this adds no
// runtime value export (react-refresh stays clean).
export type { NodeType, WorkspaceTypeKey, WireDirection, PortName, SemanticRelationshipType, TopologyNodeData, TopologyWireData, BranchLocationSeed, WorkspaceInstanceSeed } from './nodeTopologyEditorTypes';

/** Click cycle order for wire direction (1 → 2 → 3 → 1). */
const WIRE_DIRECTION_CYCLE: WireDirection[] = ['one-way', 'reverse', 'two-way'];

export interface NodeTopologyEditorProps {
  currentTier?: 'free' | 'one_time' | 'plus' | 'pro' | 'premium' | 'enterprise';
  /**
   * Optional toolbar content rendered inside the topology header, above the
   * title/actions row. The parent screen uses this slot to merge its branch
   * (graph) selector toolbar into the editor's header instead of rendering a
   * separate stacked bar.
   */
  branchToolbar?: ReactNode;
  /**
   * Called when the user clicks "Apply Topology Changes". Returns an
   * optional `oldId -> newId` map so the editor can remap its local
   * state when archive+recreate assigns new UUIDs (Critical #1).
   */
  onSave?: (
    nodes: TopologyNodeData[],
    wires: TopologyWireData[],
    baseRevision?: number,
    resolvedIssueKeys?: string[],
    /** ADR #46 §6: the operator's "why", typed in the Apply dialog. Empty
     *  string means no note, which the history shows as such. */
    changeNote?: string,
  ) => Promise<(TopologyApplyResult & { idMap?: Record<string, string> }) | Record<string, string> | void>;
  /**
   * Real workspace instances to seed the canvas with. When provided, the
   * editor renders one workspace node per instance (positions restored from
   * the saved topology diagram when available) instead of the demo preset.
   * This makes the canvas reflect the actual `workspace_instances` table so
   * the parent's onSave diff can create / update / archive correctly.
   */
  workspaceInstances?: WorkspaceInstanceSeed[];
  /** Branch Locations available to seed the ownership graph. */
  branchLocations?: BranchLocationSeed[];
  /** Persist a Branch Location (store profile) rename from the node card.
   *  Resolves true on success so the card can close its inline form;
   *  false keeps the draft open for a retry (the parent toasts errors). */
  onRenameBranch?: (id: string, name: string) => Promise<boolean> | boolean | void;
  /** Persist a workspace instance rename from the node card (the live
   *  instance row, not just the canvas label). Same contract as
   *  onRenameBranch: true closes the form, false keeps the draft open. */
  onRenameWorkspace?: (id: string, name: string) => Promise<boolean> | boolean | void;
  /** Allow Apply before the parent supplies real branch identities. */
  allowLegacyApply?: boolean;
  /** Branch (graph) identity for viewport memory — pan/zoom persist per
   *  branch so switching branches (which remounts the editor) lands back
   *  where the user left off instead of resetting to identity. The parent
   *  passes the same value it uses to key the remount. */
  branchId?: string;
  /** Reports the canvas dirty state upward (true after any edit, false after
   *  Apply/undo-to-snapshot). The parent uses it to guard branch switches
   *  against silently discarding unsaved edits — the editor cannot veto its
   *  own remount, so the guard must live in the parent. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Reports an authoritative topology load failure so the parent can keep
   *  Apply disabled instead of allowing a preset to overwrite unknown data. */
  onLoadError?: (error: unknown) => void;
  /** Reports that the authoritative topology request completed successfully. */
  onLoadSuccess?: () => void;
  /** Spatial branch-diff overlay (round 158): the compare panel's
   *  classification rendered over the canvas. Other-only workspaces become
   *  ghost cards at their saved positions; current-only and shared-differing
   *  ids get red / amber markers on their existing cards. Display-only —
   *  ghosts are pointer-events-none and nothing here writes back. */
  compareOverlay?: TopologyOverlay | null;
  /**
   * Compare-focus mode (round 162): when on, every shared-identical
   * workspace dims so only the differences stay bright — the spatial
   * diff becomes a review view instead of a snapshot. No effect without
   * a compare overlay. Display-only.
   */
  compareFocus?: boolean;
  /**
   * Whether the session user is allowed to persist topology changes.
   * The backend gates `apply_topology_diff` on `staff:update` (granted to
   * Owner/Manager/Staff presets); when false the editor renders in view-only
   * mode — Apply is disabled with an explanatory tooltip and a header notice.
   * Defaults to true so standalone editor usages (tests, dev presets) keep
   * their current behavior.
   */
  canSave?: boolean;
  /**
   * ADR #46 §5 restore-to-draft: a revision's diagram the PARENT (the
   * revision browser's host screen) has decided to load onto the canvas as
   * an unsaved draft. The editor owns no restore UI, state, or command —
   * the parent fetches the graph, stamps this prop with a fresh object
   * identity per restore request, and the editor replaces the canvas with
   * the mapped diagram and clears undo/redo, exactly like the
   * authoritative load. Changing the prop identity seeds the draft; the
   * screen guards unsaved-edit loss before arming it. Erasing it (back to
   * undefined/null) does nothing — a one-shot seed, not a live binding.
   */
  restoreSeed?: { nodes: TopologyNodePayload[]; wires: TopologyWirePayload[] } | null;
}

/** Valid workspace type keys come from the node kind registry
 *  (`SELECTABLE_WORKSPACE_TYPE_KEYS`, ADR #45 §3); labels are resolved at
 *  render time via l10n.getString for i18n. */

/** Evaluate a cubic bezier at parameter t (0-1). */
const GRID_SIZE = 24;

/** Nudge-burst coalescing window: discrete arrow presses closer together
 *  than this (on the same selection) share ONE undo entry; a longer gap
 *  starts a fresh entry. Chosen to cover a fast typing burst without
 *  folding deliberately-separated nudges into one undo step. */
const NUDGE_COALESCE_MS = 1500;
const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

export default function NodeTopologyEditor({
  currentTier = 'free',
  onSave,
  workspaceInstances,
  branchLocations,
  onRenameBranch,
  onRenameWorkspace,
  allowLegacyApply = true,
  branchToolbar,
  branchId,
  onDirtyChange,
  onLoadError,
  onLoadSuccess,
  compareOverlay,
  compareFocus = false,
  canSave = true,
  restoreSeed,
}: NodeTopologyEditorProps) {
  const { sessionToken, resolvedStoreId: sessionStoreId } = useWorkspace();
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  /** Latest l10n for ref-based callbacks (duplicate commit/cancel) so the
   *  announcement strings always come from the current bundle. */
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;    const { settings } = useSettings();

  const canvasRef = useRef<HTMLDivElement>(null);

  const {
    nodes,
    wires,
    history,
    redo,
    setNodes,
    setWires,
    setHistory,
    setRedo,
  } = useTopologyEditorGraph<TopologyNodeData, TopologyWireData>([], []);
  type HistoryEntry = TopologyHistoryEntry<TopologyNodeData, TopologyWireData>;
  /** Save/apply lifecycle: load settling, branch document revision, and the
   *  Apply in-flight guard now live in one typed state machine instead of
   *  scattered booleans. `settled` keeps the dismissal forget-effect gated on
   *  the first authoritative load (the editor mounts on the retail preset
   *  while the async load is in flight — that placeholder graph must never be
   *  treated as the real diagram). */
  const {
    revision: topologyRevision,
    busy: saving,
    settled: topologyLoaded,
    loadSuccess,
    loadFailure,
    beginApply,
    finishApply,
    failApply,
  } = useTopologyEditorSaveLifecycle();
  /** Branch-scoped issue dismissals loaded from and saved with the topology. */
  const [resolvedIssues, setResolvedIssues] = useState<Set<string>>(new Set());
  /** Monotonic token bumped to force an authoritative reload on demand — the
   *  revision-conflict recovery adopts the newer topology by re-running the
   *  load effect (which also depends on workspaceInstances/branchLocations). */
  const [reloadKey, setReloadKey] = useState(0);

  /** Selection (primary node, multi-selection set, wire) lives in one
   *  typed reducer — node and wire selection are mutually exclusive by
   *  construction, so a stray wire can never shadow the toolbar Delete
   *  path or leave the inspector showing a phantom target. */
  const {
    nodeId: selectedNodeId,
    nodeIds: selectedNodeIds,
    wireId: selectedWireId,
    selectOnly,
    selectMany,
    addToSelection,
    selectWire,
    clearSelection,
    clearWire,
    clearAll,
    pruneSelection,
  } = useTopologyEditorSelection();
  /** Render-time mirror so the memoized card handlers read the CURRENT
   *  selection without taking it as a useCallback dep (a dep would churn
   *  the handler identity on every selection change and defeat the card
   *  memo for unrelated cards). */
  const selectedNodeIdsRef = useRef<Set<string>>(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  /** Drag lifecycle (render set + synchronous ref mirror) lives in one
   *  typed reducer — every begin/end/cancel writes both faces together, so
   *  the touch gesture loop's stale-closure reads can never see a drag
   *  that was already cancelled. */
  const {
    draggingNodeIdsRef,
    beginDrag,
    endDrag,
    cancelDrag,
  } = useTopologyEditorDrag();
  const dragOffsetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  /** Alt+drag duplicate mode: true while an in-flight drag is duplicating
   *  (the copies follow the cursor, the originals stay). Committed (one
   *  undo entry) on mouseup, cancelled by Escape. */
  const duplicateDragRef = useRef(false);
  /** Ids of the live duplicate copies during an Alt+drag (the drag set). */
  const duplicateCopyIdsRef = useRef<string[]>([]);
  /** True when an Alt+drag was converted MID-move: the move's history entry
   *  (pushed at first movement) IS the pre-drag state, so the commit must
   *  not push a duplicate entry and the cancel must pop it. */
  const duplicateHistoryPushedRef = useRef(false);
  /** Live alignment guide lines while dragging: the snapped edge/center
   *  coordinate (canvas units) for a vertical (x) and/or horizontal (y)
   *  guide. Null while idle. Cleared on mouseup. */
  const [alignmentGuide, setAlignmentGuide] = useState<{ x?: number; y?: number } | null>(null);
  /** Marquee box selection: null while idle, a rect in container-relative
   *  screen px while left-dragging on empty background. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Mirror of the rendered marquee rect so the document-level finalizer
   *  (armed at mousedown) always reads the LATEST box — refs never go
   *  stale across renders, and a release event may carry no pointer coords. */
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  /** True while a marquee drag runs with Shift held — its result UNIONs into
   *  the pre-drag selection at release instead of replacing it. Reset by the
   *  finalizer (or the next mousedown), so it can never leak across drags. */
  const marqueeAdditiveRef = useRef(false);
  /** Cancels an in-flight marquee when the pointer is released outside the
   *  canvas — the canvas onMouseUp never fires there, so without a
   *  document-level listener the box would linger and the next mousemove
   *  would re-open it. Mirrors dragCleanupRef for node drags. */
  const marqueeCleanupRef = useRef<(() => void) | null>(null);
  /** Set once a drag has actually moved the node — history is pushed on the
   *  first movement, not on mousedown, so a plain click-to-select never
   *  creates a no-op undo entry or marks the canvas dirty. */
  const dragHasMovedRef = useRef(false);
  /** Pre-drag positions of the nodes in an in-flight MOVE (filled at node
   *  mousedown, cleared on mouseup/cancel). Escape mid-move restores these
   *  so the drag snaps back to where it started (Figma semantics). Empty
   *  while idle — which is also what distinguishes "a move is in flight"
   *  from a plain Escape in the keydown handler. */
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  /** In-flight bend drag: which wire, which bend index, its pre-drag
   *  position (Escape restores it), whether it has moved yet (history is
   *  pushed on first movement, one entry per drag), and whether the bend
   *  was CREATED by this gesture (a ghost insert — cancel then removes it
   *  entirely instead of restoring). pendingInsert marks a created bend
   *  whose insertion is deferred to the first drag movement (a click
   *  without drag on a ghost must leave no trace). */
  const bendDragRef = useRef<{
    wireId: string;
    index: number;
    moved: boolean;
    startX: number;
    startY: number;
    created: boolean;
    pendingInsert: boolean;
  } | null>(null);
  /** Document-listener cleanup for a bend drag (minimap pattern) — the
   *  drag must keep tracking when the pointer leaves the handle. */
  const bendDragCleanupRef = useRef<(() => void) | null>(null);
  /** Set of node ids that were just added (for scale-in animation). */
  const [freshNodeIds, setFreshNodeIds] = useState<Set<string>>(new Set());
  /** Timers for fresh-node animation cleanup; cleared on unmount to prevent leaks. */
  const freshTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  /** Per-branch viewport memory: pan/zoom persist per branch id so a branch
   *  switch (which remounts the editor) lands back where the user left off
   *  instead of resetting to identity. 'unassigned' mirrors the parent's
   *  key fallback for diagrams with no selected branch. */
  const viewKey = `oz-topology-viewport:${branchId ?? 'unassigned'}`;
  /** Lazy mount-time read of the saved view. Restoring one marks the view as
   *  user-owned so the auto-fit effect (which fits overflowing NEW diagrams)
   *  never yanks a saved position. */
  const [savedView] = useState<{ zoom: number; pan: { x: number; y: number } } | null>(() => {
    try {
      const raw = localStorage.getItem(viewKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { zoom?: number; pan?: { x: number; y: number } } | null;
        if (parsed && typeof parsed.zoom === 'number' && parsed.pan
          && typeof parsed.pan.x === 'number' && typeof parsed.pan.y === 'number') {
          return { zoom: parsed.zoom, pan: parsed.pan };
        }
      }
    } catch { /* corrupted view — fall back to identity */ }
    return null;
  });
  const restoredViewRef = useRef(savedView !== null);
  const [zoom, setZoom] = useState(() => (savedView ? Math.max(0.4, Math.min(2.0, savedView.zoom)) : 1));
  const [pan, setPan] = useState<{ x: number; y: number }>(() => savedView?.pan ?? { x: 0, y: 0 });

  /** Viewport machinery (slices 3.5a + 3.5b-1): the debounced per-diagram
   *  viewport persist, minimap visibility with its own per-diagram key, the
   *  center/nudge helpers the minimap drives, and the zoom cluster. The call
   *  sits exactly where the view-persist block lived, so hook order — and
   *  therefore effect order — is what the component already had. The zoom/pan
   *  STATE and viewKey stay above it: they have consumers outside this
   *  machinery (pointer + touch hook deps, the zoom popover, the label
   *  transforms), and the savedView restore read seeds those initializers. */
  const {
    zoomToFit,
    zoomToSelection,
    zoomBy,
    resetView,
    minimapVisible,
    setMinimapVisible,
    centerViewportOn,
    nudgeViewport,
  } = useTopologyEditorViewport({
    branchId,
    viewKey,
    zoom,
    pan,
    setZoom,
    setPan,
    canvasRef,
    nodes,
    selectedNodeIds,
  });

  /** Node finder (Ctrl+F) open state — owned here because the central
   *  keydown handler opens it on Ctrl+F and closes it on a canvas-focus
   *  Escape; the overlay's query/index/list and input keydown live in
   *  `TopologyNodeFinder`. */
  const [finderOpen, setFinderOpen] = useState(false);
  const closeFinder = useCallback(() => setFinderOpen(false), []);
  /** Latest zoom for ref-based math (finder centering) without re-arming
   *  document listeners. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** Jump the viewport to a finder match: select it, center it at the
   *  current zoom, and close the overlay. */
  const jumpToFinderMatch = useCallback((match: TopologyNodeData) => {
    selectOnly(match.id);
    const canvas = canvasRef.current;
    if (canvas) {
      setPan({
        x: canvas.clientWidth / 2 - (match.x + NODE_WIDTH / 2) * zoomRef.current,
        y: canvas.clientHeight / 2 - (match.y + NODE_HEIGHT / 2) * zoomRef.current,
      });
    }
    setFinderOpen(false);
  }, [selectOnly]);
  const {
    wireRouting,
    setWireRouting,
    snapEnabled,
    setSnapEnabled,
    wireLabelsVisible,
    setWireLabelsVisible,
  } = useTopologyEditorViewPrefs({ branchId });
  /** Pan tool: while active, left-drags on the empty canvas pan instead of
   *  marqueeing — the touchscreen-friendly twin of Space+drag. */
  const [panToolActive, setPanToolActive] = useState(false);
  /** Any wire carrying authored bends. The elbow/curved toggle then applies
   *  only to UNBENT wires (authored geometry wins), so the View rack shows
   *  an override note instead of letting the toggle silently lie. */
  const anyBentWires = wires.some((w) => (w.bends?.length ?? 0) > 0);
  /** Grid-aware placement: identity when the snap toggle is off. */
  const snapOrNot = (v: number) => (snapEnabled ? snap(v) : v);
  /** Live cursor position in canvas coords while a connection is in flight
   *  — drives the wire preview so it follows the pointer, not just the
   *  last hovered target. */
  const [previewCursor, setPreviewCursor] = useState<{ x: number; y: number } | null>(null);
  /** Latest pointer position for the in-flight wire preview (the
   *  connection line follows the last cursor position when no socket is
   *  hovered). Ref-only — the readout no longer needs it; CanvasCursorReadout
   *  owns its own listener and rAF. */
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** Round 169: while a mouse-pan drag is in flight, the ghost layer drops
   *  its glide transition so an edge-anchored ghost tracks the pointer
   *  instead of trailing it (state mirrors isPanningRef — a ref alone
   *  would not re-render the class toggle). */
  const [panGestureActive, setPanGestureActive] = useState(false);
  const isPanningRef = useRef(false);
  /** Right-button drags emit a native contextmenu after mouseup. Track
   *  whether the pan actually moved so that gesture is suppressed while a
   *  stationary right-click still opens the canvas menu. */
  const panMovedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panCleanupRef = useRef<(() => void) | null>(null);

  /** Document touch-gesture listener teardown. Declared beside its pan/drag/
   *  marquee siblings rather than inside the touch hook (slice 3.4e): the unmount
   *  sweep fires it as well, so the hook receives it through deps. */
  const touchCleanupRef = useRef<(() => void) | null>(null);
  /** Space held → the next left-drag pans (Figma-style) instead of
   *  marqueeing. Mirrored in state purely for the grab cursor class. */
  const spaceDownRef = useRef(false);
  const [spacePanArmed, setSpacePanArmed] = useState(false);

  useEffect(() => {
    // Space is the pan modifier. It must NOT arm while typing or when a
    // control owns the key (e.g. the wire hitbox's Space cycle-to-direction
    // — a focused role=button keeps its own Space behavior).
    const isTypingOrControl = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"], button, [role="button"]');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isTypingOrControl(e.target)) return;
      e.preventDefault(); // keep the page from scrolling while arming pan
      spaceDownRef.current = true;
      setSpacePanArmed(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDownRef.current = false;
      setSpacePanArmed(false);
    };
    // Window blur / tab-hidden: the browser delivers keyup to the NEW focus
    // target, so a Space held across alt-tab (or a dialog stealing focus)
    // never reaches this page. Without this disarm the pan would stay armed
    // and the next left-drag would pan instead of marquee-selecting.
    const disarm = () => {
      spaceDownRef.current = false;
      setSpacePanArmed(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') disarm();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', disarm);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', disarm);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  /** Cancels an in-flight node drag when the pointer is released outside
   *  the canvas — the canvas onMouseUp never fires there, so without this
   *  the node would keep following the cursor on re-entry (ghost drag). */
  const dragCleanupRef = useRef<(() => void) | null>(null);

  /** In-flight wire connection + relationship picker live in one typed
   *  reducer — dismissing the picker always clears the armed connection
   *  (a stale source port click must never complete a wire after the
   *  choice was abandoned). */
  const {
    fromNodeId: connectingFromNodeId,
    fromPort: connectingFromPort,
    fromVariantIndex: connectingFromVariantIndex,
    picker: relationshipPicker,
    beginConnection,
    openPicker,
    cancelConnection,
    dismissPicker,
  } = useTopologyEditorConnection();
  /** Nearest target port while dragging a connection, for snap-to-port preview. */
  const [hoveredTarget, setHoveredTarget] = useState<{ nodeId: string; port: PortName; variantIndex: number } | null>(null);

  /** Mirror of `history` state for synchronous reads in undo/redo handlers. */
  const historyRef = useRef<HistoryEntry[]>([]);
  historyRef.current = history;

  /** Right-side tool rack panel state. Collapsed on mount so the editor
   *  opens on a clean canvas — arriving from the home screen's "Add
   *  Workspace" (or anywhere else) should not auto-expand the add-node
   *  palette. Each panel opens on its rack-icon click. */
  const [rackPanel, setRackPanel] = useState<string | null>(null);
  const toggleRackPanel = useCallback((key: string) => setRackPanel((p) => (p === key ? null : key)), []);

  /** Session-level PIN cache. When set, subsequent Apply calls skip the
   *  verifyPin prompt — the checkbox in the dialog controls whether the
   *  flag is remembered for the session. The cache lives in a module-scope
   *  set keyed by session token (not a component ref) so a branch switch —
   *  which remounts this editor — keeps the remembered PIN, matching the
   *  "for this session" label. Stays here because confirmApply reads it to
   *  decide whether to verify at all. */
  const pinVerifiedRef = useRef(PIN_VERIFIED_SESSIONS.has(sessionToken ?? ''));

  /** Live canvas getter for the relationship picker's position clamp. */
  const getCanvas = useCallback(() => canvasRef.current, []);
  /** Legacy-schema migration dialog (ADR #34 item 7): a fully-unknown
   *  legacy wire (normalized to legacy-out/legacy-in) cannot be applied —
   *  the dialog resolves each one in place from the node types' LEGAL
   *  relationships (never a silent reinterpretation) or deletes it. The
   *  derived memos and handlers live after liveValidation; only the state
   *  lives here (the keydown effect below reads it). */
  const [migrationOpen, setMigrationOpen] = useState(false);
  /** "Later"/Escape dismisses the dialog for this load session; a fresh
   *  load resets it so the migration is re-offered. */
  const migrationDismissedRef = useRef(false);
  /** Per-wire choice: index into the entry's option list, or 'delete'. */
  const [migrationSelections, setMigrationSelections] = useState<Record<string, number | 'delete'>>({});

  /** Cancel the relationship picker AND the in-flight connection it
   *  belongs to (same cleanup as an incompatible drop). Declared early so
   *  the keyboard effect's deps can reference it (const TDZ). The reducer's
   *  cancel is atomic — picker and connection always clear together. */
  const cancelRelationshipPicker = useCallback(() => {
    cancelConnection();
    // Return focus to the canvas so keyboard users resume where they left off.
    canvasRef.current?.focus();
  }, [cancelConnection, canvasRef]);

  /** Skip the next workspaceInstances-triggered reload (set before calling onSave). */
  const skipNextLoadRef = useRef(false);
  /**
   * Exact dirty tracking: the canvas as of the last Apply success, preset
   * load, or authoritative load. Dirty is DERIVED at preset-click time by
   * comparing the current canvas against this snapshot (canvasStateEqual),
   * instead of the previous conservative boolean that was armed by every
   * pushHistory/undo/redo — that over-approximated by marking a canvas
   * dirty even when undo/redo had returned it to EXACTLY the last applied
   * state (e.g. undoing a same-preset load showed a spurious confirm).
   * A null snapshot (never applied) counts as dirty.
   */
  const appliedSnapshotRef = useRef<{ nodes: TopologyNodeData[]; wires: TopologyWireData[] } | null>(
    { nodes, wires },
  );
  // Live mirrors so the drag, copy, and validation readers below always
  // see the current canvas without re-binding their closures.
  const nodesRef = useRef<TopologyNodeData[]>(nodes);
  nodesRef.current = nodes;
  const wiresRef = useRef<TopologyWireData[]>(wires);
  wiresRef.current = wires;
  /** Pan mirror for the same stale-closure reason as draggingNodeIdsRef:
   *  applyDragMove auto-pans the viewport mid-drag, so the drag math must
   *  always read the CURRENT pan (a down-time closure would compute targets
   *  against the pre-pan view and the dragged node would lag the pointer).
   *  zoom has an existing mirror (zoomRef, used by the finder centering). */
  const panRef = useRef(pan);
  panRef.current = pan;
  /** Last pointer position fed to applyDragMove, for edge auto-pan's
   *  direction gate: the viewport only pans when the drag moves TOWARD the
   *  edge the pointer sits in — a drag that drifts away from the edge (or
   *  holds still) must not scroll. Seeded at drag start so the first move
   *  has a baseline. */
  const lastDragMovePosRef = useRef<{ x: number; y: number } | null>(null);
  /** The canvas's single dirty derivation. The comparison itself is a
   *  memo over the current nodes/wires; `snapshotVersion` exists because a
   *  ref cannot drive re-renders — commitSnapshot bumps it so the memo
   *  re-derives after every Apply or authoritative load. */
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const commitSnapshot = useCallback((next: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => {
    appliedSnapshotRef.current = next;
    setSnapshotVersion((v) => v + 1);
  }, []);
  const isDirty = useMemo(() => {
    const snap = appliedSnapshotRef.current;
    if (!snap) return true;
    // snapshotVersion has no bearing on the comparison itself — its only
    // job is to be a dependency so the memo re-derives after commitSnapshot
    // bumps it (a ref alone cannot trigger a re-render).
    void snapshotVersion;
    // During a drag the canvas is always dirty (positions changing). Skip
    // the per-field comparison to avoid O(N+W) allocation per mousemove.
    if (dragHasMovedRef.current) return true;
    return !canvasStateEqual(snap.nodes, snap.wires, nodes, wires);
  }, [nodes, wires, snapshotVersion]);

  /** Surface the dirty flag upward for the parent's branch-switch guard.
   *  Fires on mount (post-load clean) and on every dirty transition; a
   *  stable parent callback makes this effect fire only on real changes. */
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  /** Hover-focus mode: while a node card is hovered, non-connected nodes
   *  and wires dim so the neighbourhood reads at a glance (Figma-style
   *  focus). Null when nothing is hovered — no dimming at all. Lives in one
   *  typed reducer with the wire hover: node/wire hover are mutually
   *  exclusive, and a structural canvas replacement or node/wire removal
   *  prunes the stale id (React never fires mouseleave on unmount, so a
   *  stale hover would otherwise dim the whole diagram until the next
   *  hover). */
  const {
    nodeId: hoveredNodeId,
    wireId: hoveredWireId,
    hoverNode,
    hoverWire,
    clearHover,
    pruneHover,
  } = useTopologyEditorHover();
  const hoverConnections = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set([hoveredNodeId]);
    for (const w of wires) {
      if (w.fromNodeId === hoveredNodeId) ids.add(w.toNodeId);
      if (w.toNodeId === hoveredNodeId) ids.add(w.fromNodeId);
    }
    return ids;
  }, [hoveredNodeId, wires]);

  /** Right-click context-menu state, the document close effect and the
   *  two object-scoped open handlers (slice G18) live in
   *  useTopologyEditorContextMenu; the returned names are the original
   *  locals, so the pointer/touch hooks, resetTransientCanvasState and
   *  the JSX mount are untouched. */
  const {
    contextMenu,
    setContextMenu,
    openNodeMenu,
    openWireMenu,
  } = useTopologyEditorContextMenu({
    canvasRef,
    selectOnly,
    selectWire,
  });

  /** Whether the zoom-level button's slider popover is open. Closed by
   *  Escape or any document mousedown outside the picker (the picker
   *  wrapper stops propagation, so slider drags never close it). */
  const [zoomPickerOpen, setZoomPickerOpen] = useState(false);
  /** Save-template popover: open flag + the in-flight template name. */
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  /** Templates popover: open flag + the last-listed names (re-listed on
   *  open and after a delete so the list never goes stale). */
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<string[]>([]);
  useEffect(() => {
    if (!zoomPickerOpen) return;
    const close = () => { setZoomPickerOpen(false); };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [zoomPickerOpen]);

  /** Bounding box of the current multi-selection in canvas coords — the
   *  align/distribute toolbar floats above it. Null unless 2+ nodes are
   *  selected (alignment needs a pair, distribution needs the box). */
  const selectionBounds = useMemo(() => {
    const sel = nodes.filter((n) => selectedNodeIds.has(n.id));
    if (sel.length < 2) return null;
    const minX = Math.min(...sel.map((n) => n.x));
    const minY = Math.min(...sel.map((n) => n.y));
    const maxX = Math.max(...sel.map((n) => n.x + NODE_WIDTH));
    const maxY = Math.max(...sel.map((n) => n.y + nodeHeight(n)));
    return { minX, minY, maxX, maxY };
  }, [nodes, selectedNodeIds]);

  /** Select every node on the canvas (context menu action). */
  const selectAllNodes = useCallback(() => {
    selectMany(nodes.map((n) => n.id), null);
  }, [selectMany, nodes]);

  /**
   * Node id for which an inspector edit already pushed an undo entry in
   * the current selection session. Inspector fields push history once on
   * the FIRST change after selecting a node, so a whole typing burst in
   * the name/subtitle/type controls is a single undo step — not one
   * entry per keystroke. Reset on selection change and undo/redo. */
  const inspectorHistoryPushedForRef = useRef<string | null>(null);

  /** Nudge-burst session: the node set and last-press time of the current
   *  arrow-key burst. Discrete presses within NUDGE_COALESCE_MS on the SAME
   *  selection share ONE undo entry — undo reverts the whole burst, not the
   *  last pixel step (the journal's round-165 follow-up). The burst ends on
   *  a time gap, a selection change (same-selection check in the nudge
   *  handler), any other history-pushing edit (pushHistory clears it), an
   *  undo/redo (popUndo/popRedo clear it), or a fresh canvas
   *  (resetTransientCanvasState clears it). */
  const nudgeSessionRef = useRef<{ nodeIds: Set<string>; lastNudgeAt: number } | null>(null);

  // Premium is Pro-equivalent (backend max_warehouses / capacity both
  // include it) — the spawn gate and the live validation must agree with
  // the Apply boundary or a Premium install blocks its second Stock Room.
  const isProAllowed = useMemo(() => ['pro', 'premium', 'enterprise'].includes(currentTier), [currentTier]);

  // Slice A (saas-2 §J downgrade tail): warehouse over-limit readout. The count
  // comes from the editor's in-graph node state (no new IPC); the cap comes from
  // SubscriptionCapabilities.maxWarehouses via useSubscription.
  const { caps } = useSubscription();
  const warehouseCount = useMemo(
    () => nodes.filter((n) => n.type === 'warehouse').length,
    [nodes],
  );
  /** True when adding `extra` warehouse nodes would exceed the tier cap
   *  (one warehouse per install below Pro). The palette spawn, Ctrl+D,
   *  Ctrl+V, Alt+drag, and the mid-drag Alt conversion ALL share this gate
   *  so no creation path can bypass it. Reads nodesRef for freshness inside
   *  callbacks with stable deps. */
  const wouldExceedWarehouseCap = useCallback(
    (extra: number) =>
      !isProAllowed && nodesRef.current.filter((n) => n.type === 'warehouse').length + extra > 1,
    [isProAllowed],
  );
  /** Validate a pending duplicate/paste BEFORE any mutation: warehouses obey
   *  the Pro-tier cap. Returns the FTL toast id to refuse with, or null when
   *  the gesture is allowed. Every duplicate path shares it so the gate can
   *  never be bypassed by an alternate route. */
  const duplicateRefusal = useCallback(
    (copies: TopologyNodeData[]): string | null => {
      const whCopies = copies.filter((n) => n.type === 'warehouse').length;
      if (whCopies > 0 && wouldExceedWarehouseCap(whCopies)) return 'topology-toast-multi-warehouse';
      return null;
    },
    [wouldExceedWarehouseCap],
  );

  /** O(1) node lookup by id — replaces `nodes.find` in hot paths (wire rendering, etc.). */
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Announcements (Phase 3.3 hook): the hook owns the live-region state,
  // the snap-entry latch, and the selection settle debounce; the aliases
  // keep every one-shot call site and the rendered live region unchanged.
  const {
    announcement: liveAnnouncement,
    announce: setLiveAnnouncement,
  } = useTopologyEditorAnnouncements({
    alignmentGuide,
    selectedNodeIds,
    selectedWireId,
    nodeMap,
    l10nRef,
  });

  /** Relationship type display metadata: color, icon SVG, and localized label. */
  const relationshipStyle = useCallback((type?: SemanticRelationshipType): { color: string; icon: string; label: string } => {
    const map: Record<string, { color: string; icon: string; labelKey: string }> = {
      'location':            { color: '#3b82f6', icon: '📍', labelKey: 'topology-relationship-location' },
      'generic':             { color: '#6b7280', icon: '🔗', labelKey: 'topology-relationship-generic' },
      'stock-routing':       { color: '#10b981', icon: '📦', labelKey: 'topology-relationship-stock-routing' },
      'inventory-transfer':  { color: '#f59e0b', icon: '🔄', labelKey: 'topology-relationship-inventory-transfer' },
      'ticket-routing':      { color: '#8b5cf6', icon: '🎫', labelKey: 'topology-relationship-ticket-routing' },
      'hardware-connection': { color: '#ef4444', icon: '🔌', labelKey: 'topology-relationship-hardware-connection' },
    };
    const entry = type ? map[type] : undefined;
    return {
      color: entry?.color ?? '#6b7280',
      icon: entry?.icon ?? '🔗',
      label: entry ? l10n.getString(entry.labelKey) : l10n.getString('topology-relationship-generic'),
    };
  }, [l10n]);

  /** User-visible wire label: the custom label, else the endpoint-name join,
   *  else the generic connection fallback. Shared by the context-menu title
   *  and the label pills so the two surfaces can never disagree. */
  const wireDisplayLabel = (wire: TopologyWireData) =>
    wire.label
      || [nodeMap.get(wire.fromNodeId)?.name, nodeMap.get(wire.toNodeId)?.name].filter(Boolean).join(' → ')
      || l10n.getString('topology-wire-label-connected');

  /** Precomputed wire path geometry — avoids recomputing bezier curves on every render. */
  const wireGeometries = useMemo(() => {
    const geo = new Map<string, {
      x1: number; y1: number; x2: number; y2: number;
      dx: number;
      pathD: string;
      polyline?: Array<[number, number]>;
    }>();
    for (const wire of wires) {
      const fromNode = nodeMap.get(wire.fromNodeId);
      const toNode = nodeMap.get(wire.toNodeId);
      if (!fromNode || !toNode) continue;
      const fromPort = wire.fromPort ?? 'right';
      const toPort = wire.toPort ?? 'left';
      // Round 174 stacked ports: each semantic is its own row, so a wire's
      // endpoint Y is the portRowCenterY of the row its recorded semantic
      // occupies (falling back to the primary row for untyped wires). This
      // replaces the old constant NODE_PORT_Y single-rail endpoint.
      const fromRowIndex = semanticRowIndex(fromNode, fromPort, wire.fromPortId);
      const toRowIndex = semanticRowIndex(toNode, toPort, wire.toPortId);
      const x1 = fromNode.x + (fromPort === 'right' ? NODE_WIDTH : 0);
      const y1 = fromNode.y + portRowCenterY(fromNode, fromRowIndex);
      const x2 = toNode.x + (toPort === 'right' ? NODE_WIDTH : 0);
      const y2 = toNode.y + portRowCenterY(toNode, toRowIndex);
      const dx = Math.abs(x2 - x1) * 0.5;
      if (wire.bends && wire.bends.length > 0) {
        // User-authored bends take precedence over auto routing: the wire
        // becomes a polyline through the bend points (the pulse rides the
        // same polyline, so the simulation follows the bent path).
        const pts: Array<[number, number]> = [
          [x1, y1],
          ...wire.bends.map((b) => [b.x, b.y] as [number, number]),
          [x2, y2],
        ];
        geo.set(wire.id, { x1, y1, x2, y2, dx, pathD: polylineD(pts), polyline: pts });
      } else if (wireRouting === 'elbow') {
        const pts = elbowPoints(x1, y1, x2, y2);
        geo.set(wire.id, { x1, y1, x2, y2, dx, pathD: polylineD(pts), polyline: pts });
      } else {
        geo.set(wire.id, {
          x1, y1, x2, y2, dx,
          pathD: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        });
      }
    }
    return geo;
  }, [wires, nodeMap, wireRouting]);

  /** Under-card segments of crossing wires (round 146): the wire SVG
   *  renders beneath the cards, so a wire passing under a card it does not
   *  connect to vanishes under the card and re-emerges as two broken
   *  pieces. These clipped sub-paths are drawn in a pointer-events-none
   *  overlay ON TOP of the cards so the wire reads as one continuous
   *  connection. The wire's own endpoint cards are excluded (ports sit on
   *  the box edge, so they would false-positive). */
  const wireUnderCardPaths = useMemo(() => {
    const m = new Map<string, string>();
    // Pass the FULL node list once with per-wire excludeIds — avoids the
    // O(W×N) per-wire boxes.filter() allocation that was the primary OOM
    // hot path during drag (each wire allocated a ~N-element array).
    const allBoxes: Array<{ x: number; y: number; id: string }> = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
    for (const wire of wires) {
      const geo = wireGeometries.get(wire.id);
      if (!geo) continue;
      const d = wireUnderCardSegments(
        geo,
        allBoxes,
        new Set<string>([wire.fromNodeId, wire.toNodeId]),
      );
      if (d) m.set(wire.id, d);
    }
    return m;
  }, [wireGeometries, wires, nodes]);

  /** Dynamic SVG bounds derived from node positions — replaces fixed 5000×5000px clipping. */
  const svgBounds = useMemo(() => {
    if (nodes.length === 0) return { width: 0, height: 0 };
    const maxX = nodes.reduce((acc, n) => Math.max(acc, n.x + NODE_WIDTH), -Infinity);
    const maxY = nodes.reduce((acc, n) => Math.max(acc, n.y + nodeHeight(n)), -Infinity);
    if (!isFinite(maxX) || !isFinite(maxY)) return { width: 0, height: 0 };
    return { width: maxX + 200, height: maxY + 200 };
  }, [nodes]);

  /** Round 159: the overlay's ghosts laid out into the VISIBLE canvas. The
   *  other diagram's saved coordinates can sit outside the current viewport
   *  (different canvas size, or a pan/zoom since it was authored) — clamp
   *  them into the visible world-rect and resolve pile-ups against each
   *  other and against the live cards, so every difference stays legible.
   *  Falls back to 800×600 pre-layout (jsdom has no client size). */
  const laidOutGhosts = useMemo(() => {
    if (!compareOverlay || compareOverlay.ghosts.length === 0) return compareOverlay?.ghosts ?? [];
    const canvas = canvasRef.current;
    return layoutGhosts(
      compareOverlay.ghosts,
      {
        width: canvas?.clientWidth || 800,
        height: canvas?.clientHeight || 600,
        pan,
        zoom,
      },
      // EVERY live card is a blocker, not just workspaces: a ghost (the
      // other branch's workspace at its saved position) must never cover
      // this branch's Branch Location, Warehouse, or Hardware card either
      // — spatial divergence routinely lands an other-only workspace on
      // this side's root/storage/peripheral cards.
      nodes.map((n) => ({ x: n.x, y: n.y, width: NODE_WIDTH, height: NODE_HEIGHT })),
    );
  }, [compareOverlay, pan, zoom, nodes]);

  /** Round 161: shared workspaces as LIVE card bounds, keyed by their
   *  OTHER-side id (what the other diagram's wires reference). A shared
   *  workspace whose current card is not on the canvas (deleted unsaved)
   *  resolves to nothing — its ghost→shared stub is skipped. */
  const sharedFarEnds = useMemo(() => {
    const byCurrentId = new Map(
      nodes
        .filter((n) => n.type === 'workspace')
        .map((n) => [n.id, { x: n.x, y: n.y, width: NODE_WIDTH, height: NODE_HEIGHT }] as const),
    );
    const far = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const { otherId, currentId } of compareOverlay?.sharedByOtherId ?? []) {
      const bounds = byCurrentId.get(currentId);
      if (bounds) far.set(otherId, bounds);
    }
    return far;
  }, [compareOverlay, nodes]);

  /** Round 160/161: dashed stubs for the other branch's wiring involving
   *  ghosts — ghost↔ghost (between laid-out ghosts) and ghost→shared
   *  (from a ghost card to the shared workspace's LIVE card). A missing
   *  satellite — one workspace or a whole cluster — reads as a real
   *  connection instead of a floating box. */
  const ghostStubs = useMemo(
    () => buildGhostWireStubs(compareOverlay?.otherWires ?? [], laidOutGhosts, sharedFarEnds),
    [compareOverlay, laidOutGhosts, sharedFarEnds],
  );

  /** Round 162: compare-focus dim set — the shared-identical live cards.
   *  Only active while compareFocus is on AND an overlay is present;
   *  hover-focus dimming (focusing one node's connections) composes with
   *  it via OR at the card site. */
  const compareDimSet = useMemo(() => {
    if (!compareFocus || !compareOverlay) return new Set<string>();
    return new Set(compareFocusDimIds(compareOverlay));
  }, [compareFocus, compareOverlay]);

  /** The stub SVG must span the laid-out ghosts even when the current
   *  diagram is small — the ghost layer is inset to the viewport, so the
   *  stubs need their own full-cover bounds (ghost extents + margin). */
  const stubSvgBounds = useMemo(() => {
    const w = laidOutGhosts.reduce((acc, g) => Math.max(acc, g.x + GHOST_WIDTH), 0);
    const h = laidOutGhosts.reduce((acc, g) => Math.max(acc, g.y + GHOST_HEIGHT), 0);
    return {
      width: Math.max(w + 200, svgBounds.width),
      height: Math.max(h + 200, svgBounds.height),
    };
  }, [laidOutGhosts, svgBounds]);

  /** Escape mid-bend-drag: restore the bend to its start position (a
   *  ghost-created bend is removed entirely) and pop the drag's single
   *  history entry, so a cancelled gesture leaves no undo record. Mirrors
   *  cancelNodeMove for node drags. Defined before the keydown effect that
   *  calls it (the effect's deps evaluate this binding eagerly). */
  /** Cancel an in-flight marquee: clear the box state/refs AND disarm the
   *  document finalizer. A release after a canvas replacement must not
   *  commit a stale selection, and the box must never linger on a new
   *  canvas — clearing only the listener (marqueeCleanupRef) would leave
   *  the rendered box behind. */
  const cancelMarquee = useCallback(() => {
    marqueeStartRef.current = null;
    marqueeRef.current = null;
    setMarquee(null);
    marqueeCleanupRef.current?.();
  }, [setMarquee]);

  const cancelBendDrag = useCallback(() => {
    const d = bendDragRef.current;
    if (!d) return;
    bendDragRef.current = null;
    // Cancel semantics (which write-back, whether the entry pops) come from
    // the command module's pure decision.
    const decision = cancelBendDecision(d);
    if (decision.restore !== 'none') {
      setWires((prev) =>
        prev.map((w) => {
          if (w.id !== d.wireId) return w;
          if (decision.restore === 'remove-bend') {
            // A created bend only exists once the drag MOVED (deferred
            // insertion) — a cancelled click-without-move never inserted it.
            return { ...w, bends: (w.bends ?? []).filter((_, i) => i !== d.index) };
          }
          return {
            ...w,
            bends: (w.bends ?? []).map((b, i) => (i === d.index ? { x: d.startX, y: d.startY } : b)),
          };
        }),
      );
    }
    if (decision.popHistory) {
      // The drag pushed exactly one entry (on first movement) — pop it so
      // Undo stays a no-op for a cancelled gesture.
      setHistory((prev) => prev.slice(0, -1));
    }
    bendDragCleanupRef.current?.();
  }, [setHistory, setWires]);

  /**
   * Canvas-replacement rule: every path that replaces the canvas wholesale
   * (the three authoritative load-effect paths) must reset
   * the transient editor state that outlives a specific canvas — the
   * in-flight port connection, port-snap target, node/wire hover,
   * simulation pulse, marquee, bend-drag, open context menu, and the
   * inspector's first-edit guard. Kept in ONE helper so a new transient
   * state can never be added to some paths and forgotten in others
   * (rounds 124-132 each found exactly that drift). Call BEFORE the new
   * canvas's data lands (commitSnapshot / setNodes / setWires) so the
   * resets never act on the replacement canvas. Hoisted above the
   * load-lifecycle hook call so it can be passed as an argument without
   * a temporal-dead-zone reference (the hook call evaluates its args at
   * render time); hoisting earlier is order-safe.
   */
  const resetTransientCanvasState = useCallback(() => {
    cancelConnection();
    setHoveredTarget(null);
    clearHover();
    cancelMarquee();
    cancelBendDrag();
    setContextMenu(null);
    inspectorHistoryPushedForRef.current = null;
    nudgeSessionRef.current = null;
  }, [
    cancelConnection,
    setHoveredTarget,
    clearHover,
    cancelMarquee,
    cancelBendDrag,
    setContextMenu,
  ]);

  // Load persisted topology on mount, fall back to retail preset. The
  // effect body (full rebuild, both light-merge fast paths, the post-Apply
  // skip guard, the unassigned-empty path, the legacy fallback, and the
  // error boundary) now lives in the load-lifecycle hook; it is called at
  // this exact position so hook order — and therefore effect order — is
  // unchanged from the inline original.
  useTopologyEditorLoadLifecycle({
    workspaceInstances,
    branchLocations,
    branchId,
    reloadKey,
    skipNextLoadRef,
    migrationDismissedRef,
    nodesRef,
    wiresRef,
    setNodes,
    setWires,
    setHistory,
    setRedo,
    setResolvedIssues,
    cancelConnection,
    setHoveredTarget,
    clearHover,
    commitSnapshot,
    resetTransientCanvasState,
    loadSuccess,
    loadFailure,
    onLoadSuccess,
    onLoadError,
    addToast,
    l10n,
    snap,
  });


  // ── Inline node rename (slice R1: extracted to useTopologyEditorNodeRename) ──
  // The node half of the old G5 rename block, moved verbatim; the call sits at
  // the block's original position so hook order — and effect order — is what
  // the component already had. The wire half below followed in slice R1b.
  const {
    renamingNodeId,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    renameBaselineRef,
    startNodeRename,
    cancelNodeRename,
    persistNodeRename,
    commitNodeRename,
  } = useTopologyEditorNodeRename({
    nodes,
    setNodes,
    nodesRef,
    onRenameBranch,
    onRenameWorkspace,
  });

  // ── Inline wire rename (slice R1b: extracted to useTopologyEditorWireRename) ──
  // The wire half of the old G5 rename block, moved verbatim; the call sits at
  // the block's original position so hook order — and effect order — is what
  // the component already had. `pushHistory` is declared BELOW this point, so
  // it reaches the hook as a deferred wrapper arrow rather than the callback.
  const {
    renamingWireId,
    wireRenameDraft,
    setWireRenameDraft,
    wireRenameInputRef,
    startWireRename,
    cancelWireRename,
    commitWireRename,
  } = useTopologyEditorWireRename({
    wires,
    setWires,
    // Deferred access: `pushHistory` is declared BELOW this call, so pass the
    // wrapper arrow — it closes over the binding without reading it at render.
    pushHistory: () => pushHistory(),
  });

  const pushHistory = useCallback((snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => {
    // Dirty is derived (isDirty compares against appliedSnapshotRef),
    // so no flag needs arming here — the mutation itself is the dirty signal.
    setRedo([]); // new edit invalidates the redo branch
    // Any other history-pushing edit ends an open nudge burst — the next
    // nudge starts a fresh entry instead of folding into this edit's.
    nudgeSessionRef.current = null;
    setHistory((prev) => {
      // An explicit snapshot wins (bend drags capture the pre-gesture wires
      // at mousedown so a ghost-created bend undoes away completely); the
      // default snapshots the refs — identical to the latest render's
      // closure state, but keeps pushHistory referentially STABLE so the
      // memoized card/wire layers don't churn on every nodes/wires change.
      const src = snapshot ?? { nodes: nodesRef.current, wires: wiresRef.current };
      // Push-time integrity: every stored entry is endpoint-consistent
      // (see historyEntry) — a dangling wire can never even enter the stack.
      const entry: HistoryEntry = historyEntry(src.nodes, src.wires);
      const next = [...prev, entry];
      if (next.length > 50) next.shift();
      return next;
    });
  }, [setHistory, setRedo]);
  /** Mirror so the memoized wire handlers (cycle/bends) can call pushHistory
   *  without taking it as a dep — pushHistory re-keys whenever nodes/wires
   *  change, which would churn the handler identity and re-render every wire
   *  on any unrelated edit. The ref reads the latest snapshot at call time. */
  const pushHistoryRef = useRef(pushHistory);
  pushHistoryRef.current = pushHistory;

  /** One-click organize (see computeAutoLayout): a thin wrapper that
   *  pushes ONE undo entry, applies the engine's placements, clears authored
   *  bends (their coordinates described the OLD geometry), and announces the
   *  result. An empty diagram has nothing to organize — no history entry. */
  const autoLayout = useCallback(() => {
    // Elbow-routed wires are orthogonal — snap the placements to the grid
    // so the orthogonal geometry stays clean; curved wires tolerate the
    // free-floating anchor positions.
    const placed = computeAutoLayout(nodes, wires, {
      snapToGrid: snapEnabled && wireRouting === 'elbow',
    });
    if (placed.length === 0) return;
    pushHistory();
    const byId = new Map(placed.map((p) => [p.id, p]));
    setNodes((prev) => prev.map((n) => {
      const p = byId.get(n.id);
      return p ? { ...n, x: p.x, y: p.y } : n;
    }));
    // exactOptionalPropertyTypes forbids `bends: undefined` — destructure
    // the property away so the wires leave with NO bends key at all.
    setWires((prev) => prev.map(({ bends: _bends, ...rest }) => rest));
    setLiveAnnouncement(l10nRef.current.getString('topology-layout-announce'));
  }, [nodes, wires, pushHistory, snapEnabled, wireRouting, setNodes, setWires, setLiveAnnouncement]);

  /** Diagram import/export + template callbacks (slice G13-a+b): the six
   *  handlers live in useTopologyEditorIo (bodies byte-identical); the
   *  popover state slots stay parent-owned (G4-a precedent) and are wired
   *  in as their stable setters. */
  const {
    handleExport,
    handleImport,
    handleSaveTemplate,
    handleLoadTemplate,
    handleDeleteTemplate,
    openTemplates,
  } = useTopologyEditorIo({
    nodes,
    wires,
    addToast,
    l10nRef,
    pushHistory,
    setNodes,
    setWires,
    setTemplateSaveOpen,
    setTemplateName,
    setTemplatesOpen,
    setSavedTemplates,
  });

  /** Sticky "user touched the canvas" flag: suppresses the auto-fit-viewport
   *  pass. Hoisted above the relocated pointer-hook call (slice 3.4c-2) — that
   *  call evaluates its args at render time, so a declaration below it would be
   *  a temporal-dead-zone reference (same reason resetTransientCanvasState is
   *  hoisted above the load-lifecycle call). Its sibling autoFitKeyRef stays
   *  down there: it is not a hook dep. */
  const userInteractedRef = useRef(false);

  const {
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleCanvasMouseDown,
    handleWheel,
    handleContextMenu,
    handleNodeMouseDown,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
    cancelDuplicateDrag,
    convertDragToDuplicate,
    cancelNodeMove,
  } = useTopologyEditorPointer({
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
    panCleanupRef,
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
    // Node-drag inputs (slices 3.4c-1 / 3.4c-2). Every ref below stays
    // declared here: the touch loop and the unmount sweep still share this
    // gesture state with the hook, which now owns the drag trio AND the
    // duplicate cluster (commitDuplicateDrag is internal; the other three
    // are returned for the keydown Escape ladder and the Alt mid-move).
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
    dragCleanupRef,
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
  });


  // ── ADR #46 §5: restore-to-draft seed ──────────────────────────────
  // The hook owns one-shot seed identity; this callback owns the graph
  // replacement and keeps the pre-restore canvas as the dirty baseline.
  const applyRestoreSeed = useCallback((seed: NonNullable<NodeTopologyEditorProps['restoreSeed']>) => {
    resetTransientCanvasState();
    setHistory([]);
    setRedo([]);
    commitSnapshot({ nodes: nodesRef.current, wires: wiresRef.current });
    setNodes(seed.nodes.map(diagramNodeToCanvas));
    setWires(seed.wires.map(diagramWireToCanvas));
  }, [resetTransientCanvasState, setHistory, setRedo, commitSnapshot, setNodes, setWires]);
  useTopologyEditorRestoreSeed(restoreSeed, applyRestoreSeed);

  /** Align or distribute the current multi-selection. One undo entry per
   *  action; the reference geometry is the selection's own bounding box,
   *  so the extremes stay put and the rest move to match. Both use exact
   *  arithmetic — no re-snapping, or an off-grid extreme node would drift
   *  instead of anchoring the alignment (legacy preset ys like 80 are
   *  deliberately off the 24px grid, and geometry tests pin them). */
  const applyAlign = useCallback((mode: AlignMode) => {
    if (selectedNodeIds.size < 2) return;
    pushHistory();
    const ids = new Set(selectedNodeIds);
    setNodes((prev) => {
      const sel = prev.filter((n) => ids.has(n.id));
      if (sel.length < 2) return prev;
      const minX = Math.min(...sel.map((n) => n.x));
      const maxX = Math.max(...sel.map((n) => n.x + NODE_WIDTH));
      const minY = Math.min(...sel.map((n) => n.y));
      const maxY = Math.max(...sel.map((n) => n.y + nodeHeight(n)));
      const aligned = prev.map((n) => {
        if (!ids.has(n.id)) return n;
        switch (mode) {
          case 'left': return { ...n, x: minX };
          case 'hcenter': return { ...n, x: minX + (maxX - minX - NODE_WIDTH) / 2 };
          case 'right': return { ...n, x: maxX - NODE_WIDTH };
          case 'top': return { ...n, y: minY };
          case 'vcenter': return { ...n, y: minY + (maxY - minY - NODE_HEIGHT) / 2 };
          case 'bottom': return { ...n, y: maxY - NODE_HEIGHT };
          case 'dist-h': {
            const sorted = [...sel].sort((a, b) => a.x - b.x);
            if (sorted.length < 3) return n;
            const i = sorted.findIndex((s) => s.id === n.id);
            const span = sorted[sorted.length - 1]!.x - sorted[0]!.x;
            return { ...n, x: sorted[0]!.x + (span * i) / (sorted.length - 1) };
          }
          case 'dist-v': {
            const sorted = [...sel].sort((a, b) => a.y - b.y);
            if (sorted.length < 3) return n;
            const i = sorted.findIndex((s) => s.id === n.id);
            const span = sorted[sorted.length - 1]!.y - sorted[0]!.y;
            return { ...n, y: sorted[0]!.y + (span * i) / (sorted.length - 1) };
          }
          default: return n;
        }
      });
      // The no-overlap invariant (rounds 140-143) holds for every movement
      // path — an align can collapse two same-row cards onto the same spot
      // (e.g. Align left on two stores at one y) and stack one invisibly
      // under its anchor, exactly the defect the invariant exists to stop.
      // Settle ONLY the cards whose position actually changed: the anchor
      // that was already on the line keeps it, while a moved card that now
      // intersects anything finds the nearest free spot (the round-140
      // spiral — flush alignment is not an overlap, so tidy layouts stay).
      const beforeById = new Map(prev.map((n) => [n.id, n]));
      const alignedById = new Map(aligned.map((n) => [n.id, n]));
      const movedIds = new Set<string>();
      for (const id of ids) {
        const before = beforeById.get(id);
        const after = alignedById.get(id);
        if (before && after && (after.x !== before.x || after.y !== before.y)) {
          movedIds.add(id);
        }
      }
      const resolved = movedIds.size > 0 ? resolveDropOverlaps(aligned, movedIds) : null;
      if (!resolved) return aligned;
      const resolvedById = new Map(resolved.map((r) => [r.id, r]));
      return prev.map((n) => {
        const r = resolvedById.get(n.id);
        return r ? { ...n, x: r.x, y: r.y } : n;
      });
    });
  }, [selectedNodeIds, pushHistory, setNodes]);

  /**
   * Push history at most once per node selection session when an
   * inspector field changes — the first keystroke/select of a session
   * snapshots the pre-edit state; later changes in the same session
   * mutate without creating more undo entries.
   */
  const beginInspectorEdit = useCallback((nodeId: string) => {
    if (inspectorHistoryPushedForRef.current !== nodeId) {
      inspectorHistoryPushedForRef.current = nodeId;
      pushHistory();
    }
  }, [pushHistory]);

  // A fresh selection starts a fresh inspector edit session.
  useEffect(() => {
    inspectorHistoryPushedForRef.current = null;
  }, [selectedNodeId]);

  /**
   * Re-validate the selection whenever the canvas changes — an undo, redo,
   * preset load, or fresh topology reload can remove the selected node or
   * wire. A dangling selection (pointing at a now-gone element) renders the
   * tool-rack Delete button for nothing and lets arrow keys push no-op undo
   * entries, so clear it; a still-valid selection is preserved.
   */
  useEffect(() => {
    // Prune dangling node ids and the wire selection in one reducer pass:
    // a primary that no longer exists is cleared, multi-selection members
    // that vanished are dropped, and a wire that was deleted is deselected.
    const validNodeIds = new Set(nodeMap.keys());
    const validWireId = wires.some((w) => w.id === selectedWireId) ? selectedWireId : null;
    pruneSelection(validNodeIds, validWireId);
    // A hovered node/wire that vanished (preset load, workspace reload,
    // batch delete, undo/redo) must drop its hover too — React never fires
    // mouseleave on unmount, so a stale id would keep hoverConnections
    // non-null and dim every remaining card and wire until the next hover.
    pruneHover(validNodeIds, new Set(wires.map((w) => w.id)));
    // A picker whose target node vanished (preset load, workspace reload,
    // batch delete) must close — otherwise its keyboard guard would keep
    // swallowing canvas shortcuts even though the popover is unrenderable.
    // The reducer's cancel also clears the armed connection, so a later
    // port click cannot complete a wire from the stale source either.
    if (relationshipPicker && !nodeMap.has(relationshipPicker.toNodeId)) {
      cancelConnection();
    }
  }, [selectedNodeId, selectedWireId, nodeMap, wires, relationshipPicker, pruneSelection, cancelConnection, pruneHover]);

  const popUndo = useCallback(() => {
    const stack = historyRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1]!;
    // Push current state to redo before restoring — sanitized at push time
    // like every other entry (see historyEntry).
    setRedo((prev) => [...prev, historyEntry(nodes, wires)]);
    // Sibling setState calls (not nested in updater — fixes ADR audit #6)
    setNodes(entry.nodes);
    // Restore-boundary integrity: never land a wire whose endpoint nodes
    // are missing from the SAME entry (see validWiresForNodes).
    setWires(validWiresForNodes(entry.nodes, entry.wires, 'restore'));
    setHistory((prev) => prev.slice(0, -1));
    // Dirty is derived: if the undone-to canvas matches the last applied
    // snapshot (e.g. undoing a same-preset load), no confirm fires; if it
    // diverges (undoing past a save), the preset gate confirms. The stale
    // conservative boolean was removed — it armed a spurious confirm for
    // the exact-equality case.
    // A post-undo edit is a fresh session — it must push a new entry.
    inspectorHistoryPushedForRef.current = null;
    nudgeSessionRef.current = null;
    // Undoing a deletion restores the removed node — re-select it so the
    // inspector reopens on the restored element (the delete flow cleared
    // the selection). Exactly one node restored from the entry is the
    // delete signature: an undo of an add/move/toggle restores no nodes
    // and must leave the selection untouched.
    const currentIds = new Set(nodes.map((n) => n.id));
    const restoredNodes = entry.nodes.filter((n) => !currentIds.has(n.id));
    if (restoredNodes.length === 1) {
      selectOnly(restoredNodes[0]!.id);
    }
  }, [nodes, wires, selectOnly, setHistory, setNodes, setRedo, setWires]);

  const popRedo = useCallback(() => {
    if (redo.length === 0) return;
    const entry = redo[redo.length - 1]!;
    // Push current state to history before restoring — sanitized at push
    // time like every other entry (see historyEntry).
    setHistory((prev) => [...prev, historyEntry(nodes, wires)]);
    setNodes(entry.nodes);
    // Restore-boundary integrity: never land a wire whose endpoint nodes
    // are missing from the SAME entry (see validWiresForNodes).
    setWires(validWiresForNodes(entry.nodes, entry.wires, 'restore'));
    setRedo((prev) => prev.slice(0, -1));
    // Same derived dirty rule as undo: redo to exactly the applied canvas
    // is clean; redo to anything else confirms on the next preset click.
    // A post-redo edit is a fresh session — it must push a new entry.
    inspectorHistoryPushedForRef.current = null;
    nudgeSessionRef.current = null;
  }, [redo, nodes, wires, setHistory, setNodes, setRedo, setWires]);

  // Clean up pan/drag/marquee/bend/touch listeners and fresh-node timers on
  // unmount. Every document-level gesture listener must be disarmed here — a
  // branch switch or screen navigation mid-gesture otherwise leaves the
  // listener attached, firing finalize/cancel closures against an unmounted
  // editor on the next page-wide pointer event.
  useEffect(() => {
    // Each cleanup ref holds a closure installed LATER by the gesture hook that
    // arms it, so the value must be read when the cleanup runs. The ref OBJECT
    // is stable for the editor's lifetime, so capturing it in a local is safe —
    // and it is what react-hooks/exhaustive-deps asks for here; copying
    // `.current` into a local instead would freeze the empty setup-time value
    // and defeat the sweep (the trap the previous comment on bendDragCleanupRef
    // named, which is why the sweep keeps five `const x = xRef` captures).
    const timers = freshTimersRef.current;
    const panCleanup = panCleanupRef;
    const dragCleanup = dragCleanupRef;
    const marqueeCleanup = marqueeCleanupRef;
    const bendDragCleanup = bendDragCleanupRef;
    const touchCleanup = touchCleanupRef;
    return () => {
      panCleanup.current?.();
      dragCleanup.current?.();
      marqueeCleanup.current?.();
      bendDragCleanup.current?.();
      touchCleanup.current?.();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  /** Delete-confirm flow (slice P5-B/S5): the two confirmation states,
   *  the Branch-Location anchor guard, the shared delete commit and
   *  executeDelete moved verbatim into nodeTopologyEditorDeleteConfirm. The
   *  call sits at the slot the two callbacks occupied — above the keyboard
   *  controller that consumes all five names as arguments — and every
   *  identity the moved bodies read is declared above it. */
  const {
    confirmDelete,
    setConfirmDelete,
    confirmDeleteMany,
    setConfirmDeleteMany,
    isBranchLocation,
    deleteNodes,
    executeDelete,
  } = useTopologyEditorDeleteConfirm({
    nodes,
    wires,
    selectedWireId,
    connectingFromNodeId,
    connectingFromPort,
    pushHistory,
    setNodes,
    setWires,
    clearSelection,
    clearWire,
    cancelConnection,
  });

  /** One-shot load auto-fit: when a diagram's content first lands (the
   *  mount preset or an async load) on a MEASURED canvas, fit it if it
   *  overflows the viewport — fixes clipped cards on narrow canvases
   *  (tablet) without ever yanking the view during editing. Content-keyed:
   *  refits when a NEW diagram replaces the current one (preset → load,
   *  preset swap), never for in-place edits, and never after the user has
   *  interacted (a click or key press hands the view to the user). */
  const autoFitKeyRef = useRef('');
  // (userInteractedRef was hoisted above the pointer-hook call — 3.4c-2.)

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
    const key = nodes.map((n) => n.id).sort().join('|');
    if (autoFitKeyRef.current === key) return;
    autoFitKeyRef.current = key;
    if (!userInteractedRef.current && !restoredViewRef.current && diagramOverflowsCanvas(canvas, nodes)) {
      zoomToFit();
    }
    // The fit decides on the CONTENT (nodes/wires), not on pan/zoom —
    // those are the values it sets, so they must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, wires]);

  /** Clipboard/duplicate callbacks (slice G13-c): the internal clipboard,
   *  the paste-cascade counter and the three mutation callbacks live in
   *  useTopologyEditorClipboard (bodies byte-identical); the parent keeps
   *  wiring graph state, viewport, creation gate and toast/l10n deps in. */
  const {
    copySelection,
    duplicateSelection,
    pasteClipboard,
  } = useTopologyEditorClipboard({
    nodes,
    wires,
    selectedNodeIds,
    pan,
    zoom,
    canvasRef,
    duplicateRefusal,
    addToast,
    l10n,
    setNodes,
    setWires,
    selectMany,
    pushHistory,
    GRID_SIZE,
  });

  /** Latest-ref for the spawn handler: the keydown effect runs earlier in
   *  the component body than `handleAddNode`'s const declaration, so a
   *  direct dep would hit the TDZ. The ref is assigned after the function
   *  definition and read by the effect — always the current render's fn. */
  const handleAddNodeRef = useRef<((type: NodeType) => void) | null>(null);

  /** Central canvas keyboard controller (slice 3.4d). The window keydown
   *  effect moved verbatim into nodeTopologyEditorKeyboard; every ref, setter
   *  and module constant it reads stays parent-owned and is passed in. */
  useTopologyEditorKeyboard({
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
  });

  // Clear hoveredTarget when connection mode ends
  useEffect(() => {
    if (!connectingFromNodeId) {
      setHoveredTarget(null);
    }
  }, [connectingFromNodeId]);

  // ── Touch gestures (pointer parity for tablets) ──────────────────
  // The loop lives in useTopologyEditorTouch (slice 3.4e) — the document-level
  // pointer listeners, the one-finger drag/pan branch and the two-finger pinch.
  // Only handleCanvasPointerDown comes back out: the canvas onPointerDown prop
  // is its single external consumer. touchPointersRef and touchGestureRef moved
  // into the hook with it (nothing else reads them); touchCleanupRef is declared
  // up beside the other cleanup refs, because the unmount sweep disarms a live
  // gesture through it too.
  const { handleCanvasPointerDown } = useTopologyEditorTouch({
    pan,
    zoom,
    setPan,
    setZoom,
    isPanningRef,
    userInteractedRef,
    touchCleanupRef,
    selectedNodeIds,
    selectOnly,
    clearWire,
    clearAll,
    dismissPicker,
    setContextMenu,
    beginNodeDrag,
    applyDragMove,
    finalizeNodeDrag,
  });

  /** Add-node flow (slice P5-B/S6): the plain `handleAddNode` arrow moved
   *  verbatim into nodeTopologyEditorAddNode. Neither it nor that hook
   *  registers a React hook, so the component's hook order — and therefore
   *  its effect order — is untouched; the deps it reads stay parent-owned.
   *  The ref mirror below stays here because the keydown effect above this
   *  point reads it, and a direct dep would hit the TDZ. */
  const { handleAddNode } = useTopologyEditorAddNode({
    allowLegacyApply,
    wouldExceedWarehouseCap,
    addToast,
    l10n,
    pushHistory,
    snapOrNot,
    nodes,
    canvasRef,
    pan,
    zoom,
    setPan,
    setNodes,
    setFreshNodeIds,
    freshTimersRef,
    selectOnly,
  });
  handleAddNodeRef.current = handleAddNode;

  /** Live semantic validation of the CURRENT canvas (ADR #34 slice 2).
   *  Mirrors the Apply gate exactly — same normalize + validate, same
   *  canonical-identity condition — so the on-canvas badges and the Apply
   *  toast can never disagree. Errors carrying a nodeId pin to that card as
   *  a note; graph-level errors (branch roots, wire integrity) surface as
   *  the canvas banner. */
  const liveValidation = useMemo(() => {
    const errors = validateEditorGraph(nodes, wires, allowLegacyApply, currentTier);
    const byNode = new Map<string, TopologyValidationError[]>();
    const byWire = new Map<string, TopologyValidationError[]>();
    const graphLevel: TopologyValidationError[] = [];
    for (const err of errors) {
      // byWire is additive — the original nodeId/graphLevel bucketing is
      // unchanged so wireId-only errors (invalid-semantic-connection etc.)
      // still surface in the canvas banner as before.
      if (err.wireId) {
        const list = byWire.get(err.wireId);
        if (list) list.push(err);
        else byWire.set(err.wireId, [err]);
      }
      if (err.nodeId) {
        const list = byNode.get(err.nodeId);
        if (list) list.push(err);
        else byNode.set(err.nodeId, [err]);
      } else {
        graphLevel.push(err);
      }
    }
    return { byNode, byWire, graphLevel };
  }, [nodes, wires, allowLegacyApply, currentTier]);

  // ── Legacy-schema migration dialog (ADR #34 item 7, slice G4-a) ─────
  // The candidate memos, the auto-open effect and the two footer handlers moved
  // verbatim to nodeTopologyEditorMigration. The call sits at the slot that block
  // occupied - directly after liveValidation, which the first memo derives from
  // - so hook order, and therefore effect order, is unchanged. The state trio
  // above stays parent-owned (the load and keyboard hooks read it from higher up)
  // and arrives through deps; the dialog JSX below keeps consuming the same four
  // names, now bound from the hook return.
  const {
    migrationEntries,
    migrationSelectionFor,
    handleResolveMigration,
    handleLaterMigration,
  } = useTopologyEditorMigration({
    liveValidation,
    nodeMap,
    wires,
    setWires,
    pushHistory,
    setLiveAnnouncement,
    l10n,
    migrationDismissedRef,
    setMigrationOpen,
    migrationSelections,
    setMigrationSelections,
  });

  /** Validation cluster (slice P5-B/S4): everything derived FROM
   *  liveValidation moved verbatim into nodeTopologyEditorValidation - the
   *  panel state, the dismissed-issue filtering every surface shares, the
   *  jump and dismiss handlers, the per-card error, badge, overlap and
   *  overlay-marker maps, and the forget effect. liveValidation itself stays
   *  above (the migration hook derives from it) and returns as a dep; the two
   *  dismissal key helpers moved with the block as module consts. The call
   *  sits at the slot the cluster occupied, below the migration call and
   *  above every consumer, in the block own original order - so hook order,
   *  and therefore effect order, is unchanged. */
  const {
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
  } = useTopologyEditorValidation({
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
  });


  /** Wire-commit controller (slice P5-B/S3): commitWire (internal),
   *  commitPickerOption and handlePortClick moved verbatim into
   *  nodeTopologyEditorWireCommit; the call sits at the slot the three
   *  callbacks occupied, so hook order — and therefore effect order — is
   *  unchanged. Every mirror and setter they read stays parent-owned and
   *  arrives through the deps object; the port pair is created in the hook
   *  now, and isPortCompatible comes back from it for the node-card JSX. */
  const { commitPickerOption, handlePortClick, isPortCompatible } = useTopologyEditorWireCommit({
    wiresRef,
    pushHistoryRef,
    nodeMap,
    isProAllowed,
    addToast,
    l10n,
    cancelRelationshipPicker,
    setWires,
    relationshipPicker,
    connectingFromNodeId,
    connectingFromPort,
    connectingFromVariantIndex,
    beginConnection,
    cancelConnection,
    openPicker,
    setPreviewCursor,
  });

  /** Cycle a wire's visual flow: one-way → reverse → two-way → one-way.
   *  Clicking the wire itself is the affordance; the from/to ownership is
   *  untouched (only the arrow presentation changes). */
  const handleCycleWireDirection = useCallback((wireId: string) => {
    pushHistoryRef.current();
    setWires((prev) =>
      prev.map((w) => {
        if (w.id !== wireId) return w;
        const current = w.direction === 'reverse' || w.direction === 'two-way' ? w.direction : 'one-way';
        const next = WIRE_DIRECTION_CYCLE[(WIRE_DIRECTION_CYCLE.indexOf(current) + 1) % WIRE_DIRECTION_CYCLE.length]!;
        return { ...w, direction: next };
      }),
    );
  }, [setWires]);

  const { startBendDrag, startGhostBendDrag, removeBend } = useTopologyEditorBendDrag({
    pan,
    zoom,
    selectWire,
    canvasRef,
    setWires,
    setHistory,
    nodesRef,
    wiresRef,
    bendDragRef,
    bendDragCleanupRef,
    pushHistoryRef,
  });


  /** Wire click: select the wire AND cycle its flow direction — the whole
   *  wire is the affordance now (no separate label pill). Stable so the
   *  memoized wire groups can receive it as a prop. */
  const handleWireClick = useCallback((e: { stopPropagation(): void }, wireId: string) => {
    e.stopPropagation();
    selectWire(wireId);
    handleCycleWireDirection(wireId);
  }, [selectWire, handleCycleWireDirection]);


  /** Stable name/enabled writers for the memoized workspace cards. */
  const handleSetNodeName = useCallback((nodeId: string, name: string) => {
    beginInspectorEdit(nodeId);
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, name } : n)));
  }, [beginInspectorEdit, setNodes]);

  const handleSetNodeEnabled = useCallback((nodeId: string, enabled: boolean) => {
    beginInspectorEdit(nodeId);
    setNodes((prev) => prev.map((n) => (n.id === nodeId
      ? { ...n, metadata: { ...n.metadata, enabled } }
      : n)));
  }, [beginInspectorEdit, setNodes]);

  /** Stable metadata writer for the warehouse settings card (capacity,
   *  low-stock threshold). Keeps edits in the beginInspectorEdit dirty
   *  flow so canvasStateEqual can project the new keys. */
  const handleSetNodeMetadata = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    beginInspectorEdit(nodeId);
    setNodes((prev) => prev.map((n) => (n.id === nodeId
      ? { ...n, metadata: { ...n.metadata, ...patch } }
      : n)));
  }, [beginInspectorEdit, setNodes]);

  const handleDisconnectNode = useCallback((nodeId: string) => {
    setWires((prev) => {
      // The command reports `changed` so a disconnect on a wire-less node
      // produces no history entry (no-op suppression) — identical to the
      // inline length comparison this replaced.
      const { wires: remaining, changed } = disconnectNode(prev, nodeId);
      if (changed) {
        pushHistory();
        return remaining;
      }
      return prev;
    });
  }, [pushHistory, setWires]);

  const handleDeleteRequest = () => {
    if (selectedNodeIds.size > 0) {
      // Filter out Branch Location nodes — they are permanent anchors.
      const targets = [...selectedNodeIds].filter((id) => !isBranchLocation(id));
      if (targets.length === 0) return; // Only Branch Location(s) selected
      const hasWires = wires.some((w) => targets.includes(w.fromNodeId) || targets.includes(w.toNodeId));
      if (hasWires) {
        if (targets.length === 1) setConfirmDelete(targets[0]!);
        else setConfirmDeleteMany(targets);
      } else {
        // No connected wires — delete immediately without dialog.
        deleteNodes(targets);
      }
    } else if (selectedWireId) {
      setConfirmDelete('');
    }
  };

  const wirePreviewLine = useMemo(() => {
    if (!connectingFromNodeId || !connectingFromPort) return null;
    const fromNode = nodeMap.get(connectingFromNodeId);
    if (!fromNode) return null;
    // Round 174: the source endpoint rides the exact semantic row.
    const x1 = fromNode.x + (connectingFromPort === 'right' ? NODE_WIDTH : 0);
    const y1 = fromNode.y + portRowCenterY(fromNode, connectingFromVariantIndex);

    // Snap the preview to a hovered target port; otherwise follow the
    // live cursor (previewCursor tracks every mousemove while connecting).
    let mx: number;
    let my: number;
    if (hoveredTarget) {
      const targetNode = nodes.find((n) => n.id === hoveredTarget.nodeId);
      if (targetNode) {
        mx = targetNode.x + (hoveredTarget.port === 'right' ? NODE_WIDTH : 0);
        my = targetNode.y + portRowCenterY(targetNode, hoveredTarget.variantIndex);
      } else {
        mx = previewCursor?.x ?? mousePosRef.current.x;
        my = previewCursor?.y ?? mousePosRef.current.y;
      }
    } else {
      mx = previewCursor?.x ?? mousePosRef.current.x;
      my = previewCursor?.y ?? mousePosRef.current.y;
    }

    if (wireRouting === 'elbow') {
      return { d: polylineD(elbowPoints(x1, y1, mx, my)) };
    }
    const dx = Math.abs(mx - x1) * 0.5;
    return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${mx - dx} ${my}, ${mx} ${my}` };
  }, [connectingFromNodeId, connectingFromPort, connectingFromVariantIndex, nodeMap, nodes, hoveredTarget, previewCursor, wireRouting]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId), [nodes, selectedNodeId]);

  // ── Live telemetry (ADR #22 Phase 2) ─────────────────────────

  /** Compute live telemetry for a node from SettingsContext. */
  const getTelemetry = useCallback((node: TopologyNodeData): { badge: string; status: 'online' | 'warning' | 'offline' } | null => {
    if (node.type === 'store') {
      // The node's own name is the Branch Location display name — if it has
      // one, the location is active regardless of whether the backend store
      // profile settings have been loaded yet.
      return { badge: node.name ? 'Active' : 'Unconfigured', status: node.name ? 'online' : 'warning' };
    }
    if (node.type === 'workspace') {
      const typeKey = (node.metadata?.['typeKey'] as string) ?? 'store-pos';
      if (typeKey === 'kds') {
        return { badge: 'KDS Ready', status: 'online' };
      }
      return {
        badge: settings.receipt.paperWidth === 'standard' ? 'Receipt ✓' : 'Receipt 58mm',
        status: 'online',
      };
    }
    if (node.type === 'warehouse') {
      // Per-node diagram metadata drives the badge (round 70+): once the
      // user enters a Current Stock, show stock / capacity and flip to the
      // warning state when stock is at or below the low-stock threshold.
      // Without stock the badge stays hidden — a placeholder chip would
      // read as "unfinished". Live inventory telemetry (settings.inventory)
      // can supersede the metadata numbers when that scope lands.
      const meta = node.metadata;
      const stock = typeof meta?.['stock'] === 'number' ? (meta['stock'] as number) : undefined;
      const capacity = typeof meta?.['capacity'] === 'number' ? (meta['capacity'] as number) : undefined;
      const threshold = typeof meta?.['lowStockThreshold'] === 'number' ? (meta['lowStockThreshold'] as number) : undefined;
      if (stock === undefined) return null;
      const low = threshold !== undefined && stock <= threshold;
      const badge = capacity !== undefined
        ? `${stock} / ${capacity} items`
        : `${stock} items`;
      return { badge, status: low ? 'warning' : 'online' };
    }
    return node.telemetryBadge
      ? { badge: node.telemetryBadge, status: node.telemetryStatus ?? 'online' }
      : null;
  }, [settings]);

  /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- interactive drag/pan canvas requires these */
  // Anchor the relationship picker at the target node's left edge so the
  // user sees WHICH socket the pending choice applies to. Same screen-space
  // math as the marquee (node position × zoom + pan, in canvas-container
  // coordinates).
  const pickerAnchor = relationshipPicker ? nodeMap.get(relationshipPicker.toNodeId) : null;

  // ── Apply gate + confirm popup + save (slice G8-a: extracted to
  // useTopologyEditorApplyPanel) ───────────────────────────────────────────
  // The gate, the two dialog state slots, the save itself and the chip diff
  // preview moved; the call sits at the slot handleApplyClick occupied, below
  // every ref and setter it hands over and above the return that consumes the
  // six results. The dialog JSX stays mounted in the editor.
  const {
    applyConfirmOpen,
    applyConfirmData,
    setApplyConfirmOpen,
    handleApplyClick,
    confirmApply,
    dirtySummary,
  } = useTopologyEditorApplyPanel({
    nodes,
    wires,
    topologyRevision,
    resolvedIssues,
    onSave,
    addToast,
    l10n,
    beginApply,
    failApply,
    finishApply,
    commitSnapshot,
    sessionToken,
    allowLegacyApply,
    currentTier,
    workspaceInstances,
    sessionStoreId,
    setValidationPanelOpen,
    isDirty,
    pinVerifiedRef,
    skipNextLoadRef,
    appliedSnapshotRef,
    setNodes,
    setWires,
    setHistory,
    setRedo,
    clearAll,
    setReloadKey,
  });

  return (
    <div className="node-topology-editor">
      {/* Visually-hidden live region: announces alignment snaps and
          Alt-duplicate drops/cancels for assistive tech. The visual
          guides and the copy cursor are aria-hidden, so screen-reader
          users would otherwise get zero feedback that a snap or clone
          happened. role="status" implies aria-live="polite". */}
      <div className="sr-only" role="status" aria-live="polite" data-testid="topology-live-region">{liveAnnouncement}</div>
      <TopologyDeleteDialogs
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        confirmDeleteMany={confirmDeleteMany}
        setConfirmDeleteMany={setConfirmDeleteMany}
        executeDelete={executeDelete}
        l10n={l10n}
      />

      <TopologyHeader
        l10n={l10n}
        branchToolbar={branchToolbar}
        canSave={canSave}
        onSaveAvailable={!!onSave}
        currentTier={currentTier}
        saving={saving}
        onApply={() => void handleApplyClick()}
      />

      <div className="node-topology-main">
        <TopologyToolRack
          l10n={l10n}
          rackPanel={rackPanel}
          onTogglePanel={toggleRackPanel}
          onClosePanel={() => setRackPanel(null)}
          hasSelection={selectedNodeIds.size > 0 || !!selectedWireId || history.length > 0 || redo.length > 0}
          canDelete={selectedNodeIds.size > 0 || !!selectedWireId}
          canUndo={history.length > 0}
          canRedo={redo.length > 0}
          onDeleteSelected={handleDeleteRequest}
          onUndo={popUndo}
          onRedo={popRedo}
          allowLegacyApply={allowLegacyApply}
          onAddNode={handleAddNode}
          isProAllowed={isProAllowed}
          hasWarehouse={nodes.some((n) => n.type === 'warehouse')}
          onAutoLayout={autoLayout}
          wireRouting={wireRouting}
          onToggleWireRouting={() => setWireRouting((r) => (r === 'elbow' ? 'curved' : 'elbow'))}
          anyBentWires={anyBentWires}
          snapEnabled={snapEnabled}
          onToggleSnap={() => setSnapEnabled((s) => !s)}
          panToolActive={panToolActive}
          onTogglePanTool={() => setPanToolActive((v) => !v)}
          wireLabelsVisible={wireLabelsVisible}
          onToggleWireLabels={() => setWireLabelsVisible((v) => !v)}
          onExport={handleExport}
          onImport={handleImport}
          templateSaveOpen={templateSaveOpen}
          onToggleTemplateSave={() => setTemplateSaveOpen((v) => !v)}
          templateName={templateName}
          onTemplateNameChange={setTemplateName}
          onSaveTemplate={handleSaveTemplate}
          onOpenTemplates={openTemplates}
          templatesOpen={templatesOpen}
          savedTemplates={savedTemplates}
          onLoadTemplate={handleLoadTemplate}
          onDeleteTemplate={handleDeleteTemplate}
        />

        <div
          ref={canvasRef}
          className={`node-canvas-container${spacePanArmed || panToolActive ? ' canvas-space-pan' : ''}`}
          tabIndex={0}
          role="application"
          aria-label={l10n.getString('topology-canvas-aria-label')}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseDown={handleCanvasMouseDown}
          onPointerDown={handleCanvasPointerDown}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        >
          <TopologyStatusStrip
            bannerGraphLevel={bannerGraphLevel}
            isProAllowed={isProAllowed}
            hasCapacityMetadata={hasCapacityMetadata}
            caps={caps}
            warehouseCount={warehouseCount}
            dirtySummary={dirtySummary}
            topologyRevision={topologyRevision}
            l10n={l10n}
          />
          {totalIssues > 0 && (
            <TopologyValidationWidget
              totalIssues={totalIssues}
              open={validationPanelOpen}
              onToggle={toggleValidationPanel}
              nodeIssues={visibleNodeIssues}
              graphIssues={visibleGraphLevel}
              onSelectNode={selectIssueNode}
              onAddStockWire={handleAddStockWireHint}
              onJumpToWire={handleJumpToWire}
              onDismissNodeIssue={handleDismissNodeIssue}
              onDismissGraphIssue={handleDismissGraphIssue}
            />
          )}
          {marquee && (
            <div
              className="topology-marquee"
              aria-hidden="true"
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
          <TopologyEmptyState isEmpty={nodes.length === 0} />
          {selectionBounds && (
            <TopologyAlignBar
              selectionBounds={selectionBounds}
              applyAlign={applyAlign}
              pan={pan}
              zoom={zoom}
              l10n={l10n}
            />
          )}
          {contextMenu && (
            <TopologyContextMenu
              l10n={l10n}
              menu={contextMenu}
              onClose={() => setContextMenu(null)}
              nodeMap={nodeMap}
              wires={wires}
              wireDisplayLabel={wireDisplayLabel}
              onCycleWireDirection={handleCycleWireDirection}
              onStartWireRename={startWireRename}
              onStartNodeRename={startNodeRename}
              onDuplicateSelection={duplicateSelection}
              onDeleteRequest={handleDeleteRequest}
              onZoomToSelection={zoomToSelection}
              selectedCount={selectedNodeIds.size}
              onClearSelection={clearSelection}
              allowLegacyApply={allowLegacyApply}
              onAddNode={handleAddNode}
              pan={pan}
              zoom={zoom}
              onSelectAll={selectAllNodes}
              onZoomToFit={zoomToFit}
              onResetView={resetView}
              canRenameBranch={!!onRenameBranch}
              canRenameWorkspace={!!onRenameWorkspace}
              onConfirmDeleteWire={() => setConfirmDelete('')}
            />
          )}
          {relationshipPicker && pickerAnchor && (
            <TopologyRelationshipPicker
              picker={relationshipPicker}
              toNode={pickerAnchor}
              getCanvas={getCanvas}
              pan={pan}
              zoom={zoom}
              onCommit={commitPickerOption}
              onCancel={cancelRelationshipPicker}
            />
          )}
          {migrationOpen && migrationEntries.length > 0 && (
            <TopologyMigrationDialog
              entries={migrationEntries}
              selectionFor={migrationSelectionFor}
              setMigrationSelections={setMigrationSelections}
              onLater={handleLaterMigration}
              onResolve={handleResolveMigration}
              l10n={l10n}
            />
          )}
          <div
            className="node-canvas-viewport"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <svg className="node-wires-svg" style={{ width: svgBounds.width, height: svgBounds.height }}>
              <defs>
                <marker
                  id="arrow-end"
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="4"
                  markerHeight="4"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--color-accent, #5a9fd4)" />
                </marker>

                <marker
                  id="arrow-start"
                  viewBox="0 0 6 6"
                  refX="5"
                  refY="3"
                  markerWidth="4"
                  markerHeight="4"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="var(--color-accent, #5a9fd4)" />
                </marker>
              </defs>

              {wires.map((wire) => {
                const geo = wireGeometries.get(wire.id);
                if (!geo) return null;
                return (
                  <TopologyWireGroup
                    key={wire.id}
                    wire={wire}
                    x1={geo.x1}
                    y1={geo.y1}
                    x2={geo.x2}
                    y2={geo.y2}
                    dx={geo.dx}
                    pathD={geo.pathD}
                    polyline={geo.polyline}
                    errors={liveValidation.byWire.get(wire.id) ?? EMPTY_ERRORS}
                    selected={selectedWireId === wire.id}
                    dimmed={hoverConnections !== null
                      && wire.fromNodeId !== hoveredNodeId
                      && wire.toNodeId !== hoveredNodeId}
                    hovered={hoveredWireId === wire.id}
                    l10n={l10n}
                    onHoverWire={hoverWire}
                    onWireClick={handleWireClick}
                    onOpenWireMenu={openWireMenu}
                    onStartGhostBend={startGhostBendDrag}
                    onStartBendDrag={startBendDrag}
                    onRemoveBend={removeBend}
                  />
                );
              })}

              {wirePreviewLine && (
                <path d={wirePreviewLine.d} className="wire-path" opacity="0.5" pointerEvents="none" />
              )}
            </svg>

            <TopologyAlignmentGuides alignmentGuide={alignmentGuide} />

            <TopologyWireRenameOverlay
              renamingWireId={renamingWireId}
              wireGeometries={wireGeometries}
              wireRenameDraft={wireRenameDraft}
              setWireRenameDraft={setWireRenameDraft}
              wireRenameInputRef={wireRenameInputRef}
              commitWireRename={commitWireRename}
              cancelWireRename={cancelWireRename}
              l10n={l10n}
            />

            {wireLabelsVisible && wires.map((wire) => {
              // Permanent label pill at the wire's midpoint (the same point
              // the rename input anchors to). Clicking opens the rename
              // editor — the wire itself stays the direction-cycle
              // affordance, so the pill must not cycle. Hidden while the
              // wire's own rename input is open (it replaces the pill).
              if (renamingWireId === wire.id) return null;
              const geo = wireGeometries.get(wire.id);
              if (!geo) return null;
              const mid = geo.polyline
                ? polylinePoint(geo.polyline, 0.5)
                : {
                    x: cubicBezier(0.5, geo.x1, geo.x1 + geo.dx, geo.x2 - geo.dx, geo.x2),
                    y: cubicBezier(0.5, geo.y1, geo.y1, geo.y2, geo.y2),
                  };
              const isDimmed = hoverConnections !== null
                && wire.fromNodeId !== hoveredNodeId
                && wire.toNodeId !== hoveredNodeId;
              const rStyle = relationshipStyle(wire.relationshipType);
              const fromName = nodeMap.get(wire.fromNodeId)?.name ?? '';
              const toName = nodeMap.get(wire.toNodeId)?.name ?? '';
              const tooltip = `${rStyle.icon} ${rStyle.label}: ${fromName} → ${toName}`;
              return (
                <button
                  key={wire.id}
                  type="button"
                  className={`wire-label-pill${isDimmed ? ' wire-label-pill-dimmed' : ''}`}
                  style={{ left: mid.x, top: mid.y }}
                  title={tooltip}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectWire(wire.id);
                    startWireRename(wire.id);
                  }}
                >
                  <span className="wire-label-badge" style={{ backgroundColor: rStyle.color }} />
                  <span className="wire-label-text-content">{wireDisplayLabel(wire)}</span>
                </button>
              );
            })}

                        {nodes.map((node) => {
              // Pre-compute per-port hover booleans so React.memo can
              // skip re-rendering unaffected cards when the target moves.
              const _htn = hoveredTarget?.nodeId === node.id ? hoveredTarget : null;
              return (
              <TopologyNodeCard
                key={node.id}
                node={node}
                isSelected={selectedNodeIds.has(node.id)}
                isConnectingSource={connectingFromNodeId === node.id}
                connectingFromNodeId={connectingFromNodeId}
                connectingFromPort={connectingFromPort}
                connectingFromVariantIndex={connectingFromVariantIndex}
                hoveredTarget={_htn ? { port: _htn.port, variantIndex: _htn.variantIndex } : null}
                nodeErrors={nodeErrorsByNode.get(node.id) ?? EMPTY_ERRORS}
                countBadge={excessBadgeByNode.get(node.id) ?? null}
                hasOverlap={overlappingNodeIds.has(node.id)}
                stockWireHint={addStockWireHintId === node.id}
                onDismissNodeIssue={handleDismissNodeIssue}
                isFresh={freshNodeIds.has(node.id)}
                /* Hover focus is the transient, specific intent: while it is
                   active it fully takes over, so the inspected card and its
                   connections light up even when compare focus would dim
                   them (round 163). Compare dimming applies outside hover. */
                isDimmed={(hoverConnections !== null && !hoverConnections.has(node.id))
                  || (compareDimSet.has(node.id) && hoverConnections === null)}
                isRenameable={(node.type === 'store' && !!onRenameBranch) || (node.type === 'workspace' && !!onRenameWorkspace)}
                renaming={renamingNodeId === node.id}
                renameDraft={renameDraft}
                l10n={l10n}
                renameInputRef={renameInputRef}
                renameBaselineRef={renameBaselineRef}
                onSelect={selectOnly}
                onOpenNodeMenu={openNodeMenu}
                onCardMouseDown={handleNodeMouseDown}
                onStartRename={startNodeRename}
                onCommitRename={commitNodeRename}
                onCancelRename={cancelNodeRename}
                onRenameDraftChange={setRenameDraft}
                onPersistRename={persistNodeRename}
                onSetNodeName={handleSetNodeName}
                onSetNodeEnabled={handleSetNodeEnabled}
                onPortClick={handlePortClick}
                onHoverNode={hoverNode}
                getTelemetry={getTelemetry}
                isPortCompatible={isPortCompatible}
                overlayMarker={overlayMarkerById.get(node.id) ?? null}
                onDisconnect={handleDisconnectNode}
              />
              );
            })}

            {/* Round 158: the compare panel's spatial diff. Other-only
                workspaces render as ghost cards at their SAVED positions in
                the other branch's diagram — a spatial hint of what that
                location has that this one does not. Decorative: pointer-
                events-none and aria-hidden, so the ghost never steals
                clicks, hover, or focus from a card below. */}
            {laidOutGhosts.length > 0 && (
              <div
                className={
                  panGestureActive
                    ? 'topology-overlay-ghost-layer'
                    : 'topology-overlay-ghost-layer topology-ghosts-animate'
                }
                aria-hidden="true"
              >
                {ghostStubs.length > 0 && (
                  <svg
                    className="topology-overlay-stub-layer"
                    style={{ width: stubSvgBounds.width, height: stubSvgBounds.height }}
                  >
                    {ghostStubs.map((s) => (
                      <line
                        key={s.id}
                        className="topology-overlay-stub"
                        x1={s.x1}
                        y1={s.y1}
                        x2={s.x2}
                        y2={s.y2}
                      />
                    ))}
                  </svg>
                )}
                {laidOutGhosts.map((g) => (
                  <div
                    key={g.id}
                    className="topology-overlay-ghost"
                    data-overlay-node-id={g.id}
                    aria-hidden="true"
                    style={{ transform: `translate(${g.x}px, ${g.y}px)` }}
                  >
                    <span className="topology-overlay-ghost-name">{g.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Round 146: the under-card segments of wires that cross a card
                they do not connect to, drawn on top so the wire reads as
                continuous. pointer-events-none — the overlay never steals
                clicks or hover from the card below. */}
            {wireUnderCardPaths.size > 0 && (
              <svg className="node-wires-crossing" style={{ width: svgBounds.width, height: svgBounds.height }}>
                {[...wireUnderCardPaths.entries()].map(([wireId, d]) => {
                  // Round 151: the overlay must mirror the base wire's
                  // interaction states (hover brightens, selected turns
                  // info-blue, hover-focus mode dims) or the wire visibly
                  // splits again the moment the user interacts with it —
                  // the exact continuity defect round 146 fixed, but on
                  // hover/selection instead of the static render.
                  const crossingWire = wires.find((w) => w.id === wireId);
                  const dimmed = hoverConnections !== null
                    && (crossingWire === undefined
                      || (crossingWire.fromNodeId !== hoveredNodeId
                        && crossingWire.toNodeId !== hoveredNodeId));
                  const cls = [
                    hoveredWireId === wireId ? 'node-wires-crossing-hover' : null,
                    selectedWireId === wireId ? 'node-wires-crossing-selected' : null,
                    dimmed ? 'node-wires-crossing-dimmed' : null,
                  ].filter(Boolean).join(' ') || undefined;
                  return <path key={wireId} d={d} className={cls} pointerEvents="none" />;
                })}
              </svg>
            )}
          </div>

          {/* ── Canvas HUD — status readouts only; the zoom readout
                 lives in the floating zoom cluster ───────────────── */}
          <div className="canvas-hud" aria-hidden="true">
            <span className="canvas-hud-item">{l10n.getString('topology-hud-nodes', { count: nodes.length })}</span>
            <span className="canvas-hud-divider" />
            <span className="canvas-hud-item">{l10n.getString('topology-hud-wires', { count: wires.length })}</span>
            <span className="canvas-hud-divider" />
            <CanvasCursorReadout pan={pan} zoom={zoom} />
            <span className="canvas-hud-divider" />
            <span className="canvas-hud-item">{l10n.getString('topology-status-selection', { count: selectedNodeIds.size })}</span>
          </div>

          {/* ── Node finder (Ctrl+F) — quick jump overlay ─────── */}
          <TopologyNodeFinder
            open={finderOpen}
            nodes={nodes}
            onJump={jumpToFinderMatch}
            onClose={closeFinder}
          />

          <TopologyCanvasZoomControls
            l10n={l10n}
            zoom={zoom}
            zoomPickerOpen={zoomPickerOpen}
            onToggleZoomPicker={() => setZoomPickerOpen((v) => !v)}
            onZoomOut={() => zoomBy(1 / 1.25)}
            onZoomIn={() => zoomBy(1.25)}
            onSliderChange={(z) => setZoom(z)}
            onZoomToFit={zoomToFit}
            onResetView={resetView}
            minimapVisible={minimapVisible}
            onToggleMinimap={() => setMinimapVisible((v) => !v)}
          />

          {/* ── Canvas minimap — bottom-left overview; click/drag to
                 recenter, arrows nudge the view, Enter centers on the
                 content box ────────────────────────────────────── */}
          {minimapVisible && (
            <TopologyMinimap
              nodes={nodes}
              wires={wires}
              nodeMap={nodeMap}
              pan={pan}
              zoom={zoom}
              canvasWidth={canvasRef.current?.clientWidth ?? 0}
              canvasHeight={canvasRef.current?.clientHeight ?? 0}
              onCenter={centerViewportOn}
              onNudge={nudgeViewport}
            />
          )}
        </div>

        {/* ── Inspector drawer (slice G7-b) ────────────────────────────────
            Extracted verbatim to TopologyInspectorDrawer; the mount condition
            stays here so the JSX contract is unchanged. */}
        {selectedNode && (
          <TopologyInspectorDrawer
            selectedNode={selectedNode}
            l10n={l10n}
            beginInspectorEdit={beginInspectorEdit}
            setNodes={setNodes}
            persistNodeRename={persistNodeRename}
            renameBaselineRef={renameBaselineRef}
            duplicateSelection={duplicateSelection}
            handleDeleteRequest={handleDeleteRequest}
            handleSetNodeMetadata={handleSetNodeMetadata}
            isProAllowed={isProAllowed}
            sessionToken={sessionToken}
            clearSelection={clearSelection}
          />
        )}
      </div>

      {/* ── Apply confirmation popup ──────────────────────────────── */}
      {/* Rendered unconditionally: the dialog must stay MOUNTED while closed,
          because confirmApply closes it during PIN verification and re-opens
          it on rejection, and the error + cleared PIN have to survive that. */}
      <TopologyApplyConfirm
        open={applyConfirmOpen}
        data={applyConfirmData}
        saving={saving}
        sessionPinVerified={pinVerifiedRef.current}
        onClose={() => setApplyConfirmOpen(false)}
        onConfirm={confirmApply}
      />

    </div>
  );
}
/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */

