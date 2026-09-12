import { useState, useCallback, useEffect } from 'react';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import { exportSalesByHourScoped, type SalesByHourRow } from '@/api/sales';
import { formatMoney, type Money } from '@/types/domain';
import { Skeleton } from '@/components/Skeleton';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { isWidgetAccessible, useWidgetUser } from '@/platform/ui/widget-registry';
/**
 * Sales by Hour Widget — shows a bar chart of sales broken down
 * by hour of the day. Registered with the WidgetRegistry.
 *
 * This widget is designed to be rendered inside a container Card
 * provided by the host dashboard page.
 */
export default function SalesByHourWidget() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const user = useWidgetUser();
  /**
   * F-017 lockout fix: `export_sales_by_hour_scoped` enforces
   * `permissions::REPORTS_EXPORT` (tablet-client src/commands/history.rs:389,
   * mirroring the desktop bridge). The Staff preset grants `sales:view` but NOT
   * `reports:export` (platform/core/src/rbac_presets.rs:136-159), so this tile
   * must know the answer before it calls. The RULE is not spelled here: it asks
   * the widget registry, which delegates to `passesGate` in
   * platform/ui/page-registry/index.ts:139 - the same gate pages and nav items
   * pass through. Interim half of the gate: it exists only until
   * `registerSalesWidgets` declares `requiredPermission` on this tile, which lets
   * the host - which now gates through the registry - refuse to mount this
   * component at all.
   */
  const canExport = isWidgetAccessible({ requiredPermission: 'reports:export' }, user);
  const [hourly, setHourly] = useState<SalesByHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // A refusal we provoke is a spinner and a log line for nobody: when the
    // permission is absent the command is never called at all.
    if (!canExport) return;
    setLoading(true);
    try {
      const h = await exportSalesByHourScoped(sessionToken);
      setHourly(h);
    } catch {
      setHourly([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, canExport]);

  useEffect(() => { load(); }, [load]);

  const peakHour = Math.max(...hourly.map((h) => h.total_minor), 0);
  const currency = 'USD';

  // No reports:export -> say so in the tile slot. The registry cannot filter
  // this widget (WidgetRegistration has no permission field and getWidgets()
  // never sees a user), and a silently missing tile is indistinguishable from
  // a broken one, so this renders the same lines the full-page PermissionDenied
  // screen renders, inside the tile's own chrome.
  if (!canExport) {
    return (
      <div className="reporting-widget reporting-widget--hourly" aria-label={requiredLocalized(l10n, 'sales-dashboard-hourly-aria')}>
        <div className="reporting-widget-header">
          <Localized id="permission-denied-title">
            <h3 className="reporting-widget-title">Access Denied</h3>
          </Localized>
        </div>
        <Localized id="permission-denied-perm-desc" vars={{ action: requiredLocalized(l10n, 'sales-dashboard-hourly-title') }}>
          <p className="reporting-widget-no-data">You don&apos;t have permission to access this report.</p>
        </Localized>
        <Localized id="permission-denied-perm-key" vars={{ permission: 'reports:export' }}>
          <p className="reporting-widget-no-data">(required permission: reports:export)</p>
        </Localized>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="reporting-widget" aria-hidden="true">
        <div className="reporting-widget-header">
          <Skeleton width="6rem" height="0.875rem" />
        </div>
        <div className="reporting-widget-hourly-chart">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="reporting-widget-hour-bar-row">
              <Skeleton width="1.5rem" height="0.75rem" />
              <div className="reporting-widget-hour-bar-track">
                <Skeleton width={`${[60, 40, 80, 30, 70, 50, 90, 45][i]!}%`} height="0.75rem" style={{ borderRadius: 'var(--radius-sm)' }} />
              </div>
              <Skeleton width="3rem" height="0.75rem" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="reporting-widget reporting-widget--hourly" aria-label={requiredLocalized(l10n, 'sales-dashboard-hourly-aria')}>
      <div className="reporting-widget-header">
        <Localized id="sales-dashboard-hourly-title">
          <h3 className="reporting-widget-title">Sales by Hour</h3>
        </Localized>
      </div>
      <div className="reporting-widget-hourly-chart" role="list" aria-label={requiredLocalized(l10n, 'sales-dashboard-hourly-bars-aria')}>
        {hourly.map((h) => {
          const barPct = peakHour > 0 ? Math.round((h.total_minor / peakHour) * 100) : 0;
          return (
            <div key={h.hour} className="reporting-widget-hour-bar-row"
                 role="listitem"
                 aria-label={`${String(h.hour).padStart(2, '0')}:00 — ${h.sale_count} sales, ${formatMoney({ minor_units: h.total_minor, currency } as Money)}`}>
              <span className="reporting-widget-hour-label">
                {String(h.hour).padStart(2, '0')}
              </span>
              <div className="reporting-widget-hour-bar-track">
                <div
                  className={`reporting-widget-hour-bar ${barPct > 0 ? 'reporting-widget-hour-bar--active' : ''}`}
                  style={{ width: `${Math.max(barPct, h.total_minor > 0 ? 4 : 0)}%` }}
                />
              </div>
              <span className="reporting-widget-hour-value">
                {formatMoney({ minor_units: h.total_minor, currency } as Money)}
              </span>
            </div>
          );
        })}
        {hourly.length === 0 && (
          <Localized id="sales-dashboard-no-data">
            <p className="reporting-widget-no-data">No data for today</p>
          </Localized>
        )}
      </div>
    </div>
  );
}
