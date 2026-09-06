import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { requiredLocalized } from '@/frontend/shared';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Localized, useLocalization } from '@fluent/react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { printSalesReceipt } from '@/api/sales';
import {
  getDailyRevenue,
  getWeeklyRevenue,
  getMonthlyRevenue,
  getTopProducts,
  getHourlyHeatmap,
  getCategoryBreakdown,
  getCategoryPopularity,
  getCategoryPopularityTrend,
  getCategoryForecast,
  type DailyRevenueRow,
  type WeeklyRevenueRow,
  type MonthlyRevenueRow,
  type TopProductRow,
  type HourlyHeatmapRow,
  type CategoryBreakdownRow,
  type CategoryPopularityRow,
  type CategoryTrendPoint,
  type CategoryForecastRow,
} from '@/api/reports';
import { getPrimaryLocationScoped } from '@/api/locations';
import { isoDaysAgo, isoToday } from '@/features/analytics/analytics-data';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { minorUnitExponent } from '@/types/domain';
import { sumGrossProfitByCurrency, sumNetRevenueByCurrency, sumRevenueByCurrency } from './revenueTotals';
import './SalesReportScreen.css';

const PIE_COLORS = [
  '#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

const HEATMAP_COLORS = [
  '#f0fdf4', '#bbf7d0', '#86efac', '#4ade80',
  '#22c55e', '#16a34a', '#15803d', '#166534',
];

type ViewMode = 'daily' | 'weekly' | 'monthly';

// FTL ids for weekday labels (day-sunday … day-saturday in reports.ftl),
// indexed by the heatmap's day_of_week column (0 = Sunday).
// Exported so dynamicFluentFamilies.test.ts can pin the `day-${dayKey}`
// family against both bundles: the id is built by interpolation, so the
// static parity gate cannot see the reference and cannot catch a rename.
export const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

type RevenueRow = DailyRevenueRow | WeeklyRevenueRow | MonthlyRevenueRow;

function fmtCurrency(minor: number, currency: string, locale = 'en'): string {
  // Exponent-driven: IDR/JPY = 0 decimals, KWD = 3, USD/EUR = 2 — the
  // shared minorUnitExponent map is the single source of truth (mirrors
  // the Rust Currency::minor_unit_exponent). No hardcoded /100 math.
  const exp = minorUnitExponent(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(minor / 10 ** exp);
  } catch {
    // Fallback to plain number formatting if currency is invalid
    const fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    });
    return fmt.format(minor / 10 ** exp);
  }
}

// today() and monthAgo() used to live here. today() was
// new Date().toISOString().slice(0,10) -- UTC, so host-independent, but blind to
// the store's zone: a +07:00 store at 06:00 local is 23:00 UTC the previous day,
// so "today" showed yesterday for the first seven hours of every business day.
// monthAgo() was worse, mixing host-local setDate() with a UTC read-back (a
// DST-only off-by-one; see R36-06's measurement). Both are replaced by
// isoToday()/isoDaysAgo() from features/analytics/analytics-data, which anchor to
// the primary store (REP-03) -- the same helpers R36-01/R36-05 converged on.

/** Sales report screen — daily/weekly/monthly revenue charts, top products, hourly heatmap, and category breakdown with CSV export. */
/** §B administrative gate — Reports lock while the subscription is not `active`. */
export default function SalesReportScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <SalesReportScreenContent />;
}

