//! Table turn-time card. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the bars chart now lives in
//! `charts/TablesTrendChart`.

import { useLocalization } from '@fluent/react';
import { periodDelta, turnDelta, type AnalyticsQuery, type Bucket } from '../analytics-data';
import { exportTrendCsv } from '../utils/analyticsCardCsv';
import { TablesTrendChart } from '../charts/TablesTrendChart';
import { activeBuckets } from './shared/buckets';
import { NO_BUCKETS } from './shared/constants';
import { CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';

export function TablesCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const getString = useGetString();
  const { data: raw, prev: prevRaw, error } = useCardDataCompare<Bucket[]>('tables', q, compare ?? false);
  const data = raw ?? NO_BUCKETS;
  const prevData = prevRaw ?? NO_BUCKETS;
  const active = activeBuckets(data);
  const prevActive = activeBuckets(prevData);
  const avgTurn = active.length ? Math.round(active.reduce((s, d) => s + d.value, 0) / active.length) : 0;
  const prevAvgTurn = prevActive.length ? Math.round(prevActive.reduce((s, d) => s + d.value, 0) / prevActive.length) : 0;
  // Peak/Low come from the active buckets — a zero-filled no-order day is
  // not a 0-minute turn.
  const peak = active.length ? active.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const low = active.length ? active.reduce((a, b) => (b.value < a.value ? b : a)) : null;
  // Compare mode shows the period-over-period change; off-mode keeps the
  // in-series turn-time delta over the active buckets (faster turns =
  // shorter minutes; zero-filled no-order days are not "0-minute turns").
  const delta = compare ? periodDelta(avgTurn, prevAvgTurn) : turnDelta(active);
  if (error) return <CardError error={error} />;
  if (!raw) return <CardLoading />;
  return (
    <Visual>
      <div className="analytics-kpi-row">
        <Kpi value={avgTurn > 0 ? l10n.getString('analytics-unit-minutes', { n: String(avgTurn) }) : '—'} label={l10n.getString('analytics-card-tables-turn')} />
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} tone="bad" compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-tables-aria')} onClick={() => exportTrendCsv('tables', l10n.getString('analytics-export-col-turn'), data, q.from, q.to, (id) => l10n.getString(id), (v) => String(Math.round(v)))} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <TablesTrendChart data={data} prev={prevData} compare={compare ?? false} expanded={expanded} getString={getString} />
      </div>
      {peak && <p className="analytics-card-insight">{l10n.getString('analytics-card-peak', { label: peak.label, value: l10n.getString('analytics-unit-minutes', { n: String(peak.value) }) })}</p>}
      {low && <p className="analytics-card-insight">{l10n.getString('analytics-card-low', { label: low.label, value: l10n.getString('analytics-unit-minutes', { n: String(low.value) }) })}</p>}
    </Visual>
  );
}
