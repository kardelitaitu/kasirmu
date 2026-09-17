import { useState, useCallback, useEffect } from 'react';
import { requiredLocalized } from '@/components';
import { Localized, useLocalization } from '@fluent/react';
import { exportDailySummaryScoped, type DailySummaryRow } from '@/api/sales';
import { formatMoney, type Money } from '@/types/domain';
import { Skeleton } from '@/components/Skeleton';
import TierLockedFeature from '@/components/TierLockedFeature';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
/**
 * Daily Total Widget — shows revenue, sales count, and item count
 * for the current day. Registered with the WidgetRegistry so it
 * can be rendered on any dashboard page.
 *
 * This widget is designed to be rendered inside a container Card
 * provided by the host dashboard page.
 *
 * ACCESS: this component renders, it does not decide. `requiredPermission:
 * 'reports:export'` on the `daily-total` registration (features/sales/widgets/
 * index.ts) is enforced by the widget registry via `passesGate`, so SalesDashboardScreen
 * never mounts this tile for a session that lacks the key - and therefore never
 * calls `export_daily_summary_scoped`, which would refuse it.
 */
export default function DailyTotalWidget() {
  const { l10n } = useLocalization();
  const { caps } = useSubscription();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [summary, setSummary] = useState<DailySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await exportDailySummaryScoped(sessionToken);
      setSummary(s);
    } catch {
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const dailyTotal = summary.reduce((acc, r) => acc + r.total_minor, 0);
  const totalSales = summary.length;
  const totalItems = summary.reduce((acc, r) => acc + r.line_count, 0);
  const currency = summary[0]?.currency ?? 'USD';

  // C2.2: Free tier sees a blurred teaser with upgrade CTA (§3, §6).
  if (caps && !caps.supportsDailyDashboard) {
    return (
      <TierLockedFeature
        titleKey="daily-dashboard-locked-title"
        messageKey="daily-dashboard-locked-message"
        ctaKey="daily-dashboard-locked-cta"
        target="plus"
      >
        <div className="reporting-widget reporting-widget--daily-total" aria-hidden="true">
          <div className="reporting-widget-kpi-row">
            <div className="reporting-widget-kpi">
              <span className="reporting-widget-kpi-label">Daily Total</span>
              <span className="reporting-widget-kpi-value">Rp 1.250.000</span>
            </div>
            <div className="reporting-widget-kpi">
              <span className="reporting-widget-kpi-label">Sales</span>
              <span className="reporting-widget-kpi-value">12</span>
            </div>
            <div className="reporting-widget-kpi">
              <span className="reporting-widget-kpi-label">Items</span>
              <span className="reporting-widget-kpi-value">34</span>
            </div>
          </div>
        </div>
      </TierLockedFeature>
    );
  }

  if (loading) {
    return (
      <div className="reporting-widget" aria-hidden="true">
        <div className="reporting-widget-kpi-row">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="reporting-widget-kpi">
              <Skeleton width="4rem" height="0.75rem" />
              <Skeleton width="5rem" height="1.5rem" style={{ marginTop: '4px' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="reporting-widget reporting-widget--daily-total" aria-label={requiredLocalized(l10n, 'sales-dashboard-daily-aria')}>
      <div className="reporting-widget-header">
        <Localized id="sales-dashboard-daily-total">
          <h3 className="reporting-widget-title">Daily Summary</h3>
        </Localized>
      </div>
      <div className="reporting-widget-kpi-row">
        <div className="reporting-widget-kpi">
          <Localized id="sales-dashboard-daily-total">
            <span className="reporting-widget-kpi-label">Daily Total</span>
          </Localized>
          <span className="reporting-widget-kpi-value reporting-widget-kpi-value--primary">
            {formatMoney({ minor_units: dailyTotal, currency } as Money)}
          </span>
        </div>
        <div className="reporting-widget-kpi">
          <Localized id="sales-dashboard-total-sales">
            <span className="reporting-widget-kpi-label">Sales</span>
          </Localized>
          <span className="reporting-widget-kpi-value">{totalSales}</span>
        </div>
        <div className="reporting-widget-kpi">
          <Localized id="sales-dashboard-total-items">
            <span className="reporting-widget-kpi-label">Items</span>
          </Localized>
          <span className="reporting-widget-kpi-value">{totalItems}</span>
        </div>
      </div>
    </div>
  );
}
