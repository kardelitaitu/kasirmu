// ── Organization security trail (audit baseline) ──────────────────
//
// The tenant-global half of the audit surface: who authenticated into the
// organization, and what happened to their access. It is a SEPARATE route from
// `audit-log` rather than a tab inside it because the two read different
// databases and answer different questions: `AuditLogScreen` shows the
// session's STORE and its business actions, while this screen shows the GLOBAL
// identity database (ADR #4 / ADR #7 — staff, roles and sessions are
// tenant-global). Merging the views would imply one scope where the backend has
// two, and a store-bound session would look like it was seeing a partial
// security history when it is in fact seeing all of it.
//
// Both commands return the same `AuditLogPageDto` and share filtering and
// keyset pagination, so this screen consumes the existing page contract against
// a different endpoint. Class names and most labels are reused from
// `AuditLogScreen.css` / the shared audit bundle on purpose: one visual
// vocabulary for two halves of the same feature.

import { useState, useCallback, useEffect, useRef } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import {
  listSecurityEventsScoped,
  type AuditEntryDto,
  type ListSecurityEventsScopedArgs,
} from '@/api/audit';
import { Button } from '@/components/Button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  ACTION_FLUENT_IDS,
  ACTION_FALLBACK_ID,
  OUTCOME_FLUENT_IDS,
  OUTCOME_FALLBACK_ID,
} from './auditCatalog';
import { l10nErrorMessage } from '@/utils/app-error';
import './AuditLogScreen.css';

const PAGE_LIMIT = 50;

type OutcomeFilter = 'all' | 'success' | 'failure';

/**
 * Keyset cursor for the next (older) page. The backend pages on
 * `(created_at, id)`, so the cursor is taken from the LAST ROW RECEIVED and
 * never derived from a count — that is what keeps pagination stable when rows
 * are appended above the cursor between two reads.
 */
interface Cursor {
  beforeCreatedAt: string;
  beforeId: string;
}

function cursorFrom(entries: AuditEntryDto[]): Cursor | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  return { beforeCreatedAt: last.created_at, beforeId: last.id };
}

/** Localized label for one trail action; unmapped actions fall back safely. */
function actionFluentId(action: string): string {
  return ACTION_FLUENT_IDS[action] ?? ACTION_FALLBACK_ID;
}

/** Localized label for one outcome value. */
function outcomeFluentId(outcome: string): string {
  return OUTCOME_FLUENT_IDS[outcome] ?? OUTCOME_FALLBACK_ID;
}

/**
 * Active application locale, resolved from the Fluent bundles. Duplicated from
 * `AuditLogScreen` rather than imported from it on purpose: that file is 525
 * lines of another slice's internals, and extracting a shared helper would turn
 * an additive screen into a edit of a surface this ruling excludes.
 */
function localeOf(l10n: ReturnType<typeof useLocalization>['l10n']): string {
  for (const bundle of l10n.bundles) {
    const locales = bundle.locales;
    const primary = locales && locales.length > 0 ? locales[0] : undefined;
    if (primary) return primary;
  }
  return 'en';
}

function formatStamp(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * The trail is an administrative surface: it locks while the subscription is
 * not `active`, exactly like the store audit log. The gate lives in this
 * wrapper rather than inside the content component so that none of the hooks
 * below can run conditionally.
 */
export default function SecurityTrailScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <SecurityTrailScreenContent />;
}

