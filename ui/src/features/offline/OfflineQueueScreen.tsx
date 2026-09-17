import { useState, useCallback, useEffect, useRef } from 'react';
import { requiredLocalized } from '@/components';
import { Localized, useLocalization } from '@fluent/react';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import {
  listAllOfflineScoped,
  pendingOfflineCountScoped,
  retryOfflineSyncScoped,
  deleteOfflineItemScoped,
  getOfflineQueueStatusSummaryScoped,
  getSyncPlanScoped,
  listRemoteFailuresScoped,
  requeueRemoteFailureScoped,
  type OfflineQueueItemDto,
  type OfflineQueueSummaryDto,
  type RemoteSyncFailureDto,
  type SyncPlanResult,
  type SyncResult,
} from '@/api/offline';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { deriveAsyncPhase } from '@/utils/retry-state';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import './OfflineQueueScreen.css';

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'status-pending';
    case 'synced':
      return 'status-synced';
    case 'failed':
      return 'status-failed';
    default:
      return '';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'offline-queue-status-pending';
    case 'synced':
      return 'offline-queue-status-synced';
    case 'failed':
      return 'offline-queue-status-failed';
    default:
      return 'offline-queue-status-pending';
  }
}

/** Relative-time label ("just now", "5m ago", …) for the summary panel. */
function formatRelativeTime(iso: string | null): { fluentKey: string; fluentArgs: Record<string, number | string> } | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diffMs = Math.max(0, Date.now() - ts);
  if (diffMs < 60_000) {
    return { fluentKey: 'offline-queue-time-just-now', fluentArgs: {} };
  }
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) {
    return { fluentKey: 'offline-queue-time-days-ago', fluentArgs: { count: days } };
  }
  if (hours >= 1) {
    return { fluentKey: 'offline-queue-time-hours-ago', fluentArgs: { count: hours } };
  }
  return { fluentKey: 'offline-queue-time-minutes-ago', fluentArgs: { count: mins } };
}

// ── Component ───────────────────────────────────────────────────────

/** Offline queue screen — view pending, synced, and failed offline operations with retry and delete capabilities. */
/**
 * One settled read: `ok: false` records UNKNOWN — never a borrowed fact.
 *
 * Copied from the sanctioned shape at ui/src/app/AppShell.tsx:87-94.
 * The point is not the try/catch, it is what the CALLER is allowed to write
 * afterwards: on `ok: false` there is no value, so a failure cannot be stored
 * as — or rendered as — an answer the call was never able to produce. The
 * console line is what makes the two cases tellable apart later; a swallowed
 * throw and a pending read look identical from the screen, and only one of
 * them is a fact about the queue.
 */
