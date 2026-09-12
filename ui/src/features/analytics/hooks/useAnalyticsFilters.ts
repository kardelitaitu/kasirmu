//! Analytics filter, view and zoom state.
//!
//! Extracted from `AnalyticsScreen.tsx` (R37 analytics-query split). The
//! screen owns layout, popovers and drag-and-drop; this hook owns the
//! selections that decide *what* the screen queries — workspace view,
//! granularity, the custom range, and the zoom level.
//!
//! Two storage keys live here and are pinned by
//! `src/__tests__/storageKeyPins.test.ts`, which asserts that the module the
//! registry names really declares the literal. Moving either key again means
//! updating that registry in the same commit.

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getPrimaryLocationScoped } from '@/api/locations';
import { isoDaysAgo, isoToday } from '../analytics-data';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  type Granularity,
  type WorkspaceView,
} from '../utils/dateRangePresets';

/** localStorage key for the last-chosen workspace view (retail/restaurant). */
const WORKSPACE_VIEW_STORAGE_KEY = 'oz-analytics-workspace-view';

/** localStorage key for the persisted grid zoom level. */
const ZOOM_STORAGE_KEY = 'oz-analytics-zoom';

export interface UseAnalyticsFiltersArgs {
  /** Session token. The store-timezone fetch is skipped while it is null. */
  sessionToken: string | null;
  /** Active workspace instance — only `type_key` is read, for the default view. */
  activeInstance: { type_key?: string | null } | null;
}

export interface AnalyticsFilters {
  workspaceView: WorkspaceView;
  setWorkspaceView: Dispatch<SetStateAction<WorkspaceView>>;
  granularity: Granularity;
  setGranularity: Dispatch<SetStateAction<Granularity>>;
  customFrom: string;
  setCustomFrom: Dispatch<SetStateAction<string>>;
  customTo: string;
  setCustomTo: Dispatch<SetStateAction<string>>;
  /** Set once the user edits the range, so the store-tz re-seed stops. */
  customTouched: MutableRefObject<boolean>;
  /** Primary store timezone; null until the profile loads. */
  storeTz: string | null;
  zoomLevel: number;
  setZoomLevel: Dispatch<SetStateAction<number>>;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Resets zoom to 1. The toast stays with the caller, which owns `l10n`. */
  resetZoom: () => void;
  /** Set the custom range to the last `days` days, ending on the store's today. */
  applyRangePreset: (days: number) => void;
}

export function useAnalyticsFilters({
  sessionToken,
  activeInstance,
}: UseAnalyticsFiltersArgs): AnalyticsFilters {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() => {
    // Reopen on the last-chosen view across sessions; fall back to the
    // workspace type the user was last in, then retail.
    const saved = localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY);
    if (saved === 'retail' || saved === 'restaurant') return saved;
    return activeInstance?.type_key === 'restaurant-pos' ? 'restaurant' : 'retail';
  });

  // Keep the stored preference in sync — covers the selector, the command
  // palette, and any future path that changes the view.
  useEffect(() => {
    localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, workspaceView);
  }, [workspaceView]);

  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [customFrom, setCustomFrom] = useState(isoToday());
  const [customTo, setCustomTo] = useState(isoToday());
  // REP-03: derived windows anchor to the PRIMARY STORE's calendar day,
  // not the device's — a laptop in another region must still see "today"
  // as the store sees it. Until the profile loads (or if the fetch fails)
  // the anchor is FALLBACK_STORE_TZ in analytics-data (UTC, the schema's own
  // column default), never the host zone — see the comment there.
  const [storeTz, setStoreTz] = useState<string | null>(null);
  const customTouched = useRef(false);
  useEffect(() => {
    if (!sessionToken) return;
    let alive = true;
    getPrimaryLocationScoped(sessionToken)
      .then((p) => {
        if (alive) setStoreTz(p?.timezone ?? null);
      })
      .catch(() => {
        /* storeTz stays null, so isoToday/isoDaysAgo use FALLBACK_STORE_TZ */
      });
    return () => {
      alive = false;
    };
  }, [sessionToken]);
  useEffect(() => {
    // Re-seed the untouched custom defaults once the store day is known.
    if (!storeTz || customTouched.current) return;
    const t = isoToday(storeTz);
    setCustomFrom(t);
    setCustomTo(t);
  }, [storeTz]);

  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
    return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 1;
  });

  const zoomIn = useCallback(() => setZoomLevel((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoomLevel((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const resetZoom = useCallback(() => setZoomLevel(1), []);

  // Persist zoom across sessions
  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomLevel));
    } catch {
      /* storage unavailable */
    }
  }, [zoomLevel]);

  const applyRangePreset = useCallback((days: number) => {
    customTouched.current = true;
    // REP-03: presets end on the store's today, not the device's.
    setCustomTo(isoDaysAgo(0, storeTz));
    setCustomFrom(isoDaysAgo(days - 1, storeTz));
  }, [storeTz]);

  return {
    workspaceView,
    setWorkspaceView,
    granularity,
    setGranularity,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    customTouched,
    storeTz,
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    applyRangePreset,
  };
}
