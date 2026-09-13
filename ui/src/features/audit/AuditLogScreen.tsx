import { useState, useCallback, useEffect, useRef } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import {
  listAuditLogScoped,
  getAuditReviewStatusScoped,
  markAuditReviewedScoped,
  exportAuditLogScoped,
  exportSecurityEventsScoped,
  type AuditEntryDto,
} from '@/api/audit';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import {
  ACTION_FLUENT_IDS,
  ACTION_FALLBACK_ID,
  OUTCOME_FLUENT_IDS,
  OUTCOME_FALLBACK_ID,
  CRITICAL_ACTIONS,
} from './auditCatalog';
import { l10nErrorMessage } from '@/utils/app-error';
import './AuditLogScreen.css';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the active application locale from the Fluent localization
 * context (AUD-07). `ReactLocalization` exposes its bundles as an
 * iterable; the first bundle's locale is the negotiated language.
 */
function activeLocale(l10n: ReturnType<typeof useLocalization>['l10n']): string {
  for (const bundle of l10n.bundles) {
    const locales = bundle.locales;
    const primary = locales && locales.length > 0 ? locales[0] : undefined;
    if (primary) return primary;
  }
  return 'en';
}

/**
 * Format an ISO timestamp for display using the application locale
 * (AUD-07). Falls back to the raw ISO string when the date is invalid.
 */
function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function outcomeBadgeClass(outcome: string): string {
  switch (outcome) {
    case 'success': return 'audit-badge--success';
    case 'failure': return 'audit-badge--failure';
    default: return 'audit-badge--info';
  }
}

/** High-water-mark cursor: newest entry a page boundary references. */
interface Cursor {
  created_at: string;
  id: string;
}

// ── Component ───────────────────────────────────────────────────────

type OutcomeFilter = 'all' | 'success' | 'failure';

/** Audit log screen — view filtered action history with date range, action type, and outcome filters for compliance monitoring. */
/**
 * §B administrative gate (todo-global-saas-1.md): the Audit Log is an
 * administrative SaaS feature — it locks while the subscription is not
 * `active` while POS operational runtime continues through grace.
 */
export default function AuditLogScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <AuditLogScreenContent />;
}

