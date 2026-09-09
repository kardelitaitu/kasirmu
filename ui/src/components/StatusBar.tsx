import { useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { useToast } from '@/frontend/shared/Toast';
import Tooltip from '@/frontend/shell/Tooltip';
import { useAuthConnection } from '@/hooks/useAuthConnection';
import { toneForHealth, type ConnectionHealth, type StatusTone } from '@/hooks/connectionHealth';
import { useSyncConnection } from '@/hooks/useSyncConnection';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import type { VersionStatusInfo } from '@/hooks/useVersionStatus';
import './StatusBar.css';

// The tone vocabulary and the latency thresholds live in
// @/hooks/connectionHealth with the state union, so an indicator cannot
// disagree with the hook feeding it. This file used to keep its own
// `HealthState` ('checking' | 'online' | 'offline') alongside the two hooks'
// structurally identical `*ConnectionState` unions — three names for one
// concept, and `degraded` was in none of them.

/** Icon glyphs (Lucide-style, 24x24 stroke icons, uniform style). */
function KeyIcon() {
  return (
    <svg className="statusbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg className="statusbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="statusbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

const ICONS = {
  key: KeyIcon,
  sync: SyncIcon,
  download: DownloadIcon,
} as const;

interface StatusItemProps {
  kind: keyof typeof ICONS;
  tone: StatusTone;
  label: string;
  tooltip: string;
  onClick?: () => void;
  align?: 'center' | 'left' | 'right';
}

/** One colored icon button with a hover tooltip + click toast. */
function StatusItem({ kind, tone, label, tooltip, onClick, align = 'center' }: StatusItemProps) {
  const Icon = ICONS[kind];
  return (
    <Tooltip content={tooltip} position="top" showDelay={300} portal nowrap align={align}>
      <button
        type="button"
        className={`statusbar-item statusbar-tone--${tone}`}
        aria-label={label}
        aria-describedby={undefined}
        onClick={onClick}
      >
        <Icon />
      </button>
    </Tooltip>
  );
}

/**
 * Single status area with three colored SVG icons — auth, sync, version.
 *
 * Colors follow latency thresholds: green < 1 s, yellow 1–3 s, red >= 3 s
 * (or unreachable). While checking, the icon slowly blinks grey. Hovering
 * shows a native tooltip; clicking raises a toast with the same detail.
 *
 * When `bare` is set the surrounding pill/box chrome is omitted so the icon
 * row can sit inline inside a larger container (e.g. the shell StatusBar).
 */
export default function StatusBar({ bare = false }: { bare?: boolean }) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const auth = useAuthConnection();
  const sync = useSyncConnection();
  const version = useVersionStatus();

  // ── Labels (localized) ─────────────────────────────────────────
  const authLabel = requiredLocalized(l10n, 'staff-login-connection-auth');
  const syncLabel = requiredLocalized(l10n, 'staff-login-connection-sync');
  const versionLabel = requiredLocalized(l10n, 'statusbar-version-label');

  // ── Auth + Sync items ──────────────────────────────────────────
  // Both hooks return { state: ConnectionHealth, latencyMs, cause }.
  const connectionTone = (s: { state: ConnectionHealth; latencyMs: number | null }): StatusTone =>
    toneForHealth(s.state, s.latencyMs);
  const connectionTooltip = (
    l10n: ReturnType<typeof useLocalization>['l10n'],
    s: { state: ConnectionHealth; latencyMs: number | null; cause: string | null },
    name: string,
  ) => {
    if (s.state === 'checking') {
      return requiredLocalized(l10n, 'statusbar-checking-msg', { name });
    }
    if (s.state === 'disconnected') {
      return requiredLocalized(l10n, 'statusbar-offline-msg', { name });
    }
    // Degraded names the subsystem the server itself reported. Translating it
    // into "something is wrong" would throw away the only actionable half of
    // the message, so it is interpolated as-is — it is a service label like
    // "database", not prose.
    if (s.state === 'degraded') {
      return requiredLocalized(l10n, 'statusbar-degraded-msg', { name, cause: s.cause ?? '' });
    }
    return requiredLocalized(l10n, 'statusbar-latency-msg', { name, ms: String(s.latencyMs ?? 0) });
  };

  const authTone = connectionTone(auth);
  const authTooltip = connectionTooltip(l10n, auth, authLabel);
  const syncTone = connectionTone(sync);
  const syncTooltip = connectionTooltip(l10n, sync, syncLabel);

  // ── Version item (2 states: latest / update) ───────────────────
  const versionTone: StatusTone =
    version.state === 'checking' ? 'checking' : version.state === 'update' ? 'warn' : 'good';
  const versionTooltip =
    version.state === 'checking'
      ? requiredLocalized(l10n, 'statusbar-checking-msg', { name: versionLabel })
      : version.state === 'update'
        ? requiredLocalized(l10n, 'statusbar-version-update-msg')
        : requiredLocalized(l10n, 'statusbar-version-latest-msg');

  const notify = (msg: string) => addToast({ type: 'info', message: msg });

  return (
    <div className={`statusbar${bare ? ' statusbar--bare' : ''}`} role="group" aria-label={requiredLocalized(l10n, 'statusbar-group-aria')}>
      <StatusItem kind="key" tone={authTone} label={authLabel} tooltip={authTooltip} onClick={() => notify(authTooltip)} />
      <StatusItem kind="sync" tone={syncTone} label={syncLabel} tooltip={syncTooltip} onClick={() => notify(syncTooltip)} />
      <StatusItem kind="download" tone={versionTone} label={versionLabel} tooltip={versionTooltip} onClick={() => notify(versionTooltip)} align="right" />
    </div>
  );
}

// Re-export type for tests.
export type { VersionStatusInfo };