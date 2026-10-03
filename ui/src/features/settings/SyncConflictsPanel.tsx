import { useLocalization } from '@fluent/react';
import { useCallback, useEffect, useState } from 'react';

import {
  listRemoteFailuresScoped,
  requeueRemoteFailureScoped,
  type RemoteSyncFailureDto,
} from '@/api/offline';
import { useWorkspace } from '@/contexts/WorkspaceContext';

import './SyncConflictsPanel.css';

export interface SyncConflictsPanelProps {
  onRequeueSuccess?: () => void;
}

/** Manager-only panel showing quarantined dead-lettered remote sync failures. */
export function SyncConflictsPanel({ onRequeueSuccess }: SyncConflictsPanelProps) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';

  const [failures, setFailures] = useState<RemoteSyncFailureDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await listRemoteFailuresScoped(sessionToken);
      setFailures(result ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

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

  const deadLettered = failures.filter((f) => f.deadLettered);

  return (
    <section
      className="sync-conflicts-panel"
      aria-label={l10n.getString('sync-conflicts-panel-title')}
    >
      <h3 className="sync-conflicts-panel-title">
        {l10n.getString('sync-conflicts-panel-title')}
      </h3>
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
              {deadLettered.map((f) => (
                <tr key={f.itemId}>
                  <td>{f.action}</td>
                  <td>{f.attempts}</td>
                  <td title={f.lastError}>{f.lastError || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="sync-conflicts-retry-btn"
                      aria-label={l10n.getString('sync-conflicts-retry-aria', { id: f.itemId })}
                      disabled={requeueingId === f.itemId}
                      onClick={() => void handleRequeue(f.itemId)}
                    >
                      {requeueingId === f.itemId
                        ? l10n.getString('sync-conflicts-retrying')
                        : l10n.getString('sync-conflicts-retry')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