function AuditLogScreenContent() {
  const { l10n } = useLocalization();
  const locale = activeLocale(l10n);
  const { isManager } = useAuth();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const limit = 50;
  const loadSeqRef = useRef(0);
  const cursorRef = useRef<Cursor | null>(null);

  // Server-side review checkpoint (AUD-04): review time for display and a
  // server-computed unreviewed count over the FULL table (AUD-02), not just
  // the loaded page.
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Dedicated export-failure notice (AUD-09): the table load error state only
  // renders when the table is empty, so an export failure with rows present
  // would otherwise be silent.
  const [exportError, setExportError] = useState<string | null>(null);

  // Filters (server-side). Search is debounced to avoid an IPC per keystroke.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');

  // ── Load (server-filtered + keyset paginated, AUD-01/02/03) ─────

  const load = useCallback(
    async (opts: { reset?: boolean } = {}) => {
      const { reset = false } = opts;
      if (!sessionToken) return;
      const seq = ++loadSeqRef.current;
      setLoading(true);
      setError(null);
      try {
        const page = await listAuditLogScoped(sessionToken, {
          limit,
          ...(outcomeFilter !== 'all' ? { outcome: outcomeFilter } : {}),
          ...(searchQuery ? { query: searchQuery } : {}),
          ...(!reset && cursorRef.current
            ? {
                beforeCreatedAt: cursorRef.current.created_at,
                beforeId: cursorRef.current.id,
              }
            : {}),
        });
        if (seq !== loadSeqRef.current) return;
        if (reset) {
          setEntries(page.items);
        } else {
          // Deduplicate by entry id (AUD-03 defense in depth).
          setEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...page.items.filter((e) => !seen.has(e.id))];
          });
        }
        setTotal(page.total);
        setHasMore(page.has_more);
        const last = page.items[page.items.length - 1];
        if (last) {
          cursorRef.current = { created_at: last.created_at, id: last.id };
        }
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setError(l10nErrorMessage(err, l10n, 'audit-log-error-load'));
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    },
    [sessionToken, limit, outcomeFilter, searchQuery, l10n],
  );

  // Debounce the free-text search, then reload from the first page.
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Initial load + reload whenever a server-side filter changes.
  useEffect(() => {
    cursorRef.current = null;
    void load({ reset: true });
  }, [load]);

  // ── Review checkpoint (AUD-04) ───────────────────────────────────

  const loadReviewStatus = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const status = await getAuditReviewStatusScoped(sessionToken);
      setReviewedAt(status.checkpoint?.reviewed_at ?? null);
      setUnreviewedCount(status.unreviewed_count);
    } catch {
      // Server is authoritative; a transient failure keeps the previous state.
    }
  }, [sessionToken]);

  useEffect(() => {
    void loadReviewStatus();
  }, [loadReviewStatus]);

  const handleMarkReviewed = useCallback(async () => {
    if (!sessionToken) return;
    setMarkingReviewed(true);
    try {
      // High-water mark = the newest entry the reviewer has seen (page 1 is
      // newest-first, so entries[0] is the globally newest row).
      const newest = entries[0];
      await markAuditReviewedScoped(sessionToken, {
        reviewedThroughCreatedAt: newest?.created_at ?? new Date().toISOString(),
        reviewedThroughId: newest?.id ?? '',
      });
      await loadReviewStatus();
      // The audit.review event just landed — refresh the first page.
      await load({ reset: true });
    } catch {
      await loadReviewStatus();
    } finally {
      setMarkingReviewed(false);
    }
  }, [sessionToken, entries, load, loadReviewStatus]);

  const handleLoadMore = useCallback(() => {
    void load({ reset: false });
  }, [load]);

  // ── Export (AUD-09) ────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (!sessionToken || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const result = await exportAuditLogScoped(sessionToken, {
        ...(outcomeFilter !== 'all' ? { outcome: outcomeFilter } : {}),
        ...(searchQuery ? { query: searchQuery } : {}),
      });
      // Hand the CSV artifact to the browser as a download.
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Dedicated inline notice — always visible regardless of table state.
      setExportError(requiredLocalized(l10n, 'audit-log-export-error'));
    } finally {
      setExporting(false);
    }
  }, [sessionToken, exporting, outcomeFilter, searchQuery, l10n]);

  // ── Security-event export (ruling D61-7 / design D84) ─────────
  //
  // SECURITY_ACTIONS-only CSV with an exact actor filter (user_id or
  // "system") and inclusive-from / exclusive-to date bounds, normalized at
  // the IPC layer. Gate reuses the same `isManager` visibility as the
  // AUD-09 export button — the AUDIT_EXPORT permission set is identical
  // (Owner/Manager/Admin), so no new check is invented here.

  const [secExporting, setSecExporting] = useState(false);
  const [secExportError, setSecExportError] = useState<string | null>(null);
  const [secActor, setSecActor] = useState('');
  const [secFrom, setSecFrom] = useState('');
  const [secTo, setSecTo] = useState('');

  const handleSecurityExport = useCallback(async () => {
    if (!sessionToken || secExporting) return;
    setSecExporting(true);
    setSecExportError(null);
    try {
      const result = await exportSecurityEventsScoped(sessionToken, {
        ...(secActor ? { actor: secActor } : {}),
        ...(secFrom ? { dateFrom: secFrom } : {}),
        ...(secTo ? { dateTo: secTo } : {}),
      });
      // Same Blob+anchor download plumbing as the AUD-09 export above.
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `security-events-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setSecExportError(requiredLocalized(l10n, 'audit-log-security-export-error'));
    } finally {
      setSecExporting(false);
    }
  }, [sessionToken, secExporting, secActor, secFrom, secTo, l10n]);

  // ── Render ────────────────────────────────────────────────────────

  // With server-side filtering the page only ever holds matching rows, so the
  // empty-filtered state is distinguishable by whether a filter is active.
  const filtersActive = outcomeFilter !== 'all' || searchQuery.length > 0;

  return (
    <div className="audit-log" data-testid="audit-log-table">
      <div className="audit-log-header">
        <div className="audit-log-header-left">
          <Localized id="audit-log-title">
            <h1 className="audit-log-title"><span>Audit Log</span></h1>
          </Localized>
          {unreviewedCount > 0 && (
            <span className="audit-log-unreviewed-badge" title={l10n.getString('audit-log-unreviewed-title', { count: String(unreviewedCount) }, `${unreviewedCount} unreviewed events since last review`)}>
              {unreviewedCount} new
            </span>
          )}
          {reviewedAt && (
            <span className="audit-log-reviewed-at">
              <time dateTime={reviewedAt} title={reviewedAt}>
                <Localized id="audit-log-reviewed-at" vars={{ date: formatDate(reviewedAt, locale) }}><span>Reviewed: {formatDate(reviewedAt, locale)}</span></Localized>
              </time>
            </span>
          )}
        </div>
        <div className="audit-log-header-right">
          {isManager && unreviewedCount > 0 && (
            <Button variant="secondary" onClick={() => void handleMarkReviewed()} loading={markingReviewed} size="sm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true" className="audit-log-btn-icon">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <Localized id="audit-log-mark-reviewed"><span>Mark Reviewed</span></Localized>
            </Button>
          )}
          {isManager && (
            <Button variant="secondary" onClick={() => void handleExport()} loading={exporting}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <Localized id="audit-log-export">
                <span>Export CSV</span>
              </Localized>
            </Button>
          )}
          <Button variant="secondary" onClick={() => void load({ reset: true })} loading={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
            </svg>
            <Localized id="audit-log-refresh">
              <span>Refresh</span>
            </Localized>
          </Button>
        </div>
      </div>

      {/* Export failure notice (AUD-09) — independent of the table load error */}
      {exportError && (
        <div className="audit-log-export-error" role="alert">
          <span className="audit-log-export-error-icon" aria-hidden="true">⚠</span>
          {exportError}
        </div>
      )}

      {/* Security-event export (ruling D61-7 / D84): SECURITY_ACTIONS-only
          CSV with exact actor + date-range bounds. Same visibility gate as
          the AUD-09 export button above. */}
      {isManager && (
        <div className="audit-log-security-export">
          <input
            type="text"
            className="audit-log-security-export-actor"
            value={secActor}
            onChange={(e) => setSecActor(e.target.value)}
            placeholder={l10n.getString('audit-log-security-export-actor')}
            aria-label={l10n.getString('audit-log-security-export-actor')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
          />
          <input
            type="date"
            className="audit-log-security-export-date"
            value={secFrom}
            onChange={(e) => setSecFrom(e.target.value)}
            aria-label={l10n.getString('audit-log-security-export-from')}
          />
          <input
            type="date"
            className="audit-log-security-export-date"
            value={secTo}
            onChange={(e) => setSecTo(e.target.value)}
            aria-label={l10n.getString('audit-log-security-export-to')}
          />
          <Button variant="secondary" size="sm" onClick={() => void handleSecurityExport()} loading={secExporting}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <Localized id="audit-log-security-export"><span>Export security CSV</span></Localized>
          </Button>
        </div>
      )}
      {secExportError && (
        <div className="audit-log-export-error" role="alert">
          <span className="audit-log-export-error-icon" aria-hidden="true">⚠</span>
          {secExportError}
        </div>
      )}

      {/* Filters */}
      <div className="audit-log-filters">
        <div className="audit-log-search-wrap">
          <svg className="audit-log-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="audit-log-search"
            id="audit-log-search"
            name="audit-log-search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            placeholder={l10n.getString('audit-log-search-placeholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={l10n.getString('audit-log-search-label')}
          />
        </div>

        <div className="audit-log-outcome-filters" role="radiogroup" aria-label={l10n.getString('audit-log-filter-label')}>
          {(['all', 'success', 'failure'] as OutcomeFilter[]).map((outcome) => {
            const outcomeIds: Record<string, string> = {
              'all': 'audit-log-filter-all',
              'success': 'audit-log-filter-success',
              'failure': 'audit-log-filter-failure',
            };
            return (
              <Localized id={outcomeIds[outcome] ?? outcome} key={outcome}>
                <button
                  type="button"
                  className={`audit-log-chip ${outcomeFilter === outcome ? 'audit-log-chip--active' : ''}`}
                  onClick={() => setOutcomeFilter(outcome)}
                  role="radio"
                  aria-checked={outcomeFilter === outcome}
                >
                  <span>{outcome === 'all' ? 'All' : outcome === 'success' ? 'Success' : 'Failure'}</span>
                </button>
              </Localized>
            );
            })}
        </div>
      </div>

      {/* Content */}
      {loading && entries.length === 0 ? (
        <div className="audit-log-loading-skeleton">
          <div className="audit-log-skeleton-filters">
            <Skeleton variant="block" width="100%" height="2.25rem" />
            <Skeleton variant="block" width="10rem" height="2rem" />
          </div>
          <div className="audit-log-table-wrap">
            <table className="audit-log-table" aria-hidden="true">
              <thead>
                <tr>
                  <Localized id="audit-log-col-date"><th>Date</th></Localized>
                  <Localized id="audit-log-col-action"><th>Action</th></Localized>
                  <Localized id="audit-log-col-target"><th>Target</th></Localized>
                  <Localized id="audit-log-col-user"><th>User ID</th></Localized>
                  <Localized id="audit-log-col-outcome"><th>Outcome</th></Localized>
                  <Localized id="audit-log-col-details"><th>Details</th></Localized>
                </tr>
              </thead>
              <tbody>{Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton variant="text" width="7rem" /></td>
                    <td><Skeleton variant="text" width="9rem" /></td>
                    <td><Skeleton variant="text" width="6rem" /></td>
                    <td><Skeleton variant="text" width="4rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.25rem" /></td>
                    <td><Skeleton variant="text" width="8rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : error && entries.length === 0 ? (
        <Card shadow="sm">
          <div className="audit-log-error">
            <p>{error}</p>
            <Localized id="audit-log-retry">
              <Button variant="secondary" onClick={() => void load({ reset: true })}><span>Retry</span></Button>
            </Localized>
          </div>
        </Card>
      ) : entries.length === 0 && !loading ? (
        <Card shadow="sm">
          <div className="audit-log-empty">
            {filtersActive ? (
              <Localized id="audit-log-empty-filtered">
                <span>No audit entries match the current filters.</span>
              </Localized>
            ) : (
              <Localized id="audit-log-empty-none">
                <span>No audit entries recorded yet. Entries appear when sales are completed, voided, or staff actions occur.</span>
              </Localized>
            )}
          </div>
        </Card>
      ) : (
        <div className="audit-log-table-wrap" aria-live="polite" aria-relevant="additions text">
          {/* ERR-09: rows stay visible during a reload — announce the retry intent */}
          {loading && entries.length > 0 && (
            <div className="audit-log-refreshing" role="status" aria-live="polite">
              <Localized id="audit-log-refreshing">
                <span>Refreshing…</span>
              </Localized>
            </div>
          )}
          <table className="audit-log-table" aria-label={l10n.getString('audit-log-table-label')}>
            <thead>
              <tr>
                <th className="audit-log-critical-th" />
                <Localized id="audit-log-col-date"><th><span>Date</span></th></Localized>
                <Localized id="audit-log-col-action"><th><span>Action</span></th></Localized>
                <Localized id="audit-log-col-target"><th><span>Target</span></th></Localized>
                <Localized id="audit-log-col-user"><th><span>User ID</span></th></Localized>
                <Localized id="audit-log-col-outcome"><th><span>Outcome</span></th></Localized>
                <Localized id="audit-log-col-details"><th><span>Details</span></th></Localized>
              </tr>
            </thead>
            <tbody>{entries.map((entry) => {
                const isCritical = CRITICAL_ACTIONS.has(entry.action) || entry.outcome === 'failure';
                return (
                  <tr key={entry.id} className={isCritical ? 'audit-log-row--critical' : ''}>
                    <td className="audit-log-critical-indicator">
                      {isCritical && <div className="audit-log-critical-bar" />}
                    </td>
                    <td className="audit-log-cell-date">
                      <time dateTime={entry.created_at} title={entry.created_at}>{formatDate(entry.created_at, locale)}</time>
                    </td>
                    <td>
                      <Localized id={ACTION_FLUENT_IDS[entry.action] ?? ACTION_FALLBACK_ID}>
                        <span className="audit-log-action-label"><span>{entry.action}</span></span>
                      </Localized>
                      <span className="audit-log-action-key" title={entry.action}>{entry.action}</span>
                    </td>
                    <td>
                      {entry.target_type ? (
                        <span className="audit-log-target">
                          <span className="audit-log-target-type">{entry.target_type}</span>
                          {entry.target_id && (
                            <span className="audit-log-target-id">{entry.target_id.slice(0, 8)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="audit-log-target-none">&mdash;</span>
                      )}
                    </td>
                    <td className="audit-log-cell-mono">{entry.user_id ? entry.user_id.slice(0, 8) : requiredLocalized(l10n, 'audit-log-user-system')}</td>
                    <td>
                      <span className={`audit-log-badge ${outcomeBadgeClass(entry.outcome)}`} title={entry.outcome}>
                        <Localized id={OUTCOME_FLUENT_IDS[entry.outcome] ?? OUTCOME_FALLBACK_ID}>
                          <span>{entry.outcome}</span>
                        </Localized>
                      </span>
                    </td>
                    <td className="audit-log-cell-details">
                      {entry.details && entry.details !== '{}' ? (
                        <span className="audit-log-details-preview">
                          {entry.details.slice(0, 60)}{entry.details.length > 60 ? '…' : ''}
                        </span>
                      ) : (
                        <span className="audit-log-details-none">&mdash;</span>
                      )}
                    </td>
                  </tr>
                );
              })}
</tbody>
          </table>
          {hasMore && (
            <div className="audit-log-load-more-wrap">
              <Localized id={loading ? 'shared-loading' : 'audit-log-load-more'}>
                <button
                  type="button"
                  className="audit-log-load-more"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  <span>{loading ? 'Loading…' : 'Load More'}</span>
                </button>
              </Localized>
            </div>
          )}
          <div className="audit-log-footer">
            <span className="audit-log-count">
              <Localized id="audit-log-count-of" vars={{ shown: entries.length, total }}>
                <span>{entries.length} of {total} entries</span>
              </Localized>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
