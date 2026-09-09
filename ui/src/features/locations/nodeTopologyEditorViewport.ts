//! Viewport machinery for the topology editor (Phase 3.5a + 3.5b-1 + 3.5b-2).
//!
//! Owns the pieces of the canvas that decide WHERE you are looking, not WHAT is
//! on it: the debounced per-diagram viewport persist (a 250ms trailing write,
//! flushed once more on unmount so a branch switch never drops the last pan),
//! minimap visibility (per-diagram, same key scheme), the two viewport helpers
//! the minimap drives (center / nudge), and the zoom cluster (fit the diagram,
//! fit the selection, step the zoom, reset to the Branch Location anchor).
//!
//! What deliberately did NOT move, and why:
//! - `viewKey`, `savedView`, the `zoom`/`pan` state slots and
//!   `restoredViewRef` stay parent-side. `savedView` is a lazy `useState`
//!   initializer feeding the parent's own zoom/pan slots, so it has to run
//!   BEFORE this call, and `restoredViewRef` is read only by the auto-fit
//!   effect. `viewKey` arrives through deps rather than being recomputed here:
//!   one literal, one owner.
//! - The zoom/pan STATE stays parent-side and arrives through deps. Both have
//!   many consumers outside this machinery — the pointer hook's deps, the touch
//!   hook's deps, the zoom popover, the wire-label transforms — so hoisting
//!   them here would invert ownership the gesture hooks already rely on.
//! - The auto-fit effect stays parent-side: it reads `userInteractedRef`,
//!   declared well below this call, and its `autoFitKeyRef` guard is consumed
//!   only AFTER the measured-canvas check. Either move would change WHEN a fit
//!   is allowed to fire.
//! - `useTopologyEditorViewPrefs` (slice 3.5b-2) is the SECOND export here and
//!   owns the routing / snap / wire-labels prefs, each with its legacy
//!   per-install fallback literal. Those three pinned literals moved with their
//!   readers, which re-attributed their owner in storageKeyPins.test.ts — that
//!   gate's deliberate, itemized co-edit, committed in the same change.
//!
//! Bodies, comments and dependency arrays are verbatim line-slices of the
//! inline originals in NodeTopologyEditor.tsx. The call site sits at the exact
//! position of the original view-persist block, so hook order — and therefore
//! effect order — is what the component already had.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, SetStateAction } from 'react';
import type { TopologyNodeData } from './NodeTopologyEditor';
import { NODE_WIDTH } from './nodeTopologyClamp';
import { nodeHeight } from './topologyMetrics';

export interface TopologyViewportDeps {
  /** Diagram identity — keys the per-diagram minimap preference. Undefined
   *  while no branch is selected, where the key falls back to 'unassigned'. */
  branchId: string | undefined;
  /** Per-branch viewport key, computed parent-side (it also seeds the restore
   *  read there) and carried inside the persist record. */
  viewKey: string;
  /** Live viewport zoom — the centering math and the persisted value. */
  zoom: number;
  /** Live viewport pan — the nudged value and the persisted value. */
  pan: { x: number; y: number };
  /** Viewport zoom setter — every zoom path writes through it. */
  setZoom: (value: SetStateAction<number>) => void;
  /** Viewport pan setter — centering, nudging, fitting and resetting use it. */
  setPan: (value: SetStateAction<{ x: number; y: number }>) => void;
  /** Live canvas element — its clientWidth/clientHeight ARE the viewport for
   *  every fit calculation and for centering. */
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  /** Current nodes — the bounds source for fit-to-diagram and reset-to-anchor. */
  nodes: TopologyNodeData[];
  /** Current multi-selection — the bounds source for fit-to-selection. */
  selectedNodeIds: Set<string>;
}

