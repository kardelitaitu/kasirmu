//! Bucket predicates shared by the trend cards.

import type { Bucket } from '../../analytics-data';

/**
 * Buckets with real activity. Zero-filled gaps mean "no data that
 * day" (no sales / no table orders), not a 0-value reading — rate
 * metrics (AOV, turn minutes) must average and trend over the active
 * buckets only. Sum metrics (revenue) keep the zeros: $0 is a real day.
 */
export function activeBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.filter((b) => b.value > 0);
}
