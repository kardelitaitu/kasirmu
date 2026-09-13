import { useState, useEffect, useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { listTerminalsScoped, type TerminalDto } from '@/api/terminals';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import './TerminalStatusPanel.css';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function formatLastSeen(iso: string | null, l10n: ReturnType<typeof useLocalization>['l10n']): string {
  if (!iso) return l10n.getString('terminal-status-never');
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return l10n.getString('terminal-status-just-now');
  if (diff < 3_600_000) return l10n.getString('terminal-status-minutes-ago', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return l10n.getString('terminal-status-hours-ago', { n: Math.floor(diff / 3_600_000) });
  // Older than a day — render the date in the active Fluent locale
  // (toLocaleDateString with no locale uses the browser default).
  const locale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  return new Date(iso).toLocaleDateString(locale);
}

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

interface TerminalStatusPanelProps {
  refreshTrigger?: number;
}

/** Terminal status panel card — displays live online/offline status of all terminals with auto-refresh every 30 seconds. */
export default function TerminalStatusPanel({ refreshTrigger }: TerminalStatusPanelProps) {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listTerminalsScoped(sessionToken);
      setTerminals(data);
      setError(null);
    } catch {
      setError(l10n.getString('terminal-status-error-load'));
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  useEffect(() => {
    intervalRef.current = setInterval(load, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const onlineCount = terminals.filter((t) => isOnline(t.lastSeenAt)).length;

  return (
    <Card
      shadow="sm"
      header={
        <div className="terminal-status-header">
          <span className="terminal-status-title">
            <Localized id="terminal-status-title"><span>Terminal Status</span></Localized>
          </span>
          {!loading && (
            <span className="terminal-status-count">
              <Localized id="terminal-status-online-count" vars={{ online: onlineCount, total: terminals.length }}>
                <span>{onlineCount} / {terminals.length} online</span>
              </Localized>
            </span>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="terminal-status-loading-skeleton" aria-hidden="true">
          <div className="terminal-status-skeleton-header">
            <Skeleton width="8rem" height="1.25rem" />
            <Skeleton width="5rem" height="0.875rem" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="terminal-status-skeleton-row">
              <Skeleton variant="circle" width="0.625rem" height="0.625rem" />
              <div className="terminal-status-skeleton-info">
                <Skeleton width="80%" height="0.875rem" />
                <Skeleton width="60%" height="0.75rem" />
              </div>
              <Skeleton width="2.5rem" height="0.75rem" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="terminal-status-error">{error}</p>
      ) : terminals.length === 0 ? (
        <p className="terminal-status-empty">
          <Localized id="terminal-status-empty"><span>No terminals registered.</span></Localized>
        </p>
      ) : (
        <div className="terminal-status-list" role="list" aria-label={l10n.getString('terminal-status-list-aria')}>
          {terminals.map((terminal) => {
            const online = isOnline(terminal.lastSeenAt);
            return (
              <div key={terminal.id} className="terminal-status-item" role="listitem">
                <span
                  className={`terminal-status-dot ${online ? 'terminal-status-dot--online' : 'terminal-status-dot--offline'}`}
                  aria-label={online ? l10n.getString('terminal-status-online') : l10n.getString('terminal-status-offline')}
                />
                <div className="terminal-status-info">
                  <span className="terminal-status-item-name">{terminal.name}</span>
                  <span className="terminal-status-item-device">{terminal.deviceId}</span>
                </div>
                <span className="terminal-status-item-time">
                  {formatLastSeen(terminal.lastSeenAt, l10n)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
