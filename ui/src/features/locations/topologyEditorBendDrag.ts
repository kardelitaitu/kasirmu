//! Bend-drag gesture callbacks for the topology editor (Phase 3.4a).
//!
//! Owns the three bend mutations the memoized TopologyWireGroup receives as
//! props: startBendDrag (arm a document-level drag moving an existing bend,
//! or — with the created flag — a freshly spliced ghost bend),
//! startGhostBendDrag (the midpoint-ghost entry point that delegates to it),
//! and removeBend (double-click removal). Every gesture semantic is preserved
//! verbatim from the inline originals in NodeTopologyEditor: the document-level
//! listeners installed here, history pushed ONCE on the first movement, the
//! deferred ghost insertion (pendingInsert) that makes a click without drag
//! leave no trace, and the no-op landing pop that keeps Undo from offering an
//! entry restoring identical state.
//!
//! The hook owns only the callbacks. The gesture refs (bendDragRef,
//! bendDragCleanupRef) and the graph mirrors they read stay parent-owned and
//! arrive through deps: the editor cancelBendDrag (Escape / canvas replacement)
//! and the unmount listener sweep both consume them, so hoisting them here
//! would split one gesture across two owners. The call site sits at the exact
//! position of the original trio, so hook order — and therefore effect order —
//! is unchanged.

import { useCallback, type MutableRefObject, type SetStateAction } from 'react';
import type { TopologyHistoryEntry } from './nodeTopologyEditorState';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import { bendLandedAtStart, type BendGestureState } from './topologyCommands';