async function settleRead<T>(
  label: string,
  read: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[offline-queue] ${label} read failed — recording unknown:`, err);
    return { ok: false };
  }
}

export default function OfflineQueueScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  // Dates follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const [items, setItems] = useState<OfflineQueueItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState<number>(0);
  // Detailed queue status (pending/synced/failed/conflicts + timestamps)
  // surfaced from offline_queue_status_summary (P1-6 sync observability).
  const [queueSummary, setQueueSummary] = useState<OfflineQueueSummaryDto | null>(null);
  // The tenant's sync plan read from the server (ADR sync-plan-gating) —
  // lets operators see free/pro and the upgrade prompt without syncing.
  const [syncPlan, setSyncPlan] = useState<SyncPlanResult | null>(null);
  // SYNC-11: remote items quarantined after repeated pull-application failures.
  // null = UNKNOWN: the read has not answered, or answered by failing. An
  // EMPTY ARRAY is a different fact — "the server has nothing quarantined" —
  // and only a read that returned one may write it. Collapsing the two is
  // what made a failed read render as a clean queue on the one screen whose
  // job is to show sync trouble.
  const [failures, setFailures] = useState<RemoteSyncFailureDto[] | null>(null);
  const [requeueError, setRequeueError] = useState<string | null>(null);
  // ERR-07: generation guard + last-refresh tracking for the poll loop.
  // A late poll response after unmount/supersession is ignored, and repeated
  // failures surface a non-blocking stale indicator instead of being silent.
  const pollGenRef = useRef(0);
  const pollFailuresRef = useRef(0);
  const [pollStale, setPollStale] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, count, summary, remoteFailures] = await Promise.all([
        listAllOfflineScoped(sessionToken),
        pendingOfflineCountScoped(sessionToken),
        getOfflineQueueStatusSummaryScoped(sessionToken).catch(() => null),
        // A dead-letter read must not blank out the LOCAL queue — but it may
        // not answer FOR the quarantine either. `.catch(() => [])` did
        // exactly that: it turned a failure into an empty list, which the
        // section below renders as "No quarantined items.". Settled instead,
        // so the failure arrives at the caller as `{ ok: false }` with no
        // value to mistake for an answer. Promise.all still resolves, so the
        // queue itself keeps rendering either way.
        settleRead('offline_remote_failures', listRemoteFailuresScoped(sessionToken)),
      ]);
      setItems(data);
      setPendingCount(count);
      if (summary) {
        setConflictCount(summary.conflictCount);
        setQueueSummary(summary);
      }
      // Best-effort plan read — never fail the screen if the server is
      // unreachable or sync isn't configured.
      getSyncPlanScoped(sessionToken).then(setSyncPlan).catch(() => setSyncPlan(null));
      // Write a value ONLY when the call produced one. A failed read sets
      // null — UNKNOWN, rendered by the section's own error path below —
      // because a stale list is not a current one either. The next
      // successful read (Retry, pull-to-refresh, requeue reload) replaces it
      // with what the server actually said.
      setFailures(remoteFailures.ok ? remoteFailures.value : null);
    } catch {
      setError(l10n.getString('offline-queue-error'));
    } finally {
      setLoading(false);
    }
    // sessionToken is read five times in this body (:126-:141) and was not a dependency, so
    // :157's `useEffect(() => { load(); }, [load])` never re-ran for a new session.
  }, [l10n, sessionToken]);

  // P7-3: Pull-to-refresh gesture (defined after load so it's hoist-safe)
  const { containerProps: pullRefreshProps, state: pullState, pullDistance } = usePullToRefresh({
    onRefresh: load,
  });

  // ── Load data on mount ─────────────────────────────────────────

  useEffect(() => { load(); }, [load]);

  // Poll pending count and conflict count every 10 seconds (P1-3).
  // ERR-07: recursive timeout with a generation guard instead of a fixed
  // interval so a slow poll never overlaps the next one, late results after
  // unmount are ignored, and repeated failures become visible.
  useEffect(() => {
    const gen = ++pollGenRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const [count, summary] = await Promise.all([
          pendingOfflineCountScoped(sessionToken),
          getOfflineQueueStatusSummaryScoped(sessionToken).catch(() => null),
        ]);
        if (gen !== pollGenRef.current) return; // superseded or unmounted
        setPendingCount(count);
        if (summary) {
          setConflictCount(summary.conflictCount);
          setQueueSummary(summary);
        }
        getSyncPlanScoped(sessionToken).then(setSyncPlan).catch(() => setSyncPlan(null));
        pollFailuresRef.current = 0;
        setPollStale(false);
        setLastPolledAt(new Date());
      } catch {
        if (gen !== pollGenRef.current) return;
        // Three consecutive failures → show a stale notice (ERR-07).
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current >= 3) setPollStale(true);
      } finally {
        if (gen === pollGenRef.current) {
          timer = setTimeout(() => { void poll(); }, 10_000);
        }
      }
    };

    void poll();
    return () => {
      pollGenRef.current += 1; // invalidate any in-flight poll
      if (timer) clearTimeout(timer);
    };
    // sessionToken is read at :170, :171 and :179. With [] this polled on a fixed 10s cadence
    // with the mount-time token forever: after a cashier hot-swap (FastPINOverlay, and
    // swapSessionToken destroys the old token at WorkspaceContext.tsx:273) every request failed
    // with a dead session, pollFailuresRef reached 3, and the screen showed a permanent
    // "stale queue" notice over a queue that was fine. Re-running is safe by construction --
    // the cleanup bumps the generation and clears the timer, which is what :173/:189 guard on.
  }, [sessionToken]);

  // ── Sync all ──────────────────────────────────────────────────

  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await retryOfflineSyncScoped(sessionToken);
      setSyncResult(result);
      await load();
    } catch {
      setError(l10n.getString('offline-queue-sync-error'));
    } finally {
      setSyncing(false);
    }
  }, [load, l10n, sessionToken]);

  // ── Requeue dead-lettered remote item ─────────────────────────

  const handleRequeue = useCallback(async (itemId: string) => {
    setRequeueError(null);
    try {
      await requeueRemoteFailureScoped(sessionToken, itemId);
      await load();
    } catch {
      setRequeueError(l10n.getString('offline-queue-quarantine-requeue-error'));
    }
  }, [load, l10n, sessionToken]);

  // ── Delete item ────────────────────────────────────────────────

  const handleDelete = useCallback(async (id: string) => {
    setDeleteError(null);
    try {
      await deleteOfflineItemScoped(sessionToken, id);
      await load();
    } catch {
      setDeleteError(l10n.getString('offline-queue-delete-error'));
    }
  }, [load, l10n, sessionToken]);

  // ── Render ─────────────────────────────────────────────────────

  // ERR-09: derive the standardized async phase so a reload with rows on
  // screen is `refreshing` (rows stay visible + status announced) instead
  // of blanking to the skeleton.
  const phase = deriveAsyncPhase({
    loading,
    error: error !== null,
    hasData: items.length > 0,
  });

  return (
    <div className="offline-queue-screen">
      <div className="offline-queue-header">
        <div className="offline-queue-title-row">
          <Localized id="offline-queue-title">
            <h1 className="offline-queue-title">Offline Queue</h1>
          </Localized>
          {pendingCount > 0 && (
            <Localized id="offline-queue-pending-count" vars={{ count: String(pendingCount) }}>
              <span className="offline-queue-badge" aria-label={`${pendingCount} pending`} aria-live="polite">
                {pendingCount} pending
              </span>
            </Localized>
          )}
        </div>
        <Button
          variant="primary"
          loading={syncing}
          disabled={pendingCount === 0 || syncing}
          onClick={handleSyncAll}
          aria-label={l10n.getString('offline-queue-sync-all-label')}
        >
          <Localized id={syncing ? 'offline-queue-syncing' : 'offline-queue-sync-all'}>
            <span>{syncing ? 'Syncing…' : 'Sync All'}</span>
          </Localized>
        </Button>
      </div>

      {/* ADR sync-plan-gating: show the tenant's plan so operators see
          free/pro and the upgrade prompt without running a sync. */}
      {syncPlan?.ok && syncPlan.plan && (
        <div
          className={`offline-queue-plan-row${syncPlan.plan === 'free' ? ' offline-queue-plan-row--free' : ''}`}
          data-testid="offline-queue-plan-row"
        >
          <Localized id="offline-queue-plan-label"><span className="offline-queue-plan-label">Plan</span></Localized>
          {syncPlan.plan === 'pro' ? (
            <span className="offline-queue-plan-badge offline-queue-plan-badge--pro">
              <Localized id="offline-queue-plan-pro"><span>Pro</span></Localized>
            </span>
          ) : (
            <span className="offline-queue-plan-badge offline-queue-plan-badge--free">
              <Localized id="offline-queue-plan-free"><span>Free</span></Localized>
            </span>
          )}
          {syncPlan.plan === 'free' && (
            <Localized id="offline-queue-plan-upgrade-hint">
              <span className="offline-queue-plan-upgrade-hint">Upgrade to sync to the cloud</span>
            </Localized>
          )}
        </div>
      )}

      {/* P1-6: detailed queue status — same numbers operators see in
          Settings → Cloud Sync, surfaced here outside settings. */}
      {queueSummary && (
        <div className="offline-queue-summary" data-testid="offline-queue-summary">
          <div className="offline-queue-summary-grid">
            <span className="offline-queue-summary-item">
              <strong>{queueSummary.pendingCount}</strong>
              <Localized id="offline-queue-summary-pending"><span>pending</span></Localized>
            </span>
            <span className="offline-queue-summary-item">
              <strong>{queueSummary.syncedCount}</strong>
              <Localized id="offline-queue-summary-synced"><span>synced</span></Localized>
            </span>
            <span className="offline-queue-summary-item">
              <strong>{queueSummary.failedCount}</strong>
              <Localized id="offline-queue-summary-failed"><span>failed</span></Localized>
            </span>
            <span className="offline-queue-summary-item">
              <strong>{queueSummary.conflictCount}</strong>
              <Localized id="offline-queue-summary-conflicts"><span>conflicts</span></Localized>
            </span>
          </div>
          <div className="offline-queue-summary-meta">
            <span className="offline-queue-summary-time">
              {(() => {
                const rel = formatRelativeTime(queueSummary.lastSyncedAt);
                return rel
                  ? l10n.getString('offline-queue-last-synced', { time: l10n.getString(rel.fluentKey, rel.fluentArgs) })
                  : l10n.getString('offline-queue-last-synced-never');
              })()}
            </span>
            <span className="offline-queue-summary-time">
              {(() => {
                const rel = formatRelativeTime(queueSummary.oldestPendingAt);
                return rel
                  ? l10n.getString('offline-queue-oldest-pending', { time: l10n.getString(rel.fluentKey, rel.fluentArgs) })
                  : l10n.getString('offline-queue-oldest-pending-none');
              })()}
            </span>
          </div>
        </div>
      )}

      {conflictCount > 0 && (
        <div className="offline-queue-sync-result" role="alert" style={{ borderColor: 'var(--color-warning-border, #ffc107)' }}>
          <Localized id="offline-queue-conflict-count" vars={{ count: String(conflictCount) }}>
            <span>{conflictCount} item(s) resolved via sync conflict.</span>
          </Localized>
        </div>
      )}

      {/* ERR-07: non-blocking stale notice after repeated poll failures */}
      {pollStale && (
        <div className="offline-queue-stale" role="status">
          <Localized id="offline-queue-status-stale">
            <span>Queue status may be out of date.</span>
          </Localized>
          {lastPolledAt && (
            <span className="offline-queue-stale-time">
              {requiredLocalized(l10n, 'offline-queue-last-refreshed', {
                time: lastPolledAt.toLocaleTimeString(numLocale, { hour: '2-digit', minute: '2-digit' }),
              })}
            </span>
          )}
        </div>
      )}

      {syncResult && syncResult.planRequired && (
        <div className="offline-queue-sync-result offline-queue-sync-result--plan" role="status">
          <p className="offline-queue-plan-required-title">
            <Localized id="offline-queue-plan-required">
              <span>Cloud sync requires a paid plan</span>
            </Localized>
          </p>
          <p className="offline-queue-plan-required-hint">
            <Localized id="offline-queue-plan-required-hint">
              <span>Your local sales keep working — upgrade to sync them to the cloud.</span>
            </Localized>
          </p>
        </div>
      )}
      {syncResult && !syncResult.planRequired && (
        <div className="offline-queue-sync-result" role="status">
          <Localized
            id="offline-queue-sync-success"
            vars={{ synced: String(syncResult.syncedCount), failed: String(syncResult.failedCount) }}
          >
            <span>
              Synced {syncResult.syncedCount} items, {syncResult.failedCount} failed.
            </span>
          </Localized>
        </div>
      )}

      {deleteError && (
        <div className="offline-queue-error" role="alert">
          <span>{deleteError}</span>
        </div>
      )}

      {/* P7-3: Pull-to-refresh indicator */}
      {pullState !== 'idle' && (
        <div
          className="offline-queue-pull-indicator"
          style={{
            transform: `translateY(${pullDistance}px)`,
            opacity: Math.min(1, pullDistance / 60),
          }}
        >
          {pullState === 'pulling' && (
            <span>{requiredLocalized(l10n, 'offline-queue-pull-to-refresh')}</span>
          )}
          {pullState === 'ready' && (
            <span>{requiredLocalized(l10n, 'offline-queue-release-to-refresh')}</span>
          )}
          {pullState === 'loading' && <span className="offline-queue-refresh-spinner" />}
        </div>
      )}

      {phase === 'loading' ? (
        <div className="offline-queue-loading-skeleton" {...pullRefreshProps}>
          {/* Header skeleton */}
          <div className="offline-queue-skeleton-header">
            <Skeleton variant="block" width="12rem" height="1.75rem" />
            <Skeleton variant="block" width="7rem" height="2.25rem" />
          </div>
          {/* Table skeleton */}
          <div className="offline-queue-table-wrap">
            <table className="offline-queue-table" aria-hidden="true">
              <thead>
                <tr>
                  <Localized id="offline-queue-action"><th>Action</th></Localized>
                  <Localized id="offline-queue-status"><th>Status</th></Localized>
                  <Localized id="offline-queue-retries"><th>Retries</th></Localized>
                  <Localized id="offline-queue-last-error"><th>Last Error</th></Localized>
                  <Localized id="offline-queue-created"><th>Created</th></Localized>
                  <Localized id="offline-queue-synced-at"><th>Synced At</th></Localized>
                  <th aria-label={l10n.getString('offline-queue-table-actions')}> </th>
                </tr>
              </thead>
              <tbody>{Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton variant="text" width="6rem" /></td>
                    <td><Skeleton variant="block" width="4.5rem" height="1.25rem" /></td>
                    <td style={{ textAlign: 'center' }}><Skeleton variant="text" width="2rem" /></td>
                    <td><Skeleton variant="text" width="8rem" /></td>
                    <td><Skeleton variant="text" width="7rem" /></td>
                    <td><Skeleton variant="text" width="7rem" /></td>
                    <td><Skeleton variant="block" width="3rem" height="1.5rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : phase === 'error' ? (
        <Card shadow="sm">
          <div className="offline-queue-empty">
            <Localized id="offline-queue-error">
              <p>Failed to load queue. Please try again.</p>
            </Localized>
            <Localized id="offline-queue-retry">
              <Button variant="secondary" onClick={load}>Retry</Button>
            </Localized>
          </div>
        </Card>
      ) : phase === 'idle' ? (
        <Card shadow="sm">
          <div className="offline-queue-empty" {...pullRefreshProps}>
            <Localized id="offline-queue-empty">
              <p>All transactions synced. No pending items.</p>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="offline-queue-table-wrap" {...pullRefreshProps}>
          {/* ERR-09: rows stay visible during a reload — announce the retry intent */}
          {phase === 'refreshing' && (
            <div className="offline-queue-refreshing" role="status" aria-live="polite">
              <Localized id="offline-queue-refreshing">
                <span>Refreshing…</span>
              </Localized>
            </div>
          )}
          {/* P7-3: Pull-to-refresh indicator */}
          {pullState !== 'idle' && (
            <div
              className="offline-queue-pull-indicator"
              style={{
                transform: `translateY(${pullDistance}px)`,
                opacity: Math.min(1, pullDistance / 60),
              }}
            >
              {pullState === 'pulling' && (
                <span>{requiredLocalized(l10n, 'offline-queue-pull-to-refresh')}</span>
              )}
              {pullState === 'ready' && (
                <span>{requiredLocalized(l10n, 'offline-queue-release-to-refresh')}</span>
              )}
              {pullState === 'loading' && <span className="offline-queue-refresh-spinner" />}
            </div>
          )}
          <table className="offline-queue-table" aria-label={requiredLocalized(l10n, 'offline-queue-table-aria')}>
            <thead>
              <tr>
                <Localized id="offline-queue-action"><th>Action</th></Localized>
                <Localized id="offline-queue-status"><th>Status</th></Localized>
                <Localized id="offline-queue-retries"><th>Retries</th></Localized>
                <Localized id="offline-queue-last-error"><th>Last Error</th></Localized>
                <Localized id="offline-queue-created"><th>Created</th></Localized>
                <Localized id="offline-queue-synced-at"><th>Synced At</th></Localized>
                <th aria-label={l10n.getString('offline-queue-table-actions')}> </th>
              </tr>
            </thead>
            <tbody>{items.map((item) => (
                <tr key={item.id}>
                  <td className="offline-queue-cell-action">{item.action}</td>
                  { }
                  <td>
                    <Localized id={statusLabel(item.status)}>
                      <span className={`offline-queue-status-badge ${statusClass(item.status)}`}>
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                    </Localized>
                  </td>
                  <td className="offline-queue-cell-retries">{item.retryCount}</td>
                  <td className="offline-queue-cell-error">
                    {item.lastError ? (
                      <span title={item.lastError}>{item.lastError}</span>
                    ) : (
                      <Localized id="offline-queue-none">
                        <span className="offline-queue-cell-none">—</span>
                      </Localized>
                    )}
                  </td>
                  <td className="offline-queue-cell-created">{formatDate(item.createdAt, numLocale)}</td>
                  <td className="offline-queue-cell-synced">
                    {item.syncedAt ? formatDate(item.syncedAt, numLocale) : (
                      <Localized id="offline-queue-none">
                        <span className="offline-queue-cell-none">—</span>
                      </Localized>
                    )}
                  </td>
                  <td>
                    <div className="offline-queue-cell-actions">
                    <button
                      type="button"
                      className="offline-queue-action-btn offline-queue-action-btn--danger"
                      onClick={() => handleDelete(item.id)}
                      aria-label={l10n.getString('offline-queue-delete')}
                    >
                      <Localized id="offline-queue-delete"><span>Delete</span></Localized>
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      {/* SYNC-11: quarantined remote items — visible even when the local
          queue is empty so operators can remediate and requeue them. */}
      {phase !== 'loading' && phase !== 'error' && (
        <section className="offline-queue-quarantine" aria-label={requiredLocalized(l10n, 'offline-queue-quarantine-table-aria')}>
          <div className="offline-queue-quarantine-header">
            <Localized id="offline-queue-quarantine-title">
              <h2 className="offline-queue-quarantine-title">Quarantined Remote Items</h2>
            </Localized>
            <Localized id="offline-queue-quarantine-description">
              <p className="offline-queue-quarantine-description">Items from the sync server that repeatedly failed to apply. Requeue after fixing the underlying issue.</p>
            </Localized>
          </div>

          {requeueError && (
            <div className="offline-queue-error" role="alert">
              <span>{requeueError}</span>
            </div>
          )}

          {failures === null ? (
            /* The read never answered. Rendered through the degraded path
               this file already owns — the same `offline-queue-error` copy and
               `offline-queue-retry` affordance the phase==='error' branch uses
               above, in the same `offline-queue-error` alert container the
               requeue failure already uses inside this section — so "we could
               not ask" is visible without inventing copy or a new Fluent key.
               What it must never reach is the branch below. */
            <div className="offline-queue-error" role="alert">
              <Localized id="offline-queue-error">
                <span>Failed to load queue. Please try again.</span>
              </Localized>
              <Localized id="offline-queue-retry">
                <Button variant="secondary" onClick={load}>Retry</Button>
              </Localized>
            </div>
          ) : failures.length === 0 ? (
            /* Reachable ONLY from a read that returned an empty list: this is
               the assertion "nothing is quarantined", and it now has evidence. */
            <Localized id="offline-queue-quarantine-empty">
              <p className="offline-queue-quarantine-empty">No quarantined items.</p>
            </Localized>
          ) : (
            <div className="offline-queue-table-wrap">
              <table className="offline-queue-table" aria-label={requiredLocalized(l10n, 'offline-queue-quarantine-table-aria')}>
                <thead>
                  <tr>
                    <Localized id="offline-queue-quarantine-item-id"><th>Item ID</th></Localized>
                    <Localized id="offline-queue-action"><th>Action</th></Localized>
                    <Localized id="offline-queue-quarantine-attempts"><th>Attempts</th></Localized>
                    <Localized id="offline-queue-last-error"><th>Last Error</th></Localized>
                    <th aria-label={l10n.getString('offline-queue-table-actions')}> </th>
                  </tr>
                </thead>
                <tbody>{failures.map((failure) => (
                    <tr key={failure.itemId}>
                      <td className="offline-queue-cell-action">{failure.itemId}</td>
                      <td>{failure.action}</td>
                      <td className="offline-queue-cell-retries">{failure.attempts}</td>
                      <td className="offline-queue-cell-error">
                        <span title={failure.lastError}>{failure.lastError}</span>
                      </td>
                      <td>
                        <div className="offline-queue-cell-actions">
                          <button
                            type="button"
                            className="offline-queue-action-btn"
                            onClick={() => handleRequeue(failure.itemId)}
                            aria-label={l10n.getString('offline-queue-quarantine-requeue-aria', { itemId: failure.itemId })}
                          >
                            <Localized id="offline-queue-quarantine-requeue"><span>Requeue</span></Localized>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
