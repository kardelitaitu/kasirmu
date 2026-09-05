import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { requiredLocalized, LoadingStatus } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { listKdsOrdersScoped, type KdsOrder } from '@/api/kds';
import './KdsCompletedView.css';

/** Time-bucket labels and their day-range condition. Exported so tests use the real
 *  ranges instead of a second copy that nothing keeps in step. */
export const BUCKETS = [
  { key: 'today',     start: 0, end: 1 },
  { key: 'yesterday', start: 1, end: 2 },
  { key: 'this-week', start: 2, end: 7 },
  { key: 'older',     start: 7, end: Infinity },
] as const;

/**
 * The bucket an order's day-offset falls into, or null when none does.
 *
 * Extracted from the inline loop in the `bucketed` memo, which previously scanned BUCKETS
 * inside the component. Returning null rather than a default preserves the old behaviour
 * exactly: an offset matching no range was silently dropped, not filed under "older".
 * That is unreachable today -- dayOffset clamps at 0 and `older` spans [7, Infinity) --
 * but the fallback was never part of the contract, so it is not being added now.
 */
export function bucketForOffset(offset: number): string | null {
  for (const b of BUCKETS) {
    if (offset >= b.start && offset < b.end) return b.key;
  }
  return null;
}

/** Day offset from today for the order's completion time (served_at or received_at). */
export function dayOffset(ts: string): number {
  const now = new Date();
  const d = new Date(ts);
  // Normalise to date-only (midnight) so "today" = same calendar day.
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const orderDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.floor((nowDay - orderDay) / 86_400_000));
}

/** Format duration between two timestamps as "Xm Ys" or "Xh Ym". */
export function fmtDuration(from: string, to: string): string {
  const sec = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * KdsCompletedView — the prototype completed-tab view (dev/kds-prototype.html):
 * time-bucket columns (Today / Yesterday / This Week / Older) with collapsible
 * bucket headers. Each card is a minimized .kds-card showing order# + table +
 * items + duration + status, with a Reopen button.
 *
 * Replaces KdsHistoryPanel in the Completed tab (Phase 5).
 */
export function KdsCompletedView({
  onReopen,
  completedFilter = 'all',
  active = true,
}: {
  onReopen?: (orderId: string) => void;
  completedFilter?: 'all' | 'dinein' | 'takeaway';
  /** Whether the Completed tab is the visible pane — a stale-while-hidden
   *  pane fetched only on mount and never refreshed for a whole shift. */
  active?: boolean;
}) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<string>>(new Set());
  const loadSeqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setFetchFailed(false);
    // Fetch served orders — the completed tab shows finished tickets.
    listKdsOrdersScoped(sessionToken, 'served')
      .then((result) => {
        if (seq !== loadSeqRef.current) return;
        setOrders(result);
        setLoading(false);
      })
      .catch(() => {
        if (seq !== loadSeqRef.current) return;
        setLoading(false);
        // Surface a distinguishable error — an empty board used to be
        // indistinguishable from "the fetch failed" (and from "no orders").
        setFetchFailed(true);
      });
  }, [sessionToken]);

  useEffect(() => {
    // Refetch whenever the pane becomes visible: both panes stay mounted
    // (aria-hidden toggle), so a mount-only fetch went stale all shift.
    if (!active) return;
    load();
  }, [active, load]);

  // Filter completed orders by order type (All / Dine in / Takeaway)
  const filteredOrders = useMemo(() => {
    if (completedFilter === 'dinein') {
      return orders.filter((o) => !!o.table_number && o.table_number.trim() !== '');
    }
    if (completedFilter === 'takeaway') {
      return orders.filter((o) => !o.table_number || o.table_number.trim() === '');
    }
    return orders;
  }, [orders, completedFilter]);

  // Bucket the orders by completion time.
  const bucketed = useMemo(() => {
    const map = new Map<string, KdsOrder[]>();
    for (const b of BUCKETS) map.set(b.key, []);
    for (const o of filteredOrders) {
      const ref = o.served_at || o.received_at;
      const key = bucketForOffset(dayOffset(ref));
      if (key) map.get(key)!.push(o);
    }
    return map;
  }, [filteredOrders]);

  const toggleBucket = useCallback((key: string) => {
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="kds-main completed-view kds-completed-view--loading">
        <LoadingStatus label={requiredLocalized(l10n, 'kds-history-loading')}>
          <span className="kds-refresh-spinner" />
        </LoadingStatus>
      </div>
    );
  }

  if (fetchFailed) {
    return (
      <div className="kds-main completed-view" role="region" aria-label={requiredLocalized(l10n, 'kds-completed-aria')}>
        <div className="kds-completed-error" role="alert">
          <span>
            <Localized id="kds-completed-load-failed">Failed to load completed orders</Localized>
          </span>
          <button
            type="button"
            className="kds-btn kds-btn--muted"
            onClick={load}
            aria-label={requiredLocalized(l10n, 'kds-completed-retry-aria')}
            data-testid="kds-completed-retry"
          >
            <Localized id="kds-offline-retry">Retry</Localized>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kds-main completed-view" role="region" aria-label={requiredLocalized(l10n, 'kds-completed-aria')}>
      {BUCKETS.map(({ key }) => {
        const items = bucketed.get(key) ?? [];
        const collapsed = collapsedBuckets.has(key);
        return (
          <div key={key} className="kds-col">
            <button
              className="kds-completed-col-head"
              onClick={() => toggleBucket(key)}
              aria-expanded={!collapsed}
              aria-label={requiredLocalized(l10n, `kds-completed-${key}`)}
              data-testid={`kds-completed-col-${key}`}
            >
              <span>
                <Localized id={`kds-completed-${key}`}>{key}</Localized>
                <span className="kds-completed-col-count"> ({items.length})</span>
              </span>
              <span className="kds-completed-col-chev" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
            </button>
            {!collapsed && items.length === 0 && (
              <p className="kds-empty kds-completed-view__empty">
                <Localized id={`kds-completed-${key}-empty`}>No orders</Localized>
              </p>
            )}
            {!collapsed && items.map((order) => {
              const ref = order.served_at || order.received_at;
              return (
                <div key={order.id} className="kds-ticket kds-completed-ticket">
                  <div className="kds-card-header kds-completed-ticket__header">
                    <span className="kds-card-header-left">
                      <span className="kds-card-header-row">
                        <span className="order-no">#{order.display_number}</span>
                        {order.table_number && <span className="kds-ticket-table">{order.table_number}</span>}
                      </span>
                    </span>
                    <span className="kds-card-header-right">
                      <span className="kds-card-header-meta">
                        <span className="kds-ticket-time kds-ticket-time--green">{fmtDuration(order.received_at, ref)}</span>
                        <span className="status prepared">
                          <Localized id="kds-completed-status">Completed</Localized>
                        </span>
                      </span>
                    </span>
                  </div>
                  <div className="kds-completed-ticket__summary">
                    {order.items_summary}
                  </div>
                  <div className="kds-card-footer">
                    <div className="kds-footer-actions">
                      <button
                        className="kds-status-btn reopen"
                        onClick={(e) => { e.stopPropagation(); onReopen?.(order.id); }}
                        aria-label={requiredLocalized(l10n, 'kds-completed-reopen-aria', { number: order.display_number ?? 0 })}
                        data-testid={`kds-order-card-${order.display_number ?? order.id}-status-reopen`}
                      >
                        <Localized id="kds-completed-reopen">Reopen</Localized>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
