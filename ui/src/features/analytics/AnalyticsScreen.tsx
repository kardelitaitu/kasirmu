//! Analytics Screen — layout shell with three flex areas.
//!
//! Top:    back button + title
//! Menu:   workspace selector (row 1) + time granularity buttons (row 2)
//!         + inline custom date range
//! Main:   smart card grid — cards adapt to retail vs restaurant

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { createPortal } from 'react-dom';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getPrimaryLocationScoped } from '@/api/locations';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import { useInvalidSession } from '@/hooks/useInvalidSession';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import TierLockedFeature from '@/components/TierLockedFeature';
import { minorUnitExponent } from '@/types/domain';
import { downloadCsv } from '@/utils/export-csv';
import { AnalyticsCardContent, ExportCsvButton } from './AnalyticsCardContent';
import { analyticsDataCache, clearAnalyticsCache, cardQueryKey } from './analytics-cache';
import { useToastManager } from './useToastManager';
import { useCardLayout } from './useCardLayout';
import { useCommandPalette } from './useCommandPalette';
import { AnalyticsHeatmap } from './AnalyticsHeatmap';
import {
  CARD_PAYLOAD_VALIDATORS,
  DAY_LABEL_KEYS,
  buildHeatmapCells,
  heatPeak,
  heatmapGranularityForRange,
  isoDaysAgo,
  isoToday,
  loadHeatmapRows,
  rangeForGranularity,
  yearlyHeatmapColumns,
  type DailyRevenueRow,
  type HeatCell,
  type HourlyHeatmapRow,
  type WeeklyRevenueRow,
} from './analytics-data';
import { clearAnalyticsErrors, useAnalyticsQuery } from './useAnalyticsQuery';
import './AnalyticsScreen.css';

export type WorkspaceView = 'retail' | 'restaurant';
export type Granularity = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

// Re-export the calendar helper so the analytics test suite can import it
// from the screen module (the heatmap card owns its own copy of the helper
// via analytics-data; this keeps the existing test import working).
export { monthCalendarGrid } from './analytics-data';

// `daily` was removed from the selector: every card mapped it to `weekly`,
// so the two buttons rendered identical data. A short custom range still
// auto-buckets as daily (see bucketGranularity), but the selector no longer
// offers daily as a global view.
/**
 * The granularities the selector actually renders — the domain for the
 * `analytics-granularity-${g}` template-built message ids.
 *
 * Exported so `dynamicFluentFamilies.test.ts` can assert every one resolves
 * in BOTH bundles. Note this is deliberately narrower than the `Granularity`
 * union, which also admits `'daily'`: that value reaches
 * `rangeForGranularity()` and the query cache but no selector button, so
 * `analytics-granularity-daily` does not exist. Adding `'daily'` to this
 * array without adding the key would render a blank button label — a
 * template-built id is invisible to scripts/verify-bundle-parity.py, so this
 * array plus that test is the only guard.
 */
export const GRANULARITIES: Granularity[] = ['weekly', 'monthly', 'yearly', 'custom'];

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const ZOOM_STEP = 0.2;

/** localStorage key for the last-chosen workspace view (retail/restaurant). */
const WORKSPACE_VIEW_STORAGE_KEY = 'oz-analytics-workspace-view';

/** Keyboard shortcut metadata — drives both the handler and the help popover. */
const SHORTCUTS: { keys: string; labelKey: string }[] = [
  { keys: '1–4',    labelKey: 'analytics-shortcuts-granularity' },
  { keys: 'R',      labelKey: 'analytics-shortcuts-refresh' },
  { keys: '+ / −',  labelKey: 'analytics-shortcuts-zoom' },
  { keys: '0',      labelKey: 'analytics-shortcuts-zoom-reset' },
  { keys: 'C',      labelKey: 'analytics-shortcuts-collapse' },
  { keys: 'Esc',    labelKey: 'analytics-shortcuts-close' },
];

/**
 * Only one card may be expanded at a time.
 * - clicking the expanded card restores it (`current` → `null`)
 * - expanding when nothing is open sets the new card (`null` → `cid`)
 * - expanding another card while one is open is ignored
 */
export const nextExpandedKey = (current: string | null, cid: string): string | null => {
  if (current === cid) return null;
  if (current === null) return cid;
  return current;
}

/**
 * Scale factor that enlarges `content` to fill `available` without
 * overflowing either axis, capped at `max`. Returns 1 when the sizes
 * are unknown (e.g. layout not yet measured).
 */
export const smartScale = (
  available: { w: number; h: number },
  content: { w: number; h: number },
  max = 4,
): number => {
  if (available.w <= 0 || available.h <= 0 || content.w <= 0 || content.h <= 0) return 1;
  return Math.max(1, Math.min(max, Math.min(available.w / content.w, available.h / content.h)));
}

/**
 * Effective granularity for a card after applying its per-card remap.
 * Cards default to respecting the global selector; a card with a
 * `granularityMap` entry for the current granularity overrides it (e.g.
 * mapping `daily` to `weekly` when a card has no daily layout).
 */
export const cardGranularity = (
  card: { granularityMap?: Partial<Record<Granularity, Granularity>> },
  g: Granularity,
): Granularity => {
  return card.granularityMap?.[g] ?? g;
}

/**
 * Date range for a card, derived from its *effective* granularity (after
 * the per-card remap) so a card that remaps e.g. weekly → monthly also
 * gets the matching window instead of the global selector's window.
 */
export const cardRange = (
  card: { granularityMap?: Partial<Record<Granularity, Granularity>> },
  g: Granularity,
  customFrom: string,
  customTo: string,
  storeTz?: string | null,
): { from: string; to: string } => {
  // A custom range is user-selected — never let a granularity remap
  // replace it with a derived window (a card that derives its grid from the
  // custom span still queries the chosen dates).
  if (g === 'custom') return { from: customFrom, to: customTo };
  return rangeForGranularity(cardGranularity(card, g), customFrom, customTo, storeTz);
}

/** Number of days in the current month (28–31). */
export const daysInCurrentMonth = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/**
 * Download the heatmap's underlying revenue rows as CSV, shaped by the
 * card's effective granularity: the 7×24 hourly grid for weekly, one row
 * per calendar day for monthly, and one row per Monday-week for yearly.
 */
