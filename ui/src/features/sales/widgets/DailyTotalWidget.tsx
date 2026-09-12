import { useState, useCallback, useEffect } from 'react';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import { exportDailySummaryScoped, type DailySummaryRow } from '@/api/sales';
import { formatMoney, type Money } from '@/types/domain';
import { Skeleton } from '@/components/Skeleton';
import TierLockedFeature from '@/components/TierLockedFeature';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasGrantedPermission } from '@/platform/ui/page-registry';
/**
 * Daily Total Widget — shows revenue, sales count, and item count
 * for the current day. Registered with the WidgetRegistry so it
 * can be rendered on any dashboard page.
 *
 * This widget is designed to be rendered inside a container Card
 * provided by the host dashboard page.
 */
/**
 * Read the logged-in session without hard-requiring an <AuthProvider>.
 *
 * `useAuth()` THROWS outside its provider, and the widget registry renders this
 * component inside the host page's <Suspense>/<LazyBoundary> with no error
 * boundary of its own — a throw here would take the whole dashboard down. So an
 * absent provider reads as `undefined` (not enough information to deny), the same
 * distinction page-registry `passesGate()` makes when a caller has no granted keys.
 * The app always mounts one (contexts/AppProviders.tsx:60), so in production this
 * never takes that branch: a session is present and its permissions decide.
 */
function useSessionOrUnknown() {
  try {
    return useAuth().session;
  } catch {
    return undefined;
  }
}

export default function DailyTotalWidget() {
  const { l10n } = useLocalization();
  const { caps } = useSubscription();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const session = useSessionOrUnknown();
  /**
   * F-017 lockout fix: `export_daily_summary_scoped` now enforces
   * `permissions::REPORTS_EXPORT` (tablet-client history.rs, mirroring the
   * desktop bridge in crates/oz-bridge). The Staff preset grants `sales:view`
   * but NOT `reports:export` (platform/core rbac_presets.rs), so this tile must
   * ask the same question the command asks before it calls it. Checked with the
   * backend-mirroring wildcard-aware helper the page/menu registries use.
   */
  const canExport = session === undefined
    ? true
    : hasGrantedPermission(session?.permissions, 'reports:export');
  const [summary, setSummary] = useState<DailySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // A refusal we provoke is a spinner and a log line for nobody: when the
    // permission is absent the command is never called at all.
    if (!canExport) return;
    setLoading(true);
    try {
      const s = await exportDailySummaryScoped(sessionToken);
      setSummary(s);
    } catch {
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, canExport]);

  useEffect(() => { load(); }, [load]);

  const dailyTotal = summary.reduce((acc, r) => acc + r.total_minor, 0);
  const totalSales = summary.length;
  const totalItems = summary.reduce((acc, r) => acc + r.line_count, 0);
  const currency = summary[0]?.currency ?? 'USD';

  // No reports:export -> say so in the tile slot. The registry cannot filter
  // this widget (WidgetRegistration has no permission field and getWidgets()
  // never sees a user), and a silently missing tile is indistinguishable from
  // a broken one, so this renders the same three lines the full-page
  // PermissionDenied screen renders, in the tile's own chrome.
  if (!canExport) {
    return (
      <div className="reporting-widget reporting-widget--daily-total" aria-label={requiredLocalized(l10n, 'sales-dashboard-daily-aria')}>
        <div className="reporting-widget-header">
          <Localized id="permission-denied-title">
            <h3 className="reporting-widget-title">Access Denied</h3>
          </Localized>
        </div>
        <Localized id="permission-denied-perm-desc" vars={{ action: requiredLocalized(l10n, 'sales-dashboard-daily-total') }}>
          <p className="reporting-widget-no-data">You don&apos;t have permission to access this report.</p>
        </Localized>
        <Localized id="permission-denied-perm-key" vars={{ permission: 'reports:export' }}>
          <p className="reporting-widget-no-data">(required permission: reports:export)</p>
        </Localized>
      </div>
    );
  }

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