function SalesReportScreenContent() {
  const { l10n } = useLocalization();
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en';
  // R36-07: read the token through the useWorkspace() hook rather than the
// raw context object. The global test harness mocks the hook, not the
// context, so the direct form silently yielded an empty token and skipped
// every token-gated effect. AppProviders wraps the routed tree in the
// provider, so the hook's throw-outside-provider path is unreachable here.
const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('daily');
  // REP-03/R36-06: the default window anchors to the PRIMARY STORE's calendar
  // day. Until the profile loads (or if the fetch fails) the anchor is
  // FALLBACK_STORE_TZ (UTC, the schema's column default), never the host.
  const [storeTz, setStoreTz] = useState<string | null>(null);
  const rangeTouched = useRef(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(isoToday());
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
    setStartDate(isoDaysAgo(30, storeTz));
    setEndDate(isoToday(storeTz));
  }, [storeTz]);

  // REP-06: Request generation counter to ignore stale responses
  const fetchGenerationRef = useRef(0);

  const [revenueData, setRevenueData] = useState<RevenueRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  // Rank the top-products table by revenue (default) or gross profit.
  // Boolean flag keeps className interpolations quote-free (see
  // screenExtraction: quoted strings inside `${...}` are read as classes).
  const [rankByProfit, setRankByProfit] = useState(false);
  const [heatmap, setHeatmap] = useState<HourlyHeatmapRow[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<
    CategoryBreakdownRow[]
  >([]);
  const [categoryPopularity, setCategoryPopularity] = useState<
    CategoryPopularityRow[]
  >([]);
  const [popularityTrend, setPopularityTrend] = useState<CategoryTrendPoint[]>([]);
  const [categoryForecast, setCategoryForecast] = useState<CategoryForecastRow[]>([]);

  // P9-3: Period comparison
  const [comparePeriod, setComparePeriod] = useState(false);
  const [prevRevenueData, setPrevRevenueData] = useState<RevenueRow[]>([]);

  const revenueTotals = sumRevenueByCurrency(revenueData);
  const multiCurrencyPeriod = revenueTotals.length > 1;
  // Single-currency periods keep the exact pre-existing display; the chart
  // tooltip still uses the first-seen currency (multi-currency chart
  // semantics are a tracked follow-up, not this fix).
  const currency: string = revenueTotals[0]?.currency ?? 'USD';
  const totalRevenue = revenueTotals[0]?.total_minor ?? 0;

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);

    // REP-06: Increment generation counter to invalidate any in-flight requests
    const currentGeneration = ++fetchGenerationRef.current;

    let revenuePromise: Promise<RevenueRow[]>;
    switch (view) {
      case 'daily':
        revenuePromise = getDailyRevenue(startDate, endDate, sessionToken);
        break;
      case 'weekly':
        revenuePromise = getWeeklyRevenue(startDate, endDate, sessionToken);
        break;
      case 'monthly':
        revenuePromise = getMonthlyRevenue(startDate, endDate, sessionToken);
        break;
    }

    Promise.all([
      revenuePromise,
      getTopProducts(startDate, endDate, 10, sessionToken, rankByProfit ? 'profit' : 'revenue'),
      getHourlyHeatmap(startDate, endDate, sessionToken),
      getCategoryBreakdown(startDate, endDate, sessionToken),
      getCategoryPopularity(sessionToken, 3),
      getCategoryPopularityTrend(sessionToken, startDate, endDate, view, 5),
      getCategoryForecast(sessionToken, startDate, endDate, view, 5),
    ])
    .then(([rev, top, heat, cat, catPop, trend, forecast]) => {
      // REP-06: Ignore stale responses from superseded requests
      if (currentGeneration !== fetchGenerationRef.current) {
        return;
      }
      setRevenueData(rev);
      setTopProducts(top);
      setHeatmap(heat);
      setCategoryBreakdown(cat);
      setCategoryPopularity(catPop);
      setPopularityTrend(trend);
      setCategoryForecast(forecast);
    })
    .catch((e) => {
      // REP-06: Only set error if this is still the current request
      if (currentGeneration === fetchGenerationRef.current) {
        setError(e.message ?? String(e));
      }
    })
    .finally(() => {
      // REP-06: Only clear loading if this is still the current request
      if (currentGeneration === fetchGenerationRef.current) {
        setLoading(false);
      }
    });
  }, [view, startDate, endDate, sessionToken, rankByProfit]);

  // P9-3: Fetch previous period data when comparison is enabled
  const calcPrevRange = useCallback(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    return {
      prevStart: prevStart.toISOString().slice(0, 10),
      prevEnd: prevEnd.toISOString().slice(0, 10),
    }
  }, [startDate, endDate]);

  const fetchPrevData = useCallback(() => {
    if (!comparePeriod) {
      setPrevRevenueData([]);
      return;
    }

    const { prevStart, prevEnd } = calcPrevRange();

    // REP-06: Use a separate generation counter for prev-period fetches
    const prevFetchGeneration = ++fetchGenerationRef.current;

    let revenuePromise: Promise<RevenueRow[]>;
    switch (view) {
      case 'daily':
        revenuePromise = getDailyRevenue(prevStart, prevEnd, sessionToken);
        break;
      case 'weekly':
        revenuePromise = getWeeklyRevenue(prevStart, prevEnd, sessionToken);
        break;
      case 'monthly':
        revenuePromise = getMonthlyRevenue(prevStart, prevEnd, sessionToken);
        break;
    }

    revenuePromise
      .then((rev) => {
        // REP-06: Ignore stale prev-period responses
        if (prevFetchGeneration === fetchGenerationRef.current) {
          setPrevRevenueData(rev);
        }
      })
      .catch(() => {
        // REP-06: Only clear if this is still the current prev-period request
        if (prevFetchGeneration === fetchGenerationRef.current) {
          setPrevRevenueData([]);
        }
      });

  }, [comparePeriod, view, calcPrevRange, sessionToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchPrevData();
  }, [fetchPrevData]);

  const exportCsv = () => {
    const escapeCsvField = (field: string): string => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    const headers = ['Period', 'Revenue', 'Currency', 'Orders'];
    const rows = revenueData.map((r) => {
      const period = 'date' in r ? r.date : 'week_start' in r ? r.week_start : r.month;
      return [
        escapeCsvField(period),
        escapeCsvField((r.total_minor / 10 ** minorUnitExponent(r.currency)).toFixed(minorUnitExponent(r.currency))),
        escapeCsvField(r.currency),
        escapeCsvField(r.sale_count.toString()),
      ];
    });
    const bom = '\uFEFF';
    const csv = [headers.map(escapeCsvField).join(','), ...rows].join('\n');
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report-${startDate}-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = async () => {
    const totalMinor = revenueData.reduce(
      (s: number, r) => s + r.total_minor,
      0,
    );

    await printSalesReceipt(sessionToken, {
      date: new Date().toISOString().slice(0, 10),
      receiptNumber: `RPT-${Date.now()}`,
      items: topProducts.map((p) => ({
        name: p.name,
        quantity: p.total_qty,
        unitPrice: { minorUnits: 0, currency },
        totalPrice: { minorUnits: p.total_minor, currency },
      })),
      subtotal: { minorUnits: totalMinor, currency },
      total: { minorUnits: totalMinor, currency },
      payments: [{ method: 'Report', amount: { minorUnits: totalMinor, currency }, change: null }],
    });
  };

  // P9-3: Calculate deltas — per-currency, never across a collapsed sum.
  const prevRevenueTotals = useMemo(
    () => sumRevenueByCurrency(prevRevenueData),
    [prevRevenueData],
  );
  const prevTotalRevenue = prevRevenueTotals[0]?.total_minor ?? 0;
  const prevMultiCurrencyPeriod = prevRevenueTotals.length > 1;
  const prevTotalOrders = useMemo(
    () => prevRevenueData.reduce((s: number, r) => r.sale_count + s, 0),
    [prevRevenueData],
  );

  // Reshape the trend points into one row per period for recharts: each
  // category becomes a series keyed by its display name.
  const trendData = useMemo(() => {
    const byPeriod = new Map<string, Record<string, number>>();
    for (const p of popularityTrend) {
      const catName =
        p.category_name ??
        requiredLocalized(l10n, 'sales-report-category-popularity-uncategorized');
      if (!byPeriod.has(p.period_start)) {
        byPeriod.set(p.period_start, {});
      }
      byPeriod.get(p.period_start)![catName] = p.score;
    }
    return [...byPeriod.entries()]
      .map(([period_start, cats]) => ({ period_start, ...cats }))
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
  }, [popularityTrend, l10n]);
  const trendCategories = useMemo(() => {
    const names: string[] = [];
    for (const p of popularityTrend) {
      const catName =
        p.category_name ??
        requiredLocalized(l10n, 'sales-report-category-popularity-uncategorized');
      if (!names.includes(catName)) names.push(catName);
    }
    return names;
  }, [popularityTrend, l10n]);

  // The skeleton replaces the whole screen ONLY on the first load (no data
  // rendered yet). Refreshes after a filter change keep the existing content
  // and controls visible (the LoadingStatus `busy` pattern) — otherwise the
  // date picker would unmount mid-refresh and rapid filter changes would be
  // impossible, defeating the REP-06 generation guard this screen uses to
  // discard stale responses.
  if (loading && revenueData.length === 0) {
    return (
      <div className="sales-report-loading-skeleton" aria-hidden="true">
        {/* Header: title + controls */}
        <div className="sales-report-header">
          <Skeleton width="10rem" height="1.75rem" />
          <div className="sales-report-controls">
            <Skeleton width="5rem" height="2rem" />
            <Skeleton width="5rem" height="2rem" />
            <Skeleton width="8rem" height="2rem" />
            <Skeleton width="4rem" height="2rem" />
            <Skeleton width="6rem" height="2rem" />
          </div>
        </div>
        {/* Revenue chart card */}
        <Card shadow="sm" className="sales-report-chart-card">
          <Skeleton width="5rem" height="1.25rem" />
          <Skeleton variant="block" width="100%" height="300px" style={{ borderRadius: 'var(--radius-lg)', marginTop: 'var(--space-3)' }} />
          <div className="sales-report-totals" style={{ marginTop: 'var(--space-3)' }}>
            <Skeleton width="6rem" height="1rem" />
            <Skeleton width="4rem" height="1rem" />
          </div>
        </Card>
        {/* Two-column layout */}
        <div className="sales-report-columns">
          <Card shadow="sm" className="sales-report-chart-card">
            <Skeleton width="6rem" height="1.25rem" />
            <Skeleton variant="block" width="100%" height="250px" style={{ borderRadius: 'var(--radius-lg)', marginTop: 'var(--space-3)' }} />
          </Card>
          <Card shadow="sm" className="sales-report-chart-card">
            <Skeleton width="6rem" height="1.25rem" />
            {/* 4-column table header + 4 skeleton rows */}
            <div className="sales-report-top-header">
              <Skeleton width="1rem" height="0.75rem" />
              <Skeleton width="3rem" height="0.75rem" />
              <Skeleton width="2rem" height="0.75rem" />
              <Skeleton width="3rem" height="0.75rem" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="sales-report-top-row">
                <Skeleton width="1rem" height="0.875rem" />
                <Skeleton width="5rem" height="0.875rem" />
                <Skeleton width="2rem" height="0.875rem" />
                <Skeleton width="4rem" height="0.875rem" />
              </div>
            ))}
          </Card>
        </div>
        {/* Heatmap card */}
        <Card shadow="sm" className="sales-report-chart-card">
          <Skeleton width="6rem" height="1.25rem" />
        </Card>
      </div>
    );
  }

  const revenueKey =
    view === 'daily' ? 'date' : view === 'weekly' ? 'week_start' : 'month';
  const totalOrders = (revenueData ?? []).reduce(
    (s: number, r) => r.sale_count + s,
    0,
  );

  const canCompareRevenue = comparePeriod
    && !multiCurrencyPeriod
    && !prevMultiCurrencyPeriod
    && prevTotalRevenue > 0;
  const revenueDelta = canCompareRevenue
    ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
    : null;
  const ordersDelta = comparePeriod && prevTotalOrders > 0
    ? ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100
    : null;

  return (
    <div className="sales-report" role="region" aria-label={requiredLocalized(l10n, 'sales-report-region-aria')}>
      <div className="sales-report-header">
        <Localized id="sales-report-title">
          <h1 className="sales-report-title">Sales Report</h1>
        </Localized>

        <div className="sales-report-controls">
          <label htmlFor="start-date" className="sales-report-label">
            <Localized id="sales-report-start-date">Start</Localized>
          </label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => { rangeTouched.current = true; setStartDate(e.target.value); }}
            className="sales-report-input"
            aria-label={requiredLocalized(l10n, 'sales-report-start-aria')}
          />

          <label htmlFor="end-date" className="sales-report-label">
            <Localized id="sales-report-end-date">End</Localized>
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => { rangeTouched.current = true; setEndDate(e.target.value); }}
            className="sales-report-input"
            aria-label={requiredLocalized(l10n, 'sales-report-end-aria')}
          />

          <div
            className="sales-report-view-toggle"
            role="radiogroup"
            aria-label={requiredLocalized(l10n, 'sales-report-view-aria')}
          >
            {(['daily', 'weekly', 'monthly'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`sales-report-view-btn ${view === mode ? 'active' : ''}`}
                onClick={() => setView(mode)}
                role="radio"
                aria-checked={view === mode}
                aria-label={l10n.getString(`sales-report-${mode}`)}
              >
                <Localized id={`sales-report-${mode}`}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Localized>
              </button>
            ))}
          </div>

          <Button
            variant={comparePeriod ? 'primary' : 'secondary'}
            onClick={() => setComparePeriod((p) => !p)}
            aria-label={comparePeriod ? (requiredLocalized(l10n, 'sales-report-compare-off-aria')) : (requiredLocalized(l10n, 'sales-report-compare-on-aria'))}
            aria-pressed={comparePeriod}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true" style={{ marginRight: 'var(--space-1)' }}>
              <line x1="12" y1="20" x2="12" y2="10" />
              <line x1="18" y1="20" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="16" />
            </svg>
            <Localized id="sales-report-compare">Compare</Localized>
          </Button>
          <Button
            variant="secondary"
            onClick={printReport}
            aria-label={requiredLocalized(l10n, 'sales-report-print-aria')}
          >
            <Localized id="print">Print</Localized>
          </Button>
          <Button
            variant="secondary"
            onClick={exportCsv}
            aria-label={requiredLocalized(l10n, 'sales-report-export-aria')}
          >
            <Localized id="sales-report-export-csv">Export CSV</Localized>
          </Button>
        </div>
      </div>

      {error && (
        <p className="sales-report-error">
          <Localized id="error-occurred">
            <span>An error occurred</span>
          </Localized>
        </p>
      )}

      <Card shadow="sm" className="sales-report-chart-card">
        <Localized id="sales-report-revenue-chart">
          <h2 className="sales-report-section-title">Revenue</h2>
        </Localized>
        <ResponsiveContainer width="100%" height={300} data-testid="bar-chart">
          <BarChart data={revenueData as unknown as Record<string, unknown>[]}>
            <XAxis
              dataKey={revenueKey}
              tick={{ fontSize: 12 }}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
                  formatter={(value: unknown) => fmtCurrency(Number(value), currency, numLocale)}
            />
            <Bar data-testid="bar"
              dataKey="total_minor"
              fill="var(--color-accent, #4f46e5)"
              radius={[4, 4, 0, 0]}
              aria-label={l10n.getString('sales-report-revenue-label')}
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="sales-report-totals">
          <span>
            <Localized id="sales-report-total-revenue">Total</Localized>:{' '}
            {multiCurrencyPeriod
              ? revenueTotals.map((t) => fmtCurrency(t.total_minor, t.currency, numLocale)).join(' · ')
              : fmtCurrency(totalRevenue, currency, numLocale)}
            {revenueDelta !== null && (
              <span className={`comparison-delta ${revenueDelta >= 0 ? 'comparison-delta--positive' : 'comparison-delta--negative'}`}>
                <span>{revenueDelta >= 0 ? '▲' : '▼'}</span>
                <span>{Math.abs(revenueDelta).toFixed(1)}%</span>
                <span style={{ fontWeight: 400, opacity: 0.6, fontSize: '0.85em' }}>
                  vs {fmtCurrency(prevTotalRevenue, currency, numLocale)}
                </span>
              </span>
            )}
          </span>
          <span>
            <Localized id="sales-report-total-orders">Orders</Localized>:{' '}
            {totalOrders}
            {ordersDelta !== null && (
              <span className={`comparison-delta ${ordersDelta >= 0 ? 'comparison-delta--positive' : 'comparison-delta--negative'}`}>
                <span>{ordersDelta >= 0 ? '▲' : '▼'}</span>
                <span>{Math.abs(ordersDelta).toFixed(1)}%</span>
                <span style={{ fontWeight: 400, opacity: 0.6, fontSize: '0.85em' }}>
                  vs {prevTotalOrders}
                </span>
              </span>
            )}
          </span>
          {/* HPP exposure: gross profit per period (daily, weekly, monthly) */}
          {(revenueData ?? []).length > 0 && (() => {
            const profitTotals = sumGrossProfitByCurrency(revenueData);
            return (
              <span>
                <Localized id="sales-report-total-gross-profit">Gross Profit</Localized>:{' '}
                {profitTotals.map((t) => fmtCurrency(t.gross_profit_minor, t.currency, numLocale)).join(' · ')}
                <span className={`comparison-delta ${profitTotals.every((t) => t.gross_profit_minor >= 0) ? 'comparison-delta--positive' : 'comparison-delta--negative'}`}>
                  <span>
                    {profitTotals.length === 1 && totalRevenue > 0
                      ? `(${((profitTotals[0]!.gross_profit_minor / totalRevenue) * 100).toFixed(1)}%)`
                      : ''}
                  </span>
                </span>
              </span>
            );
          })()}
          {/* REP-04: refunds netted into net revenue for the period */}
          {(revenueData ?? []).length > 0 && (() => {
            const netTotals = sumNetRevenueByCurrency(revenueData);
            if (!netTotals.some((t) => t.refund_minor > 0)) return null;
            return (
              <>
                <span>
                  <Localized id="sales-report-total-refunds">Refunds</Localized>:{' '}
                  {netTotals.map((t) => fmtCurrency(t.refund_minor, t.currency, numLocale)).join(' · ')}
                </span>
                <span>
                  <Localized id="sales-report-total-net-revenue">Net Revenue</Localized>:{' '}
                  {netTotals.map((t) => fmtCurrency(t.net_revenue_minor, t.currency, numLocale)).join(' · ')}
                </span>
              </>
            );
          })()}
        </div>
      </Card>

      {/* Top Products */}
      <Card shadow="sm" className="sales-report-chart-card">
        <div className="sales-report-top-products-header">
          <Localized id="sales-report-top-products">
            <h2 className="sales-report-section-title">Top Products</h2>
          </Localized>
          <div className="sales-report-rank-toggle" role="radiogroup" aria-label={requiredLocalized(l10n, 'sales-report-top-rank-aria')}>
            <div className="sales-report-rank-option">
              <input
                type="radio"
                name="rank-by"
                checked={!rankByProfit}
                onChange={() => setRankByProfit(false)}
                aria-label={requiredLocalized(l10n, 'sales-report-top-rank-revenue-aria')}
              />
              <Localized id="sales-report-top-rank-revenue-aria"><span>Rank by revenue</span></Localized>
            </div>
            <div className="sales-report-rank-option">
              <input
                type="radio"
                name="rank-by"
                checked={rankByProfit}
                onChange={() => setRankByProfit(true)}
                aria-label={requiredLocalized(l10n, 'sales-report-top-rank-profit-aria')}
              />
              <Localized id="sales-report-top-rank-profit-aria"><span>Rank by gross profit</span></Localized>
            </div>
          </div>
        </div>
        {topProducts.length === 0 ? (
          <p className="sales-report-no-data">
            <Localized id="no-results">
              <span>No results</span>
            </Localized>
          </p>
        ) : (
          <div className="sales-report-top-products-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th><Localized id="top-products-name"><span>Name</span></Localized></th>
                  <th><Localized id="top-products-quantity"><span>Qty</span></Localized></th>
                  <th><Localized id="top-products-revenue"><span>Revenue</span></Localized></th>
                  <th><Localized id="top-products-gross-profit"><span>Gross Profit</span></Localized></th>
                  <th><Localized id="top-products-margin"><span>Margin</span></Localized></th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.product_id ?? i}>
                    <td>{i + 1}</td>
                    <td>{p.name}</td>
                    <td>{p.total_qty}</td>
                    <td>{fmtCurrency(p.total_minor, p.currency ?? currency, numLocale)}</td>
                    <td className={p.gross_profit_minor < 0 ? 'sales-report-top-negative' : ''}>
                      {fmtCurrency(p.gross_profit_minor, p.currency ?? currency, numLocale)}
                    </td>
                    <td>{p.gross_margin_percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="sales-report-columns">
        <Card shadow="sm" className="sales-report-chart-card">
          <Localized id="sales-report-category-breakdown">
            <h2 className="sales-report-section-title">By Category</h2>
          </Localized>
          {categoryBreakdown.length === 0 ? (
            <p className="sales-report-no-data">
              <Localized id="no-results">
                <span>No results</span>
              </Localized>
            </p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={categoryBreakdown}
                    dataKey="total_minor"
                    nameKey="category_name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(...args: unknown[]) =>
                      `${String((args[0] as Record<string, unknown>)['category_name'] ?? '')} ${Number((args[0] as Record<string, unknown>)['percentage']).toFixed(0)}%`
                    }
                  >
                    {categoryBreakdown.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]!}
                      />
                     ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
        </Card>

        {/* Category Popularity Leaderboard */}
        <Card shadow="sm" className="sales-report-chart-card">
          <Localized id="sales-report-category-popularity">
            <h2 className="sales-report-section-title">Category Popularity</h2>
          </Localized>
          {categoryPopularity.length === 0 ? (
            <p className="sales-report-no-data">
              <Localized id="no-results">
                <span>No results</span>
              </Localized>
            </p>
          ) : (
            <table className="sales-report-popularity-table">
              <thead>
                <tr>
                  <th><Localized id="sales-report-category-popularity-category"><span>Category</span></Localized></th>
                  <th><Localized id="sales-report-category-popularity-products"><span>Products</span></Localized></th>
                  <th><Localized id="sales-report-category-popularity-mean"><span>Popularity</span></Localized></th>
                  <th><Localized id="sales-report-category-popularity-top"><span>Top Sellers</span></Localized></th>
                </tr>
              </thead>
              <tbody>
                {categoryPopularity.map((cat, i) => (
                  <tr key={cat.category_id ?? i}>
                    <td>{cat.category_name ?? l10n.getString('sales-report-category-popularity-uncategorized')}</td>
                    <td>{cat.product_count}</td>
                    <td>{cat.catalog_ratio.toFixed(1)}×</td>
                    <td>{(cat.top_products as Array<{ name: string; rank: number }>).length > 0
                      ? (cat.top_products as Array<{ name: string; rank: number }>).map(p => `${p.rank}. ${p.name}`).join(' · ')
                      : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card shadow="sm" className="sales-report-chart-card">
          <Localized id="sales-report-popularity-trend">
            <h2 className="sales-report-section-title">Popularity Trend</h2>
          </Localized>
          {popularityTrend.length === 0 ? (
            <p className="sales-report-no-data">
              <Localized id="no-results">
                <span>No results</span>
              </Localized>
            </p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trendData as unknown as Record<string, unknown>[]}>
                  <XAxis
                    dataKey="period_start"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: unknown) => fmtCurrency(Number(value), currency, numLocale)}
                  />
                  {trendCategories.map((name, index) => (
                    <Line
                      key={name}
                      dataKey={name}
                      stroke={PIE_COLORS[index % PIE_COLORS.length]!}
                      strokeWidth={2}
                      aria-label={l10n.getString(`sales-report-category-${name}`)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
        </Card>
      </div>

      <Card shadow="sm" className="sales-report-chart-card">
        <Localized id="sales-report-demand-forecast">
          <h2 className="sales-report-section-title">Demand Forecast</h2>
        </Localized>
        {categoryForecast.length === 0 ? (
          <p className="sales-report-no-data">
            <Localized id="no-results">
              <span>No results</span>
            </Localized>
          </p>
        ) : (
          <>
            <table className="sales-report-forecast-table">
              <thead>
                <tr>
                  <th><Localized id="sales-report-demand-forecast-category"><span>Category</span></Localized></th>
                  <th><Localized id="sales-report-demand-forecast-avg"><span>Avg / period</span></Localized></th>
                  <th><Localized id="sales-report-demand-forecast-trend"><span>Trend</span></Localized></th>
                  <th><Localized id="sales-report-demand-forecast-next"><span>Next period</span></Localized></th>
                </tr>
              </thead>
              <tbody>
                {categoryForecast.map((f, i) => (
                  <tr key={f.category_id ?? i}>
                    <td>{f.category_name}</td>
                    <td>{f.recent_avg_units.toFixed(1)}</td>
                    <td className={f.trend_per_period < 0 ? 'sales-report-forecast-down' : 'sales-report-forecast-up'}>
                      {f.trend_per_period >= 0 ? '▲' : '▼'} {Math.abs(f.trend_per_period).toFixed(1)}
                    </td>
                    <td>{f.forecast_units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart>
                <XAxis
                  dataKey="period_start"
                  tick={{ fontSize: 12 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: unknown) => fmtCurrency(Number(value), currency, numLocale)}
                />
                {categoryForecast.map((_row, index) => (
                  <Line
                    key={index}
                    dataKey="forecast"
                    stroke={PIE_COLORS[index % PIE_COLORS.length]!}
                    strokeWidth={2}
                    aria-label={l10n.getString('sales-report-category-forecast')}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      {/* Hourly Heatmap */}
      <Card shadow="sm" className="sales-report-chart-card">
        <Localized id="sales-report-hourly-heatmap">
          <h2 className="sales-report-section-title">Busiest Hours</h2>
        </Localized>
        {heatmap.length === 0 ? (
          <p className="sales-report-no-data">
            <Localized id="heatmap-no-data">
              <span>No data</span>
            </Localized>
          </p>
        ) : (
          <div className="sales-report-heatmap" role="grid" aria-label={requiredLocalized(l10n, 'sales-report-hourly-heatmap-aria')}>
            {DAY_KEYS.map((dayKey, dayIdx) => (
              <div key={dayKey} className="sales-report-heatmap-row" role="row">
                <div className="sales-report-heatmap-day-label" role="rowheader">
                  <Localized id={`day-${dayKey}`}>
                    <span>{dayKey.charAt(0).toUpperCase() + dayKey.slice(1, 3)}</span>
                  </Localized>
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  // REP-06: one cell may carry several currency rows.
                  // Intensity tracks the display currency only; the label
                  // lists every currency's revenue for the cell.
                  const cells = heatmap.filter(
                    (c) => c.day_of_week === dayIdx && c.hour === h,
                  );
                  const value = cells.reduce(
                    (sum, c) => sum + (c.currency === currency ? c.total_minor : 0),
                    0,
                  );
                  const sales = cells.reduce((sum, c) => sum + c.sale_count, 0);
                  const amounts = cells
                    .map((c) => fmtCurrency(c.total_minor, c.currency, numLocale))
                    .join(' · ');
                  return (
                    <div
                      key={h}
                      className="sales-report-heatmap-cell"
                      role="gridcell"
                      aria-label={
                        cells.length > 0
                          ? `${dayKey.charAt(0).toUpperCase() + dayKey.slice(1, 3)} ${String(h).padStart(2, '0')}:00 - ${amounts || fmtCurrency(0, currency, numLocale)} (${sales} orders)`
                          : `${dayKey.charAt(0).toUpperCase() + dayKey.slice(1, 3)} ${String(h).padStart(2, '0')}:00 - $0.00 (0 orders)`
                      }
                      style={{
                        backgroundColor: value > 0 ? HEATMAP_COLORS[Math.min(Math.floor((value / 50000) * 7), 7)] : 'transparent',
                      }}
                    >
                      {sales > 0 ? sales : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Card>

    </div>
  );
}