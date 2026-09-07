import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { plainErrorMessage } from '@/utils/app-error';
import {
  acknowledgeMemoScoped,
  listActiveMemosScoped,
  type ActiveMemo,
  type MemoCadence,
} from '@/api/memos';

/**
 * Options for the memo display surface.
 *
 * `kds` selects the server-issued doubled interval (KDS kitchen traffic
 * cannot afford the base-interrupt cadence). The multiplier itself lives in
 * `oz_core::memo::KDS_INTERVAL_MULTIPLIER` and arrives over IPC — the UI
 * never hardcodes either interval.
 */
export interface UseMemosOptions {
  kds?: boolean;
}

export interface UseMemosResult {
  /** Memos this terminal should display: not acknowledged, not dismissed. */
  memos: ActiveMemo[];
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Last fetch error message, or null. */
  error: string | null;
  /** Acknowledge a memo (persists delivery state) and drop it from view. */
  acknowledge: (memoId: string) => void;
  /** Hide a memo for this session only (reappears on the next poll). */
  dismiss: (memoId: string) => void;
  /** Force an immediate refetch. */
  refresh: () => void;
}

/**
 * Backing state for the Memo display surface (Phase 2 P1). Fetches the memos
 * addressed to the caller's terminal, refreshes on the server-issued cadence,
 * and exposes acknowledge/dismiss.
 *
 * The poll interval is the one the backend serves with the first response
 * (`baseIntervalSecs`, or `kdsIntervalSecs` for KDS surfaces) — no interval
 * literal lives in the UI, so a backend cadence change propagates without a
 * front-end edit and cannot drift.
 *
 * Acknowledge is durable (writes the recipient row, so the memo stops showing
 * on later polls); dismiss is a local, session-only hide. A memo already
 * acknowledged by this terminal is filtered out of `memos` so the banner never
 * nags about something the staff has confirmed reading.
 */
export function useMemos(options: UseMemosOptions = {}): UseMemosResult {
  const { kds = false } = options;
  const { sessionToken } = useWorkspace();
  const [memos, setMemos] = useState<ActiveMemo[]>([]);
  const [cadence, setCadence] = useState<MemoCadence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Keep the latest token in a ref so the interval callback and the
  // acknowledge path never capture a stale closure, and the poll effect does
  // not tear down/rebuild on every token identity change.
  const tokenRef = useRef(sessionToken);
  tokenRef.current = sessionToken;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setMemos([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const result = await listActiveMemosScoped(token);
      setMemos(result.memos);
      setCadence(result.cadence);
      setError(null);
    } catch (e) {
      // Non-Fluent hook: route through the shared user-safe mapper (ERR-05/10)
      // — raw backend text never reaches the exposed error field.
      setError(plainErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch. The poll interval is deliberately NOT scheduled here —
  // it starts only once the server has told us the cadence (see below), so
  // there is no client-side fallback literal to drift from the backend.
  useEffect(() => {
    void load();
    if (!sessionToken) return;
  }, [load, sessionToken]);

  // Poll on the server-issued interval, choosing the KDS value when the
  // surface is KDS. Rebuilt when the cadence changes so a backend change
  // propagates after the next response.
  useEffect(() => {
    if (!sessionToken || !cadence) return;
    const secs = kds ? cadence.kdsIntervalSecs : cadence.baseIntervalSecs;
    const id = setInterval(() => void load(), secs * 1000);
    return () => clearInterval(id);
  }, [load, sessionToken, cadence, kds]);

  // Dev-only bridge (same shape as AppShell's `app:lock` listener): the
  // dev toolbar's "Spawn memo" buttons publish through the real IPC
  // surface and then fire `memos:refresh`, so a freshly published memo
  // appears without waiting out the (up to 15-minute) poll cadence.
  // Gated to dev builds — production has no dispatcher and must not
  // carry a listener for an event nothing sends.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = () => void load();
    window.addEventListener('memos:refresh', handler);
    return () => window.removeEventListener('memos:refresh', handler);
  }, [load]);

  const acknowledge = useCallback((memoId: string) => {
    // Optimistically drop it from view; the durable write follows.
    setMemos((prev) => prev.filter((m) => m.memo.id !== memoId));
    const token = tokenRef.current;
    if (token) {
      void acknowledgeMemoScoped(token, memoId).catch(() => {
        // Non-fatal: a failed ack just means the memo reappears on next poll.
      });
    }
  }, []);

  const dismiss = useCallback((memoId: string) => {
    setDismissedIds((prev) => {
      if (prev.has(memoId)) return prev;
      const next = new Set(prev);
      next.add(memoId);
      return next;
    });
  }, []);

  const visible = memos.filter(
    (m) => m.deliveryStatus !== 'acknowledged' && !dismissedIds.has(m.memo.id),
  );

  return { memos: visible, loading, error, acknowledge, dismiss, refresh: load };
}
