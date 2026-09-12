//! Designed card visuals for the analytics grid.
//!
//! Every non-heatmap card renders a purpose-built layout — KPI + trend
//! chart, donut, stacked bar, ranked list, or alert list — fed by the
//! real analytics loaders (CARD_LOADERS). Comparison mode overlays the
//! previous equal-length period per card (delta chips + chart overlays).
//!
//! Charts use echarts (via echarts-for-react), matching the reports
//! DashboardScreen so the analytics page shares the same chart stack.

import { type ReactNode, useMemo, useState } from 'react';
import { useLocalization } from '@fluent/react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart as EBar, LineChart as ELine, PieChart as EPie } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useCurrency } from '@/contexts/CurrencyContext';
import { minorUnitExponent } from '@/types/domain';
import { l10nErrorMessage } from '@/utils/app-error';
import { readCSSVar } from '@/utils/color';
import { useAnalyticsQuery } from './useAnalyticsQuery';
import { cardQueryKey } from './analytics-cache';
import type { MenuEngineeringRow } from '@/api/reports';
import {
  CARD_LOADERS,
  CARD_PAYLOAD_VALIDATORS,
  alignPrevBuckets,
  alignPrevHourly,
  periodDelta,
  previousRange,
  seriesDelta,
  turnDelta,
  type AnalyticsQuery,
  type AovTrend,
  type BasketTrend,
  type Bucket,
  type RankRow,
} from './analytics-data';
import type {
  CategoryBreakdownRow,
  CustomerSplitRow,
  DiscountsSummaryRow,
  InventoryTrendRow,
  InventoryTurnoverRow,
  LowStockAlert,
  PaymentMethodRow,
  TopProductRow,
  VoidedItemRow,
  VoidedSummaryRow,
} from './analytics-data';
import type { StaffAnalyticsRow, TableOccupancy } from './analytics-data';
import type { Granularity, WorkspaceView } from './AnalyticsScreen';
import { PAYMENT_NAMES } from './cards/shared/constants';
import {
  exportCategoryCsv,
  exportCustomersCsv,
  exportDiscountsCsv,
  exportLowStockCsv,
  exportOccupancyCsv,
  exportPaymentsCsv,
  exportRefundsCsv,
  exportStaffCsv,
  exportTopItemsCsv,
  exportTrendCsv,
  exportVoidedItemsCsv,
} from './utils/analyticsCardCsv';

