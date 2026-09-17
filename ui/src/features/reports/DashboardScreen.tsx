//! Reports Dashboard — owner/admin landing page.
//!
//! Date range picker → granularity toggle → KPI bar (with deltas) →
//! revenue trend area chart + category donut → sales heatmap +
//! top products bar → low stock alerts.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { requiredLocalized } from '@/components';
import { l10nErrorMessage } from '@/utils/app-error';
import { Card } from '@/components/Card';
import { Spinner } from '@/components/Spinner';
import { minorUnitExponent } from '@/types/domain';
import { sumRevenueByCurrency, sumGrossProfitByCurrency } from './revenueTotals';
import { downloadCsv } from '@/utils/export-csv';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  getDailyRevenue, getWeeklyRevenue, getMonthlyRevenue,
  getTopProducts, getLowStockAlerts, getCategoryBreakdown, getHourlyHeatmap,
  type DailyRevenueRow, type WeeklyRevenueRow, type MonthlyRevenueRow,
  type TopProductRow, type LowStockAlert, type CategoryBreakdownRow,
  type HourlyHeatmapRow,
} from '@/api/reports';
import { getPrimaryLocationScoped } from '@/api/locations';
import { isoDaysAgo, isoToday } from '@/features/analytics/analytics-data';
import './DashboardScreen.css';

echarts.use([
  BarChart, LineChart, PieChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, VisualMapComponent,
  CanvasRenderer,
]);

// ── Date helpers ───────────────────────────────────────────────────

// `today()` and `daysAgo()` used to live here, reading the DEVICE calendar
// (isoDay(new Date())). They are replaced by isoToday()/isoDaysAgo() from
// features/analytics/analytics-data, which anchor to the primary store's zone
// (REP-03) — the same fix R36-01 made in AnalyticsScreen. This screen queries
// store-scoped data via api/reports, so host-derived range boundaries were
// wrong for any terminal not in the store's zone.
//
// isoDay/parseLocalDate/shiftDate stay: they do calendar arithmetic on
// already-formatted YYYY-MM-DD strings, so the local Date is only a scratch
// container and the result is zone-independent.
function isoDay(d: Date): string {
  // Local calendar date — `toISOString()` is UTC and can return the
  // previous day for late-evening/early-morning local times.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an ISO date into a local-midnight `Date` (never `new Date(str)`, which parses as UTC). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}
/** Inclusive whole-day count between two ISO dates (DST-safe). */
function daysBetween(from: string, to: string): number {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  return Math.round(
    (Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(f.getFullYear(), f.getMonth(), f.getDate())) / 86400000,
  ) + 1;
}
/** Shift an ISO date by whole days, preserving the local calendar date. */
function shiftDate(s: string, days: number): string {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

type Granularity = 'daily' | 'weekly' | 'monthly';

const GRANULARITIES: Granularity[] = ['daily', 'weekly', 'monthly'];

/** Cached on-demand weekly/monthly revenue series, keyed by granularity + range. */
interface GranularitySeries {
  granularity: 'weekly' | 'monthly';
  from: string;
  to: string;
  rows: WeeklyRevenueRow[] | MonthlyRevenueRow[];
}

// Sunday-first day keys, matching the backend `day_of_week` (0 = Sunday).
const DAY_LABELS = ['day-sunday', 'day-monday', 'day-tuesday', 'day-wednesday', 'day-thursday', 'day-friday', 'day-saturday'];

// ── Currency formatting ────────────────────────────────────────────

function fmtCurrency(minor: number, currency: string, locale = 'en'): string {
  const exp = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency,
    minimumFractionDigits: exp, maximumFractionDigits: exp,
  }).format(minor / 10 ** exp);
}

function fmtShort(minor: number, currency: string, locale = 'en'): string {
  // Compact notation follows the active Fluent locale (e.g. "Rp 2,5 jt" for
  // id) instead of hardcoding English "M"/"K" suffixes.
  const exp = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(minor / 10 ** exp);
}

/** Format a period-over-period percentage delta (caller must guard `previous === 0`). */
function fmtDelta(current: number, previous: number): string {
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ── Component ───────────────────────────────────────────────────────

/** §B administrative gate — the owner/admin dashboard locks while the subscription is not `active`. */
export default function DashboardScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <DashboardScreenContent />;
}

