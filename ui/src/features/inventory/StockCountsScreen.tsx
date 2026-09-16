import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import { l10nErrorMessage } from '@/utils/app-error';
import {
  listStockCounts,
  type StockCountDto,
} from '@/api/inventoryCounts';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import './StockCountsScreen.css';
// The sc-badge family (base + four state modifiers) is hoisted into its own sheet;
// imported AFTER this screen's own so the relative order the list had in one file is kept.
import './StockCountBadge.css';

/** Stock counts list screen — displays all stock counts with status filters and links to create new counts or view details. */
export default function StockCountsScreen() {
  const [counts, setCounts] = useState<StockCountDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

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
      const data = await listStockCounts(sessionToken);
      setCounts(data);
    } catch (err) {
      const message = l10nErrorMessage(err, l10nRef.current, 'sc-error-load');
      setError(message);
      addToast({ message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return counts;
    return counts.filter((c) => c.status === filter);
  }, [counts, filter]);

  const statusBadge = (status: string) => {
    const cls = `sc-badge sc-badge--${status}`;
    return <span className={cls}><Localized id={`sc-status-${status}`}>{status}</Localized></span>;
  };

  const typeLabel = (t: string) => <Localized id={`sc-type-${t}`}>{t}</Localized>;

  return (
    <div className="sc-screen">
      <div className="sc-header">
        <h1 className="sc-title">
          <Localized id="sc-title">
            <span>Stock Counts</span>
          </Localized>
        </h1>
        <Button variant="primary" onClick={() => { window.location.hash = '#stock-count-new'; }}>
          <Localized id="sc-new-count">
            <span>New Count</span>
          </Localized>
        </Button>
      </div>

      <div className="sc-filters">
        {['all', 'draft', 'in_progress', 'completed', 'cancelled'].map((f) => (
           
          <button
            key={f}
            type="button"
            className={`sc-filter-btn ${filter === f ? 'sc-filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
          >
            <Localized id={`sc-filter-${f}`}>
              <span>{f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}</span>
            </Localized>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="sc-loading-skeleton" aria-hidden="true">
          <div className="sc-header">
            <Skeleton variant="block" width="10rem" height="1.75rem" />
            <Skeleton variant="block" width="7rem" height="2.25rem" />
          </div>
          <div className="sc-filters">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="block" width="5rem" height="1.75rem" />
            ))}
          </div>
          <div className="sc-list">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} shadow="sm" className="sc-card">
                <div className="sc-card-row">
                  <Skeleton variant="text" width="5rem" height="1rem" />
                  <Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-sm)' }} />
                </div>
                <div className="sc-card-meta">
                  <Skeleton variant="text" width="4rem" height="0.75rem" />
                  <Skeleton variant="text" width="6rem" height="0.75rem" />
                </div>
                <div className="sc-card-actions">
                  <Skeleton variant="text" width="3rem" height="0.875rem" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="sc-load-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={load}>
            <Localized id="retry"><span>Retry</span></Localized>
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="sc-empty">
          <Localized id="sc-empty-list">
            <span>No stock counts found.</span>
          </Localized>
        </p>
      ) : (
        <div className="sc-list">
          {filtered.map((c) => (
            <Card key={c.id} shadow="sm" className="sc-card">
              <div className="sc-card-row">
                <span className="sc-card-number">{c.count_number}</span>
                {statusBadge(c.status)}
              </div>
              <div className="sc-card-meta">
                <span className="sc-card-type">{typeLabel(c.count_type)}</span>
                <span className="sc-card-date">{new Date(c.created_at).toLocaleDateString(numLocale)}</span>
              </div>
              {c.notes && <p className="sc-card-notes">{c.notes}</p>}
              <div className="sc-card-actions">
                <button
                  type="button"
                  className="sc-card-action"
                  onClick={() => { window.location.hash = `#stock-count-${c.id}`; }}
                  aria-label={l10n.getString('sc-view-aria', { id: c.count_number })}
                >
                  <Localized id="sc-view">
                    <span>View</span>
                  </Localized>
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
