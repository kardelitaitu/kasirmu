//! Analytics Screen — layout shell with three flex areas.
//!
//! Top:    back button + title
//! Menu:   workspace selector (row 1) + time granularity buttons (row 2)
//!         + inline custom date range
//! Main:   smart card grid — cards adapt to retail vs restaurant

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
import { useInvalidSession } from '@/hooks/useInvalidSession';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import TierLockedFeature from '@/components/TierLockedFeature';
import { minorUnitExponent } from '@/types/domain';
import { AnalyticsCardContent, ExportCsvButton } from './AnalyticsCardContent';
import { clearAnalyticsCache, cardQueryKey } from './analytics-cache';
import { useToastManager } from './useToastManager';
import { useCardLayout } from './useCardLayout';
import { useCommandPalette } from './useCommandPalette';
import { useAnalyticsFilters } from './hooks/useAnalyticsFilters';
import { AnalyticsHeatmap } from './AnalyticsHeatmap';
import {
  CARD_PAYLOAD_VALIDATORS,
  buildHeatmapCells,
  heatPeak,
  heatmapGranularityForRange,
  loadHeatmapRows,
  yearlyHeatmapColumns,
  type HeatCell,
} from './analytics-data';
import { clearAnalyticsErrors, useAnalyticsQuery } from './useAnalyticsQuery';
import { exportHeatmapCsv } from './utils/analyticsExport';
import { CacheMetricsPanel } from './components/CacheMetricsPanel';
import { AnalyticsCardFrame } from './components/AnalyticsCardFrame';
import { CommandPalette } from './components/CommandPalette';
import { NoWorkspacePrompt } from './components/NoWorkspacePrompt';
import { SessionRecoveryBanner } from './components/SessionRecoveryBanner';
import { ZoomControls } from './components/ZoomControls';
import {
  GRANULARITIES,
  cardGranularity,
  cardRange,
  nextExpandedKey,
  smartScale,
  type Granularity,
  type WorkspaceView,
} from './utils/dateRangePresets';
import './AnalyticsScreen.css';

// Re-export the calendar helper so the analytics test suite can import it
// from the screen module (the heatmap card owns its own copy of the helper
// via analytics-data; this keeps the existing test import working).
export { monthCalendarGrid } from './analytics-data';

