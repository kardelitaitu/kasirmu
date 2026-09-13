//! Voided line-items card — quantity-ranked. Extracted verbatim from
//! `AnalyticsCardContent.tsx` (agents-2 Phase 2.2).

import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type VoidedItemRow } from '../analytics-data';
import { exportVoidedItemsCsv } from '../utils/analyticsCardCsv';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { RankedList } from './shared/RankedList';
import { Visual } from './shared/Visual';
import { rowDeltas, useCardDataCompare } from './shared/useCardData';

export function VoidsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { data: items, prev: prevItems, error } = useCardDataCompare<VoidedItemRow[]>('voids', q, compare ?? false);
  if (error) return <CardError error={error} />;
  if (!items) return <CardLoading />;
  if (items.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  const rows = rowDeltas(
    items.map((it) => ({ name: it.name, value: it.qty, display: `${it.qty}×` })),
    prevItems ? prevItems.map((it) => ({ name: it.name, value: it.qty, display: '' })) : null,
  );
  const totalQty = rows.reduce((s, r) => s + r.value, 0);
  const prevQty = prevItems ? prevItems.reduce((s, it) => s + it.qty, 0) : 0;
  const delta = compare ? periodDelta(totalQty, prevQty) : null;
  return (
    <Visual>
      <div className="analytics-kpi-tiles">
        <Kpi value={String(totalQty)} label={l10n.getString('analytics-card-voids-count')} tone="bad" />
      </div>
      <div className="analytics-kpi-actions analytics-card-insight">
        {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
        <ExportCsvButton ariaLabel={l10n.getString('analytics-export-voids-aria')} onClick={() => exportVoidedItemsCsv('voids', items, q.from, q.to, (id) => l10n.getString(id))} />
      </div>
      <RankedList rows={rows} ariaLabel={title} limit={expanded ? undefined : 5} />
    </Visual>
  );
}
