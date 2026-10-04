import { useLocalization } from '@fluent/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Tooltip from '@/app/Tooltip';

import {
  listRemoteFailuresScoped,
  requeueRemoteFailureScoped,
  type RemoteSyncFailureDto,
} from '@/api/offline';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import './SyncConflictsPanel.css';

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
      setFailures(list);
      const deadCount = list.filter((f) => f.deadLettered).length;
      onCountChange?.(deadCount);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRequeue(itemId: string) {
    if (!sessionToken) return;
    setRequeueingId(itemId);
    setError(null);
    try {
      await requeueRemoteFailureScoped(sessionToken, itemId);
      await load();
      onRequeueSuccess?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setRequeueingId(null);
    }
  }

  async function handleRequeueAll(items: RemoteSyncFailureDto[]) {
    if (!sessionToken || items.length === 0) return;
    setRequeueingAll(true);
    setError(null);
    try {
      let index = 0;
      for (const item of items) {
        index++;
        setRequeueProgress({ current: index, total: items.length });
        await requeueRemoteFailureScoped(sessionToken, item.itemId);
      }
      await load();
      onRequeueSuccess?.();
    } catch (e) {
      setError(String(e));
    } finally {
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
                              <span className="sync-conflicts-payload-title">JSON Payload</span>
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

