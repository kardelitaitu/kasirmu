//! Discount-code redemption card. Extracted verbatim from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.2).

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type DiscountsSummaryRow, type RankRow } from '../analytics-data';
import { exportDiscountsCsv } from '../utils/analyticsCardCsv';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { RankedList } from './shared/RankedList';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';

export function DiscountsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: summary, prev: prevSummary, error } = useCardDataCompare<DiscountsSummaryRow>('discounts', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!summary) return <CardLoading />;
  if (summary.codes.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const rows: RankRow[] = summary.codes.map((c) => ({
    name: c.label,
    value: c.redeemed_count,
    display: `${c.redeemed_count} ${l10n.getString('analytics-card-discounts-redeemed')}`,
  }));
  const discountShare = summary.share_percent;
  const redeemed = summary.codes.reduce((s, c) => s + c.redeemed_count, 0);
  const prevRedeemed = prevSummary ? prevSummary.codes.reduce((s, c) => s + c.redeemed_count, 0) : 0;
  const delta = compare ? periodDelta(redeemed, prevRedeemed) : null;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={`${discountShare.toFixed(1)}%`} label={l10n.getString('analytics-card-discounts-share')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-discounts-aria')} onClick={() => exportDiscountsCsv(summary, q.from, q.to, (id) => l10n.getString(id))} />
        </div>
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}
