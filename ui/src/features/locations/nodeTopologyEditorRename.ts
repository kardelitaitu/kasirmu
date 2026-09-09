//! Inline rename machinery for the topology editor (Phase 4 · slices R1 + R1b).
//!
//! Owns inline node rename end to end: the open/draft/saving state, the two
//! focus effects that move the caret into the card's input and back out to the
//! card on a keyboard close, the rename-capability mirrors that gate WHICH node
//! types may be renamed, and the four callbacks the surfaces drive —
//! `startNodeRename` (F2 / pencil / double-click / context menu),
//! `cancelNodeRename` (Escape), `persistNodeRename` (the live-bound body-config
//! and inspector inputs) and `commitNodeRename` (the card's Enter/blur).
//!
//! What deliberately did NOT move, and why:
//! - The WIRE half of the old inline rename block moved into
//!   `useTopologyEditorWireRename` below (slice R1b) — zero symbol overlap with
//!   this one, so the two halves coexist as two exports with independent deps.
//!   What stayed parent-side is `pushHistory` itself: it is declared BELOW the
//!   wire block in NodeTopologyEditor.tsx, so the wire hook takes it as a
//!   deferred `pushHistory: () => void` wrapper rather than the callback (see
//!   TopologyWireRenameDeps). Relocating `pushHistory` would have shifted a hook
//!   slot, which is the one thing this extraction must not do.
//! - `nodes`, `setNodes`, `nodesRef`, `onRenameBranch` and `onRenameWorkspace`
//!   stay parent-side and arrive through deps: every one of them is also read by
//!   other regions of the editor (card / context-menu / inspector prop sites),
//!   so hoisting them here would invert ownership those surfaces rely on.
//! - The two node focus effects keep their exact relative order against the two
//!   wire focus effects and every other hook. The call site sits at the position
//!   of the original block, so hook order — and therefore effect order — is what
//!   the component already had.
//!
//! `renameSaving` has no reader outside this machinery (it is not handed to the
//! card or the inspector), so it is hook-internal — but it STAYS inside
//! `commitNodeRename`'s dependency array, exactly as it was inline. Pruning it
//! would fold the double-submit race the characterization test pins.
//!
//! Bodies, comments and dependency arrays are verbatim line-slices of the
//! inline originals in NodeTopologyEditor.tsx.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, SetStateAction } from 'react';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

export interface TopologyNodeRenameDeps {
  /** Current nodes — commit/persist resolve the target and its live name from
   *  here, so the value has to be the render-time array. */
  nodes: TopologyNodeData[];
  /** Node setter — a committed or reverted rename is written through it. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  /** Live mirror of `nodes`, read by the referentially stable
   *  `startNodeRename` (a dep on `nodes` would churn its identity and defeat
   *  the memoized cards that receive it as a prop). */
  nodesRef: MutableRefObject<TopologyNodeData[]>;
  /** Parent persist for Branch Locations; presence gates the control. */
  onRenameBranch?: ((id: string, name: string) => Promise<boolean> | boolean | void) | undefined;
  /** Parent persist for Workspaces; presence gates the control. */
  onRenameWorkspace?: ((id: string, name: string) => Promise<boolean> | boolean | void) | undefined;
}

