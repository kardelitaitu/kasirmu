import { useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { useToast } from '@/frontend/shared/Toast';
import Tooltip from '@/frontend/shell/Tooltip';
import { useAuthConnection } from '@/hooks/useAuthConnection';
import { toneForBinaryHealth, toneForHealth, type ConnectionHealth, type StatusTone } from '@/hooks/connectionHealth';
import { useSyncConnection } from '@/hooks/useSyncConnection';
import { usePaymentConnection } from '@/hooks/usePaymentConnection';
import { useDevicesConnection } from '@/hooks/useDevicesConnection';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import type { VersionStatusInfo } from '@/hooks/useVersionStatus';
import './StatusBar.css';

// The tone vocabulary and the latency thresholds live in
// @/hooks/connectionHealth with the state union, so an indicator cannot
// disagree with the hook feeding it. This file used to keep its own
// `HealthState` ('checking' | 'online' | 'offline') alongside the two hooks'
// structurally identical `*ConnectionState` unions — three names for one
// concept, and `degraded` was in none of them.
//
// The four service pills below are the UI half of the service-health
// contracts (todo-global-saas-3.md): license server (auth), sync, payment,
// device connectivity. The version pill is not one of the four named
// services — it stays as the fifth, right-aligned icon.

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

function CardIcon() {
  return (
    <svg className="statusbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function UsbIcon() {
  return (
    <svg className="statusbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="7" r="1" />
      <circle cx="4" cy="20" r="1" />
      <path d="M4.7 19.3 19 5" />
      <path d="m21 3-3 1 2 2 1-3Z" />
      <path d="M9.26 7.68 5 12l2 5" />
      <path d="m10 14 5 2 3.5-3.5" />
      <path d="m18 12 1-1 1 1-1 1-1-1Z" />
    </svg>
  );
}

const ICONS = {
  key: KeyIcon,
  sync: SyncIcon,
  download: DownloadIcon,
  card: CardIcon,
  usb: UsbIcon,
} as const;

interface StatusItemProps {
  kind: keyof typeof ICONS;
  tone: StatusTone;
  label: string;
  tooltip: string;
  /** Second tooltip line: what clicking this pill will do. */
  hint?: string | undefined;
  onClick?: () => void;
  align?: 'center' | 'left' | 'right';
}

/** One colored icon button with a hover tooltip + click toast. */
function StatusItem({ kind, tone, label, tooltip, hint, onClick, align = 'center' }: StatusItemProps) {
  const Icon = ICONS[kind];
  const content = (
    <>
      {tooltip}
      {hint && (
        <span className="tooltip-hint">{hint}</span>
      )}
    </>
  );
  return (
    <Tooltip content={content} position="top" showDelay={300} portal nowrap align={align}>
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
 * Unified status area: four service pills (auth, sync, payment, devices)
 * plus the version icon. Colors follow latency thresholds: green < 1 s,
 * yellow 1–3 s, red >= 3 s (or unreachable). While checking, the icon
 * slowly blinks grey. Hovering shows a native tooltip; clicking a service
 * pill re-probes it now instead of waiting for the next scheduled poll —
 * the user-triggered retry the service-health contracts ask for. Only the
 * version icon keeps the informational toast (there is nothing to retry).
 *
 * When `bare` is set the surrounding pill/box chrome is omitted so the icon
 * row can sit inline inside a larger container (e.g. the shell StatusBar).
 */
export default function StatusBar({ bare = false }: { bare?: boolean }) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const auth = useAuthConnection();
  const sync = useSyncConnection();
  const payment = usePaymentConnection();
  const devices = useDevicesConnection();
  const version = useVersionStatus();

  // ── Labels (localized) ─────────────────────────────────────────
  const authLabel = requiredLocalized(l10n, 'staff-login-connection-auth');
  const syncLabel = requiredLocalized(l10n, 'staff-login-connection-sync');
  const paymentLabel = requiredLocalized(l10n, 'statusbar-payment-label');
  const devicesLabel = requiredLocalized(l10n, 'statusbar-devices-label');
  const versionLabel = requiredLocalized(l10n, 'statusbar-version-label');
  const retryHint = requiredLocalized(l10n, 'statusbar-retry-hint');

  // ── Manual retry (the box's user-triggered action) ─────────────
  // Re-probe now and say so. While a probe is already running there is
  // nothing to trigger — say that instead of queueing a duplicate.
  const handleRetry = (name: string, state: ConnectionHealth, tooltip: string, retry: () => void) => {
    if (state === 'checking') {
      addToast({ type: 'info', message: tooltip });
      return;
    }
    retry();
    addToast({ type: 'info', message: requiredLocalized(l10n, 'statusbar-retry-queued', { name }) });
  };

  // ── Service items ──────────────────────────────────────────────
  // Auth + Sync hooks return { state, latencyMs, cause }; the payment and
  // device hooks fold their probe into the same ConnectionHealth union.
  const connectionTone = (s: { state: ConnectionHealth; latencyMs: number | null }): StatusTone =>
    toneForHealth(s.state, s.latencyMs);
  const connectionTooltip = (
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
  const authTooltip = connectionTooltip(auth, authLabel);
  const syncTone = connectionTone(sync);
  const syncTooltip = connectionTooltip(sync, syncLabel);

  // ── Payment pill (ServiceKind::Payment) ────────────────────────
  // A configuration probe measures no latency, so the count of active
  // gateways is the reading — not a synthetic "0ms".
  const paymentTone = toneForBinaryHealth(payment.state);
  const paymentTooltip =
    payment.state === 'connected'
      ? requiredLocalized(l10n, 'statusbar-payment-gateway-msg', { name: paymentLabel, count: String(payment.gateways) })
      : payment.state === 'disconnected'
        ? requiredLocalized(l10n, 'statusbar-payment-unconfigured-msg', { name: paymentLabel })
        : connectionTooltip(payment, paymentLabel);

  // ── Devices pill (ServiceKind::DeviceConnectivity) ─────────────
  // Enumeration is binary, so the device count is the reading for every
  // state after the first probe — including 0 when the bus is empty.
  const devicesTone = toneForBinaryHealth(devices.state);
  const devicesTooltip =
    devices.state === 'checking'
      ? connectionTooltip(devices, devicesLabel)
      : requiredLocalized(l10n, 'statusbar-devices-count-msg', { name: devicesLabel, count: String(devices.devices) });

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
      <StatusItem
        kind="key"
        tone={authTone}
        label={authLabel}
        tooltip={authTooltip}
        hint={auth.state === 'checking' ? undefined : retryHint}
        onClick={() => handleRetry(authLabel, auth.state, authTooltip, auth.retryNow)}
      />
      <StatusItem
        kind="sync"
        tone={syncTone}
        label={syncLabel}
        tooltip={syncTooltip}
        onClick={() => notify(syncTooltip)}
      />
      <StatusItem
        kind="card"
        tone={paymentTone}
        label={paymentLabel}
        tooltip={paymentTooltip}
        hint={payment.state === 'checking' ? undefined : retryHint}
        onClick={() => handleRetry(paymentLabel, payment.state, paymentTooltip, payment.retryNow)}
      />
      <StatusItem
        kind="usb"
        tone={devicesTone}
        label={devicesLabel}
        tooltip={devicesTooltip}
        hint={devices.state === 'checking' ? undefined : retryHint}
        onClick={() => handleRetry(devicesLabel, devices.state, devicesTooltip, devices.retryNow)}
      />
      <StatusItem kind="download" tone={versionTone} label={versionLabel} tooltip={versionTooltip} onClick={() => notify(versionTooltip)} align="right" />
    </div>
  );
}

// Re-export type for tests.
export type { VersionStatusInfo };
