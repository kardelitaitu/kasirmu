//! Real-data loaders and pure mapping helpers for the analytics cards.
//!
//! Each card's data slice is fetched through the shared TTL cache via
//! `useAnalyticsQuery`, keyed by card + workspace + granularity + range.
//! This module owns *what* to fetch and how to derive the per-bucket
//! shapes the layouts consume; the cards keep their visual structure and
//! only swap their data source. Raw API rows stay unformatted here —
//! money display formatting lives in the UI layer (the cards' `useMoney`).

import {
  getBasketSizeTrend,
  getCategoryBreakdown,
  getCustomerSplit,
  getDailyRevenue,
  getDiscountsSummary,
  getHourlyHeatmap,
  getHourlyOccupancy,
  getInventoryTrend,
  getInventoryTurnover,
  getLowStockAlerts,
  getMenuEngineering,
  getMonthlyRevenue,
  getPaymentMethodBreakdown,
  getTableTurnover,
  getTopProducts,
  getVoidedItems,
  getVoidedSalesSummary,
  getWeeklyRevenue,
} from '@/api/reports';
import { listTablesScoped } from '@/api/tables';
import type {
  BasketSizeRow,
  BasketTrendRow,
  CategoryBreakdownRow,
  CustomerSplitRow,
  DailyRevenueRow,
  DiscountsSummaryRow,
  HourlyHeatmapRow,
  InventoryTrendRow,
  InventoryTurnoverRow,
  LowStockAlert,
  MenuEngineeringRow,
  MonthlyRevenueRow,
  PaymentMethodRow,
  TopProductRow,
  VoidedItemRow,
  VoidedSummaryRow,
  WeeklyRevenueRow,
} from '@/api/reports';
import { getStaffAnalyticsScoped } from '@/api/analytics';
import type { StaffAnalyticsRow } from '@/api/analytics';
import type { Granularity, WorkspaceView } from './utils/dateRangePresets';

// ── Shared layout shapes ────────────────────────────────────────────

/** One time-bucket of a chart series. */
export interface Bucket {
  label: string;
  value: number;
}

/** One row of a ranked list (top products, staff, discount codes, …). */
export interface RankRow {
  name: string;
  value: number;
  display: string;
  /** Optional % change vs previous period; renders a trend arrow. */
  delta?: number;
}

/** Everything a card needs to load its slice: scope + range. */
export interface AnalyticsQuery {
  workspace: WorkspaceView;
  granularity: Granularity;
  from: string;
  to: string;
  sessionToken: string;
}

// ── Date-range helper ───────────────────────────────────────────────

/**
 * Parse the store-timezone contract (REP-03, mirrored in Rust at
 * `db/reports.rs::parse_utc_offset`): a fixed UTC offset `'+HH:MM'` /
 * `'-HH:MM'` → milliseconds; `'UTC'`, IANA names, and anything else
 * unparseable → 0. IANA names are deliberately NOT interpreted — the
 * report buckets are fixed-offset too, so the UI must agree with the
 * backend rather than resolve a possibly-different DST rule client-side.
 */
export function storeOffsetMs(tz: string | null | undefined): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz ?? '');
  if (!m) return 0;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 23 || mm > 59) return 0;
  return (hh * 3_600_000 + mm * 60_000) * (m[1] === '-' ? -1 : 1);
}

/**
 * Anchor used when the primary store's timezone is not (yet) known.
 *
 * Deliberately a fixed constant rather than the device's zone. A POS terminal
 * usually sits in the store, so host-local *looks* harmless — but it makes the
 * computed range depend on wherever the app happens to run, which is how the
 * analytics date windows differed between a UTC CI runner and a UTC+7
 * workstation on PR #95. Host-local also has no defined meaning for a headless
 * or remote session.
 *
 * 'UTC' is not an invented policy: it is the schema's own default for this
 * column — `timezone TEXT NOT NULL DEFAULT 'UTC'` in both
 * crates/kasirmu-core/migrations/20260813_init.sql:803 and the generated
 * 20260813_init.pg.sql:199. Because the column is NOT NULL, a persisted store
 * always has a zone; null here means the profile is still loading or the fetch
 * failed. storeOffsetMs() parses only fixed ±HH:MM offsets and returns 0 for
 * anything else, so 'UTC' resolves to offset 0 — the correct value, reached the
 * same way the backend reaches it.
 */
export const FALLBACK_STORE_TZ = 'UTC';

/**
 * The store's current calendar day as `YYYY-MM-DD`.
 *
 * With no store zone, falls back to FALLBACK_STORE_TZ rather than the host, so
 * the result depends only on the instant — never on where the app runs.
 */
export function isoToday(storeTz?: string | null): string {
  // Offset-shifted instant read as a UTC calendar = the store's today.
  return new Date(Date.now() + storeOffsetMs(storeTz ?? FALLBACK_STORE_TZ)).toISOString().slice(0, 10);
}

/**
 * The store's calendar day `daysAgo` days back, as `YYYY-MM-DD`.
 *
 * Shared by AnalyticsScreen and reports/DashboardScreen so the two cannot drift
 * apart on the REP-03 anchor rule. Like isoToday, the result depends only on the
 * instant and the store offset — never on the host zone.
 */
