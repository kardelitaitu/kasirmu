//! CSV export helpers for the analytics feature.
//!
//! Extracted from `AnalyticsScreen.tsx` (R37 analytics-query split). This
//! module holds the screen's own export surface — the heatmap download and
//! the cache-label helper. The per-card exporters live in
//! `utils/analyticsCardCsv.ts`, because each one is typed against its own
//! card's row shape.

import { downloadCsv } from '@/utils/export-csv';
import {
  DAY_LABEL_KEYS,
  type DailyRevenueRow,
  type HourlyHeatmapRow,
  type WeeklyRevenueRow,
} from '../analytics-data';
import type { Granularity } from './dateRangePresets';

/**
 * Download the heatmap's underlying revenue rows as CSV, shaped by the
 * card's effective granularity: the 7×24 hourly grid for weekly, one row
 * per calendar day for monthly, and one row per Monday-week for yearly.
 */
export function exportHeatmapCsv(
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
export function shortCacheLabel(key: string): string {
  const parts = key.split(':');
  if (parts[0] === 'card' && parts[1]) return parts[1]!;
  return parts[0] ?? key;
}