export function useTopologyEditorNodeRename(deps: TopologyNodeRenameDeps) {
  const {
    nodes,
    setNodes,
    nodesRef,
    onRenameBranch,
    onRenameWorkspace,
  } = deps;

  // ── Inline node rename on the card (Branch Location + workspace) ──
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const renamingNodeIdRef = useRef<string | null>(renamingNodeId);
  renamingNodeIdRef.current = renamingNodeId;
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  /** Guards the blur-commit against a concurrent Escape/close. */
  const renameCancelledRef = useRef(false);
  /** Focus-time name snapshot for the live-bound rename inputs (body config
   *  / inspector Node Name). They already carry the edited value on blur, so
   *  the baseline is what tells an unedited blur from a real rename. */
  const renameBaselineRef = useRef<string | null>(null);
  /** Focus target when the rename form closes: the node id for keyboard
   *  closes (Enter/Escape), null for blur-commits — a click-away must not
   *  steal focus back from wherever the user actually clicked. */
  const renameFocusReturnRef = useRef<string | null>(null);

  // Move keyboard focus into the card's rename input the moment it opens
  // (autoFocus is banned by jsx-a11y/no-autofocus).
  useEffect(() => {
    if (renamingNodeId) renameInputRef.current?.focus();
  }, [renamingNodeId]);

  // Return focus to the node card after a keyboard-driven close, so the
  // keyboard user lands back on the node they just renamed instead of the
  // canvas body.
  useEffect(() => {
    if (renamingNodeId !== null) return;
    const nodeId = renameFocusReturnRef.current;
    if (nodeId === null) return;
    renameFocusReturnRef.current = null;
    (document.querySelector(`.topology-node[data-node-id="${nodeId}"]`) as HTMLElement | null)?.focus();
  }, [renamingNodeId]);

  /** Rename-capability mirrors for the type gate inside startNodeRename.
   *  The gate only reads PRESENCE of the two optional props, and they cannot
   *  be useCallback deps without churning the callback identity — every
   *  memoized node card receives startNodeRename as a prop, so a prop-side
   *  re-render would defeat the React.memo contract (same stale-closure
   *  reason as nodesRef / panRef above). */
  const canRenameBranchRef = useRef(!!onRenameBranch);
  canRenameBranchRef.current = !!onRenameBranch;
  const canRenameWorkspaceRef = useRef(!!onRenameWorkspace);
  canRenameWorkspaceRef.current = !!onRenameWorkspace;

  /** The single entry point into inline node rename: the F2 keyboard branch,
   *  the card pencil + double-click, and the context-menu Rename item all
   *  arrive here. Resolves the node from the live canvas mirror and applies
   *  the renameable type gate (a Branch Location needs onRenameBranch, a
   *  Workspace needs onRenameWorkspace), then silently no-ops when the node
   *  is gone or its type has no rename handler — which is exactly what F2 on
   *  a Warehouse always did, and why the card/menu hide the control.
   *  Callers still pass a second `currentName` argument (the card and
   *  context-menu prop signatures are `(nodeId, currentName)`, untouched in
   *  their own files); it is ignored by design — the name is re-read from the
   *  same array their `node` prop came from. Deps list only the parent-owned
   *  `nodesRef` — a stable ref identity — so the callback stays referentially
   *  stable and the memoized cards never re-render for it. */
  const startNodeRename = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    if (!((node.type === 'store' && canRenameBranchRef.current)
      || (node.type === 'workspace' && canRenameWorkspaceRef.current))) return;
    renameCancelledRef.current = false;
    renameFocusReturnRef.current = null;
    setRenameDraft(node.name);
    setRenamingNodeId(nodeId);
  }, [nodesRef]);

  const cancelNodeRename = useCallback(() => {
    renameCancelledRef.current = true;
    // Escape is a keyboard close — return focus to the card. Reads the
    // current renaming node via the ref so the callback stays stable (the
    // memoized cards all receive it as a prop).
    renameFocusReturnRef.current = renamingNodeIdRef.current;
    setRenamingNodeId(null);
    setRenameDraft('');
  }, []);

  /** Persist a live-bound rename (the body config input / inspector Node
   *  Name field) through the same parent callback the titlebar F2 rename
   *  uses, so a committed rename survives the authoritative instance/
   *  location refresh instead of being silently reverted by the merge.
   *  Harnesses without the callback keep the local-only path (Apply
   *  persists the diff). A false return means the parent toasted — keep
   *  the local name for a retry, mirroring commitNodeRename. */
  const persistNodeRename = useCallback(async (nodeId: string, name: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // Live-bound inputs already carry the edited value on blur — compare
    // against the focus-time baseline so an unedited blur never round-trips
    // a redundant rename through the parent.
    if (trimmed === renameBaselineRef.current) return;
    const persist = node.type === 'store' ? onRenameBranch : onRenameWorkspace;
    if (!persist) return;
    const ok = await persist(nodeId, trimmed);
    if (ok === false) {
      // The parent refused (it toasts the error) — revert the live-bound name
      // to the focus-time (authoritative) baseline so the canvas never holds
      // a name the backend rejected. commitNodeRename keeps its draft open
      // for a retry; a blurred input has no draft to keep, so reverting is
      // the honest state — the alternative (keep the edited name) would
      // silently revert on the next authoritative refresh instead.
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, name: renameBaselineRef.current ?? n.name } : n)));
      return;
    }
    renameBaselineRef.current = trimmed;
  }, [nodes, onRenameBranch, onRenameWorkspace, setNodes]);

  const commitNodeRename = useCallback(async (nodeId: string, fromKeyboard = false) => {
    if (renameSaving || renameCancelledRef.current) return;
    const node = nodes.find((n) => n.id === nodeId);
    const name = renameDraft.trim();
    // Empty or unchanged input is a no-op: close the form silently rather
    // than round-tripping a redundant update. A false return from the
    // parent is reserved for genuine errors (it toasts and we keep the
    // draft open for a retry).
    if (!node || !name || name === node.name) {
      renameCancelledRef.current = true;
      renameFocusReturnRef.current = fromKeyboard ? nodeId : null;
      setRenamingNodeId(null);
      setRenameDraft('');
      return;
    }
    setRenameSaving(true);
    try {
      const persist = node.type === 'store' ? onRenameBranch : onRenameWorkspace;
      const ok = await persist?.(nodeId, name);
      if (ok !== false) {
        // Belt & suspenders: reflect the new name locally AND let the seed
        // refresh (profile / instance is authoritative) confirm it on the
        // next reload.
        setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, name } : n)));
        renameCancelledRef.current = true;
        renameFocusReturnRef.current = fromKeyboard ? nodeId : null;
        setRenamingNodeId(null);
        setRenameDraft('');
      }
      // ok === false → parent toasts; keep the draft open for a retry.
    } finally {
      setRenameSaving(false);
    }
  }, [renameSaving, renameDraft, nodes, onRenameBranch, onRenameWorkspace, setNodes]);

  return {
    renamingNodeId,
    renameDraft,
    setRenameDraft,
    renameInputRef,
    renameBaselineRef,
    startNodeRename,
    cancelNodeRename,
    persistNodeRename,
    commitNodeRename,
  };
}

