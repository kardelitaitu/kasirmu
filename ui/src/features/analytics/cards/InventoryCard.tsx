//! Inventory turnover card. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the units-sold trend now lives in
//! `charts/InventoryTrendChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type Bucket, type InventoryTrendRow, type InventoryTurnoverRow } from '../analytics-data';
import { exportTrendCsv } from '../utils/analyticsCardCsv';
import { InventoryTrendChart } from '../charts/InventoryTrendChart';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';

export function InventoryCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const getString = useGetString();
  const { data: loaded, prev: prevLoaded, error } = useCardDataCompare<[InventoryTurnoverRow, InventoryTrendRow[]]>('inventory', q, compare ?? false);
  const [turnoverRow, trend]: [InventoryTurnoverRow | null, InventoryTrendRow[]] = loaded ?? [null, []];
  const [prevRow, prevTrend]: [InventoryTurnoverRow | null, InventoryTrendRow[]] = prevLoaded ?? [null, []];
  const turnover = turnoverRow && turnoverRow.stock_on_hand > 0 ? turnoverRow.units_sold / turnoverRow.stock_on_hand : 0;
  const prevTurnover = prevRow && prevRow.stock_on_hand > 0 ? prevRow.units_sold / prevRow.stock_on_hand : 0;
  const data: Bucket[] = trend.map((t) => ({ label: t.date.slice(5), value: t.units_sold }));
  const prevData: Bucket[] = prevTrend.map((t) => ({ label: t.date.slice(5), value: t.units_sold }));
  const skus = turnoverRow ? turnoverRow.sku_count : 0;
  const daysOfStock = turnoverRow && turnover > 0 ? Math.max(1, Math.round(turnoverRow.range_days / turnover)) : 0;
  const delta = compare ? periodDelta(turnover, prevTurnover) : null;
  if (error) return <CardError error={error} />;
  if (!loaded) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={turnover > 0 ? `${turnover.toFixed(1)}×` : '—'} label={l10n.getString('analytics-card-inventory-turnover')} />
        <Kpi value={daysOfStock > 0 ? l10n.getString('analytics-unit-days', { n: String(daysOfStock) }) : '—'} label={l10n.getString('analytics-card-inventory-days')} />
        <Kpi value={String(skus)} label={l10n.getString('analytics-card-inventory-skus')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-inventory-aria')} onClick={() => exportTrendCsv('inventory', l10n.getString('analytics-export-col-units'), data, q.from, q.to, (id) => l10n.getString(id), (v) => String(v))} />
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <InventoryTrendChart data={data} prev={prevData} compare={compare ?? false} expanded={expanded} getString={getString} />
      </div>
    </Visual>
  );
}
