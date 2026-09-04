import { memo, useState, useEffect, useCallback } from 'react';
import { Localized } from '@fluent/react';
import { requiredLocalized } from '@/frontend/shared';
import { useLocalization } from '@fluent/react';
import {
  listKdsDevicesScoped,
  type KdsDevice,
  type KdsConnectionStatus,
} from '@/api/kds';
import './KdsDeviceStatusIndicator.css';

/** Props for the KdsDeviceStatusIndicator. */
export interface KdsDeviceStatusIndicatorProps {
  /** Session token for scoped API calls. */
  sessionToken: string;
  /** How often to poll for device status (ms). Defaults to 10000. */
  pollIntervalMs?: number;
  /**
   * H3: entry point for the enrollment modal. Previously the modal was
   * unreachable dead code (no UI ever opened it). When provided, an
   * "Enroll device" action appears in the dropdown — and the indicator
   * itself renders even with zero devices so a fresh kitchen can enroll
   * its first display.
   */
  onEnrollDevice?: () => void;
}

/**
 * Determine overall device status from connected/total counts.
 * All connected → 'connected', some → 'stale', none → 'disconnected'.
 * Exported for testing.
 */
export function overallDeviceStatus(
  connectedCount: number,
  totalCount: number,
): KdsConnectionStatus {
  if (connectedCount === totalCount) return 'connected';
  if (connectedCount > 0) return 'stale';
  return 'disconnected';
}

/** Map connection status to a display label and CSS modifier. */
const STATUS_DISPLAY: Record<
  KdsConnectionStatus,
  { labelKey: string; className: string }
> = {
  connected: {
    labelKey: 'kds-device-status-connected',
    className: 'kds-device-status--connected',
  },
  disconnected: {
    labelKey: 'kds-device-status-disconnected',
    className: 'kds-device-status--disconnected',
  },
  stale: {
    labelKey: 'kds-device-status-stale',
    className: 'kds-device-status--stale',
  },
};

/**
 * KdsDeviceStatusIndicator — compact badge showing the connection
 * status of all KDS devices for the current Restaurant POS.
 *
 * Displays a small pill with a colored dot and device count, expandable
 * to show individual device names and their statuses.
 */
export const KdsDeviceStatusIndicator = memo(
  function KdsDeviceStatusIndicator({
    sessionToken,
    pollIntervalMs = 10_000,
    onEnrollDevice,
  }: KdsDeviceStatusIndicatorProps) {
    const { l10n } = useLocalization();
    const [devices, setDevices] = useState<KdsDevice[]>([]);
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);

    const fetchDevices = useCallback(async () => {
      if (!sessionToken) return;
      setLoading(true);
      try {
      const result = await listKdsDevicesScoped(sessionToken);
      setDevices(Array.isArray(result) ? result : []);
      } catch {
        // Silent — indicator is non-critical UI.
      } finally {
        setLoading(false);
      }
    }, [sessionToken]);

    // Poll for device status.
    useEffect(() => {
      fetchDevices();
      const interval = setInterval(fetchDevices, pollIntervalMs);
      return () => clearInterval(interval);
    }, [fetchDevices, pollIntervalMs]);

    // Don't render if no devices are registered — unless an enrollment
    // entry point was provided (a fresh kitchen still needs one). The
    // zero-device branch below renders the enroll button alone.
    if ((!devices || devices.length === 0) && !loading) {
      return onEnrollDevice ? (
        <div className="kds-device-status-container">
          <button
            type="button"
            className="kds-device-enroll-btn"
            onClick={onEnrollDevice}
            aria-label={requiredLocalized(l10n, 'kds-device-enroll-aria')}
          >
            <Localized id="kds-device-enroll">Enroll device</Localized>
          </button>
        </div>
      ) : null;
    }

    const connectedCount = devices.filter(
      (d) => d.connection_status === 'connected',
    ).length;
    const totalCount = devices.length;

    const overallStatus = overallDeviceStatus(connectedCount, totalCount);

    const statusDisplay = STATUS_DISPLAY[overallStatus];

    const enrollButton = onEnrollDevice ? (
      <button
        type="button"
        className="kds-device-enroll-btn"
        onClick={() => {
          setExpanded(false);
          onEnrollDevice();
        }}
        aria-label={requiredLocalized(l10n, 'kds-device-enroll-aria')}
      >
        <Localized id="kds-device-enroll">Enroll device</Localized>
      </button>
    ) : null;

    return (
      <div className="kds-device-status-container">
        <button
          className={`kds-device-status ${statusDisplay.className}`}
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          aria-label={requiredLocalized(l10n, 'kds-device-status-aria', {
            connected: String(connectedCount),
            total: String(totalCount),
          })}
        >
          <span className="kds-device-status-dot" aria-hidden="true" />
          <span className="kds-device-status-count">
            {connectedCount}/{totalCount}
          </span>
        </button>

        {expanded && (
          <div
            className="kds-device-status-dropdown"
            role="list"
            aria-label={requiredLocalized(l10n, 'kds-device-list-aria')}
          >
            {devices.map((device) => {
              const deviceDisplay =
                STATUS_DISPLAY[device.connection_status];
              return (
                <div
                  key={device.id}
                  className={`kds-device-status-item ${deviceDisplay.className}`}
                  role="listitem"
                >
                  <span
                    className="kds-device-status-dot kds-device-status-dot--sm"
                    aria-hidden="true"
                  />
                  <span className="kds-device-status-name">
                    {device.name}
                  </span>
                  <span className="kds-device-status-label">
                    {requiredLocalized(l10n, deviceDisplay.labelKey)}
                  </span>
                </div>
              );
            })}
            {enrollButton}
          </div>
        )}
      </div>
    );
  },
);