/**
 * Deps for {@link useTopologyEditorWireRename}. Slice R1b owns the WIRE half of
 * the old inline rename block: start/draft/cancel state, the two focus effects,
 * and the three plain-arrow callbacks the wire surfaces drive.
 */
export interface TopologyWireRenameDeps {
  /** Current wires — start/commit resolve the target and its live label from
   *  here, so the value has to be the render-time array. */
  wires: TopologyWireData[];
  /** Wire setter — a committed relabel (or the empty-label delete) is written
   *  through it. */
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** Deferred access to the parent's `pushHistory`. The real `pushHistory`
   *  is declared BELOW this hook's call site in NodeTopologyEditor.tsx, so it
   *  arrives as a wrapper arrow: the arrow closes over the BINDING without
   *  reading it during render (no TDZ throw) and by event time it is
   *  initialized. Passing `pushHistory` itself would evaluate it at render —
   *  ReferenceError. `commitWireRename` calls it bare, so `() => void` suffices. */
  pushHistory: () => void;
}

export function useTopologyEditorWireRename(deps: TopologyWireRenameDeps) {
  const {
    wires,
    setWires,
    pushHistory,
  } = deps;

  // ── Inline wire rename: floating input at the wire's midpoint ──
  const [renamingWireId, setRenamingWireId] = useState<string | null>(null);
  const [wireRenameDraft, setWireRenameDraft] = useState('');
  const wireRenameInputRef = useRef<HTMLInputElement>(null);
  /** Guards the blur-commit against a concurrent Escape/close. */
  const wireRenameCancelledRef = useRef(false);
  /** Focus target when the form closes: the wire id for keyboard closes
   *  (Enter/Escape), null for blur-commits — a click-away must not steal
   *  focus back from wherever the user actually clicked. */
  const wireRenameFocusReturnRef = useRef<string | null>(null);

  // Move keyboard focus into the wire's rename input the moment it opens.
  useEffect(() => {
    if (renamingWireId) wireRenameInputRef.current?.focus();
  }, [renamingWireId]);

  // Return focus to the wire after a keyboard-driven close, so the keyboard
  // user lands back on the object they just relabeled instead of the canvas.
  useEffect(() => {
    if (renamingWireId !== null) return;
    const wireId = wireRenameFocusReturnRef.current;
    if (wireId === null) return;
    wireRenameFocusReturnRef.current = null;
    (document.querySelector(`.wire-hitbox[data-wire-id="${wireId}"]`) as HTMLElement | null)?.focus();
  }, [renamingWireId]);

  const startWireRename = (wireId: string) => {
    const wire = wires.find((w) => w.id === wireId);
    wireRenameCancelledRef.current = false;
    wireRenameFocusReturnRef.current = null;
    setWireRenameDraft(wire?.label ?? '');
    setRenamingWireId(wireId);
  };

  const cancelWireRename = () => {
    wireRenameCancelledRef.current = true;
    // Escape is a keyboard close — return focus to the wire.
    wireRenameFocusReturnRef.current = renamingWireId;
    setRenamingWireId(null);
    setWireRenameDraft('');
  };

  const commitWireRename = (wireId: string, fromKeyboard = false) => {
    if (wireRenameCancelledRef.current) return;
    const wire = wires.find((w) => w.id === wireId);
    const label = wireRenameDraft.trim();
    // Empty or unchanged input is a no-op: close the form silently. An empty
    // label reverts to the endpoint-name display (the label is optional).
    if (!wire || label === (wire.label ?? '')) {
      wireRenameCancelledRef.current = true;
      wireRenameFocusReturnRef.current = fromKeyboard ? wireId : null;
      setRenamingWireId(null);
      setWireRenameDraft('');
      return;
    }
    // One undo entry; label is a persisted field in the dirty projection, so
    // the relabel also marks the canvas dirty and rides Apply Topology.
    pushHistory();
    setWires((prev) =>
      prev.map((w) => {
        if (w.id !== wireId) return w;
        const next: TopologyWireData = { ...w };
        if (label) next.label = label;
        else delete next.label;
        return next;
      }),
    );
    wireRenameCancelledRef.current = true;
    wireRenameFocusReturnRef.current = fromKeyboard ? wireId : null;
    setRenamingWireId(null);
    setWireRenameDraft('');
  };

  return {
    renamingWireId,
    wireRenameDraft,
    setWireRenameDraft,
    wireRenameInputRef,
    startWireRename,
    cancelWireRename,
    commitWireRename,
  };
}
