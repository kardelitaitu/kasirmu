//! Average-order-value KPI + trend. Extracted from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.3); the option builder
//! now lives in `charts/AovTrendChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, seriesDelta, type AnalyticsQuery, type AovTrend } from '../analytics-data';
import { exportTrendCsv } from '../utils/analyticsCardCsv';
import { AovTrendChart } from '../charts/AovTrendChart';
import { activeBuckets } from './shared/buckets';
import { NO_BUCKETS } from './shared/constants';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';
import { useMoney } from './shared/useMoney';

export function AovCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  const getString = useGetString();
  const { data, prev, error } = useCardDataCompare<AovTrend>('aov', q, compare ?? false);
  const buckets = data ? data.buckets : NO_BUCKETS;
  const prevBuckets = prev ? prev.buckets : NO_BUCKETS;
  const active = activeBuckets(buckets);
  // True average order value: total revenue ÷ total orders across the
  // range (a weighted average), not an unweighted mean of per-bucket AOVs.
  const avg = data && data.total_orders > 0 ? Math.round(data.total_minor / data.total_orders) : 0;
  const prevAvg = prev && prev.total_orders > 0 ? Math.round(prev.total_minor / prev.total_orders) : 0;
  // Peak/Low come from the active buckets — a zero-filled no-sales day is
  // not a $0 AOV reading.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const delta = compare ? periodDelta(avg, prevAvg) : active.length ? seriesDelta(active) : null;
  if (error) return <CardError error={error} />;
  if (!data) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={fmt(avg)} label={l10n.getString('analytics-card-aov')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-aov-aria')} onClick={() => exportTrendCsv('aov', l10n.getString('analytics-export-col-aov'), buckets, q.from, q.to, (id) => l10n.getString(id), fmt)} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <AovTrendChart buckets={buckets} prevBuckets={prevBuckets} compare={compare ?? false} expanded={expanded} fmt={fmt} getString={getString} />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: fmt(peak.value) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: fmt(low.value) })}</p>}
    </Visual>
  );
}
