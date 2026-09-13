//! Top products card — ranks product sales; the loader may return plain
//! top-product rows or menu-engineering rows (rows carrying `total_qty`
//! are the former). Extracted verbatim from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.2).

import { useLocalization } from '@fluent/react';
import type { MenuEngineeringRow } from '@/api/reports';
import { periodDelta, type AnalyticsQuery, type RankRow, type TopProductRow } from '../analytics-data';
import { exportTopItemsCsv } from '../utils/analyticsCardCsv';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { RankedList } from './shared/RankedList';
import { Visual } from './shared/Visual';
import { rowDeltas, useCardDataCompare } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function TopItemsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { short, fmt } = useMoney();
  const { data: raw, prev: prevRaw, error } = useCardDataCompare<(TopProductRow | MenuEngineeringRow)[]>('top-items', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!raw) return <CardLoading />;
  if (raw.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const buildRows = (list: (TopProductRow | MenuEngineeringRow)[]): RankRow[] => list.map((r) => {
    if ('total_qty' in r) {
      return { name: r.name, value: r.total_minor, display: `${short(r.total_minor)} · ${r.total_qty}×` };
    }
    return { name: r.name, value: r.total_revenue_minor, display: `${short(r.total_revenue_minor)} · ${r.total_volume}×` };
  });
  const rows = rowDeltas(buildRows(raw), prevRaw ? buildRows(prevRaw) : null);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prevRaw ? prevRaw.reduce((s, r) => s + ('total_qty' in r ? r.total_minor : r.total_revenue_minor), 0) : 0;
  const topName = rows[0]?.name;
  const delta = compare ? periodDelta(total, prevTotal) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        {topName && <Kpi value={topName} label={l10n.getString('analytics-card-top-product')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-top-items-aria')} onClick={() => exportTopItemsCsv(raw, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}
