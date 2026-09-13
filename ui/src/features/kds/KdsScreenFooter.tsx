import { useEffect, useRef, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDeviceIp } from '@/hooks/useDeviceIp';
import { useSyncConnection } from '@/hooks/useSyncConnection';
import { requiredLocalized } from '@/frontend/shared';

/** "dd Month hh:mm" — the prototype footer clock format. */
export function formatClock(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * KdsScreenFooter — the screen's status bar (prototype
 * ``.kds-screen-footer``): ``Username | Workspace | IP | dd Month hh:mm |
 * Last sync: xxs ago | Connected/Disconnected``.
 *
 * Data sources: display name from the auth session, workspace name from
 * the active instance, IP from ``useDeviceIp`` (public → local fallback),
 * a live clock, and sync state from ``useSyncConnection``. "Last sync"
 * is the last time the connection reported healthy.
 */
export function KdsScreenFooter() {
  const { l10n } = useLocalization();
  const { session } = useAuth();
  const { activeInstance } = useWorkspace();
  const { ip } = useDeviceIp();
  const { state } = useSyncConnection();

  const locale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  // Live clock — ticks every 30s (minutes precision is enough).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Last healthy-sync timestamp — updates whenever the connection reports connected.
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const wasConnected = useRef(false);
  useEffect(() => {
    if (state === 'connected') {
      wasConnected.current = true;
      setLastSyncAt(Date.now());
    }
  }, [state]);

  const username = session?.display_name ?? '';
  const workspace = activeInstance?.name ?? activeInstance?.store_name ?? '';

  // Compact relative time for "Last sync: xxs ago".
  const syncAgo =
    lastSyncAt === null && !wasConnected.current
      ? requiredLocalized(l10n, 'kds-footer-never')
      : lastSyncAt === null
        ? ''
        : (() => {
            const sec = Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000));
            // Numbers, not strings — keeps Fluent number formatting intact.
            if (sec < 60) return requiredLocalized(l10n, 'kds-footer-seconds', { count: sec });
            const min = Math.floor(sec / 60);
            if (min < 60) return requiredLocalized(l10n, 'kds-footer-minutes', { count: min });
            return requiredLocalized(l10n, 'kds-footer-hours', { count: Math.floor(min / 60) });
          })();

  return (
    <div className="kds-screen-footer" role="contentinfo" aria-label={requiredLocalized(l10n, 'kds-footer-aria')}>
      <span>{username || '\u00a0'}</span>
      <span className="sep" aria-hidden="true">|</span>
      <span>{workspace || '\u00a0'}</span>
      <span className="sep" aria-hidden="true">|</span>
      <span>{ip || '\u00a0'}</span>
      <span className="sep" aria-hidden="true">|</span>
      <span>{formatClock(now, locale)}</span>
      <span className="sep" aria-hidden="true">|</span>
      <span>
        <Localized id="kds-footer-last-sync" vars={{ time: syncAgo }}>
          <span>Last sync: {syncAgo}</span>
        </Localized>
      </span>
      <span className="sep" aria-hidden="true">|</span>
      <span>
        {state === 'connected'
          ? requiredLocalized(l10n, 'kds-device-status-connected')
          : requiredLocalized(l10n, 'kds-device-status-disconnected')}
      </span>
    </div>
  );
}
