import { useState, useCallback, useEffect } from 'react';
import { requiredLocalized } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Localized, useLocalization } from '@fluent/react';
import { getCategoryBreakdown } from '@/api/reports';
import { Skeleton } from '@/components/Skeleton';
import CanvasPieChart from '@/components/charts/CanvasPieChart';
import type { PieSlice } from '@/components/charts/CanvasPieChart';
import { l10nErrorMessage } from '@/utils/app-error';
import { useCurrency } from '@/contexts/CurrencyContext';
import { minorUnitExponent } from '@/types/domain';
import { isoToday, isoDaysAgo } from '@/features/analytics/analytics-data';
import { useStoreTimezone } from '@/hooks/useStoreTimezone';

/** Canvas 2D category breakdown donut chart widget for the reporting dashboard. */
export default function CategoryPieChartWidget() {
  const { l10n } = useLocalization();
  const { currency } = useCurrency();
  // R36-07: read the token through the useWorkspace() hook rather than the
// raw context object. The global test harness mocks the hook, not the
// context, so the direct form silently yielded an empty token and skipped
// every token-gated effect. AppProviders wraps the routed tree in the
// provider, so the hook's throw-outside-provider path is unreachable here.
const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [slices, setSlices] = useState<PieSlice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // REP-03: one read of the store's calendar anchor, shared by every widget.
  const storeTz = useStoreTimezone();
  // The store zone lands AFTER the first fetch, so the window is refetched once
  // it arrives. Without this the second load blanks the tile to a skeleton and the
  // user watches the chart they were already reading disappear — the same reason
  // DashboardScreen keeps `hasLoaded` separate from `loading` (DashboardScreen.tsx:169,
  // :427) and shows a 'Refreshing…' line instead of the full-screen spinner.
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // REP-03: the window is the STORE's last 31 days. The backend buckets
      // the range by the store's offset, so a UTC-anchored end date omits the
      // store's current day for every store past UTC midnight.
      const rows = await getCategoryBreakdown(
        isoDaysAgo(30, storeTz),
        isoToday(storeTz),
        sessionToken,
      );
      setSlices(
        rows.map((r) => ({
          name: r.category_name || 'Uncategorized',
          value: r.total_minor,
        })),
      );
    } catch (e) {
      // ERR-05: never render raw backend messages — map to user-safe copy.
      setError(l10nErrorMessage(e, l10n, 'app-error-generic'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [sessionToken, l10n, storeTz]);

  useEffect(() => { load(); }, [load]);

  if (loading && !hasLoaded) {
    return (
      <div className="reporting-widget" aria-hidden="true">
        <div className="reporting-widget-header">
          <Skeleton width="8rem" height="0.875rem" />
        </div>
        <Skeleton variant="block" width="100%" height="200px" style={{ borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="reporting-widget">
        <div className="reporting-widget-header">
          <Localized id="sales-dashboard-category-title">
            <h3 className="reporting-widget-title">By Category</h3>
          </Localized>
        </div>
        <p className="reporting-widget-no-data">{error}</p>
      </div>
    );
  }

  if (slices.length === 0) {
    return (
      <div className="reporting-widget">
        <div className="reporting-widget-header">
          <Localized id="sales-dashboard-category-title">
            <h3 className="reporting-widget-title">By Category</h3>
          </Localized>
        </div>
        <p className="reporting-widget-no-data">
          <Localized id="sales-dashboard-no-data">
            <span>No data for this period</span>
          </Localized>
        </p>
      </div>
    );
  }

  return (
    <div className="reporting-widget reporting-widget--category" aria-label={requiredLocalized(l10n, 'sales-dashboard-category-aria')}>
      <div className="reporting-widget-header">
        <Localized id="sales-dashboard-category-title">
          <h3 className="reporting-widget-title">By Category</h3>
        </Localized>
      </div>
      <CanvasPieChart
        data={slices}
        otherLabel={requiredLocalized(l10n, 'sales-dashboard-chart-other')}
        label={requiredLocalized(l10n, 'sales-dashboard-category-aria')}
        summary={requiredLocalized(l10n, 'sales-dashboard-category-summary', {
          count: String(slices.length),
        })}
        formatValue={(v) =>
          new Intl.NumberFormat('en', {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: minorUnitExponent(currency),
          }).format(v / 10 ** minorUnitExponent(currency))
        }
        minHeight="200px"
      />
    </div>
  );
}
