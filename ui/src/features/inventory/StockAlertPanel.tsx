import { useCallback, useEffect, useState, useRef, memo } from 'react';
import { requiredLocalized } from '@/components';
import { Localized, useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { StockAlertEvent } from '@/api/inventory';
import { getActiveStockAlerts, acknowledgeStockAlert } from '@/api/inventory';
import { l10nErrorMessage } from '@/utils/app-error';

import './StockAlertPanel.css';

interface StockAlertPanelProps {
  /** Inventory location ID to scope alerts to. */
  locationId: string;
  /** Optional interval (ms) for polling; 0 or omit disables polling. */
  pollIntervalMs?: number;
  /** Max alerts to display. */
  maxAlerts?: number;
}

/**
 * StockAlertPanel — ADR-18 §9e-iii dashboard widget.
 *
 * Displays active stock alerts for a given location with product info,
 * severity indicators, and acknowledge buttons. Supports optional polling.
 */
export const StockAlertPanel = memo(function StockAlertPanel({
  locationId,
  pollIntervalMs = 30_000,
  maxAlerts = 20,
}: StockAlertPanelProps) {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  const [alerts, setAlerts] = useState<StockAlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<Set<string>>(new Set());

  const token = sessionToken ?? '';

  // ── Fetch alerts ──────────────────────────────────────────────────

  const fetchAlerts = useCallback(async () => {
    if (!token || !locationId) return;
    try {
      setError(null);
      const data = await getActiveStockAlerts(token, locationId);
      setAlerts(data.slice(0, maxAlerts));
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'inv-alert-error-load'));
    } finally {
      setLoading(false);
    }
  }, [token, locationId, maxAlerts]); // l10n accessed via ref — stable dep chain


  useEffect(() => {
    fetchAlerts();

    if (pollIntervalMs > 0) {
      const interval = setInterval(fetchAlerts, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchAlerts, pollIntervalMs]);

  // ── Acknowledge ──────────────────────────────────────────────────

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      if (!token) return;
      setAcknowledging((prev) => new Set(prev).add(alertId));
      try {
        await acknowledgeStockAlert(token, alertId);
        // Remove from local state immediately for snappy UX
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      } catch (err) {
        setError(l10nErrorMessage(err, l10nRef.current, 'inv-alert-error-ack'));
      } finally {
        setAcknowledging((prev) => {
          const next = new Set(prev);
          next.delete(alertId);
          return next;
        });
      }
    },
    [token], // l10n accessed via ref — stable dep chain
  );

  // ── Severity ─────────────────────────────────────────────────────

  const isCritical = (alert: StockAlertEvent) => alert.current_qty === 0;

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return requiredLocalized(l10n, 'inv-alert-time-now');
      if (diffMin < 60) return requiredLocalized(l10n, 'inv-alert-time-min', { min: diffMin });
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return requiredLocalized(l10n, 'inv-alert-time-hr', { hr: diffHrs });
      return d.toLocaleDateString(numLocale);
    } catch {
      return iso;
    }
  };

  // ── Loading state ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="stock-alert-panel" role="region" aria-label={requiredLocalized(l10n, 'inv-alert-loading-aria')}>
        <div className="stock-alert-panel-header">
          <span className="stock-alert-panel-title"><Localized id="inv-alert-title">Stock Alerts</Localized></span>
        </div>
        <div className="stock-alert-loading">
          <Localized id="inv-alert-loading"><span>Loading alerts...</span></Localized>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────

  if (error && alerts.length === 0) {
    return (
      <div className="stock-alert-panel" role="region" aria-label={requiredLocalized(l10n, 'inv-alert-aria')}>
        <div className="stock-alert-panel-header">
          <span className="stock-alert-panel-title"><Localized id="inv-alert-title">Stock Alerts</Localized></span>
        </div>
        <div className="stock-alert-error" role="alert">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="stock-alert-panel" role="region" aria-label={requiredLocalized(l10n, 'inv-alert-panel-aria')}>
      {/* Header */}
      <div className="stock-alert-panel-header">
        <span className="stock-alert-panel-title">
          <Localized id="inv-alert-title">Stock Alerts</Localized>
        </span>
        {alerts.length > 0 && (
          <span className="stock-alert-panel-badge" aria-label={l10n.getString('inv-alert-badge-count', { count: alerts.length })}>
            {alerts.length}
          </span>
        )}
      </div>

      {/* Empty state */}
      {alerts.length === 0 && (
        <div className="stock-alert-empty">
          <svg className="stock-alert-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="stock-alert-empty-text">
            <Localized id="inv-alert-empty">No active alerts</Localized>
          </span>
        </div>
      )}

      {/* Alert list */}
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`stock-alert-card ${isCritical(alert) ? 'stock-alert-card--critical' : 'stock-alert-card--warning'}`}
          role="listitem"
        >
          <div className="stock-alert-product-row">
            <span className="stock-alert-sku">{alert.product_sku}</span>
            <span className="stock-alert-product-name" title={alert.product_name}>
              {alert.product_name}
            </span>
          </div>

          <div className="stock-alert-metrics">
            <span className="stock-alert-metric-current">
              <span className={`stock-alert-severity-dot ${isCritical(alert) ? '' : 'stock-alert-severity-dot--warning'}`} />
              <strong aria-label={requiredLocalized(l10n, 'inv-alert-stock-label')}>{alert.current_qty}</strong>
            </span>
            <span className="stock-alert-metric-threshold">
              <span aria-label={requiredLocalized(l10n, 'inv-alert-threshold-label')}>{alert.threshold}</span>
            </span>
          </div>

          <div className="stock-alert-footer">
            <span className="stock-alert-time" title={alert.triggered_at}>
              {formatTime(alert.triggered_at)}
            </span>
            <button
              type="button"
              className="stock-alert-ack-btn"
              onClick={() => handleAcknowledge(alert.id)}
              disabled={acknowledging.has(alert.id)}
              aria-label={l10n.getString('inv-alert-ack-aria', { name: alert.product_name })}
            >
              {acknowledging.has(alert.id) ? (requiredLocalized(l10n, 'inv-alert-acking')) : (requiredLocalized(l10n, 'inv-alert-ack'))}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
