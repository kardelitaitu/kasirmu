//! `useKdsOffline` — offline resilience hook for the KDS screen.
//!
//! Provides:
//!   • Cached KDS orders in localStorage (last-known-good snapshot)
//!   • Pending-action queue for failed status updates (retried on reconnect)
//!   • Connection-status detection (backend unreachable)
//!   • Wrapped fetch/update functions with automatic cache + queue logic
//!   • OFF-03: durable optimistic projection — a locally-advanced status is
//!     persisted into the cached snapshot so a reload does not undo it
//!   • OFF-05: bounded retries with exponential backoff + a visible
//!     dead-letter list for exhausted/permanent failures
//!   • OFF-07: all storage is namespaced by store scope (`kds-*:{scope}`) and
//!     the cache carries an expiry, so stale order data and queued mutations
//!     never survive across stores/workspaces or indefinitely.
//!   • OFF-10: a `storage` listener keeps multiple tabs of the same scope
//!     coordinated — a write in one tab reloads the queue in the others.
//!
//! The hook does NOT depend on any Tauri APIs, making it testable in
//! plain vitest/JSDOM. All storage is via localStorage with try/catch
//! guards so it degrades gracefully when storage is unavailable.
//!
//! OFF-08: persistence failures are surfaced via `storageUnavailable`
//! instead of being silently swallowed — a KDS that cannot persist has no
//! durable recovery record, and the operator should know.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KdsOrder, KdsStatus } from '@/api/kds';

// ── Constants ───────────────────────────────────────────────────────

const LS_PREFIX_CACHED_ORDERS = 'kds-cached-orders';
const LS_PREFIX_LAST_SYNC = 'kds-last-sync';
const LS_PREFIX_OFFLINE_QUEUE = 'kds-offline-queue';
const LS_PREFIX_DEAD_LETTER = 'kds-offline-dead-letter';

/** OFF-05: max attempts before an action moves to the dead-letter list. */
export const MAX_RETRY_ATTEMPTS = 5;

/** OFF-05: backoff base (ms) — 1s, 2s, 4s, 8s with ±30% jitter. */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_JITTER = 0.3;

/**
 * OFF-07: cache retention window. A cached order snapshot older than this is
 * treated as expired on restore (stale orders must not linger indefinitely on
 * a shared terminal).
 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Build the store-scoped localStorage key. */
function scopedKey(prefix: string, scope: string | undefined): string {
  return scope ? `${prefix}:${scope}` : prefix;
}

// ── Types ───────────────────────────────────────────────────────────

/** A KDS action queued for retry after reconnection. */
export interface PendingKdsAction {
  /** Uniquely identifies the action (derived from order ID + target status). */
  id: string;
  /** The KDS order ID this action targets. */
  orderId: string;
  /** Target status to apply. */
  targetStatus: KdsStatus;
  /** Current retry count (for exponential backoff display). */
  retryCount: number;
  /** Timestamp of when the action was originally attempted. */
  createdAt: string;
  /** Last error message. */
  lastError: string;
  /** OFF-05: earliest allowed retry time (ISO). Actions are skipped until then. */
  nextAttemptAt?: string;
  /** OFF-07: the store scope the action was queued in (isolation). */
  storeId?: string;
}

/** OFF-05: an action that exhausted its retries and needs operator attention. */
export interface DeadLetterKdsAction extends PendingKdsAction {
  /** When the action was moved to the dead-letter list. */
  deadLetterAt: string;
}

/** Return type of the `useKdsOffline` hook. */
export interface UseKdsOfflineReturn {
  /** Whether the backend is currently reachable. */
  online: boolean;
  /** Last-known-good cached orders, or null if never fetched/expired. */
  cachedOrders: KdsOrder[] | null;
  /** Timestamp of last successful backend sync (ISO string, or null). */
  lastSyncAt: string | null;
  /** Number of actions pending retry. */
  pendingQueueLength: number;
  /** Pending actions for display/debug. */
  pendingActions: PendingKdsAction[];
  /** OFF-05: actions that exhausted retries and need operator attention. */
  deadLetterActions: DeadLetterKdsAction[];
  /** OFF-05: number of dead-lettered actions. */
  deadLetterLength: number;
  /** Whether the hook is in its initial loading state. */
  initialLoading: boolean;
  /** OFF-08: true when localStorage writes are failing (quota/unavailable). */
  storageUnavailable: boolean;