export function isoDaysAgo(daysAgo: number, storeTz?: string | null): string {
  return new Date(
    Date.now() + storeOffsetMs(storeTz ?? FALLBACK_STORE_TZ) - daysAgo * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * The inclusive `[from, to]` window for a granularity. Daily/Weekly/
 * Monthly/Yearly are anchored at "now"; Custom uses the picked range.
 * When `storeTz` is provided (the primary store's `timezone`, REP-03) the
 * anchor is the STORE's calendar day, not the device's — a laptop in
 * another region must still query "today" as the store sees it. Passing
 * `null`/`undefined` keeps the legacy device-local anchor.
 */
export function rangeForGranularity(
  g: Granularity,
  customFrom: string,
  customTo: string,
  storeTz?: string | null,
): { from: string; to: string } {
  let y: number;
  let m: number;
  let d: number;
  let dow: number; // 0 = Monday … 6 = Sunday
  if (storeTz === undefined || storeTz === null || storeTz === '') {
    const now = new Date();
    y = now.getFullYear();
    m = now.getMonth();
    d = now.getDate();
    dow = (now.getDay() + 6) % 7;
  } else {
    // UTC getters on the offset-shifted instant = the store's calendar.
    const s = new Date(Date.now() + storeOffsetMs(storeTz));
    y = s.getUTCFullYear();
    m = s.getUTCMonth();
    d = s.getUTCDate();
    dow = (s.getUTCDay() + 6) % 7;
  }
  // Calendar-safe day construction (month/year rollover via Date.UTC).
  const iso = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  switch (g) {
    case 'daily': {
      // Daily shows the current week (Monday-first), bucketed per day — the
      // same window the heatmap's weekday view covers. A single-day window
      // would produce a one-point series where Peak == Low.
      return { from: iso(y, m, d - dow), to: iso(y, m, d) };
    }
    case 'weekly': {
      // Monday-first week start.
      return { from: iso(y, m, d - dow), to: iso(y, m, d) };
    }
    case 'monthly':
      return { from: iso(y, m, 1), to: iso(y, m, d) };
    case 'yearly':
      return { from: `${y}-01-01`, to: iso(y, m, d) };
    case 'custom':
      return { from: customFrom, to: customTo };
  }
}

/** Inclusive number of days in [from, to]. */
export function spanDays(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

/**
 * Bucket granularity for a query. Fixed granularities pass through; a
 * custom range rolls up by span so long ranges stay readable:
 * ≤ 31 days → daily, 32–180 days → weekly, > 180 days → monthly.
 */
export function bucketGranularity(g: Granularity, from: string, to: string): Granularity {
  if (g !== 'custom') return g;
  const days = spanDays(from, to);
  if (days <= 31) return 'daily';
  if (days <= 180) return 'weekly';
  return 'monthly';
}

/**
 * Effective grid for the heatmap card's custom range. A range inside one
 * calendar month renders the monthly calendar; a long range renders the
 * range-derived yearly columns; everything in between keeps the dense 7×24
 * weekly grid. Fixed granularities pass through unchanged.
 */
export function heatmapGranularityForRange(g: Granularity, from: string, to: string): Granularity {
  if (g !== 'custom') return g;
  if (from.slice(0, 7) === to.slice(0, 7)) return 'monthly';
  if (spanDays(from, to) > 180) return 'yearly';
  return 'weekly';
}

// ── Pure mapping helpers ────────────────────────────────────────────

/**
 * Short bucket label for a revenue row by granularity. daily/weekly raw =
 * "YYYY-MM-DD" → "MM-DD"; monthly/yearly raw = "YYYY-MM" → "MM" — or
 * "MM/YY" when `multiYear` (the query range spans calendar years), because
 * bare "MM" labels would collide across years on a multi-year range.
 */
export function revenueLabel(g: Granularity, raw: string, multiYear = false): string {
  if (g === 'monthly' || g === 'yearly') {
    return multiYear ? `${raw.slice(5)}/${raw.slice(2, 4)}` : raw.slice(5);
  }
  if (g === 'weekly') {
    // "MM-DD" of the Monday week-start can repeat across years on a
    // multi-year range — carry the year then too.
    return multiYear ? `${raw.slice(5)}/${raw.slice(2, 4)}` : raw.slice(5);
  }
  return raw.slice(5);
}

/** True when the query window spans more than one calendar year. */
function rangeSpansYears(q: AnalyticsQuery): boolean {
  return q.from.slice(0, 4) !== q.to.slice(0, 4);
}

/**
 * % change from the first bucket to the last (null when < 2 buckets or the
 * first bucket is zero — a zero baseline makes the percentage undefined, so
 * callers omit the chip instead of showing a misleading 0% / ±∞).
 */
export function seriesDelta(buckets: Bucket[]): number | null {
  if (buckets.length < 2) return null;
  const first = buckets[0]!.value;
  const last = buckets[buckets.length - 1]!.value;
  if (first === 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

/**
 * The equal-length window immediately preceding `q` — the comparison
 * baseline for period-over-period mode (same span, ending the day before
 * the current window starts).
 */
export function previousRange(q: AnalyticsQuery): AnalyticsQuery {
  // All arithmetic is UTC-anchored (`...Z` + toISOString), so the window
  // shifts by whole calendar days in every timezone — never by hours.
  const fromMs = Date.parse(`${q.from}T00:00:00Z`);
  const toMs = Date.parse(`${q.to}T00:00:00Z`);
  const spanDays = Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1);
  const prevToMs = fromMs - 86_400_000;
  const prevFromMs = prevToMs - (spanDays - 1) * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { ...q, from: iso(prevFromMs), to: iso(prevToMs) };
}

/**
 * % change of `current` vs `previous` (one decimal). Returns `null` when
 * there is no previous baseline (missing or zero) — callers then omit the
 * comparison chip instead of showing a misleading ±∞.
 */
export function periodDelta(current: number, previous: number): number | null {
  if (previous === 0 || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Map the previous period's per-hour `pct` onto the current period's hour
 * set for the compare overlay. The backend returns only hours with orders,
 * so the two periods can have different active hours — alignment must be
 * by hour, never by array position. Current hours absent from the previous
 * period read as 0 (no activity there last period).
 */
export function alignPrevHourly(
  current: { hour: number; pct: number }[],
  previous: { hour: number; pct: number }[],
): number[] {
  const byHour = new Map(previous.map((h) => [h.hour, h.pct]));
  return current.map((h) => byHour.get(h.hour) ?? 0);
}

/**
 * Map the previous period's bucket values onto the current period's bucket
 * labels for a compare overlay. The backend groups by date/week/month and
 * returns only buckets with sales, so equal-length windows can have
 * different bucket sets — alignment must be by label, never by array
 * position. Current labels absent from the previous period read as 0 (no
 * activity there last period); previous-only labels are not plotted.
 */
export function alignPrevBuckets(current: Bucket[], previous: Bucket[]): number[] {
  const byLabel = new Map(previous.map((b) => [b.label, b.value]));
  return current.map((b) => byLabel.get(b.label) ?? 0);
}

// ── Heatmap intensity builders ──────────────────────────────────────
//
// Cell keys identify the heatmap's fixed grid per granularity:
//   daily/custom: weekday index (0 = Mon … 6 = Sun)
//   weekly:       `${dayIdx}:${hour}` (dayIdx 0 = Mon, hour 0–23)
//   monthly:      day-of-month number (1…31)
//   yearly:       `${YYYY-MM}:${weekIdx}` — the key's month is the range's
//                 actual month (multi-year ranges keep separate columns),
//                 and weekIdx 0–4 is the week's ordinal among the month's
//                 Mondays (5-Monday months use band 4, never merging weeks)
//
// Intensities are normalized 0–4 against the strongest cell in the set.

/**
 * The `percentile`-th value (0–100) of a numeric array, nearest-rank. Used as
 * the normalization baseline so a single outlier cannot wash out the rest of
 * the scale. For datasets under ~20 values the 95th percentile IS the max,
 * so small sets keep the exact legacy max-normalized behavior.
 */
function percentileValue(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

/**
 * Percent-of-peak (0–100) against a shared 95th-percentile baseline — the
 * single normalization rule behind every intensity scale (heatmap cells and
 * the occupancy curve), so the same level of business always renders as the
 * same relative intensity. Capping the baseline at the 95th percentile keeps
 * one outlier cell from washing out the rest of the grid; values above it
 * clamp to 100.
 */
export function pctOfPeak(values: number[]): number[] {
  const baseline = Math.max(1, percentileValue(values, 95));
  return values.map((v) => Math.min(100, Math.round((v / baseline) * 100)));
}

/**
 * 0–4 heat level for a percent-of-peak value — the binning the heatmap
 * renders: level = ⌊pct / 20⌋, so 0–19% → 0, 20–39% → 1, … 80–100% → 4.
 * An occupancy curve at 60% and a heatmap cell at level 3 are the same
 * intensity.
 */
export function intensityFromPct(pct: number): number {
  return pct <= 0 ? 0 : Math.min(4, Math.floor((pct / 100) * 5));
}

/** Map `[key, value]` entries to 0–4 levels, normalized to the shared peak baseline. */
export function normalizeIntensities(entries: [string, number][]): Map<string, number> {
  const pcts = pctOfPeak(entries.map(([, v]) => v));
  const map = new Map<string, number>();
  entries.forEach(([key], i) => map.set(key, intensityFromPct(pcts[i]!)));
  return map;
}

/** Monday-first index from a `Date.getDay()` (0 = Sunday). */
function mondayFirst(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** Aggregated raw revenue + order count for one heatmap cell key. */
interface HeatTotals {
  minor: number;
  orders: number;
}

/** One heatmap cell's value: raw totals plus the normalized 0–4 level. */
export interface HeatCell extends HeatTotals {
  /** 0–4 heat level normalized against the strongest cell in the set. */
  level: number;
}

/** The yearly heatmap's `YYYY-MM:week` cell key for a Monday week_start. */
function yearlyWeekKey(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00`);
  const month = d.getMonth();
  // Ordinal of the week among the month's Monday weeks (0-based) — the same
  // Monday-first structure as the trend cards' weekStartKey. The old
  // day-of-month arithmetic capped at 3, silently merging the 5th Monday of
  // a month into the 4th week's cell. The key carries the week_start's
  // YYYY-MM so a multi-year range never merges two Januaries into one column.
  let week = 0;
  for (let day = 1; day <= d.getDate(); day++) {
    if (mondayFirst(new Date(d.getFullYear(), month, day).getDay()) === 0) week += 1;
  }
  return `${weekStart.slice(0, 7)}:${week - 1}`;
}

/**
 * Raw per-cell totals (revenue in minor units + order count) for the
 * heatmap's fixed grid. The backend can emit one row per currency (daily /
 * weekly) and one per day/hour (hourly), so every key sums rather than
 * overwrites — the single aggregation rule behind the intensity levels, the
 * busiest-time insight, and the per-cell tooltips.
 */
function heatTotals(
  g: Granularity,
  data: { daily?: DailyRevenueRow[]; hourly?: HourlyHeatmapRow[]; weekly?: WeeklyRevenueRow[] },
): Map<string, HeatTotals> {
  const totals = new Map<string, HeatTotals>();
  const add = (key: string, minor: number, orders: number) => {
    const t = totals.get(key) ?? { minor: 0, orders: 0 };
    t.minor += minor;
    t.orders += orders;
    totals.set(key, t);
  };
  if (g === 'monthly') {
    for (const r of data.daily ?? []) {
      add(String(new Date(`${r.date}T00:00:00`).getDate()), r.total_minor, r.sale_count);
    }
  } else if (g === 'yearly') {
    for (const r of data.weekly ?? []) {
      add(yearlyWeekKey(r.week_start), r.total_minor, r.sale_count);
    }
  } else if (g === 'weekly') {
    for (const r of data.hourly ?? []) {
      add(`${mondayFirst(r.day_of_week)}:${r.hour}`, r.total_minor, r.sale_count);
    }
  } else {
    // daily + custom: the 7-day weekday view aggregated from hourly rows.
    for (const r of data.hourly ?? []) {
      add(String(mondayFirst(r.day_of_week)), r.total_minor, r.sale_count);
    }
  }
  return totals;
}

/** 0–4 levels for a raw totals map, normalized via `normalizeIntensities`. */
function normalizeTotals(totals: Map<string, HeatTotals>): Map<string, number> {
  return normalizeIntensities([...totals.entries()].map(([k, t]) => [k, t.minor] as [string, number]));
}

/** Per-cell values (totals + level) for the heatmap card at the given granularity. */
export function buildHeatmapCells(
  g: Granularity,
  data: { daily?: DailyRevenueRow[]; hourly?: HourlyHeatmapRow[]; weekly?: WeeklyRevenueRow[] },
): Map<string, HeatCell> {
  const totals = heatTotals(g, data);
  const levels = normalizeTotals(totals);
  const cells = new Map<string, HeatCell>();
  for (const [key, t] of totals) {
    cells.set(key, { ...t, level: levels.get(key) ?? 0 });
  }
  return cells;
}

/** The strongest cell (highest revenue) — the heatmap's "busiest" slot. */
export function heatPeak(cells: Map<string, HeatCell>): { key: string; cell: HeatCell } | null {
  let best: { key: string; cell: HeatCell } | null = null;
  for (const [key, cell] of cells) {
    if (cell.minor <= 0) continue; // zero-activity cells never count as "busiest"
    if (!best || cell.minor > best.cell.minor) best = { key, cell };
  }
  return best;
}

/** The weakest active cell (lowest positive revenue) — the heatmap's "quietest" slot. */
export function heatLow(cells: Map<string, HeatCell>): { key: string; cell: HeatCell } | null {
  let best: { key: string; cell: HeatCell } | null = null;
  for (const [key, cell] of cells) {
    if (cell.minor <= 0) continue; // zero-activity cells never count as "quietest"
    if (!best || cell.minor < best.cell.minor) best = { key, cell };
  }
  return best;
}

/** Hourly rows aggregated by day-of-week (daily/custom view). */
export function weekdayIntensities(rows: HourlyHeatmapRow[]): Map<string, number> {
  return normalizeTotals(heatTotals('daily', { hourly: rows }));
}

/** Hourly rows mapped to the 7×24 weekly grid. */
export function weeklyHourlyIntensities(rows: HourlyHeatmapRow[]): Map<string, number> {
  return normalizeTotals(heatTotals('weekly', { hourly: rows }));
}

/** Daily revenue mapped to calendar days of the current month. */
export function monthDayIntensities(rows: DailyRevenueRow[]): Map<string, number> {
  return normalizeTotals(heatTotals('monthly', { daily: rows }));
}

/** Weekly revenue mapped to (YYYY-MM, week-of-month) for the range-derived yearly grid. */
export function yearlyWeekIntensities(rows: WeeklyRevenueRow[]): Map<string, number> {
  return normalizeTotals(heatTotals('yearly', { weekly: rows }));
}

/** Number of Monday weeks in a month (4 or 5) — a yearly heatmap column's band count. */
export function mondayWeeksInMonth(year: number, month: number): number {
  const days = new Date(year, month + 1, 0).getDate();
  let weeks = 0;
  for (let day = 1; day <= days; day++) {
    if (mondayFirst(new Date(year, month, day).getDay()) === 0) weeks += 1;
  }
  return weeks;
}

/** One column of the yearly heatmap: a month in the query range. */
export interface YearlyHeatmapColumn {
  /** YYYY-MM — matches the `yearlyWeekIntensities` cell keys. */
  key: string;
  /** Monday-week count (4 or 5) — how many heat cells the column renders. */
  cells: number;
}

/**
 * The yearly heatmap's columns: one per month in `[from, to]` — never the
 * current year's fixed 12 — so a past-year range renders that year's
 * months. The header label (localized month name, or MM/YY when the range
 * spans years) is composed in the UI layer where l10n is available.
 */
export function yearlyHeatmapColumns(from: string, to: string): YearlyHeatmapColumn[] {
  return bucketKeys('monthly', from, to).map((ym) => ({
    key: ym,
    cells: mondayWeeksInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1),
  }));
}

/** Per-cell intensities for the heatmap card at the given granularity. */
export function buildHeatmapIntensities(
  g: Granularity,
  data: { daily?: DailyRevenueRow[]; hourly?: HourlyHeatmapRow[]; weekly?: WeeklyRevenueRow[] },
): Map<string, number> {
  return normalizeTotals(heatTotals(g, data));
}

// ── Per-card loaders (raw API rows, no formatting) ──────────────────

/** Raw revenue rows for a resolved bucket granularity. */
async function revenueRows(g: Granularity, q: AnalyticsQuery): Promise<
  DailyRevenueRow[] | WeeklyRevenueRow[] | MonthlyRevenueRow[]
> {
  switch (g) {
    case 'weekly':
      return getWeeklyRevenue(q.from, q.to, q.sessionToken);
    case 'monthly':
    case 'yearly':
      return getMonthlyRevenue(q.from, q.to, q.sessionToken);
    default:
      return getDailyRevenue(q.from, q.to, q.sessionToken);
  }
}

/** Raw bucket key (date / week_start / month) for a revenue row. */
function rowKey(r: DailyRevenueRow | WeeklyRevenueRow | MonthlyRevenueRow): string {
  return 'date' in r ? r.date : 'week_start' in r ? r.week_start : r.month;
}

/** The date `days` after `iso` (UTC-anchored, exact-day arithmetic). */
function addDaysUtc(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every raw bucket key the granularity's axis must cover within
 * [from, to]. The backend GROUP BYs completed sales and returns only
 * buckets WITH sales, so the loaders zero-fill against this
 * enumeration: daily keys are dates, weekly keys are Monday week
 * starts, monthly/yearly keys are YYYY-MM.
 */
function bucketKeys(g: Granularity, from: string, to: string): string[] {
  const keys: string[] = [];
  if (g === 'monthly' || g === 'yearly') {
    let cur = from.slice(0, 7);
    const end = to.slice(0, 7);
    while (cur <= end) {
      keys.push(cur);
      const [y, m] = cur.split('-').map(Number);
      cur = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, '0')}`;
    }
  } else if (g === 'weekly') {
    let cur = weekStartKey(from);
    const end = weekStartKey(to);
    while (cur <= end) {
      keys.push(cur);
      cur = addDaysUtc(cur, 7);
    }
  } else {
    let cur = from;
    const end = to;
    while (cur <= end) {
      keys.push(cur);
      cur = addDaysUtc(cur, 1);
    }
  }
  return keys;
}

/** Revenue per bucket (Revenue Overview card), zero-filled to the range. */
export async function loadRevenue(q: AnalyticsQuery): Promise<Bucket[]> {
  const g = bucketGranularity(q.granularity, q.from, q.to);
  const rows = await revenueRows(g, q);
  // Sum per raw key — the backend can emit one row per (day, currency).
  const byKey = new Map<string, number>();
  for (const r of rows) {
    byKey.set(rowKey(r), (byKey.get(rowKey(r)) ?? 0) + r.total_minor);
  }
  return bucketKeys(g, q.from, q.to).map((key) => ({
    label: revenueLabel(g, key, rangeSpansYears(q)),
    value: byKey.get(key) ?? 0,
  }));
}

/**
 * AOV card slice: per-bucket average order value (zero-filled to the
 * range) plus the range totals so the KPI can compute the true weighted
 * average (revenue ÷ orders) instead of an unweighted mean of daily AOVs.
 */
export interface AovTrend {
  /** Per-bucket AOV (total_minor ÷ sale_count), zero-filled to the range. */
  buckets: Bucket[];
  /** Total revenue across the range in minor units. */
  total_minor: number;
  /** Total completed orders across the range. */
  total_orders: number;
}

/** Average order value per bucket (AOV card), zero-filled to the range. */
export async function loadAov(q: AnalyticsQuery): Promise<AovTrend> {
  const g = bucketGranularity(q.granularity, q.from, q.to);
  const rows = await revenueRows(g, q);
  const byKey = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const key = rowKey(r);
    const agg = byKey.get(key) ?? { total: 0, count: 0 };
    agg.total += r.total_minor;
    agg.count += r.sale_count;
    byKey.set(key, agg);
  }
  const buckets = bucketKeys(g, q.from, q.to).map((key) => {
    const agg = byKey.get(key);
    return {
      label: revenueLabel(g, key, rangeSpansYears(q)),
      value: agg && agg.count > 0 ? Math.round(agg.total / agg.count) : 0,
    };
  });
  let totalMinor = 0;
  let totalOrders = 0;
  for (const [, agg] of byKey) {
    totalMinor += agg.total;
    totalOrders += agg.count;
  }
  return { buckets, total_minor: totalMinor, total_orders: totalOrders };
}

/** Staff analytics (shared Staff Performance + restaurant Top Waitstaff). */
export function loadStaff(q: AnalyticsQuery): Promise<StaffAnalyticsRow[]> {
  return getStaffAnalyticsScoped(q.sessionToken, q.from, q.to);
}

/** Top products (retail) / menu engineering (restaurant). */
export function loadTopItems(q: AnalyticsQuery): Promise<TopProductRow[] | MenuEngineeringRow[]> {
  if (q.workspace === 'retail') {
    return getTopProducts(q.from, q.to, 10, q.sessionToken, 'revenue');
  }
  return getMenuEngineering(q.from, q.to, q.sessionToken).then((r) => r.rows);
}

/** Raw rows the heatmap needs at the given granularity. */
export async function loadHeatmapRows(q: AnalyticsQuery): Promise<{
  daily: DailyRevenueRow[];
  hourly: HourlyHeatmapRow[];
  weekly: WeeklyRevenueRow[];
}> {
  const { from, to, sessionToken } = q;
  // Weekly needs the 7×24 hourly grid; monthly needs per-day revenue;
  // yearly needs per-week revenue. Daily/custom use the weekday view
  // aggregated from the hourly heatmap. Fetch the two needed sets only.
  switch (q.granularity) {
    case 'monthly':
      return { daily: await getDailyRevenue(from, to, sessionToken), hourly: [], weekly: [] };
    case 'yearly':
      return { daily: [], hourly: [], weekly: await getWeeklyRevenue(from, to, sessionToken) };
    default:
      return { daily: [], hourly: await getHourlyHeatmap(from, to, sessionToken), weekly: [] };
  }
}

/** Completed table-bound orders per day → per-bucket turn minutes. */
function weekStartKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // Monday-first
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthDays(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y!, m!, 0).getDate();
}

/**
 * Granularity bucket key for a date in the tables/basket trend loaders:
 * Monday week-start for weekly, YYYY-MM for monthly AND yearly (the
 * yearly axis is one bucket per month, matching the revenue card and
 * the 12-column yearly heatmap).
 */
function trendKey(g: Granularity, date: string): string {
  if (g === 'weekly') return weekStartKey(date);
  if (g === 'monthly' || g === 'yearly') return date.slice(0, 7);
  return date;
}

/** Every trend bucket key the axis must cover within [from, to]. */
function trendBucketKeys(g: Granularity, from: string, to: string): string[] {
  if (g === 'monthly' || g === 'yearly') return bucketKeys('monthly', from, to);
  if (g === 'weekly') return bucketKeys('weekly', from, to);
  return bucketKeys('daily', from, to);
}

/**
 * Average table-turn minutes per granularity bucket. Table service is
 * recorded as completed KDS orders carrying a table number; each bucket
 * sums its turns and divides the bucket's service minutes by them
 * (fewer turns per hour ⇒ longer average turn). Buckets without any
 * turns in the range read 0, and the axis covers the whole range.
 */
export async function loadTables(q: AnalyticsQuery): Promise<Bucket[]> {
  const g = bucketGranularity(q.granularity, q.from, q.to);
  const rows = await getTableTurnover(q.from, q.to, q.sessionToken);
  const ordersByKey = new Map<string, number>();
  for (const r of rows) {
    const key = trendKey(g, r.date);
    ordersByKey.set(key, (ordersByKey.get(key) ?? 0) + r.table_orders);
  }
  return trendBucketKeys(g, q.from, q.to).map((key) => {
    const orders = ordersByKey.get(key) ?? 0;
    const bucketMinutes =
      g === 'monthly' || g === 'yearly'
        ? monthDays(key) * 1440
        : g === 'weekly'
          ? 7 * 1440
          : 1440;
    return {
      label: revenueLabel(g, key, rangeSpansYears(q)),
      value: orders > 0 ? Math.round(bucketMinutes / orders) : 0,
    };
  });
}

/** Table-turn delta: positive when turns got *faster* (minutes dropped). */
export function turnDelta(buckets: Bucket[]): number | null {
  const d = seriesDelta(buckets);
  if (d === null) return null;
  return Math.round(-d * 10) / 10;
}

/** Basket-size shape for the trend card: per-bucket averages + range total. */
export interface BasketTrend {
  /** Per-bucket mean items/order (one bucket per granularity cell). */
  buckets: Bucket[];
  /** Completed sales across the range. */
  sale_count: number;
  /** Weighted mean line count across the range (matches the KPI tile). */
  avg_line_count: number;
}

/**
 * Basket size per granularity bucket — weighted average of items/order
 * across each bucket's days, plus the range totals. The daily rows come
 * from the backend; weekly/monthly/yearly group them like `loadTables`.
 */
export async function loadBasketSize(q: AnalyticsQuery): Promise<BasketTrend> {
  const g = bucketGranularity(q.granularity, q.from, q.to);
  const rows = await getBasketSizeTrend(q.from, q.to, q.sessionToken);
  // Buckets without sales in the range read 0; the axis covers the range.
  const salesByKey = new Map<string, number>();
  const linesByKey = new Map<string, number>();
  for (const r of rows) {
    const key = trendKey(g, r.date);
    salesByKey.set(key, (salesByKey.get(key) ?? 0) + r.sale_count);
    linesByKey.set(key, (linesByKey.get(key) ?? 0) + r.sale_count * r.avg_line_count);
  }
  const buckets: Bucket[] = trendBucketKeys(g, q.from, q.to).map((key) => {
    const sales = salesByKey.get(key) ?? 0;
    const lines = linesByKey.get(key) ?? 0;
    return {
      label: revenueLabel(g, key, rangeSpansYears(q)),
      value: sales > 0 ? Math.round((lines / sales) * 10) / 10 : 0,
    };
  });
  const saleCount = rows.reduce((s, r) => s + r.sale_count, 0);
  const lineTotal = rows.reduce((s, r) => s + r.sale_count * r.avg_line_count, 0);
  return {
    buckets,
    sale_count: saleCount,
    avg_line_count: saleCount > 0 ? lineTotal / saleCount : 0,
  };
}

/**
 * Inventory turnover summary plus the units-sold trend line, bucketed by
 * the query's (possibly span-derived) granularity and zero-filled across
 * the queried range so the chart axis covers the whole window.
 */
export async function loadInventory(
  q: AnalyticsQuery,
): Promise<[InventoryTurnoverRow, InventoryTrendRow[]]> {
  const [turnover, trend] = await Promise.all([
    getInventoryTurnover(q.from, q.to, q.sessionToken, 'default'),
    getInventoryTrend(q.from, q.to, q.sessionToken),
  ]);
  const g = bucketGranularity(q.granularity, q.from, q.to);
  const unitsByKey = new Map<string, number>();
  for (const t of trend) {
    const key = trendKey(g, t.date);
    unitsByKey.set(key, (unitsByKey.get(key) ?? 0) + t.units_sold);
  }
  const filled = trendBucketKeys(g, q.from, q.to).map((key) => ({
    date: key,
    units_sold: unitsByKey.get(key) ?? 0,
  }));
  return [turnover, filled];
}

/** Live floor-plan occupancy derived from the `tables` snapshot. */
export interface TableOccupancy {
  /** Percentage of tables currently occupied (0–100). */
  rate: number;
  /**
   * Completed table orders per hour (0–23). `pct` is percent-of-peak on the
   * same scale as the heatmap (`pctOfPeak`) and `level` is the matching
   * 0–4 heat level (`intensityFromPct`) — the curve and the heatmap now
   * share one intensity scale.
   */
  hourly: { hour: number; table_orders: number; pct: number; level: number }[];
  /** Hour (0–23) with the most completed table orders, or null when empty. */
  peak_hour: number | null;
}

/**
 * Real occupancy: the live rate comes from the current `tables` snapshot,
 * and the hourly curve + peak hour come from completed table orders per
 * hour of day in the selected range (`hourly_table_activity`).
 */
export async function loadTableOccupancy(q: AnalyticsQuery): Promise<TableOccupancy> {
  const [tables, hourlyRows] = await Promise.all([
    listTablesScoped(q.sessionToken),
    getHourlyOccupancy(q.from, q.to, q.sessionToken),
  ]);
  const active = tables.filter((t) => t.active);
  const occupied = active.filter((t) => t.status === 'occupied').length;
  // Shared normalization with the heatmap: percent-of-peak plus the 0–4
  // heat level, so the curve and the heatmap cells speak the same scale.
  const pcts = pctOfPeak(hourlyRows.map((r) => r.table_orders));
  const hourly = hourlyRows
    .map((r, i) => ({
      hour: r.hour,
      table_orders: r.table_orders,
      pct: pcts[i]!,
      level: intensityFromPct(pcts[i]!),
    }))
    .sort((a, b) => a.hour - b.hour);
  let peak: number | null = null;
  let peakCount = 0;
  for (const r of hourlyRows) {
    if (r.table_orders > peakCount) {
      peak = r.hour;
      peakCount = r.table_orders;
    }
  }
  return {
    rate: active.length > 0 ? Math.round((occupied / active.length) * 100) : 0,
    hourly,
    peak_hour: peak,
  };
}

/** Everything the dashboard cards need, keyed by card key. */
export type CardLoaderResult = unknown;

/** True when `v` is a non-null object (a plain struct payload). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Structural payload guards keyed by card key, colocated with
 * `CARD_LOADERS` so a loader and its shape check can't drift apart. Each
 * guard returns true for the shape its loader produces; `useCardData`
 * passes the matching guard to `useAnalyticsQuery` so a cached value whose
 * shape drifted (a schema change without a version bump, or a corrupt
 * snapshot) is dropped and refetched instead of being cast blindly into
 * the card's type. Guards are deliberately loose — they only check the
 * container kind (array vs object) plus the fields each card dereferences —
 * so real data always passes while gross corruption does not.
 */
export const CARD_PAYLOAD_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  heatmap: (v) => isRecord(v) && Array.isArray(v['daily']) && Array.isArray(v['hourly']) && Array.isArray(v['weekly']),
  revenue: Array.isArray,
  aov: (v) => isRecord(v) && Array.isArray(v['buckets']) && typeof v['total_minor'] === 'number' && typeof v['total_orders'] === 'number',
  staff: Array.isArray,
  customers: isRecord,
  payments: Array.isArray,
  discounts: isRecord,
  refunds: isRecord,
  'top-items': Array.isArray,
  category: Array.isArray,
  basket: (v) => isRecord(v) && Array.isArray(v['buckets']),
  inventory: (v) => Array.isArray(v) && v.length === 2 && isRecord(v[0]) && Array.isArray(v[1]),
  'low-stock': Array.isArray,
  waitstaff: Array.isArray,
  tables: Array.isArray,
  voids: Array.isArray,
  occupancy: (v) => isRecord(v) && Array.isArray(v['hourly']),
};

export const CARD_LOADERS: Record<string, (q: AnalyticsQuery) => Promise<CardLoaderResult>> = {
  heatmap: loadHeatmapRows,
  revenue: loadRevenue,
  aov: loadAov,
  staff: loadStaff,
  customers: (q) => getCustomerSplit(q.from, q.to, q.sessionToken),
  payments: (q) => getPaymentMethodBreakdown(q.from, q.to, q.sessionToken),
  discounts: (q) => getDiscountsSummary(q.from, q.to, q.sessionToken),
  // Refunds is a money/totals summary (count + amount + average); the
  // voided-item list belongs to the separate restaurant-only Voids card.
  refunds: (q) => getVoidedSalesSummary(q.from, q.to, q.sessionToken),
  'top-items': loadTopItems,
  category: (q) => getCategoryBreakdown(q.from, q.to, q.sessionToken),
  basket: loadBasketSize,
  inventory: loadInventory,
  'low-stock': (q) => getLowStockAlerts(10, q.sessionToken),
  waitstaff: loadStaff,
  tables: loadTables,
  voids: (q) => getVoidedItems(q.from, q.to, q.sessionToken, 5),
  occupancy: loadTableOccupancy,
};

// ── Re-export the raw row types for card-side mapping ───────────────

export type {
  BasketSizeRow,
  BasketTrendRow,
  CategoryBreakdownRow,
  CustomerSplitRow,
  DailyRevenueRow,
  DiscountsSummaryRow,
  HourlyHeatmapRow,
  InventoryTrendRow,
  InventoryTurnoverRow,
  LowStockAlert,
  MonthlyRevenueRow,
  PaymentMethodRow,
  TopProductRow,
  VoidedItemRow,
  VoidedSummaryRow,
  WeeklyRevenueRow,
};

// ── Heatmap label keys + calendar layout (shared by the heatmap card) ──

/**
 * Fluent keys for the heatmap's Monday-first day-of-week abbreviations,
 * reused from reports.ftl (which already localizes them) so the analytics
 * grid and the reports heatmap share one set of day labels.
 */
export const DAY_LABEL_KEYS = ['day-monday', 'day-tuesday', 'day-wednesday', 'day-thursday', 'day-friday', 'day-saturday', 'day-sunday'];

/** Month-name key suffixes (0-based month index → `analytics-month-*`). */
export const MONTH_LABEL_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Calendar layout for the month containing `from` (an ISO `YYYY-MM-DD`
 * date). `leading` counts the empty cells before day 1 (Monday-first),
 * `days` the day cells, and `trailing` the empty cells after the last day
 * so the grid always completes whole weeks (leading + days + trailing ≡ 0
 * mod 7). Derived from the queried range's month — never "now" — so a
 * custom range inside a past or future month renders that month's calendar.
 */
export function monthCalendarGrid(from: string): { leading: number; days: number; trailing: number } {
  const [year, month] = from.split('-').map(Number); // month is 1-based
  // Day 0 of month index `month` (one past the 1-based month) rolls back to
  // that month's last day, yielding its day count.
  const days = new Date(year!, month!, 0).getDate();
  const leading = (new Date(year!, month! - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const trailing = (7 - ((leading + days) % 7)) % 7;
  return { leading, days, trailing };
}
export type { StaffAnalyticsRow };