echarts.use([EBar, ELine, EPie, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

// ── Money formatting (mirrors reports DashboardScreen) ───────────────

function useMoney() {
  const { currency } = useCurrency();
  const { l10n } = useLocalization();
  const exp = minorUnitExponent(currency);
  // Number formatting follows the active Fluent locale (en-US / id) so
  // currency strings match the rest of the localized UI — never a
  // hardcoded English locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const fmt = (minor: number) =>
    new Intl.NumberFormat(numLocale, { style: 'currency', currency, maximumFractionDigits: exp }).format(minor / 10 ** exp);
  // REP-06: report rows carry their own currency — format in it, same locale.
  const fmtIn = (minor: number, code: string) => {
    const e = minorUnitExponent(code);
    return new Intl.NumberFormat(numLocale, { style: 'currency', currency: code, maximumFractionDigits: e }).format(minor / 10 ** e);
  };
  const short = (minor: number) =>
    new Intl.NumberFormat(numLocale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(minor / 10 ** exp);
  const count = (n: number) => new Intl.NumberFormat(numLocale).format(n);
  return { fmt, fmtIn, short, count };
}

/**
 * Resolve one chart colour from its theme token with a hex fallback.
 *
 * echarts paints to canvas, where CSS var() strings never resolve — the
 * value must be concrete by the time it reaches an option. readCSSVar
 * returns the computed token on :root (empty under jsdom/tests), and the
 * fallback keeps the chart's look stable in every environment where the
 * stylesheet is absent. Each fallback is the value this chart shipped
 * before the token pass, so a bare test DOM renders byte-identical output.
 */
function chartColor(varName: string, fallback: string): string {
  return readCSSVar(varName) ?? fallback;
}

/**
 * Per-card accent colours, read from the theme's semantic tokens (same
 * source every themed surface uses) with the pre-token hexes as fallbacks:
 * indigo→--color-accent, blue→--color-accent-secondary, cyan→--color-info,
 * green→--color-success, amber→--color-warning, red→--color-danger,
 * violet→--color-purple, grey→--color-fg-muted.
 */
const PALETTE_TOKENS = [
  ['--color-accent', '#4f46e5'],
  ['--color-accent-secondary', '#3b82f6'],
  ['--color-info', '#06b6d4'],
  ['--color-success', '#22c55e'],
  ['--color-warning', '#f59e0b'],
  ['--color-warning-pos', '#f97316'],
  ['--color-danger', '#ef4444'],
  ['--color-purple', '#8b5cf6'],
] as const;

/** The palette as echarts needs it: concrete colour strings. */
const PALETTE: string[] = PALETTE_TOKENS.map(([varName, fallback]) => chartColor(varName, fallback));

/** Chart line/bar colours that carry one semantic meaning across cards. */
const CHART_ACCENT = chartColor('--color-accent', '#4f46e5');
const CHART_PREV = chartColor('--color-fg-muted', '#94a3b8');
const CHART_BASKET = chartColor('--color-info', '#06b6d4');
const CHART_INVENTORY = chartColor('--color-success', '#22c55e');
const CHART_TABLES = chartColor('--color-warning', '#f59e0b');
/** Legend/donut tint for the customers card's returning segment (accent-subtle). */
const CHART_ACCENT_SOFT = chartColor('--color-accent-subtle', '#c7d2fe');
/** Donut segment separators. The analytics surface is a fixed light card
 *  (AUT-1 scoped tokens in AnalyticsScreen.css), so the border stays the
 *  card's white surface rather than a theme-dependent token. */
const DONUT_BORDER = '#fff';
/** Axis text — theme-neutral grey, matching the pre-token value. */
const CHART_TEXT = chartColor('--color-fg-muted', '#94a3b8');

/** Stable empty bucket list — the AOV card's `data?.buckets` fallback so a
 *  fresh `[]` literal isn't recreated every render (a referential-stability
 *  fix for the chart's `useMemo` dependency array). */
const NO_BUCKETS: Bucket[] = [];

/** Stable empty hourly occupancy curve — the occupancy card's `hourly` fallback
 *  so a fresh `[]` literal isn't recreated every render (same referential-
 *  stability fix as {@link NO_BUCKETS}). */
const NO_HOURLY: { hour: number; table_orders: number; pct: number; level: number }[] = [];

/** Stable empty number list — the occupancy card's `prevPct` fallback (same
 *  referential-stability fix as {@link NO_BUCKETS}). */
const NO_NUMBERS: number[] = [];

/**
 * Stock at or below this many units is flagged "critical" (vs merely
 * "low") in the low-stock card — the red severity tier that precedes a
 * full out-of-stock.
 */
const CRITICAL_STOCK_LEVEL = 5;

/**
 * Chart height per card, collapsed vs expanded (px). Kept in one place so
 * the layout proportions are tunable without hunting literals across every
 * card component.
 */
const CHART_HEIGHT: Record<string, { base: number; expanded: number }> = {
  revenue: { base: 104, expanded: 240 },
  aov: { base: 104, expanded: 240 },
  customers: { base: 118, expanded: 210 },
  payments: { base: 84, expanded: 180 },
  category: { base: 118, expanded: 210 },
  inventory: { base: 80, expanded: 170 },
  tables: { base: 104, expanded: 240 },
  basket: { base: 104, expanded: 240 },
  occupancy: { base: 64, expanded: 150 },
};

/** Resolve a card's chart height for its current expanded state. */
function chartHeight(cardKey: string, expanded?: boolean | undefined): number {
  const h = CHART_HEIGHT[cardKey] ?? CHART_HEIGHT['revenue']!;
  return expanded ? h.expanded : h.base;
}

// ── Shared building blocks ──────────────────────────────────────────

/**
 * Wrapper that hosts the card content. Every card runs on real backend
 * data — there is no demo-data path left.
 */
function Visual({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`analytics-card-visual${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

/** Shown while a real-data card's IPC query is still in flight. */
function CardLoading() {
  return (
    <div className="analytics-card-skeleton">
      <div className="skeleton-bar skeleton-bar--sm" />
      <div className="skeleton-bar skeleton-bar--lg" />
      <div className="skeleton-bar skeleton-bar--md" />
    </div>
  );
}

/**
 * Shown when a card's IPC query failed.
 *
 * The query layer records the failure and does NOT re-invoke the fetcher
 * on re-render, so this is a stable state — the screen's refresh action
 * clears the recorded failure and retries. Only the localized user-safe
 * copy is rendered (ERR-05), never the raw backend message.
 */
function CardError({ error }: { error: unknown }) {
  const { l10n } = useLocalization();
  const message = l10nErrorMessage(error, l10n, 'analytics-card-error-load');
  return (
    <div className="analytics-card-error" role="alert">
      <span className="analytics-card-error-icon" aria-hidden="true">⚠</span>
      <span className="analytics-card-error-text">{message}</span>
    </div>
  );
}

/** Muted "no data" placeholder for a card whose query returned zero rows. */
function CardEmpty({ message }: { message: string }) {
  return (
    <div className="analytics-card-empty" role="status">
      {message}
    </div>
  );
}

/** Big KPI number with a small caption underneath. */
function Kpi({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="analytics-kpi">
      <span className={`analytics-kpi-value${tone ? ` analytics-kpi-value--${tone}` : ''}`}>{value}</span>
      <span className="analytics-kpi-label">{label}</span>
    </div>
  );
}

/** Small CSV export action — aria label describes what the card exports. */
export function ExportCsvButton({ onClick, ariaLabel }: { onClick: () => void; ariaLabel: string }) {
  const { l10n } = useLocalization();
  return (
    <button
      type="button"
      className="analytics-export-btn"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>{l10n.getString('analytics-export-csv')}</span>
    </button>
  );
}

/** Column labels for the staff-performance CSV (localized). */
function DeltaChip({ value, tone, compare }: { value: number; tone?: 'good' | 'bad'; compare?: boolean }) {
  const { l10n } = useLocalization();
  const up = value >= 0;
  // For metrics where up is bad (voids, refunds, restock cost, turn time)
  // the pill's colour follows the *semantic* direction, not the sign.
  const good = tone === 'bad' ? !up : up;
  return (
    <span className={`analytics-delta${good ? ' analytics-delta--up' : ' analytics-delta--down'}`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%{compare ? ` ${l10n.getString('analytics-card-vs-prev')}` : ''}
    </span>
  );
}

/**
 * Buckets with real activity. Zero-filled gaps mean "no data that
 * day" (no sales / no table orders), not a 0-value reading — rate
 * metrics (AOV, turn minutes) must average and trend over the active
 * buckets only. Sum metrics (revenue) keep the zeros: $0 is a real day.
 */
function activeBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.filter((b) => b.value > 0);
}

/** Compact ranked list with proportional bars — no chart lib needed. */
function RankedList({ rows, ariaLabel, limit }: { rows: RankRow[]; ariaLabel: string; limit?: number | undefined }) {
  const { l10n } = useLocalization();
  const shown = limit !== undefined ? rows.slice(0, limit) : rows;
  const max = Math.max(...shown.map((r) => r.value), 1);
  return (
    <ul className="analytics-rank-list" aria-label={ariaLabel}>
      {shown.map((r, i) => (
        <li
          key={`${r.name}-${i}`}
          className="analytics-rank-row"
          aria-label={r.delta !== undefined
            ? l10n.getString('analytics-rank-delta-aria', {
                name: r.name,
                value: r.display,
                dir: l10n.getString(r.delta >= 0 ? 'analytics-rank-up' : 'analytics-rank-down'),
                pct: Math.abs(r.delta).toFixed(1),
              })
            : undefined}
        >
          <span className="analytics-rank-index">{i + 1}</span>
          <span className="analytics-rank-name">{r.name}</span>
          <span className="analytics-rank-bar-track">
            <span className="analytics-rank-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          {r.delta !== undefined && (
            <span
              className={`analytics-rank-delta${r.delta >= 0 ? ' analytics-rank-delta--up' : ' analytics-rank-delta--down'}`}
              aria-hidden="true"
            >
              {r.delta >= 0 ? '▲' : '▼'} {Math.abs(r.delta).toFixed(1)}%
            </span>
          )}
          <span className="analytics-rank-value">{r.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Color dot + name + value legend (used beside donuts and stacked bars). */
function Legend({ items }: { items: { name: string; value: string; color: string }[] }) {
  return (
    <ul className="analytics-legend">
      {items.map((it) => (
        <li key={it.name} className="analytics-legend-item">
          <span className="analytics-legend-dot" style={{ background: it.color }} />
          <span className="analytics-legend-name">{it.name}</span>
          <span className="analytics-legend-value">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Per-card layouts ────────────────────────────────────────────────

/**
 * Per-card cached query — keyed by (card, workspace, granularity, range)
 * so an identical query revisits the TTL cache instead of refetching.
 * Every card loads through `CARD_LOADERS` (real backend data).
 * Returns `null` while an async query is in flight.
 *
 * `enabled=false` (the comparison baseline while compare mode is off)
 * never fetches and always yields `data: null`.
 */
function useCardData<T>(
  cardKey: string,
  q: AnalyticsQuery,
  enabled = true,
): { data: T | null; error: unknown } {
  const result = useAnalyticsQuery(
    cardQueryKey(cardKey, q.workspace, q.granularity, q.from, q.to),
    () => {
      const loader = CARD_LOADERS[cardKey] as ((query: AnalyticsQuery) => Promise<T>) | undefined;
      if (!loader) return null as T;
      return loader(q);
    },
    enabled,
    CARD_PAYLOAD_VALIDATORS[cardKey],
  );
  return { data: result.data as T | null, error: result.error };
}

/**
 * Period-over-period variant: the current query plus the previous
 * equal-length window, both through the shared TTL cache. The baseline
 * only fetches while `compare` is on, so compare mode costs nothing when
 * it is off; a failing baseline just yields `prev: null` (no chip).
 */
function useCardDataCompare<T>(
  cardKey: string,
  q: AnalyticsQuery,
  compare: boolean,
): { data: T | null; prev: T | null; error: unknown } {
  const cur = useCardData<T>(cardKey, q);
  const prevQ = useMemo(
    () => previousRange(q),
    [q],
  );
  const prev = useCardData<T>(cardKey, prevQ, compare);
  return { data: cur.data, prev: prev.data, error: cur.error };
}

/**
 * Attach per-row deltas to a ranked list by matching row names against
 * the previous period. Rows absent from the baseline keep no chip.
 */
function rowDeltas(cur: RankRow[], prev: RankRow[] | null | undefined): RankRow[] {
  if (!prev) return cur;
  const prevByName = new Map(prev.map((r) => [r.name, r.value]));
  return cur.map((r) => {
    const pv = prevByName.get(r.name);
    const d = pv !== undefined ? periodDelta(r.value, pv) : null;
    return d !== null ? { ...r, delta: d } : r;
  });
}

function RevenueCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt, short } = useMoney();
  const { data, prev, error } = useCardDataCompare<Bucket[]>('revenue', q, compare ?? false);
  const prevData = prev ?? NO_BUCKETS;
  const total = data ? data.reduce((s, d) => s + d.value, 0) : 0;
  const prevTotal = prevData.reduce((s, d) => s + d.value, 0);
  const peak = data && data.length ? data.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = data && data.length ? data.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  // Compare mode replaces the in-period trend with the true period-over-
  // period change; off-mode keeps the existing series delta.
  const delta = compare ? periodDelta(total, prevTotal) : data ? seriesDelta(data) : null;
  const option = useMemo(() => (data ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => fmt(Number(v)) },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        name: l10n.getString('analytics-card-revenue'),
        type: 'line' as const, data: data.map((d) => d.value),
        smooth: true, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: CHART_ACCENT }, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 },
      },
      ...(compare && prevData.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prevData),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prevData, compare, fmt, l10n]);
  if (error) return <CardError error={error} />;
  if (!data) return <CardLoading />;
  return (
    <Visual className="analytics-card-visual--revenue">
      <div className="analytics-kpi-row">
        <Kpi value={short(total)} label={l10n.getString('analytics-card-total-revenue')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-revenue-aria')} onClick={() => exportTrendCsv('revenue', l10n.getString('analytics-export-col-revenue'), data, q.from, q.to, (id) => l10n.getString(id), fmt)} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('revenue', expanded) }} notMerge />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: short(peak.value) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: short(low.value) })}</p>}
    </Visual>
  );
}

function AovCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  const { data, prev, error } = useCardDataCompare<AovTrend>('aov', q, compare ?? false);
  const buckets = data ? data.buckets : NO_BUCKETS;
  const prevBuckets = prev ? prev.buckets : NO_BUCKETS;
  const active = activeBuckets(buckets);
  // True average order value: total revenue ÷ total orders across the
  // range (a weighted average), not an unweighted mean of per-bucket AOVs.
  const avg = data && data.total_orders > 0 ? Math.round(data.total_minor / data.total_orders) : 0;
  const prevAvg = prev && prev.total_orders > 0 ? Math.round(prev.total_minor / prev.total_orders) : 0;
  // Peak/Low come from the active buckets — a zero-filled no-sales day is
  // not a $0 AOV reading.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const delta = compare ? periodDelta(avg, prevAvg) : active.length ? seriesDelta(active) : null;
  const option = useMemo(() => (buckets.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => fmt(Number(v)) },
    xAxis: {
      type: 'category' as const, data: buckets.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'line' as const, data: buckets.map((d) => d.value),
        smooth: true, symbol: 'circle', symbolSize: 4,
        itemStyle: { color: CHART_ACCENT }, areaStyle: { opacity: 0.12 }, lineStyle: { width: 2 },
      },
      ...(compare && prevBuckets.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(buckets, prevBuckets),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [buckets, prevBuckets, compare, fmt, l10n]);
  if (error) return <CardError error={error} />;
  if (!data) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={fmt(avg)} label={l10n.getString('analytics-card-aov')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-aov-aria')} onClick={() => exportTrendCsv('aov', l10n.getString('analytics-export-col-aov'), buckets, q.from, q.to, (id) => l10n.getString(id), fmt)} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('aov', expanded) }} notMerge />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: fmt(peak.value) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: fmt(low.value) })}</p>}
    </Visual>
  );
}

function StaffCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { short, fmt } = useMoney();
  const { data: staff, prev: prevStaff, error } = useCardDataCompare<StaffAnalyticsRow[]>('staff', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!staff) return <CardLoading />;
  if (staff.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const buildRows = (rows: StaffAnalyticsRow[]): RankRow[] => rows
    .slice()
    .sort((a, b) => b.sale_total_minor - a.sale_total_minor)
    .map((r) => ({ name: r.display_name, value: r.sale_total_minor, display: short(r.sale_total_minor) }));
  const rows = rowDeltas(buildRows(staff), prevStaff ? buildRows(prevStaff) : null);
  const totalSales = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prevStaff ? prevStaff.reduce((s, r) => s + r.sale_total_minor, 0) : 0;
  const delta = compare ? periodDelta(totalSales, prevTotal) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={short(totalSales)} label={l10n.getString('analytics-card-staff-sales')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-csv-aria')} onClick={() => exportStaffCsv('staff-performance', staff, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}

function CustomersCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { count } = useMoney();
  const { data: split, prev: prevSplit, error } = useCardDataCompare<CustomerSplitRow>('customers', q, compare ?? false);
  const newCount = split ? split.new_count : 0;
  const retCount = split ? split.returning_count : 0;
  const total = newCount + retCount;
  const prevTotal = prevSplit ? prevSplit.new_count + prevSplit.returning_count : 0;
  const newPct = total > 0 ? Math.round((newCount / total) * 100) : 0;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  const option = useMemo(() => (split ? ({
    tooltip: { trigger: 'item' as const },
    series: [{
      type: 'pie' as const, radius: ['58%', '82%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: DONUT_BORDER, borderWidth: 2 },
      label: { show: false }, emphasis: { scaleSize: 4 },
      data: [
        { value: newCount, name: l10n.getString('analytics-card-customers-new'), itemStyle: { color: CHART_ACCENT } },
        { value: retCount, name: l10n.getString('analytics-card-customers-returning'), itemStyle: { color: CHART_ACCENT_SOFT } },
      ],
    }],
  }) : null), [newCount, retCount, l10n, split]);
  if (error) return <CardError error={error} />;
  if (!split) return <CardLoading />;
  if (newCount + retCount === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      <div className="analytics-kpi-row">
        <Kpi value={count(total)} label={l10n.getString('analytics-card-customers-total')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-customers-aria')} onClick={() => exportCustomersCsv(split, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart analytics-card-chart--donut" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('customers', expanded) }} notMerge />
      </div>
      <Legend items={[
        { name: l10n.getString('analytics-card-customers-new'), value: count(newCount), color: CHART_ACCENT },
        { name: l10n.getString('analytics-card-customers-returning'), value: count(retCount), color: CHART_ACCENT_SOFT },
      ]} />
      <p className="analytics-card-insight">
        {l10n.getString('analytics-card-customers-new-share', { pct: String(newPct) })}
      </p>
    </Visual>
  );
}

function largestRemainderPcts(values: number[], total: number): number[] {
  if (total <= 0 || values.length === 0) return values.map(() => 0);
  const shares = values.map((v) => (v / total) * 100);
  const pcts = shares.map((s) => Math.floor(s));
  let remainder = 100 - pcts.reduce((sum, p) => sum + p, 0);
  const byFraction = shares
    .map((s, i) => ({ i, fraction: s - Math.floor(s) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    pcts[i] = (pcts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return pcts;
}

function PaymentsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  const { data: rows, prev: prevRows, error } = useCardDataCompare<PaymentMethodRow[]>('payments', q, compare ?? false);
  const total = rows ? rows.reduce((s, r) => s + r.total_minor, 0) : 0;
  const prevTotal = prevRows ? prevRows.reduce((s, r) => s + r.total_minor, 0) : 0;
  // Largest-remainder rounding so the stacked bar always sums to 100. The
  // segments + percentages are derived together so the chart's useMemo sees
  // one stable pair (no fresh `[]` fallback each render).
  const { segs, pcts } = useMemo(() => {
    if (!rows) return { segs: [] as { key: string; name: string; pct: number }[], pcts: [] as number[] };
    const pctByMethod = largestRemainderPcts(rows.map((r) => r.total_minor), total);
    const segs = rows.map((r, i) => ({
      key: r.payment_method,
      name: PAYMENT_NAMES[r.payment_method] ? l10n.getString(PAYMENT_NAMES[r.payment_method]!) : r.payment_method,
      pct: pctByMethod[i] ?? 0,
    }));
    return { segs, pcts: segs.map((s) => s.pct) };
  }, [rows, total, l10n]);
  const topPct = pcts.length ? Math.max(...pcts) : 0;
  const topSeg = segs[pcts.indexOf(topPct)];
  const delta = compare ? periodDelta(total, prevTotal) : null;
  const option = useMemo(() => (segs.length ? ({
    grid: { left: 8, right: 8, top: 8, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, valueFormatter: (v: unknown) => `${v}%` },
    xAxis: { type: 'value' as const, show: false },
    yAxis: { type: 'category' as const, data: [l10n.getString('analytics-card-payments')], show: false },
    series: segs.map((s, i) => ({
      name: s.name, type: 'bar' as const, stack: 'total', barWidth: 16,
      itemStyle: {
        color: PALETTE[i % PALETTE.length],
        borderRadius: i === segs.length - 1 ? [0, 4, 4, 0] : 0,
      },
      data: [pcts[i]],
    })),
  }) : null), [segs, pcts, l10n]);
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  if (rows.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      <div className="analytics-kpi-row">
        {topSeg && <Kpi value={`${topSeg.name} · ${topPct}%`} label={l10n.getString('analytics-card-payments-top')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-payments-aria')} onClick={() => exportPaymentsCsv(rows, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('payments', expanded) }} notMerge />
      </div>
      <Legend items={segs.map((s, i) => ({ name: s.name, value: `${s.pct}%`, color: PALETTE[i % PALETTE.length]! }))} />
    </Visual>
  );
}

function DiscountsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: summary, prev: prevSummary, error } = useCardDataCompare<DiscountsSummaryRow>('discounts', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!summary) return <CardLoading />;
  if (summary.codes.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const rows: RankRow[] = summary.codes.map((c) => ({
    name: c.label,
    value: c.redeemed_count,
    display: `${c.redeemed_count} ${l10n.getString('analytics-card-discounts-redeemed')}`,
  }));
  const discountShare = summary.share_percent;
  const redeemed = summary.codes.reduce((s, c) => s + c.redeemed_count, 0);
  const prevRedeemed = prevSummary ? prevSummary.codes.reduce((s, c) => s + c.redeemed_count, 0) : 0;
  const delta = compare ? periodDelta(redeemed, prevRedeemed) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={`${discountShare.toFixed(1)}%`} label={l10n.getString('analytics-card-discounts-share')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-discounts-aria')} onClick={() => exportDiscountsCsv(summary, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}

function RefundsCard({ q, compare }: { q: AnalyticsQuery; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmtIn, count } = useMoney();
  // REP-06: voided totals arrive as one row per currency.
  const { data: rows, prev: prevRows, error } = useCardDataCompare<VoidedSummaryRow[]>('refunds', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  const totalCount = rows.reduce((s, r) => s + r.void_count, 0);
  if (totalCount === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const amountDisplay = rows.map((r) => fmtIn(r.void_total_minor, r.currency)).join(' · ');
  const avgDisplay = rows
    .map((r) => fmtIn(r.void_count > 0 ? Math.round(r.void_total_minor / r.void_count) : 0, r.currency))
    .join(' · ');
  const delta =
    compare && prevRows
      ? periodDelta(totalCount, prevRows.reduce((s, r) => s + r.void_count, 0))
      : null;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={count(totalCount)} label={l10n.getString('analytics-card-refunds-count')} tone="bad" />
        <Kpi value={amountDisplay} label={l10n.getString('analytics-card-refunds-amount')} tone="bad" />
        <Kpi value={avgDisplay} label={l10n.getString('analytics-card-refunds-avg')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-refunds-aria')} onClick={() => exportRefundsCsv(rows, q.from, q.to, fmtIn, (id) => l10n.getString(id))} />
      </div>
    </Visual>
  );
}

function TopItemsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { short, fmt } = useMoney();
  const { data: raw, prev: prevRaw, error } = useCardDataCompare<(TopProductRow | MenuEngineeringRow)[]>('top-items', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!raw) return <CardLoading />;
  if (raw.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const buildRows = (list: (TopProductRow | MenuEngineeringRow)[]): RankRow[] => list.map((r) => {
    if ('total_qty' in r) {
      return { name: r.name, value: r.total_minor, display: `${short(r.total_minor)} · ${r.total_qty}×` };
    }
    return { name: r.name, value: r.total_revenue_minor, display: `${short(r.total_revenue_minor)} · ${r.total_volume}×` };
  });
  const rows = rowDeltas(buildRows(raw), prevRaw ? buildRows(prevRaw) : null);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prevRaw ? prevRaw.reduce((s, r) => s + ('total_qty' in r ? r.total_minor : r.total_revenue_minor), 0) : 0;
  const topName = rows[0]?.name;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        {topName && <Kpi value={topName} label={l10n.getString('analytics-card-top-product')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-top-items-aria')} onClick={() => exportTopItemsCsv(raw, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}

function CategoryCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmtIn } = useMoney();
  const { currency: displayCurrency } = useCurrency();
  const { data: rows, prev: prevRows, error } = useCardDataCompare<CategoryBreakdownRow[]>('category', q, compare ?? false);
  // REP-06a: one pie PER CURRENCY. The backend normalizes percentages
  // within each currency, and minor units across currencies are not
  // area-comparable (IDR ×10⁴ dwarfs USD) — mixing them in one pie was
  // the visual lie. Tabs appear only when the range spans currencies;
  // the display currency picks the default tab.
  const currencies = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows ?? []) if (!seen.includes(r.currency)) seen.push(r.currency);
    return seen;
  }, [rows]);
  const [tab, setTab] = useState<string | null>(null);
  const active =
    tab !== null && currencies.includes(tab)
      ? tab
      : currencies.includes(displayCurrency)
        ? displayCurrency
        : currencies[0] ?? null;
  const visible = useMemo(
    () => (rows ?? []).filter((r) => r.currency === active),
    [rows, active],
  );
  const { names, pcts } = useMemo(() => {
    if (!visible.length) return { names: [] as string[], pcts: [] as number[] };
    return {
      names: visible.map((r) => r.category_name).slice(0, 8),
      pcts: visible.map((r) => Math.round(r.percentage)).slice(0, 8),
    };
  }, [visible]);
  const topName = pcts.length ? names[pcts.indexOf(Math.max(...pcts))] : '';
  const total = visible.reduce((s, r) => s + r.total_minor, 0);
  const prevTotal = prevRows
    ? prevRows.filter((r) => r.currency === active).reduce((s, r) => s + r.total_minor, 0)
    : 0;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  const option = useMemo(() => (names.length ? ({
    tooltip: { trigger: 'item' as const },
    series: [{
      type: 'pie' as const, radius: ['58%', '82%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 4, borderColor: DONUT_BORDER, borderWidth: 2 },
      label: { show: false }, emphasis: { scaleSize: 4 },
      data: names.map((n, i) => ({ value: pcts[i], name: n, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
    }],
  }) : null), [names, pcts]);
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  if (rows.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      {currencies.length > 1 && (
        <div className="analytics-granularity" role="group" aria-label={l10n.getString('analytics-category-currency-aria')}>
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              className={`analytics-granularity-btn${c === active ? ' analytics-granularity-btn--active' : ''}`}
              aria-pressed={c === active}
              onClick={() => setTab(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="analytics-kpi-row">
        {topName && <Kpi value={topName} label={l10n.getString('analytics-card-category-top')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-category-aria')} onClick={() => exportCategoryCsv(rows, q.from, q.to, fmtIn, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart analytics-card-chart--donut" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('category', expanded) }} notMerge />
      </div>
      <Legend items={names.map((n, i) => ({ name: n, value: `${pcts[i]}%`, color: PALETTE[i % PALETTE.length]! }))} />
    </Visual>
  );
}

function BasketCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: basket, prev: prevBasket, error } = useCardDataCompare<BasketTrend>('basket', q, compare ?? false);
  const data = basket ? basket.buckets : NO_BUCKETS;
  const prevData = prevBasket ? prevBasket.buckets : NO_BUCKETS;
  const avg = basket ? basket.avg_line_count : 0;
  const orders = basket ? basket.sale_count : 0;
  const prevAvg = prevBasket ? prevBasket.avg_line_count : 0;
  const active = activeBuckets(data);
  // Peak/Low come from the active buckets — a zero-filled no-sales day is
  // not a 0.0 items/order reading.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const delta = compare ? periodDelta(avg, prevAvg) : null;
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'bar' as const, data: data.map((d) => d.value),
        itemStyle: { color: CHART_BASKET, borderRadius: [3, 3, 0, 0] }, barWidth: '55%',
      },
      ...(compare && prevData.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prevData),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prevData, compare, l10n]);
  if (error) return <CardError error={error} />;
  if (!basket) return <CardLoading />;
  // Real per-bucket basket size from the backend — average items per order
  // per bucket, with the range totals as the KPI tiles.
  return (
    <Visual>
      <div className={`analytics-kpi-tiles${expanded ? ' analytics-kpi-tiles--expanded' : ''}`}>
        <Kpi value={avg > 0 ? avg.toFixed(1) : '—'} label={l10n.getString('analytics-card-basket-items')} />
        <Kpi value={orders > 0 ? String(orders) : '—'} label={l10n.getString('analytics-card-basket-orders')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-basket-aria')} onClick={() => exportTrendCsv('basket', l10n.getString('analytics-export-col-basket'), data, q.from, q.to, (id) => l10n.getString(id), (v) => v.toFixed(1))} />
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('basket', expanded) }} notMerge />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: peak.value.toFixed(1) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: low.value.toFixed(1) })}</p>}
    </Visual>
  );
}

function InventoryCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: loaded, prev: prevLoaded, error } = useCardDataCompare<[InventoryTurnoverRow, InventoryTrendRow[]]>('inventory', q, compare ?? false);
  const [turnoverRow, trend]: [InventoryTurnoverRow | null, InventoryTrendRow[]] = loaded ?? [null, []];
  const [prevRow, prevTrend]: [InventoryTurnoverRow | null, InventoryTrendRow[]] = prevLoaded ?? [null, []];
  const turnover = turnoverRow && turnoverRow.stock_on_hand > 0 ? turnoverRow.units_sold / turnoverRow.stock_on_hand : 0;
  const prevTurnover = prevRow && prevRow.stock_on_hand > 0 ? prevRow.units_sold / prevRow.stock_on_hand : 0;
  const data: Bucket[] = trend.map((t) => ({ label: t.date.slice(5), value: t.units_sold }));
  const prevData: Bucket[] = prevTrend.map((t) => ({ label: t.date.slice(5), value: t.units_sold }));
  const skus = turnoverRow ? turnoverRow.sku_count : 0;
  const daysOfStock = turnoverRow && turnover > 0 ? Math.max(1, Math.round(turnoverRow.range_days / turnover)) : 0;
  const delta = compare ? periodDelta(turnover, prevTurnover) : null;
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 10, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'line' as const, data: data.map((d) => d.value),
        smooth: true, symbol: 'none', lineStyle: { width: 2, color: CHART_INVENTORY },
        areaStyle: { opacity: 0.12 }, itemStyle: { color: CHART_INVENTORY },
      },
      ...(compare && prevData.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prevData),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prevData, compare, l10n]);
  if (error) return <CardError error={error} />;
  if (!loaded) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={turnover > 0 ? `${turnover.toFixed(1)}×` : '—'} label={l10n.getString('analytics-card-inventory-turnover')} />
        <Kpi value={daysOfStock > 0 ? l10n.getString('analytics-unit-days', { n: daysOfStock }) : '—'} label={l10n.getString('analytics-card-inventory-days')} />
        <Kpi value={String(skus)} label={l10n.getString('analytics-card-inventory-skus')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-inventory-aria')} onClick={() => exportTrendCsv('inventory', l10n.getString('analytics-export-col-units'), data, q.from, q.to, (id) => l10n.getString(id), (v) => String(v))} />
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('inventory', expanded) }} notMerge />
      </div>
    </Visual>
  );
}

function LowStockCard({ q, title, expanded }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  // Low-stock alerts are a live inventory snapshot with no time-bounded
  // history, so a period-over-period baseline would diff the snapshot
  // against itself (a spurious 0.0% chip). Load through the plain
  // single-window hook and never render a compare delta.
  const { data: alerts, error } = useCardData<LowStockAlert[]>('low-stock', q);
  if (error) return <CardError error={error} />;
  if (!alerts) return <CardLoading />;
  if (alerts.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-low-stock')} />;
  const rows = alerts.map((a) => ({
    name: a.name,
    stock: a.current_qty,
    reorder: Math.max(0, a.threshold - a.current_qty),
    cost: a.cost_minor,
  }));
  const restockCost = rows.reduce((s, r) => s + r.reorder * r.cost, 0);
  const criticalCount = rows.filter((r) => r.stock <= CRITICAL_STOCK_LEVEL).length;
  // Collapsed cards cap the alert list; expanding reveals every alert.
  const shown = expanded ? rows : rows.slice(0, 5);
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={fmt(restockCost)} label={l10n.getString('analytics-card-low-stock-restock')} tone="bad" />
        <Kpi value={String(rows.length)} label={l10n.getString('analytics-card-low-stock-items')} />
        <Kpi value={String(criticalCount)} label={l10n.getString('analytics-card-low-stock-critical')} tone="bad" />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-low-stock-aria')} onClick={() => exportLowStockCsv(alerts, q.from, q.to, fmt, (id) => l10n.getString(id))} />
      </div>
      <ul className="analytics-alert-list" aria-label={title}>
        {shown.map((r, i) => {
          const critical = r.stock <= CRITICAL_STOCK_LEVEL;
          return (
            <li key={`${r.name}-${i}`} className="analytics-alert-row">
              <span className={`analytics-alert-dot${critical ? ' analytics-alert-dot--critical' : ' analytics-alert-dot--warn'}`} />
              <span className="analytics-alert-name">{r.name}</span>
              <span className="analytics-alert-count">{r.stock} {l10n.getString('analytics-card-low-stock-left')}</span>
              <span className="analytics-alert-reorder">{l10n.getString('analytics-card-low-stock-order', { n: r.reorder })}</span>
            </li>
          );
        })}
      </ul>
    </Visual>
  );
}

function TablesCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: raw, prev: prevRaw, error } = useCardDataCompare<Bucket[]>('tables', q, compare ?? false);
  const data = raw ?? NO_BUCKETS;
  const prevData = prevRaw ?? NO_BUCKETS;
  const active = activeBuckets(data);
  const prevActive = activeBuckets(prevData);
  const avgTurn = active.length ? Math.round(active.reduce((s, d) => s + d.value, 0) / active.length) : 0;
  const prevAvgTurn = prevActive.length ? Math.round(prevActive.reduce((s, d) => s + d.value, 0) / prevActive.length) : 0;
  // Peak/Low come from the active buckets — a zero-filled no-order day is
  // not a 0-minute turn.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  // Compare mode shows the period-over-period change; off-mode keeps the
  // in-series turn-time delta over the active buckets (faster turns =
  // shorter minutes; zero-filled no-order days are not "0-minute turns").
  const delta = compare ? periodDelta(avgTurn, prevAvgTurn) : turnDelta(active);
  const option = useMemo(() => (data.length ? ({
    grid: { left: 8, right: 8, top: 12, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => l10n.getString('analytics-unit-minutes', { n: String(v) }) },
    xAxis: {
      type: 'category' as const, data: data.map((d) => d.label),
      axisLabel: { fontSize: 9, color: CHART_TEXT }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false },
    series: [
      {
        type: 'bar' as const, data: data.map((d) => d.value),
        itemStyle: { color: CHART_TABLES, borderRadius: [3, 3, 0, 0] }, barWidth: '55%',
      },
      ...(compare && prevData.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: alignPrevBuckets(data, prevData),
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }) : null), [data, prevData, compare, l10n]);
  if (error) return <CardError error={error} />;
  if (!raw) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={avgTurn > 0 ? l10n.getString('analytics-unit-minutes', { n: String(avgTurn) }) : '—'} label={l10n.getString('analytics-card-tables-turn')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-tables-aria')} onClick={() => exportTrendCsv('tables', l10n.getString('analytics-export-col-turn'), data, q.from, q.to, (id) => l10n.getString(id), (v) => String(Math.round(v)))} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <ReactEChartsCore echarts={echarts} option={option!} style={{ height: chartHeight('tables', expanded) }} notMerge />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: l10n.getString('analytics-unit-minutes', { n: String(peak.value) }) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: l10n.getString('analytics-unit-minutes', { n: String(low.value) }) })}</p>}
    </Visual>
  );
}

function OccupancyCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  // Real rate from the live tables snapshot + real per-hour completed table
  // orders from the backend — nothing is demo-shaped anymore.
  const { data: occ, prev: prevOcc, error } = useCardDataCompare<TableOccupancy>('occupancy', q, compare ?? false);
  const rate = occ ? occ.rate : 0;
  const hourly = occ ? occ.hourly : NO_HOURLY;
  const prevHourly = prevOcc ? prevOcc.hourly : NO_HOURLY;
  const peak = occ ? occ.peak_hour : null;
  // The peak-hour bucket carries the raw order count for the meta line;
  // pct/level already share the heatmap's intensity scale.
  const peakBucket = peak !== null ? hourly.find((h) => h.hour === peak) : null;
  // The live rate is a snapshot, so the compare chip uses table-order
  // volume across the period (sum of the hourly counts) instead.
  const totalOrders = hourly.reduce((s, h) => s + h.table_orders, 0);
  const prevOrders = prevHourly.reduce((s, h) => s + h.table_orders, 0);
  const delta = compare ? periodDelta(totalOrders, prevOrders) : null;
  // Align the previous curve by hour — the backend only returns hours with
  // orders, so index alignment would misplot when the hour sets differ.
  const prevPct = compare ? alignPrevHourly(hourly, prevHourly) : NO_NUMBERS;
  const option = useMemo(() => ({
    grid: { left: 8, right: 8, top: 8, bottom: 0, containLabel: true },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: unknown) => `${v}%` },
    xAxis: {
      type: 'category' as const, data: hourly.map((d) => String(d.hour).padStart(2, '0')),
      axisLabel: { fontSize: 9, color: CHART_TEXT, interval: 1 }, axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: 'value' as const, show: false, max: 100 },
    series: [
      {
        type: 'line' as const, data: hourly.map((d) => d.pct),
        smooth: true, symbol: 'none', lineStyle: { width: 2, color: CHART_TABLES },
        areaStyle: { opacity: 0.12 }, itemStyle: { color: CHART_TABLES },
      },
      ...(compare && prevHourly.length ? [{
        name: l10n.getString('analytics-card-prev'),
        type: 'line' as const, data: prevPct,
        smooth: true, symbol: 'none',
        itemStyle: { color: CHART_PREV }, lineStyle: { width: 1.5, color: CHART_PREV, type: 'dashed' as const },
      }] : []),
    ],
  }), [hourly, prevPct, compare, l10n, prevHourly.length]);
  if (error) return <CardError error={error} />;
  if (!occ) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-occupancy">
        <div className="analytics-occupancy-head">
          <span className="analytics-occupancy-value">{rate}%</span>
          <span className="analytics-occupancy-label">{l10n.getString('analytics-card-occupancy-occupied')}</span>
        </div>
        <div className="analytics-occupancy-track" role="img" aria-label={title}>
          <span className="analytics-occupancy-fill" style={{ width: `${rate}%` }} />
        </div>
        <div className="analytics-occupancy-meta">
          {peak !== null && (
            <span>
              {l10n.getString('analytics-card-occupancy-peak')} · {String(peak).padStart(2, '0')}:00
              {peakBucket && ` · ${peakBucket.table_orders} ${l10n.getString('analytics-card-occupancy-orders')}`}
            </span>
          )}
        </div>
        <div className="analytics-kpi-actions analytics-card-insight">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-occupancy-aria')} onClick={() => exportOccupancyCsv(occ, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
        <div className="analytics-card-chart" role="img" aria-label={l10n.getString('analytics-card-occupancy-hourly')}>
          <ReactEChartsCore echarts={echarts} option={option} style={{ height: chartHeight('occupancy', expanded) }} notMerge />
        </div>
      </div>
    </Visual>
  );
}

function WaitstaffCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt, count } = useMoney();
  const { data: staff, prev: prevStaff, error } = useCardDataCompare<StaffAnalyticsRow[]>('waitstaff', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!staff) return <CardLoading />;
  if (staff.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  // Rank waitstaff by covers served (sale_count), not revenue — the
  // differentiator versus the shared Staff Performance card, which ranks by
  // sales total.
  const buildRows = (rows: StaffAnalyticsRow[]): RankRow[] => rows
    .slice()
    .sort((a, b) => b.sale_count - a.sale_count)
    .map((r) => ({ name: r.display_name, value: r.sale_count, display: `${count(r.sale_count)} ${l10n.getString('analytics-card-waitstaff-covers')}` }));
  const rows = rowDeltas(buildRows(staff), prevStaff ? buildRows(prevStaff) : null);
  // "Total covers" is a count (orders served), not a money figure — sum the
  // sale counts so the KPI matches its label.
  const totalCovers = staff.reduce((s, r) => s + r.sale_count, 0);
  const prevCovers = prevStaff ? prevStaff.reduce((s, r) => s + r.sale_count, 0) : 0;
  const delta = compare ? periodDelta(totalCovers, prevCovers) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={count(totalCovers)} label={l10n.getString('analytics-card-waitstaff-total')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-waitstaff-aria')} onClick={() => exportStaffCsv('waitstaff', staff, q.from, q.to, fmt, (id) => l10n.getString(id), 'covers')} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}

function VoidsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: items, prev: prevItems, error } = useCardDataCompare<VoidedItemRow[]>('voids', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!items) return <CardLoading />;
  if (items.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const rows = rowDeltas(
    items.map((it) => ({ name: it.name, value: it.qty, display: `${it.qty}×` })),
    prevItems ? prevItems.map((it) => ({ name: it.name, value: it.qty, display: '' })) : null,
  );
  const totalQty = rows.reduce((s, r) => s + r.value, 0);
  const prevQty = prevItems ? prevItems.reduce((s, it) => s + it.qty, 0) : 0;
  const delta = compare ? periodDelta(totalQty, prevQty) : null;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={String(totalQty)} label={l10n.getString('analytics-card-voids-count')} tone="bad" />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-voids-aria')} onClick={() => exportVoidedItemsCsv('voids', items, q.from, q.to, (id) => l10n.getString(id))} />
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────

export interface AnalyticsCardContentProps {
  /** Card key from ANALYTICS_CARDS (e.g. 'revenue', 'top-items'). */
  cardKey: string;
  granularity: Granularity;
  /** Workspace view — differentiates retail vs restaurant card data. */
  workspaceView: WorkspaceView;
  /** Inclusive date range backing the query (derived from granularity). */
  from: string;
  to: string;
  /** Session token for the scoped reporting commands. */
  sessionToken: string;
  /** Localized card title, used as the chart's accessible name. */
  title: string;
  /** When true the card fills the main area — charts grow and lists uncap. */
  expanded?: boolean | undefined;
  /** When true cards overlay the previous equal-length period. */
  compare?: boolean | undefined;
}

/** Renders the designed content for a non-heatmap analytics card. */
export function AnalyticsCardContent({
  cardKey,
  granularity,
  workspaceView,
  from,
  to,
  sessionToken,
  title,
  expanded,
  compare,
}: AnalyticsCardContentProps) {
  const q: AnalyticsQuery = { workspace: workspaceView, granularity, from, to, sessionToken };
  switch (cardKey) {
    case 'revenue': return <RevenueCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'aov': return <AovCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'staff': return <StaffCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'customers': return <CustomersCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'payments': return <PaymentsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'discounts': return <DiscountsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'refunds': return <RefundsCard q={q} compare={compare} />;
    case 'top-items': return <TopItemsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'category': return <CategoryCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'basket': return <BasketCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'inventory': return <InventoryCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'low-stock': return <LowStockCard q={q} title={title} expanded={expanded} />;
    case 'tables': return <TablesCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'occupancy': return <OccupancyCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'waitstaff': return <WaitstaffCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'voids': return <VoidsCard q={q} title={title} expanded={expanded} compare={compare} />;
    default: return null;
  }
}