function exportHeatmapCsv(
  g: Granularity,
  data: { daily: DailyRevenueRow[]; hourly: HourlyHeatmapRow[]; weekly: WeeklyRevenueRow[] },
  from: string,
  to: string,
  fmt: (minor: number) => string,
  getString: (id: string) => string,
) {
  const dayLabels = DAY_LABEL_KEYS.map((k) => getString(k));
  const filename = `heatmap-${from}-to-${to}.csv`;
  // The backend emits one daily/weekly revenue row per currency — sum per
  // bucket so a multi-currency day/week exports as one combined row, the
  // same normalization the intensity builders already apply.
  if (g === 'monthly') {
    const byDate = new Map<string, { minor: number; orders: number }>();
    for (const r of data.daily) {
      const e = byDate.get(r.date) ?? { minor: 0, orders: 0 };
      e.minor += r.total_minor;
      e.orders += r.sale_count;
      byDate.set(r.date, e);
    }
    downloadCsv(
      filename,
      [
        { key: 'date', label: getString('analytics-export-col-date') },
        { key: 'sales', label: getString('analytics-export-col-sales') },
        { key: 'orders', label: getString('analytics-export-col-orders') },
      ],
      [...byDate.entries()].map(([date, e]) => ({ date, sales: fmt(e.minor), orders: String(e.orders) })),
    );
    return;
  }
  if (g === 'yearly') {
    const byWeek = new Map<string, { minor: number; orders: number }>();
    for (const r of data.weekly) {
      const e = byWeek.get(r.week_start) ?? { minor: 0, orders: 0 };
      e.minor += r.total_minor;
      e.orders += r.sale_count;
      byWeek.set(r.week_start, e);
    }
    downloadCsv(
      filename,
      [
        { key: 'week', label: getString('analytics-export-col-week') },
        { key: 'sales', label: getString('analytics-export-col-sales') },
        { key: 'orders', label: getString('analytics-export-col-orders') },
      ],
      [...byWeek.entries()].map(([week, e]) => ({ week, sales: fmt(e.minor), orders: String(e.orders) })),
    );
    return;
  }
  // weekly (and daily/custom, which remap to weekly): the 7×24 hourly grid.
  downloadCsv(
    filename,
    [
      { key: 'day', label: getString('analytics-export-col-day') },
      { key: 'hour', label: getString('analytics-export-col-hour') },
      { key: 'sales', label: getString('analytics-export-col-sales') },
      { key: 'orders', label: getString('analytics-export-col-orders') },
    ],
    data.hourly.map((r) => ({
      day: dayLabels[(r.day_of_week + 6) % 7] ?? String(r.day_of_week),
      hour: String(r.hour).padStart(2, '0'),
      sales: fmt(r.total_minor),
      orders: String(r.sale_count),
    })),
  );
}

/**
 * Short, stable label for a cache key in the debug readout:
 * `card:revenue:retail:daily:...` → `revenue`, `query:retail:daily:...` → `query`.
 */
function shortCacheLabel(key: string): string {
  const parts = key.split(':');
  if (parts[0] === 'card' && parts[1]) return parts[1]!;
  return parts[0] ?? key;
}

// ── Card definitions ─────────────────────────────────────────────────

export interface AnalyticsCard {
  key: string;
  /** `null` = appears in both workspaces */
  workspace: WorkspaceView | null;
  /** Fluent message id for the title */
  titleKey: string;
  /** English fallback shown when the Fluent key is missing */
  title: string;
  /** Fluent message id for the one-line description (info tooltip) */
  descKey: string;
  /** `wide` = span 2 columns; `full` = span all columns; default = single */
  size?: 'wide' | 'full';
  /** Optional per-card granularity remap: override specific global
      granularities for this card (e.g. the heatmap maps daily → weekly).
      Unmapped granularities follow the selector. */
  granularityMap?: Partial<Record<Granularity, Granularity>>;
}

const ANALYTICS_CARDS: AnalyticsCard[] = [
  // 2×1 wide heatmap — custom ranges derive their grid from the span
  // (see heatmapGranularityForRange), not a fixed weekly remap.
  { key: 'heatmap',   workspace: null,         titleKey: 'analytics-card-heatmap', title: 'Heat Map', descKey: 'analytics-card-desc-heatmap', size: 'wide' },
  // Shared (both retail and restaurant)
  { key: 'revenue',   workspace: null,         titleKey: 'analytics-card-revenue',    title: 'Revenue Overview', descKey: 'analytics-card-desc-revenue' },
  { key: 'aov',       workspace: null,         titleKey: 'analytics-card-aov',        title: 'Average Order Value', descKey: 'analytics-card-desc-aov' },
  { key: 'staff',     workspace: null,         titleKey: 'analytics-card-staff',      title: 'Staff Performance', descKey: 'analytics-card-desc-staff' },
  { key: 'customers', workspace: null,         titleKey: 'analytics-card-customers',  title: 'New vs Returning Customers', descKey: 'analytics-card-desc-customers' },
  { key: 'payments',  workspace: null,         titleKey: 'analytics-card-payments',   title: 'Payment Methods', descKey: 'analytics-card-desc-payments' },
  { key: 'discounts', workspace: null,         titleKey: 'analytics-card-discounts',  title: 'Discounts & Promotions', descKey: 'analytics-card-desc-discounts' },
  { key: 'refunds',   workspace: null,         titleKey: 'analytics-card-refunds',    title: 'Refunds & Voids', descKey: 'analytics-card-desc-refunds' },
  // Retail-only
  { key: 'top-items', workspace: 'retail',     titleKey: 'analytics-card-top-products', title: 'Top Products', descKey: 'analytics-card-desc-top-products' },
  { key: 'category',  workspace: 'retail',     titleKey: 'analytics-card-category',   title: 'Sales by Category', descKey: 'analytics-card-desc-category' },
  { key: 'basket',    workspace: 'retail',     titleKey: 'analytics-card-basket',     title: 'Average Basket Size', descKey: 'analytics-card-desc-basket' },
  { key: 'inventory', workspace: 'retail',     titleKey: 'analytics-card-inventory',  title: 'Stock Turnover', descKey: 'analytics-card-desc-inventory' },
  { key: 'low-stock', workspace: 'retail',     titleKey: 'analytics-card-low-stock',  title: 'Low Stock Alerts', descKey: 'analytics-card-desc-low-stock', size: 'wide' },
  // Restaurant-only
  { key: 'top-items', workspace: 'restaurant', titleKey: 'analytics-card-top-menu',   title: 'Top Menu Items', descKey: 'analytics-card-desc-top-menu' },
  { key: 'tables',    workspace: 'restaurant', titleKey: 'analytics-card-tables',     title: 'Table Turnover', descKey: 'analytics-card-desc-tables' },
  { key: 'occupancy', workspace: 'restaurant', titleKey: 'analytics-card-occupancy',  title: 'Table Occupancy', descKey: 'analytics-card-desc-occupancy' },
  { key: 'waitstaff', workspace: 'restaurant', titleKey: 'analytics-card-waitstaff',  title: 'Top Waitstaff', descKey: 'analytics-card-desc-waitstaff' },
  { key: 'voids',     workspace: 'restaurant', titleKey: 'analytics-card-voids',      title: 'Voided Items', descKey: 'analytics-card-desc-voids' },
];

