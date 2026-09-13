//! Table occupancy card. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the hourly curve now lives in
//! `charts/OccupancyTrendChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type TableOccupancy } from '../analytics-data';
import { exportOccupancyCsv } from '../utils/analyticsCardCsv';
import { OccupancyTrendChart } from '../charts/OccupancyTrendChart';
import { NO_HOURLY } from './shared/constants';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';

export function OccupancyCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const getString = useGetString();
  // Real rate from the live tables snapshot + real per-hour completed table
  // orders from the backend — nothing is demo-shaped anymore.
  const { data: occ, prev: prevOcc, error } = useCardDataCompare<TableOccupancy>('occupancy', q, compare ?? false);
  const rate = occ ? occ.rate : 0;
  const hourly = occ ? occ.hourly : NO_HOURLY;
  const prevHourly = prevOcc ? prevOcc.hourly : NO_HOURLY;
  const peak = occ ? occ.peak_hour : null;
  // The peak-hour bucket carries the raw order count for the meta line;
  // pct/level already share the heatmap's intensity scale.
  const peakBucket = peak !== null ? hourly.find((h) => h.hour === peak) : null;
  // The live rate is a snapshot, so the compare chip uses table-order
  // volume across the period (sum of the hourly counts) instead.
  const totalOrders = hourly.reduce((s, h) => s + h.table_orders, 0);
  const prevOrders = prevHourly.reduce((s, h) => s + h.table_orders, 0);
  const delta = compare ? periodDelta(totalOrders, prevOrders) : null;
  if (error) return <CardError error={error} />;
  if (!occ) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-occupancy">
        <div className="analytics-occupancy-head">
          <span className="analytics-occupancy-value">{rate}%</span>
          <span className="analytics-occupancy-label">{l10n.getString('analytics-card-occupancy-occupied')}</span>
        </div>
        <div className="analytics-occupancy-track" role="img" aria-label={title}>
          <span className="analytics-occupancy-fill" style={{ width: `${rate}%` }} />
        </div>
        <div className="analytics-occupancy-meta">
          {peak !== null && (
            <span>
              {l10n.getString('analytics-card-occupancy-peak')} · {String(peak).padStart(2, '0')}:00
              {peakBucket && ` · ${peakBucket.table_orders} ${l10n.getString('analytics-card-occupancy-orders')}`}
            </span>
          )}
        </div>
        <div className="analytics-kpi-actions analytics-card-insight">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-occupancy-aria')} onClick={() => exportOccupancyCsv(occ, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
        <div className="analytics-card-chart" role="img" aria-label={l10n.getString('analytics-card-occupancy-hourly')}>
          <OccupancyTrendChart hourly={hourly} prevHourly={prevHourly} compare={compare ?? false} expanded={expanded} getString={getString} />
        </div>
      </div>
    </Visual>
  );
}