function DashboardScreenContent() {
  const { l10n } = useLocalization();
  const { goToWorkspacePicker } = useWorkspaceNav();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const { currency } = useCurrency();
  // Currency/number formatting follows the active Fluent locale (matching
  // the analytics cards) instead of a hardcoded 'en'.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  const [granularity, setGranularity] = useState<Granularity>('daily');
  // REP-03: the default 30-day window anchors to the PRIMARY STORE's calendar
  // day, not the device's. Until the profile loads (or if the fetch fails) the
  // anchor is FALLBACK_STORE_TZ (UTC, the schema's column default) — see the
  // comment on that constant in features/analytics/analytics-data.
  const [storeTz, setStoreTz] = useState<string | null>(null);
  const rangeTouched = useRef(false);
  const [fromDraft, setFromDraft] = useState(isoDaysAgo(29));
  const [toDraft, setToDraft] = useState(isoToday());
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(isoToday());
  useEffect(() => {
    if (!sessionToken) return;
    let alive = true;
    getPrimaryLocationScoped(sessionToken)
      .then((p) => { if (alive) setStoreTz(p?.timezone ?? null); })
      .catch(() => { /* storeTz stays null -> the UTC fallback applies */ });
    return () => { alive = false; };
  }, [sessionToken]);
  useEffect(() => {
    // Re-seed the untouched defaults once the store's day is actually known.
    if (!storeTz || rangeTouched.current) return;
    setFromDraft(isoDaysAgo(29, storeTz));
    setToDraft(isoToday(storeTz));
    setFrom(isoDaysAgo(29, storeTz));
    setTo(isoToday(storeTz));
  }, [storeTz]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current period. `dailyRevenue` is always fetched (the KPIs and the default
  // chart derive from it); weekly/monthly are fetched on demand by the series
  // effect below, so the daily view doesn't pay for two unused aggregates.
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenueRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownRow[]>([]);
  const [heatmap, setHeatmap] = useState<HourlyHeatmapRow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Previous period for deltas
  const [prevDaily, setPrevDaily] = useState<DailyRevenueRow[]>([]);

  // On-demand weekly/monthly revenue series cache.
  const [series, setSeries] = useState<GranularitySeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // Refs to the granularity radio buttons so arrow-key navigation can move
  // focus to the newly-checked option (roving tabindex per WAI-ARIA radio).
  const radioRefs = useRef<Record<Granularity, HTMLButtonElement | null>>({
    daily: null, weekly: null, monthly: null,
  });

  // WAI-ARIA radiogroup: Arrow keys move focus AND selection; Tab leaves the
  // group. `aria-checked` + `tabIndex` make the roving-tabindex contract work.
  const handleGranularityKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const idx = GRANULARITIES.indexOf(granularity);
    let next: Granularity | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = GRANULARITIES[(idx + 1) % GRANULARITIES.length]!;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = GRANULARITIES[(idx - 1 + GRANULARITIES.length) % GRANULARITIES.length]!;
    }
    if (!next) return;
    e.preventDefault();
    setGranularity(next);
    radioRefs.current[next]?.focus();
  }, [granularity]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = daysBetween(from, to);
      const prevFrom = shiftDate(from, -days);
      const prevTo = shiftDate(from, -1);

      const [daily, top, stock, cats, heat, prev] = await Promise.all([
        getDailyRevenue(from, to, sessionToken),
        getTopProducts(from, to, 10, sessionToken, 'revenue'),
        getLowStockAlerts(10, sessionToken),
        getCategoryBreakdown(from, to, sessionToken),
        getHourlyHeatmap(from, to, sessionToken),
        getDailyRevenue(prevFrom, prevTo, sessionToken),
      ]);
      setDailyRevenue(daily);
      setTopProducts(top);
      setLowStock(stock);
      setCategoryBreakdown(cats);
      setSelectedCategory(null);
      setHeatmap(heat);
      setPrevDaily(prev);
      setHasLoaded(true);
    } catch (e) {
      setError(l10nErrorMessage(e, l10n, 'dashboard-error-load'));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, from, to, l10n]);

  useEffect(() => { loadData(); }, [loadData]);

  // Fetch the weekly/monthly revenue series on demand, only when that
  // granularity is selected. The result is cached (keyed by granularity +
  // range) so toggling back reuses it and a date-range change invalidates it.
  useEffect(() => {
    if (granularity === 'daily') return;
    const fresh = series
      && series.granularity === granularity
      && series.from === from
      && series.to === to;
    if (fresh) return;

    let cancelled = false;
    setSeriesLoading(true);
    setSeriesError(null);
    const fetcher = granularity === 'weekly' ? getWeeklyRevenue : getMonthlyRevenue;
    fetcher(from, to, sessionToken)
      .then((rows) => {
        if (cancelled) return;
        setSeries({ granularity, from, to, rows });
      })
      .catch((e) => {
        if (cancelled) return;
        setSeriesError(l10nErrorMessage(e, l10n, 'dashboard-error-load'));
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });
    return () => { cancelled = true; };
  }, [granularity, from, to, sessionToken, series, l10n]);

  // ── Revenue series for chart ─────────────────────────────────────

  const revenueSeries = useMemo(() => {
    switch (granularity) {
      case 'daily': return dailyRevenue.map((r) => ({ date: r.date, total: r.total_minor, profit: r.gross_profit_minor, count: r.sale_count }));
      case 'weekly': {
        const rows = series?.granularity === 'weekly' ? (series.rows as WeeklyRevenueRow[]) : [];
        return rows.map((r) => ({ date: r.week_start, total: r.total_minor, profit: r.gross_profit_minor, count: r.sale_count }));
      }
      case 'monthly': {
        const rows = series?.granularity === 'monthly' ? (series.rows as MonthlyRevenueRow[]) : [];
        return rows.map((r) => ({ date: r.month, total: r.total_minor, profit: r.gross_profit_minor, count: r.sale_count }));
      }
    }
  }, [granularity, dailyRevenue, series]);

  // ── KPI computed values with deltas ──────────────────────────────

  // KPI totals are sums over the WHOLE selected range (not "today") — the
  // delta compares them against the previous equal-length period.
  // REP-02: Never sum minor units across currencies. Compute per-currency
  // totals and only render a single KPI when the period is single-currency.
  const rangeKPIs = useMemo(() => {
    const revenueTotals = sumRevenueByCurrency(dailyRevenue);
    const profitTotals = sumGrossProfitByCurrency(dailyRevenue);
    const prevRevenueTotals = sumRevenueByCurrency(prevDaily);
    const prevProfitTotals = sumGrossProfitByCurrency(prevDaily);

    const rangeRev = revenueTotals.reduce((s, t) => s + t.total_minor, 0);
    const rangeProfit = profitTotals.reduce((s, t) => s + t.gross_profit_minor, 0);
    const rangeOrders = dailyRevenue.reduce((s, r) => s + r.sale_count, 0);
    const prevRev = prevRevenueTotals.reduce((s, t) => s + t.total_minor, 0);
    const prevProfit = prevProfitTotals.reduce((s, t) => s + t.gross_profit_minor, 0);
    const prevOrders = prevDaily.reduce((s, r) => s + r.sale_count, 0);
    const top = topProducts[0];

    const multiCurrency = revenueTotals.length > 1;
    // For single-currency periods, use that currency; otherwise undefined
    // signals the render layer to display per-currency breakdown.
    const singleCurrency = multiCurrency ? undefined : revenueTotals[0]?.currency ?? currency;

    return {
      rangeRev, rangeProfit, rangeOrders, top,
      prevRev, prevProfit, prevOrders,
      currency: singleCurrency,
      multiCurrency,
      revenueTotals,
      profitTotals,
    };
  }, [dailyRevenue, prevDaily, topProducts, currency]);

  // ── ECharts options (same as before, trimmed for space) ──────────

  const revenueChartOption = useMemo(() => {
    const dates = revenueSeries.map((r) => r.date);
    return {
      tooltip: { trigger: 'axis' as const, valueFormatter: (val: unknown) => fmtCurrency(Number(val), currency, numLocale) },
      legend: { data: [l10n.getString('dashboard-chart-revenue'), l10n.getString('dashboard-chart-profit')], top: 0 },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 40, containLabel: true },
      xAxis: { type: 'category' as const, data: dates, axisLabel: { rotate: granularity === 'monthly' ? 45 : 0 } },
      yAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => fmtShort(v, currency, numLocale) } },
      series: [
        { name: l10n.getString('dashboard-chart-revenue'), type: 'line' as const, data: revenueSeries.map((r) => r.total), areaStyle: { opacity: 0.15 }, smooth: true, itemStyle: { color: '#5470c6' }, symbol: 'circle', symbolSize: 4 },
        { name: l10n.getString('dashboard-chart-profit'), type: 'line' as const, data: revenueSeries.map((r) => r.profit), areaStyle: { opacity: 0.08 }, smooth: true, itemStyle: { color: '#91cc75' }, symbol: 'circle', symbolSize: 4 },
      ],
    };
  }, [revenueSeries, currency, granularity, l10n, numLocale]);

  const categoryDonutOption = useMemo(() => {
    if (categoryBreakdown.length === 0) return null;
    // ECharts renders to <canvas>, which cannot resolve CSS variables in a
    // fill — read the theme foreground color into a concrete value here so it
    // only re-reads when the donut inputs change (not on every render).
    const fgColor = getComputedStyle(document.documentElement).getPropertyValue('--color-fg').trim() || '#111';
    const total = categoryBreakdown.reduce((s, c) => s + c.total_minor, 0);
    return {
      tooltip: { trigger: 'item' as const, valueFormatter: (val: unknown) => fmtCurrency(Number(val), currency, numLocale) },
      legend: { orient: 'vertical' as const, right: 0, top: 'middle', textStyle: { fontSize: 11 } },
      series: [{
        name: l10n.getString('dashboard-chart-category'), type: 'pie' as const,
        radius: ['45%', '75%'], center: ['35%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: 'var(--color-bg)', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold' } },
        data: categoryBreakdown.map((c) => ({ value: c.total_minor, name: c.category_name })),
      }],
      graphic: total > 0 ? [{ type: 'text' as const, left: '24%', top: 'middle',
        style: { text: fmtShort(total, currency, numLocale), textAlign: 'center' as const, fill: fgColor, fontSize: 14, fontWeight: 'bold' } }] : undefined,
    };
  }, [categoryBreakdown, currency, l10n, numLocale]);

  const heatmapOption = useMemo(() => {
    if (heatmap.length === 0) return null;
    const dayNames = DAY_LABELS.map((k) => l10n.getString(k));
    const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const maxVal = Math.max(...heatmap.map((h) => h.sale_count), 1);
    return {
      tooltip: { position: 'top' as const, formatter: (params: { value: [number, number, number] }) => l10n.getString('dashboard-heatmap-tooltip', { day: dayNames[params.value[1]] ?? '', hour: hours[params.value[0]] ?? '', count: String(params.value[2]) }) },
      grid: { left: 60, right: 20, bottom: 40, top: 10 },
      xAxis: { type: 'category' as const, data: hours, splitArea: { show: true }, axisLabel: { fontSize: 9, interval: 3 } },
      yAxis: { type: 'category' as const, data: dayNames, splitArea: { show: true } },
      visualMap: { min: 0, max: maxVal, calculable: true, orient: 'horizontal' as const, left: 'center', bottom: 0, inRange: { color: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'] }, itemWidth: 10, itemHeight: 80, textStyle: { fontSize: 9 } },
      series: [{ name: l10n.getString('dashboard-chart-heatmap'), type: 'heatmap' as const, data: heatmap.map((h) => [h.hour, h.day_of_week, h.sale_count]), label: { show: false }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } } }],
    };
  }, [heatmap, l10n]);

  const topProductsOption = useMemo(() => {
    if (topProducts.length === 0) return null;
    // Reverse once (instead of mutating inside the axis/series config) so
    // the highest-revenue product renders at the top of the horizontal bar
    // chart — ECharts draws category-axis items bottom-up.
    const names = topProducts.map((p) => p.name).reverse();
    const values = topProducts.map((p) => p.total_minor).reverse();
    return {
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, valueFormatter: (val: unknown) => fmtCurrency(Number(val), currency, numLocale) },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 0, containLabel: true },
      xAxis: { type: 'value' as const, axisLabel: { formatter: (v: number) => fmtShort(v, currency, numLocale) } },
      yAxis: { type: 'category' as const, data: names, axisLabel: { width: 120, overflow: 'truncate', fontSize: 10 } },
      series: [{ name: l10n.getString('dashboard-chart-top-products'), type: 'bar' as const, barMaxWidth: 28,
        data: values.map((v) => ({ value: v, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#5470c6' }, { offset: 1, color: '#91cc75' }]) } })),
      }],
    };
  }, [topProducts, currency, l10n, numLocale]);

  // Localized period-over-period delta label. A zero previous period has no
  // meaningful %, so a genuinely new metric shows a localized "New" badge
  // instead of the old unlocalized `+∞` / `−` math symbols.
  const renderDelta = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? <Localized id="dashboard-delta-new"><span>New</span></Localized> : null;
    return fmtDelta(current, previous);
  };

  // ── Render ───────────────────────────────────────────────────────

  // The full-screen spinner/error replace the dashboard only on the very first
  // load (no data yet). Once loaded, reloads keep stale data visible and show
  // a lightweight in-flight indicator instead of flashing the whole screen.
  if (!hasLoaded && loading) return <div className="dashboard"><Spinner aria-label={l10n.getString('spinner-label')} /></div>;
  if (!hasLoaded && error) return <div className="dashboard"><p className="dashboard-error">{error}</p></div>;

  return (
    <div className="dashboard dashboard--fullscreen" role="region" aria-label={requiredLocalized(l10n, 'dashboard-region-aria')}>
      {/* Back button */}
      <button type="button" className="dashboard-back-btn" onClick={goToWorkspacePicker}
        aria-label={l10n.getString('dashboard-back-aria')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
        <Localized id="dashboard-back"><span>Back</span></Localized>
      </button>
      {loading && hasLoaded && (
        <p className="dashboard-refreshing" role="status">
          <Localized id="dashboard-refreshing"><span>Refreshing…</span></Localized>
        </p>
      )}
      {error && hasLoaded && (
        <p className="dashboard-error" role="alert">{error}</p>
      )}
      {/* Header: title + date range + granularity */}
      <div className="dashboard-header">
        <div className="dashboard-header-top">
          <Localized id="dashboard-title"><h1 className="dashboard-title">Dashboard</h1></Localized>
          {revenueSeries.length > 0 && (
            <button type="button" className="dashboard-export-btn"
              onClick={() => downloadCsv(`reports-dashboard-${from}-to-${to}.csv`,
                [{ key: 'date', label: l10n.getString('dashboard-export-col-date') },
                 { key: 'total', label: l10n.getString('dashboard-export-col-revenue') },
                 { key: 'profit', label: l10n.getString('dashboard-export-col-profit') },
                 { key: 'count', label: l10n.getString('dashboard-export-col-orders') }],
                revenueSeries.map((r) => ({ ...r, total: String(r.total), profit: String(r.profit), count: String(r.count) })),
              )}
              aria-label={l10n.getString('dashboard-export-csv-aria')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <Localized id="dashboard-export-csv"><span>CSV</span></Localized>
            </button>
          )}
        </div>
        <div className="dashboard-controls">
          <div className="dashboard-date-row">
            <input type="date" className="dashboard-date-input" value={fromDraft} max={toDraft}
              onChange={(e) => { rangeTouched.current = true; setFromDraft(e.target.value); }} aria-label={l10n.getString('dashboard-filter-from')} />
            <span className="dashboard-date-sep">—</span>
            <input type="date" className="dashboard-date-input" value={toDraft} min={fromDraft}
              onChange={(e) => { rangeTouched.current = true; setToDraft(e.target.value); }} aria-label={l10n.getString('dashboard-filter-to')} />
            <button type="button" className="dashboard-apply-btn" onClick={() => { setFrom(fromDraft); setTo(toDraft); }}
              aria-label={l10n.getString('dashboard-btn-apply')}>
              <Localized id="dashboard-btn-apply"><span>Apply</span></Localized>
            </button>
          </div>
          <div className="dashboard-granularity" role="radiogroup"
            aria-label={l10n.getString('dashboard-granularity-aria')}>
            {GRANULARITIES.map((g) => (
              <button key={g} type="button" ref={(el) => { radioRefs.current[g] = el; }}
                className={`dashboard-granularity-btn${granularity === g ? ' dashboard-granularity-btn--active' : ''}`}
                onClick={() => setGranularity(g)} onKeyDown={handleGranularityKeyDown}
                role="radio" aria-checked={granularity === g}
                tabIndex={granularity === g ? 0 : -1}>
                <Localized id={`dashboard-granularity-${g}`}><span>{g}</span></Localized>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI Row ──────────────────────────────────── */}
      <div className="dashboard-kpi-row">
        <Card shadow="sm" className="dashboard-kpi">
          <span className="dashboard-kpi-label"><Localized id="dashboard-revenue"><span>Revenue</span></Localized></span>
          {rangeKPIs.multiCurrency ? (
            <span className="dashboard-kpi-value dashboard-kpi-value--multi">
              {rangeKPIs.revenueTotals.map((t) => fmtCurrency(t.total_minor, t.currency, numLocale)).join(' · ')}
            </span>
          ) : (
            <span className="dashboard-kpi-value">{fmtCurrency(rangeKPIs.rangeRev, rangeKPIs.currency ?? currency, numLocale)}</span>
          )}
          <span className={`dashboard-kpi-delta${!rangeKPIs.multiCurrency && rangeKPIs.rangeRev >= rangeKPIs.prevRev ? '' : ' dashboard-kpi-delta--down'}`}>
            {!rangeKPIs.multiCurrency ? renderDelta(rangeKPIs.rangeRev, rangeKPIs.prevRev) : null}
          </span>
        </Card>
        <Card shadow="sm" className="dashboard-kpi">
          <span className="dashboard-kpi-label"><Localized id="dashboard-gross-profit"><span>Gross Profit</span></Localized></span>
          {rangeKPIs.multiCurrency ? (
            <span className="dashboard-kpi-value dashboard-kpi-value--multi">
              {rangeKPIs.profitTotals.map((t) => fmtCurrency(t.gross_profit_minor, t.currency, numLocale)).join(' · ')}
            </span>
          ) : (
            <span className={`dashboard-kpi-value${rangeKPIs.rangeProfit < 0 ? ' dashboard-kpi-negative' : ''}`}>
              {fmtCurrency(rangeKPIs.rangeProfit, rangeKPIs.currency ?? currency, numLocale)}
            </span>
          )}
          <span className={`dashboard-kpi-delta${!rangeKPIs.multiCurrency && rangeKPIs.rangeProfit >= rangeKPIs.prevProfit ? '' : ' dashboard-kpi-delta--down'}`}>
            {!rangeKPIs.multiCurrency ? renderDelta(rangeKPIs.rangeProfit, rangeKPIs.prevProfit) : null}
          </span>
        </Card>
        <Card shadow="sm" className="dashboard-kpi">
          <span className="dashboard-kpi-label"><Localized id="dashboard-orders"><span>Orders</span></Localized></span>
          <span className="dashboard-kpi-value">{rangeKPIs.rangeOrders}</span>
          <span className={`dashboard-kpi-delta${rangeKPIs.rangeOrders >= rangeKPIs.prevOrders ? '' : ' dashboard-kpi-delta--down'}`}>
            {renderDelta(rangeKPIs.rangeOrders, rangeKPIs.prevOrders)}
          </span>
        </Card>
        <Card shadow="sm" className="dashboard-kpi">
          <span className="dashboard-kpi-label"><Localized id="dashboard-top-product"><span>Top Product</span></Localized></span>
          <span className="dashboard-kpi-value dashboard-kpi-value--name">{rangeKPIs.top?.name ?? '-'}</span>
        </Card>
      </div>

      {/* ── Revenue trend + Category donut ────────────── */}
      <div className="dashboard-chart-row">
        <Card shadow="sm" className="dashboard-chart-card">
          <Localized id="dashboard-chart-revenue"><h2 className="dashboard-section-title">Revenue Trend</h2></Localized>
          {granularity !== 'daily' && seriesLoading ? (
            <div className="dashboard-chart-loading"><Spinner aria-label={l10n.getString('spinner-label')} /></div>
          ) : granularity !== 'daily' && seriesError ? (
            <p className="dashboard-error">{seriesError}</p>
          ) : revenueSeries.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={revenueChartOption} style={{ height: 320 }} notMerge aria-label={l10n.getString('dashboard-chart-revenue-aria')} />
          ) : <p className="dashboard-no-data"><Localized id="dashboard-no-data"><span>No data yet</span></Localized></p>}
        </Card>
        <Card shadow="sm" className="dashboard-chart-card">
          <Localized id="dashboard-chart-category-breakdown"><h2 className="dashboard-section-title">Category Breakdown</h2></Localized>
          {categoryDonutOption ? (
            <>
              <ReactEChartsCore echarts={echarts} option={categoryDonutOption} style={{ height: 280 }} notMerge
                onEvents={{ click: (params: { name?: string }) => setSelectedCategory(params.name ?? null) }}
                aria-label={l10n.getString('dashboard-chart-category-aria')} />
              {selectedCategory && (
                <div className="dashboard-category-detail">
                  <span className="dashboard-category-detail-name">{selectedCategory}</span>
                  <span className="dashboard-category-detail-pct">
                    {(() => {
                      const cat = categoryBreakdown.find((c) => c.category_name === selectedCategory);
                      const total = categoryBreakdown.reduce((s, c) => s + c.total_minor, 0);
                      return cat && total > 0 ? `${((cat.total_minor / total) * 100).toFixed(1)}%` : '';
                    })()}
                  </span>
                  <button type="button" className="dashboard-category-detail-clear" onClick={() => setSelectedCategory(null)}
                    aria-label={l10n.getString('dashboard-category-clear-aria')}>×</button>
                </div>
              )}
            </>
          ) : <p className="dashboard-no-data"><Localized id="dashboard-no-data"><span>No data yet</span></Localized></p>}
        </Card>
      </div>

      {/* ── Heatmap + Top Products ─────────────────────── */}
      <div className="dashboard-chart-row">
        <Card shadow="sm" className="dashboard-chart-card">
          <Localized id="dashboard-chart-heatmap"><h2 className="dashboard-section-title">Sales Heatmap</h2></Localized>
          {heatmapOption ? (
            <ReactEChartsCore echarts={echarts} option={heatmapOption} style={{ height: 280 }} notMerge aria-label={l10n.getString('dashboard-chart-heatmap-aria')} />
          ) : <p className="dashboard-no-data"><Localized id="dashboard-heatmap-empty"><span>No heatmap data yet</span></Localized></p>}
        </Card>
        <Card shadow="sm" className="dashboard-chart-card">
          <Localized id="dashboard-chart-top-products"><h2 className="dashboard-section-title">Top 10 Products</h2></Localized>
          {topProductsOption ? (
            <ReactEChartsCore echarts={echarts} option={topProductsOption} style={{ height: 280 }} notMerge aria-label={l10n.getString('dashboard-chart-top-products-aria')} />
          ) : <p className="dashboard-no-data"><Localized id="dashboard-no-data"><span>No data yet</span></Localized></p>}
        </Card>
      </div>

      {/* ── Low Stock Alerts ──────────────────────────── */}
      <Card shadow="sm" className="dashboard-section">
        <Localized id="dashboard-low-stock-alerts"><h2 className="dashboard-section-title">Low Stock Alerts</h2></Localized>
        {lowStock.length === 0 ? (
          <p className="dashboard-no-data"><Localized id="dashboard-stock-ok"><span>All stock levels are healthy.</span></Localized></p>
        ) : (
          <ul className="dashboard-low-stock-list" aria-label={requiredLocalized(l10n, 'dashboard-stock-alerts-aria')}>
            {lowStock.map((item) => (
              <li key={item.product_id} className="dashboard-low-stock-item">
                <span className="dashboard-low-stock-name">{item.name}</span>
                <Localized id="dashboard-stock-below-threshold" vars={{ qty: item.current_qty, threshold: item.threshold }}>
                  <span className="dashboard-low-stock-qty">{item.current_qty} left (below {item.threshold})</span>
                </Localized>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
