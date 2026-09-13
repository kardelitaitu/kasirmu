//! Per-card cached query hooks + row-delta attach. Every card loads real
//! backend data through `CARD_LOADERS`, keyed so an identical query
//! revisits the TTL cache instead of refetching.

import { useMemo } from 'react';
import { useAnalyticsQuery } from '../../useAnalyticsQuery';
import { cardQueryKey } from '../../analytics-cache';
import {
  CARD_LOADERS,
  CARD_PAYLOAD_VALIDATORS,
  previousRange,
  periodDelta,
  type AnalyticsQuery,
  type RankRow,
} from '../../analytics-data';

/**
 * Per-card cached query — keyed by (card, workspace, granularity, range)
 * so an identical query revisits the TTL cache instead of refetching.
 * Every card loads through `CARD_LOADERS` (real backend data).
 * Returns `null` while an async query is in flight.
 *
 * `enabled=false` (the comparison baseline while compare mode is off)
 * never fetches and always yields `data: null`.
 */
export function useCardData<T>(
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
export function useCardDataCompare<T>(
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
export function rowDeltas(cur: RankRow[], prev: RankRow[] | null | undefined): RankRow[] {
  if (!prev) return cur;
  const prevByName = new Map(prev.map((r) => [r.name, r.value]));
  return cur.map((r) => {
    const pv = prevByName.get(r.name);
    const d = pv !== undefined ? periodDelta(r.value, pv) : null;
    return d !== null ? { ...r, delta: d } : r;
  });
}
