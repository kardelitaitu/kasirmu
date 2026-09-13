//! Refunds (voided-sales summary) card. Extracted verbatim from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.2). Prop exception: takes
//! only `{ q, compare }` — no title/expanded — and the dispatcher passes
//! exactly that.

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type VoidedSummaryRow } from '../analytics-data';
import { exportRefundsCsv } from '../utils/analyticsCardCsv';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useMoney } from './shared/useMoney';

export function RefundsCard({ q, compare }: { q: AnalyticsQuery; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmtIn, count } = useMoney();
  // REP-06: voided totals arrive as one row per currency.
  const { data: rows, prev: prevRows, error } = useCardDataCompare<VoidedSummaryRow[]>('refunds', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  const totalCount = rows.reduce((s, r) => s + r.void_count, 0);
  if (totalCount === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const amountDisplay = rows.map((r) => fmtIn(r.void_total_minor, r.currency)).join(' · ');
  const avgDisplay = rows
    .map((r) => fmtIn(r.void_count > 0 ? Math.round(r.void_total_minor / r.void_count) : 0, r.currency))
    .join(' · ');
  const delta =
    compare && prevRows
      ? periodDelta(totalCount, prevRows.reduce((s, r) => s + r.void_count, 0))
      : null;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={count(totalCount)} label={l10n.getString('analytics-card-refunds-count')} tone="bad" />
        <Kpi value={amountDisplay} label={l10n.getString('analytics-card-refunds-amount')} tone="bad" />
        <Kpi value={avgDisplay} label={l10n.getString('analytics-card-refunds-avg')} />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-refunds-aria')} onClick={() => exportRefundsCsv(rows, q.from, q.to, fmtIn, (id) => l10n.getString(id))} />
      </div>
    </Visual>
  );
}