export interface TopologyBendDragDeps {
  /** Current viewport pan — client-to-canvas coords use the same transform as
   *  node drags, so bends stay glued to the cursor while panned. */
  pan: { x: number; y: number };
  /** Current viewport zoom divisor, paired with pan. */
  zoom: number;
  /** Selection reducer wire selector — a bend gesture selects its wire. */
  selectWire: (id: string) => void;
  /** Canvas element providing the getBoundingClientRect origin for coords. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Wire graph setter: bend insert, update and remove all write through it. */
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** History setter — used only to pop a no-op drag entry on mouseup. */
  setHistory: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  /** Live node mirror read at mousedown for the pre-gesture snapshot. */
  nodesRef: MutableRefObject<TopologyNodeData[]>;
  /** Live wire mirror: snapshot source and no-op landing check. */
  wiresRef: MutableRefObject<TopologyWireData[]>;
  /** Parent-owned in-flight gesture ref, also read by cancelBendDrag and the
   *  keyboard handler that decides whether a bend is in flight. */
  bendDragRef: MutableRefObject<BendGestureState | null>;
  /** Parent-owned document-listener cleanup ref: both the editor unmount sweep
   *  and cancelBendDrag disarm a live drag through it. */
  bendDragCleanupRef: MutableRefObject<(() => void) | null>;
  /** Parent-owned history-push mirror, READ but never listed as a dep — the
   *  original callbacks stayed referentially stable while pushHistory re-keys
   *  whenever nodes/wires change, which would otherwise churn every wire. */
  pushHistoryRef: MutableRefObject<
    (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void
  >;
}

/**
 * The three bend gestures, with the same identities the inline originals had.
 */
export function useTopologyEditorBendDrag(deps: TopologyBendDragDeps): {
  startBendDrag: (e: React.MouseEvent, wireId: string, index: number, startX: number, startY: number, created?: boolean) => void;
  startGhostBendDrag: (e: React.MouseEvent, wireId: string, segmentIndex: number, mx: number, my: number) => void;
  removeBend: (wireId: string, index: number) => void;
} {
  const {
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
  } = deps;

  /** Arm a document-level drag that moves bend `index` on `wireId`.
   *  Canvas coords are derived from client coords with the same pan/zoom
   *  transform as node drags, so bends stay glued to the cursor while
   *  panning/zoomed. History is pushed once, on the first movement. */
  const startBendDrag = useCallback((e: React.MouseEvent, wireId: string, index: number, startX: number, startY: number, created = false) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    selectWire(wireId);
    bendDragCleanupRef.current?.();
    // `created` (ghost) bends are INSERTED by the first movement, not at
    // mousedown — a click without drag on a midpoint ghost must leave no
    // trace (no phantom bend, no dirty, no entry). pendingInsert flips
    // false the moment the bend is spliced in.
    const drag = { wireId, index, moved: false, startX, startY, created, pendingInsert: created };
    bendDragRef.current = drag;
    // Pre-gesture snapshot captured at mousedown: for a ghost-created bend
    // the insertion is deferred to the first movement (pendingInsert), so
    // the refs hold the UNBENT wires — the exact undo target (one entry,
    // restores the pre-gesture state). For an existing bend they hold the
    // wire with the bend at its original position. Immutable discipline:
    // each setWires replaces the bends array, so the history entry keeps
    // the old array reference.
    const snapshot = { nodes: nodesRef.current, wires: wiresRef.current };
    const handleMove = (ev: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const bx = (ev.clientX - (rect?.left ?? 0) - pan.x) / zoom;
      const by = (ev.clientY - (rect?.top ?? 0) - pan.y) / zoom;
      const d = bendDragRef.current;
      if (!d) return;
      if (!d.moved) {
        d.moved = true;
        pushHistoryRef.current(snapshot);
        if (d.pendingInsert) {
          // Deferred ghost insertion: splice the fresh bend in at the
          // CURRENT cursor position. The snapshot above still holds the
          // UNBENT wires (the refs flush after this handler), so one undo
          // removes the whole creation gesture. The splice also places the
          // bend at the cursor, so return without the update pass below.
          d.pendingInsert = false;
          setWires((prev) =>
            prev.map((w) => {
              if (w.id !== d.wireId) return w;
              const bends = [...(w.bends ?? [])];
              bends.splice(d.index, 0, { x: bx, y: by });
              return { ...w, bends };
            }),
          );
          return;
        }
      }
      setWires((prev) =>
        prev.map((w) =>
          w.id !== d.wireId
            ? w
            : { ...w, bends: (w.bends ?? []).map((b, i) => (i === d.index ? { x: bx, y: by } : b)) },
        ),
      );
    };
    const handleUp = () => {
      const d = bendDragRef.current;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      bendDragCleanupRef.current = null;
      bendDragRef.current = null;
      // No-op bend drag: a COMPLETED drag of an EXISTING bend that landed
      // exactly at its start position pushed an entry (on first movement)
      // that restores identical state — pop it so Undo never appears but
      // does nothing. (bendLandedAtStart never suppresses a created bend —
      // the bend's existence is the edit. Cancel already pops via
      // cancelBendDrag.)
      if (d && d.moved && bendLandedAtStart(wiresRef.current, d)) {
        setHistory((prev) => prev.slice(0, -1));
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);      bendDragCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      bendDragCleanupRef.current = null;
      bendDragRef.current = null;
    };
    // The refs read above (bendDragRef, bendDragCleanupRef, nodesRef, wiresRef,
    // pushHistoryRef) arrive through the deps object, so the rule cannot see that they
    // are the editor's own useRef objects — it only trusts useRef() created in this
    // scope. Their identity never changes, so listing them would be a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original.
  }, [pan, zoom, selectWire, canvasRef, setWires, setHistory]);

  /** Drag on a midpoint ghost: one gesture creates and positions a fresh
   *  bend. The insertion is DEFERRED to the first drag movement (the
   *  startBendDrag pendingInsert flow) — a mousedown+mouseup without
   *  movement is a pure no-op instead of leaving a phantom midpoint bend
   *  that dirties the canvas with no undo entry to remove it. */
  const startGhostBendDrag = useCallback((e: React.MouseEvent, wireId: string, segmentIndex: number, mx: number, my: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    selectWire(wireId);
    startBendDrag(e, wireId, segmentIndex, mx, my, true);
  }, [selectWire, startBendDrag]);

  /** Double-click a bend handle to remove it (one undo entry). Stable so
   *  the memoized wire groups can receive it as a prop. */
  const removeBend = useCallback((wireId: string, index: number) => {
    pushHistoryRef.current();
    setWires((prev) =>
      prev.map((w) =>
        w.id !== wireId
          ? w
          : { ...w, bends: (w.bends ?? []).filter((_, i) => i !== index) },
      ),
    );
    // pushHistoryRef comes through deps (see the note on startBendDrag): the parent
    // keeps it in a ref precisely so these handlers stay referentially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original.
  }, [setWires]);

  return { startBendDrag, startGhostBendDrag, removeBend };
}
