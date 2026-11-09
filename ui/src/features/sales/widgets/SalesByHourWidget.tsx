import { useState, useCallback, useEffect } from 'react';
import { requiredLocalized } from '@/components';
import { Localized, useLocalization } from '@fluent/react';
import { exportSalesByHourScoped, type SalesByHourRow } from '@/api/sales';
import { formatMoney, type Money } from '@/types/domain';
import { Skeleton } from '@/components/Skeleton';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalCurrency } from '@/contexts/CurrencyContext';
/**
 * Sales by Hour Widget — shows a bar chart of sales broken down
 * by hour of the day. Registered with the WidgetRegistry.
 *
 * This widget is designed to be rendered inside a container Card
 * provided by the host dashboard page.
 *
 * ACCESS: this component renders, it does not decide. `requiredPermission:
 * 'reports:export'` on the `sales-by-hour` registration (features/sales/widgets/
 * index.ts) is enforced by the widget registry via `passesGate`, so
 * SalesDashboardScreen never mounts this tile for a session that lacks the key -
 * and therefore never calls `export_sales_by_hour_scoped`, which would refuse it.
 */
export default function SalesByHourWidget() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [hourly, setHourly] = useState<SalesByHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await exportSalesByHourScoped(sessionToken);
      setHourly(h);
    } catch {
      setHourly([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const peakHour = Math.max(...hourly.map((h) => h.total_minor), 0);
  // ⚠️ The store's currency, NOT a literal. This read `'USD'` unconditionally, so on
  // an IDR till every hourly figure rendered with a "$" — the same defect the POS cart
  // had, and `SalesByHourRow` cannot supply the answer because it carries no currency
  // field at all (api/sales.ts: only hour, total_minor, sale_count). The currency
  // context is the same authority every other money figure in the app formats with.
  //
  // `useOptionalCurrency`, not `useCurrency`: this widget is rendered by the
  // dashboard inside `AppProviders`, but it is also mounted bare by its own suite and
  // by the widget registry, and `useCurrency` THROWS outside a provider. The fallback
  // is grouped with the rest of the app's (`PosScreen` uses the same shape) rather
  // than a second opinion about what an unknown store bills in.
  const currencyCtx = useOptionalCurrency();
  const currency = currencyCtx?.currency ?? 'IDR';

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
