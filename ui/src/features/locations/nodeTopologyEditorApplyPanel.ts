//! Apply surface for the topology editor (Phase 4 - slice G8-a).
//!
//! Owns the Apply path end to end plus the two pieces of confirm-dialog state
//! it drives:
//! - dirtySummary - the "Unsaved changes" chip preview, derived through the
//!   SAME planTopologyDiff the save payload is built on, so the preview can
//!   never drift from the Apply.
//! - handleApplyClick - the Apply GATE: validate the raw canvas, open the
//!   issues panel and toast when blocked, otherwise build the diff preview and
//!   open the PIN confirm popup.
//! - confirmApply - the PIN check and the save itself: the id-map remap, the
//!   revision-conflict reload, and the deferred finishApply release.
//!
//! What deliberately did NOT move, and why:
//! - pinVerifiedRef, skipNextLoadRef and appliedSnapshotRef stay parent-owned
//!   and arrive through deps. The load lifecycle, the restore path,
//!   commitSnapshot/isDirty and the reload effects all read them too, so
//!   making the panel their owner would split one fact across two files.
//! - commitSnapshot stays parent-side for the same reason and is CALLED here,
//!   never re-derived: the exact-dirty contract is that the applied snapshot is
//!   the canvas the save actually sent.
//! - The TopologyApplyConfirm JSX stays mounted in the editor. It is already a
//!   props-driven child, and the dialog must stay MOUNTED while closed so its
//!   error and cleared PIN survive the confirmApply close/re-open - a contract
//!   the mount pins.
//! - saving is not a dep: its only reader is that mount.
//!
//! PIN_VERIFIED_SESSIONS DID move here, as a module-scope export. It is written
//! by confirmApply and read by the editor's pinVerifiedRef initializer, so
//! exactly one file has to own it - and it has to survive the per-branch
//! remounts, which is why it is a module const rather than a ref. It is
//! deliberately NOT a deps field: a deps-sourced value is reactive, and
//! exhaustive-deps would then demand a thirteenth name in confirmApply's array,
//! which stays byte-identical to the inline original.
//!
//! Bodies, comments and dependency arrays are verbatim line-slices of the
//! inline originals in NodeTopologyEditor.tsx. The one ordering change is
//! confirmApply: its slot moved from mid-file to this hook call, so it now
//! lands after pushHistory. Nothing orders effects against it - it is only ever
//! invoked by the dialog.

