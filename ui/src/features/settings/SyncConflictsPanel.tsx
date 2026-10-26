import { useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Tooltip from '@/app/Tooltip';

import {
  listRemoteFailuresScoped,
  requeueRemoteFailureScoped,
  type RemoteSyncFailureDto,
} from '@/api/offline';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import './SyncConflictsPanel.css';
import { asArray } from '@/utils/ipc-payload';

export interface SyncConflictsPanelProps {
  onRequeueSuccess?: () => void;
  onCountChange?: (count: number) => void;
}

function formatJsonPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payload || '—';
  }
}

/** Manager-only panel showing quarantined dead-lettered remote sync failures. */
export function SyncConflictsPanel({
  onRequeueSuccess,
  onCountChange,
}: SyncConflictsPanelProps) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [failures, setFailures] = useState<RemoteSyncFailureDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);
  const [requeueingAll, setRequeueingAll] = useState(false);
  /** Synchronous mirrors of the requeue flags — see the guards in the handlers below. */
  const requeueingAllRef = useRef(false);
  const requeuePendingRef = useRef(new Set<string>());
  const [requeueProgress, setRequeueProgress] = useState<{ current: number; total: number } | null>(null);
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await listRemoteFailuresScoped(sessionToken);
      const list = result ?? [];
      setFailures(asArray<typeof list[number]>(list));
      const deadCount = list.filter((f) => f.deadLettered).length;
      onCountChange?.(deadCount);
    } catch (e) {
      // Was `String(e)` -- the third raw-rejection site in this panel. A list that
      // failed to load must not print the backend's sentence into a role="alert".
      setError(l10nErrorMessage(e, l10n, 'sync-conflicts-load-failed'));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, onCountChange, l10n]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRequeue(itemId: string) {
    if (!sessionToken) return;
    // Per-ROW guard: two DIFFERENT items must requeue concurrently, so this is a set of
    // ids, not a boolean. A replay of the same row only re-reports its status.
    if (requeuePendingRef.current.has(itemId)) return;
    requeuePendingRef.current.add(itemId);
    setRequeueingId(itemId);
    setError(null);
    try {
      await requeueRemoteFailureScoped(sessionToken, itemId);
      await load();
      onRequeueSuccess?.();
    } catch (e) {
      // Was `String(e)`: the raw IPC rejection reached a role="alert" verbatim.
      setError(l10nErrorMessage(e, l10n, 'sync-conflicts-requeue-failed'));
    } finally {
      requeuePendingRef.current.delete(itemId);
      setRequeueingId(null);
    }
  }

  async function handleRequeueAll(items: RemoteSyncFailureDto[]) {
    if (!sessionToken || items.length === 0) return;
    // Re-entry guard: the replay walks the SAME list a second time, so every row is
    // requeued twice and the `requeueProgress` bar restarts at 1 of N mid-run.
    if (requeueingAllRef.current) return;
    requeueingAllRef.current = true;
    setRequeueingAll(true);
    setError(null);
    // A per-item failure does NOT abort the batch. The backend refuses an item that is
    // no longer dead-lettered with CoreError::NotFound (remote.rs:192-195 — "a request to
    // requeue an item that is already being retried must not be a silent no-op"), which
    // is a NORMAL outcome here: the operator requeued it from the row button a moment
    // before, or a previous cycle already claimed it. The old loop let that single
    // refusal throw out of the whole walk, so the remaining N-of-N items were never
    // attempted and the operator saw only a raw error string.
    let failed = 0;
    let lastError: unknown = null;
    try {
      let index = 0;
      for (const item of items) {
        index++;
        setRequeueProgress({ current: index, total: items.length });
        try {
          await requeueRemoteFailureScoped(sessionToken, item.itemId);
        } catch (e) {
          failed += 1;
          lastError = e;
        }
      }
      await load();
      onRequeueSuccess?.();
      // Report the PARTIAL result rather than pretending the batch succeeded. A stale
      // item is not an operator error worth a failure banner, but silently requeueing
      // 8 of 10 and saying nothing is worse.
      if (failed > 0) {
        setError(
          l10nErrorMessage(lastError, l10n, 'sync-conflicts-requeue-partial') +
            ` (${failed}/${items.length})`,
        );
      }
    } catch (e) {
      setError(l10nErrorMessage(e, l10n, 'sync-conflicts-requeue-failed'));
    } finally {
      requeueingAllRef.current = false;
      setRequeueingAll(false);
      setRequeueProgress(null);
    }
  }

  async function handleCopyPayload(itemId: string, payload: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(formatJsonPayload(payload));
        setCopiedId(itemId);
        setTimeout(() => {
          setCopiedId((curr) => (curr === itemId ? null : curr));
        }, 2000);
      }
    } catch {
      // Best-effort copy fallback
    }
  }

  const deadLettered = failures.filter((f) => f.deadLettered);

  return (
    <section
      className="sync-conflicts-panel"
      aria-label={l10n.getString('sync-conflicts-panel-title')}
    >
      <div className="sync-conflicts-panel-header">
        <h3 className="sync-conflicts-panel-title">
          {l10n.getString('sync-conflicts-panel-title')}
        </h3>
        {deadLettered.length > 1 && (
          <button
            type="button"
            className="sync-conflicts-requeue-all-btn"
            disabled={requeueingAll || requeueingId !== null}
            onClick={() => void handleRequeueAll(deadLettered)}
            aria-label={l10n.getString('sync-conflicts-requeue-all-aria')}
          >
            {requeueingAll && requeueProgress
              ? l10n.getString('sync-conflicts-requeueing-all', {
                  current: requeueProgress.current,
                  total: requeueProgress.total,
                })
              : l10n.getString('sync-conflicts-requeue-all')}
          </button>
        )}
      </div>

      {loading && (
        <p className="sync-conflicts-panel-status">
          {l10n.getString('sync-conflicts-loading')}
        </p>
      )}
      {error && (
        <p className="sync-conflicts-panel-error" role="alert">
          {error}
        </p>
      )}
      {!loading && deadLettered.length === 0 && (
        <p className="sync-conflicts-panel-empty">
          {l10n.getString('sync-conflicts-panel-empty')}
        </p>
      )}
      {!loading && deadLettered.length > 0 && (
        <div className="sync-conflicts-table-wrap">
          <table
            className="sync-conflicts-table"
            aria-label={l10n.getString('sync-conflicts-panel-table-aria')}
          >
            <thead>
              <tr>
                <th scope="col">{l10n.getString('sync-conflicts-col-action')}</th>
                <th scope="col">{l10n.getString('sync-conflicts-col-attempts')}</th>
                <th scope="col">{l10n.getString('sync-conflicts-col-error')}</th>
                <th scope="col">{l10n.getString('sync-conflicts-col-actions')}</th>
              </tr>
            </thead>
            <tbody>
              {deadLettered.map((f) => {
                const isExpanded = expandedPayloadId === f.itemId;
                return (
                  <Fragment key={f.itemId}>
                    <tr>
                      <td>{f.action}</td>
                      <td>{f.attempts}</td>
                      {/* The error text is a server string, not a translatable
                          UI label, so it stays as-is inside the design Tooltip
                          rather than a native `title=` (banned on intrinsic
                          elements -- see nativeTooltipCompliance.test.ts).
                          `portal` escapes the table's scroll clipping and
                          `fit="inline"` keeps the cell's own box. */}
                      <td>
                        {f.lastError ? (
                          <Tooltip content={f.lastError} fit="inline" portal>
                            <span className="sync-conflicts-error-text">{f.lastError}</span>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="sync-conflicts-actions-group">
                          <button
                            type="button"
                            className="sync-conflicts-inspect-btn"
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? l10n.getString('sync-conflicts-payload-hide-aria', { id: f.itemId })
                                : l10n.getString('sync-conflicts-payload-inspect-aria', { id: f.itemId })
                            }
                            onClick={() =>
                              setExpandedPayloadId((curr) => (curr === f.itemId ? null : f.itemId))
                            }
                          >
                            {isExpanded
                              ? l10n.getString('sync-conflicts-payload-hide')
                              : l10n.getString('sync-conflicts-payload-inspect')}
                          </button>
                          <button
                            type="button"
                            className="sync-conflicts-retry-btn"
                            aria-label={l10n.getString('sync-conflicts-retry-aria', { id: f.itemId })}
                            disabled={requeueingAll || requeueingId === f.itemId}
                            onClick={() => void handleRequeue(f.itemId)}
                          >
                            {requeueingId === f.itemId
                              ? l10n.getString('sync-conflicts-retrying')
                              : l10n.getString('sync-conflicts-retry')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="sync-conflicts-payload-row">
                        <td colSpan={4}>
                          <div
                            className="sync-conflicts-payload-viewer"
                            data-testid={`payload-view-${f.itemId}`}
                          >
                            <div className="sync-conflicts-payload-header">
                              <span className="sync-conflicts-payload-title">{l10n.getString('sync-conflicts-payload-title')}</span>
                              <button
                                type="button"
                                className="sync-conflicts-copy-btn"
                                onClick={() => void handleCopyPayload(f.itemId, f.payload)}
                              >
                                {copiedId === f.itemId
                                  ? l10n.getString('sync-conflicts-payload-copied')
                                  : l10n.getString('sync-conflicts-payload-copy')}
                              </button>
                            </div>
                            <pre className="sync-conflicts-payload-pre">
                              {formatJsonPayload(f.payload)}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