  /**
   * Wrap a fetch operation with cache fallback.
   *
   * On success: updates the cache + clears initialLoading.
   * On failure: returns cached orders (may be null), marks offline.
   *
   * After a successful fetch, automatically flushes the pending queue.
   */
  wrapFetch: (
    fetchFn: () => Promise<KdsOrder[]>,
  ) => Promise<{ orders: KdsOrder[]; fromCache: boolean }>;

  /**
   * Wrap a status-update operation with optimistic queue-on-failure.
   *
   * On success: clears any pending action for this order.
   * On failure: queues the action for retry AND persists the optimistic
   * status into the cached snapshot (OFF-03) so a reload keeps the
   * locally-advanced state visible.
   *
   * Returns `true` when the update succeeded, `false` when queued.
   */
  wrapUpdate: (
    orderId: string,
    targetStatus: KdsStatus,
    updateFn: () => Promise<unknown>,
  ) => Promise<boolean>;

  /** Manually retry all pending actions. Returns count of successes. */
  retryPending: (executeFn: (action: PendingKdsAction) => Promise<boolean>) => Promise<number>;

  /** Clear all pending actions (discard them). */
  clearPending: () => void;

  /** OFF-05: discard the dead-letter list (operator acknowledges failures). */
  clearDeadLetter: () => void;

  /**
   * OFF-05: move every dead-lettered action back into the pending queue
   * for a fresh bounded retry run and empty the dead-letter list.
   *
   * Returns the number of actions requeued. Unlike `clearDeadLetter`
   * (which discards operator intent), the actions are preserved and will
   * be replayed by the next `retryPending`/post-fetch flush.
   */
  requeueDeadLetter: () => number;

  /** Counter incremented on OS-level `online` event for fetch effect dependency. */
  forceRetryCounter: number;
}

// ── LocalStorage helpers ─────────────────────────────────────────────

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Write to localStorage. Returns false when persistence failed (OFF-08). */
function writeLS<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    /* quota exceeded or storage unavailable */
    return false;
  }
}

/** OFF-05: compute the next retry timestamp with exponential backoff + jitter. */
export function nextAttemptAt(retryCount: number): string {
  const exp = Math.pow(2, retryCount - 1); // retry 1 → 1s, 2 → 2s, 3 → 4s…
  const jitter = 1 + (Math.random() * 2 - 1) * BACKOFF_JITTER; // ±30%
  const delayMs = Math.round(BACKOFF_BASE_MS * exp * jitter);
  return new Date(Date.now() + delayMs).toISOString();
}

/** OFF-03: apply queued actions to a fetched snapshot deterministically. */
export function applyProjections(
  orders: KdsOrder[],
  queue: PendingKdsAction[],
): KdsOrder[] {
  if (queue.length === 0) return orders;
  return orders.map((order) => {
    const action = queue.find(
      (a) => a.orderId === order.id && a.targetStatus !== order.status,
    );
    return action ? { ...order, status: action.targetStatus } : order;
  });
}

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Provide offline resilience for the KDS screen.
 *
 * All storage is namespaced by `storeId` (OFF-07) so switching stores on a
 * shared terminal never leaks orders or queued mutations across contexts.
 * The cached snapshot expires after `CACHE_TTL_MS`.
 *
 * @example
 * ```tsx
 * const { online, cachedOrders, pendingQueueLength, wrapFetch, wrapUpdate, retryPending } =
 *   useKdsOffline(workspaceScope?.storeId);
 * ```
 */
