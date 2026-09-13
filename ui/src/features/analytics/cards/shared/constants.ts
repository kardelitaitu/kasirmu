//! Display-label maps and stable defaults shared by analytics cards and
//! their CSV exporters.

import type { Bucket } from '../../analytics-data';

/**
 * Fluent message ids for the payment methods the backend reports. The CSV
 * exporter and the payments card both resolve these, so the map lives here
 * rather than in either one — a divergence would make the download's column
 * labels disagree with the on-screen legend.
 */
export const PAYMENT_NAMES: Record<string, string> = {
  cash: 'analytics-card-payments-cash',
  card: 'analytics-card-payments-card',
  qris: 'analytics-card-payments-qris',
  ewallet: 'analytics-card-payments-ewallet',
};

/**
 * Largest-remainder rounding of a set of percentages so the segments
 * always sum to exactly 100 instead of drifting from independent rounding.
 */
export function largestRemainderPcts(values: number[], total: number): number[] {
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

/** Stable empty bucket list — a card's `buckets` fallback so a fresh `[]`
 *  literal isn't recreated every render (a referential-stability fix for
 *  the chart's `useMemo` dependency array). */
export const NO_BUCKETS: Bucket[] = [];

/** Stable empty hourly occupancy curve — the occupancy card's `hourly`
 *  fallback (same referential-stability fix as {@link NO_BUCKETS}). */
export const NO_HOURLY: { hour: number; table_orders: number; pct: number; level: number }[] = [];

/** Stable empty number list — the occupancy card's `prevPct` fallback (same
 *  referential-stability fix as {@link NO_BUCKETS}). */
export const NO_NUMBERS: number[] = [];

/**
 * Stock at or below this many units is flagged "critical" (vs merely
 * "low") in the low-stock card — the red severity tier that precedes a
 * full out-of-stock.
 */
export const CRITICAL_STOCK_LEVEL = 5;
