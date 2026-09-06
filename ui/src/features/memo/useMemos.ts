import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  acknowledgeMemoScoped,
  listActiveMemosScoped,
  type ActiveMemo,
} from '@/api/memos';

/**
 * Poll cadence for the memo display surface. Mirrors
 * `oz_core::memo::NOTIFICATION_BASE_INTERVAL_SECS` (900s = 15 min) — the
 * backend's notification cycle. Memos change rarely, so a long poll is enough
 * to pick up newly-published and expired memos without hammering the IPC
 * boundary. Kept in sync by comment, not import, because the Rust constant is
 * not exposed over IPC.
 */
export const MEMO_POLL_INTERVAL_MS = 900_000;

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
 * addressed to the caller's terminal, refreshes on the notification cadence,
 * and exposes acknowledge/dismiss.
 *
 * Acknowledge is durable (writes the recipient row, so the memo stops showing
 * on later polls); dismiss is a local, session-only hide. A memo already
 * acknowledged by this terminal is filtered out of `memos` so the banner never
 * nags about something the staff has confirmed reading.
 */
export function useMemos(): UseMemosResult {
  const { sessionToken } = useWorkspace();
  const [memos, setMemos] = useState<ActiveMemo[]>([]);
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
      setMemos(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load memos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (!sessionToken) return;
    const id = setInterval(() => void load(), MEMO_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load, sessionToken]);

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
