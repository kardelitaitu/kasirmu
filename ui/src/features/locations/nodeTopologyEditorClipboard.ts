//! Clipboard, duplicate and paste callbacks for the topology editor (slice G13-c).
//!
//! Extracted verbatim from NodeTopologyEditor.tsx: the internal Ctrl+C/Ctrl+V
//! clipboard ref, the Figma-style paste-cascade counter, and the three
//! useCallbacks that own the copy/duplicate/paste semantics — creation-path
//! gates (branch identity + warehouse tier cap) refuse BEFORE the history
//! entry, copies are sanitized diagram-only cards, wires ride along only when
//! both endpoints survive, and every accepted gesture is exactly one undo
//! entry with the copies becoming the selection. Bodies and comments are
//! byte-identical to the inline originals; nothing was rewrapped. The dep
//! arrays keep their original name lists plus TWO sanctioned stable-dep
//! additions (canvasRef, GRID_SIZE — a stable ref and a module const, so
//! identity churn is unchanged; the 3.3a setLiveAnnouncement precedent)
//! because both became deps-object fields and exhaustive-deps demands them.
//!
//! The clipboard/cascade refs move INTO the hook: they had zero readers
//! outside this cluster (grep-verified at extraction time). The keyboard
//! controller and the inspector drawer consume the returned callbacks under
//! their original names, so their call/prop sites are untouched.