import { useCallback, useMemo, useState } from 'react';
import type { MutableRefObject, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/frontend/shared/Toast';
import { parseAppError, plainErrorMessage } from '@/utils/app-error';
import type { ApplyDiffItem, TopologyApplyConfirmData } from './TopologyApplyConfirm';
import { isTopologyRevisionConflict, validateEditorGraph } from './topologyEditorHelpers';
import { TopologyApplyValidationError } from './topologyApply';
import { planTopologyDiff, summarizeTopologyPlan } from './topologyDiff';
import { topologyIssueKey } from './topologyContract';
import type { TopologyHistoryEntry } from './nodeTopologyEditorState';
import type {
  NodeTopologyEditorProps,
  TopologyNodeData,
  TopologyWireData,
  WorkspaceInstanceSeed,
} from './NodeTopologyEditor';

/** Session-level "Remember PIN" cache. The editor is keyed by branch
 *  (TopologyScreen remounts it on every branch switch), so a component-scoped
 *  ref would forget the verified PIN on each switch — contradicting the
 *  "Remember PIN for this session" label. A module-scope set keyed by session
 *  token survives remounts for the app's lifetime, matching the label. */
export const PIN_VERIFIED_SESSIONS = new Set<string>();

/** Stable validation-issue key. Mirrors the editor's local alias so the moved
 *  Apply-gate line stays verbatim; the key format lives in the contract. */
const issueKey = topologyIssueKey;

export interface TopologyApplyPanelDeps {
  /** Canvas being applied - the payload and the diff preview both read it. */
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
  /** Branch document revision: the base revision of the save, and of the
   *  chip's from/to preview. */
  topologyRevision: number;
  /** Dismissed issue keys. The gate drops the one error the operator resolved
   *  on purpose (an intentionally empty warehouse). */
  resolvedIssues: Set<string>;
  /** Parent persist. Positional contract: (nodes, wires, baseRevision,
   *  resolvedIssueKeys, changeNote) - and the issue set is COPIED. */
  onSave: NodeTopologyEditorProps['onSave'] | undefined;
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Only getString is needed - for the blocked / saving / conflict copy. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Save-lifecycle guard: false means an Apply is already in flight. */
  beginApply: () => boolean;
  failApply: () => void;
  finishApply: (revision: number) => void;
  /** Parent dirty-snapshot committer - CALLED here, never re-derived. */
  commitSnapshot: (next: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** PIN verification target; null means there is no session to verify. */
  sessionToken: string | null;
  allowLegacyApply: boolean;
  currentTier: NonNullable<NodeTopologyEditorProps['currentTier']>;
  /** Real backend instances - the before-side of the diff when present. */
  workspaceInstances: WorkspaceInstanceSeed[] | undefined;
  /** Authenticated store, echoed into the dialog's debug panel. */
  sessionStoreId: string;
  /** The gate opens the issues panel rather than toasting one error at a time. */
  setValidationPanelOpen: (value: SetStateAction<boolean>) => void;
  /** Exact-dirty flag; dirtySummary previews the diff only when dirty. */
  isDirty: boolean;
  /** Parent-side session PIN mirror; the dialog reads it as a prop. */
  pinVerifiedRef: MutableRefObject<boolean>;
  /** Cross-effect handshake: suppress the reload onSave triggers. */
  skipNextLoadRef: MutableRefObject<boolean>;
  /** Canvas as of the last Apply / authoritative load. */
  appliedSnapshotRef: MutableRefObject<{ nodes: TopologyNodeData[]; wires: TopologyWireData[] } | null>;
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  setHistory: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  setRedo: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  /** Selection reducer - an id-map remap replaces every id, so the whole
   *  selection goes stale and is dropped with the history stacks. */
  clearAll: () => void;
  /** Conflict recovery bumps this to re-run the load effect. */
  setReloadKey: (value: SetStateAction<number>) => void;
}

/** The Apply gate, the confirm popup's state, and the save itself. */
export function useTopologyEditorApplyPanel(deps: TopologyApplyPanelDeps) {
  const {
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
  } = deps;

  // ── Apply confirmation popup ──────────────────────────────────────
  // Only the two pieces the editor itself decides are left here: whether the
  // dialog is open, and what it is confirming. The PIN entry, its error, the
  // verifying spinner and the remember-flag all moved to
  // TopologyApplyConfirm with the JSX that renders them.
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [applyConfirmData, setApplyConfirmData] = useState<TopologyApplyConfirmData | null>(null);

  // ── Confirm-apply: the actual save after the confirmation popup ──
  /**
   * Verify the dialog's PIN and, if it holds, run the Apply.
   *
   * Resolves FALSE only when the PIN was rejected — the signal for the dialog
   * to re-open and show its error. Every other early exit resolves TRUE,
   * because "already saving" and "the backend rejected the graph" are not PIN
   * problems and must not be reported as one.
   *
   * The dialog's own state (typed PIN, error, verifying spinner) is no longer
   * touched here; TopologyApplyConfirm owns it. What stays is the close/reopen
   * sequencing, because this function is the one that knows when to do it.
   */
  const confirmApply = useCallback(async (
    pin: string,
    remember: boolean,
    changeNote: string,
  ): Promise<boolean> => {
    if (!beginApply()) return true;
    setApplyConfirmOpen(false);
    try {
      // Session-level PIN cache: skip re-verification when the flag is set
      // (controlled by the "Remember PIN" checkbox in the dialog).
      if (!pinVerifiedRef.current) {
        const { verifyPin } = await import('@/api/staff');
        if (!sessionToken) { setApplyConfirmOpen(true); failApply(); return false; }
        const valid = await verifyPin(sessionToken, pin);
        if (!valid) {
          setApplyConfirmOpen(true);
          failApply();
          return false;
        }
        // Persist the verified flag for the rest of the session. Write to
        // the module-scope cache too so a branch-switch remount (new ref
        // initialized from the set) keeps the remembered PIN.
        if (remember) {
          pinVerifiedRef.current = true;
          if (sessionToken) PIN_VERIFIED_SESSIONS.add(sessionToken);
        }
      }
    } catch {
      setApplyConfirmOpen(true);
      failApply();
      return false;
    }
    skipNextLoadRef.current = true;
    addToast({ message: l10n.getString('topology-apply-status-saving'), type: 'info' });
    let savedNodes = nodes;
    let savedWires = wires;
    let nextRevision: number | undefined;
    try {
      const result = await onSave?.(nodes, wires, topologyRevision, [...resolvedIssues], changeNote);
      const idMap: Record<string, string> | undefined = result && typeof result === 'object' && 'idMap' in result
        ? (result.idMap && typeof result.idMap === 'object'
          ? result.idMap as Record<string, string>
          : undefined)
        : result && typeof result === 'object' && !('revision' in result)
          ? result as Record<string, string>
          : undefined;
      if (result && typeof result === 'object' && 'revision' in result && typeof result.revision === 'number') {
        nextRevision = result.revision;
      }
      if (idMap && Object.keys(idMap).length > 0) {
        clearAll();
        setHistory([]);
        setRedo([]);
        savedNodes = nodes.map((n) => {
          const newId = idMap[n.id];
          return newId ? { ...n, id: newId } : n;
        });
        savedWires = wires.map((w) => {
          const newFrom = idMap[w.fromNodeId];
          const newTo = idMap[w.toNodeId];
          if (newFrom || newTo) {
            return {
              ...w,
              fromNodeId: newFrom ?? w.fromNodeId,
              toNodeId: newTo ?? w.toNodeId,
            };
          }
          return w;
        });
        setNodes(savedNodes);
        setWires(savedWires);
      }
    } catch (err) {
      if (isTopologyRevisionConflict(err)) {
        addToast({ message: l10n.getString('topology-toast-revision-conflict'), type: 'error' });
        skipNextLoadRef.current = false;
        failApply();
        setReloadKey((k) => k + 1);
        return true;
      }
      if (!(err instanceof TopologyApplyValidationError)) {
        // Show both the localized error category AND the raw backend detail
        // so the user (and developer) can see exactly what failed.
        const typed = parseAppError(err);
        const rawMsg = typed?.message ?? plainErrorMessage(err);
        const userMsg = plainErrorMessage(err);
        addToast({
          message: `${l10n.getString('topology-toast-save-error')}: ${userMsg}${rawMsg !== userMsg ? ` (${rawMsg})` : ''}`,
          type: 'error',
        });
      }
      skipNextLoadRef.current = false;
      failApply();
      return true;
    }
    commitSnapshot({ nodes: savedNodes, wires: savedWires });
    setTimeout(() => {
      skipNextLoadRef.current = false;
      finishApply(nextRevision ?? topologyRevision);
    }, 0);
    // The PIN held. Everything after this point is the Apply itself, and a
    // failure there is reported by toast — it is not a PIN problem, so the
    // dialog must not reopen claiming one.
    return true;
  }, [nodes, wires, topologyRevision, resolvedIssues, onSave, addToast, l10n, beginApply, failApply, finishApply, commitSnapshot, sessionToken]);

  // ── Header actions (extracted JSX lives in topologyHeader.tsx) ─────
  // The Apply gate: validate the raw canvas, then build the diff preview
  // and open the PIN confirm popup. Same validation as the live badge
  // surface — shared helper keeps the toast and badges in lockstep. A
  // DISMISSED missing-stock-routing prompt (intentionally empty warehouse)
  // is the one error that stops blocking once the user explicitly resolved
  // it (round 81).
  const handleApplyClick = useCallback(async () => {
    const validationErrors = validateEditorGraph(nodes, wires, allowLegacyApply, currentTier).filter(
      (e) => !(e.code === 'warehouse-missing-stock-routing' && e.nodeId && resolvedIssues.has(issueKey(e.nodeId, e.messageId))),
    );
    if (validationErrors.length > 0) {
      // Open the issues panel so the user sees EVERY blocking issue at once
      // instead of fixing them one at a time through the toast, then confirm
      // what blocked Apply.
      setValidationPanelOpen(true);
      addToast({
        message: l10n.getString('topology-apply-blocked', { count: String(validationErrors.length) }),
        type: 'error',
      });
      return;
    }
    // Compute the diff preview and show the confirmation popup.
    const snap = appliedSnapshotRef.current;
    const beforeInstances = workspaceInstances !== undefined
      ? workspaceInstances.map((s) => ({
        instance_id: s.instanceId,
        type_key: s.typeKey,
        ...(s.purposeKey !== undefined ? { purpose_key: s.purposeKey } : {}),
        name: s.name,
      }))
      : (snap?.nodes ?? [])
        .filter((n) => n.type === 'workspace')
        .map((n) => ({
          instance_id: n.id,
          type_key: (n.metadata?.['typeKey'] as string) ?? 'store-pos',
          purpose_key: (n.metadata?.['purposeKey'] as string) ?? 'general',
          name: n.name,
        }));
    const plan = planTopologyDiff(nodes, beforeInstances);
    const wsNodes = new Map(nodes.filter((n) => n.type === 'workspace').map((n) => [n.id, n]));
    const instanceMap = new Map((workspaceInstances ?? []).map((s) => [s.instanceId, s]));
    const items = (ids: string[], map: Map<string, { name: string; typeKey?: string; type_key?: string }>): ApplyDiffItem[] =>
      ids.map((id) => {
        const entry = map.get(id);
        return { id, name: entry?.name ?? id, typeKey: entry?.typeKey ?? entry?.type_key ?? 'store-pos' };
      });
    const createdItems = items(
      plan.createNodeIds.filter((id) => !plan.typeChanges.has(id)),
      wsNodes,
    );
    const typeChangedItems = [...plan.typeChanges.entries()].map(([id, ch]) => ({
      id: ch.newId, name: wsNodes.get(id)?.name ?? id, typeKey: ch.newTypeKey,
    }));
    const updatedItems = items(plan.updateNodeIds, instanceMap);
    const archivedItems = items(
      plan.archiveIds.filter((id) => !plan.typeChanges.has(id)),
      instanceMap,
    );
    // Resolve store IDs for the debug info panel.
    const branchNode = nodes.find((n) => n.type === 'store');
    const effectiveStoreId = branchNode?.storeProfileId
      ?? (branchNode?.metadata?.['storeProfileId'] as string | undefined)
      ?? sessionStoreId;
    setApplyConfirmData({
      created: createdItems,
      updated: updatedItems,
      archived: archivedItems,
      typeChanged: typeChangedItems,
      sessionStoreId,
      effectiveStoreId,
    });
    // Opening is all this does now: clearing the PIN and focusing the field
    // are the dialog's own concern, driven by its `open` effect.
    setApplyConfirmOpen(true);
  }, [nodes, wires, allowLegacyApply, currentTier, resolvedIssues, workspaceInstances, sessionStoreId, addToast, l10n, setValidationPanelOpen, setApplyConfirmData, appliedSnapshotRef]);

  /** Reactive "Unsaved changes" chip data. Round 153: the chip always
   *  previews the workspace-instance diff through the SAME planTopologyDiff
   *  the save path's payload builder is built on, so the preview can never
   *  drift from the Apply. With real instances the before-side is the loaded
   *  backend instances (round 150); on a standalone/demo canvas it is
   *  synthesized from the committed snapshot (the last-loaded diagram) — the
   *  workspace format is the single honest signal everywhere.
   *  The plan is total: a workspace mid-wiring (no store ownership yet)
   *  still counts as a creation instead of crashing the chip (round 152: a
   *  type change surfaces as a destructive recreate, not a plain create +
   *  archive). */
  const dirtySummary = useMemo(() => {
    if (!isDirty) return null;
    const snap = appliedSnapshotRef.current;
    const beforeInstances = workspaceInstances !== undefined
      ? workspaceInstances.map((s) => ({
        instance_id: s.instanceId,
        type_key: s.typeKey,
        // exactOptionalPropertyTypes: omit the key, never set it to undefined.
        ...(s.purposeKey !== undefined ? { purpose_key: s.purposeKey } : {}),
        name: s.name,
      }))
      : (snap?.nodes ?? [])
        .filter((n) => n.type === 'workspace')
        .map((n) => ({
          instance_id: n.id,
          type_key: (n.metadata?.['typeKey'] as string) ?? 'store-pos',
          purpose_key: (n.metadata?.['purposeKey'] as string) ?? 'general',
          name: n.name,
        }));
    const plan = planTopologyDiff(nodes, beforeInstances);
    return summarizeTopologyPlan(plan);
  }, [isDirty, nodes, workspaceInstances, appliedSnapshotRef]);

  return {
    applyConfirmOpen,
    applyConfirmData,
    setApplyConfirmOpen,
    handleApplyClick,
    confirmApply,
    dirtySummary,
  };
}
