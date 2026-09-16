import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import { loadTopology } from '@/api/topology';
import { plainErrorMessage } from '@/utils/app-error';
import type { ToastType } from '@/frontend/shared/Toast';
import { buildLoadedTopologyWires, buildWorkspaceTopologyNodes } from './topologyLoadModel';
import { syncBranchLocations, syncWorkspaceInstanceNames } from './topologyBranchSync';
import { diagramNodeToCanvas, diagramWireToCanvas } from './topologyEditorHelpers';
import type { TopologyHistoryEntry } from './nodeTopologyEditorState';
import type {
  BranchLocationSeed,
  PortName,
  TopologyNodeData,
  TopologyWireData,
  WorkspaceInstanceSeed,
} from './NodeTopologyEditor';

/**
 * Hook owning the authoritative load lifecycle extracted from
 * NodeTopologyEditor: the full-load effect (mount/reload), the two
 * light-merge fast paths (branch-location rename/seed/delete without an
 * instance change; workspace name refresh with an identical instance id
 * set), the post-Apply skip guard, the unassigned-branch empty graph, the
 * legacy saved-diagram/preset fallback, and the thrown-error toast +
 * `onLoadError` boundary.
 *
 * Pure behavior move — every branch, comment, ordering guarantee, and
 * dependency below is copied verbatim from the editor's inline effect so
 * the extraction cannot drift timing or semantics. The prev-prop identity
 * refs are private to this lifecycle and live here; `skipNextLoadRef` and
 * `migrationDismissedRef` stay editor-owned because the save flow and the
 * migration dialog write them.
 *
 * Callers pass the callbacks this effect consumes (`resetTransientCanvasState`,
 * `commitSnapshot`, `loadSuccess`/`loadFailure`, graph setters) following the
 * restore-seed hook's parameter convention; the call site must sit at the
 * original effect's position so hook order — and therefore effect order —
 * is unchanged.
 */