import { useCallback, useRef, type RefObject, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/components/Toast';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import { clampNodeToViewport } from './nodeTopologyClamp';
import { sanitizeCopiedNode } from './topologyCard';

/** Everything the clipboard cluster reads from the editor, one explicit
 *  field per name (the established deps-object convention — never a props
 *  bag). Types mirror the sibling hooks' interfaces. */
export interface TopologyEditorClipboardDeps {
  /** Current graph — copy/duplicate filter their source nodes/wires from it. */
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  /** Multi-selection the gesture applies to (nodes only; wire selection is
   *  mutually exclusive by construction). */
  selectedNodeIds: Set<string>;
  /** Current viewport — copies clamp into the visible canvas rect. */
  pan: { x: number; y: number };
  zoom: number;
  /** Canvas element ref — supplies the client rect the clamp works against. */
  canvasRef: RefObject<HTMLDivElement>;
  /** Shared creation-path gate (branch + warehouse tier cap); editor-owned
   *  because the other creation routes (add node, Alt+drag, commitDuplicate)
   *  call it too. */
  duplicateRefusal: (copies: TopologyNodeData[]) => string | null;
  /** Toast sink for the localized refusal copy. */
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Localization handle for the refusal message lookup. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Graph setters — one accepted gesture appends nodes + wires. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** The copies become the selection (primary = first copy). */
  selectMany: (ids: string[], primary: string | null) => void;
  /** History push — every accepted gesture is exactly one undo entry. */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Editor module grid const — one cascade step and the duplicate offset.
   *  Forwarded as a field (keyboard-hook precedent), not duplicated. */
  GRID_SIZE: number;
}

/** Owns the clipboard refs and the copy/duplicate/paste callbacks. The
 *  returned names are the original locals, so the keyboard deps object and
 *  the inspector drawer prop keep their pre-extraction text. */
export function useTopologyEditorClipboard(deps: TopologyEditorClipboardDeps) {
  const {
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
  } = deps;

  /** Internal clipboard for Ctrl+C/Ctrl+V. Wires are kept only when BOTH
   *  endpoints were copied — a half-copied wire would dangle on paste. */
  const clipboardRef = useRef<{ nodes: TopologyNodeData[]; wires: TopologyWireData[] }>({
    nodes: [],
    wires: [],
  });
  /** Pastes cascade one grid step per paste (Figma-style) so repeated
   *  Ctrl+V never stacks copies exactly on top of each other. Reset on a
   *  fresh copy. */
  const pasteCascadeRef = useRef(0);

  const copySelection = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const ids = new Set(selectedNodeIds);
    clipboardRef.current = {
      nodes: nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n })),
      wires: wires.filter((w) => ids.has(w.fromNodeId) && ids.has(w.toNodeId)).map((w) => ({ ...w })),
    };
    pasteCascadeRef.current = 0;
  }, [nodes, wires, selectedNodeIds]);

  /** Duplicate the selection in place: copies offset one grid step down-right,
   *  wires copied only when both endpoints are selected, the copies become
   *  the selection (so repeated Ctrl+D cascades), all in one undo entry. */
  const duplicateSelection = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const ids = new Set(selectedNodeIds);
    // Creation-path gates (branch + warehouse tier cap) refuse the gesture
    // BEFORE the history entry, so a blocked duplicate leaves no undo
    // record — shared with paste/Alt+drag so no route can bypass them.
    const refusal = duplicateRefusal(nodes.filter((n) => ids.has(n.id)));
    if (refusal) {
      addToast({ message: l10n.getString(refusal), type: 'warning' });
      return;
    }
    pushHistory();
    const idMap = new Map<string, string>();
    const copies = nodes.filter((n) => ids.has(n.id)).map((n) => {
      const newId = `${n.type}-${crypto.randomUUID()}`;
      idMap.set(n.id, newId);
      const clamped = clampNodeToViewport(n.x + GRID_SIZE, n.y + GRID_SIZE, {
        panX: pan.x,
        panY: pan.y,
        zoom,
        canvasW: canvasRef.current?.clientWidth ?? 0,
        canvasH: canvasRef.current?.clientHeight ?? 0,
      });
      // sanitizeCopiedNode strips a Branch Location copy's canonical
      // identity — the copy is a diagram-only card, never a second
      // branch impersonating the original.
      return { ...sanitizeCopiedNode(n), id: newId, x: clamped.x, y: clamped.y };
    });
    const wireCopies = wires
      .filter((w) => ids.has(w.fromNodeId) && ids.has(w.toNodeId))
      .map((w) => ({
        ...w,
        id: `wire-${crypto.randomUUID()}`,
        fromNodeId: idMap.get(w.fromNodeId)!,
        toNodeId: idMap.get(w.toNodeId)!,
      }));
    setNodes((prev) => [...prev, ...copies]);
    setWires((prev) => [...prev, ...wireCopies]);
    selectMany(copies.map((c) => c.id), copies[0]?.id ?? null);
  }, [nodes, wires, selectedNodeIds, pushHistory, pan, zoom, duplicateRefusal, addToast, l10n, setNodes, setWires, selectMany, canvasRef, GRID_SIZE]);

  /** Paste the clipboard with a per-paste cascade offset; wires whose both
   *  endpoints were copied come along. The pasted copies become the
   *  selection, and each paste is one undo entry. */
  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (clip.nodes.length === 0) return;
    // Same creation-path gates as the other routes — a clipboard holding
    // warehouses past the tier cap is refused before any history entry or
    // cascade offset. A Branch Location copy is allowed but sanitized below
    // into a diagram-only card.
    const refusal = duplicateRefusal(clip.nodes);
    if (refusal) {
      addToast({ message: l10n.getString(refusal), type: 'warning' });
      return;
    }
    pushHistory();
    pasteCascadeRef.current += 1;
    const dx = pasteCascadeRef.current * GRID_SIZE;
    const dy = pasteCascadeRef.current * GRID_SIZE;
    const idMap = new Map<string, string>();
    const copies = clip.nodes.map((n) => {
      const newId = `${n.type}-${crypto.randomUUID()}`;
      idMap.set(n.id, newId);
      const clamped = clampNodeToViewport(n.x + dx, n.y + dy, {
        panX: pan.x,
        panY: pan.y,
        zoom,
        canvasW: canvasRef.current?.clientWidth ?? 0,
        canvasH: canvasRef.current?.clientHeight ?? 0,
      });
      // sanitizeCopiedNode strips a Branch Location copy's canonical
      // identity — the copy is a diagram-only card, never a second
      // branch impersonating the original.
      return { ...sanitizeCopiedNode(n), id: newId, x: clamped.x, y: clamped.y };
    });
    const wireCopies = clip.wires
      .filter((w) => idMap.has(w.fromNodeId) && idMap.has(w.toNodeId))
      .map((w) => ({
        ...w,
        id: `wire-${crypto.randomUUID()}`,
        fromNodeId: idMap.get(w.fromNodeId)!,
        toNodeId: idMap.get(w.toNodeId)!,
      }));
    setNodes((prev) => [...prev, ...copies]);
    setWires((prev) => [...prev, ...wireCopies]);
    selectMany(copies.map((c) => c.id), copies[0]?.id ?? null);
  }, [pushHistory, pan, zoom, duplicateRefusal, addToast, l10n, setNodes, setWires, selectMany, canvasRef, GRID_SIZE]);

  return { copySelection, duplicateSelection, pasteClipboard };
}
