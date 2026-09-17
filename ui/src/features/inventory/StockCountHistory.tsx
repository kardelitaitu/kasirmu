import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { l10nErrorMessage } from '@/utils/app-error';
import {
  listStockCounts,
  listStockAdjustments,
  getCountLines,
  type StockCountDto,
  type StockCountLineDto,
  type StockAdjustmentDto,
} from '@/api/inventoryCounts';
import { Skeleton } from '@/components/Skeleton';
import './StockCountHistory.css';
// The sc-badge family this screen paints at :161 lives in its own sheet, not in the
// list screen's -- import it here so the styling no longer depends on the flow's static import.
import './StockCountBadge.css';

/** Stock count history screen — lists completed and cancelled counts alongside stock adjustments with drill-down into individual count lines. */
export default function StockCountHistory() {
  const [counts, setCounts] = useState<StockCountDto[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCount, setSelectedCount] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<StockCountLineDto[]>([]);

  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { addToast } = useToast();
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!sessionToken) throw new Error(requiredLocalized(l10nRef.current, 'sc-error-session'));
      const [c, a] = await Promise.all([
        listStockCounts(sessionToken),
        listStockAdjustments(sessionToken),
      ]);
      setCounts(c.filter((cnt) => cnt.status === 'completed' || cnt.status === 'cancelled'));
      setAdjustments(a);
    } catch (err) {
      const message = l10nErrorMessage(err, l10nRef.current, 'sc-error-load-history');
      setError(message);
      addToast({ message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const handleSelectCount = useCallback(async (id: string) => {
    setSelectedCount(id);
    try {
      if (!sessionToken) throw new Error(requiredLocalized(l10nRef.current, 'sc-error-session'));
      const lines = await getCountLines(sessionToken, id);
      setSelectedLines(lines);
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'sc-error-load-lines'), type: 'error' });
      setSelectedLines([]);
    }
  }, [addToast, sessionToken]);

  const countAdjustments = useMemo(() => {
    if (!selectedCount) return [];
    return adjustments.filter((a) => a.count_id === selectedCount);
  }, [adjustments, selectedCount]);

  if (loading) {
    return (
      <div className="sc-hist-screen" aria-hidden="true">
        <div className="sc-hist-header">
          <Skeleton variant="block" width="14rem" height="1.5rem" />
        </div>
        <div className="sc-hist-layout">
          <div className="sc-hist-list">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sc-hist-item">
                <Skeleton variant="text" width={`${5 + (i % 3) * 2}rem`} height="0.875rem" />
                <Skeleton variant="block" width="4rem" height="1rem" style={{ borderRadius: 'var(--radius-sm)' }} />
                <Skeleton variant="text" width="6rem" height="0.75rem" />
              </div>
            ))}
          </div>
          <div className="sc-hist-detail">
            <div className="sc-hist-table">
              <div className="sc-hist-tr sc-hist-th">
                <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
                <span><Skeleton variant="text" width="4rem" height="0.75rem" /></span>
                <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
                <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
                <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
              </div>
              {[0, 1, 2, 3].map((r) => (
                <div key={r} className="sc-hist-tr">
                  <span><Skeleton variant="text" width="4rem" height="0.75rem" /></span>
                  <span><Skeleton variant="text" width="7rem" height="0.875rem" /></span>
                  <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
                  <span><Skeleton variant="text" width="3rem" height="0.75rem" /></span>
                  <span><Skeleton variant="text" width="5rem" height="0.75rem" /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sc-hist-screen">
        <div className="sc-hist-header">
          <h1 className="sc-title">
            <Localized id="sc-hist-title"><span>Stock Count History</span></Localized>
          </h1>
        </div>
        <div className="sc-load-error" role="alert">
          <p>{error}</p>
          <button type="button" className="sc-retry-btn" onClick={load}>
            <Localized id="retry"><span>Retry</span></Localized>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sc-hist-screen">
      <div className="sc-hist-header">
        <h1 className="sc-title">
          <Localized id="sc-hist-title">
            <span>Stock Count History</span>
          </Localized>
        </h1>
      </div>

      {counts.length === 0 ? (
        <p className="sc-hist-empty">
          <Localized id="sc-hist-empty">
            <span>No completed or cancelled counts yet.</span>
          </Localized>
        </p>
      ) : (
        <div className="sc-hist-layout">
          <div className="sc-hist-list">
            {counts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`sc-hist-item ${selectedCount === c.id ? 'sc-hist-item--sel' : ''}`}
                onClick={() => handleSelectCount(c.id)}
              >
                <span className="sc-hist-item-number">{c.count_number}</span>
                <span className={`sc-badge sc-badge--${c.status}`}>
                  <Localized id={`sc-status-${c.status}`}>{c.status}</Localized>
                </span>
                <span className="sc-hist-item-date">{new Date(c.created_at).toLocaleDateString(numLocale)}</span>
              </button>
            ))}
          </div>

          {selectedCount && (
            <div className="sc-hist-detail">
              <h2>
                <Localized id="sc-hist-reconciliation">
                  <span>Reconciliation Report</span>
                </Localized>
              </h2>

              {selectedLines.length > 0 && (
                <div className="sc-hist-lines">
                  <h3><Localized id="sc-hist-lines-title"><span>Count Lines</span></Localized></h3>
                  <div className="sc-hist-table">
                    <div className="sc-hist-tr sc-hist-th">
                      <span><Localized id="sc-col-sku">SKU</Localized></span><span><Localized id="sc-col-name">Product</Localized></span><span><Localized id="sc-col-expected">Expected</Localized></span><span><Localized id="sc-col-counted">Counted</Localized></span><span><Localized id="sc-col-diff">Diff</Localized></span>
                    </div>
                    {selectedLines.map((l) => (
                      <div key={l.id} className="sc-hist-tr">
                        <span>{l.sku}</span>
                        <span>{l.product_name}</span>
                        <span>{l.expected_qty}</span>
                        <span>{l.counted_qty ?? '—'}</span>
                        <span className={l.difference < 0 ? 'sc-diff-neg' : l.difference > 0 ? 'sc-diff-pos' : ''}>
                          {l.counted_qty != null ? (l.difference > 0 ? '+' : '') + l.difference : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {countAdjustments.length > 0 && (
                <div className="sc-hist-adjustments">
                  <h3><Localized id="sc-hist-adjust-title"><span>Adjustments Applied</span></Localized></h3>
                  <div className="sc-hist-table">
                    <div className="sc-hist-tr sc-hist-th">
                      <span><Localized id="sc-col-sku">SKU</Localized></span><span><Localized id="sc-col-name">Product</Localized></span><span><Localized id="sc-col-previous">Previous</Localized></span><span><Localized id="sc-col-new">New</Localized></span><span><Localized id="sc-col-reason">Reason</Localized></span>
                    </div>
                    {countAdjustments.map((a) => (
                      <div key={a.id} className="sc-hist-tr">
                        <span>{a.sku}</span>
                        <span>{a.product_name}</span>
                        <span>{a.previous_qty}</span>
                        <span>{a.adjusted_qty}</span>
                        <span>{a.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedLines.length === 0 && countAdjustments.length === 0 && (
                <p><Localized id="sc-hist-no-data"><span>No data available for this count.</span></Localized></p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