export function useKdsOffline(storeId?: string): UseKdsOfflineReturn {
  // OFF-07: namespace every key by the store scope.
  const cachedKey = scopedKey(LS_PREFIX_CACHED_ORDERS, storeId);
  const syncKey = scopedKey(LS_PREFIX_LAST_SYNC, storeId);
  const queueKey = scopedKey(LS_PREFIX_OFFLINE_QUEUE, storeId);
  const deadKey = scopedKey(LS_PREFIX_DEAD_LETTER, storeId);

  const [online, setOnline] = useState(true);
  const [cachedOrders, setCachedOrders] = useState<KdsOrder[] | null>(() => {
    // OFF-07: expiry — an old snapshot is not returned as if it were fresh.
    const lastSync = readLS<string | null>(syncKey, null);
    if (lastSync) {
      const age = Date.now() - new Date(lastSync).getTime();
      if (!Number.isNaN(age) && age > CACHE_TTL_MS) {
        return null;
      }
    }
    return readLS<KdsOrder[] | null>(cachedKey, null);
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    () => readLS<string | null>(syncKey, null),
  );
  const [pendingActions, setPendingActions] = useState<PendingKdsAction[]>(
    () => readLS<PendingKdsAction[]>(queueKey, []),
  );
  const [deadLetterActions, setDeadLetterActions] = useState<DeadLetterKdsAction[]>(
    () => readLS<DeadLetterKdsAction[]>(deadKey, []),
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const [forceRetryCounter, setForceRetryCounter] = useState(0);
  // OFF-08: persistence failures are observable, not silently swallowed.
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  // PERF-KDS-01: `wrapFetch` MUST keep a stable identity across cache
  // updates. It previously closed over `cachedOrders`/`initialLoading`
  // directly, so every successful fetch produced a new `wrapFetch`, which
  // produced a new `fetchOrders` in KdsScreen, which re-ran the effect that
  // fetches and subscribes — an unbounded fetch/subscribe loop that
  // exhausted the WebView2 PostMessage queue on Windows
  // (0x80070718 "Not enough quota"). These refs mirror the state for the
  // callbacks; the state itself still drives rendering.
  const cachedOrdersRef = useRef(cachedOrders);
  cachedOrdersRef.current = cachedOrders;
  const initialLoadingRef = useRef(initialLoading);
  initialLoadingRef.current = initialLoading;

  // Expose pending queue length as a derived value.
  const pendingQueueLength = pendingActions.length;
  const deadLetterLength = deadLetterActions.length;

  // ── Cache helpers ──────────────────────────────────────────────────

  const updateCache = useCallback(
    (orders: KdsOrder[]) => {
      const now = new Date().toISOString();
      // OFF-03: persist the optimistic projection over fresh server data so a
      // reload while actions are still queued keeps the locally-advanced state.
      const queue = readLS<PendingKdsAction[]>(queueKey, []);
      const projected = applyProjections(orders, queue);
      setCachedOrders(projected);
      setLastSyncAt(now);
      const ok1 = writeLS(cachedKey, projected);
      const ok2 = writeLS(syncKey, now);
      if (!ok1 || !ok2) setStorageUnavailable(true);
    },
    [cachedKey, queueKey, syncKey],
  );

  /** OFF-03: project a single status change onto the cached snapshot. */
  const projectStatusOntoCache = useCallback(
    (orderId: string, targetStatus: KdsStatus) => {
      setCachedOrders((prev) => {
        if (!prev) return prev;
        const next = prev.map((o) =>
          o.id === orderId ? { ...o, status: targetStatus } : o,
        );
        const ok = writeLS(cachedKey, next);
        if (!ok) setStorageUnavailable(true);
        return next;
      });
    },
    [cachedKey],
  );

  const loadQueue = useCallback(() => {
    const q = readLS<PendingKdsAction[]>(queueKey, []);
    setPendingActions(q);
    return q;
  }, [queueKey]);

  const saveQueue = useCallback(
    (queue: PendingKdsAction[]) => {
      setPendingActions(queue);
      const ok = writeLS(queueKey, queue);
      if (!ok) setStorageUnavailable(true);
    },
    [queueKey],
  );

  const loadDeadLetter = useCallback(() => {
    const d = readLS<DeadLetterKdsAction[]>(deadKey, []);
    setDeadLetterActions(d);
    return d;
  }, [deadKey]);

  const saveDeadLetter = useCallback(
    (dead: DeadLetterKdsAction[]) => {
      setDeadLetterActions(dead);
      const ok = writeLS(deadKey, dead);
      if (!ok) setStorageUnavailable(true);
    },
    [deadKey],
  );

  // ── wrapFetch ──────────────────────────────────────────────────────

  const wrapFetch = useCallback(
    async (
      fetchFn: () => Promise<KdsOrder[]>,
    ): Promise<{ orders: KdsOrder[]; fromCache: boolean }> => {
      try {
        const orders = await fetchFn();
        // Backend is reachable — update cache, mark online.
        setOnline(true);
        updateCache(orders);
        if (initialLoadingRef.current) setInitialLoading(false);

        return { orders, fromCache: false };
      } catch {
        // Backend unreachable — fall back to cache.
        setOnline(false);
        if (initialLoadingRef.current) setInitialLoading(false);

        const cached = cachedOrdersRef.current;
        if (cached) {
          return { orders: cached, fromCache: true };
        }

        // No cache available either — return empty array.
        return { orders: [], fromCache: true };
      }
    },
    // PERF-KDS-01: deliberately depends only on `updateCache` (stable per
    // store scope). Reading cache/loading through refs keeps the identity
    // stable so KdsScreen's fetch effect does not re-subscribe per fetch.
    [updateCache],
  );

  // ── wrapUpdate ─────────────────────────────────────────────────────

  const wrapUpdate = useCallback(
    async (
      orderId: string,
      targetStatus: KdsStatus,
      updateFn: () => Promise<unknown>,
    ): Promise<boolean> => {
      try {
        await updateFn();
        // Success — clear any pending action for this order.
        setOnline(true);
        const queue = loadQueue();
        const remaining = queue.filter((a) => a.orderId !== orderId);
        if (remaining.length !== queue.length) {
          saveQueue(remaining);
        }
        return true;
      } catch (e) {
        // Failure — queue the action for retry.
        setOnline(false);
        const action: PendingKdsAction = {
          id: `${orderId}->${targetStatus}`,
          orderId,
          targetStatus,
          retryCount: 0,
          createdAt: new Date().toISOString(),
          lastError: e instanceof Error ? e.message : String(e),
          // OFF-07: bind the mutation to the store scope it was created in.
          ...(storeId ? { storeId } : {}),
        };

        const queue = loadQueue();
        // Deduplicate — replace existing action for same order+status.
        const filtered = queue.filter((a) => a.id !== action.id);
        filtered.push(action);
        saveQueue(filtered);

        // OFF-03: persist the optimistic status into the cached snapshot so
        // a reload keeps the locally-advanced state visible.
        projectStatusOntoCache(orderId, targetStatus);

        return false;
      }
    },
    [loadQueue, saveQueue, projectStatusOntoCache, storeId],
  );

  // ── retryPending ───────────────────────────────────────────────────

  const retryPending = useCallback(
    async (
      executeFn: (action: PendingKdsAction) => Promise<boolean>,
    ): Promise<number> => {
      const queue = loadQueue();
      if (queue.length === 0) return 0;

      // OFF-07: never replay actions from another store scope.
      const scoped = storeId ? queue.filter((a) => !a.storeId || a.storeId === storeId) : queue;
      if (scoped.length === 0) {
        saveQueue([]);
        return 0;
      }

      const now = Date.now();
      let successes = 0;
      const kept: PendingKdsAction[] = [];
      const dead: DeadLetterKdsAction[] = [];

      for (const action of scoped) {
        // OFF-05: skip actions whose backoff window has not elapsed.
        if (action.nextAttemptAt && new Date(action.nextAttemptAt).getTime() > now) {
          kept.push(action);
          continue;
        }
        try {
          const ok = await executeFn(action);
          if (ok) {
            successes++;
          } else {
            const next = {
              ...action,
              retryCount: action.retryCount + 1,
              nextAttemptAt: nextAttemptAt(action.retryCount + 1),
            };
            if (next.retryCount >= MAX_RETRY_ATTEMPTS) {
              dead.push({
                ...next,
                deadLetterAt: new Date().toISOString(),
              });
            } else {
              kept.push(next);
            }
          }
        } catch (e) {
          const next = {
            ...action,
            retryCount: action.retryCount + 1,
            lastError: e instanceof Error ? e.message : 'Retry failed',
            nextAttemptAt: nextAttemptAt(action.retryCount + 1),
          };
          if (next.retryCount >= MAX_RETRY_ATTEMPTS) {
            dead.push({
              ...next,
              deadLetterAt: new Date().toISOString(),
            });
          } else {
            kept.push(next);
          }
        }
      }

      saveQueue(kept);
      if (dead.length > 0) {
        const existing = loadDeadLetter();
        saveDeadLetter([...existing, ...dead]);
      }
      if (kept.length === 0) {
        setOnline(true);
      }
      return successes;
    },
    [loadQueue, saveQueue, loadDeadLetter, saveDeadLetter, storeId],
  );

  // ── clearPending / clearDeadLetter ─────────────────────────────────

  const clearPending = useCallback(() => {
    saveQueue([]);
  }, [saveQueue]);

  const clearDeadLetter = useCallback(() => {
    saveDeadLetter([]);
  }, [saveDeadLetter]);

  // ── requeueDeadLetter ──────────────────────────────────────────────

  const requeueDeadLetter = useCallback((): number => {
    const dead = loadDeadLetter();
    if (dead.length === 0) return 0;
    // Re-arm each action for a fresh bounded retry run: reset the retry
    // counter and backoff window (the operator explicitly asked for
    // another attempt), and drop the dead-letter bookkeeping fields.
    const requeued: PendingKdsAction[] = dead.map((a) => ({
      id: a.id,
      orderId: a.orderId,
      targetStatus: a.targetStatus,
      retryCount: 0,
      createdAt: a.createdAt,
      lastError: a.lastError,
      ...(a.storeId ? { storeId: a.storeId } : {}),
    }));
    // Append to the pending queue (dedupe by action id in case the same
    // order+status was also re-queued by a newer failure).
    const queue = loadQueue();
    const seen = new Set(requeued.map((a) => a.id));
    const merged = [...queue.filter((a) => !seen.has(a.id)), ...requeued];
    saveQueue(merged);
    saveDeadLetter([]);
    return requeued.length;
  }, [loadDeadLetter, loadQueue, saveQueue, saveDeadLetter]);

  // ── Listen for OS-level online/offline events ──────────────────────

  useEffect(() => {
    const handleOnline = () => {
      setForceRetryCounter((prev) => prev + 1);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // ── OFF-10: cross-tab coordination ─────────────────────────────────
  // Another tab of the same scope may queue actions or update the cache.
  // Re-read the scoped keys so all tabs see the same durable state.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === queueKey) {
        loadQueue();
      } else if (e.key === cachedKey) {
        const v = readLS<KdsOrder[] | null>(cachedKey, null);
        setCachedOrders(v);
      } else if (e.key === deadKey) {
        loadDeadLetter();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [queueKey, cachedKey, deadKey, loadQueue, loadDeadLetter]);

  return {
    online,
    cachedOrders,
    lastSyncAt,
    pendingQueueLength,
    pendingActions,
    deadLetterActions,
    deadLetterLength,
    initialLoading,
    storageUnavailable,
    wrapFetch,
    wrapUpdate,
    retryPending,
    clearPending,
    clearDeadLetter,
    requeueDeadLetter,
    forceRetryCounter,
  };
}