// The keyboard-shortcut help list moved to components/ZoomControls with
// its only renderer; the keydown handler below mirrors those keys in its
// own branches.

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
  // context and gate the screen below. §B: Analytics is also an
  // ADMINISTRATIVE SaaS feature, so it locks the moment the subscription
  // leaves `active` (at expiresAt / canceled / paused / unavailable) even
  // though the tier entitlements themselves survive the grace window.
  const { caps, state: subscriptionState } = useSubscription();
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

  // R37 analytics-query: the view/granularity/range/zoom selections moved to
  // `hooks/useAnalyticsFilters.ts`, which also owns the two localStorage keys
  // they persist to. `workspaceLabel` below stays here — it needs
  // `availableWorkspaces` and `l10n`, which the hook has no business knowing.
  const {
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
  } = useAnalyticsFilters({ sessionToken, activeInstance });

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

  // The hook owns the zoom state and the persisted level; the reset toast
  // stays here, where `l10n` and `showToast` live.
  const zoomReset = useCallback(() => {
    resetZoom();
    showToast(l10n.getString('analytics-toast-zoom-reset'));
  }, [resetZoom, showToast, l10n]);

  // Live refresh of the debug cache-metrics readout while it is open.
  useEffect(() => {
    if (!showCacheMetrics) return;
    const id = setInterval(() => setMetricsTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [showCacheMetrics]);

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


  // §B administrative lock first — it outranks the tier gate: an expired
  // Premium subscription gets the admin lock, not the upgrade prompt.
  if (subscriptionState !== 'active') {
    return (
      <div className="analytics">
        <AdminLockedFeature />
      </div>
    );
  }

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
            <ZoomControls
              zoomLevel={zoomLevel}
              onZoomOut={zoomOut}
              onZoomIn={zoomIn}
              onZoomReset={zoomReset}
              onZoomLevelChange={setZoomLevel}
              zoomPopoverOpen={zoomPopover}
              onToggleZoomPopover={() => setZoomPopover((o) => !o)}
              shortcutsOpen={showShortcuts}
              onToggleShortcuts={() => setShowShortcuts((s) => !s)}
              zoomBadgeRef={zoomBadgeRef}
              zoomPopoverRef={zoomPopoverRef}
              shortcutsButtonRef={shortcutsButtonRef}
              shortcutsPopoverRef={shortcutsPopoverRef}
            />
          </div>
        </div>
      </nav>

      {/* Scroll progress — flush against the menu's bottom edge, tracks
          the main area's scroll position (no gap, no own spacing) */}
      <div className="analytics-scroll-progress" style={{ width: `${scrollProgress * 100}%` }} aria-hidden="true" />

      {/* Session-expired recovery banner — replaces the wall of per-card
          "session has expired" errors with one actionable notice. */}
      {showSessionBanner && (
        <SessionRecoveryBanner onSignInAgain={goToWorkspacePicker} />
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
          <NoWorkspacePrompt onSelectWorkspace={goToWorkspacePicker} />
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
          <CacheMetricsPanel
            open={showCacheMetrics}
            onToggle={() => setShowCacheMetrics((o) => !o)}
            onClear={() => {
              clearAnalyticsCache();
              setMetricsTick((t) => t + 1);
              showToast(l10n.getString('analytics-toast-cache-cleared'));
            }}
            chipRef={cacheChipRef}
            popoverRef={cachePopoverRef}
          />
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
            <AnalyticsCardFrame
              key={cid}
              cid={cid}
              size={card.size}
              titleKey={card.titleKey}
              title={card.title}
              descKey={card.descKey}
              expanded={isExpanded}
              collapsed={isCollapsed}
              dragging={isDragging}
              dropTarget={isDropTarget}
              menuOpen={menuOpen}
              first={isFirst}
              last={isLast}
              menuAnchor={menuAnchor}
              menuRef={cardMenuRef}
              expandScale={expandScale}
              expandedBodyRef={expandedBodyRef}
              onDragStart={() => setDragId(cid)}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragLeave={() => setOverId((o) => (o === cid ? null : o))}
              onDragOver={() => { if (overId !== cid) setOverId(cid); }}
              onDrop={() => { reorderCard(dragId ?? '', cid); setDragId(null); setOverId(null); }}
              onOpenMenu={(el) => {
                // Anchor the (portaled) menu to the trigger so it escapes
                // the card's overflow clipping, and remember the trigger
                // so closeCardMenu can restore focus.
                const rect = el.getBoundingClientRect();
                menuTriggerRef.current = el;
                setMenuAnchor({ bottom: rect.bottom, right: window.innerWidth - rect.right });
                setMenuCardId(cid);
              }}
              onCloseMenu={closeCardMenu}
              onToggleExpand={() => setExpandedKey((current) => {
                const next = nextExpandedKey(current, cid);
                // Expanding a card while in compact mode shows the card
                // in full; collapse-all and expand are mutually exclusive.
                if (next) setAllCollapsed(false);
                return next;
              })}
              onMenuToggleExpand={() => setExpandedKey((current) => nextExpandedKey(current, cid))}
              onMenuMove={(dir) => { moveCard(cid, dir); closeCardMenu(); }}
              onMenuCollapse={() => { toggleCardCollapsed(cid); closeCardMenu(); }}
              exportSlot={card.key === 'heatmap' && heatmapData ? (
                <ExportCsvButton
                  ariaLabel={l10n.getString('analytics-export-heatmap-aria')}
                  onClick={() => exportHeatmapCsv(heatmapGranularity, heatmapData, heatmapRange.from, heatmapRange.to, fmt, (id) => l10n.getString(id))}
                />
              ) : undefined}
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
            </AnalyticsCardFrame>
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
      <CommandPalette
        open={paletteOpen}
        query={paletteQuery}
        activeIndex={paletteIndex}
        filteredItems={filteredItems}
        inputRef={paletteInputRef}
        onQueryChange={setPaletteQuery}
        onIndexChange={setPaletteIndex}
        onClose={() => { setPaletteOpen(false); setPaletteQuery(''); }}
        onRunItem={runPaletteItem}
      />

    </div>
  );
}
