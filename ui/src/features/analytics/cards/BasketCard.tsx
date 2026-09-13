//! Basket-size card. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the bars+overlay chart now lives in
//! `charts/BasketTrendChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type BasketTrend, type Bucket } from '../analytics-data';
import { exportTrendCsv } from '../utils/analyticsCardCsv';
import { BasketTrendChart } from '../charts/BasketTrendChart';
import { activeBuckets } from './shared/buckets';
import { NO_BUCKETS } from './shared/constants';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';

export function BasketCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const getString = useGetString();
  const { data: basket, prev: prevBasket, error } = useCardDataCompare<BasketTrend>('basket', q, compare ?? false);
  const data = basket ? basket.buckets : NO_BUCKETS;
  const prevData = prevBasket ? prevBasket.buckets : NO_BUCKETS;
  const avg = basket ? basket.avg_line_count : 0;
  const orders = basket ? basket.sale_count : 0;
  const prevAvg = prevBasket ? prevBasket.avg_line_count : 0;
  const active = activeBuckets(data);
  // Peak/Low come from the active buckets — a zero-filled no-sales day is
  // not a 0.0 items/order reading.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  const delta = compare ? periodDelta(avg, prevAvg) : null;
  if (error) return <CardError error={error} />;
  if (!basket) return <CardLoading />;
  // Real per-bucket basket size from the backend — average items per order
  // per bucket, with the range totals as the KPI tiles.
  return (
    <Visual>
      <div className={`analytics-kpi-tiles${expanded ? ' analytics-kpi-tiles--expanded' : ''}`}>
        <Kpi value={avg > 0 ? avg.toFixed(1) : '—'} label={l10n.getString('analytics-card-basket-items')} />
        <Kpi value={orders > 0 ? String(orders) : '—'} label={l10n.getString('analytics-card-basket-orders')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-basket-aria')} onClick={() => exportTrendCsv('basket', l10n.getString('analytics-export-col-basket'), data, q.from, q.to, (id) => l10n.getString(id), (v) => v.toFixed(1))} />
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <BasketTrendChart data={data as Bucket[]} prev={prevData} compare={compare ?? false} expanded={expanded} getString={getString} />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: peak.value.toFixed(1) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: low.value.toFixed(1) })}</p>}
    </Visual>
  );
}
