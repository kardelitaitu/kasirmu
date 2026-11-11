//! Cache-first data hook for analytics queries.
//!
//! `useAnalyticsQuery(key, fetcher)` returns the query's result from the
//! shared TTL cache when one exists, and otherwise runs `fetcher` and
//! stores the result. Identical queries made within the cache TTL are
//! served instantly — switching granularity or workspace back and forth
//! does not recompute or refetch.
//!
//! `fetcher` may be synchronous (pure helpers) or return a Promise (the
//! real IPC commands); async fetchers surface a `loading` status until
//! they resolve.
//!
//! Failed fetches do NOT retry on every render. A rejection is recorded
//! in a module-level error map (keyed by query key) and rendered as a
//! stable `error` status; the screen's refresh action clears the map via
//! `clearAnalyticsErrors()` so a user-initiated retry refetches. This
//! prevents the old behavior where a rejected IPC call re-invoked the
//! fetcher on every re-render — an infinite retry loop that hammered the
//! backend with no user-visible result.

import { useEffect, useRef, useState } from 'react';
import { analyticsDataCache } from './analytics-cache';

export type QueryStatus = 'loading' | 'ready' | 'error';

export interface AnalyticsQueryResult<T> {
  data: T | null;
  status: QueryStatus;
  /** Raw failure when `status === 'error'`; `null` otherwise. */
  error: unknown;
}

/** Per-key failures, module-level so refresh can clear them globally. */
const failures = new Map<string, unknown>();

/** Forget every recorded query failure (called by the refresh action). */
export function clearAnalyticsErrors(): void {
  failures.clear();
}

/** Internal cache read: carries the TTL freshness used by stale-while-revalidate. */
interface CachedRead<T> {
  data: T;
  fresh: boolean;
}

/** Read the shared cache with the right payload type. */
function readCached<T>(
  key: string,
  validate?: (value: unknown) => boolean,
): CachedRead<T> | undefined {
  const hit = analyticsDataCache.get(key);
  if (!hit) return undefined;
  if (validate && !validate(hit.value)) {
    // Shape mismatch — schema drift without a version bump, or a corrupt
    // snapshot. Drop the entry so it can't be served again and treat the
    // read as a miss so the hook refetches below.
    analyticsDataCache.invalidate(key);
    return undefined;
  }
  return { data: hit.value as T, fresh: hit.fresh };
}

/**
 * Cache-first query hook.
 *
 * Sync fetchers resolve during render, so there is never an empty
 * flash: a miss computes once, stores the result in the shared cache,
 * and every later render reads the cache hit. The write is idempotent
 * and deterministic, which keeps it safe to run during render. Async
 * fetchers render `loading` until the promise resolves, then cache the
 * resolved value.
 *
 * On failure the key is recorded in the module error map and the hook
 * returns `status: 'error'` on subsequent renders WITHOUT re-invoking
 * the fetcher. Only `clearAnalyticsErrors()` (refresh) or a new key
 * (workspace/granularity change) allows a retry.
 *
 * An optional `validate` guard checks a cached value's shape before it is
 * served: a value that no longer matches (schema drift without a version
 * bump, or a corrupt snapshot) is invalidated and refetched instead of
 * being cast blindly into `T`.
 */
export function useAnalyticsQuery<T>(
  key: string,
  fetcher: () => T | Promise<T>,
  enabled = true,
  validate?: (value: unknown) => boolean,
): AnalyticsQueryResult<T> {
  const [, forceRender] = useState(0);
  const inflight = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Disabled queries (e.g. the previous-period baseline while comparison
  // mode is off) never fetch and report a neutral loading state.
  if (!enabled) {
    return { data: null, status: 'loading', error: null };
  }

  const cached = readCached<T>(key, validate);
  if (cached) {
    // Stale-while-revalidate: a value past its TTL renders immediately
    // while a background refetch refreshes the cache for the next render.
    // A previously-failed key skips revalidation (no retry loop) and a
    // key already in flight is not double-fetched.
    if (!cached.fresh && !failures.has(key) && inflight.current !== key) {
      inflight.current = key;
      Promise.resolve(fetcher()).then(
        (value) => {
          analyticsDataCache.set(key, value);
          inflight.current = null;
          failures.delete(key);
          if (mountedRef.current) forceRender((n) => n + 1); // next render reads the fresh hit
        },
        (err) => {
          inflight.current = null;
          failures.set(key, err);
          if (mountedRef.current) forceRender((n) => n + 1);
        },
      );
    }
    // A revalidation that already failed must not keep serving the stale
    // value indefinitely: surface the error so the card renders its error
    // state, and the refresh action clears it for an explicit retry.
    if (failures.has(key)) {
      return { data: null, status: 'error', error: failures.get(key) };
    }
    return { data: cached.data, status: 'ready', error: null };
  }

  // A previously failed key stays failed until explicitly cleared —
  // never re-invoke the fetcher implicitly (no infinite retry loop).
  if (failures.has(key)) {
    return { data: null, status: 'error', error: failures.get(key) };
  }

  // A miss — but skip re-invoking the fetcher while an async request
  // for this same key is already in flight (StrictMode double-renders
  // would otherwise fire the fetch twice).
  if (inflight.current === key) {
    return { data: null, status: 'loading', error: null };
  }

  let out: T | Promise<T>;
  try {
    out = fetcher();
  } catch (e) {
    // Sync fetchers can throw during render — surface as an error
    // instead of crashing the tree.
    failures.set(key, e);
    return { data: null, status: 'error', error: e };
  }

  if (out instanceof Promise) {
    inflight.current = key;
    out.then(
      (value) => {
        analyticsDataCache.set(key, value);
        inflight.current = null;
        failures.delete(key);
        if (mountedRef.current) forceRender((n) => n + 1); // next render reads the cache hit
      },
      (err) => {
        inflight.current = null;
        failures.set(key, err);
        if (mountedRef.current) forceRender((n) => n + 1);
      },
    );
    return { data: null, status: 'loading', error: null };
  }

  analyticsDataCache.set(key, out);
  return { data: out, status: 'ready', error: null };
}
