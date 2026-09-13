//! Waitstaff card — ranked by covers served (sale_count), the deliberate
//! differentiator versus the Staff Performance card's revenue ranking.
//! Extracted verbatim from `AnalyticsCardContent.tsx` (agents-2 Phase 2.2).

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type RankRow, type StaffAnalyticsRow } from '../analytics-data';
import { exportStaffCsv } from '../utils/analyticsCardCsv';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { RankedList } from './shared/RankedList';
import { Visual } from './shared/Visual';
import { rowDeltas, useCardDataCompare } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function WaitstaffCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt, count } = useMoney();
  const { data: staff, prev: prevStaff, error } = useCardDataCompare<StaffAnalyticsRow[]>('waitstaff', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!staff) return <CardLoading />;
  if (staff.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  // Rank waitstaff by covers served (sale_count), not revenue — the
  // differentiator versus the shared Staff Performance card, which ranks by
  // sales total.
  const buildRows = (rows: StaffAnalyticsRow[]): RankRow[] => rows
    .slice()
    .sort((a, b) => b.sale_count - a.sale_count)
    .map((r) => ({ name: r.display_name, value: r.sale_count, display: `${count(r.sale_count)} ${l10n.getString('analytics-card-waitstaff-covers')}` }));
  const rows = rowDeltas(buildRows(staff), prevStaff ? buildRows(prevStaff) : null);
  // "Total covers" is a count (orders served), not a money figure — sum the
  // sale counts so the KPI matches its label.
  const totalCovers = staff.reduce((s, r) => s + r.sale_count, 0);
  const prevCovers = prevStaff ? prevStaff.reduce((s, r) => s + r.sale_count, 0) : 0;
  const delta = compare ? periodDelta(totalCovers, prevCovers) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={count(totalCovers)} label={l10n.getString('analytics-card-waitstaff-total')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-waitstaff-aria')} onClick={() => exportStaffCsv('waitstaff', staff, q.from, q.to, fmt, (id) => l10n.getString(id), 'covers')} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}