export function useTopologyEditorViewport(deps: TopologyViewportDeps) {
  const {
    branchId,
    viewKey,
    zoom,
    pan,
    setZoom,
    setPan,
    canvasRef,
    nodes,
    selectedNodeIds,
  } = deps;

  /** Debounced viewport persist. Pan/zoom update at pointer-move rate, and a
   *  synchronous localStorage write per frame can jank the canvas — flush the
   *  latest value 250ms after the last change (and once more on unmount). */
  const viewPersistRef = useRef<{ viewKey: string; zoom: number; pan: { x: number; y: number } } | null>(null);
  const viewPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistViewport = useCallback(() => {
    const v = viewPersistRef.current;
    if (!v) return;
    try {
      localStorage.setItem(v.viewKey, JSON.stringify({ zoom: v.zoom, pan: v.pan }));
    } catch { /* storage may be unavailable (private mode) — view pref only */ }
  }, []);

  useEffect(() => {
    viewPersistRef.current = { viewKey, zoom, pan };
    if (viewPersistTimerRef.current) clearTimeout(viewPersistTimerRef.current);
    viewPersistTimerRef.current = setTimeout(persistViewport, 250);
  }, [viewKey, zoom, pan, persistViewport]);

  // Flush any pending viewport persist on unmount so a branch switch never
  // drops the last 250ms of panning.
  useEffect(() => () => {
    if (viewPersistTimerRef.current) clearTimeout(viewPersistTimerRef.current);
    persistViewport();
  }, [persistViewport]);

  /** Minimap visibility per diagram (branch) — mirrors the viewport memory's
   *  per-branch key scheme so a branch switch (which remounts the editor)
   *  restores the user's hide/show choice for that diagram instead of
   *  resetting to a global default. 'unassigned' mirrors the viewport key's
   *  fallback for diagrams with no selected branch. */
  const minimapKey = `oz-topology-view-minimap:${branchId ?? 'unassigned'}`;
  const [minimapVisible, setMinimapVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(minimapKey) !== '0';
    } catch { /* storage unavailable or corrupted — default visible */ }
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem(minimapKey, minimapVisible ? '1' : '0');
    } catch { /* storage may be unavailable (private mode) — view pref only */ }
  }, [minimapKey, minimapVisible]);

  /** Center the viewport on a canvas point — the minimap's recenter/Enter
   *  action. Reads the live canvas size so the centering math uses the
   *  current viewport dimensions. */
  const centerViewportOn = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current;
    const cw = canvas?.clientWidth ?? 0;
    const ch = canvas?.clientHeight ?? 0;
    setPan({ x: cw / 2 - cx * zoom, y: ch / 2 - cy * zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original; canvasRef arrives through the deps object.
  }, [zoom, setPan]);

  /** Nudge the viewport by a canvas-space delta — the minimap's arrows. */
  const nudgeViewport = useCallback((dx: number, dy: number) => {
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, [setPan]);

  /** Fit the whole diagram into the viewport (clamped 40%..200%). */
  const zoomToFit = useCallback(() => {
    if (nodes.length === 0) return;
    const minX = nodes.reduce((acc, n) => Math.min(acc, n.x), Infinity);
    const minY = nodes.reduce((acc, n) => Math.min(acc, n.y), Infinity);
    const maxX = nodes.reduce((acc, n) => Math.max(acc, n.x + NODE_WIDTH), -Infinity);
    const maxY = nodes.reduce((acc, n) => Math.max(acc, n.y + nodeHeight(n)), -Infinity);
    // Guard against degenerate bounding box with zero or negative dimensions
    if (!isFinite(minX) || !isFinite(maxX) || maxX <= minX || maxY <= minY) return;
    const padding = 60;
    const viewW = (canvasRef.current?.clientWidth ?? 800) - padding * 2;
    const viewH = (canvasRef.current?.clientHeight ?? 600) - padding * 2;
    const fitZoom = Math.min(
      Math.min(viewW / Math.max(maxX - minX, 1), viewH / Math.max(maxY - minY, 1)),
      1.5,
    );
    // The pan must be computed at the CLAMPED zoom that is actually
    // applied — using the raw fitZoom (e.g. 0.26 for a diagram spanning
    // ~2.5 viewports) centers the view at a different scale than the
    // transform uses, so the fit lands off-center by |minX|·(0.4−fitZoom).
    const appliedZoom = Math.max(0.4, Math.min(2.0, fitZoom));
    setZoom(appliedZoom);
    setPan({ x: padding - minX * appliedZoom, y: padding - minY * appliedZoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original; canvasRef/setZoom/setPan arrive through the deps object.
  }, [nodes]);

  /** Fit the current multi-selection — same bounds math as zoomToFit but
   *  scoped to the selected nodes (context menu action). */
  const zoomToSelection = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const sel = nodes.filter((n) => selectedNodeIds.has(n.id));
    if (sel.length === 0) return;
    const minX = Math.min(...sel.map((n) => n.x));
    const minY = Math.min(...sel.map((n) => n.y));
    const maxX = Math.max(...sel.map((n) => n.x + NODE_WIDTH));
    const maxY = Math.max(...sel.map((n) => n.y + nodeHeight(n)));
    if (!isFinite(minX) || !isFinite(maxX) || maxX <= minX || maxY <= minY) return;
    const padding = 60;
    const viewW = (canvasRef.current?.clientWidth ?? 800) - padding * 2;
    const viewH = (canvasRef.current?.clientHeight ?? 600) - padding * 2;
    const fitZoom = Math.min(
      Math.min(viewW / Math.max(maxX - minX, 1), viewH / Math.max(maxY - minY, 1)),
      1.5,
    );
    // Same clamp-consistency rule as zoomToFit: pan at the applied zoom,
    // not the raw fitZoom.
    const appliedZoom = Math.max(0.4, Math.min(2.0, fitZoom));
    setZoom(appliedZoom);
    setPan({ x: padding - minX * appliedZoom, y: padding - minY * appliedZoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original; canvasRef/setZoom/setPan arrive through the deps object.
  }, [nodes, selectedNodeIds]);

  /** Step the zoom by a factor, clamped to the same 40%..200% range the
   *  wheel uses — the floating − / + buttons share one code path. */
  const zoomBy = useCallback((factor: number) => {
    setZoom((prev) => Math.min(2.0, Math.max(0.4, prev * factor)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original; setZoom arrives through the deps object.
  }, []);

  /** Reset the view: 100% zoom, pan so the Branch Location node sits at
   *  the top-left of the visible canvas (with a fixed margin). That way
   *  the location anchor is always in view after a reset, regardless of
   *  where the user has panned. Falls back to the identity transform when
   *  no Branch Location exists. */
  const resetView = useCallback(() => {
    const storeNode = nodes.find((n) => n.type === 'store');
    const margin = 60;
    setZoom(1);
    setPan(storeNode
      ? { x: margin - storeNode.x, y: margin - storeNode.y }
      : { x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dep array kept byte-identical to the inline original; setZoom/setPan arrive through the deps object.
  }, [nodes]);

  return {
    /** The zoom cluster the central keydown effect and the zoom popover consume. */
    zoomToFit,
    zoomToSelection,
    zoomBy,
    resetView,
    /** Minimap drivers: the toolbar's visibility toggle and the minimap's own pan controls. */
    minimapVisible,
    setMinimapVisible,
    centerViewportOn,
    nudgeViewport,
  };
}

export interface TopologyViewPrefsDeps {
  /** Diagram identity — keys all three per-diagram preferences. Undefined
   *  while no branch is selected, where each key falls back to 'unassigned'. */
  branchId: string | undefined;
}

/** The three View-rack preferences that survive a reload: wire routing style,
 *  grid snapping, and the wire-label pills — all keyed per diagram (branch) on
 *  the same scheme as the viewport memory and the minimap.
 *
 *  Each preference's legacy per-install fallback READ and its per-branch
 *  write-back effect are one closed set: the read inherits the old global value
 *  exactly once when the diagram has no stored choice yet, and the write then
 *  migrates it to the branch key. The pairs move together or the migration
 *  breaks, which is why all three live here rather than being split.
 *
 *  The three legacy literals are pinned in storageKeyPins.test.ts; relocating
 *  them here moved their owner attribution in the same commit. */
export function useTopologyEditorViewPrefs(deps: TopologyViewPrefsDeps) {
  const { branchId } = deps;

  /** Wire routing style: smooth cubic beziers (default) or orthogonal
   *  elbow segments. Persisted per diagram (branch) in localStorage — the
   *  same key scheme as the viewport memory and minimap — so each diagram
   *  keeps its own routing across branch switches and reloads. A legacy
   *  per-install value is inherited once when no per-diagram choice exists
   *  yet (the write-back effect then migrates it to the branch key). */
  const routingKey = `oz-topology-view-routing:${branchId ?? 'unassigned'}`;
  const [wireRouting, setWireRouting] = useState<'curved' | 'elbow'>(() => {
    try {
      const saved = localStorage.getItem(routingKey);
      const value = saved ?? localStorage.getItem('oz-topology-view-routing');
      return value === 'elbow' ? 'elbow' : 'curved';
    } catch {
      return 'curved';
    }
  });
  const snapKey = `oz-topology-view-snap:${branchId ?? 'unassigned'}`;
  /** Snap interactive placement (drag/nudge/spawn) to the 24px grid.
   *  Persisted per branch alongside the routing preference; a legacy
   *  per-install value is inherited once when no per-branch choice exists. */
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(snapKey);
      const value = saved ?? localStorage.getItem('oz-topology-view-snap');
      return value !== '0';
    } catch {
      return true;
    }
  });
  /** Wire label pills: optional permanent labels at each wire's midpoint
   *  (clicking one opens the round-20 rename editor). Persisted with the
   *  other view prefs; default off to keep the current clean look. */
  const wireLabelsKey = `oz-topology-view-wire-labels:${branchId ?? 'unassigned'}`;
  const [wireLabelsVisible, setWireLabelsVisible] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(wireLabelsKey);
      const value = saved ?? localStorage.getItem('oz-topology-view-wire-labels');
      return value === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(wireLabelsKey, wireLabelsVisible ? '1' : '0');
    } catch { /* storage may be unavailable (private mode) — view pref only */ }
  }, [wireLabelsKey, wireLabelsVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(routingKey, wireRouting);
    } catch { /* storage may be unavailable (private mode) — view pref only */ }
  }, [routingKey, wireRouting]);

  useEffect(() => {
    try {
      localStorage.setItem(snapKey, snapEnabled ? '1' : '0');
    } catch { /* storage may be unavailable (private mode) — view pref only */ }
  }, [snapKey, snapEnabled]);

  return {
    /** Elbow/curved choice — every wire-geometry path, the auto-layout, and the
     *  View rack's routing toggle. */
    wireRouting,
    setWireRouting,
    /** Grid-snap toggle — read by `snapOrNot`, the nudge/drag paths and the rack. */
    snapEnabled,
    setSnapEnabled,
    /** Midpoint label pills — the label layer and the rack's labels toggle. */
    wireLabelsVisible,
    setWireLabelsVisible,
  };
}