// ── Component ─────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const { l10n } = useLocalization();
  const { currency } = useCurrency();
  // C2.2: Analytics is a Pro+ feature — caps arrive from the subscription
  // context and gate the screen below.
  const { caps } = useSubscription();
  const exp = minorUnitExponent(currency);
  // Number formatting follows the active Fluent locale, matching the other
  // analytics cards' money formatter (never a hardcoded English locale).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const fmt = (minor: number) =>
    new Intl.NumberFormat(numLocale, { style: 'currency', currency, maximumFractionDigits: exp }).format(minor / 10 ** exp);
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { sessionToken, availableWorkspaces, activeInstance } = useWorkspace();
  // Keep the session alive while this dashboard is open (ping every 10 min).
  useSessionKeepalive(sessionToken || '');
  // Detect InvalidSession from any IPC command and show a recovery banner.
  const showSessionBanner = useInvalidSession();
  const { toasts, showToast } = useToastManager();
  const {
    paletteOpen,
    paletteQuery,
    paletteIndex,
    paletteInputRef,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteIndex,
    filteredItemsRef,
    runItemRef,
  } = useCommandPalette<PaletteItem>();

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

  // Label the selector with the real workspace names ("Store POS" /
  // "Restaurant POS") from the workspace registry; fall back to the
  // localized type label when the registry hasn't loaded or the test
  // stub has no instances.
  const workspaceLabel = (view: WorkspaceView): string => {
    const typeKey = view === 'retail' ? 'store-pos' : 'restaurant-pos';
    const inst = availableWorkspaces.find((w) => w.type_key === typeKey);
    if (inst?.name) return inst.name;
    return l10n.getString(
      view === 'retail' ? 'analytics-workspace-retail' : 'analytics-workspace-restaurant',
    );
  };
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
    const saved = Number(localStorage.getItem('oz-analytics-zoom'));
    return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 1;
  });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandScale, setExpandScale] = useState(1);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [menuCardId, setMenuCardId] = useState<string | null>(null);
  /** Viewport anchor for the portaled per-card options menu. */
  const [menuAnchor, setMenuAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const [zoomPopover, setZoomPopover] = useState(false);
  const [showCacheMetrics, setShowCacheMetrics] = useState(false);
  const [compare, setCompare] = useState(false);
  const [, setMetricsTick] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [, setRecalcTick] = useState(0);
  const expandedBodyRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const cardMenuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastMenuAnchorRef = useRef<{ bottom: number; right: number } | null>(null);
  const zoomPopoverRef = useRef<HTMLDivElement | null>(null);
  const shortcutsPopoverRef = useRef<HTMLDivElement | null>(null);
  const cachePopoverRef = useRef<HTMLDivElement | null>(null);
  const zoomBadgeRef = useRef<HTMLButtonElement | null>(null);
  const shortcutsButtonRef = useRef<HTMLButtonElement | null>(null);
  const cacheChipRef = useRef<HTMLButtonElement | null>(null);

  // Date ranges are derived per card from its effective granularity via
  // cardRange, so a card that remaps granularity gets the matching window
  // (custom ranges are always preserved verbatim).

  /**
   * Kick off a recalculation. `force` (refresh button / R key) always
   * refetches; otherwise an identical query still fresh in the TTL cache
   * renders instantly — switching granularity or workspace back and
   * forth does not refetch identical queries.
   *
   * There is no artificial delay: cards show their own loading skeleton
   * while their IPC query actually resolves, and the heatmap shows its
   * skeleton while its query is in flight. The tick just re-renders the
   * grid so cards re-evaluate their (possibly now-cleared) queries.
   */
  const startRecalculating = useRef<(force?: boolean) => void>();
  startRecalculating.current = (force = false) => {
    if (force) {
      // Refresh also wipes the cached payloads so the data actually
      // recomputes; the TTL-bounded cache refills on the next render.
      clearAnalyticsCache();
    }
    // Every recalc is a fresh navigation: forget recorded failures so a
    // query that failed earlier retries when revisited (refresh also
    // wipes the cache itself). The per-key failure guard still stops a
    // re-render retry loop; only re-navigating (filter change) retries.
    clearAnalyticsErrors();
    setRecalcTick((n) => n + 1);
  };

  // Recalculate when filters change
  useEffect(() => {
    startRecalculating.current?.();
  }, [workspaceView, granularity, customFrom, customTo]);

  const zoomIn = useCallback(() => setZoomLevel((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoomLevel((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => {
    setZoomLevel(1);
    showToast(l10n.getString('analytics-toast-zoom-reset'));
  }, [showToast, l10n]);

  // Live refresh of the debug cache-metrics readout while it is open.
  useEffect(() => {
    if (!showCacheMetrics) return;
    const id = setInterval(() => setMetricsTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [showCacheMetrics]);

  // Persist zoom across sessions
  useEffect(() => {
    try {
      localStorage.setItem('oz-analytics-zoom', String(zoomLevel));
    } catch {
      /* storage unavailable */
    }
  }, [zoomLevel]);

  // Keyboard shortcuts (ignored while typing in form fields)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (paletteOpen) return;
      const k = e.key;
      if (k >= '1' && k <= '4') {
        setGranularity(GRANULARITIES[Number(k) - 1]!);
      } else if (k === 'r' || k === 'R') {
        startRecalculating.current?.(true);
      } else if (k === '+') {
        zoomIn();
      } else if (k === '-' || k === '_') {
        zoomOut();
      } else if (k === '0') {
        zoomReset();
      } else if (k === 'c' || k === 'C') {
        setAllCollapsed((c) => !c);
      } else if (k === 'Escape') {
        setExpandedKey(null);
        setShowShortcuts(false);
        setShowCacheMetrics(false);
        setMenuCardId(null);
        setZoomPopover(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, zoomReset, paletteOpen]);

  // Smart scaling: when a card is expanded, scale its content to fill the
  // available body area (works for any card — heatmap, table, or chart).
  useEffect(() => {
    if (!expandedKey) {
      setExpandScale(1);
      return;
    }
    const body = expandedBodyRef.current;
    const content = body?.querySelector<HTMLElement>('.analytics-card-content');
    if (!body || !content) return;
    setExpandScale(smartScale(
      { w: body.clientWidth, h: body.clientHeight },
      { w: content.offsetWidth, h: content.offsetHeight },
    ));
  }, [expandedKey, granularity, workspaceView]);

  // Filter cards visible for the current workspace
  const visibleCards = ANALYTICS_CARDS.filter(
    (c) => c.workspace === null || c.workspace === workspaceView,
  );

  const cardId = useCallback((c: AnalyticsCard) => `${c.key}-${c.workspace ?? 'shared'}`, []);

  const {
    cardOrder,
    collapsedCards,
    toggleCardCollapsed,
    reorderCard,
    moveCard,
    resetLayout,
    isDefaultOrder,
  } = useCardLayout(
    workspaceView,
    cardId,
    ANALYTICS_CARDS,
    showToast,
    l10n.getString('analytics-toast-layout-saved'),
    l10n.getString('analytics-toast-layout-reset'),
  );

  /** Close the per-card options menu and restore focus to its trigger. */
  const closeCardMenu = useCallback(() => {
    setMenuCardId(null);
    menuTriggerRef.current?.focus();
  }, []);

  // Focus the first enabled menuitem when a card menu opens (the menu is
  // portaled to document.body, so it never inherits focus from the trigger).
  useEffect(() => {
    if (!menuCardId) return;
    const first = cardMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [menuCardId]);

  // Re-anchor the portaled menu to its trigger's live viewport position. The
  // anchor is captured at open time as a fixed position, so without this the
  // menu drifts away from its card whenever the grid scrolls or the viewport
  // resizes while it is open.
  const repositionCardMenu = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const bottom = rect.bottom;
    const right = window.innerWidth - rect.right;
    const last = lastMenuAnchorRef.current;
    if (last && Math.abs(last.bottom - bottom) < 0.5 && Math.abs(last.right - right) < 0.5) return;
    lastMenuAnchorRef.current = { bottom, right };
    setMenuAnchor({ bottom, right });
  }, []);

  useEffect(() => {
    if (!menuCardId) return;
    // Scroll events don't bubble, so capture-phase listening catches the
    // grid's own scroll (and any other scroller) without wiring each one up.
    window.addEventListener('scroll', repositionCardMenu, true);
    window.addEventListener('resize', repositionCardMenu);
    return () => {
      window.removeEventListener('scroll', repositionCardMenu, true);
      window.removeEventListener('resize', repositionCardMenu);
    };
  }, [menuCardId, repositionCardMenu]);

  // Close the toolbar popovers (zoom / shortcuts / cache) when the user
  // clicks or taps outside them — the same behaviour the per-card options
  // menu already gets via its backdrop.
  useEffect(() => {
    if (!zoomPopover && !showShortcuts && !showCacheMetrics) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const insidePopover =
        zoomPopoverRef.current?.contains(target) ||
        shortcutsPopoverRef.current?.contains(target) ||
        cachePopoverRef.current?.contains(target);
      // Clicks on a toggle button are handled by its own onClick, which
      // flips the state — treat them as "inside" so we don't close-then-
      // reopen in the same gesture.
      const onToggle =
        zoomBadgeRef.current?.contains(target) ||
        shortcutsButtonRef.current?.contains(target) ||
        cacheChipRef.current?.contains(target);
      if (insidePopover || onToggle) return;
      setZoomPopover(false);
      setShowShortcuts(false);
      setShowCacheMetrics(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [zoomPopover, showShortcuts, showCacheMetrics]);

  // Throttle the grid's scroll handler to one state commit per animation
  // frame — raw scroll events otherwise re-render the whole screen (and
  // every card's query hook) many times per frame.
  const handleMainScroll = (e: UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setShowScrollTop(el.scrollTop > 240);
      const max = el.scrollHeight - el.clientHeight;
      setScrollProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
    });
  };

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // ── Command palette (Ctrl/Cmd+K) ──────────────────────────────

  type PaletteItem =
    | { kind: 'workspace'; value: WorkspaceView; label: string; hint: string }
    | { kind: 'granularity'; value: Granularity; label: string; hint: string }
    | { kind: 'action'; value: 'collapse' | 'expand' | 'reset-zoom' | 'reset-layout' | 'home' | 'shortcuts'; label: string; hint: string };

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { kind: 'workspace', value: 'retail', label: l10n.getString('analytics-workspace-retail'), hint: '' },
      { kind: 'workspace', value: 'restaurant', label: l10n.getString('analytics-workspace-restaurant'), hint: '' },
    ];
    GRANULARITIES.forEach((g, i) => {
      items.push({ kind: 'granularity', value: g, label: l10n.getString(`analytics-granularity-${g}`), hint: String(i + 1) });
    });
    items.push(
      { kind: 'action', value: 'collapse', label: l10n.getString('analytics-action-collapse-all-aria'), hint: 'C' },
      { kind: 'action', value: 'expand', label: l10n.getString('analytics-action-expand-all-aria'), hint: 'C' },
      { kind: 'action', value: 'reset-zoom', label: l10n.getString('analytics-action-zoom-reset-aria'), hint: '0' },
      { kind: 'action', value: 'reset-layout', label: l10n.getString('analytics-reset-layout'), hint: '' },
      { kind: 'action', value: 'shortcuts', label: l10n.getString('analytics-shortcuts-title'), hint: '?' },
      { kind: 'action', value: 'home', label: l10n.getString('analytics-palette-home'), hint: '' },
    );
    return items;
  }, [l10n]);

  const q = paletteQuery.trim().toLowerCase();
  const filteredItems = q ? paletteItems.filter((it) => it.label.toLowerCase().includes(q)) : paletteItems;

  const runPaletteItem = (item: PaletteItem) => {
    if (item.kind === 'workspace') {
      setWorkspaceView(item.value);
      setGranularity('weekly');
      setExpandedKey(null);
    } else if (item.kind === 'granularity') {
      setGranularity(item.value);
    } else {
      switch (item.value) {
        case 'collapse': setAllCollapsed(true); break;
        case 'expand': setAllCollapsed(false); break;
        case 'reset-zoom': zoomReset(); break;
        case 'reset-layout': resetLayout(); break;
        case 'home': goToWorkspacePicker(); break;
        case 'shortcuts': setShowShortcuts(true); break;
      }
    }
    setPaletteOpen(false);
    setPaletteQuery('');
  };

  // Feed the hook's refs each render — the keydown listener stays mounted
  // once and always reads the latest filtered list + run action.
  filteredItemsRef.current = filteredItems;
  runItemRef.current = runPaletteItem;

  const applyRangePreset = (days: number) => {
    customTouched.current = true;
    // REP-03: presets end on the store's today, not the device's.
    setCustomTo(isoDaysAgo(0, storeTz));
    setCustomFrom(isoDaysAgo(days - 1, storeTz));
  };

  // When a card is expanded, only it is shown; otherwise all visible cards
  const displayedCards = expandedKey && visibleCards.some((c) => cardId(c) === expandedKey)
    ? visibleCards.filter((c) => cardId(c) === expandedKey)
    : visibleCards;

  // Apply the user's saved order (falling back to the default when empty)
  const orderedCards = [...displayedCards].sort(
    (a, b) => cardOrder.indexOf(cardId(a)) - cardOrder.indexOf(cardId(b)),
  );

  // Smart heatmap — bucket cells change with the selected granularity.
  // Monthly renders one cell per day of the queried month (28–31); yearly
  // renders one column per month in the query range (4–5 Monday weeks
  // each); weekly renders the dense 7×24 grid. Intensities come from real
  // revenue rows via the TTL cache. A custom range derives its grid from the
  // span: a single calendar month → monthly, a long range → yearly columns.
  const heatmapCard = ANALYTICS_CARDS.find((c) => c.key === 'heatmap')!;
  const heatmapRange = cardRange(heatmapCard, granularity, customFrom, customTo, storeTz);
  const heatmapGranularity = heatmapGranularityForRange(granularity, heatmapRange.from, heatmapRange.to);
  const heatmapQuery = useAnalyticsQuery(
    cardQueryKey('heatmap', workspaceView, heatmapGranularity, heatmapRange.from, heatmapRange.to),
    () => loadHeatmapRows({ workspace: workspaceView, granularity: heatmapGranularity, from: heatmapRange.from, to: heatmapRange.to, sessionToken: sessionToken ?? '' }),
    true,
    CARD_PAYLOAD_VALIDATORS['heatmap'],
  );
  const heatmapData = heatmapQuery.data;
  const heatCells = heatmapData
    ? buildHeatmapCells(heatmapGranularity, heatmapData)
    : new Map<string, HeatCell>();
  const peakKey = heatmapData ? heatPeak(heatCells)?.key ?? null : null;
  // Yearly columns are range-derived and shared by the grid and the peak label.
  const heatmapColumns = heatmapGranularity === 'yearly'
    ? yearlyHeatmapColumns(heatmapRange.from, heatmapRange.to)
    : [];
  const multiYear = heatmapColumns.length > 0
    && heatmapColumns[0]!.key.slice(0, 4) !== heatmapColumns[heatmapColumns.length - 1]!.key.slice(0, 4);
  // The grid renders zero-filled even for an empty range, so flag a truly
  // empty query to show the same no-data placeholder as the other cards.
  const heatmapEmpty = heatmapData
    ? heatmapGranularity === 'monthly'
      ? heatmapData.daily.length === 0
      : heatmapGranularity === 'yearly'
        ? heatmapData.weekly.length === 0
        : heatmapData.hourly.length === 0
    : false;


  // C2.2: Analytics tab lock (Plus→Pro trigger) — render a locked screen
  // with a blurred sample chart + upgrade CTA instead of the live cards.
  if (caps && !caps.supportsAnalytics) {
    return (
      <div className="analytics">
        <TierLockedFeature
          titleKey="analytics-upgrade-required"
          messageKey="analytics-upgrade-message"
          ctaKey="analytics-upgrade-cta"
          target="pro"
        >
          <div className="analytics-locked-sample" aria-hidden="true">
            <span style={{ height: '32%' }} />
            <span style={{ height: '58%' }} />
            <span style={{ height: '44%' }} />
            <span style={{ height: '76%' }} />
            <span style={{ height: '52%' }} />
            <span style={{ height: '88%' }} />
            <span style={{ height: '64%' }} />
          </div>
        </TierLockedFeature>
      </div>
    );
  }

  return (
    <div className="analytics" role="region" aria-label={l10n.getString('analytics-region-aria')}>

      {/* ══════════════════════════════════════════════════════════
          AREA 1 — Top: back button + title
          ══════════════════════════════════════════════════════════ */}
      <header className="analytics-topbar">
        <button
          type="button"
          className="analytics-back-btn"
          onClick={goToWorkspacePicker}
          aria-label={l10n.getString('analytics-back-aria')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            width="18" height="18" aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <div className="analytics-title-group">
          <Localized id="analytics-title">
            <h1 className="analytics-title">Analytics</h1>
          </Localized>
          <Localized id="analytics-subtitle">
            <p className="analytics-subtitle">Sales, products, and staff performance</p>
          </Localized>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          AREA 2 — Menu: workspace selector + granularity buttons
          ══════════════════════════════════════════════════════════ */}
      <nav className="analytics-menu">
        {/* Row 1 — workspace selector */}
        <div className="analytics-menu-row">
          <select
            className="analytics-workspace-select-input"
            value={workspaceView}
            onChange={(e) => {
              setWorkspaceView(e.target.value as WorkspaceView);
              setGranularity('weekly');
              setExpandedKey(null);
            }}
            aria-label={l10n.getString('analytics-workspace-select-aria')}
          >
            <option value="retail">{workspaceLabel('retail')}</option>
            <option value="restaurant">{workspaceLabel('restaurant')}</option>
          </select>
        </div>

        {/* Row 2 — granularity pill buttons + custom date range inline */}
        <div className="analytics-menu-row">
          <div
            className="analytics-granularity"
            role="radiogroup"
            aria-label={l10n.getString('analytics-granularity-aria')}
          >
            {GRANULARITIES.map((g) => (
              <button
                key={g}
                type="button"
                className={`analytics-granularity-btn${granularity === g ? ' analytics-granularity-btn--active' : ''}`}
                onClick={() => setGranularity(g)}
                role="radio"
                aria-checked={granularity === g}
                title={`${l10n.getString(`analytics-granularity-${g}`)} (${GRANULARITIES.indexOf(g) + 1})`}
              >
                <Localized id={`analytics-granularity-${g}`}>
                  <span>{g}</span>
                </Localized>
              </button>
            ))}
          </div>

          {granularity === 'custom' && (
            <>
              <div className="analytics-custom-range">
                <label className="analytics-custom-field">
                  <Localized id="analytics-custom-from">
                    <span className="analytics-custom-label">From</span>
                  </Localized>
                  <input
                    type="date"
                    className="analytics-custom-input"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => {
                  customTouched.current = true;
                  setCustomFrom(e.target.value);
                }}
                    aria-label={l10n.getString('analytics-custom-from')}
                  />
                </label>
                <span className="analytics-custom-sep">—</span>
                <label className="analytics-custom-field">
                  <Localized id="analytics-custom-to">
                    <span className="analytics-custom-label">To</span>
                  </Localized>
                  <input
                    type="date"
                    className="analytics-custom-input"
                    value={customTo}
                    min={customFrom}
                    onChange={(e) => {
                      customTouched.current = true;
                      setCustomTo(e.target.value);
                    }}
                    aria-label={l10n.getString('analytics-custom-to')}
                  />
                </label>
              </div>
              <div className="analytics-custom-presets" role="group" aria-label={l10n.getString('analytics-range-presets-aria')}>
                {[7, 30, 90, 365].map((days) => (
                  <button
                    key={days}
                    type="button"
                    className="analytics-preset-chip"
                    onClick={() => applyRangePreset(days)}
                    aria-label={l10n.getString(`analytics-range-preset-${days}d`)}
                  >
                    {l10n.getString(`analytics-range-preset-${days}d`)}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Action buttons — collapse, refresh, zoom out, zoom in */}
          <div className="analytics-actions">
            <button
              type="button"
              className={`analytics-action-btn${compare ? ' analytics-action-btn--active' : ''}`}
              onClick={() => {
                const next = !compare;
                setCompare(next);
                showToast(l10n.getString(next ? 'analytics-toast-compare-on' : 'analytics-toast-compare-off'));
              }}
              aria-pressed={compare}
              aria-label={l10n.getString(compare ? 'analytics-compare-off-aria' : 'analytics-compare-on-aria')}
              title={l10n.getString(compare ? 'analytics-compare-off-aria' : 'analytics-compare-on-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <path d="M3 7h13" />
                <path d="M3 12h9" />
                <path d="M3 17h5" />
                <polyline points="18 4 22 8 18 12" />
                <polyline points="14 12 18 16 14 20" />
              </svg>
            </button>
            <button
              type="button"
              className={`analytics-action-btn${allCollapsed ? ' analytics-action-btn--active' : ''}`}
              onClick={() => {
                const next = !allCollapsed;
                setAllCollapsed(next);
                showToast(l10n.getString(next ? 'analytics-toast-collapsed' : 'analytics-toast-expanded'));
                // Collapsing all while a card is expanded would otherwise
                // leave the grid showing only that card — restore the grid
                // so the toggle visibly does what its label promises.
                if (next) setExpandedKey(null);
              }}
              aria-label={l10n.getString(allCollapsed ? 'analytics-action-expand-all-aria' : 'analytics-action-collapse-all-aria')}
              title={l10n.getString(allCollapsed ? 'analytics-action-expand-all-aria' : 'analytics-action-collapse-all-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                {allCollapsed ? (
                  <>
                    <path d="M4 14h16" />
                    <path d="M4 18h16" />
                    <path d="M4 6l4 4 4-4" />
                  </>
                ) : (
                  <>
                    <path d="M4 6h16" />
                    <path d="M4 10h16" />
                    <path d="M4 14l4 4 4-4" />
                  </>
                )}
              </svg>
            </button>
            <button
              type="button"
              className="analytics-action-btn"
              onClick={() => {
                startRecalculating.current?.(true);
                showToast(l10n.getString('analytics-toast-refreshing'));
              }}
              aria-label={l10n.getString('analytics-action-refresh-aria')}
              title={l10n.getString('analytics-action-refresh-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button
              type="button"
              className="analytics-action-btn"
              onClick={zoomOut}
              disabled={zoomLevel <= ZOOM_MIN}
              aria-label={l10n.getString('analytics-action-zoom-out-aria')}
              title={l10n.getString('analytics-action-zoom-out-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button
              type="button"
              ref={zoomBadgeRef}
              className="analytics-zoom-badge"
              onClick={() => setZoomPopover((o) => !o)}
              aria-label={l10n.getString('analytics-zoom-slider-aria')}
              title={l10n.getString('analytics-zoom-slider-aria')}
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            {zoomPopover && (
              <div ref={zoomPopoverRef} className="analytics-zoom-popover" role="dialog" aria-label={l10n.getString('analytics-zoom-slider-aria')}>
                <input
                  type="range"
                  className="analytics-zoom-slider"
                  min={ZOOM_MIN * 100}
                  max={ZOOM_MAX * 100}
                  step={ZOOM_STEP * 100}
                  value={Math.round(zoomLevel * 100)}
                  onChange={(e) => setZoomLevel(Number(e.target.value) / 100)}
                  aria-label={l10n.getString('analytics-zoom-slider-aria')}
                />
                <span className="analytics-zoom-popover-value">{Math.round(zoomLevel * 100)}%</span>
                <button
                  type="button"
                  className="analytics-zoom-reset-btn"
                  onClick={zoomReset}
                >
                  {l10n.getString('analytics-action-zoom-reset-aria')}
                </button>
              </div>
            )}
            <button
              type="button"
              className="analytics-action-btn"
              onClick={zoomIn}
              disabled={zoomLevel >= ZOOM_MAX}
              aria-label={l10n.getString('analytics-action-zoom-in-aria')}
              title={l10n.getString('analytics-action-zoom-in-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button
              type="button"
              ref={shortcutsButtonRef}
              className="analytics-action-btn"
              onClick={() => setShowShortcuts((s) => !s)}
              aria-label={l10n.getString('analytics-shortcuts-aria')}
              title={l10n.getString('analytics-shortcuts-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>

            {showShortcuts && (
              <div ref={shortcutsPopoverRef} className="analytics-shortcuts-popover" role="dialog" aria-label={l10n.getString('analytics-shortcuts-title')}>
                <h3 className="analytics-shortcuts-title">{l10n.getString('analytics-shortcuts-title')}</h3>
                <ul className="analytics-shortcuts-list">
                  {SHORTCUTS.map((s) => (
                    <li key={s.labelKey} className="analytics-shortcuts-item">
                      <kbd className="analytics-shortcuts-keys">{s.keys}</kbd>
                      <span>{l10n.getString(s.labelKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Scroll progress — flush against the menu's bottom edge, tracks
          the main area's scroll position (no gap, no own spacing) */}
      <div className="analytics-scroll-progress" style={{ width: `${scrollProgress * 100}%` }} aria-hidden="true" />

      {/* Session-expired recovery banner — replaces the wall of per-card
          "session has expired" errors with one actionable notice. */}
      {showSessionBanner && (
        <div
          className="analytics-session-banner"
          role="alert"
          data-testid="analytics-session-banner"
        >
          <svg
            className="analytics-session-banner-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="analytics-session-banner-body">
            <div className="analytics-session-banner-title">
              <Localized id="analytics-session-expired-title"><span>Session expired</span></Localized>
            </div>
            <div className="analytics-session-banner-message">
              <Localized id="analytics-session-expired-message"><span>Your session has expired. Sign in again.</span></Localized>
            </div>
          </div>
          <button
            type="button"
            className="analytics-session-banner-action"
            onClick={goToWorkspacePicker}
            aria-label={l10n.getString('analytics-sign-in-again')}
          >
            <Localized id="analytics-sign-in-again"><span>Sign in again</span></Localized>
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          AREA 3 — Main content: smart analytics card grid
          ══════════════════════════════════════════════════════════ */}
      <main
        className="analytics-main"
        ref={mainRef}
        onScroll={handleMainScroll}
      >
        {/* No workspace selected — show actionable prompt */}
        {!sessionToken && (
          <div className="analytics-no-workspace" role="status">
            <svg
              className="analytics-no-workspace-icon"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <h2 className="analytics-no-workspace-title">
              <Localized id="analytics-no-workspace-title"><span>No workspace selected</span></Localized>
            </h2>
            <p className="analytics-no-workspace-message">
              <Localized id="analytics-no-workspace-message"><span>Select a workspace to view analytics</span></Localized>
            </p>
            <button
              type="button"
              className="analytics-no-workspace-action"
              onClick={goToWorkspacePicker}
            >
              <Localized id="analytics-select-workspace"><span>Select workspace</span></Localized>
            </button>
          </div>
        )}

        {/* View status — card count + workspace + time view */}
        {sessionToken && (<div className="analytics-status">
          <span className="analytics-status-item">
            <Localized id="analytics-status-cards" vars={{ count: String(displayedCards.length) }}>
              <span>{displayedCards.length} cards</span>
            </Localized>
          </span>
          <span className="analytics-status-sep" aria-hidden="true">·</span>
          <span className="analytics-status-item">
            {l10n.getString(workspaceView === 'retail' ? 'analytics-workspace-retail' : 'analytics-workspace-restaurant')}
            <span className="analytics-status-sep" aria-hidden="true">·</span>
            {l10n.getString(`analytics-granularity-${granularity}`)}
          </span>
          {granularity === 'custom' && (
            <>
              <span className="analytics-status-sep" aria-hidden="true">·</span>
              <span className="analytics-status-item">
                <Localized id="analytics-status-range" vars={{ from: customFrom, to: customTo }}>
                  <span>{customFrom} – {customTo}</span>
                </Localized>
              </span>
            </>
          )}
          {!isDefaultOrder && (
            <button
              type="button"
              className="analytics-reset-layout"
              onClick={resetLayout}
            >
              <Localized id="analytics-reset-layout"><span>Reset layout</span></Localized>
            </button>
          )}

          {/* Debug: TTL cache hit/miss/expiry readout per query key */}
          <div className="analytics-cache-metrics">
            <button
              type="button"
              ref={cacheChipRef}
              className={`analytics-cache-chip${showCacheMetrics ? ' analytics-cache-chip--open' : ''}`}
              onClick={() => setShowCacheMetrics((o) => !o)}
              aria-expanded={showCacheMetrics}
              aria-label={l10n.getString('analytics-cache-metrics-aria')}
              title={l10n.getString('analytics-cache-metrics-aria')}
            >
              <span className="analytics-cache-chip-dot" aria-hidden="true" />
              <Localized id="analytics-cache-chip"><span>cache</span></Localized>
              <span className="analytics-cache-chip-rate">
                {(() => {
                  const { totals } = analyticsDataCache.metrics();
                  return totals.hitRate === null ? '–' : `${Math.round(totals.hitRate * 100)}%`;
                })()}
              </span>
            </button>
            {showCacheMetrics && (
              <div ref={cachePopoverRef} className="analytics-cache-popover" role="dialog" aria-label={l10n.getString('analytics-cache-metrics-aria')}>
                <div className="analytics-cache-popover-head">
                  <div className="analytics-cache-popover-meta">
                    <h3 className="analytics-cache-popover-title">
                      <Localized id="analytics-cache-popover-title"><span>Cache metrics</span></Localized>
                    </h3>
                    {(() => {
                      const { totals } = analyticsDataCache.metrics();
                      const rate = totals.hitRate === null ? '–' : `${Math.round(totals.hitRate * 100)}%`;
                      return (
                        <span className="analytics-cache-popover-summary">
                          <Localized
                            id="analytics-cache-summary"
                            vars={{
                              rate,
                              hits: String(totals.hits),
                              misses: String(totals.misses),
                              expiries: String(totals.expiries),
                            }}
                          >
                            <span>{rate} · {totals.hits} hits · {totals.misses} misses · {totals.expiries} expired</span>
                          </Localized>
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    className="analytics-cache-clear-btn"
                    onClick={() => {
                      clearAnalyticsCache();
                      setMetricsTick((t) => t + 1);
                      showToast(l10n.getString('analytics-toast-cache-cleared'));
                    }}
                    aria-label={l10n.getString('analytics-cache-clear-aria')}
                    title={l10n.getString('analytics-cache-clear-aria')}
                  >
                    <Localized id="analytics-cache-clear"><span>Clear cache</span></Localized>
                  </button>
                </div>
                <table className="analytics-cache-table">
                  <thead>
                    <tr>
                      <th><Localized id="analytics-cache-col-key"><span>key</span></Localized></th>
                      <th><Localized id="analytics-cache-col-hits"><span>hits</span></Localized></th>
                      <th><Localized id="analytics-cache-col-misses"><span>misses</span></Localized></th>
                      <th><Localized id="analytics-cache-col-expiries"><span>expired</span></Localized></th>
                      <th><Localized id="analytics-cache-col-evictions"><span>evicted</span></Localized></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const { perKey } = analyticsDataCache.metrics();
                      const rows = [...perKey.entries()].sort((a, b) => {
                        const readsB = b[1].hits + b[1].misses + b[1].expiries;
                        const readsA = a[1].hits + a[1].misses + a[1].expiries;
                        return readsB - readsA;
                      });
                      if (rows.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className="analytics-cache-empty">
                              <Localized id="analytics-cache-empty"><span>No queries yet</span></Localized>
                            </td>
                          </tr>
                        );
                      }
                      return rows.map(([key, m]) => (
                        <tr key={key} title={key}>
                          <td className="analytics-cache-key">{shortCacheLabel(key)}</td>
                          <td>{m.hits}</td>
                          <td>{m.misses}</td>
                          <td>{m.expiries}</td>
                          <td>{m.evictions}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        )}

        <div className="analytics-grid" style={{ zoom: zoomLevel }}>
          {orderedCards.map((card) => {
            const cid = cardId(card);
            const cardG = cardGranularity(card, granularity);
            const cardWindow = cardRange(card, granularity, customFrom, customTo, storeTz);
            const isExpanded = expandedKey === cid;
            const isCollapsed = !isExpanded && (allCollapsed || collapsedCards.has(cid));
            const isDragging = dragId === cid;
            const isDropTarget = overId === cid;
            const menuOpen = menuCardId === cid;
            const idx = cardOrder.indexOf(cid);
            const isFirst = idx === 0;
            const isLast = idx === cardOrder.length - 1;
            return (
            <div
              key={cid}
              role="group"
              draggable={!isExpanded}
              aria-labelledby={`analytics-card-title-${cid}`}
              onDragStart={(e) => {
                setDragId(cid);
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox refuses to begin a drag without setData.
                  e.dataTransfer.setData('text/plain', cid);
                }
              }}
              onDragOver={(e) => { e.preventDefault(); if (overId !== cid) setOverId(cid); }}
              onDragLeave={() => setOverId((o) => (o === cid ? null : o))}
              onDrop={(e) => { e.preventDefault(); reorderCard(dragId ?? '', cid); setDragId(null); setOverId(null); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={`analytics-card${card.size ? ` analytics-card--${card.size}` : ''}${isExpanded ? ' analytics-card--expanded' : ''}${isCollapsed ? ' analytics-card--collapsed' : ''}${isDragging ? ' analytics-card--dragging' : ''}${isDropTarget ? ' analytics-card--drop-target' : ''}`}
            >
              <div className="analytics-card-header">
                <span className="analytics-card-grip" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                    <circle cx="9" cy="5" r="1.4" /><circle cx="15" cy="5" r="1.4" />
                    <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
                    <circle cx="9" cy="19" r="1.4" /><circle cx="15" cy="19" r="1.4" />
                  </svg>
                </span>
                <Localized id={card.titleKey}>
                  <h2 className="analytics-card-title" id={`analytics-card-title-${cid}`}>{card.title}</h2>
                </Localized>
                <div className="analytics-card-actions">
                  {card.key === 'heatmap' && heatmapData && (
                    <ExportCsvButton
                      ariaLabel={l10n.getString('analytics-export-heatmap-aria')}
                      onClick={() => exportHeatmapCsv(heatmapGranularity, heatmapData, heatmapRange.from, heatmapRange.to, fmt, (id) => l10n.getString(id))}
                    />
                  )}
                  <button
                    type="button"
                    className="analytics-card-action analytics-card-info"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={l10n.getString(card.descKey)}
                    title={l10n.getString(card.descKey)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="analytics-card-action"
                    onClick={() => setExpandedKey((current) => {
                      const next = nextExpandedKey(current, cid);
                      // Expanding a card while in compact mode shows the card
                      // in full; collapse-all and expand are mutually exclusive.
                      if (next) setAllCollapsed(false);
                      return next;
                    })}
                    aria-label={l10n.getString(isExpanded ? 'analytics-card-restore-aria' : 'analytics-card-expand-aria')}
                    title={l10n.getString(isExpanded ? 'analytics-card-restore-aria' : 'analytics-card-expand-aria')}
                  >
                    {isExpanded ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                        <polyline points="4 14 10 14 10 20" />
                        <polyline points="20 10 14 10 14 4" />
                        <line x1="14" y1="10" x2="21" y2="3" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                        <polyline points="15 3 21 3 21 9" />
                        <polyline points="9 21 3 21 3 15" />
                        <line x1="21" y1="3" x2="14" y2="10" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className={`analytics-card-action${menuOpen ? ' analytics-card-action--active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuOpen) {
                        closeCardMenu();
                      } else {
                        // Anchor the (portaled) menu to the trigger so it
                        // escapes the card's overflow clipping, and remember
                        // the trigger so focus can be restored on close.
                        const rect = e.currentTarget.getBoundingClientRect();
                        menuTriggerRef.current = e.currentTarget;
                        setMenuAnchor({ bottom: rect.bottom, right: window.innerWidth - rect.right });
                        setMenuCardId(cid);
                      }
                    }}
                    aria-label={l10n.getString('analytics-card-menu-aria')}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title={l10n.getString('analytics-card-menu-aria')}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                  {menuOpen && createPortal(
                    <div
                      ref={cardMenuRef}
                      className="analytics-card-menu"
                      role="menu"
                      tabIndex={-1}
                      aria-label={l10n.getString('analytics-card-menu-aria')}
                      style={{
                        position: 'fixed',
                        top: (menuAnchor?.bottom ?? 0) + 4,
                        right: menuAnchor?.right ?? 0,
                      }}
                      onKeyDown={(e) => {
                        const items = Array.from(
                          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
                        );
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          closeCardMenu();
                          return;
                        }
                        if (items.length === 0) return;
                        const idx = items.indexOf(document.activeElement as HTMLButtonElement);
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          items[(idx + 1) % items.length]?.focus();
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          items[(idx - 1 + items.length) % items.length]?.focus();
                        } else if (e.key === 'Home') {
                          e.preventDefault();
                          items[0]?.focus();
                        } else if (e.key === 'End') {
                          e.preventDefault();
                          items[items.length - 1]?.focus();
                        }
                      }}
                    >
                      <button type="button" role="menuitem" disabled={isFirst}
                        onClick={() => { moveCard(cid, 'up'); closeCardMenu(); }}>
                        {l10n.getString('analytics-menu-move-up')}
                      </button>
                      <button type="button" role="menuitem" disabled={isLast}
                        onClick={() => { moveCard(cid, 'down'); closeCardMenu(); }}>
                        {l10n.getString('analytics-menu-move-down')}
                      </button>
                      <button type="button" role="menuitem" disabled={isFirst}
                        onClick={() => { moveCard(cid, 'top'); closeCardMenu(); }}>
                        {l10n.getString('analytics-menu-move-top')}
                      </button>
                      <button type="button" role="menuitem" disabled={isLast}
                        onClick={() => { moveCard(cid, 'bottom'); closeCardMenu(); }}>
                        {l10n.getString('analytics-menu-move-bottom')}
                      </button>
                      <div className="analytics-card-menu-sep" role="separator" />
                      <button type="button" role="menuitem"
                        onClick={() => {
                          setExpandedKey((current) => nextExpandedKey(current, cid));
                          closeCardMenu();
                        }}>
                        {l10n.getString(isExpanded ? 'analytics-card-restore-aria' : 'analytics-card-expand-aria')}
                      </button>
                      <button type="button" role="menuitem"
                        onClick={() => { toggleCardCollapsed(cid); closeCardMenu(); }}>
                        {l10n.getString(isCollapsed ? 'analytics-menu-show-card' : 'analytics-menu-collapse-card')}
                      </button>
                    </div>,
                    document.body,
                  )}
                </div>
              </div>
              <div className="analytics-card-body" ref={isExpanded ? expandedBodyRef : undefined}>
                <div
                  className="analytics-card-content"
                  style={isExpanded ? { transform: `scale(${expandScale})` } : undefined}
                >
                  {card.key === 'heatmap' ? (
                    <AnalyticsHeatmap
                      granularity={heatmapGranularity}
                      range={heatmapRange}
                      cells={heatCells}
                      peakKey={peakKey}
                      columns={heatmapColumns}
                      multiYear={multiYear}
                      empty={heatmapEmpty}
                      status={heatmapQuery.status}
                      error={heatmapQuery.error}
                      data={heatmapData}
                      fmt={fmt}
                    />
                  ) : (
                    <AnalyticsCardContent
                      cardKey={card.key}
                      granularity={cardG}
                      workspaceView={workspaceView}
                      from={cardWindow.from}
                      to={cardWindow.to}
                      sessionToken={sessionToken ?? ''}
                      title={l10n.getString(card.titleKey)}
                      expanded={isExpanded}
                      compare={compare}
                    />
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>

        {/* Scroll-to-top — appears after scrolling the grid */}
        {showScrollTop && (
          <button
            type="button"
            className="analytics-scroll-top"
            onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label={l10n.getString('analytics-scroll-top-aria')}
            title={l10n.getString('analytics-scroll-top-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        )}
      </main>

      {/* Outside-click backdrop for the per-card options menu */}
      {menuCardId && (
        <div
          className="analytics-menu-backdrop"
          role="presentation"
          tabIndex={-1}
          onClick={(e) => { if (e.target === e.currentTarget) closeCardMenu(); }}
        />
      )}

      {/* Transient action feedback toasts */}
      {toasts.length > 0 && (
        <div className="analytics-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`analytics-toast${t.exiting ? ' analytics-toast--exiting' : ''}`}>{t.message}</div>
          ))}
        </div>
      )}

      {/* Command palette overlay (Ctrl/Cmd+K) */}
      {paletteOpen && (
        <div
          className="analytics-palette-backdrop"
          role="presentation"
          tabIndex={-1}
          onClick={(e) => { if (e.target === e.currentTarget) { setPaletteOpen(false); setPaletteQuery(''); } }}
        >
          <div
            className="analytics-palette"
            role="dialog"
            aria-label={l10n.getString('analytics-palette-aria')}
          >
            <input
              ref={paletteInputRef}
              type="text"
              className="analytics-palette-input"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              placeholder={l10n.getString('analytics-palette-placeholder')}
              aria-label={l10n.getString('analytics-palette-placeholder')}
            />
            <ul className="analytics-palette-list" role="listbox" aria-label={l10n.getString('analytics-palette-aria')}>
              {filteredItems.length === 0 ? (
                <li className="analytics-palette-empty">{l10n.getString('analytics-palette-empty')}</li>
              ) : (
                filteredItems.map((item, i) => (
                  <li key={`${item.kind}-${item.value}`}>
                    <button
                      type="button"
                      className={`analytics-palette-item${i === paletteIndex ? ' analytics-palette-item--active' : ''}`}
                      onMouseEnter={() => setPaletteIndex(i)}
                      onClick={() => runPaletteItem(item)}
                    >
                      <span>{item.label}</span>
                      {item.hint && <kbd className="analytics-palette-hint">{item.hint}</kbd>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

    </div>
  );
}