function SecurityTrailScreenContent() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [entries, setEntries] = useState<AuditEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<Cursor | null>(null);
  // A slow response for an OLD filter must not overwrite a NEW one.
  const loadSeqRef = useRef(0);

  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Debounced: without this, every keystroke is an IPC round trip against the
  // global identity database.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildArgs = useCallback(
    (cursor: Cursor | null): ListSecurityEventsScopedArgs => (
      {
        limit: PAGE_LIMIT,
        ...(outcomeFilter !== 'all' ? { outcome: outcomeFilter } : {}),
        ...(searchQuery ? { query: searchQuery } : {}),
        ...(cursor ? cursor : {}),
      }
    ),
    [outcomeFilter, searchQuery],
  );

  const load = useCallback(async () => {
    if (!sessionToken) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    cursorRef.current = null;
    try {
      const page = await listSecurityEventsScoped(sessionToken, buildArgs(null));
      if (seq !== loadSeqRef.current) return;
      setEntries(page.items);
      setTotal(page.total);
      setHasMore(page.has_more);
      cursorRef.current = cursorFrom(page.items);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      // A below-Premium session is REFUSED rather than shown an empty page, so
      // empty and refused are two different claims and must never render the same
      // way. What shows here is the kind-mapped copy from ERR-05/06, not the
      // backend's sentence: l10nErrorMessage resolves permissionDenied to the
      // permission message. That is deliberately blunter than "this tenant is on
      // Plus", and the trade is stated rather than assumed — the trail is org-wide
      // identity data, so leaking an identifier or infrastructure detail into a
      // manager-visible screen costs more than the lost precision. The upgrade
      // path is already owned by the admin gate above.
      setError(l10nErrorMessage(err, l10n));
      setEntries([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [sessionToken, buildArgs, l10n]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!sessionToken || !cursor) return;
    const seq = ++loadSeqRef.current;
    setLoadingMore(true);
    try {
      const page = await listSecurityEventsScoped(sessionToken, buildArgs(cursor));
      if (seq !== loadSeqRef.current) return;
      setEntries((prev) => prev.concat(page.items));
      setTotal(page.total);
      setHasMore(page.has_more);
      cursorRef.current = cursorFrom(page.items) ?? cursor;
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(l10nErrorMessage(err, l10n));
    } finally {
      if (seq === loadSeqRef.current) setLoadingMore(false);
    }
  }, [sessionToken, buildArgs, l10n]);

  const chips: { value: OutcomeFilter; id: string }[] = [
    { value: 'all', id: 'audit-log-filter-all' },
    { value: 'success', id: 'audit-log-filter-success' },
    { value: 'failure', id: 'audit-log-filter-failure' },
  ];


  return (
    <section
      className="audit-log"
      aria-label={requiredLocalized(l10n, 'security-trail-title')}
      data-testid="security-trail"
    >
      <div className="audit-log-header">
        <div className="audit-log-header-left">
          <h2 className="audit-log-title">
            <Localized id="security-trail-title">
              <span>Security Trail</span>
            </Localized>
          </h2>
          <p className="audit-log-search-label">
            <Localized id="security-trail-scope-note">
              <span>
                Sign-ins, sign-outs, impersonation and staff account changes for
                every location in this organization.
              </span>
            </Localized>
          </p>
        </div>
      </div>

      <div className="audit-log-filters">
        <div
          className="audit-log-outcome-filters"
          role="group"
          aria-label={requiredLocalized(l10n, 'audit-log-filter-label')}
        >
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={
                'audit-log-chip'
                + (outcomeFilter === chip.value ? ' audit-log-chip--active' : '')
              }
              aria-pressed={outcomeFilter === chip.value}
              onClick={() => setOutcomeFilter(chip.value)}
              data-testid={'security-trail-outcome-' + chip.value}
            >
              <Localized id={chip.id}>
                <span>{chip.value}</span>
              </Localized>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="audit-log-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={requiredLocalized(l10n, 'audit-log-search-placeholder')}
          aria-label={requiredLocalized(l10n, 'audit-log-search-label')}
          data-testid="security-trail-search"
        />
      </div>

      {loading && (
        <p className="audit-log-loading-text" data-testid="security-trail-loading">
          <Localized id="audit-log-loading">
            <span>Loading…</span>
          </Localized>
        </p>
      )}

      {!loading && error && (
        <div className="audit-log-error" role="alert" data-testid="security-trail-error">
          <span>{error}</span>
          <Button variant="secondary" onClick={() => void load()} data-testid="security-trail-retry">
            <Localized id="audit-log-retry">
              <span>Retry</span>
            </Localized>
          </Button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="audit-log-empty" data-testid="security-trail-empty">
          {/* The shared empty copy names sales and voids, which is the store
              log's vocabulary; an empty security trail needs its own sentence. */}
          <Localized id="security-trail-empty">
            <span>No security events match these filters.</span>
          </Localized>
        </p>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="audit-log-table-wrap">
          <table className="audit-log-table" aria-label={requiredLocalized(l10n, 'audit-log-table-label')}>
            <thead>
              <tr>
                <th scope="col">
                  <Localized id="audit-log-col-date">
                    <span>Date</span>
                  </Localized>
                </th>
                <th scope="col">
                  <Localized id="audit-log-col-action">
                    <span>Action</span>
                  </Localized>
                </th>
                <th scope="col">
                  <Localized id="audit-log-col-user">
                    <span>User</span>
                  </Localized>
                </th>
                <th scope="col">
                  <Localized id="audit-log-col-outcome">
                    <span>Outcome</span>
                  </Localized>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} data-testid="security-trail-row">
                  <td className="audit-log-cell-date">{formatStamp(entry.created_at, localeOf(l10n))}</td>
                  <td>
                    <Localized id={actionFluentId(entry.action)}>
                      <span className="audit-log-action-label">{entry.action}</span>
                    </Localized>
                    {entry.target_id ? (
                      <span className="audit-log-action-key">{entry.target_id}</span>
                    ) : null}
                  </td>
                  <td className="audit-log-cell-mono">
                    {entry.user_id
                      ? entry.user_id.slice(0, 8)
                      : requiredLocalized(l10n, 'audit-log-user-system')}
                  </td>
                  <td>
                    <span className={'audit-log-badge audit-log-badge--' + entry.outcome}>
                      <Localized id={outcomeFluentId(entry.outcome)}>
                        <span>{entry.outcome}</span>
                      </Localized>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="audit-log-footer">
            <Localized id="audit-log-count-of" vars={{ shown: entries.length, total }}>
              <span className="audit-log-count">{'{ $shown } of { $total }'}</span>
            </Localized>
            {hasMore && (
              <span className="audit-log-load-more-wrap">
                <Button
                  variant="secondary"
                  loading={loadingMore}
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  data-testid="security-trail-load-more"
                >
                  <Localized id="audit-log-load-more">
                    <span>Load More</span>
                  </Localized>
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
