//! Revenue KPI + trend chart. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the option builder now lives in
//! `charts/RevenueTrendChart`. The shell keeps loading/error gates, the
//! KPI row, the chart wrapper (accessibility stays with the shell) and
//! the peak/low insights.

import { useLocalization } from '@fluent/react';
import { periodDelta, seriesDelta, type AnalyticsQuery, type Bucket } from '../analytics-data';
import { exportTrendCsv } from '../utils/analyticsCardCsv';
import { RevenueTrendChart } from '../charts/RevenueTrendChart';
import { NO_BUCKETS } from './shared/constants';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';
import { useMoney } from './shared/useMoney';

export function RevenueCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt, short } = useMoney();
  const getString = useGetString();
  const { data, prev, error } = useCardDataCompare<Bucket[]>('revenue', q, compare ?? false);
  const prevData = prev ?? NO_BUCKETS;
  const total = data ? data.reduce((s, d) => s + d.value, 0) : 0;
  const prevTotal = prevData.reduce((s, d) => s + d.value, 0);
  const peak = data && data.length ? data.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = data && data.length ? data.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  // Compare mode replaces the in-period trend with the true period-over-
  // period change; off-mode keeps the existing series delta.
  const delta = compare ? periodDelta(total, prevTotal) : data ? seriesDelta(data) : null;
  if (error) return <CardError error={error} />;
  if (!data) return <CardLoading />;
  return (
    <Visual className="analytics-card-visual--revenue">
      <div className="analytics-kpi-row">
        <Kpi value={short(total)} label={l10n.getString('analytics-card-total-revenue')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-revenue-aria')} onClick={() => exportTrendCsv('revenue', l10n.getString('analytics-export-col-revenue'), data, q.from, q.to, (id) => l10n.getString(id), fmt)} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <RevenueTrendChart data={data} prev={prevData} compare={compare ?? false} expanded={expanded} fmt={fmt} getString={getString} />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: short(peak.value) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: short(low.value) })}</p>}
    </Visual>
  );
}
