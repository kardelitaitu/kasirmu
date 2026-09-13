//! Customer new-vs-returning card. Extracted from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.3); the donut now lives
//! in `charts/CustomerMixChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type CustomerSplitRow } from '../analytics-data';
import { exportCustomersCsv } from '../utils/analyticsCardCsv';
import { CustomerMixChart } from '../charts/CustomerMixChart';
import { CHART_ACCENT, CHART_ACCENT_SOFT } from '../charts/chartTheme';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Legend } from './shared/Legend';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';
import { useMoney } from './shared/useMoney';

export function CustomersCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { count } = useMoney();
  const getString = useGetString();
  const { data: split, prev: prevSplit, error } = useCardDataCompare<CustomerSplitRow>('customers', q, compare ?? false);
  const newCount = split ? split.new_count : 0;
  const retCount = split ? split.returning_count : 0;
  const total = newCount + retCount;
  const prevTotal = prevSplit ? prevSplit.new_count + prevSplit.returning_count : 0;
  const newPct = total > 0 ? Math.round((newCount / total) * 100) : 0;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  if (error) return <CardError error={error} />;
  if (!split) return <CardLoading />;
  if (newCount + retCount === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      <div className="analytics-kpi-row">
        <Kpi value={count(total)} label={l10n.getString('analytics-card-customers-total')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-customers-aria')} onClick={() => exportCustomersCsv(split, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart analytics-card-chart--donut" role="img" aria-label={title}>
        <CustomerMixChart newCount={newCount} returningCount={retCount} expanded={expanded} getString={getString} />
      </div>
      <Legend items={[
        { name: l10n.getString('analytics-card-customers-new'), value: count(newCount), color: CHART_ACCENT },
        { name: l10n.getString('analytics-card-customers-returning'), value: count(retCount), color: CHART_ACCENT_SOFT },
      ]} />
      <p className="analytics-card-insight">
        {l10n.getString('analytics-card-customers-new-share', { pct: String(newPct) })}
      </p>
    </Visual>
  );
}
