//! Add-node flow for the topology editor (Phase 5 slice P5-B/S6).
//!
//! Owns the single spawn path every creation route funnels through: the
//! strict-mode store refusal, the shared warehouse-cap gate, the placement
//! chain (snap -> jitter -> first collision-free spot -> clamp into the
//! visible viewport, panning to reveal a spot that had been panned away),
//! the workspace-label/subtitle resolution, the `persisted: false` seed
//! metadata, and the 400 ms fresh-node animation timer that the editor's
//! unmount sweep drains through freshTimersRef.
//!
//! The moved body is BYTE-IDENTICAL to the inline original, with ZERO
//! deviations: it was a plain arrow function, not a useCallback, so this
//! module declares no dep array at all (converting it is out of contract —
//! it would churn the memoized card layer), and react-hooks' exhaustive-deps
//! has nothing to demand. No suppression comments were added or needed.
//!
//! `handleAddNodeRef.current = handleAddNode` stays in the editor body: the
//! keydown effect is declared ABOVE this function precisely because a direct
//! dep would hit the TDZ, and the ref mirror is what keeps that working. The
//! call site sits at the slot the arrow occupied, and because neither the
//! moved code nor this hook registers a React hook, the component's hook
//! order — and therefore its effect order — is literally untouched.

import type { MutableRefObject, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/frontend/shared/Toast';
import {
  clampNodeToViewport,
  findFreeSpawnSpot,
  NODE_WIDTH,
  NODE_HEIGHT,
} from './nodeTopologyClamp';
import { workspaceTypeLabel, topologyUiString } from './topologyCard';
import type { NodeType, TopologyNodeData, WorkspaceTypeKey } from './nodeTopologyEditorTypes';

export interface TopologyAddNodeDeps {
  /** Strict mode has no storeProfileId for a palette-spawned store, so the
   *  store spawn is refused outright. */
  allowLegacyApply: boolean;
  /** The one warehouse-cap gate every creation path shares (parent-owned, so
   *  Ctrl+D / Ctrl+V / Alt-drag cannot bypass it either). */
  wouldExceedWarehouseCap: (extra: number) => boolean;
  /** Cap-refusal toast. */
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Only `getString` is needed — for the refusal, name, subtitle and status
   *  copy (also handed to topologyUiString, which asks for the same slice). */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** One undo entry per spawn, before any state write. */
  pushHistory: () => void;
  /** Grid-aware placement — identity while the snap toggle is off. */
  snapOrNot: (v: number) => number;
  /** Current nodes, for the collision-free spawn search. */
  nodes: TopologyNodeData[];
  /** Canvas element providing the clientWidth/Height the clamp needs. */
  canvasRef: React.RefObject<HTMLDivElement>;
  /** Viewport pan / zoom, shared with every other canvas transform. */
  pan: { x: number; y: number };
  zoom: number;
  /** Reveal-pan setter for a natural spot that sat outside the view. */
  setPan: (value: SetStateAction<{ x: number; y: number }>) => void;
  /** Node graph setter: the insert itself. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  /** Fresh-node (scale-in) set — armed here, drained by the timer below. */
  setFreshNodeIds: (value: SetStateAction<Set<string>>) => void;
  /** Animation timers, parent-owned so the unmount sweep can clear them. */
  freshTimersRef: MutableRefObject<Set<ReturnType<typeof setTimeout>>>;
  /** Selection reducer: the new node becomes the sole selection. */
  selectOnly: (id: string) => void;
}

/**
 * The spawn handler, with the same per-render identity the inline original
 * had (a fresh closure every render — nothing memoizes it, by design).
 */
export function useTopologyEditorAddNode(deps: TopologyAddNodeDeps): {
  handleAddNode: (type: NodeType, at?: { x: number; y: number }, workspaceTypeKey?: WorkspaceTypeKey) => void;
} {
  const {
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
  } = deps;

  const handleAddNode = (
    type: NodeType,
    at?: { x: number; y: number },
    workspaceTypeKey: WorkspaceTypeKey = 'store-pos',
  ) => {
    // Strict mode (the real topology screen) builds the branch card from
    // the authoritative branchLocations list — a palette-spawned store has
    // no storeProfileId and nothing can attach one, so it could never be
    // applied. Refuse the spawn there; the palette slot, context-menu
    // entry, and the 1-slot shortcut are hidden too.
    if (type === 'store' && !allowLegacyApply) return;
    if (type === 'warehouse' && wouldExceedWarehouseCap(1)) {
      addToast({ message: l10n.getString('topology-toast-multi-warehouse'), type: 'warning' });
      return;
    }
    pushHistory();

    const id = `${type}-${crypto.randomUUID()}`;
    // Placement: a context-menu spawn honors the cursor; a palette spawn
    // jitters near the origin then settles into the first collision-free
    // spot (the old jitter box sat entirely inside the preset branch card,
    // so palette spawns stacked invisibly on top of it). Both are clamped
    // into the visible viewport so a node can never land off-canvas, and a
    // palette spot that was outside the view (panned/zoomed away) pans the
    // viewport so the fresh node is revealed instead of silently invisible.
    const raw = at
      ? { x: snapOrNot(at.x), y: snapOrNot(at.y) }
      : { x: snapOrNot(200 + Math.random() * 100), y: snapOrNot(150 + Math.random() * 100) };
    const free = at ? raw : findFreeSpawnSpot(raw, nodes.map((n) => ({ x: n.x, y: n.y })));
    const canvas = canvasRef.current;
    const canvasW = canvas?.clientWidth ?? 0;
    const canvasH = canvas?.clientHeight ?? 0;
    const placed = clampNodeToViewport(free.x, free.y, {
      panX: pan.x,
      panY: pan.y,
      zoom,
      canvasW,
      canvasH,
    });
    if (!at && canvasW > 0 && canvasH > 0
      && (placed.x !== free.x || placed.y !== free.y)) {
      // The natural palette spot was off-view — pan to reveal the node
      // (mirrors the node-finder jump).
      setPan({
        x: canvasW / 2 - (placed.x + NODE_WIDTH / 2) * zoom,
        y: canvasH / 2 - (placed.y + NODE_HEIGHT / 2) * zoom,
      });
    }
    const newNode: TopologyNodeData = {
      id,
      type,
      name: type === 'workspace'
        ? workspaceTypeLabel(workspaceTypeKey, (id, vars) => topologyUiString(l10n, id, vars ?? null))
        : l10n.getString(`topology-new-${type}`),
      subtitle: type === 'workspace'
        ? l10n.getString('topology-new-workspace-subtitle')
        : l10n.getString(`topology-new-${type}-subtitle`),
      x: placed.x,
      y: placed.y,
      telemetryBadge: l10n.getString('topology-new-ready'),
      telemetryStatus: 'online',
      // New workspace nodes default to the retail POS type until the user
      // picks another in the inspector. `persisted: false` marks it as not
      // yet backed by a workspace_instances row so onSave will create it.
      ...(type === 'workspace' ? { metadata: { typeKey: workspaceTypeKey, purposeKey: 'general', persisted: false } } : {}),
    };

    setNodes((prev) => [...prev, newNode]);
    setFreshNodeIds((prev) => new Set(prev).add(id));
    // Remove from fresh set after animation completes
    const freshTimer = setTimeout(() => {
      setFreshNodeIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      freshTimersRef.current.delete(freshTimer);
    }, 400);
    freshTimersRef.current.add(freshTimer);
    selectOnly(id);
  };

  return { handleAddNode };
}
