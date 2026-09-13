//! Payment-method mix card. Extracted from `AnalyticsCardContent.tsx`
//! (agents-2 Phase 2.3); the stacked bar now lives in
//! `charts/PaymentMixChart`. The segment derivation (largest-remainder
//! percentages) stays HERE — the Legend and the chart render the same
//! segs, and the split is the card's reading, not the chart's.

import { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import { periodDelta, type AnalyticsQuery, type PaymentMethodRow } from '../analytics-data';
import { exportPaymentsCsv } from '../utils/analyticsCardCsv';
import { PaymentMixChart, type PaymentSeg } from '../charts/PaymentMixChart';
import { PALETTE } from '../charts/chartTheme';
import { largestRemainderPcts, PAYMENT_NAMES } from './shared/constants';
import { CardEmpty, CardError, CardLoading } from './shared/CardStates';
import { DeltaChip } from './shared/DeltaChip';
import { ExportCsvButton } from './shared/ExportCsvButton';
import { Kpi } from './shared/Kpi';
import { Legend } from './shared/Legend';
import { Visual } from './shared/Visual';
import { useCardDataCompare } from './shared/useCardData';
import { useGetString } from './shared/useGetString';
import { useMoney } from './shared/useMoney';

export function PaymentsCard({ q, title, expanded, compare }: { q: AnalyticsQuery; title: string; expanded?: boolean | undefined; compare?: boolean | undefined }) {
  const { l10n } = useLocalization();
  const { fmt } = useMoney();
  const getString = useGetString();
  const { data: rows, prev: prevRows, error } = useCardDataCompare<PaymentMethodRow[]>('payments', q, compare ?? false);
  const total = rows ? rows.reduce((s, r) => s + r.total_minor, 0) : 0;
  const prevTotal = prevRows ? prevRows.reduce((s, r) => s + r.total_minor, 0) : 0;
  // Largest-remainder rounding so the stacked bar always sums to 100. The
  // segments + percentages are derived together so the chart's useMemo sees
  // one stable pair (no fresh `[]` fallback each render).
  const { segs, pcts } = useMemo(() => {
    if (!rows) return { segs: [] as PaymentSeg[], pcts: [] as number[] };
    const pctByMethod = largestRemainderPcts(rows.map((r) => r.total_minor), total);
    const segs = rows.map((r, i) => ({
      key: r.payment_method,
      name: PAYMENT_NAMES[r.payment_method] ? l10n.getString(PAYMENT_NAMES[r.payment_method]!) : r.payment_method,
      pct: pctByMethod[i] ?? 0,
    }));
    return { segs, pcts: segs.map((s) => s.pct) };
  }, [rows, total, l10n]);
  const topPct = pcts.length ? Math.max(...pcts) : 0;
  const topSeg = segs[pcts.indexOf(topPct)];
  const delta = compare ? periodDelta(total, prevTotal) : null;
  if (error) return <CardError error={error} />;
  if (!rows) return <CardLoading />;
  if (rows.length === 0) return <CardEmpty message={l10n.getString('analytics-empty-generic')} />;
  return (
    <Visual className="analytics-card-visual--split">
      <div className="analytics-kpi-row">
        {topSeg && <Kpi value={`${topSeg.name} · ${topPct}%`} label={l10n.getString('analytics-card-payments-top')} />}
        <div className="analytics-kpi-actions">
          {delta !== null && <DeltaChip value={delta} compare={compare === true} />}
          <ExportCsvButton ariaLabel={l10n.getString('analytics-export-payments-aria')} onClick={() => exportPaymentsCsv(rows, q.from, q.to, fmt, (id) => l10n.getString(id))} />
        </div>
      </div>
      <div className="analytics-card-chart" role="img" aria-label={title}>
        <PaymentMixChart segs={segs} pcts={pcts} expanded={expanded} getString={getString} />
      </div>
      <Legend items={segs.map((s, i) => ({ name: s.name, value: `${s.pct}%`, color: PALETTE[i % PALETTE.length]! }))} />
    </Visual>
  );
}
