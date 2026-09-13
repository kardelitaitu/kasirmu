//! Staff performance card — ranked by sales total. Extracted verbatim from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.2). The waitstaff card
//! shares the loader type but ranks by covers, not revenue.

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

export function StaffCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { short, fmt } = useMoney();
  const { data: staff, prev: prevStaff, error } = useCardDataCompare<StaffAnalyticsRow[]>('staff', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!staff) return <CardLoading />;
  if (staff.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const buildRows = (rows: StaffAnalyticsRow[]): RankRow[] => rows
    .slice()
    .sort((a, b) => b.sale_total_minor - a.sale_total_minor)
    .map((r) => ({ name: r.display_name, value: r.sale_total_minor, display: short(r.sale_total_minor) }));
  const rows = rowDeltas(buildRows(staff), prevStaff ? buildRows(prevStaff) : null);
  const totalSales = rows.reduce((s, r) => s + r.value, 0);
  const prevTotal = prevStaff ? prevStaff.reduce((s, r) => s + r.sale_total_minor, 0) : 0;
  const delta = compare ? periodDelta(totalSales, prevTotal) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={short(totalSales)} label={l10n.getString('analytics-card-staff-sales')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-csv-aria')} onClick={() => exportStaffCsv('staff-performance', staff, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}