export type TopologyEditorLoadLifecycleDeps = {
  /** Reactive inputs the effect re-runs on (verbatim from the editor). */
  workspaceInstances: WorkspaceInstanceSeed[] | undefined;
  branchLocations: BranchLocationSeed[] | undefined;
  branchId: string | undefined;
  /** R1 (todo-topology-editor.md §5): the read is sessioned like the
   *  template reads — a null/undefined token is not skipped but SENT (as
   *  the empty string the editor's absent session degrades to), and the
   *  backend answers InvalidSession, which this effect already surfaces
   *  through its load-failure path. Pre-session canvases were the asymmetry
   *  the ruling ended, not a case to preserve. */
  sessionToken: string | null | undefined;
  reloadKey: number;
  /** Editor-owned skip guard, set before onSave and cleared by the reload paths. */
  skipNextLoadRef: MutableRefObject<boolean>;
  /** Editor-owned migration-dialog dismissal flag a fresh load re-arms. */
  migrationDismissedRef: MutableRefObject<boolean>;
  /** Live canvas mirrors the light-merge paths read without re-running the effect. */
  nodesRef: MutableRefObject<TopologyNodeData[]>;
  wiresRef: MutableRefObject<TopologyWireData[]>;
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  setHistory: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  setRedo: (value: SetStateAction<TopologyHistoryEntry<TopologyNodeData, TopologyWireData>[]>) => void;
  setResolvedIssues: Dispatch<SetStateAction<Set<string>>>;
  /** Transient resets the branch-location light-merge path runs when cards are removed. */
  cancelConnection: () => void;
  setHoveredTarget: Dispatch<SetStateAction<{ nodeId: string; port: PortName; variantIndex: number } | null>>;
  clearHover: () => void;
  commitSnapshot: (next: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Canvas-replacement transient reset (connection/hover/marquee/bend-drag/menu). */
  resetTransientCanvasState: () => void;
  loadSuccess: (revision: number) => void;
  loadFailure: () => void;
  onLoadSuccess?: (() => void) | undefined;
  onLoadError?: ((error: unknown) => void) | undefined;
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Only `getString` is needed for the load-error toast copy. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Grid snapping shared with the seed/merge builders (branch-sync convention). */
  snap: (value: number) => number;
};

/**
 * Run the authoritative load effect. Returns nothing — the canvas state is
 * owned by the editor's graph state and reached through the passed setters.
 */
export function useTopologyEditorLoadLifecycle(deps: TopologyEditorLoadLifecycleDeps): void {
  const {
    workspaceInstances,
    branchLocations,
    branchId,
    sessionToken,
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
  } = deps;

  /** Previous prop identities — a branchLocations-only change (profile
   *  renamed or added while the canvas holds in-flight edits) is a light
   *  merge into the live canvas, NEVER a rebuild from the saved diagram: a
   *  rebuild would silently discard unsaved drags and wires. Deletions are
   *  intentionally not handled here — the full path also keeps saved store
   *  nodes whose profile is gone. */
  const prevBranchLocationsRef = useRef<BranchLocationSeed[] | undefined>(branchLocations);
  const prevInstancesRef = useRef<WorkspaceInstanceSeed[] | undefined>(workspaceInstances);

  useEffect(() => {
    // Branch locations changed but workspace instances did not: the parent
    // renamed, added, or DELETED a store profile. Merge names into the
    // existing store nodes, seed any new locations, and drop the cards (and
    // wires) of deleted locations — a removed branch must leave the canvas
    // cleanly instead of stranding an orphaned card. Positions, history, and
    // every other in-flight edit stay untouched. The initial mount and
    // instance-driven reloads take the full rebuild path below.
    const prevLocations = prevBranchLocationsRef.current;
    const prevInstances = prevInstancesRef.current;
    prevBranchLocationsRef.current = branchLocations;
    prevInstancesRef.current = workspaceInstances;
    if (prevLocations !== branchLocations && prevInstances === workspaceInstances) {
      const synced = syncBranchLocations(
        nodesRef.current,
        wiresRef.current,
        branchLocations,
        prevLocations,
        snap,
      );
      setNodes(synced.nodes);
      // Wires to a removed branch card must go with it.
      setWires(synced.wires);
      if (synced.removedLocationIds.size > 0) {
        // A removed branch card may host an in-flight wire preview — cancel
        // it like the rebuild path does, so no stale preview can complete.
        cancelConnection();
        setHoveredTarget(null);
        // Removed branch cards may host a hover — clear it so the stale id
        // cannot dim the remaining canvas (mouseleave never fires on unmount).
        clearHover();
      }
      return;
    }
    // Workspace instances changed but the SET of instances is identical
    // (same ids, same order) — the parent refreshed names after a card
    // rename. Merge the new names into the live workspace nodes instead of
    // rebuilding (a rebuild would discard unsaved drags/wires). Structural
    // changes (create / archive / reorder) fall through to the full
    // authoritative rebuild below, and the post-Apply skip guard keeps
    // precedence so persisted-flag marking still runs.
    const instancesSameIds =
      prevInstances !== workspaceInstances
      && (prevInstances?.length ?? 0) === (workspaceInstances?.length ?? 0)
      && (prevInstances ?? []).every((i, idx) => (workspaceInstances?.[idx]?.instanceId ?? '') === i.instanceId);
    if (instancesSameIds && !skipNextLoadRef.current) {
      setNodes(syncWorkspaceInstanceNames(nodesRef.current, workspaceInstances ?? []));
      return;
    }
    let cancelled = false;
    loadTopology(sessionToken ?? '', branchId)
      .then((data) => {
        if (cancelled) return;
        onLoadSuccess?.();
        setResolvedIssues(new Set(data?.resolved_issue_keys ?? []));
        // Build a lookup of saved node positions/metadata (the diagram layer).
        const savedById = new Map<string, TopologyNodeData>();
        loadSuccess(data?.revision ?? 0);
        if (data && data.nodes) {
          for (const persistedNode of data.nodes) {
            const node = diagramNodeToCanvas(persistedNode);
            savedById.set(node.id, node);
          }
        }

        // When real workspace instances are supplied (or were — the parent
        // may have just deleted the last branch, wiping them to []), the
        // instance list is authoritative for which workspace nodes exist.
        // Restore positions from the saved diagram, but never resurrect a
        // workspace node that no longer maps to a live instance (that would
        // undo an archive). Non-workspace nodes (store/warehouse/hardware)
        // still come from the saved diagram. The initial mount passes EMPTY
        // arrays while the parent's lists load — those must fall through to
        // the saved-diagram/preset path below, or the canvas wipes to empty
        // (and a fresh install shows nothing at all) before the real seeds
        // arrive.
        const hadInstances = (workspaceInstances?.length ?? 0) > 0
          || (prevInstances?.length ?? 0) > 0
          || (branchLocations?.length ?? 0) > 0
          || (prevLocations?.length ?? 0) > 0;
        // The direct truthiness clause also narrows the type for TS — the
        // body uses workspaceInstances.map directly below.
        if (workspaceInstances && hadInstances) {
          if (cancelled) return;
          // Skip the full rebuild when our own save triggered this reload —
          // only update persisted flags, preserving in-flight canvas edits (#8).
          if (skipNextLoadRef.current) {
            setNodes((prev) =>
              prev.map((n) => {
                if (n.type === 'workspace') {
                  return { ...n, metadata: { ...n.metadata, persisted: true } };
                }
                return n;
              }),
            );
            return;
          }
          const mergedNodes = buildWorkspaceTopologyNodes(
            [...savedById.values()],
            workspaceInstances,
            branchLocations,
            snap,
          );
          const validIds = new Set(mergedNodes.map((n) => n.id));
          const loadedWires = buildLoadedTopologyWires(data?.wires ?? [], validIds);
          // Reset transient state BEFORE the loaded canvas lands — the
          // resets must never act on the replacement canvas (a cancelled
          // bend-drag, for example, would otherwise restore its old start
          // position over a freshly loaded bend).
          resetTransientCanvasState();
          // A fresh load re-offers the legacy-schema migration dialog even
          // if a previous load was dismissed with "Later".
          migrationDismissedRef.current = false;
          // A fresh authoritative load replaces the canvas — the undo/redo
          // stacks hold stale pre-reload states that contradict the loaded
          // instances. Clear them so Undo can never restore a phantom canvas.
          setHistory([]);
          setRedo([]);
          setNodes(mergedNodes);
          setWires(loadedWires);
          commitSnapshot({ nodes: mergedNodes, wires: loadedWires });
          return;
        }

        // An explicit unassigned branch owns an empty graph. This is distinct
        // from the initial loading state (where the parent omits seed props),
        // so a saved diagram from a previously selected branch cannot leak
        // into the unassigned canvas after the last branch is deleted.
        const unassignedGraph = branchId === 'unassigned'
          && workspaceInstances !== undefined
          && branchLocations !== undefined
          && workspaceInstances.length === 0
          && branchLocations.length === 0;
        if (unassignedGraph) {
          resetTransientCanvasState();
          setHistory([]);
          setRedo([]);
          setNodes([]);
          setWires([]);
          commitSnapshot({ nodes: [], wires: [] });
          return;
        }

        // No real instances/locations ever supplied — legacy/demo behaviour:
        // use the saved diagram verbatim, or fall back to the retail preset.
        if (cancelled || !data || !data.nodes || data.nodes.length === 0) {
          // No saved diagram. A standalone editor (seeds never supplied) keeps
          // the demo preset; a parent that EXPLICITLY supplied empty seeds
          // owns the graph — a fresh or fully-deleted store must show the
          // empty canvas (onboarding hint) rather than demo data.
          if (workspaceInstances !== undefined || branchLocations !== undefined) {
            setNodes([]);
            setWires([]);
            setHistory([]);
            setRedo([]);
            commitSnapshot({ nodes: [], wires: [] });
          }
          return;
        }
        if (skipNextLoadRef.current) { return; }
        // Reset transient state BEFORE the loaded canvas lands (see
        // resetTransientCanvasState).
        resetTransientCanvasState();
        // A fresh load re-offers the legacy-schema migration dialog even
        // if a previous load was dismissed with "Later".
        migrationDismissedRef.current = false;
        // Fresh authoritative load — drop stale pre-load undo/redo state.
        setHistory([]);
        setRedo([]);
        setNodes([...savedById.values()]);
        const loadedWires: TopologyWireData[] = data.wires.map(diagramWireToCanvas);
        setWires(loadedWires);
        commitSnapshot({ nodes: [...savedById.values()], wires: loadedWires });
      })
      .catch((err) => {
        // Only "no saved topology" (null result) is expected — that is
        // handled in the .then() above. Any thrown error (corrupt DB,
        // serialisation failure, etc.) should be surfaced to the user
        // rather than silently swallowed.
        if (cancelled) return;
        addToast({
          message: `${l10n.getString('topology-toast-load-error')}: ${plainErrorMessage(err)}`,
          type: 'error',
        });
        onLoadError?.(err);
        // An authoritative load failure moves the lifecycle to `load-error`
        // (Apply disabled) until a later load settles successfully.
        loadFailure();
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceInstances, branchLocations, branchId, sessionToken, reloadKey]);
}
